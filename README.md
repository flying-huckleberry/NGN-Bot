# YouTube & Discord Live Chat Bot

A modular Node.js bot that connects to both YouTube Live Chat and Discord. It processes commands through a shared router, serves an Accounts/Control Panel web UI plus Playground, and supports PROD/DEV/Playground modes to balance real usage with safe offline testing.

## Features

- PROD: auto-connects per account and continuously polls chat for each configured YouTube channel.
- DEV: manual connect/poll per account via the control panel to conserve YouTube quota.
- Playground: offline fake chat for developing commands without API calls.
- Discord transport: discord.js client shares the same command registry and scoped state.
- Crypto paper-trading mini-game with CoinGecko prices and per-scope portfolios.
- Semantic word-guess game using OpenAI embeddings.
- Multi-account control panel with per-account settings (prefix, race config, disabled modules, Discord channel rules, etc).
- Web UI: Accounts picker, account control panels, module settings pages, and Playground.
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
- Global defaults (command prefix, OpenAI model, etc.)
- Discord bot token (optional)
- Optional legacy targeting (for quick single-account testing)

### Environment example

```env
MODE=dev
PORT=3000

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth2callback

# Optional legacy targeting (single-account fallback):
TARGET_LIVESTREAM_URL=https://www.youtube.com/watch?v=XXXX
# TARGET_VIDEO_ID=XXXXXXXXXXX
# TARGET_CHANNEL_ID=UCxxxxxxxxxxxx
# TARGET_TITLE_MATCH="optional title substring"

COMMAND_PREFIX=!
YT_DAILY_QUOTA=10000
POLL_ESTIMATE_UNITS=5

# Discord transport (optional)
DISCORD_BOT_TOKEN=your-discord-bot-token

# Per-account settings (prefix, disabled modules, race config, crypto settings,
# Discord allowed channels, etc.) are managed in the control panel.
```

Target selection priority (legacy fallback): `TARGET_LIVESTREAM_URL` > `TARGET_VIDEO_ID` > `TARGET_CHANNEL_ID` (+optional `TARGET_TITLE_MATCH`).

## Running the bot

### PROD or DEV
```bash
npm start
```
Open `http://localhost:3000`. If YouTube tokens are missing, you will be redirected to `/auth` to sign in with the bot's YouTube account.

### Playground (offline)
```bash
npm run dev
```
Open `http://localhost:4000`. No external API calls are made; useful for developing commands safely.

### Discord transport
If `DISCORD_BOT_TOKEN` is set, the Discord client starts alongside YouTube. Messages starting with the per-account command prefix use the same router and replies stay in the originating channel. Discord guild + channel access, and racing channel restrictions, are configured per account in the control panel.

### Crypto paper trading
Enabled by default. Users start with account-scoped starting cash and can trade allowlisted coins from the account settings. Prices come from CoinGecko `/simple/price`, cached per account TTL (set 0 for no cache). Commands: `!buy <symbol> <usd>`, `!sell <symbol> <usd>`, `!wallet`, `!coin <symbol>`, `!leaders`. Replies tag the user and respect the chat character limit.

### Semantic word game
Uses OpenAI embeddings to compare guesses against `SEMANTIC_TARGET_WORD`. Caches the target embedding; similarity is computed locally. Commands: `!guess <word>`, `!semantic` (help), `!semanticwins`, `!semanticreset` (admin: Discord Administrator or YouTube chat owner). Replies show similarity, your best guess, and guess count; a correct guess ends the round for the current target.

### Scoped state
Stateful features persist per context:
- `playground` - offline sandbox state.
- `youtube:<channelId>` - per creator channel.
- `discord:<guildId>` - per server, with racing limited to the configured channel.

Use `src/state/scopedStore.js` for new modules; pass `ctx.stateScope` and your filename to load/save under `state/scoped/<scope>/`.

## Accounts and storage

Accounts are stored under `state/accounts.json` (registry) with per-account files in `state/accounts/<id>/`. These files are gitignored by default.

Per-account files include:
- `settings.json` (editable in the control panel)
- `runtime.json` (liveChatId, primed, page tokens)
- `secrets.json` (per-account tokens; currently plaintext)

Legacy `dev_state.json` is migrated to a default account on startup.

## Web UI

- `/accounts`: account picker + create new accounts.
- `/accounts/:id/cpanel`: account control panel (connect/poll, transport toggles, settings, module toggles).
- `/accounts/:id/modules/:module`: module-specific settings (ex: racing, crypto).
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

Resets automatically at midnight Pacific and is shown in each control panel.

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

Trigger with the per-account prefix (default `!`): `!hello`. The router handles parsing, owner checks, execution, and replies across YouTube and Discord.

## Project structure

```
src/
  index.js               # Main runtime + web UI server
  views/                 # EJS templates for accounts + control panel
  modules/               # Command modules
  services/
    youtube.js           # OAuth + YouTube API client
    discord.js           # Discord transport bootstrap
    openai.js            # !ask logic
    liveChatTarget.js    # Resolves liveChatId from overrides/account config
    league.js            # League API commands
    racing/              # Racing game logic, state, parts, venues
    crypto/              # CoinGecko-backed paper trading state/prices
    semantic/            # Semantic word game state/logic (OpenAI embeddings)
  routes/
    accounts.js          # Accounts + control panel routes
    playground.js        # Playground UI
  server/
    auth.js              # OAuth endpoints
    layout.js            # Shared HTML layout (playground/auth)
  state/
    accounts.json        # Account registry (gitignored)
    accounts/            # Per-account runtime/settings/secrets (gitignored)
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
3. Create an account, connect manually, then poll once to process chat.
4. Edit or add commands in `src/modules/`.
5. Test in real chat (uses quota) or `/sandbox` (no quota).

Deploy:

1. Set `MODE=prod`.
2. Fill account settings (YouTube channel ID, Discord guild, etc.) in the control panel.
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
- Multi-account control panels and account-scoped settings.
- Seamless PROD operation and a quota-friendly DEV mode.
- Offline Playground for safe development.
- Modular commands, scoped persistence, and racing mini-game.
- Automatic quota tracking and robust startup checks.
