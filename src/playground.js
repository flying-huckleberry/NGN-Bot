// src/playground.js
require('dotenv').config();

const express = require('express');
const path = require('path');

const env = require('./config/env');
const { loadModules } = require('./core/loader');
const { createRouter } = require('./core/router');
const league = require('./services/league'); // so ctx.services.league works

// Simple logger; swap to your logger util if you want
const logger = console;

// Use a different port than the main bot to avoid conflicts
const PLAYGROUND_PORT = process.env.PLAYGROUND_PORT || 4000;

(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // 1) Load modules & build registry
  const modulesDir = path.join(__dirname, 'modules');
  const registry = loadModules(modulesDir);

  // 2) Build a context factory for the playground
  function buildContextFactoryForPlayground(replies) {
    return async function buildContext({ msg, liveChatId, args }) {
      return {
        env,
        services: {
          registry,
          league,
          // you can add more services here if needed, e.g. youtube: null
        },
        state: {}, // no global g-state needed here
        logger,
        msg,
        liveChatId,
        args,
        reply: async (text) => {
          replies.push(String(text ?? ''));
        },
      };
    };
  }

  // 3) Create router using a playground-specific context factory
  const dispatch = createRouter({
    registry,
    buildContext: (...args) => {
      throw new Error(
        'buildContext should be provided per-request via buildContextFactoryForPlayground'
      );
    },
  });

  // we’ll wrap dispatch so we can inject a fresh buildContext per request
  async function runCommandText(rawText) {
    const replies = [];

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
        displayName: 'PlaygroundUser',
        channelId: 'PLAYGROUND',
        isChatOwner: true, // so ownerOnly commands will work if you test them
      },
    };

    const playgroundBuildContext = buildContextFactoryForPlayground(replies);

    const requestScopedDispatch = createRouter({
      registry,
      buildContext: playgroundBuildContext,
    });

    await requestScopedDispatch({ msg: fakeMsg, liveChatId: 'PLAYGROUND' });

    return replies;
  }

  // 4) Simple HTML UI (NOW USING <input> + Enter-to-submit)
  const htmlPage = (input = '', outputs = []) => {
    const safeInput = input.replace(/</g, '&lt;');
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Command Playground</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 800px; margin: 20px auto; padding: 0 16px; }
      input[type="text"] { width: 100%; font-family: monospace; padding: 8px; font-size: 14px; box-sizing: border-box; }
      button { padding: 8px 16px; margin-top: 8px; }
      .out { margin-top: 16px; padding: 8px; background: #111; color: #0f0; white-space: pre-wrap; border-radius: 4px; }
      .hint { color: #666; font-size: 0.9em; margin-top: 4px; }
    </style>
  </head>
  <body>
    <h1>Command Playground</h1>
    <p>Type a command as if you were in YouTube chat (e.g. <code>!league joke</code>).</p>
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
      <button type="submit">Run</button>
      <div class="hint">Remember: commands still use your prefix (<code>${env.COMMAND_PREFIX}</code>).</div>
    </form>

    ${
      outputs.length
        ? `<h2>Replies</h2>${outputs
            .map((o) => `<div class="out">${o.replace(/</g, '&lt;')}</div>`)
            .join('')}`
        : ''
    }
  </body>
</html>`;
  };

  // GET: show empty form
  app.get('/', (req, res) => {
    res.send(htmlPage('', []));
  });

  // POST: run the text through the command router
  app.post('/', async (req, res) => {
    const input = (req.body.input || '').trim();
    if (!input) {
      return res.send(htmlPage('', ['(no input)']));
    }

    try {
      const replies = await runCommandText(input);
      const outputs =
        replies.length > 0 ? replies : ['(no replies — maybe not a recognized command?)'];
      res.send(htmlPage('', outputs));

    } catch (err) {
      logger.error('Playground error:', err);
      res.send(htmlPage(input, ['Error while running command. Check server logs.']));
    }
  });

  app.listen(PLAYGROUND_PORT, () => {
    logger.info(`Playground running at http://localhost:${PLAYGROUND_PORT}`);
  });
})();
