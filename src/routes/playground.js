// src/routes/playground.js
const env = require('../config/env');
const { renderLayout } = require('../server/layout');
const { runCommandText, getLog, clearLog, getPlayers } = require('../playground/core');

function registerPlaygroundRoutes(app) {
  // Simple server-rendered HTML (you can reuse your current template)
  app.get('/sandbox', (req, res) => {
  const players = getPlayers();
  const log = getLog();
  res.send(
    renderPlaygroundPage({
      input: '',
      outputs: [],
      selectedPlayerId: players[0]?.id,
      log,
      players,
    })
  );
});


  app.post('/sandbox/run', async (req, res) => {
    const input = String(req.body.input || '').trim();
    const players = getPlayers();
    const selectedPlayerId = req.body.playerId || players[0]?.id;
    const player = players.find((p) => p.id === selectedPlayerId) || players[0];

    if (!input) {
      return res.send(
        renderPlaygroundPage({
          input: '',
          outputs: ['(no input)'],
          selectedPlayerId,
          log: getLog(),
          players,
        })
      );
    }

    try {
      const outputs = await runCommandText(input, player);
      const finalOutputs = outputs.length
        ? outputs
        : ['(no replies — maybe not a recognized command?)'];

      res.send(
        renderPlaygroundPage({
          input: '',
          outputs: finalOutputs,
          selectedPlayerId,
          log: getLog(),
          players,
        })
      );
    } catch (err) {
      res.send(
        renderPlaygroundPage({
          input,
          outputs: ['Error while running command. Check server logs.'],
          selectedPlayerId,
          log: getLog(),
          players,
        })
      );
    }
  });

  app.post('/sandbox/clear-log', (req, res) => {
    clearLog();
    const players = getPlayers();
    const selectedPlayerId = players[0]?.id;
    res.send(
      renderPlaygroundPage({
        input: '',
        outputs: ['(log cleared)'],
        selectedPlayerId,
        log: getLog(),
        players,
      })
    );
  });
}

function renderPlaygroundPage({ input, outputs, selectedPlayerId, log, players }) {
  const safeInput = String(input || '').replace(/</g, '&lt;');

  const effectivePlayers = Array.isArray(players) ? players : [];
  const defaultPlayerId = effectivePlayers[0]?.id || '';
  const effectiveSelectedId = selectedPlayerId || defaultPlayerId;

  const playersHtml = effectivePlayers
    .map((p) => {
      const checked = p.id === effectiveSelectedId ? 'checked' : '';
      const label = `${p.displayName}${p.isChatOwner ? ' (owner)' : ''}`;
      return `<label>
        <input type="radio" name="playerId" value="${p.id}" ${checked} />
        ${label}
      </label>`;
    })
    .join('<br />');

  const logArray = Array.isArray(log) ? log : [];
  const logHtml =
    logArray.length > 0
      ? `<h3>Global Log</h3>
        <form method="POST" action="/sandbox/clear-log" style="margin-bottom:8px;">
          <button type="submit">Clear log</button>
        </form>
        ${
          logArray
            .slice()
            .reverse()
            .map((o) => `<div class="out">${String(o).replace(/</g, '&lt;')}</div>`)
            .join('')
        }`
      : '';

  const outputsArray = Array.isArray(outputs) ? outputs : [];
  const outputsHtml =
    outputsArray.length > 0
      ? `<h3>Replies from last command</h3>${outputsArray
          .map((o) => `<div class="out">${String(o).replace(/</g, '&lt;')}</div>`)
          .join('')}`
      : '';

  const commandPrefix = env.COMMAND_PREFIX || '!';

  const inner = `
    <h2>Command Sandbox</h2>
    <p>Type a command as if you were in YouTube chat (e.g. <code>${commandPrefix}league joke</code> or <code>${commandPrefix}race</code>).</p>

    <form method="POST" action="/sandbox/run">
      <input
        type="text"
        name="input"
        value="${safeInput}"
        autofocus
        autocomplete="off"
        onkeydown="if (event.key === 'Enter') { event.preventDefault(); this.form.submit(); }"
        style="width:100%; font-family:monospace; padding:8px; font-size:14px; margin-bottom:8px;"
      />
      <fieldset style="margin-top:8px; padding:8px 12px;">
        <legend>Send as player</legend>
        ${playersHtml}
      </fieldset>
      <button type="submit" style="margin-top:8px;">Run</button>
      <div class="hint" style="color:#9ca3af; font-size:0.9em; margin-top:4px;">
        Commands use prefix <code>${commandPrefix}</code>
      </div>
    </form>

    <div style="margin-top:24px;">
      ${outputsHtml}
    </div>

    <div style="margin-top:24px;">
      ${logHtml}
    </div>

    <style>
      .out {
        margin-top: 8px;
        padding: 8px;
        background: #020617;
        color: #a7f3d0;
        white-space: pre-wrap;
        border-radius: 4px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 0.9rem;
      }
    </style>
  `;

  return renderLayout({
    title: 'Command Sandbox',
    active: 'sandbox',
    content: inner,
  });
}



module.exports = { registerPlaygroundRoutes };
