// src/modules/racing/module.js
const { ownerOnly } = require('../../utils/permissions');

const {
  ensurePlayer,
  getPlayer,
  updatePlayerCash,
  setPlayerPart,
  getRace,
  setRace,
  clearRace,
  getCooldownUntil,
  setCooldownUntil,
  getNextRace,
  rollNextRace,
} = require('../../services/racing/state');

const { computeRaceOutcome } = require('../../services/racing/logic');
const partsConfig = require('../../services/racing/parts');
const { RACE_JOIN_WINDOW_MS, RACE_COOLDOWN_MS } = require('../../config/env');

const JOIN_WINDOW_MS = Number(RACE_JOIN_WINDOW_MS || 60000);       // 60s
const COOLDOWN_MS = Number(RACE_COOLDOWN_MS || 3600000);          // 1h
const UPGRADE_COST = 100;
const LAST_PLACE_PAYOUT = 50;
const PLACE_STEP = 25;

let raceTimer = null;

// Adjust these helpers to match your ctx shape if needed.
function getPlayerId(ctx) {
  const author =
    ctx.author ||
    ctx.user ||
    (ctx.msg && ctx.msg.authorDetails) ||
    null;

  return (
    author?.channelId ||
    author?.id ||
    ctx.userId ||
    ctx.username ||
    'anonymous'
  );
}

function getPlayerName(ctx) {
  const author =
    ctx.author ||
    ctx.user ||
    (ctx.msg && ctx.msg.authorDetails) ||
    null;

  return (
    author?.displayName ||
    author?.name ||
    ctx.username ||
    'Unknown Racer'
  );
}

function formatRemaining(ms) {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  if (hh === '00') {
    // For short cooldowns, HH:MM might look weird; stick to 00:MM
    return `${hh}:${mm}`;
  }
  return `${hh}:${mm}`;
}

function formatLobbyCountdown(lobbyEndsAt, now) {
  let msLeft = lobbyEndsAt - now;
  if (msLeft < 0) msLeft = 0;

  const totalSeconds = Math.floor(msLeft / 1000);
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60);
    return `Race begins in ${minutes} minute${minutes === 1 ? '' : 's'}!`;
  }

  // Clamp to at least 1 second so you don't get "0 seconds"
  const seconds = Math.max(1, totalSeconds);
  return `Race begins in ${seconds} second${seconds === 1 ? '' : 's'}!`;
}


function normalizeToken(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

// map user-friendly part names to config keys
const PART_ALIASES = {
  tires: 'tires',
  tyre: 'tires',
  suspension: 'suspension',
  shocks: 'suspension',
  brakes: 'brakes',
  brake: 'brakes',
  intake: 'intake',
  exhaust: 'exhaust',
  ecu: 'ecu',
  carbonfiber: 'carbonfiber',
  carbonfibre: 'carbonfiber',
  cf: 'carbonfiber',
};

function resolvePartKey(input) {
  const norm = normalizeToken(input);
  for (const [alias, key] of Object.entries(PART_ALIASES)) {
    if (normalizeToken(alias) === norm) return key;
  }
  // direct match
  if (partsConfig[norm]) return norm;
  return null;
}

function resolveChoiceKey(partKey, input) {
  const norm = normalizeToken(input);
  const slot = partsConfig[partKey];
  if (!slot) return null;
  for (const key of Object.keys(slot)) {
    if (key === 'stock') continue;
    if (normalizeToken(key) === norm) return key;
  }
  return null;
}

function formatPartList(partKey) {
  const slot = partsConfig[partKey];
  if (!slot) return '';
  const names = Object.keys(slot).filter((k) => k !== 'stock');
  return names.join(', ');
}

function allPartsStock(parts) {
  return Object.values(parts || {}).every((v) => v === 'stock');
}

function capitalize(str) {
  return String(str || '').charAt(0).toUpperCase() + String(str || '').slice(1);
}

async function resolveRace(ctx) {
  const race = getRace();
  if (!race) return;
  const now = Date.now();
  const playerIds = race.players || [];

  clearRace();
  raceTimer = null;

  if (playerIds.length <= 1) {
    setCooldownUntil(now + COOLDOWN_MS);
    rollNextRace();
    await ctx.reply('Nobody else showed up. The race is a bye, no cash awarded.');
    return;
  }

  // Build players list with parts
  const players = playerIds
    .map((id) => getPlayer(id))
    .filter(Boolean);

  // New: compute race outcome with DNFs
  const { ranked, casualties } = computeRaceOutcome(
    players,
    race.venue,
    race.weather
  );

  // Optional: single casualties message before results
  if (casualties.length > 0) {
    const casualtySegments = casualties.map((c) => {
      if (c.reason === 'cops') {
        return `${c.name} was busted by the cops`;
      }
      if (c.reason === 'crash') {
        return `${c.name} crashed out`;
      }
      if (c.reason === 'mechanical') {
        return c.failedComponent
          ? `${c.name} suffered a ${c.failedComponent} failure`
          : `${c.name} suffered a mechanical failure`;
      }
      return `${c.name} did not finish`;
    });

    const casualtyMsg = `Race casualties: ${casualtySegments.join(' | ')}`;
    await ctx.reply(casualtyMsg);
  }

  // Payouts:
  // - All DNFs get LAST_PLACE_PAYOUT (50).
  // - The last finisher also gets 50.
  // - Other finishers use linear formula based on *finishers only*.
  const finishers = ranked.filter((p) => !p.dnf);
  const numFinishers = finishers.length;

  // Assign "place among finishers" so we can pay them correctly
  let finisherRank = 0;
  ranked.forEach((p) => {
    if (!p.dnf) {
      finisherRank += 1;
      p.place = finisherRank;
    } else {
      p.place = null;
    }
  });

  ranked.forEach((p) => {
    let payout = LAST_PLACE_PAYOUT;

    if (!p.dnf && numFinishers > 0) {
      if (p.place === numFinishers) {
        // Last finisher gets base payout
        payout = LAST_PLACE_PAYOUT;
      } else {
        // Better finishers get more
        payout =
          LAST_PLACE_PAYOUT + (numFinishers - p.place) * PLACE_STEP;
      }
    }

    p.payout = payout;
    updatePlayerCash(p.id, payout);
  });

  setCooldownUntil(now + COOLDOWN_MS);
  rollNextRace(); // we won't mention next venue in this message to save chars

  // --- Compact results message (char-budget friendly) ---

  const header = `Race Finished! -`;

  // Show first 5 players, collapse the rest
  const shown = ranked.slice(0, 5);
  const others = ranked.length - shown.length;

  // Build segments:
  // - Finishers: "1) Name +1234"
  // - DNFs: "DNF) Name +50"
  const segments = shown.map((p) => {
    const label = p.dnf ? 'DNF' : `${p.place || '?'}`;
    return `${label}) ${p.name} +${p.payout}`;
  });

  // Append “+N more” if we collapsed the list
  if (others > 0) {
    segments.push(`+${others} more`);
  }

  const msg = `${header} ${segments.join(' | ')}`;

  await ctx.reply(msg);
}




module.exports = {
  name: 'racing',
  description: 'Street racing mini-game.',
  middleware: [
    // placeholder; you can add owner/permission checks here if needed
    async (ctx, next) => {
      await next();
    },
  ],
  commands: {
    race: {
      name: 'race',
      description: 'Join or start a street race.',
      usage: 'race',
      aliases: [],
      async run(ctx) {
        const now = Date.now();
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);

        const player = ensurePlayer(userId, userName);

        // Check cooldown
        const cooldownUntil = getCooldownUntil();
        if (cooldownUntil > now) {
          const remaining = cooldownUntil - now;
          const hhmm = formatRemaining(remaining);
          return ctx.reply(`The next race will be available in ${hhmm}`);
        }

        let race = getRace();

        // No race yet -> start lobby
        if (!race) {
          const nextRace = getNextRace();
          race = {
            venue: nextRace.venue,
            weather: nextRace.weather,
            players: [player.id],
            lobbyEndsAt: now + JOIN_WINDOW_MS,
          };
          setRace(race);

          // Schedule resolution
          if (raceTimer) clearTimeout(raceTimer);
          raceTimer = setTimeout(() => {
            // fire and forget; ctx.reply is still valid like your riddle command
            resolveRace(ctx).catch((err) => {
              ctx.logger?.error?.('[racing] Error resolving race', err);
            });
          }, JOIN_WINDOW_MS);

          return ctx.reply(
            `${player.name} wants to street race! Message !race to line up at the starting line! Venue: ${race.venue}; Weather: ${race.weather}`
          );
        }

        // Race lobby active
        if (race.lobbyEndsAt && race.lobbyEndsAt <= now) {
          // Lobby expired but timer may have been lost (e.g., after restart).
          // Resolve it now, then this command is done.
          await resolveRace(ctx);
          return;
        }


        if (!race.players.includes(player.id)) {
          race.players.push(player.id);
          setRace(race);

          const countdown = formatLobbyCountdown(race.lobbyEndsAt, now);

          return ctx.reply(
            `${player.name} has joined the street race! venue: ${race.venue}; weather: ${race.weather}. ${countdown}`
          );
        }


        // Already in race: no-op, no reply
      },
    },

    venue: {
      name: 'venue',
      description: 'Show the next race venue and weather.',
      usage: 'venue',
      aliases: ['track'],
      async run(ctx) {
        const nextRace = getNextRace();
        await ctx.reply(
          `Next street race, Venue: ${nextRace.venue}; Weather: ${nextRace.weather}`
        );
      },
    },

    car: {
      name: 'car',
      description: 'Show your current car build.',
      usage: 'car',
      aliases: ['garage'],
      async run(ctx) {
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(userId, userName);

        const parts = player.parts || {};
        const {
          tires = 'stock',
          suspension = 'stock',
          brakes = 'stock',
          intake = 'stock',
          exhaust = 'stock',
          ecu = 'stock',
          carbonfiber = 'stock',
        } = parts;

        if (allPartsStock(parts)) {
          return ctx.reply(
            `${player.name} is driving a bone-stock sleeper. Everything is stock.`
          );
        }

        await ctx.reply(
          `${player.name} has a car with ${tires} tires, ${suspension} suspension, ${brakes} brakes, ${intake} intake, ${exhaust} exhaust, ${ecu} ECU, ${carbonfiber} carbonfiber`
        );
      },
    },

    upgrade: {
      name: 'upgrade',
      description: 'View or purchase car upgrades.',
      usage: 'upgrade <part> <name>',
      aliases: ['modify'],
      async run(ctx) {
        const args = ctx.args || [];
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(userId, userName);

        if (args.length === 0) {
          return ctx.reply(
            'To see what upgrades are available for a part, type !upgrade [Part Name]. Part types are: Tires, Suspension, Brakes, Intake, Exhaust, ECU, CarbonFiber'
          );
        }

        // At least one arg: part
        const partKey = resolvePartKey(args[0]);
        if (!partKey) {
          return ctx.reply(
            'Unknown part. Parts are: Tires, Suspension, Brakes, Intake, Exhaust, ECU, CarbonFiber'
          );
        }

        // Only part -> list options
        if (args.length === 1) {
          const slot = partsConfig[partKey];
          const options = Object.keys(slot || {}).filter((k) => k !== 'stock');
          if (!options.length) {
            return ctx.reply(`No upgrades available for ${capitalize(partKey)}.`);
          }
          const list = options.join(', ');
          return ctx.reply(
            `Available ${partKey} upgrades: ${list}. Each costs ${UPGRADE_COST} cash.`
          );
        }

        // part + name -> purchase and apply
        const choiceRaw = args.slice(1).join(' ');
        const choiceKey = resolveChoiceKey(partKey, choiceRaw);
        if (!choiceKey) {
          return ctx.reply(
            `No upgrade "${choiceRaw}" for ${partKey}. Type !upgrade ${partKey} to see options.`
          );
        }

        if ((player.cash || 0) < UPGRADE_COST) {
          return ctx.reply(
            `You need ${UPGRADE_COST} cash for ${choiceKey} ${partKey}. You only have ${player.cash || 0}.`
          );
        }

        setPlayerPart(player.id, partKey, choiceKey, UPGRADE_COST);
        await ctx.reply(
          `${player.name} upgraded their ${partKey} to ${choiceKey} for ${UPGRADE_COST} cash.`
        );
      },
    },
    racereset: {
      name: 'racereset',
      description: 'OWNER-ONLY: Reset all racing data.',
      usage: 'racereset',
      aliases: ['resetrace'],
      middleware: [ownerOnly()], // ← only the owner can run this command
      async run(ctx) {
        const { resetAll, rollNextRace } = require('../../services/racing/state');

        resetAll();
        const next = rollNextRace();

        await ctx.reply(
          `!!! RACING DATA HAS BEEN RESET !!! Next street race, Venue: ${next.venue}; Weather: ${next.weather}`
        );
      },
    },

    cash: {
      name: 'cash',
      description: 'Show your current cash balance.',
      usage: 'cash',
      aliases: ['money'],
      async run(ctx) {
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(userId, userName);
        const amount = player.cash || 0;
        await ctx.reply(`@${player.name} has ${amount} cash.`);
      },
    },

    racehelp: {
      name: 'racehelp',
      description: 'Show racing help.',
      usage: 'racehelp',
      aliases: ['racerules'],
      async run(ctx) {
        await ctx.reply(
          'Street racing: Use !race to start or join a race; !venue shows the upcoming track; !car shows your build; !upgrade <part> lists or buys mods; !cash shows your money.'
        );
      },
    },

  },
};
