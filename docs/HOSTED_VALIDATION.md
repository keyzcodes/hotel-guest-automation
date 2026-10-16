# Hosted deployment and guest journey validation

Recorded 17 October 2026, Africa/Lagos. Deployment was prepared and tested across the evening of 16 October and the early hours of 17 October.

## Current status

Hotel Guest Ops is hosted on Render and has passed a supervised manual guest journey using the hosted application on a phone and PC, with all local application servers stopped. It is available for arranged early testing. This establishes that the tested journey no longer depends on the developer PC running the application. It does not establish continuous availability, production capacity or unattended hotel readiness.

This milestone updates the earlier local-only status in the project handbook and README. The implementation remains a guest service layer that complements a hotel's PMS. Telegram is the implemented guest channel. WhatsApp, PMS integration and voice calling remain planned work.

## Release evidence

The deployment source was pushed to main at commit 47752b5, Prepare combined Render hosting and Telegram webhook. The local working tree was clean after that push. Before the push, 107 backend tests passed, frontend lint passed and the Next.js production build passed. Render's build also completed successfully.

Render initially rejected startup because the configured staff credentials were missing or did not match the expected format. After the environment configuration was corrected, the user confirmed successful deployment, login and access to saved records. No credential values belong in this record.

## Hosted architecture

| Component | Location or method |
| --- | --- |
| Dashboard | Next.js served by the combined Render Node service |
| Operations APIs and staff login | Express in the same Render service |
| Guest inbound messages | Telegram webhook with secret-header verification |
| Guest outbound messages | Telegram Bot API |
| Stay records and conversations | Existing MongoDB Atlas database |
| Scheduled messages | MongoDB-backed jobs executed by the Render process |
| AI interpretation | Configured Google Gemini provider |
| Dashboard updates | Socket.IO HTTP polling on the same public origin |

The bot's polling mode remains available for local use. The local backend must stay stopped while using the hosted receiver for the same bot. Local startup now refuses to silently replace an existing hosted webhook. A deliberate return to polling is documented in DEPLOYMENT.md.

## Confirmed manual checks

| Check | Reported result |
| --- | --- |
| Open hosted application on phone and PC | Passed |
| Staff login and access to saved records | Passed with local servers off |
| Casual guest conversation | Telegram returned conversational replies |
| Known hotel question | Breakfast hours were answered |
| Clear housekeeping need | Two towels created a Housekeeping request for Room 101 |
| Staff completion | Telegram received the completed-request confirmation |
| Reception-confirmed departure | Post-checkout feedback invitation reached Telegram |
| Internal rating | Telegram acknowledged the feedback |
| Dashboard rating count and Google destination | User confirmed the remaining checks passed |
| Overall hosted walkthrough | User reported everything tested was working |

The hosted excerpt explicitly demonstrates conversation, a service request, completion and departure feedback. Separate timestamps for a fresh hosted welcome, satisfaction check and pre-checkout reminder were not included in this excerpt. Those touchpoints were verified in earlier local walkthroughs and are included in the testing guide; record them separately in any formal pilot acceptance evidence.

## Mobile navigation finding

The phone's browser Back button or back gesture can leave the website instead of navigating through dashboard tabs. Returning through the hosted link opens the existing authenticated workspace without entering credentials again. This is navigation behaviour, not demonstrated session revocation or logout.

The proposed improvement is to represent workspace navigation in browser history so Back can return from a chat to the conversation list, close a form while preserving its draft and move through visited tabs. The application should still permit leaving the site normally. This fix is not implemented in this release.

## Reliability and dependency findings

Render reported five high-severity dependency vulnerabilities during installation. Their package names, affected ranges and exploitability have not yet been examined. The build succeeded, but build success does not resolve security findings. Review npm audit output for backend and frontend separately, apply appropriate compatible updates and rerun relevant checks. Do not run a forced upgrade without reviewing its changes.

The Free Render service can sleep after inactivity. A wakeup can delay a guest reply; the scheduled worker cannot execute while the process is asleep. Persisted jobs can be inspected and processed after resume subject to existing eligibility checks. This configuration is for guided testing rather than an on-time, continuously running hotel service.

Existing AI outage behaviour can still create unnecessary staff reviews. The deployment does not change that into guaranteed self service. Response timing, bounded AI waiting, decision validation and delivery uncertainty protections remain in place. A durable incoming processing queue, per-stay concurrent processing and production load tests are still outstanding.

## Business capability demonstrated

The tested system brings routine hotel answers, requests and staff responses into one stay conversation. It supports automated arrival and stay touchpoints, reception-confirmed departure and a feedback invitation. Internal ratings remain separate from public Google reviews, with the Google option available regardless of the internal score. There is no verified review conversion measurement or guarantee of search ranking growth.

Business benefits such as reduced staff burnout, faster service fulfilment and increased reviews are objectives to measure with a hotel pilot, not outcomes proven by this technical walkthrough.

## Next actions

1. Review the dependency audit findings and document the resolution.
2. Improve browser Back behaviour without trapping users or changing authentication semantics.
3. Arrange supervised tests with hotel owners, reception staff and guest testers.
4. Measure answer correctness, unnecessary handoffs, missed requests and response latency.
5. Obtain approved facts, menu information, policies and review destination from an interested hotel.
6. Move scheduled work to an always-running environment before promising reliable unattended operation.

Do not publish staff credentials or actual guest data with the test invitation. The staff dashboard requires login; guest testers should be linked to separate test stays through their own Telegram accounts.
