// src/state/g.js
// Single in-memory runtime state shared across modules.
// Dev state helpers (load/save/reset) operate on this object.

module.exports = {
  liveChatId: null,
  nextPageToken: null,
  primed: false,
  youtubeChannelId: null,
};
