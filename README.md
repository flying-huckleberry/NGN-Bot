# YouTube Live Chat Bot
A Node.js bot that listens to live chat and responds to commands.

## Setup
1. Create a Google Cloud project and enable **YouTube Data API v3**.
2. Create an OAuth client and add `http://localhost:3000/oauth2callback` as a redirect URI.
3. Copy `.env.example` to `.env` and fill in your keys.
4. Run `npm install` then `npm start`.

## Commands
- `!hello` — replies "Hello, world!"
