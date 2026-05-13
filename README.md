# PipelineLite

A self-hosted mini CI/CD server in Node.js — webhook-triggered builds with
real-time log streaming, branch filtering, and a per-build workspace clone.
Think "GitHub Actions, rebuilt from first principles to understand the internals."




---

## What it does

- Receives GitHub `push` webhooks and verifies them with HMAC-SHA256
- Clones the repo at the pushed commit into a per-build workspace
- Runs `pipeline.sh` from the repo (or a built-in fallback) as a child process
- Streams stdout/stderr line-by-line to a browser dashboard over Socket.io
- Persists build history, exit codes, timestamps, and logs to disk
- Queues concurrent builds with a configurable concurrency cap
- Filters incoming events by branch using glob patterns
- Authenticates dashboard / API / WebSocket via HTTP Basic Auth
- Exposes a REST API for build list and detail (`/api/builds`, `/api/builds/:id`)

---

## Architecture

```
       GitHub                  PipelineLite                    Browser

       ┌──────┐    webhook    ┌───────────────────────────┐    ┌──────────┐
       │ push │ ────────────▶ │  POST /webhook            │    │          │
       └──────┘  (HMAC sig)   │   ├─ verify HMAC          │    │ dashboard│
                              │   ├─ extract branch       │    │  +       │
                              │   ├─ branch allow-list?   │    │ Socket.io│
                              │   └─ enqueue build        │    │  client  │
                              │             │             │    │          │
                              │             ▼             │    │          │
                              │   buildQueue (FIFO, n=1)  │    │          │
                              │             │             │    │          │
                              │             ▼             │    │          │
                              │   buildRunner             │    │          │
                              │    ├─ git clone           │    │          │
                              │    ├─ git checkout <sha>  │    │          │
                              │    ├─ spawn pipeline.sh   │    │          │
                              │    └─ stream out/err      │    │          │
                              │             │             │    │          │
                              │             ▼             │    │          │
                              │   buildEvents (pub/sub)   │    │          │
                              │    ├─ append to log file  │    │          │
                              │    └─ emit to room ───────┼───▶│ <pre>    │
                              │                           │    │  log…    │
                              │   buildStore (JSON)       │    │ </pre>   │
                              │    └─ persists metadata   │◀──┐│          │
                              └───────────────────────────┘   │└──────────┘
                                                              │
                                       GET /api/builds (polled, ETag-cached)
```

The runner is decoupled from the queue, the queue from the persistence layer,
and the live stream from the file log — each piece can be swapped (e.g. JSON →
SQLite, in-process EventEmitter → Redis pub/sub) without touching the others.

---

## Engineering highlights

A few decisions that shaped the codebase:

**Constant-time HMAC verification.** Webhook signatures are compared with
`crypto.timingSafeEqual` over equal-length buffers. A naive `===` would leak
the signature byte-by-byte through response-timing differences. The webhook
route also uses `express.raw()` — not `express.json()` — because re-stringified
JSON has different bytes from the original and would invalidate the hash.

**Streaming, not buffering, child processes.** Builds use `child_process.spawn`
with `shell: false`. `exec` would buffer everything in memory (with a 1 MB
default cap), run via `/bin/sh -c` (a command-injection vector), and break on
long logs. User-supplied values (`ref`, `commit`, `repo`) reach the build
script only through environment variables — never as shell-interpolated args.

**Per-build Socket.io rooms.** Each build streams into a `build:<id>` room.
Clients subscribe by id, validated against a strict regex before being used
in any filesystem call. The runner emits once; Socket.io fans out. Two
dashboards on the same build see identical streams; dashboards on different
builds never cross-talk.

**Snapshot + live, in that order.** On `subscribe`, the server joins the
client to the room *first*, then reads the existing log file and emits a
`snapshot`. If the read came first, a chunk emitted in between could be lost
forever. The current order may emit one duplicated line in the worst case —
preferable to silent data loss.

**Defense-in-depth auth.** Dashboard, REST API, and Socket.io handshake all
gate on the same predicate (`isAuthorizedReq`). `/webhook` is exempt because
HMAC is its own authentication; `/health` is exempt for uptime probes. The
order of `app.use(...)` in `server/app.js` enforces this exemption at the
middleware layer rather than per-route.

---

## Tech stack

| Layer        | What I used                                                  |
|--------------|--------------------------------------------------------------|
| Runtime      | Node.js 18+ (ESM, no transpile step)                         |
| HTTP         | Express 4                                                    |
| Realtime     | Socket.io 4 (rooms)                                          |
| Crypto       | Node `crypto` module — HMAC-SHA256, `timingSafeEqual`        |
| Process mgmt | `child_process.spawn` with output piping                     |
| Persistence  | JSON file with atomic writes (tmpfile + rename)              |
| Frontend     | Vanilla HTML / CSS / JS — no build step, no framework        |
| Dev tools    | `nodemon`, hand-rolled `dev-send-webhook.sh` (openssl + curl)|

No build pipeline. No `webpack`. No `tsc`. Open the repo, run `npm install`,
read the code top-to-bottom.

---

## Quick start

```bash
git clone https://github.com/<your-username>/pipelinelite.git
cd pipelinelite
npm install
cp .env.example .env          # then edit to set GITHUB_WEBHOOK_SECRET
npm run dev
```

Dashboard at `http://localhost:4000/`.

To trigger a build locally without a GitHub webhook, point the included
helper at any local git repo:

```bash
# create a tiny demo repo with a pipeline.sh
mkdir -p /tmp/demo && cd /tmp/demo
git init -q
cat > pipeline.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "building $BUILD_REPO @ $BUILD_BRANCH"
sleep 1 && echo "tests passed"
EOF
chmod +x pipeline.sh
git -c user.email=demo@local -c user.name=demo \
    commit -aq --allow-empty -m "init" && git add . && git commit -m init
cd -

# fire a signed webhook at the local server
CLONE_URL=file:///tmp/demo ./scripts/dev-send-webhook.sh
```

Watch the dashboard — a new build appears, clones the repo, runs the script,
and streams the output live.

---

## Configuration

All configuration is via environment variables (`.env`). Empty / unset means
"use the default."

| Variable                | Default        | Description                                                       |
|-------------------------|----------------|-------------------------------------------------------------------|
| `PORT`                  | `4000`         | HTTP port                                                         |
| `NODE_ENV`              | `development`  | In any non-dev value, missing auth credentials cause a hard fail. |
| `GITHUB_WEBHOOK_SECRET` | *(required)*   | Shared secret for HMAC-SHA256 webhook verification                |
| `ALLOWED_BRANCHES`      | *(empty)*      | Comma-separated glob list (`main,release/*`). Empty = allow all.  |
| `DASHBOARD_USER`        | *(empty)*      | Set together with `DASHBOARD_PASSWORD` to enable Basic Auth.      |
| `DASHBOARD_PASSWORD`    | *(empty)*      | A 24+ char random string is a good default.                       |

---

## Project layout

```
pipelinelite/
├── server/
│   ├── app.js                       Express + Socket.io wiring; listens
│   ├── config/env.js                Validated, frozen config object
│   ├── middleware/basicAuth.js      Constant-time Basic Auth + logout
│   ├── routes/
│   │   ├── webhook.routes.js        POST /webhook
│   │   └── build.routes.js          GET /api/builds, GET /api/builds/:id
│   ├── controllers/
│   │   ├── webhook.controller.js    HMAC verify → service dispatch
│   │   └── build.controller.js      Thin REST layer over buildStore
│   ├── services/
│   │   ├── webhook.service.js       Parse + branch filter + enqueue
│   │   ├── buildStore.js            Atomic JSON persistence
│   │   ├── buildQueue.js            FIFO with concurrency cap
│   │   ├── buildRunner.js           Clone, checkout, spawn, stream
│   │   └── buildEvents.js           Internal pub/sub (EventEmitter)
│   ├── socket/io.js                 Socket.io attach + room handlers
│   └── utils/
│       ├── logger.js                ISO-8601 structured logger
│       ├── buildId.js               Sortable, collision-resistant ids
│       ├── verifySignature.js       HMAC-SHA256 with timingSafeEqual
│       └── branchFilter.js          Tiny glob matcher
├── client/
│   ├── index.html                   Master-detail dashboard shell
│   ├── styles.css                   Dark theme, animated status pills
│   └── app.js                       Vanilla JS — Socket.io client
├── scripts/
│   ├── build.sh                     Fallback pipeline script
│   ├── dev-send-webhook.sh          HMAC-signed test webhook (openssl + curl)
│   └── dev-tail-build.mjs           CLI log tail via socket.io-client
├── .env.example
├── package.json
└── README.md
```

---

## Connecting to GitHub

For local development, expose your server to GitHub with [zrok](https://zrok.io)
(reserved shares stay stable across restarts on the free tier) or
[ngrok](https://ngrok.com):

```bash
# zrok — first time
zrok reserve public --backend-mode proxy http://localhost:4000
# every subsequent session
zrok share reserved <your-token>
```

Then in your GitHub repo: **Settings → Webhooks → Add webhook**
- **Payload URL:** `https://<your-token>.share.zrok.io/webhook`
- **Content type:** `application/json`
- **Secret:** the value of `GITHUB_WEBHOOK_SECRET` in your `.env`
- **Events:** just the push event

Push a commit to an allowed branch and watch the dashboard.

---

## Roadmap

Building blocks that fit naturally on top of the current core:

- **Retry / cancel buttons** in the UI, backed by `POST /api/builds/:id/retry`
  and `POST /api/builds/:id/cancel` (SIGTERM → SIGKILL).
- **Multi-step pipelines from a YAML manifest** in the repo
  (`.pipelinelite.yml`) instead of a single `pipeline.sh`.
- **Slack / Discord notifications** on status change.
- **SQLite migration** for the build store — same `buildStore.js` API, better
  query surface, scales past tens of thousands of builds.
- **Docker-isolated runners** so a hostile build can't escape into the host.
- **Webhook replay protection** — dedupe by `X-GitHub-Delivery` ID + reject
  deliveries older than a 5-minute window.
- **Persistent queue** that survives restart, with orphan-reconciliation on
  boot.

---

## What I learned building this

Concrete things that surprised me or that I'd been hand-waving before:

- **The `express.json()` + HMAC trap.** Parsing the body before verifying the
  signature silently breaks verification, because `JSON.stringify` of the
  parsed object produces different bytes than the original payload. The fix
  is `express.raw()` on the webhook route only — and the order of middleware
  matters more than I thought.
- **Timing-safe compare isn't just for HMAC.** Password comparison in Basic
  Auth has the same vulnerability. Both use `crypto.timingSafeEqual` over
  same-length buffers; for arbitrary-length strings I HMAC both sides with a
  random key first to guarantee equal-length digests before comparing.
- **`exec` is a footgun.** It buffers everything (1 MB default), runs via
  `/bin/sh -c` (injection vector), and dies silently on long logs. `spawn`
  with `shell: false` is the right primitive for CI workloads.
- **Socket.io rooms are pub/sub, not connection pools.** One server-side
  listener emits once; Socket.io fans out. Subscribing per-connection would
  multiply work by N.
- **Atomic writes are one extra `rename`.** Writing to `<file>.tmp` then
  `fs.rename`-ing onto the target guarantees readers never see a half-written
  file. On POSIX filesystems this is genuinely atomic.
- **HTTP Basic Auth has no logout in the protocol.** The modern workaround
  is `Clear-Site-Data` on a 401 response; modern Chromium-based browsers
  clear the auth cache. Safari still requires closing the tab.
- **Polling-friendly cache headers exist.** Express attaches ETags to JSON
  responses automatically; an unchanged poll becomes a 200 → 304 → 304 …
  pattern at ~200 bytes per request. Massive bandwidth saving with one line
  of "do nothing differently."
- **Master-detail UX rule:** poll the list, stream the detail. Different
  freshness needs deserve different transports. Same shape that GitHub
  Actions, Jenkins Blue Ocean, and GitLab CI use.

---

## License

MIT
