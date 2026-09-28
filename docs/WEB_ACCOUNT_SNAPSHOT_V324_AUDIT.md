# Web account snapshot migration v324

The canonical SQL is [migration_v324_web_account_read_snapshot.sql](../migrations/migration_v324_web_account_read_snapshot.sql).
It belongs to akaAgent's shared database migration history; the WebApp consumes
the RPC through its authenticated backend. The SQL file was moved unchanged from
akaAgentWebApp's `scripts/account-read-snapshot.sql`.

## Already applied

This file records an existing deployment, not a new database change:

- Project: `akachat` / `cgjbsmqtfhqvttudyjzq`.
- Applied on 2026-09-28; history version `20260928111039`,
  original history name `web_account_read_snapshot`.
- Repository label `v324` maps to that same history row. Keep its original
  version, name and executed statements; do not insert another history row.
- SQL file MD5: `c9973c77c1a7d9b5e617c7ac73f09944`, matching the stored
  `statements[1]` byte for byte.
- Exact signature:
  `public.aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)`.
- Original pre-deployment source: absent, with no overloads or existing patches
  to replace. The migration fails closed if the exact signature already exists.
- Current source and target definition MD5:
  `6ac923806e9e78cb4872e6909d487a6c`.
- Owner `postgres`, `SECURITY INVOKER`, `STABLE`,
  `search_path=public, pg_temp`, `statement_timeout=20s`.
  ACL: `{postgres=X/postgres,service_role=X/postgres}`.

Do not reapply this file to the existing production database just because its
repository location or version label changed. This relocation made no database
writes, schema reloads, history edits or application deployments. A fresh
read-only capture verified the live definition, attributes and stored SQL above;
all live behavior was preserved.

## Behavior and verification

Campaign refreshes return at most 101 account states plus a versioned narrow
catalog. Account refreshes return the complete live account ID/state set,
metadata only when changed, and minimal running campaign labels. Tenant,
platform and Server-account guards apply in SQL; raw sessions never leave
PostgreSQL. Web polling cadence and editable config concurrency tokens are
unchanged. No index, worker, pool or connection-budget change is involved.

The original deployment passed rollback validation and committed smoke under
actual `SET LOCAL ROLE service_role` for the three largest eligible staff scopes.
The disposable local PostgreSQL fixture covers 1,251 accounts, session semantics,
metadata changes, tenant boundaries and the campaign-state bound.
It passed again after relocation using the v324 file directly, with the same
definition checksum and payload measurements as before the move.

Web fixture scripts remain in akaAgentWebApp and take the canonical repo path:

```sh
cd /path/to/akaAgentWebApp
AKA_AGENT_REPO=/path/to/akaAgent sh scripts/test-account-snapshot-sql.sh
```

Application change and detailed deployment evidence:
[akaAgentWebApp PR #82](https://github.com/aligoinc/akaAgentWebApp/pull/82).
