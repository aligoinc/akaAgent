# Điều tra Facebook HTTP login — 25/09/2026

Các mục dưới đây ghi nhận bản trước khi sửa. Ngày 26/09/2026 đã triển khai profile Android Messenger có mã hóa, giữ machine ID và nhánh phê duyệt có giới hạn; xem [hành vi hiện tại](FACEBOOK_LOGIN.md). Lượt thử ban đầu tiếp tục thất bại với `418/2779001`. Mục cuối tài liệu ghi kết quả điều tra bằng dữ liệu test do user cung cấp: đã xác định và sửa nhánh đổi khóa cùng header xác minh HTTP, kiểm chứng thành công cả hai tài khoản.

## Kết luận hiện có

Hai lượt thử thực tế gần nhất bị Facebook từ chối ngay ở request mật khẩu, trước khi app gửi TOTP. Code hiện tại kết thúc lượt với `code=401, subcode=1348131`; không có bước chờ phê duyệt. Đây không phải lỗi hết hạn 45 giây. Chưa xác định được lý do phía Facebook từ chối request và chưa có lần đăng nhập bằng FB4A thành công để xác nhận protocol hiện tại.

User đã đăng nhập thủ công thành công bằng cách phê duyệt thông báo trên thiết bị khác. Điều đó xác nhận luồng browser ấy hoạt động, nhưng không chứng minh request FB4A được chấp nhận, không kiểm chứng seed TOTP và không chứng minh phê duyệt browser áp dụng cho phiên HTTP khác.

## Bằng chứng local

Hai bản ghi `[FacebookLogin] Rejected request metadata` có cùng hình dạng:

```json
{
  "phase": "password",
  "code": 401,
  "subcode": 1348131,
  "hasErrorData": true,
  "uid": "missing",
  "hasFirstFactor": false,
  "hasMachineId": true,
  "hasApprovalToken": false,
  "hasSessionCookies": false
}
```

Đây là các cờ cho những trường chẩn đoán đã cho phép, không phải bản sao toàn bộ response. Không suy diễn rằng mọi trường/challenge khác đều vắng mặt. Bản ghi không chứa UID, mật khẩu, seed, cookie hoặc giá trị token.

`twoFactorMetadata()` chỉ cho phép subcode `1348162` và `1348023`. Với `1348131`, code trả lỗi trước vòng TOTP. `FacebookLoginSession` sau đó được dọn; lượt mới tạo device ID/machine ID mới. Tăng timeout hoặc thêm một khoảng chờ đơn thuần không làm lượt cũ tiếp tục.

Đã bổ sung kiểm tra dữ liệu tại HTTPS server fixture sau khi request đi qua Electron thật và proxy CONNECT có xác thực: POST, Content-Type, Authorization và User-Agent đúng với code hiện tại; mật khẩu chứa khoảng trắng đầu/cuối, `+&=%#`, chữ Việt và Unicode được giữ nguyên khi giải mã form. `node scripts/run-facebook-login-browser-smoke.cjs` chạy thành công. Kết quả loại trừ lỗi biến đổi dữ liệu trong transport ở những ca đã thử, không khẳng định nội dung khách nhập là đúng hay Facebook chấp nhận các header đó.

## Đối chiếu các triển khai HTTP

| Điểm | akaAgent hiện tại | Bằng chứng đối chiếu / giới hạn |
| --- | --- | --- |
| Mật khẩu | Giá trị gốc trong form, có HTTPS bảo vệ đường truyền | Android login của mautrix/facebook mã hóa thêm bằng public key Facebook; khác biệt chưa chứng minh là nguyên nhân lỗi. |
| Thiết bị | Tạo machine ID local; không nhận machine ID từ challenge để dùng ở bước OTP | mautrix/facebook giữ machine ID server trả về. Bỏ qua giá trị này là điểm cần sửa khi chuẩn hóa protocol; chưa giải thích được lỗi trước OTP. |
| `jazoest` | Hai giá trị cố định | mautrix/facebook tính từ device UUID; không tự trộn từng trường giữa hai profile request. |
| Phê duyệt thiết bị | Chưa có | mautrix/facebook có kiểm tra `check_approved_machine`, sau đó dùng transient auth token để hoàn tất. Hai response đã quan sát không có token ấy trong các trường đã kiểm tra; chỉ có machine ID không đủ để chạy nguyên luồng này. |
| Triển khai mới hơn | Chưa tích hợp | mautrix/meta dùng luồng Messenger qua Bloks, giữ trạng thái và callback chờ phê duyệt. Không phải thay endpoint hoặc kéo dài timeout là dùng được. |

Nguồn trực tiếp:

- [mautrix/facebook: Android login](https://github.com/mautrix/facebook/blob/master/maufbapi/http/login.py). Repo đã được [archive ngày 02/03/2024](https://github.com/mautrix/facebook); chỉ dùng để hiểu protocol cũ, không coi là bằng chứng hiện còn đăng nhập được.
- [mautrix/meta: Messenger login](https://github.com/mautrix/meta/blob/30de42a8b9354cbcc99219b40535d800af68f99e/pkg/messagix/messengerlite.go).
- [mautrix/meta: trạng thái Bloks và chờ phê duyệt](https://github.com/mautrix/meta/blob/30de42a8b9354cbcc99219b40535d800af68f99e/pkg/messagix/bloks/selenium.go). Code này duyệt cây thành phần Bloks và chạy hành động/callback từ response; không dùng DOM browser, nhưng vẫn phụ thuộc cấu trúc giao diện native. Không coi đây là API xác thực ổn định hoặc đưa vào app như một thay đổi nhỏ.

Đã probe riêng `https://graph.facebook.com/pwd_key_fetch` với public app token có sẵn trong source và device UUID mới: HTTP 200, có key ID và public key RSA 2048 bit hợp lệ. Không gửi UID, mật khẩu, seed hay cookie của khách, không gọi login. Kết quả chỉ xác nhận bước lấy public key còn hoạt động; không xác nhận mã hóa mật khẩu sẽ giải quyết `1348131`.

## Hướng xử lý có căn cứ

Ưu tiên kiểm chứng một profile request nhất quán cho bước mật khẩu, gồm chuẩn bị public key nếu protocol yêu cầu và giữ device/machine ID xuyên suốt lượt. Chỉ thêm nhánh TOTP hoặc phê duyệt khi nhận được challenge có đủ dữ liệu tiếp tục, có deadline/hủy và giới hạn request. Không tự coi mọi `401/1348131` là trạng thái chờ, không lặp mật khẩu để dò trạng thái.

Lượt điều tra này chỉ thêm kiểm thử transport và tài liệu, chưa thay protocol chạy thật, chưa thêm DOM/selector hoặc polling. Cần kiểm chứng đăng nhập tài khoản thật sau một thay đổi protocol có chủ đích trước khi kết luận đã sửa được lỗi.

## Cập nhật sau lần thử Android Messenger — 26/09/2026

User nhận `Facebook chưa chấp nhận bước mật khẩu (code=418, subcode=2779001)`. Terminal xác nhận phase `password`, error data có machine ID; các trường UID, first factor, approval token và session cookies được kiểm tra đều không có. Nhánh TOTP/phê duyệt chưa chạy. Đây là `error.code` từ JSON, không được suy diễn thành ý nghĩa của HTTP status 418.

Việc đổi từ FB4A sang Android Messenger là thay đổi thử nghiệm dựa trên khác biệt giữa các implementation, chưa phải bản sửa có nguyên nhân gốc đã được xác nhận. Các test fixture và build không chứng minh Facebook chấp nhận protocol, mật khẩu hay seed của tài khoản thật. Kết quả mới không chứng minh đang tiến gần thành công chỉ vì mã lỗi thay đổi.

Đã tìm mã chính xác trên web và các issue public của mautrix; chưa có nguồn liên quan đủ tin cậy giải thích `2779001`. Không áp dụng giải thích của HTTP 418, React 418 hoặc lỗi WhatsApp trùng số.

Đã thực hiện đúng một request login không dùng tài khoản khách, với tên đăng nhập `akaagent-protocol-probe@example.invalid` và mật khẩu giả ngẫu nhiên. Dùng code dựng request/mã hóa hiện tại với transport adapter Node fetch; không đi qua Electron hoặc proxy tài khoản khách. Endpoint lấy key trả HTTP 200. Endpoint login trả HTTP 400, JSON code 400/subcode 1348076, `Invalid username or email address`; chỉ ghi phần mô tả của probe, không ghi giá trị machine ID. Điều này xác nhận endpoint còn phân loại tên đăng nhập không tồn tại trong điều kiện probe; không xác nhận chữ ký/mã hóa đã được kiểm tra, không suy ra nguyên nhân của lỗi 418 ở tài khoản thật.

Log hiện có của lượt thật đã bỏ phần mô tả tự do của Facebook, nên không thể khôi phục `message`/`error_user_msg` sau khi response đã được dọn. Cần chẩn đoán phần mô tả từ một response thực tế đã che thông tin nhạy cảm trước khi kết luận và thay logic tiếp. Lượt điều tra cập nhật này không sửa protocol, không gửi thêm request vào tài khoản khách và không yêu cầu khách lặp lại cùng bản chưa thay đổi.


## Kiểm chứng bằng hai tài khoản thật — 26/09/2026

Đọc file test do user chỉ định bằng `textutil` trong runner local, không đưa nội dung vào source/log. Runner bundle trực tiếp service TypeScript hiện tại và dùng Electron thật, session bộ nhớ riêng, mạng trực tiếp; không kết nối Supabase, không tạo account/profile bền vững, không tạo BrowserWindow hoặc đọc/tương tác DOM. Các sửa thử nghiệm trước đó chỉ nằm trong bundle tạm; lượt kiểm chứng cuối dùng nguyên code service đã sửa, không plugin/stub transport.

### Bằng chứng và thay đổi

1. Bản chưa sửa tái hiện HTTP 400, JSON `error.code=418`, subcode `2779001` trên cả hai tài khoản. Phần mô tả chỉ là “An unexpected error occurred. Please try logging in again.”; `error_data` chứa `pwd_enc_key_pkg`, `error_subcode`, `machine_id`. Không có first factor/UID/auth token/cookie trong phản hồi đó. Đồng hồ máy lệch khoảng một giây so với HTTP Date của Facebook, không phải lệch giờ TOTP đáng kể.
2. `pwd_enc_key_pkg` chứa `key_id`, `public_key`, `seconds_to_live`; key ID và public key khác bước `pwd_key_fetch`. Thử mã hóa lại bằng package trả về, giữ cùng device và machine ID, nhận `406/1348162` kèm first factor. TOTP tiếp theo trả HTTP 200 và session cookies. Đây là bằng chứng cho nhánh thay khóa của lỗi 418 đã quan sát, không phải giải thích chung cho mọi mã lỗi Facebook.
3. Cookie được cấp nhưng HTTP verifier cũ trả 400. Probe public không cookie cũng trả 400 khi gắn User-Agent browser; bỏ header này để dùng UA mặc định của node-fetch thì trả 200 và bootstrap. Tách riêng Accept/Cache-Control không gây 400. Nguyên nhân sâu hơn phía Facebook chưa biết; thay đổi chỉ bỏ header browser khỏi HTTP client, giữ proxy/cookie/giới hạn và điều kiện parser.
4. Sau hai thay đổi, verifier hiện có xác nhận `ACCOUNT_ID` khớp `c_user`, có `xs` và DTSG, trạng thái `authenticated`. Không nới điều kiện xác minh cookie.

### Kết quả lượt cuối với code chính thức

| Dữ liệu test | Password → khóa thay thế → TOTP | Xác minh Facebook web | Graph tên | Thời gian |
| --- | --- | --- | --- | --- |
| Tài khoản dòng 1 | Thành công | Authenticated, đúng UID | Có tên | 13 giây |
| Tài khoản dòng 2 | Thành công | Authenticated, đúng UID | Có tên | 14 giây |

Mỗi tài khoản ở lượt cuối dùng một request lấy key, hai request credential kiểu password (khóa đầu và khóa thay thế), một request TOTP; không phải chờ user phê duyệt thiết bị. Số BrowserWindow luôn bằng 0. Cookie chỉ ở partition bộ nhớ của runner và được xóa khi kết thúc; không có dữ liệu account, credential/token/cookie hoặc response thô trong tài liệu này.

Nhánh đổi khóa chỉ chạy đúng một lần cho `418/2779001` có package mới hợp lệ, trước OTP; giữ hạn 45 giây/request và 120 giây/lượt. Các lỗi khác, package không hợp lệ/không đổi, từ chối lần hai, hủy và timeout đều dừng. Không thêm polling/RPC/connection Supabase hoặc thay luồng DOM/check login thủ công.

Kiểm thử hồi quy bao gồm hai khóa RSA khác nhau và giải mã envelope ở server fixture, giữ device/machine, refresh → OTP → cookie/web verify qua Electron + proxy HTTPS thật, giới hạn một lần/hủy/timeout và không gửi plaintext. Thử thật xác nhận login/2FA/cookie web/name; không kiểm chứng thao tác tạo account/profile vào DB production hoặc chiến dịch.

Các kiểm tra sau sửa đều PASS: `facebook-login-request-smoke-test.cjs`, `facebook-session-request-smoke-test.cjs`, `run-facebook-login-browser-smoke.cjs`, `facebook-login-smoke-test.cjs`, `facebook-login-legacy-check-smoke-test.cjs`, hai typecheck Node/Web, `npm run build` và `git diff --check`. Production build vẫn có cảnh báo Vite dynamic/static import như trước, không có lỗi. Chưa đóng gói lại DMG/EXE. Runner tạm và thư mục userData riêng đã dọn, giữ nguyên file test gốc của user.
