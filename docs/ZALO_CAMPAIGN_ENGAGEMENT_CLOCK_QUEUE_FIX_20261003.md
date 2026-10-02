# Desktop / legacy Server: sửa giờ, hàng đợi và cache cấu hình tương tác — 03/10/2026

## Bằng chứng và phạm vi

Điều tra chỉ đọc production akachat (`cgjbsmqtfhqvttudyjzq`) cho campaign 22141, detail 3651162. Account chạy App Zalo Server legacy, không có binding tenant Chat. Ba detail gửi thành công đều có `zaloEngagementSource.sentAt` từ máy Server đi trước `created_at` DB khoảng 17,2–17,4 giây, dù nguồn được chụp trước gửi và trước INSERT detail.

Ví dụ UTC: detail tạo lúc `2026-10-02T18:10:21.187500Z`, nguồn ghi `18:10:38.526Z`, seen ghi `18:10:39.145Z`, hàng tương tác cập nhật `18:11:01.607262Z`. Seen riêng tư của SDK thiếu timestamp nên bản cũ dùng giờ máy. Không thể lấy thẳng hiệu seen → updated làm độ trễ vì hai mốc khác đồng hồ. Với độ lệch ổn định như các detail liền kề, độ trễ ước tính khoảng 40 giây; không có log raw callback để đo chính xác.

Trong khoảng khởi động, log HTTP ghi 120 RPC read engagement trước register và record; register/record riêng chỉ mất vài chục ms. Writer cũ luân phiên qua nhiều owner và đọc catalog/recovery trước việc đang sẵn sàng. Fixture tái hiện thêm việc phản hồi mang timestamp Zalo trước `sent_at` bị loại khi đồng hồ Server nhanh. Người dùng phản hồi vài giây sau xem; không còn raw payload của phản hồi cụ thể nên không khẳng định duy nhất một nguyên nhân cho dấu thiếu đó.

Người dùng bổ sung ảnh có phản hồi lúc 01:26 Việt Nam, vài phút sau khi cột đã hiện seen. Lệch giờ 17 giây không giải thích được lần này. Log HTTP có GET bốn setting engagement thành công lúc `18:13:43.012Z` và `18:26:52.934Z` (01:13 và 01:26 Việt Nam), không có RPC record thêm sau `18:11:01.621Z` trong cửa sổ tới `18:35Z`. Query lại detail vẫn `responded_at=NULL`. Code bỏ sự kiện đã khớp watch khi `currentOrRefresh()` trả undefined vì cache 60 giây hết hạn; chính sự kiện đó chỉ khởi động refresh. Fixture seen → im lặng 3 phút → reply tái hiện lỗi (0 record thay vì 1) trên cả bản sửa clock ban đầu, rồi pass sau bản sửa cache. Log không chứa body sự kiện nên đây là nguyên nhân code đã tái hiện, phù hợp mốc ảnh/log, không phải xác minh raw callback cụ thể.

## Thay đổi

- Thêm `peekDatabaseRuntimeClock()` chỉ đọc cache hiện có. Engagement dùng giờ DB đã đồng bộ cho nguồn gửi và timestamp nhận dự phòng; timestamp Zalo vẫn giữ nguyên. Không gọi thêm RPC lấy giờ, không thêm timer đồng bộ; cache lạnh/hết hạn thì bỏ theo dõi mới, không chặn nghiệp vụ.
- Giữ timestamp xếp hàng trong miền giờ local của timer. Offset DB/máy không được biến nhịp gom 5 giây thành 5 giây cộng/trừ offset.
- Ưu tiên owner có việc sẵn sàng; nạp tối đa một trang metadata khi rảnh. Giữ một writer/process, vòng luân phiên, retry và các giới hạn tài nguyên hiện có.
- Giữ account ID khi callback detail commit chuyển hold/recover thành mục đăng ký để nhận sự kiện nhanh trước lúc register RPC hoàn tất. Chỉ khớp đúng account, UID phiên và người nhận; không mở lookup cho tin không liên quan.
- Khi refresh cấu hình, sự kiện đã được RAM chấp nhận và có revision gần nhất đang bật vào `waiting_config` của queue hiện có. Writer xác minh lại enabled/revision rồi mới ghi; tắt/bật thay revision thì bỏ. Không tạo promise chờ cho từng event, không thêm lượt đọc cấu hình, không giữ listener/campaign. Queue giữ `receivedAt` bằng giờ DB riêng với `at` dùng cho timer; timestamp nguồn/fallback không đổi qua refresh/retry.

Bản sửa đầu ở Desktop/legacy Server; sau yêu cầu tiếp theo đã bổ sung cùng lỗi cache hết hạn cho Chat Sync trong `akaAgentChatApi` (database package/system-worker), dùng trạng thái inbox có sẵn. Không thay Web, schema, setting, API Zalo, pool/connection, status campaign, quota hoặc chính sách gửi. Không backfill/sửa timestamp các dòng đã ghi; không gửi lại tin để bù tương tác. Chi tiết Chat trong [ghi chú riêng](../../akaAgentChatApi/docs/CAMPAIGN_ENGAGEMENT_CONFIG_REFRESH_20261003.md).

## Kiểm chứng và triển khai

Fixture `scripts/zalo-campaign-engagement-clock-queue-smoke.cjs` dùng module clock/coordinator thật với DB, file và timer giả: clock nhanh 17,5 giây/chậm 5 phút, chỉnh giờ máy, phản hồi/seen trước đăng ký, account/UID/người nhận sai, deadline gom không bị dời, 60 owner chờ metadata, foreground đến lúc request nền đang chạy, một writer và cache giờ lạnh/hết hạn/invalidate không gọi DB. Thêm phản hồi sau seen 3 phút, một refresh cho burst 1.000 sự kiện trùng, giữ một mục trong queue, lỗi đọc/retry giữ timestamp đầu tiên, tắt hoặc đổi revision bỏ mục chờ. Cả hai chiều lệch giờ dùng revision mới ngay trước lượt gửi để kiểm tra fence không dựa vào giờ VPS.

Đã PASS ngày 03/10/2026: fixture clock/queue ở trên; smoke engagement lõi, lifecycle và nonblocking (restart, retry, revision, đổi owner/credential, overflow, hủy trước INSERT, kết quả INSERT không rõ và đĩa/config chậm); smoke opt-out và rich Share; `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`, `npm run build`, `npm run build:server`. Build có cảnh báo chunk/import, không có lỗi. Không gửi Zalo thật hoặc tạo tải giả trên production.

Phần Desktop/App Zalo Server đã build lại đủ bốn bộ cài **7.9.0** ngày 03/10/2026 (Việt Nam): Windows x64, macOS ARM64, macOS Intel x64 và App Zalo Server Windows x64. Chưa upload/phát hành; người dùng cần cài bộ mới để nhận bản sửa. Manifest và checksum ở `dist/build-7.9.0-manifest.json`, `dist/SHA256SUMS-7.9.0.txt`; log ở `dist/build-7.9.0-logs/`. Bộ cài cũ được giữ tại `dist/archive/before-7.9.0-rebuild-20261002-190525/`.

Đóng gói lần lượt bằng các npm script chuẩn; hai typecheck sạch. Đã kiểm tra cả bốn payload có đúng version, bản sửa clock và main bundle khớp build hiện tại; nguồn không đổi trong khi build. Cả hai DMG qua kiểm tra checksum, mount và so payload; executable/native đúng kiến trúc, chữ ký ad-hoc hợp lệ và SQLite đóng gói chạy được trên ARM/Intel. Windows/Desktop và Server qua kiểm tra NSIS, giải nén đối chiếu payload/executable/PE x64 native; chưa chạy cài đặt trên Windows thật. Native module của máy build đã được khôi phục. macOS chưa notarize, Windows chưa ký chứng thư, giữ cách đóng gói hiện có.

Phần Chat Sync đã deploy system-worker lúc 02:02 ngày 03/10/2026 (Việt Nam), image `engagement-config-refresh-20261003`; xem [audit](../../akaAgentChatApi/docs/CAMPAIGN_ENGAGEMENT_CONFIG_REFRESH_20261003.md). Không cần cập nhật Desktop của người dùng Chat, Chat API web process hoặc zalo-server-runtime. Không cần migration hay deploy Web. Sau cập nhật, kiểm tra bằng lượt gửi mới vì nguồn cũ vẫn giữ thời gian cũ và phản hồi đã bị bỏ không tự phục hồi.
