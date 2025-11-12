// src/utils/permissions.js
// Minimal owner check

const { OWNER_CHANNEL_ID } = require('../config/env');

function isOwner(msg) {
  // yt livestream channel owner can use the command
  if (msg?.authorDetails?.isChatOwner) return true;
  // bot owner can use the command
  if (OWNER_CHANNEL_ID && msg?.authorDetails?.channelId === OWNER_CHANNEL_ID) return true;
  return false;
}

module.exports = { isOwner };
