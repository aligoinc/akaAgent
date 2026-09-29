# Web/PWA device change — v332

The **Đổi thiết bị** operation releases admission while preserving the control session. It permits the current browser, clears all Web/PWA admissions for that browser group and leaves device identity, tokens, expiry and native sessions intact. Background authentication continues; the next open/F5 must claim again. A full quota at that entry uses v331's existing rejection/revocation behavior.

Canonical source: [migration v332](../migrations/migration_v332_web_device_release.sql). Project: `cgjbsmqtfhqvttudyjzq` (`akachat`). The live definitions and attributes captured during this task are in [the audit snapshot](../migrations/snapshots/v332_web_device_release_audit.json).

Applied on 29 September 2026 as `20260929073354 / web_device_release_v332`; **do not reapply**. Backend and Web/PWA are deployed at https://agent.akabiz.net, including the campaign selection bar's light/dark text-color fix.

## Function and preserved dependencies

- New signature: `public.aka_agent_control_web_device_release(bigint,bigint,uuid)`; source checksum absent (new function), target MD5 `c45333bae7d4fb4ea29bafa8c69eaa5d` from `pg_get_functiondef`, verified equal on local PostgreSQL 16 and production after apply.
- SECURITY INVOKER, VOLATILE, `search_path=pg_catalog,public`, lock timeout 3s, statement timeout 8s. Production owner `postgres` and ACL `{postgres=X/postgres,service_role=X/postgres}` verified; no browser-role access.
- Lock the same staff row used by admission before looking up the scoped session and clearing the entire device group. Native, expired/revoked sessions, missing device identity and mismatched staff/tenant are rejected. Repeated release of an otherwise valid pending session succeeds without further changes.
- Preserve claim (`fbd5933e5fc7c4a600e523ad4572772c`), overview (`93faf6dab8bd9da786eb737a1a847cab`) and hard revoke (`2eed26df527dd2ca0106da507ba73a8f`) byte-for-byte. The migration checks these live dependency hashes and fails if the new RPC already exists. Existing auth (`7995d6e92b16eb17b44995e14aae1b87`) and staff time (`a294e60011edd8d42e90ac2f74ce744c`) remain untouched, preserving all captured live patches.
- No new tables/settings/indexes, connection sources, pools, replicas, workers or polling. One PostgREST schema reload is required for the new RPC signature. Never reapply v331.

## Verification and rollout

WebApp's `scripts/test-web-device-sql.sh` reads v331/v332 through `AKA_AGENT_REPO`. Release assertions run under `SET LOCAL ROLE service_role` and `ROLLBACK`: group release retains every authentication field, current-device release, same-identity re-entry, full-quota rejection on later re-entry, native/tenant isolation, expiry, idempotent retry and unchanged hard logout. Concurrent release with five logins remains bounded; existing concurrency/revision tests also pass.

Backend tests verify authenticated scope and retained cookies on success/failure. Browser fixtures cover another browser continuing background `/me`, manual list refresh without reclaim, successful reload, current-device release followed by quota-full reload, and release network errors.

Live smoke in [the rollback fixture](../migrations/tests/migration_v332_web_device_release_rollback_smoke.sql) used actual `SET LOCAL ROLE service_role`, synthetic sessions in an unused staff scope, and `ROLLBACK`. Authentication before/after release, shared Web/PWA release, current-device re-entry, full-quota rejection, native/tenant guards and unchanged hard revoke passed; zero synthetic sessions remained. PostgREST invocation from the existing backend returned HTTP 200/false for a nonexistent actor. All seven captured dependencies retained their exact checksums, owners, security modes, volatility, config and ACL. The security advisor reported no finding for the new function.

WebApp verification passed: workspace typechecks, 1,531 unit/integration tests, local SQL role/concurrency fixtures and production build. All 15 browser fixtures passed against deployed assets on desktop Chromium, Android Chromium and iPhone WebKit; APIs were intercepted, with no real login, messages or campaign starts.

Deployed image: `registry.fly.io/aka-agent-web-app:device-change-theme-0ed30b1-20260929@sha256:8406e3fe00a8bd6dfc432b1db8e2a3eb63a0ebc2ea23ee790aa09636ab25f37a`. Existing Fly machine `48ee749f357398` updated in place at `2026-09-29T07:41:19Z`; config changed only its image, with health passing. No connection-budget or machine-count increase. Detailed build/HTTP/browser evidence is recorded in WebApp's `docs/WEB_DEVICE_LIMITS_DEPLOY_20260929.md`.

Application rollback uses the preceding immutable image `registry.fly.io/aka-agent-web-app:web-devices-visible-6b8694c-20260929@sha256:c3457ae4523e4eacfcd90de4938d1c815079a0042bbf0ba817f5ecbe734c19cf` and retains this additive RPC; do not reset device admissions or revive previously revoked sessions.
