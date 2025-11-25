// src/services/semantic/state.js
// Scoped state for the semantic word game.
const { getScopedState, saveScopedState, resetScopedState } = require('../../state/scopedStore');
const { logger } = require('../../utils/logger');

const STATE_FILE = 'semantic.json';

function defaultState() {
  return {
    solved: false,
    players: {},
  };
}

function getState(scopeKey) {
  if (!scopeKey) throw new Error('Semantic state requires a scope key.');
  return getScopedState(scopeKey, STATE_FILE, defaultState);
}

function persist(scopeKey) {
  try {
    saveScopedState(scopeKey, STATE_FILE);
  } catch (err) {
    logger.error('[semantic] failed to persist state', err);
  }
}

function ensurePlayer(scopeKey, id, name) {
  const state = getState(scopeKey);
  let player = state.players[id];
  if (!player) {
    player = {
      id,
      name: name || `Player_${id}`,
      wins: 0,
      guesses: 0,
      best: null, // { word, score }
    };
    state.players[id] = player;
    persist(scopeKey);
  } else if (name && player.name !== name) {
    player.name = name;
    persist(scopeKey);
  }
  return player;
}

function setPlayer(scopeKey, id, player) {
  const state = getState(scopeKey);
  state.players[id] = player;
  persist(scopeKey);
}

function listPlayers(scopeKey) {
  const state = getState(scopeKey);
  return Object.values(state.players || {});
}

function setSolved(scopeKey, solved) {
  const state = getState(scopeKey);
  state.solved = Boolean(solved);
  persist(scopeKey);
}

function isSolved(scopeKey) {
  const state = getState(scopeKey);
  return Boolean(state.solved);
}

function resetAll(scopeKey) {
  resetScopedState(scopeKey, STATE_FILE, defaultState);
  return getState(scopeKey);
}

module.exports = {
  ensurePlayer,
  setPlayer,
  listPlayers,
  setSolved,
  isSolved,
  resetAll,
};
