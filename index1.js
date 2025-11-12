// index.js
require('dotenv').config();

const MODE = (process.env.MODE || 'prod').toLowerCase();

const DEV_STATE_PATH = path.join(__dirname, 'dev_state.json');

let g = {
  liveChatId: null,
  nextPageToken: null,
  primed: false,
};

const fs = require('fs');
const path = require('path');
const express = require('express');
const { google } = require('googleapis');
const open = (...args) => import('open').then(m => m.default(...args));
const OpenAI = require("openai");

/* ─────────────────────────── ENV ─────────────────────────── */
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  PORT = 3000,
  TARGET_CHANNEL_ID,
  TARGET_TITLE_MATCH = '',
  TARGET_LIVESTREAM_URL,
  OPENAI_API_KEY,
  CHAT_MAX_CHARS,
  OWNER_CHANNEL_ID,
  COMMAND_PREFIX = '!',
  POLLING_FALLBACK_MS = '2000',
} = process.env;

const MAX_CHARS = Number.isFinite(parseInt(process.env.CHAT_MAX_CHARS, 10))
  ? parseInt(process.env.CHAT_MAX_CHARS, 10)
  : 190;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  console.error('Missing Google OAuth env vars. Check .env.example.');
  process.exit(1);
}


const TOKEN_PATH = path.join(__dirname, 'token.json'); // credentials for the BOT account

// mark when this bot instance started
const BOT_START_ISO = new Date().toISOString();

/* ─────────────────────── Google Auth / API ─────────────────────── */
const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI
);
const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

/**
 * Scopes:
 *  - youtube.readonly → read chat only (no posting)
 *  - youtube (recommended) → required to send chat messages
 * Request ONLY ONE write scope to keep consent screen simpler.
 */
const SCOPES = ['https://www.googleapis.com/auth/youtube'];

/**
 * OPENAI FUN TIME
 */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ─────────────────────── ASK GPT HELPER FN ─────────────────────── */
async function askGPT(prompt) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // or "gpt-4o" if your API account has it
      messages: [
        { role: "system", content: "You are a friendly chatbot in a YouTube live chat." },
        { role: "user", content: prompt },
      ],
      max_tokens: 80, // short replies so chat doesn’t flood
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    console.error("OpenAI error:", err);
    return "Sorry, I couldn't reach the AI service right now.";
  }
}

/**
 * Ask OpenAI for a reply that fits into a single YouTube chat message.
 * Strategy:
 *  - Instruct a strict character budget
 *  - Use small max_tokens
 *  - Final guard-truncate to MAX_CHARS
 */
async function askGPTBounded(prompt, maxChars = MAX_CHARS) {
  // Rough token budget: ~4 chars/token → add a little margin
  const targetTokens = Math.max(16, Math.min(100, Math.floor(maxChars / 4)));

  const system = [
    "You are a helpful YouTube live-chat bot.",
    `You MUST keep the ENTIRE reply ≤ ${maxChars} characters.`,
    "Be concise. Prefer short sentences. No preambles. No disclaimers.",
    "Only the answer; no code fences or formatting.",
  ].join(" ");

  const user = [
    `HARD LIMIT: ≤ ${maxChars} characters total.`,
    "If content seems long, compress aggressively: remove filler, use simple words.",
    "Avoid emoji unless necessary; keep it short.",
    "",
    `Question: ${prompt}`
  ].join("\n");

  try {
    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: targetTokens,   // backstop
      temperature: 0.5,
    });

    let reply = (completion.choices[0]?.message?.content || "").trim();

    // Final safety: hard cap to single-message length
    if (reply.length > maxChars) reply = reply.slice(0, maxChars - 1) + "…";
    return reply;
  } catch (err) {
    console.error("OpenAI error:", err);
    return "Sorry, I couldn't reach the AI service.";
  }
}



/* ───────────────────────── Auth Flow ───────────────────────── */
async function ensureAuth() {
  // Reuse saved tokens if present
  if (fs.existsSync(TOKEN_PATH)) {
    const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oauth2Client.setCredentials(tokens);
    return;
  }

  // Minimal local server to complete OAuth
  const app = express();

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
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      res.send('Auth successful. You can close this tab and return to the terminal.');
      console.log('✅ Saved tokens to token.json (BOT identity).');
      server.close();
      startBot();
    } catch (err) {
      console.error('OAuth error:', err);
      res.status(500).send('OAuth error');
    }
  });

  if (MODE === 'dev') {
    function devHtml(status) {
        const s = JSON.stringify(status || {}, null, 2);
        return `
        <!doctype html>
        <meta charset="utf-8" />
        <title>YT Bot Dev Panel</title>
        <style>
        body { font: 14px/1.4 system-ui, sans-serif; padding: 20px; max-width: 780px; }
        button { padding: 8px 12px; margin-right: 8px; }
        pre { background:#111; color:#0f0; padding:12px; border-radius:6px; overflow:auto; }
        </style>
        <h1>YT Bot — Dev Panel</h1>
        <p>Mode: <b>DEV</b> — manual control to conserve quota.</p>
        <form action="/dev/connect" method="post"><button>1) Connect</button></form>
        <form action="/dev/prime"   method="post"><button disabled>2) Prime (handled in Poll Once)</button></form>
        <form action="/dev/poll"    method="post"><button>3) Poll once</button></form>
        <form action="/dev/whoami"  method="post"><button>Who am I?</button></form>
        <pre>${s}</pre>`;
    }

    function ensureDev(app) {
        app.use(express.urlencoded({ extended: true }));
        app.get('/dev', (req, res) => res.send(devHtml({ liveChatId: g.liveChatId, primed: g.primed })));

        app.post('/dev/connect', async (req, res) => {
            try {
                let liveChatId = null;

                if (process.env.TARGET_LIVESTREAM_URL) {
                liveChatId = await getLiveChatIdFromUrl(process.env.TARGET_LIVESTREAM_URL);
                } else if (process.env.TARGET_VIDEO_ID) {
                liveChatId = await getLiveChatIdForVideo(process.env.TARGET_VIDEO_ID);
                } else if (process.env.TARGET_CHANNEL_ID) {
                liveChatId = await getLiveChatIdForChannel(
                    process.env.TARGET_CHANNEL_ID,
                    (process.env.TARGET_TITLE_MATCH || '').trim()
                );
                } else {
                return res.send(devHtml({ error: 'Set one of TARGET_LIVESTREAM_URL, TARGET_VIDEO_ID, or TARGET_CHANNEL_ID in .env' }));
                }

                g.liveChatId = liveChatId;
                g.nextPageToken = null;
                g.primed = false;
                res.send(devHtml({ ok: true, liveChatId }));
            } catch (e) {
                res.send(devHtml({ error: e.message || String(e) }));
            }
            saveDevState();
        });


        app.post('/dev/prime', async (req, res) => {
            if (!g.liveChatId) return res.send(devHtml({ error: 'Not connected.' }));
            try {
                const r = await primeChat(g.liveChatId);
                res.send(devHtml({ primed: g.primed, ...r }));
            } catch (e) {
                res.send(devHtml({ error: e.message || String(e) }));
            }
        });

        app.post('/dev/poll', async (req, res) => {
            if (!g.liveChatId) return res.send(devHtml({ error: 'Not connected.' }));
            try {
                const r = await pollOnce(g.liveChatId);
                res.send(devHtml({ lastPoll: r, primed: g.primed, liveChatId: g.liveChatId }));
            } catch (e) {
                res.send(devHtml({ error: e.message || String(e) }));
            }
        });

        app.post('/dev/whoami', async (req, res) => {
            res.send(devHtml({
                botAuthChannelId: 'unknown (derive as needed)',
                liveChatId: g.liveChatId,
                primed: g.primed
            }));
        });
    }

    ensureDev(app); // add dev routes to the same express app
    console.log(`Dev panel: http://localhost:${PORT}/dev`);

  }

  const server = app.listen(PORT, async () => {
    console.log(`Auth server on http://localhost:${PORT}`);
    await open(`http://localhost:${PORT}/auth`);
  });


  // keep process alive until server closes
  await new Promise(() => {});
}

/* ─────────────────── Live Chat Discovery (Target) ─────────────────── */
/**
 * Find the active live video on TARGET_CHANNEL_ID and return its liveChatId.
 * We do NOT rely on "mine: true" — this can be any channel (e.g., your main).
 */
async function getLiveChatIdForChannel(channelId, titleSubstring) {
  // 1) find an active live video on the channel
  const searchRes = await youtube.search.list({
    part: ['id', 'snippet'],
    channelId,
    eventType: 'live',   // live now (not upcoming)
    type: ['video'],
    maxResults: 5,
    order: 'date',
  });

  const items = searchRes.data.items || [];
  if (!items.length) {
    throw new Error('No active live stream found on the target channel.');
  }

  // Optionally pick by title substring if provided
  let candidate = items[0];
  if (titleSubstring) {
    const lower = titleSubstring.toLowerCase();
    candidate =
      items.find(i => (i.snippet?.title || '').toLowerCase().includes(lower)) || candidate;
  }

  const videoId = candidate?.id?.videoId;
  const title = candidate?.snippet?.title;
  if (!videoId) {
    throw new Error('Found a live item but could not resolve video ID.');
  }

  // 2) get the liveChatId from liveStreamingDetails
  const videosRes = await youtube.videos.list({
    part: ['liveStreamingDetails'],
    id: [videoId],
  });
  const liveChatId = videosRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;

  if (!liveChatId) {
    throw new Error('Live video found but no active chat (chat disabled or members-only).');
  }

  console.log(`🎬 Monitoring live: "${title}" (${videoId})`);
  return liveChatId;
}

async function getLiveChatIdForVideo(videoId) {
  const res = await youtube.videos.list({
    part: ['liveStreamingDetails'],
    id: [videoId],
  });
  const liveChatId = res.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId) throw new Error('Video found but not currently live or chat disabled.');
  return liveChatId;
}


/* ─────────────────── Live Chat Discovery (Target) ─────────────────── */
/**
 * Find the active live video by url and return its liveChatId.
 */
async function getLiveChatIdFromUrl(url) {
  const match = url.match(/[?&]v=([^&]+)/);
  if (!match) throw new Error('Invalid YouTube URL');
  const videoId = match[1];

  const res = await youtube.videos.list({
    part: ['liveStreamingDetails'],
    id: [videoId],
  });

  const liveChatId = res.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
  if (!liveChatId)
    throw new Error('Video found but not currently live or chat disabled.');
  return liveChatId;
}


/** Do an initial fetch to get the forward token, but DO NOT process messages */
async function primeChat(liveChatId) {
  const res = await youtube.liveChatMessages.list({
    liveChatId,
    part: ['snippet'],
    maxResults: 200,
  });
  const token = res.data.nextPageToken || null;
  console.log('⏭️  Primed chat: skipping past messages, starting fresh.');
  return token;
}



/* ─────────────────────── Chat Send / Poll ─────────────────────── */
async function sendChatMessage(liveChatId, text) {
  await youtube.liveChatMessages.insert({
    part: ['snippet'],
    requestBody: {
      snippet: {
        liveChatId,
        type: 'textMessageEvent',
        textMessageDetails: { messageText: text },
      },
    },
  });
}

const commands = {
  hello: async ({ liveChatId, msg }) => {
    await sendChatMessage(liveChatId, 'Hello, world!');
    console.log(`↩︎ !hello from ${msg.authorDetails?.displayName}`);
  },

  // Unified !ask command
  ask: async ({ liveChatId, args }) => {
    const question = args.join(' ').trim();
    if (!question) {
      await sendChatMessage(liveChatId, 'Usage: !ask <your question>');
      return;
    }

    // Optional: comment this out to avoid double sends
    // await sendChatMessage(liveChatId, '🤔 Thinking...');

    let reply = await askGPTBounded(question, MAX_CHARS);

    // one more tiny guard: normalize whitespace again and clamp hard (no ellipsis)
    reply = reply.replace(/\s+/g, " ").trim();
    const cps = [...reply];
    if (cps.length > MAX_CHARS) reply = cps.slice(0, MAX_CHARS).join("");
    if (!reply) reply = "NO REPLY FROM AI!";

    await sendChatMessage(liveChatId, reply);
    console.log(`🧠 !ask (${ASK_MODE}) → ${reply}`);
  },
};


/**
 * Check if user is allowed to use a command
 * First check if its the actual channel owner
 * Then check if its the channelID set in .env OWNER_CHANNEL_ID
 */
function isOwner(msg) {
  // Prefer YouTube's flags; fallback to channelId match if provided
  if (msg?.authorDetails?.isChatOwner) return true;
  if (OWNER_CHANNEL_ID && msg?.authorDetails?.channelId === OWNER_CHANNEL_ID) return true;
  return false;
}

function parseCommand(text, prefix) {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith(prefix)) return null;
  const [name, ...args] = trimmed.slice(prefix.length).split(/\s+/);
  return { name: name.toLowerCase(), args };
}

// Poll once: process new commands exactly once; return summary
async function pollOnce(liveChatId) {
  const res = await youtube.liveChatMessages.list({
    liveChatId,
    part: ['snippet', 'authorDetails'],
    pageToken: g.nextPageToken || undefined,
    maxResults: 200,
  });

  const items = res.data.items || [];
  let handled = 0;

  for (const msg of items) {
    if (msg?.snippet?.type !== 'textMessageEvent') continue;

    // 🆕 ignore anything from before this bot instance started
    const publishedAt = msg?.snippet?.publishedAt;
    if (publishedAt && publishedAt < BOT_START_ISO) continue;

    const text = msg?.snippet?.textMessageDetails?.messageText || '';
    const cmd = parseCommand(text, COMMAND_PREFIX);
    if (cmd && commands[cmd.name]) {
      try {
        await commands[cmd.name]({ liveChatId, msg, args: cmd.args });
        handled++;
      } catch (e) {
        console.error('Command error:', e);
      }
    }
  }

  g.nextPageToken = res.data.nextPageToken || g.nextPageToken;
  saveDevState();

  return {
    ok: true,
    received: items.length,
    handled,
    nextDelaySuggestedMs: res.data.pollingIntervalMillis ?? Number(POLLING_FALLBACK_MS || 10000),
  };
}

async function pollChat(liveChatId, pageToken) {
  try {
    const res = await youtube.liveChatMessages.list({
      liveChatId,
      part: ['snippet', 'authorDetails'],
      pageToken,
      maxResults: 200,
    });

    const items = res.data.items || [];
    for (const msg of items) {
      if (msg?.snippet?.type !== 'textMessageEvent') continue;

      // Skip anything published before this bot instance started
      const publishedAt = msg?.snippet?.publishedAt;
      if (publishedAt && publishedAt < BOT_START_ISO) continue;

      const text = msg?.snippet?.textMessageDetails?.messageText || '';
      const cmd = parseCommand(text, COMMAND_PREFIX);
      if (cmd && commands[cmd.name]) {
        try {
          await commands[cmd.name]({ liveChatId, msg, args: cmd.args });
        } catch (e) {
          console.error('Command error:', e);
        }
      }
    }

    const nextPageToken = res.data.nextPageToken;
    const delay =
      res.data.pollingIntervalMillis ??
      (Number.isFinite(+POLLING_FALLBACK_MS) ? +POLLING_FALLBACK_MS : 2000);

    setTimeout(() => pollChat(liveChatId, nextPageToken), delay);
  } catch (err) {
    console.error('Polling error:', err?.errors?.[0] || err.message || err);
    setTimeout(() => pollChat(liveChatId, pageToken), 5000);
  }
}

function loadDevState() {
  try {
    const s = JSON.parse(fs.readFileSync(DEV_STATE_PATH, 'utf8'));
    if (s?.liveChatId) g.liveChatId = s.liveChatId;
    if (s?.nextPageToken) g.nextPageToken = s.nextPageToken;
    if (typeof s?.primed === 'boolean') g.primed = s.primed;
  } catch {}
}

function saveDevState() {
  try {
    fs.writeFileSync(DEV_STATE_PATH, JSON.stringify({
      liveChatId: g.liveChatId,
      nextPageToken: g.nextPageToken,
      primed: g.primed
    }, null, 2));
  } catch {}
}


/* ─────────────────────────── Start ─────────────────────────── */
async function startBot() {
  try {
    if (MODE === 'dev') {
      console.log('DEV mode: open the Dev Panel → Connect → Prime → Poll Once');
      return;
    }

    let liveChatId = null;

    if (process.env.TARGET_LIVESTREAM_URL) {
      liveChatId = await getLiveChatIdFromUrl(process.env.TARGET_LIVESTREAM_URL);
    } else if (process.env.TARGET_VIDEO_ID) {
      liveChatId = await getLiveChatIdForVideo(process.env.TARGET_VIDEO_ID);
    } else if (process.env.TARGET_CHANNEL_ID) {
      liveChatId = await getLiveChatIdForChannel(
        process.env.TARGET_CHANNEL_ID,
        (process.env.TARGET_TITLE_MATCH || '').trim()
      );
    } else {
      throw new Error('Set one of TARGET_LIVESTREAM_URL, TARGET_VIDEO_ID, or TARGET_CHANNEL_ID in .env');
    }

    const initialToken = await primeChat(liveChatId);
    g.liveChatId = liveChatId;
    g.nextPageToken = initialToken;
    g.primed = true;

    const interval = Number(process.env.POLLING_FALLBACK_MS || 8000);
    console.log(`✅ PROD: Connected. Listening roughly every ${interval}ms…`);
    pollChat(liveChatId, initialToken);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}


(async () => {
  await ensureAuth(); // if token exists, continues immediately; otherwise starts OAuth and calls startBot after
  if (MODE === 'dev') {
    loadDevState();
  }
  if (oauth2Client.credentials?.access_token || oauth2Client.credentials?.refresh_token) {
    await startBot();
  }
})();
