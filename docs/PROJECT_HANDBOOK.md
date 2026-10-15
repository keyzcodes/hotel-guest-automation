# Hotel Guest Operations Project Handbook

Updated 15 October 2026. Latest user confirmed commit: `a18d1ab` on `recovery/hotel-workflows`, also pushed to that remote branch. This handbook describes that milestone; subsequent changes should update it.

## Product and testing status

Hotel Guest Operations helps hotel staff manage guest conversations, routine questions, service requests and departure feedback in one workspace. It is ready for supervised early testing, with the operator running the application. It has not yet been deployed for an unattended hotel pilot.

The product complements a hotel property management system. It does not currently replace a PMS, manage reservations or payments, or synchronise with a PMS. Staff record a stay manually. Telegram is the implemented guest channel. WhatsApp, voice calling and PMS integrations remain future work.

The intended business result is fewer repetitive interruptions for reception, clearer ownership of service requests and an easier guest experience. Those results should be measured during a pilot rather than presented as proven commercial outcomes.

## Guest journey

1. A staff member signs in and records the guest name, phone, room and a future checkout time. A Telegram chat ID is optional. The guest must have started the bot before it can contact them.
2. A linked stay receives a welcome with approved hotel information and its checkout time. An unlinked stay is still recorded, but cannot receive Telegram messages.
3. A satisfaction check asks whether the guest is settling in comfortably. An issue response invites details; it must not claim a team has been dispatched merely because a button was pressed.
4. The concierge answers hotel questions, clarifies incomplete needs, records actionable service requests and supplies saved request status. Guests can use natural language, including the tested Pidgin and French examples.
5. Staff reply in the conversation or complete physical service work. A confirmed completion can notify the guest. A reception review closes only after a confirmed staff reply covers its pending messages.
6. A reminder uses the booked checkout time. Choosing Ready to leave expresses intent and directs the guest to reception. It does not complete the booking.
7. Reception confirms departure. The stay becomes completed, leaves the current stay list and remains in History. The feedback invitation becomes due immediately, without an extra one minute delay.
8. The invitation offers an internal one to five rating and a labelled Google review link. The first valid internal rating is retained. The dashboard shows a compact rolling 30 day average and response count.

## Scheduling

| Event | Normal schedule | Accelerated demonstration schedule |
| --- | --- | --- |
| Welcome | At check in | At check in |
| Satisfaction check | 15 minutes after check in | 1 minute after check in |
| Checkout reminder | 30 minutes before booked checkout | 2 minutes after check in if still eligible |
| Feedback invitation | Due at confirmed departure | Due at confirmed departure |

`JOB_DEMO_MODE=true` enables the accelerated schedule for newly scheduled jobs. It does not change the actual booked checkout time. Reminder wording uses the real time remaining and does not falsely claim a 30 minute countdown. Displayed guest times use Africa/Lagos. The form accepts the device timezone and sends an ISO timestamp; this difference matters when testing from another timezone.

A MongoDB worker polls for due jobs about every two seconds, claims work atomically and uses a lease. A due job is not a guarantee of instantaneous delivery. Database latency, Telegram latency and process availability still apply. A sleeping or stopped server cannot execute scheduled jobs while it is stopped.

## Conversation intelligence

The model interprets language; application code decides which actions are permitted. We are configuring and validating an existing model, not training a new model or hardcoding a dictionary of possible guest sentences.

| Decision | Behaviour |
| --- | --- |
| ANSWER | Answer the question without creating a task |
| CLARIFY | Ask for the detail needed before acting |
| CREATE_REQUEST | Record a clear service need using trusted booking identity |
| FOLLOW_UP | Add a guest update to the specified open request in the same stay |
| STATUS | Read the saved status of a request without creating more work |
| HANDOFF | Create a review when human assistance is appropriate |

Hotel knowledge comes from the configured hotel details and current stay context. Conversation history, open requests and recent completed requests help preserve context. The model must not invent a menu, price, facility, operational reason or delivery time. If menu information is missing, it should explain that and offer help; asking about a menu alone should not automatically create restaurant work. Explicitly accepting contact with the restaurant can justify a handoff.

An incomplete message such as “I am hungry” should prompt a question about what the guest wants. A specific meal order can create an F&B request. A status question should report what staff saved, not assert that the guest physically received the item.

The decision schema constrains action, category, target ID and reply. Server validation rejects unknown privileges, unexpected fields and invalid targets. Request IDs must belong to the current stay and appropriate status. Physical work, financial decisions and departure confirmation remain subject to staff action.

### Provider behaviour and remaining gap

The selected tested configuration is `GEMINI_MODEL=gemini-3.1-flash-lite`. Set it explicitly: the source has a different fallback model when this variable is absent. Model availability and output quality are not guaranteed by selecting a particular model or paying for access.

The SDK client is reused. Application retries are disabled. AI waiting is bounded and late output cannot apply actions after the local deadline. The current default local budget is 8 seconds; the provider request deadline is at least 10 seconds to meet the provider requirement. These are different limits. The whole guest workflow includes database and delivery work beyond AI time.

When AI processing fails, narrow local fallbacks can handle some greetings or clear housekeeping requests. Other failures can still create a grouped staff review and send a generic acknowledgement. This remains a known source of unnecessary reception work. It has not been fully solved. Future changes should improve recovery and knowledge handling without weakening validation or losing messages.

## Staff workspace

The workspace provides Overview, Conversations, Requests and Stays. The hotel name supplies the branding. Room number is the primary visual anchor, followed by guest identity and stay context. The booking ID keeps successive occupants separate behind the scenes.

Chats use compact bubbles, Enter to send and Shift Enter for a new line. Read tracking and Needs reply are separate: opening a conversation does not mean a staff member answered it. Confirmed staff replies acknowledge the saved inbound boundary, without silently clearing a newer guest handoff.

Service completion and reception review closure have different meanings. Complete and notify is for service work. Close review checks that staff have replied; it does not send another completion message or approve a booking change. The chat no longer requires the extra Start handling step.

Current stays are the default working context. Completed conversations remain accessible through History. Checkout should not be interpreted as automatic resolution of every unfinished task. Staff must review unresolved work through the request workflow; remaining request visibility and grouping deserve further usability testing.

On mobile, staff open one conversation at a time and use bottom navigation. Theme preference is applied before paint to reduce the light flash on dark mode. The selected workspace view and selected conversation are restored after refresh. Check in drafts and whether the form was open are saved in session storage. A successful check in closes the form, clears its draft and returns to Stays.

Loaded records remain visible during refresh. Requests have timeouts and avoid overlapping loads. Connection failure must not be represented as an empty hotel. Current live dashboard transport uses Socket.IO HTTP polling through the frontend proxy; a WebSocket transport is not required to explain the current behaviour.

## Data and boundaries

| Entity | Purpose |
| --- | --- |
| Booking | Stay identity, room, channel binding, dates, departure confirmation and feedback |
| Message | Inbound and outbound text, delivery state, processing and attention boundaries |
| TaskTicket | Department, request text, status and grouped guest updates |
| ScheduledJob | Durable scheduled work, attempts, claim lease and outcome |
| StaffSession | Hashed session token, account fingerprint and expiry |
| StaffLoginAttempt | Login throttling records with expiry |

Bookings have ACTIVE, EXTENDED, COMPLETED or CANCELLED status. Requests have Pending, In Progress, Resolved or Escalated status. Those status sets describe different things and must not be substituted for one another.

One Telegram chat must resolve to exactly one active stay. Room number alone is insufficient because rooms are reused. Old operational buttons are checked against the saved message, chat and stay, not merely the room written in the callback. Completed stay messages do not restart the operational guest workflow. Unlinked inbound messages can be recorded without a booking; they do not appear in a stay conversation or trigger an AI reply. Post checkout rating actions are separately checked against their exact invitation.

Repeated inbound provider messages and scheduled deliveries have idempotency keys. Outbound messages are saved before sending, then marked sent after provider confirmation. Uncertain delivery is retained for inspection rather than blindly resent. This reduces duplicates; it does not establish an exactly once guarantee across every possible crash.

## Feedback and Google reviews

Internal ratings are scoped to a confirmed completed stay and its saved invitation. Repeated or changed taps preserve the first rating and count once. Invalid, stale or unrelated callbacks cannot guess another stay.

The average is the sum of eligible ratings divided by the number of responses. Ratings of one and five therefore produce 3.0 from two responses. Last 30 days is a moving window, not an automatic monthly reset. Star graphics are a visual summary; the numeric average remains the meaningful value.

The Google button is available regardless of the internal rating. Clicking it opens the configured public URL; it does not publish the internal rating to Google. There is no verified Google review conversion tracking. Obtain the hotel's correct review destination before a pilot. Do not promise search rankings or guaranteed review growth.

## Access and security

There is a hotel staff login and no public registration. The current setup uses one configured hotel account, not individual staff roles. An operator creates the email and password through `backend/scripts/setup-staff.cjs`. There is no default public password.

Passwords use salted scrypt hashes. A random opaque session token is placed in an HttpOnly, SameSite Lax cookie; the database stores its SHA256 digest. Sessions expire after eight hours and require another login. Expiry is checked by the application independently of MongoDB TTL cleanup. Logout revokes the saved session and disconnects its live connections. Credential changes invalidate the account fingerprint after configuration takes effect.

Unsafe requests require an allowed origin, logins are throttled and protected routes fail closed when session verification is unavailable. Production cookies require HTTPS. The current account has no per person attribution, role permissions, MFA, password reset email or user management UI. These are future requirements to assess before a real multi staff pilot.

## Architecture and source map

The frontend is Next.js with React, TypeScript and CSS modules. The backend is Node.js with Express and CommonJS. MongoDB Atlas persists application records through Mongoose. grammY provides Telegram integration; Google GenAI provides language interpretation. No Redis or external job broker is currently required by this implementation.

The browser calls same origin `/api` and `/socket.io` paths. Next.js proxies them to `BACKEND_URL`, defaulting to the local backend. This requires a running Next.js server or equivalent supported proxy setup; a static build label alone does not mean the app can be hosted as plain static files.

| Source location | Responsibility |
| --- | --- |
| backend/server.js | Express startup, access middleware, database and workers |
| backend/src/config/hotel.js | Hotel identity, approved facts and review URL |
| backend/src/services/guestAiService.js | Model client, deadline, schema and validation |
| backend/src/services/guestMessageService.js | Persist, link, interpret and apply guest actions |
| backend/src/services/telegramService.js | Bot transport, outgoing messages and callbacks |
| backend/src/services/stayCallbackService.js | Operational button stay boundaries |
| backend/src/services/schedulingService.js and jobWorker.js | Schedule and execute durable jobs |
| backend/src/services/taskCompletionService.js and taskReviewService.js | Complete services or close answered reviews |
| backend/src/services/conversationAttentionService.js | Read and reply attention calculations |
| backend/src/services/guestFeedbackService.js | Rating validation and summary |
| backend/src/services/staffAuthService.js | Credentials, cookies, sessions and origin checks |
| backend/src/services/responseTimingService.js | Stage timing with no workflow side effects |
| frontend/src/app/page.tsx | Main navigation, overview, stays and check in |
| frontend/src/app/ChatWorkspace.tsx | Chat, requests, replies and attention |
| frontend/src/app/GuestFeedback.tsx | Compact feedback summary |
| frontend/src/app/StaffAccess.tsx and apiClient.ts | Login gate and authenticated requests |

## API reference

Staff authentication is required for operational routes. Login and session checks are handled by the authentication router; health is public. The public health response is a process check, not a complete dependency readiness guarantee.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | /health | Backend process response |
| POST | /api/auth/login | Sign in |
| GET | /api/auth/session | Verify current session |
| POST | /api/auth/logout | Revoke session |
| POST | /api/bookings/check-in | Record a stay |
| GET | /api/bookings/active | List active stays |
| POST | /api/bookings/:id/checkout | Confirm departure and schedule feedback |
| GET | /api/bookings/feedback | Feedback summary |
| GET | /api/tasks | List requests with optional status |
| PATCH | /api/tasks/:id | Change allowed status or assignment |
| POST | /api/tasks/:id/close-review | Close an answered reception review |
| GET | /api/conversations | List conversations |
| GET | /api/conversations/:bookingId/messages | Load stay messages |
| POST | /api/conversations/:bookingId/read | Acknowledge explicit loaded inbound IDs |
| POST | /api/conversations/:bookingId/reply | Send a staff reply |

## Configuration and local operation

Keep real values in private environment files. Do not commit credentials, tokens, database URLs, password hashes or actual guest exports.

| Variable | Use |
| --- | --- |
| MONGO_URI | MongoDB connection string |
| TELEGRAM_BOT_TOKEN | Bot credential |
| GEMINI_API_KEY or GOOGLE_API_KEY | AI provider credential |
| GEMINI_MODEL | Explicit selected model |
| USE_MOCK_AI | Keep false for live interpretation |
| AI_RESPONSE_TIMEOUT_MS | Local AI waiting budget |
| JOB_DEMO_MODE | Accelerated scheduled messages |
| STAFF_EMAIL and STAFF_PASSWORD_HASH | Generated staff credentials |
| FRONTEND_ORIGINS | Allowed frontend origins |
| PORT | Backend listening port, default 5000 |
| NODE_ENV | Runtime mode and secure production cookie behaviour |
| TRUST_PROXY | Set only when the deployed proxy topology requires it |
| BACKEND_URL | Frontend server proxy destination |

Use separate PowerShell terminals from the project root. Restore locked dependencies with `npm ci` when setting up a fresh checkout. Run `node .\scripts\setup-staff.cjs` from backend to create or change staff credentials, then restart the backend. Start the backend with `npm start` from backend and the frontend with `npm run dev` from frontend. The development frontend uses port 3001. Only one poller should run for the same Telegram bot token.

For verification run `node --test .\tests\*.test.cjs` in backend, then `npm run lint` and `npm run build` in frontend. The backend package's default npm test script is not the regression command. Run `git diff --check` from the repository root before committing.

## Evidence and known limits

At this milestone 99 backend tests passed, along with frontend lint and production build checks. Coverage includes decision boundaries, timing instrumentation, scheduled delivery, feedback, stale buttons, request status, attention, review closure and authentication. Live manual checks exercised arrival, satisfaction, reminders, conversation, staff completion, checkout and ratings.

The tests do not prove zero downtime, universal language support, complete factual grounding or capacity for 100 simultaneous rooms. The authentication flow integration uses isolated test storage, not a production database load test. Small model comparisons helped choose a candidate; they are not reliability guarantees. Live replies have often taken several seconds. Logs separate database, AI and Telegram stages so optimisation can target measured delays.

Outstanding work includes provider outage handling that avoids unnecessary tasks, more reliable multi turn routing, better coverage of simultaneous messages, real hotel knowledge and menu maintenance, operating procedures for uncertain sends, production backup and monitoring, staff permissions where needed, and a hosted supervised pilot. Multiple unrelated service needs in one message remain constrained by the current single action contract.

Hosting, incoming webhooks, WhatsApp, PMS integration and production operations are deferred. Telegram currently uses polling. Scheduled jobs need a running backend regardless of the incoming message transport.

## Next release priorities

Preserve the working journey and complete supervised tester feedback first. Measure answer correctness, unwanted handoffs, missed requests, duplicate work and response latency. Fix the highest impact failures before adding new screens. Obtain approved hotel facts, policies and review links. Then choose hosting and establish a small monitored pilot with clear human ownership of unresolved requests.

The success criterion is trustworthy guest assistance with less staff interruption, not simply a larger feature count.
