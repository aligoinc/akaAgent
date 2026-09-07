# Cấu hình thông tin màn hình đăng nhập

Quản trị tại bảng **`public.auto_system_settings`**, tìm row theo cột **`key`** và sửa cột **`value`**.

| Key | Nội dung | Giá trị ban đầu |
|---|---|---|
| `app.notification` | Thông báo hệ thống, dùng chung với trong app | Giữ nội dung hiện có |
| `akabiz.links.website` | Website akaBiz | `https://akabiz.net/` |
| `akabiz.links.user_guide` | Hướng dẫn sử dụng | `https://www.youtube.com/@akabizai` |
| `akabiz.links.upgrade_payment` | Nâng cấp và thanh toán | `NULL` |
| `akabiz.links.contact_us` | Liên hệ với akaBiz | `NULL` |

Bốn key `akabiz.links.*` là cấu hình dùng chung cho mọi sản phẩm. Đặt `is_active=true`, `is_secret=false` để hiển thị. Link phải là URL HTTP/HTTPS; thiếu row, trống, không hợp lệ hoặc `is_active=false` thì ẩn. Nhập URL vào hai row đang `NULL` để hiện thêm liên kết tương ứng. Mọi link mở bằng trình duyệt ngoài.

`app.notification.value` nhận văn bản thường hoặc JSON:

```json
{
  "title": "Thông tin từ akaBiz",
  "message": "Nội dung thông báo cho khách hàng.",
  "level": "info",
  "linkLabel": "Xem chi tiết",
  "linkUrl": "https://akabiz.net/",
  "startsAt": "2026-10-01T08:00:00+07:00",
  "endsAt": "2026-10-07T23:59:00+07:00"
}
```

Chỉ `message` bắt buộc. `title` là tiêu đề; `level` chọn `info`, `success`, `warning` hoặc `error`; `linkLabel` là chữ trên liên kết `linkUrl`. `startsAt` và `endsAt` giới hạn thời gian hiển thị, có thể bỏ nếu không cần hẹn giờ. Note trống, bị tắt, chưa tới hạn hoặc hết hạn thì panel giữ lời chào và các link hữu ích.

Màn hình đọc lại khi mở, quay lại cửa sổ/tab, có mạng trở lại và mỗi 60 phút khi hiển thị. Thay đổi nội dung và mốc thời gian được áp dụng ở lần đọc kế tiếp. Trước đăng nhập chỉ hiện thông báo hệ thống; sau đăng nhập vẫn ưu tiên `org_staff.app_notification` của staff rồi mới tới hệ thống.
