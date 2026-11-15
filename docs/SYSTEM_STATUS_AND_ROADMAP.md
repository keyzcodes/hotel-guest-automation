# Hotel system — working picture and roadmap
Updated: 14 November 2026

## Simple container release foundation (14 November 2026)

User approved a simple combined container: frontend, backend, WhatsApp and workers together; Atlas external; builds off-server; one active session owner and brief stop/start downtime. User reports successful hands-on mobile finance demos with the Le Harve GM, who will discuss with the CEO and invite a demo at the 18 November GM meeting. These are user-reported outcomes, not a sale or confirmed invitation. Module price discussed: NGN450,000; hosting/maintenance terms unconfirmed.

Implemented locally: multi-stage Dockerfile, one Compose service, private runtime environment template, readiness checks, Linux release lock and previous-image recovery, and GitHub Actions test/build/smoke/publish with opt-in demo deployment. Health checks API/database/dashboard and enabled WhatsApp readiness. Image rollback does not roll back database changes or runtime configuration. See docs/CONTAINER_DEPLOYMENT.md. No cloud instance, reverse proxy, credentials, push or deployment created; existing Render services unchanged.

Verified locally: nine deployment/health tests passed with simulated Docker CLI and real HTTP fixture; full backend 283 total, 273 passed, 10 database-dependent skipped; frontend 31 passed. Production frontend build passed using Webpack because workspace dependencies are linked outside the build root. Shell syntax and YAML parsing passed. Docker engine unavailable: actual image build, pruned runtime, Compose and CI execution remain unverified. One-GB runtime memory unmeasured. Prior real-Mongo verification was not repeated for this run.

Next: apply incremental patch, run Docker build/CI, configure one demo server privately, rehearse release/recovery, then enable demo auto-deploy. Live-hotel deployment needs a separate environment and approval decision. Provider failures and remaining live enquiry evaluations remain unresolved; packaging does not fix those issues.

## Preserve partial changes and shorten quotes (13 November 2026)

User-reported live rerun completed turns 1-5 in roughly 2-4 seconds. Turn 6 changed the dates correctly but supplied ALL, clearing the saved Luxury preference and listing all categories. The changes evaluation correctly failed. Guest also reported that the repeated check-in/checkout tag, reception footer and model introductions made replies feel automated.

Implemented locally; Windows installation/live rerun pending: a stay-detail change cannot implicitly broaden an existing room preference to ALL/ALTERNATIVES. It preserves the current selection unless replacePreference=true explicitly accompanies the scope change. The new field documents that true means the guest also requested the preference change. Date-only changes should use KEEP_CURRENT. This is a generic partial-update rule, not a phrase list; the model can still misinterpret explicit guest intent, so live checks remain necessary. Genuine broader searches remain possible, including with new dates.

The enquiry quote renderer now returns a concise single-option sentence, or a dated list for multiple options. Repeated reception footers are removed. Policy hours are included on the first prepared quote in an enquiry and when the hotel's configured hours change. policySignature persists independently of quote invalidation, so date changes do not repeat policy hours. It tracks prepared output, not delivery/read confirmation. An explicit reset clears this presentation history. Policy questions continue to use getHotelInformation(POLICIES) and always return configured hours. In availability replies the backend displays trusted result text without the model's redundant introductory sentence; other conversational replies keep model wording.

Verification: PMS_TEST_URI=<disposable localhost replica-set URI> node --test backend/tests/*.test.cjs: 274 total, 273 passed, zero failed, one dedicated finance integration case skipped. Targeted enquiry/presentation/evaluation tests: 35 passed, zero failed/skipped. Regressions cover unintended ALL/ALTERNATIVES during stay changes, explicit scope replacement, first/follow-up/changed-policy rendering, and the full reported Luxury date-only failure with a deliberately wrong ALL model argument. Real MongoDB 7.0.26 exercised existing integration cases; model and outbound messaging calls are simulated. No live provider call, frontend change, commit, push or deployment.

Next: apply after Resume And Automatic Alternatives, rerun targeted tests and node --env-file-if-exists=backend/.env.whatsapp backend/scripts/eval-enquiry-agent.cjs 1 changes. Inspect the actual reply and preferencePreserved trace, then run proactive/strict. The earlier critic review failure and intermittent upstream rate limits remain separate unresolved issues.

## Grounded resume and proactive alternatives (13 November 2026)

User-reported live changes rerun: turns 1-7 completed category changes, explicit alternatives (Luxury and Junior Suite), all-category search, date revision and thanks. Turn 8 recalled the correct Luxury/date details from saved context but bypassed getEnquiryProgress and offered two competing next actions. The strict progress-tool assertion failed. A 429 Retry-After caused a 14000ms retry wait in that turn; total 19770ms. This is not lost memory. Live flow remained unaccepted at this point.

Implemented locally; installation/live verification pending: replyToGuest now supports recapEnquiry=true to render the authoritative saved enquiry and a single yes/no recheck question directly in the terminal tool. This avoids a separate progress-tool/model round. The existing getEnquiryProgress route also renders the same recap; the final reply uses its canonical question. Inline recap sets enquiryProgressUsed and trace recapFromState, and the evaluator accepts this backend-grounded route as well as the progress tool. Free-text replies containing concrete complete-stay values without a tool result are asked to use the grounding contract. This is a limited factual-source safeguard, not general semantic verification. The canonical pending question is persisted; recap never checks availability or claims old quotes remain available.

checkAvailability now checks inventory across categories in one existing service lookup when a selected category allows alternatives. If a requested category is available and within constraints, it is shown without unrelated alternatives. If requested options are unavailable or unsuitable, up to two available options fitting guest count/budget are offered, cheapest first, for the same dates. Guest preferences and dates are preserved until the guest chooses a change. Discussed history tracks displayed options rather than every category checked in the background. A PMS error remains PMS_UNAVAILABLE and never becomes a sold-out claim. If no suitable options are found, the response asks about date flexibility; it does not change the dates.

The selection contract adds allowAlternatives (default true for existing records), maxTotalMinor and maxNightlyMinor (nullable integer currency minor-unit caps). Explicit category-only requests should set allowAlternatives=false. Budget extraction and interpretation remain model-dependent; the backend validates/preserves explicit constraints, enforces capacity and price caps, and invalidates old quotes when they change. No migration is required for old sessions. Constraints are currently limited to party capacity, category restrictions and total/per-night price; beds, accessibility and amenities filtering are not implemented. This phase creates no reservation, hold or payment.

Verification: PMS_TEST_URI=<disposable localhost replica-set URI> node --test backend/tests/*.test.cjs: 271 total, 270 passed, zero failed, one dedicated finance integration case skipped. Real MongoDB 7.0.26 covered the existing persistence/CAS and WhatsApp routing tests. Targeted enquiry/behaviour/presentation tests: 32 passed, covering one-call inline recap, grounded progress recap, automatic fallback with one lookup, primary-category availability, capacity exclusions, strict/budget restrictions, no suitable rooms, PMS failure and constraint persistence. AI and messaging are simulated; no live revised-model result established here. No frontend changes, commit, push or deployment.

Live evaluation cases: changes now accepts a backend-rendered inline recap; proactive makes Imperial unavailable in a synthetic fixture and requires alternatives without a follow-up phrase; strict checks an explicit Imperial-only restriction. Commands: node --env-file-if-exists=backend/.env.whatsapp backend/scripts/eval-enquiry-agent.cjs 1 changes (then proactive or strict). Prices remain synthetic; no MongoDB or WhatsApp activity in live-model evals. Preserve the existing pre-stay budget; provider rate limits/latency and the critic's previously unknown failure remain separate unresolved issues.

## Alternatives selection guard (13 November 2026)

User-reported live changes evaluation: Standard and Imperial checks completed for the requested dates. The other-options turn offered Luxury alone and ended in SELECTED rather than ALTERNATIVES, omitting Junior Suite from the synthetic four-category fixture. The evaluator correctly reported MECHANICS_FAIL at turn 3. This is a semantic selection/coverage failure after successful tool execution, not a timeout. Evaluation prices (20000/40000/60000 NGN in this run) are synthetic and do not replace the hotel rates.

Implemented locally; Windows installation/live rerun pending: SELECTED now requires a new known category to be mentioned in the current guest text or already present in current/discussed preferences. An invented new selection receives SELECTION_NOT_GROUNDED before a state write or inventory query, allowing the model to correct to ALTERNATIVES/ALL or clarify. This does not infer intent from a list of guest phrases. Catalog labels are property-specific and matched with word boundaries; indirect references to already discussed options remain allowed. The guard does not independently understand every negation, synonym or complex preference; live goal-based evaluation remains necessary.

Contract wording makes ALTERNATIVES search every remaining category, with the backend determining options. The trace now includes requestedScope, resolvedScope, selectedCategories and checkedCategories for state-changing/search tools. The changes evaluation explicitly checks both Luxury and Junior Suite in the alternatives response and explains the scope mismatch in plain language.

Verification: node --test backend/tests/enquiry-agent.test.cjs backend/tests/eval-enquiry-agent.test.cjs: 25 passed, zero failed/skipped. Added regressions for an unrequested Luxury selection corrected to an alternatives search (both remaining categories returned, no premature query/write), explicitly named multiple categories, and references to discussed categories. Model and inventory calls are simulated. No new live Gemini run, database integration run, frontend change, commit, push or deployment in this update.

Next: apply after Conversation Behaviour Evals, rerun the targeted tests and node --env-file-if-exists=backend/.env.whatsapp backend/scripts/eval-enquiry-agent.cjs 1 changes. Review scope/category traces and replies. The earlier semantic critic's unknown review failure remains unresolved; no overall conversation acceptance is claimed.

## Conversation evaluation correction (13 November 2026)

User-reported live evidence: the Phase 1 patch installed and 15 targeted tests passed on Windows. A minimal Gemini request returned OK in 2322ms, and the native-tool diagnostic returned replyToGuest in 2049ms. These isolated successes do not establish provider reliability. The subsequent conversation evaluation printed PASS despite premature date/party-size collection on the general enquiry, room-types answer and thanks. Turn durations were 1892ms, 18630ms and 1056ms. This is recorded as a conversational failure; the former PASS is not accepted. Narrow phrase checks and unchanged-state assertions were inadequate.

Implemented locally; Windows installation and live verification pending: the runtime contract prioritizes the current guest request, separates information from availability, stops when an answer is complete and acknowledges thanks without repeating a stored question. replyToGuest explicitly permits an empty connective message with trusted result IDs and makes clarification optional. No new guest-path model call, timeout change, category list or canned response was introduced. Instructions alone do not guarantee semantic compliance.

The evaluation now reports mechanicsPassed separately from behaviouralPassed, behaviouralFailed, reviewRequired, failed, blocked and notRun. Without a semantic reviewer, every mechanically successful journey remains REVIEW_REQUIRED, never a conversational pass. Exit code 2 means review is pending; code 1 means execution/behaviour failed or provider blocking occurred. Broad phrase matching was removed as a substitute for conversational assessment; state/tool assertions remain deterministic checks. Latency p50/p95 and turns over 10 seconds are reported separately (10 seconds is a reporting threshold, not a universal service target).

Optional --judge runs one additional bounded, no-retry model call per mechanically completed journey, reviewing the whole synthetic transcript against per-turn goals. The critic must assess meaning, distinguish information from availability and cite an exact reply excerpt for every failure. Missing/duplicate turns, fabricated evidence, malformed JSON, a timeout or an uncertain judgement leave REVIEW_REQUIRED. A critic 429 stops the remaining batch. Positive verdicts are explicitly PROVISIONAL_BEHAVIOUR_PASS, requiring transcript inspection; the same-model critic can share the actor's blind spots and is not independent ground truth. SESORA_EVAL_JUDGE_MODEL optionally selects a different available model; otherwise it uses WHATSAPP_PRE_STAY_MODEL or the existing default. Reviewer calls happen only in the evaluation script, never during guest replies, and use only synthetic data.

Verification: node --test backend/tests/enquiry-agent.test.cjs backend/tests/eval-enquiry-agent.test.cjs: 22 passed, zero failed/skipped. Tests replay the exact reported bad transcript, prove it cannot pass without review, check separate semantic failure/provisional-pass handling, uncertain/failed critic handling, evidence validation and bounded critic requests. Actor and critic responses are mocked; this does not prove that the live revised actor or critic makes correct semantic decisions. Existing phase-one database verification remains historical; no schema or persistence change in this patch.

Next live check: node --env-file-if-exists=backend/.env.whatsapp backend/scripts/eval-enquiry-agent.cjs 1 conversation --judge. Compare the actual three replies and critic evidence. The --judge option costs one additional model request for this journey; omit it for mechanics plus manual review. Do not mark the conversation accepted merely because tools ran or a model critic passed it. No commit, push, deployment or actual guest message performed here.

## Native enquiry agent phase 1 (13 November 2026)

Implemented locally behind WHATSAPP_ENQUIRY_AGENT_ENABLED=true; installation and live Gemini evaluation pending. This opt-in path takes priority over WHATSAPP_AVAILABILITY_TOOL_DEMO when the existing lab booking workflow is available. The old path remains available by disabling the new flag. Backend only: no room-board, reception, payment, check-in or checkout behaviour changed.

The single conversation source of truth is GuestEnquirySession, unique by hotelId and chatId. It stores version, stage, stay, roomPreference, discussedCategories, lastQuote and pendingQuestion. It imports the latest legacy checked stay (or workflow details) only on initial creation. Subsequent requests and resets never reimport old category memory. BookingEnquiry remains the separate existing reception approval ledger; this phase cannot modify or cancel it. MongoDB compare-and-swap version checks reject stale concurrent saves. The existing transport serializes inbound processing and the existing message idempotency key ignores delivery replays. Tests also cover independent concurrent writers. Empty stay objects are explicitly preserved in MongoDB.

Contract and system instructions: backend/src/services/enquiryAgentContract.js. Tools: getHotelInformation, getEnquiryProgress, updateEnquiry, checkAvailability and replyToGuest. Native function responses are fed back to the model with original response parts/thought signatures and matching call IDs retained. Exactly one tool executes per step, at most six model/tool steps per turn. No write-to-reservation, payment or escalation tool is exposed. General hotel facts are currently limited to configured room types, hotel name/city, amenities and standard/cancellation policies; arbitrary handbook retrieval and broader service knowledge remain future work.

Search scope is mandatory for availability: ALL, SELECTED, ALTERNATIVES or KEEP_CURRENT. SELECTED replaces preferences; FIRST_AVAILABLE preserves an explicit conditional order. Null explicitly clears a stay field, omission preserves it, and reset clears only the conversation workspace. Dates, guest count and selection changes invalidate the saved quote; dates/party changes reset discussed categories. Availability reads inventory again; previous quotes are historical and do not hold a room. The configured-label safeguard rejects a mismatched selected/current category in an unambiguous latest message before querying, allowing tool-argument repair without inventing a result.

Social replies use replyToGuest without an inventory call. There is no broad word blacklist on this new path. Hotel facts and availability text are rendered from current tool result IDs; unknown references are rejected, and the latest verified availability result is always delivered. Natural connective text is model-generated and constrained by instructions; it is NOT a complete semantic guarantee against fabricated statements. Live evaluations and transcript review remain necessary. A pending question is persisted so a later yes has context, but interpreting that answer still depends on the model. The read-only phase does not claim a booking was submitted or staff notified.

All model rounds and retry waits consume the remaining existing pre-stay budget (configured 20 seconds in the user's lab); no timeout increase. This is not a universal database/network deadline. Slow lookups or saves can extend total response time. On provider failure, saved state remains; a verified availability result can still be sent if final wording fails. Before a tool result, failure returns an honest temporary notice without a false handoff. ENQUIRY_AGENT_TRACE reports tool names, statuses, version and elapsed time, without guest text/phone/credentials. Upstream 503/504/429 incidents remain unresolved.

Verification: PMS_TEST_URI=<disposable localhost replica-set URI> node --test backend/tests/*.test.cjs: 254 total, 253 passed, zero failed, one skipped (finance test requires its dedicated restricted Atlas account). Real MongoDB 7.0.26 replica set covered session reconnects, reset persistence, CAS contention, WhatsApp routing, message replay and changing live room inventory. AI and WhatsApp transport were simulated. Unit tests cover social wording, room information without dates, all/selected/alternatives/date changes, pending questions, reset, invalid details, provider/PMS failure, shared model budget, thought signatures, result references and bounded loops. No frontend change; frontend build not rerun.

Live evaluation: node --env-file-if-exists=backend/.env --env-file-if-exists=backend/.env.whatsapp backend/scripts/eval-enquiry-agent.cjs 1 conversation. Additional cases: changes and authority. These evaluations use a real configured Gemini model with synthetic dates/guests, fake inventory and in-memory state; no MongoDB connection or WhatsApp sends. Outcomes check tools and state rather than exact response wording, with targeted negative checks for unwanted booking questions and false confirmations. Provider-blocked journeys are reported separately and HTTP 429 stops the remaining run. Initial testing should use one case/one repetition to limit quota usage. Live runs were not performed here because user provider credentials are not available. Broader wording, ambiguity and adversarial evaluation remain ongoing work.

Next: apply the patch after Category Continuity, run the local agent tests and one live conversation evaluation, enable the new flag in backend/.env.whatsapp and restart. Test social enquiry, all categories, category changes, side question, thanks, dates, resume and reset on WhatsApp. Reservation submission through this contract is deferred until these checks pass; its existing backend approval safeguards must be reused. Do not claim a fully autonomous booking journey from this phase.

## Category continuity correction (13 November 2026)

User-reported live diagnostic verification: pre-stay 20000ms configured, in-stay 8000ms default; successful message processing 6582ms, AI 2718ms, inventory 630ms, WhatsApp send 1797ms. The same reply incorrectly offered Standard after the guest asked for Imperial. This confirms a semantic selection failure on a successful lookup, not a timeout on that turn. The old trace cannot establish whether Gemini or context merging supplied the wrong category.

Implemented locally, Windows installation pending: native availability now supplies one current enquiry context. The most recent checked stay takes precedence over older booking-workflow details. A single unambiguous category label in the latest message is grounded against the property's configured catalog before querying; stale model categories cannot override that explicit selection. Negated, conditional or multiple-category preferences remain model-interpreted. This is not general language-understanding proof and does not fix provider outages.

ALTERNATIVES ignores a valid but stale categories array and searches outside the categories discussed for the same dates and guest count. Discussion history accumulates across category changes and includes unavailable alternatives; different dates/party size reset those exclusions. Explicit category requests can recheck an already discussed option. Date-only follow-ups retain the current category. No cached availability results are used for new checks, and no reservations are created by this read-only path.

New selection diagnostics show allow-listed model, saved and requested category names, selection source and reuse mode. The existing CHECKED log now includes resolvedCategories, making it possible to compare the selected category with the PMS result. Unknown model strings are redacted rather than logged verbatim. No guest text, phone numbers or credentials are added to these traces.

Regression coverage includes Standard to Imperial with deliberately stale model arguments, alternatives with stale categories, Luxury then a date-only follow-up, property-specific labels containing punctuation, exclusion/conditional wording, unavailable alternatives and explicit rechecks. Tests use simulated model and inventory calls; live conversational verification remains required after installation. Verification: node --test backend/tests/*.test.cjs returned 237 total, 229 passed, zero failed, eight database integration cases skipped because test database URIs were absent.

## Workflow timeout diagnostics (13 November 2026)

Implemented locally; Windows installation and live verification pending. WORKFLOW_TIMEOUTS is emitted after MongoDB connects. AI budget resolution is shared with runtime execution: pre-stay defaults to 12 seconds, accepts integer milliseconds from 1000 to 20000; in-stay defaults to 8 seconds, accepts 1000-20000 milliseconds and rounds down. Sources are configured, default or invalid_using_default; raw environment values and credentials are excluded. Existing limits, retries, booking decisions and guest messages are unchanged.

The user reports WHATSAPP_PRE_STAY_TIMEOUT_MS=20000. Native availability requests share that budget across initial inference and up to two retries. No end-to-end message deadline exists. Database server-selection limits are not query deadlines. Ordinary conversation sends have no explicit application deadline; queued sends retain 20 seconds, scheduled welcome/reminder sends retain 25 seconds.

The message timing trace now records pre_stay_ai and, only when native availability actually queries inventory, pms_lookup. Existing whatsapp_send remains separate. AI failures record error without a fictional inventory check; database exceptions record pms_lookup error even when the tool returns a graceful PMS_UNAVAILABLE result. The legacy structured path also measures interpretation, booking_workflow and optional reply composition. Nested measurements overlap pre_stay_conversation: do not add parent and child durations. Parent result ok means the function returned, possibly with a fallback, not that Gemini succeeded. These are application waits, not guest delivery/read receipts.

Verification: backend suite 230 total, 222 passed, zero failed, eight database integration cases skipped because test database URIs were absent. Four new workflow-timeouts cases passed separately, covering effective settings, secret exclusion, distinct AI/PMS timing and failure isolation. Provider, lookup and messaging calls are simulated. Live Gemini reliability remains unresolved; no Windows restart or real message sent.

User Git output confirms 3319881 pushed to main and feature/whatsapp-integration with clean main. Hosted deployment remains pending; Auto-Deploy reported off, Le Harve branch unchanged. Preparation notes below are historical.

## Shared branch merge preparation (13 November 2026)

Baseline: freshly cloned feature/whatsapp-integration at ada1a7d. User Git output confirms main (3cf8d2e) and feature/le-harve-reporting (c33df7d) are ancestors of this branch. All committed Le Harve functionality is already included. The separate Le Harve worktree has uncommitted server formatting and documentation guidance; those files are preserved. The documentation guidance is carried into this branch's frontend/AGENTS.md.

The user reports Auto-Deploy is now OFF for hotel-guest-ops, which follows main. le-harve-demo follows feature/le-harve-reporting and is unchanged. No merge, push to main or deployment has been performed in this preparation. render.yaml still starts the combined server with Telegram webhook configuration; merging source does not configure the hosted WhatsApp service. Review channel, credentials, session storage and normal scheduling before a manual deployment.

Neutral demo branding is configured through backend/.env.whatsapp: HOTEL_NAME=Kudu Demo and HOTEL_GUEST_NAME=Kudu Demo Hotel. Windows application of those local values has not been independently verified. Preserve room inventory and internal property identifiers.

Corrected the check-in test fixture to provide the WhatsApp scheduler explicitly, verify the saved stay is passed once, confirm the Telegram scheduler is not called, and cover scheduler failure and disabled scheduling. This corrects the former incidental TypeError in the test fixture; production behaviour is unchanged.

Verification on the fresh checkout plus this patch:
- PMS_TEST_URI=<disposable localhost replica-set URI> node --test backend/tests/*.test.cjs: 230 total, 229 passed, zero failed, one skipped. MongoDB 7.0.26 replica set; seven formerly skipped PMS integration cases ran successfully, including overlap contention, booking approval, calendar endpoints, enquiry persistence and checkout outbox reports.
- The remaining finance-mongodb case requires the dedicated restricted Atlas test account (FINANCE_TEST_URI); no hotel credentials were requested or used. Its skip is not a pass.
- node --test frontend/tests/*.test.mjs: 31 passed, zero failed.
- node frontend/node_modules/typescript/bin/tsc --project frontend/tsconfig.json --noEmit --incremental false: passed.
- Production build: user-reported Windows success on ada1a7d on 12 November; not rerun for this test/documentation-only patch.
- AI and messaging provider calls in these tests are simulated. Live Gemini failures remain unresolved; no real WhatsApp delivery is established by these checks.

Next: apply and verify the patch on Windows, commit it on feature/whatsapp-integration, then fast-forward main after checking the working tree and remote refs. Keep Auto-Deploy off while hosted configuration is reviewed.

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
