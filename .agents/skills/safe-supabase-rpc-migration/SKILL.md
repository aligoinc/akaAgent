---
name: safe-supabase-rpc-migration
description: Safely create, edit, review, or apply Supabase/Postgres RPC migrations without overwriting newer live function patches. Must be used whenever a task touches CREATE OR REPLACE FUNCTION, DROP/recreate FUNCTION, ALTER FUNCTION behavior, pg_proc/prosrc, or an existing RPC definition in any SQL migration, including hotfixes and production deploys.
---

# Safe Supabase RPC Migration

Treat the live database definition as the source of truth. Never construct a replacement function body from an old migration before capturing the exact live signature.

## Mandatory workflow

1. Verify the linked project is `cgjbsmqtfhqvttudyjzq` (`akachat`). Never query or mutate legacy project `yfkvwgapqmywaoftwuzc`.
2. Resolve the exact signature with `to_regprocedure(...)`. Before drafting SQL, query and retain:
   - `pg_get_functiondef(oid)`
   - owner, `prosecdef`, `provolatile`, `proconfig`, and `proacl`
   - a definition checksum such as `md5(pg_get_functiondef(oid))`
3. Search every repository migration that mentions the signature. Diff the live definition against the newest repository definition and identify DB-only or later patches.
4. Build the new function from the captured live definition. Change only the intended behavior; preserve every unrelated live patch and function attribute.
5. Put a fail-closed preflight before `CREATE OR REPLACE FUNCTION`:
   - accept only the captured source definition checksum;
   - optionally accept the target checksum for idempotent reapply;
   - raise an exception for any other definition;
   - raise when the exact signature is missing.
6. Validate in a transaction that ends with `ROLLBACK`. Do not apply while the preflight, SQL, owner, ACL, or behavior is unverified.
7. Apply only to the verified linked project and only when the task authorizes the database change. Apply the single intended migration; do not bulk-push unrelated migrations.
8. After apply, query the exact signature again and verify definition checksum, owner, security mode, volatility, config, and ACL. Run a rollback smoke test for both the changed behavior and preserved concurrency/ownership guards.

## Hard stops

- Do not run `CREATE OR REPLACE FUNCTION` if the live definition was not captured during the current task.
- Do not assume the newest repository migration equals production.
- Do not copy a historical body and merely add/remove a branch.
- Do not proceed when the live checksum differs from the migration preflight. Report the mismatch and inspect the live patch first.
- Do not delegate reading or interpreting this skill or the live definition; the main agent must perform the audit.

## Required handoff

Report the exact signature, source checksum, target checksum, preserved live patches, apply target, and smoke-test result. If production was not changed, say so explicitly.
