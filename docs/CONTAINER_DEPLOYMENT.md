# One-container demo deployment

The first deployment keeps Next.js, Express, WhatsApp and existing workers in
one container. MongoDB Atlas remains external. There is no new database service,
queue service or process manager. Docker restarts the process if it exits.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Build dependencies and dashboard; run as a non-root user |
| `compose.yaml` | One application, localhost port 5000, bounded logs and graceful shutdown |
| `deploy/container.env.example` | Runtime configuration template without credentials |
| `deploy/healthcheck.cjs` | Check API readiness and dashboard response |
| `deploy/release.sh` | Replace one instance; restore the previous image on failed readiness |
| `.github/workflows/container.yml` | Test, build, smoke-test and publish; optional demo deployment |

## First verification

On a computer with Docker Engine or Docker Desktop running, from the repository:

```sh
docker build -t sesora:demo .
```

The image build uses the normal frontend build. The local development server and
its generated files are not copied into the image. No real credentials belong in
the image, Git, workflow file or build arguments.

## One-time Linux server setup

1. Install Docker Engine, Compose **2.30 or newer**, Git and `flock` (util-linux).
2. Put the deployment files from the reviewed release in a stable checkout.
3. Copy `deploy/container.env.example` to `deploy/container.env`, restrict it to
   the deployment user (`chmod 600`), and edit it privately. Values are raw:
   **do not add surrounding quotes**. This preserves `$` in scrypt hashes and URIs.
4. Configure the Atlas network allowlist and database user for this server.
   Reuse the existing staff hash privately, or bootstrap individual staff accounts
   using the existing setup process. Finance requires individual accounts and a GM.
5. Put an HTTPS reverse proxy in front of `127.0.0.1:5000`; configure its public
   origin in the private environment. Proxy Socket.IO/WebSocket upgrades too.
   The supplied Compose file does not expose an unsecured public dashboard.
6. If GHCR images are private, authenticate Docker on the server with read-only
   package access. This is separate from the workflow's image-publishing token.
7. Start the first tested image with `bash deploy/release.sh IMAGE_DIGEST`.

Messaging is deliberately off in the template. Enable the appropriate existing
features only after dashboard verification. WhatsApp currently requires
`sesora_whatsapp_lab`; this update does not remove that isolation rule. Copy the
existing encrypted-session Mongo URI and encryption key privately, then stop the
old WhatsApp process before enabling the server owner. Existing session records
and scheduled jobs stay in Atlas. A new/unpaired session needs initial pairing.
Never run the same WhatsApp session on the laptop and server simultaneously.

Keep the existing Le Harve deployment and its configuration separate. For a
finance-only setup with messaging disabled, use the existing non-WhatsApp channel
configuration rather than bypassing the WhatsApp laboratory restriction.

## Release pipeline

Pull requests run tests, build the image and smoke-test combined startup against
a disposable MongoDB replica set. A successful `main` run publishes a commit-tagged
GHCR image and passes its immutable digest to deployment.

Demo deployment remains **off by default**. Configure the GitHub `demo` environment:

| Setting | Type | Purpose |
| --- | --- | --- |
| `DEMO_HOST`, `DEMO_USER`, `DEMO_PATH` | Variables | Linux server and stable deployment checkout |
| `DEMO_SSH_KEY` | Secret | Dedicated deployment account key |
| `DEMO_KNOWN_HOSTS` | Secret | Server host key verified independently |
| `DEMO_AUTO_DEPLOY` | Variable | Set to `true` after a successful manual rehearsal |

Alternatively, manually run the workflow on `main` with `deploy_demo` checked.
The workflow uses the stable server-side release script; it does not `git pull`
over live configuration. Synchronize changes to deployment files deliberately.
No existing Render service is reconfigured by these files. Live hotels should
have a separate deployment environment and an approval gate before adoption.

The release script pulls before stopping, stops the old instance gracefully,
starts the candidate and waits roughly two minutes for Docker health. Healthy
means MongoDB, the dashboard and, when enabled, WhatsApp are ready. A failed
replacement restores and checks the previous image. Failed releases still fail
CI even when recovery succeeds; a failed rollback is reported separately.

```sh
# Manual rollback to the saved previous image, using the same checks:
bash deploy/release.sh "$(cat .release/previous)"
```

This includes brief downtime. First deployment has no previous image to restore.
Rollback restores application code, **not database changes or runtime settings**.
Do not introduce incompatible schema migrations without a separate migration and
backup plan. Deployment health is not proof that Gemini is available or every
business journey works; keep the existing journey tests and live checks.

## Verification status — 14 November 2026

Locally: nine deployment/health tests passed, using a simulated Docker CLI and a
real HTTP fixture. Full backend run: 283 tests, 273 passed, 10 database-dependent
tests skipped because no test database was configured. Frontend: 31 tests passed.
Production frontend build passed using Webpack because this workspace links its
dependencies outside the build root. YAML parsing and shell syntax checks passed.

Docker Engine is unavailable in this workspace. Actual image build, pruned-runtime
startup, Compose integration and the GitHub workflow remain unverified until CI
or Docker Desktop runs them. No image was published and no server was deployed.
One-GB RAM suitability has not been measured. The pipeline builds off-server,
but runtime memory still needs measurement during the first deployment.
