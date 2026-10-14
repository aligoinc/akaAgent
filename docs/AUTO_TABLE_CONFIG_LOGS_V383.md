# Configuration-only table logs — V383

**Current location:** V384 moved the existing table to `public.auto_table_logs` at 09:58 Vietnam time on 14/10/2026, preserving this configuration-filtering contract and admin-only access. See [V384 audit/query/rollback](AUTO_TABLE_LOGS_PUBLIC_V384.md). V383 rollout/rehearsal scripts are historical; use the V384 runner for the current schema.

DB-only follow-up to V382 on **akachat / cgjbsmqtfhqvttudyjzq**. No application/runtime edits, build, release, connection, worker, cron or polling changes. Canonical migration: [migration_v383_auto_table_config_logs.sql](../migrations/migration_v383_auto_table_config_logs.sql). V382 is historical and must not be reapplied or edited.

**Applied and verified at 09:39 Vietnam time on 14/10/2026**, history `20261014023921 / migration_v383_auto_table_config_logs`. Migration transaction: 20.7 ms; linked rollback rehearsal: 168 ms; post-apply rollback smoke: 174 ms. Both source API reads returned HTTP 200. Function definition, owner, ACL, volatility/search path and all seven business triggers/functions match the expected snapshots. Local rollback detach/retain passed. No customer rows were mutated by smoke. Do not reapply V383.

## Behavior

New INSERTs record the configuration baseline. UPDATE records one log only when the normalized configuration differs (NULL-safe equality); no-op and runtime-only writes produce none. `old_data` and `new_data` hold the complete configuration before/after, not a delta and not the complete source row. The seven log columns, index, RLS, owner-only access, transaction rollback and ordinary-error best-effort behavior remain unchanged. DELETE is not captured. Existing V382 rows remain unchanged and can contain full runtime snapshots; new filtering does not reclaim their disk space.

Campaign configuration fields (explicit allowlist, also used in snapshots):

`id`, `name`, `action_id`, `account_id`, `secondary_account_id`, `is_delete`, `content`, `original_schedule`, `schedule_type`, `schedule_end_date`, `schedule_days`, `schedule_week_days`, `continue_next_day`, `refresh_data`, `extra_settings`, `images`, `staff_id`, `organization_id`, `daily_stop_time`, `time_sleep_between_2`, `data_target_source_mode`, `data_group_id`.

Excluded campaign fields (neither compared nor stored):

`status`, `schedule`, `log`, `created_at`, `updated_at`, `note`, `completed_at`, `last_run_at`, `control_idempotency_key`, `provisioning_state`, `creation_bundle_id`, `creation_bundle_child_index`, `runtime_claim_token`, `runtime_claim_target`, `runtime_claim_vietnam_date`, `runtime_claimed_at`, `runtime_unit_token`, `runtime_unit_vietnam_date`, `runtime_unit_claimed_at`, `runtime_unit_input_data_ids`, `content_rotation_indexes`.

`original_schedule` is the configured schedule, written by the campaign form together with `schedule`. Runtime moves `schedule` to the next execution slot without changing configuration. An SQL edit of only `schedule`, status or runtime note is deliberately ignored. This follows field semantics, not a claim about the human actor: any process that actually changes a retained configuration field still produces a log. Link-table changes are outside these two source tables and are not captured.

Within `extra_settings`, retain configuration (including action limits, target selection, content, tags and new unknown keys), but remove these known runtime progress/cursor keys:

`sourceLinkIndex`, `contentRotationIndex`, `postBumpRotationIndex`, `internalSmsCreatedCampaignIdsByAccount`, `postBumpCreatedCampaignIdsByAccount`, `zaloFriendDataMaterializedAt`, `zaloFriendMaterializedCount`, `zaloBirthdayDataMaterializedDate`, `zaloBirthdayMaterializedCount`, `zaloFriendRecommendationDataMaterializedAt`, `zaloFriendRecommendationMaterializedCount`, `zaloCancelFriendRequestDataMaterializedAt`, `zaloCancelFriendRequestMaterializedCount`.

SQL NULL, an empty settings object and an object containing only excluded runtime keys normalize to JSON null. JSON null stays null. Other JSON values retain their identity. This avoids logging a runtime cursor added to initially empty settings. The explicit projection never evaluates/serializes the campaign `log` column, even when another field changes. New top-level campaign configuration columns require a reviewed migration to extend this allowlist.

`auto_error` is the error-policy catalog. Compare/store every column except `created_at` and `updated_at`; policy edits still log, timestamp-only/no-op updates do not.

## Implementation and evidence

The exact live `private.aka_agent_capture_table_change()` was captured this turn before constructing SQL. Source MD5 **15a067168000fe73c96edae98fa85422**, target MD5 **1cd8e9bc61b39e7ac7f8e6020ba3e953**. The function remains owned by postgres, SECURITY DEFINER, VOLATILE, `search_path=pg_catalog`, ACL `{postgres=X/postgres}`. Preserve its existing schema guard, key validation, safe warning and exception behavior.

The trigger argument contract now starts with a configuration profile, then PK columns: `('campaign_config_v1','id')` / `('error_config_v1','id')`. Explicit profiles let rollback smoke use public fixture tables without writing real campaigns or policies. Do not register arbitrary source shapes with these profiles. The migration checks that exactly the two known registrations exist before changing this contract. Composite keys remain supported when included in the selected profile's snapshot.

Source column/constraint/ACL definitions, all seven business triggers/functions and event triggers are checksum-guarded. Only the existing capture function and its two registrations change. The private log table is not rewritten, pruned or backfilled. Existing DDL notification behavior is preserved; no explicit NOTIFY or migration-history preparation DDL is added.

Audit files: [before snapshot](audits/auto-table-logs-v383/before.json), [source body](audits/auto-table-logs-v383/source-function.sql), [classification](audits/auto-table-logs-v383/policy.json), [audit directory](audits/auto-table-logs-v383/).

## Verification

```sh
node scripts/auto-table-config-logs-v383.cjs local
node scripts/auto-table-config-logs-v383.cjs rehearse
node scripts/auto-table-config-logs-v383.cjs apply
node scripts/auto-table-config-logs-v383.cjs verify
node scripts/auto-table-config-logs-v383.cjs post-smoke
node scripts/auto-table-config-logs-v383.cjs api
```

Local/rehearsal/verification runs write timestamped receipts, so they can be repeated without overwriting deployment evidence or failing with EEXIST. `apply` is single-attempt, requires matching successful local and linked rollback-rehearsal hashes, and writes intent before dispatch. Inspect history/live state after any unknown outcome; never blindly retry. Only V383 is applied; no bulk migration push.

Smoke covers all 22 retained campaign fields individually, all excluded runtime columns and 13 settings keys, NULL/empty settings, mixed config/runtime edits, 256-KiB log exclusion, no-op updates, INSERT, bulk UPDATE, upsert, PK/composite-key changes, retained history after DELETE, source/log rollback, real application SQL roles, denied private reads, log INSERT failure without aborting source writes, and existing pause/claim cleanup/completion BEFORE-trigger behavior. Live smoke creates rollback-only public fixtures with explicit IDs, not customer writes. Existing error-policy guards remain byte-for-byte unchanged.

Local benchmark uses five warmed UPDATE samples per scenario and whole-instance WAL insertion-LSN deltas, including AFTER-trigger writes. The source log is 256 KiB of difficult-to-compress text. Source log append itself remains expensive; V383 removes the additional audit copy. These are local samples, not production latency guarantees.

| Scenario | Median execution | Median whole-statement WAL | New log payload over 6 writes |
| --- | ---: | ---: | ---: |
| V382 runtime log append | 15.297 ms | 852,080 bytes | 3,158,996 bytes |
| V383 runtime log append | 6.366 ms | 287,976 bytes | 0 bytes |
| V383 configuration edit | 0.089 ms | 1,480 bytes | 6,008 bytes |

## Rollback

The checksum-guarded [rollback.sql](audits/auto-table-logs-v383/rollback.sql) detaches only the two logging triggers, preserving the log table/function/history and business triggers. It does not restore the high-volume V382 logging. ACCESS EXCLUSIVE locks are acquired upfront with a 2-second timeout; do not relax guards or retry without investigation. Retention/pruning of old logs is a separate user decision.

Security advisors report only the existing expected INFO for the private log: [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Owner-only access is intentional; unrelated findings were not modified. PostgreSQL reference: [JSON construction and comparison](https://www.postgresql.org/docs/current/functions-json.html), [trigger semantics](https://www.postgresql.org/docs/current/sql-createtrigger.html).

Live read-only observations: between `2026-10-14 02:39:56.946238+00` and `2026-10-14 02:41:14.453063+00`, the source UPDATE statistic increased by **2403** while there were **7 committed new logs since apply**, with **0 containing log/updated_at**. This short window is evidence of runtime suppression, not a guarantee of zero future configuration writes. Allocated size is **1498513408 bytes**, including retained V382 history; no cleanup was authorized or performed. See [observation](audits/auto-table-logs-v383/observation-after.json).
