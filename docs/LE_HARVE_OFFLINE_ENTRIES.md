# Le Harve offline entry queue

## Scope

New sales and expense entries can be saved on the device from an already loaded, signed-in Operations workspace. The existing form displays Waiting to sync, Saved, or Needs review. A small expandable pending-entry list appears in Reports only when there are pending or rejected entries. No separate workspace is introduced.

This is an entry queue, not full offline application startup. There is no service worker, offline sign-in, or cached authenticated API response. Reloading the application without connectivity still requires the existing session check and can show Unable to connect. Pending entries remain in IndexedDB and resume when the same account signs in with connectivity. Corrections and voids continue to require the server. Existing tab-scoped unfinished drafts are unchanged.

## Persistence and identity

The queue lives in IndexedDB, scoped by browser origin and staff account ID. Persistence is acknowledged only after the write transaction commits. A new submission receives one UUID and an immutable body. Network failures, server failures and lost responses retry that exact body and ID.

No password or session token is stored in the queue. Sync uses the live HttpOnly cookie session. X-Finance-Actor is checked against the trusted staff session at the backend; it does not grant permissions. A switched, disabled or expired account cannot post an entry under a different staff identity. Another account does not load the original staff member's pending entries.

Logout does not delete pending financial entries. They remain local and are available when their owner signs in again. Clearing browser site data, browser eviction or closing the final private/incognito window can erase local-only entries. Until confirmed by the server, entries are not available on another device or included in reports. This browser storage is not a backup or encrypted vault.

## Sync and conflicts

While the signed-in app is open, sync wakes on connectivity restoration, window focus, a new queued entry, and a 30-second interval. Hidden or suspended browsers may delay timers; no background sync after closing the app is promised. The server remains authoritative for dates, categories, amounts, identity, uniqueness and permissions.

Only a confirmed successful server response changes an entry to Saved. Database request-ID replay and the daily-sale uniqueness index prevent duplicate financial records, including concurrent tabs and retries after lost responses. Same-department daily sales already pending on the device are also blocked locally. Multiple expenses remain allowed.

A definite client rejection changes the queue item to Needs review and stops automatic retries. Staff can inspect the retained entry. Dismiss unsaved entry requires confirmation and is unavailable for an uncertain/waiting item. It removes only the rejected local item; it never deletes a server record. Conflicts never overwrite existing daily totals automatically. After reviewing saved records, staff can correct the original or create a new valid entry.

Requests with expired, disabled or mismatched identities pause; they do not become Saved. Temporary failures remain waiting. If device storage cannot confirm receipt after a server success, the item stays retryable and repeats the same ID.

Reports fetch once after a sync batch rather than once per entry. Totals continue to include server records only. The queue does not optimistically alter financial totals.

## Validation completed

- 23 frontend tests passed, including queue persistence acknowledgement, lost-response replay, local and server duplicate handling, account scope, session-change pause, retryable failures, receipt storage failure, calendar and amount checks.
- Backend suite: 139 tests, 138 passed, one optional MongoDB integration test skipped because no integration URI was supplied. The existing manual Atlas verification from the earlier stage is not a new verification of this update.
- Financial HTTP test checks mismatched X-Finance-Actor is rejected before any write and matching identity creates the attributed record.
- Frontend lint and production build checked separately.
- Browser interaction, native IndexedDB persistence, mobile layout and real offline reconnection remain to be verified on the user's machine. Unit tests use a memory queue store; they do not simulate the browser storage implementation.

## Installation

Install only on feature/le-harve-reporting after the equal-height filter update. The installer checks source hashes and backs up changed files. No database migration, environment edit, Telegram change, main merge or deployment is included.

Restart the isolated backend with node scripts/le-harve-dev.cjs start from backend, then rebuild and restart the frontend on port 3001. Both parts must be updated so the actor guard is active.

## Manual verification

1. With connectivity, sign in and open Reports so configuration is loaded.
2. In a normal browser window, choose DevTools Network Offline. Do not refresh.
3. Save a new Kitchen expense of ₦100 with note Offline queue test. Expect Saved on this device and Waiting to sync. Its amount must not enter server totals yet.
4. Close the form. The pending entry should remain accessible from the small Reports status line.
5. Restore Network No throttling. Expect Saved in the open entry or disappearance from the pending list, and exactly one server expense with the original staff identity.
6. Refresh while online. Confirm exactly one record; compare the total increase and history.
7. For a duplicate test, queue a daily sale offline for a date/department with an existing server total. Reconnect. Expect Needs review and unchanged server totals.
8. Sign out with a waiting entry and sign in as another account. That account must not show or sync the first account's entry. Return to the original account to resume.
9. To check persistence across browser restart, use a normal window. Save offline, close, reconnect, reopen and sign in as the same staff account. Confirm the queue resumes exactly once.
10. Void synthetic server test entries after checking their attribution. Do not discard uncertain waiting items as a substitute for verifying server state.
