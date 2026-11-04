# Trung tâm thông báo — apply DB và deploy Web/API 04/11/2026

Đã thực hiện theo yêu cầu trực tiếp: kiểm tra code mới nhất, apply V457/V458, cấu hình điều phối và deploy Web/API; mobile để sau. Người dùng giữ nguyên code đã review, không sửa các finding trong lượt này.

## Lịch sử apply và deploy

- Tại lúc deploy: akaAgent `dev_3` và remote cùng `c332ecf5`; akaAgentWebApp `dev` và remote cùng `8da46d6`. Web/API build từ repo chính `/Users/lequangnhut/Repos/akaAgentWebApp`, không deploy từ worktree.
- **V457 đã apply** akachat `cgjbsmqtfhqvttudyjzq`, ledger `20261104161948 / migration_v457_notification_center` (23:19 VN).
- **V458 đã apply** cùng project, ledger `20261104162008 / migration_v458_data_group_member_events` (23:20 VN).
- **Web/API deploy 23:22:11–23:22:37 VN** trên Fly `aka-agent-web-app`, machine `48ee749f357398`. Image `registry.fly.io/aka-agent-web-app:notifications-8da46d6-20261104@sha256:ff9ddc5da0d57ec77878f676f9aa2551ff13be649c4620690b9342b28c917a89`.
- Chỉ đổi `.image` trong machine config, giữ một máy 2 shared CPU / 2 GB, env/services/volume và ngân sách connection. Hai secret mới được stage rồi nạp khi cập nhật máy; worker chạy chung API, không thêm process/pool/cron.
- Fly đã có `NOTIFICATION_DISPATCH_TOKEN`, `NOTIFICATION_LINK_SECRET`; Vault có URL `https://agent.akabiz.net/internal/notifications/dispatch` và token trùng Fly. Không ghi giá trị secret vào Git.
- **23:24:47 VN:** `notifications.enabled=true`, `notifications.delivery_mode=dry_run`; `notifications.member_events.enabled=false`. V458 vẫn ghi khi `notifications.enabled=true` theo OR gate hiện có. Hệ mới chưa gửi email/push thật. Trigger email cũ và hai cron 5 phút vẫn bật.
- Mobile/APNs và phát hành Desktop để sau. Không apply V460, deploy CRM/Edge gia hạn, Chat API, App Server hay worker email cũ trong lượt này.

## RPC và bảo toàn

| Exact signature | MD5 trước | MD5 sau |
| --- | --- | --- |
| `public.aka_agent_data_group_background_tick()` | `873b2939cc09a51e0e9d71f685dfd0e0` | `10a2465bf8273b269ed5123344cff4db` |
| `public.aka_agent_process_data_group_dynamic_filters_core(bigint,bigint,integer)` | `d40d1a23943ae1a4a66339504382526f` | `3b94712afe9d6aa725d8af55d825c5cb` |

Đã capture live body/owner/ACL/security/volatility/config trước apply. Hai hàm giữ owner `postgres`, SECURITY DEFINER, VOLATILE, parallel unsafe, `search_path=pg_catalog, public`, ACL chỉ postgres. Tick giữ hai bước cũ, thêm điều phối; core giữ logic membership/claim/lỗi và thêm nhật ký theo migration V458. 43 hàm sau apply khớp toàn bộ checksum và metadata của trial.

19 dòng cài đặt email được chuyển thành 38 subscription; checksum các trường nghiệp vụ cũ giữ nguyên `4547aaf94172a1e68837e8637df8bc54`. Không mở quyền bảng mới cho anon/authenticated/Desktop/Chat API/service_role; caller đi qua RPC theo ACL trong migration.

## Kiểm chứng

- Hai suite PG17 local đạt, gồm parity bộ lọc và rollback; wrapper ngoài repo chỉ xử lý Bash 3 empty-array để chạy trên Mac, không sửa SQL/source.
- Production rehearsal chạy V457 → V458 → rollback V458 → rollback V457 trong transaction kết thúc **ROLLBACK**. Hai hàm, quyền và bảng cũ khôi phục; sau trial không còn bảng thông báo. Sau apply chạy thêm transaction kiểm quyền, service-role stats/settings/inbox và từ chối sai tổ chức.
- WebApp typecheck 7 workspace, production build local/remote, 34 API và 38 Web notification tests đạt.
- 114 file nguồn trong source map API khớp checkout; 9 asset Web HTTP khớp container. Health 200, ba route control từ chối chưa đăng nhập 401, dispatch thiếu token 401, hai link email sai trả 400.
- DB `pg_net` gọi worker bằng Vault: request `636994`, HTTP 200, worker hoàn tất 116 ms; rendered/sent/retried/failed đều 0. Kiểm chứng đường gọi và RPC production, không chứng minh gửi SMTP/APNs thực tế.
- Trình duyệt production tải màn đăng nhập; chưa chạy UI có phiên đăng nhập thật. Quan sát 23:25:46 VN: 0 pending render/delivery, 0 thông báo/lượt gửi mới; email cũ và tick 30 giây vẫn bật. Không tạo notification giả hoặc gửi thư thử.

## Chuyển live theo yêu cầu người dùng — 23:39 VN

- **23:39:22 VN:** chuyển `notifications.delivery_mode` từ `dry_run` sang `live`, giữ `notifications.enabled=true`. Cùng transaction tắt trigger `trg_aka_agent_enqueue_campaign_completed_email` trên `auto_campaigns` và hai cron `aka_agent_email_notification_worker_retry` (21), `aka_agent_email_notification_daily_report` (22). Không xóa định nghĩa/lịch sử; cron tick dùng chung (66) vẫn bật.
- Guard kiểm tra chính xác mode, checksum/enable-state trigger, checksum/name/schedule/active của cron và hàng đợi cũ trống. Khóa ngắn bảng campaign/outbox cũ khi chuyển. Trước/sau có 773 email cũ `sent`, 1 `failed`, không có pending/inflight; không sửa lịch sử thư. Thay đổi vận hành có DDL nên dùng công cụ apply, ledger `20261104163922 / notification_center_live_cutover_20261104`; không apply lại V457/V458 hoặc tạo phiên bản sản phẩm V460.
- **23:40:01 VN:** gửi đúng một email kiểm chứng tới `akabizzm@gmail.com` (người dùng chỉ định), Gmail trả `250 2.0.0 OK`, accepted đúng một địa chỉ, rejected rỗng. Tiêu đề: “Kiểm chứng hệ thống thông báo akaBiz — live”. Message-ID: `<akaagent-live-20261104T163318Z@akabiz.net>`.
- Bài kiểm chứng gọi SMTP một lần từ machine Web/API production, đọc cấu hình sender qua RPC service-role hiện có, cùng thư viện Nodemailer; không retry, không đổi cài đặt nhận thư của staff. Hộp thư được chỉ định chưa nằm trong notification settings nên không tạo thông báo/outbox giả để ép fanout. Kết quả chứng minh SMTP chấp nhận thư, **chưa chứng minh Inbox hoặc toàn bộ luồng sự kiện → render → delivery**.
- **23:40:31 VN:** Web/API health 200, machine started/check passing, `live`, pending render/delivery đều 0; tick 66 tiếp tục succeeded sau chuyển. Chưa có thông báo phát sinh tự nhiên tại thời điểm quan sát. Không cấu hình APNs/phát hành mobile hoặc Desktop.
- Repo WebApp đã fast-forward tới `3281a40` (PR #149 mới đến) và giữ các tài liệu triển khai local; production vẫn chạy image `8da46d6` đã kiểm chứng. Lượt chuyển live không deploy thêm image, sửa source nghiệp vụ, RPC, ACL, timeout, pool hoặc số machine.

[Receipt chuyển live đã lọc secret](live-receipt.json). SQL guard, capture và biên nhận SMTP riêng tại `/Users/lequangnhut/.codex/deployments/notification-live-20261104T163318Z`.

Người dùng sau đó xác nhận đã nhận được email kiểm chứng ngày 04/11/2026. Đây là bằng chứng cho lượt SMTP trực tiếp 23:40; lượt end-to-end dưới đây kiểm chứng thêm chuỗi xử lý thông báo.

## Deploy Web/API mới nhất và canary end-to-end — 23:50–23:54 VN

- **23:50:10–23:50:33 VN:** deploy từ repo WebApp chính `dev`, HEAD/remote `3281a405a326b270b88c0a3f7f5234b9cbbd1e1c` (PR #149). Image `registry.fly.io/aka-agent-web-app:notifications-3281a40-20261104@sha256:6d9f39688a9aa70707f72019fdaa7a4978182ef0a8873140aeda5dc762d71931`. Máy `48ee749f357398` chỉ đổi image, giữ 2 shared CPU/2 GB, config, secret, connection và một replica. Image rollback của lượt này là `notifications-8da46d6-20261104@sha256:ff9ddc5da0d57ec77878f676f9aa2551ff13be649c4620690b9342b28c917a89`.
- Typecheck 7 workspace, build production local/remote, **226 API + 38 Web tests** đạt. 114 source API trong image khớp checkout; ba JS/CSS entry được production phục vụ khớp container. Health 200, machine/check healthy; ba route dữ liệu khi chưa đăng nhập vẫn 401. Fetch sau deploy xác nhận `origin/dev` vẫn `3281a40`.
- Dùng staff nội bộ 15/org 1 (chủ tài khoản gửi 9742, quyền akaAgent hợp lệ), đăng nhập qua HTTP API production theo cơ chế hiện có. Trước thử không có notification settings/subscription của staff này. Tạo tạm danh sách nhận chỉ `akabizzm@gmail.com`, tắt mọi subscription định kỳ/sự kiện và push; email được đánh dấu đã xác minh qua RPC server dựa trên xác nhận nhận thư trước đó của người dùng. Không gửi thêm email xác minh, không đổi thông tin nhận thư của khách.
- **23:51:33 VN:** `POST /settings/notifications/test` tạo notification **1**, `system.test`. Tick 30 giây hiện có tự gọi worker qua Vault/pg_net, không gọi SMTP trực tiếp hoặc kích hoạt worker thủ công. Request pg_net **637204**, HTTP 200, `rendered=1`, `sent=1`, retry/failed/cancelled/suppressed đều 0, 3.075 ms.
- **23:51:49 VN:** delivery **1**, đích `akabizzm@gmail.com`, `sent`, attempt 1; render attempt 1, `content_status=ready`, push `none`. Email **`[akaBiz] Thông báo thử`**, Message-ID `<3973fd69-a89d-3b3d-4073-8f4532bc59c6@gmail.com>`. Người dùng xác nhận **đã nhận được** thư này trong chat.
- **23:52:57 VN:** API list/detail trả thông báo đã gửi; `/me` và `/auth/web-entry` cùng trả unread 1. Mark-read cập nhật đúng 1 dòng; unread-list loại thông báo này, `/me` trả 0, detail có `readAt`. Logout phiên thử rồi `/me` trả 401. Kiểm tra qua HTTP production; không coi đây là bằng chứng click UI browser production.
- **23:54:26 VN:** cleanup transaction có guard checksum đã xóa đúng một settings row và bốn subscription tạm, khôi phục trạng thái ban đầu không có cấu hình cho staff 15. Phiên thử đã revoke qua logout, file cookie tạm trên machine đã xóa. Giữ notification/delivery đã gửi và đã đọc để tra cứu. Không thay campaign, account status, dữ liệu khách, RPC/ACL hoặc timeout; ba hàm đã capture giữ nguyên body checksum/owner/security/volatility/config/ACL.
- Hậu kiểm **23:54:53 VN:** `live`, pending render/delivery 0, trigger cũ disabled, cron 21/22 inactive, tick 66 active. Outbox email cũ giữ 773 sent/1 failed. Không apply migration, deploy mobile/APNs hoặc phát hành Desktop.

Phạm vi canary là sự kiện `system.test` qua toàn chuỗi xử lý email. Chưa phát sinh campaign/account/report thật hoặc thử UI browser production; các nhóm đó có kiểm tra tự động và không bị thay đổi trong lượt này.

[Receipt end-to-end](e2e-receipt.json). Bằng chứng riêng tại `/Users/lequangnhut/.codex/deployments/notification-e2e-20261104T164555Z`.

## Vận hành tiếp và rollback

Không apply lại V457/V458; không bật lại trigger/hai cron cũ khi hệ mới đang gửi. Mobile cần APNs và bản phát hành riêng. Các finding review vẫn giữ nguyên theo yêu cầu người dùng.

Nếu có sự cố, xác nhận trạng thái hiện tại rồi dừng tạo mới bằng `notifications.enabled=false`; kiểm tra riêng lượt gửi đang chạy/chờ trước khi phục hồi email cũ để tránh gửi trùng. Không tự đổi dữ liệu hoặc ACL khác. Image trước nằm trong receipt. Rollback schema chỉ theo yêu cầu rõ ràng và phải chạy V458 trước V457; V457 rollback xóa dữ liệu thông báo nên không tự thực hiện. Đã thử thứ tự rollback trong transaction trước apply.

[Receipt đã lọc secret](receipt.json). Full capture/log và bản dự phòng secrets giữ riêng ngoài Git tại `/Users/lequangnhut/.codex/deployments/notification-center-20261104T161539Z`.
