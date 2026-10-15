# Supervised testing guide

Updated 15 October 2026. Use test guest details. Hosting is deferred, so the operator must keep the backend and frontend running during an arranged session. There is no public signup link yet.

## Arrange access

Ask interested testers to message the project owner. Confirm a testing time and whether they are testing as a guest or reviewing the staff workspace. Guest testers can use their own Telegram accounts from another location while the operator's backend is running. They must start the bot first. The operator links their chat ID to a separate current stay. Never give multiple active stays the same chat ID.

The staff workspace is currently local. Use a guided screen share or an agreed access arrangement rather than advertising an existing hosted dashboard. Do not post staff credentials publicly.

## Before a session

- Verify staff login, MongoDB connection, bot polling and the scheduled worker.
- Check whether accelerated scheduling is enabled. Enable it only for a short walkthrough; tell the tester the reminder schedule is accelerated.
- Use a future checkout time and check device timezone against Lagos display time.
- Record the room, booking and intended Telegram account. Do not delete earlier stay history to make the test work.
- Ensure there is only one running instance polling the same bot.

## Test sequence

| Step | Test | Expected observation |
| --- | --- | --- |
| 1 | Sign in with invalid then valid credentials | Invalid credentials do not open the workspace; valid credentials do |
| 2 | Enter a checkout time in the past, then correct it | Clear inline error disappears after correction |
| 3 | Refresh an unfinished check in form | Draft values and open state restore |
| 4 | Create a linked test stay | Stay appears and welcome reaches the correct Telegram account |
| 5 | Wait for satisfaction and reminder | Correct room and checkout time; demo offsets only when configured |
| 6 | Ask a casual greeting and two known hotel questions | Conversational answer; no unnecessary service request |
| 7 | Say I am hungry | Ask what the guest wants rather than assuming an order |
| 8 | Request fresh towels | One appropriate Housekeeping request |
| 9 | Change quantity or add detail to that request | Existing appropriate request receives the update |
| 10 | Ask for request status | Saved status is reported without another task |
| 11 | Ask for a menu when none is configured | Honest limitation and offer; no invented menu |
| 12 | Explicitly request a human | Visible review and Needs reply indicator |
| 13 | Open the chat without replying | Read changes do not silently clear Needs reply |
| 14 | Send a staff reply and close the review | Reply reaches Telegram; answered review can close |
| 15 | Complete a service request | Saved completion and one confirmed guest notification |
| 16 | Refresh mobile chat and change theme | Chat and navigation restore; layout stays usable |
| 17 | Select Ready to leave | Reception is still required to confirm departure |
| 18 | Confirm checkout | Current stay ends; history remains; feedback becomes due immediately |
| 19 | Rate once, then tap again | First rating is retained and counted once |
| 20 | Open Google review button | Correct hotel destination opens regardless of rating |
| 21 | Type after checkout or tap old operational buttons | Closed stay does not restart service workflow |
| 22 | Sign out and revisit the workspace | Session is revoked; login is required |

## Record observations

For each problem, record the test step, guest wording, expected behaviour, actual reply or action, approximate timestamp and whether an unintended task appeared. Share a cropped screenshot where useful. The operator can correlate the timestamp with response timing logs and saved message IDs. Do not include API keys, bot tokens, session cookies or real guest records in public feedback.

Measure three separate outcomes: was the answer useful and grounded, was the action correct, and how long did it take? A fast generic acknowledgement is not a successful answer to a routine question. A correct answer in one test does not establish reliability across every phrasing.

## Pilot acceptance questions

Can staff immediately identify the room and guest? Can they recognise an unanswered handoff without opening every chat? Do questions avoid creating physical work? Can a guest clarify a need and check status? Does checkout preserve history without restarting the old stay? Can staff recover safely when delivery is uncertain?

Before a real hotel pilot, replace sample hotel information, verify Google review destination, agree who owns unresolved work and review any failing test cases. Deployment and capacity testing are separate from this walkthrough.
