// src/modules/crypto/module.js
// CoinGecko-backed paper trading mini-game (scoped per transport).
const {
  MAX_CHARS,
  CRYPTO_ALLOWED_COINS,
} = require('../../config/env');
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
  ALLOWED_COINS,
} = require('../../services/crypto/prices');

const DEFAULT_MAX_CHARS = Number(MAX_CHARS || 190);

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

function clamp(text) {
  if (!text) return '';
  if (text.length <= DEFAULT_MAX_CHARS) return text;
  return `${text.slice(0, DEFAULT_MAX_CHARS - 3)}...`;
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

function allowedListText() {
  const list = Array.from(ALLOWED_COINS || []);
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

async function fetchSinglePrice(symbol) {
  const res = await getPrice(symbol);
  if (!res.ok) return null;
  return res.price;
}

async function computePortfolio(player) {
  const holdings = player.holdings || {};
  const symbols = Object.keys(holdings).filter((s) => holdings[s] > 0);
  const prices = symbols.length ? await getPrices(symbols) : {};
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
        if (args.length < 2) {
          return ctx.reply(clamp('Usage: !buy <symbol> <usd>'));
        }

        const symbol = args[0].toUpperCase();
        const amount = parseAmount(args[1]);

        if (!ALLOWED_COINS.has(symbol)) {
          return ctx.reply(clamp(`Unsupported coin. Allowed: ${allowedListText()}`));
        }
        if (amount === null || amount <= 0) {
          return ctx.reply(clamp('Amount must be greater than 0.'));
        }

        const scopeKey = getScopeKey(ctx);
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(scopeKey, userId, userName);

        const price = await fetchSinglePrice(symbol);
        if (price === null) {
          return ctx.reply(clamp(`Price unavailable for ${symbol}. Try again later.`));
        }

        const cost = roundCents(amount);
        if ((player.cash || 0) < cost) {
          const mention = ctx.mention(userId, userName);
          return ctx.reply(
            clamp(`${mention}, insufficient cash. You have $${formatMoney(player.cash || 0)}.`)
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
        if (args.length < 2) {
          return ctx.reply(clamp('Usage: !sell <symbol> <usd>'));
        }

        const symbol = args[0].toUpperCase();
        const amount = parseAmount(args[1]);

        if (!ALLOWED_COINS.has(symbol)) {
          return ctx.reply(clamp(`Unsupported coin. Allowed: ${allowedListText()}`));
        }
        if (amount === null || amount <= 0) {
          return ctx.reply(clamp('Amount must be greater than 0.'));
        }

        const scopeKey = getScopeKey(ctx);
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(scopeKey, userId, userName);

        const price = await fetchSinglePrice(symbol);
        if (price === null) {
          return ctx.reply(clamp(`Price unavailable for ${symbol}. Try again later.`));
        }

        const proceeds = roundCents(amount);
        const qtyNeeded = roundHoldings(proceeds / price);
        const currentQty = roundHoldings(player.holdings?.[symbol] || 0);

        if (qtyNeeded > currentQty) {
          const mention = ctx.mention(userId, userName);
          return ctx.reply(
            clamp(`${mention}, insufficient ${symbol}. You have ${formatHoldings(currentQty)}.`)
          );
        }

        player.cash = roundCents((player.cash || 0) + proceeds);
        player.holdings = player.holdings || {};
        player.holdings[symbol] = roundHoldings(currentQty - qtyNeeded);
        setPlayer(scopeKey, player.id, player);

        const mention = ctx.mention(userId, userName);
        return ctx.reply(
          clamp(
            `${mention} sold ${formatHoldings(qtyNeeded)} ${symbol} for $${formatMoney(
              proceeds
            )} @ $${formatMoney(price)}`
          )
        );
      },
    },

    cash: {
      name: 'cash',
      description: 'Show your cash balance.',
      usage: 'cash',
      aliases: ['balance'],
      async run(ctx) {
        const scopeKey = getScopeKey(ctx);
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(scopeKey, userId, userName);
        const mention = ctx.mention(userId, userName);
        return ctx.reply(clamp(`${mention} has $${formatMoney(player.cash || 0)} cash.`));
      },
    },

    wallet: {
      name: 'wallet',
      description: 'Show cash + holdings value.',
      usage: 'wallet',
      aliases: ['portfolio'],
      async run(ctx) {
        const scopeKey = getScopeKey(ctx);
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(scopeKey, userId, userName);
        const { cash, holdingsValue, total } = await computePortfolio(player);
        const mention = ctx.mention(userId, userName);
        return ctx.reply(
          clamp(
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
        if (args.length < 1) {
          return ctx.reply(clamp('Usage: !coin <symbol>'));
        }
        const symbol = args[0].toUpperCase();
        if (!ALLOWED_COINS.has(symbol)) {
          return ctx.reply(clamp(`Unsupported coin. Allowed: ${allowedListText()}`));
        }

        const scopeKey = getScopeKey(ctx);
        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(scopeKey, userId, userName);

        const qty = roundHoldings(player.holdings?.[symbol] || 0);
        const price = await fetchSinglePrice(symbol);
        const value = price !== null ? roundCents(price * qty) : 0;
        const mention = ctx.mention(userId, userName);

        if (price === null) {
          return ctx.reply(
            clamp(`${mention} holds ${formatHoldings(qty)} ${symbol}. Price unavailable.`)
          );
        }

        return ctx.reply(
          clamp(
            `${mention} holds ${formatHoldings(qty)} ${symbol} worth $${formatMoney(
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
        const cmds = [
          '!buy <symbol> <usd>',
          '!sell <symbol> <usd>',
          '!wallet',
          '!coinlist',
          '!coin <symbol>',
          '!leaders',
          '!cryptohelp',
        ];
        const allowed = allowedListText();
        return ctx.reply(
          clamp(
            `${mention} crypto: ${cmds.join(' | ')} | !coinlist: ${allowed}`
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
          return ctx.reply(clamp('No traders yet.'));
        }

        // Collect all symbols in use to price them once.
        const symbols = new Set();
        players.forEach((p) => {
          Object.entries(p.holdings || {}).forEach(([sym, qty]) => {
            if (qty > 0 && ALLOWED_COINS.has(sym.toUpperCase())) {
              symbols.add(sym.toUpperCase());
            }
          });
        });

        const priceMap = symbols.size ? await getPrices(Array.from(symbols)) : {};

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
          const mention = ctx.mention(p.id, p.name);
          const row = `${idx + 1}) ${mention} $${formatMoney(p.total)}`;
          if (parts.join(' | ').length + row.length + 3 <= DEFAULT_MAX_CHARS) {
            parts.push(row);
          }
        });

        return ctx.reply(clamp(parts.join(' | ') || 'No traders yet.'));
      },
    },

    coinlist: {
      name: 'coinlist',
      description: 'Show allowed coin tickers.',
      usage: 'coinlist',
      aliases: [],
      async run(ctx) {
        const mention = ctx.mention(getPlayerId(ctx), getPlayerName(ctx));
        return ctx.reply(clamp(`${mention} coins: ${allowedListText()}`));
      },
    },

    cryptoreset: {
      name: 'cryptoreset',
      description: 'ADMIN-ONLY: Reset all crypto data for this scope.',
      usage: 'cryptoreset',
      aliases: ['resetcrypto'],
      async run(ctx) {
        if (!isAdminOrOwner(ctx)) {
          return; // silent deny
        }
        const scopeKey = getScopeKey(ctx);
        resetAll(scopeKey);
        return ctx.reply(clamp('Crypto state reset for this scope.'));
      },
    },
  },
};
