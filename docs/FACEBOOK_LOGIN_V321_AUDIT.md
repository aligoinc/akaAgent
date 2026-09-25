# V321 — bounded Facebook claim cancellation and temporary-session cleanup

Applied 26/09/2026 (Asia/Ho_Chi_Minh) to **akachat / cgjbsmqtfhqvttudyjzq**. History version `20260925194826`, name `migration_v321_facebook_login_claim_cancellation`. The legacy project was not accessed.

Migration: [migration_v321_facebook_login_claim_cancellation.sql](../migrations/migration_v321_facebook_login_claim_cancellation.sql).
SHA-256: `91a2e57e3882875b8cb8aba41eb74d2fc7c552fb2f9a0bd30c2c5e51f9d35168`.
The stored history statement matches the file exactly (MD5 `b9ce17e718d0295f5e20bed1d1475b06`).

## Behavior

An unanswered claim previously ignored the login deadline, leaving its account reserved and preventing `stop()` from finishing. A temporary partition's unfinished `clearStorageData()` could also delay DB release indefinitely.

- `auto_accounts.facebook_login_claim_generation`: bigint, not null, default 0. It is an internal operation generation, unrelated to Facebook UID/credentials or their revision. There is no new table, growing token ledger or timer.
- Only `facebook.login` uses the new `aka_agent_facebook_account_operation` RPC. Its claim carries the generation from the existing account read, the same immutable token and previous status. Transport waiting shares the attempt's 120-second deadline; an additional 120-second ceiling covers callers without a parent deadline.
- Claim and cleanup serialize on the existing staff/account locks. Cleanup closes the generation even if claim has not reached DB. A late request cannot acquire the account after that cleanup. A retry of the same currently owned token is idempotent; a competing or closed request cannot take over.
- A BEFORE UPDATE trigger, ordered after the existing token guard, increments the generation when a Facebook operation token changes. Existing pause, legacy cleanup and lifecycle recovery therefore also invalidate old requests. Email/Zalo token handling stays unchanged.
- Cancellation retains the local reservation until DB cleanup confirms. Cleanup still has its separate 18-second deadline, and unresolved cleanup keeps the existing recovery policy: at most five background attempts per token/app session, or explicit retry. DB unavailability is not treated as successful release. The same in-flight HTTP request is never interpreted as proof that SQL was cancelled merely because fetch aborted.
- All other claims retain their original drain policy. No Facebook DOM, selector, workflow, UID-deduplication rule, account creation rule or name lookup changed.
- Login releases its account claim before temporary-session disposal. Disposal only clears that attempt's unique nonpersistent partition, waits at most 18 seconds, consumes late errors, and cannot touch the persistent account or a later attempt. It runs even if release fails. Cleanup may continue natively after the wait expires.

The new RPC replaces the existing claim/cleanup HTTP calls; the generation arrives in the existing account SELECT. No SQL pool, connection limit, listener, job, polling interval or background retry budget was added. During an uncertain cancellation, server-side claim and cleanup may overlap until the account row lock settles; they use the existing Supabase HTTP/Data API and server pool.

## Definitions and privileges

All checksums below are `md5(pg_get_functiondef(oid))`. Live definitions, owner, ACL, security mode, volatility and config were captured before drafting. Shared bodies matched the latest repository bodies; v305 staff-expiration guards were preserved, as were the existing work-running/tenant/platform/status and token-owner checks.

| Exact signature | Source | Tested/applied target |
| --- | --- | --- |
| `public.aka_agent_facebook_account_operation(bigint,bigint,text,uuid,bigint,text)` | absent | `a5c7a6181fb3af9b1d47eeed8bc912cf` |
| `public.guard_facebook_login_claim_generation()` | absent | `2f6e2f7b901d816cd7a5c29deb8c43e4` |
| `public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)` | `b721f2bf997eef62f72eaf5e2728fb8c` | unchanged |
| `public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid)` | `f941b9177b447ca5da721d10dacf55e8` | unchanged |
| `public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)` | `e590eca5b11f0b258309bcd13b01e6a6` | unchanged |
| `public.guard_auto_account_runtime_operation_claim_token()` | `aa29df91b50cd6bc11e24bd912545c40` | unchanged |

Both new functions: owner `postgres`, SECURITY INVOKER, volatile, `search_path=pg_catalog, public`. Production execute ACL is postgres/anon/authenticated/service_role, with no PUBLIC execution. The trigger function inherits the project's explicit role defaults (the isolated local database has no such defaults); its trigger return type cannot be invoked as an ordinary RPC. Existing function attributes and ACLs were checked after apply and remain identical to the capture. No existing function body or RLS/table grant was replaced.

The new column and RPC signature require schema refresh. The existing DDL event triggers handled it; no duplicate NOTIFY or migration-history bootstrap DDL was used. Application HTTP probes confirmed the column is available (200, limit 0) and the new RPC signature is resolved (400/P0001 for deliberately invalid IDs, before any mutation).

## Verification

Passed:

- Isolated PostgreSQL tests with actual `SET LOCAL ROLE anon`: cancel before claim, replay after acquisition, replay after cancellation, competing tokens, stale cleanup against a new owner, user pause, inactive guard, legacy cleanup and unchanged Email behavior.
- Two real concurrent PostgreSQL transactions in both orders: claim holds the account lock first, and cancellation holds it first. Each ends idle with the old generation closed. A mismatched source checksum is rejected before DDL.
- Full migration plus synthetic production fixtures in one transaction ending ROLLBACK before apply. The first fixture attempt hit an ambiguous test variable and rolled back; the fixture was corrected and the complete test passed. Standalone production rollback smoke passed again after apply using the actual anon role. Account fixture `321000000001` is absent afterward. Fixture identity sequences can advance on rollback.
- 41 account-operation runtime tests: bounded unanswered claim, lifecycle stop during claim, recovery fence, a late claim after a newer operation, existing 18-second cleanup deadlines, failure/ownership preservation and unchanged Zalo/Email/scan drain behavior.
- Actual `FacebookLoginService` with actual `FacebookLoginSession.dispose()`: stalled native disposal after success, DB error and release error; release happens first, stop completes after disposal's deadline, and late cleanup leaves the persistent account intact.
- Existing Facebook service, legacy manual check and Electron HTTP/proxy/cookie/login tests.
- Both Node and renderer TypeScript checks, production `npm run build`, and `git diff --check`.
- Postapply definitions, privileges, column, trigger and exact history file checksum verified. Security advisors returned no notice identifying either new function.

This verification used synthetic/local Facebook responses, not another login with customer credentials. The desktop was built locally; no installer was packaged or published.

Commands:

```sh
node scripts/account-operation-cleanup-smoke-test.cjs
node scripts/facebook-login-release-smoke-test.cjs
node scripts/run-facebook-login-claim-sql-smoke.cjs
node scripts/facebook-login-smoke-test.cjs
node scripts/facebook-login-legacy-check-smoke-test.cjs
node scripts/run-facebook-login-browser-smoke.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

The production rollback fixture is a setup fragment: concatenate `migration_v321_facebook_login_claim_production_rollback.sql`, then `migration_v321_facebook_login_claim_cancellation_smoke.sql`, then `RESET ROLE; ROLLBACK;`. Before apply, prepend the migration without its final COMMIT and remove the setup fragment's BEGIN.

Supabase's [abortSignal documentation](https://supabase.com/docs/reference/javascript/using-modifiers-abortsignal) describes aborting fetch; DB cancellation safety here comes from the tested generation/row-lock protocol.
