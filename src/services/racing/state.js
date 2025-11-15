// src/services/racing/state.js
const fs = require('fs');
const path = require('path');
const partsConfig = require('./parts');

const STATE_PATH = path.join(__dirname, '..', 'state', 'racing.json');
const VENUE_WEIGHTS = require('./venues');

let state = {
  players: {}, // id -> { id, name, cash, parts }
  race: null,  // { venue, weather, players: [id], lobbyEndsAt }
  cooldownUntil: 0,
  nextRace: null, // { venue, weather }
};

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = fs.readFileSync(STATE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state = {
          players: parsed.players || {},
          race: parsed.race || null,
          cooldownUntil: parsed.cooldownUntil || 0,
          nextRace: parsed.nextRace || null,
        };
      }
    }
  } catch (err) {
    console.error('[racing] Failed to load state:', err);
  }
}

function saveState() {
  try {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[racing] Failed to save state:', err);
  }
}

loadState();

// Initialize a new player's profile (100 cash, all stock parts)
function createDefaultParts() {
  const parts = {};
  for (const slot of Object.keys(partsConfig)) {
    parts[slot] = 'stock';
  }
  return parts;
}

function ensurePlayer(id, name) {
  if (!id) throw new Error('ensurePlayer called without id');

  let player = state.players[id];
  if (!player) {
    player = {
      id,
      name: name || `Racer_${id}`,
      cash: 100,
      parts: createDefaultParts(),
    };
    state.players[id] = player;
    saveState();
  } else if (name && player.name !== name) {
    player.name = name;
    saveState();
  }
  return player;
}

function getPlayer(id) {
  return state.players[id] || null;
}

function updatePlayerCash(id, delta) {
  const p = state.players[id];
  if (!p) return;
  p.cash = Math.max(0, (p.cash || 0) + delta);
  saveState();
}

function setPlayerPart(id, slot, choiceName, cost) {
  const p = state.players[id];
  if (!p) return;
  p.cash = Math.max(0, (p.cash || 0) - cost);
  p.parts[slot] = choiceName;
  saveState();
}

function getRace() {
  return state.race;
}

function setRace(race) {
  state.race = race;
  saveState();
}

function clearRace() {
  state.race = null;
  saveState();
}

function getCooldownUntil() {
  return state.cooldownUntil || 0;
}

function setCooldownUntil(ts) {
  state.cooldownUntil = ts || 0;
  saveState();
}

function randomKey(obj) {
  const keys = Object.keys(obj || {});
  if (!keys.length) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}

function rollNextRace() {
  const venue = randomKey(VENUE_WEIGHTS) || 'Harbor';

  const venueTable = VENUE_WEIGHTS[venue] || VENUE_WEIGHTS['Harbor'];
  const weather = randomKey(venueTable) || 'Sunny';

  state.nextRace = { venue, weather };
  saveState();
  return state.nextRace;
}


function getNextRace() {
  if (!state.nextRace) {
    return rollNextRace();
  }
  return state.nextRace;
}

function resetAll() {
  state = {
    players: {},
    race: null,
    cooldownUntil: 0,
    nextRace: null,
  };
  saveState();
}

module.exports = {
  getState: () => state,
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
};
