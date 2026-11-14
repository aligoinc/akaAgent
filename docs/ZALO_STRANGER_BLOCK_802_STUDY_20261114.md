# Zalo chặn nhắn người lạ (mã 802) trên tài khoản Zalo Server: nghiên cứu 120 ngày

Đo ngày 14/11/2026 trên production (chỉ đọc), cửa sổ 17/07 → 14/11/2026. Zalo Server có từ 30/07 nên
cửa sổ này phủ toàn bộ lịch sử của tính năng. Tài liệu này thay phần "Mã 802" trong
[điều tra 01/11](CUSTOMER_REPORTS_ZALO_ALBUM_FB_GROUP_20261101.md) ở những chỗ hai bên khác nhau.

Thuật ngữ dùng trong bài:

- **Bị chặn**: Zalo trả mã 802 "Bạn đang bị chặn nhắn tin với người lạ" khi tài khoản gửi tin cho người lạ.
- **Ngày hoạt động**: ngày tài khoản có gửi tin cho người lạ. Mọi tốc độ bị chặn tính trên 1.000 ngày hoạt động
  trước lần bị chặn đầu tiên.
- **Người vận hành**: một tài khoản đăng nhập phần mềm (nhân viên) quản lý các tài khoản Zalo.
- **Tài khoản**: một danh tính Zalo. Cùng một Zalo thêm lại nhiều lần vẫn tính là một.

## 1. Câu trả lời ngắn

1. Yếu tố tách người bị và người không bị mạnh nhất là **hình thức tin gửi cho người lạ**: chỉ gửi chữ bị chặn
   nhiều gấp 11,9 lần gửi album từ 2 ảnh trở lên (đã tính các yếu tố khác). Tiếp theo là **tài khoản đó đáng tin
   tới đâu với Zalo**: tài khoản thường, hồ sơ sơ sài, tin nhắn ghi số điện thoại của người khác.
2. Tài khoản cùng tổ chức bị chặn cùng nhau vì một tổ chức gần như luôn là một người vận hành, và người đó dùng
   cùng một kiểu tài khoản, cùng một kiểu nội dung cho mọi tài khoản. Các yếu tố đo được giải thích 44% phần dồn
   theo tổ chức. Phần còn lại là một hiệu ứng kéo theo trong khoảng 2 tuần sau khi một tài khoản bị chặn, dữ
   liệu của mình chưa chỉ ra được nguyên nhân.
3. Địa chỉ IP và user agent chung không tạo ra khác biệt giữa các tổ chức. Chúng nhiều khả năng nâng rủi ro của
   mọi tài khoản Server: cùng loại tài khoản và cùng kiểu nội dung, Server bị chặn nhiều gấp khoảng 6,5 lần
   tài khoản QR chạy trên máy khách.
4. Một lần chặn kéo dài khoảng 7 ngày. Chặn liên tục quá 8,5 ngày chỉ xác nhận được ở 4 tài khoản. "Bị quá 7
   ngày" trên thực tế phần lớn là bị chặn lại ngay sau khi được mở.
5. Khoá cả tài khoản không đo được: Zalo không trả mã lỗi riêng và hệ thống không ghi lý do mất phiên.

## 2. Quy mô và thời lượng

| Chỉ số | Giá trị |
| --- | --- |
| Tài khoản Server có gửi người lạ | 1.977, thuộc 684 tổ chức, 723 người vận hành |
| Tin người lạ gửi thành công | 1.556.307 trên 32.295 ngày hoạt động |
| Tài khoản bị chặn ít nhất một lần | 172 (8,7%), 252 đợt |
| Tốc độ bị chặn lần đầu | 5,07 trên 1.000 ngày hoạt động (tháng 8: 3,6; 9: 4,9; 10: 5,5; 11: 5,9) |

Mã 802 xuất hiện lần đầu ngày 20/08 (tài khoản QR) và 28/08 (Server), sớm hơn mốc 02/10 ghi ở điều tra cũ.

Thời lượng một đợt (đợt bắt đầu ở lần 802 đầu, kết thúc ở tin người lạ thành công kế tiếp; phần mềm tự thử lại
mỗi 48 giờ):

- 145 đợt đã gửi lại được: 89 đợt (61%) gửi lại được trong ngày 6,5–9,5. Trong 58 đợt còn bị chặn ở lần thử
  ngày thứ 5,5 trở đi, trung vị gửi lại được là ngày 8,1 và 86% trước ngày 9,5. Không đợt nào đã mở lại mà còn
  802 sau ngày 7,5.
- 26 đợt ngắn dưới 5,5 ngày, trong đó 12 đợt gửi lại được ngay trong ngày.
- 4 đợt bị chặn liên tục 12,7 / 18,8 / 19,9 / 33,0 ngày. Hai đợt vẫn bị chặn ở lần thử 12/11.

Phân nhóm 172 tài khoản:

| Nhóm | Số tài khoản |
| --- | --- |
| Chỉ có đợt ngắn dưới 5,5 ngày | 12 |
| Một đợt khoảng 7 ngày | 51 |
| Bị lặp 2–5 đợt | 42 |
| Bị liên tục quá 8,5 ngày | 4 |
| Chưa rõ vì không có lần thử lại | 63 (40 mới bị dưới 7 ngày, 23 bị bỏ không dùng nữa) |

Sau khi được mở lại, 54 trên 97 đợt (56%) bị chặn lại trong 10 ngày. Tốc độ bị chặn lại là 108 trên 1.000 ngày
hoạt động, khoảng 20 lần mức lần đầu. Gửi chỉ chữ sau khi mở lại thì 45/71 bị chặn lại, gửi kèm ảnh 8/24.

Trong 112 tài khoản bị chặn từ 14 ngày trước trở về, 31 tài khoản không gửi người lạ lần nào nữa (55% đã bị xoá
khỏi phần mềm). Không phân biệt được bị Zalo khoá hay khách bỏ: tỉ lệ mất phiên đăng nhập trong 7 ngày sau khi bị
chặn là 20,8% (22/106), mức nền của tài khoản không bị chặn là 16,4% (233/1.425).

Thời điểm phát hiện lần đầu (172 tài khoản): 101 lần ở tin đầu tiên sau 12–30 giờ nghỉ, 40 lần giữa phiên (dưới
1 giờ sau một tin thành công), 23 lần sau quãng nghỉ khác, 8 lần khi tài khoản chưa từng gửi được tin nào.

## 3. Yếu tố tác động

Tập phân tích: 1.962 tài khoản có ít nhất một ngày hoạt động trước khi bị chặn, 157 bị chặn, 30.945 ngày hoạt
động. Cột "Hệ số" là tỉ số tốc độ từ mô hình Poisson có bù số ngày hoạt động, hiệu chỉnh lẫn nhau và theo tháng
bắt đầu, sai số gộp theo người vận hành (1.719 tài khoản biết loại, 144 bị chặn), kèm khoảng tin cậy 95%.

| Yếu tố | Nhóm (số tài khoản) | Bị chặn / 1.000 ngày | Hệ số |
| --- | --- | --- | --- |
| Hình thức tin | Chỉ chữ (453) | 16,9 | 11,9 (6,3–22,3) |
| | Một ảnh kèm chữ (605) | 4,5 | 3,3 (1,7–6,5) |
| | 2–3 ảnh (305) | 1,7 | mốc so sánh (từ 2 ảnh) |
| | Từ 4 ảnh (356) | 0,9 | |
| Số điện thoại ghi trong tin | Số khác số của tài khoản (523) | 9,9 | 4,4 (2,1–9,3) |
| | Không ghi số (941) | 4,9 | 2,4 (1,2–4,9) |
| | Số của chính tài khoản (490) | 1,1 | mốc |
| Loại tài khoản | Thường (1.299) | 6,7 | 2,2 (0,95–5,3) |
| | Business Basic (275) / Pro (145) | 0,9 / 1,7 | mốc |
| Ảnh bìa hồ sơ | Không có (407) / có (1.312) | 13,8 / 3,4 | 2,2 (1,4–3,3) |
| Có dùng Zalo trên máy tính | Không (940) / có (779) | 8,1 / 2,3 | 1,9 (1,2–3,1) |
| Danh sách nhiều số không có Zalo | Trên 1,5 lượt tra cho một tin (361) | 10,8 | 1,9 (1,2–2,9) |

Ước tính phần lần bị chặn sẽ không xảy ra nếu đổi yếu tố (các phần chồng lên nhau, không cộng được): mọi tin gửi
album trước 75% (riêng nhóm chỉ chữ 53%); tin ghi số của chính tài khoản 64%; mọi tài khoản là Business 52%; hồ sơ
đầy đủ 52%; danh sách sạch 15%.

Gộp bốn dấu hiệu (chỉ chữ, ghi số khác, tài khoản thường, không ảnh bìa):

| Số dấu hiệu | Tài khoản | Bị chặn | Trên 1.000 ngày |
| --- | --- | --- | --- |
| 0 | 262 | 1,1% | 0,6 |
| 1 | 632 | 3,3% | 1,9 |
| 2 | 547 | 9,1% | 5,9 |
| 3 | 226 | 19,0% | 17,4 |
| 4 | 52 | 51,9% | 72,4 |

Các kiểm tra chéo cho yếu tố hình thức tin:

- Trong cùng một tài khoản có cả ngày gửi chữ lẫn ngày gửi ảnh (118 tài khoản): sau ngày chỉ chữ 5,9 trên 1.000
  (6/1.011), sau ngày kèm ảnh 0,5 (1/1.890); tỉ số 11,2 (1,3–96,7). Số ca ít.
- Theo ngành: bất động sản 1,4 (kèm ảnh) so với 15,7 (chỉ chữ); tài chính 4,1 so với 12,8; ngành khác 3,4 so với 20,3.
- Hai nửa kỳ (trước và sau 20/10): tài khoản thường gửi chữ 23,2 và 19,4; tài khoản thường gửi ảnh 3,9 và 3,8.
- Tài khoản QR: thường gửi chữ 3,2 (10/291), thường gửi ảnh 0,5 (5/478).
- Trong nhóm chỉ chữ, chữ dài rủi ro hơn: dưới 150 ký tự 5,9; trên 500 ký tự 23–36.

Phần mềm gửi album từ 2 ảnh trước rồi mới gửi chữ thành tin riêng; một ảnh thì chữ là chú thích của ảnh. Thứ tự
rủi ro (chỉ chữ, ảnh kèm chú thích, album trước) trùng với việc tin đầu tiên người lạ nhận có mang chữ quảng cáo
hay không. Đây là quan sát, chưa phải thí nghiệm.

Dấu hiệu tài khoản mới hoặc phụ: trong 189 tài khoản biết năm tạo Zalo, tài khoản tạo năm 2026 có 54% không ảnh
bìa và 75% không dùng Zalo trên máy tính, tài khoản tạo từ 2019 trở về là 14% và 31%. Tốc độ bị chặn: 2026 là 5,0
(6/61), từ 2019 trở về 0,7 (1/74).

Rủi ro dồn vào tuần đầu: ngày hoạt động thứ 3–7 khoảng 11–14 trên 1.000, từ ngày thứ 11 trở đi 2–3.

Nhóm nặng (bị lặp hoặc liên tục, 43 tài khoản biết loại): tài khoản thường gửi chữ 34/366, tài khoản thường gửi
ảnh 9/933, Business 0/420. Tài khoản thường ghi số của chính mình: 0/275.

So với runtime khác: Server 5,07; QR 0,90; Zalo Web 1,59. Cùng ô: thường gửi chữ 20,5 (Server) so với 3,2 (QR);
thường gửi ảnh 3,3 so với 0,5. Trong Server, chạy trên Fly và trên VPS không khác nhau sau hiệu chỉnh (1,18; 0,76–1,82).

Đã đo và không thấy tác động: số tin mỗi ngày (mỗi lần gấp đôi 1,23; 0,92–1,64), khoảng nghỉ giữa hai tin, bật
kết bạn kèm (0,98), hay chạm giới hạn ngày mã 120 (0,73; 0,40–1,34), tỉ lệ người nhận chặn tin người lạ mã 122,
link trong nội dung (5,6 so với 5,1), AI viết lại nội dung, tỉ lệ đã xem và phản hồi (475 tài khoản đo 03–06/10).

## 4. Vì sao dồn theo tổ chức

- 172 tài khoản bị chặn nằm trong 100 tổ chức. 34 tổ chức có từ 2 tài khoản bị chặn (nếu độc lập chỉ khoảng 19)
  và chứa 106 tài khoản bị chặn.
- 681/683 tổ chức chỉ có một người vận hành cho mọi tài khoản. Tổ chức duy nhất có nhiều người vận hành và nhiều
  tài khoản (34 người, 76 tài khoản) có 4 tài khoản bị chặn ở 4 người khác nhau; cặp tài khoản khác người vận hành
  cùng bị chặn là 6, thấp hơn mức 21 nếu ngẫu nhiên.
- Cặp tài khoản cùng người vận hành cùng bị chặn: 132, mức ngẫu nhiên 22 (5,9 lần).
- Người vận hành dùng một kiểu cho mọi tài khoản: 84,8% dùng cùng một hình thức tin. Người vận hành toàn tài
  khoản thường gửi chữ (38 người): 39,5% có tài khoản bị chặn. Toàn tài khoản thường gửi ảnh (122): 13,9%. Toàn
  Business gửi ảnh (12): 0.
- Tính đủ các yếu tố ở mục 3 cho từng tài khoản thì số cặp cùng bị chặn kỳ vọng là 71: giải thích 44% phần dôi,
  còn lại 1,9 lần.

Phần còn lại là hiệu ứng kéo theo sau khi một tài khoản bị chặn:

- Tài khoản khác đang gửi của cùng người vận hành: 10,3% bị chặn trong 3 ngày, 14,3% trong 14 ngày, 82,5% không
  bị. Tốc độ 34,6 trên 1.000 ở ngày kế tiếp và 15,6 ở ngày 4–14, mức nền 4,3. Sau hiệu chỉnh còn 2,8 (1,6–4,9)
  trong 3 ngày và 2,7 (1,7–4,4) trong ngày 4–14. Tài khoản Business Basic của cùng người vận hành: 0/29.
- Tài khoản mới thêm sau khi người vận hành đã có tài khoản bị chặn (69): 31,9% bị chặn, các tài khoản khác 7,9%.
  Dùng lại nội dung của tài khoản đã bị: 2/7; nội dung khác: 11/50.
- Tài khoản nghỉ từ 3 ngày rồi quay lại: 3/30 bị chặn ngay nếu trong lúc nghỉ có tài khoản cùng người vận hành bị
  chặn, 5/1.621 nếu không.

Đã loại trừ làm nguyên nhân kéo theo:

- Địa chỉ IP và user agent: chung cho mọi tổ chức. Mọi phiên Server dùng đúng một user agent.
- Mã thiết bị phía máy chủ: mỗi tài khoản một mã riêng (2.358/2.358).
- Trùng người nhận: mẫu 33 người vận hành, 26.731 người nhận trong 4 ngày trước lần chặn đầu, không người nào
  nhận tin từ hai tài khoản; 107/108 cặp không trùng người nào.
- Trùng nội dung: tài khoản có chung nội dung với tài khoản vừa bị chặn 14,9% bị trong 3 ngày, không chung 7,9%.
  Có góp phần nhưng không phải điều kiện.
- Lô SIM: chỉ 19 cặp có số điện thoại chung 7 chữ số đầu, 1 cặp cùng bị chặn.

Người vận hành ghi một số điện thoại cho mọi tài khoản có 13,4% tài khoản bị chặn (122 người, 367 tài khoản);
mỗi tài khoản ghi số riêng 4,8% (73 người, 208 tài khoản). Sau khi tính rủi ro riêng của từng tài khoản, cặp ghi
cùng số không dồn hơn các cặp khác (1,6 so với 1,5–2,2 lần).

Chưa xác minh: Zalo có nối các tài khoản của cùng một chủ bằng tín hiệu ngoài hệ thống của mình hay không (điện
thoại dùng để đăng nhập và quét mã, định danh, quan hệ giữa các tài khoản). Dữ liệu ủng hộ có: kéo theo cả khi
khác nội dung và khác người nhận, tài khoản đang nghỉ vẫn bị. Dữ liệu ngược lại: 82,5% tài khoản đang gửi không
bị kéo theo, Business không bị.

## 5. Cách đo và giới hạn

Nguồn:

- Lần bị chặn: `auto_zalo_api_error_logs` (mã 802), `chat_zalo_action.error_code`, `auto_account_logs`
  (`event_type = 'zalo_error'`, từ 18/09). Ba nguồn gộp lại, bỏ trùng trong 120 giây.
- Tin gửi: `auto_campaign_details` gom theo tài khoản, hành động, ngày, kèm số tệp đính kèm thực tế
  (`data.attachments`). Riêng 04/11 10:32 → 12/11 17:08 lấy số thành công theo ngày từ
  `private.auto_report_daily`, lỗi theo mã từ `auto_zalo_api_error_logs`, và truy vấn chính xác cho 292 tài khoản
  từng bị chặn.
- Hồ sơ: `zalo_accounts.metadata` (`bizPkg`, `cover`, `isActivePC`), `chat_zalo_account` cho tài khoản chạy Fly.
- Nội dung và cấu hình: `auto_campaigns` (`content`, `images`, `extra_settings.imageOption`).

Giới hạn:

- Số liệu quan sát. Gói Business, ảnh bìa là trạng thái ở lần đăng nhập gần nhất, có thể đổi sau khi bị chặn.
- Tài khoản chạy Fly không ghi `data.attachments`; hình thức tin của nhóm này lấy theo cấu hình chiến dịch.
- Không đo được số lần người nhận báo xấu, và không thấy điện thoại của khách.
- Năm tạo Zalo chỉ có ở 189 tài khoản. Khoá cả tài khoản không có tín hiệu trực tiếp.

Bẫy khi đo lại:

- `auto_campaign_details` từ id khoảng 9 triệu (27/10) nằm rải rác trên đĩa: quét theo khoảng id tốn hơn một
  trang cho mỗi dòng, 50 nghìn id mất khoảng 35 giây khi nguội. Hai lượt quét song song cùng lúc giành tiến trình
  song song của nhau và cùng quá giờ.
- Đọc qua index một phần của bảng này vẫn phải chạm bảng chính với dòng mới, vì trang chưa được đánh dấu.
- 802 không có dòng trong `auto_campaign_details`. Ngày bị chặn ở tin đầu tiên không hiện trong bảng theo ngày,
  phải thêm vào từ log lỗi.
