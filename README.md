# YouTube Live Chat Bot

A modular Node.js application that connects to YouTube Live Chat, processes commands, and provides a full development environment through a unified Web UI. The bot supports multiple modes—PROD, DEV, and PLAYGROUND—allowing efficient development while controlling API usage.



## Features

 **PROD mode** – Automatically connects to a livestream and continuously polls chat.
 **DEV mode** – Manual connect and poll controls via Web UI to conserve YouTube quota.
 **Playground mode** – Fully offline simulation of YouTube chat for testing commands.
 **YouTube OAuth2 authentication** – Logs in the bot account securely.
 **Unified Web UI** – Dev panel and playground accessible from the browser.
 **Modular command system** – Commands stored in `src/modules/`.
 **Quota tracking** – Estimates API cost and resets daily at midnight PST.
 **State persistence** – DEV mode saves state to avoid repeated expensive API lookups.
 **Robust startup safety checks** – Ensures modules load correctly and logs errors.



## Prerequisites

 Node.js 18
 A Google Cloud Project with **YouTube Data API v3** enabled
 OAuth Client ID  Secret
 Redirect URI:  
  `http://localhost:3000/oauth2callback`



## Installation

```bash
npm install
cp .env.example .env
```

Open `.env` and fill in:

 Google OAuth credentials  
 Bot mode (dev/prod)  
 Desired livestream target  
 Command prefix  
 Quota settings  



## Environment Configuration

Example `.env`:

```env
MODE=dev
PORT=3000
PLAYGROUND_PORT=4000

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
```

Target selection priority:

1. `TARGET_LIVESTREAM_URL`
2. `TARGET_VIDEO_ID`
3. `TARGET_CHANNEL_ID`  optional `TARGET_TITLE_MATCH`



## Running the Bot

### PROD or DEV mode
```bash
npm start
```

Visit:

```
http://localhost:3000
```

If tokens are missing, you'll be redirected to `/auth` to sign in with the **bot’s YouTube account**.

### Playground (offline)
```bash
npm run dev
```

Visit:

```
http://localhost:4000
```

No API calls are performed in this mode.



## Web UI Overview

The Web UI uses a shared sidebar layout:

### `/` — Dev Panel
Main interface for development:

 Connect to livestream  
 Poll once (reads one page of chat)  
 View YouTube quota usage  
 Inspect liveChatId, method, tokens, prime status  
 Reset dev state  
 View raw JSON debug panel  

### `/playground`
Offline fakechat environment:

 Select a fake player identity  
 Send commands as if in YouTube chat  
 View replies and global log  
 Useful for command development without affecting quota  

### `/auth`
Starts Google OAuth2 flow.  
After authorization, the bot’s tokens are saved locally.

### `/oauth2callback`
Receives and stores the OAuth tokens.



## Quota Tracking

YouTube Data API v3 has strict daily limits.  
This bot maintains an internal estimate in `state/quota.js`.

Estimated costs used:

| Action | Approx Units |
|||
| Resolve livestream URL | ~1 |
| Resolve video ID | ~1 |
| Resolve channel | ~101 |
| Prime chat | ~5 |
| Poll once | ~5 |

Reset happens automatically every midnight Pacific Time.

Displayed visually in the Dev Panel progress bar.



## Commands

Commands live under:

```
src/modules/
```

Each module can export multiple commands:

```js
module.exports = {
  name: 'example',
  commands: {
    hello: {
      description: 'Say hello',
      run: async (ctx) => {
        ctx.reply('Hello!');
      }
    }
  }
};
```

Commands are triggered in chat using the prefix defined in `.env` (default: `!`):

```
!hello
```

The router automatically handles parsing, owner checks, execution, and reply delivery across all modes.



## Project Structure

```
src/
  index.js               # Main bot runtime  web UI server

  modules/               # Commands (userdefined)

  services/
    youtube.js           # OAuth  YouTube API client
    openai.js            # Connect to OpenAI API, !ask command logic
    liveChatTarget.js    # Resolves liveChatId from env settings
    league.js            # Commands logic for LeagueAPI requests
    racing/              # Suite of services providing a Racing game in live chats

  routes/
    dev.js               # Dev panel handler
    playground.js        # Playground Web UI

  server/
    auth.js              # OAuth endpoints
    layout.js            # Shared HTML layout  sidebar

  state/
    g.js                 # Inmemory global state
    devState.js          # Saved state for DEV mode
    quota.js             # Quota accounting  resets

  utils/
    logger.js            # Logging wrapper, using Winston package
    logCommand.js        # Formatting for logging !commands (command + author + response)
    parse.js             # Parses commands + arguments
    permissions.js       # Owneronly check
```



## Development Workflow

1. Set `MODE=dev` in `.env`.
2. Start the bot: `npm start`.
3. Open `http://localhost:3000`.
4. Connect manually (consumes minimal quota).
5. Poll once to process chat.
6. Edit or add commands in `src/modules/`.
7. Test either:
    **In real chat (uses quota)**  
    **In `/playground` (no quota)**  

When deploying:

1. Set `MODE=prod`.
2. Ensure targeting values in `.env` are correct.
3. Start the bot normally and let it run unattended.



## Adding New Commands

Example module `dice.js`:

```js
module.exports = {
  name: 'dice',
  commands: {
    roll: {
      description: 'Roll a sixsided die',
      run: async (ctx) => {
        const n = Math.floor(Math.random() * 6)  1;
        ctx.reply(`You rolled a ${n}`);
      }
    }
  }
};
```

Reload the bot and test it:

```
!roll
```



## Summary

This bot provides:

 Seamless PROD operation  
 Powerful DEV mode to conserve YT API quota  
 Complete offline testing environment  
 Centralized Web UI  
 Pushbutton connect and poll  
 Modular commands easy to extend  
 Automatic quota management  
 Safe startup and error logging  

Developers can build new commands quickly and test them immediately—without burning API quota or dealing with complex YouTube integrations.
