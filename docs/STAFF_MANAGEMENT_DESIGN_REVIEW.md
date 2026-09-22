# Đối chiếu giao diện quản lý nhân viên

Nguồn: `/Users/lequangnhut/Downloads/Thiết kế akaAgent (7)/Quản lý nhân viên.dc.html`, gồm template HTML, `Component.renderVals()`, `STATUS_META`, `COLS` và `support.js` đi kèm. Áp dụng skill `implement-ui-from-design-code`. Lượt đối chiếu UI ban đầu ngày 22/09/2026 chỉ thay UI và fixture kiểm thử. Lượt sửa tiếp theo đồng bộ quy tắc phòng ban với Chat Web qua v307; xem audit migration.

## Ánh xạ thiết kế sang React

| Phần thiết kế | Bản triển khai |
|---|---|
| Header: tên trang, tổ chức/ID/số ngày bên trái; quota và chế độ hạn bên phải | Dữ liệu từ `StaffPage.organization`, huy hiệu số chỗ còn lại/đã đầy; bỏ hàng summary phụ cũ |
| Padding 18/20/30, khoảng cách panel 14, radius panel 13 | CSS scope `.staff-management`, giữ các kích thước này ở cửa sổ rộng |
| Accent `#5b57e8`, nền trang `#eef1f6`, panel trắng, viền `#dfe5ee` | Palette sáng lấy trực tiếp từ HTML, chỉ áp dụng trong màn hình này; theme tối dùng token app |
| Header phòng ban xanh chuyển sắc, header nhân viên tím chuyển sắc; số bước tròn 26px | Native `<section>`/`<h2>`, icon Lucide và CSS gradient |
| Bảng phòng ban 4 cột, cao cuộn tối đa 236px, chọn dòng rồi bấm Sửa ở header | Native table; dữ liệu cây thật, thụt lề theo độ sâu; Enter/Space chọn; không có cột thao tác phụ |
| Search cạnh Thêm nhân viên, 4 bộ lọc pill dưới header | Input thật, tìm kiếm debounce 250ms hiện có; nút `aria-pressed`, không thêm polling |
| Dòng focus và checkbox chọn nhiều tách biệt; Đổi máy/Đổi trạng thái/Sửa trên toolbar | Dòng focus mặc định đầu trang, checkbox ưu tiên khi có chọn; Sửa vô hiệu hóa nếu chọn nhiều; Bỏ chọn không đổi dữ liệu |
| Bảng nhân viên 10 cột dữ liệu + checkbox, rộng tối thiểu 1060px | Giữ thứ tự/nhãn từ `COLS`; mật khẩu **Hiện/Ẩn** gọi API reveal riêng, không đưa mật khẩu vào danh sách |
| Badge hoạt động xanh, tạm khóa vàng, hết hạn đỏ; số ngày sát hạn màu vàng | Status từ RPC; hết hạn hiển thị “Hết hạn”, 0 ngày còn hiệu lực trong hôm nay không bị đổi thành hết hạn |
| Modal phòng ban 460px, nhân viên 600px, trạng thái/đổi máy 480px; top 44px | Dialog có nhãn, focus đầu form/khôi phục focus, Escape, giữ focus trong dialog; body cuộn riêng khi thiếu chiều cao |
| Form nhân viên: tên/SĐT 2 cột, phòng ban chip, card đăng nhập tím và card hạn xanh | Input/radio thật, chọn đúng một phòng ban; dữ liệu dự kiến tách khỏi hạn chính thức do DB cấp |
| Trạng thái dạng các thẻ chọn, thiết bị dạng danh sách card | Radio trạng thái và dữ liệu `prepareDevices` thật; giữ CAS/retry của API |
| Thông báo thành công nổi dưới màn hình | Toast có `role=status`, tự ẩn sau 3,2 giây và có nút đóng |

## Khác biệt có chủ đích theo nghiệp vụ đã chốt

- Chế độ hạn chỉ đọc, không có nút chuyển như prototype.
- Mặc định toàn tổ chức; chọn phòng ban thực sự lọc cả hậu duệ. Có nút trở lại toàn tổ chức.
- Một dòng gốc đại diện tổ chức, hiển thị badge “Tổ chức”, không tính vào số phòng ban và không sửa như phòng ban thường. Chọn “trực thuộc tổ chức” dùng ID dòng gốc; không tạo thêm dòng `parent_id=NULL`. Đây là quy tắc dữ liệu dùng chung với Chat Web, cập nhật tại v307 sau lượt đối chiếu UI ban đầu.
- Form thêm nhân viên chọn sẵn dòng đầu cây (tổ chức), vẫn cho chọn một phòng ban khác. Form sửa giữ phòng ban hiện tại; nhân viên chưa phân công mới dùng mặc định đầu cây.
- Bổ sung lựa chọn **Là trưởng phòng** theo form `workspace-staff-settings.tsx` của Chat Web, đặt sau chọn phòng và dùng palette/geometry của akaAgent. Cấp người mới hiển thị tên trưởng phòng sẽ bị thay; chuyển phòng giữ lựa chọn vai trò, chỉ áp dụng cho một phòng. Tên/biểu tượng trưởng phòng xuất hiện trong hai bảng, không thêm quyền admin tổ chức. Đây là phần mở rộng theo yêu cầu sau prototype; v308 lưu bằng quan hệ DB hiện có.
- Hết hạn tự tính, không cho người dùng chọn trạng thái Hết hạn, gia hạn, sửa hạn hoặc cấp admin.
- Đổi máy không ép đăng xuất và không trừ lượt; bỏ lời mô tả ép đăng xuất của prototype.
- Sửa nhân viên hiển thị username thực tế, mật khẩu che và hạn đã cấp; không giả định mật khẩu hiện tại là `123456`, không tính lại hạn từ cấu hình mới.
- Prototype có nút giả lập SĐT trùng/chưa dùng. UI thật kiểm tra trùng khi lưu tại DB, không hiển thị xác nhận “SĐT chưa dùng” khi chưa được kiểm chứng.
- Có nút Tải lại, phân trang 100 và trạng thái loading/error/empty. Footer ghi hạn **hiệu lực** theo quyền sản phẩm; không lấy dữ liệu mẫu của prototype làm kết quả nghiệp vụ.
- Cửa sổ hẹp cho toolbar xuống dòng, bảng cuộn ngang; modal xuống một cột dưới 500px. Giữ điều hướng và font stack của ứng dụng.

## Kiểm chứng

Đã mở bản HTML tham chiếu bằng Chromium với runtime cục bộ để so trực quan. Render tham chiếu chỉ dùng cho kiểm tra; không đưa HTML prototype, `support.js`, iframe hay ảnh vào sản phẩm.

Chạy màn hình React thật trong Electron fixture với preload/IPC/repository thật và DB giả lập. Đối chiếu trực quan theme sáng/tối, cửa sổ rộng/hẹp, form tạo/sửa, phòng ban, trạng thái và đổi máy. Fixture dùng dữ liệu mẫu, không đăng nhập hay sửa tenant production.

`node scripts/run-staff-management-smoke-test.cjs` kiểm tra bộ lọc pill, focus dòng bằng bàn phím, parent loại trừ chính nó/hậu duệ, username không đổi trong form sửa, radio phòng ban/trạng thái, chọn nhiều, replay request mất phản hồi, ẩn mật khẩu/phản hồi muộn, lỗi tải và thử lại, phân trang, thu hồi quyền, Escape/khôi phục focus và cuộn ngang. Ảnh kiểm tra được xuất dưới `/tmp/akaagent-staff-*.png`.

Kiểm tra phát hành UI: hai typecheck và `npm run build`. Lượt đối chiếu UI ban đầu không đổi DB; bản sửa mô hình phòng ban tiếp theo cần v307. Không cần build/deploy Server cho thay đổi phòng ban này.
