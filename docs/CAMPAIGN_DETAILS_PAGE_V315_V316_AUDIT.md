# Kết quả chạy: index và phân trang ID trước payload — v315–316

Ngày 23/09/2026. Đã apply lên linked production **akachat / `cgjbsmqtfhqvttudyjzq`**, qua `supabase db query --linked` dùng Management API hiện có. Không thêm cột, trigger, timestamp ghi, SQL client/pool hoặc ngân sách connection. Code Desktop đã đổi và build local; chưa phát hành installer mới.

## Thay đổi

- v315 thêm B-tree `idx_campaign_details_page (campaign_id, created_at, id) WHERE is_delete=false`. `created_at` và `id` thực tế đều `NOT NULL`, vì thế ASC và backward DESC dùng chung một index, vẫn tương đương quy tắc thiếu thời gian nằm cuối. Preflight từ chối schema không còn invariant này. Không INCLUDE log/data/nội dung vào index.
- v316 thêm RPC `aka_agent_list_campaign_details_page`: xác thực bằng helper live, kiểm tra campaign cùng staff/tenant, phân trang `id,created_at` trong CTE MATERIALIZED, sau đó lookup PK và JSON hóa payload chỉ cho trang. Tổng chính xác nằm trong cùng statement/snapshot, kể cả khi OFFSET vượt cuối trả `{items:[],total:...}`.
- Predicate chỉ được thêm khi có filter; chiều sort chọn từ hai hằng ASC/DESC. Giá trị tìm kiếm/status/date/page đều bind bằng `USING`, không nối input vào SQL. Giữ tìm kiếm ILIKE trên sáu trường, status, ngày inclusive, soft-delete và ID cùng chiều để phá hòa. Không CASE ORDER BY toàn campaign và không MATERIALIZE payload toàn campaign.
- `listCampaignDetailsPage` dùng một RPC thay cho query ownership + page trước đây. Enrichment input và automation hiện có giữ nguyên và chỉ xử lý IDs trong trang. Giữ response `{items,total}` nên UI/export/reload và request-generation guards không đổi.
- History chỉ đọc, không claim runtime. Campaign Zalo Desktop/Server đều dùng cùng guard ownership như query cũ; không thay GUC runtime hoặc thêm kiểm tra subtype làm mất lịch sử.
- RPC input v313/v314 và phần provenance Data ban đầu chưa thay đổi (bước 3 chưa triển khai).

## Cách apply index

Bảng `auto_campaign_details` khoảng 4,04 GB bao gồm index trước apply. Vì bảng đang nhận ghi, dùng `CREATE INDEX CONCURRENTLY` trong request riêng, không build index thường trong transaction.

```sh
node scripts/apply-campaign-details-page-index.cjs --apply
```

Script khóa đúng linked ref, chạy ba phase trong migration v315 riêng biệt: preflight → build → postflight + history. Cùng tên nhưng khác definition hoặc invalid/not-ready sẽ dừng; không dùng `IF NOT EXISTS` để bỏ qua sai cấu trúc. API giữ timeout hiện có 2 phút; CLI wrapper giới hạn 150 giây. Script không mở hoặc giữ SQL connection riêng; phía server dùng cơ chế kết nối Management API hiện có. Nếu response không rõ hoặc index invalid, phải kiểm tra `pg_index` và `pg_stat_progress_create_index` trước khi xử lý; script không tự drop/retry index.

Build trả thành công sau **73.634 ms**, size sau tạo **104.398.848 byte (~99,6 MiB)**, `indisvalid=true`, `indisready=true`. Definition chính xác:

```sql
CREATE INDEX idx_campaign_details_page ON public.auto_campaign_details
USING btree (campaign_id, created_at, id) WHERE (is_delete = false)
```

v315 không có metadata API thay đổi, không NOTIFY và không DDL chuẩn bị migration history. Đã kiểm tra `extensions.pgrst_ddl_watch()`: CREATE INDEX không phát reload. v316 có signature RPC mới nên reload schema trong transaction là cần thiết. HTTP probe sau apply trả lỗi xác thực nghiệp vụ, không PGRST202/PGRST002.

| Migration | History version |
|---|---|
| migration_v315_campaign_details_page_index | 20260923094727 |
| migration_v316_campaign_details_page | 20260923094808 |

## Live RPC audit và checksum

Đã capture trong task này `pg_get_functiondef`, owner, security, volatility, proconfig, ACL và checksum. Hai helper/endpoint liên quan khớp body repo mới nhất v174/v195 sau chuẩn hóa whitespace; không có DB-only patch bị ghi đè. Guard RPC mới được dựng từ guard live của endpoint detail-automation, không từ migration lịch sử. Không thay bất kỳ definition/owner/ACL nào dưới đây:

| Exact signature (`public`) | Source = target MD5 |
|---|---|
| `auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` |
| `aka_agent_list_campaign_detail_automation_triggers(bigint,bigint,bigint,bigint[],text,text)` | `56822434723347452c8944484764daea` |
| `aka_agent_internal_require_staff_tenant(bigint,bigint)` | `3261f19ede3835caccc9cc425cbbc414` |

RPC mới, signature chính xác:

```text
public.aka_agent_list_campaign_details_page(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text)
```

- Source: signature **chưa tồn tại**, đã xác minh `to_regprocedure` và mọi overload theo tên.
- Target MD5: **`9652783556c25109e6250375da031fa3`**.
- Owner postgres; `SECURITY DEFINER`; volatility STABLE; `search_path=pg_catalog, public`; `statement_timeout=60s`.
- ACL: postgres/anon/authenticated/service_role EXECUTE; PUBLIC bị revoke. Phù hợp auth process-only credentials hiện có; service_role giữ bypass credential của helper live nhưng vẫn bắt buộc campaign thuộc staff/tenant được truyền.
- v316 preflight fail-closed theo hai source checksum, index đúng/valid/ready, NOT NULL và target absent hoặc đúng target checksum cho reapply. Checksum giả bị từ chối **trước CREATE FUNCTION**; reapply đúng target checksum trong transaction ROLLBACK cũng PASS.
- Postflight so sánh lại definition và toàn bộ thuộc tính/ACL của các function capture; các source giữ nguyên, target khớp rehearsal.

Advisors có hai cảnh báo expected về anon/authenticated được EXECUTE SECURITY DEFINER. Đây là endpoint tenant có credential và ownership guards theo kiến trúc hiện có; SQL smoke dùng role thật và HTTP invalid-credential đều xác nhận guard. Không mở quyền table hoặc sửa các cảnh báo legacy ngoài phạm vi.

## Kiểm chứng

- SQL rollback smoke trước và sau apply PASS: sort ASC/DESC, microseconds/timestamp trùng, nhiều trang/ngoài cuối, soft-delete, full payload + exact total, 30 tổ hợp search/status/date, SQL injection string, invalid sort/limit/offset/date, thiếu/sai credential, cross-tenant, role thật anon/authenticated/service_role và lịch sử Desktop/Server.
- NULL created_at bị ràng buộc NOT NULL từ chối; không thêm ràng buộc/cột mới để giả lập.
- Parity dữ liệu live: 4 campaign / 4 tổ chức, hai chiều, OFFSET 0/5.000/30.000 = **24 trường hợp**, toàn JSON payload và tổng số khớp query cũ trong cùng snapshot. Không xuất nội dung/log/credential ra artifact.
- `node scripts/campaign-details-page-smoke.cjs`: chạy repository thật với DB mock, xác nhận RPC/credentials/filter normalization, mapping/order, enrichment, empty-page total và error propagation. Không gọi production từ test này.
- `node scripts/run-campaign-data-sort-ui-smoke.cjs`: renderer thật + mocked IPC, menu/pagination/filter/tab/refresh/export/campaign reset/stale-response guards PASS. Không dùng smoke này làm bằng chứng latency HTTP production.
- Hai typecheck sạch; `npm run build` PASS; `git diff --check` PASS.
- HTTP `/rest/v1/rpc/aka_agent_list_campaign_details_page` với anon key và identity giả: **400 / P0001 / automation_auth_invalid**, chứng minh signature đã vào schema cache và credential guard chạy.

## Hiệu năng và giới hạn

Xem [số đo sau tối ưu](CAMPAIGN_DETAILS_PAGE_PERFORMANCE_20260923.md) và [raw metrics/plans](CAMPAIGN_DETAILS_PAGE_PERFORMANCE_20260923.json). Plan xác nhận index-only pagination và lookup full row theo PK cho tối đa page size, không sort payload toàn campaign và không spill temp ở các trang sâu được đo.

Exact count vẫn phải đếm các khóa phù hợp; OFFSET sâu vẫn đi qua các khóa trước trang. Index-only có thể cần heap fetch cho trang chưa all-visible theo MVCC, không được hiểu là hoàn toàn không đọc heap. Search trong nội dung/log vẫn có thể quét các dòng của campaign; không thêm trigram index hoặc thay nghĩa tìm kiếm trong task này. Index mới tăng dung lượng và chi phí bảo trì khi ghi.

## Rollback

Nếu cần rollback app, đưa `listCampaignDetailsPage` về query trước v316 trước khi gỡ endpoint. RPC mới additive nên app cũ vẫn hoạt động và không phải drop RPC lập tức. Drop RPC cần migration checksum/preflight riêng và schema refresh. Index chỉ gỡ bằng `DROP INDEX CONCURRENTLY public.idx_campaign_details_page` ngoài transaction, sau khi kiểm tra đúng definition; không đụng dữ liệu lịch sử hoặc index cũ. Không tự động rollback production sau các smoke đã PASS.

Tài liệu: [PostgreSQL concurrent index build](https://www.postgresql.org/docs/17/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY), [index ordering](https://www.postgresql.org/docs/17/indexes-ordering.html), [index-only scans và MVCC](https://www.postgresql.org/docs/17/indexes-index-only-scans.html).
