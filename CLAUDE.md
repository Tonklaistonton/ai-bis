# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## Repository scope

The application lives in `ai-chat/`. Run all npm commands from that directory. It is a self-hosted Node.js 22+ service; `node:sqlite` is required.

## Commands

```bash
cd ai-chat
npm ci                # install the committed lockfile
npm run dev          # development server; node server.js, default port 3000
npm run build        # Next.js production build
npm start             # production server (node server.js --prod)
npm test              # all node:test files under tests/**/*.test.js
node --test tests/auth-db.test.js                 # one test file
node --test --test-force-exit --test-name-pattern="setup" tests/auth-http.test.js
node preview.js       # isolated demo server using data/preview.db
npm run tunnel        # localtunnel, only when external webhook access is intended
```

Use `PORT=...` to change the port. `DB_FILE=...` selects another SQLite file. `AIZEN_SKIP_LOGIN=1` bypasses login for local development only; it grants the first admin account and must not be used in production. `preview.js` resets/seeds its isolated database and provides `demo` / `demo1234`.

Tests use Node's built-in `node:test` and `node:assert`; no test runner or transpilation step exists. HTTP tests start the server and use an isolated temporary database. Run a focused file before the full suite when changing one subsystem.

## CI and dependency maintenance

`.github/workflows/ci.yml` runs on pushes and pull requests, using Ubuntu and Node 22.x with read-only repository permissions and a 15-minute timeout. Steps run inside `ai-chat/`: `npm ci`, `npm test`, then `npm run build`. Commit `ai-chat/package-lock.json` with dependency changes; the workflow uses it for installation and caching. This is CI only, not website deployment; production still needs a Node host and persistent SQLite storage.

Stop the local Next dev server before HTTP tests (both use `.next/dev`) or `npm ci` on Windows (native modules can be locked). `npm test` uses `--test-force-exit` because HTTP tests leave the server and background timer open; the flag exits after test completion, not instead of checking failures. HTTP tests explicitly disable `AIZEN_SKIP_LOGIN` so local `.env` settings cannot bypass their authentication checks.

Nodemailer was upgraded to `^10.0.13`. Localtunnel 2.0.2 pins vulnerable Axios 0.21.4, so a scoped npm override selects Axios `^1.20.0`; retain the override until upstream supplies a patched dependency. `tests/dependency-compat.test.js` checks offline email composition and localtunnel metadata negotiation against localhost without sending mail or opening a public tunnel.

### Implementation summary (2026-10-02)

- Added CI, tracked lockfile, deterministic authentication test configuration, and test-runner termination.
- Added repository agents under `.claude/agents/` for coordination, backend, frontend, integrations, and review. These are Claude Code helpers, not GitHub Actions jobs.
- Local verification on Windows / Node 25.9.0: 51 tests passed, production build passed, `npm audit` reported zero vulnerabilities. Actual GitHub Ubuntu / Node 22 execution is a separate check; these local results do not prove hosted CI success.
- Live Gmail delivery and public tunnel connections were not tested. No hosting deployment was configured.

## Architecture

`ai-chat/server.js` is the composition root. It loads `.env`, opens the database, prepares Next.js, and owns the HTTP server. Express handles `/api/*`, the LINE webhook, and WebSocket `/ws`; Next.js handles the React UI and HMR upgrades. The root `/` is still served directly from `unified-inbox.html`; other non-API routes fall through to Next.js.

### Frontend

- `app/` contains the Next.js App Router pages: inbox, LINE, email, knowledge, settings, login, and setup.
- `components/AppProvider.jsx` owns shared client state/API loading and realtime updates; `AppShell.jsx` supplies the authenticated application shell; the channel/settings views implement page workflows.
- `css/` contains the global, component, and Next-specific styles.
- UI API calls target the Express routes in `server.js`; WebSocket messages notify clients, which then refresh HTTP-backed state where appropriate.

### Backend services

- `lib/db.js`: SQLite storage controller using `node:sqlite`; creates/migrates schema, applies environment overrides, bounds chat/email history to 200 records, and exposes config, knowledge, channel, team, conversation, and message operations. Database default: `data/aizen.db`.
- `lib/auth.js`: scrypt password hashes, sessions in SQLite, httpOnly session cookies, setup/login/logout, roles, and team visibility checks.
- `lib/lineService.js`: LINE webhook HMAC validation, inbound event handling, profile lookup, Reply API, and Push API.
- `lib/gmailService.js`: Gmail SMTP sending and connection verification. Email is outbound-only; there is no IMAP inbox sync.
- `lib/aiService.js`: Gemini/OpenAI calls, configurable OpenAI-compatible endpoint/model probing, combined Airtable/Sheets context, and deterministic Thai/English rule-based fallback.
- `lib/airtableService.js` and `lib/googleSheetsService.js`: external knowledge-source sync into SQLite caches; Google Sheets also supplies an Apps Script webhook/template.
- `lib/migrate.js`: one-time import from legacy `data/database.json` into SQLite, preserving the original as a migrated archive.
- `lib/chatUtils.js`: shared pure chat validation/grouping helpers used by UI-related code and tests.

### Data flow and invariants

SQLite is the source of runtime state: users/sessions, config, knowledge, messages, teams, channels, conversations, and synced knowledge caches. Secrets may come from `.env` and override database values. API responses redact secret fields; masked values submitted by the UI mean “leave unchanged.”

Channels belong to teams. Staff can access only channels belonging to their teams; admins can access all channels. Conversation ownership is enforced server-side:

- Unassigned conversations are visible to permitted team members but cannot be used for outbound replies.
- Claim/release uses database-side conditional updates; claiming is atomic.
- Only the assigned staff member or an admin may send LINE or email replies.
- Claiming hands a conversation from AI to a human; AI must not auto-reply or draft while assigned. Releasing returns it to the unassigned/AI window.

When adding or changing an endpoint, preserve both authentication middleware and channel/team scope checks. Webhook routes authenticate through their provider-specific signature mechanism rather than a browser session. LINE webhook body parsing must remain raw until signature validation. WebSocket clients also require a valid session.

## Configuration and operations

Relevant `.env` names include `LINE_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENAI_ENDPOINT`, `AIRTABLE_API_KEY`, and `GMAIL_APP_PASSWORD`; see `ai-chat/README.md` for the complete list and deployment caveats. Do not commit `ai-chat/data/aizen.db`, `.env`, or generated runtime state.

Back up runtime state by copying `ai-chat/data/aizen.db` while the service is stopped or using an appropriate SQLite backup procedure. The service has no built-in HTTPS, rate limiting, audit log, 2FA, or automatic backup. `start.bat` can expose the server through a tunnel; treat that as public exposure.

For domain terminology and business rules, read `ai-chat/CONTEXT.md` before changing teams, channels, assignment, ownership, or AI handoff behavior. For setup, security constraints, and integration limitations, read `ai-chat/README.md`.
