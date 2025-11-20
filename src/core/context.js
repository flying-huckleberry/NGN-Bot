// src/core/context.js
const env = require('../config/env');
const { sendChatMessage } = require('../services/youtube');
const g = require('../state/g');
const { deriveStateScope } = require('../state/stateScope');
const { logger, getLogger } = require('../utils/logger');
const botLogger = getLogger('bot');

function buildContextFactory(services) {
  return async function buildContext({ msg, liveChatId, args, transport, platformMeta }) {
    // Best-effort extraction of the author name
    const authorName =
      msg?.authorDetails?.displayName ||
      msg?.author?.displayName ||
      'unknown';

    // Extract a simple "command name" from the raw chat message text
    // e.g. "!help" → "help", "!core help" → "core"
    const rawText = msg?.snippet?.displayMessage || '';
    const firstToken = rawText.trim().split(/\s+/)[0] || '';
    const commandName = firstToken.startsWith('!')
      ? firstToken.slice(1)
      : firstToken;

    const activeTransport =
      transport ||
      {
        type: 'youtube',
        async send(text) {
          await sendChatMessage(liveChatId, text);
        },
      };

    const scopeInfo = deriveStateScope({ transport: activeTransport, platformMeta });

    const ctx = {
      env,
      services,
      state: g,
      logger,     // app logger
      botLogger,  // bot logger if you ever want direct access
      msg,
      liveChatId,
      args,
      authorName,
      commandName,
      transport: activeTransport,
      platform: activeTransport?.type || 'youtube',
      platformMeta,
      stateScope: scopeInfo.scopeKey,
      scopeInfo,
    };

    ctx.mention = (userId, fallbackName = ctx.authorName || 'user') => {
      if (ctx.platform === 'discord') {
        const id =
          userId ||
          platformMeta?.discord?.userId ||
          activeTransport?.userId ||
          ctx.msg?.authorDetails?.channelId ||
          null;
        return id ? `<@${id}>` : fallbackName;
      }
      return fallbackName;
    };

    // Wrap reply: always log command.response, then send message
    ctx.reply = async (text, meta = {}) => {
      const reply = String(text ?? '');

      try {
        botLogger.info('command.response', {
          command: ctx.commandName,
          user: ctx.authorName,
          reply,
          ...meta,
        });
      } catch (err) {
        // Don't let logging failure break replies
      }

      if (activeTransport?.send) {
        await activeTransport.send(reply);
      } else {
        await sendChatMessage(liveChatId, reply);
      }
    };

    return ctx;
  };
}

module.exports = { buildContextFactory };
