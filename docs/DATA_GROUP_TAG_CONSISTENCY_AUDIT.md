# v289 Data Group tag consistency audit

Audit date: 2026-09-20. Target: **cgjbsmqtfhqvttudyjzq (akachat)**. **Applied** as `20260920022631` / `v289_data_group_chat_tag_consistency`.

Implementation: [v289](../migrations/migration_v289_data_group_chat_tag_consistency.sql), [SQL smoke](../migrations/tests/migration_v289_data_group_chat_tag_consistency_smoke.sql), [repository smoke](../scripts/run-contact-tag-sync-smoke.cjs).

## Agreed behavior and changes

- Tag akaBiz uses canonical akaChat membership for linked conversations. Explicit Desktop tag changes write through to Chat; Chat changes mirror back to the existing live Desktop contact even with that group's dynamic filter off. Unlinked contacts retain local storage. Both user and group conversations are scoped by account, staff and organization. Native Zalo tags retain their existing source.
- Current Desktop code uses authenticated delta RPC calls, at most 100 contacts per batch, rather than reading and overwriting an entire tag array. Add/remove preserve unrelated current tags, including catalog deletion cleanup. Missing/deleted/foreign tags are not added, and account-scoped tags cannot cross accounts. Server service-role callers retain their credential-free path; tenant calls retain automation authentication. Only definite transaction rollbacks (40P01/40001) are retried, at most twice.
- Existing clients' local array writes are bridged by a scoped delta trigger. Projection/writeback contexts are restored on success and exception to prevent recursion. The projection locks the contact before reading canonical membership, avoiding an old projection overwriting a commit made while it waited. No historical membership sweep/backfill runs at deployment.
- Disabled filters may retain outdated account/tag values. Validation still rejects those values when enabling again; rule shape, authentication, tenant checks, worker lock order and forward-only cutoff remain.
- **Explicitly deleted account contacts stay deleted.** Friendship events and system-tag events already preserved the tombstone; native Zalo-tag conflict updates now preserve it too. Projections skip deleted contacts, the mutation RPC skips them, and the worker continues to exclude them. This is separate from removal of a group membership.

## Live definitions and preservation

Captured all seven exact live dependencies in this task using pg_get_functiondef, owner, ACL, security mode, volatility, config and checksum. Compared the modified functions against v250/v252/v286 and retained live v286 behavior: account binding, akaChat facts, enabled-filter gating, forward-only effective dates, rule normalization, advisory locks and tenant authentication. Only three existing bodies change. Four dependency bodies remain byte-identical.

Existing owner/security/volatility/ACL are unchanged. The save-filter RPC additionally receives the required function-local `statement_timeout=60s`; other captured configs are unchanged. The three new functions are SECURITY DEFINER with fixed search_path, owned by postgres. Only the credential mutation RPC exposes EXECUTE to anon/authenticated/service_role; both trigger/projection helpers are private. Every old signature has a fail-closed source checksum preflight; every new signature must be absent.

| Exact public signature | Source checksum | Validated target checksum |
| --- | --- | --- |
| `public.aka_agent_data_group_account_available(bigint,bigint,bigint)` | `a1ab32210c3f3cc16b814898fb26315c` | `a1ab32210c3f3cc16b814898fb26315c` |
| `public.aka_agent_data_group_zalo_facts(bigint)` | `9cac9151db1cd2e208f5f0f160e7100e` | `9cac9151db1cd2e208f5f0f160e7100e` |
| `public.aka_agent_dynamic_filter_chat_event()` | `edbd8f005e263ac788b2fabef14ba987` | `ea43ac7d147b5bc86a38f3936bcb9cee` |
| `public.aka_agent_dynamic_filter_sync_chat_contact()` | `39e1371dd3430e3b76d4f4a0a90d5a2c` | `26f962a5d4ae9542dc8198615e2032f5` |
| `public.aka_agent_enqueue_data_group_chat_user(bigint,text,bigint)` | `3dface1e4b48d8c92a5100dadaaf4ebb` | `3dface1e4b48d8c92a5100dadaaf4ebb` |
| `public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)` | Absent | `decf57350ad6e47478d342745be552d4` |
| `public.aka_agent_refresh_contact_chat_tags(bigint)` | Absent | `b581724c1c84c68cf997043039555611` |
| `public.aka_agent_save_data_group_dynamic_filter(bigint,bigint,bigint,boolean,jsonb,text,text)` | `34fd38386ec751146db1e78b06f9195b` | `24207c47df7ad9a23ecc3a5eb3d574e4` |
| `public.aka_agent_sync_contact_chat_tag_delta()` | Absent | `10aa869d5625e0afac011344a9e92c52` |
| `public.auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` | `5a9a503db72b965eb644739f5f60905d` |

## Verification

- Full migration and SQL regression smoke passed inside ROLLBACK on the linked target. It includes v286 binding, ingestion, tenant, semantic, names/status, provenance and rule-account guards, plus Desktop-to-Chat add/remove, Chat-to-Desktop mirror, atomic RPC add/remove/replay, legacy scope checks, unlinked fallback, disabled invalid rules and rejected re-enable, recursion context restoration, private helper ACL and missing-credential rejection.
- A real worker call in the rollback fixture verified that friendship, native-tag and system-tag events cannot revive or re-enter a deleted contact, and the queued event is consumed.
- Isolated repository smoke passed: 205-contact batching, atomic delta parameters, Server null credentials, bounded rolled-back-transaction retry, errors without unsafe retries, and catalog deletion using delta removal. No external Zalo action is called.
- Both TypeScript projects and the production build passed. Build warnings about the existing mixed DataScanModal import and bundle size are unchanged.
- Multi-session database stress timing was not benchmarked. Concurrent conflicting transactions may be rejected by PostgreSQL; current Desktop mutations retry only explicit full-transaction rollback codes, not ambiguous network failures.

## Deployment

- Applied only v289 plus history `20260920022631` in one transaction to the verified linked project. No unrelated migrations or migration-history bootstrap DDL were applied.
- All ten new/captured signatures match validated target checksums, owner, security, volatility, config and ACL after apply; the history row is present.
- Full post-apply SQL smoke passed and rolled back; no synthetic group/contact/Chat-user rows remain.
- REST table health returned 200; the new `aka_agent_mutate_contact_tags` route is discoverable and returned the expected 400/P0001/automation_auth_required for missing credentials. No additional schema reload was necessary.
- Source and database are updated. No installer was packaged or distributed in this task.

## Follow-up

[v290 performance audit](DATA_GROUP_QUERY_OPTIMIZATION_AUDIT.md) records removal of UI polling, set-based profile reads, deferred tag projection and post-apply checks.
