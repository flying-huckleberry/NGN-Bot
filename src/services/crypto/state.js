// src/services/crypto/state.js
// Scoped crypto game state backed by per-context JSON files.
const { getScopedState, saveScopedState, resetScopedState } = require('../../state/scopedStore');
const { logger } = require('../../utils/logger');
const { CRYPTO_STARTING_CASH } = require('../../config/env');

const STATE_FILE = 'crypto.json';

function defaultState() {
  return {
    players: {},
  };
}

function getState(scopeKey) {
  if (!scopeKey) throw new Error('Crypto state requires a scope key.');
  return getScopedState(scopeKey, STATE_FILE, defaultState);
}

function persist(scopeKey) {
  try {
    saveScopedState(scopeKey, STATE_FILE);
  } catch (err) {
    logger.error('[crypto] Failed to persist scoped state', err);
  }
}

function ensurePlayer(scopeKey, id, name) {
  const state = getState(scopeKey);
  let player = state.players[id];
  if (!player) {
    player = {
      id,
      name: name || `Trader_${id}`,
      cash: CRYPTO_STARTING_CASH,
      holdings: {},
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

function setPlayer(scopeKey, id, player) {
  const state = getState(scopeKey);
  state.players[id] = player;
  persist(scopeKey);
}

function resetAll(scopeKey) {
  resetScopedState(scopeKey, STATE_FILE, defaultState);
  return getState(scopeKey);
}

module.exports = {
  ensurePlayer,
  getPlayer,
  listPlayers,
  setPlayer,
  resetAll,
};
