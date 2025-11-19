# Agent Guidelines (Codex / AI Helpers)

## Sensitive Files — NEVER OPEN OR EDIT

The following files must NEVER be read or modified by AI coding tools:
- `.env`
- `.env.*`
- `token.json`

If you are an AI assistant (Codex / Copilot / etc):
- Do not request to see these files.
- Assume necessary environment variables exist and are documented in `.env.example` or README.
- If you need configuration details, ask for them conceptually instead of inspecting secrets.
- You can also refer to the file `.codexignore` for a gitignore-style list of files that you should NOT access.

## Allowed Configuration References

Use:
- `.env.example`
- `README.md`
- `CODING_AGENTS.md` (this file)
- Comments and TypeScript/JSDoc types

## Environment Variables

When you need configuration:

- Infer variable names and meanings from `.env.example`.
- Do NOT inspect `.env` — it may contain real secrets.
- If in doubt, suggest changes to `.env.example` instead.


## Preferred Default Mode

If you are running inside VS Code:

- Start in **Chat / Read-Only** mode.
- Do NOT modify files unless explicitly asked: e.g. “apply these changes to the codebase”.
- When suggesting changes, provide code snippets instead of directly editing files.

