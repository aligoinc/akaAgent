# Rà soát các luồng còn phụ thuộc trạng thái bận của tài khoản

Cập nhật: các lỗi bên dưới đã được sửa và áp dụng bằng [v288](CONTROL_CAMPAIGN_QUEUE_DATA.md), gồm kiểm thử nhóm có dữ liệu và bundle hai campaign. Phần dưới giữ lại bằng chứng audit trước bản sửa.

Ngày 20/09/2026, sau khi v287 đã được áp dụng. Đọc code WebApp, đối chiếu exact live function definitions trên linked production `akachat` / `cgjbsmqtfhqvttudyjzq`, rồi dùng fixture trong transaction rollback để kiểm tra. Không thay đổi thêm hàm/dữ liệu production trong lượt rà soát này; không gửi tin nhắn.

## Các lỗi phát hiện trước v288

| Thao tác | Kết quả khi tài khoản hợp lệ đang bận |
| --- | --- |
| Thêm data trực tiếp/import | `add_control_campaign_input_rows` trả `not_found`, inserted=0. |
| Tạo mới/nhân bản qua form/tạo từ nháp có data trực tiếp | Tạo campaign thành công nhưng bước nạp data từng lô dùng RPC thêm data phía trên và thất bại. Không thể coi toàn bộ luồng tạo từ form đã được sửa chỉ vì RPC tạo thành công. |
| Gắn/đổi nguồn Nhóm data | Preflight trả `allowed=false, reason=data_group_campaign_account_not_found`; bind trả cùng lỗi. Khi fixture account chuyển về chờ xử lý, preflight/bind thành công. |
| Tiếp tục nhận data từ Nhóm data | Reactivate trả `data_group_campaign_terminal` dù chiến dịch fixture đang tạm dừng và nguồn chỉ đang stopped. |
| RPC append cũ | `append_control_campaign_inputs` cũng trả `not_found`; không tìm thấy caller trong code WebApp/Desktop hiện tại. Cần tính đến tương thích nếu sửa tiếp. |

Tổng cộng 5 core RPC còn giữ điều kiện `account.status IN ('chờ xử lý', 'tạm dừng')`. Các wrapper credentialed của Nhóm data gọi vào core tương ứng nên chịu cùng ảnh hưởng. Những guard này khác với kiểm tra chính chiến dịch đang chạy; không được xoá guard runtime/claim để sửa lỗi cấu hình.

## Các luồng kiểm tra không gặp lỗi cùng loại

- Sửa đầy đủ, sửa nhanh, đổi tài khoản, thay tài khoản cũ bị xoá: dùng update core đã sửa trong v287; smoke v287 đã qua trước/sau apply.
- RPC tạo mới/core/v2: tạo khi account bận thành công. Đây chỉ là bước tạo record; xem nhánh nạp data phía trên.
- Tạm dừng/tiếp tục chiến dịch: RPC status trả ok=true trên fixture account bận.
- Chạy lại dòng data: update input statuses thành công, updated_count=1.
- Xoá chiến dịch đang tạm dừng: deleted=true dù account bận.
- Snapshot Nhóm data một lần vào campaign direct: gọi đúng service-role JWT context, fixture nhóm rỗng trả thành công khi account bận. Test này xác nhận không bị chặn bởi account busy; không chứng minh mọi kiểu dữ liệu snapshot đều đúng.
- Nhân bản qua API `/clone` dùng create-with-inputs, khác với menu Nhân bản trên UI mở lại CampaignFormPage rồi nạp data từng lô.

## Bằng chứng luồng gọi

- `akaAgentWebApp/packages/control-client/src/index.ts:952`: tạo form ghi input theo lô bằng POST `/campaigns/:id/inputs`.
- `akaAgentWebApp/apps/api/src/modules/aka-agent-control/aka-agent-control.repository.ts:1501`: endpoint thêm data gọi `add_control_campaign_input_rows`.
- `akaAgentWebApp/apps/web/src/features/CampaignDraftFormPage.tsx:16`: tạo từ nháp dùng lại form create/clone.
- `akaAgentWebApp/apps/web/src/features/CampaignsPage.tsx:1175`: menu Nhân bản mở `/campaigns/:id/clone`.
- `akaAgentWebApp/apps/api/src/modules/aka-agent-control/aka-agent-control.dataGroups.ts`: preflight/bind/reactivate dùng các RPC core có guard cũ.

## Exact signature/checksum đã capture

| Signature | Source checksum |
| --- | --- |
| `public.add_control_campaign_input_rows(bigint,bigint,bigint,text,integer,jsonb,timestamptz,text)` | `49005ecea81255f4a3bebd747513e6ef` |
| `public.append_control_campaign_inputs(bigint,bigint,bigint,text,integer,jsonb)` | `39d62e473f8d85452901cf2fe9f2c483` |
| `public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)` | `d3b0ec9f53d3b41102dd7b69ec3b2a3b` |
| `public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint)` | `abc77805588d2b86c8f7dc41e9d6fafc` |
| `public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)` | `ae62b6c0b3064ad37da3d9b5411bae25` |

Tại thời điểm audit chưa có target checksum và chưa apply thêm RPC. Target checksum/apply/kiểm thử sau đó được ghi trong [hồ sơ v288](CONTROL_CAMPAIGN_QUEUE_DATA.md). Owner/security/volatility/config/ACL của các RPC được capture cùng định nghĩa live để phục vụ bản sửa tiếp theo; mọi thay đổi tiếp theo phải capture lại và kiểm tra preflight theo skill migration.

Reproduction: [SQL audit](../migrations/tests/control_campaign_busy_account_audit.sql). Chỉ tạo account/campaign/group/input giả lập chưa commit, cuối cùng ROLLBACK. Cả điều kiện lỗi và ca đối chứng idle đã được chạy. Một lần thử snapshot ban đầu thiếu PostgREST JWT context nên trả automation_auth_required; đã bổ sung service-role claim đúng với backend và xác minh snapshot thành công. Không coi lỗi thiếu context test là lỗi ứng dụng.

Đây là rà soát nhóm lỗi account busy trong các đường gọi nêu trên, không phải chứng nhận toàn bộ hệ thống không còn lỗi. Chưa thử request UI qua browser, bundle nhiều campaign của Nhóm data, nhóm có dữ liệu thực hoặc concurrency giữa hai kết nối. V287 trước đó chỉ kiểm thử append nằm trong RPC update; nó chưa kiểm thử endpoint thêm data độc lập và các RPC nguồn Nhóm data, nên các nhánh này tiếp tục bị bỏ sót.
