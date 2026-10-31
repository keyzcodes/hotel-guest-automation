# Le Harve implementation

Development branch: `feature/le-harve-reporting`, based on main `3cf8d2e`.

## Stage 1: individual-account backend

Implemented, not deployed:

- Optional `STAFF_ACCOUNTS_ENABLED=true` selects database-backed individual accounts.
- When absent/false, the existing shared environment account remains in use.
- One login URL and the existing opaque eight-hour session cookie remain in place.
- Sessions return the signed-in account ID, name, email and GM/STAFF role.
- Authenticated GM-only `/api/staff` supports listing accounts and creating staff.
- `PATCH /api/staff/:id` accepts only `{ "active": true|false }`.
- Disabling or re-enabling staff changes their credential version, removes all
  sessions and disconnects connected sockets. Old cookies cannot become valid
  again on re-enable. Authentication also checks current account state.
- Normal management cannot disable the bootstrap GM or assign a GM role.
- Shared operational permissions remain unchanged, as agreed for v1.
- Passwords remain salted scrypt hashes; neither hashes nor cookie tokens are
  returned in account responses. Unknown-email login performs a dummy hash check.

## Development database setup — explicit, never automatic

Use a **separate development database and credentials**. Do not run this setup
against the hosted Kudu Demo database. No database was contacted during development.

1. Configure that database in the development backend's `MONGO_URI`.
2. Configure `STAFF_EMAIL` and `STAFF_PASSWORD_HASH` using the existing local
   `node scripts/setup-staff.cjs` if necessary. Do not commit the `.env` file.
3. Run `node scripts/bootstrap-gm.cjs --confirm-development-database`.
   This copies the configured identity/hash into a GM account; it does not
   overwrite an existing GM, print credentials, or change guest records.
4. Set `STAFF_ACCOUNTS_ENABLED=true` only in that development environment.
5. Start the backend and sign in with the configured GM credentials.

Switching modes requires signing in again. Legacy cookies are intentionally not
accepted as individual identities. Returning to shared mode requires retaining
the original configured environment credentials. This switch is a development
compatibility measure, not an invitation to downgrade an installed hotel.

Account administration UI and password reset are not yet implemented. Do not
enable this stage alone for a real hotel. It provides no public registration.

## API examples

All routes require the existing session cookie and approved Origin for mutations.
The frontend uses the existing `/api/auth/login`, `/session` and `/logout` URLs.

```
GET /api/staff
POST /api/staff
{ "name": "Reception", "email": "reception@example.test", "password": "a unique 12–128 character password" }

PATCH /api/staff/<staff ID>
{ "active": false }
```

These examples are documentation, not real hotel credentials. GM-only account
management does not impose departmental restrictions on operational records.

## Stage 2: Sales & Expenses backend

Implemented locally, not deployed or connected to a hotel database:

- Independent module: `backend/src/modules/sales-expenses/`.
- Disabled unless `SALES_EXPENSES_ENABLED=true`. Requires individual staff
  accounts. In shared/demo mode the finance API is unavailable.
- `financialEntries` is a new collection in the selected hotel's database.
  Existing guest collections are not used for financial records.
- One non-void daily sales total per department/date, enforced by a unique
  partial MongoDB index. Multiple genuine expenses are allowed.
- The client submits decimal naira text, for example `"10000.29"`; the backend
  parses it to integer kobo, never floating-point currency multiplication.
  Maximum per-entry amount: 1,000,000,000,000 kobo (10 billion naira).
- Sales may explicitly be zero. Expenses must be positive. Entries cannot be
  future-dated; business dates use Africa/Lagos regardless of server timezone.
- Repeated saves use the same UUID v4 request ID. Matching retries return the
  saved record; reusing an ID for a different amount or actor fails with 409.
- Staff and GM have equal financial entry/report access. Audit identity comes
  from the authenticated account, never submitted form identity.
- Corrections require the saved version and a UUID mutation ID. A concurrent
  change returns 409 instead of silently overwriting. The record and its
  before/after history are changed atomically in the same document.
- Correction notes are optional. Voiding requires a short reason, retains
  history and releases the daily sales slot. Voided entries cannot be edited.
  Wrong entry type: void and recreate. Maximum 200 history events per record.
- The summary aggregates all saved, non-void entries in the chosen period using
  decimal sums of integer kobo. No running monthly balance is stored.
  Totals outside JavaScript's exact integer response range fail explicitly.
- Department coverage distinguishes `NOT_ENTERED`, `INCOMPLETE`, `COMPLETE`
  and non-sales departments. Missing daily dates are returned through today,
  not future days. `NO_EXPENSES_RECORDED` does not assert no expenses occurred.
- Report periods are inclusive date ranges, at most 366 days. Without filters,
  the backend returns month-to-date. Daily, weekly, monthly and annual UI
  choices can all use those same from/to filters.
- Detailed entries are paginated separately (default 50, maximum 100); summary
  totals are never calculated from the visible page. Voids can be included in
  details for review. Detail pages are ordered by saved ID, not business date.
- Live record-change notifications publish only after confirmed writes.

### Finance API

All endpoints are under the existing authenticated, Origin-checked `/api`.
There is no public finance endpoint. No delete endpoint is supplied.

```
GET /api/finance/config
GET /api/finance/summary?from=2026-10-01&to=2026-10-30
GET /api/finance/entries?from=2026-10-01&to=2026-10-30&departmentId=kitchen
GET /api/finance/entries/<entry ID>

POST /api/finance/entries
{ "requestId": "UUID v4", "type": "SALE", "businessDate": "2026-10-30",
  "departmentId": "kitchen", "amount": "10000.00", "note": "" }

PATCH /api/finance/entries/<entry ID>
{ "mutationId": "new UUID v4", "expectedVersion": 1, "type": "SALE",
  "businessDate": "2026-10-30", "departmentId": "kitchen",
  "amount": "12000.00", "note": "", "reason": "Optional correction note" }

POST /api/finance/entries/<entry ID>/void
{ "mutationId": "new UUID v4", "expectedVersion": 2, "reason": "Duplicate" }
```

An expense uses `"type": "EXPENSE"` and a valid department-specific
`"categoryId"`. Diesel belongs to `"departmentId": "general"` with
`"categoryId": "diesel"`. Read `/config` for the provisional mappings.

### Separate database verification — still required

Unit/model tests and HTTP tests use isolated fake persistence. They do not
prove that a real MongoDB instance enforces the indexes or runs the aggregation.
An opt-in integration test is included at `backend/tests/finance-mongodb.test.cjs`.

The interactive runner is `node scripts/verify-finance.cjs`. It privately prompts
for an Atlas connection string using `le_harve_dev_app`, fixes the database to
`le_harve_dev`, and requires only readWrite on that database. It creates a random
`verification_finance_*` collection, checks persistence, uniqueness, corrections,
aggregation, voids and explicit zero sales, then drops only that collection.
It never starts the app/bot, changes environment files, or drops a database.
Its guards reject a different username or another database in the URI path.

The automated integration wrapper reads **only** `FINANCE_TEST_URI`, never your
normal `MONGO_URI` or `.env`. It calls the same runner and is skipped if that
variable is absent. Prefer the interactive runner so credentials are not typed
into shell command history. Do not use the older generated-database approach;
the restricted development user does not need access to other databases.

Model validation protects application writes; unique indexes protect concurrent
saves in MongoDB. A raw database administrator can bypass application business
validation. Do not give staff direct database write access.

No real database migration or test connection was made when producing this stage.
Do not enable reporting in the hosted demo or deploy this unfinished module.

## Agreed next stages — not implemented

1. Real development-database verification of account setup, persistence,
   financial indexes, concurrent writes and report aggregation.
2. Approved blue `#0866ff` Overview / Guests / Reports shell; existing guest
   navigation remains inside Guests. Staff-account management in the GM profile.
3. Entry forms, local draft recovery, server drafts and cross-device conflict
   handling; offline new-entry queue with stable IDs and visible sync status.
   Guest messaging remains online-only. Do not cache guest conversations offline.
4. Report summaries, drilldown, date filters and dedicated Print / Save PDF layout.
   Include all rows in the selected scope, freshness and signature space.

The draft department list is Accommodation, Kitchen/Restaurant, Bar, Laundry,
Gym and Swimming Pool, plus General Operations for shared expenses. Confirm the
hotel's exact categories before configuration. Diesel stays General Operations;
no cost-allocation engine or PMS/reservation expansion in this scope.

## Verification scope

Automated tests exercise real Express and Socket.IO with isolated in-memory
stores. They cover existing shared login, named login, role rejection, account
creation, duplicate email, protected GM access, disable/re-enable revocation and
live socket disconnection. These do **not** prove real MongoDB persistence,
index creation, database migration, browser account management or hosted rollout.
Those checks remain required in the separate development environment.
