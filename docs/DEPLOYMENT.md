# Guided deployment on Render

This deployment serves Next.js and Express together as one Node web service. MongoDB Atlas remains the database. The public staff workspace, APIs and Socket.IO use one HTTPS origin. The existing two terminal local development mode remains available when SERVE_FRONTEND is not true.

## What changes

The root render.yaml defines a Free web service on main, Node 24.15.0, a build that installs backend and frontend dependencies and builds Next.js, and start command node backend/server.js. API routes are served by Express before Next.js. Login uses the existing secure HttpOnly session cookie. Database credentials and provider keys stay in the Render environment, not the repository.

Telegram uses webhooks on the hosted service and polling locally. The webhook route is /telegram/webhook. It does not require a staff session: grammY verifies a private Telegram header before running the same existing guest handlers. The configured random secret is converted to a SHA256 hex header value because Telegram does not accept every character in Render generated base64 secrets. No secret is printed or returned publicly.

Webhook responses await handler completion. Failures receive an error response instead of an unconditional early success. This is not a new durable incoming queue and does not make existing message processing crash recoverable. Telegram retries, application idempotency and outbound uncertainty protections still have their existing limits. A process death after a message is recorded can require staff inspection. Serial webhook delivery is deliberately retained for a small guided test; this is not a concurrent hotel capacity deployment.

Health returns 503 until database connection, startup, worker and Telegram setup have completed, and when the MongoDB connection is down. It does not continuously probe Telegram or Gemini. Startup failures exit rather than leaving a falsely healthy service online. Shutdown stops new job polling and drains HTTP connections within a bounded shutdown window.

## Prepare locally

1. Install this update using its Install.ps1. It checks all three existing source files before copying anything and backs up modified files outside the repository. It does not alter your .env or password.
2. From backend, run node --test .\tests\*.test.cjs. From frontend, run npm run lint and npm run build. From the repository root, run git diff --check.
3. Commit only the eight listed deployment files and push main. The update installer does not commit or push.
4. Stop the local backend with Ctrl+C before creating the hosted service. Never run both receivers for the same bot during testing. Close the local frontend to avoid confusing local and hosted sessions.

## Create the service

In Render, choose New, then Blueprint. Connect the GitHub repository keyzcodes/hotel-guest-automation and select main. Render reads render.yaml at the repository root. Review that only one service is being created and its compute plan is Free. Do not add a Render database or paid service for this walkthrough.

The Blueprint prompts for the following values. Copy them privately from backend/.env into the Render dashboard. Do not paste them into chat or a GitHub commit:

- MONGO_URI: the current MongoDB Atlas URI.
- TELEGRAM_BOT_TOKEN: the bot token currently used locally.
- GEMINI_API_KEY: the working AI key. If your local setting uses GOOGLE_API_KEY, enter that value here.
- STAFF_EMAIL: the configured staff login email.
- STAFF_PASSWORD_HASH: the entire existing hash, including every dollar sign. This is the hash, not your plain password.

Render generates TELEGRAM_WEBHOOK_SECRET. The manifest sets GEMINI_MODEL to gemini-3.1-flash-lite and USE_MOCK_AI to false. JOB_DEMO_MODE is true so new stays use the short guided walkthrough schedule. Staff login credentials remain the same; local browser sessions do not transfer to the hosted domain.

Do not add SERVE_FRONTEND=true to your local .env unless you intend to run the combined production build. Do not manually override Render's PORT. Do not set BACKEND_URL for this combined deployment. Do not copy a local FRONTEND_ORIGINS value to Render.

Render supplies RENDER_EXTERNAL_URL, used for webhook registration and allowed staff origins. The host must be a plain HTTPS origin. If using a custom domain later, set APP_PUBLIC_URL to that origin and update FRONTEND_ORIGINS deliberately. Do not use wildcard origins.

## Atlas network access

Check Atlas Network Access before deployment. In the Render service dashboard, obtain its outbound IP ranges and add those specific ranges to the Atlas project IP access list. Keep existing local access only where still needed. Do not broadly open the database to the entire internet as the default fix. Use the existing database credentials privately. Changing the network list does not require changing application records.

If startup reports a connection selection error, inspect Atlas access and the service logs before retrying. If the initial deployment times out before you can obtain ranges, add the service's ranges and deploy again. Never publish a complete MongoDB connection string in a screenshot.

## Verify after Render reports Live

1. Open the assigned HTTPS URL. Confirm the hotel login appears.
2. Open /health in another tab. Confirm status OK. Open /api/auth/session before signing in: 401 is expected.
3. Sign in using the configured email and password. Confirm stays, requests and conversations load. Historical test records remain because the Atlas database is unchanged.
4. Use two browser windows to check saved dashboard updates. The current client uses Socket.IO HTTP polling.
5. Create a separate test stay linked to your Telegram chat, with a future checkout. Confirm welcome, satisfaction check and reminder. Test a normal question, clarification, service request and staff reply.
6. Confirm departure and the feedback invitation, then test a rating and old operational buttons.
7. Sign out. Confirm the protected workspace cannot reopen without signing in.
8. With the local backend still stopped, send a fresh Telegram message during an active hosted test stay. This demonstrates that the hosted service is processing it. Localhost is no longer required for this test.

From backend on your PC, node .\scripts\telegram-webhook.cjs status can show whether a webhook is configured, its public URL, pending update count and last Telegram delivery error. It does not print the bot token or webhook secret. A historic last error can remain even after recovery; compare its timing with current behaviour and the live logs.

## Free service limitations

Render Free services sleep after 15 minutes without incoming traffic and can take about a minute to wake. Opening the dashboard before a planned test helps establish that it is awake. A Telegram webhook request can initiate wakeup, but the first message can be delayed and retried. Opening the site is not a guarantee of uninterrupted future uptime.

The scheduled worker cannot run while the service sleeps. Due jobs remain in MongoDB and are checked after resume, subject to stay eligibility. There is no on time background job guarantee on this plan. Keep the dashboard active during the guided journey. The plan is for testing, not 24 hour hotel operations. Included usage limits and provider quotas still apply; do not enable billable services by accident.

Only the website hosting service is configured as Free. Existing AI and database accounts have their own usage and billing rules. The source has no paid fallback provider or guaranteed availability. If the combined app exceeds the free instance's memory limits, inspect logs and choose whether to split services or upgrade; this change is not a capacity guarantee.

## Recover or return to local polling

If the new hosted service fails, keep its logs and do not reset the database. Fix the relevant environment or access setting, then redeploy. For source rollback, use the installer backup or Render's earlier successful deployment; review any mismatch in registered Telegram URL.

To deliberately return to local polling, stop or suspend the hosted service first. From backend, run:

    node .\scripts\telegram-webhook.cjs clear --confirm-hosted-bot-stopped

This removes the webhook without dropping pending updates. Then run the local backend with TELEGRAM_MODE unset or polling and SERVE_FRONTEND unset or false. A local startup refuses to silently remove a configured hosted webhook. Do not clear it while expecting the hosted bot to continue receiving messages.

The deployment does not remove the old exported startTelegramBot compatibility function. The updated server uses createTransport, which is the supported hosting entry point.

## Evidence and references

The source update passed 107 backend tests, including eight new deployment transport tests. The frontend production build passed. A combined server smoke check exercised the dashboard, health, anonymous API rejection, origin rejection and forged webhook rejection using isolated test dependencies. It made no Atlas writes or provider calls. Actual Render account setup, network access, live credentials, hosted cookies and Telegram delivery must still be verified after deployment.

Official documentation checked 16 October 2026:

- https://render.com/docs/free
- https://render.com/docs/blueprint-spec
- https://grammy.dev/ref/core/webhookoptions
- https://nextjs.org/docs/app/guides/custom-server
