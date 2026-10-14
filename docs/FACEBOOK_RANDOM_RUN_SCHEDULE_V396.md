# Đồng bộ ngày kết thúc khi lập kế hoạch ngẫu nhiên — V396

Đã apply trên **akachat / `cgjbsmqtfhqvttudyjzq`** ngày **14/10/2026 lúc 20:33:56 Việt Nam**, history **`20261014133356 / migration_v395_facebook_random_run_schedule`**. Không apply lại.

Số canonical trong repo là **V396**: task chẩn đoán khác đã dùng V395 trong lúc bản sửa này đang kiểm thử. Giữ nguyên tên history `migration_v395_facebook_random_run_schedule` và nội dung SQL đã commit (kể cả nhãn V395 trong SQL); chỉ đổi tên file canonical, không sửa history hoặc apply lại để đổi số.

## Lỗi và thay đổi

Desktop đã dùng `isDataGroupCampaignHardEnded` giống luồng thường, nhưng nhánh `plan` của RPC vẫn chặn mọi chiến dịch có ngày kết thúc cũ. Tài khoản `fb LD` có chiến dịch đăng nhóm `31113`: data trực tiếp, chờ xử lý, đến lịch, còn hai data và action đang mở; vì điều kiện DB này nên chiến dịch không xuất hiện trong kế hoạch. Log hoàn tất đợt mới của chiến dịch nhắn tin xác nhận Desktop đã chạy bản sửa, không phải chưa nhận code mới.

V396 chỉ sửa một predicate trong bước chọn campaign của planner:

```sql
AND (cc.data_target_source_mode IS DISTINCT FROM 'data_group'
     OR cc.schedule_end_date IS NULL
     OR cc.schedule_end_date > clock_timestamp())
```

Data trực tiếp tiếp tục theo lịch và quy tắc hoàn tất/chuyển kỳ hiện có. Nhóm data hết hạn vẫn bị loại. Nguồn NULL được xử lý giống luồng Desktop (không phải Nhóm data). Giữ nguyên staff/tenant/account/action, trạng thái/xóa, provisioning, lịch bắt đầu/giờ dừng/23:59, revision, thứ tự, ownership/token, tiến độ, recovery và lịch sử.

Không chỉnh lịch, trạng thái hay data của khách hàng; không thêm pool/connection/timer. Bản sửa SQL có hiệu lực ở lượt lập kế hoạch tiếp theo. Desktop cần giữ bản sửa kiểm tra lịch đã có; không cần phát hành thêm Desktop cho riêng V396.

## Source và checksum

Signature: `public.aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)`.

| | MD5 của `pg_get_functiondef` |
| --- | --- |
| Source live | `d82e1fa2561ca34c2e365a41a58b8ca4` |
| V396 | `ece8bf67bdf300722e17b7d1cf6b99f4` |

Live capture khớp body V392 khôi phục lifecycle V389; không dựng body từ migration cũ. [Migration](../migrations/migration_v396_facebook_random_run_schedule.sql) dựng từ capture live, preflight fail-closed, transaction và timeout. Owner `postgres`, SECURITY DEFINER, volatility, search_path, statement_timeout và ACL giữ nguyên. Các helper/claim/settle/cleanup/recovery/reset không đổi checksum.

Snapshot và biên nhận ở [thư mục V396](../migrations/snapshots/facebook-random-run-schedule-v396): `source.json`, `target.json`, `support.json`, `manifest.json`, `audit.json`, `local-smoke.json`, `apply.json`, `after.json`, `api-smoke.json` và `account-after.json`.

Chỉ thay body, không thay API metadata và không thêm `NOTIFY` chủ động. Event trigger `pgrst_ddl_watch` có sẵn vẫn tự phát reload khi CREATE FUNCTION được commit; không tắt trigger. Apply qua Management API linked, ghi history cùng transaction, không chạy DDL chuẩn bị migration schema. Kiểm tra Data API sau apply.

## Kiểm chứng

- `node scripts/facebook-random-run-schedule-smoke.cjs`: tái hiện lỗi bằng body live trước sửa; 10 ca planner dùng role `anon` thật; scheduler thật gọi planner/claim/settle/finish SQL thật, executor Facebook giả lập và xác nhận log 1/1 data. Không thao tác Facebook từ test.
- `node scripts/facebook-random-run-schedule-v396.cjs audit`: thay body trong transaction rồi rollback; kiểm tra đủ metadata/quyền; 10 ca ngày kết thúc/lịch/trạng thái và bộ smoke V393 về tenant/auth, token retry, tranh lượt, pause và recovery.
- `apply` chỉ nhận đúng checksum source và biên nhận test của migration; không bulk-push migration khác.
- `verify` kiểm tra target/history/helper; chạy lại hai bộ SQL rollback và diễn tập hoàn nguyên body trong transaction rồi rollback. Production vẫn giữ V396.
- Hai typecheck và production build đạt; chỉ còn cảnh báo bundler import tĩnh/động đã có.

Sau apply, API đọc trả HTTP 200; RPC không có credential trả đúng `automation_auth_required`. Lúc 20:35 Việt Nam, `31113` vẫn chờ xử lý, còn hai data và chưa có lượt mới. Lần cập nhật kế hoạch gần nhất là 20:28:48, trước apply; kiểm tra process không còn akaAgent/Electron của repo đang chạy trên máy local. Không tự mở app, bật scheduler hoặc thực hiện hành động Facebook để kiểm chứng. Cần bộ chạy hoạt động trở lại để nhận vòng kế tiếp.

## Rollback

[rollback.sql](../migrations/snapshots/facebook-random-run-schedule-v396/rollback.sql) chỉ nhận đúng checksum V396, khôi phục body source và giữ lịch sử migration/config/kế hoạch. Rollback sẽ phục hồi cả lỗi chặn data trực tiếp có ngày kết thúc cũ; không tự chạy file này khi phát hành. `verify` chỉ diễn tập, không commit rollback.
