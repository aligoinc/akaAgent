# Phát hành cá nhân hoá từ chối nhận tin — 13/09/2026

Đã phát hành từ các working tree đã review, không commit/push hoặc apply migration trong đợt này.

## Thứ tự đã thực hiện

| Thành phần | Release | Thời điểm UTC | Image |
| --- | --- | --- | --- |
| WebApp: route công khai, codec, bootstrap/PWA | 54 | 2026-09-13 13:34:16 | `registry.fly.io/aka-agent-web-app:stop-messages-routes-20260913-01` |
| Chat system-worker | 149 | 2026-09-13 13:35:44 | `registry.fly.io/aka-agent-chat-api@sha256:1940796eed9f207f48deea43e166dc7eefa05c0d9d59bc51f627893943386854` |
| WebApp: giao diện và Control API đầy đủ | 55 | 2026-09-13 13:37:36 | `registry.fly.io/aka-agent-web-app@sha256:f73e345f5d93af04ab30e153212f34322297a2aefd9665680cd4723f6646459b` |
| WebApp: bỏ giới hạn chiều cao cố định của bảng cá nhân hoá | 56 | 2026-09-13 13:57:06 | `registry.fly.io/aka-agent-web-app:stop-messages-popover-20260913-01` |
| WebApp: tách state tiến trình lưu khỏi form | 57 | 2026-09-13 14:49:26 | `registry.fly.io/aka-agent-web-app:campaign-save-progress-20260913-01` |

Lượt route được dựng từ HEAD của WebApp cộng riêng các file route, codec, trang xác nhận/lỗi, bootstrap và cấu hình PWA. Sau khi kiểm tra route trên production mới cập nhật worker; giao diện chèn biến được phát hành sau worker.

- WebApp: cập nhật hai machine hiện hữu `7812567c479ed8`, `78139e4a1e1608`.
- Chat API: chỉ cập nhật process `worker`, machine `784574da214578`, bằng `--process-groups worker --only-machines 784574da214578 --update-only --ha=false --strategy rolling`.
- Machine `api` (`683e030bd76998`) và `zalo_runtime` (`0803139f1d1058`) giữ nguyên instance, thời điểm cập nhật, image và hash toàn bộ cấu hình so với trước deploy. Không tạo thêm worker/runtime.
- Giữ nguyên DNS/HTTPS của `b.akabiz.biz` và `agent.akabiz.net`; chứng chỉ domain ngắn đã có sẵn và hợp lệ.
- Không migration, sửa RPC hoặc reload schema. Desktop và App Server chưa phát hành binary trong đợt này.

## Hậu kiểm

Bản sửa giao diện release 56 đổi `max-height: min(330px, 72vh)` thành `72vh` ở WebApp và mã nguồn Desktop. Bảng thực tế có nội dung 334px trong vùng cũ 328px; sau sửa `scrollHeight === clientHeight === 334` trên desktop/laptop, hết cuộn thừa trong bảng. Kiểm tra trên production dùng API/WebSocket mock xác nhận chèn biến và bật checkbox vẫn đúng; iPhone giữ chế độ cuộn cần thiết cho bố cục một cột. Hai typecheck/build Desktop và typecheck/build/test WebApp đều đạt (Web UI 493/493). Chỉ WebApp được deploy lại; không cập nhật worker/Chat API/runtime. Bản sửa Desktop đã build local, chưa phát hành installer.

- Các release đã hoàn tất; WebApp `/healthz` trả `ok`, Chat API `/health/ready` trả `ready`, gồm kiểm tra kết nối database.
- Playwright Chromium desktop và WebKit iPhone trên production: `/s/error` hiển thị đúng thông báo, không nút xác nhận và không gọi API; token không hợp lệ không gọi API.
- Link ngắn chứa UUID minh hoạ và link UUID cũ đều gọi GET inspect với cùng UUID, cùng trả trạng thái `invalid` cho bản ghi minh hoạ không tồn tại. Không bấm xác nhận hoặc gửi POST.
- HTML và toàn bộ hai asset JavaScript production khớp SHA-256 với bản build local đã kiểm tra.
- Ba file worker đang chạy `campaignContent.js`, `zaloCampaignExecutor.js`, `zaloMessageOptOut.js` khớp SHA-256 với build local.
- Trong phút 13:37:09–13:38:09 UTC: project hoàn tất 28/28, raw/project/retry backlog đều bằng 0, không có lỗi hạ tầng hoặc mất claim. Normalize có 1 event failed trong mỗi hai khoảng thống kê đầu; không thấy lỗi scheduler/leadership terminal trong log đã đọc. Không thay đổi code normalize/project trong đợt này và chưa điều tra nguyên nhân các event đó.
- Không tạo campaign, gửi Zalo thử hoặc xác nhận từ chối trên dữ liệu production. Các thống kê worker là lưu lượng sẵn có.

Lỗi cache HTML đã nêu trong review và trường hợp biến bị tách bởi định dạng rich text không được sửa trong phạm vi người dùng chọn; không coi đợt deploy này là bản sửa hai vấn đề đó.

Kiểm tra trước deploy: hai typecheck và build Desktop, smoke render; typecheck/build WebApp và Chat API; Chat API 910 test, Web shared 10 test, Web API 423 test. Web UI có 492/493 test đạt ở lượt chạy chung, một test DataGroups timeout; chạy riêng lại toàn bộ file đó đạt 14/14. Kiểm tra giao diện quick-edit bằng component thật và API mock đã đạt.

## Image trước đợt phát hành

- WebApp: `registry.fly.io/aka-agent-web-app@sha256:68550409f75f9fe9840a3797826577d9cb0bb640e67171388416462b53bca4a4`.
- Worker: `registry.fly.io/aka-agent-chat-api@sha256:1881a08e2ece99177348dd56a77ed9d7269e1876462d874ed5bbcc7b199f5060`.

Rollback phải giữ route công khai tương thích với link đã phát ra; không đưa worker về bản chưa hiểu biến trong khi campaign có biến mới vẫn hoạt động. Chỉ cập nhật đúng process cần rollback.

Log deploy, snapshot machine đã lược bỏ cấu hình bí mật, hash và ảnh hậu kiểm nằm tại `/tmp/stop-messages-deploy-20260913/`.
