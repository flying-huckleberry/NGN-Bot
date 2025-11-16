// src/playground.js
require('dotenv').config();

const express = require('express');
const path = require('path');

const env = require('./config/env');
const { loadModules } = require('./core/loader');
const { createRouter } = require('./core/router');
const league = require('./services/league'); // so ctx.services.league works

// Simple logger; swap to your logger util if you want
const { logger, getLogger } = require('./utils/logger');
const botLogger = getLogger('bot');


// Use a different port than the main bot to avoid conflicts
const PLAYGROUND_PORT = process.env.PLAYGROUND_PORT || 4000;

// Global in-memory log of all replies ever sent in this process
const PLAYGROUND_LOG = [];

// Helper to push into the global log with a soft cap
function pushLog(text) {
  const line = String(text ?? '');
  PLAYGROUND_LOG.push(line);
  // soft cap to avoid unbounded growth
  if (PLAYGROUND_LOG.length > 200) {
    PLAYGROUND_LOG.shift();
  }
}

// Fake YouTube-style players for testing
const PLAYGROUND_PLAYERS = [
  {
    id: 'UC_PLAYGROUND_OWNER',
    displayName: 'PlaygroundOwner',
    isChatOwner: true,
  },
  {
    id: 'UC_STREETKING',
    displayName: 'StreetKing',
    isChatOwner: false,
  },
  {
    id: 'UC_DRIFTQUEEN',
    displayName: 'DriftQueen',
    isChatOwner: false,
  },
  {
    id: 'UC_RAINRUNNER',
    displayName: 'RainRunner',
    isChatOwner: false,
  },
  {
    id: 'UC_ROADBLADE',
    displayName: 'RoadBlade',
    isChatOwner: false,
  },
];

(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // 1) Load modules & build registry
  const modulesDir = path.join(__dirname, 'modules');
  const registry = loadModules(modulesDir);

  // 2) Build a context factory for the playground
  // 2) Build a context factory for the playground
  function buildContextFactoryForPlayground() {
    return async function buildContext({ msg, liveChatId, args }) {
      const author = msg && msg.authorDetails ? msg.authorDetails : null;

      const authorName = author?.displayName || 'unknown';

      // Extract the raw chat text from the fake YouTube message
      const rawText =
        msg?.snippet?.textMessageDetails?.messageText ||
        msg?.snippet?.displayMessage ||
        '';

      // crude command name: first token, strip leading "!"
      const firstToken = rawText.trim().split(/\s+/)[0] || '';
      const commandName = firstToken.startsWith('!')
        ? firstToken.slice(1)
        : firstToken;

      const ctx = {
        env,
        services: {
          registry,
          league,
          // you can add more services here if needed
        },
        state: {}, // no global g-state needed here
        logger,     // app logger
        botLogger,  // bot logger
        msg,
        liveChatId,
        args,
        author,
        user: author,    // optional alias if modules ever expect ctx.user
        authorName,
        commandName,
      };

      // Wrap reply: log command.response, then push into playground log
      ctx.reply = async (text, meta = {}) => {
        const reply = String(text ?? '');

        try {
          botLogger.info('command.response', {
            command: ctx.commandName,
            user: ctx.authorName,
            reply,
            ...meta,
          });
        } catch (err) {
          // don't let logging failures break playground
        }

        pushLog(reply);
      };

      return ctx;
    };
  }


  // 3) Wrap dispatch so we can inject a fresh buildContext per request and a chosen player
  async function runCommandText(rawText, player) {
    const before = PLAYGROUND_LOG.length;
    const repliesFromThisCommand = [];

    const effectivePlayer = player || PLAYGROUND_PLAYERS[0];

    // Fake YouTube-style message object (router expects msg.snippet.textMessageDetails.messageText)
    const fakeMsg = {
      snippet: {
        type: 'textMessageEvent',
        textMessageDetails: {
          messageText: rawText,
        },
        publishedAt: new Date().toISOString(),
      },
      authorDetails: {
        displayName: effectivePlayer.displayName,
        channelId: effectivePlayer.id,
        isChatOwner: !!effectivePlayer.isChatOwner,
        // you can add isChatModerator, isChatSponsor, etc. if needed
      },
    };

    const playgroundBuildContext = buildContextFactoryForPlayground();

    const requestScopedDispatch = createRouter({
      registry,
      buildContext: playgroundBuildContext,
    });

    // Run the command: immediate replies go into PLAYGROUND_LOG via ctx.reply
    await requestScopedDispatch({ msg: fakeMsg, liveChatId: 'PLAYGROUND' });

    // Anything appended to the log during this command is considered this command's replies
    const after = PLAYGROUND_LOG.length;
    if (after > before) {
      for (let i = before; i < after; i++) {
        repliesFromThisCommand.push(PLAYGROUND_LOG[i]);
      }
    }

    return repliesFromThisCommand;
  }

  // 4) Simple HTML UI with player radio selection + global log display
  const htmlPage = (
    input = '',
    outputs = [],
    selectedPlayerId = PLAYGROUND_PLAYERS[0].id
  ) => {
    const safeInput = input.replace(/</g, '&lt;');

    const playersHtml = PLAYGROUND_PLAYERS
      .map((p) => {
        const checked = p.id === selectedPlayerId ? 'checked' : '';
        return `<label>
          <input type="radio" name="playerId" value="${p.id}" ${checked} />
          ${p.displayName} ${p.isChatOwner ? '(owner)' : ''}
        </label>`;
      })
      .join('<br />');

    const logHtml =
      PLAYGROUND_LOG.length > 0
        ? `<h2>Global Log</h2>
          <form method="POST" action="/clear-log" style="margin-bottom:8px;">
            <button type="submit">Clear log</button>
          </form>
          ${
            PLAYGROUND_LOG.slice().reverse() // newest first
              .map((o) => `<div class="out">${o.replace(/</g, '&lt;')}</div>`)
              .join('')
          }`
        : '';


    const outputsHtml =
      outputs.length > 0
        ? `<h2>Replies from last command</h2>${outputs
            .map((o) => `<div class="out">${o.replace(/</g, '&lt;')}</div>`)
            .join('')}`
        : '';

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Command Playground</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 800px; margin: 20px auto; padding: 0 16px; }
      input[type="text"] { width: 100%; font-family: monospace; padding: 8px; font-size: 14px; box-sizing: border-box; }
      button { padding: 8px 16px; margin-top: 8px; }
      .out { margin-top: 8px; padding: 8px; background: #111; color: #0f0; white-space: pre-wrap; border-radius: 4px; }
      .hint { color: #666; font-size: 0.9em; margin-top: 4px; }
      fieldset { margin-top: 16px; padding: 8px 12px; }
      legend { font-weight: bold; }
      h2 { margin-top: 24px; }
    </style>
  </head>
  <body>
    <h1>Command Playground</h1>
    <p>Type a command as if you were in YouTube chat (e.g. <code>!league joke</code> or <code>!race</code>).</p>
    <form method="POST" action="/">
      <input
        type="text"
        name="input"
        value="${safeInput}"
        autofocus
        autocomplete="off"
        onkeydown="if (event.key === 'Enter') { event.preventDefault(); this.form.submit(); }"
      />
      <br />
      <fieldset>
        <legend>Send as player</legend>
        ${playersHtml}
      </fieldset>
      <button type="submit">Run</button>
      <div class="hint">Remember: commands still use your prefix (<code>${env.COMMAND_PREFIX}</code>).</div>
    </form>

    ${outputsHtml}
    ${logHtml}
  </body>
</html>`;
  };

  // GET: show form + full log
  app.get('/', (req, res) => {
    res.send(htmlPage('', [], PLAYGROUND_PLAYERS[0].id));
  });

  // POST: run the text through the command router
  app.post('/', async (req, res) => {
    const input = (req.body.input || '').trim();
    const selectedPlayerId = req.body.playerId || PLAYGROUND_PLAYERS[0].id;
    const player =
      PLAYGROUND_PLAYERS.find((p) => p.id === selectedPlayerId) ||
      PLAYGROUND_PLAYERS[0];

    if (!input) {
      return res.send(htmlPage('', ['(no input)'], selectedPlayerId));
    }

    try {
      const outputs = await runCommandText(input, player);
      const finalOutputs =
        outputs.length > 0 ? outputs : ['(no replies — maybe not a recognized command?)'];
      res.send(htmlPage('', finalOutputs, selectedPlayerId));
    } catch (err) {
      logger.error('Playground error:', err);
      res.send(
        htmlPage(input, ['Error while running command. Check server logs.'], selectedPlayerId)
      );
    }
  });

  app.post('/clear-log', (req, res) => {
    PLAYGROUND_LOG.length = 0;
    res.send(htmlPage('', ['(log cleared)'], PLAYGROUND_PLAYERS[0].id));
  });


  app.listen(PLAYGROUND_PORT, () => {
    logger.info(`Playground running at http://localhost:${PLAYGROUND_PORT}`);
  });
})();
