// src/routes/dev.js
// Dev panel + routes. Minimal API burn: reuses cached state and only calls
// getLiveChatIdFromUrl when we don't already have liveChatId.

const express = require('express');
const {
  TARGET_LIVESTREAM_URL,
} = require('../config/env');

const {
  getLiveChatIdFromUrl,
  primeChat,
} = require('../services/youtube');

const {
  loadDevState,
  saveDevState,
  resetDevState,
  devStateExists,
} = require('../state/devState');

const g = require('../state/g');

function renderDev(status = {}) {
  const s = JSON.stringify(status, null, 2);
  const exists = devStateExists();
  return `
    <!doctype html>
    <meta charset="utf-8" />
    <title>YT Bot Dev Panel</title>
    <style>
      body { font: 14px/1.4 system-ui, sans-serif; padding: 20px; max-width: 820px; }
      .row { display:flex; gap:8px; margin: 0 0 12px; flex-wrap: wrap; }
      button { padding: 8px 12px; }
      pre { background:#111; color:#0f0; padding:12px; border-radius:6px; overflow:auto; }
      .state-status { margin-bottom:12px; }
      .exists { color:#0f0; }
      .missing { color:#f55; }
    </style>
    <h1>YT Bot — Dev Panel</h1>
    <p>Mode: <b>DEV</b> — manual control to conserve quota.</p>

    <div class="state-status">
      State file:
      <span class="${exists ? 'exists' : 'missing'}">
        ${exists ? '✅ Present' : '❌ Missing'}
      </span>
    </div>

    <div class="row">
      <form action="/dev/connect" method="post"><button>1) Connect</button></form>
      <form action="/dev/prime"   method="post"><button disabled>2) Prime (optional)</button></form>
      <form action="/dev/poll"    method="post"><button>3) Poll once</button></form>
      <form action="/dev/whoami"  method="post"><button>Who am I?</button></form>
      <form action="/dev/reset"   method="post"
            onsubmit="return confirm('Delete dev_state.json and clear memory?')">
        <button style="background:#300;color:#fff;border:1px solid #a66">Reset state</button>
      </form>
    </div>

    <pre>${s}</pre>`;
}

/**
 * Mount dev routes onto an existing Express app.
 * @param {import('express').Express} app
 * @param {object} options  { pollOnce, commands }
 */
function registerDevRoutes(app, { pollOnce, commands }) {
  app.use(express.urlencoded({ extended: true }));

  // Load state early so UI reflects cache immediately
  loadDevState(g);

  app.get('/dev', (req, res) => {
    res.send(renderDev({
      liveChatId: g.liveChatId,
      nextPageToken: g.nextPageToken,
      primed: g.primed,
      stateFile: devStateExists() ? 'present' : 'missing',
    }));
  });

  app.post('/dev/connect', async (req, res) => {
    try {
      if (!TARGET_LIVESTREAM_URL) {
        return res.send(renderDev({ error: 'Set TARGET_LIVESTREAM_URL in .env for DEV.' }));
      }

      const hasPrimedProp = Object.prototype.hasOwnProperty.call(g, 'primed');

      // Full cached state? Reuse with zero API calls.
      if (g.liveChatId && g.nextPageToken && hasPrimedProp) {
        return res.send(renderDev({
          ok: true,
          reused: true,
          liveChatId: g.liveChatId,
          nextPageToken: g.nextPageToken,
          primed: g.primed,
        }));
      }

      // Otherwise resolve chat id once (cheap); keep cached token/primed if present
      const liveChatId = g.liveChatId || (await getLiveChatIdFromUrl(TARGET_LIVESTREAM_URL));
      g.liveChatId = liveChatId;

      res.send(renderDev({
        ok: true,
        reused: Boolean(g.nextPageToken && hasPrimedProp),
        liveChatId: g.liveChatId,
        nextPageToken: g.nextPageToken || null,
        primed: hasPrimedProp ? g.primed : null,
      }));
    } catch (e) {
      res.send(renderDev({ error: e.message || String(e) }));
    }
    saveDevState(g);
  });

  app.post('/dev/prime', async (req, res) => {
    if (!g.liveChatId) return res.send(renderDev({ error: 'Not connected.' }));
    try {
      const token = await primeChat(g.liveChatId);
      g.primed = true;
      g.nextPageToken = token;
      saveDevState(g);
      res.send(renderDev({ primed: g.primed, token, liveChatId: g.liveChatId }));
    } catch (e) {
      res.send(renderDev({ error: e.message || String(e) }));
    }
  });

  app.post('/dev/poll', async (req, res) => {
    if (!g.liveChatId) return res.send(renderDev({ error: 'Not connected.' }));
    try {
      const r = await pollOnce(g.liveChatId, commands);
      res.send(renderDev({
        lastPoll: r,
        primed: g.primed,
        liveChatId: g.liveChatId,
        nextPageToken: g.nextPageToken,
      }));
    } catch (e) {
      res.send(renderDev({ error: e.message || String(e) }));
    }
  });

  app.post('/dev/whoami', async (req, res) => {
    res.send(renderDev({
      botAuthChannelId: 'unknown (derive as needed)',
      liveChatId: g.liveChatId,
      nextPageToken: g.nextPageToken,
      primed: g.primed,
    }));
  });

  app.post('/dev/reset', async (req, res) => {
    resetDevState(g);
    res.send(renderDev({
      reset: true,
      liveChatId: g.liveChatId,
      nextPageToken: g.nextPageToken,
      primed: g.primed,
    }));
  });
}

module.exports = { registerDevRoutes };
