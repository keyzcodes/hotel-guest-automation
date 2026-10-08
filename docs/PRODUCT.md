# Hotel Guest Ops — product agreement

Recorded 7 October 2026.

## Purpose
Reduce front-desk repetitive work, forgotten guest requests, and unresolved guest problems. Sell a lightweight standalone product to hotels in Nigeria without assuming their PMS has an API. The first hotel has not been interviewed: only its exterior/name was photographed. No hotel operations or service facts are verified.

## Agreed immediate demo
Staff enters name, phone, room, checkout date/time and submits once. The system sends a personalised welcome with configured hotel information, schedules a settling-in check, departure reminder, feedback and an equal public-review invitation. Incoming Telegram messages appear live on the dashboard; operational requests become tracked tickets. Telegram is first; WhatsApp is a later integration with its own setup and verification. Telegram test recipient must be explicitly linked after starting the bot. QR onboarding is optional, not a required guest registration form. Manual entry is accepted for the demo; avoiding duplicate PMS entry remains a hotel-discovery requirement.

## Timing and human actions
Proposed accelerated schedule: welcome immediately, pulse at 30 seconds, reminder at 90 seconds, simulated checkout at 120 seconds, then feedback. Timing is configurable and visibly labelled demo mode. Normal pulse is 15–20 minutes after actual check-in; departure reminder is 30 minutes before confirmed departure. Live checkout requires a verified event or staff confirmation, not simply elapsed time. Extensions require staff approval and reschedule pending jobs. Physical services require humans and accurate progress updates.

## Dashboard
Compact check-in form, live conversations/request queue, automation timeline with honest send/failure states. Staff sees actionable exceptions first. Preserve all conversations. Support different arrival times and multi-week stays. A 200-room production capacity claim requires load and provider-limit testing.

## AI responsibilities
Hotel-grounded FAQs, intent classification, multiple task extraction, complaint triage, summaries and suggested replies. Save incoming messages before AI work. On uncertainty or failure preserve the request for human review. AI does not invent hotel facts, authorise extensions, confirm checkout, or claim work has happened.

## Later scope
PMS integration/import options, smart-room devices, upsells, advanced analytics and SMS escalation. Smart-room work came from a real hotel enquiry but development has not been approved. No power-control claims in the standalone product.

## Constraints
Zero upfront project budget before client revenue. Free local prototype does not establish free reliable commercial hosting. Public review invitations are not restricted to positive ratings. No guest app download.

## Automation and evidence
- Reduce total staff workload, including data entry and exception handling.
- Routine guest messages run automatically after a single check-in action.
- Record message attempts, failures, available delivery receipts, handoffs,
  ticket acknowledgement, completion, and guest confirmation.
- Calculate metrics from stored records; AI explains those metrics.
- Label time savings as estimates until validated against a hotel baseline.

## Management visibility
- GM overview shows guest service activity recorded in this system.
- Daily summaries highlight unresolved issues and decisions needed.
- Weekly summaries highlight recurring issues and service trends.
- Urgent exceptions trigger alerts without waiting for a digest.
- Remote access requires deployment and appropriate access controls.

## Hotel discovery and commercial options
- Observe the hotel's existing guest workflow and software capabilities.
- Check available modules, actual usage, duplicate entry, and API access.
- Offer configuration/training when existing software meets the need.
- Offer standalone automation when it reduces total operational effort.
- Offer PMS integration when technically and commercially feasible.
- Validate value through a pilot; do not assume the PMS lacks features.

## Verification checkpoint
- Backend node-cron dependency removed after old scheduler removal.
- Frontend lint, TypeScript check, and production build passed locally.
- Production dependency audit: zero reported vulnerabilities.
- Full dependency audit: unresolved braces issue in ESLint tooling.
- Guest automation and live integrations are not yet verified.
