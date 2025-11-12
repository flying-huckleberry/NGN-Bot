// src/core/polling.js
// Polling + single-shot processing logic. Keeps API usage minimal and
// reuses cached page tokens. No rate/backoff changes.

const {
  COMMAND_PREFIX,
  POLLING_FALLBACK_MS,
  BOT_START_MS,
} = require('../config/env');

const { youtube, primeChat } = require('../services/youtube');
const { saveDevState } = require('../state/devState');
const g = require('../state/g');

/**
 * Simple parser for commands like "!ask hello world"
 */
function parseCommand(text, prefix) {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith(prefix)) return null;
  const [name, ...args] = trimmed.slice(prefix.length).split(/\s+/);
  return { name: name.toLowerCase(), args };
}

/**
 * Process exactly one page of messages and run matching commands.
 * - Uses saved g.nextPageToken when available
 * - If token is invalid, primes once and retries
 * - Filters out messages published before this bot instance started
 *
 * @param {string} liveChatId
 * @param {object} commands  Map: name -> async ({ liveChatId, msg, args }) => void
 * @returns {object} { ok, received, handled, nextDelaySuggestedMs }
 */
async function pollOnce(liveChatId, commands) {
  let res;
  try {
    res = await youtube.liveChatMessages.list({
      liveChatId,
      part: ['snippet', 'authorDetails'],
      pageToken: g.nextPageToken || undefined,
      maxResults: 200,
    });
  } catch (err) {
    const reason = err?.errors?.[0]?.reason || err?.message;
    if (String(reason).toLowerCase().includes('invalidpagetoken')) {
      const newToken = await primeChat(liveChatId);
      res = await youtube.liveChatMessages.list({
        liveChatId,
        part: ['snippet', 'authorDetails'],
        pageToken: newToken || undefined,
        maxResults: 200,
      });
      g.nextPageToken = newToken || g.nextPageToken;
    } else {
      throw err;
    }
  }

  const items = res.data.items || [];
  let handled = 0;

  for (const msg of items) {
    if (msg?.snippet?.type !== 'textMessageEvent') continue;

    const publishedAt = msg?.snippet?.publishedAt;
    if (publishedAt && Date.parse(publishedAt) < BOT_START_MS) continue;

    const text = msg?.snippet?.textMessageDetails?.messageText || '';
    const cmd = parseCommand(text, COMMAND_PREFIX);
    if (cmd && commands[cmd.name]) {
      try {
        await commands[cmd.name]({ liveChatId, msg, args: cmd.args });
        handled++;
      } catch (e) {
        console.error('Command error:', e);
      }
    }
  }

  g.nextPageToken = res.data.nextPageToken || g.nextPageToken;
  saveDevState(g);

  return {
    ok: true,
    received: items.length,
    handled,
    nextDelaySuggestedMs:
      res.data.pollingIntervalMillis ??
      (Number.isFinite(+POLLING_FALLBACK_MS) ? +POLLING_FALLBACK_MS : 2000),
  };
}

/**
 * Continuous poller.
 * Prod uses this; Dev (WebUI) calls pollOnce with each button click.
 */
async function pollChat(liveChatId, commands, pageToken) {
  try {
    const res = await youtube.liveChatMessages.list({
      liveChatId,
      part: ['snippet', 'authorDetails'],
      pageToken,
      maxResults: 200,
    });

    const items = res.data.items || [];
    for (const msg of items) {
      if (msg?.snippet?.type !== 'textMessageEvent') continue;

      const publishedAt = msg?.snippet?.publishedAt;
      if (publishedAt && Date.parse(publishedAt) < BOT_START_MS) continue;

      const text = msg?.snippet?.textMessageDetails?.messageText || '';
      const cmd = parseCommand(text, COMMAND_PREFIX);
      if (cmd && commands[cmd.name]) {
        try {
          await commands[cmd.name]({ liveChatId, msg, args: cmd.args });
        } catch (e) {
          console.error('Command error:', e);
        }
      }
    }

    const nextPageToken = res.data.nextPageToken;
    const delay =
      res.data.pollingIntervalMillis ??
      (Number.isFinite(+POLLING_FALLBACK_MS) ? +POLLING_FALLBACK_MS : 2000);

    setTimeout(() => pollChat(liveChatId, commands, nextPageToken), delay);
  } catch (err) {
    console.error('Polling error:', err?.errors?.[0] || err.message || err);
    setTimeout(() => pollChat(liveChatId, commands, pageToken), 5000);
  }
}

module.exports = {
  pollOnce,
  pollChat,
};
