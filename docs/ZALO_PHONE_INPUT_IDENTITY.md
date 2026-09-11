# Cập nhật thông tin input chiến dịch

Code hiện tại và migration v274 cho phép cập nhật thông tin của input canonical
trong cả `direct` (“Thêm bằng nhóm”) và `data_group` (“Chọn nhóm data để chạy”).
**V274 đã áp dụng trên akachat lúc 13:27:14 ngày 11/09/2026 (UTC+7),
version `20260911054007`.**

V275 (`20260911063918`) đã áp dụng lúc 13:43:34 cùng ngày để sửa lỗi quyền
khi app lưu UID tìm được. Trigger dùng `normalize_phone` đã có quyền gọi,
thay cho helper nội bộ bị chặn với `anon`/`authenticated`; giữ nguyên kiểm tra
SĐT hợp lệ, quyền của các function và quy tắc không đổi đối tượng. Không cần
build lại app/server cho riêng v275.

Các trường `name`, `phone_carrier`, `info1…5`, `content`, `schedule`, `status`,
`note`, `date_action` được cập nhật. Các trường liên hệ khác được bổ sung khi
không phải trường xác định đối tượng của hành động:

| Hành động | Trường phải giữ nguyên | Thông tin có thể bổ sung |
|---|---|---|
| Gửi Zalo theo SĐT | `phone` | `uid`, `email` và thông tin mô tả |
| Thêm thành viên nhóm, input có SĐT hợp lệ | `phone` và UID đã có | Điền UID khi đang trống, `email` và thông tin mô tả |
| Thêm thành viên nhóm, input chạy theo UID | `uid`; không thêm SĐT hợp lệ để đổi cách chọn đối tượng | Email và thông tin mô tả |
| Gửi email | `email` | `phone`, `uid` và thông tin mô tả |
| Các hành động Facebook/Zalo chạy theo UID/link | `uid` | `phone`, `email` và thông tin mô tả |

Trường xác định đối tượng được giữ nguyên giá trị đã lưu, kể cả khi client chỉ
muốn đổi cách viết/định dạng. Input SĐT không hợp lệ không được dùng ngoại lệ
bổ sung UID. Input thường không có canonical key giữ hành vi chỉnh sửa cũ.

Không cho đổi `campaign_id`, `input_id`, `canonical_target_key`,
`auto_automation_detail_id` hoặc xoá input canonical. Key, alias và
`auto_campaign_input_origins.payload_snapshot` được giữ nguyên; không cập nhật
ngược nhóm data gốc. Không bổ sung màn hình chỉnh sửa mới.

Code scheduler lưu tên/UID tìm được từ SĐT cho cả gửi theo SĐT và thêm thành viên
nhóm, trên QR local, Web local và Server. Repository kiểm tra trước khi ghi;
trigger DB kiểm tra nguyên tử trên bản ghi hiện tại.

V274 bỏ trigger/function `aka_agent_release_changed_direct_input_identity()`
của v273 và bỏ đúng phần kiểm tra nhập lại phục vụ việc đổi đối tượng.
Các bản vá nhập nhóm trước v273, khóa/ownership/retry, quyền gọi và timeout
60 giây của snapshot được giữ nguyên. Khi chỉ sửa thông tin mô tả/trạng thái,
guard không cần truy vấn campaign. Không còn bước DELETE alias trong UPDATE.

## Mã nguồn và kiểm thử

- [Migration v274](../migrations/migration_v274_campaign_input_information_updates.sql):
  định nghĩa, source/target checksum và preflight chống ghi đè thay đổi live.
- [Repository](../src/main/data/repositories/campaignRepository.ts),
  [scheduler](../src/main/services/campaignScheduler.ts).
- `node scripts/zalo-phone-input-identity-smoke-test.cjs`: hai chế độ, bảy loại
  hành động, QR/Web/Server, bổ sung thông tin, chặn đổi đối tượng và kiểm tra quyền.
- [SQL information smoke](../migrations/tests/migration_v274_campaign_input_information_smoke.sql):
  hai chế độ, năm action, bảo vệ đối tượng/tham chiếu, giữ alias/origins.
- [SQL reimport smoke](../migrations/tests/migration_v274_input_information_reimport_smoke.sql):
  nhập lại giữ thông tin đã sửa, chống trùng, retry và runtime ownership.
- [SQL caller-role smoke v275](../migrations/tests/migration_v275_canonical_input_phone_guard_permissions_smoke.sql):
  UPDATE thực tế bằng `anon`, `authenticated`, `service_role` cho hai chế độ và
  năm action; kiểm tra tên/UID đã lưu, khóa đối tượng và tham chiếu. Kiểm thử bằng
  `postgres` hoặc API chỉ đọc không thay thế được kiểm thử quyền ghi này.

Hai SQL smoke dùng transaction ROLLBACK. Trên DB còn dùng v273, phải stage
migration v274 trong cùng transaction trước khi chạy smoke. Typecheck node/web,
build desktop và build Server Windows kiểm tra bản code tương ứng.

V272/v273 và smoke lịch sử được giữ nguyên để đối chiếu phiên bản đã áp dụng.
Triển khai hành vi mới cần cả migration v274 và app mới; bộ cài Server đã build
không đồng nghĩa đã cài hoặc phát hành. Chưa chạy chiến dịch gửi Zalo thật.
