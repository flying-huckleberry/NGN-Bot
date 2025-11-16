// src/routes/dev.js
// Dev panel + routes. Minimal API burn: reuses cached state and only calls
// getLiveChatIdFromUrl when we don't already have liveChatId.

const { renderLayout } = require('../server/layout');
const express = require('express');
const {
  TARGET_LIVESTREAM_URL,
} = require('../config/env');

const { resolveTargetLiveChatId } = require('../services/liveChatTarget');
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
  const exists = devStateExists();

  const {
    liveChatId = null,
    primed = false,
    error = null,
    message = null,
    resolvedMethod = null,
    targetInfo = {},
  } = status;

  const prettyStatus = JSON.stringify(status, null, 2);

  const isConnected = !!liveChatId;

  const connectionInfoHtml = `
    <div style="background:#1f2937; padding:16px; border-radius:8px; margin-bottom:16px;">
      <h3 style="margin-top:0;">Connection Info</h3>
      <div style="line-height:1.6; font-size:0.9rem;">
        <div><strong>Target Method:</strong> ${
          resolvedMethod
            ? `<span style="color:#93c5fd">${resolvedMethod}</span>`
            : `<span style="color:#9ca3af">Not connected</span>`
        }</div>
        <div><strong>Resolved LiveChat ID:</strong> ${
          liveChatId
            ? `<span style="color:#6ee7b7">${liveChatId}</span>`
            : `<span style="color:#9ca3af">None</span>`
        }</div>
        <div><strong>Primed:</strong> ${
          primed
            ? '<span style="color:#6ee7b7">Yes</span>'
            : '<span style="color:#fda4af">No</span>'
        }</div>
      </div>
      <div style="margin-top:12px; font-size:0.85rem; color:#9ca3af;">
        ${targetInfo.url ? `<div>URL: ${targetInfo.url}</div>` : ''}
        ${targetInfo.videoId ? `<div>Video ID: ${targetInfo.videoId}</div>` : ''}
        ${targetInfo.channelId ? `<div>Channel ID: ${targetInfo.channelId}</div>` : ''}
        ${targetInfo.titleMatch ? `<div>Title Match: "${targetInfo.titleMatch}"</div>` : ''}
      </div>
      ${
        error
          ? `<p style="color:#f87171; margin-top:10px;"><strong>Error:</strong> ${error}</p>`
          : ''
      }
      ${
        message
          ? `<p style="color:#86efac; margin-top:10px;"><strong>${message}</strong></p>`
          : ''
      }
    </div>
  `;

  const inner = `
    <h2>YT Bot — Dev Panel</h2>
    <p>Mode: <b style="color:#93c5fd">DEV</b> — manual control to conserve quota.</p>

    <div class="state-status" style="margin:12px 0;">
      State file:
      <span style="color:${exists ? '#6ee7b7' : '#f87171'};">
        ${exists ? '✅ Present' : '❌ Missing'}
      </span>
    </div>

    ${connectionInfoHtml}

    <div class="row" style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
      <form action="/dev/connect" method="post">
        <button>1) Connect</button>
      </form>

      <form action="/dev/prime" method="post">
        <button ${isConnected ? '' : 'disabled title="Connect first"'}>Re-prime</button>
      </form>

      <form action="/dev/poll" method="post">
        <button ${isConnected ? '' : 'disabled title="Connect first"'}>Poll once</button>
      </form>

      <form action="/dev/whoami" method="post">
        <button>Who am I?</button>
      </form>

      <form action="/dev/reset" method="post"
            onsubmit="return confirm('Delete dev_state.json and clear memory?')">
        <button style="background:#300; color:#fff; border:1px solid #a66;">
          Reset state
        </button>
      </form>
    </div>

    <h3>Raw Status</h3>
    <pre>${prettyStatus}</pre>
  `;

  return renderLayout({
    title: 'Dev Panel',
    active: 'dev',
    content: inner,
  });
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

  app.get('/', (req, res) => {
    res.send(renderDev({
      liveChatId: g.liveChatId,
      nextPageToken: g.nextPageToken,
      primed: g.primed,
      stateFile: devStateExists() ? 'present' : 'missing',
    }));
  });

  app.post('/dev/connect', async (req, res) => {
    try {
      const liveChatId = await resolveTargetLiveChatId();

      const token = await primeChat(liveChatId);
      g.liveChatId = liveChatId;
      g.nextPageToken = token;
      g.primed = true;

      return res.send(
        renderDev({
          liveChatId,
          primed: true,
          message: 'Connected and primed successfully.',
        })
      );
    } catch (err) {
      return res.send(
        renderDev({
          error: err.message || String(err),
        })
      );
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
