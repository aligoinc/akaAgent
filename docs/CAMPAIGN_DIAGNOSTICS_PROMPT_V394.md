# Prompt chẩn đoán chiến dịch — V394

Đã áp dụng ngày **14/10/2026, 20:23 giờ Việt Nam** trên **akachat / `cgjbsmqtfhqvttudyjzq`**, history **`20261014132316 / migration_v394_campaign_diagnostics_prompt`**. Không apply lại V390/V394.

**Lịch sử:** V395 đã tinh chỉnh tiếp prompt để bỏ box chỉ giải thích nguyên nhân đã loại trừ hoặc điều kiện bình thường. Xem [audit V395 hiện hành](CAMPAIGN_DIAGNOSTICS_FOCUS_V395.md); giữ nguyên snapshot và kết quả kiểm chứng V394 bên dưới.

## Kết quả

Hướng dẫn AI thuộc cấu hình DB: **`ai_prompt.id=47`, code `app_campaign_diagnostics`**. `ai_using.id=45` vẫn liên kết prompt này với `ai_model.id=21 / gpt-6.1-sol`. Chỉ `prompt_system` và timestamp cập nhật của dòng prompt thay đổi; giữ prompt người dùng, trạng thái, phạm vi, model, credential, request options và các trợ lý khác.

- Data trực tiếp: ngày kết thúc được xét khi chuyển kỳ/hoàn tất, không tự chặn data còn chờ chỉ vì ngày cũ. Không kết luận phép so sánh ngày này là lỗi hoặc bắt buộc sửa trước khi tiếp tục.
- Nhóm data: hết hạn thì không nhận lượt thực thi mới dù còn data.
- Nhật ký tạm dừng không tự xác định nguyên nhân/người dừng. Kiểm tra lịch chỉ đánh giá điều kiện lịch, không cam kết chiến dịch sẽ chạy.
- Hỗ trợ snapshot cũ thiếu `facts.schedule`: dùng nguồn data đã ghi nhận trong `facts.campaign.dataTargetSourceMode`; thiếu giờ DB không tự lấy giờ máy để kết luận hiện đã hết hạn. Câu trả lời dùng tên nghiệp vụ, tránh mã field/chính sách nội bộ.

Đã xóa `DIAGNOSTICS_SCHEDULE_INSTRUCTIONS` và tùy chọn ghép `systemInstructions` khỏi source Desktop. Main giữ phần lấy dữ liệu, snapshot và kiểm tra bằng quy tắc. `aiRuntimeService` render prompt do repository trả về; repository đọc cấu hình DB mỗi lần gọi AI, không có cache prompt. Các chỉnh sửa hướng dẫn tiếp theo có hiệu lực ở lần bấm AI tiếp theo; kết quả AI cũ không tự thay đổi. Bản Desktop bỏ phần ghép prompt đã build local, chưa đóng gói/phát hành.

## Áp dụng và kiểm chứng

[Migration](../migrations/migration_v394_campaign_diagnostics_prompt.sql) được dựng từ row live vừa đọc, có khóa dòng và checksum fail-closed cho prompt, binding, model; chặn nếu prompt được dùng thêm bởi chức năng khác. Apply dùng Management API linked hiện có, ghi history trong cùng transaction. Đây là cập nhật dữ liệu, không có RPC/DDL, history setup DDL, reload schema, pool, connection mới hoặc polling.

- Smoke UPDATE trong transaction rồi rollback đạt, xác nhận không thay đổi các cấu hình AI khác.
- Sau apply kiểm tra lại row/history và Data API HTTP **200**, nhận đúng prompt mới.
- Smoke rollback sau apply đạt; transaction thử nghiệm được rollback nên production vẫn giữ prompt mới.
- Hai typecheck và production build đạt. Smoke chẩn đoán kiểm tra prompt từ DB, Responses/Chat nhận revision mới ở lần gọi tiếp theo, bảo toàn snapshot đã che thông tin nhạy cảm và các điều kiện lịch.
- Cả 5 ca Sol 6.1 thực tế đạt: direct tạm dừng (snapshot mới và cũ), direct chờ xử lý, Nhóm data hết hạn và direct chưa đến giờ. System prompt gửi đi khớp chính xác prompt DB sau nội suy. Các ca direct không bị yêu cầu sửa ngày cũ; Nhóm data hết hạn trả blocking, lịch tương lai được giải thích là chờ. [Câu trả lời và checksum prompt](../migrations/snapshots/campaign-diagnostics-prompt-v394/ai-schedule-smoke.json).

Snapshot và biên nhận: [before](../migrations/snapshots/campaign-diagnostics-prompt-v394/before.json), [target](../migrations/snapshots/campaign-diagnostics-prompt-v394/target.json), [manifest](../migrations/snapshots/campaign-diagnostics-prompt-v394/manifest.json), [apply](../migrations/snapshots/campaign-diagnostics-prompt-v394/apply.json), [API](../migrations/snapshots/campaign-diagnostics-prompt-v394/api.json), [rollback smoke](../migrations/snapshots/campaign-diagnostics-prompt-v394/rollback-smoke.json).

SHA-256 prompt sau apply: `704bcdb72f999b26b503479d5352bc07b50752f52f8be469fe7972be36f35d35`.

## Kiểm tra lại và rollback

Script `campaign-diagnostics-prompt-v394.cjs verify` dành cho thời điểm V394 còn là prompt hiện hành; sau V395, dùng `node scripts/campaign-diagnostics-prompt-v395.cjs verify`. Smoke model thật hiện đã mở rộng thành 7 ca và đọc prompt live, xem audit V395. Biên nhận 5 ca tại thời điểm V394 vẫn được giữ nguyên ở thư mục snapshot V394.

[Rollback có guard](../migrations/tests/migration_v394_campaign_diagnostics_prompt_rollback.sql) chỉ khôi phục nội dung prompt trước V394 nếu row/binding chưa drift; giữ history. `rollback-smoke` của script chỉ diễn tập rồi rollback transaction, không hoàn nguyên production. Không sửa scheduler hoặc các migration đã apply để rollback prompt.
