# Report loading recovery — 19 September 2026

## Findings

- Both WebApp and Desktop loaded accounts/groups/actions before requesting a report. If that bootstrap failed, the page retained empty selections and the “Tải báo cáo” button invoked only the matrix loader. It returned an empty report without retrying the failed filters. The error was transient while the page remained unusable until reopening/reloading.
- The Desktop repository still paged all pending inputs and their repeated campaign settings before filtering the effective schedule in JavaScript. The first two 1,000-row pages for staff 4/organization 1 took about 2.35 s and 4.02 s over the local connection, and the second page was still full. These are partial page timings, not a completed before/after benchmark.
- The current production WebApp backend did **not** reproduce a load failure for `nhutlq` during this inspection: today's daily aggregation completed in 792 ms; the matrix with its filter queries completed in 612 ms from the Fly machine. An authenticated production browser session was unavailable, so these measurements cover read-only repository/service calls, not a complete signed-in browser flow.

## Changes

WebApp and Desktop retain a visible load error with explicit retry. Retry reloads filters if bootstrap failed, and otherwise reloads only the report. Loading filters also shows the loading state. Failed or pending loads disable Excel export. No polling or automatic retry was added.

The companion akaAgent change scopes pending reads by staff, organization, selected account and executable actions. It filters input schedules at the database, falling back to campaign schedules only for null input schedules. Reads use bounded campaign batches and ID cursors; detail hydration loads only the selected page (or explicit export). A failed/aborted read never returns partial totals. No schema, RPC, index, or role timeout change is involved.

Read-only Desktop repository verification for the same scope and day after the change: 12 accounts, 7 reads, 2.30 s total, 12 successful actions, 1 failed action and 0 pending actions. This used the repository's real Supabase read queries in an isolated process; it did not launch the scheduler or send messages.

## Verification

- WebApp: `npm run typecheck`, `npm test`, `npm run build` passed; 1,083 tests total across workspaces. New report UI tests exercise filter failure/retry, matrix failure/retry and the bootstrap loading state.
- Desktop: both TypeScript targets and `npm run build` passed. `node scripts/run-report-loading-smoke-test.cjs` covers >1,000 campaigns/inputs, date boundaries, null schedule fallback, foreign/deleted records, action flags, detail pagination and failed-read retry against a mocked PostgREST transport.
- Browser verification used the real WebApp and Desktop report components with isolated adapters and network access blocked. Both recovered from filter failure, then report failure, then displayed the expected 12/1 result matrix.
- No real campaign was started and no Zalo/SMS operation was performed. No database configuration was changed.

## Delivery

WebApp deployed to `https://agent.akabiz.net` with image `report-loading-20260919`; Fly machine `784525eae74998` passed health checks and `/healthz` returned `ok`. Desktop is source/build only; no installer or auto-update release was published.
