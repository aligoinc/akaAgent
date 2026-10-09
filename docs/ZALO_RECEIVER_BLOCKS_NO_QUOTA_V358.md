# Zalo recipient-blocked messages: exclude from limits

Applied to production **akachat / cgjbsmqtfhqvttudyjzq** on **09/10/2026 at
08:43:34 Vietnam time**, at the user's request. Migration history:
`20261009014334 / migration_v358_zalo_receiver_blocks_no_quota`. Do not reapply.

| Policy ID | Zalo code | Policy | counts_toward_limit |
|---|---|---|---|
| 10 | 122 | err_zalo_receiver_blocks_stranger_message | true → false |
| 11 | 119 | err_zalo_receiver_blocks_message | true → false |

Both policies retain `zalo_action_codes=[]`, so friend and stranger messaging
use the same result when Zalo returns either code. New failures remain
`thất bại`, but do not consume action limits after the runtime reads the updated
policy. Existing detail flags and daily counters are not rewritten or refunded.
No app build is needed; an operation that already read the old policy may finish
with its previous snapshot.

[Canonical SQL](../migrations/migration_v358_zalo_receiver_blocks_no_quota.sql)
checks the captured live full-row MD5 for each policy under a row lock, updates
only `counts_toward_limit` and `updated_at`, and asserts every other field is
unchanged. Both updates and the migration-history INSERT committed in one
transaction through `supabase db query --linked`. No DDL, RPC modification,
schema reload, new pool or connection source was added. The target table had no
non-internal triggers at preflight.

Post-commit read verified both false flags, unchanged failed status, shared
scope, no action disabling, active policies and an exact match between the
canonical SQL and the recorded migration source. The
[verification receipt](../migrations/snapshots/zalo-receiver-blocks-v358/applied.json)
contains timestamps, before/after checksums and full policy rows. No application
source changed. Before opening the PR, both node/web typechecks passed and
`npm run build` completed successfully in 25.7 seconds (36.7 MiB output).

If reverting, capture the live rows again, reject unexpected drift, change only
these two flags back to true (plus updated_at), and record a separate migration.
Do not rewrite past results or remove the applied history.
