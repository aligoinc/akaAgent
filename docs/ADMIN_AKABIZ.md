# Admin akaBiz — desktop

Menu **Admin akaBiz** nằm ngay dưới **Cài đặt Workflow**, dành cho nhân viên đang hoạt động có **`org_staff.is_admin IS TRUE` và `organization_id = 1`**. `NULL`/thiếu cờ không cấp quyền. `is_admin_akabiz` vẫn phục vụ các chức năng cũ, không cấp quyền Admin này.

## Sử dụng

- **Doc API:** mục lục bên trái, website đang chọn bên phải. Bấm **Thêm** để nhập tên, URL HTTP(S), mô tả, thứ tự và trạng thái bật/tắt; số thứ tự nhỏ đứng trước. Nút sửa/xóa nằm cạnh từng mục. Có sẵn **API akaChat** (`https://chat.akabiz.biz/developers`). Trang gốc cung cấp nội dung/công cụ thử API; thay URL hoặc sửa website không cần phát hành lại desktop. Nếu website cần đăng nhập, đăng nhập thủ công. Liên kết khác origin mở trong trình duyệt mặc định.
- **Thông báo trên Web/App:** sửa thông báo chung hoặc tìm khách hàng theo username trên toàn hệ thống, kiểm tra tên tổ chức trước khi lưu. Mỗi tài khoản khách hàng có một nội dung. Phần tùy chọn gồm tiêu đề, mức độ, nhãn/link và thời gian theo Việt Nam; có xem trước. Danh sách giữ cả thông báo tương lai/hết hạn. **Xóa** chỉ ghi chuỗi rỗng, không xóa tài khoản khách hàng hay setting.
- **Cài đặt hệ thống:** tìm biến, sửa mô tả/giá trị. Không thêm/xóa biến, không đổi tên hoặc cờ active/secret. Secret mặc định che; **Hiện giá trị** xác minh lại quyền ở backend. Nội dung bạn nhập hoặc xóa trong lúc chờ hiện giá trị được giữ nguyên khi phản hồi về. Chỉ sửa mô tả sẽ giữ giá trị hiện tại. Nếu dữ liệu đã đổi từ lần đọc, đóng form, làm mới và sửa lại.
- **Cron job Supabase:** chọn job hoặc bộ lọc kết quả. Log mới nhất trước, **Trang tiếp** lấy tối đa 100 dòng tiếp theo, **Về đầu** trở lại mới nhất. **Xem** xem thời gian, thời lượng, trạng thái gốc, câu lệnh và thông điệp. Lịch có diễn giải tiếng Việt kèm biểu thức gốc, giữ nguyên timezone cron được ghi trên màn hình; thời gian thực thi hiển thị theo Việt Nam. Không có thao tác chạy/sửa job.
- **Function from Trigger:** tìm theo trigger, bảng hoặc hàm. Danh sách gồm cả trigger tắt của bảng `public`, loại trigger nội bộ PostgreSQL. Chi tiết tải định nghĩa trigger và body hàm vào Monaco chỉ đọc; không thực thi hoặc sửa SQL.

## Dữ liệu và quyền

Chỉ có **một bảng nghiệp vụ mới**: `public.auto_admin_api_docs`. Các chức năng còn lại dùng dữ liệu hiện hữu:

| Chức năng | Nguồn |
| --- | --- |
| Danh mục Doc API | `auto_admin_api_docs` |
| Thông báo chung | `auto_system_settings.key = 'app.notification'` |
| Thông báo riêng | `org_staff.app_notification` |
| Biến hệ thống | `auto_system_settings` |
| Cron / log | `cron.job`, `cron.job_run_details` |
| Trigger / hàm | `pg_trigger`, `pg_class`, `pg_namespace`, `pg_proc` |

Bảng tài liệu bật RLS và thu hồi quyền truy cập trực tiếp từ `PUBLIC`, `anon`, `authenticated`, `service_role`; không có policy cho client. Năm RPC chức năng `aka_agent_admin_docs`, `aka_agent_admin_notifications`, `aka_agent_admin_settings`, `aka_agent_admin_cron`, `aka_agent_admin_triggers` dùng chung helper `aka_agent_admin_assert_access`. Mỗi lần gọi đều kiểm tra credential, staff active, `is_admin` và tổ chức 1. Helper không cấp EXECUTE cho client; các RPC nhóm chỉ cấp cho `anon`/`authenticated` theo cơ chế desktop hiện có.

Credential chỉ được thêm trong main process. IPC `admin:*` chỉ nhận từ main frame của cửa sổ ứng dụng. Renderer gửi ID tài liệu; main đọc URL đã lưu qua RPC. Không có API chạy SQL tùy ý. `AuthUser.isAdmin` được đọc lúc login/bootstrap và cập nhật bằng vòng refresh quyền 30 giây hiện có; phát hiện mất quyền sẽ đóng guest và thoát trang. RPC phát hiện mất quyền sớm hơn sẽ thu hồi ngay. Lỗi truy vấn quyền cũng đóng quyền Admin theo nguyên tắc fail-closed.

Thông báo đọc/ghi raw text hoặc JSON. Editor không áp bộ lọc thời gian khi mở form. Client Web/App tiếp tục dùng parser và refresh cũ: thông báo staff hợp lệ ưu tiên hơn thông báo chung. Không có kênh realtime mới. Lưu sử dụng version/hash và khóa row để báo xung đột; secret không lưu trong renderer storage hoặc log và bị bỏ khỏi state khi đóng form/tab.

**Phạm vi ACL:** migration này không siết ACL legacy của `org_staff` hoặc `auto_system_settings`. Các đường Admin mới có guard riêng; không coi đây là việc khắc phục quyền truy cập trực tiếp legacy cho toàn hệ thống.

## Vòng đời webview và truy vấn

`AdminDocsWebService` dùng partition `persist:akaagent_admin_docs_1_<staffId>_<docId>`, độc lập CRM/akaChat và tài khoản automation. Chỉ tài liệu đang chọn có guest; chuyển tài liệu, rời Doc API, logout, đổi tài khoản, hết phiên hoặc mất quyền đóng guest/popup và chặn request tiếp theo. Cookie/storage riêng vẫn giữ để đăng nhập thủ công. Guest/popup không có preload/Node, có sandbox/context isolation/web security, chặn quyền thiết bị và tải file. Guest crash được bỏ đi, **Thử lại** tạo guest mới.

Doc API cho phép `clipboard-sanitized-write` từ guest/popup đang thuộc service, đúng origin tài liệu và còn quyền truy cập; quyền đọc clipboard và yêu cầu từ iframe khác origin vẫn bị chặn. Cấp quyền này không thêm hộp thoại xin quyền hệ điều hành, không gọi focus/show hoặc đưa cửa sổ lên trước.

Repository dùng Supabase HTTP client hiện có, request timeout 12 giây; RPC cấu hình timeout 8 giây, mutation lock timeout 3 giây. Không thêm pool SQL, connection giữ lâu, worker, listener hoặc polling cron. Cron dùng keyset `runid < cursor ORDER BY runid DESC LIMIT 101` (trả 100 dòng và cursor), không đếm tổng. Chi tiết log/body hàm chỉ tải khi mở. V296 sửa timeout khi lọc job thưa/đã tắt; xem [audit v296](ADMIN_CRON_V296_AUDIT.md).

## Kiểm chứng

```sh
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
node scripts/run-admin-smoke-test.cjs
```

Electron smoke chạy UI/IPC/repository/webview thật với HTTP fixture và Supabase giả, profile tạm, không truy cập DB production. Bao phủ quyền, raw notification, CRUD, chống lưu trùng, cookie cách ly, sandbox popup, popup cleanup, crash/retry, secret (kể cả sửa/xóa khi reveal đang chờ), cron cursor, Monaco, phản hồi prepare đến muộn và thu hồi quyền. Kiểm tra quyền clipboard bằng Permissions API, bao gồm iframe khác origin; không đọc/ghi clipboard thật hoặc bật cửa sổ kiểm thử.

SQL smoke: chạy nội dung `migrations/tests/migration_v294_admin_akabiz_smoke.sql` trong **`BEGIN; ... ROLLBACK;`**, với `lock_timeout`/`statement_timeout` hữu hạn. Không commit dữ liệu thử, không gọi câu lệnh cron hay hàm trigger đang xem. Kiểm tra quyền, CAS, URL, thông báo, secret, metadata và phân trang. Không ghi credential/secret ra kết quả.

Migration/audit production: [ADMIN_AKABIZ_MIGRATION_AUDIT.md](ADMIN_AKABIZ_MIGRATION_AUDIT.md).
