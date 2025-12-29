// src/config/env.js
const path = require("path");
const { logger } = require('../utils/logger'); 

const dotenvPath = path.join(__dirname, "..", "..", ".env");

const dotenvResult = require("dotenv").config({ path: dotenvPath });

if (dotenvResult.error) {
  logger.error("Failed to load .env:", dotenvResult.error);
} else {
  logger.info("Loaded .env from", dotenvPath);
}


const MODE = (process.env.MODE || 'prod').toLowerCase();
const PORT = Number(process.env.PORT || 3000);

// project root (assumes you run `node` from repo root)
const ROOT_DIR = process.cwd();

// persist files in project root (same behavior as your current code)
const TOKEN_PATH = path.join(ROOT_DIR, 'token.json');
const DEV_STATE_PATH = path.join(ROOT_DIR, 'dev_state.json');

// destructured env (matches your current usage)
function parseCsv(value, { defaultValue = [] } = {}) {
  if (!value) return [...defaultValue];
  return value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseCsv(value, { defaultValue = [] } = {}) {
  if (!value) return [...defaultValue];
  return value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseKeyValueList(value) {
  if (!value) return {};
  return value
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const [key, val] = pair.split(':').map((s) => s?.trim());
      if (key && val) acc[key] = val;
      return acc;
    }, {});
}

const {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  TARGET_CHANNEL_ID,
  TARGET_TITLE_MATCH = '',
  TARGET_LIVESTREAM_URL,
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini',
  CHAT_MAX_CHARS = 190,
  OWNER_CHANNEL_ID,
  COMMAND_PREFIX = '!',
  POLLING_FALLBACK_MS = '10000',
  APILEAGUE_API_KEY = '',
  RIDDLE_TIMEOUT = '120000',
  RACE_COOLDOWN_MS = '1000000',
  RACE_JOIN_WINDOW_MS = '120000',
  DISCORD_BOT_TOKEN = '',
  DISCORD_ALLOWED_GUILD_IDS = '',
  DISCORD_ALLOWED_CHANNEL_IDS = '',
  DISCORD_RACING_CHANNELS = '',
  DISABLED_MODULES = '',
  CRYPTO_ALLOWED_COINS = 'BTC,ETH,SOL,DOGE,LTC',
  CRYPTO_STARTING_CASH = '1000',
  COINGECKO_TTL_MS = '60000',
  SEMANTIC_TARGET_WORD = '',
  AUTO_ANNOUNCEMENTS_MAX = '5',
  CUSTOM_COMMANDS_MAX = '15',
  DISCORD_MAX_CHARS = '1990',
} = process.env;

// validate critical oauth vars early
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
  logger.error('Missing Google OAuth env vars. Check .env.example.');
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

  // time
  BOT_START_ISO,
  BOT_START_MS,

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

  // league api
  APILEAGUE_API_KEY,
  RIDDLE_TIMEOUT,

  // Racing Game
  RACE_COOLDOWN_MS,
  RACE_JOIN_WINDOW_MS,

  // Discord transport
  DISCORD_BOT_TOKEN,
  DISCORD_ALLOWED_GUILD_IDS: parseCsv(DISCORD_ALLOWED_GUILD_IDS),
  DISCORD_ALLOWED_CHANNEL_IDS: parseCsv(DISCORD_ALLOWED_CHANNEL_IDS),
  DISCORD_RACING_CHANNELS: parseKeyValueList(DISCORD_RACING_CHANNELS),

  // Modules
  DISABLED_MODULES: parseCsv(DISABLED_MODULES),

  // Crypto game
  CRYPTO_ALLOWED_COINS: parseCsv(CRYPTO_ALLOWED_COINS).map((c) => c.toUpperCase()),
  CRYPTO_STARTING_CASH: Number(CRYPTO_STARTING_CASH) || 1000,
  COINGECKO_TTL_MS: Number(COINGECKO_TTL_MS) || 0,

  // Semantic game
  SEMANTIC_TARGET_WORD: (SEMANTIC_TARGET_WORD || '').trim(),

  // Auto announcements
  AUTO_ANNOUNCEMENTS_MAX: Number(AUTO_ANNOUNCEMENTS_MAX) || 5,

  // Custom commands
  CUSTOM_COMMANDS_MAX: Number(CUSTOM_COMMANDS_MAX) || 15,

  // Discord
  DISCORD_MAX_CHARS: Number(DISCORD_MAX_CHARS) || 1990,
};
