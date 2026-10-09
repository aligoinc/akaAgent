# Lỗi composer chỉ ảnh hưởng target — V376

Đã apply trên akachat `cgjbsmqtfhqvttudyjzq` lúc **03:13:57 ngày 10/10/2026** (Việt Nam), history `20261009201357 / migration_v376_fb_composer_target_error`.

## Nguyên nhân và sửa đổi

V346 seed `err_fb_composer_editor_not_found` bằng cấu hình `pending`, bao gồm `update_status_campaign='chờ xử lý'`. V374/V375 nối mã lỗi này với output và writer hiện có nhưng giữ chỉ thị đó. Vì đây là trạng thái **chiến dịch**, `applyRuntimeErrorPolicy()` chuyển cả campaign về chờ xử lý và trả `triggered=true`, khiến lượt hiện tại dừng và log “Dừng chiến dịch”. Chờ xử lý không phải chỉ thị bỏ qua target; scheduler có thể nhận lại chiến dịch sau đó.

Timeout tìm composer chưa chứng minh account bị khóa, campaign sai cấu hình, hay nhóm chưa tham gia. Theo yêu cầu người dùng, lỗi này phải ghi nhận ở target và tiếp tục target khác.

V376 chỉ đổi `public.auto_error.id=94`:

- `update_status_campaign`: `chờ xử lý` → `NULL`.
- Cập nhật `updated_at` cho lần sửa cấu hình.

Giữ toàn bộ cột khác và 103 policy còn lại. Giữ `detail_mode='inherit'`, thông báo “Không tìm thấy ô đăng bài”, không tính hạn mức và không tăng/reset chuỗi target lỗi. Policy trạng thái Lỗi hiện có tiếp tục hoàn tất input bị lỗi; không tự requeue. Không suy ra “chưa tham gia nhóm” từ timeout, không thêm trạng thái hoặc thử tham gia nhóm.

Không sửa application source, block/workflow, schema, RPC, input/detail lịch sử, trạng thái/note/log campaign đã lưu hoặc câu chữ thông báo. Không reload PostgREST, thêm pool/connection hoặc build/deploy lại. Lượt đang chạy giữ catalog đã lấy; lượt mới sử dụng cấu hình mới sau khi cache 60 giây được làm mới thành công. Có thể khởi động lại app để bỏ cache cũ; không tự khởi động lại hoặc chạy chiến dịch trong migration.

## Kiểm chứng và khôi phục

- Backup đủ 104 dòng `auto_error`, tất cả cột, schema/constraint/index/ACL/RLS/trigger; checksum từng dòng/toàn bảng và SHA256 file được đọc lại trước mutation.
- Thử UPDATE trong transaction rồi ROLLBACK: dữ liệu khớp backup.
- Sáu kiểm thử offline dùng workflow, scheduler, managed writer và PostgreSQL WASM thật: tái hiện cấu hình cũ dừng; bốn workflow sau sửa không dừng; timeout button/dialog và phục hồi Page; giữ đúng detail/lượt/chuỗi lỗi, chống ghi trùng và ghi được kết quả thành công của target tiếp theo. Không thực hiện thao tác Facebook thật.
- Sau apply: chỉ hai cột nêu trên của một dòng thay đổi; schema, producer checksum và các policy khác giữ nguyên.
- Thử SQL rollback trong transaction: khôi phục đúng checksum dòng trước thay đổi, sau đó ROLLBACK transaction kiểm thử để giữ bản sửa đang áp dụng.

[Migration](../migrations/migration_v376_fb_composer_target_error.sql), [snapshot và manifest](../migrations/snapshots/fb-composer-target-error-v376/manifest.json), [receipt apply](../migrations/snapshots/fb-composer-target-error-v376/apply.json), [SQL rollback](../migrations/snapshots/fb-composer-target-error-v376/rollback.sql).

Rollback có kiểm tra schema và checksum toàn dòng, dừng nếu cấu hình đã được chỉnh tiếp. Chỉ phục hồi hai giá trị của policy, không xóa hoặc tính lại detail/counter, không phục hồi đè bảng, không reset sequence; giữ lịch sử migration. Chạy kiểm thử lại bằng `node scripts/fb-composer-target-error-v376-smoke.cjs`; `--receipt` chỉ dùng khi tạo receipt mới và không ghi đè bằng chứng đã lưu.
