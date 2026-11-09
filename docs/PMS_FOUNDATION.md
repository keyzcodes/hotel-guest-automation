# Sesora PMS foundation — premium property pilot

Updated 7 November 2026 (Lagos). **Status: room-board pilot implemented and approved for local testing.** Target premium hotels and serviced apartments with meaningful direct-booking and guest-service volume. The Nest setup preview is a design reference. Actual room/unit numbers, categories, rates and policies must be approved by each property before use.

## Current evidence

The user reported successful local WhatsApp welcome, accelerated departure reminder, guest request, completion notification, confirmed checkout and conversation-history checks. The selected automated suite reported 30 passing tests; an older check-in test logged a scheduling TypeError, so the suite alone is not proof of integration. External booking, real inventory enforcement, payment verification and production readiness remain unverified. Unresolved review visibility after checkout needs explicit verification. The available source copy predates some Windows changes; reconcile with the current checkout before editing integration code.

## First build: shared inventory and front desk

- Let management configure approved policies, room/unit types, capacity, currency and rates once. Limit changes to authorised staff and record who changed what and when.
- Give reception one register for arrivals, in-house stays and departures. Use existing guest and reservation details at check-in; enter a walk-in once. Hotels and apartments use the same lifecycle; one apartment may be one bookable unit.
- Separate physical occupancy, housekeeping readiness and maintenance. Confirmed checkout frees occupancy and marks the room for cleaning. A dirty room cannot be checked in now, but can be sold for future dates if otherwise available. Maintenance blocks the affected dates.
- Check capacity over the entire date range in the property's timezone. Holds expire; confirmed reservations consume capacity. Use one concurrency-safe backend operation for desk and agent to allocate the last unit; a read-then-write availability check is insufficient. Separate allocation from check-in readiness.
- Preserve existing stays and their message/request history. Reconcile active stays against approved inventory before enforcing selection. Do not seed guessed hotel room data into live inventory.

## Demo room board and concurrency scope

Planned on 7 November 2026. Keep management setup; start with 12 synthetic units: 5 Standard, 3 Imperial, 2 Luxury, 2 Junior Suite. Uneven counts support category capacity and last-room conflict tests. Sample room numbers, dates and rates are not Nest Hotel data. Staff can add further approved rooms through setup later.

Front desk > Rooms is a grid of room number, category and current status, with reservation and privacy indicators shown separately. Selecting a tile opens a dialog with current room conditions, the linked guest or reservation, booking source, dates, verified payment status when available and the relevant action. Closing the dialog returns to the same grid. The grid does not expose guest details at a glance. Show permitted guest fields only inside the staff view.

A ready unit can start a walk-in check-in; a reserved unit reuses the reservation details and requires only verified arrival and confirmation. The WhatsApp agent can allocate an eligible unit through the shared reservation tool and the grid reflects the confirmed result. Reception confirms physical check-in for the first release; remote booking and arrival are separate states. Checkout moves the unit to needs cleaning; housekeeping uses one action to confirm readiness in the default workflow. Occupied, dirty and maintenance rooms are not offered for immediate check-in. Room readiness now does not guarantee availability over requested dates.

The guest-facing agent uses authorised PMS tools for features, date availability and quotes; never expose other guests' identities or internal notes. The room grid is a local-state planning preview. It does not persist bookings, send messages or prove concurrent allocation.

Agree the screen and data fields first, then implement shared room data and allocation rules before connecting the screen to live operations. Demonstrate booking concurrency with ten simultaneous synthetic requests for the same dates and one eligible remaining unit: at most one committed hold, clear results for all other requests, no duplicate holds on retry. Also test separate guests/dates progressing independently, delayed or failed tool calls, and no state leakage across conversations. Verify final database state and record observed response times before claiming capacity. This is a test target, not a measured production limit.

## Room-state palette and availability rules

Updated 7 November 2026. **Design agreed in conversation; backend enforcement pending.** Use the supplied legend as the visual reference and retain text labels alongside colour.

| Room-board label | Colour | Operational meaning |
|---|---|---|
| Vacant / Dirty | Amber | Needs cleaning after checkout |
| Vacant / Clean | Light blue | Optional: cleaned, awaiting a separate inspector; hidden by default |
| Vacant / Ready | Success green | Housekeeping confirmed readiness, or an authorised inspector approved it if inspection is enabled |
| Occupied / Clean | Dark blue | Guest is in-house and the room is tidy |
| Occupied / Dirty | Muted purple-grey | Guest is in-house and the room needs a refresh |
| Out of Order (OOO) | Danger red | Maintenance block excludes the unit from booking inventory for the affected dates |

Do Not Disturb is deferred for the first room board. If later added, use a separate privacy indicator on occupied rooms; it does not change occupancy, cleanliness or booking inventory. Reserved today and time-limited holds are separate booking indicators; they do not change the physical room state but block conflicting allocations.

The room-board overview shows a count for each enabled colour-coded state, plus vacant, occupied and out-of-order totals. Each room counts once. Reserved today is an indicator; show the ready-room breakdown so staff can distinguish physical readiness from an existing booking. Counts in the preview are synthetic.

On confirmed checkout, move the room to Vacant / Dirty. By default, housekeeping confirms physical readiness with one Mark ready tap, moving it straight to Vacant / Ready. For a property that explicitly enables a separate inspection, housekeeping instead taps Mark clean once and the authorised inspector taps Approve room once. Do not require one person to do both actions. The passage of time may flag delays but never marks a room clean or ready. After clearing a maintenance block, verify the room's readiness before assigning it.

Online and reception bookings share the same date-based inventory. Immediate check-in additionally requires a vacant, ready, in-service room and the correct assignment. Current occupancy or cleaning need alone does not permanently block future dates. Planned departure never replaces staff-confirmed checkout.

## Next build: controlled WhatsApp booking

Start with verified availability and quotes. Then add explicit guest confirmation and time-limited holds. Save the quoted rate and total on the hold or reservation; changing the base rate must not silently reprice a confirmed reservation. Requote an expired or invalid offer and request confirmation again. Treat payment as verified only by an approved payment source or authorised staff action. Agent tool calls are property-scoped, bounded and audited. On an uncertain write, recover the saved outcome before retrying. Escalate with the guest's dates, preferences and last confirmed state.

## Acceptance tests before a paid live pilot

| Scenario | Required result |
|---|---|
| Reception and WhatsApp attempt the last room for overlapping dates | Only one holds or books it; the other gets a clear alternative or unavailability |
| A guest confirms twice, or a provider event is replayed | One booking/hold and one intended confirmation |
| A GM changes a base rate | A new quote uses the approved rate; existing confirmed totals are preserved |
| A remote guest arrives | Reception uses the existing reservation and guest information |
| A room is dirty, occupied or blocked for maintenance | Immediate check-in is prevented; future date availability follows actual occupancy and maintenance rules |
| A guest says “I paid” | No paid status without verification |
| The model or channel fails | Staff can see and continue the request; the app never invents success |
| A user from property A tries to access property B | No cross-property access to guest, inventory or booking records |

Before live guest use, confirm supported WhatsApp operation, staff access and audit trail, tested backup restoration, and a manual reception fallback. Keep accelerated demo timing isolated from live operation.

## Commercial offer

Charge a one-time onboarding fee for inventory and policy setup, staff training and go-live. Charge a recurring fee per property for the agreed modules, hosting, monitoring and support. Define included messaging/AI usage and overages separately; scope migrations, integrations and custom work independently. Set the final quote after understanding room/unit count, direct enquiries, support coverage and channel costs. A pilot measures enquiry-to-booking conversion, response time and reception follow-up workload; do not promise revenue gains before measurement.

## Next implementation step

Reconcile the current Windows integration branch, then implement management room setup and the shared availability/assignment path for reception. Test conflicting allocations before enabling a WhatsApp booking write tool. Typo classification and duplicate-review improvements remain deferred.

## Implemented in the integration checkout — 7 November 2026

The first room-board slice is behind `ROOM_BOARD_ENABLED=true`. It adds an authenticated room list, GM room creation, one-tap Mark ready, maintenance actions, status totals and a room picker in the current guest workspace. A newly added room starts dirty. Check-in claims a ready, vacant, in-service room and creates its stay in one MongoDB transaction. Confirmed checkout closes the stay and releases its room as dirty in one transaction. An out-of-order room returns as dirty when maintenance clears it. The default board has no separate inspection step and no DND control.

Enable only on an isolated development database with MongoDB transaction support, such as an Atlas replica set. Add real inventory only after reconciling existing stays; setup rejects room numbers with unmanaged active stays. Keep the flag enabled while managed stays are active. The existing stay scheduler and guest-service routes are retained. No live database or WhatsApp messages were used for this update.

The responsive implementation starts with two room columns on phones and scales up at wider breakpoints. The portable preview uses the actual guest workspace components and synthetic, in-memory responses; its viewport control offers 320 px, 390 px and desktop widths. It does not validate live MongoDB or delivery behaviour. Browser-based layout verification could not be completed because the browser could not connect to the local preview server.

Verification: backend suite: 149 passed, 1 skipped. Frontend lint, TypeScript and production build passed. Portable preview bundle and width-switch script passed syntax and execution checks. Room lifecycle tests use injected storage/transaction fakes; check-in/checkout rollback and rejection behaviour passed under those fakes. A real replica-set race test, live browser audit across existing screens, date-based reservations, booking indicators, separate inspection configuration and automated remote booking are still pending. The source checkout does not include every change reported on the separate Windows branch; apply only the incremental room-board diff after checking it against that branch.

## Local pilot handoff — 7 November 2026

The room-board design was approved. The incremental patch applied cleanly to a reconstructed copy containing both the original WhatsApp integration and the follow-up stay-message update. Run `node --test backend/tests/room-inventory.test.cjs backend/tests/whatsapp-stay-messages.test.cjs backend/tests/job-worker.test.cjs backend/tests/whatsapp-request-flow.test.cjs backend/tests/task-completion.test.cjs` from the repository root. The combined run passed 32 tests; the older check-in fixture logged a scheduling TypeError because it does not stub the new scheduling service. The separate scheduler tests passed. The actual Windows checkout still needs a local patch check and live smoke test.

For the local pilot, set `ROOM_BOARD_ENABLED=true` in `backend/.env.whatsapp`, restart the WhatsApp backend and use synthetic rooms. Verify that a dirty room cannot be checked in; mark it ready, check in a test guest, confirm checkout, and verify the room returns to dirty. Check the same flow on a phone-sized viewport and desktop before adding date-based reservations.

## Demo room preload — 7 November 2026

Starting the WhatsApp backend with the room board enabled now preloads the agreed 12 sample rooms in the `sesora_whatsapp_lab` development database: 5 Standard, 3 Imperial, 2 Luxury and 2 Junior Suite. Room 101 starts dirty on a fresh lab. The preload only inserts missing rooms; it does not change existing room states, create stays, or send messages. Room numbers with an existing active or extended stay are skipped. Production and other databases are excluded.

Demo journey: **Rooms → 101 → Mark ready → Check in → Stays → Confirm checkout**. Room 101 returns to **Vacant / Dirty**. If a property opens a new room, the existing GM path is **Rooms → Add room → room number and category → Add room**. The new room starts dirty and becomes available for immediate check-in after housekeeping marks it ready.

Verification: `node --test backend/tests/demo-rooms.test.cjs backend/tests/room-inventory.test.cjs backend/tests/whatsapp-stay-messages.test.cjs` passed 17 tests in the reconstructed integration with the room board and stay-message updates. Preload tests use injected models; a live run on the Windows lab is pending.
