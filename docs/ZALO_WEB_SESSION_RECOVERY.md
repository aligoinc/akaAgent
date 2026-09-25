# Khôi phục phiên Zalo Web

Áp dụng cho `is_zalo_show_web=true`; Facebook, Zalo QR và Server giữ nguyên luồng cũ.

Tab Zalo có thể vẫn đăng nhập dù app mất bootstrap để dựng API. Vì vậy thiếu bootstrap, lỗi CDP, lỗi mạng và timeout trả kết quả **chưa xác minh được**, giữ `login_status` gần nhất. Cookie có mặt không được dùng để kết luận đăng nhập thành công. Chỉ xác nhận thiếu cookie xác thực trên tab không còn tải mới ghi trạng thái đăng xuất. Không thêm enum hoặc migration.

## Phục hồi

- Mỗi webview mới có một lượt phục hồi dự phòng trong RAM, sau thời gian chờ bootstrap 30 giây. CDP bị ngắt/crash làm mất API; lần re-arm giữ lý do ngắt để chẩn đoán.
- Poller dùng nhịp 30 giây và danh sách account hiện có, đọc cookie local kể cả account đang `chưa đăng nhập`. Account bận, đang có operation, inactive hoặc tab crash không nhận lượt phục hồi.
- Khi cần phục hồi và account rảnh/còn cookie, tiêu thụ lượt **trước** khi gọi claim `zalo.web.recover` với `requires_login=false`. Chỉ có một lượt phục hồi nền đang xử lý; vòng kiểm tra chung không chờ claim, xác minh hoặc cleanup của lượt đó. Claim thất bại cũng không tạo lượt claim mới mỗi nhịp. Producer kết thúc luôn đi qua release token hiện có; lifecycle đã abandon thì giữ cơ chế recovery chung.
- Lifecycle vẫn theo dõi lượt nền đến khi claim/cleanup kết thúc. Dừng rồi bật lại runtime, abandon rồi nhận quyền lại hoặc đổi staff không cho producer cũ chạy tiếp; dọn claim kiểm tra thế hệ ownership và đúng token. Timeout chờ lifecycle không tự bỏ khóa hay quên lượt đang chờ.
- Trong claim, bật CDP trước; nếu trang đang tải hoặc mới được arm thì cho bootstrap tối đa 30 giây để đến. Nếu vẫn thiếu và còn cookie, reload đúng một lần rồi chờ thêm tối đa 30 giây. Không tự reload guest đã crash hay tab đã điều hướng khỏi chat.zalo.me.
- Giữ luồng tự xác minh khi đủ bootstrap, kể cả dữ liệu đến sau timeout. Các caller dùng chung một API build. API chỉ sẵn sàng sau khi xác minh profile và lưu identity thành công.
- API mới dựng dùng kết quả xác minh profile của chính lần build, không gọi profile lần thứ hai. API đã có từ trước vẫn xác minh bằng một request mới. Lượt dự phòng chỉ được trả lại khi toàn bộ kiểm tra thành công, kể cả đọc account cuối cùng và kiểm tra API vẫn thuộc phiên hiện tại; lấy được API từ cache hoặc thành công một phần không trả lại lượt.
- Thành công mở lại lượt dự phòng cho sự cố tiếp theo. Re-register/dom-ready hoặc một bootstrap mới chưa xác minh thành công không mở lại lượt reload. Thất bại dừng, ghi lý do vào log trong app qua IPC hiện có; nút **Kiểm tra đăng nhập** cho phép thử một lượt mới.
- Scheduler chờ API Web sẵn sàng trước khi nhận lượt chiến dịch mới; không dùng trạng thái đăng nhập được giữ lại để retry claim/API liên tục. Preflight vẫn xác minh phiên trước khi chạy.

`Network.enable`, đọc cookie phục vụ xác minh và `fetchAccountInfo` có hạn chờ 30 giây. Hạn HTTP bao gồm body và truyền AbortSignal xuống `session.fetch`; không áp hạn này lên upload/tác vụ campaign. Claim và ghi DB vẫn dùng cơ chế ownership/drain hiện có, không bỏ ngang mutation rồi giải phóng khóa bằng timer. Không thêm timer định kỳ, SQL pool, connection hoặc truy vấn Supabase định kỳ; chỉ khi có lượt phục hồi mới claim/release và lưu kết quả xác minh. Các lượt xác minh bootstrap có giới hạn trước đây được giữ nguyên.

## Kiểm chứng

`node scripts/zalo-web-session-recovery-smoke-test.cjs` chạy code service/check/poller với Electron/API/DB giả lập: dữ liệu đến muộn, mất bootstrap, reload một lần, retry thủ công, cookie mất/tạm thiếu khi navigation, CDP ngắt/crash, timeout headers/body, claim bận/thất bại, producer lỗi và giới hạn số request DB. Các ca hồi quy giữ claim/cleanup pending để kiểm tra Facebook và account Zalo khác vẫn được kiểm tra, đổi lifecycle không chạy producer cũ, API mới chỉ gọi profile một lần và chỉ trả lượt phục hồi sau thành công trọn vẹn. Không dùng tài khoản hay DB production.

Chạy thêm hai typecheck và production build. Khi kiểm tra với tài khoản thật: mở tab đang đăng nhập → Kiểm tra đăng nhập phải thành công; khi phải phục hồi chỉ reload một lần; đăng xuất thật không được tự báo đã đăng nhập; tài khoản đang chạy tác vụ không bị reload nền.
