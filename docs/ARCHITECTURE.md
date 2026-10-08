# Architecture decisions

## Retained foundation
Next.js/React/TypeScript/Tailwind frontend; Node/Express backend; MongoDB/Mongoose; grammY Telegram; Google GenAI SDK. Versions remain as supplied in package files; no dependency upgrade or database migration in this pass. Backend remains CommonJS.

## Planned, not implemented
SSE pushes stored events to the dashboard; HTTP handles staff actions. Database-backed scheduled jobs plus a running worker replace in-memory timers. Jobs need claims, retries, deduplication and stale-stay checks. A provider interface separates Telegram/WhatsApp from workflow logic. Message history and hotel-approved knowledge must be persisted/configured. AI model availability must be verified before integration repair.

## Delivery
Local demo first. Hosted deployment is undecided. No Vercel five-minute Hobby cron or zero-cold-start claim. No Supabase, Redis or BullMQ added now. A future PMS connector should feed the same stay workflow.

## Repository
User machine has root and nested frontend Git repositories. Their relationship is unresolved; preserve both histories. This source ZIP has no Git metadata or secrets. Backend defaults to port 5000; frontend currently calls port 3000. Environment override may exist but was not supplied.
