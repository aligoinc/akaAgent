# Deploy quyền akaChat/akaAgent từ repo chính — 03/11/2026

Audit này giữ trạng thái tại mốc deploy 05:33–05:36 Việt Nam. V447 sau đó đã
kích hoạt lúc 06:07:41 theo chỉ thị riêng; xem [activation và hậu kiểm](ACTIVATION_20261103.md).
Sau activation phải roll forward, không dùng ghi chú trước activation bên dưới để mở lại quyền.

Đã deploy từ ba checkout trong `/Users/lequangnhut/Repos`, không build/deploy từ worktree. Ba image Linux remote build thành công; worker được dừng trước khi cập nhật runtime, rồi khởi động lại trên máy cũ. Các bước dừng dùng SIGTERM và ngân sách cleanup hiện có.

| Thành phần | Commit repo chính | Machine Fly | Hoàn tất giờ Việt Nam |
| --- | --- | --- | --- |
| Chat API | `c25b520` | `7845747fe073e8` | 05:33:06 |
| Worker | `c25b520` | `784574da214578` | 05:34:34 |
| Server runtime | `c25b520` | `7817d7daee2d58` | 05:33:59 |
| Chat Web | `da7124e` | `7847d95cd4ddd8` | 05:35:32 |
| WebApp/API | `24846f5` | `48ee749f357398` | 05:36:12 |

[Receipt triển khai](deployment-receipt.json) lưu commit/image/digest trước–sau và kiểm chứng đã lọc. Full config cả năm máy **chỉ đổi image**; giữ CPU/RAM, env, service, volume 20 GB, số máy 3/1/1 và ngân sách kết nối. Không chạy runtime thứ hai. `labs/` ngoài Git của API bị loại khỏi context bằng ignorefile riêng, không đọc nội dung.

Lần cập nhật API đầu bị registry Fly trả `MANIFEST_UNKNOWN`. Máy vẫn giữ image/config cũ, retry sau đó thành công; đây không phải lỗi khởi động ứng dụng.

## Kiểm chứng production

- 14/14 HTTP probes đạt: health/live/ready, trang Web, domain Chat `chat.akabiz.biz` và WebApp `agent.akabiz.net`; sáu endpoint snapshot/set từ chối yêu cầu không đăng nhập bằng 401.
- Năm source file trong image API khớp SHA-256 với repo chính. Hai route build Chat tồn tại, build ID ghi trong receipt. Tám file Web (HTML/JS/CSS) qua domain thật khớp checksum container.
- API/Server monitor running, realtime connected, lastError null; Server gắn lại 226 account như trước deploy, heartbeat tiến. Số account gắn runtime không chứng minh mọi phiên Zalo đều đăng nhập thành công.
- Đối chiếu lỗi normalize bằng SELECT aggregate: cùng `runtime_event_not_json_serializable` của `runtime_event_transport_error` đã có 113 event trước và 7 event sau mốc worker deploy trong cửa sổ đọc. Không đọc payload hoặc sửa dữ liệu; các lỗi này không được tính là kiểm chứng zero-error.
- Worker xử lý event tự nhiên sau reconnect. Hàng chờ raw/project đã về 0 ở cửa sổ kết thúc 2026-11-02T22:43:37.104Z; cửa sổ cuối không có failed/claimLost/infrastructureErrors. Các cửa sổ normalize/project/backlog và lỗi có trong receipt. Đây không phải benchmark hoặc cam kết không bỏ lỡ event trong khoảng restart.
- Test trước PR vẫn là bằng chứng unit/SQL/mock ở [pr-verification.json](pr-verification.json); lượt này kiểm remote build và production health/auth/file. Không thực hiện kiểm thử gửi tin/chạy chiến dịch thật, nhập lịch sử điện thoại hoặc đổi quyền bằng phiên người dùng production.

## DB, phát hành và rollback

SELECT trước/sau trên `cgjbsmqtfhqvttudyjzq` xác nhận policy false, V447 không có trong ledger. **Không apply DB; quyền riêng chưa kích hoạt.** V445/V446 và hai private auth patches giữ nguyên. Desktop chưa phát hành; CRM không đổi source/deployment. Hai finding P2 đã được người dùng hoãn vẫn giữ nguyên.

Rollback image trước activation: đọc lại config/version live, kiểm tương thích caller/protocol, drain worker/runtime và chỉ đổi image máy hiện có bằng digest trước trong receipt. Không restore nguyên config cũ, tạo runtime thứ hai, rollback DB hoặc mở quyền. Sau activation theo hợp đồng roll forward.

Full config/log/script nằm trong thư mục private ghi ở receipt; không đưa env, credential hoặc dữ liệu khách hàng vào Git. Tại mốc bàn giao deploy, audit mới lưu local và chưa commit/push.
