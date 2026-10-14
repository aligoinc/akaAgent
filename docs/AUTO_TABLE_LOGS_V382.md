# Table change logs — V382

**Current location:** V384 moved the same table and retained history to `public.auto_table_logs`. See [V384 audit/query/rollback](AUTO_TABLE_LOGS_PUBLIC_V384.md); definitions of `private.auto_table_logs` below describe the initial rollout.

**Historical contract:** V383 superseded future capture on 14/10/2026 at 09:39 Vietnam time: only configuration changes/snapshots are now recorded. See [V383](AUTO_TABLE_CONFIG_LOGS_V383.md). Existing V382 history remains. Do not run the V382 rehearsal/post-smoke against the newer function contract.

DB-only change for linked production **akachat / cgjbsmqtfhqvttudyjzq**. No application TypeScript, Desktop/Server runtime, IPC, UI, dependency, build or release changes. The canonical migration is [migration_v382_auto_table_logs.sql](../migrations/migration_v382_auto_table_logs.sql).

**Applied and verified on 14/10/2026 at 09:20 Vietnam time**, history `20261014022053 / migration_v382_auto_table_logs`. Do not reapply. Migration transaction duration was approximately 30 ms; linked pre-apply rollback smoke 107 ms and post-apply rollback smoke 74 ms. The two existing public API reads returned HTTP 200; requesting the private log through the anon Data API returned HTTP 406 (schema not exposed).

## Data contract

`private.auto_table_logs` is an ordinary logged table with seven columns:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Log ID; sequence gaps are normal after rolled-back attempts. |
| `created_at` | `timestamptz NOT NULL DEFAULT clock_timestamp()` | Capture time, not commit order. |
| `table_name` | `text NOT NULL` | Unqualified source name, currently `auto_campaigns` or `auto_error`. |
| `record_pk` | `jsonb NOT NULL` | New row's primary-key object, currently `{"id":123}`. |
| `operation` | `text NOT NULL` | `INSERT` or `UPDATE`. |
| `old_data` | `jsonb` | Full previous row on UPDATE; SQL NULL on INSERT. |
| `new_data` | `jsonb NOT NULL` | Full resulting row, including BEFORE-trigger modifications. |

No schema-name or actor column is stored. `staff_id` in a snapshot is a source field, not proof of who performed the write. JSONB objects retain SQL NULL fields as JSON null. CHECK constraints enforce operation/object/old-row consistency. There is no foreign key back to the source. Primary-key changes use the new key in `record_pk`; the old key remains in `old_data`.

The index is `(table_name, record_pk, created_at DESC, id DESC)`. There is no JSON payload GIN index, automatic retention, cleanup job, initial backfill, DELETE/TRUNCATE capture, or log-of-log trigger. Full snapshot payloads can include source runtime tokens and other private fields; they remain restricted to database administrators.

## Capture and security

`private.aka_agent_capture_table_change()` is a new VOLATILE PL/pgSQL trigger function, owned by `postgres`, SECURITY DEFINER, `search_path=pg_catalog`, with owner-only EXECUTE. It takes primary-key column names through `TG_ARGV` and only accepts AFTER ROW INSERT/UPDATE registrations on tables in `public`. The two `trg_auto_table_log` triggers both pass `'id'`.

Each affected row produces one log, including no-op UPDATE and UPDATE via upsert. `ON CONFLICT DO NOTHING`/zero affected rows produce none. Outer transaction/savepoint rollback removes the associated log. Source DELETE leaves earlier history intact. The function uses no per-row catalog query, network call, SQL connection, worker, queue or retry.

Ordinary capture errors are caught in a PL/pgSQL subtransaction; the source write continues. The warning contains only `auto_table_logs: capture skipped (SQLSTATE ...)`, never SQLERRM, DETAIL, primary keys or snapshot content. PostgreSQL cancellation/assertion errors are not swallowed. Logging is synchronous and can add CPU, memory, disk/WAL work or lock wait; this is best-effort diagnostics, not a guaranteed independent audit service.

RLS is enabled with no client policies. All non-owner default grants are removed from the table, sequence and function, including custom project roles. Existing private-schema/source-table ACLs and business functions are unchanged. A source write can execute its preinstalled trigger without exposing direct EXECUTE/SELECT/INSERT rights to app roles.

## Read and extend

Run as a database administrator in Supabase SQL Editor, replacing the source ID:

```sql
SELECT id, created_at, operation, old_data, new_data
FROM public.auto_table_logs
WHERE table_name = 'auto_campaigns'
  AND record_pk = jsonb_build_object('id', 123::bigint)
ORDER BY created_at DESC, id DESC
LIMIT 100;
```

For an error policy, use `table_name = 'auto_error'` and its ID. Use a time bound/keyset cursor for deeper history. Do not search by `public.auto_campaigns`: schema prefixes are not stored.

To register another **public** table, capture its live schema/primary key/triggers and this function's checksum first, then add a separately versioned migration with a guarded AFTER INSERT OR UPDATE ROW trigger calling this function with the exact primary-key column names. Composite keys pass each column as a separate argument. Do not attach to non-public tables or configure non-key/nullable columns as keys. This does not require an app change or new connection. Adding a column to a registered source automatically includes it in subsequent full snapshots.

## Verification and performance

Reproducible DB-only tooling:

```sh
node scripts/auto-table-logs-v382.cjs local
node scripts/auto-table-logs-v382.cjs rehearse
node scripts/auto-table-logs-v382.cjs apply
node scripts/auto-table-logs-v382.cjs verify
node scripts/auto-table-logs-v382.cjs post-smoke
node scripts/auto-table-logs-v382.cjs api
```

Receipts are write-once. These are initial-deployment commands, not an instruction to reapply V382. `apply` requires matching successful local and linked rehearsal receipts, writes an intent before dispatch and refuses a second attempt after an unknown outcome. Inspect history and live objects instead of retrying. No bulk push, setup DDL for migration history, or duplicate timestamp SQL file is used.

The isolated PostgreSQL fixture uses captured source column types/defaults and original trigger function definitions; unrelated source dependencies/FKs are intentionally omitted. Tests cover INSERT/UPDATE, full JSONB/NULL/Unicode snapshots, no-op updates, changed/composite keys, multi-row writes, upsert, rollback, retained history after DELETE, and actual anon/authenticated/service_role/Chat SQL roles. A deliberately oversized audit index key forces real log INSERT failure while source INSERT and UPDATE succeed. Existing server-pause claim preservation, claim clearing, completed-at population and the error-policy component guard are exercised on isolated data. Adversarial custom default grants are removed.

Linked rollback smoke uses only temporary-in-transaction **public fixture tables** and explicit fixture IDs; it never updates customer campaigns/error policies or consumes their sequences. It exercises the actual capture function, live claim/completed-at helpers, anon/authenticated/service_role writes, and verifies Chat ACLs. The Management API caller cannot SET ROLE `aka_agent_chat_api`; actual Chat role execution is covered on isolated PostgreSQL, not claimed as live coverage. Log sequence gaps from rolled-back fixture attempts are harmless.

Migration/source/DDL-trigger checksums are checked before and after rehearsal/apply. The initial live role test failed with 42501 and was rolled back without changing role grants. A later rollback-detach test encountered 40P01 during a source-table lock upgrade; it was rolled back and moved to the isolated database. The operational rollback now takes ACCESS EXCLUSIVE up front with a 2-second lock timeout, avoiding that upgrade. Existing business definitions/owners/ACLs remain captured and compared byte-for-byte.

Performance measurements use a disposable socket-only local PostgreSQL instance, the captured campaign row shape, one warmed connection per scenario, and five UPDATE samples. Whole-instance WAL insertion-LSN deltas include AFTER-trigger/TOAST/index writes; EXPLAIN plan-node WAL alone does not fully represent them. These are local statement timings, not production p95 or commit latency. The 256-KiB text fixture is deliberately difficult to compress, and only `name` changes, illustrating the cost of full snapshots even when `log` is unchanged.

Final measurements are in [local-verification.json](audits/auto-table-logs-v382/local-verification.json). No load test was run against real campaigns. Cold-connection results and superseded rehearsal manifests are retained separately for traceability, not used as final apply evidence. No application typecheck/build is needed for this DB-only change.

| Fixture / warmed UPDATE | Median execution | Median WAL bytes |
| --- | ---: | ---: |
| Small row, capture off | 0.009 ms | 80 |
| Small row, capture on | 0.104 ms | 2,248 |
| 256-KiB log, capture off | 0.014 ms | 136 |
| 256-KiB log, capture on | 10.421 ms | 564,224 |

Full before/after snapshots deliberately trade storage/WAL for complete row history. There is no background retention limit in this release.

## Audit and rollback

The [audit directory](audits/auto-table-logs-v382/) contains the exact before snapshot, source checksums, migration/smoke/rollback SHA-256 manifest, local results, linked rehearsal and apply/verification receipts. Source signature `private.aka_agent_capture_table_change()` was **absent**, with no overload; no historical migration body was used to replace it. Target MD5 of `pg_get_functiondef` is `15a067168000fe73c96edae98fa85422`.

All seven existing source triggers/functions, source schema/constraints/ACLs and six event triggers are preserved. Existing `pgrst_ddl_watch` handles the DDL notification; the migration does not add NOTIFY or disable shared event triggers. The API check reads zero customer rows and verifies private log access is denied.

The [security advisor receipt](audits/auto-table-logs-v382/security-advisors.json) has no WARN/ERROR for the new objects. Its expected INFO, [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), reflects intentional owner-only access, not a missing customer policy. Existing unrelated findings were not modified. A read-only [live observation](audits/auto-table-logs-v382/live-observation.json) records only counts, source table names, timestamp and allocated size; no customer payload is exported.

At approximately 09:22 Vietnam time, about 77 seconds after apply, the table already held **2,458 real campaign logs** and occupied **100,876,288 bytes (96.2 MiB, including indexes/TOAST/allocation)**. No fixture tables remained. This is an observed early storage footprint, not a steady-state growth forecast; full snapshots and no automatic retention remain enabled as requested. No `auto_error` write was observed in that initial window, although its trigger and role behavior were verified.

The guarded [rollback.sql](audits/auto-table-logs-v382/rollback.sql) removes only the two new source triggers. It preserves the log table, sequence, function and accumulated history, and does not rewrite migration history. Its detach/retain behavior is tested in the isolated DB, not repeatedly on busy production sources. A lock timeout/checksum mismatch must be investigated before retrying; do not relax the guard or use CASCADE.
