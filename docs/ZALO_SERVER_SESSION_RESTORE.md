# Tự khôi phục session Zalo được nhập từ SQL

Thay đổi trong repo akaAgent, dành cho ứng dụng akaAgent Zalo Server. Chưa triển khai lên VPS.

## Hành vi

API migration vẫn ghi tài khoản, session cũ và trạng thái `chưa đăng nhập` trong transaction Supabase. Sau khi commit, vòng discovery hiện có của Zalo Server (60 giây/lượt) tự nhận session chưa xác minh, kể cả khi runtime của nhân viên đã chạy từ trước. Việc xác thực chạy nền; API migration không chờ Zalo và không cam kết session còn hiệu lực trong response.

Server chỉ xét tài khoản Zalo đang bật, chưa xóa, thuộc subtype Server, có `zalo_session` và `zalo_session_last_verified_at IS NULL`, đúng nhân viên/tổ chức đang có quyền Server. Tenant Chat dùng runtime riêng nên không thuộc luồng này. Discovery chỉ đọc ID và mốc cập nhật session, phân trang keyset 1.000 bản ghi; không tải cookie hàng loạt.

Trước khi đọc credential, server giữ reservation trong scheduler và claim tài khoản bằng RPC hiện có với `requires_login=false`. Luồng khôi phục đọc lại thông tin để bỏ qua session đã được QR xác minh, bị thay thế, đăng xuất, vô hiệu hóa hoặc chuyển subtype sau discovery. Các guard quyền và chống tác vụ chạy đồng thời vẫn giữ nguyên.

Session được đăng nhập và xác thực qua `ZaloRuntimeService.checkSession()`:

- Thành công: cập nhật `đã đăng nhập`, thời điểm xác minh, xóa lỗi phiên; giữ API đã đăng nhập trong cache runtime để dùng tiếp. Server phát cập nhật trạng thái và yêu cầu các chiến dịch realtime hiện có làm mới.
- Thiếu/hỏng session: giữ `chưa đăng nhập`. Phiên chắc chắn không hợp lệ không được thử lặp trong cùng runtime; session mới có mốc cập nhật mới sẽ được nhận lại.
- Lỗi mạng hoặc lỗi tạm thời: giữ credential, thử lại sau 1, 2, 4, 8 rồi tối đa 15 phút giữa các lượt. Thời điểm thực tế còn phụ thuộc discovery, tác vụ đang giữ tài khoản và khả năng kết nối.
- Tài khoản bận: chờ lượt sau, không chuyển trạng thái hay hủy tác vụ hiện tại.

Mỗi lượt nền xử lý tối đa 25 runtime nhân viên đồng thời, tuần tự theo tài khoản trong từng runtime. Các lượt không chồng nhau. Xác thực không chặn vòng cập nhật quyền; shutdown chờ producer hiện tại, không khởi chạy tài khoản tiếp theo. Claim/cleanup dùng token hiện có, chỉ bỏ reservation khi registry xác nhận đã giải phóng.

Khôi phục session lúc startup vẫn hoạt động như trước. Tài khoản đã xác minh không được đăng nhập lại mỗi phút. Nút kiểm tra đăng nhập không thay đổi trong bản sửa này.

## Triển khai

Không có migration DB hoặc thay đổi contract API. Không cần deploy akaBizApi cho phần sửa này. Cần build/cập nhật ứng dụng **akaAgent Zalo Server** trên VPS thì luồng mới có hiệu lực:

```bash
npm run build:server:win
```

Cài bản server theo [ZALO_SERVER_VPS.md](ZALO_SERVER_VPS.md). Chỉ sau khi cập nhật server mới kiểm chứng thực tế các tài khoản đã chuyển; bản sửa không tự khẳng định session SQL còn hiệu lực.

## Kiểm chứng local

```bash
node scripts/zalo-server-session-restore-smoke-test.cjs
node scripts/account-operation-cleanup-smoke-test.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build:server
```

Smoke test chạy code discovery, runtime đăng nhập, scheduler reservation và server manager thật với transport DB/Zalo giả lập trong bộ nhớ. Bao phủ phân trang và phạm vi tenant, import sau startup, API cache, session thiếu/hỏng/hết hạn, retry lỗi mạng, tác vụ bận, gọi đồng thời, dữ liệu thay đổi sau discovery, cleanup chưa xác nhận và shutdown khi đang xác thực. Không gọi Zalo hoặc sửa dữ liệu production.
