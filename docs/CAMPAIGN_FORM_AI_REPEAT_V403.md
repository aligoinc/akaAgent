# Enter và yêu cầu đã khớp form — V403

Đã apply trên **akachat** ngày **15/10/2026, 00:33:51 giờ Việt Nam**, history `20261014173351 / migration_v403_campaign_form_ai_repeat`. Chỉ cập nhật prompt **49** và **52**; giữ binding **47/50**, model **21** `gpt-6.1-sol`. Không apply lại V399/V400/V402/V403. Desktop đã build local, chưa đóng gói/phát hành.

## Nguyên nhân và hành vi

Popover dùng chung từng chặn mọi Enter, nên Shift+Enter cũng gửi yêu cầu. Handler hiện dừng lan truyền phím trước, cho Shift+Enter xuống dòng theo textarea, chỉ Enter thường mới ngăn xuống dòng và gửi. Giữ chặn lặp phím, bộ gõ IME, mô tả trống và yêu cầu trùng khi đang chờ. Áp dụng cho cả **Lịch chạy** và **Giới hạn hành động**.

Prompt V402 yêu cầu `ok` phải có ít nhất một thay đổi. Hai parser cũng chuyển `ok` không có thay đổi thành `unclear`. Vì vậy mô tả đúng và đã khớp với form có thể bị báo “Chưa hiểu yêu cầu”, dù AI đã xác định đúng các giá trị.

Prompt V403 phân biệt **hiểu được yêu cầu** với **có thay đổi giá trị**: giá trị được yêu cầu rõ được điền lại kể cả khi trùng; yêu cầu giữ nguyên được trả `ok` với các trường null/danh sách rỗng theo schema. Không tự tìm một thay đổi khác, không hỏi lại chỉ vì cấu hình đã đáp ứng yêu cầu. Parser nhận `ok` rỗng là thành công sau kiểm tra cấu trúc. Không chuyển `unclear` thật thành thành công hay dò câu mẫu trong code.

Thành công vẫn tự đóng popover, mở khóa form, giữ giá trị không được yêu cầu và không tự lưu. Yêu cầu thật sự thiếu ý định hoặc không biểu diễn được vẫn trả `unclear`/`unsupported`. Không đổi kiểm tra nghiệp vụ tại Lưu, quyền, lịch scheduler hoặc quota.

## DB và rollback

SQL được dựng từ snapshot live trong `migrations/snapshots/campaign-form-ai-v403/before.json`. Preflight khóa hai prompt, hai binding và model; kiểm tra full-row checksum, số cấu hình theo code và metadata. Chỉ UPDATE `prompt_system`, giữ nguyên metadata khác. Không thêm schema/bảng/cột/RPC/connection/polling, không reload schema.

`scripts/campaign-form-ai-v403.cjs` dùng linked Management API HTTP hiện có; apply ghi history trong cùng transaction, không DDL chuẩn bị history. Apply yêu cầu SQL smoke và kết quả model candidate cùng checksum migration. So sánh toàn bộ model/binding và prompt ngoài phạm vi trước–sau.

Rollback tại `migrations/tests/migration_v403_campaign_form_ai_repeat_rollback.sql` chỉ khôi phục hai prompt cũ sau checksum nội dung mới/metadata/binding; không ghi đè bản chỉnh mới hơn. `rollback-smoke` diễn tập rồi ROLLBACK, giữ production ở V403. Script/snapshot của V400/V402 là lịch sử, không dùng để ghi đè prompt hiện tại.

## Kiểm chứng

- `node scripts/campaign-schedule-ai-smoke.cjs`: `ok` rỗng, giá trị trùng, JSON sai cấu trúc, `unclear` thật, capability, IPC/hủy/deadline/phiên đăng nhập.
- `node scripts/run-campaign-schedule-ai-ui-smoke.cjs`: form thật cho cả hai phần; Shift+Enter chèn newline mà không gọi AI, Enter gửi, mô tả trùng nhận kết quả rỗng vẫn đóng popover/mở khóa/giữ dữ liệu/không tự lưu. Giữ hồi quy nháp, múi giờ, mốc lặp, lỗi/hủy/timeout/đổi phiên và override phút.
- `node scripts/campaign-form-ai-v403-live.cjs --live`: 11 lượt model candidate, gồm nhập lại đúng câu người dùng, giữ nguyên, sửa riêng trường, thiếu thông tin và không hỗ trợ. Câu trùng giới hạn và câu trùng lịch đều gọi hai lần liên tiếp, đối chiếu toàn bộ trạng thái sau điền.
- `node scripts/campaign-form-ai-v403-live.cjs --live --applied`: gọi service thực với prompt DB, không override, kiểm tra nhập lại và yêu cầu cần làm rõ cho cả hai phần.
- Hai typecheck, production build, SQL smoke/rollback/history/checksum. Kết quả tổng hợp tại `docs/audits/campaign-form-ai-v403/verification.json`.
