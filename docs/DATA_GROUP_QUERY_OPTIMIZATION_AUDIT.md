# v290 — Data Group query optimization audit

Date: 2026-09-20. Target: **cgjbsmqtfhqvttudyjzq (akachat)**. **Applied** as `20260920035924` / `v290_data_group_query_optimization`.

Migration: [v290](../migrations/migration_v290_data_group_query_optimization.sql). Regression: [SQL smoke](../migrations/tests/migration_v290_data_group_query_optimization_smoke.sql), [renderer smoke](../scripts/run-data-group-zalo-ui-smoke.cjs), [tag repository smoke](../scripts/run-contact-tag-sync-smoke.cjs).

## Scope and resulting behavior

- Removed the 30-second UI timer from `DataGroupDynamicFilterPanel`. Configuration loads on opening/changing the selected group, after saving, or through **Làm mới**. Manual refresh is disabled when there are unsaved changes. No replacement timer, connection pool, realtime subscription or process RPC was added.
- Search and friendship filtering use set-based joins to the same tenant/account-scoped Chat and local profiles. They no longer construct the full JSON facts projection or aggregate either tag family for each candidate contact. The canonical name/display-name/relationship fallback order is unchanged.
- Filtering and exact total counting precede pagination. Primary-origin and provenance display work now runs on the selected page. The v2 page enriches names/status directly, without the previous three scalar facts calls per row, and explicitly retains newest-membership ordering.
- Tag mutations resolve the canonical conversation directly, defer per-tag event work inside an exception-safe transaction-local batch flag, then enqueue the affected user contact and mirror tags once. An event is still queued when the canonical tag changes but the local array was already equal. Direct Chat writes enqueue/materialize before one mirror; legacy Desktop array writes retain their bridge. Tag projection reads only the relevant akaBiz memberships, keeping staff/organization/account scope and skipping deleted contacts.
- No historical backfill. The database worker remains active on its existing `30 seconds` schedule with `aka_agent_run_data_group_dynamic_filter_worker(5, 100)`. Its body, ownership/advisory guards, bounded processing, forward-only cutoff and tombstone behavior are unchanged. The previously accepted concurrent-write deadlock limitation was not addressed.

## Live source and preservation

Captured 33 exact live signatures with `pg_get_functiondef()`, checksum, owner, ACL, security mode, volatility and config during this implementation. Compared with v206/v286/v289 and the earlier performance review. Six existing bodies change; 27 captured bodies remain identical. The migration checks 12 captured checksums fail-closed: all six modified bodies plus the canonical facts, materialization, contact enqueue, auth and worker dependencies.

No signatures or return types changed. Owner, SECURITY DEFINER/STABLE attributes where present, fixed search_path, every existing function-local timeout and ACL are unchanged. The existing bulk Data API wrappers retain `statement_timeout=60s`. Both private tag helpers remain inaccessible to client roles.

| Exact public signature | Source checksum | Applied checksum |
|---|---|---|
| `public.aka_agent_dynamic_filter_chat_event()` | `ea43ac7d147b5bc86a38f3936bcb9cee` | `5aba2699c1f8a5b3c5f9fa5a380f8e8b` |
| `public.aka_agent_list_data_group_members_v2(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text)` | `c5cf3b29b5721aff8a0b605b9d2f57cc` | `221ed55d3a0acbfb6a4f1c1491f0915d` |
| `public.aka_agent_list_data_group_members_v205_internal(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],integer,integer)` | `778357ef05c9261d77db7faddf241046` | `13949f7f28813309f55be5c0f5b51790` |
| `public.aka_agent_mutate_contact_tags(bigint,bigint,bigint[],bigint[],text,text,text)` | `decf57350ad6e47478d342745be552d4` | `2e2d262fa88fd2be5051c2e3aac35f9c` |
| `public.aka_agent_refresh_contact_chat_tags(bigint)` | `b581724c1c84c68cf997043039555611` | `4d2abc80e1ed65661ede653c53a56e62` |
| `public.aka_agent_sync_contact_chat_tag_delta()` | `10aa869d5625e0afac011344a9e92c52` | `f8947adce5649dc487bf343ca5414f23` |

## Verification

- Migration plus full SQL smoke passed in ROLLBACK before deployment; post-apply smoke passed again and rolled back. Coverage includes all four relationship states, unknown/removed normalization, local legacy fallback, search-before-pagination, exact page totals, user/group tag add/remove, legacy array bridge, canonical events with an already-equal local array, tenant/auth/account scope, stale-filter disable, preserved contact deletion and an actual bounded worker evaluation.
- Complete pre/post row payload parity passed in one REPEATABLE READ snapshot for a Zalo page, a friendship-filtered page and a Facebook page, including provenance and total_count.
- PostgreSQL local tracking with captured function definitions: adding one tag for one linked live contact reduced full facts calls from **4 to 0** and refresh calls from **3 to 1**. A forced constraint failure verified that the batch flag is restored and failed tag writes roll back.
- Renderer smoke advanced the browser clock 90 seconds while idle and observed **no additional get-filter calls**; manual refresh performs one call and cannot discard unsaved rules. Existing form/account/name/status/save checks passed.
- Both `tsconfig.node.json` and `tsconfig.web.json` typechecks passed. Production `npm run build` passed; existing bundle-size/mixed-import warnings remain. `git diff --check` and tag repository smoke passed.

### Read-only performance measurements

Same existing group with **9,515 memberships**, page size **50**. The post-apply queries used `EXPLAIN (ANALYZE, BUFFERS)` in a READ ONLY transaction with a five-second statement budget. These are individual measurements, not a simultaneous-load benchmark; cache state and current database load affect exact latency.

| RPC operation | Before optimization | After apply |
|---|---:|---:|
| First page, no filter | 2,138.571 ms | 149.904 ms |
| Search with no match | >5,000 ms, capped by review timeout | 260.722 ms |
| Friendship filter | 2,441.796 ms | 181.613 ms |

The earlier directly-extracted SELECT comparison was 70.654 ms before v286 versus 2,301.528 ms after v286. That query-only baseline is distinct from the full RPC timings above.

## Deployment

Applied only v290 and its existing-table migration-history INSERT in one transaction. No migration-history bootstrap DDL, new index/table/function signature, or explicit PostgREST reload was added. After deployment, all **33 captured definitions and attributes** matched the rehearsed targets, the migration history row was present, and the cron job was unchanged. All regression fixture writes were rolled back. No installer was packaged or released.

Audit captures and EXPLAIN output from this task are under `/tmp/aka-data-group-opt-20260920`; pre-optimization measurements are under `/tmp/aka-data-group-perf-20260920`.
