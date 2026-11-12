# Hotel system — working picture and roadmap
Updated: 10 November 2026

## Gemini to Terra failover (10 November 2026)

Gemini remains primary. For pre-stay turns, the existing retry slot switches to OpenAI GPT-5.6 Terra on a rate limit, timeout, or retryable server response when OpenAI failover is enabled. Both attempts share the original time budget. Booking actions run only after a validated interpretation and run once. Failed optional wording generation can still return the backend result. When both providers fail, the existing staff-review path handles the guest message.

Keep guest failover off until the eval succeeds. Add `OPENAI_API_KEY` to the local `backend/.env.whatsapp`. Set PowerShell's `$env:SESORA_EVAL_PROVIDER = "failover"` and run `node --env-file-if-exists=backend/.env --env-file-if-exists=backend/.env.whatsapp backend/scripts/eval-booking-agent.cjs 1 recovery`. The eval simulates Gemini returning 503 and makes real Terra requests with synthetic guest data. Set the mode to `terra` to exercise Terra directly, or remove it to return to the default Gemini eval.

To opt in for actual guest turns after verification, set `WHATSAPP_OPENAI_FAILOVER_ENABLED=true` in the same local env file and restart WhatsApp. The default backup model is `gpt-5.6-terra`. `WHATSAPP_OPENAI_BACKUP_MODEL` can override it.

The backend suite passed 195 tests with one finance integration test skipped. MongoDB tests ran against an isolated replica set. Provider responses were simulated, including failover for 503, 429 and deadlines. Live Terra verification is pending an OpenAI API key.

## Kudu booking workflow and evals (10 November 2026)

The lab workflow saves one open enquiry per WhatsApp sender in MongoDB. The agent collects dates, party size, room preference when supplied, and guest name. It checks live room inventory and quotes from the demo rates in `hotelSettings`. A quote expires after 30 minutes and leaves the room available to others. On acceptance, the backend rechecks inventory and price. A changed or expired offer requires new acceptance.

Reception reviews complete requests in **Chats → Booking requests**. It can confirm, decline, or ask a question. Staff explicitly attest to deposit verification where required. Confirmation rechecks inventory, creates one PMS reservation and queues one WhatsApp confirmation in the same transaction. A staff question pauses the request until the guest replies. If a room sells out at final approval, reception can ask for another room or dates and the agent can prepare a new offer. WhatsApp submission status is visible on the card. An ambiguous send is surfaced for staff review.

- Lab only. In `backend/.env.whatsapp`, set `WHATSAPP_BOOKING_WORKFLOW_ENABLED=true`, `WHATSAPP_AVAILABILITY_ENABLED=true`, and `ROOM_BOARD_ENABLED=true`. Start with `npm --prefix backend run start:whatsapp`. A live Gemini key is needed for conversational interpretation. The demo hotel record is seeded only if missing. Keep the flag off outside the lab.
- Backend tests: `node --test backend/tests/*.test.cjs`. Set `PMS_TEST_URI` to a test replica set to run database integration tests against isolated disposable databases.
- Repeat the live model evals with `node --env-file-if-exists=backend/.env --env-file-if-exists=backend/.env.whatsapp backend/scripts/eval-booking-agent.cjs 3`. The evals use synthetic messages and simulated inventory. They make live Gemini calls, without messaging guests or writing hotel records.
- The existing reception check-in, in-house request and checkout paths follow a confirmed reservation. This update uses structured hotel facts and direct Node.js tools. General handbook retrieval, vector indexing, MCP, and property selection across several live hotels remain future work.

Verification: the backend suite passed 185 tests against a local MongoDB replica set. One unrelated finance integration test was skipped. The new booking test used synthetic guests and a WhatsApp send stub, and verified duplicate acceptance, deposit gating, concurrent approval, a sold-out conflict, and the outbound queue. Frontend lint and build passed. The user subsequently reported 9/9 live Gemini eval journeys passed on Windows. A live WhatsApp quote arrived, but the conversation mishandled a vague enquiry, price question and stay-length change. Reception approval and outbound booking confirmation are still pending a live check.

### Natural WhatsApp conversation (10 November 2026)

This update builds on the original booking workflow patch. The transcript-specific follow-up was not installed on Windows. The model interprets the message with saved booking context and supplies a typed action or its own conversational reply. The workflow calculates revised dates, live inventory and prices. For eligible tool results, a second model pass can rephrase the backend result within the remaining response budget. The backend checks numeric literals and rejects common unsupported commitments, preserves the quote conditions, and falls back to its own result when a draft fails those checks or the deadline. The checks do not independently verify every semantic claim. Staff actions and booking statuses retain authoritative backend wording.

The repeated Gemini eval adds vague enquiries, corrections, a date question, a quote challenge, and both absolute and relative duration changes. The backend suite passed 188 tests against a disposable replica set. One unrelated finance integration test was skipped. The updated Gemini eval and live WhatsApp retest still need the user's lab credentials and connection.

### Live Gemini eval diagnostics (10 November 2026)

The Windows three-round run passed direct and informal requests. One recovery journey failed its next-step assertion without logging the specific turn, then Gemini returned HTTP 429 for nine journeys. The old summary counted provider-blocked journeys as failures. The recovery issue needs a targeted live rerun to identify the exact mismatch.

The runner now spaces turns 24 seconds apart by default, stops at the first 429, and reports passed, failed, provider-blocked and unrun journeys separately. The default is one round. Append `1 recovery` to the existing eval command to run the recovery journey alone. Behavior failures print the synthetic message, reply and failing assertion. The interval can be set with `SESORA_EVAL_TURN_INTERVAL_MS`; pacing does not restore depleted project quota. This is an eval-only change.

`node --test backend/tests/eval-booking-agent.test.cjs backend/tests/booking-workflow.test.cjs` passed 10 tests with stubbed Gemini responses. Live rerun pending.

## Current WhatsApp booking enquiry workflow

On 9 November 2026, the user verified that WhatsApp requested dates, returned available room categories and referred a booking request to reception. The original inbox listed those messages separately under Guest matching needed.

Chats now groups a sender's booking messages when they arrive within 30 minutes of each other. A card shows the latest valid dates and Awaiting reception when there is a handoff. Earlier availability messages and recognizable booking handoffs are included. Unrelated unlinked messages remain in Guest matching needed. Reception replies from the hotel WhatsApp and confirms the booking through Rooms → Reservations. Completion of an enquiry is not yet tracked.

Verification: `node --test backend/tests/*.test.cjs` passed 171 with two live MongoDB tests skipped. `npm --prefix frontend run lint` and `npm --prefix frontend run build` passed. Browser verification was blocked by the Chromium package installation timing out. The live grouped inbox and availability comparison after an inventory change are pending.

## Jaden demo readiness (9 November 2026)

The room board, dated reservations and WhatsApp guest service provide the foundation for a controlled front-desk demo. The current demo build still needs one live run that joins those workflows.

1. Use synthetic inventory and a test WhatsApp number. Ask about availability, provide dates and ask to book. Verify the messages appear as one Booking enquiry without requiring an active stay. Reception confirms the reservation through Rooms > Reservations.
2. Compare WhatsApp availability with reception for the same dates after the reservation consumes the last eligible unit. Verify an overlapping reservation is rejected without creating a second booking.
3. Check in from the saved reservation, send a towel request on WhatsApp and complete it in reception. Confirm checkout moves the room to Needs cleaning and the staff readiness action returns it to Ready.

Use one guest and one room through the rehearsal. Record the branch, observed results and any mock or skipped step before showing the full sequence live. Payment verification, invoices, automatic WhatsApp booking and manager reports are outside this demo scope.

### Agent capability check (9 November 2026)

The checked-in guest interpreter receives the sample hotel facts in `backend/src/config/hotel.js`. The WhatsApp pre-stay path uses a separate rule-based availability flow. The proposed per-property agent handbook and autonomous booking flow are not wired into that path.

`node --test backend/tests/room-inventory.test.cjs backend/tests/booking-enquiry-inbox.test.cjs backend/tests/whatsapp-request-flow.test.cjs` passed all 15 tests. The check-in fixture emitted a scheduling TypeError warning, so this run does not verify scheduling. A separate replay of the availability handler with simulated inventory showed a new inventory read after a category was removed. The replay did not recognize a natural Friday booking question or a Friday-to-Sunday date reply, and referred explicit booking confirmation to reception. This replay did not use a live hotel database or WhatsApp session.

In a follow-up Windows lab run, the user reported no replies. Their logs showed successful MongoDB and WhatsApp connections, inbound saves, and four availability handler runs that ended as unlinked stays. The supplied logs do not include the message text. Under the current code, that outcome after availability handling means the handler returned no reply and the message went to unlinked review. Retest with the known supported booking phrase and explicit date range to distinguish classifier coverage from outbound delivery.

### Conversational pre-stay WhatsApp (9 November 2026)

With WhatsApp availability and the room board enabled, the pre-stay handler uses the configured Gemini model for ordinary conversation and booking intent, with the last 12 same-sender unlinked messages from a 30-minute window. The backend validates dates and formats availability from a fresh inventory read. Known public hotel facts come from the sample hotel configuration. Pre-stay context excludes Wi-Fi credentials. Reception still confirms bookings and reviews explicit handoffs. Failed AI calls reply with a staff-review acknowledgement instead of leaving the sender without a response.

The backend suite passed 175 tests, with two live MongoDB tests skipped. The new tests use injected model and inventory responses and a WhatsApp send stub. Live Gemini, MongoDB and WhatsApp verification is pending on Windows. Set a Gemini API key and use live AI rather than mock AI when testing.

### WhatsApp live-test follow-up (9 November 2026)

The user reported repeated fallback replies. Their live logs show successful WhatsApp sends and repeated Gemini deadlines near eight seconds. One provider error did not include an HTTP status. The console also exposed session key material via direct libsignal logs. No key material is retained in this note.

The reliability patch suppresses the known libsignal session-object log messages, reports a sanitized provider status and a distinct fallback outcome, and gives pre-stay chat a separate Flash-Lite model and 12-second response budget. Explicit lab relinking uses `npm --prefix backend run start:whatsapp -- --relink` after stopping the backend and unlinking its device in WhatsApp. The flag replaces only the lab's saved connection session after obtaining its lease. Normal restarts omit the flag.

`node --test backend/tests/*.test.cjs` passed 176 tests with two live MongoDB tests skipped. Live relinking and the new model's responsiveness still need verification on Windows.

The user subsequently reported two normal replies to social messages, followed by the pre-stay AI fallback on two booking turns. The reported fallback text comes from the pre-stay interpretation handler, distinct from the room-inventory error reply. The user supplied a sanitized provider HTTP 504 for a booking turn. The pre-stay handler now retries eligible transient failures once within a single shared 12-second AI budget by default. It preserves the guest messages and omits previous temporary-failure replies from model context. Local tests verify retry recovery, live inventory lookup after recovery, and bounded attempts. Live recovery on the Windows setup remains pending.

## Read-only WhatsApp availability tool (10 November 2026)

The Kudu demo can opt into Gemini function calling with `WHATSAPP_AVAILABILITY_TOOL_DEMO=true` in `backend/.env.whatsapp`. The booking workflow must already be enabled for the demo database. Restart the WhatsApp backend after changing the flag. Unset it or set it to `false` to restore the standard pre-stay booking workflow. The in-stay path is separate.

The agent makes one Gemini call per turn. For a conditional request, the tool receives the category preference order and the backend offers the first available option. For a comparison request, the backend shows the requested categories. Both use one current PMS lookup and the property's configured rates and capacities. An inventory error and a provider failure are reported separately. The demo only offers availability and prices.

A successful lookup saves the dates, party size and discussed categories on the inbound message. The demo can reuse this context from the recent conversation (up to 12 messages within 30 minutes). For a same-stay alternatives request the tool checks the remaining categories and shows available options. Changing the dates or party size clears the category exclusions. The demo does not create holds, quotes, or reservations.

The user verified the original live tool on Windows. Imperial became unavailable when taken out of service and the agent offered Luxury at ₦220,000 for two nights. Of six messages, three reached the PMS and three received a Gemini 503 before the lookup. The original optional summary call also failed twice after a successful lookup. This follow-up removes that call. A 503 on the initial call can still interrupt the reply.

Local verification: `PMS_TEST_URI=<test-replica-set-uri> node --test backend/tests/*.test.cjs` passed 196 tests with one finance integration test skipped. The availability integration test uses real MongoDB with a stubbed Gemini and WhatsApp transport. It verifies Imperial only when available, Luxury as fallback, both unavailable, then a Standard offer for the same stay after an intervening simulated 503. It makes one model call per turn and creates no reservations or booking enquiries. Live verification of this follow-up patch is pending.

For the live demo, send from a number without an active stay. Ask for Imperial for two future nights for one guest, with Luxury only if Imperial is unavailable. Mark the last available Imperial room out of service and repeat. Then mark the last Luxury room out of service, repeat, and ask “no alternatives?” An available Standard or Junior Suite should be offered using the original dates. The flag and startup command stay the same.

### Availability date follow-ups (10 November 2026)

The user reported an unavailable Junior Suite reply for 22–24 November, followed by a request to repeat dates and guest count when asking about 23–24 November. The supplied log ends with CHECKED and INVALID_REQUEST, while separate earlier attempts received provider HTTP 503. The old INVALID_REQUEST log did not identify which fields failed validation, so it cannot establish the exact rejected arguments.

Context reuse now covers changes to dates, guests or categories within the same enquiry. Gemini explicitly marks whether to reuse the last stay. Node.js merges only omitted fields, preserves the saved category selection and preference order, then queries current PMS availability for the resulting dates. Fresh enquiries collect their own details. Previously saved context remains supported by using its discussed category list when the newer selection fields are absent. The existing 12-message, 30-minute context window applies.

Validation logs now include a reason and missing field names without guest text or tool argument values. Clarification requests name missing details. This update continues to use one Gemini call per message; provider 503 failures on that call remain unresolved.

Automated verification: `PMS_TEST_URI=<test-replica-set-uri> node --test backend/tests/*.test.cjs` passed 199 tests with one finance integration test skipped. Real MongoDB integration with stubbed Gemini and WhatsApp verifies a Junior Suite reservation rejects an overlapping request and accepts a date-only follow-up after the reserved departure, retaining one guest and the selected category. Unit tests cover old context, conditional preference order, new enquiries, invalid dates and missing details. Live Windows installation and Gemini verification of this correction remain pending.

### Latest explicit dates take precedence (10 November 2026)

The user observed an explicit request for 22–24 November answered as 23–24 November, followed by the same 23–24 reply to a date-change follow-up. The previous update merged omitted fields but still trusted a date supplied incorrectly by Gemini. Raw tool arguments for the live failure were not logged.

The availability handler now independently recognizes a single explicit ISO or day/month-name range in the latest guest message and applies those dates before validation and the PMS query. The model is also instructed to give the latest message precedence over history. Recognized invalid dates are rejected instead of falling back to saved dates. Saved guest count and category continue to be reused for a marked continuation. An omitted year uses the model's resolved year, then the continuing saved stay, then the current WAT year. Explicit years take precedence.

This guard covers common explicit ranges including ordinal days, month abbreviations and different months. Negation or multiple ranges are left to Gemini to interpret; other natural date expressions continue through Gemini. It is a targeted date safeguard, not a guarantee of perfect interpretation for every wording. Provider HTTP 503 failures remain unresolved. The privacy-safe availability log includes latestMessageDates to show when the explicit range guard ran.

Automated verification: `PMS_TEST_URI=<test-replica-set-uri> node --test backend/tests/*.test.cjs` passed 201 tests with one finance integration test skipped. Unit tests deliberately return stale model dates for the user's two messages and verify the requested ranges reach inventory in order. MongoDB integration seeds a real reservation, forces stale model arguments, verifies the overlapping latest dates are unavailable, and verifies the following date change is available with context persisted in Message. Gemini and WhatsApp are stubbed. Live installation and retest remain pending.

### X community feedback implementation (10 November 2026)

Sami suggested reminding a returning guest where they left off before asking another question. Mr Indie Hacker suggested testing duplicate confirmations. Nath's comment was positive feedback about WhatsApp-to-front-desk coordination and did not request a separate feature.

The read-only Gemini availability tool set now includes getEnquiryProgress. When selected for a resume or recall request, it returns the saved category, dates and guest count before asking whether to recheck availability or change the stay. It reads the latest structured availability snapshot for this WhatsApp chat from MongoDB, independently of recent chat history. This supersedes the earlier 12-message and 30-minute limit for saved stay recall. Recent free-text model history remains bounded. The recap identifies a past check and does not claim current availability or a reservation. Availability requests still query the PMS. Normal booking status replies also include saved stay details before the next question.

Existing booking safeguards already prevent repeated guest acceptance from creating another enquiry or reservation after submission or confirmation. Reception confirmation uses a version check and commits the reservation, enquiry decision and outbound message in one transaction. No new reservation-writing capability was added to the availability demo.

Automated verification: `PMS_TEST_URI=<test-replica-set-uri> node --test backend/tests/*.test.cjs` passed 203 tests with one finance integration test skipped. An actual new Node process resumes a saved availability enquiry after its snapshot is moved two days into the past and fourteen unrelated messages are inserted. The reply recalls the same stay without querying or announcing fresh availability. Another new process repeats acceptance after confirmation while spare inventory exists; concurrent repeated acceptances and the restarted acceptance return the original reference. There is still one guest enquiry, one reservation and one queued confirmation for that booking. Gemini interpretation and WhatsApp transport are stubbed in these tests. Live Windows patch installation and resume testing remain pending. Initial-call provider HTTP 503 errors remain unresolved.

### Bounded native Gemini retries (10 November 2026)

A user-reported attempt to resume an enquiry failed with provider HTTP 503 after approximately 2.7 seconds, before the recap tool ran. The configured AI budget was 20 seconds. The failure did not verify or disprove saved-context recall.

The shared model wrapper now supports up to two explicit application retries for HTTP 429, 503 and 504. The native availability/recap path enables both retries. Backoff is approximately 300–400 ms and 600–700 ms. All attempts and waits share the existing WHATSAPP_PRE_STAY_TIMEOUT_MS budget. Each SDK request is passed the remaining budget, subject to its ten-second minimum HTTP timeout, while the outer local timer cancels the active request at the true overall AI deadline. Late responses cannot reach tool execution.

SDK retry attempts remain set to one. Structured callers keep the wrapper's zero-retry default because their pre-stay handler already has a separate bounded retry policy; these policies are not stacked. Permanent errors and local deadline expiry propagate immediately. Retry-After and Google RetryInfo delays are respected when present, and a retry is skipped if the indicated wait would leave under a second for inference. Sanitized GEMINI_RETRY logs show status, retry count, delay and remaining time. GEMINI_RETRY_SKIPPED identifies insufficient budget.

Automated verification: `PMS_TEST_URI=<test-replica-set-uri> node --test backend/tests/*.test.cjs` passed 209 tests with one finance integration test skipped. Tests simulate 429/503/504 recovery, repeated overload, permanent errors, long provider retry delays, cancellation at the shared deadline, one PMS execution after recovery, and recovery into the saved-enquiry reminder. The suite also runs the MongoDB reservation and restart tests. Google inference and WhatsApp delivery are simulated. Live Windows installation and recovery testing remain pending. A continuing outage or exhausted quota can still reach the existing fallback. Retry success is not guaranteed.

### WhatsApp typing and waiting feedback (10 November 2026)

The approved UX update adds chat-specific typing presence and one delayed progress message while a verified WhatsApp request is actively being handled. Activity starts after inbound deduplication and stay-routing checks. It covers pre-stay availability and in-stay requests that receive an automatic response. Review-only and ambiguous stay matches do not start it.

The transport sends composing presence when processing starts and refreshes it every four seconds. After five seconds, a still-running request sends “Thanks for waiting. I’m checking that for you.” exactly once. Fast replies finish without a progress message. The progress message is saved through the normal outbound record/send/confirm flow under a distinct PROGRESS:<inbound-id> idempotency key. The final reply retains its AUTO:<inbound-id> key. Uncertain progress sends are marked UNKNOWN and are not retried.

Completion cancels timers and queues paused presence. If a progress send has already started, the final reply waits for it to settle so the messages remain in order. Presence sends run independently of the final reply. A connection close, fatal transport failure or shutdown aborts active activity controllers and clears local timers. Remote indicator clearing after disconnection remains best effort because the socket is unavailable. No artificial delay is added to fast replies.

Automated verification: `PMS_TEST_URI=<test-replica-set-uri> node --test backend/tests/*.test.cjs` passed 217 tests with one finance integration test skipped. New fake-clock tests cover fast and slow responses, one progress message, disconnect cancellation, in-flight send ordering and presence/send failures. Message-processing tests verify separate persisted progress/final records, duplicate-event suppression, uncertain-send recording and review-only exits. Existing MongoDB reservation, recovery and restart tests pass. Baileys presence delivery and the phone display require live Windows verification. Gemini provider reliability remains a separate pending live test.

### Typing-only WhatsApp feedback (11 November 2026)

The user observed the saved Junior Suite recap working live after a greeting, and disliked the automatic “Thanks for waiting” message. They approved removing that message while retaining typing presence.

The delayed progress timer and progress-message send have been removed. Active requests show composing presence, refreshed every four seconds, then send their completed answer. Completion, disconnect and shutdown still cancel typing activity. The normal outbound record keeps its original AUTO:<inbound-id> idempotency key. Past progress messages remain historical conversation records. This supersedes the five-second progress behavior documented above.

Focused verification: `node --test backend/tests/whatsapp-response-activity.test.cjs backend/tests/whatsapp-request-flow.test.cjs backend/tests/response-flow-timing.test.cjs` passed 16 tests with none skipped. Fake-clock tests hold a request for twenty seconds and verify typing refreshes with zero outgoing waiting messages, one final reply, and no extra reply on a repeated event. Presence failure, disconnect cleanup and existing response timing checks pass. Phone verification of the removal remains pending. The user also reported a provider fallback on a subsequent “yes”; Gemini reliability remains unresolved.

### End-of-demo GM WhatsApp summary (11 November 2026)

The user requested a summary delivered directly to a configured WhatsApp number after the demo workflow, tested on their own personal number before setting the hotel's GM as recipient. The trigger is reception's existing Confirm checkout action.

Enable only in backend/.env.whatsapp with WHATSAPP_DEMO_GM_SUMMARY_ENABLED=true and WHATSAPP_GM_SUMMARY_PHONE set to the chosen personal test number. Phone normalization accepts a Nigerian local number or an international number with country code. Startup rejects a missing/invalid recipient and requires the WhatsApp lab database and room board. The default is disabled. Once personal-phone delivery is verified, the recipient can be changed for a new demo stay and the backend restarted. The recipient is captured when each summary is queued.

Room inventory checkout queues the summary in the same MongoDB transaction as checkout and room release, using DEMO_GM_SUMMARY:<stay-id> as the unique outbox key. Repeated checkout clicks do not queue another summary. Existing stays without a linked room report that the inventory record is unavailable. Summary content uses recorded guest/stay details, actual check-in and confirmed checkout times in WAT, counts of this stay's requests marked Resolved versus still open, and room state at checkout. It does not require Gemini. No request or payment results are invented.

The existing WhatsApp outbox delivery worker also handles these summaries, independently of whether booking enquiries are enabled. Disabled booking workflow messages remain excluded. The report is stored separately from the guest's stay conversation and addressed to the configured recipient. It remains queued while disconnected. Uncertain submission is marked UNKNOWN and is not retried automatically. GM_DEMO_SUMMARY with deliveryState SENT in the terminal means WhatsApp returned a message ID; verify actual receipt on the personal phone.

Automated verification: `PMS_TEST_URI=<test-replica-set-uri> node --test backend/tests/*.test.cjs` passed 217 tests with one finance integration test skipped. The new MongoDB test covers real stay creation, request counts scoped to that stay, concurrent and repeated checkout, atomic rollback when the recipient is invalid, queue persistence while disconnected, delivery to the configured test phone, and suppression of uncertain resends. WhatsApp delivery is mocked; no message was sent to a real number from this workspace. Live Windows patch installation, recipient configuration and personal-phone receipt remain pending.

### Approved Ambassador demo messages implemented (11 November 2026)

The user approved Ambassador Hotel branding, the welcome and pre-checkout previews, a guest farewell, and a GM report listing every room's current state. They explicitly requested implementation after earlier discussion had left these as previews. They also confirmed receiving the original GM summary on their personal WhatsApp after pressing Confirm checkout.

Configuration in backend/.env.whatsapp uses HOTEL_NAME=Ambassador Hotel — Demo for the workspace and HOTEL_GUEST_NAME=Ambassador Hotel for guest messages, report and model public profile name. The override also applies to an existing saved Kudu property profile without overwriting its rates, rooms or internal identifiers. The sidebar initial follows the displayed hotel name. The room inventory remains illustrative demo data.

Welcome and checkout reminder now use the approved branded text and Powered by Sesora footer. Both interpolate the recorded guest and room. The reminder formats the saved checkout date/time in WAT and renders midday as 12 noon. Demo scheduling remains two minutes after check-in; normal scheduling remains thirty minutes before recorded checkout.

Confirmed room-board checkout now queues a farewell to the stay's saved WhatsApp number and, when the existing GM demo flag is enabled, a separate report to WHATSAPP_GM_SUMMARY_PHONE. Both outbox records commit with checkout and room release. Keys WHATSAPP_FAREWELL:<stay-id> and DEMO_GM_SUMMARY:<stay-id> prevent duplicate queuing on repeated/concurrent checkout. The farewell uses the existing WHATSAPP_STAY_MESSAGES_ENABLED flag and works independently of the GM demo flag. The worker submits one queued message per poll, normally the farewell before the GM report. Uncertain sends are not automatically retried.

The GM report contains the triggering demo stay's recorded activity counts and a snapshot of all inventory rooms grouped as Ready, Occupied, Awaiting cleaning, and Out of service, using the same precedence as the room board. It dynamically lists room numbers and counts. It is not a daily aggregate of every guest's activities. Existing 103/402 test stays contribute to the room snapshot while activity totals describe the checked-out demo stay. Neither farewell nor report needs Gemini.

Automated verification: `PMS_TEST_URI=<test-replica-set-uri> node --test backend/tests/*.test.cjs` passed 219 tests with one finance integration test skipped. A real MongoDB test seeds the proposed 12-room setup, checks guest 101 out concurrently, and verifies exactly one guest farewell and one separately addressed GM report showing 6 ready, 2 occupied, 3 awaiting cleaning and 1 out of service. WhatsApp transport is mocked. Welcome/reminder tests verify branding, saved guest details, WAT and noon formatting. Frontend `tsc --noEmit --incremental false` passed. Live Windows installation, refreshed dashboard branding and two-phone rehearsal of this combined update remain pending. A new test stay is required; repeating checkout on a completed stay does not regenerate past messages.

### Date-only overnight stay workflow (11 November 2026)

The user rejected the AM/PM control preview, supplied a date-only reference, approved calendar dates with a night count and visible hotel policy hours, and asked to retain the existing Confirm check-in and Mark out of order actions. This implementation targets the Ambassador-messages checkout form originally shown in their screenshot.

The walk-in form now displays today's WAT check-in date read-only and an editable checkout date, defaulting to tomorrow for one night. It shows the calendar-night count and the property's configured standard hours. Actual check-in remains the server's confirmation time. Guest identity fields and dates remain in parent form state until successful save, then reset for the next guest. The existing action buttons, room labels and room colors are retained. Date fields stack on narrow screens and use two columns on wider screens; the policy line wraps.

The rooms API exposes only the property's check-in/checkout hours and display labels alongside inventory. The check-in endpoint accepts checkOutDate as a calendar date, validates it against today's WAT date, applies the property's configured checkout hour, and persists the resulting Date in checkOutTime. Legacy checkOutTime timestamp callers retain their existing path. Supplying both input forms is rejected. Property defaults are 14:00 and 12:00 when no saved settings exist. Normal overnight date entry requires at least one calendar night.

Native WhatsApp availability output now includes calendar nights and configured policy hours in its backend-rendered response. The model is instructed to use dates for availability and refer exceptional hours to staff. Amounts and nights remain backend calculations. The existing room/reservation/stay overlap queries and MongoDB schema are unchanged. The additional policy read provides consistent input hours. These changes improve input accuracy and consistency; they do not fix Gemini HTTP 503 failures.

Verification: `PMS_TEST_URI=<test-replica-set-uri> node --test backend/tests/*.test.cjs` passed 221 tests with one finance integration test skipped. Added regression checks cover date-only check-in applying a custom 11:30 WAT checkout, invalid dates, conflicting date/timestamp inputs and availability responses using the configured hours and night count. MongoDB overlap, checkout, notifications and restart tests pass. Frontend `tsc --noEmit --incremental false` passed. A fresh Chromium launch attempt was blocked by the sandbox's singleton-socket restriction, so visual/mobile browser verification remains pending on Windows. Existing stays keep their recorded checkout times; use a fresh stay for the live rehearsal.

### Reservation calendar controls aligned (11 November 2026)

The user pointed out that the previous date-only patch covered walk-in check-in but left Reservations using datetime inputs. The shared StaySchedule now supports an editable reservation arrival date as well as the walk-in form's fixed current-day arrival. Both forms show calendar-night counts and property policy hours. The existing reservation actions are retained. Planned arrival cards explicitly display AM/PM for their saved scheduled times.

Reservation availability and confirmation now submit arrivalDate and departureDate. Both backend endpoints apply the current property policy in WAT before calling the existing inventory functions. Timestamp callers using arrivalAt/departureAt remain supported, while mixed representations and invalid calendar dates are rejected. Reservation creation still leaves the room unoccupied until reception confirms check-in. Changing either selected date clears cached available rooms and the selected room, keeping the existing date-change safety behavior.

Verification: `PMS_TEST_URI=<test-replica-set-uri> node --test backend/tests/*.test.cjs` passed 222 tests with one finance integration test skipped. The new real MongoDB/HTTP test verifies calendar availability, saving a reservation with custom 15:00/11:30 WAT policy hours, overlapping-date exclusion, an exact back-to-back timestamp boundary, invalid dates and rejection of mixed fields. Existing room-board and booking tests pass. Frontend `tsc --noEmit --incremental false` passed. Interactive browser verification remains pending due to the previously observed Chromium sandbox socket restriction. This follow-up patch requires the preceding Calendar Night Stays update.

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

## Previous next step (6 November 2026)
Complete one live internal journey: request -> completion notification -> confirmed checkout -> history. Do not start PMS reservations during this check. Then establish room inventory as the next PMS foundation while retaining the working guest-service flow.

## Scope and limits
Current work is local development on feature/whatsapp-integration with the isolated lab database. It is not a completed full PMS or a production rollout. Keep demo timing separate from normal operations. No new UI redesign is requested in this stage.

## Verification update � 6 November 2026
- User reported passing the completion notification, confirmed checkout and conversation-history checks.
- Unresolved-review visibility after checkout still needs explicit confirmation.
- Next planned stage: room inventory, with occupancy separate from cleaning and maintenance.
- Typo classification and duplicate reception reviews remain deferred.

## Verified pre-stay booking journey and PMS data (10 November 2026)

The WhatsApp booking lab uses live records in its configured MongoDB database. The Kudu demo settings supply category rates and capacities, check-in and checkout times, quote validity, deposit percentage, and configured public hotel information. Availability reads room categories and out-of-order status, overlapping reservations, and active or extended stays from the same database snapshot. Housekeeping readiness is checked separately at physical check-in. The backend calculates the quote, rereads inventory before reception confirms, and saves a reservation and queued confirmation together. Reception records whether a required deposit has been verified.

Sesora keeps the requested duration when arrival is missing. On a model outage, Chats → Messages for staff review shows the failed incoming message and the saved booking details and last quote, when available. Reception can follow up in the hotel WhatsApp. A subsequent successful guest turn can resume from the saved enquiry.

With PMS_TEST_URI pointing to an isolated MongoDB replica set, `node --test backend/tests/*.test.cjs` passed 191 tests, with one finance integration test skipped. The new end-to-end case uses the real incoming-message handler, PMS reads and writes, staff decision route, and outbound worker. It simulates Gemini, staff authentication and WhatsApp delivery. The fixture changes a room rate, changes a stay duration, injects a provider outage, confirms the revised booking, and checks the outbound reference. Live WhatsApp verification is pending.

The live staff inbox displayed the saved dates and last quote after a provider timeout, but the triggering message was only a greeting. A failed pre-stay turn now uses the existing whole-message greeting check before putting it in the staff queue. A greeting by itself leaves the existing enquiry intact. A greeting followed by a substantive message still routes to staff on provider failure. Verified through the MongoDB booking journey with simulated model failure. The suite passed 191 tests with one unrelated finance test skipped.
