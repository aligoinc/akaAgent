# Data Group account options (v291)

All create/edit forms use the same account selector. An account that cannot accept the group's current data/configuration remains visible with a disabled option and a reason. This applies to manual and dataset-derived groups through one shared database helper; the UI does not branch on the group kind to disable the entire selector.

## Rules and loading

- Eligibility checks the proposed semantic type, live account capabilities, active member/contact provenance, live dataset sources (including empty snapshots), active automation sources and saved dynamic-filter rules.
- Dataset-derived groups can bind their actual source account. A group with mixed, accountless or incompatible sources cannot bind a single account. A dataset-derived group with no identifiable live dataset source fails closed. Removing an optional binding remains supported; dataset semantic types remain read-only.
- The existing write trigger uses the same helper and rechecks after acquiring the existing group lock. A stale client cannot bypass it. The helper stays VOLATILE so write-time reads retain fresh read-committed snapshots after waiting for locks. Existing member/provenance guards, tenant/auth checks, forward-only cutoffs and contact tombstones remain intact.
- Opening the editor or changing its proposed data type issues one authenticated IPC/RPC read. Create and edit views share the selector; left/right edit panels share one request/state. There is no timer, subscription or per-account request. A failed read disables selection and exposes retry. Late responses cannot overwrite a newly selected group. Failed binding writes refresh eligibility.
- Existing unavailable bindings can be kept while renaming a group. The UI never silently replaces an invalid selected account; inactive semantic categories retain their known group type.

Implementation: [selector](../src/renderer/src/components/DataGroups/DataGroupAccountSelect.tsx), [repository](../src/main/data/repositories/dataGroupRepository.ts), [migration](../migrations/migration_v291_data_group_account_options.sql), [SQL smoke](../migrations/tests/migration_v291_data_group_account_options_smoke.sql), [renderer smoke](../scripts/run-data-group-zalo-ui-smoke.cjs).

## Live-source audit

Target: **akachat / cgjbsmqtfhqvttudyjzq**. Eleven exact live signatures and their definitions, checksums, owner, ACL, security mode, volatility and config were captured before drafting SQL. Compared against v286 and subsequent v289/v290 references: the binding guard still matches v286; later tag/query patches are unaffected. All eleven source checksums are checked fail-closed; both new signatures must be absent.

| Signature | Source checksum | Target checksum |
|---|---|---|
| `public.aka_agent_guard_data_group_bound_account()` | `fac56e4b36c7707d6cabac4065c15715` | `b32a00be6ecc6e6c26f6d71b281ffda0` |
| `public.aka_agent_data_group_account_options_internal(public.auto_account_contact_groups,bigint[])` | New | `f1de49e124ecdfeb79c682517543c7fb` |
| `public.aka_agent_get_data_group_account_options(bigint,bigint,bigint,bigint,text,text)` | New | `e38858ca59bd394ac079a281df03d0e8` |

The existing trigger function retains owner postgres, SECURITY DEFINER, VOLATILE, fixed `search_path=pg_catalog, public` and postgres-only EXECUTE. Its unchanged-binding fast path, revision increment and dynamic-filter cutoff refresh remain. The new helper is private; only the credential wrapper grants EXECUTE to anon/authenticated/service_role. The wrapper has a function-local 15-second timeout. No table/index/signature changes to existing functions or historical data backfill are included. The new public RPC requires schema-cache reload.

## Verification

- v291 rollback SQL smoke passed: new/empty groups, member/provenance mismatch and exact save-error parity, mixed accounts, binding/unbinding, empty dataset-source constraints, binding a dataset-derived group to its own account, rescan preservation and wrong-account rejection, active automation, disabled-filter rules, missing-group/auth rejection and private helper ACL.
- The current v290 regression suite and v291 suite passed in separate savepoints under the candidate migration, followed by ROLLBACK. Legacy v286 smoke is superseded: its direct Chat-tag insert conflicts with the v289 tag bridge; no production data was changed by that rolled-back attempt.
- Renderer smoke passed account choices for manual/auto/mixed groups, disabled reasons, lookup failure/retry, stale-response fencing, create/save, and the pre-existing name/status/filter tests. Idle time is advanced 90 seconds to verify no account-option polling; the dynamic-filter no-polling check remains.
- On the existing group of about 9,500 members used for v290 measurements, the full account-options RPC took **63.811 ms** in one rollback rehearsal. It aggregates member eligibility once by account, uses existing dataset-group indexes, and returns a compact option per account. This is a single measurement, not a load benchmark.
- Both TypeScript projects and production build passed during implementation. Final deployment verification is recorded below.

## Deployment

Applied to linked production **akachat / cgjbsmqtfhqvttudyjzq** as `20260920064015` / `v291_data_group_account_options`, with the existing-table migration-history INSERT in the same transaction. No migration-history bootstrap DDL was run. All 13 captured/new definitions and owner/ACL/security/volatility/config attributes match the rehearsed targets; the other ten captured functions are unchanged. Post-apply v291 smoke passed and rolled back. The new REST RPC is discoverable and rejects missing credentials with HTTP 400 / P0001 / `automation_auth_required`, confirming the API cache and auth guard.

Final node/web typechecks, production build and renderer smoke passed. The account-options idle test observed no additional reads over 90 seconds. No installer has been packaged or released; the Desktop code must be updated for the new selector. Source/target captures, rollback results and build logs are under `/tmp/aka-data-group-account-options-20260920`.
