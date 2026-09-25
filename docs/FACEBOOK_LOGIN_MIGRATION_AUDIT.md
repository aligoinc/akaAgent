# Audit migration v319 – Facebook login

Latest existing-account login extension: [v320 audit](FACEBOOK_LOGIN_V320_AUDIT.md). The checksums below document the original v319 apply.

Applied on 2026-09-25 to linked production **akachat**, project **cgjbsmqtfhqvttudyjzq**. Legacy project was not accessed. Migration history version: `20260925053218`, name `migration_v319_facebook_login_sessions`.

File: `migrations/migration_v319_facebook_login_sessions.sql`.
SHA-256: `967eaab7ae71569905917b7ace53628db3414791ae32e0e0e5aa5c77c061cc12`.

## Definition audit

All checksums below are `md5(pg_get_functiondef(oid))`. New functions were absent before drafting. Existing helper definitions, owner, ACL, security mode, volatility and config were captured from linked production during this task. No existing function body was replaced.

| Exact signature | Source | Applied target |
| --- | --- | --- |
| `aka_agent_facebook_login(bigint,text,text,text,jsonb)` | absent | `9da25936c98428774debffcafcc0d8f8` |
| `aka_agent_facebook_account_cleanup()` | absent | `ae3e6dba0ceb2350eea0d58dcb622715` |
| `aka_agent_facebook_secret_cleanup()` | absent | `86169ca640c7f2ef310d40aa2719b393` |
| `aka_agent_staff_access(bigint,text,text)` | `ca59bfbfa79c7e40ec50788e77b9d022` | unchanged |
| `aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)` | `b721f2bf997eef62f72eaf5e2728fb8c` | unchanged |

New functions: owner `postgres`, SECURITY DEFINER, volatile, `search_path=pg_catalog,public`; RPC also has `statement_timeout=15s`. RPC EXECUTE is granted to anon/authenticated/service_role and checks staff credentials, tenant and current entitlement. Cleanup trigger functions retain only postgres/service_role EXECUTE. Preserved helpers retain their captured definitions and ACL, including staff expiration and runtime claim guards.

## Schema and execution

- `auto_accounts.facebook_uid` (nullable text, not unique), `facebook_login_managed` (default false).
- Nonunique partial index `(staff_id, facebook_uid)` for undeleted Facebook accounts.
- `auto_facebook_login_sessions`: account link, Vault secret ID, request ID, revision and verification timestamps. RLS enabled; no direct PUBLIC/anon/authenticated access.
- `auto_facebook_login_imports`: nonsecret request/ID reservations. RLS enabled; no direct PUBLIC/anon/authenticated access. The ID comes from the existing identity sequence. No account or Vault secret is created until final commit after browser verification.
- Setting `facebook.account_import.max_accounts_per_batch=10`, seeded without overwriting an existing value.
- Soft delete, owner/organization/platform change delete the related secret; hard delete cascades through session metadata. Existing account/campaign guards were not changed.

Applied the one migration using linked `db query`, with history insertion in the same transaction and no extra migration-history DDL. Schema reload is required for the new API columns/tables/function. No pool, connection budget, SQL listener or cron was added. Client calls reuse the Supabase HTTP client.

An initial rollback test exposed expensive existing foreign-key scans when deleting a newly created account (`auto_campaign_run_events.account_id`). The implementation was changed before apply to reserve an ID and create the account only after profile promotion. Abort now deletes only the reservation. No unrelated index or log-table change was introduced.

## Validation results

- Full migration plus synthetic fixtures tested in a transaction ending with ROLLBACK before apply.
- Standalone rollback smoke passed after apply using actual `SET LOCAL ROLE anon` for RPC calls: credential rejection, cap, reservation replay, no usable account before final commit, import dedupe, manual duplicate UID, 111→222 credential discard, logged-in edit mismatch, unknown-state rejection, revision conflict, logout retains UID, logged-out edit clears old cookies, deleted UID reimport and idempotent abort.
- Existing claim RPC accepts logged-out/paused Facebook account with `requires_login=false`, rejects a competing claim, and cleanup preserves paused status.
- Postapply definition checksums, owner, ACL, security, volatility and config match the rollback target for all five signatures above.
- HTTP probe passed: new account columns available (200 with limit 0), invalid staff credentials rejected by the new RPC, both secret/reservation tables deny anon direct reads (`42501`).
- No real customer credentials or Facebook account were used. Synthetic business rows roll back; sequences can advance during rollback tests.

One parallel CLI audit probe encountered temporary `cli_login_postgres` authentication failures after another CLI invocation refreshed its temporary role. Retries were stopped. Final read-only definition verification used the Supabase connector with the explicit production project ref and matched all expected attributes. Application HTTP probes and the postapply rollback test passed. Future linked CLI queries in this workflow should run sequentially.

Browser, UI and runtime smoke scripts and known live-Facebook verification limits are documented in [FACEBOOK_LOGIN.md](FACEBOOK_LOGIN.md).
