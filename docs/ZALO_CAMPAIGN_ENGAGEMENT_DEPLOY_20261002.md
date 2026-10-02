# Zalo campaign engagement — production rollout, 2 October 2026

Applied DB v339 and deployed the WebApp/API plus Chat worker/runtime at the user's request. Initial rollout kept the feature disabled. **The user subsequently requested activation: `zalo.campaign_engagement.enabled=true` since 16:40:20 UTC (23:40:20 Vietnam), 2 October 2026.** Desktop and legacy Electron Server installers are not published. No real Zalo test message, friend request, reaction, receipt or campaign was generated.

## Database

- Verified linked project **akachat / `cgjbsmqtfhqvttudyjzq`**.
- Canonical [v339](../migrations/migration_v339_zalo_campaign_engagement.sql), SHA-256 **`4d048c2a3c7ba644d4f2d63a5cf10fcb7e61857c5a19406eecef72043624d262`**.
- Applied history **`20261002162601 / migration_v339_zalo_campaign_engagement`**. Do not reapply or bulk-push other pending migrations.
- Fresh [source capture](audits/zalo-engagement/deploy-source.json) and [verified production target](audits/zalo-engagement/deploy-target.json). Identity helper and detail v1 retain exact definitions, owner, ACL, security, volatility and configuration. V2 preserves live v1 ownership/credential checks, pagination bounds, date/sort guards, count and page-only payload behavior.

| Exact function signature in `public` | Source MD5 | Production target MD5 |
| --- | --- | --- |
| `auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` | unchanged |
| `aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text)` | `9652783556c25109e6250375da031fa3` | unchanged |
| `aka_agent_campaign_engagement_revision()` | absent | `cf7e83d7ec5562bbe4f6ec4d09abe4f6` |
| `aka_agent_campaign_engagement_batch(bigint,bigint,text,jsonb,text,text,text)` | absent | `0bdce96014857158991a7c0ce78e81ca` |
| `aka_agent_register_campaign_engagement(bigint,bigint,text,jsonb,text,text)` | absent | `0be97926b6629fd1f821726f2eca71c5` |
| `aka_agent_record_campaign_engagement(bigint,bigint,text,jsonb,text,text)` | absent | `c64228d384c787cce3da3417ccaeca53` |
| `aka_agent_read_campaign_engagement(bigint,bigint,text,jsonb,text,text)` | absent | `2546cd89f6ffe8118cd818dd12b467e5` |
| `aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text,text,text)` | absent | `7b7407f8102f56591435b9bc092c7b34` |

All new functions are owned by `postgres`. Trigger is invoker/volatile; batch and three wrappers are definer/volatile with `search_path=pg_catalog, public` and 15s statement timeout. V2 is definer/stable with 60s timeout and the existing read ACL. Internal batch and trigger have owner-only EXECUTE. Public wrappers retain credential/tenant/account/runtime/UID/time/ID validation. Table has RLS and no direct API-role access.

Predeployment privilege inspection found that `aka_agent_chat_api` does **not** inherit `service_role`. The three register/read/record wrappers therefore receive explicit EXECUTE for this existing runtime role; the internal batch and table remain inaccessible. Local fixtures now reproduce production default ACLs, and the revision trigger explicitly revokes inherited anon/authenticated/service-role EXECUTE. No function body changed for these grants.

The existing details and inbox tables had approximately 3.36M and 1.77M rows. [The deployment runner](../scripts/apply-zalo-engagement-migration.cjs) used the existing linked Management API, a short schema transaction with 2s lock timeout / 15s statement timeout, then **four sequential `CREATE INDEX CONCURRENTLY` requests** on those populated tables. The nullable inbox check was added NOT VALID and validated separately. Three indexes on the new empty engagement table were created normally. The four concurrent builds took about 47.4s, 12.7s, 19.3s and 3.7s; constraint validation request took 3.0s. All seven exact index definitions matched the local fixture and were valid/ready/live before recording history. No index was dropped or unrelated migration applied.

API metadata changed, so postflight requested schema reload and verified all four public RPC endpoints through the existing Web machine's Supabase HTTP credentials. Calls returned the expected owner/campaign guard errors, confirming PostgREST recognized the signatures. The DB rollback smoke verified role ACLs, actual `SET LOCAL ROLE service_role`, credential/owner guards and RLS, and left zero engagement rows. A read-only rollback comparison on an existing campaign also confirmed v1/v2 payload/count equality and that the `none` filter excludes unregistered details. The Management API admin role cannot `SET ROLE aka_agent_chat_api`; its privileges were checked by exact role name on production, and actual Chat-role execution was tested in isolated PostgreSQL. This limitation is not represented as a live Chat-role impersonation test.

Seeded settings are **false / 5 seconds / 100 items / 48 hours**. Registration uses its persisted DB deadline. Enabling and production load validation remain separate rollout gates.

## Applications

Frozen build inputs were Git archives plus explicitly selected feature files. Web used commit `64b73744cfb06735647ae9908bbce2ac5231dab2` plus 13 files; unrelated mobile/iOS/signing edits were excluded. Chat used commit `ba246f0` plus 13 files. Existing source edits remain uncommitted in the user's working trees.

| Component | Existing machine | Updated at UTC | Immutable image digest |
| --- | --- | --- | --- |
| Chat worker | `784574da214578` | 16:29:44 | `sha256:8811c3ac48c077dc04eaf91cc22c91f00ebe74ba20de1802e29d292fd925d16d` |
| Chat runtime | `0803139f1d1058` | 16:30:28 | same Chat image |
| WebApp + its API | `48ee749f357398` | 16:30:18 | `sha256:6b3ce5846cf84b3acc1ea221ea19ba5034f12c12803e8ae627f988232ffd51e7` |

Images: `registry.fly.io/aka-agent-chat-api:campaign-engagement-20261002` and `registry.fly.io/aka-agent-web-app:campaign-engagement-20261002`, pinned to the digests above. Public Web URL: **https://agent.akabiz.net**.

The existing worker and runtime received SIGTERM at a verified Node PID, exited gracefully and were updated while stopped. Runtime logged a completed drain with zero remaining events/bytes. No overlapping worker/runtime replica or forced kill was used. Only `config.image` changed; full config equality was checked after update and startup. Still one worker, one runtime and one Chat API machine; Web still one shared CPU / 256-MB machine. Worker pool maximum remains **10**; no new SQL client/pool, connection-budget increase, replica or process was added. Chat API machine `7845747fe073e8` needed no code update and retained its configuration and instance ID.

All 126 source-backed production Chat JavaScript files matched the tested local build after deployment. Web HTTP HTML and main JS matched the deployed filesystem hashes; main asset `/assets/index-BaUeWQSz.js`. API health/live/ready and Web health returned 200, browser navigation worked and missing-auth API calls returned 401.

## Verification

- Isolated PostgreSQL migration, rollback assertions, real-role ACL and two-transaction race smoke passed, including preserved deadline/idempotency/ownership behavior and nonblocking acknowledgement.
- Chat typecheck/build and **93 files / 1,434 tests** passed. After final ACL fixture changes, all **29 engagement integration tests** passed again.
- Local synthetic ingress acknowledged all **1,000** generated events across a simulated two-second outage. This harness uses fake connectors and no production DB/Zalo.
- Web typecheck/build and all **1,545 tests** passed.
- Against the production-served assets, **three Playwright fixtures** passed on Desktop Chromium, Android Chromium and iPhone WebKit: four marks, applicability, filters, narrow layouts and all 996 filtered Excel rows. API data and WebSocket traffic were intercepted; no live customer session/campaign was used. Screenshots were visually inspected.
- Desktop/legacy Server had already passed their typechecks/builds before this deployment turn; they were not published.

## Initial production observation

The runtime reattached **87 accounts**, matching its final pre-cutover queue samples (16:28 and 16:29 UTC). Server state remained running, `lastError=null`, heartbeat advanced and the runtime queue/in-flight/unsent counts returned to zero. An earlier inventory showed 88 accounts; that count had already fallen to 87 before the runtime was signalled.

Reconnect caused a temporary inbox burst: raw/projection backlog reached 10,964 / 3,095 at 16:31:49 UTC, then drained to **0 / 0**, with **0 scheduled retries**, at **2026-10-02T16:36:49.616Z**. All observed postdeployment intervals had zero normalization/projection failures, rejected/lost claims and infrastructure errors. Existing best-effort realtime `capacity_drop` warnings were present around cutover; no claim is made that this feature fixes that dispatcher. Engagement stayed disabled throughout. These are bounded observations of natural traffic, not a production capacity benchmark.

[Final verification manifest](audits/zalo-engagement/deploy-verification.json).

## Rollback and evidence

Previous worker image: `registry.fly.io/aka-agent-chat-api:action-limit-notices-20261002-090528@sha256:3bd958710848e56bb31716b806a96505efa3745622132a6b519cbf2f9c4f8931`.

Previous runtime image: `registry.fly.io/aka-agent-chat-api:send-exclusions-20260928-172935@sha256:be958adeea64ae33cc6185dabd8673435fc11f76316a77a81f98d58781baa81c`.

Previous Web image: `registry.fly.io/aka-agent-web-app:fingerprint-groups-b5f854b-20261002@sha256:cb0fb98a7416f09ae2a391da529e961a796e2326ef75b86348f16b05fb942a3b`.

If code rollback is required, gracefully stop the same Chat process before replacing only its image; preserve all configuration and ownership recovery. Keep additive DB schema and `enabled=false`. Do not replay Zalo commands, clear runtime tokens, drop the engagement table or reapply v339 to roll back.

Restricted local evidence: `/tmp/engagement-release-20261002` (0700), including exact build manifests, SQL phase outputs/history, machine configurations, runtime/file hashes, logs, HTTP probes and browser screenshots. Public DB source/target metadata is retained in the linked audit files. This rollout does not establish production load capacity; the earlier stress limitations and staging gate remain in force.

## User-requested activation — 16:40:20 UTC

After deployment and its postflight checks, the user explicitly requested enabling the feature. Updated only `zalo.campaign_engagement.enabled` from `false` to `true` with a revision compare-and-set. The existing trigger advanced revision from `2026-10-02 16:26:02.117234+00` to **`2026-10-02 16:40:20.806571+00`**; an independent read verified the committed value. Other settings stayed at 5 seconds / 100 items / 48 hours with unchanged revisions. [Activation evidence](audits/zalo-engagement/enable-20261002.json).

This was a data-only setting update: no migration, schema reload, process restart, new connection source or replica. The deployed consumers refresh their cached configuration on activity after the 60-second cache expires. No historical mark backfill or real Zalo test action was triggered. Desktop/legacy Server still require the unpublished new client version. The rollout/benchmark observations above remain historical and do not become a capacity guarantee because the switch is now on.

## UI update — 03/10/2026 Vietnam

Web received a display-only update to leave cells empty without recorded marks; Desktop source matches. See [current display release](ZALO_CAMPAIGN_ENGAGEMENT_DISPLAY_20261003.md) for the newer Web image, verification and rollback. DB/Chat runtime and the enabled setting were unchanged.
