// src/routes/dev.js
// Dev panel + routes. Minimal API burn: reuses cached state and only calls
// target resolution / YouTube API when needed.

const express = require('express');
const { renderLayout } = require('../server/layout');

const {
  loadDevState,
  saveDevState,
  resetDevState,
  devStateExists,
} = require('../state/devState');

const { getQuotaInfo, addQuotaUsage } = require('../state/quota');
const { resolveTargetLiveChatId } = require('../services/liveChatTarget');
const { primeChat } = require('../services/youtube');
const g = require('../state/g');

// ───────────────── renderDev ─────────────────

function renderDev(status = {}) {
  const {
    liveChatId = null,
    primed = false,
    error = null,
    message = null,
    resolvedMethod = null,
    targetInfo = {},
    quota = null,          // { dailyLimit, used, remaining, percentUsed, lastResetPst }
    stateFile = null,      // 'present' | 'missing' | null (from route)
    lastPoll = null,       // { received, handled } if provided
    botAuthChannelId = null,
    youtubeChannelId = null,
    discordStatus = null,
  } = status;

  // Fallback: if stateFile not passed, we can still do a direct check
  const exists =
    stateFile === 'present'
      ? true
      : stateFile === 'missing'
      ? false
      : devStateExists();

  const prettyStatus = JSON.stringify(status, null, 2);
  const isConnected = !!liveChatId;

  const quotaHtml = quota
    ? `
      <div style="background:#020617; padding:16px; border-radius:8px; margin-bottom:16px;">
        <h3 style="margin-top:0;">YouTube Quota (Est.)</h3>
        <p style="font-size:0.9rem; color:#d1d5db;">
          Used: <strong>${quota.used}</strong> / ${quota.dailyLimit} units
          (${quota.percentUsed}%)
        </p>

        <div style="
          position:relative;
          width:100%;
          height:10px;
          border-radius:999px;
          background:#111827;
          overflow:hidden;
          margin:8px 0 4px;
        ">
          <div style="
            width:${quota.percentUsed}%;
            height:100%;
            background:#22c55e;
            transition:width 0.2s ease-out;
          "></div>
        </div>

        <p style="font-size:0.8rem; color:#9ca3af; margin:0;">
          Resets at midnight Pacific. Last reset: ${quota.lastResetPst || 'unknown'} (PT)
        </p>
      </div>
    `
    : '';

  const lastPollHtml = lastPoll
    ? `
      <div style="background:#0f172a; padding:12px; border-radius:8px; margin-bottom:16px;">
        <h3 style="margin-top:0;">Last Poll</h3>
        <p style="font-size:0.9rem; color:#e5e7eb;">
          Received: <strong>${lastPoll.received}</strong>,
          Handled: <strong>${lastPoll.handled}</strong>
        </p>
      </div>
    `
    : '';

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
        ${
          youtubeChannelId
            ? `<div><strong>YT Channel ID:</strong> <code>${youtubeChannelId}</code></div>`
            : ''
        }
        <div><strong>Primed:</strong> ${
          primed
            ? '<span style="color:#6ee7b7">Yes</span>'
            : '<span style="color:#fda4af">No</span>'
        }</div>
        ${
          botAuthChannelId
            ? `<div><strong>Bot Channel ID:</strong> <code>${botAuthChannelId}</code></div>`
            : ''
        }
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

  const discordState = discordStatus?.state || (discordStatus?.enabled ? 'offline' : 'disabled');
  const discordConnected = discordState === 'ready';
  const discordStatusHtml = `
    <div style="background:#111827; padding:16px; border-radius:8px; margin-bottom:16px;">
      <h3 style="margin-top:0;">Discord Transport</h3>
      <div style="font-size:0.9rem; line-height:1.6;">
        <div><strong>Status:</strong> ${
          discordConnected
            ? '<span style="color:#6ee7b7;">Connected</span>'
            : `<span style="color:#fbbf24;">${discordState}</span>`
        }</div>
        ${
          discordStatus?.username
            ? `<div><strong>Bot:</strong> ${discordStatus.username}</div>`
            : ''
        }
        ${
          discordStatus?.readyAt
            ? `<div><strong>Ready at:</strong> ${discordStatus.readyAt}</div>`
            : ''
        }
        ${
          discordStatus?.lastError
            ? `<div style="color:#f87171;"><strong>Last error:</strong> ${discordStatus.lastError}</div>`
            : ''
        }
      </div>
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

    ${quotaHtml}
    ${connectionInfoHtml}
    ${discordStatusHtml}
    ${lastPollHtml}

    <div class="row" style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
      <form action="/dev/connect" method="post">
        <button>1) Connect</button>
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

// ───────────────── registerDevRoutes ─────────────────

/**
 * Mount dev routes onto an existing Express app.
 * @param {import('express').Express} app
 * @param {object} options  { pollOnce, commands }
 */
function registerDevRoutes(app, { pollOnce, commands, getDiscordStatus }) {
  app.use(express.urlencoded({ extended: true }));

  // Load state early so UI reflects cache immediately
  loadDevState(g);

  const withDiscordStatus = (payload = {}) => ({
    ...payload,
    youtubeChannelId: g.youtubeChannelId,
    discordStatus:
      typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
  });

  // Main dev panel at "/"
  app.get('/', (req, res) => {
    const quota = getQuotaInfo();
    res.send(
      renderDev(
        withDiscordStatus({
          quota,
          liveChatId: g.liveChatId,
          nextPageToken: g.nextPageToken,
          primed: g.primed,
          stateFile: devStateExists() ? 'present' : 'missing',
        })
      )
    );
  });

  // Optional: /dev → redirect to "/"
  app.get('/dev', (req, res) => {
    res.redirect('/');
  });

  // Connect + prime via resolveTargetLiveChatId
  app.post('/dev/connect', async (req, res) => {
    try {
      const { liveChatId, method, targetInfo, estimatedUnits, channelId } =
        await resolveTargetLiveChatId();

      const token = await primeChat(liveChatId);
      g.liveChatId = liveChatId;
      g.nextPageToken = token;
      g.primed = true;
      g.youtubeChannelId = channelId || g.youtubeChannelId;
      saveDevState(g);

      const quota = addQuotaUsage(estimatedUnits);

      return res.send(
        renderDev(
          withDiscordStatus({
            liveChatId,
            primed: true,
            resolvedMethod: method,
            targetInfo,
            message: `Connected and primed successfully. ~${estimatedUnits} units.`,
            quota,
            stateFile: devStateExists() ? 'present' : 'missing',
          })
        )
      );
    } catch (err) {
      const quota = getQuotaInfo();
      return res.send(
        renderDev(
          withDiscordStatus({
            error: err.message || String(err),
            quota,
            stateFile: devStateExists() ? 'present' : 'missing',
          })
        )
      );
    }
  });

  // Optional manual re-prime route (rarely needed, but handy for debugging)
  app.post('/dev/prime', async (req, res) => {
    if (!g.liveChatId) {
      const quota = getQuotaInfo();
      return res.send(
        renderDev(
          withDiscordStatus({
            error: 'Not connected.',
            quota,
            stateFile: devStateExists() ? 'present' : 'missing',
          })
        )
      );
    }

    try {
      const token = await primeChat(g.liveChatId);
      g.primed = true;
      g.nextPageToken = token;
      saveDevState(g);

      const quota = getQuotaInfo(); // priming cost is already accounted at connect time

      res.send(
        renderDev(
          withDiscordStatus({
            primed: g.primed,
            token,
            liveChatId: g.liveChatId,
            quota,
            message: 'Re-primed: starting fresh from current point in chat.',
            stateFile: devStateExists() ? 'present' : 'missing',
          })
        )
      );
    } catch (e) {
      const quota = getQuotaInfo();
      res.send(
        renderDev(
          withDiscordStatus({
            error: e.message || String(e),
            quota,
            stateFile: devStateExists() ? 'present' : 'missing',
          })
        )
      );
    }
  });

  // Poll once using the provided pollOnce adapter from index.js
  app.post('/dev/poll', async (req, res) => {
    if (!g.liveChatId) {
      const quota = getQuotaInfo();
      return res.send(
        renderDev(
          withDiscordStatus({
            error: 'Not connected.',
            quota,
            stateFile: devStateExists() ? 'present' : 'missing',
          })
        )
      );
    }

    try {
      const result = await pollOnce(g.liveChatId);
      // liveChatMessages.list ≈ 5 units
      const quota = addQuotaUsage(5);

      return res.send(
        renderDev(
          withDiscordStatus({
            liveChatId: g.liveChatId,
            primed: g.primed,
            lastPoll: {
              received: result.received,
              handled: result.handled,
            },
            quota,
            stateFile: devStateExists() ? 'present' : 'missing',
          })
        )
      );
    } catch (e) {
      const quota = getQuotaInfo();
      return res.send(
        renderDev(
          withDiscordStatus({
            error: e.message || String(e),
            quota,
            liveChatId: g.liveChatId,
            primed: g.primed,
            stateFile: devStateExists() ? 'present' : 'missing',
          })
        )
      );
    }
  });

  // WhoAmI — debug endpoint
  app.post('/dev/whoami', async (req, res) => {
    const quota = getQuotaInfo();
    res.send(
      renderDev(
        withDiscordStatus({
          botAuthChannelId: 'unknown (derive as needed)',
          liveChatId: g.liveChatId,
          nextPageToken: g.nextPageToken,
          primed: g.primed,
          quota,
          stateFile: devStateExists() ? 'present' : 'missing',
          message: 'WhoAmI: see Raw Status for current g/dev state.',
        })
      )
    );
  });

  // Reset dev state
  app.post('/dev/reset', async (req, res) => {
    resetDevState(g);

    const quota = getQuotaInfo();
    res.send(
      renderDev(
        withDiscordStatus({
          reset: true,
          liveChatId: g.liveChatId,
          nextPageToken: g.nextPageToken,
          primed: g.primed,
          quota,
          stateFile: devStateExists() ? 'present' : 'missing',
          message: 'Dev state reset.',
        })
      )
    );
  });
}

module.exports = { registerDevRoutes };
