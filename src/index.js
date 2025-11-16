// src/index.js
require('dotenv').config();

// ── startup sanity: ensure we're launched from project root ─────────
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
      `❌ Failed to load ${label} from ${modulePath}: ${err.stack || err.message || err}`
    );
    throw err;
  }
}

const rootPkg = path.join(ROOT_DIR, 'package.json');
if (!fs.existsSync(rootPkg)) {
  logger.error(`❌ Startup error: expected to find package.json in ROOT_DIR (${ROOT_DIR})`);
  logger.error('Please run this script from the project root directory.');
  process.exit(1);
}

// ── deps ─────────────────────────────────────────────────────────────
const express = require('express');
const open = (...args) => import('open').then((m) => m.default(...args));

// Services
const {
  youtube,
  initYoutubeAuthIfTokenExists,
  primeChat,
} = safeRequire('YouTube service', './services/youtube');

const { resolveTargetLiveChatId } = safeRequire(
  'Live chat target resolver',
  './services/liveChatTarget'
);

const league = safeRequire('League service', './services/league');

// HTTP / routes
const { mountAuthRoutes } = safeRequire('Auth routes', './server/auth');
const { registerDevRoutes } = safeRequire('Dev routes', './routes/dev');
const { registerPlaygroundRoutes } = safeRequire(
  'Playground routes',
  './routes/playground'
);

// Core
const { createRouter } = safeRequire('Router core', './core/router');
const { loadModules } = safeRequire('Module loader', './core/loader');
const { buildContextFactory } = safeRequire('Context factory', './core/context');

// Global state
const g = safeRequire('Global state g', './state/g');

// ── app bootstrap ───────────────────────────────────────────────────
(async () => {
  try {
    const app = express();

    // 1) Load all command modules and build the dispatcher
    const modulesDir = path.join(__dirname, 'modules');
    const registry = loadModules(modulesDir);

    const buildContext = buildContextFactory({
      youtube,
      registry, // so help can enumerate modules/commands
      league,
    });

    const dispatch = createRouter({ registry, buildContext });

    // 2) OAuth routes (save tokens, then startBot)
    mountAuthRoutes(app, { onAuthed: startBot });

    // 3) Dev panel routes
    registerDevRoutes(app, {
      pollOnce: (liveChatId) => pollOnceWithDispatch(liveChatId, dispatch),
      commands: {},
    });

    // 4) Playground routes
    registerPlaygroundRoutes(app);

    // 5) Start HTTP server and proceed based on token presence
    app.listen(PORT, async () => {
      logger.info(`HTTP server on http://localhost:${PORT}`);

      if (!initYoutubeAuthIfTokenExists()) {
        await open(`http://localhost:${PORT}/auth`);
      } else {
        await startBot();
      }
    });

    // ── helpers ───────────────────────────────────────────────────────

    // Poll exactly one page and dispatch each message through the module router.
    async function pollOnceWithDispatch(liveChatId, dispatchFn) {
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
        // If our saved page token went stale (e.g. long downtime), re-prime once to realign.
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

        // Ignore anything from before this bot instance started
        const publishedAt = msg?.snippet?.publishedAt;
        if (publishedAt && Date.parse(publishedAt) < BOT_START_MS) continue;

        await dispatchFn({ msg, liveChatId });
        handled++;
      }

      g.nextPageToken = res.data.nextPageToken || g.nextPageToken;

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
    async function pollLoop(liveChatId) {
      try {
        const res = await youtube.liveChatMessages.list({
          liveChatId,
          part: ['snippet', 'authorDetails'],
          pageToken: g.nextPageToken || undefined,
          maxResults: 200,
        });

        const items = res.data.items || [];
        for (const msg of items) {
          if (msg?.snippet?.type !== 'textMessageEvent') continue;

          const publishedAt = msg?.snippet?.publishedAt;
          if (publishedAt && Date.parse(publishedAt) < BOT_START_MS) continue;

          await dispatch({ msg, liveChatId });
        }

        g.nextPageToken = res.data.nextPageToken || g.nextPageToken;
        const delay =
          res.data.pollingIntervalMillis ??
          (Number.isFinite(+POLLING_FALLBACK_MS) ? +POLLING_FALLBACK_MS : 2000);
        setTimeout(() => pollLoop(liveChatId), delay);
      } catch (err) {
        logger.error('Polling error:', err?.errors?.[0] || err.message || err);
        setTimeout(() => pollLoop(liveChatId), 5000);
      }
    }

    // Start in PROD (DEV returns early to use the /dev panel)
    async function startBot() {
      try {
        if (MODE === 'dev') {
          logger.info('✅ Running in DEV mode — open / for manual connect & poll');
          return;
        }

        const { liveChatId, method } = await resolveTargetLiveChatId();

        const token = await primeChat(liveChatId);
        g.liveChatId = liveChatId;
        g.nextPageToken = token;
        g.primed = true;

        const interval = Number(POLLING_FALLBACK_MS || 10000);
        logger.info(
          `✅ PROD: Connected via ${method || 'unknown method'} — Listening roughly every ${interval}ms…`
        );

        pollLoop(liveChatId);
      } catch (err) {
        logger.error(err.message || err);
        process.exit(1);
      }
    }
  } catch (err) {
    logger.error(
      `❌ Fatal bootstrap error in index.js: ${err.stack || err.message || err}`
    );
    process.exit(1);
  }
})();
