// src/server/auth.js
// Mounts /auth and /oauth2callback on an existing Express app.
// Keeps your original behavior (save tokens, then call `onAuthed()`).

const { oauth2Client, saveOAuthTokens } = require('../services/youtube');
const { SCOPES } = require('../config/env');
const { logger } = require('../utils/logger');
const { renderLayout } = require('./layout');

function mountAuthRoutes(app, { onAuthed, log = logger.log } = {}) {
  app.get('/auth', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
    });

    const content = `
      <h2>Auth / Tokens</h2>
      <p>
        This bot uses a dedicated Google account for YouTube API access.
        Sign in below to grant the required scopes.
      </p>

      <p style="margin-top:16px;">
        <a href="${url}" style="
          display:inline-block;
          padding:8px 14px;
          border-radius:999px;
          background:#dc2626;
          color:#f9fafb;
          text-decoration:none;
          font-weight:500;
        ">
          Sign in with Google (BOT account)
        </a>
      </p>

      <p style="margin-top:12px; font-size:0.9rem; color:#9ca3af;">
        After completing the Google sign-in flow, you’ll be returned here and the bot
        will store tokens in <code>token.json</code>.
      </p>
    `;

    res.send(
      renderLayout({
        title: 'YT Auth',
        active: 'auth',
        content,
      })
    );
  });



  app.get('/oauth2callback', async (req, res) => {
    try {
      const { code } = req.query;
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      saveOAuthTokens(tokens);

      logger.info('✅ Saved tokens to token.json (BOT identity).');

      const content = `
        <h2>Auth successful</h2>
        <p>Your Google tokens have been saved. The bot can now talk to the YouTube API.</p>

        <p style="margin-top:16px; font-size:0.9rem; color:#9ca3af;">
          You can close this tab and return to the terminal, or go back to the
          <a href="/" style="color:#60a5fa; text-decoration:underline;">Dev Panel</a>.
        </p>
      `;

      res.send(
        renderLayout({
          title: 'Auth Successful!',
          active: 'auth',
          content,
        })
      );

      if (typeof onAuthed === 'function') {
        onAuthed();
      }
    } catch (err) {
      logger.error('OAuth error:', err);

      const content = `
        <h2>OAuth error</h2>
        <p>Something went wrong while exchanging the auth code for tokens.</p>
        <p style="margin-top:8px; font-size:0.9rem; color:#9ca3af;">
          Check the server logs for details, then try again from the
          <a href="/auth" style="color:#60a5fa; text-decoration:underline;">Auth page</a>.
        </p>
      `;

      res
        .status(500)
        .send(
          renderLayout({
            title: 'OAuth Error',
            active: 'auth',
            content,
          })
        );
    }
  });

}

module.exports = { mountAuthRoutes };
