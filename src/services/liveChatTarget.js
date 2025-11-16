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

// rough cost assumptions you gave:
// - livestream URL lookup: 1
// - video ID lookup:       1
// - channel ID search:   101
// plus primeChat (liveChatMessages.list) ~5 units
const PRIME_ESTIMATE_UNITS = 5;

/**
 * Resolves the liveChatId based on .env:
 * 1) TARGET_LIVESTREAM_URL
 * 2) TARGET_VIDEO_ID
 * 3) TARGET_CHANNEL_ID (+ TARGET_TITLE_MATCH)
 *
 * Returns:
 *   { liveChatId, method, targetInfo, estimatedUnits }
 *
 * Throws with a helpful message if none is set or if resolution fails.
 */
async function resolveTargetLiveChatId() {
  let liveChatId;
  let method;
  let targetInfo = {};
  let discoverCost = 0;

  if (TARGET_LIVESTREAM_URL) {
    liveChatId = await getLiveChatIdFromUrl(TARGET_LIVESTREAM_URL);
    method = 'Livestream URL';
    targetInfo = { url: TARGET_LIVESTREAM_URL };
    discoverCost = 1;
  } else if (process.env.TARGET_VIDEO_ID) {
    liveChatId = await getLiveChatIdForVideo(process.env.TARGET_VIDEO_ID);
    method = 'Video ID';
    targetInfo = { videoId: process.env.TARGET_VIDEO_ID };
    discoverCost = 1;
  } else if (TARGET_CHANNEL_ID) {
    liveChatId = await getLiveChatIdForChannel(
      TARGET_CHANNEL_ID,
      (TARGET_TITLE_MATCH || '').trim()
    );
    method = 'Channel ID (title match optional)';
    targetInfo = {
      channelId: TARGET_CHANNEL_ID,
      titleMatch: TARGET_TITLE_MATCH || '',
    };
    discoverCost = 101;
  } else {
    throw new Error(
      'Set one of TARGET_LIVESTREAM_URL, TARGET_VIDEO_ID, or TARGET_CHANNEL_ID in .env'
    );
  }

  if (!liveChatId) {
    throw new Error('Unable to resolve liveChatId from the configured target.');
  }

  const estimatedUnits = discoverCost + PRIME_ESTIMATE_UNITS;

  return { liveChatId, method, targetInfo, estimatedUnits };
}

module.exports = { resolveTargetLiveChatId };
