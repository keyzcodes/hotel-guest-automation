# Guest AI interpretation — demo phase

Goal: reduce staff workload by separating conversation from actionable requests. Gemini API access was verified by the developer on 10 October 2026 using gemini-3.8-flash. This update enables real interpretation; semantic behavior must be checked with Telegram after installation.

## Mechanism

1. grammY receives text; guestMessageService saves the inbound Message first with its unique Telegram provider key.
2. Exactly one active/extended booking must own the chat. Guest/room identity comes from that booking.
3. Fetch the latest 20 prior messages for the same booking and up to 20 open tickets, excluding unconfirmed outbound messages. Phone number and chat ID are not sent to Gemini. Hotel configuration is supplied as the knowledge source; current hotel amenity values are demo data until verified.
4. guestAiService sends separate system instructions and a JSON data payload to the configured Gemini model. SDK structured output uses responseMimeType and responseJsonSchema, supported by installed @google/genai 2.24.0. Request timeout is 20 seconds; one retry for selected transient HTTP statuses.
5. Validate action enum, category, required strings, response length, and FOLLOW_UP target against supplied open tickets. This is structural/action validation; it does not guarantee every natural-language answer is factually correct.
6. Execute one action and record aiAction/ticketId on the inbound message. Send and save a truthful response, tracking outbound PENDING/SENT/UNKNOWN. SENT means provider accepted, not read by guest.
7. Existing Mongoose hooks publish Socket.IO record changes. Dashboard reloads chat and requests; follow-ups appear on the request details and compact conversation request card.

## Actions

- ANSWER: no ticket, short greeting or answer grounded in hotel configuration/booking.
- CLARIFY: no ticket, ask guest to disambiguate.
- CREATE_REQUEST: pending ticket with backend-selected booking identity and raw guest message. No automatic staff acceptance.
- FOLLOW_UP: append raw guest message and Message ID to guestUpdates on an existing open ticket for the same stay. Keep original requestText and status; no new ticket. A guest preference is pending staff review, not a promised service time. If ticket closes concurrently, ask for clarification.
- HANDOFF: pending request for staff decisions/unknown facts; no payment, extension approval, cancellation approval, or checkout status changes.

TaskTicket.sourceMessageId has a partial unique index applying only to ObjectId values; old tickets without source IDs remain valid. Upsert prevents repeated task creation for the same source message. FOLLOW_UP query also prevents duplicate notes from that message.

## Files

- guestAiService.js: model prompt, structured output, validation, explicit offline stub.
- guestMessageService.js: storage, trusted booking lookup, action execution, recorded replies/fallback.
- telegramService.js: delegates text handling; existing welcome/pulse/review/callback/staff senders remain.
- Message.js: aiAction and linked ticket ID for inspection.
- TaskTicket.js: source-message uniqueness and guestUpdates history.
- Frontend page and ChatWorkspace: display saved follow-up notes.
- backend/tests/guest-ai.test.cjs: 13 unit tests with fake model/database behavior; no API key or live messages required.

## Limits

This is still a local demo without staff authentication/hotel isolation. Existing mock-created tickets are preserved, not silently removed. Older callback and welcome/pulse senders are unchanged and are not yet fully persisted/connected to business state. Timed jobs, SLA escalation, multi-action messages, autonomous department dispatch, and GM summaries are not implemented by this phase. Multiple unrelated requests are handed to staff rather than executing several tools. Twenty-message/ticket context is bounded and is not unlimited memory. Unknown/ambiguous answers may require staff; model answers can still be wrong despite grounding instructions. Live Gemini failure preserves the message and attempts an idempotent General Inquiry fallback ticket. No claims of exactly-once provider delivery or 200-room load testing.

## Installation and checks

Stop backend and frontend. Run install-ai.ps1 from the extracted payload. It validates known source markers before editing, runs tests, backs up affected source and .env outside the repository, adds files and schema fields, preserves existing socket hooks and staff exports, updates USE_MOCK_AI=false and GEMINI_MODEL=gemini-3.8-flash without printing credentials, checks syntax/lint/types. It adds no package dependencies.

Automated checks passed: 13 backend unit tests, transformed Telegram syntax, frontend lint, TypeScript/production build in snapshot Next 16.3.6. Local Turbopack cache initially failed; deleting generated .next cache produced a successful clean build. The installer checks the user's current frontend version; no package versions changed.

Live test: 'Hi' should create no ticket. Ask Wi-Fi question (answer must match hotel config). Request a new physical item with no matching open ticket; expect one pending ticket. Follow up mentioning the same item and a different preferred time; expect a note on that ticket, no extra ticket, and acknowledgement pending staff review. If old duplicate mock tickets make target ambiguous, clarification is correct. Ask to extend stay; expect staff handoff, with checkout time unchanged. Inspect MongoDB Message.aiAction/ticketId and TaskTicket.guestUpdates for evidence. Do not delete old history as part of this test.

Rollback: backup path is printed. Restore affected source and .env from that folder and restart. Newly added modules can remain unused after restoring Telegram delegation; new schema fields are additive and no existing records were removed.
