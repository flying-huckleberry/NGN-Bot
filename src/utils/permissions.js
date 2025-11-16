// src/utils/permissions.js
// Owner checks + a reusable ownerOnly middleware for modules/commands.

const { OWNER_CHANNEL_ID } = require('../config/env');
const { logger } = require('./logger');

/**
 * Low-level ownership check using YouTube message metadata.
 * - true if author is the stream/channel owner (YouTube flag)
 * - true if author channelId matches OWNER_CHANNEL_ID (.env)
 */
function isOwner(msg) {
  if (msg?.authorDetails?.isChatOwner) return true;
  if (OWNER_CHANNEL_ID && msg?.authorDetails?.channelId === OWNER_CHANNEL_ID) return true;
  return false;
}

/**
 * ownerOnly middleware
 * Usage:
 *   - As a module-wide guard:  module.exports = { ..., middleware: [ownerOnly()] }
 *   - As a per-command guard:  commands.mycmd.middleware = [ownerOnly()]
 *
 * Options:
 *   - message: what to reply when blocked (string | false to stay silent)
 *   - log    : custom logger (defaults to ctx.logger.warn if present, else logger.warn)
 */
function ownerOnly({ message = 'This command is owner-only.', log } = {}) {
  return async function ownerOnlyMiddleware(ctx, next) {
    const ok = isOwner(ctx.msg);
    if (ok) return next();

    // optional feedback in chat
    if (message) {
      try { await ctx.reply(message); } catch (_) {}
    }

    const writer = log || (ctx?.logger?.warn ?? logger.warn.bind(logger));
    writer(`[ownerOnly] blocked ${ctx.msg?.authorDetails?.displayName || 'unknown user'}`);
    // stop the middleware chain
    return;
  };
}

module.exports = {
  isOwner,
  ownerOnly,
};

