# Campaign data sorting — v313

Applied on 23/09/2026 to linked production **akachat** (`cgjbsmqtfhqvttudyjzq`).
Migration history: `20260923085015`, name `migration_v313_campaign_data_sort`.

## Behavior

- Data ban đầu: Tạo mới nhất (default), Tạo cũ nhất, Cập nhật gần nhất, Cập nhật xa nhất.
- Kết quả chạy: Tạo mới nhất (default), Tạo cũ nhất.
- Creation sorts use `created_at`; processing sorts use `COALESCE(date_action, created_at)`. Null timestamps go last; ID breaks ties in the selected direction.
- `date_action` is the existing runtime timestamp, not a general row update timestamp. Resetting a run clears it, so sorting then falls back to creation time.
- Each tab has independent in-memory selection; switching tabs/reloading retains it, changing campaign resets to newest-created. Changing sort resets to page 1 and preserves filters and selected IDs.
- Sorting happens before DB pagination. Input export now resolves fixed selected-ID batches and globally sorts them ([v314 follow-up](CAMPAIGN_INPUT_SELECTION_V314_AUDIT.md)); result export uses the same query as the tab.
- No columns, triggers, data backfill, indexes, SQL pools, or new connection sources. Existing RPC overloads and scheduler reads are unchanged.

## Live definition audit

Captured exact signatures with `to_regprocedure`, `pg_get_functiondef`, MD5, owner, security mode, volatility, config and ACL through `supabase db query --linked` before drafting SQL.

Source core:

```text
public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer)
MD5 d0d1a242529d6fc83a1cdf557ee0cc63
```

Source credentialed wrapper:

```text
public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text,text)
MD5 2ac65746a79de69ba99911b3301e1340
```

The core body matches v219 plus the v230 semantic projection and oldest-first patches. The wrapper body matches v221; live additionally has function-local `statement_timeout=60s`. This comparison was performed programmatically before constructing v313. Both original checksums remain identical after apply.

New core:

```text
public.aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text)
MD5 26f1c96183a8d0e92ac76575e8c1df96
```

New credentialed wrapper:

```text
public.aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text,text,text)
MD5 440e2c6163518d4c0563c275d33e8474
```

Both new functions are owned by `postgres`, use `SECURITY DEFINER`, `search_path=pg_catalog, public`, and `statement_timeout=60s`. Core is STABLE and executable only by owner/service_role; wrapper is VOLATILE and executable by owner/anon/authenticated/service_role. PUBLIC has no EXECUTE grant. Credentials, staff/tenant ownership, semantic projection, provenance enrichment, account-subtype runtime routing and GUC restoration on success/error are retained from the captured live bodies.

`p_sort` is the final argument on both new overloads. It accepts `created_desc`, `created_asc`, `processed_desc`, `processed_asc`; NULL means `created_desc`, other values fail. Existing return shapes remain `input_data jsonb, origins jsonb, total_count bigint`.

The migration fails closed if either source checksum changed, a source signature is missing, or an existing target has an unexpected checksum. Expected target checksums allow an idempotent reapply. Only v313 was applied via Supabase's migration tool. Schema reload is necessary because these are new RPC signatures.

## Verification

- Migration plus smoke executed in a transaction ending with ROLLBACK before apply. Verified neither new functions nor fixture rows remained afterward.
- `migrations/tests/migration_v313_campaign_data_sort_smoke.sql` passed again after apply: four orders, ties/nulls, offset/limit, search/status/date/origin filters, reset fallback, legacy checksums, owner/ACL/timeout, actual `SET LOCAL ROLE anon`/`service_role`, cross-tenant denial, Desktop/Server routing, and runtime GUC restoration on success/error.
- Post-apply exact target checksums, owner/security/volatility/config/ACL match the above.
- HTTP POST with deliberately invalid credentials reached the new wrapper and returned HTTP 400 / `P0001` / `automation_auth_invalid`. No PostgREST missing/ambiguous RPC or schema-cache error.
- EXPLAIN ANALYZE of the processing-sort pagination portion for a live campaign with 15,843 inputs used `idx_campaign_input_data_campaign_id` and top-N heapsort (39 kB), taking 75.245 ms in one sample. This is the paging portion, not the complete RPC including provenance enrichment.
- `node scripts/run-campaign-data-sort-ui-smoke.cjs` passed with the real CampaignPanel/Zustand and fake IPC; HTTP blocked. Covers menu counts/default/checked state, pagination, selection retention, cross-page input Excel order, processed sort, refresh, late-response suppression, search retention, independent tabs, result reload/export, and campaign reset.
- Both TypeScript checks passed; `npm run build` passed. Build retains the existing DataScanModal static/dynamic import warning.

Security advisor review reports the intentional credentialed SECURITY DEFINER wrapper callable by [anon](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). This matches the existing desktop credential-RPC model: the wrapper validates live credentials and tenant before calling the service-only core. Invalid credentials and cross-tenant access were tested; the core is not executable by either public API role.

## Compatibility and rollback

Deploy DB before distributing the updated desktop binary. Older clients continue using the unchanged RPC overloads. To roll back the client, leave the additive v2 functions installed; no data rollback is needed. Removing v2 requires first retiring clients that call it and checking exact live definitions/dependencies again under the safe migration workflow.
