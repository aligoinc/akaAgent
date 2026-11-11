# Desktop UI polling and paged campaign reads (v327)

Status: implemented and tested. Migration v327 was **applied** to production `cgjbsmqtfhqvttudyjzq` on 2026-09-28 with history `20260928141133 / migration_v327_desktop_ui_reads`. The Desktop build has **not** been published.

Follow-up [v328 UI read deltas](DESKTOP_UI_READ_DELTAS.md) adds selected config fingerprints, visible-tab log deltas and event deduplication. That migration is **not applied yet** and is required before running the updated Desktop code; the v327 apply record below remains unchanged.

## Settings

Two independent rows in `auto_system_settings`, both seeded to `30` without replacing an existing value:

| Key | Purpose |
| --- | --- |
| `desktop.campaigns.poll_interval_seconds` | Campaign list fallback refresh |
| `desktop.accounts.poll_interval_seconds` | Account state fallback refresh on the Campaigns screen |

The main process reads only these active, nonsecret keys once per login session. Close/reopen Desktop or sign out/in after editing. Values are integer seconds from 5 through 3600; missing, disabled, malformed or unavailable settings use 30. Reading settings has a 5-second deadline and does not prevent login.

One renderer coordinator schedules the two intervals independently. It pauses when hidden, skips focus refresh while each snapshot is still fresh, and schedules from read completion instead of catching up missed intervals. The account timer still requires Server accounts, as before. Account notifications refresh even outside the Campaigns screen when visible. Campaign/account state notifications coalesce for 300ms; duplicate passive reads share the pending request, while a mutation or state event during a read gets one follow-up. Repeated unchanged off-page status/log signals retain only a bounded state signature and do not trigger repeated page reads.

This changes UI reads only. Login/session checks, runtime scheduling, campaign execution, group watchers, heartbeat, quota and claim behavior are unchanged. Existing Supabase singleton, connection limits, workers and runtime repository APIs remain in place.

## Data and compatibility

- Campaign list: DB filter/sort/count over narrow keys, 100 combined campaign/draft rows per page. Fetch summaries and progress only for page IDs plus one pinned detail (at most 101 campaigns, progress batches at most 100).
- Keep Desktop platform entitlements, QR/Web/Server capability distinctions, primary/secondary account filters, schedule-based dates (including the legacy extra day after `dateTo`, matching drafts), status/time ordering, drafts and soft-deleted account references. Narrow running-campaign labels and supplemental filter options remain independent of the displayed page.
- Selection across pages reads IDs/status only, sequential keyset batches of 500. Bulk commands use selected fixed IDs and existing mutation paths. A failed selection read never submits a partial set. Selection and bulk commands are disabled while entered search/applied page filters differ or the page is pending. A filter change clears selection and fences pending results; changing only the page preserves selection.
- Form pickers and linked information load the separate campaign metadata catalog on demand; this catalog has no progress aggregation and never polls. Read sequential ID pages until empty, retaining existing data on failure. Source links load by selected campaign and action-specific JSON field. Manual reload, config signals and link-changing mutations invalidate them through the existing page refresh; periodic reads and status-only events do not. Source requests serialize, coalesce invalidations and ignore obsolete selection/session responses. Assistant context retains its selected name when the list changes page.
- Account snapshot: one authenticated RPC returns all entitled account states and a metadata fingerprint. Catalog metadata is returned only when its fingerprint changes. Runtime status, login, heartbeat and session verification changes do not invalidate metadata; names, groups, proxies, public Zalo profile, additions and deletion do. Preserve SMS credentials required by the existing UI; never read or return raw Zalo/email sessions or other platforms' passwords.
- Poll errors wait for the next cycle rather than retrying immediately. Campaign errors retain filter/detail state and expose retry, while stale list rows are hidden. A metadata edit arriving during an account read discards the older response and rereads once.

Database still filters/counts campaign keys and fingerprints scoped account metadata; this does **not** eliminate all per-account DB work. The main load reduction is bounded campaign progress aggregation, fewer duplicate reads and smaller recurring account payloads. No new index, SQL client/pool, process or worker is introduced.

## RPC audit

Verified linked project: `cgjbsmqtfhqvttudyjzq` (`akachat`), 2026-09-28. Both new signatures were absent in the captured live definition inventory. Preflight allows first creation or the identical target checksum and rejects other definitions.

| Exact signature (schema `public`) | Source | Target MD5 of `pg_get_functiondef` |
| --- | --- | --- |
| `aka_agent_desktop_campaign_page(bigint,bigint,text,text,jsonb,jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])` | Absent | `d3255c296a0db4e144b078ae64c3831d` |
| `aka_agent_desktop_account_snapshot(bigint,bigint,text,text,jsonb,text)` | Absent | `4cefacf78def24a3b0fc4d8164ddf7a8` |

Owner `postgres`; STABLE, SECURITY DEFINER, `search_path=pg_catalog, public`, function statement timeout 60 seconds. PUBLIC execute revoked; execute granted to `anon`, `authenticated`, `service_role`. Desktop main supplies the authenticated staff/organization credentials and its entitlement snapshot; renderer cannot supply actor credentials/scope. Existing `auto_assert_automation_identity` authenticates the actor on each call.

Captured live definitions retained during development and left unchanged:

| Existing signature | Source checksum |
| --- | --- |
| `aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])` | `bd7caeef73e9675f36dd9851498c11e6` |
| `aka_agent_control_account_snapshot(bigint,bigint,text[],text,bigint[],jsonb,text)` | `6ac923806e9e78cb4872e6909d487a6c` |
| `aka_agent_control_campaign_progress(bigint,bigint,bigint[])` | `fdff962116bb5f2c98830dbfaec6a7f4` |
| `aka_agent_control_campaign_progress(bigint,bigint,bigint[],text,text)` | `954ab48ce0eec97b433d2cdc6da3b57e` |
| `auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` |

The live Web campaign function matched v325. Its narrow paging/selection approach was adapted for Desktop; no existing function is replaced, so Web fixes, runtime paths and existing authentication/progress patches remain intact.

Validation: disposable local PostgreSQL fixture (1,510 scoped campaigns, 1,255 scoped accounts), tenant/credential/capability checks, primary/secondary filters, accent/literal search, Vietnam day boundaries with microseconds, drafts, pinned rows, ID selection, account fingerprint/runtime/restriction behavior, idempotent reapply. The new definitions were also compiled and called under `SET LOCAL ROLE service_role` with an empty scope on the linked database in a transaction ending with **ROLLBACK**; owner/ACL/config/checksums matched. Those pre-apply validation transactions retained no production schema/settings. The authorized apply described below subsequently committed v327.

## Production apply (2026-09-28)

Applied only canonical `migrations/migration_v327_desktop_ui_reads.sql` through the existing linked Management API (`supabase db query --linked`). Both Desktop signatures were absent immediately before apply; the five existing RPC definitions and attributes still matched the audit above. A full rollback validation passed before the identical payload was committed, with its history row in the same transaction. No schema/history preparation DDL or unrelated migrations were applied.

- History: `20260928141133 / migration_v327_desktop_ui_reads` (one statement containing the canonical SQL).
- Canonical file SHA-256: `db61e23c94a387e70d4bb4926c7c18cd7a3545bd7dce70667ee785d22f71ad39`.
- Both new RPC checksums, owner, STABLE/SECURITY DEFINER, function settings and ACL match the table above; all existing RPC definitions/attributes remain unchanged.
- Both polling settings persisted as `30`, active and nonsecret. Existing values would have been retained by `ON CONFLICT DO NOTHING`.
- Post-apply rollback smoke passed under actual `service_role` and `anon` SQL roles: empty tenant scope, unchanged catalog version omits metadata, selection over 500 IDs is rejected, missing/invalid identity is denied.
- PostgREST recognizes both new signatures after the required schema reload. Anonymous HTTP calls correctly return `400 / P0001 / automation_auth_required`; an HTTP read of the two public setting keys returns `200` with `30` for each.

No runtime campaigns/messages were started. Desktop release remains a separate step.

## Verification and release order

```sh
sh scripts/test-desktop-ui-sql.sh
node scripts/run-desktop-ui-reads-smoke.cjs
node scripts/run-campaign-data-sort-ui-smoke.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

Electron smoke uses fake IPC and blocks HTTP: 1,205 campaigns, 100-row pages, pinned detail, select all and bulk action across 13 pages, 30s defaults and independent 45s/60s settings, visibility/focus, event bursts, requests already in progress, metadata edits, errors/retry and off-page repeated signals. Regression cases cover search/select-all before the 300ms debounce, pending selection across a filter change, deletion count after filtering, source links after manual/config refresh, coalesced config bursts, serialized source requests and no source reads during periodic polling. Existing input/result sorting and export smoke also passes. No real messages or campaigns are started.

The v327 database prerequisite is complete; do not reapply it as part of the Desktop release or create a duplicate history row. Publish the tested Desktop build separately. Existing Web and older Desktop versions continue using their existing APIs. New Desktop intentionally does not fall back to loading every campaign if its RPC is missing.

## Sửa đọc chiến dịch nguồn (11/11/2026)

Code đã sửa, **chưa phát hành Desktop**; không migration/RPC/quyền mới.

- **Lỗi (có từ v327, `d50a8ac8`):** `getDesktopCampaignSources` lọc bằng `.contains(\`extra_settings->${field}\`, [id])`. Với mảng, supabase-js gửi `cs.{id}` (literal mảng Postgres), nhưng `extra_settings->field` là jsonb nên Postgres báo `22P02 invalid input syntax for type json` và PostgREST trả 400. Danh sách "chiến dịch nguồn" (chiến dịch tìm data cấp data cho chiến dịch đang chọn) ở tab Thông tin chưa từng tải được; renderer chỉ ghi `Failed to load campaign sources` ra console, chiến dịch vẫn chạy bình thường. `edge_logs` akachat 10/11 08:00 → 11/11 08:00 UTC: 502 lượt `GET /rest/v1/auto_campaigns` dạng này, cả 502 đều 400, role `aka_agent_desktop`, 71 IP.
- **Sửa:** `.or()` với hai literal JSON `cs.[id]` và `cs.["id"]`, khớp ID lưu dạng số hoặc chuỗi, giống `hasPendingFindDataSource` ([campaignPendingReasonRepository.ts](../src/main/data/repositories/campaignPendingReasonRepository.ts)). Giữ phạm vi staff/tổ chức/`is_delete`/hai action tìm data, trang 1.000 dòng theo `id`, timeout 60 giây.
- **Đối chiếu dữ liệu thật (chỉ đọc, 11/11):** cả 7 trường `find*TargetCampaignIds` đều là mảng jsonb; 763 phần tử hiện có đều là số nguyên. Trên 131 chiến dịch đích đang có nguồn (213 liên kết), bộ lọc mới cho đúng tập ID như cách tách phần tử bằng `jsonb_array_elements_text`. `aka_agent_desktop` có SELECT trên bảng và các cột dùng để lọc. PostgREST production đã trả 200 cho đúng dạng `or=(…cs.[52726],…cs.["52726"])` ngày 10/11 (lượt gọi của API Web).
- **Quy tắc:** lọc chứa trên đường dẫn jsonb (`col->key`) phải gửi literal JSON (`cs.[…]`), không dùng `.contains(col, mảng)` (chỉ đúng với cột mảng Postgres). Trong `or=(…)`, giá trị không đặt trong nháy kép không được chứa dấu phẩy, nên mỗi literal chỉ chứa một ID.
- **Smoke:** `node scripts/desktop-campaign-sources-smoke.cjs` đóng gói file repository thật, dùng supabase-js thật và Postgres 16 cục bộ dùng một lần (`PG_TEST_BINDIR` để đổi thư mục binary). Smoke chạy lại câu cũ (400/22P02), rồi kiểm ID số/chuỗi/mảng trộn, ID gần giống (`420`, `"042"`), sai trường/staff/tổ chức/action, đã xóa, phân trang 2.345 dòng và so với cách tách phần tử. Đặt `DESKTOP_UI_REPOSITORY_SOURCE=<file>` để chạy với bản khác; với bản trước khi sửa, smoke dừng ở `Không thể tải chiến dịch nguồn: invalid input syntax for type json`.
