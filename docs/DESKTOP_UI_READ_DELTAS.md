# Desktop UI read deltas (v328)

Status on 2026-09-28: implemented and tested; **v328 has not been applied** and this Desktop build has not been published. Apply the canonical [v328 migration](../migrations/migration_v328_desktop_ui_read_deltas.sql) before running/releasing this code. V327 is already applied; do not reapply it or duplicate its history. Older Desktop versions remain compatible with v328.

## Scope and recurring load

Both existing `desktop.campaigns.poll_interval_seconds` and `desktop.accounts.poll_interval_seconds` remain 30 seconds by default, with the same once-per-login settings read, visibility guards, separate clocks and 300-ms state-event coalescing described in [v327](DESKTOP_UI_READS_V327.md). Paging, filters, drafts and cross-page selection are unchanged.

1. A committed local scheduler log append emits `campaign:log-updated` with its ID instead of a campaign status notification. Actual status transitions retain their existing notifications. The Server log path was already separate and remains unchanged. Zalo Server snapshots trigger a database refresh only when the server or current staff runtime state/start/error changes; periodic timestamps, connection counts and other staff activity do not. Every reconnect/hello still refreshes.
2. The existing page RPC returns a config fingerprint for the selected campaign only. It hashes explicit configuration fields, including content/settings/images, but excludes log and runtime timestamps/status/schedule. The renderer retains configuration across runtime refreshes, merges newer summary state and reloads configuration on a changed fingerprint or explicit invalidation. Pending reads are fenced against newer config versions; runtime changes during a read merge without another config request. This read fingerprint is not an edit concurrency token.
3. Only the visible, open campaign log tab reads stored `auto_campaigns.log`. Events coalesce for two seconds; requests serialize with a follow-up for events received in flight. Opening, focus/visibility restoration and reconnect resynchronize. Existing campaign page refreshes provide missed-event recovery, with no additional polling clock. Closing the log tab stops future reads; an already pending request may finish. Reopening during that request waits and then requests fresh history.
4. Recurring campaign summaries omit unused relation flags/target ID arrays and reuse secondary account names from the existing page RPC response. Email link-tracking eligibility stays in the summary. Linked target IDs come from on-demand configuration; the separate full picker/reference catalog remains on demand. The Info view merges current summary names/state/progress while preserving catalog `relationSettings`, so a source on the current page retains its links. A successful source-ID query, including an empty list, is authoritative for the current campaign and auth scope; cached catalog relations cannot restore removed sources. Pending/failed reads retain the last confirmed IDs for that campaign, and obsolete selection responses are ignored. The form preview without a source-ID query continues to use its full catalog. Passive page refreshes do not reload that catalog.

No login/session checking, campaign execution, group watcher, scheduler timing, quota, claim or log-writing behavior changes. No index, worker, process, SQL connection/pool or connection-budget increase. The existing Supabase singleton serves every RPC.

## Log transfer and recovery

The new detail RPC authenticates and applies staff/organization/account/capability guards before returning either configuration or history. Configuration and log are separate branches; configuration never selects the stored log.

The main process keeps at most three log snapshots keyed by organization/staff/campaign. A cursor contains the previous MD5, Unicode character count and at most 1,024 trailing characters. The RPC returns:

- `unchanged`: version/timestamp only;
- `delta`: a small prefix, retained suffix length and appended text, supporting the existing rolling log that trims oldest entries;
- `replace`: full stored history for initial reads, resets or missing overlap.

The main process reconstructs the text and verifies its MD5. An ambiguous/repeated anchor or mismatch gets exactly one cursor-free resynchronization; another mismatch fails and retains the last good renderer snapshot. Unicode slicing uses code points, matching PostgreSQL. Cached history is never returned without an authenticated scoped RPC read.

This reduces **DB-to-Desktop transfer**, not the database cost of reading/hashing the stored text. Main-to-renderer IPC still carries the reconstructed snapshot. The existing writer's 256-KiB/2,000-entry retention is unchanged; older logs can remain larger until written again. There is no new log table, trigger or write-time version column.

## Live RPC audit

The linked project was verified as `cgjbsmqtfhqvttudyjzq` (`akachat`). Exact definitions, attributes and checksums were captured before editing; the existing page matched v327, with no additional DB-only patch. V328 is derived from that live definition and adds only the selected config fingerprint to its response.

Checksums are MD5 of `pg_get_functiondef` in schema `public`:

| Exact signature | Source | Target |
| --- | --- | --- |
| `aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])` | `d3255c296a0db4e144b078ae64c3831d` | `0a57f824f6be155b8dafd2c636f36823` |
| `aka_agent_desktop_campaign_config_version(public.auto_campaigns)` | Absent | `cd15cf96e7848c42071ed22b415fe246` |
| `aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)` | Absent | `496c1f46adc7e4edfefbeeb0babd123e` |

Preflight rejects missing/unrecognized existing page definitions and unrecognized new-function definitions; an identical target is accepted for idempotent verification. The page retains owner `postgres`, STABLE/SECURITY DEFINER, `search_path=pg_catalog, public`, 60-second function timeout and its existing execute ACL. Its paging/filter/draft/selection/tenant/capability behavior is preserved.

The new detail reader is owned by `postgres`, STABLE/SECURITY DEFINER, with the same search path and 60-second timeout; PUBLIC execute is revoked and `anon`, `authenticated`, `service_role` can execute. Desktop main supplies credentials/scope via the existing identity helper. The config helper is STABLE, SECURITY INVOKER, owned by `postgres`, with the same search path and UTC timezone; execute is revoked from PUBLIC and all three API roles. Only the definer readers call it.

Unchanged live functions include:

| Function | Captured checksum |
| --- | --- |
| `append_auto_campaign_log(bigint,bigint,text)` | `f94520920cec83d91829b7f542435eeb` |
| `auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` |
| `aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text)` (v327 baseline) | `4cefacf78def24a3b0fc4d8164ddf7a8` |

In particular, the log writer's row lock, retention, concurrent append and monotonic `updated_at` protections are untouched. Web RPCs and runtime repositories are not replaced. Schema reload is included because v328 introduces new callable API metadata.

Live validation compiled v328 on the linked schema, checked target hashes/attributes and executed the reader under actual `service_role`, all inside a transaction ending with **ROLLBACK**. After rollback the page retained its source checksum and both new functions were absent. **No production migration/history/settings change was committed.** Local audit captures are in `/tmp/aka-desktop-ui-deltas`.

## Verification

```sh
sh scripts/test-desktop-ui-sql.sh
node scripts/desktop-ui-read-deltas-smoke.cjs
node scripts/run-desktop-ui-reads-smoke.cjs
node scripts/run-campaign-data-sort-ui-smoke.cjs
node scripts/zalo-policy-progress-smoke-test.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

The SQL fixture retains v327 coverage over 1,510 campaigns and 1,255 accounts, adds config/runtime separation, tenant/capability/auth/SQL-role checks, Unicode append, unchanged/rolling/reset/null history, malformed cursors and idempotent v328 reapply. A large-log append fixture returns under 2,000 bytes instead of the full stored history; this is a fixture assertion, not a production bandwidth benchmark.

The main-process smoke exercises actual repository/scheduler/socket-handler methods with in-memory adapters: local log signals, unchanged Server snapshots, reconnects, live status forwarding, narrow projections, secondary names and checksum recovery. Electron fixtures use fake IPC and block HTTP; they cover 1,205 campaigns, filters/pages/selection/bulk commands, independent settings, config freshness/in-flight state, active/hidden log tabs, event bursts, reopen during a pending read and existing data sorting. Page fixtures omit configuration/relation payloads just like the real projection; on-page/off-page source links survive passive refresh, receive current names without catalog polling and disappear after unlink plus manual refresh. Coverage includes unlinking the last source while Info is inactive, failed source reads retaining known links, and changing selection while an old empty source read is pending. No real campaigns/messages were started.
