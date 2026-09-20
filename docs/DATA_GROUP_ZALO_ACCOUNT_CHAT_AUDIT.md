# v286 Data Group Zalo account / akaChat facts audit

Audit date: 2026-09-20. Verified linked production: **cgjbsmqtfhqvttudyjzq (akachat)**. **Applied** as `20260920013944` / `v286_data_group_zalo_account_chat_facts`.

Implementation: [migration v286](../migrations/migration_v286_data_group_zalo_account_chat_facts.sql), [database smoke](../migrations/tests/migration_v286_data_group_zalo_account_chat_facts_smoke.sql), [isolated UI smoke](../scripts/run-data-group-zalo-ui-smoke.cjs).

Follow-up: [v289 tag consistency and deletion behavior](DATA_GROUP_TAG_CONSISTENCY_AUDIT.md) fixes shared tag writes and disabling stale filters, and records the agreed rule that deleted account contacts must stay deleted. Its checksums supersede the affected v286 definitions below.

## Behavior

Groups with main data type `zalo_person` or `zalo_group` may bind one Zalo account. NULL keeps shared behavior. Binding is distinct from legacy `account_id`; it applies to uploads, scans, moves, automation output and dynamic membership. Binding a group with mismatched/accountless contacts or current origins fails with a count; data is not reassigned or deleted. Member/origin guards also fence direct writes and reactivation. Dataset-auto groups cannot be rebound. Deleted or unavailable accounts never widen the filter.

Names and friendship status use the scoped akaChat account-user projection, falling back to local Zalo data when the Chat entity does not exist. Native Zalo tags use account-conversation membership; internal akaBiz tags use tenant conversation membership. Existing Chat membership is authoritative even when empty, preventing stale local tags from reappearing. The UI exposes four friendship states and separate original/display names. Zalo tag/group option keys are account-scoped; legacy raw rule values remain readable.

## Live-source preservation

Exact definitions and attributes were captured from linked production during this task. Repository references were checked through v198 (ingest row cap), v206 (semantic data types), v240 (group information), v250 (dynamic rules), v252 (forward-only cutoffs) and v253 (database worker). Existing functions were edited from those live captures, not reconstructed from historical bodies. The four source functions used to derive the new create/update/list wrappers remain unchanged.

The v198 ingest row limit, replay/hash conflict rules, tenant ownership, semantic validation, provenance, soft-delete/reactivation behavior and current authentication wrappers remain. Forward-only filtering retains the v252 effective-from cutoff and v253 worker/advisory-lock, queue stamping, batching and leave-wins behavior. Saving or rebinding does not scan historical contacts; future Chat friendship/tag changes enqueue only affected contacts for enabled filters. The existing database worker remains the only consumer; no Desktop timer was introduced.

Old RPC signatures and return types remain intact. New credential wrappers use `_v2`; all other new functions revoke PUBLIC/anon/authenticated/service_role EXECUTE. Existing owner, security mode, volatility, config and ACL match the captured source. New functions belong to postgres and use SECURITY DEFINER with fixed search_path. Only the four new credential wrappers grant tenant/service EXECUTE, and they retain the automation identity check.

## Exact signatures and checksums

Checksums below are `md5(pg_get_functiondef(oid))`. Every captured signature is checked before DDL; every new signature must be absent. Unexpected drift fails the entire transaction. Target values were captured after the full migration and smoke inside a transaction ending ROLLBACK.

| Exact public signature | Live source | Validated target |
| --- | --- | --- |
| `public.aka_agent_create_data_group(bigint,bigint,text,text,text,bigint)` | `591c4a312eafb4968c34e47cd2bbd0e5` | `591c4a312eafb4968c34e47cd2bbd0e5` |
| `public.aka_agent_create_data_group_v2(bigint,bigint,text,text,text,bigint,bigint,text,text)` | Absent | `a26d37823eb0210088d7e0a72dd7c841` |
| `public.aka_agent_create_data_group_v2_internal(bigint,bigint,text,text,text,bigint,bigint)` | Absent | `cc9ca5418b49f70d7c7df1e413cd1029` |
| `public.aka_agent_data_group_account_available(bigint,bigint,bigint)` | Absent | `a1ab32210c3f3cc16b814898fb26315c` |
| `public.aka_agent_data_group_dynamic_rule_matches(bigint,bigint)` | `12a1ccc256fd0fdb79d326c908f524a6` | `99a29f86609900acce374b2d6d4fa967` |
| `public.aka_agent_data_group_dynamic_values_match(bigint,text,text[])` | `4b479af42dc79aaee0308da2bb36276f` | `86df0d05381926898d8b60b94d190d10` |
| `public.aka_agent_data_group_validate_bound_rule(bigint,bigint,bigint,jsonb)` | Absent | `469684f0be829225f8e4cf6d89e27b4a` |
| `public.aka_agent_data_group_zalo_facts(bigint)` | Absent | `9cac9151db1cd2e208f5f0f160e7100e` |
| `public.aka_agent_duplicate_data_group(bigint,bigint,bigint,text,text)` | `e8f05ce4f5fb5b77dfed72e27a8a0f37` | `9d84dcd9325bc6ef4c1695097db55e28` |
| `public.aka_agent_dynamic_filter_chat_event()` | Absent | `edbd8f005e263ac788b2fabef14ba987` |
| `public.aka_agent_dynamic_filter_sync_chat_contact()` | `56b901cd4d2751f250ff3d0e7ff85cd3` | `39e1371dd3430e3b76d4f4a0a90d5a2c` |
| `public.aka_agent_enqueue_data_group_chat_user(bigint,text,bigint)` | Absent | `3dface1e4b48d8c92a5100dadaaf4ebb` |
| `public.aka_agent_get_data_group_dynamic_filter(bigint,bigint,bigint,text,text)` | `c891b833f9d1624ef60fbd119cb4842c` | `8b0dbad6f6db3feca29e315518065478` |
| `public.aka_agent_guard_bound_data_group_source()` | Absent | `4197b8b0c30c934043b491f5da81c51d` |
| `public.aka_agent_guard_data_group_bound_account()` | Absent | `fac56e4b36c7707d6cabac4065c15715` |
| `public.aka_agent_guard_data_group_bound_member()` | Absent | `2748ad9dff6273fd7e4b9d91fee74986` |
| `public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)` | `0d5f27ba28557eecc1c75d2adec394a5` | `544d36b2c232653ce3168cd18ae25266` |
| `public.aka_agent_list_data_group_members(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)` | `4564edccd0be59ea0f9563367859f3d3` | `4564edccd0be59ea0f9563367859f3d3` |
| `public.aka_agent_list_data_group_members_v2(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)` | Absent | `c5cf3b29b5721aff8a0b605b9d2f57cc` |
| `public.aka_agent_list_data_group_members_v205_internal(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)` | `758ca8404d7913b6cc347d7fb5e2897d` | `778357ef05c9261d77db7faddf241046` |
| `public.aka_agent_list_data_groups(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)` | `d4d42baec8810c79db4090b982a100e9` | `d4d42baec8810c79db4090b982a100e9` |
| `public.aka_agent_list_data_groups_v2(bigint,bigint,text,text,bigint,bigint[],integer,integer,text,text,boolean)` | Absent | `1c392cbde23276cbeb867b3678d5eaf9` |
| `public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)` | `e384f8113c0166531de3eacd724d7241` | `d40d1a23943ae1a4a66339504382526f` |
| `public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)` | `5c8507459cb2dc0e39b2b8906f6047ee` | `34fd38386ec751146db1e78b06f9195b` |
| `public.aka_agent_update_data_group(bigint,bigint,bigint,text,text,integer,bigint,boolean)` | `b077c1ae61c53a5115632ad64d3a2d92` | `b077c1ae61c53a5115632ad64d3a2d92` |
| `public.aka_agent_update_data_group_v2(bigint,bigint,bigint,text,text,integer,bigint,boolean,bigint,boolean,text,text)` | Absent | `d3d0f58f5212b696c908b9e665d4854e` |

## Validation

- Full migration plus synthetic SQL smoke passed on the verified linked database inside ROLLBACK, then target checksums and all source attributes were captured and compared.
- SQL smoke covers create/replay/conflict; optional binding; upload default/source provenance; cross-account rejection; bind count; semantic type; duplicate; contact identity; move rollback; reactivation; scoped tag/rule validation; original/display name and friendship filtering before pagination; four Chat states and legacy aliases; both tag systems and authoritative removals; no historical enqueue on save; future friendship enqueue; negative-rule account fence; catalog scope; unbind; private helper ACL and unauthenticated RPC rejection.
- Synthetic rows roll back. No real Zalo command, contact action or external API is invoked. The fixture uses existing eligible account identities only as foreign-key parents.
- Both TypeScript projects passed; production build passed. The isolated browser smoke renders the real component with mocked IPC and checks names/status, optional account visibility/reset, Zalo-only choices, create payload, inherited account scope, four status options and saved rules. No browser page errors; screenshots visually checked.
- Multi-session race timing and production-scale latency were not benchmarked. Existing lock order is retained and binding writes acquire the dynamic-worker advisory lock before the group row; membership/provenance inserts acquire a share lock to fence concurrent rebinding.

## Apply and API verification

- Applied only v286 with its history row in one transaction via the verified linked database. No migration-history bootstrap DDL or unrelated migration push was used. The new column and RPC signatures required one explicit PostgREST reload notification.
- All **26** captured/new signatures match the validated target checksum, owner, security mode, volatility, config and ACL after apply.
- Post-apply SQL smoke passed and rolled back all fixtures; follow-up queries confirmed no synthetic groups, contacts or Chat users remain. An initial concurrent CLI invocation failed temporary-role authentication before executing SQL; running the smoke sequentially succeeded. No SQL retry/reapply was needed.
- REST table query selecting `bound_zalo_account_id` returned **200**. All four new credential RPC routes were discoverable and rejected missing credentials with **400 / P0001 / automation_auth_required**, confirming both schema cache readiness and the auth guard. No additional reload was issued.
- Both final TypeScript checks passed. Production build and isolated UI smoke passed; this task did not package or distribute a new desktop installer.
