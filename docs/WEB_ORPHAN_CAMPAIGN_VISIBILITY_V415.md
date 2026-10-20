# Web giữ chiến dịch sau khi xóa tài khoản — V415

Ngày 20/10/2026, đã apply trên **akachat** (`cgjbsmqtfhqvttudyjzq`):
`20261020095536 / migration_v415_web_orphan_campaign_visibility`.
Không apply lại.

## Hành vi và nguyên nhân

Xóa tài khoản là soft-delete `auto_accounts`; chiến dịch vẫn nằm trong
`auto_campaigns` và giữ `account_id` cũ. Web gọi
`aka_agent_control_campaign_page`, vốn lọc `a.is_delete=false`, nên chiến dịch
biến mất ngay cả khi chọn tất cả bộ lọc. RPC đọc lịch sử có cùng điều kiện.

V415 bỏ đúng hai điều kiện xóa **tài khoản** trong hai RPC đọc. Chiến dịch còn
hiển thị với tên tài khoản cũ, tiến độ, chi tiết và lịch sử. Campaign đã bị xóa
vẫn bị loại. Xóa rồi thêm lại tài khoản tạo ID mới không tự chuyển chiến dịch
sang ID đó. Muốn dùng tài khoản mới, sử dụng luồng sửa/nhân bản hiện có.

Giữ nguyên staff/organization, capability platform, điều kiện Zalo Server,
phân trang 100 hàng, tìm kiếm, bộ lọc, chọn nhiều và selected ngoài trang.
Không đổi quyền sử dụng tài khoản, pause/resume, lịch chạy, quota hoặc ghi dữ
liệu chiến dịch. Catalog tài khoản vẫn loại tài khoản đã xóa.

Frontend đã có fallback lấy `accountId`/`accountName` từ campaign khi tài khoản
không còn trong catalog. Detail/config và progress cũng không có điều kiện
account soft-delete. Vì vậy không cần sửa mã runtime Web/API hoặc deploy lại;
RPC mới có hiệu lực ở lần đọc tiếp theo. Trang đang mở có thể bấm **Làm mới
chiến dịch**.

## RPC và snapshot live

Canonical migration:
[`migration_v415_web_orphan_campaign_visibility.sql`](../migrations/migration_v415_web_orphan_campaign_visibility.sql).
Snapshot, diff, receipt, rollback:
[`web-orphan-campaign-v415`](../migrations/snapshots/web-orphan-campaign-v415/).
SQL được sinh từ `pg_get_functiondef` live trong lượt làm việc này; không lấy
body từ migration V325/V408 cũ.

| Chữ ký chính xác | MD5 trước | MD5 sau |
| --- | --- | --- |
| `public.aka_agent_control_campaign_page(bigint,bigint,text[],jsonb,integer,jsonb,bigint,boolean,bigint,bigint[])` | `bd7caeef73e9675f36dd9851498c11e6` | `e081e2adaa53652506e9628e851aa604` |
| `public.aka_agent_control_campaign_logs(bigint,bigint,bigint,text[],jsonb)` | `3bafa54ccba53cb9788a32ab754ab7da` | `1275ad05d4dd184f5f6d9cd937caa21c` |

Cả hai giữ owner `postgres`, STABLE, EXECUTE chỉ postgres/service_role.
Page giữ SECURITY INVOKER, search_path `public, pg_temp`, timeout 20 giây.
Logs giữ SECURITY DEFINER, search_path `pg_catalog, public`, timeout 15 giây.
Không đổi signature, default arguments, JSON contract, ACL, RLS hoặc bảng.

Preflight kiểm tra cả hai hàm trước khi thay: checksum nguồn/đích đã biết,
owner, security, volatility, config và ACL. Khác snapshot thì dừng giao dịch.
Postflight kiểm tra checksum đích và các thuộc tính. `lock_timeout=2s`.

Các patch live được bảo toàn:

- `private.campaign_log_page(bigint,jsonb)`:
  `9df075f367231f8ad06970bfb6a62a5a`, bao gồm
  `plan_cache_mode=force_custom_plan`; không thay helper này.
- Progress overload ba tham số:
  `fdff962116bb5f2c98830dbfaec6a7f4`.
- Progress overload năm tham số:
  `954ab48ce0eec97b433d2cdc6da3b57e`.

Không thêm query, connection, pool, polling hay schema-cache reload. Không
chạy migration cũ hoặc thay đổi dữ liệu khách hàng.

## Kiểm chứng

1. `node scripts/web-orphan-campaign-visibility-v415.cjs`: PGlite chạy body
   live, tái hiện bản cũ ẩn orphan và trả lịch sử NULL, chạy migration thật,
   kiểm tra xóa/thêm lại tài khoản, hơn 1.000 campaign, phân trang, selected,
   filter/search/ngày Việt Nam, SMS/Zalo, tenant/capability/ACL, lịch sử
   beforeId/afterId/throughId và bigint dạng chuỗi. Apply lặp, rollback và
   chặn body drift đều đạt. Không kết nối production.
2. Web API `aka-agent-control.campaignList.test.ts`: **11/11** đạt, gồm
   account catalog rỗng nhưng campaign, selected và tiến độ vẫn giữ; số
   RPC của luồng hiện có không tăng.
3. `campaign-orphan-visibility.spec.ts`: **6/6** đạt trên Desktop Chromium,
   Android Chromium và iPhone WebKit cho Zalo/SMS. Kiểm tra refresh khi
   catalog rỗng, mở chi tiết/lịch sử, thêm tài khoản ID mới, chọn tất cả và
   reload trang. Dùng UI thật với API/WS giả lập.
4. Hồi quy cùng `campaign-orphan-clone.spec.ts`: lần chạy chung 5 worker
   đạt 19/21; hai ca `late-accounts` cũ lỗi timing trên Desktop/Android.
   Chạy lại riêng scenario đó tuần tự trên cả ba profile: **3/3** đạt.
   Không sửa mã clone hoặc test clone trong lượt này.
5. Web monorepo `npm run typecheck`: 7 workspace đạt. `npm run build` đạt,
   còn cảnh báo chunk lớn hiện có.
6. Trước apply: giao dịch production áp dụng hai body, chạy SQL smoke dưới
   `service_role` trên tối đa sáu orphan có sẵn, chạy rollback kiểm tra MD5
   nguồn rồi ROLLBACK toàn bộ: đạt (`dry-run.json`).
7. Sau apply: checksum/owner/security/config/ACL đúng snapshot đích;
   progress và helper lịch sử không đổi. SQL smoke production và diễn tập
   rollback → reapply trong giao dịch rồi ROLLBACK đều đạt
   (`post-smoke.json`, `post-rollback.json`).

Production smoke chỉ đọc campaign có sẵn theo đúng tenant, xác nhận list,
selected, tên/ID tài khoản gốc, chọn theo account, history bounded; scope
khác và anon/authenticated bị chặn. Không đưa nội dung hoặc tên khách hàng
vào receipt. Browser ở mục 3–4 là kiểm thử fixture, không phải đăng nhập
tài khoản khách trên production; không thực hiện luồng xóa tài khoản thật.

## Rollback

File [`rollback.sql`](../migrations/snapshots/web-orphan-campaign-v415/rollback.sql)
khôi phục đúng hai definition live ban đầu, có guard checksum và thuộc tính.
Nếu live đã có patch khác, dừng và chụp lại live trước khi quyết định.
Rollback không xóa campaign/log; nó trả lại hành vi Web ẩn campaign và lịch
sử của tài khoản đã xóa. Giữ migration history đã apply, không xóa lịch sử.

Có thể chạy lại SQL chỉ đọc trong một giao dịch:

```sh
supabase db query --linked -f /tmp/v415-check.sql -o json
```

Nội dung `/tmp/v415-check.sql` là `BEGIN;`, nội dung
[`migration_v415_web_orphan_campaign_visibility_smoke.sql`](../migrations/tests/migration_v415_web_orphan_campaign_visibility_smoke.sql),
rồi `ROLLBACK;`. Không chạy fixture local lên production.
