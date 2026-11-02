# Combined entry form and grouped daily entries

## Delivered behaviour

Add entry has shared date, department and optional note, plus independent Daily sales and Expense amounts. Expense category appears only when the expense amount is filled. General Operations offers expenses only. Leaving sales blank submits no sales record; typing 0 submits an explicit zero sale. Blank expense creates no expense. Zero expenses remain invalid, consistent with existing validation.

Save entries submits sales only, expense only or both. Each financial record retains its independent ID, actor attribution, correction history and backend uniqueness checks. Both local queue records commit in one IndexedDB transaction. Server sync is independently confirmed for each item: a conflict on the sale does not erase the expense or overwrite the existing sale. The form shows per-item Saved, Waiting to sync or Needs review. Already confirmed records are not resent. No claim of an atomic two-record server transaction is made.

Existing single-record correction and void workflows remain unchanged. Offline startup still requires connectivity and login verification. Existing tab-scoped single-entry drafts migrate to the combined form with their original request IDs; queued entries remain available through the pending list. Draft restoration fails closed if it cannot safely reconstruct a prepared save.

## Lightweight daily view

Daily entries now shows one row per department and business date with recorded sales and the combined expense amount. The date appears beneath the department on mobile and remains visible on desktop. A confirmed zero sale displays currency zero. A group with no active sale displays Not entered; General Operations shows a dash. A void-only group remains accessible and is labelled Voided only.

Selecting a row opens its live single-day totals and paginated saved records, including voided entries marked not counted. Selecting an individual record opens the existing history/correction/void panel.

The new read-only daily-groups endpoint aggregates integer-kobo totals in MongoDB using Decimal arithmetic, excludes voided values from sums, and counts submitted sales separately from amounts. Pagination happens after grouping, so a department's daily expense total is never the sum of just one raw-entry page. Groups sort by date descending and department ID ascending with a bounded keyset cursor. Raw entries and histories are fetched only on demand. Existing Summary and Overview calculations are unchanged.

Print/PDF in Daily entries follows the grouped view and fetches all selected group pages before printing. Individual voided amounts remain visible in the on-screen drill-down, not as separate rows in the grouped printout. Printing remains a live report, not an immutable signed snapshot. Concurrent changes between requests can still change a live report.

## Verification

- Frontend: 31 tests passed, including combined selection, blank versus zero, General Operations, validation, atomic local staging, old payload order compatibility, partial success and lost-response retries.
- Backend: 144 tests total, 143 passed and one optional MongoDB integration test skipped without a test URI.
- ESLint and production build passed.
- New group tests cover pipeline scope, decimal sums, group-level pagination, cursor validation, exact numeric response limits and the HTTP endpoint.
- Browser interaction, native IndexedDB batch transactions, mobile appearance, actual MongoDB grouped aggregation and printed output still need validation on the user's local development setup. These have not been claimed as observed here.

## Install and check

Use feature/le-harve-reporting only. The guarded installer backs up original files and refuses unknown source versions. Restart the isolated backend, rebuild the frontend and restart port 3001. No environment files, MongoDB records, schemas/indexes, Telegram settings, main branch or hosted services are changed by installation.

1. Use an unoccupied department/date in development. Save sales 1000 and one valid expense 200 together. Confirm two saved statuses and one Daily entries row showing 1000 sales and 200 expenses.
2. Add another expense-only entry for 50. Confirm the same row now shows 250 expenses and the drill-down lists both expenses.
3. Test sales-only with explicit 0 on a different date/department. Confirm 0, not Not entered.
4. Test expense-only on a department/date with no sale. Confirm Not entered and the recorded expense; no zero sale is created.
5. Open a group, open an individual record, correct its amount, refresh, then void it. Confirm group and Summary totals agree, with history retained.
6. Offline: save both fields, close and reopen with connectivity as the same account. Confirm exactly one sale and one expense. If the sale date/department is occupied, confirm Needs review for sales while the expense can sync.
7. Refresh an unfinished form and confirm both amounts return independently. After submitting and closing it, Add entry must open a fresh form.
8. Check 320px, 390px, tablet and desktop, in light and dark themes; check scrolling, focus, labels and large amounts.
9. Print a filtered multi-day Daily entries report and compare grouped dates, departments and totals. Summary printing should remain unchanged.
10. Void development test records after completing validation.
