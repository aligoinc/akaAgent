# Web device fingerprint admission groups v336

Status 2026-10-02: **applied to production and WebApp deployed**. Target `cgjbsmqtfhqvttudyjzq` (`akachat`); history **`20261002051556 / web_device_fingerprint_groups_v336`**. Supersedes the v335 wrapper behavior; do not reapply v331/v332/v335/v336 or bulk-push other migrations.

Canonical migration: [v336 SQL](../migrations/migration_v336_web_device_fingerprint_groups.sql), SHA-256 `050d8141479d3e54706c1e82a157e8cd23fca77a52ca31d1d87816cf66658693`. It was scaffolded using `supabase migration new web_device_fingerprint_groups_v336` and relocated to this repository's canonical `migrations/` directory. WebApp fixtures reference it through `AKA_AGENT_REPO`; no duplicate SQL migration is kept in WebApp.

## Problem and behavior

Two already-live cookies can have the same fingerprint. v335 treats them as ambiguous and cannot recover a cookie-less login when the quota is full. v336 separates each browser's `web_device_id` from its shared capacity `web_device_group_id`. Live exact fingerprint matches in the same staff/organization merge to one admission group. A missing cookie receives a new browser identity in that group, retaining the tokens of sibling browsers. Known-cookie login rotates only that cookie identity as before.

One live member admitted in the current policy revision holds one group slot. Released/old-revision groups must claim capacity again; unrelated fingerprints cannot evict another group or bypass the limit. An entry which changes its fingerprint to an existing group's fingerprint folds both groups atomically. Known-cookie aliases survive grouping and later missing/changed fingerprints.

The upgrade backfills connected components among live, unrevoked, unexpired Web/PWA fingerprints. A cookie with multiple recorded live fingerprints links those groups transitively. It stores aliases on corresponding historical cookie rows too, but historical/expired/revoked fingerprints do not establish matches. No tokens, expiry, registration timestamps, revisions or policy values change. Legacy sessions with no fingerprint remain unenrolled.

Overview uses the capacity group and returns one row, marking it current for any member. Soft release clears admission of all Web/PWA members without logging them out. Explicit logout and legacy hard revoke end the whole selected admission group, freeing the slot including old cookie identities left after clearing cookies. Full-quota restoration denial also revokes only that browser identity. Native sessions and background `/me` remain untouched. Fingerprint never replaces password/policy/entitlement authentication.

## Exact RPC audit and checksums

Fresh exact live signatures, definitions, owner, security, volatility, config and ACL were captured before writing SQL in [the source audit](../migrations/snapshots/v336_web_device_fingerprint_groups_audit.json). The captured definitions agree with canonical v331/v332/v335; no additional DB-only patches were found. The preflight accepts only these exact source definition MD5s and requires the new group column to be absent. Missing signatures or changed bodies/configuration abort before DDL. Reapplication intentionally fails closed.

All signatures below are in `public`. `timestamptz` is `timestamp with time zone`.

| Exact signature | Captured source MD5 | Verified production target MD5 |
| --- | --- | --- |
| `aka_agent_control_web_device_claim(bigint,bigint,uuid,uuid,text,text,text,timestamptz)` | `fbd5933e5fc7c4a600e523ad4572772c` | `c5e1be7ac88054ac9cdeebb4360bba9c` |
| `aka_agent_control_web_device_claim_v2(bigint,bigint,uuid,uuid,text,text,text,timestamptz,text)` | `fe57c1ebd641803729211aea01844065` | `b0237c546238d9613e42a0c70e1fb6d0` |
| `aka_agent_control_web_device_overview(bigint,bigint,uuid)` | `93faf6dab8bd9da786eb737a1a847cab` | `b948501e1f5b3f225233e471de4eb557` |
| `aka_agent_control_web_device_release(bigint,bigint,uuid)` | `c45333bae7d4fb4ea29bafa8c69eaa5d` | `b2b271fc69145c9fb1e61d7a4aa2394f` |
| `aka_agent_control_web_device_revoke(bigint,bigint,uuid)` | `2eed26df527dd2ca0106da507ba73a8f` | `d2a8faa67b422761de065d0533d63afb` |

`CREATE OR REPLACE` retains production owner `postgres`, invoker security and service-role-only ACL (owner/service_role EXECUTE). Overview remains STABLE; claims/release/revoke remain VOLATILE. All retain search path `pg_catalog, public`, 8s statement timeout and 3s mutation lock timeout. Local assertions compare owner, ACL, volatility, security and config before/after. Original v1 now delegates to v2, keeping old callers group-aware; v2 no longer calls v1. The returned session JSON strips digest, cookie identity, group, revision, registration timestamp and token hash.

Preserved live guards include policy→staff lock ordering, active/policy/staff-time checks, tenant/session validation, optional fingerprint validation, known-cookie fingerprint retention across logout/expiry, input validation, same-cookie login rotation, denial revocation and statement/lock timeouts. Auth, setting parser and policy-revision triggers are not replaced. Hard revoke retains its staff lock, tenant/session guard and native isolation; its Web/PWA group predicate changes to the shared admission group so explicit logout frees the slot. The original wrapper's one-match-only recovery is the intended behavior removed.

## Load and rollout

Adds one nullable UUID and a scoped effective-group expression index, reusing v335's fingerprint/history indexes. All matching and count/write work remains in the same existing singleton RPC transaction; staff locks serialize competing entry/release/revoke requests. No new connection source, pool, worker, replica, periodic job, polling, auto-retry or heartbeat. The one-time backfill runs under the DDL table lock and existing migration bounds (3s lock / 30s statement timeout); unknown spare DB capacity is not assumed.

Completed authorized apply: refreshed the audit, matched every exact definition **and attribute** against this snapshot, applied only canonical v336, verified target MD5/owner/ACL/config/index validity and unchanged policy revision, then passed the [rollback smoke](../migrations/tests/migration_v336_web_device_fingerprint_groups_rollback_smoke.sql) under actual `SET LOCAL ROLE service_role`. It selects an unused active staff scope and ends in ROLLBACK. The existing deployed backend already calls v2, so the grouping fix takes effect when the DB migration commits; WebApp deployment updates the explanatory copy. The migration emits one PostgREST metadata refresh for the new column.

Application rollback can retain the additive DB fix. A DB rollback requires a reviewed migration of all group-aware operations together; simply restoring old admission counting while keeping grouped release would split quota semantics. Do not delete group storage or revoke user sessions to roll back.

## Verification

`AKA_AGENT_REPO=/path/to/akaAgent sh scripts/test-web-device-sql.sh` passes on disposable local PostgreSQL 16. No application credentials or production connections are used. Assertions and the canonical service-role smoke end in ROLLBACK. Coverage:

- Backfill reproduces two Chrome identities with one fingerprint plus a distinct Edge identity: 3 cookie slots become 2 groups, with no changes to auth or admission fields. Transitive matches, historical aliases and native/expired/revoked exclusions are checked.
- At a full quota, cleared-cookie login reuses the group; sibling tokens remain valid. Different/absent unknown fingerprints remain blocked. Known-cookie rotation/history, conflicting request cookies, missing collection and changed fingerprints preserve grouping.
- Overview shows one current row with combined session count. Release clears every member; F5 reclaims if space exists, and full-quota denial affects only the requesting cookie. Real logout frees the whole group, including orphaned cookie identities; expiry stops a session counting and frees the slot once no admitted member remains. Staff, tenant, policy and native isolation remain enforced.
- `3 → 2 → 3`, description-only edits, original setting fallbacks, original v331/v332 behavior and ACLs remain covered. A deliberately changed source checksum is rejected without leaving the group column behind. Owner/security/config/ACL are identical before and after migration.
- Five concurrent equal-fingerprint logins preserve five independent cookie sessions and consume one group; five distinct fingerprints admit exactly three. Concurrent release, fingerprint recovery and unrelated logins keep usage bounded and old sibling tokens valid.

WebApp browser fixtures verify grouping/current badges and soft release on desktop Chromium, Android Chromium and iPhone WebKit, plus real Chromium fingerprint collection after restart/cookie clearing. API responses are mocked in browser tests; actual matching/concurrency are exercised by SQL. No real messages, campaigns or production session changes occur.

WebApp final validation: typecheck/build and all **1,545 unit/API tests passed**. **23 browser cases passed**, with **1 real-GPU WebKit case skipped** (fallback and grouped UI covered). The new UI-only WebKit fixture uses explicit fixture sessions after injected-cookie setup failed; real cleared-cookie recovery remains tested on Chromium and matching on PostgreSQL. Final RPC target hashes above are from the last passing SQL run, including grouped logout. The production rollout and verification are recorded below.

Final browser rerun after awaiting in-flight route handlers during fixture cleanup: fingerprint suite **11 passed / 1 skipped**. The unchanged device-management suite passed all **12 cases**, for 23 passing cases total. Local dev server was stopped after verification.

## Production rollout — 2026-10-02

Applied only this canonical migration to `cgjbsmqtfhqvttudyjzq` as **`20261002051556 / web_device_fingerprint_groups_v336`**. A fresh preflight matched all five captured definitions and attributes; every production target MD5 in the table above matched after apply, with unchanged owner/security/ACL/config. Group index valid; policy stays 3 with revision `50322802-b377-4852-9e27-ca4787de990a`. The scoped previously inspected account changed from 3 cookie slots to 2 groups with all 3 sessions still live.

The canonical service-role rollback smoke passed on production; a follow-up query confirmed zero synthetic sessions persisted. Existing-host PostgREST probes for claim v2, overview and release passed with nonexistent actor 0. No sessions were mass revoked or released.

WebApp deployment followed SQL verification: immutable image `registry.fly.io/aka-agent-web-app:fingerprint-groups-b5f854b-20261002@sha256:cb0fb98a7416f09ae2a391da529e961a796e2326ef75b86348f16b05fb942a3b`, existing machine `48ee749f357398` updated at `2026-10-02T05:16:58Z`, health passing. Configuration differed only by image; one shared CPU / 256 MB, no new replica, SQL connection source, pool, worker or heartbeat. All 13 HTTP checks and 23 browser fixtures passed against deployed assets; 1 real-GPU WebKit fixture stayed skipped. Browser API responses were mocked; actual matching and release were checked through SQL. Full release/rollback details are in WebApp `docs/WEB_DEVICE_FINGERPRINT_GROUPS_DEPLOY_20261002.md`.

Restricted audit/build/runtime evidence: `/var/folders/cn/vjc7x3sn3gxc_nr3qz4nd7q80000gn/T/aka-fingerprint-groups-deploy-20261002-fqlue_hr`. Source audit is retained unchanged; do not reapply v336.
