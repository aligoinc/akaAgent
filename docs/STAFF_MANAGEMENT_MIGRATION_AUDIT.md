# Audit migration Quản lý nhân viên v305–v306

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
