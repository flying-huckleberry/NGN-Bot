// src/utils/permissions.js
// Admin/owner checks + reusable adminOnly/ownerOnly middleware for modules/commands.

const { PermissionsBitField } = require('discord.js');
const { OWNER_CHANNEL_ID } = require('../config/env');
const { logger } = require('./logger');

/**
 * Low-level ownership check using YouTube message metadata.
 * - true if author is the stream/channel owner (YouTube flag)
 * - true if author channelId matches OWNER_CHANNEL_ID (.env)
 */
function isOwner(msg, ctx) {
  if (ctx?.transport?.type === 'discord') {
    const raw = ctx?.platformMeta?.rawDiscord;
    const ownerId = raw?.guild?.ownerId;
    if (ownerId && raw?.author?.id && ownerId === raw.author.id) return true;
    return false;
  }
  if (msg?.authorDetails?.isChatOwner) return true;
  if (OWNER_CHANNEL_ID && msg?.authorDetails?.channelId === OWNER_CHANNEL_ID) return true;
  return false;
}

/**
 * Admin check per platform.
 * - YouTube: channel owner or chat moderator
 * - Discord: Administrator permission (or guild owner)
 */
function isAdmin(msg, ctx) {
  if (ctx?.transport?.type === 'discord') {
    const raw = ctx?.platformMeta?.rawDiscord;
    const ownerId = raw?.guild?.ownerId;
    if (ownerId && raw?.author?.id && ownerId === raw.author.id) return true;
    if (raw?.member?.permissions?.has) {
      return raw.member.permissions.has(PermissionsBitField.Flags.Administrator);
    }
    return false;
  }
  if (msg?.authorDetails?.isChatOwner) return true;
  if (msg?.authorDetails?.isChatModerator) return true;
  return false;
}

/**
 * adminOnly middleware
 * Usage:
 *   - As a module-wide guard:  module.exports = { ..., middleware: [adminOnly()] }
 *   - As a per-command guard:  commands.mycmd.middleware = [adminOnly()]
 *
 * Options:
 *   - message: what to reply when blocked (string | false to stay silent)
 *   - log    : custom logger (defaults to ctx.logger.warn if present, else logger.warn)
 */
function adminOnly({ message = 'This command is admin-only.', log } = {}) {
  return async function adminOnlyMiddleware(ctx, next) {
    const ok = isAdmin(ctx.msg, ctx);
    if (ok) return next();

    // optional feedback in chat
    if (message) {
      try { await ctx.reply(message); } catch (_) {}
    }

    const writer = log || (ctx?.logger?.warn ?? logger.warn.bind(logger));
    writer(`[adminOnly] blocked ${ctx.msg?.authorDetails?.displayName || 'unknown user'}`);
    // stop the middleware chain
    return;
  };
}

/**
 * ownerOnly middleware
 * Usage:
 *   - As a module-wide guard:  module.exports = { ..., middleware: [ownerOnly()] }
 *   - As a per-command guard:  commands.mycmd.middleware = [ownerOnly()]
 */
function ownerOnly({ message = 'This command is owner-only.', log } = {}) {
  return async function ownerOnlyMiddleware(ctx, next) {
    const ok = isOwner(ctx.msg, ctx);
    if (ok) return next();

    if (message) {
      try { await ctx.reply(message); } catch (_) {}
    }

    const writer = log || (ctx?.logger?.warn ?? logger.warn.bind(logger));
    writer(`[ownerOnly] blocked ${ctx.msg?.authorDetails?.displayName || 'unknown user'}`);
    return;
  };
}

module.exports = {
  isOwner,
  isAdmin,
  adminOnly,
  ownerOnly,
};

