# AI điền Giới hạn hành động — V402

Đã apply trên **akachat** ngày **15/10/2026, 00:22:26 giờ Việt Nam**, history `20261014172226 / migration_v402_campaign_action_limits_ai`. Prompt **52**, binding **50**, model **21**. Không apply lại khi phát hành Desktop; Desktop đã build local, chưa đóng gói/phát hành.

Tiếp theo [V403](CAMPAIGN_FORM_AI_REPEAT_V403.md): Enter gửi, **Shift+Enter xuống dòng**; yêu cầu đã khớp form vẫn thành công. Prompt V402 và snapshot bên dưới là lịch sử, không dùng để ghi đè prompt hiện tại.

Icon Sparkles cạnh **Giới hạn hành động** mở popover bằng hover, click hoặc bàn phím. Chỉ nút **Điền giới hạn** hoặc Enter thường mới gọi AI. Enter thường không xuống dòng; bỏ qua Enter xác nhận bộ gõ/giữ phím. Thành công điền form rồi tự đóng popover, không preview và không tự lưu/chạy chiến dịch.

## Phạm vi điền

- Thời gian nghỉ giữa hai lần gửi, theo giây, khi control hiện có.
- Giới hạn ngày, số lượt và độ dài cửa sổ theo phút của từng hành động đang hiện **trong phần Giới hạn hành động**.
- Tiếp tục các hành động còn có thể chạy khi một hành động đạt giới hạn.
- Số bài cần comment trên mỗi group/page/profile của loại comment seeding feed.

Không sửa cấu hình hành động khác phần này, hành động đang tắt/ẩn, cấu hình nhóm tài khoản, lịch, nội dung, người nhận hoặc các phần khác. Ví dụ giới hạn comment riêng trong phần nội dung của chiến dịch đăng bài group không nằm trong allowlist của phần Giới hạn hành động. Giới hạn tìm SĐT ẩn cũng không gửi tới AI.

Prompt DB hướng dẫn hiểu ngữ nghĩa và ngữ cảnh, số viết bằng chữ, tăng/giảm, phủ định và đổi đơn vị; không có bảng câu mẫu trong runtime. Trường không được nhắc đến giữ nguyên. Không coi khoảng nghỉ là cửa sổ hạn mức; không coi số 0 là bỏ hạn mức ngày/giờ hoặc công tắc tiếp tục là bỏ qua hạn mức. Mô tả không xác định được hành động/số lượng cần thiết trả câu hỏi cụ thể; ngoài khả năng control trả giới hạn tương ứng. Không điền một phần của yêu cầu không hỗ trợ.

Main kiểm tra request, allowlist và cấu trúc JSON strict; số nguyên phải đưa được vào control. Không sao chép kiểm tra nghiệp vụ vào parser AI. Form dùng clamp gói quyền giống nhập tay, và xử lý số bài/độ dài cửa sổ theo luồng hiện có. Khi AI sửa số phút, đánh dấu override và mở control số phút: Lưu nháp rồi tạo chiến dịch vẫn dùng giá trị AI thay vì quay về mặc định của tài khoản. AI chỉ nhận snapshot số liệu form và nhãn hành động; không gửi ID/tên tài khoản, usage logs, nội dung, credential hay nhóm data.

## Trạng thái và tài nguyên

Lịch chạy và Giới hạn hành động dùng chung `CampaignFormAiPopover` và bộ xử lý main `campaignFormAiHandlers`. Mỗi Desktop window tối đa một flight cho cả hai phần. Kênh hủy chỉ hủy flight đúng phần và đúng request/session. Deadline 120 giây ở cả main/renderer, mô tả tối đa 2.000 ký tự, không retry tự động. Hover/focus không gọi AI. Chỉ một popover AI mở tại một thời điểm.

Khóa form, nút lưu/lưu nháp và ô nhập khi chờ; vẫn hủy hoặc đóng form được. Lỗi giữ mô tả/lịch/hạn mức, mở khóa control. Đóng/hủy/đổi phiên bỏ kết quả muộn; đăng xuất/hết phiên/shutdown dùng các hook stop hiện có. Hai trạng thái busy riêng ở renderer được gộp để không mở khóa nhầm khi phần còn lại đang chạy.

## DB và rollback

V402 chỉ INSERT một prompt và một binding `app_campaign_action_limits`, dùng lại model ID 21 `gpt-6.1-sol`, timeout 120 giây, `store:false`, logger `ai_log` hiện có. Giữ nguyên prompt/binding Lịch chạy V399/V400 và mọi model/cấu hình AI khác. Không thêm bảng/cột/RPC/ACL/SQL client/connection/polling, không reload schema.

Migration `migrations/migration_v402_campaign_action_limits_ai.sql` có preflight kiểm tra chưa tồn tại feature và checksum model live. Script `scripts/campaign-limits-ai-v402.cjs` thực thi qua linked Management API HTTP, INSERT history trong cùng transaction, không DDL chuẩn bị history. Apply yêu cầu SQL smoke và model smoke đúng checksum migration. Không dùng lại V401 vì version đó thuộc Web enrichment.

Rollback vận hành `migrations/tests/migration_v402_campaign_action_limits_ai_disable.sql` kiểm tra prompt/binding/model rồi tắt riêng binding, giữ prompt và log. `rollback-smoke` diễn tập trong transaction rồi rollback, production giữ bật. Snapshot/hash/history: `migrations/snapshots/campaign-limits-ai-v402/`.

## Kiểm chứng

- `node scripts/campaign-schedule-ai-smoke.cjs`: hồi quy lịch/IPC, thêm JSON/type/allowlist của giới hạn, giữ trường, lý do cần làm rõ, hủy khác kênh không tác động, chặn hai phần gửi đồng thời, timeout/session.
- `node scripts/run-campaign-schedule-ai-ui-smoke.cjs`: form thật, hồi quy lịch/nháp/múi giờ/mốc lặp, sau đó các ca Giới hạn hành động. Có thể chạy riêng phần mới với `--limits-only`.
- `scripts/campaign-limits-ai-ui-checks.cjs`: hover/Enter/IME, một popover, khóa/mở form, ngày/giờ/phút, khoảng nghỉ, tiếp tục, số bài, lọc comment ngoài phần đang sửa, lỗi/hủy/timeout/đóng/đổi phiên, không tự lưu, Lưu nháp → tạo chiến dịch giữ override phút.
- `node scripts/campaign-limits-ai-live-smoke.cjs --live`: 14 ca qua model thật trước apply. Candidate dùng transport binding Lịch chạy hiện có với system/user override **chỉ trong script**, không đổi prompt đang chạy. Đầu vào tổng hợp, không ID khách hàng. Sau apply dùng `--live --applied`: 4 ca qua service Giới hạn thực, không override.
- Hai typecheck và production build; SQL rollback transaction, disable rehearsal, checksum/history và Data API. Kết quả tại `docs/audits/campaign-limits-ai-v402/verification.json`. Desktop chưa đóng gói/phát hành.

Kết quả: 14 ca candidate và 4 ca sau apply qua model thật đạt; các smoke shared/IPC, hồi quy form Lịch chạy, form Giới hạn, hai typecheck/build, SQL/API/rollback và kiểm tra giao diện sáng/tối đạt. Kiểm thử đối chiếu trạng thái sau điền: giá trị đã khớp yêu cầu được giữ nguyên bằng null cũng hợp lệ, không bắt AI gửi lại một giá trị không thay đổi.
