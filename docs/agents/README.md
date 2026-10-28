# Tài liệu cho agent làm việc trên akaAgent

Đọc [AGENTS.md](../../AGENTS.md) mỗi khi bắt đầu task. Trước khi sửa hoặc review,
chọn các dòng liên quan dưới đây và đọc hợp đồng cùng audit được dẫn tới.
Task chạm nhiều phần phải đọc nhiều dòng; không cần nạp toàn bộ lịch sử.

## Chọn tài liệu theo phần việc

| Phạm vi task / đường dẫn | Tài liệu cần đọc |
| --- | --- |
| DB, RPC, RLS, auth, quyền hoặc rollout | [CURRENT_STATE](CURRENT_STATE.md); [connection](reference/database-01.md); [RPC/migration](reference/database-02.md); skill RPC trong AGENTS.md |
| Token, staff, device recovery, AI key, credentials | [CURRENT_STATE](CURRENT_STATE.md); [phạm vi credential và ngoại lệ SMS](CLIENT_CONTRACTS.md#sms-credentials); [data/auth/AI](reference/data-auth-ai-01.md); [Desktop token](../DESKTOP_SESSION_RLS.md); [device v3](../DEVICE_IDENTITY_V3.md); [AI proxy](../DESKTOP_AI_PROXY.md) |
| Quyền account/campaign hoặc chia sẻ nhóm | [ownership](../DESKTOP_ACCOUNT_CAMPAIGN_OWNERSHIP.md); [staff privacy](../DESKTOP_STAFF_SELF_ACCESS.md); [sharing revoke](../GROUP_SHARING_REVOKE_OWNERSHIP.md); [Data Group sharing](../GROUP_SHARING_V409.md) |
| Quyền thư viện contacts/content/media, settings, element/XPath, org/gói | [V436: phạm vi, ngoại lệ chia sẻ và admin](../DESKTOP_DATA_PRIVACY_V436.md); [CURRENT_STATE](CURRENT_STATE.md) |
| `src/main`, preload, shared IPC, renderer stores | [kiến trúc](reference/architecture-01.md); [IPC](reference/architecture-02.md); [renderer/editor](reference/architecture-03.md) |
| `src/main/v2`, Facebook/browser/login, nội dung và DOM | Các mục `browser-*` và `workflow-*` trong [chỉ mục](REFERENCE_INDEX.md); [engine v2](reference/workflow-01.md); skill C# khi có nguồn C# |
| Scheduler/campaign/runtime/quota/source/claim/recovery | `campaigns-*`, `action-results-*`, `media-*`, `pitfalls-*` trong [chỉ mục](REFERENCE_INDEX.md); [media timeout](reference/media-01.md); [kết quả explicit/legacy](reference/action-results-01.md) |
| Zalo QR/Web/Server, akaChat, listener, replay | [Desktop/WebApp và kết nối Chat](CLIENT_CONTRACTS.md#chat-routing); [subtype và runtime](reference/browser-04.md); [listener/replay](reference/pitfalls-04.md); [HTTP các repo](../CROSS_REPO_RLS_DEPLOY_20261028.md); tìm thêm tên service trong [chỉ mục](REFERENCE_INDEX.md) |
| Repository, Data Group, quét data, lọc/chọn/xuất | [data layer](reference/data-auth-ai-01.md); `campaigns-*`, `browser-*`, `pitfalls-*` theo feature; [bộ lọc cột](../DATA_COLUMN_FILTERS.md) |
| UI/form/log/status/content | [UI và log](reference/ui-logs-01.md); [IPC](reference/architecture-02.md); `campaigns-*`, `pitfalls-*` theo feature |
| Nhóm mẫu nội dung, picker/preview, `CampaignFormModal`, snapshot | [luồng chọn nhóm hiện tại](CLIENT_CONTRACTS.md#content-group-selection); [campaign/content](reference/campaigns-01.md); [pitfall và đính chính](reference/pitfalls-02.md) |
| Report/Automation/action status | [báo cáo](reference/reports-01.md); [kết quả hành động](reference/action-results-01.md); [hợp đồng report](../ACTION_STATUS_REPORTS.md) |
| akaBiz API/SMS/SQL import/Sheet/template/staff admin | [SQL Account](reference/integrations-01.md); [tích hợp/quản trị](reference/integrations-02.md); `browser-*`/`campaigns-*` theo sản phẩm |
| Build/package/update/release | [lệnh và native](reference/build-01.md); [updater](reference/build-02.md); [feed/version](reference/build-03.md); [CURRENT_STATE](CURRENT_STATE.md) |
| Docs, Git và tổ chức hướng dẫn | [MAINTENANCE](MAINTENANCE.md); [skill trước PR](../../.agents/skills/source-command-verify-pr/SKILL.md); [chỉ mục](REFERENCE_INDEX.md) |

## Tra cứu đủ ngữ cảnh

```bash
rg -n 'tên_file|tên_RPC|action_id|feature' docs/agents/reference docs/agents/history
```

Đọc đoạn phù hợp và audit/source được dẫn tới, không suy luận chỉ từ tên trong bảng.
[REFERENCE_INDEX](REFERENCE_INDEX.md) ánh xạ toàn bộ AGENTS.md cũ theo phần và dòng
nguồn; mỗi file chuyển có banner phân biệt ghi chú rollout lịch sử. Với file có
“Hướng dẫn hiện hành”, đọc ghi chú đó trước vùng `PRESERVED SOURCE`: đính chính
thay thế đúng câu/phạm vi được chỉ rõ, không huỷ những ràng buộc còn lại.
[CLIENT_CONTRACTS](CLIENT_CONTRACTS.md) giải quyết các khác biệt credential SMS,
Desktop/WebApp và chọn nhóm mẫu đã đối chiếu với code.

Các trạng thái cũ “anon chưa thu hồi”, “C chưa chạy”, “Desktop chưa phát hành” không
phải cho phép quay lại trạng thái đó. [CURRENT_STATE](CURRENT_STATE.md) giải quyết
các mốc đã xác nhận; ngoài bảng đó, đọc audit mới nhất và kiểm tra live nếu chuẩn
bị tác động production. Hợp đồng nghiệp vụ không bị bỏ chỉ vì được ghi cùng một
mốc lịch sử.

## Bảo toàn thông tin

- [Archive nguyên byte](archive/AGENTS-2026-10-28.txt) giữ đủ 1.050 dòng trước khi rút gọn, gồm ghi chú apply mới nhất chưa commit.
- [Manifest](reorganization-2026-10-28.json) lưu SHA-256 và phạm vi dòng của mọi phần chuyển; không có dòng nguồn bị bỏ hoặc gán trùng.
- Trong vùng `PRESERVED SOURCE`, reference chỉ sửa link tương đối để trỏ về cùng file trong repo; nội dung khác giữ nguyên. Đính chính hiện hành nằm ngoài vùng đó và không đổi checksum nội dung đã chuyển. Archive `.txt` giữ đường dẫn gốc tính từ repo root để đối chiếu.
- Audit feature và tài liệu bảo mật ngoài repo vẫn ở vị trí cũ; không nhập source/capture bảo mật trở lại Git.
