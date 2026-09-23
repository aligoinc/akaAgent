# Campaign input selection — v314

Applied to linked production **akachat** (`cgjbsmqtfhqvttudyjzq`) on 23/09/2026.
Migration history: `20260923090658`, name `migration_v314_campaign_input_selection`.

## Fix

Export and create-from-selection now partition the selected IDs into batches of at most 500. Each request filters by those IDs inside the SQL filtered CTE, before sorting/counting/provenance enrichment, and starts at offset zero. A changing `date_action` cannot move an unfetched selected ID behind an already consumed offset. Selecting one row at the end of a 10,000-row campaign requires one page RPC instead of 20; automation provenance may still use the existing enrichment RPC where needed.

All returned IDs must match the requested batch exactly; missing, duplicate or unexpected rows abort the operation. Export displays the error and does not write a partial workbook. Existing search/status/date/origin filters remain in effect: if a selected row no longer matches them, the user is asked to refresh and select again.

The collected rows are globally sorted using the selected order, processing-time fallback, NULLS LAST, and matching ID direction. The comparator preserves Postgres timestamp microseconds across batches. Batches read current data at their respective request times; this is not a single transaction snapshot of every field, but timestamp movement cannot skip a selected ID.

Regular list pagination continues to call v2. The optional `inputDataIds` field travels through the existing shared query type, preload/IPC and repository, selecting the new narrow RPC only for selected-row requests. No columns, triggers, indexes, connection sources or pools were added.

## Live definition audit

The two exact v2 signatures were captured through `supabase db query --linked` using `to_regprocedure`, `pg_get_functiondef`, MD5, owner, security mode, volatility, configuration and ACL. Both bodies exactly matched v313; no newer live-only patches were found. New bodies were derived from those captures, changing only the name/signature, ID validation/filter and wrapper forwarding.

Source:

```text
public.aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text)
MD5 26f1c96183a8d0e92ac76575e8c1df96
```

Target:

```text
public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,bigint[])
MD5 3a4b00065a39f4172474d8a25d9dcdfc
```

Source:

```text
public.aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text)
MD5 440e2c6163518d4c0563c275d33e8474
```

Target:

```text
public.aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text,bigint[])
MD5 6faf48dceae54faacb69b6c3aa3b5ca6
```

The source RPCs remain unchanged. Fail-closed preflight checks both source checksums and any existing target checksums before DDL. Both new functions remain owned by `postgres`, SECURITY DEFINER, `search_path=pg_catalog, public`, `statement_timeout=60s`. Core is STABLE and executable only by owner/service_role. The VOLATILE credential wrapper allows anon/authenticated/service_role, but authenticates live staff credentials and tenant before the core. PUBLIC execute is revoked. Runtime subtype routing, GUC restoration on success/error, semantic projection and provenance are preserved.

## Validation

- Migration plus SQL smoke passed inside ROLLBACK before apply; confirmed zero new functions remained.
- SQL smoke passed again after apply: exact selected IDs, other-campaign/deleted-row exclusion, all four orders, filters, missing timestamps, actual anon/service_role role switching, invalid and oversized ID sets, cross-tenant rejection, Desktop/Server routing and GUC restoration.
- Exact source and target definitions, checksums, owner/security/volatility/config/ACL verified again after apply.
- HTTP probe with deliberately invalid credentials returned 400 / P0001 / `automation_auth_invalid`, confirming PostgREST sees the new overload and enforces authentication.
- `node scripts/campaign-input-selection-smoke.cjs`: one query for a far selected row; 1,001 selected rows across three batches with timestamp movement; exact completeness; global ordering, microseconds, ties, NULLS LAST and processing fallback.
- `node scripts/run-campaign-data-sort-ui-smoke.cjs`: real CampaignPanel/Zustand with fake IPC and blocked HTTP; selected IDs forwarded in one request, Excel order retained, missing selected ID prevents workbook creation and shows an error; existing menu, paging, tab, search, refresh and stale-response checks remain green.
- Both `tsconfig.node.json` and `tsconfig.web.json` typechecks passed. Production build passed with the existing DataScanModal import warning. `git diff --check` passed.

Security advisor flags the deliberate credential wrapper grants for [anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), matching the captured v2 access model. The core stays restricted, with wrapper authentication/tenant checks tested. No table privileges or RLS changed.

## Compatibility

Deploy this additive migration before distributing the updated client. Existing clients keep using v2 and legacy signatures. Client rollback can leave the new RPCs in place; removing them requires retiring updated clients and repeating the live-definition audit. PostgREST metadata reload was required for these new signatures.
