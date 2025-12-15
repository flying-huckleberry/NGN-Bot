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
 * Resolves the liveChatId based on overrides or .env:
 * Overrides priority:
 *   a) livestreamUrl (URL)
 *   b) channelId
 *
 * Otherwise .env priority:
 * 1) TARGET_LIVESTREAM_URL
 * 2) TARGET_VIDEO_ID
 * 3) TARGET_CHANNEL_ID (+ TARGET_TITLE_MATCH)
 *
 * Returns:
 *   { liveChatId, method, targetInfo, estimatedUnits, channelId }
 *
 * Throws with a helpful message if none is set or if resolution fails.
 */
async function resolveTargetLiveChatId(overrides = {}) {
  const overrideUrl = (overrides.livestreamUrl || '').trim();
  const overrideChannelId = (overrides.channelId || '').trim();
  let result;
  let method;
  let targetInfo = {};
  let discoverCost = 0;

  if (overrideUrl) {
    result = await getLiveChatIdFromUrl(overrideUrl);
    method = 'Livestream URL (override)';
    targetInfo = { url: overrideUrl, videoId: result?.videoId };
    discoverCost = 1;
  } else if (overrideChannelId) {
    result = await getLiveChatIdForChannel(
      overrideChannelId,
      (TARGET_TITLE_MATCH || '').trim()
    );
    method = 'Channel ID (override)';
    targetInfo = {
      channelId: overrideChannelId,
      titleMatch: TARGET_TITLE_MATCH || '',
    };
    discoverCost = 101;
  } else if (TARGET_LIVESTREAM_URL) {
    result = await getLiveChatIdFromUrl(TARGET_LIVESTREAM_URL);
    method = 'Livestream URL';
    targetInfo = { url: TARGET_LIVESTREAM_URL, videoId: result?.videoId };
    discoverCost = 1;
  } else if (process.env.TARGET_VIDEO_ID) {
    result = await getLiveChatIdForVideo(process.env.TARGET_VIDEO_ID);
    method = 'Video ID';
    targetInfo = { videoId: process.env.TARGET_VIDEO_ID };
    discoverCost = 1;
  } else if (TARGET_CHANNEL_ID) {
    result = await getLiveChatIdForChannel(
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
      'Set one of TARGET_LIVESTREAM_URL, TARGET_VIDEO_ID, or TARGET_CHANNEL_ID in .env, or provide an override.'
    );
  }

  if (!result?.liveChatId) {
    throw new Error('Unable to resolve liveChatId from the configured target.');
  }

  const estimatedUnits = discoverCost + PRIME_ESTIMATE_UNITS;

  return {
    liveChatId: result.liveChatId,
    channelId: result.channelId || overrideChannelId || TARGET_CHANNEL_ID || null,
    method,
    targetInfo,
    estimatedUnits,
  };
}

module.exports = { resolveTargetLiveChatId };
