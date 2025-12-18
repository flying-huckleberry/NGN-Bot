// src/state/accountSettings.js
const fs = require('fs');
const {
  ensureAccountDir,
  getAccountFilePath,
} = require('./accountPaths');
const env = require('../config/env');

const SETTINGS_FILE = 'settings.json';
const cache = new Map();

function normalizeModules(input) {
  return (input || [])
    .map((name) => String(name || '').trim().toLowerCase())
    .filter(Boolean);
}

function normalizeIdList(input) {
  if (!Array.isArray(input)) return [];
  return input.map((id) => String(id || '').trim()).filter(Boolean);
}

function defaultSettings() {
  // Baseline account settings used when no settings.json exists.
  return {
    commandPrefix: env.COMMAND_PREFIX || '!',
    disabledModules: normalizeModules(env.DISABLED_MODULES || []),
    youtube: {
      // Transport enablement is per account; YouTube connects/disconnects.
      enabled: true,
    },
    discord: {
      // Discord enablement gates routing, not global presence.
      enabled: true,
      allowedChannelIds: [],
      racingChannelId: '',
    },
    race: {
      cooldownMs: Number(env.RACE_COOLDOWN_MS) || 3600000,
      joinWindowMs: Number(env.RACE_JOIN_WINDOW_MS) || 60000,
    },
    crypto: {
      allowedCoins: Array.isArray(env.CRYPTO_ALLOWED_COINS)
        ? env.CRYPTO_ALLOWED_COINS.map((c) => String(c || '').toUpperCase())
      : ['BTC', 'ETH', 'SOL', 'DOGE', 'LTC'],
      startingCash: Number(env.CRYPTO_STARTING_CASH) || 1000,
      coingeckoTtlMs: Number(env.COINGECKO_TTL_MS) || 0,
    },
  };
}

function normalizeSettings(settings) {
  // Normalize and fill defaults to keep settings robust across partial updates.
  const base = defaultSettings();
  const next = { ...base, ...(settings || {}) };

  next.commandPrefix = String(next.commandPrefix || base.commandPrefix || '!').trim() || '!';
  next.disabledModules = normalizeModules(next.disabledModules);

  {
    const cooldownRaw = Number(
      next.race?.cooldownMs ?? base.race.cooldownMs
    );
    const joinRaw = Number(
      next.race?.joinWindowMs ?? base.race.joinWindowMs
    );
    next.race = {
      cooldownMs: Number.isFinite(cooldownRaw) ? cooldownRaw : base.race.cooldownMs,
      joinWindowMs: Number.isFinite(joinRaw) ? joinRaw : base.race.joinWindowMs,
    };
  }

  next.discord = {
    enabled: Boolean(next.discord?.enabled ?? base.discord.enabled),
    allowedChannelIds: normalizeIdList(next.discord?.allowedChannelIds),
    racingChannelId: String(next.discord?.racingChannelId || '').trim(),
  };

  next.youtube = {
    enabled: Boolean(next.youtube?.enabled ?? base.youtube.enabled),
  };

  {
    const startingRaw = Number(
      next.crypto?.startingCash ?? base.crypto.startingCash
    );
    const ttlRaw = Number(
      next.crypto?.coingeckoTtlMs ?? base.crypto.coingeckoTtlMs
    );
    next.crypto = {
      allowedCoins: normalizeIdList(next.crypto?.allowedCoins).map((c) => c.toUpperCase()),
      startingCash: Number.isFinite(startingRaw) ? startingRaw : base.crypto.startingCash,
      coingeckoTtlMs: Number.isFinite(ttlRaw) ? ttlRaw : base.crypto.coingeckoTtlMs,
    };
  }

  if (next.crypto.allowedCoins.length === 0) {
    next.crypto.allowedCoins = base.crypto.allowedCoins.slice();
  }

  return next;
}

function readSettingsFile(accountId) {
  ensureAccountDir(accountId);
  const filePath = getAccountFilePath(accountId, SETTINGS_FILE);
  if (!fs.existsSync(filePath)) {
    return normalizeSettings({});
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return normalizeSettings(raw);
  } catch {
    return normalizeSettings({});
  }
}

function loadAccountSettings(accountId) {
  if (!accountId) throw new Error('Account ID is required.');
  if (cache.has(accountId)) return cache.get(accountId);
  const settings = readSettingsFile(accountId);
  cache.set(accountId, settings);
  return settings;
}

function saveAccountSettings(accountId, settings) {
  if (!accountId) throw new Error('Account ID is required.');
  const normalized = normalizeSettings(settings);
  ensureAccountDir(accountId);
  const filePath = getAccountFilePath(accountId, SETTINGS_FILE);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');
  cache.set(accountId, normalized);
  return normalized;
}

function updateAccountSettings(accountId, updates = {}) {
  const current = loadAccountSettings(accountId);
  const next = {
    ...current,
    ...updates,
    race: { ...current.race, ...(updates.race || {}) },
    discord: { ...current.discord, ...(updates.discord || {}) },
    crypto: { ...current.crypto, ...(updates.crypto || {}) },
  };
  return saveAccountSettings(accountId, next);
}

function resetSettingsCache(accountId) {
  if (accountId) {
    cache.delete(accountId);
  } else {
    cache.clear();
  }
}

function buildAccountEnv(settings) {
  const normalized = normalizeSettings(settings);
  return {
    ...env,
    COMMAND_PREFIX: normalized.commandPrefix,
    DISABLED_MODULES: normalized.disabledModules,
    RACE_COOLDOWN_MS: normalized.race.cooldownMs,
    RACE_JOIN_WINDOW_MS: normalized.race.joinWindowMs,
    CRYPTO_ALLOWED_COINS: normalized.crypto.allowedCoins,
    CRYPTO_STARTING_CASH: normalized.crypto.startingCash,
    COINGECKO_TTL_MS: normalized.crypto.coingeckoTtlMs,
  };
}

module.exports = {
  loadAccountSettings,
  saveAccountSettings,
  updateAccountSettings,
  resetSettingsCache,
  normalizeSettings,
  buildAccountEnv,
};
