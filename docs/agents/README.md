# Tài liệu cho agent làm việc trên akaAgent

Đọc [AGENTS.md](../../AGENTS.md) mỗi khi bắt đầu task. Trước khi sửa hoặc review,
chọn các dòng liên quan dưới đây và đọc hợp đồng cùng audit được dẫn tới.
Task chạm nhiều phần phải đọc nhiều dòng; không cần nạp toàn bộ lịch sử.

## Chọn tài liệu theo phần việc

| Phạm vi task / đường dẫn | Tài liệu cần đọc |
| --- | --- |
| Tách quyền akaAgent/akaChat, product 5, quota riêng, local reader, app_access | [Hợp đồng](../APP_ACCESS_SPLIT.md); [audit triển khai](../audits/app-access-split/README.md); [V447 đã kích hoạt, chỉ roll forward](../audits/app-access-split/ACTIVATION_20261103.md); [V448/query performance đã triển khai](../audits/app-access-split/PERFORMANCE_FIX_20261103.md); [V449 chia sẻ khi chủ khóa/hết hạn đã apply](../audits/app-access-split/SHARED_OWNER_FIX_20261103.md); [V450 cấp/bật lại Chat Server đã apply](../audits/app-access-split/SHARED_OWNER_GRANT_FIX_20261103.md); [V451 canonical identity đã apply](../audits/app-access-split/CANONICAL_IDENTITY_FIX_20261103.md) |
| Hết hạn gói/dùng thử khi đăng nhập, màn Gia hạn nhúng cổng CRM `/gia-han`, Edge `renewal_link`, link Lấy lại tài khoản/Đăng ký dùng thử, V460 | [Hợp đồng, bản vá Edge riêng và trạng thái](../RENEWAL_PORTAL_DESKTOP.md); [cấu hình màn đăng nhập](../LOGIN_SCREEN_SETTINGS.md); giữ khóa ký ở server, không đưa link/mật khẩu qua renderer |
| Trung tâm thông báo, worker email/push, V457/V458, rollout Web/API | [Hợp đồng](../NOTIFICATION_CENTER.md); [đã deploy PR #149, live và test end-to-end 04/11](../audits/notification-center-20261104/README.md); trigger và hai cron email cũ đã tắt, mobile/APNs để sau |
| DB, RPC, RLS, auth, quyền hoặc rollout | [CURRENT_STATE](CURRENT_STATE.md); [connection](reference/database-01.md); [RPC/migration](reference/database-02.md); skill RPC trong AGENTS.md |
| Token, staff, device recovery, Windows đọc hardware chậm/timeout 30 giây, AI key, credentials | [CURRENT_STATE](CURRENT_STATE.md); [phạm vi credential và ngoại lệ SMS](CLIENT_CONTRACTS.md#sms-credentials); [data/auth/AI](reference/data-auth-ai-01.md); [Desktop token](../DESKTOP_SESSION_RLS.md); [device v3](../DEVICE_IDENTITY_V3.md); [AI proxy](../DESKTOP_AI_PROXY.md) |
| Quyền account/campaign hoặc chia sẻ nhóm | [ownership](../DESKTOP_ACCOUNT_CAMPAIGN_OWNERSHIP.md); [staff privacy](../DESKTOP_STAFF_SELF_ACCESS.md); [sharing revoke](../GROUP_SHARING_REVOKE_OWNERSHIP.md); [Data Group sharing](../GROUP_SHARING_V409.md) |
| Quyền thư viện contacts/content/media, settings, element/XPath, org/gói | [V436: phạm vi, ngoại lệ chia sẻ và admin](../DESKTOP_DATA_PRIVACY_V436.md); [CURRENT_STATE](CURRENT_STATE.md) |
| `src/main`, preload, shared IPC, renderer stores | [kiến trúc](reference/architecture-01.md); [IPC](reference/architecture-02.md); [renderer/editor](reference/architecture-03.md) |
| `src/main/v2`, Facebook/browser/login, nội dung và DOM | Các mục `browser-*` và `workflow-*` trong [chỉ mục](REFERENCE_INDEX.md); [engine v2](reference/workflow-01.md); skill C# khi có nguồn C# |
| Chia sẻ bài nguồn vào nhóm/trang cá nhân, Reel không có dialog, element 257, block 36/2835 | [XPath hoàn chỉnh đã live 03/11, source/V455 đồng bộ 04/11](../FACEBOOK_NATIVE_GROUP_SHARE.md#share-xpath-20261103); không ghép thêm parent vào 257, không tái sinh migration lịch sử từ source hiện hành |
| Zalo album + chữ tới người lạ (lỗi 127); mã 122/120/802 khi nhắn người lạ; "Nghỉ giữa 2 lần" sau mục tiêu thất bại, tra số `221`; gửi lại mục tiêu đã hỏng, lỗi tạm thời đốt mục tiêu; comment sau đăng nhóm (`fb_comment_box_at_n`), nút comment newsfeed/quét data (element 1692/1489), nút Like newsfeed/dialog (1691/1132); `Không tìm thấy ô đăng bài` | [điều tra và cập nhật XPath 01–02/11/2026: số liệu, cơ chế, phần chưa xác minh](../CUSTOMER_REPORTS_ZALO_ALBUM_FB_GROUP_20261101.md) |
| Kiểm tra gửi trùng/cooldown, tra UID/SĐT/SMS, `aka_agent_apply_campaign_delivery_cooldown` | [V431 và tra người nhận bằng index đã apply 28/10](../COOLDOWN_HISTORY_V431.md); giữ lịch sử xóa mềm/guard Desktop, không apply lại; đổi `normalize_phone` phải rebuild index SĐT |
| Scheduler/campaign/runtime/quota/source/claim/recovery | `campaigns-*`, `action-results-*`, `media-*`, `pitfalls-*` trong [chỉ mục](REFERENCE_INDEX.md); [media timeout](reference/media-01.md); [kết quả explicit/legacy](reference/action-results-01.md) |
| Facebook chạy ngẫu nhiên AI, checkbox/ẩn Tải lại, phân lượt campaign, deadline/retry, giới hạn cũ, lease/UI và cách ly luồng chạy thường | [Hợp đồng V444](../FACEBOOK_RANDOM_AI_V442.md); [audit V444 đã apply DB, app chưa phát hành](../audits/facebook-random-ai-v442/README.md); giữ lifecycle/quota/ownership hiện hành |
| Zalo QR/Web/Server, akaChat, listener, replay | [Desktop/WebApp và kết nối Chat](CLIENT_CONTRACTS.md#chat-routing); [subtype và runtime](reference/browser-04.md); [listener/replay](reference/pitfalls-04.md); [HTTP các repo](../CROSS_REPO_RLS_DEPLOY_20261028.md); tìm thêm tên service trong [chỉ mục](REFERENCE_INDEX.md) |
| Đồng bộ lịch sử Zalo Server, V437–V438 | [trạng thái và nguồn canonical ở Chat API/Web](../ZALO_MESSAGE_SYNC_V437_20261030.md); giữ phone-only date filter, disk admission và worker receipt |
| Mốc ngày/cờ hiển thị đồng bộ theo tổ chức, V440 | [UI rollout V440](../ZALO_MESSAGE_SYNC_UI_V440_20261030.md); đã apply/deploy API/Web, không đổi backend range/runtime |
| Trigger Context khi nhập lịch sử Zalo, V439 | [bỏ qua nguồn old và receipt](../CONTEXT_ZALO_HISTORY_TRIGGER_V439_20261030.md); giữ realtime, job hiện có và các luồng thu thập độc lập |
| Repository, Data Group, quét data, lọc/chọn/xuất | [data layer](reference/data-auth-ai-01.md); `campaigns-*`, `browser-*`, `pitfalls-*` theo feature; [bộ lọc cột](../DATA_COLUMN_FILTERS.md); [Tên/Tên gốc Zalo V441](../ZALO_SCAN_NAMES_V441.md) |
| Thêm chiến dịch bằng Agent, `CampaignAgentFormModal`, chat/giảm lag gõ với nhiều data, revision và nháp đồng bộ/ô nhập chung gọn, chọn file và kéo thả Excel/đính kèm data dài từ màn rút gọn/nhập text–Excel–TXT–ảnh bằng parser và OCR local/giữ SĐT–email khi dán trong nội dung/CSV/TSV giữ cột/dòng trống/tên khách/ô nhiều dòng, tách câu chỉ thị và nằm local/mô tả quá dài không hỏng nháp/OCR lỗi khởi tạo vẫn hủy–thử lại được/AI chỉ nhận metadata và chọn nơi nhập/Upload kiểm tra trước khi chèn/giữ file nháp khi hủy hoặc lưu lỗi/chặn lưu khi data dán chưa đính kèm/không nhầm câu đặt tên với header/undo, nháp Agent, hủy cuối lượt/tag trả chậm/metadata nhóm data khi tải/chặn thay danh sách/chuyển nguồn khi còn nhóm chờ, kể cả nhóm ẩn/cập nhật Data–Nội dung–Loại trừ sau đổi tùy chọn trong cùng lượt/cờ và tab nguồn theo action khi đổi loại/payload nội dung khi lưu/Nội dung vượt giới hạn AI không chặn section khác, bảng thay đổi dễ đọc/hạn mức nội bộ ẩn khỏi Agent/giữ số phút theo tài khoản, form trống/width 90%/chat gọn 300–360px cạnh form/sidebar 260px/tương phản chat, V442 đã apply | [hợp đồng Agent](../CAMPAIGN_AGENT_FORM.md); [audit local và receipt apply](../audits/campaign-agent-v442/README.md); [form route](CLIENT_CONTRACTS.md#campaign-agent-form) |
| Lag nhập nội dung ở dev, `useCampaignContentFormData`, ô text/HTML và bộ đếm SMS trong cả hai form | [hợp đồng nhập nội dung](../CAMPAIGN_CONTENT_TYPING.md); [audit local](../audits/campaign-content-typing/README.md) |
| UI/form/log/status/content | [UI và log](reference/ui-logs-01.md); [IPC](reference/architecture-02.md); `campaigns-*`, `pitfalls-*` theo feature |
| Tab **Hành động** trong chi tiết chiến dịch, `CampaignAccountActionsTab`, IPC `campaign:account-actions`, `readCampaignAccountActionRows`, `resolveCampaignActionQuotaLimit` (công thức chung với Chẩn đoán) | [hợp đồng, cách đọc chỉ-đọc và smoke](../CAMPAIGN_DETAIL_ACTIONS_TAB.md); giữ một công thức giới hạn cho tab, Chẩn đoán và bộ chạy |
| Excel nhóm Facebook: Data tìm được, Nhóm data, Kết quả chạy | [Mẫu 6 cột tìm theo từ khóa](../FACEBOOK_SEARCH_GROUP_EXCEL.md); [metadata động, action gate, quyền nguồn và V443](../FACEBOOK_GROUP_EXPORT_METADATA.md); [phương án 10/11: đủ mẫu 7 cột + thông tin thêm, lỗi giao diện tiếng Anh](../FACEBOOK_SEARCH_GROUP_EXPORT_PLAN.md); giữ luồng quét nhóm đã tham gia |
| Nhóm mẫu nội dung, picker/preview, `CampaignFormModal`, snapshot | [luồng chọn nhóm hiện tại](CLIENT_CONTRACTS.md#content-group-selection); [campaign/content](reference/campaigns-01.md); [pitfall và đính chính](reference/pitfalls-02.md) |
| Report/Automation/action status | [báo cáo](reference/reports-01.md); [kết quả hành động](reference/action-results-01.md); [hợp đồng report](../ACTION_STATUS_REPORTS.md) |
| Không tìm thấy ô đăng bài khi đăng nhóm, nhóm Mua bán, tách policy group/personal | [V459 đã apply: block 27, group policy 122 Bỏ qua, profile policy 94 giữ nguyên](../FACEBOOK_GROUP_COMPOSER_POLICY_V459.md); không đổi app, giữ log nguyên nhân, cần nạp lại catalog |
| akaBiz API/SMS/SQL import/Sheet/template/staff admin | [SQL Account](reference/integrations-01.md); [tích hợp/quản trị](reference/integrations-02.md); `browser-*`/`campaigns-*` theo sản phẩm |
| Loại trừ gửi Zalo, xóa tag trên Zalo làm báo thiếu dữ liệu | [Hợp đồng tag đã xóa 04/11/2026](../CAMPAIGN_SEND_EXCLUSIONS.md#deleted-native-zalo-tags--source-change-04112026); bỏ tag khỏi điều kiện đang xét chỉ sau khi đọc đủ danh sách, giữ lỗi API/phiên và các bộ lọc khác |
| Build/package/update/release | [lệnh, native, chuẩn build phát hành và khi nào build lại App Server](reference/build-01.md); [updater](reference/build-02.md); [feed/version](reference/build-03.md); [App Server 9.5.1 local](../audits/akaagent-server-9.5.1-20261110/README.md); [Desktop 9.5.0 local](../audits/akaagent-9.5.0-20261110/README.md); [Desktop 9.4.0](../audits/akaagent-9.4.0-20261106/README.md); [build 9.3.0 và App Server nội bộ](../audits/akaagent-9.3.0-20261105/README.md); [CURRENT_STATE](CURRENT_STATE.md) |
| Docs, Git và tổ chức hướng dẫn | [MAINTENANCE](MAINTENANCE.md); [skill trước PR](../../.agents/skills/source-command-verify-pr/SKILL.md); [chỉ mục](REFERENCE_INDEX.md) |

Bản sửa tiếp theo cho app-access/Zalo identity: [V452](../audits/app-access-split/RUNTIME_IDENTITY_FIX_20261103.md).

Quyết định mới về Desktop pre-request: [V453 bỏ kiểm quyền app trong hook IP](../audits/app-access-split/IP_HOOK_ACCESS_REMOVAL_20261103.md).

Tối ưu DB tiếp theo: [V454 staff/control guards đã apply, giữ quyền và cleanup](../audits/app-access-split/GUARD_PERFORMANCE_V454_20261103.md).

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
