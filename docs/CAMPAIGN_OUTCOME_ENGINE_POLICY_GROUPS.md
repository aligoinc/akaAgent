# Chính sách xử lý kết quả của bộ chạy mới, xếp theo hành vi

Sinh bởi `scripts/campaign-outcome-engine-policy-groups.cjs` từ production akachat (chỉ đọc) lúc 10:47:02 12/11/2026 giờ VN.
Bảng `auto_outcome_policies` có 264 dòng đang bật (seed_v495_action 2, seed_v495_class 13, seed_v495_engine 14, seed_v495_error 106, seed_v495_status 19, v500_review 109, v501 1). Chỉ bộ chạy mới (engine v2) đọc các dòng này; bộ cũ vẫn chạy theo `auto_error`.

**Cách đọc.**
- Mỗi dòng là một mã lỗi (mã công khai, kèm mã Zalo nếu có) trên một hoặc nhiều thao tác. Chính sách là bản đã gộp (`aka_agent_engine_resolve_policy`): mặc định an toàn < theo trạng thái < theo nhóm lỗi < theo mã < chặn theo thao tác.
- Mỗi mã nằm ở một nhóm theo hành vi nặng nhất: đăng xuất/dừng tài khoản > dừng chiến dịch ngay > khoá có thời hạn > đếm lỗi liền > chiến dịch tạm chờ > về hàng đợi > tạm dừng data > không rõ kết quả > bỏ qua > ghi kết quả có tính lượt.
- Data đi đâu tách hai cột. "Data chưa gửi gì": lỗi xảy ra trước khi có gì tới người nhận (lỗi ở bước gửi đầu tiên, hoặc ở bước đọc như tra số, đọc hồ sơ); đây là cột lấy từ chính sách. "Data đã gửi được tin / ảnh": lỗi xảy ra ở bước sau khi data đã gửi được tin hoặc ảnh; cột này là luật cố định của DB, không do chính sách. "Hiệu ứng khác" (khoá, lượt, chuỗi lỗi, dừng chiến dịch…) áp như nhau ở cả hai trường hợp.
- **"Về hàng đợi" / "hẹn chạy lại" chỉ áp khi data đó chưa gửi được gì.** Data đã gửi được một phần thì DB luôn đổi thành "hoàn thành, không gửi lại" (luật `no_requeue_after_delivery` trong `aka_agent_engine_report_v1`, không do chính sách), ví dụ:
  - đã nhắn tin xong rồi bước kết bạn lỗi (221, 802, NET01…): data hoàn thành, tin không gửi lại, lời mời kết bạn của người đó không thử lại; khoá thao tác và chuỗi data lỗi của mã kết bạn vẫn áp;
  - đã gửi ảnh/tệp rồi phần chữ lỗi (hoặc chữ đi rồi tệp lỗi): luôn ghi "thất bại" với câu "Đã gửi file nhưng gửi nội dung thất bại. …" (hoặc ngược lại), tính lượt, không cộng chuỗi data lỗi, không dừng chiến dịch theo ngưỡng; data hoàn thành;
  - đang gửi thì bị ngắt (không rõ đã tới chưa): hoàn thành, không gửi lại (SYS02 / UNK01).
  Trường hợp về hàng đợi thật: lỗi ngay ở bước gửi đầu tiên (chưa gì tới người nhận), hoặc lỗi ở bước đọc trước khi gửi (tra số, đọc hồ sơ).
- Dừng chiến dịch / tài khoản / lượt chỉ có hiệu lực sau data đang xử lý.
- "Chuỗi data lỗi": số data lỗi liên tiếp của chiến dịch. "Nhớ người nhận": không gửi lại người nhận đó trên cùng tài khoản trong N ngày.

## A. Zalo và mã hệ thống (đang dùng cho chiến dịch Zalo)

### 1. Đăng xuất / dừng tài khoản (1 mã)

Tài khoản không dùng được nữa: đánh dấu chưa đăng nhập / checkpoint hoặc tạm dừng tài khoản.

| Mã | Mã Zalo | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|---|
| Z600 | 600 | thao tác khác | Phiên đăng nhập Zalo không hợp lệ | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | đánh dấu tài khoản chưa đăng nhập; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| Z600 | 600 | Kết bạn, Thêm thành viên vào group, Huỷ lời mời kết bạn đã gửi, Đổi tên, Tìm SĐT, Tham gia vào group, Tham gia group, Gửi tin nhắn đến bạn bè, Gửi tin nhắn đến group, Gửi tin nhắn đến người lạ, Gắn tag | Phiên đăng nhập Zalo không hợp lệ | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | đánh dấu tài khoản chưa đăng nhập; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử |

### 2. Tạm dừng chiến dịch ngay (14 mã)

Cấu hình hoặc nội dung sai: dừng chiến dịch một lần; data chưa gửi gì thì về hàng đợi, khách sửa rồi chạy lại.

| Mã | Mã Zalo | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|---|
| CFG01 | — | mọi thao tác | Không dùng được tệp media của chiến dịch | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| CFG02 | — | mọi thao tác | Cấu hình chiến dịch chưa hợp lệ | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| CFG10 | — | mọi thao tác | Tài khoản Zalo Web chỉ gửi được ảnh JPG, JPEG, PNG, WEBP hoặc GIF | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; bỏ các bước còn lại của data; không ghi lịch sử; không nghỉ trước data kế |
| CFG11 | — | mọi thao tác | Số tệp vượt giới hạn Zalo cho một tin | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; bỏ các bước còn lại của data; không ghi lịch sử; không nghỉ trước data kế |
| CFG12 | — | mọi thao tác | Zalo không cho gửi loại tệp này | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; bỏ các bước còn lại của data; không ghi lịch sử; không nghỉ trước data kế |
| CFG14 | — | mọi thao tác | Đăng fanpage bằng API chỉ hỗ trợ ảnh | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; bỏ các bước còn lại của data; không ghi lịch sử; không nghỉ trước data kế |
| CFG15 | — | mọi thao tác | Media Facebook chỉ hỗ trợ ảnh hoặc video | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; bỏ các bước còn lại của data; không ghi lịch sử; không nghỉ trước data kế |
| CFG16 | — | mọi thao tác | Nội dung nâng cao chưa hợp lệ | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; bỏ các bước còn lại của data; không ghi lịch sử; không nghỉ trước data kế |
| Z118 | 118 | thao tác khác | Nội dung quá dài | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tạm dừng chiến dịch; tính lượt; tăng chuỗi data lỗi; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z118 | 118 | Gửi tin nhắn đến bạn bè, Gửi tin nhắn đến group, Gửi tin nhắn đến người lạ | Nội dung quá dài | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; bỏ các bước còn lại của data; không ghi lịch sử |
| Z164 | 164 | mọi thao tác | Tài khoản không phải thành viên của nhóm đích | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; bỏ các bước còn lại của data; không ghi lịch sử; không nghỉ trước data kế |
| Z183 | 183 | mọi thao tác | Nhóm đã đủ số thành viên tối đa | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; bỏ các bước còn lại của data; không ghi lịch sử; không nghỉ trước data kế |
| Z223 | 223 | Kết bạn | Danh sách yêu cầu kết bạn đã đầy | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| Z224 | 224 | Kết bạn | Danh bạ Zalo đã đầy (mã 224) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch; khoá Kết bạn không thời hạn (mở bằng tay); không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| Z264 | 264, 269 | Thêm thành viên vào group | Zalo không cho thêm trực tiếp thành viên (mã 264/269) | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |

### 3. Khoá thao tác có thời hạn (20 mã)

Zalo hạn chế tài khoản: khoá đúng thao tác tới lúc mở; data chưa gửi gì thì chờ tới khi mở khoá. Nhiều mã còn đếm data lỗi liền để tạm dừng chiến dịch.

| Mã | Mã Zalo | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|---|
| NET01 | — | Kết bạn, Thêm thành viên vào group, Huỷ lời mời kết bạn đã gửi, Đổi tên, Tìm SĐT, Tham gia vào group, Tham gia group, Gửi tin nhắn đến bạn bè, Gửi tin nhắn đến group, Gửi tin nhắn đến người lạ, Gắn tag | Kết nối mạng tạm thời gián đoạn | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 4 data lỗi liền; khoá Tìm SĐT, Gửi tin nhắn đến người lạ, Gửi tin nhắn đến bạn bè, Gửi tin nhắn đến group, Kết bạn, Thêm thành viên vào group, Tham gia vào group, Tham gia group, Gắn tag, Đổi tên, Huỷ lời mời kết bạn đã gửi 5 phút; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
| NET03 | — | Kết bạn, Thêm thành viên vào group, Huỷ lời mời kết bạn đã gửi, Đổi tên, Tìm SĐT, Tham gia vào group, Tham gia group, Gửi tin nhắn đến bạn bè, Gửi tin nhắn đến group, Gửi tin nhắn đến người lạ, Gắn tag | Kết nối tới Zalo chưa sẵn sàng, sẽ tự chạy lại | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 4 data lỗi liền; khoá Tìm SĐT, Gửi tin nhắn đến người lạ, Gửi tin nhắn đến bạn bè, Gửi tin nhắn đến group, Kết bạn, Thêm thành viên vào group, Tham gia vào group, Tham gia group, Gắn tag, Đổi tên, Huỷ lời mời kết bạn đã gửi 5 phút; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
| Z120 | 120 | Thêm thành viên vào group | Zalo hạn chế thêm thành viên nhóm (mã 120) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Thêm thành viên vào group tới 09:45 sau 1 ngày; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử |
| Z120 | 120 | Gửi tin nhắn đến bạn bè, Gửi tin nhắn đến người lạ | Zalo hạn chế nhắn người lạ (mã 120) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Gửi tin nhắn đến người lạ tới 09:45 sau 1 ngày; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử |
| Z123 | 123 | Gửi tin nhắn đến bạn bè | Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 123) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | khoá Gửi tin nhắn đến bạn bè 30 phút; tính lượt; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z123 | 123 | Gửi tin nhắn đến group | Zalo hạn chế nhắn nhóm do gửi nhanh hoặc trùng nội dung (mã 123) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | khoá Gửi tin nhắn đến group 30 phút; tính lượt; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z123 | 123 | Gửi tin nhắn đến người lạ | Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 123) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | khoá Gửi tin nhắn đến người lạ 30 phút; tính lượt; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z126 | 126, 127 | Gửi tin nhắn đến group | Zalo hạn chế nhắn nhóm (mã 126/127) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Gửi tin nhắn đến group 30 phút; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z127 | 127 | Gửi tin nhắn đến bạn bè | Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 127) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Gửi tin nhắn đến bạn bè 30 phút; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z127 | 127 | Gửi tin nhắn đến người lạ | Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 127) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Gửi tin nhắn đến người lạ 30 phút; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z221 | 221 | Kết bạn | Đạt giới hạn kết bạn trong giờ | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Kết bạn 60 phút; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z221 | 221, 312 | Tìm SĐT | Đạt giới hạn tìm SĐT trong giờ | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Tìm SĐT 60 phút; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử |
| Z221 | 221 | Gửi tin nhắn đến bạn bè | Đạt giới hạn nhắn bạn bè (mã 221) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Gửi tin nhắn đến bạn bè 60 phút; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z221 | 221 | Gửi tin nhắn đến group | Đạt giới hạn nhắn nhóm (mã 221) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Gửi tin nhắn đến group 60 phút; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z299 | 299 | mọi thao tác | Tài khoản đã tham gia quá nhiều nhóm hôm nay; chạy tiếp lúc (giờ mở khoá) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Tham gia group tới hết ngày; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
| Z301 | 301 | mọi thao tác | Tài khoản đã huỷ quá nhiều lời mời kết bạn hôm nay; chạy tiếp lúc (giờ mở khoá) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Huỷ lời mời kết bạn đã gửi tới hết ngày; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
| Z313 | 304, 313 | thao tác khác | Đạt giới hạn tìm SĐT trong ngày | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | khoá Tìm SĐT tới hết ngày; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| Z313 | 304, 313 | Tìm SĐT | Đạt giới hạn tìm SĐT trong ngày | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Tìm SĐT tới hết ngày; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử |
| Z314 | 314 | thao tác khác | Đạt giới hạn mời người lạ vào group | hoàn thành, không gửi lại | hoàn thành, không gửi lại | khoá Thêm thành viên vào group 60 phút; tính lượt; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z314 | 314 | Thêm thành viên vào group | Đạt giới hạn mời người lạ vào group | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Thêm thành viên vào group 60 phút; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z802 | 802 | Thêm thành viên vào group | Zalo hạn chế thêm thành viên nhóm (mã 802) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Thêm thành viên vào group tới 09:45 sau 2 ngày; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| Z802 | 802 | Gửi tin nhắn đến bạn bè, Gửi tin nhắn đến người lạ | Zalo hạn chế nhắn người lạ (mã 802) | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 3 data lỗi liền; khoá Gửi tin nhắn đến người lạ tới 09:45 sau 2 ngày; không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử |

### 4. Đếm lỗi liền, đủ ngưỡng thì tạm dừng chiến dịch (1 mã)

Không khoá; chỉ dừng chiến dịch khi lỗi lặp lại nhiều data liên tiếp.

| Mã | Mã Zalo | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|---|
| SYS99 | — | mọi thao tác | Lỗi không xác định | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 4 data lỗi liền; không tính lượt; bỏ các bước còn lại của data; lịch sử: "lỗi" |

### 5. Chiến dịch tạm chờ rồi tự chạy lại (7 mã)

Lỗi hạ tầng (mạng, máy chủ, DB): không đốt data, chiến dịch về chờ và tự chạy tiếp.

| Mã | Mã Zalo | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|---|
| DB01 | — | mọi thao tác | Chưa kết nối được máy chủ akaBiz | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| NET01 | — | thao tác khác | Kết nối mạng tạm thời gián đoạn | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| NET02 | — | mọi thao tác | Proxy của tài khoản không kết nối được | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| SYS03 | — | mọi thao tác | Không tải được block cần chạy | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| SYS04 | — | mọi thao tác | Trình duyệt thực thi bị gián đoạn | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| SYS05 | — | mọi thao tác | Thiết bị tạm ngừng kết nối khi ngủ | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| SYS06 | — | mọi thao tác | Dịch vụ AI tạm thời không xử lý được yêu cầu | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |

### 6. Data chưa gửi gì thì về hàng đợi, chạy lại sau (8 mã)

Lỗi trước khi gửi: data quay lại chờ (ngay ở lượt sau hoặc sau N phút).

| Mã | Mã Zalo | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|---|
| AUTH01 | — | mọi thao tác | Tài khoản bị đăng xuất | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; không ghi lịch sử |
| LIM01 | — | mọi thao tác | Đạt giới hạn trong ngày | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; không ghi lịch sử |
| LIM02 | — | mọi thao tác | Đạt giới hạn trong giờ | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; không ghi lịch sử |
| NET03 | — | thao tác khác | Kết nối tới Zalo chưa sẵn sàng, sẽ tự chạy lại | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
| RUN01 | — | mọi thao tác | Đã dừng theo yêu cầu | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
| SYS01 | — | mọi thao tác | Bị ngắt trước khi gửi | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
| SYS08 | — | mọi thao tác | Chưa kiểm tra được điều kiện gửi, sẽ tự chạy lại | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
| UNK01 | -69 | Tìm SĐT | Không xác nhận được tin đã tới; không gửi lại để tránh trùng | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |

### 7. Tạm dừng data (2 mã)

Data dừng hẳn, không tự chạy lại (người nhận từ chối nhận tin, nhóm không còn…).

| Mã | Mã Zalo | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|---|
| OPT01 | — | mọi thao tác | Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo | tạm dừng, không tự chạy lại | tạm dừng, không tự chạy lại | không tính lượt; bỏ các bước còn lại của data; không ghi lịch sử; không nghỉ trước data kế |
| Z161 | 161 | Gửi tin nhắn đến group | Nhóm Zalo không còn tồn tại (mã 161) | tạm dừng, không tự chạy lại | tạm dừng, không tự chạy lại | không tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; lịch sử: "không tồn tại"; không nghỉ trước data kế |

### 8. Không rõ kết quả, không gửi lại (2 mã)

Có thể đã tới người nhận: data hoàn thành, không gửi lại để tránh trùng.

| Mã | Mã Zalo | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|---|
| SYS02 | — | mọi thao tác | Bị ngắt khi đang gửi, không rõ kết quả; không gửi lại để tránh trùng | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt nếu đã gửi đi; bỏ các bước còn lại của data; lịch sử: "thất bại" |
| UNK01 | -69 | thao tác khác | Không xác nhận được tin đã tới; không gửi lại để tránh trùng | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt nếu đã gửi đi; bỏ các bước còn lại của data; lịch sử: "thất bại" |
| UNK01 | -69 | Kết bạn | Không xác nhận được tin đã tới; không gửi lại để tránh trùng | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; tăng chuỗi data lỗi; bỏ các bước còn lại của data; lịch sử: "thất bại" |
| UNK01 | -69 | Thêm thành viên vào group, Gửi tin nhắn đến bạn bè, Gửi tin nhắn đến group, Gửi tin nhắn đến người lạ | Không xác nhận được tin đã tới; không gửi lại để tránh trùng | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt nếu đã gửi đi; tăng chuỗi data lỗi; bỏ các bước còn lại của data; lịch sử: "thất bại" |

### 9. Bỏ qua data, không tính lượt (18 mã)

Data hoàn thành mà không tốn lượt (thiếu dữ liệu, người nhận không nhận được, đã làm trước đó…).

| Mã | Mã Zalo | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|---|
| CFG13 | — | mọi thao tác | Nội dung rỗng vì data thiếu cột dùng trong mẫu | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; bỏ các bước còn lại của data; lịch sử: "thất bại"; không nghỉ trước data kế |
| DAT01 | — | thao tác khác | Dữ liệu đầu vào không hợp lệ | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| DAT01 | — | Kết bạn, Thêm thành viên vào group, Huỷ lời mời kết bạn đã gửi, Đổi tên, Tìm SĐT, Tham gia vào group, Tham gia group, Gửi tin nhắn đến bạn bè, Gửi tin nhắn đến group, Gửi tin nhắn đến người lạ, Gắn tag | Dữ liệu đầu vào không hợp lệ | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại"; không nghỉ trước data kế |
| SYS07 | — | mọi thao tác | Lượt chạy không ghi nhận được kết quả | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; tăng chuỗi data lỗi; bỏ các bước còn lại của data; lịch sử: "lỗi" |
| Z112 | 112 | Gửi tin nhắn đến group | Zalo từ chối gửi nội dung vào nhóm (mã 112) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; tăng chuỗi data lỗi; lịch sử: "thất bại" |
| Z114 | 114 | Kết bạn, Thêm thành viên vào group, Huỷ lời mời kết bạn đã gửi, Đổi tên, Tìm SĐT, Tham gia vào group, Tham gia group, Gửi tin nhắn đến bạn bè, Gửi tin nhắn đến group, Gửi tin nhắn đến người lạ, Gắn tag | Tham số không hợp lệ | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| Z119 | 119 | thao tác khác | Người nhận chặn tin nhắn | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| Z119 | 119 | Thêm thành viên vào group | Người nhận chặn tin nhắn | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z122 | 122 | thao tác khác | Người nhận chặn tin nhắn người lạ | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| Z122 | 122 | Thêm thành viên vào group | Người nhận chặn tin nhắn người lạ | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z126 | 126 | Thêm thành viên vào group | Zalo từ chối lời mời vào nhóm (mã 126) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z172 | 172 | mọi thao tác | Nhóm đang đầy, chưa vào được | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; bỏ các bước còn lại của data; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z178 | 178 | thao tác khác | Đã là thành viên group | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "đã là thành viên" |
| Z178 | 178 | Thêm thành viên vào group, Tham gia vào group, Tham gia group | Đã là thành viên group | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "đã là thành viên"; không nghỉ trước data kế |
| Z210 | 210 | Kết bạn | Người nhận bị Zalo chặn (mã 210) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; lịch sử: "không tồn tại"; không nghỉ trước data kế |
| Z215 | 215, 251 | Kết bạn | Người nhận không nhận lời mời kết bạn (mã 215/251) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z216 | 212, 214, 216 | Kết bạn | Zalo không tồn tại | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; lịch sử: "không tồn tại"; không nghỉ trước data kế |
| Z225 | 225 | thao tác khác | Đã là bạn bè | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "đã là bạn bè" |
| Z225 | 225 | Kết bạn | Đã là bạn bè | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "đã là bạn bè"; không nghỉ trước data kế |
| Z227 | 227 | Tham gia group | Link nhóm Zalo không hợp lệ (mã 227) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z230 | 230 | mọi thao tác | Danh sách nhãn Zalo vừa thay đổi | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z311 | 311 | Kết bạn | Yêu cầu kết bạn không thành công | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| Z999 | mã khác (chưa có luật riêng) | Kết bạn | Thao tác Zalo thất bại | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; tăng chuỗi data lỗi; lịch sử: "thất bại" |

### 10. Ghi kết quả, có tính lượt (11 mã)

Nền tảng đã trả lời: data hoàn thành, tốn lượt như hôm nay (phần lớn ghi thất bại, vài mã ghi thành công).

| Mã | Mã Zalo | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|---|
| Z114 | 114 | thao tác khác | Tham số không hợp lệ | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; tăng chuỗi data lỗi; lịch sử: "thất bại" |
| Z119 | 119 | Gửi tin nhắn đến bạn bè | Người nhận chặn tin nhắn | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z119 | 119 | Gửi tin nhắn đến người lạ | Người nhận chặn tin nhắn | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z122 | 122 | Gửi tin nhắn đến người lạ | Người nhận chặn tin nhắn người lạ | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z126 | 126 | Gửi tin nhắn đến bạn bè | Zalo từ chối tin nhắn cá nhân (mã 126) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z126 | 126 | Gửi tin nhắn đến người lạ | Zalo từ chối tin nhắn cá nhân (mã 126) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; lịch sử: "thất bại"; không nghỉ trước data kế |
| Z210 | 210 | Tìm SĐT | Người nhận bị Zalo chặn (mã 210) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; lịch sử: "không tồn tại"; không nghỉ trước data kế |
| Z216 | 212, 214, 216 | thao tác khác | Zalo không tồn tại | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; lịch sử: "không tồn tại" |
| Z216 | 212, 214, 216 | Tìm SĐT | Zalo không tồn tại | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; lịch sử: "không tồn tại"; không nghỉ trước data kế |
| Z219 | 219 | Tìm SĐT | Số điện thoại không hợp lệ (mã 219) | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; lịch sử: "không tồn tại"; không nghỉ trước data kế |
| Z222 | 222 | Kết bạn | Đã chấp nhận lời mời kết bạn | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; lịch sử: "thành công" |
| Z240 | 240 | mọi thao tác | Đã gửi lời mời vào nhóm, chờ quản trị viên duyệt | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; xoá chuỗi data lỗi; lịch sử: "thành công" |
| Z311 | 311 | thao tác khác | Yêu cầu kết bạn không thành công | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; tăng chuỗi data lỗi; lịch sử: "thất bại" |
| Z999 | mã khác (chưa có luật riêng) | thao tác khác | Thao tác Zalo thất bại | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; tăng chuỗi data lỗi; lịch sử: "thất bại" |

## B. Facebook (đã có trong DB, chưa dùng: bộ chạy mới chưa chạy Facebook)

### 1. Đăng xuất / dừng tài khoản (2 mã)

Tài khoản không dùng được nữa: đánh dấu chưa đăng nhập / checkpoint hoặc tạm dừng tài khoản.

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| FB04 | mọi thao tác | Facebook yêu cầu xác minh tài khoản | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | đánh dấu tài khoản checkpoint; tạm dừng tài khoản; chiến dịch về chờ, chạy lại ở lần quét sau; khoá Kết bạn, Comment, Mời vào group, Tham gia group, Like post, Nhắn tin bạn bè, Nhắn tin khách inbox page, Nhắn tin người lạ, Đăng bài group, Đăng bài trang cá nhân, Đăng bài fanpage không thời hạn (mở bằng tay); không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB07 | mọi thao tác | Không khôi phục được danh tính Facebook ban đầu | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng tài khoản; chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |

### 2. Tạm dừng chiến dịch ngay (3 mã)

Cấu hình hoặc nội dung sai: dừng chiến dịch một lần; data chưa gửi gì thì về hàng đợi, khách sửa rồi chạy lại.

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| FB02 | mọi thao tác | Giới hạn tần suất đăng bài group | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB03 | mọi thao tác | Giới hạn tần suất comment | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB31 | mọi thao tác | Facebook từ chối nội dung hoặc liên kết bài đăng | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tạm dừng chiến dịch; tính lượt; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |

### 3. Khoá thao tác có thời hạn (2 mã)

Zalo hạn chế tài khoản: khoá đúng thao tác tới lúc mở; data chưa gửi gì thì chờ tới khi mở khoá. Nhiều mã còn đếm data lỗi liền để tạm dừng chiến dịch.

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| FB01 | mọi thao tác | Nhắn tin | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | khoá Nhắn tin người lạ 1440 phút; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB27 | mọi thao tác | Facebook giới hạn tham gia nhóm | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; khoá Tham gia group 1440 phút; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |

### 5. Chiến dịch tạm chờ rồi tự chạy lại (12 mã)

Lỗi hạ tầng (mạng, máy chủ, DB): không đốt data, chiến dịch về chờ và tự chạy tiếp.

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| FB05 | mọi thao tác | Facebook tạm chặn một tính năng | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB06 | mọi thao tác | Không chuyển được sang danh tính Facebook cần dùng | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB08 | mọi thao tác | Thiếu phiên truy cập Facebook Business | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB09 | mọi thao tác | Thiếu quyền hoặc token đăng bài lên Page | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB10 | mọi thao tác | Facebook Graph API tạm thời không xử lý được yêu cầu | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB20 | mọi thao tác | Messenger yêu cầu thiết lập PIN hoặc khôi phục tin nhắn | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB21 | mọi thao tác | Facebook hạn chế nhắn tin của tài khoản | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB29 | mọi thao tác | Giao diện tham gia nhóm Facebook chưa xử lý được | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB34 | mọi thao tác | Tải ảnh hoặc video lên Facebook chưa hoàn tất | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB37 | mọi thao tác | Giao diện hộp thư Page chưa sẵn sàng | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB38 | mọi thao tác | Không tìm thấy form tải media Facebook phù hợp | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| FB39 | mọi thao tác | Giao diện mời bạn vào nhóm Facebook chưa xử lý được | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | chiến dịch về chờ, chạy lại ở lần quét sau; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |

### 6. Data chưa gửi gì thì về hàng đợi, chạy lại sau (4 mã)

Lỗi trước khi gửi: data quay lại chờ (ngay ở lượt sau hoặc sau N phút).

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| FB33 | mọi thao tác | Facebook không nhận nội dung định dạng | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; không ghi lịch sử |
| FB35 | mọi thao tác | Không mở được ô nhập bài đăng Facebook | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; không ghi lịch sử |
| FB36 | mọi thao tác | Không tìm thấy nút đăng hoặc chia sẻ trên Facebook | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; không ghi lịch sử |
| FB41 | mọi thao tác | Không tìm thấy ô bình luận | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | không tính lượt; không ghi lịch sử |

### 8. Không rõ kết quả, không gửi lại (1 mã)

Có thể đã tới người nhận: data hoàn thành, không gửi lại để tránh trùng.

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| FB30 | mọi thao tác | Chưa xác nhận được kết quả đăng bài Facebook | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; lịch sử: "thất bại" |

### 9. Bỏ qua data, không tính lượt (16 mã)

Data hoàn thành mà không tốn lượt (thiếu dữ liệu, người nhận không nhận được, đã làm trước đó…).

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| FB11 | mọi thao tác | Chưa là thành viên nhóm Facebook | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB12 | mọi thao tác | Đang chờ duyệt tham gia nhóm Facebook | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB13 | mọi thao tác | Nhóm Facebook chỉ cho quản trị viên đăng bài | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB14 | mọi thao tác | Nhóm Facebook không khả dụng | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "không tồn tại" |
| FB15 | mọi thao tác | Bài Facebook đang chờ duyệt nên chưa bình luận được | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB16 | mọi thao tác | Bài Facebook đã tắt bình luận | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB17 | mọi thao tác | Không tìm thấy bài Facebook để bình luận | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "không tồn tại" |
| FB18 | mọi thao tác | Chưa đủ quyền thành viên để bình luận trong nhóm | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB19 | mọi thao tác | Người nhận không thể nhận tin nhắn Facebook | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB22 | mọi thao tác | Không thể gửi lời mời kết bạn Facebook | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB23 | mọi thao tác | Không tìm thấy khách trong hộp thư Page | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "không tồn tại" |
| FB24 | mọi thao tác | Chưa xác minh được đúng hội thoại khách trên Page | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB25 | mọi thao tác | Hội thoại Page đã ngoài thời hạn trả lời | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB26 | mọi thao tác | Khách không cho Page gửi tin nhắn | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB28 | mọi thao tác | Nhóm Facebook yêu cầu trả lời câu hỏi tham gia | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "thất bại" |
| FB40 | mọi thao tác | Không tìm thấy ô đăng bài trong nhóm Facebook | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "bỏ qua" |

### 10. Ghi kết quả, có tính lượt (1 mã)

Nền tảng đã trả lời: data hoàn thành, tốn lượt như hôm nay (phần lớn ghi thất bại, vài mã ghi thành công).

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| FB32 | mọi thao tác | Facebook báo nội dung đăng bị trùng | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tính lượt; lịch sử: "thất bại" |

## C. Email (đã có trong DB, chưa dùng: bộ chạy mới chưa chạy Email)

### 1. Đăng xuất / dừng tài khoản (3 mã)

Tài khoản không dùng được nữa: đánh dấu chưa đăng nhập / checkpoint hoặc tạm dừng tài khoản.

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| EM03 | mọi thao tác | Google yêu cầu đăng nhập lại Gmail | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | đánh dấu tài khoản chưa đăng nhập; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| EM04 | mọi thao tác | Sai mật khẩu ứng dụng Gmail | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | đánh dấu tài khoản chưa đăng nhập; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| EM08 | mọi thao tác | Tài khoản email chưa cấu hình SMTP | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | đánh dấu tài khoản chưa đăng nhập; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |

### 2. Tạm dừng chiến dịch ngay (2 mã)

Cấu hình hoặc nội dung sai: dừng chiến dịch một lần; data chưa gửi gì thì về hàng đợi, khách sửa rồi chạy lại.

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| EM10 | mọi thao tác | Email vượt dung lượng cho phép | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| EM11 | mọi thao tác | Nội dung/tệp đính kèm bị chặn | về hàng đợi, chạy lại ở lượt sau | hoàn thành, không gửi lại | tạm dừng chiến dịch; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |

### 3. Khoá thao tác có thời hạn (5 mã)

Zalo hạn chế tài khoản: khoá đúng thao tác tới lúc mở; data chưa gửi gì thì chờ tới khi mở khoá. Nhiều mã còn đếm data lỗi liền để tạm dừng chiến dịch.

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| EM02 | mọi thao tác | Gmail hết lượt gửi trong 24 giờ | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | khoá Email - Gửi email 1440 phút; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| EM05 | mọi thao tác | Đăng nhập SMTP quá nhiều lần | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | khoá Email - Gửi email 30 phút; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| EM06 | mọi thao tác | Máy chủ email tạm từ chối | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | khoá Email - Gửi email 30 phút; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| EM07 | mọi thao tác | Mất kết nối tới máy chủ email | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | khoá Email - Gửi email 10 phút; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |
| EM13 | mọi thao tác | Lỗi kết nối server akaBiz khi gửi email | về hàng đợi, chạy lại khi mở khoá | hoàn thành, không gửi lại | khoá Email - Gửi email 10 phút; không tính lượt; kết thúc lượt chạy sau data này; không ghi lịch sử |

### 4. Đếm lỗi liền, đủ ngưỡng thì tạm dừng chiến dịch (2 mã)

Không khoá; chỉ dừng chiến dịch khi lỗi lặp lại nhiều data liên tiếp.

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| EM09 | mọi thao tác | Thiếu email người nhận | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 5 data lỗi liền; không tính lượt; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |
| EM12 | mọi thao tác | Lỗi gửi email chưa xác định | hoàn thành, không gửi lại | hoàn thành, không gửi lại | tạm dừng chiến dịch khi 5 data lỗi liền; tính lượt; kết thúc lượt chạy sau data này; lịch sử: "thất bại" |

### 9. Bỏ qua data, không tính lượt (1 mã)

Data hoàn thành mà không tốn lượt (thiếu dữ liệu, người nhận không nhận được, đã làm trước đó…).

| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |
|---|---|---|---|---|---|
| EM01 | mọi thao tác | Email không tồn tại | hoàn thành, không gửi lại | hoàn thành, không gửi lại | không tính lượt; lịch sử: "không tồn tại" |

## Sắp thêm (migration ở local, chưa apply production)

| Mã | Nhóm | Ý nghĩa | Xử lý | Migration |
|---|---|---|---|---|
| CFG17 | 2. Tạm dừng chiến dịch ngay | Gửi dạng chia sẻ chưa có nội dung hoặc media | tạm dừng chiến dịch; data về hàng đợi; không tính lượt; không ghi lịch sử | V503 |
| SYS09 | 10. Ghi kết quả, có tính lượt | Lô chia sẻ dừng theo chính sách sau khi đã gửi media; chưa chia sẻ phần chữ | data hoàn thành, không gửi lại; tính lượt; lịch sử "thất bại" | V503 |
| EXC01 | 7. Tạm dừng data | Người nhận thuộc điều kiện loại trừ gửi | data tạm dừng kèm câu; không tính lượt; không ghi lịch sử; không nghỉ trước data kế | V504 |
| EXC02 | 7. Tạm dừng data | Chưa đủ dữ liệu để kiểm điều kiện loại trừ | data tạm dừng kèm câu; không tính lượt; không ghi lịch sử; không nghỉ trước data kế | V504 |
| EXC03 | 9. Bỏ qua data, không tính lượt | Nằm trong danh sách không gửi tin (kiểu cũ) | data hoàn thành, không gửi; không tính lượt; không ghi lịch sử | V504 |
| CFG18 | 2. Tạm dừng chiến dịch ngay | Cấu hình loại trừ gửi không hợp lệ | tạm dừng chiến dịch; data về hàng đợi; không tính lượt; không ghi lịch sử | V504 |
| CFG19 | 2. Tạm dừng chiến dịch ngay | Danh sách không gửi tin Zalo không hợp lệ | tạm dừng chiến dịch; data về hàng đợi; không tính lượt; không ghi lịch sử | V504 |

## D. Lớp nền

Áp khi mã lỗi không nói gì về một trường (mã đặt trường nào thì trường đó thắng).

**Theo trạng thái kết quả** (cả kết quả thành công):

| Trạng thái | Thao tác | Xử lý |
|---|---|---|
| thành công | mọi thao tác | tính lượt; xoá chuỗi data lỗi; data hoàn thành |
| thất bại | mọi thao tác | tính lượt; tăng chuỗi data lỗi; data hoàn thành |
| lỗi | mọi thao tác | không tính lượt; tăng chuỗi data lỗi; data hoàn thành |
| bỏ qua | mọi thao tác | không tính lượt; data hoàn thành |
| đã là bạn bè | mọi thao tác | không tính lượt; data hoàn thành |
| đã gửi lời mời | mọi thao tác | không tính lượt; data hoàn thành |
| đã là thành viên | mọi thao tác | không tính lượt; data hoàn thành |
| đã tham gia | mọi thao tác | không tính lượt; data hoàn thành |
| không tồn tại | mọi thao tác | không tính lượt; data hoàn thành |
| lỗi | Tham gia group | tính lượt; tăng chuỗi data lỗi; data hoàn thành |
| thành công | Gắn tag | không tính lượt; data hoàn thành |
| thất bại | Gắn tag | không tính lượt; data hoàn thành |
| lỗi | Gắn tag | không tính lượt; data hoàn thành |
| thành công | Đổi tên | không tính lượt; data hoàn thành |
| thất bại | Đổi tên | không tính lượt; data hoàn thành |
| lỗi | Đổi tên | không tính lượt; data hoàn thành |
| tag không tồn tại | mọi thao tác | không tính lượt; data hoàn thành |
| tham số không hợp lệ | mọi thao tác | không tính lượt; data hoàn thành |
| không tồn tại | Mời vào group | không tính lượt; xoá chuỗi data lỗi; data hoàn thành |
| thành công | Tìm SĐT | không nghỉ trước data kế |

**Theo thao tác** (luôn thắng mã lỗi):

- Đổi tên: không tính lượt, không đổi chuỗi data lỗi.
- Gắn tag: không tính lượt, không đổi chuỗi data lỗi.

**Theo nhóm lỗi** (mã mới chỉ cần khai nhóm là có cách xử lý mặc định):

| Nhóm lỗi | Data chưa gửi gì | Hiệu ứng khác |
|---|---|---|
| target_permanent | hoàn thành, không gửi lại | không tính lượt; nhớ người nhận 30 ngày trên tài khoản, không gửi lại; bỏ các bước còn lại của data; lịch sử: "?"; không nghỉ trước data kế |
| target_temporary | hẹn chạy lại sau 60 phút | không tính lượt; bỏ các bước còn lại của data; lịch sử: "?"; nghỉ ngắn |
| unknown_delivery | hoàn thành, không gửi lại | tính lượt nếu đã gửi đi; bỏ các bước còn lại của data; lịch sử: "?" |
| already_done | hoàn thành, không gửi lại | không tính lượt; xoá chuỗi data lỗi; lịch sử: "?"; không nghỉ trước data kế |
| account_restricted | hẹn chạy lại sau 30 phút | không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; lịch sử: "?"; không nghỉ trước data kế |
| quota | hẹn chạy lại sau 60 phút | không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
| auth | về hàng đợi, chạy lại ở lượt sau | đánh dấu tài khoản chưa đăng nhập; không tính lượt; bỏ các bước còn lại của data; dừng tài khoản; không ghi lịch sử; không nghỉ trước data kế |
| content_config | về hàng đợi, chạy lại ở lượt sau | tạm dừng chiến dịch; không tính lượt; bỏ các bước còn lại của data; không ghi lịch sử; không nghỉ trước data kế |
| ui_changed | hẹn chạy lại sau 60 phút | không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; lịch sử: "?"; không nghỉ trước data kế |
| transient | về hàng đợi, chạy lại ở lượt sau | không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
| internal | hoàn thành, không gửi lại | không tính lượt; tăng chuỗi data lỗi; bỏ các bước còn lại của data; lịch sử: "?" |
| cancelled | về hàng đợi, chạy lại ở lượt sau | không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
| run_control | về hàng đợi, chạy lại ở lượt sau | không tính lượt; bỏ các bước còn lại của data; kết thúc lượt chạy sau data này; không ghi lịch sử; không nghỉ trước data kế |
