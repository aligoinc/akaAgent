# AI điền giới hạn: khung phút khác nhau và phiên Web — V405

Đã sửa local ngày 15/10/2026 cho akaAgent Desktop và akaAgentWebApp. Prompt DB đã apply; các bản sửa ứng dụng chưa đóng gói/phát hành hoặc deploy.

## Hai lỗi được sửa

1. Form tạo chiến dịch chọn nhiều tài khoản có khung phút khác nhau (ví dụ 30 và 60), chưa chỉnh khung chung, vẫn kế thừa từng tài khoản khi lưu. Snapshot AI trước đây lại gửi một giá trị mặc định 65, khiến AI hiểu sai yêu cầu tương đối. Lỗi có ở cả Desktop và Web.
2. Web nhận `/me` với `session.id` mới nhưng cùng staff/org không đổi revision phiên của form. Kết quả AI từ phiên cũ có thể được điền. Desktop đã có guard credential ở main, không cần sửa phần phiên Desktop.

## Hợp đồng sau sửa

- Snapshot action gửi `rateLimitMinutes: null` và `rateLimitMinuteValues: [30, 60]` khi chưa có khung chung. Danh sách loại trùng và sắp tăng; validator chỉ nhận số nguyên an toàn, ít nhất hai giá trị khác nhau, tối đa 1.000 phần tử. Đây là metadata đầu vào, không thêm trường vào JSON Schema đầu ra.
- Form đã lưu/nhân bản, đã chỉnh phút hoặc các tài khoản cùng một khung tiếp tục gửi số nguyên như trước. Chỉ sửa số lượt thì giữ các khung riêng qua luồng Lưu; AI chỉ định rõ một khung chung mới đánh dấu đã chỉnh và áp dụng chung.
- Prompt hiểu giá trị thực, không chọn 65 hoặc một đại diện tùy ý. Yêu cầu tương đối có một kết quả chung vẫn được điền. Yêu cầu cần thay đổi riêng từng tài khoản trả `unsupported` vì control hiện tại chỉ hỗ trợ một khung chung; ý định thiếu căn cứ mới trả `unclear`.
- Client Web giữ public `session.id` có sẵn từ `/me` trong `ControlUser.sessionId`. Auth scope gồm org/staff/session; nhận phiên mới qua luồng refresh hiện có sẽ tăng revision, hủy request và bỏ kết quả muộn. Refresh cùng phiên không hủy AI. Không gửi token ra form, không thêm polling.
- Không thay validation nghiệp vụ khi Lưu, lịch chạy, dữ liệu chiến dịch hay cơ chế kết nối.

## Migration đã apply

Canonical: `migrations/migration_v405_campaign_limits_mixed_windows.sql`.

- Project: akachat (`cgjbsmqtfhqvttudyjzq`). History: `20261014193235 / migration_v405_campaign_limits_mixed_windows` (15/10/2026 giờ Việt Nam).
- Chỉ cập nhật `ai_prompt.id=52.prompt_system` của `app_campaign_action_limits`; giữ binding `ai_using.id=50`, model `gpt-6.1-sol` ID 21 và tất cả prompt khác. Client cũ gửi phút dạng số nguyên vẫn tương thích.
- Transaction có row lock, timeout, preflight checksum toàn dòng và kiểm tra binding/model; verify nội dung sau UPDATE. Apply qua SQL và ghi history hiện có trong cùng transaction; không DDL phụ, RPC, bảng/cột mới, reload schema, connection hay polling.
- SQL SHA-256: `5c9da174866e6371039638394b6614a8a376a16d92b55bae4d77651ff975620c`; MD5 statement trong history khớp file: `3605ff43c8d472fa5d846b94df72c45d`.
- MD5 toàn dòng prompt: trước `851310707eef1f972089e634ee859024`, sau `920d73f8af472921dfc1ff5ec6a2ffe8`. Hash model, binding và các prompt khác không đổi.
- Snapshot và bằng chứng: `migrations/snapshots/campaign-limits-mixed-v405/`.

Không apply lại khi merge/phát hành. Rollback có guard checksum tại `migrations/tests/migration_v405_campaign_limits_mixed_windows_rollback.sql`; đã diễn tập trong transaction kết thúc bằng ROLLBACK và xác nhận V405 vẫn live. Chỉ rollback prompt nếu các client mới đã được rollback hoặc tác động tới metadata mixed đã được đánh giá; không xóa history đã apply.

## Kiểm chứng

- Desktop: hai typecheck `tsconfig.node.json` / `tsconfig.web.json`, production build, `node scripts/campaign-schedule-ai-smoke.cjs` và Electron UI `node scripts/run-campaign-schedule-ai-ui-smoke.cjs --mixed-only` đạt. UI thực kiểm tra snapshot 30/60, sửa số lượt vẫn kế thừa, đổi chung 45 và không tự lưu.
- Web: typecheck bảy workspace, production build đạt. Campaign-core 66 tests và control-client 44 tests đạt; API form-AI 7 tests, Web popover/auth/session 10 tests đạt. Test mapper xác nhận Lưu vẫn tạo 30/60 khi chỉ sửa số lượt, hoặc 45/45 khi chỉ định khung chung.
- Test phiên dùng AuthProvider và client normalization thực: đổi session cùng user hoặc khác user đều hủy/bỏ response muộn; refresh bình thường giữ request.
- Web production preview: `apps/web/e2e/campaign-form-ai.spec.ts` đạt 3/3 trên Desktop Chromium, Android Chromium và iPhone WebKit, gồm snapshot mixed từ hai tài khoản thật trong fixture, Enter/Shift+Enter, khóa form, lỗi/hủy/đóng, không tự lưu và dark/light.
- Model thật qua runtime hiện có: 6/6 ca candidate và 2/2 ca sau apply đạt, gồm giữ nguyên, chỉ đổi số lượt, đặt 45 phút, tăng gấp đôi từng khung, chọn giá trị chung từ ngữ cảnh và client cũ nhập lặp lại. Chỉ dùng dữ liệu giả lập; log ở `ai_log` hiện có, không tạo/chạy chiến dịch hoặc gửi tin.
- Lệnh tái hiện model thật có tính phí: `node scripts/campaign-limits-mixed-v405-live.cjs --live` (đọc hướng dẫn trong script để chọn candidate/applied). Không chạy mặc định trong smoke.

Web cần deploy cả API/parser mới và Web snapshot mới cùng đợt; API mới nhận cả payload cũ và mới. Desktop cần phát hành bundle mới để gửi metadata đúng. Prompt live tự nó không sửa snapshot từ app cũ.
