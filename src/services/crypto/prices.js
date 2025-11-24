// src/services/crypto/prices.js
// CoinGecko price fetcher with simple TTL caching.
const { logger } = require('../../utils/logger');
const {
  COINGECKO_TTL_MS,
  CRYPTO_ALLOWED_COINS,
} = require('../../config/env');

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

// Normalize allowlist to uppercase symbols
const ALLOWED = new Set((CRYPTO_ALLOWED_COINS || []).map((c) => c.toUpperCase()));

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

async function getPrice(symbol) {
  const upper = symbol.toUpperCase();
  if (!ALLOWED.has(upper)) {
    return { ok: false, error: 'not_allowed' };
  }

  const cached = cache.get(upper);
  if (isFresh(cached, COINGECKO_TTL_MS)) {
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

async function getPrices(symbols) {
  const upperSyms = symbols.map((s) => s.toUpperCase()).filter((s) => ALLOWED.has(s));
  const result = {};
  const toFetch = [];

  upperSyms.forEach((sym) => {
    const cached = cache.get(sym);
    if (isFresh(cached, COINGECKO_TTL_MS)) {
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
  ALLOWED_COINS: ALLOWED,
};
