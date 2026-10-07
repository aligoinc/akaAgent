# Zalo 221 — nghỉ nhắn bạn bè 60 phút (v348)

Đã apply trên **akachat** (`cgjbsmqtfhqvttudyjzq`) ngày 06/10/2026 lúc 09:03:26 Việt Nam, history `20261006020326 / migration_v348_zalo_friend_221_hour_limit`. **Không apply lại.**

Người dùng yêu cầu share tin nhắn cho bạn bè gặp lỗi 221 cũng nghỉ 60 phút như share nhóm. Thêm một policy `auto_error.id=62`, `error_code=err_zalo_221_message_friend`; không sửa 45 policy đang có.

| Thuộc tính | Giá trị |
| --- | --- |
| Mã Zalo | `221` |
| Scope / action bị khóa | `zalo_message_friend` |
| Thời gian | `fixed_minutes`, 60 phút, theo DB clock hiện có |
| Detail | `thất bại` |
| Tính quota / lỗi target liên tiếp | `true` / `false` |
| Thông báo chiến dịch | `Tạm khóa nhắn bạn bè 60 phút.` |
| Thay đổi login / account / campaign trực tiếp | Không |

Runtime hiện có dùng cùng action cho gửi trực tiếp và share bạn bè, nên cả hai nhận policy này. Batch không có target thành công áp khóa một lần và đưa chiến dịch về `chờ xử lý`. Batch có target thành công (kể cả media đã gửi) giữ xử lý lỗi riêng từng target, không khóa action do lỗi share của target còn lại. Detail thất bại là kết quả cuối của input; các target này không được tự gửi lại. Khóa dùng chung giữa các chiến dịch nhắn bạn bè của cùng tài khoản. Không thay đổi policy 221 tìm SĐT, kết bạn, nhắn nhóm hay thêm scope người lạ/global.

Nguồn cấu hình là row nhắn nhóm đọc trực tiếp từ production trước khi dựng migration. [Snapshot trước](../migrations/snapshots/zalo-friend-221-v348/before.json) giữ row live, checksum từng policy, toàn bảng, metadata, trigger và action. [Migration](../migrations/migration_v348_zalo_friend_221_hour_limit.sql) có preflight fail-closed, khóa bảng ngắn với `lock_timeout=3s` / `statement_timeout=30s`, kiểm tra checksum và conflict scope, rồi postflight xác minh toàn bộ policy cũ không đổi.

Apply dùng `supabase db query --linked --file` qua Management API hiện có. INSERT policy và INSERT history vào bảng `supabase_migrations.schema_migrations` đã tồn tại nằm trong một transaction. Không tạo/sửa RPC, schema, pool/connection, timer hoặc runtime; không có DDL chuẩn bị hay `NOTIFY pgrst`. Đã kiểm tra không có trigger riêng trên bảng policy/history. Không cần build/phát hành ứng dụng cho thay đổi dữ liệu này.

Kiểm chứng:

- SQL smoke trong transaction rollback: từ chối checksum cũ, apply policy, giữ nguyên mọi row cũ, rollback có guard. Fixture dùng ID âm để không tiêu thụ sequence production.
- Harness dùng mapper/repository/scheduler thật với adapter RAM: lookup đúng scope, expiry đúng 60 phút theo DB clock, khóa chỉ `zalo_message_friend`, giữ ba scope 221 cũ, không global/người lạ; `target-only` / `batch-followup` không khóa thêm; input thất bại không tự retry.
- `node scripts/zalo-policy-days-at-time-smoke-test.cjs` được nạp trong RAM với fixture v348 và các assertion trên: PASS.
- `node scripts/zalo-rich-share-smoke-test.cjs`: PASS Local/Server, friend/group, batch 50 target, kết quả hỗn hợp, media và nội dung rỗng.
- `node scripts/zalo-policy-progress-smoke-test.cjs`: PASS note, scope và log lý do khóa.
- Đọc lại production sau commit: policy id 62 đúng cấu hình, 45 checksum policy cũ và metadata không đổi, đúng một history v348. [Biên nhận](../migrations/snapshots/zalo-friend-221-v348/applied.json), [snapshot sau](../migrations/snapshots/zalo-friend-221-v348/after.json), [checksum file](../migrations/snapshots/zalo-friend-221-v348/manifest.json).

Không gửi tin thật qua Zalo để thử lỗi. Không sửa trạng thái chiến dịch/target đã thất bại trước khi apply.

[Rollback](../migrations/tests/migration_v348_zalo_friend_221_hour_limit_rollback.sql) chỉ vô hiệu hóa policy nếu cấu hình vẫn khớp bản đã apply, giữ các tham chiếu log/runtime. Khóa account đã ghi trước rollback vẫn hết hạn theo lịch 60 phút; rollback không xóa khóa đó và không xóa history.
