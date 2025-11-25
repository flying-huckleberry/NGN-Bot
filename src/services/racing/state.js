// src/services/racing/state.js
// Scoped racing state backed by per-context JSON files.

const { logger } = require('../../utils/logger');
const { getScopedState, saveScopedState, resetScopedState } = require('../../state/scopedStore');
const partsConfig = require('./parts');
const VENUE_WEIGHTS = require('./venues');

const STATE_FILE = 'racing.json';

function defaultState() {
  return {
    players: {},
    race: null,
    cooldownUntil: 0,
    nextRace: null,
  };
}

function getState(scopeKey) {
  if (!scopeKey) {
    throw new Error('Racing state requires a scope key.');
  }
  return getScopedState(scopeKey, STATE_FILE, defaultState);
}

function persist(scopeKey) {
  try {
    saveScopedState(scopeKey, STATE_FILE);
  } catch (err) {
    logger.error('[racing] Failed to persist scoped state', err);
  }
}

function createDefaultParts() {
  const parts = {};
  for (const slot of Object.keys(partsConfig)) {
    parts[slot] = 'stock';
  }
  return parts;
}

function ensurePlayer(scopeKey, id, name) {
  if (!id) throw new Error('ensurePlayer called without id');
  const state = getState(scopeKey);
  let player = state.players[id];
  if (!player) {
    player = {
      id,
      name: name || `Racer_${id}`,
      cash: 100,
      parts: createDefaultParts(),
    };
    state.players[id] = player;
    persist(scopeKey);
  } else if (name && player.name !== name) {
    player.name = name;
    persist(scopeKey);
  }
  return player;
}

function getPlayer(scopeKey, id) {
  const state = getState(scopeKey);
  return state.players[id] || null;
}

function listPlayers(scopeKey) {
  const state = getState(scopeKey);
  return Object.values(state.players || {});
}

function updatePlayerCash(scopeKey, id, delta) {
  const state = getState(scopeKey);
  const player = state.players[id];
  if (!player) return;
  player.cash = Math.max(0, (player.cash || 0) + delta);
  persist(scopeKey);
}

function setPlayerPart(scopeKey, id, slot, choiceName, cost) {
  const state = getState(scopeKey);
  const player = state.players[id];
  if (!player) return;
  player.cash = Math.max(0, (player.cash || 0) - cost);
  player.parts[slot] = choiceName;
  persist(scopeKey);
}

function getRace(scopeKey) {
  const state = getState(scopeKey);
  return state.race;
}

function setRace(scopeKey, race) {
  const state = getState(scopeKey);
  state.race = race;
  persist(scopeKey);
}

function clearRace(scopeKey) {
  const state = getState(scopeKey);
  state.race = null;
  persist(scopeKey);
}

function getCooldownUntil(scopeKey) {
  const state = getState(scopeKey);
  return state.cooldownUntil || 0;
}

function setCooldownUntil(scopeKey, ts) {
  const state = getState(scopeKey);
  state.cooldownUntil = ts || 0;
  persist(scopeKey);
}

function randomKey(obj) {
  const keys = Object.keys(obj || {});
  if (!keys.length) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}

function rollNextRace(scopeKey) {
  const state = getState(scopeKey);
  const venue = randomKey(VENUE_WEIGHTS) || 'Harbor';
  const venueTable = VENUE_WEIGHTS[venue] || VENUE_WEIGHTS['Harbor'];
  const weather = randomKey(venueTable) || 'Sunny';
  state.nextRace = { venue, weather };
  persist(scopeKey);
  return state.nextRace;
}

function getNextRace(scopeKey) {
  const state = getState(scopeKey);
  if (!state.nextRace) {
    return rollNextRace(scopeKey);
  }
  return state.nextRace;
}

function resetAll(scopeKey) {
  resetScopedState(scopeKey, STATE_FILE, defaultState);
  return getState(scopeKey);
}

module.exports = {
  ensurePlayer,
  getPlayer,
  listPlayers,
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
};
