# v285 SQL Account migration audit

Audit/apply date: 2026-09-18. Linked production: **cgjbsmqtfhqvttudyjzq (akachat)**. **v285 was applied**, recorded as `20260918071137` / `v285_akabiz_sql_account_migration`. Synthetic deployment smoke data was rolled back. A user-authorized production migration was subsequently checked; customer-specific records are retained in the private API repository.

Implementation: [migration v285](../migrations/migration_v285_akabiz_sql_account_migration.sql), with API/service/source-reader/tests and deployment instructions in sibling repository `akaBizApi`, `docs/AKA_AGENT_SQL_MIGRATION.md`.

## Exact signatures and checksums

Checksums are `md5(pg_get_functiondef(oid))`, not hashes of migration files.

| Signature | Captured live source | Tested target |
| --- | --- | --- |
| `public.akabiz_migrate_sql_account_v1(jsonb)` | Absent (`to_regprocedure` is NULL) | `529028a7ad71f71f61212d04062cad4f` |
| `public.enforce_zalo_account_capability_and_quota()` | `567609a81de652a65813586093accfe4` | `1edc48a7985f2268159ad0b605fb205b` |
| `public.fn_upsert_aka_customer_v1(jsonb)` | `b111013d7e1918ddffc9a13830db2012` | Unchanged |
| `public.akabiz_portal_create_trial_account(jsonb)` | `ed7bf07f6a99905279a1cdfafd3c3e6f` | Unchanged |

The new RPC preflight permits absence or the exact target checksum. The trigger preflight accepts only the audited source or target. Portal/helper contract drift fails closed. Definitions and attributes were captured again immediately before apply. After apply, all four signatures match the target/unchanged checksums above, with owner/security/volatility/config/ACL verified.

Both functions: owner `postgres`, `SECURITY DEFINER`, volatile, `search_path=pg_catalog, public, private`. New RPC additionally has function-local `statement_timeout=60s`; EXECUTE ACL is only postgres/service_role. Trigger keeps its original postgres-only ACL and original config.

## Preserved behavior

The trigger was built from the captured live `pg_get_functiondef`, checked against migration v219, and compared after removing the added import branch: the remaining definition is identical to live. All tokenized subtype claim/CAS checks, organization checks, control-account advisory locks, pooled capability/quota checks and shared entitlement lock remain intact. Tenant callers cannot use the migration context, even if they set the custom GUC. The context is restricted by database role, target organization, staff ownership, INSERT operation and Server subtype; normal runtime checks apply after import.

No portal or customer helper body was replaced. Registration duplicate checks, CRM merge/owner helper logic, order/lifecycle/loyalty triggers, SMS-account creation, and runtime session verification paths remain as deployed. The migration does not call portal signup or email outbox. Existing CRM profile fields are untouched; normal derived product/lifecycle triggers remain enabled.

DDL is limited to removing `org_organization_phone_key`, introducing the RPC, and the narrow existing-trigger amendment. Per user request, v285 does not add a unique constraint/index on `sql_account_id`; the index and its duplicate-data installation preflight were removed before deployment. Function bodies/checksums are unchanged by this removal. Schema metadata changes require one PostgREST reload. No ledger or legacy credential column was added.

The follow-up fixes preserve `zaloapp.com` sessions, report unsupported SQL rights without blocking supported products, and import a Shop without UID with `zalo_account_id=NULL` and logged-out status. No placeholder Zalo identity is created. Finding 4 (coordination with portal signup phone locks) is explicitly deferred by user request; its code is unchanged.

## Validation and limits

- Local PostgreSQL 16, disposable database: functional migration tests cover combined/Web/Desktop entitlements, dynamic package additions/ties/missing modes, NULL/zero quota handling, year/demo/forever, expired packages, locked staff, demo reuse without credential changes, same-customer new org, merged customers, ambiguity, rollback after writes, concurrent same-ID and same-phone calls, backend ACL, forged tenant context and retained subtype claim guard.
- API/mapper tests cover eight audited foreign-department patterns, rejected repair cases, duplicate staff priority/Shop exclusion, session shape handling, public request validation, sanitized responses and logs, plus replay before reading legacy SQL.
- Full migration and idempotent reapply were rehearsed in a transaction ending **ROLLBACK**, with exact captured helper/portal definitions installed in the local fixture for checksum validation. Target checksums, owner/security/config/ACL verified inside that transaction.
- Local functional tests use a contract stub for `fn_upsert_aka_customer_v1`. The production rollback smoke below exercises the real helper and enabled triggers for the synthetic demo/expired-package case; it does not cover every CRM/order/loyalty combination. No portal signup/email flow was called.
- The real SQL reader was exercised read-only on one existing SQL Account. No SQL DML is present in the repository reader.

## Production apply and smoke

- Applied only v285 using the verified linked project, with checksum guards and the migration history insert in the same transaction. No unrelated migrations were pushed.
- Ran the full migration plus synthetic RPC smoke in a transaction ending ROLLBACK before apply, then ran [the same smoke](../migrations/tests/migration_v285_sql_account_migration_smoke.sql) after apply, also ending ROLLBACK. Both passed using live customer/product triggers: three entitlements, two staff, two departments, two Zalo accounts; preserved expired dates and locked staff; missing Zalo identity; stored session; replay; scoped context restoration; ordinary staff/expiry/subtype-claim guards; backend ACL and target checksums.
- Verified the synthetic organization/customer/staff-customer/Zalo identity rows are absent after rollback. The phone unique constraint is removed; no unique index was added on `sql_account_id`.
- PostgREST table health returned 200. The first RPC check returned PGRST202 while the schema cache refreshed; a subsequent check reached the new RPC and returned its expected `MIG_PAYLOAD_INVALID` for an empty payload, without an additional reload.
- Full local suite: **408 tests / 28 files passed**, including transaction rollback/concurrent-call tests; TypeScript build passed.

## API deployment status

- Correct production domain: `https://akabiz-api.vercel.app`, Vercel project `prj_JQ58Nn2OZg7X7B2zULBq96c24HUY` / `akabiz-api`, team `akabizs-projects`, Singapore `sin1`. The stale local `.vercel/project.json` link was corrected. Production SQL/Supabase settings are present, Supabase points at the verified project, and the function timeout is 300 seconds.
- At the user's direction, built locally with `vercel build --prod` and deployed using `vercel deploy --prebuilt --prod`, retaining the project and original Git attribution. Deployment **`dpl_8TBeK9V9nkbxHBcGEnWMJpaqp4R9` is READY**; Vercel confirms `akabiz-api.vercel.app` and its other production aliases point to it. Node.js 24 runtime, region `sin1`.
- The earlier source-build attempt `dpl_AKAbyGWJN4cLRiPCYJFANU2fnKnw` was blocked by `TEAM_ACCESS_REQUIRED`; it never built. The requested prebuilt deployment was accepted without changing Git attribution or team access settings.
- Production HTTP checks passed: `/health` 200 with service `akabiz-api`, Swagger 200 with the new migration route, unauthenticated invalid ID 400 `INVALID_SQL_ACCOUNT_ID`, and verified absent SQL Account ID 2147483647 returned 404 `SQL_ACCOUNT_NOT_FOUND`.

## Subsequent production verification

The user-authorized migration reused the existing customer, imported staff/departments/products/Zalo accounts and preserved the SQL source. Replay returned the same destination with `already_migrated=true`, zero counts and unchanged row counts. The initial comparison missed the API's coercion of legacy `IsActivity=NULL` to false. The API now treats only explicit false as disabled; the affected rows were repaired separately without changing their sessions or login verification state. These API/data fixes do not change the v285 function checksums.

The API subsequently added the current admin credentials to the response and was rebuilt locally and redeployed with the NULL-activity fix. Latest API verification: 421 tests across 29 files, including 16 local PostgreSQL cases; production health, Swagger and replay checks passed. The deployment notes above describe the initial v285 rollout, not the latest API build.

The separate [Server session restoration change](ZALO_SERVER_SESSION_RESTORE.md) automatically receives unverified imported sessions while a staff runtime is already running. It needs an akaAgent Zalo Server application update on the VPS; that update has not been deployed as part of this PR preparation. No database change was applied during PR preparation.

For any future reapply, repeat the live preflight/rollback workflow. Do not remove checksum guards if the source has changed; capture and review the new live definition instead.
