# Move table logs to public — V384

Applied to **akachat / cgjbsmqtfhqvttudyjzq** at **09:58 Vietnam time, 14/10/2026**. History: `20261014025805 / migration_v384_auto_table_logs_public`. Do not reapply V382, V383 or V384.

The current table is **`public.auto_table_logs`**. `ALTER TABLE ... SET SCHEMA` moves the existing table, owned identity sequence and indexes; there is no row copy, rewrite, deletion or retention change. All historical V382/V383 rows remain. The move does not reduce existing disk usage.

The seven columns, constraints and record-history index are unchanged. [V383 configuration filtering](AUTO_TABLE_CONFIG_LOGS_V383.md) remains active: INSERT stores configuration; UPDATE logs only a configuration difference. Campaign `log`, timestamps and excluded runtime state still do not produce logs or appear in new snapshots. `record_pk` remains JSONB. `table_name` still contains only the source name, without a schema prefix.

This is a DB-only change. No application/runtime edits, build, release, additional SQL connections/pools, worker, cron or polling.

## Access and query

Being in `public` makes the table easier to find in the Supabase table list; it does not grant application access. Owner remains `postgres`, RLS is enabled with no client policies, and table/sequence privileges remain owner-only. `anon`, `authenticated`, `service_role` and `aka_agent_chat_api` have no direct table/sequence access or function EXECUTE. The installed trigger still logs their source writes through SECURITY DEFINER.

Use a database administrator in Supabase SQL Editor. Replace `123` with the campaign ID:

```sql
SELECT id, created_at, operation, old_data, new_data
FROM public.auto_table_logs
WHERE table_name = 'auto_campaigns'
  AND record_pk = jsonb_build_object('id', 123::bigint)
ORDER BY created_at DESC, id DESC
LIMIT 100;
```

For an error policy, use `table_name = 'auto_error'` and its ID. Old manual SQL that names `private.auto_table_logs` must use the new qualified name.

## Migration and preserved behavior

Canonical SQL: [migration_v384_auto_table_logs_public.sql](../migrations/migration_v384_auto_table_logs_public.sql). Exact live function captured before drafting: **`private.aka_agent_capture_table_change()`**.

| Definition checksum | MD5 |
| --- | --- |
| Source, V383 | `1cd8e9bc61b39e7ac7f8e6020ba3e953` |
| Target, V384 | `96858661d7d592a9cdc22c67fd853c62` |

Only the INSERT destination and an explicit self-capture rejection change in the captured function. The self-capture guard keeps the log table excluded now that it also belongs to `public`. The function stays in `private`, owned by `postgres`, SECURITY DEFINER, VOLATILE, with `search_path=pg_catalog` and ACL `{postgres=X/postgres}`. Configuration projections, runtime-key filtering, NULL normalization, PK behavior and sanitized best-effort exception handling are unchanged.

Both capture trigger registrations and all seven existing business triggers/functions are unchanged, including their definitions, owner, security attributes and grants. Preflight pins live source schemas/triggers/functions, log catalog and DDL watchers by checksum and requires the destination names/version to be absent. Source writer locks are acquired before the log-table lock, with `lock_timeout=2s`; migration `statement_timeout=30s`.

Existing `pgrst_ddl_watch` handles the required schema reload. No extra NOTIFY, migration-history setup DDL, bulk push, or duplicate timestamp migration was used.

## Verification

Runner: [auto-table-logs-public-v384.cjs](../scripts/auto-table-logs-public-v384.cjs). Smoke: [SQL fixtures](../migrations/tests/migration_v384_auto_table_logs_public_smoke.sql). Evidence: [audit directory](audits/auto-table-logs-v384/).

```sh
node scripts/auto-table-logs-public-v384.cjs local
node scripts/auto-table-logs-public-v384.cjs rehearse
# Initial rollout only; already applied, do not repeat:
node scripts/auto-table-logs-public-v384.cjs apply
node scripts/auto-table-logs-public-v384.cjs verify
node scripts/auto-table-logs-public-v384.cjs post-smoke
node scripts/auto-table-logs-public-v384.cjs api
```

Local PostgreSQL 16.15 tests exercise the complete migration/preflight with local catalog checksums, cached source statements before/after the move in the same backend, retained history, self-recursion rejection, reverse migration and continued logging. Behavioral smoke covers all 22 campaign configuration fields, runtime-only and no-op updates, 13 excluded settings keys, a 256-KiB source log, NULL/JSONB, PK/composite-key changes, bulk/upsert, source/log rollback, retained logs after DELETE, genuine logging errors without aborting source writes, application SQL roles and existing claim/completion BEFORE behavior.

Linked rehearsal and post-apply smoke use rollback-only fixture tables with explicit IDs; no customer campaigns or policies are written. Fixture log sequence gaps are expected. An initial rehearsal caught a PL/pgSQL variable/SQL-alias name collision in preflight and rolled back. It was corrected and the complete local migration plus linked rehearsal passed before apply.

| Check | Result |
| --- | --- |
| Final pre-apply rollback rehearsal | Passed, 176.7 ms |
| Committed migration transaction | Passed, 50.477 ms |
| Post-apply rollback smoke | Passed, 188.404 ms |
| `auto_campaigns` / `auto_error` REST reads, limit 0 | HTTP 200 / 200 |
| `auto_table_logs` REST read as anon, limit 0 | HTTP 401, SQLSTATE `42501` (permission denied) |
| Table OID / heap file before and after | `39736837` / `39736837`, unchanged |
| TOAST OID, both index OIDs/files, identity sequence OID | Unchanged |
| Columns, constraints, RLS, policies, ownership and ACLs | Unchanged |
| Capture attributes and business trigger/function definitions | Match expected live snapshot |
| Migration history | Exactly one V384 entry, exact canonical SQL |

Security advisor finds only the expected INFO for this table: [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). This is intentional admin-only access. Unrelated advisory findings were not changed. PostgreSQL reference: [ALTER TABLE / SET SCHEMA](https://www.postgresql.org/docs/current/sql-altertable.html).

## Rollback

The checksum-guarded [rollback.sql](audits/auto-table-logs-v384/rollback.sql) moves the same table/sequence/indexes back to `private` and restores the captured V383 function. It preserves all rows and configuration-only logging; it does not restore high-volume V382 capture, detach triggers or delete migration history. Verified in isolated PostgreSQL, not applied to production. Check current schema/checksums before any operational rollback; do not relax the guards after a mismatch.

Receipts are timestamped and immutable. Apply requires matching local and live rehearsal evidence, writes a single-attempt intent before dispatch, and refuses blind retries after an unknown outcome.

## V385 metadata correction

Applied at **10:21 Vietnam time, 14/10/2026**, history `20261014032129 / migration_v385_auto_table_log_comments`. Do not reapply. [V385 SQL](../migrations/migration_v385_auto_table_log_comments.sql) changes only the table and capture-function comments, which previously still described V382 full-row snapshots and PK-only trigger arguments.

Current registrations pass the configuration profile before PK column names: `auto_campaigns` uses `('campaign_config_v1', 'id')`; `auto_error` uses `('error_config_v1', 'id')`. INSERT stores a configuration baseline; UPDATE stores only normalized configuration differences. Another source needs a supported configuration profile as well as a trigger. Old V382 full-row history is retained.

The exact live signature **`private.aka_agent_capture_table_change()`** was captured before the migration. Its source and target definition MD5 are both **`96858661d7d592a9cdc22c67fd853c62`**. Function body, owner, security attributes, ACLs, both source registrations and the log catalog are unchanged. Historical V382–V384 SQL files were not edited.

Preflight rejects catalog, function, comment or DDL-watcher drift. The linked rehearsal applied V385, checked its [SQL smoke](../migrations/tests/migration_v385_auto_table_log_comments_smoke.sql), reversed both comments and verified exact restoration before rolling back (28.325 ms). The committed migration and smoke passed in 23.809 ms. Post-apply verification matched the expected comments and otherwise identical snapshot, with exactly one history entry containing the canonical SQL. No customer rows were written by these checks.

Existing DDL watchers handle the COMMENT metadata; no extra NOTIFY or history-preparation DDL was added. [Post-apply API checks](audits/auto-table-logs-v384/api-2026-10-14T03-21-52-469Z.json) returned HTTP 200 for both source tables and HTTP 401 / SQLSTATE `42501` for anonymous log access. [V385 evidence](audits/auto-table-logs-v385/) includes the fresh snapshot, checksums, rehearsal and apply receipts. Its guarded [rollback](audits/auto-table-logs-v385/rollback.sql) restores only the two previous comments and keeps all data and function behavior.
