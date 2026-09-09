# WebApp: chạy lại input theo akaAgent

Migration: `migrations/migration_v269_control_campaign_input_rerun.sql`.

RPC chính xác: `public.update_control_campaign_input_statuses_atomic(bigint,bigint,bigint,bigint[],text,text)`.

- Project: `cgjbsmqtfhqvttudyjzq` (akachat).
- Source checksum: `5472937dcee43064392f109d5fb63a34`.
- Target checksum: `a98a23f8e7f2e1e6582449f7ed45fb45`.
- Live body được capture trong lượt sửa này, giống body v219; không có patch chỉ tồn tại trên DB.
- Giữ owner `postgres`, SECURITY DEFINER, volatility `v`, search path `pg_catalog, public`, ACL chỉ `postgres` và `service_role`.
- Giữ kiểm tra tenant/runtime owner trước và sau khoá; giữ serialization barrier, thứ tự khoá input → campaign → account, bỏ qua input đang chạy/đã xoá, giới hạn 5.000 ID, dedupe ID và giữ note khi không truyền note mới.
- Thay đổi có chủ ý: đích chờ xử lý nhận cả input tạm dừng và hoàn thành. Bỏ từ chối chỉ vì campaign đã hoàn thành để khớp nút chạy lại của desktop; RPC vẫn không đổi trạng thái campaign/account. Assertion cũ về `campaign_completed` trong smoke v219 được thay bởi smoke v269 cho thao tác người dùng này.

`migrations/tests/migration_v269_control_campaign_input_rerun_smoke.sql` chạy trong transaction kết thúc ROLLBACK. Kiểm tra Zalo/SMS, chuyển trạng thái, số dòng, trạng thái campaign/account giữ nguyên, input đang chạy/đã xoá, tenant và ownership desktop/server. Fixture đều mới, không commit và không gửi tin. Bản thử thay body + smoke đã rollback thành công; xác nhận source checksum và không còn fixture trước apply.

Không thay bảng, signature, kiểu trả về hay quyền RPC; không thêm NOTIFY thủ công. Event trigger DDL của Supabase hiện có vẫn được giữ nguyên. Chỉ apply migration này và kiểm tra checksum/thuộc tính, smoke rollback, API sau apply.

Đã apply production ngày 09/09/2026. Sau apply: target checksum và toàn bộ thuộc tính khớp; smoke rollback Zalo/SMS/quyền thành công; không còn campaign fixture; API công khai WebApp trả HTTP 200.
