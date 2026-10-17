# Railway to Northflank migration

**Status: important**  
**Plan: implementation in progress — portable image verified; production cutover pending**  
**Budget: $0 — free-tier services only, throughout preparation and operation**  
**Inspected: 2026-10-07 (Europe/Kyiv)**

Move the running Railway project to the existing Northflank account while preserving the bot identity, stored sessions, remember-me credentials, announcements, and public media. Use a short, controlled interruption for the Telegram polling handover. Keep MongoDB Atlas if its existing tier and connectivity satisfy the $0 constraint. The user's free-tier requirement applies to the entire migration; paid containers, gateways, storage, builds, backups, traffic overages, and plan upgrades are excluded.

This draft combines read-only inspection of Railway and Northflank through the Dmytro Chrome profile (Railway identified the account as Dmytro Shyian), the local repository, and official Northflank documentation. Browser interaction was limited to Railway and Northflank. Secret values remained masked; no infrastructure or application settings were changed.

Implementation progress and current blockers are recorded in [northflank-implementation.md](northflank-implementation.md). Local Docker packaging and verification are complete. Runtime secrets read by the Railway CLI for storage backup remained in process memory and were not printed or persisted. No production resources have been changed.

## Verified starting point

| Component | Observed state | Migration implication |
| --- | --- | --- |
| Railway workspace | Dmytro Shyian's Projects, Limited Trial; dashboard showed **3 days or $3.12 left** | Finish preparation promptly; the earlier of elapsed trial time or exhausted credit can end availability. This is a relative indicator, not a guaranteed shutdown date. |
| Railway project | `schedule-lntu`, `production`, two services online | Moving only the bot would leave a Railway dependency. |
| Bot service | `schedule-bot`, one replica, EU West / Amsterdam; Railpack; build `npm run build`; start `npm start`; healthcheck `/health`; serverless disabled | Preserve one continuously running process and the existing build behavior. |
| Bot source | Railway shows no Git repository or image connected; a CLI root-directory setting is present | Identify and preserve the deployed source before creating a new build. Local/deployed parity is not yet established. |
| Public bot origin | `https://schedule-bot-production-0fe9.up.railway.app`; no custom domain shown | A new origin requires application configuration and Telegram Mini App entry-point changes. |
| Bot limits | Railway maximum 2 vCPU / 1 GB per replica | These are limits, not measured consumption. Northflank sizing still needs a peak-memory check. |
| Auxiliary service | `s3-public-presigner`, one replica, US West / California; source `timomeh/s3-public-presigner`, branch `main`; healthcheck `/_ah/up`; serverless disabled | Pin its deployed revision and migrate its storage configuration and public URLs. Its port/start command need verification from its build or runtime configuration. |
| Railway bucket | `public files`, **94.2 MB**, connected to the presigner | Inventory and copy the objects before retirement. Object count, keys, metadata, and consumers were not inspected. |
| Northflank account | `wilsonplur's team`, active **Developer Sandbox**; no Git provider linked | Reuse the account; establishing a source integration is still required. |
| Northflank project | Existing `schedule-bot`, **Europe - West / London**, default environment; Services showed **0 / 2** | Reuse this empty project unless a region check justifies another location. Team inventory also showed no addons or volumes. |
| Local Git | `main` has no commits; application files are untracked | Create a reviewed release commit or a reproducible image before deploying. Do not assume a pushed repository already contains the application. |

Inspection links: [Railway project](https://railway.com/project/3fe876d1-7ffc-492f-9406-b06d3c2a55bd?environmentId=a210078b-c314-4142-8510-c29307f80a56), [bot settings](https://railway.com/project/3fe876d1-7ffc-492f-9406-b06d3c2a55bd/service/3a9ccdc5-8fbc-4dac-8f7f-bae06d7586e4/settings?environmentId=a210078b-c314-4142-8510-c29307f80a56), [presigner settings](https://railway.com/project/3fe876d1-7ffc-492f-9406-b06d3c2a55bd/service/3f818b88-b80f-4235-854b-a7173a6f78d1/settings?environmentId=a210078b-c314-4142-8510-c29307f80a56), [Northflank project](https://app.northflank.com/t/wilsonplurs-team/project/schedule-bot), [Northflank plan](https://app.northflank.com/t/wilsonplurs-team/billing/plans).

## Free-tier target and constraints

Keep the existing Northflank project on **Developer Sandbox** for both rehearsal and live operation. Its allowance is **two services, two jobs, and one addon**, as documented in [Northflank's plan limits](https://northflank.com/docs/v1/application/billing/pricing-on-northflank) and observed in the account. Resource counts fit the proposed layout; exact free compute limits, included storage, build/traffic allowances, addon eligibility, and outbound-networking availability are still unverified. Counts alone do not prove a completely free deployment.

The first candidate is one free bot service, one free presigner service, and a free MinIO addon, with the existing Atlas database retained. Choose MinIO only if its compute and persistent storage are included at $0 in this account, and Atlas only after confirming its free tier and a workable free network route. Northflank documents [MinIO addon deployment](https://northflank.com/docs/v1/application/databases-and-persistence/deploy-databases-on-northflank/deploy-minio-on-northflank); it does not establish that every configuration is free. Demonstrate presigner compatibility before cutover.

The bot itself needs no persistent volume: durable data lives in MongoDB; challenges, conversations, caches, and generated schedule-image bundles live in memory. The bucket serves a separate purpose and must survive container replacements.

| Decision | Free-tier choice | Required verification |
| --- | --- | --- |
| Hosting plan | Developer Sandbox for rehearsal and live operation | Select only configurations explicitly included free; keep one bot instance and disable paid scaling/upgrades. |
| Service 1 | Schedule bot on the account's free compute allocation | Measure image-rendering peaks against the actual free memory/CPU limit; no paid sizing substitution. |
| Service 2 | Presigner on free compute | Rehearse in the same service slots before production handover; do not allocate an extra billable staging service. |
| One addon | MinIO, only if included free with durable storage | Confirm addon eligibility, included disk capacity, memory fit, and a free backup/recovery method. |
| Database | Existing Atlas free tier and `schedules` database | Verify the actual Atlas tier and free connectivity. Atlas tier and network access were not inspected. |
| Outbound networking | A route included at $0 | Dedicated egress is usable only if explicitly included free. An observed dynamic IP is insufficient for a durable restricted Atlas allowlist. |
| Region | Existing London project | Confirm eligibility for free resources and acceptable WebDk/database connectivity. |
| Public origin | Generated Northflank HTTPS origin | Use included HTTPS/TLS; no domain purchase or paid CDN. A Railway-owned `up.railway.app` hostname cannot be repointed by the user. |
| Source delivery | Existing free Git hosting/build or registry allowances | Preserve a reviewed release; verify build time, image storage, and artifact size fit the included allowance. |

Northflank's [billing documentation](https://northflank.com/docs/v1/application/billing/pricing-on-northflank) says a payment method is required to create resources even on Sandbox. Whether this account has completed that requirement was not checked. Account verification does not authorize billable resources or a plan upgrade.

**Budget gate:** record the free resource selections and allowances for compute, storage, builds, backups, image retention, and traffic before provisioning. Confirm how quota exhaustion behaves and that the chosen configuration cannot introduce an automatic charge. A billing alert alone is not a spending cap. Reject a configuration with any required charge and redesign within the free allocation. If no free configuration meets the requirements, report the specific limitation; do not switch to paid resources.

### Free alternative if Atlas or MinIO cannot fit

If there is no suitable free Atlas route, or MinIO is unavailable free, investigate this alternative within the same two-service/one-addon allowance:

| Allocation | Alternative |
| --- | --- |
| Free service 1 | Bot |
| Free service 2 | Static HTTPS media server, with the existing public files packaged into its versioned image |
| Free addon | MongoDB, accessible to the bot through Northflank's internal networking |

This is conditional on the bucket inventory proving that files are static, public media and that the resulting image fits free build/registry quotas. Current bot source contains no S3 client, which makes this a candidate, not evidence that the running system needs no writes or presigning. Preserve object paths, MIME types, video range support, and required URL behavior; private or dynamically written objects require another verified free storage design. Baked-in files survive container replacement without a separate paid volume, but updates require an image rebuild. Keep a separate local backup.

The alternative adds a database migration. Before selecting it, confirm MongoDB addon eligibility, free persistent capacity and recovery support; inventory/export all collections and indexes; preserve BSON dates, TTL behavior, `schedules`, and the original encryption key. Rehearse an import in isolation, then stop the old bot/notification worker for the final export and verified import before starting the new bot. Record counts and critical records, verify sessions and delivery-ledger continuity, and define a rollback that preserves new writes instead of restoring a stale snapshot. Keep MinIO and MongoDB alternatives mutually exclusive because the free allowance has only one addon.

The primary candidate remains Atlas plus MinIO until these gates are resolved. No database or object-storage architecture has been changed by this draft.

## Runtime configuration

Use a runtime secret group scoped to the bot. Copy credentials through a secure operator workflow during implementation; keep their values out of Git, the Docker build, this plan, and logs.

| Setting | Target behavior |
| --- | --- |
| `BOT_TOKEN` | Preserve the production token at final handover. Use a separate test bot during rehearsal. |
| `MONGODB_URI` | Preserve Atlas configuration if the primary free design is verified; otherwise use the verified free MongoDB addon route after the planned data import. Staging must use an isolated test database/user. |
| `MONGODB_DATABASE` | **`schedules`**, as observed in Railway. Using the code default `schedule_bot` would make existing sessions and announcements appear missing. |
| `AUTH_CREDENTIALS_ENCRYPTION_KEY` | Preserve the exact existing key, so saved remember-me credentials remain decryptable. Do not generate a replacement as part of the move. |
| `AUTH_HOST` | `0.0.0.0`. |
| `PORT`, `AUTH_PORT` | Explicitly set both to `3000`, matching the current service. `PORT` takes precedence in `src/config.ts`; do not rely on platform injection. |
| `AUTH_WEBAPP_URL` | New public HTTPS origin, with no `/auth` suffix. Obtain it from the service's actual Networking settings. |
| `AUTH_SESSION_MAX_AGE_SECONDS` | Preserve **`604800`**. |
| `WEBAPP_INIT_DATA_MAX_AGE_SECONDS` | Preserve observed **`43200`** for migration parity. README/default is `300`; review this existing discrepancy separately. |
| `WEBDK_API_VERSION`, `BASE_URL` | Copy the current overrides after reviewing their non-secret values; they were present but not revealed during inspection. |
| `ADMIN_EMAILS` | Not listed among the 18 Railway service variables. Confirm intended production cabinet access before setting it; `.env.example` alone is not evidence of live configuration. |
| `AUTH_SESSION_ENCRYPTION_KEY` | Legacy variable exists in Railway but is unused by the current code. Omit only after verifying the selected production source uses MongoDB sessions. |
| Bot `AWS_*` variables | Present in Railway; current bot source contains no S3 client or matching reads. Confirm deployed-source parity, then omit unused credentials. |

For the primary design, presigner variables to map separately are `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `PRESIGNED_URL_EXPIRATION_SECONDS`, and `USE_NICE_NOT_FOUND`. Values were not exposed. Use storage credentials scoped to the required bucket operations, and a public TLS endpoint that Telegram can reach when a redirect contains a signed object URL. The static-media alternative does not inherit unused S3 credentials.

## Implementation sequence and checkpoints

### 1. Preserve the release and close the unknowns

- Record the active Railway deployment identifiers, bot source artifact, presigner commit, runtime versions, target ports, and safe configuration. Preserve a way to restart the existing Railway deployment.
- Compare the local bot with the deployed application. Review all currently untracked files before making the first release commit; exclude `.env`, credentials, generated output, and local data.
- Measure representative Railway memory/CPU usage during schedule image rendering and media requests. The attempted metrics page did not provide usable measurements for this draft.
- Inventory bucket keys, object count, bytes, content types, cache metadata, and URL consumers. Check announcement records, queued delivery snapshots, documentation links, and Telegram entry points for Railway URLs.
- Confirm Atlas region, current durable network allowlist, and an available backup/recovery path. Atlas itself was not opened because browser scope was limited to the two hosting platforms.
- Verify the actual free compute allocations, addon/storage eligibility, build/traffic quotas, Atlas tier, free networking route, and account-verification prerequisite. Select one of the free architectures only after those checks.

**Checkpoint:** reproducible source, storage inventory, rollback artifact, and a verified $0 target configuration are recorded. Prioritize archival and preparation before Railway's existing trial runs out. Purchasing Railway continuity is excluded; if the remaining trial is insufficient, record the possible availability gap and preserve a Northflank recovery path.

### 2. Make the bot build portable

- Add a multi-stage `Dockerfile` using a supported, pinned Node version that satisfies `node >=20`; a Node 22 Debian-based image is a reasonable initial candidate. Install with the existing `package-lock.json` using `npm ci`, retain build-time dev dependencies for TypeScript, then run `npm run build`.
- Keep production dependencies and `dist` in the runtime image, including `sharp`, font assets, copied Mini App files, and `dist/src/assets`. Verify native dependencies on the target Linux architecture; do not copy the workstation's `node_modules`.
- Run as a non-root user and start Node directly with `node dist/src/index.js`, so the application's existing SIGTERM shutdown handler receives termination signals. Expose port 3000.
- Add `.dockerignore` for `.env` and variants, `.git`, `node_modules`, logs, local data, and generated output. Keep `.env.example` only if needed; never copy production secrets into an image layer.
- Set Northflank build context to the repository root and select the Dockerfile build. Northflank supports explicit Dockerfile/context selection. [Dockerfile build documentation](https://northflank.com/docs/v1/application/build/build-with-a-dockerfile).
- Run `rtk npm test`, `rtk npm run typecheck`, and `rtk npm run build`. Start the resulting container with test credentials and confirm assets, image rendering, and SIGTERM shutdown.
- Apply the actual free CPU/memory limits to container checks. If rendering exceeds them, plan bounded render concurrency and cache/image-buffer retention, then verify output and responsiveness again. Preserve the free compute allocation.

**Checkpoint:** the same release image builds and serves the app outside Railway; no runtime feature rewrite is needed.

### 3. Configure Northflank and Atlas connectivity

- Reuse `schedule-bot` on Developer Sandbox; establish the reviewed source within free Git/build/registry allowances and prepare bot runtime secrets.
- Expose HTTP port 3000 publicly. Northflank provides an HTTPS endpoint for public HTTP ports; set `AUTH_WEBAPP_URL` from that endpoint rather than constructing a hostname. [Port configuration](https://northflank.com/docs/v1/application/network/configure-ports).
- Configure one bot instance, continuously running, with autoscaling/previews disabled for the production token. Keep automatic deployment off during migration and until releases enforce a stop-before-start handover.
- Use `/health` on port 3000 for liveness and, if configured, startup. Keep `/ready` as a deployment acceptance check and database-availability monitor. Initially use `/health` for platform readiness too, preserving the current ability to serve an explicit database-outage response. Using `/ready` for platform readiness would remove all HTTP traffic during an Atlas outage; make that a separate behavior decision. Northflank distinguishes restart-triggering probes from traffic-routing readiness probes. [Health checks](https://northflank.com/docs/v1/application/observe/configure-health-checks).
- Verify a free database route before starting production. For Atlas, use a durable restricted route included at $0; dedicated egress is acceptable only when the account explicitly includes it free. Default outbound addresses are shared and unpredictable. If restricted Atlas access requires a billable gateway, evaluate the free internal MongoDB alternative. [Egress IP configuration](https://northflank.com/docs/v1/application/network/configure-egress-ips).
- Do not silently replace Atlas restrictions with `0.0.0.0/0`, disable TLS, or treat one observed dynamic IP as a permanent allowlist. A broader Atlas rule would be a separate security decision requiring explicit authorization; it is not the default free-tier design. Northflank's [Atlas integration guide](https://northflank.com/docs/v1/application/databases-and-persistence/integrate-with-a-database-provider/integrate-mongodb-atlas-with-northflank) recommends restricted access for production.
- Check DNS/SRV resolution where applicable, TLS, MongoDB ping/index initialization, and `/ready` from the target runtime. Preserve the old working route during the available rollback window.

**Checkpoint:** target HTTPS is valid, the selected database route costs $0 and passes readiness, and the production token has not started polling on Northflank. Resolve a missing free database route before cutover; do not provision a paid gateway.

### 4. Migrate bucket and presigner

- Provision only the verified free storage design. For MinIO, require included persistent storage, resource fit, and TLS reachability; use a local export or another verified free backup method. If the alternative is selected, package the inventoried static public objects in the media-service image and validate that design before importing the database.
- Copy objects without deleting the source. Preserve keys, bytes, content types, and relevant response/cache metadata. Validate counts and total size against the inventory and verify checksums where available; S3 ETags are not universally content hashes.
- For the primary design, deploy the presigner from the pinned revision on the second free service. Map its seven runtime variables, confirm its port/start command, and use `/_ah/up` for its health check. For the static-media alternative, replace this step with compatibility checks for the new server's object paths, direct URLs, MIME types, range requests, and health endpoint.
- Test an image and the largest representative video through the selected public media service. For the presigner, follow its redirect and check signed-URL reachability and expiry; for the static server, check the direct URL. Verify TLS, MIME types, and range requests where used in both designs.
- Verify a real Telegram media fetch during rehearsal. For the primary design, an internal-only storage address embedded in a redirect will fail for Telegram even if the presigner can reach it.
- Map old presigner/bucket URLs to new URLs for future content and editable drafts. Audit pending delivery snapshots separately: published content is frozen by the existing notification system, so do not mass-edit it without a defined migration procedure.
- Keep old storage and the old presigner available only within Railway's remaining existing trial. Previously issued signed URLs, hardcoded links, and pending messages may still depend on them. Railway-owned URLs cannot be made permanent on Northflank; historical external links can break after trial expiry or retirement. Record that boundary without purchasing an extension. Already-uploaded Telegram media using `file_id` has different dependencies and should be tested separately.

**Checkpoint:** the new media path works end to end, the inventory reconciles, and remaining old-URL dependencies have a documented disposition.

### 5. Rehearse with isolated credentials

Use a dedicated test bot and an isolated database before introducing the production token. Rehearse in the same free bot service slot while Railway runs production, then stop it before configuring production; do not create an extra paid staging service. The current startup code always launches polling and the notification worker; there is no supported HTTP-only production mode. Starting it against the production database can process announcements even if the Telegram token is different. If no test bot is available, build and hold the production image stopped until handover.

- Verify `/health`, `/ready`, `/auth`, `/auth.js`, `/auth.css`, inline thumbnails, and generated schedule images through the Northflank public origin.
- Exercise Mini App login, remember-me, logout, ordinary/general and personal schedules, inline `show all` / `show me`, calendar navigation, image pagination, and admin cabinet access with the test bot.
- Rehearse a restart: durable records survive; transient conversations/challenges/image bundles expire normally and users can start again.
- Validate announcement delivery only to isolated test recipients. Confirm exactly one notification worker runs.
- Verify a database outage leaves liveness healthy, returns temporary service errors, and recovers without a restart loop.
- Test image-rendering peaks against the actual free memory allocation and perform a bounded media-fetch check within included traffic/build quotas.

**Checkpoint:** acceptance checks pass within the free compute and storage allocations, with $0 selected resource cost. Remove test credentials from the production service configuration before handover. A failed capacity check calls for optimization or a free architecture adjustment, never a paid container substitution.

### 6. Perform the production handover

Budget a short maintenance window; an initial target is 5–15 minutes after preparation, not a guarantee. Keep the old deployment and settings available for rollback.

1. Freeze source/configuration and announcement publication. Record the previous Mini App entry URLs and outstanding delivery state.
2. Ensure the Northflank bot is stopped before setting its production token and original credential-encryption key. Ensure the new public origin is already configured; keep the selected database URI ready for the following step.
3. Stop Railway's bot using a reversible stop operation. Confirm the old process and notification worker have terminated; disable any mechanism that could start them again during handover. If local copies run, stop those too. If the internal MongoDB alternative was selected, perform the rehearsed final export/import and verify records/indexes while both bot processes are stopped. Keep `schedules` and the encryption key intact. Configure the selected database URI only after the applicable readiness/import check passes.
4. Start exactly one Northflank production instance from the reviewed image. Verify `/health`, `/ready`, the bot-started log, and the absence of Telegram polling conflicts.
5. Update Telegram's Main Mini App and menu-button entry points to `<new-origin>/auth` through the existing BotFather/API configuration. Review other configured app/domain links where applicable. This does not require converting the bot to webhooks. Telegram tabs were not inspected in this planning session.
6. Perform a limited production smoke check: `/start`, existing authorized session, fresh login, remembered-session recovery when applicable, private and inline schedules, generated images, and media retrieval. Check the admin cabinet if it is intended to be enabled.
7. Verify the existing announcement worker resumes against the same ledger. Avoid publishing a test announcement to production recipients. In-flight sends with an unknown outcome can rarely duplicate after a restart, as already documented by the application.
8. Monitor for 24 hours where Railway trial capacity permits: readiness, memory, restarts, MongoDB recovery, Telegram conflicts, and media failures. Confirm there is still only one production polling/notification process.
9. Verify account usage remains in the included free allocations. Keep paid upgrades and billable resource changes excluded after cutover too.

Existing sessions should remain usable when their upstream tokens are valid and the database/key are preserved; the hosting change itself should not require mass login. WebDk may independently expire tokens. In-memory challenges, calendar conversations, and generated-image pagination bundles will reset, so users may need to reopen those flows.

### 7. Complete retirement

After acceptance and the agreed rollback/link-compatibility window, retain the verified source release and storage backup, remove obsolete Railway URL references from configuration/docs, retire the old services/bucket deliberately, and remove the old outbound allowlist entries when they are no longer needed. Keep decommissioning separate from the cutover; deleting the old project during handover removes the fallback.

Update README with the Northflank free resource selections and allowances, source build, secrets, ports, probes, database route, release, quota-exhaustion behavior, and recovery procedure. Record measured capacity and verified $0 coverage for the complete design. Keep paid upgrades outside this migration's scope.

## Rollback

Trigger rollback if the production bot cannot poll, database readiness does not recover within the maintenance window, login/media flows fail, or memory/restart behavior is unstable.

1. Stop Northflank's bot and confirm its polling and notification worker have terminated.
2. Restore Telegram Mini App/menu entry points to the recorded Railway `/auth` URL.
3. For the Atlas design, restart the preserved Railway bot with its original image, origin, database, and credential-encryption key. For the internal MongoDB alternative, use the rehearsed data rollback procedure to preserve new writes before returning to the old database. Ensure only one production process runs.
4. Verify liveness, database readiness, existing sessions, and schedule retrieval. For the Atlas design, keep both working outbound routes until the issue is resolved.
5. Keep the copied storage intact. Revert newly introduced media links where feasible; do not restore an old MongoDB snapshot over newer production sessions or delivery-ledger writes.

Rollback depends on Railway still having available capacity under the existing trial. If trial availability is lost, use the preserved previous image on the same free Northflank service after stopping the failed instance; Railway's old hostname and links will not be restored by that fallback. Do not purchase capacity or create a paid rollback service.

## Completion criteria

- [ ] Developer Sandbox remains active; every selected compute, storage, build, backup, registry, and networking resource is verified included at $0, with no automatic billable fallback.
- [ ] The reviewed bot and selected media service run within the two free service slots; any addon fits the one free addon allocation with durable data and a free recovery method.
- [ ] Exactly one production Telegram poller and notification worker operate, including during future deployments. Northflank's default restart overlaps old and replacement containers; use a verified stop/update/start release procedure until an application-level leadership mechanism exists. [Service controls](https://northflank.com/docs/v1/application/getting-started/build-and-deploy-your-code).
- [ ] Data remains in `schedules`; the original remember-me key is preserved; database readiness passes through the verified free route. Any selected database migration has verified record/index parity and a rollback preserving new writes.
- [ ] Mini App entry points, static assets, schedule-image URLs, media delivery, and intended admin access work.
- [ ] Bucket contents reconcile, backups exist, and old links/pending deliveries have a migration or expiry policy.
- [ ] Capacity is measured, rollback is usable, and Railway retirement is completed only after validation.

The Dockerfile, build-context exclusions, and isolated Linux smoke check are implemented. Remaining work starts with a repository/image delivery destination, deployed-source verification, a complete storage backup, and selection of the free database/media architecture. Dedicated egress is confirmed billable and excluded. See the implementation record for observed allocations and test results. A gate that cannot be met requires a free redesign or a precise feasibility report; paid services are not an implementation option.
