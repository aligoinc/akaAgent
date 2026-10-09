# Composer: tính vào bộ đếm target lỗi — V377

Theo yêu cầu người dùng: giữ nguyên năm policy chưa có producer (`err_fb_join_group_failed_ui`, `err_fb_page_inbox_ui`, `err_fb_group_invite_ui`, `err_fb_media_upload_timeout`, `err_fb_upload_form_changed`); bật `counts_toward_bad_target` cho riêng `err_fb_composer_editor_not_found`.

Đã apply trên **akachat / cgjbsmqtfhqvttudyjzq** lúc **03:22:53 ngày 10/10/2026** (Việt Nam), history `20261009202253 / migration_v377_fb_composer_bad_target`. Không apply lại.

## Cấu hình hiệu lực

Chỉ đổi `auto_error.id=94.counts_toward_bad_target` từ `false` sang `true`, cùng timestamp `updated_at`. Giữ `counts_toward_limit=false`, `update_status_campaign=NULL`, `count_consecutive_errors=NULL`, `detail_mode=inherit`, thông báo “Không tìm thấy ô đăng bài” và các trường còn lại.

Lỗi này tăng chuỗi target lỗi chung một lần cho mỗi target, không tính hạn mức hành động. Không có lệnh dừng riêng của composer. Do không có ngưỡng riêng, scheduler hiện tại tiếp tục kiểm tra policy chung `err_undefined`: ngưỡng live là **4**, trạng thái khi đạt ngưỡng là **tạm dừng**. Đó là chuỗi lỗi chung, không nhất thiết bốn lần đều cùng mã composer. Ngưỡng và policy chung không được chỉnh trong V377. Thành công có thể reset bộ đếm theo policy hiện có.

Input đã xử lý vẫn hoàn thành với kết quả Lỗi; không tự thử lại và không tính lại lịch sử. Năm policy người dùng yêu cầu giữ nguyên và tất cả 103 dòng policy khác có checksum trước/sau khớp hoàn toàn. Không sửa source app, block/workflow, schema, RPC, note/log hoặc mẫu thông báo. Không thêm connection/pool và không reload schema.

Không cần build/deploy lại. Lượt đang chạy giữ catalog đã nạp; lượt mới nhận thay đổi khi cache 60 giây được làm mới thành công.

## Kiểm chứng và hoàn nguyên

- Snapshot đầy đủ 104 policy, mọi cột và schema/constraint/index/ACL/RLS/trigger; đọc lại và xác minh checksum trước UPDATE.
- Thử migration trong transaction rồi ROLLBACK: bảng trở về đúng checksum trước thay đổi.
- Bốn kiểm thử offline dùng workflow, scheduler, writer/settlement và PostgreSQL WASM: trạng thái trước khi bật cờ, tăng 0→1 không dừng, tăng 3→4 dùng ngưỡng chung và tạm dừng, cùng kết quả ở timeline. Replay không tăng trùng, quota bằng 0; không có thao tác Facebook thật.
- Sau apply: chỉ cờ được yêu cầu và timestamp của ID 94 thay đổi; mọi policy khác, schema và checksum producer giữ nguyên.
- SQL rollback chỉ phục hồi cờ và timestamp của ID 94 sau guard toàn dòng/schema; thử khôi phục trong transaction rồi ROLLBACK để giữ cấu hình mới đang áp dụng. Không sửa detail/counter lịch sử, không xóa lịch sử migration hoặc reset sequence.

[Migration](../migrations/migration_v377_fb_composer_bad_target.sql), [backup manifest](../migrations/snapshots/fb-composer-bad-target-v377/manifest.json), [apply receipt](../migrations/snapshots/fb-composer-bad-target-v377/apply.json), [rollback](../migrations/snapshots/fb-composer-bad-target-v377/rollback.sql), [runtime smoke](../migrations/snapshots/fb-composer-bad-target-v377/runtime-smoke.json).

Chạy lại smoke bằng `node scripts/fb-composer-bad-target-v377-smoke.cjs`. `--receipt` chỉ dành cho tạo receipt lần đầu, không ghi đè bằng chứng cũ.
