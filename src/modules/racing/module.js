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
  resetAll,
} = require('../../services/racing/state');

const { computeRaceOutcome } = require('../../services/racing/logic');
const partsConfig = require('../../services/racing/parts');
const {
  RACE_JOIN_WINDOW_MS,
  RACE_COOLDOWN_MS,
  DISCORD_RACING_CHANNELS = {},
} = require('../../config/env');
const { transferCash } = require('../../services/racing/transfer');
const {
  getForcedWinnerId,
  setForcedWinnerId,
  applyForcedWinner,
} = require('../../services/racing/forcedWinner');

const JOIN_WINDOW_MS = Number(RACE_JOIN_WINDOW_MS || 60000);       // 60s
const COOLDOWN_MS = Number(RACE_COOLDOWN_MS || 3600000);          // 1h
const LAST_PLACE_PAYOUT = 50;
const PLACE_STEP = 25;

// Track timers per scope so concurrent scopes don't overwrite each other.
const raceTimers = new Map();

function getScopeKey(ctx) {
  return ctx.stateScope || 'global';
}

function isDiscordChannelAllowed(ctx) {
  if (ctx.platform !== 'discord') return true;
  const guildId = ctx.platformMeta?.discord?.guildId;
  const currentChannel =
    ctx.platformMeta?.discord?.channelId || ctx.transport?.channelId || null;
  if (!guildId || !currentChannel) return false;

  const allowedChannel = DISCORD_RACING_CHANNELS[guildId];
  if (!allowedChannel) {
    ctx.reply('Racing commands are not enabled on this Discord server.');
    return false;
  }

  if (allowedChannel !== currentChannel) {
    ctx.reply(`Please use <#${allowedChannel}> for racing commands.`);
    return false;
  }
  return true;
}

async function racingScopeGuard(ctx, next) {
  // All racing commands share this middleware so transport/platform rules stay centralized.
  if (!isDiscordChannelAllowed(ctx)) return;
  await next();
}

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

function formatMsAsMinutesSeconds(ms) {
  if (ms < 0) ms = 0;

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  let seconds = totalSeconds % 60;

  // If there is time left but seconds came out 0, show at least 1s
  if (totalSeconds > 0 && seconds === 0) {
    seconds = 1;
  }

  const minPart = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const secPart = `${seconds} second${seconds === 1 ? '' : 's'}`;

  return `${minPart} ${secPart}`;
}


function formatLobbyCountdown(lobbyEndsAt, now) {
  let msLeft = lobbyEndsAt - now;
  if (msLeft < 0) msLeft = 0;

  const totalSeconds = Math.floor(msLeft / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  let seconds = totalSeconds % 60;

  // If there is time left but we somehow round to 0s, show at least 1s
  if (totalSeconds > 0 && seconds === 0) {
    seconds = 1;
  }

  const minPart = `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const secPart = `${seconds} second${seconds === 1 ? '' : 's'}`;

  return `Race begins in ${minPart} ${secPart}!`;
}




function normalizeToken(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function formatPartTypesList() {
  const keys = Object.keys(partsConfig || {});
  const pretty = keys.map((key) => {
    switch (key.toLowerCase()) {
      case 'carbonfiber':
        return 'CarbonFiber'; // to match your existing wording
      default:
        return capitalize(key);
    }
  });
  return pretty.join(', ');
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

function isOwnerUser(ctx, userId) {
  if (!userId) return false;
  if (ctx.platform === 'discord') {
    const ownerId =
      ctx.platformMeta?.rawDiscord?.guild?.ownerId ||
      ctx.platformMeta?.discord?.guildOwnerId ||
      null;
    return ownerId ? ownerId === userId : false;
  }

  if (ctx.platform === 'youtube') {
    // Treat the connected channel as the owner
    const channelId = ctx.platformMeta?.youtube?.channelId;
    return channelId ? channelId === userId : false;
  }

  return false;
}

function parseTargetId(raw) {
  if (!raw) return null;
  // Strip Discord mention wrappers <@...> or <@!...>
  const mentionMatch = String(raw).match(/^<@!?(\d+)>$/);
  if (mentionMatch) return mentionMatch[1];

  // Plain @prefix
  const atMatch = String(raw).match(/^@?(\d+)$/);
  if (atMatch) return atMatch[1];

  // Fallback: return raw as-is
  return String(raw);
}

// Resolves the active race for the current scope and pays out winnings.
async function resolveRace(ctx) {
  const scopeKey = getScopeKey(ctx);
  const race = getRace(scopeKey);
  if (!race) return;
  const now = Date.now();
  const playerIds = race.players || [];

  clearRace(scopeKey);
  const existingTimer = raceTimers.get(scopeKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
    raceTimers.delete(scopeKey);
  }

  if (playerIds.length <= 1) {
    setCooldownUntil(scopeKey, now + COOLDOWN_MS);
    rollNextRace(scopeKey);
    await ctx.reply('Nobody else showed up. The race is a bye, no cash awarded.');
    return;
  }

  // Build players list with parts
  const players = playerIds
    .map((id) => getPlayer(scopeKey, id))
    .filter(Boolean);

  // New: compute race outcome with DNFs
  let { ranked, casualties } = computeRaceOutcome(
    players,
    race.venue,
    race.weather
  );

  // If an owner invoked !ihaveagun, force them to win.
  const forcedWinnerId = getForcedWinnerId(scopeKey);
  ({ ranked, casualties } = applyForcedWinner(ranked, casualties, forcedWinnerId));

  // Optional: single casualties message before results
  if (casualties.length > 0) {
    const casualtySegments = casualties.map((c) => {
      const mention = ctx.mention(c.id, c.name);
      if (c.reason === 'cops') {
        return `${mention} was busted by the cops`;
      }
      if (c.reason === 'crash') {
        return `${mention} crashed out`;
      }
      if (c.reason === 'river') {
        return `${mention} plunged into the river`;
      }
      if (c.reason === 'plane') {
        return `${mention} collided with a landing plane`;
      }
      if (c.reason === 'brakes') {
        return `${mention} melted their brakes`;
      }
      if (c.reason === 'rockslide') {
        return `${mention} was buried in a rock slide`;
      }
      if (c.reason === 'pedestrian') {
        return `${mention} hit a pedestrian`;
      }
      if (c.reason === 'radiator') {
        return `${mention} blew their radiator`;
      }
      if (c.reason === 'deer') {
        return `${mention} hit a deer`;
      }
      if (c.reason === 'mechanical') {
        return c.failedComponent
          ? `${mention} suffered a ${c.failedComponent} failure`
          : `${mention} suffered a mechanical failure`;
      }
      return `${mention} did not finish`;
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
    updatePlayerCash(scopeKey, p.id, payout);
  });

  setCooldownUntil(scopeKey, now + COOLDOWN_MS);
  rollNextRace(scopeKey); // we won't mention next venue in this message to save chars

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
    const mention = ctx.mention(p.id, p.name);
    return `${label}) ${mention} +${p.payout}`;
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
  middleware: [racingScopeGuard],
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
        const scopeKey = getScopeKey(ctx);
        const player = ensurePlayer(scopeKey, userId, userName);

        // Check cooldown
        // Check cooldown
        // Check cooldown
        const cooldownUntil = getCooldownUntil(scopeKey);
        if (cooldownUntil > now) {
          const remaining = cooldownUntil - now;
          const pretty = formatMsAsMinutesSeconds(remaining);
          return ctx.reply(`The next race will be available in ${pretty}`);
        }



        let race = getRace(scopeKey);

        // No race yet -> start lobby
        if (!race) {
          const nextRace = getNextRace(scopeKey);
          race = {
            venue: nextRace.venue,
            weather: nextRace.weather,
            players: [player.id],
            lobbyEndsAt: now + JOIN_WINDOW_MS,
            forcedWinnerId: null,
          };
          setRace(scopeKey, race);

          // Schedule resolution for this scope
          const existingTimer = raceTimers.get(scopeKey);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }
          const timer = setTimeout(() => {
            resolveRace(ctx).catch((err) => {
              ctx.logger?.error?.('[racing] Error resolving race', err);
            });
          }, JOIN_WINDOW_MS);
          raceTimers.set(scopeKey, timer);

          const mention = ctx.mention(player.id, player.name);
          return ctx.reply(
            `${mention} wants to street race! Message !race to line up at the starting line! Venue: ${race.venue}; Weather: ${race.weather}`
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
          setRace(scopeKey, race);

          const countdown = formatLobbyCountdown(race.lobbyEndsAt, now);

          const mention = ctx.mention(player.id, player.name);
          return ctx.reply(
            `${mention} has joined the street race! venue: ${race.venue}; weather: ${race.weather}. ${countdown}`
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
        const nextRace = getNextRace(getScopeKey(ctx));
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
        const player = ensurePlayer(getScopeKey(ctx), userId, userName);

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

        const mention = ctx.mention(player.id, player.name);
        await ctx.reply(
          `${mention} has a car with ${tires} tires, ${suspension} suspension, ${brakes} brakes, ${intake} intake, ${exhaust} exhaust, ${ecu} ECU, ${carbonfiber} carbonfiber`
        );
      },
    },

    upgrade: {
      name: 'upgrade',
      description: 'View or purchase car upgrades.',
      usage: 'upgrade <part> <name>',
      aliases: ['modify', 'upgrades'],
      async run(ctx) {
        const args = ctx.args || [];
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const scopeKey = getScopeKey(ctx);
        const player = ensurePlayer(scopeKey, userId, userName);

        if (args.length === 0) {
          const partTypes = formatPartTypesList();
          return ctx.reply(
            `To see what upgrades are available for a part, type !upgrade <Part Name>. Part types are: ${partTypes}`
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

          const list = options
            .map((name) => `${name} (${slot[name].price})`)
            .join(', ');

          return ctx.reply(
            `Available ${partKey} upgrades: ${list}.`
          );
        }

        // part + name -> purchase and apply
        const choiceRaw = args.slice(1).join(' ');
        const choiceKey = resolveChoiceKey(partKey, choiceRaw);
        if (!choiceKey) {
          return ctx.reply(
            `Unknown upgrade for ${partKey}. Type !upgrade ${partKey} to see options.`
          );
        }

        const slot = partsConfig[partKey];
        const price = slot[choiceKey].price || 100;

        if ((player.cash || 0) < price) {
          return ctx.reply(
            `You need ${price} cash for ${choiceKey} ${partKey}. You only have ${player.cash || 0}.`
          );
        }

        setPlayerPart(scopeKey, player.id, partKey, choiceKey, price);

        const mention = ctx.mention(player.id, player.name);
        await ctx.reply(
          `${mention} upgraded their ${partKey} to ${choiceKey} for ${price} cash.`
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
        const player = ensurePlayer(getScopeKey(ctx), userId, userName);
        const amount = player.cash || 0;
        const mention = ctx.mention(player.id, player.name);
        await ctx.reply(`${mention} has ${amount} cash.`);
      },
    },

    give: {
      name: 'give',
      description: 'Give cash to another racer.',
      usage: 'give <@player> <amount>',
      aliases: ['donate'],
      async run(ctx) {
        const args = ctx.args || [];
        if (args.length < 2) {
          return ctx.reply('Usage: !give <@player> <amount>');
        }

        const targetToken = args[0];
        const targetId = parseTargetId(targetToken);
        const amountRaw = args[1];

        const scopeKey = getScopeKey(ctx);
        const senderId = getPlayerId(ctx);
        const senderName = getPlayerName(ctx);

        const result = transferCash(scopeKey, senderId, senderName, targetId, amountRaw);

        if (result.status === 'invalid_amount' || result.status === 'self') {
          return; // silent no-op
        }

        if (result.status === 'missing_recipient') {
          return ctx.reply(`Player ${targetToken} was not found.`);
        }

        if (result.status === 'insufficient') {
          const senderMention = ctx.mention(senderId, senderName);
          return ctx.reply(
            `${senderMention}, you do not have ${result.amount} to give. You only have ${result.senderCash}!`
          );
        }

        if (result.status === 'ok') {
          const senderMention = ctx.mention(result.sender.id, result.sender.name);
          const recipientMention = ctx.mention(result.recipient.id, result.recipient.name);
          return ctx.reply(`${senderMention} gave ${result.amount} cash to ${recipientMention}`);
        }
      },
    },

    ihaveagun: {
      name: 'ihaveagun',
      description: 'OWNER-ONLY: Guarantees the owner wins the current race.',
      usage: 'ihaveagun',
      aliases: [],
      async run(ctx) {
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const scopeKey = getScopeKey(ctx);
        const now = Date.now();

        if (!isOwnerUser(ctx, userId)) {
          return; // silent deny
        }

        let race = getRace(scopeKey);
        if (!race || !race.lobbyEndsAt || race.lobbyEndsAt <= now) {
          return ctx.reply('No active race lobby to influence.');
        }

        if (!race.players.includes(userId)) {
          return ctx.reply('Join the race first with !race, then use !ihaveagun.');
        }

        ensurePlayer(scopeKey, userId, userName);

        setForcedWinnerId(scopeKey, userId);

        const mention = ctx.mention(userId, userName);
        return ctx.reply(`${mention} has a gun! Everyone scatters!`);
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

    racereset: {
      name: 'racereset',
      description: 'OWNER-ONLY: Reset all racing data.',
      usage: 'racereset',
      aliases: ['resetrace'],
      middleware: [ownerOnly()], // ← only the owner can run this command
      async run(ctx) {
        const scopeKey = getScopeKey(ctx);
        resetAll(scopeKey);
        const next = rollNextRace(scopeKey);

        await ctx.reply(
          `!!! RACING DATA HAS BEEN RESET !!! Next street race, Venue: ${next.venue}; Weather: ${next.weather}`
        );
      },
    },

  },
};
