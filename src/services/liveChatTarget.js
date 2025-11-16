// src/services/liveChatTarget.js

const {
  TARGET_LIVESTREAM_URL,
  TARGET_CHANNEL_ID,
  TARGET_TITLE_MATCH,
} = require('../config/env');

const {
  getLiveChatIdFromUrl,
  getLiveChatIdForVideo,
  getLiveChatIdForChannel,
} = require('./youtube');

/**
 * Resolves the liveChatId based on .env:
 * 1) TARGET_LIVESTREAM_URL
 * 2) TARGET_VIDEO_ID
 * 3) TARGET_CHANNEL_ID (+ TARGET_TITLE_MATCH)
 *
 * Throws with a helpful message if none is set.
 */
async function resolveTargetLiveChatId() {
  let liveChatId = null;

  if (TARGET_LIVESTREAM_URL) {
    liveChatId = await getLiveChatIdFromUrl(TARGET_LIVESTREAM_URL);
  } else if (process.env.TARGET_VIDEO_ID) {
    liveChatId = await getLiveChatIdForVideo(process.env.TARGET_VIDEO_ID);
  } else if (TARGET_CHANNEL_ID) {
    liveChatId = await getLiveChatIdForChannel(
      TARGET_CHANNEL_ID,
      (TARGET_TITLE_MATCH || '').trim()
    );
  } else {
    throw new Error(
      'Set one of TARGET_LIVESTREAM_URL, TARGET_VIDEO_ID, or TARGET_CHANNEL_ID in .env'
    );
  }

  if (!liveChatId) {
    throw new Error('Unable to resolve liveChatId from the configured target.');
  }

  return liveChatId;
}

module.exports = { resolveTargetLiveChatId };
