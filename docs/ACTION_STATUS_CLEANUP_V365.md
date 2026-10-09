# Remove the unsupported post-visible status

Applied only to akachat (`cgjbsmqtfhqvttudyjzq`) on 9 October 2026, history `20261009121850 / migration_v365_remove_unsupported_post_visible_status`. Do not reapply.

The previous implementation incorrectly seeded the design example “Đã hiển thị bài” before verifying that a producer could recognize it. Desktop contained a consumer for `out.postVisible`/`detectOut.postVisible`, but no live block or workflow emitted that field. A consumer checking a hypothetical flag is not runtime detection.

V365 deletes only `auto_status.id=53`, code `campaign_detail_post_visible`. Its row matched the original V361 ownership checksum `8dd41aac9d84779af5bf7ae73a362b2a`; every known FK/catalog/Automation-array reference count was zero. The delete is guarded by exact canonical schema and row checksums, producer/config checks and reference checks. It does not clear mappings, remove policies, modify details, change input CHECKs, or rewrite note/log templates.

The Desktop consumer and its unused type fields were removed, and the seed source no longer includes this unsupported state. Already-applied migration files and original snapshots are retained unchanged as history. The existing “Thành công” result and pending-detection/log behavior remain intact. Missing pending evidence or a public-looking post URL never implies a visible-post secondary status.

## Full status review

Reviewed all 22 `campaign_detail` statuses, including the 19 additions from V349/V361. The per-ID decisions and evidence are in [status-review.json](../migrations/snapshots/action-status-cleanup-v365/status-review.json).

| Group | Decision |
|---|---|
| “Đã hiển thị bài”, ID 53 | Removed: hypothetical producer field only. |
| “Chờ duyệt bài”, ID 52 | Kept: live block 31, `fb_detect_pending_post`, emits `isPending`; the confirmed group-post writer consumes it. Block checksum: `21335b279cb31cfb4f382d0a1185e59a`. |
| “Bỏ qua”, ID 51 | Kept: existing friend-result `legacy_skipped` adapter. |
| Standard results, existing relationship outcomes, errors, Email/SMS/call events | Existing producer/adapter or live RPC evidence; preserved. This does not imply a main policy exists for every event or every action. |
| “Đã đổi tên”, “Đã gắn tag”, “Đã gửi lời mời kết bạn”, “Đã gửi tin nhắn”, IDs 24/25/28/29 | Retained as legacy catalog identities, each with 11 pre-V349 mapping references. No current writer was established for these exact aliases and no new main-result policy was seeded. They are not evidence of new runtime capability. Deleting their referenced identities is separate from removing an unused speculative state. |

Live blocks/workflows, 104 error policies, 19 action-status policies and every remaining config value are unchanged. The existing runtime updates to mapping timestamps were distinguished from this migration. All captured RPC definitions are unchanged. No schema cache reload, new connection, pool change, worker/Web redeploy or installer release was needed.

## Backup, verification and recovery

Full before/after config snapshots, schema/constraint/index/ACL metadata, checksums, producer evidence, apply history and API verification are in [the snapshot directory](../migrations/snapshots/action-status-cleanup-v365/). The backup was read back and verified before any committed write.

The first rollback smoke failed before DELETE because JavaScript rounded `pg_sequences.max_value` beyond its safe integer range. There was no live schema drift or committed mutation. The corrected guard compares the exact PostgreSQL-canonical schema checksum, captured separately with full numeric precision. The failed SQL/receipt is retained.

The corrected delete-and-restore transaction passed and ended in ROLLBACK; the entire `auto_status` checksum matched the backup. After apply, the API returns 200 with IDs 51/52 present and ID 53 absent. Both Desktop typechecks, Desktop and packaged Server production builds, and seven group-post fixture checks passed. No real post/send was performed.

[Rollback SQL](../migrations/tests/migration_v365_remove_unsupported_post_visible_status_rollback.sql) restores only the exact removed row after schema/identity checks. It does not reset the sequence, overwrite live rows or remove apply history. Runtime support for visible posts would still require a real verified producer; restoring a catalog row alone does not implement detection.

## P2 rollback correction — sequence position

The original rollback also compared `pg_sequences.last_value` as part of its schema checksum. An independent status INSERT, including an INSERT later rolled back, advances that value without changing the table structure. This incorrectly blocked restoring the deleted row with `auto_status schema drift`.

The repaired rollback removes only `{sequence,last_value}` from both sides of its schema comparison. Sequence definition, columns, constraints, indexes, triggers, RLS and grants still must match the exact captured metadata. The comparison uses PostgreSQL JSONB and the original canonical text to retain full bigint precision. ID/code/status-value collision checks and the restored-row checksum are unchanged; no sequence is reset.

The applied migration SQL and original preparation/apply manifests remain byte-for-byte unchanged. [The repair receipt](../migrations/snapshots/action-status-cleanup-v365/rollback-sequence-repair.json) links the previous rollback (`a85e65a731b704c7e3161366247e881bc348b82350e8f640a75e1166065bf250`) to the repaired artifact (`a70b6d91737897b5cb7fcf9b8cf692143b432532c8ed5da080d8758436eb070e`); the previous SQL is archived beside it. `repair-rollback` verifies this chain and does not reapply V365.

Verification: `node scripts/action-status-rollback-sequence-smoke.cjs` passes 12 local PostgreSQL checks, including reproduction of the old failure, preservation of an independent status and advanced sequence, and rejection of identity/data/schema/index/permission changes. The actual restore guard also passes a read-only query on akachat; ID 53 remains absent. [Local test receipt](../migrations/snapshots/action-status-cleanup-v365/rollback-sequence-smoke.json) and [read-only live check](../migrations/snapshots/action-status-cleanup-v365/rollback-sequence-live-read-check.json) are retained. No production row, RPC, migration history, runtime or release was changed by this repair.
