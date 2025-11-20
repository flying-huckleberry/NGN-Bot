// src/state/stateScope.js
// Derive logical scope identifiers for per-context persistence.

const DEFAULT_SCOPE = 'global';

function deriveStateScope({ transport, platformMeta } = {}) {
  const type = transport?.type || 'unknown';

  if (type === 'playground') {
    return {
      scopeKey: 'playground',
      source: { type: 'playground' },
    };
  }

  if (type === 'youtube') {
    const channelId = platformMeta?.youtube?.channelId;
    const scopeKey = channelId ? `youtube:${channelId}` : 'youtube:unknown';
    return {
      scopeKey,
      source: { type: 'youtube', channelId },
    };
  }

  if (type === 'discord') {
    const guildId = platformMeta?.discord?.guildId;
    const scopeKey = guildId ? `discord:${guildId}` : 'discord:unknown';
    return {
      scopeKey,
      source: { type: 'discord', guildId, channelId: platformMeta?.discord?.channelId },
    };
  }

  return {
    scopeKey: DEFAULT_SCOPE,
    source: { type },
  };
}

module.exports = { deriveStateScope };
