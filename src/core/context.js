// src/core/context.js
const env = require('../config/env');
const { sendChatMessage } = require('../services/youtube');
const g = require('../state/g');
const logger = require('../utils/logger');

function buildContextFactory(services) {
  return async function buildContext({ msg, liveChatId, args }) {
    return {
      env,
      services,
      state: g,
      logger,
      msg,
      liveChatId,
      args,
      reply: async (text) => sendChatMessage(liveChatId, text),
    };
  };
}

module.exports = { buildContextFactory };
