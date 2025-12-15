// src/state/g.js
// Single in-memory runtime state shared across modules.
// Dev state helpers (load/save/reset) operate on this object.

const { DISABLED_MODULES = [] } = require('../config/env');

module.exports = {
  liveChatId: null,
  nextPageToken: null,
  primed: false,
  youtubeChannelId: null,
  disabledModules: (DISABLED_MODULES || [])
    .map((name) => String(name || '').trim().toLowerCase())
    .filter(Boolean),
};
