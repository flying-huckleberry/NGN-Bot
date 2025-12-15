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

// ----------------- helpers -----------------

function wantsJson(req) {
  return req.headers.accept?.includes('application/json');
}

// ----------------- renderDev -----------------

function renderDevContent(status = {}) {
  const {
    liveChatId = null,
    primed = false,
    error = null,
    message = null,
    resolvedMethod = null,
    targetInfo = {},
    quota = null, // { dailyLimit, used, remaining, percentUsed, lastResetPst }
    stateFile = null, // 'present' | 'missing' | null (from route)
    lastPoll = null, // { received, handled } if provided
    botAuthChannelId = null,
    youtubeChannelId = null,
    discordStatus = null,
  } = status;

  const exists =
    stateFile === 'present'
      ? true
      : stateFile === 'missing'
      ? false
      : devStateExists();

  const prettyStatus = JSON.stringify(status, null, 2);
  const isConnected = !!liveChatId;

  const lastPollHtml = lastPoll
    ? `
        <div style="line-height:1.6; font-size:0.9rem;">
          <strong>Last Poll:</strong> Received: <strong>${lastPoll.received}</strong>; Handled: <strong>${lastPoll.handled}</strong>
        </div>
      `
    : '';

  const youtubeCard = `
    <div style="flex:1; min-width:280px; background:#0b1224; color:#e5e7eb; padding:16px; border-radius:12px; border:1px solid #1f2937; box-shadow:0 8px 24px rgba(0,0,0,0.25);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="margin:0; color:#cbd5e1;">YouTube Transport</h3>
        <span style="font-size:0.85rem; color:${primed ? '#22c55e' : '#f87171'};">
          ${primed ? 'Primed' : 'Not primed'}
        </span>
      </div>
      <div style="line-height:1.6; font-size:0.9rem; color:#d1d5db;">
        <div><strong>Target Method:</strong> ${
          resolvedMethod
            ? `<span style="color:#60a5fa">${resolvedMethod}</span>`
            : `<span style="color:#94a3b8">Not connected</span>`
        }</div>
        <div><strong>LiveChat ID:</strong> ${
          liveChatId
            ? `<span style="color:#22c55e;overflow-wrap:anywhere">${liveChatId}</span>`
            : `<span style="color:#94a3b8">None</span>`
        }</div>
        ${
          youtubeChannelId
            ? `<div><strong>YT Channel ID:</strong> <span style="color:#22c55e">${youtubeChannelId}</span></div>`
            : ''
        }
        ${
          botAuthChannelId
            ? `<div><strong>Bot Channel ID:</strong> <code>${botAuthChannelId}</code></div>`
            : ''
        }
      </div>
      <div style="margin-top:12px; font-size:0.85rem; color:#94a3b8;">
        ${targetInfo.url ? `<div>URL: ${targetInfo.url}</div>` : ''}
        ${targetInfo.videoId ? `<div>Video ID: ${targetInfo.videoId}</div>` : ''}
        ${targetInfo.channelId ? `<div>Channel ID: ${targetInfo.channelId}</div>` : ''}
        ${targetInfo.titleMatch ? `<div>Title Match: "${targetInfo.titleMatch}"</div>` : ''}
      </div>
      ${
        error
          ? `<p style="color:#f87171; margin-top:10px; font-weight:600;"><strong>Error:</strong> ${error}</p>`
          : ''
      }
      ${
        message
          ? `<p style="color:#22c55e; margin-top:10px; font-weight:600;"><strong>${message}</strong></p>`
          : ''
      }
      ${lastPollHtml}
    </div>
  `;

  const discordState = discordStatus?.state || (discordStatus?.enabled ? 'offline' : 'disabled');
  const discordConnected = discordState === 'ready';
  const discordStatusHtml = `
    <div style="flex:1; min-width:280px; background:#0b1224; color:#e5e7eb; padding:16px; border-radius:12px; border:1px solid #1f2937; box-shadow:0 8px 24px rgba(0,0,0,0.25);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h3 style="margin:0; color:#cbd5e1;">Discord Transport</h3>
        <span style="font-size:0.85rem; color:${discordConnected ? '#22c55e' : '#fbbf24'};">
          ${discordConnected ? 'Connected' : discordState}
        </span>
      </div>
      <div style="font-size:0.9rem; line-height:1.6; color:#d1d5db;">
        <div><strong>Status:</strong> ${
          discordConnected
            ? '<span style="color:#22c55e;">Ready</span>'
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
            ? `<div style="color:#b91c1c;"><strong>Last error:</strong> ${discordStatus.lastError}</div>`
            : ''
        }
      </div>
    </div>
  `;

  const quotaHtml = quota
    ? `
      <div style="background:#0b1224; padding:16px; border-radius:12px; margin-bottom:16px; border:1px solid #1f2937; box-shadow:0 8px 24px rgba(0,0,0,0.25);">
        <h3 style="margin-top:0;">YouTube Quota (Est.)</h3>
        <p style="font-size:0.9rem; color:#d1d5db;">
          Used: <strong>${quota.used}</strong> / ${quota.dailyLimit} units
          (${quota.percentUsed}%)
        </p>

        <div style="
          position:relative;
          width:100%;
          height:12px;
          border-radius:999px;
          background:#111827;
          overflow:hidden;
          margin:10px 0 6px;
          border:1px solid #1f2937;
        ">
          <div style="
            width:${quota.percentUsed}%;
            height:100%;
            background:linear-gradient(90deg, #22c55e, #16a34a);
            transition:width 0.2s ease-out;
          "></div>
        </div>

        <p style="font-size:0.8rem; color:#9ca3af; margin:0;">
          Resets at midnight Pacific. Last reset: ${quota.lastResetPst || 'unknown'} (PT)
        </p>
      </div>
    `
    : '';

  const inner = `
    <div id="dev-root">
      <h2>YT Bot - Dev Panel</h2>
      <p>Mode: <b style="color:#93c5fd">DEV</b> - manual control to conserve quota.</p>

      <div class="state-status" style="margin:12px 0;">
        State file:
        <span style="color:${exists ? '#6ee7b7' : '#f87171'};">
          ${exists ? '&#9989; Present' : '&#10060; Missing'}
        </span>
      </div>

      <div class="row" style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
        <form action="/dev/connect" method="post" data-dev-action>
          <button style="background:#374D81; color:#fff; border:1px solid #4663A5; padding:8px 12px; border-radius:8px; cursor:pointer;">Connect</button>
        </form>

        <form action="/dev/poll" method="post" data-dev-action>
          <button ${isConnected ? '' : 'disabled title="Connect first"'} style="background:#374D81; color:#fff; border:1px solid #4663A5; padding:8px 12px; border-radius:8px; cursor:pointer;">Poll once</button>
        </form>

        <form action="/dev/reset" method="post" data-dev-action data-confirm="Delete dev_state.json and clear memory?">
          <button style="background:#d9534f; color:#fff; border:1px solid #d43f3a; padding:8px 12px; border-radius:8px; cursor:pointer;">
            Reset state
          </button>
        </form>
      </div>

      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
        <form action="/dev/connect" method="post" data-dev-action style="flex:1; min-width:260px; background:#0b1224; padding:12px; border-radius:10px; border:1px solid #1f2937;">
          <label style="display:block; font-size:0.9rem; margin-bottom:6px; color:#cbd5e1;">Connect via Livestream URL</label>
          <div style="display:flex; gap:8px;">
            <input name="targetLivestreamUrl" type="url" placeholder="https://www.youtube.com/watch?v=..." style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#e5e7eb;" />
            <button type="submit" style="background:#374D81; color:#fff; border:1px solid #4663A5; padding:8px 12px; border-radius:8px; cursor:pointer;">Send</button>
          </div>
        </form>

        <form action="/dev/connect" method="post" data-dev-action style="flex:1; min-width:260px; background:#0b1224; padding:12px; border-radius:10px; border:1px solid #1f2937;">
          <label style="display:block; font-size:0.9rem; margin-bottom:6px; color:#cbd5e1;">Connect via Channel ID</label>
          <div style="display:flex; gap:8px;">
            <input name="targetChannelId" type="text" placeholder="UCxxxxxxxxxxxx" style="flex:1; padding:8px 10px; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#e5e7eb;" />
            <button type="submit" style="background:#374D81; color:#fff; border:1px solid #4663A5; padding:8px 12px; border-radius:8px; cursor:pointer;">Send</button>
          </div>
        </form>
      </div>

      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px;">
        ${youtubeCard}
        ${discordStatusHtml}
      </div>

      ${quotaHtml}

      <h3>Raw Status</h3>
      <pre>${prettyStatus}</pre>
    </div>
    <script>
      (function () {
        const attachDevHandlers = () => {
          const root = document.getElementById('dev-root');
          if (!root) return;

          const setLoading = (isLoading) => {
            root.querySelectorAll('button').forEach((btn) => {
              const alreadyDisabled = btn.dataset.originalDisabled === 'true';
              if (isLoading) {
                btn.dataset.originalDisabled = btn.hasAttribute('disabled') ? 'true' : 'false';
                btn.disabled = true;
                if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
                btn.textContent = 'Working...';
              } else {
                if (!alreadyDisabled) btn.disabled = false;
                if (btn.dataset.originalText) {
                  btn.textContent = btn.dataset.originalText;
                  delete btn.dataset.originalText;
                }
              }
            });
          };

          root.querySelectorAll('form[data-dev-action]').forEach((form) => {
            form.addEventListener(
              'submit',
              async (event) => {
                event.preventDefault();
                const confirmMsg = form.dataset.confirm;
                if (confirmMsg && !window.confirm(confirmMsg)) return;

                const formData = new FormData(form);
                const body = new URLSearchParams();
                formData.forEach((value, key) => {
                  body.append(key, value);
                });

                setLoading(true);
                try {
                  const res = await fetch(form.action, {
                    method: 'POST',
                    headers: {
                      Accept: 'application/json',
                      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                    },
                    body,
                  });
                  if (!res.ok) throw new Error('Request failed: ' + res.status);
                  const data = await res.json();
                  if (data?.html) {
                    const placeholder = document.createElement('div');
                    placeholder.innerHTML = data.html;
                    const nextRoot = placeholder.querySelector('#dev-root');
                    if (nextRoot && root.parentNode) {
                      root.parentNode.replaceChild(nextRoot, root);
                      attachDevHandlers();
                    }
                  }
                } catch (err) {
                  console.error(err);
                  window.alert(err.message || 'Request failed');
                } finally {
                  setLoading(false);
                }
              },
              { once: true }
            );
          });
        };

        attachDevHandlers();
      })();
    </script>
  `;

  return inner;
}

function renderDev(status = {}) {
  return renderLayout({
    title: 'Dev Panel',
    active: 'dev',
    content: renderDevContent(status),
  });
}

// ----------------- registerDevRoutes -----------------

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

  const respondDev = (req, res, payload = {}) => {
    const body = withDiscordStatus(payload);
    if (wantsJson(req)) {
      return res.json({ html: renderDevContent(body) });
    }
    return res.send(renderDev(body));
  };

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

  // Optional: /dev '+' redirect to "/"
  app.get('/dev', (req, res) => {
    res.redirect('/');
  });

  // Connect + prime via resolveTargetLiveChatId
  app.post('/dev/connect', async (req, res) => {
    const targetLivestreamUrl = (req.body?.targetLivestreamUrl || '').trim();
    const targetChannelId = (req.body?.targetChannelId || '').trim();

    try {
      const { liveChatId, method, targetInfo, estimatedUnits, channelId } =
        await resolveTargetLiveChatId({
          livestreamUrl: targetLivestreamUrl,
          channelId: targetChannelId,
        });

      const token = await primeChat(liveChatId);
      g.liveChatId = liveChatId;
      g.nextPageToken = token;
      g.primed = true;
      g.youtubeChannelId = channelId || g.youtubeChannelId;
      saveDevState(g);

      const quota = addQuotaUsage(estimatedUnits);

      return respondDev(req, res, {
        liveChatId,
        primed: true,
        resolvedMethod: method,
        targetInfo,
        message: `Connected and primed successfully. ~${estimatedUnits} units.`,
        quota,
        stateFile: devStateExists() ? 'present' : 'missing',
      });
    } catch (err) {
      const quota = getQuotaInfo();
      return respondDev(req, res, {
        error: err.message || String(err),
        quota,
        stateFile: devStateExists() ? 'present' : 'missing',
      });
    }
  });

  // Optional manual re-prime route (rarely needed, but handy for debugging)
  app.post('/dev/prime', async (req, res) => {
    if (!g.liveChatId) {
      const quota = getQuotaInfo();
      return respondDev(req, res, {
        error: 'Not connected.',
        quota,
        stateFile: devStateExists() ? 'present' : 'missing',
      });
    }

    try {
      const token = await primeChat(g.liveChatId);
      g.primed = true;
      g.nextPageToken = token;
      saveDevState(g);

      const quota = getQuotaInfo(); // priming cost is already accounted at connect time

      return respondDev(req, res, {
        primed: g.primed,
        token,
        liveChatId: g.liveChatId,
        quota,
        message: 'Re-primed: starting fresh from current point in chat.',
        stateFile: devStateExists() ? 'present' : 'missing',
      });
    } catch (e) {
      const quota = getQuotaInfo();
      return respondDev(req, res, {
        error: e.message || String(e),
        quota,
        stateFile: devStateExists() ? 'present' : 'missing',
      });
    }
  });

  // Poll once using the provided pollOnce adapter from index.js
  app.post('/dev/poll', async (req, res) => {
    if (!g.liveChatId) {
      const quota = getQuotaInfo();
      return respondDev(req, res, {
        error: 'Not connected.',
        quota,
        stateFile: devStateExists() ? 'present' : 'missing',
      });
    }

    try {
      const result = await pollOnce(g.liveChatId);
      // liveChatMessages.list ~5 units
      const quota = addQuotaUsage(5);

      return respondDev(req, res, {
        liveChatId: g.liveChatId,
        primed: g.primed,
        lastPoll: {
          received: result.received,
          handled: result.handled,
        },
        quota,
        stateFile: devStateExists() ? 'present' : 'missing',
      });
    } catch (e) {
      const quota = getQuotaInfo();
      return respondDev(req, res, {
        error: e.message || String(e),
        quota,
        liveChatId: g.liveChatId,
        primed: g.primed,
        stateFile: devStateExists() ? 'present' : 'missing',
      });
    }
  });

  // Reset dev state
  app.post('/dev/reset', async (req, res) => {
    resetDevState(g);

    const quota = getQuotaInfo();
    return respondDev(req, res, {
      reset: true,
      liveChatId: g.liveChatId,
      nextPageToken: g.nextPageToken,
      primed: g.primed,
      quota,
      stateFile: devStateExists() ? 'present' : 'missing',
      message: 'Dev state reset.',
    });
  });
}

module.exports = { registerDevRoutes };
