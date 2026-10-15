# Hotel Guest Ops

Hotel guest service software that brings guest conversations, service
requests and automated stay messages into one staff workspace.

Ready for supervised early testing. Currently runs locally with Telegram
as the guest messaging channel. Public hosting is not configured yet.

## What works

- Record guest check-ins and link Telegram conversations to individual stays.
- Send welcome messages, satisfaction checks and checkout reminders.
- Answer guest questions using configured hotel information.
- Clarify incomplete needs before creating service requests.
- Route requests to hotel departments and preserve follow-up messages.
- Let staff reply, complete service work and notify guests.
- Track unread messages separately from handoffs needing a staff reply.
- Confirm checkout and retain the conversation in History.
- Invite internal ratings and offer a Google review link after checkout.
- Display a compact feedback summary for the last 30 days.
- Protect the staff workspace with login and revocable sessions.
- Support mobile layouts, light and dark themes, and check-in draft recovery.

## Technology

- Frontend: Next.js, React, TypeScript and CSS modules
- Backend: Node.js and Express
- Database: MongoDB Atlas with Mongoose
- Guest messaging: Telegram through grammY
- AI interpretation: Google Gemini
- Dashboard updates: Socket.IO
- Scheduled messages: MongoDB-backed job worker

## Local setup

Install dependencies separately in backend and frontend using npm ci.

Configure the backend environment with database and provider credentials.
Never commit environment files or credentials.

From backend, create staff access:

    node scripts/setup-staff.cjs

Start the backend:

    npm start

In another terminal, start the frontend from frontend:

    npm run dev

Default local addresses:

- Backend: http://localhost:5000
- Frontend: http://localhost:3001

Guests must start the Telegram bot before it can message them.
Each Telegram chat should have only one active stay.

## Verification

From backend:

    node --test ./tests/*.test.cjs

From frontend:

    npm run lint
    npm run build

At the documented testing milestone, 99 backend tests passed,
along with frontend lint and production build checks.

These checks do not establish production capacity or guaranteed
AI availability.

## Current limitations

- AI provider failures can still create unnecessary staff reviews.
- Hotel answers depend on the completeness of configured information.
- Some complex or multi-part requests need further refinement.
- Staff access currently uses one configured hotel account.
- Scheduled messages require the backend process to be running.
- Deployment and production load testing remain outstanding.

## Product scope

This is a guest service layer intended to complement a hotel's existing
property management system.

WhatsApp, PMS integration and voice calling are not implemented.
Internal ratings are separate from Google reviews.

## Documentation

- [Project handbook](docs/PROJECT_HANDBOOK.md)
- [Supervised testing guide](docs/TESTING_GUIDE.md)

The handbook describes the current milestone, architecture,
configuration, workflows and known limits.

## Testing access

Supervised testing is available by arrangement. Contact the project
maintainer to organise a guided walkthrough.
