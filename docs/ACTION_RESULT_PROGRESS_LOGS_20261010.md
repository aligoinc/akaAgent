# Log lỗi khi nhận kết quả qua policy

## Nguyên nhân

`fb_open_composer` trả `actionResult` lỗi rồi kết thúc workflow bình thường để bỏ qua phần đăng bài. Writer ghi detail Lỗi, nhưng đường explicit result chưa có log tiến trình chung cho Facebook. Thông báo từ policy trước đây chỉ xuất hiện qua tác dụng dừng; sau V376 bỏ yêu cầu dừng thì log lỗi không xuất hiện nữa.

`✅ Hoàn thành` là **hoàn thành xử lý data**, không phải thành công hành động. Người dùng xác nhận giữ nguyên dòng này và câu chữ hiện có. Kết quả đúng là log lỗi, hoàn thành data, nghỉ rồi xử lý target tiếp theo nếu policy chưa yêu cầu dừng.

## Sửa trong runtime

- Kết quả explicit lỗi/thất bại chưa có logger chuyên biệt ghi thông báo một lần trong receipt của kết quả. Nhận nhóm failure từ metadata đã lưu, không phụ thuộc việc policy có tính bad-target hay dừng chiến dịch.
- Dùng thông báo đã ghi trong detail; khi policy suppress detail, dùng thông báo từ policy đã nạp hoặc helper hiện có. Không đọc thêm catalog, thêm pool hoặc thay thời điểm nạp.
- Email/Zalo tiếp tục dùng logger hiện tại; khi detail không có log thì giữ được thông báo sẵn có từ helper/policy.
- Output Email/Zalo chỉ có trạng thái lỗi/thất bại, thiếu `message` và `errorCode`, dùng câu dự phòng hiện có “Có lỗi xảy ra” cho log tiến trình. Nhận diện cả trạng thái mới có `report_group=failure`; không thêm thông báo cho Thành công/Bỏ qua thiếu nội dung và không ghi câu dự phòng vào detail.
- Adapter newsfeed thành công chỉ dùng cho output Thành công phù hợp; cờ DOM cũ không ghi đè thông báo lỗi trong explicit result.
- Group-post verification giữ logger chuyên biệt; replay, relay và finalization dùng receipt để không lặp log. Batch không gán tên target đầu cho kết quả của target khác.
- Giữ nguyên log hoàn thành data, note/log cũ, mẫu thông báo, detail/input settlement, quota, bad-target, ngưỡng lỗi và side effect của policy. Không sửa producer, schema hoặc dữ liệu DB.

## Kiểm chứng

`node scripts/action-result-progress-smoke.cjs` chạy 31 trường hợp với writer/settlement PostgreSQL WASM, workflow và scheduler thật; browser/transport được giả lập, không gửi/đăng thật. Bao gồm lỗi có/không dừng, inherit/suppress, Facebook/Email/Zalo, trạng thái failure mới, batch, newsfeed dual output, callback đồng thời và replay. Có 14 trường hợp Email/Zalo kiểm tra thông điệp thiếu/rỗng, giữ thông điệp đã có, không thêm log Thành công/Bỏ qua, không đổi detail/quota/policy và không ghi log trùng. Kiểm thử thiếu thông điệp đã thất bại trên source trước sửa. Trường hợp vòng scheduler đầy đủ kiểm tra lỗi composer → log lỗi → hoàn thành data → nghỉ 30 giây giả lập → target tiếp theo thành công; counter 0→1→0, quota chỉ tính thành công.

Các smoke mixed-output, origin/tracking, helper compatibility/control, threshold/input, policy progress, partial-send và V376/V377 bảo vệ hành vi hiện có. Test mapper cục bộ bổ sung `reportGroup` để giống mapper production. Chat worker đã có log độc lập với detail/policy-stop; sáu kiểm thử `policy progress independent from details` đạt, không cần sửa source Chat.

Hai typecheck và production build Desktop/packaged Server kiểm tra source chung. Không tạo bộ cài hoặc deploy trong lần sửa này.

## Phát hành và hoàn nguyên

V376/V377 đã apply và **không apply lại**. Bản sửa log là thay đổi source, cần đóng gói/cài app mới để có hiệu lực; không cần migration DB. PR #479 bao gồm bản sửa này cùng hồ sơ hai migration.

Hoàn nguyên source chỉ ảnh hưởng cách ghi log của các lượt tiếp theo. Giữ nguyên policy V376/V377 và mọi dữ liệu lịch sử; không xóa/viết lại log cũ.
