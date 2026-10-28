# Connection và tài nguyên DB

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 274–289. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
## Supabase/Postgres: phải thảo luận trước khi tăng connection

Connection là tài nguyên có giới hạn, dùng chung giữa các service và toàn bộ client của hệ thống. **Không tự ý thêm nguồn connection hoặc tăng ngân sách connection. Phải trình bày đề xuất và chờ người dùng đồng ý trước khi triển khai thay đổi đó.** Yêu cầu làm một tính năng không mặc nhiên cho phép tăng connection.

- Áp dụng khi thêm `pg.Client`/`pg.Pool` hoặc client SQL tương đương, pool riêng cho feature/log, connection giữ lâu cho listener/job, tăng `pool.max`/giới hạn pooler/Postgres, hoặc tăng process/worker/replica làm tăng tổng connection. Không tạo connection/pool theo request, event, account hay staff.
- Trước khi xin ý kiến, kiểm tra cách kết nối hiện tại; nêu lý do cần thêm, số connection hiện tại và mức tối đa dự kiến trên **tất cả process/replica**, thời gian giữ/release/timeout và phương án tái sử dụng kết nối. Phân biệt client connection tới pooler với backend connection vào Postgres; số liệu chưa biết phải ghi rõ, không tự giả định còn dư capacity.
- Ưu tiên cơ chế kết nối hiện có; HTTP/Data API/RPC vẫn dùng tài nguyên DB và pool phía server, không coi là miễn phí hoặc dùng để bỏ qua đánh giá tải. Không tự tăng pool để chữa timeout khi chưa xác định nguyên nhân.
- Với `auto_account_logs`, giữ request HTTP nền hiện tại; không mở connection SQL riêng cho mỗi log và không chiếm pool nghiệp vụ để ghi log.
- Quy tắc yêu cầu thảo luận dành cho việc thêm nguồn/tăng ngân sách connection; query thông thường, checkout/release hoặc reconnect trong cơ chế và giới hạn đã được chấp thuận không cần xin lại từng lần.

Theo dõi tương tác Zalo campaign là **best effort**: chấp nhận mất dấu; không chờ config/journal/listener/khóa engagement trên luồng gửi, detail, quota hoặc lifecycle chiến dịch. Không retry gửi vì engagement; giữ giới hạn tài nguyên và công tắc riêng. Lọc account/UID/người nhận bằng RAM trước queue/DB; cache miss bỏ dấu, không tra DB theo tin. Catalog nạp nền theo lô lúc vào phiên/revision và từ đăng ký thành công. Desktop/Server hủy nguồn nếu dừng trước INSERT; phục hồi INSERT chưa rõ kết quả có hạn cố định 5 phút, retry/restart không gia hạn, hết hạn bỏ nguồn và replay chỉ phụ thuộc nguồn đó. Hạn này không thay deadline DB của lượt đã đăng ký. Xem [cơ chế và kiểm chứng](../../../docs/ZALO_CAMPAIGN_ENGAGEMENT.md). V339 đã apply `20261002162601 / migration_v339_zalo_campaign_engagement` trên akachat; Chat worker/runtime và WebApp/API đã deploy 02/10/2026; người dùng đã yêu cầu bật `enabled=true` lúc 23:40 giờ Việt Nam, Desktop/legacy Server chưa phát hành. Không apply lại; [audit triển khai](../../../docs/ZALO_CAMPAIGN_ENGAGEMENT_DEPLOY_20261002.md).

V341 đã apply `20261002174744 / migration_v341_zalo_engagement_chat_registration` và Chat worker đã deploy hotfix 03/10/2026: đọc bốn setting public qua HTTP cache chung, dọn pending trong RPC đăng ký; không cấp thêm SELECT settings/UPDATE detail cho SQL worker. Không apply lại v339/v341. Desktop/legacy Server 7.9.0 đã build local, chưa phát hành. Xem [audit hotfix quyền](../../../docs/ZALO_CAMPAIGN_ENGAGEMENT_CONFIG_FIX_20261003.md).

Engagement Desktop/legacy Server dùng `peekDatabaseRuntimeClock()` chỉ đọc cache cho `sent_at` và thời điểm nhận dự phòng; cache giờ lạnh/hết hạn thì bỏ dấu mới, không gọi thêm RPC hay chờ luồng gửi. Timer gom/retry vẫn dùng giờ local. Giữ account ID khi detail commit chuyển hold thành đăng ký và ưu tiên mục sẵn sàng trước catalog/recovery nền. Khi cache setting hết hạn, sự kiện đã khớp RAM với revision gần nhất đang bật vào `waiting_config`; writer xác minh lại enabled/revision/thời điểm nhận trước khi ghi. Bốn bộ cài 7.9.0 đã build lại local ngày 03/10/2026, chưa phát hành; Chat Sync đã deploy bản sửa cache lúc 02:02 Việt Nam. Xem [bản sửa và kiểm chứng](../../../docs/ZALO_CAMPAIGN_ENGAGEMENT_CLOCK_QUEUE_FIX_20261003.md).


<!-- END PRESERVED SOURCE -->
