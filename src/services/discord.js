// src/services/discord.js
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
} = require('discord.js');
const {
  DISCORD_BOT_TOKEN,
  COMMAND_PREFIX,
} = require('../config/env');
const { logger } = require('../utils/logger');
const {
  findAccountByDiscordGuildId,
} = require('../state/accountsRepo');
const { loadAccountSettings } = require('../state/accountSettings');
const { loadAccountRuntime } = require('../state/accountRuntime');

let client = null;
const status = {
  enabled: Boolean(DISCORD_BOT_TOKEN),
  state: DISCORD_BOT_TOKEN ? 'idle' : 'disabled',
  lastError: null,
  readyAt: null,
  username: null,
};

function isChannelAllowed(channelId, settings) {
  if (!channelId) return true;
  const allowed = settings?.discord?.allowedChannelIds || [];
  if (!Array.isArray(allowed) || allowed.length === 0) {
    return true;
  }
  return allowed.includes(channelId);
}

function normalizeDiscordMessage(message) {
  const authorDetails = {
    displayName:
      message.member?.displayName ||
      message.author?.globalName ||
      message.author?.username ||
      'DiscordUser',
    channelId: message.author?.id,
    isChatOwner:
      message.member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
      false,
  };

  return {
    snippet: {
      type: 'textMessageEvent',
      textMessageDetails: {
        messageText: message.content || '',
      },
      displayMessage: message.content || '',
      publishedAt: message.createdAt?.toISOString?.() || new Date().toISOString(),
    },
    authorDetails,
    platform: {
      type: 'discord',
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author?.id,
    },
    raw: message,
  };
}

function createDiscordTransport(message) {
  return {
    type: 'discord',
    channelId: message.channelId,
    guildId: message.guildId,
    async send(text) {
      if (!message.channel) return;
      await message.channel.send(text);
    },
  };
}

async function startDiscordTransport({ dispatch }) {
  if (!DISCORD_BOT_TOKEN) {
    status.state = 'missing_token';
    logger.warn('Discord transport disabled: DISCORD_BOT_TOKEN not set.');
    return null;
  }

  if (client) return client;

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  status.state = 'connecting';

  client.once('ready', () => {
    status.state = 'ready';
    status.readyAt = new Date().toISOString();
    status.username = client.user?.tag || null;
    logger.info(`Discord client logged in as ${client.user?.tag || 'unknown bot'}`);
  });

  client.on('error', (err) => {
    status.state = 'error';
    status.lastError = err?.message || String(err);
    logger.error('Discord client error:', err);
  });

  client.on('shardDisconnect', (event) => {
    status.state = 'disconnected';
    logger.warn('Discord shard disconnected', event?.code);
  });

  client.on('messageCreate', async (message) => {
    if (!message || message.author?.bot) return;
    const account = findAccountByDiscordGuildId(message.guildId);
    if (!account) return;
    const settings = loadAccountSettings(account.id);
    // Per-account routing toggle; global client stays connected.
    if (settings?.discord?.enabled === false) return;
    if (!isChannelAllowed(message.channelId, settings)) return;

    const text = (message.content || '').trim();
    const prefix = settings?.commandPrefix || COMMAND_PREFIX || '!';
    if (!text.startsWith(prefix)) return;

    const msg = normalizeDiscordMessage(message);

    try {
      await dispatch({
        msg,
        liveChatId: message.channelId,
        transport: createDiscordTransport(message),
        platformMeta: {
          discord: {
            guildId: message.guildId,
            channelId: message.channelId,
            userId: message.author?.id,
          },
          rawDiscord: message,
        },
        accountId: account.id,
        accountSettings: settings,
        account,
        accountRuntime: loadAccountRuntime(account.id),
      });
    } catch (err) {
      logger.error('Discord dispatch error:', err);
    }
  });

  try {
    await client.login(DISCORD_BOT_TOKEN);
    return client;
  } catch (err) {
    status.state = 'error';
    status.lastError = err?.message || String(err);
    logger.error('Failed to login Discord client:', err);
    throw err;
  }
}

function getDiscordStatus() {
  return { ...status };
}

module.exports = {
  startDiscordTransport,
  getDiscordStatus,
};
