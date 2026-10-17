# Northflank implementation record

**Status: important — local packaging complete, production migration pending**  
**Updated: 2026-10-07**  
**Budget: $0; no paid resource or upgrade authorized**

## Implemented and verified

- Multi-stage Docker build pins the official Node 22 Debian image by digest and uses `npm ci` for Linux dependencies. The final image contains production dependencies and `dist/src`, runs as `node`, exposes port 3000, and invokes Node directly for signal handling.
- An allowlisted `.dockerignore` keeps secrets, backups, Git state, macOS dependencies, and generated files out of the build context. Runtime source/test/dev-dependency exclusions were checked inside the image.
- `scripts/container-smoke.mjs` checks compiled HTTP assets, health/readiness behavior, JPEG generation with bundled fonts/native Sharp, and generated-image retrieval. It uses in-memory fixtures and no external network.
- `scripts/export-railway-storage.py` implements read-only inventory and optional backup, object SHA-256 checksums, metadata preservation, hashed local filenames, and a second inventory check for concurrent changes. Credentials stay in child-process environments. **Backup is complete:** 6 objects, 94,170,139 bytes, with every local SHA-256 independently rechecked. After the user's approval, Railway's Credentials page confirmed `https://t3.storageapi.dev`; virtual-host addressing fixed the earlier `NoSuchKey` listing failure. No credentials were changed.
- README now documents the container build, free allocation, runtime configuration, and stop-before-start release procedure.

## Validation results

| Check | Result |
| --- | --- |
| `rtk npm run typecheck` | Passed |
| `rtk npm run build` | Passed |
| `rtk npm test` | 101 passed, 2 MongoDB integration tests skipped; no failures. HTTP tests required loopback permission outside the sandbox. |
| Linux production image | Built for `linux/amd64`; Node `v22.23.3`; image size reported by Docker: 111,592,202 bytes |
| Constrained smoke | Passed with 256 MiB memory, no swap, 0.1 CPU and external networking disabled. Three concurrent three-day schedules generated nine JPEG pages; all HTTP assets and image retrieval passed. |
| Capacity observations | 82 seconds for the smoke workload under local amd64 emulation and CPU throttling. Cgroup peak: 186 MiB; process `ru_maxrss`: 248 MiB. These distinct metrics are recorded as returned, not treated as production capacity guarantees. |
| SIGTERM lifecycle | Actual app entry point reached HTTP startup with a stub Telegram transport, fake credentials, and unavailable local MongoDB. Docker SIGTERM exited with code 0; `OOMKilled=false`. The disposable container was removed. |

The final local image is `schedule-bot:northflank`, image ID
`sha256:a48052f8f600bebf51e06d891780180caf37a2cc7805e0a5f7f1e059ba597905`.
It has not been pushed to a registry. The only final-image change after the capacity
test removed redundant `AUTH_HOST=0.0.0.0`; `PORT=3000` already supplies the same
default binding, verified by the subsequent lifecycle startup log.

The smoke workload excludes production Telegram traffic, MongoDB client memory,
real upstream latency, and sustained cache growth. Native Northflank rehearsal and
memory/latency monitoring remain necessary before acceptance. No production bot
token or database was used by these container checks.

## Live infrastructure findings

Read-only Northflank inspection used the Dmytro Chrome profile and existing
`wilsonplurs-team` / `schedule-bot` project in London:

| Item | Observed result |
| --- | --- |
| Billing plan | Active Developer Sandbox, Free; 2 services, 2 jobs, 1 addon. Billing UI says upgrading enables paid projects/higher limits. |
| Service form | `nf-compute-10`, 0.1 shared vCPU, 256 MB; one instance; 1 GB ephemeral disk. Autoscaling unavailable on free projects. |
| Build form | Default build resources 4 vCPU / 16 GB; 16 GB build ephemeral disk. These builder defaults are not a verified free build-time/retention allowance. |
| MinIO form | Available; 0.2 shared vCPU / 512 MB, 6 GB NVMe, one replica. Larger disk options disabled. No addon was created. |
| Dedicated egress | Explicit $25/month charge; excluded. |
| Shared egress | Option disabled in this account. |
| Source | No version-control provider linked. Local Git has no commits or remote. User requested the CLI instead of Git; CLI installed and authenticated. An image-registry destination is still needed for the verified image-deployment route. |
| Remaining cost checks | Included traffic/build/image-retention limits and quota exhaustion behavior still need confirmation for the selected full architecture. No paid fallback is acceptable. |

Railway account access was restored and verified as **Dmytro Shyian** after an
intermediate session showed a different empty workspace. `schedule-lntu` is
accessible; both services are online; the bucket reports 94.2 MB; the current trial
indicator is 3 days or $3.11. Railway's file browser failed with a JavaScript error,
so its “Empty directory” text is **not** evidence that the bucket is empty.

Current successful bot deployment:

- ID: `85660e7a-57d3-4847-b36a-1bfe00666d8a`
- Created: `2026-10-04T18:32:04.221Z`
- Image digest: `sha256:60c6ee6c4b41e77c97c94f791fe29b20476eafe8eb5d57d875e1a29850661b1b`
- CLI-uploaded source; no Git commit supplied by deployment metadata. Local/deployed source parity remains unverified. Read-only SSH inspection could not start because no SSH keys were available; no keys were created.
- Presigner URL expiry override: `7776000` seconds (90 days). A future migration must audit existing signed URLs and frozen announcement delivery snapshots.

## Remaining gates, in order

1. Obtain a free private registry destination for the no-Git CLI route. Preserve a reviewed release and establish image delivery without publishing secrets or personal media. The user was asked whether they have Docker Hub or another registry.
2. Bucket inventory and local backup are complete. Still audit all consumers and frozen announcement media URLs, and confirm the selected media delivery design before uploading to Northflank.
3. Select the free architecture: Atlas + MinIO still lacks a verified free restricted Atlas route. The alternative uses a free internal MongoDB addon and static media service, contingent on inventory proving static/public compatibility and a rehearsed data import. MinIO and MongoDB cannot both occupy the single free addon slot.
4. Preserve the production credential-encryption key and database `schedules`; verify sessions, all collections/indexes, BSON dates, TTL, and announcement ledger continuity for any database move.
5. Rehearse using isolated bot/database credentials in the same free service slot. Complete native capacity and public HTTPS acceptance tests.
6. Only then stop Railway's poller/notification worker, start exactly one Northflank instance, update Telegram entry points, and validate real flows. Keep retirement separate from handover and within the remaining existing Railway trial.

No Northflank services, addons, egress gateways, secret groups, or production changes
were created by this implementation pass. No Railway service was stopped or removed.

## CLI installation and no-Git investigation

Installed the official `@northflank/cli@0.13.0` package in the ignored local directory
`data/tools/northflank`. The app's dependencies and lockfile were not changed.
Browser CLI login succeeded for `wilsonplur's team` using a session token, with no
new static API token created. Authentication files are confined to
`data/tools/northflank-auth` (directory mode 0700, file mode 0600).

Verified `list projects` and `get project --project schedule-bot`: the existing
London project has no services, jobs, or addons. Its UID is
`6ac2a6550232c689c858ae61`.

```sh
rtk proxy env NF_CONFIG_DIR="$PWD/data/tools/northflank-auth" data/tools/northflank/node_modules/.bin/northflank list projects --output json
```

The installed CLI's command tree provides service deployment from registry images,
remote Git builds, and upload to existing containers; it has no direct local-folder
build-and-deploy command. File upload alone does not provide durable application
deployment across container replacement. [CLI documentation](https://northflank.com/docs/v1/api/use-the-cli),
[deployment sources](https://northflank.com/docs/v1/application/run/run-containers-and-micro-services).

Container snapshots were also investigated as a possible alternative. The API
documents Kata runtime compatibility and restore-from-snapshot deployment, but
free Sandbox eligibility and snapshot storage coverage were not established.
No snapshot-backed infrastructure was provisioned on that uncertainty.
[Snapshot API](https://northflank.com/docs/v1/api/project/services/create-container-snapshot).

## Completed object backup

Local ignored backup: `data/migration/railway-storage-2026-10-07/manifest.json`.
All objects are stored alongside the manifest under hashed filenames, with original
keys, metadata, byte lengths and SHA-256 checksums retained. The backup contains
three MP4 files, one GIF, and zero-byte `photo/` and `video/` folder markers. Largest
object: 64,817,772 bytes. The final S3 listing matched the initial listing.
HEAD checks through the existing public presigner passed for all four media files:
HTTP 200, expected content types and byte lengths, and `Accept-Ranges: bytes`.

This is a copy taken while Railway remains live; perform a final comparison/export
after freezing writes at cutover. It is not a MongoDB backup. Keep this directory
private and outside Git, Docker contexts, or public image registries.
