# Quản lý nhân viên

Menu tài khoản → **Quản lý nhân viên**, ngay dưới **Cài đặt**. Mọi tổ chức đều dùng được khi người đăng nhập có `org_staff.is_admin IS TRUE`. Quyền **Admin akaBiz** vẫn riêng tổ chức 1. Mất quyền trong lần refresh phiên hoặc khi gọi API sẽ đóng màn hình và bỏ mật khẩu đang hiển thị.

Chi tiết đối chiếu thiết kế và kiểm chứng giao diện: [STAFF_MANAGEMENT_DESIGN_REVIEW.md](STAFF_MANAGEMENT_DESIGN_REVIEW.md).

Giao diện React dựng từ `Quản lý nhân viên.dc.html` trong bộ thiết kế akaAgent (7), dùng token theme của app. Bảng phòng ban ở trên, nhân viên ở dưới; giữ màu nhấn xanh/tím, kiểu bảng và hộp thoại. Chế độ hạn là thông tin chỉ đọc, không giữ nút chuyển chế độ của prototype. Ở cửa sổ hẹp, bảng cuộn ngang bên trong màn hình.

## Nghiệp vụ

- Click hoặc Enter/Space trên dòng để chọn; thanh công cụ thao tác trên dòng đó. Đánh dấu checkbox để đổi máy/trạng thái nhiều người; **Sửa** chỉ bật khi có đúng một người.
- Mặc định xem toàn tổ chức. Chọn phòng ban lọc cả phòng ban con. Tìm theo tên, SĐT, username; lọc hoạt động/tạm khóa/hết hạn; mỗi trang 100 người.
- Mỗi tổ chức có một dòng gốc `org_group.parent_id=NULL`, hiển thị tên tổ chức và không sửa ở màn hình này. Các phòng ban nằm dưới gốc hoặc một phòng ban cùng tổ chức; không chọn chính nó/hậu duệ. Số phòng ban không tính dòng tổ chức, cùng quy tắc Chat Web. V307 tự tạo gốc khi thêm phòng ban đầu tiên và chuyển `parentId=NULL` của caller Desktop cũ thành ID gốc; dùng chung advisory lock với luồng tạo phòng ban Chat để tránh tạo hai gốc đồng thời. Dữ liệu có nhiều gốc bị từ chối khi lưu phòng ban, không tự đoán gốc hay sửa hàng loạt tổ chức khác.
- Mỗi form nhân viên chọn một phòng ban, có thể chọn ngay dòng tổ chức. Form thêm chọn sẵn dòng đầu cây (gốc tổ chức), form sửa giữ phòng ban đang có; nếu nhân viên chưa được phân công thì chọn dòng đầu. DB vẫn dùng `org_group_staff`.
- Từ v308, form có **Là trưởng phòng**, mặc định tắt khi tạo và đọc đúng quyền khi sửa. Mỗi phòng tối đa một trưởng phòng; bật cho người mới sẽ bỏ quyền của trưởng phòng hiện tại, tên người bị thay được hiển thị trước khi lưu. Đổi phòng giữ lựa chọn trưởng phòng như Chat; bỏ chọn chỉ gỡ quyền, vẫn giữ phòng. Bảng phòng ban hiện tên trưởng phòng, bảng nhân viên đánh dấu vai trò ở cột phòng ban. Quyền dùng trong Chat và không cấp `org_staff.is_admin` hay quyền xem tài khoản/chiến dịch người khác trong akaAgent.
- RPC dùng chung lock tổ chức với Chat khi lưu nhân viên và phòng ban. Caller cũ thiếu `isDepartmentManager` giữ nguyên cách cũ: quan hệ không đổi giữ quyền, quan hệ mới không tự cấp trưởng phòng. DB vẫn hỗ trợ nhiều quan hệ nhưng form chỉ lưu một phòng; không hỗ trợ kiêm nhiệm qua màn hình này.
- Tạo nhân viên: chuẩn hóa SĐT, username `organization_id.SĐT`, mật khẩu `123456`, hoạt động, không có quyền admin. Quota `org_organization.max_staff` tính mọi nhân viên chưa xóa, kể cả admin, khóa, hết hạn. Khóa transaction theo tổ chức ngăn hai yêu cầu cùng lấy suất cuối hoặc tạo trùng SĐT.
- Sửa nhân viên đổi tên, SĐT, phòng ban và vai trò trưởng phòng. Username, mật khẩu, hạn được giữ nguyên. Vì username không đổi, một SĐT từng dùng để tạo username có thể chưa dùng lại được cho tài khoản mới; lỗi unique được hiển thị rõ.
- Đổi trạng thái một hoặc nhiều nhân viên; không tự khóa hoặc khóa admin hoạt động cuối cùng. Hết hạn tự tính. Màn hình không xóa, gia hạn, sửa hạn hoặc cấp admin.
- Mật khẩu chỉ tải riêng khi bấm **Hiện**; API danh sách không trả mật khẩu. Xóa giá trị trong bộ nhớ renderer khi ẩn, đổi bộ lọc/trang, rời màn hình hoặc mất quyền. Phản hồi đến muộn không hiện lại giá trị đã ẩn. Không log/persist mật khẩu được tải.
- Đổi máy gỡ `aka_agent_device_fingerprint_hash` của akaAgent v2. Không sửa fingerprint legacy, không trừ `device_changes_remaining`, không kết thúc phiên/presence đang mở. Chuẩn bị lấy revision rồi CAS khi xác nhận; UUID và ledger bảo đảm retry không gỡ liên kết mới.

## Cấu hình hạn

| Cột | Ý nghĩa |
|---|---|
| `org_organization.staff_duration_days` | Integer dương hoặc NULL; NULL hiểu là 365 ngày |
| `org_organization.use_staff_expiration` | Boolean NOT NULL, mặc định false = dùng hạn tổ chức; true = kiểm tra thêm hạn nhân viên; chỉ cấu hình ngoài màn hình này |
| `org_staff.expiration_date` | Timestamptz nullable; xét **ngày Việt Nam**, còn hiệu lực hết ngày đó |

Nhân viên tạo qua RPC quản lý nhận ngày hạn do DB tính: ngày Việt Nam lúc tạo + số ngày cấu hình + 1. Ví dụ tạo ngày 22/09/2026, cấu hình NULL → 365, hạn nhân viên là 23/09/2027. Thay số ngày sau đó không tính lại ngày hạn đã cấp. Migration giữ các nhân viên hiện hữu có hạn NULL; không backfill. V306 dùng cùng một timestamp DB cho ngày tạo và ngày tính hạn, tránh lệch ngày nếu transaction bắt đầu sát nửa đêm.

`use_staff_expiration=false` (mặc định): dùng hạn tổ chức. `true`: kiểm tra thêm hạn nhân viên, NULL thì kế thừa hạn tổ chức. V310 đặt cờ mới false cho mọi tổ chức hiện có; không đảo dữ liệu từ cờ cũ. V312 đã drop cột `use_organization_expiration` sau khi xác nhận không còn nơi dùng; RPC giữ field JSON cũ `useOrganizationExpiration = NOT useStaffExpiration` để app cũ đọc đúng chế độ. Hạn hiệu lực hiển thị là hạn sớm hơn giữa hạn riêng áp dụng và hạn gói akaAgent xa nhất. Nhân viên luôn cần quyền sản phẩm tương ứng còn hạn:

| Tính năng | Product ID |
|---|---|
| Facebook | 3, 10 |
| Zalo | 16, 18 |
| Email | 13 |
| SMS | 17 |

Gói hết sau nhân viên: dừng quyền sử dụng khi nhân viên hết hạn. Nhân viên hết sau gói: tính năng của gói đó ngừng khi gói hết hạn; gói khác còn hiệu lực vẫn được xét riêng. Logic gộp capability Web/Server/QR, `quota_pools`, giới hạn gói và routing tenant Chat hiện hữu được giữ nguyên.

## Kiến trúc và runtime

`src/shared/staffManagement.ts` là hợp đồng typed; preload expose `electronAPI.staffManagement`. IPC `staff-management:invoke` chỉ nhận main renderer frame. Main lấy credential đang đăng nhập từ process, không nhận tổ chức tùy chọn từ renderer. RPC xác thực lại actor, `is_admin`, active/deleted, hạn và tenant; sau khi chờ khóa phải kiểm tra lại actor và giữ khóa đến commit.

Các API: `list`, `saveGroup`, `saveStaff`, `setStatus`, `revealPassword`, `prepareDevices`, `resetDevices`. Sửa dùng revision (`xmin` cùng revision membership). Các mutation dùng UUID; ledger `auto_staff_management_requests` chỉ chứa payload/result không nhạy cảm, RLS bật, không mở quyền table cho client. Khi chưa biết yêu cầu đã commit chưa, hộp thoại giữ nguyên payload/UUID và chỉ cho thử lại cùng yêu cầu.

Tái sử dụng Supabase HTTP client và timer refresh phiên 30 giây hiện hữu. Không thêm SQL pool, listener hoặc polling danh sách. Refresh quyền các tổ chức ngoài org 1 có thêm một RPC nhỏ vào cùng chu kỳ; các truy vấn gói hiện có giữ nguyên.

Desktop kiểm tra staff ở đăng nhập, bootstrap/khôi phục đăng nhập và refresh. Khi khóa/hết hạn được phát hiện, scheduler/automation ngừng nhận việc mới; chờ phần việc đang chạy thoát rồi cleanup phiên. Với hạn staff, DB discovery và các RPC claim cũng chặn lượt mới trên Server. RPC run-control giữ lượt có token đã nhận; replay token cũ và settlement/release vẫn thực hiện được. Quyền tenant/account, CAS và routing Desktop/Server/Chat không đổi.

Nút Dừng quét/Hủy QR trên kết nối Desktop đã xác thực vẫn hoạt động khi nhân viên hết hạn: Server xác minh `expectedRuntimeStartedAt` trùng phiên đang giữ tác vụ, kiểm tra tài khoản cùng staff và đúng subtype Server, rồi chuyển yêu cầu dừng tới tác vụ. Hai lệnh này không gọi RPC kiểm tra capability dành cho việc mới. Dừng vẫn chờ phần việc đang xử lý kết thúc trước khi giải phóng claim; không can thiệp phiên mới hoặc forced shutdown. Client cũ thiếu mốc phiên vẫn phải qua kiểm tra quyền hiện có. Discovery/claim tiếp tục chặn việc mới và dọn runtime hết quyền theo chu kỳ hiện hữu.

Bản sửa đường Dừng/Hủy nằm trong `zaloServerRuntimeManager.ts`, cần cập nhật binary Zalo Server để có tác dụng; không thêm migration hay thay đổi DB. Nó sửa việc lệnh dừng bị từ chối do hết hạn, không thay timeout/cách xử lý lỗi của từng API Zalo.

## Tương thích và triển khai

Migration [v305](../migrations/migration_v305_staff_management.sql) chỉ thêm ba cột nullable/default tương thích, một ledger và bốn function; vá 12 function live, giữ signature, kiểu trả về, owner, security mode, volatility, config và ACL cũ. Các helper cleanup không bị thêm guard hạn. Chi tiết checksum, patch DB-only và kiểm chứng ở [audit](STAFF_MANAGEMENT_MIGRATION_AUDIT.md).

App cũ tiếp tục đọc cột và gọi RPC cũ với hợp đồng cũ. Các tài khoản hợp lệ không bị chặn bởi thiếu cột/signature/quyền schema. Hạn mới có thể tác động app cũ qua RPC dùng chung; không có cờ đánh dấu đã update app. Kiểm chứng sử dụng caller/role cũ, các luồng auth/device hiện hữu và HTTP PostgREST; không phải chạy mọi bản installer lịch sử.

DB v305 và [v306](../migrations/migration_v306_staff_creation_expiry_timestamp.sql) cần có trước khi phát hành binary mới vì binary gọi RPC mới. Không cần sửa cấu hình quyền sản phẩm hay tăng số connection. Không phát hành installer trong task này.

[V307](../migrations/migration_v307_staff_department_organization_root.sql) đồng bộ mô hình phòng ban với Chat Web, giữ nguyên signature/kiểu trả về/ACL của RPC và mọi nhánh nhân viên, hạn, mật khẩu, đổi máy. File trong repo chỉ chứa bản sửa quy tắc dùng chung, không sửa dữ liệu riêng của tổ chức nào. Lần sửa dữ liệu `test 1` đã hoàn tất trên production được ghi riêng trong [audit](STAFF_MANAGEMENT_MIGRATION_AUDIT.md). Không thêm constraint/trigger/pool hay yêu cầu schema reload. Phần form chọn sẵn và số phòng ban cần bản Desktop mới; backend xử lý `parentId=NULL` ngay cả với Desktop trước bản sửa này.

## Kiểm chứng

```bash
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
npm run build:server
node scripts/run-staff-management-smoke-test.cjs
node scripts/staff-session-expiry-smoke.cjs
node scripts/account-operation-cleanup-smoke-test.cjs
node scripts/run-auth-v2-smoke-test.cjs
node scripts/run-device-change-smoke-test.cjs
node scripts/run-admin-smoke-test.cjs
supabase db query --linked --file migrations/tests/migration_v305_staff_management_smoke.sql
supabase db query --linked --file migrations/tests/migration_v307_staff_department_root_smoke.sql
supabase db query --linked --file migrations/tests/migration_v308_staff_department_managers_smoke.sql
supabase db query --linked --file migrations/tests/migration_v281_account_menu_device_change_unlimited_smoke.sql
```

Electron fixture dùng UI, preload, IPC và repository thật với DB mock; không dùng credential/tenant thật. Có screenshot sáng/tối và rộng/hẹp, luồng thêm/sửa, trạng thái, đổi máy nhiều người, retry sau mất phản hồi, mật khẩu đến muộn, quyền bị thu hồi, phân trang, Escape/focus và cuộn ngang.

Smoke account-operation chạy manager, ContactLoader, registry và repository thật với transport giả lập: hết hạn khi đang quét → Dừng → lưu kết quả nhận được → giải phóng account; hủy QR và hoàn tất graceful drain; từ chối phiên cũ, staff/account khác, subtype không đúng, forced shutdown và việc mới khi hết quyền. Không dùng Zalo/DB production.

SQL smoke chạy transaction rollback với fixture riêng; kiểm tra tenant, phòng ban vòng, SĐT trùng, quota, giữ username/quyền nhóm, CAS, mật khẩu, đổi máy, các chế độ hạn/ngày Việt Nam, claim/replay/settle/release của caller `anon` cũ trên Facebook/Zalo Server.

Smoke chạy đồng thời là opt-in: `python3 scripts/staff-management-concurrency-smoke.py --linked`. Nó tạo một tenant riêng, dùng tối đa hai request Management HTTP đồng thời, rồi dọn trong `finally`. Default trigger tạo tài khoản SMS cho staff; cleanup xác minh marker/ownership và tenant không có sản phẩm/chiến dịch. Chỉ transaction dọn fixture dùng `session_replication_role=replica` và khôi phục `origin` trước commit để tránh FK quét bảng run-event 13 GB không có index theo account. Không tắt hoặc thay định nghĩa trigger chung, không đụng tenant thật. Không dùng cách dọn này cho dữ liệu nghiệp vụ.
