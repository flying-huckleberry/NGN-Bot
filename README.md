# YouTube & Discord Live Chat Bot

A modular Node.js bot that connects to both YouTube Live Chat and Discord. It processes commands through a shared router, serves a unified Dev/Playground web UI, and supports PROD/DEV/Playground modes to balance real usage with safe offline testing.

## Features

- PROD: auto-connects to the target livestream and continuously polls chat.
- DEV: manual connect/poll via web UI to conserve YouTube quota.
- Playground: offline fake chat for developing commands without API calls.
- Discord transport: discord.js client shares the same command registry and scoped racing state.
- Crypto paper-trading mini-game with CoinGecko prices and per-scope portfolios.
- Unified web UI: Dev panel and playground in the browser.
- OAuth2 for YouTube; Discord token-based auth.
- Scoped persistence: per-playground, per-YouTube channel, and per-Discord guild state.
- Modular commands in `src/modules/`; racing mini-game with upgrades and payouts.
- Quota tracking and nightly reset; startup safety checks and logging.

## Prerequisites

- Node.js 18
- Google Cloud project with YouTube Data API v3 enabled (client ID/secret)
- Redirect URI: `http://localhost:3000/oauth2callback`
- (Optional) Discord bot token

## Installation

```bash
npm install
cp .env.example .env
```

Fill `.env` with:

- Google OAuth credentials
- Bot mode (dev/prod)
- Livestream targeting (URL/video ID/channel ID/title match)
- Command prefix and quota settings
- Discord bot token and allowed guild/channel IDs (optional)
- Racing Discord channel mapping (optional)

### Environment example

```env
MODE=dev
PORT=3000

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback

# Choose ONE targeting method:
TARGET_LIVESTREAM_URL=https://www.youtube.com/watch?v=XXXX
# TARGET_VIDEO_ID=XXXXXXXXXXX
# TARGET_CHANNEL_ID=UCxxxxxxxxxxxx
# TARGET_TITLE_MATCH="optional title substring"

COMMAND_PREFIX=!
YT_DAILY_QUOTA=10000
POLL_ESTIMATE_UNITS=5

# Discord transport (optional)
DISCORD_BOT_TOKEN=your-discord-bot-token
DISCORD_ALLOWED_GUILD_IDS=
DISCORD_ALLOWED_CHANNEL_IDS=
# Restrict racing commands per guild (comma separated guildId:channelId pairs)
DISCORD_RACING_CHANNELS=

# Disable modules (CSV)
DISABLED_MODULES=

# Crypto game (CoinGecko-backed paper trading)
CRYPTO_ALLOWED_COINS=BTC,ETH,SOL,DOGE,LTC
CRYPTO_STARTING_CASH=1000
COINGECKO_TTL_MS=60000  # set 0 for no cache
```

Target selection priority: `TARGET_LIVESTREAM_URL` > `TARGET_VIDEO_ID` > `TARGET_CHANNEL_ID` (+optional `TARGET_TITLE_MATCH`).

## Running the bot

### PROD or DEV
```bash
npm start
```
Open `http://localhost:3000`. If YouTube tokens are missing, you’ll be redirected to `/auth` to sign in with the bot’s YouTube account.

### Playground (offline)
```bash
npm run dev
```
Open `http://localhost:4000`. No external API calls are made; useful for developing commands safely.

### Discord transport
If `DISCORD_BOT_TOKEN` is set, the Discord client starts alongside YouTube. Messages starting with the command prefix use the same router and replies stay in the originating channel. Optional allowlists (`DISCORD_ALLOWED_GUILD_IDS`, `DISCORD_ALLOWED_CHANNEL_IDS`) scope handling. The racing game enforces one channel per guild via `DISCORD_RACING_CHANNELS`; commands elsewhere are rejected with a reminder.

### Crypto paper trading
Enabled by default. Users start with `CRYPTO_STARTING_CASH` USD and can trade allowlisted coins (`CRYPTO_ALLOWED_COINS` tickers CSV). Prices come from CoinGecko `/simple/price`, cached for `COINGECKO_TTL_MS` milliseconds (set 0 for no cache). Commands: `!buy <symbol> <usd>`, `!sell <symbol> <usd>`, `!cash`, `!wallet`, `!coin <symbol>`, `!leaders`. Replies tag the user and respect the chat character limit.

### Scoped state
Stateful features persist per context:
- `playground` — offline sandbox state.
- `youtube:<channelId>` — per creator channel.
- `discord:<guildId>` — per server, with racing limited to the configured channel.

Use `src/state/scopedStore.js` for new modules; pass `ctx.stateScope` and your filename to load/save under `state/scoped/<scope>/`.

## Web UI

- `/` (Dev Panel): connect/poll controls, quota usage, target info, token status, dev state reset, raw JSON debug panel.
- `/sandbox`: fake chat playground to send commands and view replies without API calls.
- `/auth`: starts YouTube OAuth2.
- `/oauth2callback`: stores OAuth tokens.

## Quota tracking

YouTube Data API v3 daily limits are estimated in `state/quota.js`:

| Action                | Approx units |
| --------------------- | ------------ |
| Resolve livestream URL| ~1           |
| Resolve video ID      | ~1           |
| Resolve channel       | ~101         |
| Prime chat            | ~5           |
| Poll once             | ~5           |

Resets automatically at midnight Pacific and is shown in the Dev Panel.

## Commands

Commands live in `src/modules/`. Example:

```js
module.exports = {
  name: 'example',
  commands: {
    hello: {
      description: 'Say hello',
      run: async (ctx) => {
        ctx.reply('Hello!');
      },
    },
  },
};
```

Trigger with the prefix (default `!`): `!hello`. The router handles parsing, owner checks, execution, and replies across YouTube and Discord.

## Project structure

```
src/
  index.js               # Main runtime + web UI server
  modules/               # Command modules
  services/
    youtube.js           # OAuth + YouTube API client
    discord.js           # Discord transport bootstrap
    openai.js            # !ask logic
    liveChatTarget.js    # Resolves liveChatId from env
    league.js            # League API commands
    racing/              # Racing game logic, state, parts, venues
    crypto/              # CoinGecko-backed paper trading state/prices
  routes/
    dev.js               # Dev panel handler
    playground.js        # Playground UI
  server/
    auth.js              # OAuth endpoints
    layout.js            # Shared HTML layout
  state/
    g.js                 # In-memory global state
    devState.js          # Saved state for DEV mode
    quota.js             # Quota accounting + reset
    scopedStore.js       # Scoped JSON storage helper
  utils/
    logger.js
    logCommand.js
    parse.js
    permissions.js
```

## Development workflow

1. Set `MODE=dev` in `.env`.
2. `npm start` (web UI at `http://localhost:3000`).
3. Connect manually, then poll once to process chat.
4. Edit or add commands in `src/modules/`.
5. Test in real chat (uses quota) or `/sandbox` (no quota).

Deploy:

1. Set `MODE=prod`.
2. Confirm targeting values in `.env`.
3. `npm start` and let it run.

## Adding new commands

Create a module under `src/modules/`, export commands, then reload/test:

```js
module.exports = {
  name: 'dice',
  commands: {
    roll: {
      description: 'Roll a six-sided die',
      run: async (ctx) => {
        const n = Math.floor(Math.random() * 6) + 1;
        ctx.reply(`You rolled a ${n}`);
      },
    },
  },
};
```

## Summary

This bot runs on YouTube and Discord with:
- Seamless PROD operation and a quota-friendly DEV mode.
- Offline Playground for safe development.
- Shared web UI, modular commands, scoped persistence, and racing mini-game.
- Automatic quota tracking and robust startup checks.
