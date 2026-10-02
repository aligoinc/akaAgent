# Chat engagement configuration/registration permissions — 03/10/2026

Applied and deployed on 3 October 2026 (Vietnam time). This fixes the Chat worker;
Desktop and the Windows App Server 7.9.0 installers do not need rebuilding.

## Incident and cause

Campaign 22139 / successful message detail 3651016 was committed at 00:22:22.
The existing Chat inbox received the matching seen receipt at 00:22:52 and the
incoming response at 00:22:55, but the detail had no `zaloEngagementSource` and no
engagement row. The SQL worker role `aka_agent_chat_api` cannot SELECT
`auto_system_settings`; production PostgreSQL logs confirmed the denied query.
Tracking failed closed while sending, projection and campaign completion continued.

Checking actual privileges also found that this role cannot UPDATE
`auto_campaign_details.data`. The former post-registration cleanup query would
therefore fail after fixing configuration access. Earlier tests ran that path as
the DB owner and did not reproduce these production permissions.

## Changes

- The worker's configuration reader uses the existing verified public Supabase
  HTTP project mapping and anon Data API access, restricted to exactly the four
  engagement keys, active/non-secret rows and a four-row limit. It retains the
  shared 60-second cache, in-flight deduplication, fail-closed errors and a
  five-second HTTP timeout. Unknown/local project connections never fall back to
  production; fixtures inject their own reader. No direct settings SQL remains.
- Registration consumes the Chat pending marker in the existing owner-checked
  RPC, atomically with registration. The worker's separate detail UPDATE was
  removed. The source metadata and execution status remain intact. No broad
  settings/detail grants, new pools, Zalo APIs, polling timers or replicas.
- No backfill was performed for the incident detail, which lacks source metadata.
  No real Zalo sends or other Zalo mutations were generated during verification.

## Canonical migration and database verification

- File: `migrations/migration_v341_zalo_engagement_chat_registration.sql`.
- Project: `akachat / cgjbsmqtfhqvttudyjzq`.
- History: `20261002174744 / migration_v341_zalo_engagement_chat_registration`.
- Exact signature: `public.aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)`.
- Source definition MD5: `0bdce96014857158991a7c0ce78e81ca`.
- Target definition MD5: `2bacb504c895ea6efd6a1d9b68d6e213`.
- The captured live body matched v339. The only body change expands the pending
  cleanup runtime predicate from `desktop` to `IN ('desktop','chat')`. All auth,
  tenant, revision, UID, deadline, registration idempotency, catalog and matching
  behavior remains unchanged. Owner `postgres`, SECURITY DEFINER, volatility `v`,
  search path, 15-second timeout and private helper ACL are preserved.
- Fail-closed definition/attribute preflight accepts only source or target;
  transaction rollback and idempotent reapply were tested in isolated PostgreSQL
  (PGlite). Production checksum/attributes were verified after the atomic apply.
- The apply reused existing migration history tables, with no setup DDL or
  explicit PostgREST schema reload. No API signature/metadata change was needed.
  `enabled=true` and its revision `2026-10-02T16:40:20.806571+00:00` are unchanged.

## Runtime deployment and tests

- Image: `registry.fly.io/aka-agent-chat-api:engagement-config-fix-20261003@sha256:908423d23eefbf17fa320749710a574422986252707003a8c2e3a82dc476ac43`.
- Worker: `784574da214578`, instance `01M3YVPMNYGJ62F61K4SA0ETQN`, started
  2026-10-02T17:48:40Z. Verified Node PID received SIGTERM and exited with code 0
  before image replacement; no forced kill or overlapping worker.
- Only the worker image changed. API/runtime machine instances and configuration,
  all resource settings and the three-machine count stayed unchanged. The live
  worker environment confirms its pool maximum remains 10.
- Typecheck/build and all **94 files / 1,444 tests** passed. The new integration
  regression runs `SET ROLE aka_agent_chat_api`, proves settings SELECT and detail
  UPDATE are denied, then successfully registers, clears pending and records
  seen/response through the fixed paths. Wrong tenant/auth/revision cannot clear
  another pending source; existing nonblocking/error/race tests remain green.
- The deployed configuration reader returned all four live values (true, 5, 100,
  48). Four changed compiled production files matched the tested local build.
  API readiness returned HTTP 200. A bounded PostgreSQL log check after cutover
  (17:48:30–17:49:41 UTC) found neither settings nor detail permission errors;
  this is not a long-term monitoring or real-message end-to-end guarantee.
- Existing inbox stats for the first two full minutes after restart show all
  29 received events normalized/projected, zero failures/infrastructure errors,
  zero raw/projection backlog and zero scheduled retries.

Rollback: retain v341 (compatible with Desktop and older workers) and, if needed,
gracefully restore only the same worker's previous image recorded in the original
deployment audit. The old image still has the diagnosed permission bug. Do not
resend campaigns, reconstruct source metadata or reset quotas as rollback.

Metadata evidence: `docs/audits/zalo-engagement/config-permissions-20261003/`.
Restricted deployment evidence/logs: `/tmp/engagement-config-fix-20261003`.
