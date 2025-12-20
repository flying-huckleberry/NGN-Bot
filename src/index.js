// src/index.js
require('dotenv').config();

// -- startup sanity: ensure we're launched from project root --
const fs = require('fs');
const path = require('path');
const {
  ROOT_DIR,
  MODE,
  PORT,
  POLLING_FALLBACK_MS,
  BOT_START_MS,
} = require('./config/env');
const { logger } = require('./utils/logger');

function safeRequire(label, modulePath) {
  try {
    return require(modulePath);
  } catch (err) {
    logger.error(
      `Failed to load ${label} from ${modulePath}: ${err.stack || err.message || err}`
    );
    throw err;
  }
}

const rootPkg = path.join(ROOT_DIR, 'package.json');
if (!fs.existsSync(rootPkg)) {
  logger.error(`Startup error: expected to find package.json in ROOT_DIR (${ROOT_DIR})`);
  logger.error('Please run this script from the project root directory.');
  process.exit(1);
}

// -- deps ---------------------------------------------------
const express = require('express');
const open = (...args) => import('open').then((m) => m.default(...args));

// Services
const {
  youtube,
  initYoutubeAuthIfTokenExists,
  primeChat,
  sendChatMessage,
} = safeRequire('YouTube service', './services/youtube');

const { resolveTargetLiveChatId } = safeRequire(
  'Live chat target resolver',
  './services/liveChatTarget'
);

const league = safeRequire('League service', './services/league');

// HTTP / routes
const { mountAuthRoutes } = safeRequire('Auth routes', './server/auth');
const { registerAccountRoutes } = safeRequire('Account routes', './backend/routes/accounts');
const { registerPlaygroundRoutes } = safeRequire(
  'Playground routes',
  './backend/routes/playground'
);
const {
  startDiscordTransport,
  getDiscordStatus,
} = safeRequire('Discord transport', './services/discord');

// Core
const { createRouter } = safeRequire('Router core', './core/router');
const { loadModules } = safeRequire('Module loader', './core/loader');
const { buildContextFactory } = safeRequire('Context factory', './core/context');

const { migrateDevStateToDefaultAccount } = safeRequire(
  'Account migration',
  './state/accountMigration'
);
const { listAccounts, getAccountById } = safeRequire('Accounts repo', './state/accountsRepo');
const { loadAccountRuntime, saveAccountRuntime, resetAccountRuntime } = safeRequire(
  'Account runtime',
  './state/accountRuntime'
);
const { loadAccountSettings, updateAccountSettings } = safeRequire(
  'Account settings',
  './state/accountSettings'
);

// -- app bootstrap -----------------------------------------
(async () => {
  try {
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'backend', 'views'));
    app.locals.mode = MODE;

    migrateDevStateToDefaultAccount();

    // 1) Load all command modules and build the dispatcher
    const modulesDir = path.join(__dirname, 'modules');
    const registry = loadModules(modulesDir);

    const buildContext = buildContextFactory({
      youtube,
      registry, // so help can enumerate modules/commands
      league,
    });

    const isModuleDisabled = (moduleName, transport, platformMeta, accountSettings) => {
      if (transport?.type === 'playground') return false;
      const disabled = accountSettings?.disabledModules || [];
      const lower = String(moduleName || '').toLowerCase();
      return disabled.some((name) => String(name || '').toLowerCase() === lower);
    };

    const dispatch = createRouter({ registry, buildContext, isModuleDisabled });

    // 2) OAuth routes (save tokens, then startBot)
    mountAuthRoutes(app, { onAuthed: startBot });

    // 3) Account control panel routes
    registerAccountRoutes(app, {
      pollOnce: (accountId, liveChatId) =>
        pollOnceWithDispatch(accountId, liveChatId, dispatch),
      getDiscordStatus,
      modules: registry.modules,
    });

    // 4) Playground routes
    registerPlaygroundRoutes(app);

    try {
      await startDiscordTransport({ dispatch });
    } catch (err) {
      logger.warn(`Discord transport failed to start: ${err?.message || err}`);
    }

    // 5) Start HTTP server and proceed based on token presence
    app.listen(PORT, async () => {
      logger.info(`HTTP server on http://localhost:${PORT}`);

      if (!initYoutubeAuthIfTokenExists()) {
        await open(`http://localhost:${PORT}/auth`);
      } else {
        await startBot();
      }
    });

    // -- helpers --------------------------------------------

    // Poll exactly one page and dispatch each message through the module router.
    function createYoutubeTransport(liveChatId) {
      return {
        type: 'youtube',
        liveChatId,
        async send(text) {
          await sendChatMessage(liveChatId, text);
        },
      };
    }

    function isLiveChatStale(err) {
      const reason = err?.errors?.[0]?.reason || '';
      const message = err?.errors?.[0]?.message || err?.message || '';
      const text = `${reason} ${message}`.toLowerCase();
      if (
        text.includes('livechatended') ||
        text.includes('livechatnotfound') ||
        text.includes('livechatdisabled')
      ) {
        return true;
      }
      return (
        text.includes('live chat') &&
        (text.includes('ended') ||
          text.includes('not found') ||
          text.includes('no longer live') ||
          text.includes('disabled'))
      );
    }

    function resetYoutubeTransport(accountId, account) {
      resetAccountRuntime(accountId);
      updateAccountSettings(accountId, { youtube: { enabled: false } });
      logger.info(
        `YouTube transport reset for account "${account?.name || accountId}".`
      );
    }

    async function pollOnceWithDispatch(accountId, liveChatId, dispatchFn) {
      const account = getAccountById(accountId);
      if (!account) throw new Error('Account not found.');
      const runtime = loadAccountRuntime(accountId);
      const settings = loadAccountSettings(accountId);
      const youtubeTransport = createYoutubeTransport(liveChatId);
      let res;
      try {
        res = await youtube.liveChatMessages.list({
          liveChatId,
          part: ['snippet', 'authorDetails'],
          pageToken: runtime.nextPageToken || undefined,
          maxResults: 200,
        });
      } catch (err) {
        const reason = err?.errors?.[0]?.reason || err?.message;
        // If our saved page token went stale (e.g. long downtime), re-prime once to realign.
        if (String(reason).toLowerCase().includes('invalidpagetoken')) {
          const newToken = await primeChat(liveChatId);
          res = await youtube.liveChatMessages.list({
            liveChatId,
            part: ['snippet', 'authorDetails'],
            pageToken: newToken || undefined,
            maxResults: 200,
          });
          runtime.nextPageToken = newToken || runtime.nextPageToken;
        } else if (isLiveChatStale(err)) {
          resetYoutubeTransport(accountId, account);
          return {
            ok: false,
            received: 0,
            handled: 0,
            ended: true,
          };
        } else {
          throw err;
        }
      }

      const items = res.data.items || [];
      let handled = 0;

      for (const msg of items) {
        if (msg?.snippet?.type !== 'textMessageEvent') continue;

        // Ignore anything from before this bot instance started
        const publishedAt = msg?.snippet?.publishedAt;
        if (publishedAt && Date.parse(publishedAt) < BOT_START_MS) continue;

        await dispatchFn({
          msg,
          liveChatId,
          transport: youtubeTransport,
          platformMeta: {
            youtube: {
              channelId: runtime.youtubeChannelId || account.youtube?.channelId || null,
            },
          },
          accountId: account.id,
          accountSettings: settings,
          account,
          accountRuntime: runtime,
        });
        handled++;
      }

      runtime.nextPageToken = res.data.nextPageToken || runtime.nextPageToken;
      saveAccountRuntime(accountId, runtime);

      return {
        ok: true,
        received: items.length,
        handled,
        nextDelaySuggestedMs:
          res.data.pollingIntervalMillis ??
          (Number.isFinite(+POLLING_FALLBACK_MS) ? +POLLING_FALLBACK_MS : 2000),
      };
    }

    // Simple continuous loop that uses the router (optional for PROD; DEV uses pollOnce)
    async function pollLoop(accountId, liveChatId) {
      const account = getAccountById(accountId);
      if (!account) return;
      const runtime = loadAccountRuntime(accountId);
      const settings = loadAccountSettings(accountId);

      try {
        const res = await youtube.liveChatMessages.list({
          liveChatId,
          part: ['snippet', 'authorDetails'],
          pageToken: runtime.nextPageToken || undefined,
          maxResults: 200,
        });

        const items = res.data.items || [];
        for (const msg of items) {
          if (msg?.snippet?.type !== 'textMessageEvent') continue;

          const publishedAt = msg?.snippet?.publishedAt;
          if (publishedAt && Date.parse(publishedAt) < BOT_START_MS) continue;

          await dispatch({
            msg,
            liveChatId,
            transport: createYoutubeTransport(liveChatId),
            platformMeta: {
              youtube: {
                channelId: runtime.youtubeChannelId || account.youtube?.channelId || null,
              },
            },
            accountId: account.id,
            accountSettings: settings,
            account,
            accountRuntime: runtime,
          });
        }

        runtime.nextPageToken = res.data.nextPageToken || runtime.nextPageToken;
        saveAccountRuntime(accountId, runtime);
        const delay =
          res.data.pollingIntervalMillis ??
          (Number.isFinite(+POLLING_FALLBACK_MS) ? +POLLING_FALLBACK_MS : 2000);
        setTimeout(() => pollLoop(accountId, liveChatId), delay);
      } catch (err) {
        if (isLiveChatStale(err)) {
          resetYoutubeTransport(accountId, account);
          return;
        }
        logger.error('Polling error:', err?.errors?.[0] || err.message || err);
        setTimeout(() => pollLoop(accountId, liveChatId), 5000);
      }
    }

    async function startAccountBot(account, { autoPoll }) {
      const modeLabel = autoPoll ? 'PROD' : 'DEV';
      const accountLabel = account?.id ? `(${account.id})` : '(unknown)';
      if (!account?.youtube?.channelId) {
        logger.warn(
          `${modeLabel}: Youtube - ${accountLabel} skipping connection: no Youtube channel ID.`
        );
        return;
      }

      const settings = loadAccountSettings(account.id);
      if (settings.youtube?.enabled === false) {
        logger.info(
          `${modeLabel}: Youtube - ${accountLabel} skipping connection: Youtube transport disabled.`
        );
        return;
      }

      const runtime = loadAccountRuntime(account.id);
      if (!autoPoll && runtime.liveChatId && runtime.primed) {
        logger.info(
          `${modeLabel}: Youtube - ${accountLabel} reusing cached liveChatId (${runtime.liveChatId})`
        );
        return;
      }

      const { liveChatId, method, channelId, targetInfo } = await resolveTargetLiveChatId(
        {},
        {
          channelId: account.youtube.channelId,
          livestreamUrl: '',
          videoId: '',
        }
      );

      const token = await primeChat(liveChatId);
      runtime.liveChatId = liveChatId;
      runtime.nextPageToken = token;
      runtime.primed = true;
      runtime.youtubeChannelId = channelId || account.youtube.channelId || null;
      runtime.resolvedMethod = method || null;
      runtime.targetInfo = targetInfo || {};
      saveAccountRuntime(account.id, runtime);

      const methodLabel = String(method || 'unknown method')
        .replace(/\s*\(.*?\)\s*/g, '')
        .trim();
      const videoId = targetInfo?.videoId || 'unknown';
      if (autoPoll) {
        logger.info(
          `${modeLabel}: Youtube - ${accountLabel} connected (${videoId}) via ${methodLabel}`
        );
        pollLoop(account.id, liveChatId);
      } else {
        logger.info(
          `${modeLabel}: Youtube - ${accountLabel} connected (${videoId}) via ${methodLabel}`
        );
      }
    }

    // Start in PROD (DEV returns early to use the /accounts panel)
    async function startBot() {
      try {
        const accounts = listAccounts();
        if (!accounts.length) {
          logger.warn('No accounts configured. Add one at /accounts.');
          return;
        }

        for (const account of accounts) {
          try {
            const autoPoll = MODE !== 'dev';
            const settings = loadAccountSettings(account.id);
            const modeLabel = autoPoll ? 'PROD' : 'DEV';
            const accountLabel = account?.id ? `(${account.id})` : '(unknown)';
            const discordRouting =
              settings.discord?.enabled === false ? 'routing disabled' : 'routing enabled';
            logger.info(`${modeLabel}: Discord - ${accountLabel} ${discordRouting}`);
            await startAccountBot(account, { autoPoll });
          } catch (err) {
            logger.error('Failed to start account ' + account.name + ': ' + (err?.message || err));
          }
        }
      } catch (err) {
        logger.error(err.message || err);
        process.exit(1);
      }
    }
  } catch (err) {
    logger.error(
      `Fatal bootstrap error in index.js: ${err.stack || err.message || err}`
    );
    process.exit(1);
  }
})();
