# Web campaign SQL sources v325–v326

The canonical SQL sources for Web campaign pagination and its polling setting
now live in this repository alongside the other shared database migrations:

| Repository file | Former WebApp file | Applied history statement | File MD5 |
|---|---|---|---|
| [migration_v325_web_campaign_list_page.sql](../migrations/migration_v325_web_campaign_list_page.sql) | `scripts/campaign-list-page.sql` | `statements[1]` | `04638499b45bde44f2ed5defe37261bf` |
| [migration_v326_web_campaign_polling_setting.sql](../migrations/migration_v326_web_campaign_polling_setting.sql) | `scripts/web-campaign-polling-setting.sql` | `statements[2]` | `d5b1b4f12512fad9c49f0a557da86a28` |

Both files were moved byte for byte from
[WebApp commit 8159095](https://github.com/aligoinc/akaAgentWebApp/commit/8159095da30c84151872f9558c51e089818b5ca9).
The WebApp removes its SQL copies, updates documentation, and points its local
SQL fixture and synthetic benchmark to this checkout through `AKA_AGENT_REPO`.

## Already applied: one history row, two statements

- Project: `akachat` / `cgjbsmqtfhqvttudyjzq`.
- Applied on 2026-09-28 as version `20260928093929`, name
  `web_campaign_list_page_and_polling_setting`.
- Repository labels v325 and v326 map to the **same existing history row** and
  its two statements. Preserve the version, name, statement order and SQL bytes.
- These version labels record source ownership, not a new deployment or the
  chronological order of production execution. The campaign SQL was applied
  before account snapshot v324 (`20260928111039`).

**Do not reapply either file, create new history rows, repair/renumber the applied
history or reload the schema because the source moved.** The RPC's original
preflight and the setting seed's `ON CONFLICT (key) DO NOTHING` remain unchanged.
The seed must never reset an administrator's polling value.

## Read-only live audit on 2026-09-28

Verified the linked project before reading through the existing Supabase
Management API in a `BEGIN READ ONLY` transaction with a 20-second statement
timeout, ending in `ROLLBACK`. Captured the exact live function definition,
attributes, overloads and migration history; no campaign/account data was read.

- Exact signature:
  `public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])`.
- Source and target definition MD5: `bd7caeef73e9675f36dd9851498c11e6`.
  It matches the unchanged SQL preflight; exactly one overload exists.
- Owner `postgres`, `SECURITY INVOKER`, `STABLE`,
  `search_path=public, pg_temp`, `statement_timeout=20s`.
- ACL: `{postgres=X/postgres,service_role=X/postgres}`.
- Both files match the stored history statements byte for byte. No newer
  database-only function patch was found; the live body and attributes are
  preserved without modification.
- The one named setting `web.campaigns.poll_interval_seconds` was `30`, active
  and non-secret at audit time. It was only read.

This relocation changes no production data, RPC, permissions, migration history,
deployment, connection source or budget. Local verification uses a disposable
PostgreSQL cluster; no production smoke writes are needed for an unchanged SQL
source move.

## Local verification

From the companion WebApp checkout, set `AKA_AGENT_REPO` to this checkout:

```sh
AKA_AGENT_REPO=/path/to/akaAgent sh scripts/test-campaign-list-sql.sh
```

The existing fixture checks over 1,000 campaigns, tenant/capability restrictions,
100-row pages, pinned detail, draft ordering, search, Vietnam date boundaries,
500-ID selection and execution privileges. The benchmark also reads v325
directly; no SQL copy or download is kept in WebApp. Neither tool reads
application credentials or uses the shared database.

Verification passed after relocation: the complete SQL fixture (also launched
outside the WebApp working directory), shell/Python syntax, missing-checkout/file
errors, and benchmark source loading plus generation of all six query variants.
The full 161,000-campaign/3-million-input benchmark was not rerun for this path
change. Byte equality was checked against both the original WebApp files and the
live migration history; the function body also matches the captured live body.
