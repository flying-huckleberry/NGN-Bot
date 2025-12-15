// src/state/devState.js
// tiny helpers to persist/reuse dev state without extra API calls

const fs = require('fs');
const { DEV_STATE_PATH } = require('../config/env');
const { DISABLED_MODULES = [] } = require('../config/env');

function normalizeModules(input) {
  return (input || [])
    .map((name) => String(name || '').trim().toLowerCase())
    .filter(Boolean);
}

// read from disk into the provided state object `g`
function loadDevState(g) {
  try {
    const s = JSON.parse(fs.readFileSync(DEV_STATE_PATH, 'utf8'));
    if (s?.liveChatId) g.liveChatId = s.liveChatId;
    if (s?.nextPageToken) g.nextPageToken = s.nextPageToken;
    if (Object.prototype.hasOwnProperty.call(s, 'primed')) g.primed = s.primed;
    if (s?.youtubeChannelId) g.youtubeChannelId = s.youtubeChannelId;
    if (Array.isArray(s?.disabledModules)) {
      g.disabledModules = normalizeModules(s.disabledModules);
    }
  } catch {}
}

// write current `g` to disk (overwrites if exists)
function saveDevState(g) {
  try {
    fs.writeFileSync(
      DEV_STATE_PATH,
      JSON.stringify(
        {
          liveChatId: g.liveChatId,
          nextPageToken: g.nextPageToken,
          primed: g.primed,
          youtubeChannelId: g.youtubeChannelId,
          disabledModules: Array.isArray(g.disabledModules)
            ? normalizeModules(g.disabledModules)
            : [],
        },
        null,
        2
      )
    );
  } catch {}
}

// delete file and zero the in-memory state
function resetDevState(g) {
  try {
    if (fs.existsSync(DEV_STATE_PATH)) fs.unlinkSync(DEV_STATE_PATH);
  } catch {}
  g.liveChatId = null;
  g.nextPageToken = null;
  g.primed = false;
  g.youtubeChannelId = null;
  g.disabledModules = normalizeModules(DISABLED_MODULES);
}

// quick checker for the dev panel label
function devStateExists() {
  try {
    return fs.existsSync(DEV_STATE_PATH);
  } catch {
    return false;
  }
}

module.exports = {
  loadDevState,
  saveDevState,
  resetDevState,
  devStateExists,
};
