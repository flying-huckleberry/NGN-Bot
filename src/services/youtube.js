// src/services/youtube.js
const { google } = require('googleapis');
const fs = require('fs');
const { logger } = require('../utils/logger'); 

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  TOKEN_PATH,
  SCOPES,
} = require('../config/env');

// OAuth client + YouTube API client
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);

const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

/**
 * If token.json exists, load it and set credentials.
 * Returns true if credentials were loaded, false otherwise.
 * (Non-blocking: we keep OAuth server/flow wiring elsewhere.)
 */
function initYoutubeAuthIfTokenExists() {
  logger.info('initting');
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      oauth2Client.setCredentials(tokens);
      return true;
    }
  } catch {
    logger.error('failed to initialize YouTube auth.');
  }
  return false;
}

/**
 * Utility: persist tokens to disk (overwrites).
 * Use this from your OAuth callback handler.
 */
function saveOAuthTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

/* ─────────── Helpers to discover chat and interact with live chat ─────────── */

/**
 * Find the active live video on a channel and return its liveChatId.
 * Optional `titleSubstring` to pick a specific live by (partial) title.
 */
async function getLiveChatIdForChannel(channelId, titleSubstring) {
  const searchRes = await youtube.search.list({
    part: ['id', 'snippet'],
    channelId,
    eventType: 'live',
    type: ['video'],
    maxResults: 5,
    order: 'date',
  });

  const items = searchRes.data.items || [];
  if (!items.length) {
    throw new Error('No active live stream found on the target channel.');
  }

  // Choose candidate by title match if provided
  let candidate = items[0];
  if (titleSubstring) {
    const lower = titleSubstring.toLowerCase();
    candidate =
      items.find((i) => (i.snippet?.title || '').toLowerCase().includes(lower)) || candidate;
  }

  const videoId = candidate?.id?.videoId;
  const title = candidate?.snippet?.title;
  if (!videoId) {
    throw new Error('Found a live item but could not resolve video ID.');
  }

  const videosRes = await youtube.videos.list({
    part: ['liveStreamingDetails', 'snippet'],
    id: [videoId],
  });
  const liveChatId = videosRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) {
    throw new Error('Live video found but no active chat (chat disabled or members-only).');
  }

  return { liveChatId, channelId, videoId, title };
}

async function getLiveChatIdForVideo(videoId) {
  const res = await youtube.videos.list({
    part: ['liveStreamingDetails', 'snippet'],
    id: [videoId],
  });
  const item = res.data.items?.[0];
  const liveChatId = item?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) throw new Error('Video found but not currently live or chat disabled.');
  const channelId = item?.snippet?.channelId || null;
  const title = item?.snippet?.title || null;
  return { liveChatId, channelId, videoId, title };
}

/**
 * Given a full YouTube URL, extract ?v= and resolve liveChatId.
 */
async function getLiveChatIdFromUrl(url) {
  const match = url.match(/[?&]v=([^&]+)/);
  if (!match) throw new Error('Invalid YouTube URL');
  const videoId = match[1];

  return getLiveChatIdForVideo(videoId);
}

/**
 * Prime chat: fetch once to obtain the forward nextPageToken
 * WITHOUT processing messages.
 * Also handy for recovering from invalidPageToken.
 */
async function primeChat(liveChatId) {
  const res = await youtube.liveChatMessages.list({
    liveChatId,
    part: ['snippet'],
    maxResults: 200,
  });
  return res.data.nextPageToken || null;
}

/**
 * Send a plain text chat message.
 */
async function sendChatMessage(liveChatId, text) {
  await youtube.liveChatMessages.insert({
    part: ['snippet'],
    requestBody: {
      snippet: {
        liveChatId,
        type: 'textMessageEvent',
        textMessageDetails: { messageText: text },
      },
    },
  });
}

module.exports = {
  // raw clients
  oauth2Client,
  youtube,

  // token utils
  initYoutubeAuthIfTokenExists,
  saveOAuthTokens,

  // discovery
  getLiveChatIdForChannel,
  getLiveChatIdForVideo,
  getLiveChatIdFromUrl,

  // chat
  primeChat,
  sendChatMessage,
};
