# WhatsApp guest-request integration — first slice

Base: c33df7d, feature/le-harve-reporting. Implementation branch: feature/whatsapp-integration.
This is a local test integration, not a deployment or a production-ready messaging service.

## Included

- One Guest WhatsApp number input replaces the phone/chat-ID combination.
- Backend phone normalization; newly checked-in guests have an explicit WhatsApp identity.
- Exactly one active matching stay is required before automatic room requests.
- Incoming messages use the established AI decision validation, ticket creation, fallback, and duplicate protections.
- Staff replies and service completion confirmations use the connected WhatsApp number.
- Unlinked or unsupported messages remain visible under Chats > Guest matching needed.
- Reception can link unlinked messages only when the recorded number matches exactly one active stay.
  Linking moves messages into the guest conversation for manual review. It never executes old messages as requests.
- The encrypted Atlas auth session can reuse the standalone lab's session and key.
- A lease prevents two copies of this integration owning the same session. The older standalone lab has no lease:
  it MUST be stopped before this integration runs.
- No guests need pairing; only the Business test number is linked.
- The integration launcher fixes the application database to sesora_whatsapp_lab, disables reporting, and uses ports 5001/3002.

## Deliberately pending

Welcome, pulse checks, checkout reminders, ratings, and GM summaries are NOT implemented for WhatsApp in this slice.
The WhatsApp job worker and reminder scheduling are disabled, so legacy scheduled jobs cannot send through the old provider.
Existing provider implementation is retained dormant to keep the migration reversible until live WhatsApp checks pass.
No room inventory, booking-agent tools, payment confirmation, or receipt generation were added.

## Install the patch in a separate Windows working copy

Extract the downloaded ZIP into Downloads/whatsapp-integration-update. From PowerShell:

    git -C "C:\Users\HP\hotel-guest-ops" worktree add -b feature/whatsapp-integration "C:\Users\HP\hotel-whatsapp-integration" c33df7d
    cd "C:\Users\HP\hotel-whatsapp-integration"
    git apply --check "$env:USERPROFILE\Downloads\whatsapp-integration-update\whatsapp-integration.patch"

Stop if the check fails. If it succeeds:

    git apply "$env:USERPROFILE\Downloads\whatsapp-integration-update\whatsapp-integration.patch"
    npm --prefix backend ci
    npm --prefix frontend ci --include=dev

Stop on any install error. No command commits, pushes, merges, or deploys.

## Local settings without typing secrets into chat

The original backend .env must contain STAFF_EMAIL and STAFF_PASSWORD_HASH.
The standalone lab .env must contain its working LAB_MONGO_URI and LAB_SESSION_KEY.
After installation run:

    node backend/scripts/whatsapp-setup.cjs "C:\Users\HP\hotel-guest-ops\backend\.env" "$env:USERPROFILE\Downloads\sesora-whatsapp-lab\.env"

This creates ignored backend/.env.whatsapp from the lab URI/key and existing login hash, with an optional AI key.
It does not copy the hotel database URI, edit either input file, or print credentials.
If .env.whatsapp already exists, it stops without replacing it. Keep this file private.

## Run

1. Stop the standalone lab with Ctrl+C. Stop all other processes using the same WhatsApp linked session.
2. In the new integration working copy:

       npm --prefix backend run start:whatsapp

3. Wait for "WhatsApp connected". The existing session should reconnect; scan the QR with the Business test phone only if needed.
4. In a second terminal in the same working copy:

       npm --prefix frontend run dev:whatsapp

5. Open http://localhost:3002 and use the existing local .env staff login.
   This uses its hash in the isolated database; individual Le Harve staff accounts are not copied.
6. Check in a synthetic guest with your personal WhatsApp number and a test room.
   Use fresh test data only; existing hotel bookings are not migrated.
7. From that personal WhatsApp send exactly "Please send towels".
8. Verify one housekeeping request for the test room and an acknowledgement in WhatsApp.
9. Mark the request completed. Verify one completion message, including after repeated clicks.
10. Restart the backend and verify reconnect, staff reply, and a fresh request.
11. Test an unknown personal number: it should appear under Guest matching needed without a room assignment or automatic reply.
    Register that number as a test guest, then link the old messages for staff review.
12. Confirm check-in rejects the same number on a second active stay.

## Verification performed here

Automated backend tests cover normalization, sender identity, active-stay routing, duplicate message replay,
unlinked/ambiguous senders, WhatsApp completion deduplication, encrypted auth roundtrip/tampering,
and check-in validation. Existing backend/frontend regression suites, frontend lint and production build were run.
A real Atlas financial verification test is opt-in and was skipped. No real hotel database was accessed.
Live WhatsApp pairing, transport reconnect, dashboard roundtrip, LID resolution, and delivery must be verified
on the user's test number; the previous standalone lab success does not prove this integration passes them.

## Operating limits

Use one integration process. The laptop must stay online with the backend running.
A provider message ID confirms submission, not guest delivery or reading. Uncertain sends are marked unconfirmed
and are not automatically resent. Never use a hotel's live number for these development checks.
Current sample hotel amenities are demonstration data; replace them with approved information before any live rollout.
