# Trạng thái đã xác nhận — cập nhật 30/10/2026

Đây là chỉ mục dựa trên receipt/audit đã có, không phải lệnh triển khai.
Lần tổ chức tài liệu không query hoặc thay đổi production. Trước thay đổi DB phải
đọc live theo skill RPC; không suy ra quyền apply từ bảng này.

## Bảo mật và tương thích hiện hành

| Phần | Trạng thái đã xác nhận | Nguồn để thao tác/review |
| --- | --- | --- |
| Production | `akachat`, ref `cgjbsmqtfhqvttudyjzq`; project legacy bị cấm theo AGENTS.md | `supabase/.temp/project-ref`, [quy tắc gốc](../../AGENTS.md) |
| Anon/RLS, V435 | Đã cutover `20261027165325`: thu hồi anon/authenticated trong phạm vi akaAgent, bật RLS còn thiếu; giữ bootstrap và đúng một dòng updater cho app cũ | [V435](../DESKTOP_PERMISSION_CUTOVER_V435.md) |
| Token Desktop | Token theo Auth/staff; quyền đã thu hẹp. Không đọc trực tiếp staff, không ghi tổ chức, không đọc Vault/AI key. Giữ quyền embedded join cần thiết | [token/RLS](../DESKTOP_SESSION_RLS.md), [quyền](../DESKTOP_TOKEN_PERMISSIONS.md) |
| Staff privacy | `20261027180248` đã apply: staff chỉ đọc/khóa hồ sơ runtime của mình; chặn RPC quản trị từ Desktop | [staff self access](../DESKTOP_STAFF_SELF_ACCESS.md) |
| Danh sách chia sẻ | `20261027181132` đã apply: giữ ID+tên staff hoạt động/cùng org để chọn người nhận; không trả profile/credentials người khác | [directory](../DESKTOP_STAFF_SELF_ACCESS.md) |
| Account/campaign ownership | `20261027185059` đã apply: scope theo staff token, 19 restrictive policy, guard RPC/trigger; giữ backend và chia sẻ nhóm | [ownership](../DESKTOP_ACCOUNT_CAMPAIGN_OWNERSHIP.md) |
| Thư viện dữ liệu/settings/element/org — V436 | `20261028093922` đã apply: dữ liệu riêng theo staff, giữ chia sẻ qua nhóm/RPC; settings chỉ admin, element chỉ admin hoặc own nonbuiltin; org/gói thu hẹp. 23 restrictive policy, 11 guard, không đổi app/timeout/anon. Secret upload/proxy còn giữ do client hiện tại cần | [phạm vi và kiểm chứng](../DESKTOP_DATA_PRIVACY_V436.md), [receipt](../../migrations/snapshots/desktop-data-privacy-v436/apply-receipt.json) |
| Thu hồi chia sẻ | `20261028064138` đã apply 13:41:38 VN: sửa khóa nội bộ để chủ nhóm dừng source của người mất quyền, giữ direct cross-staff denial | [audit](../GROUP_SHARING_REVOKE_OWNERSHIP.md), [receipt](../../migrations/snapshots/group-sharing-revoke-ownership/apply-receipt.json) |
| DeepSeek setting | `20261027182912` đã apply: Desktop không đọc/ghi/đổi tên dòng `ai.deepseek.api_key`; backend và settings khác giữ nguyên | [DeepSeek block](../DESKTOP_DEEPSEEK_SETTING_BLOCK.md) |
| Block/workflow definitions | `20261027191229` đã apply: Desktop kể cả admin mất quyền ghi `auto_blocks`/`auto_workflows`, giữ SELECT/backend; không suy rộng sang element/XPath/legacy | [receipt](../../migrations/snapshots/desktop-block-workflow-readonly/apply-receipt.json) |
| AI Desktop | V434/API proxy đã deploy và canary Desktop thật đã đạt; provider key không đưa về Desktop | [AI proxy](../DESKTOP_AI_PROXY.md) |
| Chat API/worker, ChatWeb, WebApp, akaMap | HTTP compatibility `20261027181400` đã apply; các backend và Edge akaMap đã deploy. Không mở lại anon hoặc tăng pool/replica | [cross-repo audit](../CROSS_REPO_RLS_DEPLOY_20261028.md) |
| Đồng bộ lịch sử Zalo Server — V437–V438 | V437 `20261029180830`, V438 `20261030043145` đã apply. API/system-worker/Web đã deploy 11:33–11:36 VN, 30/10/2026 từ repo chính sau merge PR107/API và PR68/Web: receipt Start chính xác, tránh khóa chéo và sửa UI Dừng/chuyển lượt. Runtime giữ image/config/instance, không deploy/restart; control socket reconnect sau API restart. Health đạt; worker project 540/540 trong cửa sổ kiểm tra. Giữ UI org 1/batch 20; không đổi tài nguyên/pool/replica. Pilot trước nhập 2.436 tin, 464 trùng rồi cancelled; pilot bản mới chờ user test | [phạm vi, nguồn canonical và audit liên repo](../ZALO_MESSAGE_SYNC_V437_20261030.md) |
| UI đồng bộ theo tổ chức — V440 | `20261030085919` đã apply 15:59:19 VN, 30/10/2026; chỉ org 1 bật `zalo_message_sync_enabled`. API/Web deploy 16:00–16:01 VN, mốc 7/30/90/360/720/Tuỳ chọn (UI tối đa 720). PR111/API và PR73/Web đã merge/sync, worktree đã dọn. Bản sửa giữ khoảng ngày deploy riêng Web từ repo chính `7772ed6` lúc 16:48 VN; 158 file source API live khớp `a16cfc4`. Health/hash JS đạt; API/worker/runtime giữ nguyên instance. Không apply lại DB, đổi backend date limit, quyền hoặc pool/tài nguyên | [audit liên repo và nguồn canonical](../ZALO_MESSAGE_SYNC_UI_V440_20261030.md) |
| Context từ lịch sử Zalo — V439 | `20261030081324` đã apply lúc 15:13:24 VN, 30/10/2026: trigger bỏ qua `sync_source='old'` trước khi gọi Context. Giữ realtime/API, job hiện có và function/ACL; không thêm job bù sau đồng bộ. Không deploy/restart service hoặc tăng connection | [hợp đồng, rollback và hậu kiểm](../CONTEXT_ZALO_HISTORY_TRIGGER_V439_20261030.md) |
| Nhập trích dẫn lịch sử theo lô | System-worker đã deploy từ repo chính Chat API `dev`/`09fe12a` lúc 15:26 VN, 30/10/2026 sau PR110. Chỉ đổi image sole worker; API/runtime giữ config và instance, ChatWeb không deploy. V437–V439 hậu kiểm đạt, không apply lại; 1.731 test và 13 ca PostgreSQL đạt. Pilot tốc độ đồng bộ mới chờ user test | [phạm vi liên repo](../ZALO_MESSAGE_SYNC_V437_20261030.md) |
| Device identity v3 | `20261027085744` đã apply; credential/CAS/receipt, giữ recovery proof/journal. Ghi chú “chưa bật C” là trước V435 | [device v3](../DEVICE_IDENTITY_V3.md), [V435](../DESKTOP_PERMISSION_CUTOVER_V435.md) |
| Source chặn IP | Source Edge/migration IP/hồ sơ/full capture riêng đã chuyển ngoài Git; production giữ quy tắc đang triển khai | [README source riêng](../../supabase/functions/aka-agent-desktop-session/README.md) |

Không apply lại các mốc trên. Không chạy B/C cũ hoặc rollback mở quyền nếu chưa có
chỉ thị riêng. File canonical có thể mang timestamp khác ledger; đối chiếu
receipt/signature/checksum, không dùng filename để kết luận “chưa chạy”.

## Build và phát hành

- akaAgent 9.1.0 đã build local cho Windows, Mac ARM64/Intel và Server Windows; feed ba nền tảng được xác nhận 9.1.0 trong audit cutover. [Build receipt](../audits/akaagent-9.1.0-20261027/build-receipt.json), [cutover](../DESKTOP_PERMISSION_CUTOVER_V435.md).
- Bộ cài Server nội bộ có credential giữ riêng trên máy quản lý, không publish/đưa vào Git. Build local không chứng minh đã cài trên mọi máy khách.
- akaMap 3.0.7 Mac ARM64/Windows build local được ghi trong audit cross-repo; kiểm tra audit/release mới hơn trước khi kết luận trạng thái upload.
- Các bản build/candidate/deploy cũ và rủi ro người dùng chấp nhận nằm trong [lịch sử và mục lục](REFERENCE_INDEX.md). Không đổi quyết định đã chấp nhận chỉ để làm sạch lịch sử.

## Giải quyết ghi chú cũ mâu thuẫn

| Ghi chú trong lịch sử/reference | Cách hiểu hiện nay |
| --- | --- |
| “Anon chưa thu hồi”, “B/C chưa chạy”, “org_staff RLS=false” | Mốc trước V435; dùng audit cutover và kiểm tra live. Không mở lại quyền legacy. |
| “Admin desktop sửa workflow/block”, built-in “qua admin UI/IPC” | Luồng trước thu hồi ghi; không cấp lại quyền Desktop vì UI còn hiển thị. Backend có phạm vi riêng. |
| “Không có test commands” | Không có test/lint chung; `package.json` và `scripts/` có smoke chuyên biệt. Dùng đúng lệnh trong audit phần sửa. |
| “Chưa apply/deploy/phát hành” của feature khác | Chỉ đúng tại mốc ghi nhận; tìm audit mới hơn/receipt/live trước hành động. |

Mỗi cập nhật tiếp theo chỉ sửa dòng liên quan và dẫn tới audit mới.
Không biến file này thành bản sao lịch sử toàn hệ thống.
