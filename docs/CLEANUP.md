# Cleanup — 7 October 2026

## Removed
- `backend/src/config/db.js`
- `backend/src/config/hotel.js`
- `backend/src/models/Room.js`
- `backend/src/routes/demo.js`
- `backend/src/routes/webhook.js`
- `backend/src/services/scheduler.js`
- `backend/src/services/whatsapp.js`
- `frontend/public/file.svg`
- `frontend/public/globe.svg`
- `frontend/public/next.svg`
- `frontend/public/vercel.svg`
- `frontend/public/window.svg`

Removed chain: broken WhatsApp demo/webhook routes, empty configuration/sender, disconnected Room-based scheduler/model. Removed duplicate unused database connection helper. Starter SVGs had no references in supplied app source. No database collections or records were changed.

## Retained and relocated
Booking/TaskTicket models, controllers/routes, Telegram service, frontend configuration and existing page remain. Manual bot diagnostic moved to backend/tools/testBot.js with explicit backend .env path. Do not run alongside the main bot: both poll the same token. No dependencies removed: lockfile pruning is deferred until dependency tooling is available.

## Remaining issues — next work
Homepage remains a historical visual draft and its /api/demo buttons no longer have routes; do not present as functional. Telegram still has hardcoded fallback recipient, mock response mismatch, unverified model, misleading staff-alert/power statements and selective review routing. Check-in still uses a 15-second timer and fixed short-stay policies. Callbacks do not persist actions. No message history, SSE, durable jobs, hotel knowledge, authentication, webhook signature validation, or tenant isolation implemented. Existing public API routes must not be used with real guest data before access controls. No running backend/DB/Telegram/AI verification performed.

## Checks
All retained backend JavaScript passed node --check. Relative CommonJS imports resolve to retained files. Removed SVGs were unreferenced. Frontend application files unchanged; lint/type/build not run because dependencies are absent in snapshot. No real messages sent.
