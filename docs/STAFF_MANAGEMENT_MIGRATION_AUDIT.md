# Audit migration Quản lý nhân viên v305–v308

Applied to **akachat / `cgjbsmqtfhqvttudyjzq`** on 22/09/2026. History: `20260922095837 / migration_v305_staff_management`.

Source: exact `pg_get_functiondef(to_regprocedure(signature))` captured in this task before constructing the migration. Preflight checks definition MD5 and owner/security/volatility/config/ACL for all 20 existing dependencies. Columns/new function/ledger metadata also fail closed on incompatible pre-existing definitions.

First apply hit the 3-second lock timeout and rolled back completely (no new columns/RPC/history). The final migration acquires `org_staff` then `org_organization` before ALTER, following runtime lock order. Rollback validation passed again; the subsequent single-migration apply succeeded. No pool settings, global trigger definitions, or connection budgets changed.

## Exact signatures and checksums

Existing function owner, `prosecdef`, `provolatile`, `proconfig`, `proacl` were compared after apply and are unchanged. MD5 below is of `pg_get_functiondef`, including signature/return type/config.

| Signature | Source MD5 | V305 applied MD5 |
|---|---|---|
| `aka_agent_admin_assert_access(bigint,text,text)` | `1644f95929edee967b02b51b1b785b0e` | `1644f95929edee967b02b51b1b785b0e` |
| `aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)` | `405ad2d62315e504c5ed998cfd22f0b4` | `8ea465944efda08fb2e89da9589e065a` |
| `aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)` | `15517ca7d3dd7af4bf1bd46f4e9cf653` | `b721f2bf997eef62f72eaf5e2728fb8c` |
| `aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])` | `698334ac50dcc485fbe4a825411df582` | `35d402155b69cc393621092d752605e5` |
| `aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)` | `c822891785abb3fadf2576ec02b6b6f8` | `c822891785abb3fadf2576ec02b6b6f8` |
| `aka_agent_claim_zalo_server_run_unit(bigint,bigint,bigint,bigint[])` | `b4c8813db5823e3867c6487e38263ff7` | `1d2e9fe42c493c523641741389496b5c` |
| `aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint)` | `e65852b88d5d58994f305dcda9d8fc8a` | `5b849d4685b10d6446b4922ed70b0219` |
| `aka_agent_internal_require_staff_tenant(bigint,bigint)` | `3261f19ede3835caccc9cc425cbbc414` | `3261f19ede3835caccc9cc425cbbc414` |
| `aka_agent_prepare_device_change_v2(text)` | `28589c77ed8e440a0d8b6b4304e0311f` | `28589c77ed8e440a0d8b6b4304e0311f` |
| `aka_agent_reset_device_binding_v2(text,text,text,uuid,jsonb,jsonb)` | `dfc6d177499fbf9fc51526d7b9fba6f4` | `dfc6d177499fbf9fc51526d7b9fba6f4` |
| `auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` | `5a9a503db72b965eb644739f5f60905d` |
| `claim_campaign_runtime(bigint,bigint,bigint,text)` | `e6b1889cda717cb0bea6f7d801633c75` | `02038a74bbd1238f276dee3109ae21cf` |
| `claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)` | `300b0873302bddc8f9db6ecf404eeeea` | `e590eca5b11f0b258309bcd13b01e6a6` |
| `claim_zalo_account_runtime_operation(bigint,bigint,text,boolean)` | `8fa70359975cb87d842310131438b2d4` | `4d23cf3365d335072c4fcb01e7942dd1` |
| `claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)` | `78d5cdd05a02bdf3b78349e598e9d512` | `2f925040dd0bdc49725e0cebbf07c407` |
| `discover_zalo_server_account_runtime_users(bigint,integer)` | `47fc86fdd6506bf1dbb8836569f792ab` | `e6c30bd94f312d1e181f936ac41bd026` |
| `get_staff_zalo_account_capabilities(bigint)` | `29c273a8423689adfbeb62180ba3093f` | `6354ae2e66d0d7624e090750ac820a2b` |
| `get_staff_zalo_runtime_mode(bigint)` | `c4619e84b889125335078f3559feedd4` | `cf1fdfe5733240f9a52a0395e2cdefa1` |
| `normalize_phone(text)` | `f6ccb574895043480e6523193f7be007` | `f6ccb574895043480e6523193f7be007` |
| `set_staff_defaults()` | `140b74c234a2a71e9ae0455a888dc672` | `140b74c234a2a71e9ae0455a888dc672` |

New functions (owner `postgres`, `SECURITY DEFINER`, pinned `pg_catalog, public` search path):

| Signature | V305 applied MD5 | Volatility / access |
|---|---|---|
| `aka_agent_staff_access(bigint,text,text)` | `632942ca116ca830d4a7f5fff72e871f` | s / anon/authenticated/service_role; credential checked |
| `aka_agent_staff_management_row(bigint)` | `9e5db7f61b5768852c8dece5f6e6aebe` | s / service_role only |
| `aka_agent_staff_management(bigint,text,text,text,jsonb)` | `b0fb02514a2b501b1e6d94d1122d330d` | v / anon/authenticated/service_role; credential checked |
| `aka_agent_staff_time_allowed(bigint)` | `878cba86a2426dae09bc9f69a163680e` | s / PUBLIC boolean runtime guard |

## Preserved live behavior

- `get_staff_zalo_account_capabilities(bigint)` had a DB-only `quota_pools` addition calling `private.resolve_organization_zalo_entitlement_pools`; this is preserved. The body was not restored from v219.
- Claim RPCs keep current campaign/input serialization, token replay, data-group guards, runtime ownership and pause semantics. The v2 committed-unit replay branch remains before mutable staff authorization.
- Run-control permits a held unit token to settle after staff expiry; a fresh unit/account/campaign claim and discovery require staff time access. `auto_assert_automation_identity`, `aka_agent_internal_require_staff_tenant`, device-change v2 and other cleanup bodies remain unchanged.
- Existing PUBLIC/runtime ACLs remain unchanged. The new boolean helper also supports PUBLIC callers so invoker RPCs, including `aka_agent_chat_api`, do not gain a nested permission error. The helper reveals no credentials/rows. Actual management/password API checks credential and live admin tenant.

## Validation evidence

- Migration DDL and business/runtime smoke executed inside an intentional rollback before apply; the final lock-order version passed the same rollback check.
- Post-apply 20 existing signatures matched expected checksums and all captured attributes; four new function definitions/owner/security matched.
- `migration_v305_staff_management_smoke.sql`: passed on live schema inside rollback. Includes old `anon` Facebook/Zalo claim → held unit → expire → replay → result write → settlement → next-unit denial and account-operation release.
- `migration_v281_account_menu_device_change_unlimited_smoke.sql`: passed after migration, v1/v2 device contract, zero/NULL quota, replay, presence and role permissions.
- Concurrent Management HTTP: exactly one last-slot creation; normalized duplicate rejected; stale edit rejected; stale/new-request device CAS rejected while same-request replay preserves new binding; queued request rejected after admin revocation.
- The first fixture cleanup encountered the existing unindexed run-event account FK (13 GB table). All isolated fixtures were subsequently removed using a guarded session-local cleanup; no real tenant was edited. The harness now contains that cleanup explicitly.
- PostgREST after reload: old staff SELECT HTTP 200; new columns HTTP 200; new access/management reject invalid credentials with expected P0001/HTTP 400; old device preparation returns its existing `not_found`/HTTP 200. No schema cache/signature/ACL error in these checks.
- Desktop and Server production builds plus both TypeScript projects passed. Auth v2 112 checks, device smoke, Admin smoke, new Electron staff smoke and session-expiry smoke passed.
- Visual comparison completed in Electron with fixture data, light/dark wide/narrow and create dialog. Production UI is native React, not an embedded prototype.

## Advisor review

The feature ledger intentionally has RLS with no client policies; access is RPC-only ([RLS notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). New credential-checked RPCs and the boolean runtime guard are intentionally callable as SECURITY DEFINER from the existing client roles ([anon notice](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated notice](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)). Other existing project advisor findings were outside this change.

Compatibility evidence covers the shipped database/API contracts and existing auth/device flows; it does not assert every historical packaged binary was launched. Current valid accounts retain NULL staff expiry and continue using existing product entitlements.


## V306: creation/expiry timestamp alignment

Applied on the same verified project, history `20260922101530 / migration_v306_staff_creation_expiry_timestamp`.

Exact signature: `aka_agent_staff_management(bigint,text,text,text,jsonb)`.
Source MD5 captured via `pg_get_functiondef` after v305: `b0fb02514a2b501b1e6d94d1122d330d`.
Final target MD5: `45158ff8555a5a12501949371d08b658`.
Owner, security mode, volatility, search path/timeouts and ACL were checked before/after and remain unchanged.

Only the new staff INSERT changes: `created_at`/`updated_at` now use the same DB `stamp` as expiration calculation. This eliminates a transaction-start/clock timestamp discrepancy at Vietnam midnight. No existing row is rewritten; no signature, return type or API metadata change.

The exact live body was compared with v305 before drafting, then the full business/runtime suite and the creation-date equality check passed in rollback before apply and again after apply. This body-only migration used linked CLI Management HTTP and an INSERT into the existing migration history table in the same transaction; no history-table preparation DDL and no explicit schema reload. The existing global DDL watcher remains enabled. PostgREST was checked again after apply.

Do not reapply the earlier v305 over v306: its fail-closed checksum intentionally rejects this later body. Use the final live definition for future patches.

## V307: one organization root shared with Chat Web

Applied to the verified linked production project `cgjbsmqtfhqvttudyjzq` on 22/09/2026, history `20260922114251 / migration_v307_staff_department_organization_root`.

Exact signature: `public.aka_agent_staff_management(bigint,text,text,text,jsonb)`.

| Check | Captured source | Applied target |
|---|---|---|
| `md5(pg_get_functiondef(...))` | `45158ff8555a5a12501949371d08b658` | `182c5e461d34e1028e5c6e19e32abe00` |
| Owner / result / security / volatility | `postgres` / `jsonb` / DEFINER / volatile | unchanged |
| Config | `search_path=pg_catalog, public`, `lock_timeout=3s`, `statement_timeout=12s` | unchanged |
| EXECUTE ACL | postgres, anon, authenticated, service_role; no PUBLIC grant | unchanged |

Captured the complete live definition and attributes before drafting. The live body matched the latest repository v306 exactly; there was no additional DB-only patch in this RPC. `pg_depend` and stored-function source search found no database callers of this entry point; the typed Desktop repository is its client. The v306 shared creation/expiry timestamp, live credential/admin revalidation, tenant isolation, quota/phone/CAS guards, membership permissions, password handling and device request replay branches are preserved verbatim.

Only department saving changes. The RPC keeps its existing Desktop organization advisory lock and also takes Chat's `hashtextextended('aka-agent-chat:workspace-staff:' || organization_id, 0)` transaction lock before locking actor/group rows. This matches `ChatStaffManagementRepository.lockOrganization` and serializes initial root creation with Chat, without a new SQL connection or pool. `parentId=NULL` maps to the one organization root; a missing root is created with the organization name. Editing the organization root and saving against multiple ambiguous roots are rejected with specific errors. The response shape remains unchanged.

The original production apply also included a one-time repair of `org_group.id=962`, organization 1, name `test 1`: `parent_id NULL → 1` (akaBiz root), with `updated_at` refreshed so older edits became stale. It locked and validated the root/target and checked the captured full-row checksum `30ed421c8c3d2b9fc4953917388dd202` before repair. No staff or membership row was written. After apply the three original memberships had the exact same count and aggregate checksum; the hierarchy became akaBiz → CSKH 1, test 1.

At the user's request, the repository v307 file subsequently had this tenant-specific repair block removed. It now contains only the reusable RPC fix and its checksum/attribute preflight. The applied migration history retains the original SQL as a record of what ran; it was not rewritten. This source cleanup did not change production data or reapply the migration. A fresh read of the exact live function confirmed the retained body and attributes still match applied checksum `182c5e461d34e1028e5c6e19e32abe00`.

Validation:

- Pre-apply transaction installed the target, exercised the guarded repair, ran both v307 root smoke and the full v305 business/runtime smoke, captured target metadata and rolled back. All passed.
- After apply, exact signature, checksum, owner, result, security, volatility, config and ACL matched the captured expectations. Both SQL suites passed again inside rollback.
- Concurrent Management HTTP tests passed: two first Desktop departments create only one root; simultaneous Desktop RPC and a SQL simulation of Chat's existing lock/root-create path reuse the same root. This test exercises the database coordination contract, not the deployed Chat HTTP endpoint.
- Existing concurrent last-slot quota, normalized duplicate phone, stale staff edit, newer device-binding preservation/replay and live admin revocation checks passed. The isolated fixture was removed in the harness's guarded cleanup.
- PostgREST: legacy staff SELECT HTTP 200; tenantless group SELECT HTTP 200 with RLS filtering (no tenant data); management/access RPCs returned their expected credential errors, without signature/cache/ACL errors. Hierarchy and membership preservation were verified with linked SQL.
- Security advisor notices for anon/authenticated access to this credential-checked DEFINER RPC remain intentional and unchanged. No new ACL, table, constraint or trigger was added.
- Electron smoke passed with the real UI/preload/IPC/repository and mock DB: root badge/count/read-only behavior, unique root parent choice, preselected root on add staff, existing department retained on edit, and existing secret/retry/bulk/permission flows. Visual inspection passed for both themes, wide/narrow and the department/staff dialogs. Both TypeScript projects and the final Desktop production build passed.

Apply used linked Management HTTP and an INSERT into the existing migration history table in the same transaction. No history-table DDL or explicit PostgREST reload was added; global DDL watchers remain enabled. No Chat repository code, Server binary or installer deployment is required for this department change. Updated default selection/count/badge behavior is in the new Desktop renderer.

## V308: department managers, matching Chat's current rule

Applied to the verified linked project `cgjbsmqtfhqvttudyjzq` on 22/09/2026, history `20260922122633 / migration_v308_staff_department_managers`.

| Exact signature | Captured source MD5 | Applied target MD5 |
|---|---|---|
| `public.aka_agent_staff_management(bigint,text,text,text,jsonb)` | `182c5e461d34e1028e5c6e19e32abe00` | `fe73d8c5812d395aa2d3a1d448418ef0` |
| `public.aka_agent_staff_management_row(bigint)` | `9e5db7f61b5768852c8dece5f6e6aebe` | `e4d06c369e7c05e29c69ce089e549da6` |

Captured exact live definitions, owner, result type, security, volatility, config and ACL before editing. The management body matched v307; the row helper matched v305 apart from `pg_get_functiondef` header formatting. Dependency/source inspection found only the management entry point calling the row helper; no additional stored caller of the entry point. No newer live patch was replaced. Both functions keep their original `postgres` owner, `jsonb` return, DEFINER mode, volatility, search path and ACL; management also keeps its lock/statement timeouts. Preflight and postflight validate both definition checksum and attributes.

The existing relationship `org_group_staff.is_admin` stores department-manager status. `saveStaff` accepts optional `isDepartmentManager`: explicit true clears other managers in the selected department and grants this staff; false removes the role without removing the selected department. Old payloads omitting the key preserve the old same-relationship/new-relationship behavior. New output is additive JSON: each staff includes `managerGroupIds`, each department includes manager IDs/names independently of the current staff page/filter. No password or additional credential is returned. `org_staff.is_admin` is never changed by this option.

`saveStaff` now takes Chat's existing organization advisory lock, after the Desktop organization lock and before actor/staff rows, just as v307 already did for `saveGroup`. This coordinates manager replacement and the staff-create count/check/write with Chat. Existing tenant/credential/admin/expiry checks, root/phone/quota guards, staff revision, request replay, immutable username/expiry and device handling stay intact. Only function bodies and migration history changed; no new table, column, constraint, trigger, connection or pool was added, and no business rows were backfilled.

Validation completed:

- V308 manager smoke, v307 root smoke and full v305 business/runtime/legacy-contract smoke passed together inside rollback before apply and again after apply. Covers manager create/replace/transfer/demotion, root assignment, no organization-admin escalation, tenant separation, malformed flag rejection, metadata outside the filtered staff page, membership preservation, stale revision rejection, retry preserving a newer manager and omitted-key legacy behavior.
- Post-apply exact checksums, owner, result, security, volatility, config and ACL match the table above and captured source attributes. Apply used existing linked Management HTTP plus a history INSERT in the same transaction; no history-table preparation DDL or explicit schema reload. Global DDL watchers remain enabled.
- Concurrent HTTP harness passed two Desktop nominations and simultaneous Desktop/Chat-contract nominations: one manager remained. The Chat side reproduces the current repository's lock and membership write sequence; this is a database-contract test, not a deployed Chat HTTP test. Existing root creation, quota, normalized phone, CAS, device replay and queued admin-revocation checks also passed; the isolated fixture was removed by guarded cleanup.
- PostgREST: legacy staff columns and staff-expiry column probes HTTP 200; management rejected invalid credentials with expected `staff_access_denied`/HTTP 400; legacy device preparation returned `not_found`/HTTP 200. No signature, ACL or schema-cache errors.
- Both typechecks, Desktop/Server production builds and Staff Electron smoke passed. Actual UI/preload/IPC/repository with mock DB covered checked state on edit, transfer preserving the checkbox, replacement explanation, demotion, new manager creation, immutable retry payload, disabled checkbox while retrying, list display and existing permission/secret/bulk flows. Visual inspection completed for replacement, dark mode and narrow dialogs, using the coded Chat manager form with the existing akaAgent design styles.
- Security advisor notices for anon/authenticated access to the existing credential-checked management DEFINER RPC remain intentional; ACL is unchanged. Other pre-existing project findings were outside this patch.

The Desktop UI needs an updated build. Chat uses the shared membership data through its existing permission checks; no Chat code or deployment is part of this change. Department-manager status does not grant access to other staff's akaAgent accounts/campaigns or to the organization-admin menu.

## V310 — staff expiry is opt-in (23/09/2026)

Renamed from v312 to v310 at the user’s request. Only the repository labels and migration-history `name` changed; the original history version `20260923073740` and executed `statements` are retained. No schema/RPC was reapplied or reloaded for the rename.

Applied to `cgjbsmqtfhqvttudyjzq`; history `20260923073740 / migration_v310_staff_expiration_opt_in`. Adds `org_organization.use_staff_expiration boolean NOT NULL DEFAULT false`. All 936 existing organizations now use organization/product expiry by default; no staff dates were rewritten. `true` also checks individual staff expiry, with NULL falling back to products.

At v310, the old DB column was retained but deprecated and ignored by policy; v312 below removes it. Legacy RPC JSON `useOrganizationExpiration` is always derived as `NOT useStaffExpiration`. Desktop/WebApp normalize either response during rollout. There is no dual-write trigger, new connection source or polling.

Exact definitions and owner/security/volatility/config/ACL were captured from live before editing. Time/access bodies match v305 (header formatting differs); row/management match v308 exactly. Preserved v306 single timestamp, v307 organization root, v308 manager replacement/shared Chat lock, quota, CAS, request replay, device reset and all tenant checks. All 13 dependent auth/runtime RPC definitions and ACLs remain unchanged, including v309 session checks and held-unit cleanup paths.

| Exact signature | Source MD5 | Applied MD5 |
|---|---|---|
| `public.aka_agent_staff_time_allowed(bigint)` | `878cba86a2426dae09bc9f69a163680e` | `a294e60011edd8d42e90ac2f74ce744c` |
| `public.aka_agent_staff_access(bigint,text,text)` | `632942ca116ca830d4a7f5fff72e871f` | `ca59bfbfa79c7e40ec50788e77b9d022` |
| `public.aka_agent_staff_management_row(bigint)` | `e4d06c369e7c05e29c69ce089e549da6` | `4964edb52ffc866f610036212d14fb08` |
| `public.aka_agent_staff_management(bigint,text,text,text,jsonb)` | `fe73d8c5812d395aa2d3a1d448418ef0` | `689c389e3380c75497c720e7e6c5dafb` |

Validation:

- Fail-closed checksum/attribute preflight; target reapply preserves an organization already opted in. New column metadata verified as boolean, NOT NULL, default false.
- Before apply: migration and v310/v309/v308/v305 synthetic business/auth/runtime smoke passed inside rollback. After apply: the same four smoke suites passed again inside rollback. Coverage includes both modes, NULL fallback, product expiry, Vietnam day boundary, actual anon/service-role calls, manager/CAS/device replay and settling a held runtime unit after expiry.
- Post-apply definitions match the four target checksums; owner, security, volatility, config and ACL are unchanged. Chat fixture matches the applied helper exactly; Chat role retains EXECUTE.
- PostgREST: old/new column SELECT and boolean helper HTTP 200; invalid credentials yield the original access/management errors (HTTP 400); legacy device RPC HTTP 200. API metadata reload is required for the new column.
- Desktop: both typechecks, desktop/server builds and Electron staff, session-expiry, auth (112 checks), device smoke passed.
- WebApp: typecheck, all 1,345 unit/integration tests and build passed. Chat API: typecheck, all 1,273 tests and build passed. No Chat production source or deployment is needed: existing callers use the shared DB helper.
- WebApp Playwright staff flow passed on Desktop Chromium, Android Chromium and iPhone WebKit. Used an isolated local server because the existing port 4173 server had development mocks enabled and bypassed HTTP fixtures. Existing server was left running unchanged.

## V312 — drop unused organization-expiry column (23/09/2026)

Applied `migration_v312_drop_legacy_organization_expiration` to `cgjbsmqtfhqvttudyjzq`, history `20260923075817`. Removed only `org_organization.use_organization_expiration` with RESTRICT. The canonical `use_staff_expiration` default remains false; no staff dates or policy values were updated.

Fresh catalog/body audit found only the column's own default dependency, with no function/view/materialized-view/policy/cron references. Preflight checks the four exact live signatures and attributes from the v310 table above; their source and post-apply MD5s are identical to that table's Applied MD5 column. Owner, security, volatility, config and ACL are unchanged. No RPC definition was replaced.

The drop and a second idempotent execution passed in rollback, followed by v310/v309/v308/v305 business/auth/runtime smoke. The same smoke suites passed after apply, including valid web/native authentication and held-unit settlement after expiry. Existing v310 smoke no longer writes the removed column. PostgREST exposes the remaining flag, rejects an explicit removed-column SELECT as expected, and keeps the existing helper/auth/management RPC responses. WebApp health remains HTTP 200. Schema refresh was requested because a real API column was removed; no app redeploy, pool or connection-budget change was required.
