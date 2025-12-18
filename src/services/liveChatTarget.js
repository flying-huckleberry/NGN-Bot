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
async function resolveTargetLiveChatId(overrides = {}, config = {}) {
  const defaults = {
    livestreamUrl: TARGET_LIVESTREAM_URL,
    channelId: TARGET_CHANNEL_ID,
    videoId: process.env.TARGET_VIDEO_ID,
    titleMatch: TARGET_TITLE_MATCH,
  };
  const merged = { ...defaults, ...(config || {}) };

  const overrideUrl = (overrides.livestreamUrl || '').trim();
  const overrideChannelId = (overrides.channelId || '').trim();
  const overrideVideoId = (overrides.videoId || '').trim();
  const overrideTitleMatch =
    typeof overrides.titleMatch === 'string' ? overrides.titleMatch : merged.titleMatch;
  let result;
  let method;
  let targetInfo = {};
  let discoverCost = 0;

  if (overrideUrl) {
    result = await getLiveChatIdFromUrl(overrideUrl);
    method = 'Livestream URL (override)';
    targetInfo = { url: overrideUrl, videoId: result?.videoId };
    discoverCost = 1;
  } else if (overrideVideoId) {
    result = await getLiveChatIdForVideo(overrideVideoId);
    method = 'Video ID (override)';
    targetInfo = { videoId: overrideVideoId };
    discoverCost = 1;
  } else if (overrideChannelId) {
    result = await getLiveChatIdForChannel(
      overrideChannelId,
      (overrideTitleMatch || '').trim()
    );
    method = 'Channel ID (override)';
    targetInfo = {
      channelId: overrideChannelId,
      titleMatch: overrideTitleMatch || '',
    };
    discoverCost = 101;
  } else if (merged.livestreamUrl) {
    result = await getLiveChatIdFromUrl(merged.livestreamUrl);
    method = 'Livestream URL';
    targetInfo = { url: merged.livestreamUrl, videoId: result?.videoId };
    discoverCost = 1;
  } else if (merged.videoId) {
    result = await getLiveChatIdForVideo(merged.videoId);
    method = 'Video ID';
    targetInfo = { videoId: merged.videoId };
    discoverCost = 1;
  } else if (merged.channelId) {
    result = await getLiveChatIdForChannel(
      merged.channelId,
      (merged.titleMatch || '').trim()
    );
    method = 'Channel ID (title match optional)';
    targetInfo = {
      channelId: merged.channelId,
      titleMatch: merged.titleMatch || '',
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
    channelId: result.channelId || overrideChannelId || merged.channelId || null,
    method,
    targetInfo,
    estimatedUnits,
  };
}

module.exports = { resolveTargetLiveChatId };
