# Google Sheet Web RPC permissions — v311

Applied on 2026-09-23 to linked production `cgjbsmqtfhqvttudyjzq` (`akachat`).
History version: `20260923045722`, name: `migration_v311_data_group_sheet_web_rpc_permissions`.

The Web backend uses `service_role`, while v297 granted the two public tenant RPCs
only to `anon` and `authenticated`. The missing PostgreSQL EXECUTE permission
prevented loading external sources and filtering members by source. The API
masked the permission error with its generic sync error. Desktop retained access.

## Change

[Migration](../migrations/migration_v311_data_group_sheet_web_rpc_permissions.sql)
adds only `EXECUTE` for `service_role` on these exact signatures:

```sql
public.aka_agent_data_group_external_sync(bigint,bigint,text,text,text,jsonb)
public.aka_agent_list_data_group_members_v3(bigint,bigint,bigint,text,bigint[],boolean,text[],text[],text,bigint[],bigint[],bigint[],bigint[],integer,integer,text,text,text[])
```

No function body replacement, table grants, worker grants, scheduling changes,
connections, pools or application deployment. Existing Desktop grants remain.

## Live definition audit

Captured exact live definitions with `pg_get_functiondef()` before constructing
the migration. Both bodies match their v297 definitions; the repository search
found no later replacement. All live behavior remains, including group ownership,
group-first locking, configuration/type/account validation, create replay,
revision checks and source-token invalidation. The current source-filter query,
including its live profile joins, is unchanged.

| Function | Source MD5 | Target MD5 |
| --- | --- | --- |
| `aka_agent_data_group_external_sync` | `b85a58727a68514b9a5837861adfe35b` | `b85a58727a68514b9a5837861adfe35b` |
| `aka_agent_list_data_group_members_v3` | `e6fb975f8bfa32ebf342c8f4bc7cd0e5` | `e6fb975f8bfa32ebf342c8f4bc7cd0e5` |

Before and after: owner `postgres`, `SECURITY DEFINER`,
`search_path=pg_catalog, public`, `statement_timeout=60s`. External sync is volatile;
member listing is stable. ACL before:
`{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}`.
ACL after adds exactly `service_role=X/postgres`.

The identity helper `auto_assert_automation_identity(bigint,bigint,text,text)` is
also unchanged: MD5 `5a9a503db72b965eb644739f5f60905d`, owner `postgres`, stable,
security definer, search path `pg_catalog, public`, grants only postgres and
service_role. The trusted backend role uses the authenticated control-session
identity; the RPC still checks group staff/organization. Desktop callers still
require credentials.

The migration rejects missing signatures, checksum/owner/security/volatility/
configuration drift and unexpected ACLs. It accepts the captured ACL or the
intended target ACL for reapplication. A deliberate bad-checksum execution was
rejected before either GRANT.

## Validation and application

[Actual-role rollback smoke](../migrations/tests/migration_v311_data_group_sheet_web_rpc_permissions_smoke.sql)
passed before apply (prospective grants inside the rollback transaction), then
again after apply. It switches the actual PostgreSQL role to `service_role`;
setting only a JWT claim while remaining postgres would miss this defect.

The fixture verifies list, preview, paused-source creation, identical-create
replay, toggle, edit, delete and the Google Sheet source filter. Wrong staff and
organization are rejected; stale revisions are rejected. Actual `anon` without
credentials is rejected. Anonymous table/worker/helper access remains denied.
Preview and paused-source operations create no memberships or runs. All fixture
rows are rolled back; the worker is never invoked by the smoke.

Applied the single migration via `supabase db query --linked`, with grants and
history insertion in one transaction using the existing migration history table.
No migration-history DDL scaffolding was executed. Inspected the live PostgREST
DDL event trigger: GRANT is not a reload-triggering command. No explicit schema
reload was sent because signatures and return types are unchanged.

Postflight confirms both service-role EXECUTE privileges and byte-for-byte
identical definitions, owners, security modes, volatility and configuration;
the helper's definition and ACL are also identical. `git diff --check` passes.
Application typechecks/build are not rerun for this SQL ACL-only change.

Read-only HTTP probes from the running Web machine `48ee749f357398`, using its
existing backend service-role environment, both returned HTTP 200:
`aka_agent_data_group_external_sync` with action `list`, and
`aka_agent_list_data_group_members_v3` with `p_source_codes=['external_sync']`.
The probe asserted the exact production Supabase hostname and reported status
only; credentials and returned tenant data were not printed. Fly's HTTP health
check is passing. This confirms PostgREST honors the grants without a reload.
An initial SSH probe timed out; the successful probe used `fly machine exec`.

Migration SHA-256:
`71066d39e94d1acf5ba1f96656f9a9d3c8f9cf83415f0f670bfe34bc44fda616`.

## Rollback

If required, revoke only the added EXECUTE grants from `service_role` on the two
exact signatures above in one transaction after checking for subsequent ACL
changes. This disables the Web feature again. It does not remove sources,
contacts, memberships or existing Desktop privileges.
