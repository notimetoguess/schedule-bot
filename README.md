# Schedule Telegram Bot

Telegraf.js bot for viewing a student's schedule. The Ukrainian interface supports today's schedule, the remainder of the current academic week, and a custom range with an inline calendar.

Users authenticate in a Telegram Mini App. Their email and password never appear in a Telegram message. The server validates Telegram's signed launch data, exchanges the credentials directly with WebDk, discards them, and stores only the access token, Telegram user ID, and session timestamps in MongoDB Atlas. Authorized sessions survive process restarts without requiring persistent local disk.

Inline mode works in groups and channels without adding the bot. Type `@your_bot_username show all` for the general schedule or `@your_bot_username show me` for compulsory and selected subjects. A bare `show` query displays those choices and makes no authentication, subject, or schedule request. When WebDk lists multiple semesters for a personal schedule, choose the semester explicitly; the bot does not guess from the semester numbers. In private chat, choose “Загальний розклад” or “Мій розклад” and then select today, this week, or a custom range. An unauthenticated user types `@your_bot_username login` to reveal the top-level “Авторизуватися” Mini App button. After login, “Повернутись до групи” closes the Mini App and reveals the exact originating chat without a picker.

Each user can start at most two login or schedule operations in a rolling 30-second window. A personal schedule operation may make both a timetable request and a student-subject request; the UI limit applies once to the schedule operation.

## Project structure

The source is grouped by runtime responsibility:

~~~text
src/
├── bot/           # Telegraf setup, commands, actions, handlers, middleware, and keyboards
├── auth/          # Authentication sessions, challenges, and Telegram initData validation
├── http/          # Authentication server, endpoint handlers, and HTTP helpers
├── integrations/  # External API clients
├── schedule/      # Schedule date calculations and message formatting
├── shared/        # Utilities shared across runtime boundaries
├── stores/        # General-purpose in-memory stores
├── webapp/        # Static Telegram Mini App assets
├── config.ts      # Environment configuration
├── index.ts       # Process composition and lifecycle
└── types.ts       # Shared domain data types
~~~

Add Telegram commands, callback actions, and update handlers to the corresponding directory under `src/bot`, then register them in `src/bot/bot.ts`. Keep HTTP route selection in `src/http/auth-server.ts` and endpoint behavior in `src/http/handlers`.

## Requirements

- Node.js 20 or newer
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An HTTPS URL that forwards to the local authentication server

## Setup

~~~bash
npm install
cp .env.example .env
~~~

Configure:

~~~dotenv
BOT_TOKEN=123456789:replace-with-your-bot-token
WEBDK_API_VERSION=2.18
AUTH_WEBAPP_URL=https://your-public-https-host.example
AUTH_HOST=127.0.0.1
AUTH_PORT=3000
WEBAPP_INIT_DATA_MAX_AGE_SECONDS=300
AUTH_SESSION_MAX_AGE_SECONDS=604800
AUTH_CREDENTIALS_ENCRYPTION_KEY=base64-encoded-32-byte-secret
MONGODB_URI=mongodb+srv://username:password@cluster.example.mongodb.net/
MONGODB_DATABASE=schedule_bot
~~~

Create a MongoDB Atlas cluster near the bot deployment, create a database user with `readWrite` access restricted to `schedule_bot` (or your `MONGODB_DATABASE`), and allow the deployment's outbound IP addresses in Atlas Network Access. Copy the driver connection URI into the server-only `MONGODB_URI` setting, URL-encoding any special characters in credentials. Never commit this URI. The official MongoDB driver uses one shared client with bounded connection/operation waits.

In the background the app connects and creates the `auth_sessions` TTL index on `expiresAt` with `expireAfterSeconds: 0`; database-dependent actions stay temporarily unavailable until this completes. HTTP and Telegram start independently. A single worker retries indefinitely with exponential backoff (one second to 60 seconds, with jitter), and monitors connectivity every 15 seconds. Connection selection allows 30 seconds; session operations are capped at ten seconds and readiness probes at five seconds. Sessions remain in MongoDB throughout outages; application writes are never replayed by the recovery worker. Each document has a string Telegram user ID as `_id`, an `accessToken`, and BSON Date `createdAt`/`expiresAt` fields. MongoDB TTL performs eventual cleanup; the application checks expiry on every lookup, so delayed deletion never extends authorization. Reads do not renew expiry.

Atlas supplies TLS and disk encryption. Tokens are not additionally encrypted by the application, so database users with read access can see them. See [Atlas security](https://www.mongodb.com/docs/atlas/reference/faq/security/) and [TTL behavior](https://www.mongodb.com/docs/manual/core/index-ttl/).

Migration requires one fresh login per user. The old encrypted file is not imported or read; remove the old `AUTH_SESSION_FILE` and `AUTH_SESSION_ENCRYPTION_KEY` deployment settings and retire the old file after rollout. Conversation state, challenges, and rate limits remain in memory: run a single bot process.

Database outages return a temporary service error rather than a login prompt. Logs distinguish `Authorization session missing`, `Authorization session locally expired`, `WebDk rejected authorization session before local expiry`, and `Authorization database error`. Saved sessions log creation/expiry timestamps, never credentials or tokens. A missing record can also mean TTL already cleaned it up; correlate with the earlier save timestamp. These diagnostics help investigate early logout; MongoDB cannot extend a token that WebDk rejects.

`WEBAPP_INIT_DATA_MAX_AGE_SECONDS` is only the maximum age of Telegram's signed data while opening the authorization form; it is not the authorized-session duration. `AUTH_SESSION_MAX_AGE_SECONDS` caps an ordinary session at seven days by default. If WebDk's `expires_in` is shorter, the shorter upstream lifetime is used. Remember-me sessions have a fixed 14-day window.

Selecting “Запам'ятати мене” explicitly stores the WebDk email and password encrypted with AES-256-GCM for the fixed remember-me window, so the bot can obtain a replacement token after WebDk ends a session. Set `AUTH_CREDENTIALS_ENCRYPTION_KEY` to a unique base64-encoded 32-byte deployment secret before enabling it. Logout deletes both the token and encrypted credentials. Successful schedule responses are cached in process memory for five minutes and never shared between users.

### Update announcements

Create announcements in the `announcements` collection in the configured MongoDB database. A document with `status: "drafted"` is not sent. Publish it by changing the status and setting `publishedAt` to a BSON Date:

~~~javascript
db.announcements.updateOne(
  { _id: "remember-me-14-days", status: "drafted" },
  {
    $set: { status: "published" },
    $currentDate: { publishedAt: true }
  }
)
~~~

Announcement documents require a stable string `_id`, nonempty plain-text `text`, and `status` (`drafted` or `published`). `publishedAt` is required when published. Text-only updates support Telegram's 4,096-character limit. To attach one photo or video, add `media: { type: "photo" | "video", url: "https://..." }` or use `fileId` instead of `url`; captions are limited to 1,024 characters. A tutorial webpage can be linked in the text. Published content is snapshotted when first processed; create another document for a correction.

The bot checks for updates every minute and delivers them to registered active private chats and groups. A new chat receives the latest published announcement, followed by future announcements. The bot learns a private chat from a message or callback and a group from a delivered message or its Telegram membership update. To register a group where the bot was already present before this feature, send `/start@your_bot_username` there. Typing `@your_bot_username show me` uses inline mode and does not reveal that group's chat ID.

### Admin cabinet

Set `ADMIN_EMAILS` to a comma-separated list of normalized LNTU emails. After a fresh successful WebDk login, a listed account sees **«Твій кабінет»** in the bot's private menu (and can use `/cabinet`). The account identity is stored with the authorization session; old sessions need one new login before the cabinet appears.

The cabinet creates durable drafts and publishes announcements without manually entering JSON, IDs, or BSON dates. A draft can contain text only (up to 4,096 characters), or one photo/video with a caption (up to 1,024 characters). Attach media by sending it to the bot, an HTTPS URL, or an existing Telegram `file_id`. Publication freezes the reviewed text/media and sets `publishedAt` automatically; the existing notification worker queues delivery on its next one-minute reconciliation.

MongoDB stores `notification_chats` and a durable `announcement_deliveries` ledger alongside `announcements`. Pending sends recover after a restart; per-chat pacing and Telegram flood-control retry delays are applied. A Telegram send whose outcome is unknown may be retried, so a crash or timeout can rarely result in a duplicate message. Notifications do not depend on authorization sessions.

AUTH_WEBAPP_URL must be the public HTTPS origin without /auth or a trailing slash. The server exposes:

- GET /auth?state=... — Mini App login form
- GET /auth.js and GET /auth.css — self-hosted assets
- POST /api/challenge — creates a user-bound challenge for Main Mini App/menu launches
- POST /api/auth — signed Telegram authentication exchange
- GET /health — process liveness (200 during MongoDB outages)
- GET /ready — database readiness (200 after initialization and a successful bounded ping, otherwise 503)

## Local prototype with Ngrok
Install ngrok, then type `ngrok http <PORT>` to start tunneling.

In BotFather:

1. Run /setinline, select the bot, and set a placeholder such as “Показати розклад”.
2. Run /setinlinefeedback, select the bot, and enable feedback for 100% of results. Inline logout runs only after selecting the logout result; typing the query does not log out.
3. Configure the Main Mini App or menu button with https://your-public-host/auth. Direct launches obtain their one-time challenge after Telegram initData is validated.
4. Keep the bot in long-polling mode; the HTTP server is for Mini App authentication and does not receive Telegram bot webhooks.

The local http://127.0.0.1:3000 value is useful only for browser layout checks. Telegram clients require a public HTTPS AUTH_WEBAPP_URL.

## Mini App assets

The authentication page lives in `src/webapp/auth.html`, with its styles and browser code in `src/webapp/auth.css` and `src/webapp/auth.js`. The server reads these files for every request during development, so saving a change and refreshing the browser is enough to see it.

`npm run build` compiles TypeScript and copies the three files to `dist/src/webapp`. Keep links in the HTML pointed at `/auth.css` and `/auth.js`; those are the routes exposed by the authentication server.

## Run

~~~bash
npm run dev
~~~

For a production build:

~~~bash
npm run build
npm start
~~~

## Security behavior

- Telegram initData is validated server-side with HMAC-SHA256 and a five-minute default maximum age.
- Every form link contains a random, user-bound, five-minute challenge. A successful challenge cannot be replayed.
- If a Telegram client omits initData for an inline Mini App, only the bot-issued 256-bit challenge can authorize that launch. Main Mini App/menu launches still require valid initData.
- Inline Mini App authorization is exposed only for the exact query `@bot_username login`. Schedule menus are exposed only for the exact queries `@bot_username show all` and `@bot_username show me`; bare `show` returns guidance without making authentication, subject, or schedule requests. “Повернутись до групи” closes the overlay back to its originating chat; “Чат боту” opens inline mode with that guidance.
- The API accepts JSON from the configured public origin only and limits request bodies to 16 KiB.
- Login pages use no-store caching, a restrictive Content Security Policy, no-referrer, and nosniff headers.
- Email and password remain local to one HTTP request and are never put in a bot session or log.
- The WebDk access token, Telegram user ID, and session timestamps are retained in MongoDB Atlas with TLS and disk encryption. Remember-me sessions also retain encrypted credentials until expiry or logout.
- Ordinary authorization lasts at most seven days by default and can end sooner if WebDk expires or rejects its token. Remember-me sessions last up to 14 days by default and can recover from an expired WebDk token.
- /logout deletes the token from MongoDB before confirming success.

## Checks

~~~bash
npm test
npm run typecheck
npm run build
~~~

### MongoDB integration tests

`npm test` runs unit and HTTP tests; the MongoDB integration test is skipped unless `MONGODB_TEST_URI` is explicitly supplied. To run against a disposable local MongoDB:

```sh
docker run --detach --rm --name schedule-bot-mongo-test -p 127.0.0.1:27028:27017 mongo:8 --setParameter ttlMonitorSleepSecs=1
MONGODB_TEST_URI=mongodb://127.0.0.1:27028 npm test
docker stop schedule-bot-mongo-test
```

Tests create and drop only a randomly named `schedule_bot_test_*` database. Use a test instance with permission to create/drop these databases, never a production URI. The test validates restart persistence, BSON dates, the index, token replacement/deletion, and eventual TTL cleanup. The shorter TTL monitor interval is only a test speedup; production uses MongoDB defaults.

### Northflank migration (free tier only)

The portable image is implemented; production is still on Railway. See the
[migration plan](docs/plans/railway-to-northflank.md) and
[implementation record](docs/plans/northflank-implementation.md) for the remaining
source, storage, database, and budget gates. Do not start this image with the
production token/database while Railway is polling: startup also runs the
announcement worker.

Build the Linux image and run an isolated check without credentials or external
network access:

```sh
rtk proxy docker build --platform linux/amd64 -t schedule-bot:northflank .
rtk proxy docker run --rm -i --platform linux/amd64 --network none --memory 256m --memory-swap 256m --cpus 0.1 schedule-bot:northflank node --input-type=module < scripts/container-smoke.mjs
```

The Dockerfile pins Node 22/Debian by digest, installs dependencies from the lockfile
inside Linux, and copies only compiled application files and production dependencies
into a non-root runtime. It includes Sharp, Cyrillic/Latin fonts, Mini App assets,
and inline thumbnails. `.dockerignore` allowlists the build inputs; environment
files, backups, workstation dependencies, and Git metadata are excluded. Refresh
the base image deliberately and rerun checks when applying security updates.

In the existing Northflank `schedule-bot` Sandbox project, use root build context,
`/Dockerfile`, the default image command, one instance, and HTTP port 3000. The free
service form currently selects `nf-compute-10` (0.1 shared vCPU, 256 MB). Keep automatic
deployment off and use stop/update/start so two pollers never overlap. Use `/health`
for startup/liveness/platform readiness and `/ready` for database acceptance. Set a
90-second termination grace period to allow bounded database work to finish.

Runtime settings must be entered as runtime secrets/configuration, never build
arguments: preserve `BOT_TOKEN`, `AUTH_CREDENTIALS_ENCRYPTION_KEY`, the chosen
`MONGODB_URI`, and `MONGODB_DATABASE=schedules`. Set `PORT=3000`, `AUTH_PORT=3000`,
`AUTH_HOST=0.0.0.0`, and `AUTH_WEBAPP_URL` to the actual generated HTTPS origin.
Preserve Railway's session overrides (`604800` and `43200` seconds) during the move.
Review `BASE_URL`, `WEBDK_API_VERSION`, and intended `ADMIN_EMAILS` separately.

Dedicated Northflank egress is $25/month and is excluded from this migration.
Do not create a paid gateway, upgrade compute, or broaden Atlas network access to
make the deployment work. Confirm the complete $0 database/media architecture
before provisioning. The free MongoDB-addon/static-media alternative requires a
verified bucket inventory and database migration; it has not been deployed.

The smoke check exercises the compiled HTTP assets, database-outage health behavior,
native JPEG rendering, and image URLs with synthetic local data. It does not contact
Telegram, WebDk, or MongoDB, and it is not a production load test.

For the requested no-Git workflow, the official Northflank CLI is installed locally
under ignored `data/tools/northflank`. Use the authenticated project context:

```sh
rtk proxy env NF_CONFIG_DIR="$PWD/data/tools/northflank-auth" data/tools/northflank/node_modules/.bin/northflank list projects --output json
```

The CLI can deploy a registry image; an image-registry destination is still needed.
Its file-upload command targets existing containers and is not a durable local-source
deployment. Keep CLI authentication and the completed Railway object backup under
`data/` private. Do not add either directory to Git or the Docker build context.

### Railway deployment

Use `npm run build` as the build command, `npm start` as the start command, and `/health` as the healthcheck path. Set `AUTH_HOST=0.0.0.0` in Railway (replace `127.0.0.1` if copied from the local example). The app prioritizes Railway's injected `PORT` over `AUTH_PORT`; without `PORT`, local defaults remain `127.0.0.1:3000`. Set `AUTH_WEBAPP_URL` to the service's public HTTPS domain and configure the domain target port to match the listening port.

Startup logs report the listening host/port, with database readiness and bot startup reported independently. An empty `auth_sessions` collection is normal until a successful login. If `/health` remains unreachable, inspect application runtime logs for database initialization or bot startup failures; healthcheck retry logs alone do not identify the startup error.


### MongoDB recovery diagnostics

Logs include a safe category, allowlisted driver/network codes, stage (`connect`, `index`, `ping`, or `operation`), and initialization attempt/duration/retry delay. Raw error messages, stacks, connection URIs, and tokens are never emitted. `dns` indicates resolution trouble; `tls` indicates certificate/handshake trouble; `authentication` (18) indicates database credentials/auth source; `permissions` (13) indicates database privileges; `index_conflict` (85/86) indicates an existing incompatible index. `server_selection` alone is not enough to identify the cause: inspect nested codes and test connectivity from the deployment environment. Correct the indicated infrastructure/configuration issue; do not disable TLS verification or drop indexes speculatively.

Keep Railway's healthcheck path at `/health` so a database outage does not trigger a restart loop. Use `/ready` to check whether database operations can run. Permanent configuration problems remain degraded and keep retrying until corrected. Shutdown cancels retry sleeps and waits for bounded in-flight database work before closing the shared client. Run one Telegram polling process.

### Incident: 2026-09-13

Atlas activity showed `0.0.0.0/0` added at 2026-09-12 22:54:58 and removed by System at 2026-09-13 04:54:59 (Europe/Kyiv), consistent with a six-hour temporary rule. Only the developer workstation IP remained allowed. Railway reported `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR` during connection. The recovery deployment restored process liveness and Telegram startup, while `/ready` correctly remained 503 pending Atlas network access correction.

For a restricted durable allowlist, use Railway static outbound IPs (Pro plan), add all assigned addresses to Atlas, and redeploy as required by Railway. A broad `0.0.0.0/0` rule allows connection attempts from any IPv4 host and needs an explicit security decision; do not silently recreate it or use a temporary rule as a permanent production fix. See https://docs.railway.com/networking/static-outbound-ips.

### Remember-me duration rollout

Keep the deployment environment's `AUTH_SESSION_MAX_AGE_SECONDS` override at `604800` for ordinary logins and restart the service. New remember-me logins receive the fixed 14-day window; existing records retain their saved expiry.

Only WebDk error code `20700`, or HTTP 401 with the exact message `Authorization has been denied for this request.`, clears authorization. Other failures preserve the token for a later retry. Schedule failure logs include HTTP status, numeric upstream code, classification, and remaining local lifetime in seconds, without response bodies or credentials. A confirmed upstream rejection still requires a fresh login.

Authentication is idempotent while a stored session remains active. Repeat or concurrent Mini App submissions for the same Telegram user reuse that session and do not request another WebDk token. After the session expires or WebDk explicitly rejects it, the next submission performs a fresh login.
