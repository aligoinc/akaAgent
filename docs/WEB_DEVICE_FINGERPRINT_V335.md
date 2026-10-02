# Web device fingerprint recovery v335

Status 2026-10-02: **applied to production** `cgjbsmqtfhqvttudyjzq` (akachat) as `20261002043251 / web_device_fingerprint_v335`, then deployed backend/Web to https://agent.akabiz.net. Do not reapply. WebApp implementation and fixtures live in akaAgentWebApp; set `AKA_AGENT_REPO` to this checkout.

Follow-up v336 addresses existing duplicate fingerprints by introducing shared admission groups. It is implemented but not yet applied; this document retains the historical v335 behavior. See [v336 audit](WEB_DEVICE_FINGERPRINT_GROUPS_V336.md).

## Exact RPC and audit

New signature: `public.aka_agent_control_web_device_claim_v2(bigint,bigint,uuid,uuid,text,text,text,timestamptz,text)`.

- Source: absent (new function).
- Target definition MD5 from local Postgres: `fe57c1ebd641803729211aea01844065`.
- Verified production owner: `postgres`; SECURITY INVOKER, VOLATILE, `search_path=pg_catalog,public`, lock timeout 3s, statement timeout 8s; only owner/service_role EXECUTE. Production target MD5 matches the local value above.
- Live exact definitions, owner, ACL and settings were read on the verified project during this task and retained in [the audit snapshot](../migrations/snapshots/v335_web_device_fingerprint_audit.json).

Unchanged source and target checksums:

| RPC | Exact arguments | MD5 |
| --- | --- | --- |
| `aka_agent_control_web_device_claim` | bigint,bigint,uuid,uuid,text,text,text,timestamptz | `fbd5933e5fc7c4a600e523ad4572772c` |
| `aka_agent_control_web_device_overview` | bigint,bigint,uuid | `93faf6dab8bd9da786eb737a1a847cab` |
| `aka_agent_control_web_device_release` | bigint,bigint,uuid | `c45333bae7d4fb4ea29bafa8c69eaa5d` |
| `aka_agent_control_web_device_revoke` | bigint,bigint,uuid | `2eed26df527dd2ca0106da507ba73a8f` |

Repository v331/v332 and captured live definitions agree; no DB-only patch was overwritten. The migration fails closed on source drift or existing v335 objects. It leaves auth/staff-expiry RPCs, all four audited functions, existing ACLs and policy revisions unchanged. A new nullable session column means the legacy service-only v331 row JSON can contain that column; WebApp's existing explicit session mapper excludes it, and v2 strips it before returning its result. The browser never receives stored fingerprints or raw device IDs in session/list responses.

## Admission semantics

The backend authenticates before calling this service-role-only wrapper. It locks policy then staff, checks live active/policy/time eligibility, honors a live session's identity and known cookie, then considers an optional validated `v1:<sha256>` fingerprint only for an unknown/missing cookie. Exact lookup is scoped to staff and organization and active/unexpired Web/PWA sessions. Multiple distinct matching groups are ambiguous and are not merged. One match supplies the existing device ID to unchanged v331, preserving atomic quota/revision checks, login rotation and full-quota restore revocation.

Released devices can recover their identity but must acquire a slot again. Expired/revoked sessions cannot anchor fingerprint recovery. Existing legacy sessions enroll only on a successful new entry/login; no mass backfill or release. Native and background `/me` stay unchanged. No device-change UI is added to login.

When a known-cookie login has no new fingerprint, v2 carries forward the latest non-null fingerprint of that exact staff/organization/device before v331 rotates the session. The existing identity-history index supports this lookup. Known-cookie history may include logout/expiry or older-client sessions; it never supplies an identity for a missing/unknown cookie. A new fingerprint wins over stored history, and the unchanged v331 still enforces admission. This preserves recovery after a temporary collector failure followed by Chrome clearing cookies.

Fingerprint is a best-effort supporting signal, never proof of identity. Identical machines can collide and normal login rotation can then revoke the old matching session. The user accepts collisions; no unmeasured accuracy claim is made. Cookies remain primary and the application uses no external fingerprint service.

## Resource and verification notes

Adds `web_device_fingerprint` plus two indexes: staff-scoped active fingerprint matches, and known-cookie history (including revoked/expired identities). Uses the existing backend Supabase singleton and one admission RPC request. No connection source, pool, worker, replica, polling or heartbeat increase. Additional reads are bounded to authenticated staff/device scope; matching and quota mutation stay in one transaction.

Disposable local Postgres runs migration + service_role assertions ending in ROLLBACK and real concurrent transactions. Cases cover missing cookies/new anonymous cookies at a full quota, known-cookie/session precedence, ambiguity, invalid inputs, staff/tenant/native isolation, revoked/expired anchors, legacy enrollment, release/re-entry, `3 → 2 → 3`, description-only changes and EXECUTE privileges. Five equal-fingerprint concurrent logins use one slot and rotate to one active session; five distinct fingerprints admit exactly three. All v331/v332 regression tests also pass and their definition hashes remain unchanged.

The rotation regression failed before the fix and passed after it: login with a known cookie and no fingerprint, then clear cookies and recover with the original fingerprint at 3/3. Additional assertions cover new-value precedence, null-fingerprint F5, history after logout/expiry and older clients, and staff/organization isolation. Before this fix, a fresh read of akachat confirmed v2 absent and all four source definitions/attributes unchanged from the retained audit.

After the fix, WebApp typecheck, all 1,545 unit/API tests and production build passed again. The browser fixture's Set conversion was changed to `Array.from` to satisfy its TypeScript target; production TypeScript/UI behavior is unchanged by this follow-up.

Production apply used the exact canonical SQL (SHA-256 `eefcbb36fb7f00f50f201b4cd442f9c7ef6016876345b84e657ba436a6fa722f`) after a fresh definition/attribute comparison. Postflight verified the target checksum, owner/config/ACL, both indexes valid and all four dependency definitions/attributes unchanged. Limit 3 and policy revision `50322802-b377-4852-9e27-ca4787de990a` remained unchanged. One required PostgREST metadata refresh exposed the new column/signature; no global settings were changed.

The [production smoke](../migrations/tests/migration_v335_web_device_fingerprint_rollback_smoke.sql) passed under actual `SET LOCAL ROLE service_role` in an unused active staff scope and ended with `ROLLBACK`. It checked full-quota recovery after missing collection, token rotation, release/denial/re-entry, native/staff/tenant guards and hard revocation. Zero synthetic sessions remained. The existing backend's HTTP RPC probe returned 200/`invalid_staff` for actor 0, confirming Data API readiness before application deployment. No real staff sessions were bulk-released or revoked.

WebApp release: `registry.fly.io/aka-agent-web-app:fingerprint-b5f854b-20261002@sha256:c27f9c4511fa3d8cc4744e1d424ebbbc8e94ed4f32a604f1448b350c0c2f7453`; existing machine `48ee749f357398`, instance `01M3XE9SXNVTV95ZM1MTF49VKZ`, updated `2026-10-02T04:35:16Z`. Exact config comparison confirms only the image changed; one shared CPU/256-MB machine remains. 13 HTTP/asset checks and 20 production-asset browser fixtures passed (one real-GPU WebKit case skipped). See akaAgentWebApp `docs/WEB_DEVICE_FINGERPRINT_DEPLOY_20261002.md` for full deployment evidence and rollback.

WebApp validation: typecheck, 1,545 unit/API tests, production build and 20 browser cases passed (one real-GPU WebKit case skipped; WebKit fallback covered). The initial unrelated CampaignFormPage render-count failure passed isolated and full reruns. See akaAgentWebApp `docs/WEB_DEVICE_FINGERPRINT.md` for test scope and browser fixture limitations.
