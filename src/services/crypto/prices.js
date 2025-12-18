// src/services/crypto/prices.js
// CoinGecko price fetcher with simple TTL caching.
const { logger } = require('../../utils/logger');
const env = require('../../config/env');

// Map tickers to CoinGecko IDs. Unknown symbols fall back to lowercase symbol as ID.
const DEFAULT_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  DOGE: 'dogecoin',
  LTC: 'litecoin',
};

function resolveCoinGeckoId(symbol) {
  const upper = symbol.toUpperCase();
  return DEFAULT_IDS[upper] || upper.toLowerCase();
}

const cache = new Map(); // symbol -> { price, ts }

function isFresh(entry, ttlMs) {
  if (!entry) return false;
  if (!ttlMs || ttlMs <= 0) return false;
  return Date.now() - entry.ts < ttlMs;
}

async function fetchPrices(symbols) {
  const ids = symbols.map(resolveCoinGeckoId);
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
    ids.join(',')
  )}&vs_currencies=usd`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`CoinGecko HTTP ${res.status}`);
    }
    const json = await res.json();

    const out = {};
    symbols.forEach((sym, idx) => {
      const id = ids[idx];
      const entry = json[id];
      if (entry && typeof entry.usd === 'number') {
        out[sym.toUpperCase()] = entry.usd;
      }
    });
    return out;
  } catch (err) {
    logger.error('[crypto] failed to fetch CoinGecko prices', err);
    throw err;
  }
}

function normalizeAllowedCoins(allowedCoins) {
  if (Array.isArray(allowedCoins) && allowedCoins.length > 0) {
    return new Set(allowedCoins.map((c) => String(c || '').toUpperCase()));
  }
  return new Set((env.CRYPTO_ALLOWED_COINS || []).map((c) => String(c || '').toUpperCase()));
}

function resolveTtlMs(ttlMs) {
  if (ttlMs === 0) return 0;
  if (Number.isFinite(Number(ttlMs))) return Number(ttlMs);
  return Number(env.COINGECKO_TTL_MS) || 0;
}

async function getPrice(symbol, options = {}) {
  const upper = symbol.toUpperCase();
  const allowed = normalizeAllowedCoins(options.allowedCoins);
  if (!allowed.has(upper)) {
    return { ok: false, error: 'not_allowed' };
  }

  const cached = cache.get(upper);
  const ttlMs = resolveTtlMs(options.ttlMs);
  if (isFresh(cached, ttlMs)) {
    return { ok: true, symbol: upper, price: cached.price };
  }

  const prices = await fetchPrices([upper]);
  const price = prices[upper];
  if (typeof price !== 'number') {
    return { ok: false, error: 'unavailable' };
  }
  cache.set(upper, { price, ts: Date.now() });
  return { ok: true, symbol: upper, price };
}

async function getPrices(symbols, options = {}) {
  const allowed = normalizeAllowedCoins(options.allowedCoins);
  const upperSyms = symbols.map((s) => s.toUpperCase()).filter((s) => allowed.has(s));
  const result = {};
  const toFetch = [];
  const ttlMs = resolveTtlMs(options.ttlMs);

  upperSyms.forEach((sym) => {
    const cached = cache.get(sym);
    if (isFresh(cached, ttlMs)) {
      result[sym] = cached.price;
    } else {
      toFetch.push(sym);
    }
  });

  if (toFetch.length) {
    const fetched = await fetchPrices(toFetch);
    Object.entries(fetched).forEach(([sym, price]) => {
      cache.set(sym, { price, ts: Date.now() });
      result[sym] = price;
    });
  }

  return result;
}

module.exports = {
  getPrice,
  getPrices,
  normalizeAllowedCoins,
};
