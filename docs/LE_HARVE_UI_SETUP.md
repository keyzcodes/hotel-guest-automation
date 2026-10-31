# Le Harve workspace — development UI stage

This stage adds the approved blue Overview / Guests / Reports shell. It is not
merged to main or deployed. Keep Kudu Demo's Render settings unchanged.

## What is implemented

- Authenticated session supplies the hotel name, staff identity, role and reporting
  capability. No browser setting grants API permissions. Shared/demo deployments
  with reporting off continue to use the original guest workspace.
- Reports have department/date filters, summary totals, missing-entry indicators,
  detailed entry pages, corrections, before/after history and voiding with a reason.
- Sales/expense forms use the backend's department/category mapping. Decimal naira
  text is sent to the backend, which remains authoritative for integer-kobo money.
- New and correction drafts autosave in sessionStorage, scoped to the staff ID and
  entry. Open forms can recover after refresh in that browser tab. Drafts are not
  part of totals. Logging out clears hotel-prefixed session storage.
- Each save retains its UUID across an uncertain result. Fields lock until the same
  submission is retried or the form is closed; a retry does not create a new entry.
  Draft corrections retain their original expected version to prevent overwrites.
- Native modal dialogs contain keyboard focus and support Escape when not saving.
- Summary printing uses fresh summary data. Detailed printing fetches all matching
  entry pages, not just the visible page. Voids remain labelled and excluded from
  totals. Reports show scope, generation time, preparer and signature space. Large
  detailed exports stop explicitly rather than silently printing a partial list.
- GM can create/disable staff accounts. Staff may work across departments but
  cannot access account administration. Passwords are not stored as drafts.
- Outer desktop sidebar / mobile bottom navigation stays separate from the guest
  sections. The embedded mobile conversation reserves space for the bottom nav.
- Theme is shared with the existing preference applied before first paint. The
  layout keeps the blue identity (#0866ff), with readable dark-theme equivalents.

## Start locally without disturbing the demo

Prerequisites: install Stages 1 and 2; complete the restricted-database verification;
keep the existing local backend/.env and backend/.env.finance-test private. The
latter holds the development user's password, and is ignored by Git.

In backend, run once:

```powershell
node .\scripts\le-harve-dev.cjs setup
```

This creates a GM account in le_harve_dev from the existing local STAFF_EMAIL and
STAFF_PASSWORD_HASH. Sign in with the same email/password you previously configured.
It does not copy guest records, financial records or sessions from the demo. If a
GM already exists it does not change that GM's password.

Then, in the backend terminal:

```powershell
node .\scripts\le-harve-dev.cjs start
```

In a separate frontend terminal:

```powershell
npm run dev
```

Open http://localhost:3001. If another local backend already occupies port 5000,
stop that local process before starting this one. Do not stop the hosted service.

The launcher supplies settings only to its child process: le_harve_dev database,
individual staff accounts and reporting on, Le Harve branding, guest messaging off.
It never edits .env, changes the hosted webhook, starts local Telegram polling, or
runs the message worker. The API blocks guest replies/completion sends in this mode.
Guest-service data entry can be inspected, but Telegram delivery is intentionally
not part of this isolated reporting test. Scheduled jobs may be saved in this dev
DB; the disabled worker will not execute them.

## Validation and remaining work

Backend tests, frontend lint, type checks and a production build are run locally.
The user separately confirmed the real MongoDB financial verification passed.
Browser rendering verification is incomplete: the cloud browser could not reach
the local server, and a local Chromium download failed in this environment.
Do not claim desktop/mobile visual checks or browser end-to-end tests passed.

Check locally at 320px, 390px, tablet and desktop, in both themes:

1. Sign in; see Le Harve name and Overview / Guests / Reports.
2. Add a kitchen daily sale; refresh with a second unfinished form to check recovery.
3. Inspect daily entries, make a correction and check its history.
4. Record a General Operations diesel expense; check selected-period totals.
5. Print summary and detailed entries; check scope, complete rows and signatures.
6. Open Guests / Conversations; verify the composer remains above the bottom nav.
7. Use mobile browser Back across outer tabs; reload inside Reports and Guests.
8. As GM, add a staff account and disable it; confirm staff cannot manage accounts.
9. Sign out; confirm drafts from that session are not exposed to the next login.

Still pending: offline submission queue, IndexedDB/service-worker caching, automatic
reconnection syncing, server-synced drafts and cross-device draft conflicts, password
reset, live guest messaging with a separate test bot, and final hosted validation.
This stage must not be described as offline-capable or production-ready.

The existing docs/LE_HARVE_IMPLEMENTATION.md records earlier stages; this document
supersedes its frontend-pending status for the features implemented above.
