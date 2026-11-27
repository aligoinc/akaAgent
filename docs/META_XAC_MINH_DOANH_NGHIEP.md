# Hướng dẫn xác minh doanh nghiệp trên Meta

Dùng cho app Meta của akaBiz (tin nhắn fanpage trong hộp thư Chat). Viết ngày 20/11/2026 theo trang trợ giúp của Meta bản tiếng Anh. Giao diện tiếng Việt có thể đặt tên nút hơi khác.

Việc này không cần merge hay deploy gì, làm ngay được. Meta mất tối đa **14 ngày làm việc** để duyệt, nên làm sớm.

Vì sao phải làm: app dùng cho Page của doanh nghiệp khác phải xin quyền ở mức Advanced Access. Muốn xin mức này, app phải gắn với một doanh nghiệp đã xác minh.

---

## 1. Chuẩn bị

### Người làm
- Tài khoản Facebook có **toàn quyền** (full control) trên business portfolio của akaBiz.
- Nếu không vào được **Trung tâm bảo mật** (Security Center) thì tài khoản đó chưa có toàn quyền.

### Thông tin doanh nghiệp
Phải khớp **đúng từng chữ** với giấy tờ:
- Tên pháp lý.
- Địa chỉ.
- Số điện thoại.
- Website: phải mở được, chạy `https` và không có link dẫn tới trang lỗi.
  - Ngày 20/11/2026 `https://akabiz.net` mở được, http tự chuyển sang https.

### Giấy tờ
Meta nhận giấy tờ **tiếng Việt**, không cần dịch. Giấy phải còn hạn và do cơ quan có thẩm quyền cấp.

| Giấy tờ | Dùng để xác minh |
|---|---|
| Giấy chứng nhận đăng ký doanh nghiệp (nên dùng) | Tên pháp lý, địa chỉ |
| Giấy tờ thuế do cơ quan nhà nước cấp | Tên pháp lý, địa chỉ |
| Sao kê ngân hàng của công ty | Tên pháp lý, địa chỉ |
| Hoá đơn điện / nước / viễn thông đứng tên công ty | **Chỉ** địa chỉ và số điện thoại, không dùng cho tên pháp lý |

Lưu ý:
- Không nhận tờ khai thuế tự nộp.
- Giấy ĐKKD không có số điện thoại thì nộp thêm hoá đơn đứng tên công ty có số đó.
- Trước khi tải lên, che các thông tin cá nhân không cần, ví dụ số CCCD của người đại diện.

### Cách nhận mã xác nhận
Chọn một trong các cách sau:
- **Email cùng tên miền với website**, ví dụ `...@akabiz.net`. Email khác tên miền thì Meta không gửi mã.
- **Điện thoại, SMS hoặc WhatsApp** tới số của công ty.
- **Xác minh tên miền**: thêm một thẻ meta vào website hoặc một bản ghi DNS. Cách này dùng khi không có email cùng tên miền, hoặc không có số điện thoại công ty.

---

## 2. Các bước xác minh

1. Vào `business.facebook.com` và chọn đúng business portfolio của akaBiz.
2. Mở **Cài đặt → Trung tâm bảo mật**.
3. Bấm **Bắt đầu xác minh**.
   - Nếu thấy **Không đủ điều kiện xác minh** thì dừng lại và báo bên kỹ thuật. Khi đó bắt đầu từ trang app (mục 3).
4. Nhập tên pháp lý, địa chỉ, số điện thoại, website, đúng như trên giấy.
5. Meta tìm bản ghi doanh nghiệp.
   - Có đúng doanh nghiệp thì chọn.
   - Không đúng thì chọn **Doanh nghiệp của tôi không có trong danh sách** (hoặc **Không khớp**), rồi tải giấy tờ lên.
6. Chọn cách nhận mã, nhập mã, bấm **Xong**. Màn hình báo đã nhận hồ sơ.
7. Chờ thông báo kết quả, tối đa 14 ngày làm việc.

### Trong lúc chờ và sau khi được duyệt
- **Đừng sửa thông tin doanh nghiệp.** Sửa là phải xác minh lại từ đầu.

### Nếu bị từ chối
- Xem trạng thái và kháng nghị ở **Trung tâm bảo mật**.
- Các lý do Meta nêu:
  - website không mở được, không https, hoặc có link dẫn tới trang lỗi;
  - thông tin sai hoặc gây hiểu nhầm;
  - người nộp không được quyền đại diện doanh nghiệp.

---

## 3. Gắn app Meta vào doanh nghiệp

App Meta chưa tạo, nên làm phần này lúc tạo app:

1. Trên `developers.facebook.com`, tạo app loại **Business** và chọn business portfolio của akaBiz.
2. Vào **Settings → Basic → Verification**. Mục này phải ghi app đã gắn với doanh nghiệp đã xác minh.

Ai làm được việc gì:
- Người có vai trò **Admin trên app** gắn được app vào doanh nghiệp, kể cả khi doanh nghiệp chưa xác minh.
- Chỉ **Admin của doanh nghiệp** mới hoàn tất được việc xác minh.
- Nút **Start Verification** ở trang app cũng chỉ chuyển sang Business Suite để làm các bước ở mục 2.

---

## 4. Sau khi xác minh xong

1. Cấu hình app:
   - Webhook: `https://aka-agent-chat-api.fly.dev/api/meta/webhook`.
   - Redirect của Facebook Login for Business: trang `/settings/facebook-pages/callback` của Chat Web.
2. Đặt secrets trên Fly. Bên kỹ thuật đưa lệnh để tự chạy. **Không dán App Secret vào chat.**
3. Merge code, apply migration và deploy. Lý do: Meta đòi mỗi quyền có ít nhất một lần gọi thành công trong 30 ngày trước khi nộp App Review, mà phải chạy thật mới gọi được.
4. Thử với Page của akaBiz.
5. Quay video cho từng quyền rồi nộp App Review. Meta trả kết quả trong khoảng một tuần.

---

## Nguồn

- [Cách xác minh doanh nghiệp](https://www.facebook.com/business/help/2058515294227817)
- [Giấy tờ được chấp nhận](https://www.facebook.com/business/help/159334372093366)
- [Giới thiệu về xác minh doanh nghiệp](https://www.facebook.com/business/help/1095661473946872)
- [Lý do hồ sơ bị từ chối](https://www.facebook.com/business/help/2342133782492969)
- [Khi nào dùng xác minh tên miền](https://www.facebook.com/business/help/245311299870862)
- [Xác minh doanh nghiệp, phía developer](https://developers.facebook.com/docs/development/release/business-verification)
