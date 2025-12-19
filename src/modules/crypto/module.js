// src/modules/crypto/module.js
// CoinGecko-backed paper trading mini-game (scoped per transport).

const { adminOnly } = require('../../utils/permissions');
const env = require('../../config/env');
const {
  ensurePlayer,
  getPlayer,
  setPlayer,
  listPlayers,
  resetAll,
} = require('../../services/crypto/state');
const {
  getPrice,
  getPrices,
  normalizeAllowedCoins,
} = require('../../services/crypto/prices');

function getMaxChars(ctx) {
  const maxChars = Number(ctx?.env?.MAX_CHARS ?? env.MAX_CHARS);
  return Number.isFinite(maxChars) ? maxChars : 190;
}

function getCryptoSettings(ctx) {
  const fallback = {
    allowedCoins: env.CRYPTO_ALLOWED_COINS || [],
    startingCash: env.CRYPTO_STARTING_CASH || 1000,
    coingeckoTtlMs: env.COINGECKO_TTL_MS || 0,
  };
  return {
    allowedCoins: ctx?.settings?.crypto?.allowedCoins || fallback.allowedCoins,
    startingCash: ctx?.settings?.crypto?.startingCash ?? fallback.startingCash,
    coingeckoTtlMs: ctx?.settings?.crypto?.coingeckoTtlMs ?? fallback.coingeckoTtlMs,
  };
}

function getScopeKey(ctx) {
  return ctx.stateScope || 'global';
}

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
    'Trader'
  );
}

function clamp(ctx, text) {
  if (!text) return '';
  const maxChars = getMaxChars(ctx);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 3)}...`;
}

function roundCents(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100) / 100);
}

function roundHoldings(value) {
  return Math.max(0, Math.round(Number(value || 0) * 10000) / 10000);
}

function formatMoney(value) {
  return roundCents(value).toFixed(2);
}

function formatHoldings(value) {
  return roundHoldings(value).toFixed(4);
}

function parseAmount(raw) {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

function allowedListText(allowed) {
  const list = Array.from(allowed || []);
  return list.join(', ');
}

function isAdminOrOwner(ctx) {
  if (ctx.platform === 'discord') {
    const member = ctx.platformMeta?.rawDiscord?.member;
    return Boolean(member?.permissions?.has?.('Administrator'));
  }
  if (ctx.platform === 'youtube') {
    // Reuse owner check via authorDetails flag
    return Boolean(ctx.msg?.authorDetails?.isChatOwner);
  }
  return false;
}

async function fetchSinglePrice(symbol, settings) {
  const res = await getPrice(symbol, {
    allowedCoins: settings.allowedCoins,
    ttlMs: settings.coingeckoTtlMs,
  });
  if (!res.ok) return null;
  return res.price;
}

async function computePortfolio(player, settings) {
  const holdings = player.holdings || {};
  const symbols = Object.keys(holdings).filter((s) => holdings[s] > 0);
  const prices = symbols.length
    ? await getPrices(symbols, {
        allowedCoins: settings.allowedCoins,
        ttlMs: settings.coingeckoTtlMs,
      })
    : {};
  let holdingsValue = 0;
  symbols.forEach((sym) => {
    const price = prices[sym.toUpperCase()];
    if (typeof price === 'number') {
      holdingsValue += price * holdings[sym];
    }
  });
  const cash = roundCents(player.cash || 0);
  return {
    cash,
    holdingsValue: roundCents(holdingsValue),
    total: roundCents(cash + holdingsValue),
  };
}

module.exports = {
  name: 'crypto',
  description: 'Paper trading mini-game using CoinGecko prices.',
  commands: {
    buy: {
      name: 'buy',
      description: 'Buy a coin with USD.',
      usage: 'buy <symbol> <usd>',
      aliases: [],
      async run(ctx) {
        const args = ctx.args || [];
        const settings = getCryptoSettings(ctx);
        const allowed = normalizeAllowedCoins(settings.allowedCoins);
        if (args.length < 2) {
          return ctx.reply(clamp(ctx, `Usage: ${ctx.commandPrefix}buy <symbol> <usd>`));
        }

        const symbol = args[0].toUpperCase();
        const amount = parseAmount(args[1]);

        if (!allowed.has(symbol)) {
          return ctx.reply(clamp(ctx, `Unsupported coin. Allowed: ${allowedListText(allowed)}`));
        }
        if (amount === null || amount <= 0) {
          return ctx.reply(clamp(ctx, 'Amount must be greater than 0.'));
        }

        const scopeKey = getScopeKey(ctx);
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(scopeKey, userId, userName, settings.startingCash);

        const price = await fetchSinglePrice(symbol, settings);
        if (price === null) {
          return ctx.reply(clamp(ctx, `Price unavailable for ${symbol}. Try again later.`));
        }

        const cost = roundCents(amount);
        if ((player.cash || 0) < cost) {
          const mention = ctx.mention(userId, userName);
          return ctx.reply(
            clamp(ctx, `${mention}, insufficient cash. You have $${formatMoney(player.cash || 0)}.`)
          );
        }

        const qty = roundHoldings(cost / price);

        player.cash = roundCents((player.cash || 0) - cost);
        player.holdings = player.holdings || {};
        player.holdings[symbol] = roundHoldings((player.holdings[symbol] || 0) + qty);
        setPlayer(scopeKey, player.id, player);

        const mention = ctx.mention(userId, userName);
        return ctx.reply(
          clamp(
            ctx,
            `${mention} bought ${formatHoldings(qty)} ${symbol} for $${formatMoney(cost)} @ $${formatMoney(
              price
            )}`
          )
        );
      },
    },

    sell: {
      name: 'sell',
      description: 'Sell a coin for USD.',
      usage: 'sell <symbol> <usd>',
      aliases: [],
      async run(ctx) {
        const args = ctx.args || [];
        const settings = getCryptoSettings(ctx);
        const allowed = normalizeAllowedCoins(settings.allowedCoins);
        if (args.length < 2) {
          return ctx.reply(clamp(ctx, `Usage: ${ctx.commandPrefix}sell <symbol> <usd>`));
        }

        const symbol = args[0].toUpperCase();
        const amount = parseAmount(args[1]);

        if (!allowed.has(symbol)) {
          return ctx.reply(clamp(ctx, `Unsupported coin. Allowed: ${allowedListText(allowed)}`));
        }
        if (amount === null || amount <= 0) {
          return ctx.reply(clamp(ctx, 'Amount must be greater than 0.'));
        }

        const scopeKey = getScopeKey(ctx);
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(scopeKey, userId, userName, settings.startingCash);

        const price = await fetchSinglePrice(symbol, settings);
        if (price === null) {
          return ctx.reply(clamp(ctx, `Price unavailable for ${symbol}. Try again later.`));
        }

        const proceeds = roundCents(amount);
        const qtyNeeded = roundHoldings(proceeds / price);
        const currentQty = roundHoldings(player.holdings?.[symbol] || 0);

        if (qtyNeeded > currentQty) {
          const mention = ctx.mention(userId, userName);
          return ctx.reply(
            clamp(ctx, `${mention}, insufficient ${symbol}. You have ${formatHoldings(currentQty)}.`)
          );
        }

        player.cash = roundCents((player.cash || 0) + proceeds);
        player.holdings = player.holdings || {};
        player.holdings[symbol] = roundHoldings(currentQty - qtyNeeded);
        setPlayer(scopeKey, player.id, player);

        const mention = ctx.mention(userId, userName);
        return ctx.reply(
          clamp(
            ctx,
            `${mention} sold ${formatHoldings(qtyNeeded)} ${symbol} for $${formatMoney(
              proceeds
            )} @ $${formatMoney(price)}`
          )
        );
      },
    },

    // cash is a racing command already. balance is seen in wallet command and this whole thing seems redundant and confusing
    // cash: {
    //   name: 'cash',
    //   description: 'Show your cash balance.',
    //   usage: 'cash',
    //   aliases: ['balance'],
    //   async run(ctx) {
    //     const scopeKey = getScopeKey(ctx);
    //     const userId = getPlayerId(ctx);
    //     const userName = getPlayerName(ctx);
    //     const player = ensurePlayer(scopeKey, userId, userName);
    //     const mention = ctx.mention(userId, userName);
    //     return ctx.reply(clamp(`${mention} has $${formatMoney(player.cash || 0)} cash.`));
    //   },
    // },

    wallet: {
      name: 'wallet',
      description: 'Show cash + holdings value.',
      usage: 'wallet',
      aliases: ['portfolio'],
      async run(ctx) {
        const scopeKey = getScopeKey(ctx);
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const settings = getCryptoSettings(ctx);
        const player = ensurePlayer(scopeKey, userId, userName, settings.startingCash);
        const { cash, holdingsValue, total } = await computePortfolio(player, settings);
        const mention = ctx.mention(userId, userName);
        return ctx.reply(
          clamp(
            ctx,
            `${mention} portfolio: cash $${formatMoney(cash)}, coins $${formatMoney(
              holdingsValue
            )}, total $${formatMoney(total)}`
          )
        );
      },
    },

    coin: {
      name: 'coin',
      description: 'Show your holdings and value for one coin.',
      usage: 'coin <symbol>',
      aliases: ['position'],
      async run(ctx) {
        const args = ctx.args || [];
        const settings = getCryptoSettings(ctx);
        const allowed = normalizeAllowedCoins(settings.allowedCoins);
        if (args.length < 1) {
          return ctx.reply(clamp(ctx, `Usage: ${ctx.commandPrefix}coin <symbol>`));
        }
        const symbol = args[0].toUpperCase();
        if (!allowed.has(symbol)) {
          return ctx.reply(clamp(ctx, `Unsupported coin. Allowed: ${allowedListText(allowed)}`));
        }

        const scopeKey = getScopeKey(ctx);
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(scopeKey, userId, userName, settings.startingCash);

        const qty = roundHoldings(player.holdings?.[symbol] || 0);
        const price = await fetchSinglePrice(symbol, settings);
        const value = price !== null ? roundCents(price * qty) : 0;
        const mention = ctx.mention(userId, userName);

        if (price === null) {
          return ctx.reply(
            clamp(ctx, `${mention} holds ${formatHoldings(qty)} ${symbol}. Price unavailable.`)
          );
        }

        return ctx.reply(
          clamp(
            ctx,
            `${mention} holds ${formatHoldings(qty)} ${symbol} wealth $${formatMoney(
              value
            )} @ $${formatMoney(price)}`
          )
        );
      },
    },

    cryptohelp: {
      name: 'cryptohelp',
      description: 'Show crypto commands.',
      usage: 'cryptohelp',
      aliases: ['chelp'],
      async run(ctx) {
        const mention = ctx.mention(getPlayerId(ctx), getPlayerName(ctx));
        const settings = getCryptoSettings(ctx);
        const allowed = normalizeAllowedCoins(settings.allowedCoins);
        const cmds = [
          `${ctx.commandPrefix}buy <symbol> <usd>`,
          `${ctx.commandPrefix}sell <symbol> <usd>`,
          `${ctx.commandPrefix}wallet`,
          `${ctx.commandPrefix}coinlist`,
          `${ctx.commandPrefix}coin <symbol>`,
          `${ctx.commandPrefix}leaders`,
          `${ctx.commandPrefix}cryptohelp`,
        ];
        return ctx.reply(
          clamp(
            ctx,
            `${mention} crypto: ${cmds.join(' | ')} | ${ctx.commandPrefix}coinlist: ${allowedListText(allowed)}`
          )
        );
      },
    },

    leaders: {
      name: 'leaders',
      description: 'Show top portfolios by total value.',
      usage: 'leaders',
      aliases: ['leaderboard'],
      async run(ctx) {
        const scopeKey = getScopeKey(ctx);
        const players = listPlayers(scopeKey);
        if (!players.length) {
          return ctx.reply(clamp(ctx, 'No traders yet.'));
        }

        const settings = getCryptoSettings(ctx);
        const allowed = normalizeAllowedCoins(settings.allowedCoins);

        // Collect all symbols in use to price them once.
        const symbols = new Set();
        players.forEach((p) => {
          Object.entries(p.holdings || {}).forEach(([sym, qty]) => {
            if (qty > 0 && allowed.has(sym.toUpperCase())) {
              symbols.add(sym.toUpperCase());
            }
          });
        });

        const priceMap = symbols.size
          ? await getPrices(Array.from(symbols), {
              allowedCoins: settings.allowedCoins,
              ttlMs: settings.coingeckoTtlMs,
            })
          : {};

        const ranked = players
          .map((p) => {
            const holdingsValue = Object.entries(p.holdings || {}).reduce((acc, [sym, qty]) => {
              const price = priceMap[sym.toUpperCase()];
              if (typeof price === 'number') {
                acc += price * qty;
              }
              return acc;
            }, 0);
            const cash = roundCents(p.cash || 0);
            const total = roundCents(cash + holdingsValue);
            return { id: p.id, name: p.name, total };
          })
          .sort((a, b) => b.total - a.total);

        const parts = [];
        ranked.forEach((p, idx) => {
          const row = `${idx + 1}) ${p.name} $${formatMoney(p.total)}`;
          if (parts.join(' | ').length + row.length + 3 <= DEFAULT_MAX_CHARS) {
            parts.push(row);
          }
        });

        return ctx.reply(clamp(ctx, parts.join(' | ') || 'No traders yet.'));
      },
    },

    coinlist: {
      name: 'coinlist',
      description: 'Show allowed coin tickers.',
      usage: 'coinlist',
      aliases: [],
      async run(ctx) {
        const mention = ctx.mention(getPlayerId(ctx), getPlayerName(ctx));
        const settings = getCryptoSettings(ctx);
        const allowed = normalizeAllowedCoins(settings.allowedCoins);
        return ctx.reply(clamp(ctx, `${mention} coins: ${allowedListText(allowed)}`));
      },
    },

    cryptoreset: {
      name: 'cryptoreset',
      description: 'ADMIN-ONLY: Reset all crypto data for this scope.',
      usage: 'cryptoreset',
      aliases: ['resetcrypto'],
      middleware: [adminOnly()], // only admins can run this command
      async run(ctx) {
        const scopeKey = getScopeKey(ctx);
        resetAll(scopeKey);
        return ctx.reply(clamp(ctx, 'Crypto state reset for this scope.'));
      },
    },
  },
};
