# Action result policy catalog — v361

Preparation applied to **akachat / cgjbsmqtfhqvttudyjzq** on 09/10/2026, history **20261009102331 / migration_v361_action_status_policy_catalog**. Do not reapply. This migration does not activate a new execution path or modify an existing business RPC, block, workflow, input CHECK, note, log, or message template.

## Database state

- Added `auto_account_action_status_policies`: 9 defaults and 8 exceptions. All 17 rows are active and not deleted. RLS permits catalog reads; ordinary clients cannot mutate it.
- Added the agreed nullable columns to `auto_status`, `auto_error`, `auto_campaign_details`, and `auto_automation_trigger_statuses`.
- Filled only the new `auto_status.status_value` column on 19 existing detail statuses, using the unambiguous existing Automation mapping. No existing value or timestamp on those rows changed.
- Added status IDs **51** (`campaign_detail_skipped`), **52** (`campaign_detail_post_pending`), and **53** (`campaign_detail_post_visible`). The latter two have no main-result policy; they can be observations. A future main-role use needs its own verified policy.
- Preserved all 104 `auto_error` rows, including the two inactive policies; all three new error columns remain NULL.
- Added component/identity guards. Old detail INSERTs with NULL result metadata return immediately from the new guard without catalog lookups.
- Created four partial indexes using separate `CREATE INDEX CONCURRENTLY` calls: unique result key, main status FK, secondary status FK, and policy FK. Validated the six detail constraints separately after preparation.

The catalog's inactive and deleted overrides have different meanings: an inactive, non-deleted action override blocks that action/status; a deleted override is absent and may inherit the default. Different statuses have separate default rows even when their decisions are identical.

The seed matrix and source evidence are in [seed-evidence.json](../migrations/snapshots/action-status-policies-v361/seed-evidence.json). Unverified main statuses are explicitly listed there instead of assigning guessed policy values. The exceptions preserve tag/alias no-quota and no-bad-target behavior, Facebook join errors counting quota, and Facebook group-invite not-found reporting as skipped. Differences driven by individual error codes remain in `auto_error`.

## Backup and rollback

[Snapshot directory](../migrations/snapshots/action-status-policies-v361/) contains the initial and pre-apply full configuration backups, per-row/table checksums, schema/constraint/index/ACL metadata, live function definitions, apply receipt, after snapshot, inserted IDs/checksums, and API evidence. Both backups were read back and verified before any committed DDL/INSERT.

`auto_campaign_action_detail_statuses.updated_at` changes independently while the existing enqueue RPC handles live results. Drift analysis found only these automatic timestamps changing. v361 never writes that table; all other original values are compared exactly. The timestamp differences are retained in `independent-mapping-timestamps.json`. No automatic timestamp was restored over live activity.

[Guarded rollback SQL](../migrations/tests/migration_v361_action_status_policy_catalog_rollback.sql) checks the actual IDs/checksums and refuses if configuration changed or result metadata has been used. It only removes objects and rows from this migration, preserves migration history, and does not reset sequences. Foreign keys remain restrictive; no CASCADE or whole-table restoration. Keep the schema/readers once results depend on them.

## Verification and observed issue

- Linked preparation transaction, including old-role INSERT and migration history insertion, completed with ROLLBACK before apply.
- Local PostgreSQL/PGlite schema smoke: **15 cases**, including old payloads, permissions, invalid components, duplicate defaults including deleted rows, mismatched policy/status/action, sub-status validation, and full apply/rollback round trip.
- Pure resolver smoke: **11 cases**, including new-action default inheritance, disabled/deleted overrides, main/secondary roles, immutable historical decisions, error overrides, partial/unknown operation guards, and Automation transition edges.
- All 30 captured pre-existing function definition checksums remained unchanged after preparation.
- API `SELECT *` reads returned HTTP 200 for the old catalogs/details and new policy catalog after apply and after online index creation. No explicit reload notification was added: existing DDL event triggers performed the necessary schema-cache notification at commit.
- An early smoke verification mistakenly searched the large detail table by an unindexed synthetic status. It reached its 30-second statement timeout while holding transactional DDL locks; a simultaneous API probe also timed out. That transaction rolled back. The smoke now validates the row directly through `INSERT ... RETURNING`; API recovery was confirmed before applying. A separate history-string construction error was rejected at parse time and corrected; the complete history insertion was then included in the rollback smoke.

No real message, friend request, or group action was performed. No new SQL connection source, application pool, job, or polling timer was introduced.

## Runtime rollout

The preparation schema is live. The generic resolver, reader metadata, and catalog loader are being implemented in the isolated task worktrees. **Runtime integration and deployment are not complete yet.** Existing running applications continue to use their existing writer and policy behavior. Do not emit newly configured main status codes to an old client merely because the catalog now exists.

Keep reader deployment before new writers/output. Results already processed must retain their stored decisions; edits to a default apply to future catalog loads, not historical counters. A missing policy is a contract/configuration failure, not an implicit secondary status and not a deferred-recovery queue.
