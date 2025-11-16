// src/server/auth.js
// Mounts /auth and /oauth2callback on an existing Express app.
// Keeps your original behavior (save tokens, then call `onAuthed()`).

const { oauth2Client, saveOAuthTokens } = require('../services/youtube');
const { SCOPES } = require('../config/env');
const { logger } = require('../utils/logger'); 

function mountAuthRoutes(app, { onAuthed, log = logger.log } = {}) {
  app.get('/auth', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });
    res.send(
      `<h3>YouTube Bot Auth</h3><p><a href="${url}">Sign in with Google (BOT account)</a></p>`
    );
  });

  app.get('/oauth2callback', async (req, res) => {
    try {
      const { code } = req.query;
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      saveOAuthTokens(tokens);
      res.send('Auth successful. You can close this tab and return to the terminal.');
      logger.info('✅ Saved tokens to token.json (BOT identity).');
      if (typeof onAuthed === 'function') onAuthed();
    } catch (err) {
      // Keep message terse so it’s visible in browser
      res.status(500).send('OAuth error');
      logger.error('OAuth error:', err);
    }
  });
}

module.exports = { mountAuthRoutes };
