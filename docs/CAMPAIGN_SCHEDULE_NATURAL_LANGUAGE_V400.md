# Hiểu mô tả lịch tự nhiên — V400

Tiếp theo [V403](CAMPAIGN_FORM_AI_REPEAT_V403.md): yêu cầu đã khớp form vẫn thành công, không hỏi lại chỉ vì không có thay đổi. Giữ khả năng hiểu ngữ nghĩa bên dưới; không dùng verify/rollback V400 để ghi đè prompt mới.

Đã apply trên **akachat** ngày **15/10/2026, 00:05:29 giờ Việt Nam**, history `20261014170529 / migration_v400_campaign_schedule_natural_language`. **Không apply lại.** Desktop đã build local, chưa đóng gói/phát hành.

V400 chỉ cập nhật `ai_prompt.id=49` (`app_campaign_schedule`). Giữ binding 47, model 21 `gpt-6.1-sol`, schema JSON strict, IPC, deadline 120 giây và logger hiện có. Desktop bổ sung lý do cần làm rõ vào thông báo `unclear`; lý do có giới hạn 300 ký tự và hiển thị dạng văn bản.

## Hành vi

Prompt hướng dẫn AI hiểu ý định và ngữ cảnh, không chứa bảng quy đổi buổi/ngày, bộ từ khóa hoặc danh sách câu được hỗ trợ. Mô tả bằng lời, số viết bằng chữ, cách nói khái quát, ý phủ định và sửa riêng một phần đều được diễn giải theo ngữ nghĩa. Khi đủ rõ, AI chọn mốc đại diện hợp lý để điền; khi thực sự thiếu căn cứ hoặc còn các lựa chọn loại trừ nhau, AI hỏi đúng phần cần làm rõ. Đây là kết quả để người dùng kiểm tra trong form trước khi Lưu, không bảo đảm hiểu mọi cách diễn đạt.

Phân biệt đặt lịch khác và sửa một phần lịch hiện tại: lịch theo ngày cụ thể không có ý lặp tuần/tháng chuyển sang chế độ ngày; chỉ sửa giờ/ngày bắt đầu hoặc yêu cầu giữ chu kỳ thì giữ lịch tuần/tháng. Trường không được yêu cầu vẫn giữ, kể cả ngày kết thúc cũ và dữ liệu đang ẩn. Không tự bật làm mới data vì yêu cầu lặp lịch. Chế độ ngày không phải cam kết chạy đúng một lần; yêu cầu vượt khả năng form phải được giải thích thay vì âm thầm bỏ điều kiện.

Các câu và giá trị kỳ vọng chỉ nằm trong script kiểm thử. Main/renderer không có bộ dò ngôn ngữ, không ghép thêm chỉ dẫn vào prompt DB. Success vẫn đóng popover; Enter gửi, không xuống dòng; không tự lưu/chạy. Lỗi giữ mô tả/lịch và mở khóa form. Kiểm tra quan hệ ngày/giờ, mốc `23:59` và các kiểm tra nghiệp vụ khác vẫn ở nút Lưu.

## Triển khai và rollback

Migration: `migrations/migration_v400_campaign_schedule_natural_language.sql`. Preflight fail-closed đối chiếu checksum snapshot live của prompt/binding/model trước khi sửa, khóa đúng các hàng cấu hình. Chỉ cập nhật `prompt_system`; metadata khác được kiểm tra lại. Không schema, bảng, cột, RPC, ACL, connection hoặc polling mới; không reload schema.

Script `scripts/campaign-schedule-ai-v400.cjs` dùng linked Management API HTTP đang có. History được INSERT trong cùng transaction với prompt, không chạy DDL chuẩn bị history. Snapshot chỉ lưu prompt/binding và checksum model, không lưu API key. Đường apply yêu cầu smoke SQL và kết quả model thử đúng checksum migration hiện tại; chặn history V400 trùng. Kiểm tra trước/sau giữ nguyên toàn bộ model, binding và prompt khác.

Rollback vận hành: `migrations/tests/migration_v400_campaign_schedule_natural_language_rollback.sql`. Guard checksum prompt V400 và metadata trước khi khôi phục nội dung prompt live đã chụp từ V399; giữ log/binding/model/history. Không chạy lại migration V399. Lệnh `rollback-smoke` chỉ diễn tập rollback trong transaction rồi ROLLBACK, giữ production ở V400.

## Kiểm chứng

- `node scripts/campaign-schedule-ai-v400-live.cjs --live`: đọc candidate trực tiếp từ migration, dùng `systemPromptOverride` chỉ trong script để thử qua runtime/model/logger HTTP hiện có trước khi thay DB. Dữ liệu tổng hợp, không dùng ID khách hàng/tài khoản/chiến dịch. Không tự retry.
- `node scripts/campaign-schedule-ai-v400-live.cjs --live --applied`: đọc prompt DB qua runtime thực, gồm service tạo lịch thực. Không override prompt ở bước này. Cả 4 tình huống sau apply đạt: lịch tháng bằng lời, hôm nay chuyển sang lịch ngày, chỉ sửa giờ giữ chu kỳ và thông báo cần chọn một giờ.
- 22 tình huống candidate qua model thật đã đạt. Ma trận gồm câu trưa/đầu/giữa tháng, sáng khái quát, đầu giờ chiều, thứ/giờ viết bằng chữ, sửa riêng giờ/ngày, lùi ngày tương đối, giữ chu kỳ, qua năm, nhiều khung giờ, phủ định, nguồn Nhóm data, giới hạn loại chiến dịch, giới hạn chạy một lần và câu cần làm rõ.
- `node scripts/campaign-schedule-ai-smoke.cjs`: JSON/capability/IPC và lý do `unclear` được chuyển tới renderer; reason thiếu dùng fallback, quá dài/patch kèm lỗi vẫn bị từ chối.
- `node scripts/run-campaign-schedule-ai-ui-smoke.cjs`: form thật kiểm tra lý do hiển thị, giữ mô tả/lịch và mở khóa; chuyển tháng → ngày, sửa giờ giữ tháng/ngày kết thúc, giữ giá trị ẩn; hồi quy Enter/đóng popover/hủy/deadline/auth/nháp/múi giờ/mốc lặp và nghiệp vụ chỉ ở Save.
- Hai typecheck (`tsconfig.node.json`, `tsconfig.web.json`) và production build. Không đóng gói/phát hành Desktop trong đợt này.

Kết quả và history chính xác được lưu tại `migrations/snapshots/campaign-schedule-ai-v400/`; trạng thái kiểm chứng Desktop tại `docs/audits/campaign-schedule-ai-v400/verification.json`.

SQL trong transaction rồi rollback, diễn tập rollback vận hành và đối chiếu config/history live đều đạt. Toàn bộ model/binding/prompt khác giữ nguyên. Hai typecheck, production build và các smoke Desktop nêu trên đạt.
