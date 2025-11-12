// src/index.js
require('dotenv').config();

//make sure app is running in correct context
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('./config/env');
const px = path.join(ROOT_DIR, 'package.json');
if (!fs.existsSync(px)) {
  console.error(`❌ Startup error: expected to find package.json in ROOT_DIR (${ROOT_DIR})`);
  console.error('Please run this script from the project root directory.');
  process.exit(1);
}


const express = require('express');
const open = (...args) => import('open').then((m) => m.default(...args));

const {
  MODE,
  PORT,
  TARGET_LIVESTREAM_URL,
  TARGET_CHANNEL_ID,
  TARGET_TITLE_MATCH,
  POLLING_FALLBACK_MS, // used in logs only here
} = require('./config/env');

const {
  initYoutubeAuthIfTokenExists,
  getLiveChatIdFromUrl,
  getLiveChatIdForVideo,
  getLiveChatIdForChannel,
  primeChat,
} = require('./services/youtube');

const { mountAuthRoutes } = require('./server/auth');
const { registerDevRoutes } = require('./routes/dev');
const { pollOnce, pollChat } = require('./core/polling');

const commands = require('./commands');
const g = require('./state/g');

(async () => {
  const app = express();

  // OAuth routes (save tokens, then startBot)
  mountAuthRoutes(app, { onAuthed: startBot });

  // Dev panel routes (manual connect/prime/poll; zero extra API if cache present)
  registerDevRoutes(app, { pollOnce, commands });

  const server = app.listen(PORT, async () => {
    console.success(`HTTP server on http://localhost:${PORT}`);

    // if we already have tokens, skip opening /auth
    if (!initYoutubeAuthIfTokenExists()) {
      await open(`http://localhost:${PORT}/auth`);
    } else {
      await startBot();
    }
  });

  async function startBot() {
    try {
      if (MODE === 'dev') {
        console.info('✅ Running in DEV mode - opening GUI for manual connect & polling');
        return;
      }

      let liveChatId = null;

      if (TARGET_LIVESTREAM_URL) {
        liveChatId = await getLiveChatIdFromUrl(TARGET_LIVESTREAM_URL);
      } else if (process.env.TARGET_VIDEO_ID) {
        liveChatId = await getLiveChatIdForVideo(process.env.TARGET_VIDEO_ID);
      } else if (TARGET_CHANNEL_ID) {
        liveChatId = await getLiveChatIdForChannel(
          TARGET_CHANNEL_ID,
          (TARGET_TITLE_MATCH || '').trim()
        );
      } else {
        throw new Error(
          'Set one of TARGET_LIVESTREAM_URL, TARGET_VIDEO_ID, or TARGET_CHANNEL_ID in .env'
        );
      }

      const token = await primeChat(liveChatId);
      g.liveChatId = liveChatId;
      g.nextPageToken = token;
      g.primed = true;

      const interval = Number(POLLING_FALLBACK_MS || 10000);
      console.info(`✅ PROD: Connected. Listening roughly every ${interval}ms…`);
      pollChat(liveChatId, commands, token);
    } catch (err) {
      console.error(err.message || err);
      process.exit(1);
    }
  }
})();
