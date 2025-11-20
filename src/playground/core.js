// src/playground/core.js
const path = require('path');
const env = require('../config/env');
const { loadModules } = require('../core/loader');
const { createRouter } = require('../core/router');
const league = require('../services/league');
const { logger, getLogger } = require('../utils/logger');
const botLogger = getLogger('bot');

const PLAYGROUND_LOG = [];
const PLAYGROUND_SOFT_CAP = 200;

const PLAYGROUND_PLAYERS = [
  { id: 'UC_PLAYGROUND_OWNER', displayName: 'PlaygroundOwner', isChatOwner: true },
  { id: 'UC_STREETKING',      displayName: 'StreetKing',      isChatOwner: false },
  { id: 'UC_DRIFTQUEEN',      displayName: 'DriftQueen',      isChatOwner: false },
  { id: 'UC_RAINRUNNER',      displayName: 'RainRunner',      isChatOwner: false },
  { id: 'UC_ROADBLADE',       displayName: 'RoadBlade',       isChatOwner: false },
];

function pushLog(text) {
  const line = String(text ?? '');
  PLAYGROUND_LOG.push(line);
  if (PLAYGROUND_LOG.length > PLAYGROUND_SOFT_CAP) {
    PLAYGROUND_LOG.shift();
  }
}

// one-time module load + registry
const modulesDir = path.join(__dirname, '..', 'modules');
const registry = loadModules(modulesDir);

function buildContextFactoryForPlayground() {
  return async function buildContext({ msg, liveChatId, args, transport, platformMeta }) {
    const author = msg && msg.authorDetails ? msg.authorDetails : null;
    const authorName = author?.displayName || 'unknown';

    const rawText =
      msg?.snippet?.textMessageDetails?.messageText ||
      msg?.snippet?.displayMessage ||
      '';

    const firstToken = rawText.trim().split(/\s+/)[0] || '';
    const commandName = firstToken.startsWith('!')
      ? firstToken.slice(1)
      : firstToken;

    const activeTransport =
      transport ||
      {
        type: 'playground',
        async send(text) {
          pushLog(text);
        },
      };

    const meta = platformMeta || { playground: true };

    const ctx = {
      env,
      services: { registry, league },
      state: {},
      logger,
      botLogger,
      msg,
      liveChatId,
      args,
      author,
      user: author,
      authorName,
      commandName,
      transport: activeTransport,
      platform: activeTransport?.type || 'playground',
      platformMeta: meta,
      stateScope: 'playground',
      scopeInfo: { scopeKey: 'playground', source: { type: 'playground' } },
    };

    ctx.reply = async (text, meta = {}) => {
      const reply = String(text ?? '');

      try {
        botLogger.info('command.response', {
          command: ctx.commandName,
          user: ctx.authorName,
          reply,
          ...meta,
        });
      } catch (_) {}

      if (activeTransport?.send) {
        await activeTransport.send(reply);
      } else {
        pushLog(reply);
      }
    };

    return ctx;
  };
}

async function runCommandText(rawText, player) {
  const before = PLAYGROUND_LOG.length;
  const repliesFromThisCommand = [];

  const effectivePlayer = player || PLAYGROUND_PLAYERS[0];

  const fakeMsg = {
    snippet: {
      type: 'textMessageEvent',
      textMessageDetails: { messageText: rawText },
      publishedAt: new Date().toISOString(),
    },
    authorDetails: {
      displayName: effectivePlayer.displayName,
      channelId: effectivePlayer.id,
      isChatOwner: !!effectivePlayer.isChatOwner,
    },
  };

  const buildContext = buildContextFactoryForPlayground();
  const dispatch = createRouter({ registry, buildContext });

  const transport = {
    type: 'playground',
    async send(text) {
      pushLog(text);
    },
  };

  await dispatch({
    msg: fakeMsg,
    liveChatId: 'PLAYGROUND',
    transport,
    platformMeta: { playground: true },
  });

  const after = PLAYGROUND_LOG.length;
  if (after > before) {
    for (let i = before; i < after; i++) {
      repliesFromThisCommand.push(PLAYGROUND_LOG[i]);
    }
  }

  return repliesFromThisCommand;
}

function clearLog() {
  PLAYGROUND_LOG.length = 0;
}

function getLog() {
  return [...PLAYGROUND_LOG];
}

function getPlayers() {
  return [...PLAYGROUND_PLAYERS];
}

module.exports = {
  runCommandText,
  getLog,
  clearLog,
  getPlayers,
};
