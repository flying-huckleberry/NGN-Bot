// src/config/env.js
require('dotenv').config();

const path = require('path');

const MODE = (process.env.MODE || 'prod').toLowerCase();
const PORT = Number(process.env.PORT || 3000);

// project root (assumes you run `node` from repo root)
const ROOT_DIR = process.cwd();

// persist files in project root (same behavior as your current code)
const TOKEN_PATH = path.join(ROOT_DIR, 'token.json');
const DEV_STATE_PATH = path.join(ROOT_DIR, 'dev_state.json');

// destructured env (matches your current usage)
const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  TARGET_CHANNEL_ID,
  TARGET_TITLE_MATCH = '',
  TARGET_LIVESTREAM_URL,
  OPENAI_API_KEY,
  CHAT_MAX_CHARS = 190,
  OWNER_CHANNEL_ID,
  COMMAND_PREFIX = '!',
  POLLING_FALLBACK_MS = '10000',
} = process.env;

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// validate critical oauth vars early
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  console.error('Missing Google OAuth env vars. Check .env.example.');
  process.exit(1);
}

// character budget (same logic you have)
const MAX_CHARS = Number.isFinite(parseInt(CHAT_MAX_CHARS, 10))
  ? parseInt(CHAT_MAX_CHARS, 10)
  : 190;

// bot start timestamps (used for filtering old messages)
const BOT_START_ISO = new Date().toISOString();
const BOT_START_MS = new Date(BOT_START_ISO).getTime();

// youtube scopes
const SCOPES = ['https://www.googleapis.com/auth/youtube'];

module.exports = {
  // runtime
  MODE,
  PORT,
  ROOT_DIR,

  // paths
  TOKEN_PATH,
  DEV_STATE_PATH,

  // oauth/youtube
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  SCOPES,

  // targeting
  TARGET_CHANNEL_ID,
  TARGET_TITLE_MATCH,
  TARGET_LIVESTREAM_URL,

  // chat/owner
  OWNER_CHANNEL_ID,
  COMMAND_PREFIX,
  POLLING_FALLBACK_MS,

  // openai
  OPENAI_API_KEY,
  OPENAI_MODEL,
  MAX_CHARS,

  // time
  BOT_START_ISO,
  BOT_START_MS,
};
