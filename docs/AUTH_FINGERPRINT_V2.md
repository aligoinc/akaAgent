# Fingerprint và ghi nhớ akaAgent v2

## Dữ liệu và tương thích

Migration `migration_v276_aka_agent_device_fingerprint_v2.sql` thêm duy nhất
`org_staff.aka_agent_device_fingerprint_hash` (text nullable). Không ghi fingerprint,
nhãn, platform hoặc thời gian binding legacy; không đổi RLS/quyền anon. App cũ và
ứng dụng khác tiếp tục dùng các trường/RPC cũ. Nhiều staff có thể cùng fingerprint.
Không thêm cột version: tra `auto_staff_device_presence.app_version` theo phiên.

Windows đọc System UUID qua PowerShell/CIM, serial mainboard làm dự phòng; Mac dùng
IOPlatformUUID. Nguồn được chọn lưu tại `userData/device-identity-v2.json`; UUID rỗng,
toàn 0/F hoặc serial placeholder bị loại. Nếu không có nguồn phần cứng hợp lệ mới
tạo mã random được lưu bền. Timeout đọc phần cứng không làm đổi nguồn. VM clone giữ
nguyên định danh vẫn có thể trùng; đây không phải cơ chế chống clone/spoof.

## Cập nhật và đăng nhập

1. Ưu tiên tài khoản ghi nhớ local hợp lệ.
2. Chưa có credential local hợp lệ, kiểm tra fingerprint mới có trên hệ thống chưa.
   File chỉ có checkbox và vẫn bật Ghi nhớ tiếp tục được xét chuyển đổi, giữ nguyên
   lựa chọn local. Đã bỏ Ghi nhớ hoặc file hỏng/lỗi giải mã thì không lấy credential cũ.
   Fingerprint mới đã có thì yêu cầu nhập thông tin; không đọc credential theo fingerprint cũ.
3. Chưa có mới xét fingerprint cũ. Nhiều staff: nhập tay. Đúng một staff chưa có
   binding v2: đọc tuỳ chọn đúng staff/hash, chỉ lấy credential nếu bật ghi nhớ.
4. Bật auto thì xác thực tự động; tắt auto thì chờ bấm Đăng nhập. Mật khẩu giữ trong
   main và không điền vào renderer. Đổi username không dùng mật khẩu của người trước.
5. Mọi login kiểm tra active, mật khẩu, gói, policy và binding v2. Binding khác máy
   phải đổi máy; binding đã khớp vẫn được đọc lại từ DB để phát hiện reset/rebind trong
   lúc chờ xác thực. Không xác nhận được thì login thất bại. Binding NULL được CAS sau
   xác thực, không trừ quota. Không sửa binding cũ.

Không có cột đã-migrate. Xoá binding v2 có thể mở lại nhánh chuyển đổi khi đủ điều kiện.
Không xác định được duy nhất tài khoản cũ thì mặc định remember/auto tắt, startup giữ
trạng thái hệ điều hành; người dùng chủ động bật lại. Không tự bật lại cho nhóm 462/748.
Mất local nhưng binding mới đã tồn tại phải nhập lại. File hỏng/lỗi giải mã không
được coi là một lần chuyển mới. Cập nhật bỏ qua phiên bản vẫn dùng cùng quy tắc.

## Ghi nhớ local

`userData/login-v2.json` chứa schema version, tùy chọn và credential được safeStorage
mã hoá. Ghi file tạm, fsync, rename và đọc lại kiểm tra. Không fallback plaintext.
Giữ nguyên package name `aka-biz-auto`, appId `com.akabiz.auto` và userData qua update.

- Checkbox lưu lựa chọn ngay; mật khẩu chỉ lưu sau login thành công.
- Bỏ ghi nhớ xoá credential ngay và tắt auto. Bỏ auto vẫn giữ ghi nhớ.
- Bật auto bật cả remember; không tự đăng nhập ngay chỉ vì vừa tích checkbox.
- Logout hoặc lỗi mạng không xoá credential đã được chọn ghi nhớ.
- Thất bại login không ghi đè mật khẩu đã nhớ bằng mật khẩu vừa nhập sai.
- Lỗi lưu/xoá/Keychain/startup báo riêng, không chặn login hợp lệ; lần mở sau có thể
  cần nhập lại hoặc còn thiết lập trước đó nếu không ghi được xuống đĩa.
- Main giữ credential chờ policy; cancel/đổi username/logout vô hiệu hoá request cũ.

## Đổi máy v2

`aka_agent_prepare_device_change_v2(text)` trả snapshot `{staffId,hash,revision,version:2}`.
`aka_agent_reset_device_binding_v2(text,text,text,uuid,jsonb,jsonb)` giữ contract kết quả
legacy nhưng chỉ gỡ cột mới. Revision dùng xmin của row, không thêm cột; cập nhật staff
đồng thời có thể gây conflict, người dùng thử lại để lấy snapshot mới.

Login reset giữ username + quota + Online guard dưới 120 giây; menu giữ xác thực
password/máy, không ép dừng phiên. Quota dùng chung `device_changes_remaining` (NULL
hiểu là 5). History chứa bindingVersion/revision, không credential. Journal nằm riêng
`userData/device-change-requests-v2`; replay sau mất response không trừ thêm lượt.
Không chạy lại journal legacy bằng RPC v2. Presence vẫn chỉ quan sát.

## Kiểm tra và cài thử

Chạy hai typecheck; `node scripts/run-auth-v2-smoke-test.cjs`,
`node scripts/run-auth-v2-electron-smoke.cjs`, `node scripts/run-auth-v2-renderer-smoke.cjs`,
`node scripts/run-device-change-smoke-test.cjs`, `node scripts/run-chat-web-smoke-test.cjs`.
SQL smoke ở `migrations/tests/migration_v276_device_fingerprint_v2_smoke.sql` luôn rollback.
Mọi sửa RPC phải capture live definition/checksum bằng skill safe-supabase-rpc-migration.

Schema/RPC v276 đã apply trên `akachat` (`cgjbsmqtfhqvttudyjzq`) ngày 12/09/2026;
rollback smoke trước/sau apply và API mới/legacy đều pass. Migration không tự liên kết
staff nào. Không chạy bulk migration push để cài bản này.

Tạo candidate bằng `npm run build:win`, sau đó dùng installer trong `dist` để cài đè;
không xoá userData hoặc browser profiles. Thử bằng tài khoản/môi trường test, không tự chuyển
binding của staff thật. Kiểm tra nhớ/auto trước và sau restart/update, nhiều staff có
cùng fingerprint cũ, sai máy, đổi máy, lỗi ghi và password mới. Chỉ chuẩn bị installer
và hướng dẫn; không tự cài VPS/máy khách hoặc publish bản cập nhật.

### Các bước cài candidate Windows

1. Đóng akaAgent, chạy `dist/akaAgent-Setup-7.2.0.exe`, chọn lại thư mục cài hiện có.
   Đây là bản build thử giữ version 7.2.0 của workspace, chưa phải bản phát hành tự
   động; không chép lên kênh auto-update với cùng version đang phát hành.
2. Giữ nguyên thư mục dữ liệu ứng dụng. Có thể sao lưu nguyên thư mục khi app đã đóng;
   không sao chép credential sang tài khoản Windows khác vì mã hoá gắn với OS user.
3. Mở app. Một staff cũ duy nhất và đủ điều kiện ghi nhớ: app chuyển theo checkbox cũ.
   Fingerprint cũ có nhiều staff hoặc máy đã có binding v2: nhập lại username/password.
   Tích Ghi nhớ nếu muốn lưu; tích Tự động đăng nhập nếu muốn tự vào ở lần mở kế tiếp.
4. Đóng/mở lại để kiểm tra. Nếu có cảnh báo lưu, phiên hiện tại vẫn dùng được nhưng
   cần xử lý quyền ghi/mã hoá trước khi xác nhận tính năng nhớ đã hoạt động.
5. Nếu báo liên kết máy khác, dùng Đổi máy tính theo luồng hiện tại, không xoá file
   định danh để lách binding. Máy cũ cần Offline theo quy tắc đổi máy.

Không cần cập nhật/cài credential trên Zalo Server cho thay đổi auth này. Installer
được build từ workspace hiện tại; các thay đổi Data Scan Zalo đang có trong workspace
cũng nằm trong bản build, không phải phần sửa fingerprint.

Kiểm thử Node mô phỏng không chứng nhận phần cứng Windows/VMware/VPS. Electron smoke
đã kiểm tra mã hoá OS, IOPlatformUUID thật và mở lại ở tiến trình khác trên máy Mac
hiện tại; không thay thế test
installer Windows, Keychain trên các máy Mac khác, hoặc clone VM thực tế.
