# Hotel system — working picture and roadmap
Updated: 6 November 2026

## Goal
Build a unified hotel system in stages: internal guest operations, PMS records, then an external WhatsApp AI agent using the same validated backend operations. Finish understanding and verifying the current flow before polishing the UI or classification.

## Verified through user-observed local tests
- Hotel WhatsApp connects using its saved session.
- Reception can check in a guest with name, room, WhatsApp number and planned checkout.
- Sequential check-in rejects a WhatsApp number already assigned to an active stay; after checkout the number can be reused.
- A new check-in sends a welcome and saves it in the conversation.
- Demo mode sends the pre-checkout reminder about two minutes after check-in, without changing the actual checkout date.
- A correctly spelled towel request creates a Housekeeping pending ticket and sends an acknowledgement.
- A prior live test confirmed staff completion sends a WhatsApp notification.
- Reception can confirm checkout through the existing endpoint. Full lifecycle and reminder-cancellation checks remain incomplete.
- 30 selected automated tests passed locally. One older check-in test logged a scheduling TypeError despite passing; its fixture and assertion coverage require review. A clean test summary alone is not proof of scheduling integration.

## Observed behaviour deferred for improvement
- “Please send towes” created a General Inquiry/reception review instead of Housekeeping.
- A later corrected towel request created a Housekeeping ticket but left the original review open.
- Closing the review required a staff reply, creating additional staff work for the same issue.
- Improve typo handling, correction matching and duplicate review resolution later.
- Review fallback wording: it should not promise prompt assistance without staff acceptance.
- Suppress encryption-session debug output containing private key material. Never publish these logs.
- Remove temporary inbound diagnostic logs if added and no longer needed.

## Implemented or inspected, not fully live-verified
- Scheduled WhatsApp jobs use unique keys and outbound claims to avoid repeat sends.
- Disconnected transport waits; uncertain submissions are not automatically resent.
- Worker checks ended/overdue stays and obsolete reminder times; narrow concurrent checkout/send race remains.
- New scheduler handles welcome and pre-checkout only. Existing stays do not receive retroactive welcome jobs.
- Scheduling failures can leave saved stays without complete automation; reconciliation and staff visibility are pending.

## Still required for the internal guest-service product
1. Verify the current guest's request completion, checkout, history and stopped reminders together.
2. Add stay extension and room-change operations with history and rescheduling.
3. Prevent occupied-room conflicts and concurrent duplicate active stays at the database level.
4. Add settling-in/pulse messages with meaningful response handling.
5. Add post-checkout feedback/rating flow with correct stay matching.
6. Add daily GM summary: received, completed and outstanding requests; distinguish guest operations from financial reporting.
7. Define human takeover and return-to-automation behaviour.
8. Verify unresolved requests survive checkout and a return visit gets a separate stay.

## PMS expansion
A room number on a stay is not yet a room inventory or a reservation system.

### Room inventory
Create authoritative room records, categories and approved rates. Track occupancy separately from housekeeping readiness and maintenance. Reception uses this record for walk-ins.

### Reservations
Add dated arrivals/departures, holds and confirmed reservations, cancellation/no-show rules and atomic conflict protection. Availability must consider overlapping dates, not only current room status.

### In-house operations
Arrival becomes an active stay. Support extensions, room moves, departures and housekeeping turnover. Keep guest profiles separate from individual stays; historical conversations and requests stay attached to their visit.

### Money
Add charges, confirmed payments, balances, refunds and receipts with audit records. Decide explicitly how booking payments map to existing departmental reporting to avoid double-counting. Existing reporting was demonstrated in the Le Harve branch; it is disabled in the current WhatsApp lab and not yet verified as integrated.

### External agent
Only after reliable internal records exist, enable external WhatsApp enquiries and approved tools for availability and booking holds. The AI calls authorised backend operations; it does not write arbitrary database changes or infer payment completion. Voice calls are a separate later scope.

## Next step
Complete one live internal journey: request -> completion notification -> confirmed checkout -> history. Do not start PMS reservations during this check. Then establish room inventory as the next PMS foundation while retaining the working guest-service flow.

## Scope and limits
Current work is local development on feature/whatsapp-integration with the isolated lab database. It is not a completed full PMS or a production rollout. Keep demo timing separate from normal operations. No new UI redesign is requested in this stage.

## Verification update � 6 November 2026
- User reported passing the completion notification, confirmed checkout and conversation-history checks.
- Unresolved-review visibility after checkout still needs explicit confirmation.
- Next planned stage: room inventory, with occupancy separate from cleaning and maintenance.
- Typo classification and duplicate reception reviews remain deferred.
