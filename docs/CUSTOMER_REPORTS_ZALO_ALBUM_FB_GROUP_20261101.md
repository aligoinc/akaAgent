# Điều tra khiếu nại 01/11/2026: Zalo "chỉ có ảnh", đăng nhóm Facebook "chập chờn"

Phần điều tra ban đầu chỉ đọc production **akachat — `cgjbsmqtfhqvttudyjzq`** và code.
Ngày 01–02/11/2026 đã cập nhật XPath của năm element 13/1489/1692/1691/1132
theo yêu cầu người dùng; ba element mở bình luận có lần bổ sung nhãn tiếng Việt
ngày 02/11. Chi tiết trước/sau và receipt ở mục B. Số liệu điều tra là truy vấn
chỉ đọc, ghi rõ thời điểm chốt theo giờ VN tại từng lần kiểm tra. SQL trong audit
ghi lại các thay đổi đã áp dụng; không chạy lại khi merge tài liệu này.
Hai khiếu nại là **ba lỗi khác nhau**:

| # | Khách | Lỗi | Phạm vi | Mới/cũ |
| --- | --- | --- | --- | --- |
| A | staff 1954 / org 1731 (Zalo Server, chat-sync) | Album ≥2 ảnh tới người lạ, tin chữ gửi sau bị Zalo trả `127` | 2.009 ca / 14 ngày, 6 org chat-sync | Cũ |
| B | staff 724 / org 701 (Desktop 9.1.0) và toàn fleet | Comment sau đăng nhóm / seeding comment thất bại 100% | 27 staff ngày 30/10 | **Mới, từ 30/10 ~07:45** |
| C | staff 724 / org 701 | `Không tìm thấy ô đăng bài` | ~1/3 lượt, cố định theo cặp tài khoản–nhóm | Cũ; 9.1.0 mới ghi ra |

## A. Album Zalo gửi người lạ: ảnh tới, chữ mất

**Cơ chế đã xác minh.** Cả hai runtime dùng cùng thứ tự gửi: từ 2 tệp trở lên thì gửi
album (không caption) trước, chữ là lệnh `send_text` riêng sau ~0,1 s; 1 tệp thì chữ
đi kèm làm caption (`combined`), riêng nội dung định dạng thì chữ trước ảnh.

- Chat-sync: `akaAgentChatApi/apps/system-worker/src/zaloCampaignExecutor.ts:1923`
  (`media_then_content` / `content_then_media` / `combined`).
- Desktop/App Server: [campaignScheduler.ts:15198](../src/main/services/campaignScheduler.ts) `dispatchZaloMessage`.

Ca lỗi: `send_campaign_media` completed (đủ `msgId` từng ảnh), rồi `send_text` failed
`error_code='127'`, `error_message='Không thể nhận tin nhắn từ bạn.'`. Detail ghi đúng
`thất bại` / `Đã gửi file nhưng gửi nội dung thất bại. Không thể nhận tin nhắn từ bạn.`
(`partialSend` không requeue, không tính target lỗi liên tiếp).

Staff 1954, campaign 41031 (`zalo_message_phone`, album 3 ảnh), 26/10–01/11:
397 target đủ ảnh+chữ; **14 target ảnh đi, chữ 127**; 170 target ảnh lỗi `122`
(chặn người lạ, không nhận gì); 6 `fetch failed`.

Toàn bộ `chat_zalo_action` campaign 14 ngày, media completed không caption, nối với
`send_text` 127 cùng `auto_campaign_input_data_id` trong 5 phút:

| Nhóm | Media completed | Chữ 127 ngay sau |
| --- | --- | --- |
| 1 tệp (caption hoặc chữ trước) | 23.743 | 0 |
| 2–3 tệp | 7.437 | 6,08% |
| ≥4 tệp | 10.681 | 14,58% |
| `zalo_message_friend`, ≥2 tệp | 1.019 | 0 |
| `zalo_message_group`, ≥2 tệp | 506 | 0 |
| `zalo_message_phone`, ≥2 tệp | 13.952 | 13,42% |
| `zalo_message_group_member`, ≥2 tệp | 2.641 | 5,19% |

Theo org: 990 (10 tệp) 1.503 ca/15,6%; 458 354/13,4%; 205 135/10,7%; 1731 14/3,4%;
1709 2; 1590 1/0,3%. `send_campaign_media` bị 127 (806 ca) luôn là lệnh gửi đầu tiên.

**Chưa xác minh:** lý do Zalo từ chối (giả thuyết: hạn mức/chống spam với người lạ
đếm mỗi ảnh một tin); gửi chữ trước album hoặc chèn độ trễ có hết lỗi không; số ca
của nhánh Desktop/App Server (truy vấn `auto_campaign_details` quá 60 s).

**Hướng xử lý đề xuất:** trước mắt dùng 1 ảnh cho chiến dịch người lạ; lâu dài thử
A/B "chữ trước album" cho target người lạ ở cả hai runtime. Không retry `send_text`
sau 127 (đã có kết quả xác định).

Index cần dùng khi đo lại: `chat_zalo_action` không có index theo
`auto_campaign_input_data_id`; lọc bằng `idx_chat_zalo_action_status_source`
(`action_status_category_item_id` 75=completed, 76=failed + `request_source`), nối bằng
`idx_chat_zalo_action_socket_match` với `chat_zalo_conversation_id IS NULL` (lệnh
campaign không gắn conversation).

### Bản chất mã 127 (đo 01/11/2026, 14 ngày `chat_zalo_action` campaign)

Zalo không công bố nghĩa mã 127; `zca-js` không có bảng mã, server chỉ trả đúng một câu
`Không thể nhận tin nhắn từ bạn.` (từ 24/08: 7.178 `send_text` + 1.726 media campaign +
64 chat tay). Mô tả "gửi nhanh hoặc trùng nội dung" của `auto_error` id 60/61 do đội tự
đặt ngày 01/10. Dữ liệu cho thấy 127 là **cơ chế chống spam khi nhắn người lạ, phía Zalo,
gắn với tài khoản gửi và tạm thời** — khác `122` (người nhận tắt nhận tin người lạ, cố định):

- Chỉ người lạ: bạn bè 0/4.609 lượt, nhóm 0/2.728, kể cả album 10 ảnh.
- Theo số tin đã lọt tới cùng người lạ trong lượt gửi (ảnh tính từng tin): tin 1 = 1,25%
  (chữ) / 1,92% (media); tin 2 = 0,02% (6.430); tin 3 = 0,08% (2.380); **tin 4 = 11,8%**;
  tin 5–7 = 14,7–26%. Bước nhảy ở tin thứ 4.
- Theo trạng thái tài khoản: người lạ đầu tiên sau khi tài khoản nghỉ ≥20 phút gần như không
  bị (tin 1: 1/3.879; tin 4+: 0/2.097); người lạ kế tiếp ~1 phút sau: 11,2% / 36,4%. Sau một
  lần 127 + 30 phút nghỉ (policy id 61), lượt kế tiếp 0/3.097.
- Không phải chặn vĩnh viễn: 64 ca chat tay (48 hội thoại, 56 ca người nhận chưa từng nhắn) —
  người nhận nhắn lại là gửi được ngay (vd 127 lúc 14:12:34 → khách nhắn 14:13:31 → gửi OK
  14:13:49).
- Khác nhau theo tài khoản dù cùng nhịp ~1 phút/người: org 607/1708/1722 gửi 5–10 tin/người
  vẫn 0%; org 990/458/205 ~9–11% người nhận bị. Tương quan một phần với gửi một nội dung y hệt
  hàng loạt (458: 1 nội dung cho 2.648 tin; 607: 918 nội dung khác nhau/922 tin) nhưng chưa tách
  bạch (1708 lặp 3,8 lần/nội dung vẫn 0%) — **chưa xác minh** yếu tố riêng của tài khoản.

- **Cửa sổ ~5 phút giữa hai người lạ** (từ 20/08, người trước gửi OK): người lạ kế tiếp
  trong <5 phút bị 127 ở 4–14% số người (tin đầu 1,3–4,9%); từ 5–7 phút trở đi 0,04% → 0,01%.
  Riêng các tài khoản hay bị (org 990/458/205/1731), tin thứ 4+ bị chặn 19,8% (<2 phút), 16,1%
  (2–5 phút), **0/2.392** khi cách người trước ≥5 phút. Tức là "giới hạn 3 tin/người" chỉ bật
  khi tài khoản vừa nhắn người lạ khác trong 5 phút; số tin của người trước không làm tăng rủi ro.
- Nghỉ sau một lần 127: <2 phút còn bị 68%, 2–5 phút 86%, 30–35 phút 1/5.474. Khoảng 5–30 phút
  chỉ có 24 mẫu (0 bị) — **chưa đủ** để khẳng định 10 phút là đủ. Nếu nghỉ xong vẫn gửi dồn
  ~1 phút/người thì rủi ro quay lại (21,7% người nhận trong 30–60 phút sau lần 127).
- Campaign 41031 đặt `sleepBetweenActions=60`, 15 tin/65 phút ⇒ gửi dồn 15 người trong ~15 phút
  rồi chờ ~50 phút; giãn ≥300 giây/người giữ gần nguyên thông lượng giờ.
- Ngưỡng cứng 300 giây (bucket 15 giây): 285–300 giây 14,4% người nhận bị; 300–315 giây 0,11%;
  từ 315 giây 0%. Khuyến nghị "Nghỉ giữa 2 lần" 330–360 giây để có biên.
- Theo số ảnh (30 ngày): khi cách người trước <5 phút — chỉ chữ 2,75%, 1 ảnh + chữ 0/11.923,
  2 ảnh + chữ 0,81%, 3 ảnh + chữ 13,1%, 4–6 ảnh 18,9%, 7–10 ảnh 20,3%; khi ≥5 phút mọi cỡ đều 0
  (7–10 ảnh + chữ: 0/458). Album không kèm chữ 4–6 ảnh 0/339 dù <5 phút: `zca-js` gửi các ảnh
  của album song song (`Promise.all` trong `send`), tin chữ đi sau nên mới chạm ngưỡng tin thứ 4.
  "Chữ trước album" khớp cơ chế nhưng **chưa có dữ liệu** (code chưa có nhánh này cho ≥2 tệp).
- Ngưỡng không phụ thuộc số ảnh: cách người trước 5–6 phút, X=0–2: 0/2.140, X=3–6: 0/628,
  X=7–10: 0/41; 6–10 phút cũng 0 ở mọi X, kể cả khi người trước đã nhận ≥4 tin. Quy tắc cài đặt
  vì vậy là hàm bậc thang theo X (số ảnh, cộng 1 tin chữ): X ≤ 2 ⇒ "Nghỉ giữa 2 lần" tuỳ ý;
  X ≥ 3 ⇒ ≥330–360 giây. Không có công thức tỷ lệ theo X.
- Mốc của cửa sổ là người lạ gần nhất **thật sự nhận được tin**: lượt trước bị `122` (<5 phút) nhưng
  người lạ nhận tin gần nhất đã ≥5 phút ⇒ 127 chỉ 0,01% (10.696); lượt trước nhận OK <5 phút ⇒ 6,63%.
  Ví dụ campaign 41031 ngày 31/10: 08:20:03 khách nhận tin; 08:21 và 08:22 hai khách `122`;
  08:23:14 album 3 ảnh tới, 08:23:15 chữ `127` (cách người nhận tin gần nhất 3 phút 11 giây).
  Trong cửa sổ, việc bị chặn là xác suất: các khách lúc 08:17:55 và 08:20:02 (cách 2 phút) vẫn qua.
- Xen tin bạn bè/nhóm/chat tay giữa hai người lạ cách nhau <5 phút: 0/18 (so 2,14% khi không xen) —
  quá ít mẫu, **chưa kết luận** được việc xen tin có "xoá" cửa sổ hay không.
- Tin gửi bạn bè/nhóm/chat tay trong 5 phút trước, khi người lạ gần nhất đã ≥5 phút: 0/27 và 0/16
  (ít mẫu); không gửi gì 0,01%; vừa nhắn người lạ khác <5 phút 2,34% (112.406).

Hệ quả: album ≥3 ảnh + chữ khiến chữ thành tin thứ 4+, đúng vùng bị chặn. Giữ tổng ≤3 tin cho
mỗi người lạ (vd 1 ảnh + caption, hoặc ≤2 ảnh + chữ) hoặc đưa chữ lên tin đầu.

### Lỗi 127 trong ngày 02/11/2026 (mọi runtime, `auto_campaign_details` tới 19:35)

1.086 lần 127 trên 292 tài khoản (~26% tài khoản đang nhắn người lạ); 371 lần là album đã tới, chữ
bị chặn. Cả 1.086 mục tiêu bị đánh `hoàn thành`, không gửi lại. Tỷ lệ trên tin OK cùng khung giờ:

| Ngày | Server | QR + Web |
| --- | --- | --- |
| 29/10 (T5) | 2,5% (891/35.130) | 0,9% (158/16.932) |
| 30/10 (T6) | 3,1% (1.075/35.175) | 1,2% (192/15.761) |
| 31/10 (T7) | 5,1% (1.555/30.492) | 2,9% (313/10.688) |
| 01/11 (CN) | 7,4% (1.777/23.988) | 2,8% (218/7.849) |
| 02/11 (T2) | 2,6% (901/34.188) | 1,0% (176/17.616) |

- Khoảng cách tới tin người lạ gửi OK gần nhất của cùng tài khoản: <2 phút 3,37% bị 127 (22.587
  lượt), 2–<5 phút 2,01% (16.043), 5–<6 phút 0,04% (2.683), 6–<10 phút 0/3.363, ≥10 phút 1/7.205, tin
  đầu ngày 0/1.120 ⇒ 1.084/1.086 ca nằm trong cửa sổ 5 phút; 73% lượt gửi hôm nay cách <5 phút.
- Theo "Nghỉ giữa 2 lần" của chiến dịch: <60 giây 3,90% (410 chiến dịch), 60–119 giây 1,57% (496),
  120–299 giây 0,78% (180), ≥300 giây **0** (190 chiến dịch, 4.647 tin OK). Nhóm bị nhiều nhất đặt
  30–61 giây với 15–30 tin/65 phút (staff 479, 1177, 1044, 1350).
- Khoá 30 phút (id 61) có chạy: 0 lần 127 lặp lại trong 30 phút, nhưng trung vị giữa hai lần 127 của
  cùng tài khoản là 36 phút ⇒ hết khoá là gửi dồn lại và dính tiếp; 116 tài khoản bị ≥4 lần, 20 bị ≥10.
- **Đánh đổi thông lượng**: chiến dịch chạy ≥2 giờ, ≥10 tin OK: <60 giây 10,3 tin OK/giờ, 60–119
  giây 11,6, 120–299 giây 8,6, ≥300 giây 3,4. Nhóm ≥300 giây gộp cả nghỉ 331–3.300 giây; tách riêng
  (mọi chiến dịch, tính từ mục tiêu đầu tới cuối trong ngày): ~300 giây 4,1, 331–600 giây 3,0, >600
  giây 1,6. Ở 300 giây hạn mức giờ thường không phải nút thắt: 86/96 chiến dịch đặt ≥8,3 tin/giờ
  (phổ biến nhất 10 tin/65 phút, 43 chiến dịch), còn nhịp 300 giây với ~50% mục tiêu gửi OK chỉ cho
  tối đa ~6 tin OK/giờ.
- **Khoảng nghỉ chạy sau MỌI mục tiêu đã chạy** (đã kiểm code và dữ liệu tới 20:10 ngày 02/11):
  desktop/App Server ([campaignScheduler.ts:4750](../src/main/services/campaignScheduler.ts:4750))
  và chat-sync (`apps/system-worker/src/zaloCampaignScheduler.ts:965` bên akaAgentChatApi) nghỉ sau
  mọi mục tiêu đã chạy, kể cả 122 và tra số không tồn tại. Không nghỉ khi mục tiêu bị loại trước khi
  chạy (đã xử lý, lịch tương lai, danh sách chặn bạn bè, người từ chối nhận tin, giới hạn gửi lặp),
  mục tiêu cuối lượt, dừng/tạm dừng; sau 127 chiến dịch nghỉ ~30 phút do khoá id 61. Khoảng cách tới
  mục tiêu kế tiếp sau 122 hoặc số không tồn tại bằng khoảng nghỉ cộng 1–10 giây ở 95–99,8% trường
  hợp, cả bốn runtime. Hai loại này không tính vào cửa sổ 5 phút: khi tin OK gần nhất đã ≥5 phút,
  có 122 trong 5 phút trước vẫn chỉ 1/3.679 lượt bị 127, có số không tồn tại 0/4.217. Chiến dịch ~300
  giây (96 chiến dịch, 5.348 mục tiêu: 51% gửi OK, 17% 122, 22% không tồn tại, 0 lần 127) dành 157
  trong 382 giờ chạy (41%) để nghỉ sau 122/số không tồn tại. Ví dụ chiến dịch 40711 (App Server, 300
  giây, 15 tin/65 phút): 121 mục tiêu 09:46–20:08, mục tiêu sau luôn cách 305–349 giây bất kể kết
  quả; 3 giờ 42 phút là nghỉ sau 23 lần 122 và 21 số không tồn tại.
- Cách giữ cả hai: chỉ chờ ≥300–330 giây sau tin người lạ gửi OK, không chờ sau mục tiêu thất bại —
  **chưa có trong code**, cần sửa scheduler cả ba runtime. Chiến dịch 40711 khi đó xong 77 tin OK
  trong ~6,7 giờ thay vì 10,4. Giới hạn phải giữ: Zalo chặn tra số bằng `221` "Vượt quá số request
  cho phép" khi tài khoản tra ~50 lượt/giờ (chat-sync 14 ngày, giờ-tài khoản có 221: <40 lượt 6/7.036,
  40–49 lượt 6/53, ≥50 lượt 52/71); ở nhịp trên chiến dịch 40711 tra ~18 lượt/giờ.

### Mã 122 và 120 (đo 01/11/2026, `chat_zalo_action` từ 20/08)

`uid` của người nhận khác nhau theo từng tài khoản gửi (18.836/18.836 SĐT), `globalId` thì giống
nhau — theo dõi một người qua nhiều tài khoản phải dùng SĐT hoặc `globalId`.

**122** `Bạn chưa thể gửi tin nhắn đến người này vì người này chặn không nhận tin nhắn từ người lạ.`
(45.313 lần, 39 org; `auto_error` id 10: thất bại, không tính hạn mức). Là cài đặt của người nhận:
cùng SĐT gửi lại sau ~7–14 ngày, lần trước 122 ⇒ lần sau 97,3–97,6% vẫn 122 dù cùng tài khoản,
tài khoản khác hay org khác; lần trước OK ⇒ lần sau chỉ 0,4–0,8% bị 122. Theo nguồn data:
`zalo_message_phone` 23,3%, `zalo_message_group_member` 8,9%, bạn bè/nhóm 0%. Hoá giải duy nhất đo
được là kết bạn: `send_friend_request` (có trường `message` — lời nhắn) tới người đã 122 gửi được
98,3% (OK: 94,2%); trong 10.565 người 122 đã nhận lời mời, trạng thái hiện tại `friend` 566 (5,4%),
`request_sent` 8.091, `stranger` 1.846; sau khi thành bạn nhắn qua 33/39 (còn chưa thành bạn: 10/560
và 1/123). `get_friend_request_status` chạy ngay sau khi mời nên không dùng đo tỷ lệ đồng ý.

**120** `Zalo: Bạn đang bị cấm nhắn tin cho người lạ.` (420 lần, 13 org; `auto_error` id 42 khoá nhắn
người lạ tới 09:45 hôm sau). Là **hạn mức số người lạ nhận tin trong 24 giờ cuốn chiếu**, thường ~100
mỗi tài khoản: lúc bắt đầu bị cấm, số người lạ đã nhận tin trong 24 giờ trước — tài khoản 84: 35 đợt
trung vị 100; 40: 31 đợt trung vị 100; 38: 25 đợt trung vị 101; vài tài khoản ổn định ở mức khác
(46 ~59, 149 ~130, 260 ~140). Gộp 149 đợt/10 tài khoản mức ~100: đếm người lạ nhận được tin trong
24 giờ cuốn chiếu TB 104, lệch chuẩn 11, 106/149 trong 95–105; đếm cả người bị 122 TB 148, 0/149 trong
95–105 ⇒ 122 không tính; đếm từ 0 giờ hôm nay lệch chuẩn 40 (không giải thích được các lần bị cấm buổi
sáng). Lúc gửi lại được, trung vị 86,5 người trong 24 giờ trước (108/148 dưới 100; phần còn lại nghi
do danh sách SĐT có người đã là bạn bè nên đếm thừa). Mẫu điển hình: bị cấm buổi chiều, sáng sau
08:00–09:00 vẫn bị, ~10:00 qua (tài khoản 40: 16:58 ngày 15/09 → 07:42, 08:43 vẫn 120 → 09:44 OK).
Bạn bè/nhóm 0% bị 120; nhắn bạn bè trong lúc bị cấm chỉ có 1 mẫu (OK).

Mã khác khi gửi: 119 `Xin lỗi! Hiện tại tôi không muốn nhận tin nhắn.` (302 lần người lạ, 7 lần
bạn bè — phía người nhận, chưa nghiên cứu); 126 `Không thể nhận tin nhắn từ bạn.` gặp cả bạn bè (67)
nên không riêng người lạ; 114 tham số; 161 nhóm không tồn tại.

### Mã 802 (đo 01/11/2026, mọi runtime, 01–31/10)

`Zalo: Bạn đang bị chặn nhắn tin với người lạ.` — Zalo khoá **nhắn người lạ** (và thêm người lạ vào
nhóm, `auto_error` id 45) của cả tài khoản. Trong 48 giờ sau 802 các thao tác khác vẫn chạy: tra SĐT
1.809 OK, đổi tên 1.703, kết bạn 210 OK / 5 lỗi, nhắn nhóm 97 OK.

- **Mã mới của Zalo**: chat-sync 0 lần suốt 08–09/2026 (cùng lúc mỗi tuần vài trăm tới ~5.800 lỗi
  122/127); lần đầu 02/10 (App Server), 08/10 (chat-sync). Cùng tuần 05/10, `221` (giới hạn tra SĐT)
  72 → 623/tuần.
- Nguồn đếm: `chat_zalo_action.error_code='802'`, note input `Zalo hạn chế nhắn người lạ (mã 802)…`
  và `auto_account_action_status.disabled_error_code`. App Server/desktop **không ghi detail** cho 802
  (id 44 `detail_status=NULL`); note bị ghi đè khi data chạy lại ⇒ số lần là cận dưới. Tổng **97 tài
  khoản** tới 01/11 15:35; không chiến dịch 802 nào có `secondary_account_id`, nên quy về
  `auto_campaigns.account_id` là đúng.

Rủi ro theo ngày có gửi người lạ OK (sự kiện = ngày hoạt động cuối trước lần 802 đầu, cách ≤10 ngày):

| Loại tài khoản | Ngày-tài khoản | 802 | Mỗi ngày | Tin/ngày | Chạy đều 30 ngày |
| --- | --- | --- | --- | --- | --- |
| Zalo Server | 15.590 | 81 | 0,52% | 50 | ~14,5% |
| Zalo QR (desktop) | 6.939 | 4 | 0,06% | 44 | ~1,7% |
| Zalo Web | 2.493 | 3 | 0,12% | 38 | ~3,5% |

- Server gấp ~9 lần QR theo ngày, ~8 lần theo tin. App Server 71/1.260 tài khoản, chat-sync 14/211 —
  như nhau. 1.468/1.471 tài khoản Server không có proxy; QR có proxy 0/126.
- **Không tăng theo số tin/ngày**: Server <20 tin 0,45%, 20–59 0,56%, ≥60 0,48% ⇒ bớt tin/ngày không né
  được 802 (khác 120/127). Tuần đầu của tài khoản Server 0,81%/ngày, sau đó 0,35–0,45%.
- **Số tài khoản Server của cùng org**: 1 → 0/155; 2–3 → 3,8%; 4–6 → 6,5%; ≥7 → 10,5% tài khoản (36%
  org dính). QR cùng quy mô: 0/93; 1,4%; 1,7%; 0,9%. Trong org thường nhiều tài khoản bị cách nhau 1–3
  ngày (org 1263: 5 tài khoản 10–12/10; org 1239: 4 tài khoản cùng 18/10).
- **Chỉ nhắn người lạ không phải yếu tố mạnh** (2.463 tài khoản có tin OK trong tháng 10, chia theo tỷ lệ
  tin người lạ / tin người lạ + bạn bè + nhóm trước 802): 100% người lạ 2.264 tài khoản, 87 bị, 3,49/1.000
  ngày có nhắn người lạ; có thêm bạn bè/nhóm 104 tài khoản, 3 bị, 2,96/1.000 (RR 0,85, CI 0,17–2,57);
  riêng <50% người lạ 56 tài khoản, 1 bị (4970, org 990: 118 tin người lạ / 340 tin nhóm). Trong Server
  cả hai cùng 5,06/1.000 (RR 1,00, CI 0,20–3,03), trong khi Server/QR là 8,8 lần. Tỷ lệ theo tài khoản
  (1,8% so với 3,8%) thấp hơn chỉ vì nhóm đa dạng nhắn người lạ ít ngày hơn (5,9 so với 11,0 ngày/tháng).
  Chat tay ở chat-sync cũng không thấy che chắn: có chat tay 2/16 bị, không chat tay 11/196.
- Org có cả Server lẫn QR chỉ 13 (Server 3/93, QR 0/18) — chưa đủ tách môi trường Server khỏi kiểu
  dùng của khách (nhiều nick, cùng nội dung/list). **Chưa xác minh**: IP máy chủ dùng chung, phiên
  24/7, nội dung, báo spam từ người nhận, số lần tra SĐT/ngày (mẫu 14 tài khoản cũ gợi ý ≥120 lần/ngày
  rủi ro cao hơn, chưa kiểm ở quy mô toàn hệ thống).

Thời điểm lộ ra (97 tài khoản): 75 ở tin đầu tiên sau khi nghỉ ≥3 giờ (34 qua đêm 3–20 giờ, 41 sau
>20 giờ — 16 đúng 09:45 lúc hết khoá cũ), 4 sau nghỉ 15 phút–3 giờ, 13 giữa phiên (TB 24 tin OK trong 3
giờ trước), 5 bị sẵn trước tin OK đầu tiên ⇒ Zalo chủ yếu áp lệnh lúc tài khoản đang nghỉ.

Thời gian và tái phát: một đợt ~1 tuần — App Server mở lại sau 7–9 ngày (kiểm lại mỗi 48 giờ nên
thực tế ~6–8 ngày; 1 ca 3 ngày). 8/8 tài khoản App Server được mở lại rồi chạy tiếp đều bị 802 lại,
thường trong 1–2 ngày (5899 sau 7 tin; 5078 sau 18 ngày 5–10 tin/ngày). 23 tài khoản dính 802 trên
≥5 ngày khác nhau, trải TB 15 ngày, tối đa 29. Ngược lại 13 tài khoản vẫn gửi người lạ OK ngay sau
802 (5752: phút thứ 8, 216 tin trong 48 giờ) ⇒ không phải 802 nào cũng là khoá dài, và khoá 48 giờ của
mình không chặn các tài khoản này — **chưa xác minh** vì sao. Khoá 48 giờ ngắn hơn đợt cấm: mỗi 2 ngày
tốn 1 lần tra SĐT + 1 lần gửi lỗi rồi khoá tiếp (21/97 lần đầu ghi nhận rơi đúng 09:45–10:00).

## B. Comment sau đăng nhóm gãy toàn fleet từ 30/10

Block `fb_comment_at_position` (id 34) chờ element `fb_comment_box_at_n` (id 13)
8 s rồi mới tìm `fb_comment_dialog_textbox`:
`(//div[@aria-label='Viết bình luận...' or @aria-label='Write a comment...' or @aria-label='Write a comment' or @aria-label='Viết bình luận']|//*[@role='button' and .='Bình luận'])[${n}]`
(id 14 `fb_comment_textbox_at_n` cùng XPath).

- Comment thành công cuối của `facebook_group_post` toàn hệ thống: **30/10 07:43:39 VN**.
  30/10: 86 OK / 1.499 lỗi selector này (27 staff); 31/10: 0 / 793; 01/11: 0 / 132.
  24–29/10 lỗi selector này 19–151/ngày so với 464–1.461 OK/ngày.
- `facebook_comment_seeding` (cùng block/element), 29/10 18:00–30/10 14:00:
  1.030 OK / 51 lỗi trước mốc → 1 OK / 181 lỗi sau mốc.
  `facebook_comment_seeding_post` (block `fb_comment_current_post`, chỉ dùng
  `fb_comment_dialog_textbox`) vẫn 238 OK / 0 lỗi.
- Không có thay đổi phía mình tại mốc: element 13/14 sửa lần cuối 15–16/05, block 34
  ngày 13/10, không migration 07:40–08:50 VN 30/10; mọi staff đã ở 9.1.0 từ 28/10 và
  28–29/10 comment bình thường; chuỗi bước trước comment (đăng, verify, link,
  pending) giống hệt lượt trước mốc.

**Kết luận:** gần như chắc Facebook đổi DOM ô/nút bình luận. Bài vẫn đăng thành công,
chỉ mất comment (thường chứa SĐT). Detail comment là `thất bại` nên vẫn tính quota
action Comment theo hợp đồng rate limit.

**Cập nhật 01/11/2026, 13:14:37 VN:** người dùng cung cấp XPath và yêu cầu sửa riêng
element 13 `fb_comment_box_at_n`. Đã thêm đúng `or contains(@aria-label,'Comment')`
vào điều kiện của nhánh `//div`; giữ nguyên mọi phần khác, kể cả `${n}`. Element 14
và 1517, toàn bộ block/workflow giữ nguyên checksum. Thay đổi này thay thế đề xuất
ban đầu sửa cả 13/14. [Receipt và phạm vi hậu kiểm](audits/facebook-comment-box-xpath-20261101/receipt.json),
[capture trước](audits/facebook-comment-box-xpath-20261101/before.json),
[capture sau](audits/facebook-comment-box-xpath-20261101/after.json),
[SQL có checksum guard](audits/facebook-comment-box-xpath-20261101/apply.sql),
[rollback thủ công có guard](audits/facebook-comment-box-xpath-20261101/rollback.sql).

Đã thử transaction kết thúc ROLLBACK, xác nhận catalog trở về bản trước, rồi apply
và đọc lại XPath khớp chính xác yêu cầu. Không sửa RPC/schema/quyền, không reload
PostgREST, không build/deploy app và chưa chạy comment thật để xác nhận hiệu quả.

**Đính chính cache:** cập nhật DB không tự làm process đang mở nạp lại element ở
lượt chạy kế tiếp. Cần thoát hẳn app rồi mở lại hoặc invalidation qua
`elementV2Repository`. Element 1517 vẫn có 133 lượt comment trực tiếp bài post
thành công trong kiểm tra đến 12:55; timeout tại element này không chứng minh XPath
sai nếu chưa xác nhận dialog đã mở. Giữ nguyên element 1517 theo quyết định người dùng.

**Cập nhật tiếp 01/11/2026, 13:31:54 VN:** đã cập nhật thêm hai element theo đúng
XPath người dùng cung cấp, trong cùng một transaction:

- 1692 `fb_newsfeed_comment_button`:
  `.//*[@role='button' and (.='Bình luận' or contains(@aria-label,'Comment'))]`.
- 1489 `fb_comment_in_post_btn`:
  `.//*[@role='button' and (.='Bình luận' or .='Comment' or contains(@aria-label,'Comment'))]`.

Mẫu tương thích được người dùng chỉ định là giữ điều kiện cũ và bổ sung nhận diện
`aria-label` chứa `Comment`, khi text hiển thị hoặc nhãn chính xác cũ không khớp.
Giữ nguyên XPath tương đối `.//`, `role='button'`, parent/root của từng luồng,
block/workflow, element 13 đã sửa trước đó và các ô nhập 1517/1694. Không áp dụng
thay thế hàng loạt cho selector khác từ suy luận này.

Rà soát trước sửa: 1692 được block 2707/2708 dùng trong workflow newsfeed 238/254;
log hôm nay có 165 bước mở comment trả `Không tìm thấy nút Bình luận` trên 28
chiến dịch. Element 1489 được block 2603/2719 dùng trong luồng quét comment
group/search. Element 14 giữ XPath cũ nhưng không thấy tham chiếu trong block,
workflow hoặc source hiện tại. Parent newsfeed là bài đang đánh dấu trong DOM;
parent group dùng element 1485, search dùng element 1708 (có fallback hiện hữu).

[Receipt](audits/facebook-comment-buttons-xpath-20261101/receipt.json),
[capture trước](audits/facebook-comment-buttons-xpath-20261101/before.json),
[capture sau](audits/facebook-comment-buttons-xpath-20261101/after.json),
[SQL có checksum guard](audits/facebook-comment-buttons-xpath-20261101/apply.sql),
[rollback thủ công có guard](audits/facebook-comment-buttons-xpath-20261101/rollback.sql).
Trial ROLLBACK, kiểm tra phục hồi và hậu kiểm XPath chính xác đều đạt; checksum
các element còn lại, block và workflow giữ nguyên. Chưa chạy Facebook thật;
vẫn cần khởi động lại app đang mở để nạp cache. Không reload PostgREST/build/deploy.

**Rà soát tiếp sau cập nhật (chỉ đọc, 01/11/2026):** đã rà 138 element Facebook,
code block, config workflow và log liên quan hôm nay; [bằng chứng và phạm vi](audits/facebook-comment-buttons-xpath-20261101/followup-review.json).
Element 1691 `fb_newsfeed_like_button` còn dùng
`.//*[@role='button' and .='Thích']`: 462 bước không tìm thấy nút trên 28 chiến dịch,
13 bước báo `liked=true`; ưu tiên kiểm tra DOM/root và nhãn thực tế trước sửa.
Không suy ra XPath Like/Share mới chỉ từ thay đổi nhãn Comment.

Block 2717/2719 có nhánh dự phòng nhận diện khung bài qua `innerText/textContent`
chứa Bình luận/Comment/Chia sẻ/Share, nên cần xem lại nếu giao diện chỉ còn nhãn
aria. Nhánh này chỉ chạy khi selector khung bài chính không tìm được; chưa có lượt
chạy của hai block trong cửa sổ hôm nay đã truy vấn. Fallback nút của 2719 còn so
chữ tuyệt đối, nhưng nhánh chính đã dùng element 1489 mới. Chưa sửa thêm block.

Element 1517/1693/1694 đã dùng `contains(@aria-label,...)`, giữ nguyên. Không thấy
consumer hiện tại cho 14/1456/1496/1695. Riêng tên 1695 trùng `blockName` trong
workflow, không phải tham chiếu element: block 2710 gửi bằng Enter. Không sửa
element không được sử dụng chỉ vì tên hoặc XPath trông tương tự.

**Cập nhật Like 01/11/2026, 13:49:07 VN:** sau khi người dùng kiểm tra, đã thêm
đúng điều kiện `or contains(@aria-label,'Bày tỏ cảm xúc Thích')` cho hai element:

- 1691 `fb_newsfeed_like_button`:
  `.//*[@role='button' and (.='Thích' or contains(@aria-label,'Bày tỏ cảm xúc Thích'))]`.
- 1132 `fb_like_button`:
  `.//*[@role='button' and (@aria-label='Thích' or @aria-label='Like' or contains(@aria-label,'Bày tỏ cảm xúc Thích'))]`.

Giữ điều kiện cũ, XPath tương đối và parent: 1691 tìm trong bài newsfeed hiện tại
được app đánh dấu; 1132 tìm trong dialog đầu tiên do element 1492 xác định.
Người dùng xác nhận nút Chia sẻ không lỗi; element 257 và mọi element khác giữ nguyên.
Trial ROLLBACK, xác nhận phục hồi và đọc lại DB sau COMMIT đều đạt; checksum
block/workflow và catalog element ngoài hai ID không đổi. Không sửa schema/RPC,
không reload PostgREST/build/deploy. Chưa chạy Like thật; app đang mở cần thoát hẳn
rồi mở lại để nạp cache.

[Receipt](audits/facebook-like-buttons-xpath-20261101/receipt.json),
[capture trước](audits/facebook-like-buttons-xpath-20261101/before.json),
[capture sau](audits/facebook-like-buttons-xpath-20261101/after.json),
[SQL có checksum guard](audits/facebook-like-buttons-xpath-20261101/apply.sql),
[rollback thủ công có guard](audits/facebook-like-buttons-xpath-20261101/rollback.sql).

**Hậu kiểm log sau sửa, chốt 01/11/2026 13:57:13 VN (chỉ đọc):**
[receipt và các campaign/bước liên quan](audits/facebook-like-buttons-xpath-20261101/post-edit-check.json).
Từ từng mốc cập nhật đến giờ chốt, block 34 có 18 timeout trên 7 campaign
(34811, 37293, 39049, 40443, 41786, 44976, 45527), tất cả thông báo chứa XPath
element 13 cũ, chưa có `contains(@aria-label,'Comment')`. Điều này xác nhận
các bước đó dùng selector cũ; phù hợp cache process chưa nạp lại, không phải
bằng chứng selector mới thất bại. Có 2 comment thành công ở campaign 46340,
nhưng không có telemetry selector của các bước thành công để xác nhận phiên bản.
87 output `commented=false` ở campaign 45900 là bỏ qua khi text/ảnh trống,
không tính là lỗi XPath.

Luồng comment trực tiếp bài post có 20 thành công và 1 timeout element 1517:
campaign 45621, run 4830018, bước bắt đầu 13:43:20 VN. Navigation và main đã qua,
nhưng log không xác nhận dialog đã mở nên chưa kết luận XPath ô nhập sai.
Không có bước chạy sau mốc sửa cho 1489/1692 hoặc hai nút Like 1691/1132 trong
cửa sổ đã đọc; chưa đủ dữ liệu kết luận hiệu quả các chỉnh sửa này.
Hậu kiểm không sửa DB hoặc kích hoạt comment/Like; các máy dùng selector cũ
cần thoát hẳn app rồi mở lại theo hợp đồng cache hiện hành.

**Hậu kiểm tiếp, chốt 01/11/2026 16:01:04 VN (chỉ đọc):**
[receipt cập nhật](audits/facebook-like-buttons-xpath-20261101/post-edit-check-1601.json).
Từ lần chốt 13:57 có thêm 7 comment thành công qua element 13 (6 sau đăng nhóm,
1 seeding), 21 timeout XPath 13 cũ và **2 timeout XPath 13 mới**. Hai lỗi mới thuộc
campaign 46363 `thuê đất Linh Sơn 1/11/2026`, run 4843523: vị trí 1 lúc
15:53:30 và vị trí 3 lúc 15:54:13; vị trí 2 giữa hai lỗi comment thành công.
Run trước đó cùng campaign có ba vị trí comment thành công. Bước đăng/đóng form
đã qua và `isPending=false`; không có DOM snapshot/count/screenshot để xác định
nguyên nhân hai lần không tìm thấy selector. Không quy hai lỗi này cho cache cũ.

21 lỗi cũ mới phát sinh thuộc campaign 34811/40443/45527/45430, lần lượt
12/4/4/1 lỗi. Lũy kế từ mốc sửa: element 13 có 9 comment thành công,
39 timeout bản cũ và 2 timeout bản mới. 147 bước bỏ qua nội dung/ảnh trống
không tính là lỗi XPath. Element 1517 có thêm 68 thành công và 6 timeout ở
campaign 41943 (15:44–15:48), lũy kế 88 thành công/7 timeout; vẫn chưa có
bằng chứng dialog đã mở tại các lượt timeout. Chưa có bước chạy sau sửa cho
1691/1132/1692/1489. Không sửa DB hoặc kích hoạt thao tác Facebook trong hậu kiểm.

**Hậu kiểm tiếp, chốt 01/11/2026 22:13:29 VN (chỉ đọc):**
[receipt cập nhật](audits/facebook-like-buttons-xpath-20261101/post-edit-check-2213.json).
Từ lần chốt 16:01 có thêm 47 comment thành công qua block 34,
230 lỗi tìm element 13 bằng XPath mới trên 14 campaign và 57 timeout XPath cũ.
Campaign 46363 có thêm 2 thành công/4 lỗi bản mới (lỗi cuối 17:04:57).
Năm campaign lỗi bản mới nhiều nhất: 37702=57, 43257=30, 43258=30,
43259=27, 43260=22. Nhiều lỗi ở chỉ số vị trí lớn, kể cả 50–130 trong
seeding; chưa có DOM/count để kết luận nguyên nhân không tìm thấy vị trí.

Like newsfeed 1691 đã có 178 `liked=true` và 4 lần không tìm thấy nút;
Like dialog 1132 có 4 `liked=true, alreadyLiked=false`, không thấy lỗi.
Comment newsfeed 1692 có 20 mở thành công, cả 20 focus/gửi thành công;
11 không tìm thấy nút mở ở campaign 46439/46440. Không tính 11 output
focus/gửi false phía sau thành lỗi ô nhập/gửi độc lập. Log lỗi newsfeed
không ghi selector đã resolve nên chưa phân biệt cache XPath cũ/mới.
1489 chưa có lượt chạy sau sửa. Có một bước mở newsfeed và một bước
comment seeding còn `running`, không tính là thành công/thất bại.

Comment trực tiếp 1517 có thêm 244 thành công/46 timeout; block 34 có
thêm 6 timeout 1517. Timeout không chứng minh dialog đã mở hoặc selector
ô nhập sai toàn bộ. Năm element vẫn đúng XPath và timestamp đã apply.
Không sửa DB hoặc kích hoạt thao tác Facebook trong hậu kiểm.

**Truy nguồn vị trí `n` và scroll của element 13 (01/11/2026, chỉ đọc):**
[capture block live, cấu hình workflow và bằng chứng các run](audits/facebook-comment-box-xpath-20261101/position-trace/receipt.json).
Block 34 lấy `Number(input.position || vars.loopItem.position || 1)` rồi
thay vào `fb_comment_box_at_n`. Workflow 157/test 245 lấy item từ output
`commentIterations` của block 2554. Khâu chuẩn bị đọc các khung bài bằng
element 1485, gán `position=i+1` trước khi lọc keyword/AI, giữ nguyên position
và postUrl của bài được chọn. Số bài yêu cầu là 30 không giới hạn position ở 30.

Log campaign 42111/run 4851034: quét 113, 20 vòng cuộn, chọn
`[52,62,79,95]`. Run 4853195: quét 148, 20 vòng cuộn, lần đọc cuối có
131 khung bài, chọn 17 bài gồm vị trí 130. Campaign 42109/run 4853204:
quét 119, lần cuối 118 khung, chọn `[78,79,88]`. Cả ba bật lọc keyword,
yêu cầu 30 và dừng do `max_scroll_cycles`; không được suy rằng chưa từng
tải tới bài 130 từ timeout nút thứ 130.

Block 2554 có cuộn từng khung bài khi đọc, chờ 300ms; vòng ngoài cuộn
1500px/chờ 2000ms, tối đa 20 vòng, ba vòng không có bài mới hoặc
`max(30,N*10)` bài đã quét. Sau chọn xong mới comment. Điểm chưa được
bảo đảm: position của danh sách **khung bài 1485** được dùng làm chỉ số
toàn trang của **nút/khung comment 13**, không đối chiếu ánh xạ 1:1,
không dùng lại postUrl để tìm đúng bài. DOM có thể thay đổi giữa hai giai đoạn.

Source PageController hiện tại có fallback scroll trong waitForSelector:
mỗi ba poll thất bại cuộn window `max(600,85% chiều cao)`, chờ 500ms,
trong ngân sách 8000ms do block 34 truyền vào; không xác nhận đủ n nút.
Resolver lọc phần tử có kích thước/không bị ẩn rồi mới lấy chỉ số cuối,
khác XPath thuần trong trình duyệt. Log DB không xác nhận phiên bản hay
từng lần fallback scroll trên từng máy khách.

Workflow đăng nhóm 1/test252 không chạy block 2554. Scheduler tạo
own=`[1]`, all=`[1..commentCount]`, others=`[2..commentCount+1]`;
block 2627 giảm vị trí đi 1 khi bài pending và chọn others. Snapshot các
campaign 43257–43260/37702 đặt commentCount=30/others nên có dải 1–30
hoặc 2–31; đây là nguồn các chỉ số lớn ở luồng đăng nhóm. Chưa sửa
block/workflow/element hay runtime trong lần truy nguồn này.

**Hậu kiểm ngày 02/11/2026, chốt 09:12:26 VN (chỉ đọc):**
[receipt và số liệu theo chiến dịch](audits/facebook-like-buttons-xpath-20261101/post-edit-check-20261102-0912.json).
Từ 00:00 hôm nay: comment sau đăng nhóm 34 thành công/267 lỗi
(204 tìm element 13 mới, 61 bản cũ, 2 timeout ô nhập 1517);
seeding group/page/profile 9 thành công/18 lỗi element 13 mới;
comment trực tiếp 80 thành công/15 timeout 1517;
newsfeed 113 gửi thành công/47 lỗi nút mở. 36 lượt bỏ qua nội dung trống
và 1 bước mở newsfeed còn running không tính vào thành công/thất bại.
47 output focus/gửi false sau lỗi mở không tính thêm lần nữa.

Chưa ổn: lỗi element 13 mới còn phát sinh lúc 09:11:37. Riêng một giờ
gần nhất comment sau đăng nhóm có 21 thành công, 51 lỗi bản mới,
18 bản cũ và 2 timeout ô nhập. Campaign 46363 hôm nay có 3 thành công/
9 lỗi bản mới ở vị trí 1–3; không chỉ các chỉ số lớn mới bị lỗi.
Element 13 và checksum block 34/2554 giữ nguyên; chưa sửa ánh xạ vị trí/root.
Hậu kiểm không sửa DB hoặc kích hoạt comment.

**Đối chiếu 3 thành công/9 lỗi campaign 46363 sáng 02/11 (chỉ đọc):**
[receipt 12 bước và bốn lượt chạy](audits/facebook-comment-box-xpath-20261101/comparison-46363-20261102.json).
Cả bốn lượt dùng account 9757, workflow 1, block 34, vị trí 1/2/3,
commentType/commentGroupMode đều all và cùng ba mẫu nội dung (đối chiếu hash).
Run 4876305 tại nhóm 2431016557194787 thành công cả ba (09:07–09:08);
4869093 tại 229402304828760, 4869258 tại 684374321091543 và 4876993 tại
611687073318146 lỗi cả ba. Cả chín lỗi dùng XPath 13 mới và dừng sau
khoảng 8,7–9,3 giây, trước bước textbox/đính ảnh; imageCount=0 không chứng
minh lỗi ảnh. Hai lượt lỗi có postUrl pending_posts; lượt lỗi 4869258 và
lượt thành công đều pending_content_empty/isPending=false. Thời gian từ
verify đóng form tới comment của hai lượt không pending gần bằng nhau:
8,819 giây lỗi và 8,750 giây thành công. Vì vậy pending hoặc chỉ số n lớn
không giải thích toàn bộ lỗi.

Không có run event/ảnh chụp cho bốn run này. Source hiện tại kiểm tra
my_pending_content trên page phụ, không chuyển main page tới đó; block
comment tìm nút toàn trang, không mở postUrl. Chưa có DOM/URL/count/visibility
đúng thời điểm lỗi để phân biệt nút chưa tải, bị ẩn hoặc thuộc tính khác
selector. Chưa thể kết luận XPath sai hay khẳng định một nguyên nhân DOM cụ
thể; không sửa DB/workflow/runtime hoặc kích hoạt comment trong lần đối chiếu.

**Bổ sung nhãn tiếng Việt vào element 13 ngày 02/11/2026, 09:27:03 VN:**
Người dùng đã vào trình duyệt kiểm tra và xác định cần thêm
`or contains(@aria-label,'Bình luận về')`. Đã thêm đúng điều kiện này vào
nhánh `//div[...]` của XPath 13, giữ toàn bộ điều kiện trước đó và chỉ số
`[${n}]`. Đây là bằng chứng mới từ người dùng bổ sung cho giới hạn log
trong lần đối chiếu 12 bước phía trên; chưa có xác nhận campaign sau sửa.

[Capture trước/sau, SQL có checksum guard và rollback](audits/facebook-comment-box-xpath-20261101/vietnamese-label-20261102/receipt.json).
Trial kết thúc ROLLBACK đạt, commit và đọc lại độc lập đạt; chỉ đổi
xpath/updated_at của row 13. Checksum tất cả element còn lại, block và workflow
giữ nguyên. Process đang mở cần thoát hẳn app rồi mở lại để nạp cache element.
Không sửa runtime, quyền/schema/RPC; không reload PostgREST, build, deploy
hoặc kích hoạt hành động Facebook.

**Rà và bổ sung các nút cùng chức năng ngày 02/11/2026, 09:29:38 VN:**
Theo yêu cầu người dùng, đã rà các element liên quan comment và nơi sử dụng
trong block/workflow/source. Thêm riêng `or contains(@aria-label,'Bình luận về')`
vào 1489 `fb_comment_in_post_btn` (quét comment group/search) và
1692 `fb_newsfeed_comment_button` (mở/focus bình luận newsfeed).
Giữ XPath tương đối, role button và mọi nhánh có sẵn.

1517/1693/1694 đã chứa `contains(@aria-label,'Bình luận')` nên bao phủ nhãn
mới; 13 đã sửa ở bước trước. 14 là alias cũ không thấy consumer trong block,
workflow hoặc source hiện tại nên không sửa. 1695 là nút gửi, các menu sắp xếp,
xem thêm, nội dung và permalink có chức năng khác nên giữ nguyên.
[Inventory, references, trước/sau và receipt](audits/facebook-comment-buttons-xpath-20261101/vietnamese-label-20261102/receipt.json).
Trial ROLLBACK, commit có checksum guard và đọc lại độc lập đạt; checksum
tất cả element ngoài 1489/1692, block và workflow không đổi. Chưa test Facebook
thật sau sửa; app đang mở cần khởi động lại để nhận cache mới. Không đổi
schema/RPC/quyền/source, không reload PostgREST/build/deploy.

**Kiểm chứng chuẩn bị PR ngày 02/11/2026:** hai typecheck và build production
đạt; build local mất 25,144 giây, không tạo/phát hành bộ cài hoặc deploy.
JSON, liên kết và phạm vi SQL có guard đã kiểm tra; không chạy lại SQL hay
kích hoạt Facebook. [Receipt kiểm chứng](audits/facebook-comment-box-xpath-20261101/pr-verification-20261102.json).

## C. "Không tìm thấy ô đăng bài": lỗi cũ, nay mới hiện

`fb_open_composer` (block 27, V374/V375) trả `opened:false` + `actionResult`
`err_fb_composer_editor_not_found`, stage `composer_button` (nút "Bạn viết gì đi…"
không xuất hiện trong 15 s); step vẫn `success` nên đếm lỗi phải đọc
`auto_run_steps.output->>'opened'`, không đếm `status='error'`.

- Staff 724: tỷ lệ `opened:false` **34–41% mỗi ngày từ 16/10** (28–31/10: 30,3 / 38,3 /
  28,5 / 33,7%), không đổi khi lên 9.1.0 lúc 28/10 09:26 VN.
- 7.6.0 không tạo detail: 26–27/10 có 156 lượt `opened:false`, 0 dòng
  `auto_campaign_details`, input `hoàn thành` với note rỗng (khách tưởng đã đăng).
  9.1.0 ghi `lỗi` / `Đăng bài group` / `Không tìm thấy ô đăng bài`: 36/92/82/60 dòng
  ngày 28–31/10, khớp đúng số `opened:false`.
- Không ngẫu nhiên: 1.181/1.196 lần lỗi (98,5%) nằm ở cặp tài khoản–nhóm chưa từng
  mở được. Ví dụ `groups/victorianovaladd2`: tài khoản 3340/5152/5982 OK 31/24/27,
  3351/5174 lỗi 25/28; `groups/raovatbatdongsantphcm` lỗi trên cả 6 tài khoản.
- Phần lớn cặp lỗi không có nhóm trong `auto_account_contacts` của tài khoản đó, nhưng
  có cặp `is_joined=true` vẫn lỗi và cặp `is_joined=false` vẫn đăng được ⇒ cờ không
  đáng tin; nguyên nhân từng nhóm (chưa là thành viên / nhóm chặn đăng) **chưa xác minh**.
- Campaign 44875 tự tạm dừng: `Dừng sau 7 data lỗi/thất bại liên tiếp (ngưỡng 4): Không tìm thấy ô đăng bài`.

**Hướng xử lý:** rà danh sách nhóm theo từng tài khoản (bỏ/tham gia lại cặp luôn lỗi).

## D. Rà soát logic chạy chiến dịch: lãng phí và cập nhật sai (02/11/2026 tối)

Dữ liệu `auto_campaign_details` 02/11 tới ~20:40 VN (id ≥ 10.225.316), chính sách `auto_error`
và code tại `5a0f560`. Chưa sửa gì; mọi mục dưới đây cần quyết định trước khi đổi code/DB.

1. **Không nhớ mục tiêu đã hỏng cố định.** Cooldown gửi lặp
   (`aka_agent_apply_campaign_delivery_cooldown`) chỉ xét dòng `thành công`. Chỉ nhìn lại ~2 ngày
   (id ≥ 10.000.000, từ 31/10 18:03): 2.915/15.063 lượt 122 hôm nay (19%) gửi tới số đã 122 trước đó,
   và gửi lại thì 1.883/1.900 (99,1%) vẫn 122; 3.503/21.394 lượt tra số (16%) là số đã "không tồn
   tại", tra lại 2.315/2.322 (99,7%) vẫn không tồn tại. Nguồn lần trước: ~80% tổ chức khác, ~19% tài
   khoản khác cùng tổ chức, <2% cùng tài khoản (tra lại cùng tài khoản – cùng số chỉ 127/86.274).
   QR 12–16%, Web 14%, App Server 18–21%; chat-sync không đo được từ details (thiếu SĐT trong
   `data`). Mỗi mục tiêu như vậy tốn một lượt tra số và trọn khoảng nghỉ.
2. **Nhóm Zalo từ chối cố định bị gửi lại cả ngày.** App Server, chia sẻ tin vào nhóm: tài khoản
   9709/9701 (org 1835) và 4011 có 56 nhóm trả mã **112** ở mọi lượt trong ngày (không nhóm nào lúc
   được lúc không); 4.665 lượt hôm nay, 112 của ba tài khoản 4,7–5,2 nghìn lượt/ngày từ 31/10. Chiến dịch 45928/45930 đặt 133 khung giờ (5 phút/lần), nạp
   lại toàn bộ nhóm mỗi khung. 112 chưa có dòng `auto_error` nên rơi vào
   `err_zalo_api_business_failed` và bị tính vào hạn mức. Nhóm không tồn tại (161) cùng kiểu: 67
   lượt, tài khoản 4011 lặp qua ~24 chiến dịch.
3. **Lỗi tạm thời đốt mục tiêu.** Mục tiêu chỉ được trả về hàng đợi khi chính sách không có
   `detail_status` ([campaignScheduler.ts:14553](../src/main/services/campaignScheduler.ts:14553));
   `err_zalo_api_business_failed` có `thất bại` nên mục tiêu thành `hoàn thành`. Hôm nay: upload ảnh
   lỗi mạng 252, lỗi mạng tới DB của chính mình (`Failed to get account: fetch failed`…) 57, `net::`
   16 ⇒ 325 mục tiêu chưa gửi gì mà 0 lần gửi lại; `fetch failed` 242 (phần lớn có tệp, chưa có
   phản hồi gửi ảnh). Đối chứng: `Listener Zalo chưa sẵn sàng` được trả về hàng đợi (82/97, 40 gửi
   lại OK). Media quá giờ chờ (423) cố ý không gửi lại vì không rõ đã tới chưa.
4. **127 đốt mục tiêu.** 1.138 mục tiêu bị 127 hôm nay đều `hoàn thành`, 0 gửi lại: 389 là album đã
   tới, chữ bị chặn (không gửi lại là đúng); ~749 chưa nhận được gì. 127 còn tính vào hạn mức.
5. **Nhóm lỗi chung che nguyên nhân.** `err_zalo_api_business_failed` (id 18) có 6.331 dòng hôm
   nay: mã 112 (4.820), lỗi mạng, lỗi DB của mình, media quá giờ chờ, nhóm không tồn tại. Khách chỉ
   thấy "Chia sẻ tin nhắn Zalo thất bại"/"fetch failed"; tất cả (trừ đổi tên gợi nhớ) tính vào hạn
   mức. Chỉ `err_undefined` (ngưỡng 4) mới tự tạm dừng chiến dịch; id 18 không có ngưỡng.
6. Facebook cùng kiểu mục 1–2: "Không tìm thấy ô đăng bài" nằm 98,5% ở cặp tài khoản–nhóm chưa từng
   mở được (mục C), hôm nay 1.143 dòng `lỗi`; chưa có cơ chế bỏ qua cặp luôn lỗi.

Kiểm thêm sau hai lượt đọc code (desktop/App Server và chat-sync), chỉ giữ mục có dữ liệu xác nhận:

7. **Mục tiêu bị khoá tạm thời nằm "tạm dừng" vĩnh viễn.** `aka_agent_settle_action_results_v1`
   (live) có `IF p_input_patch->>'status'='chờ xử lý' AND v_effect<>'pause' THEN v_status:=CASE WHEN
   v_committed THEN 'tạm dừng' …`; bước tra số thành công cũng tính là "đã thực hiện". Nên khi tin
   nhắn gặp 120/802 hoặc lời mời gặp 224 (chính sách muốn trả về hàng đợi), mục tiêu thành `tạm dừng`
   và scheduler bỏ qua mãi. Đang có 1.898 (120) + 274 (802) + 959 (224) = 3.131 mục tiêu như vậy, mọi
   runtime (App Server 2.562, QR 297, chat-sync 204, Web 68); 2.717 quá 3 ngày; **1.108 nằm trong
   chiến dịch đã `hoàn thành`** dù chưa từng được gửi.
8. **Lỗi tạm thời làm tạm dừng chiến dịch.** Đang tạm dừng (cập nhật trong 14 ngày): 61 chiến dịch
   desktop (44 Facebook, 9 QR, 8 Web; 42 dừng >24 h) vì `Lượt chạy gặp lỗi: …TypeError: fetch failed`
   (mạng tới DB của mình), và 32 với ghi chú chung `Có lỗi xảy ra` (`err_undefined`): 24 có mục tiêu
   cuối `thành công`, 18 bộ đếm lỗi liên tiếp chưa tới ngưỡng 4 — nhánh `explicitOnly`
   ([campaignScheduler.ts:9974](../src/main/services/campaignScheduler.ts:9974)) áp chính sách mà không
   xét ngưỡng.
9. **Ghi kết quả thất bại vì lượt chạy bị thu hồi giữa chừng**: 705 mục tiêu `hoàn thành` với ghi chú
   `action_result_claim_invalid … không tự gửi lại`, trong đó 315 mới qua bước tra số (chưa gửi gì).
   Nghi do 22 chính sách đổi chiến dịch về `chờ xử lý` (`err_device_sleep`, `err_network_offline`,
   `err_proxy_failed`…) xoá claim khi mục tiêu đang chạy — chưa tách được nguồn.
10. **Tra số lỗi mạng đốt mục tiêu**: từ 31/10 sáng có 92 lượt tra (`fetch failed`, `ECONNRESET`) bị
    `thất bại` → `hoàn thành`, dù tra số chỉ đọc, gửi lại vô hại.
11. **Chat-sync bỏ lời mời kết bạn sau 127/126/123/120**: chiến dịch bật kết bạn, từ 31/10 sáng chỉ
    1/468 mục tiêu chat-sync còn được mời (tag/tên gợi nhớ 2/468), trong khi App Server 52%, QR 72%,
    Web 79% vẫn mời.
12. **VPS hỏi trạng thái chạy mỗi 5 giây trong lúc nghỉ**: `rpc/aka_agent_get_zalo_server_run_control_state`
    1.027.502 lượt 09:00–17:00 VN (35,7/giây, 100% từ `103.153.72.222`, ~20 lượt mỗi unit), ~7% số
    request PostgREST; mỗi lượt chỉ 1,25 ms trong DB. Vòng nghỉ cũng chạy trước khi kiểm hạn mức và
    tính cả dòng đã xong (`targets` = mọi dòng của chiến dịch), nên lượt chạy hay kết thúc bằng một
    khoảng nghỉ thừa.
13. QR: lỗi mạng khi kiểm phiên hạ tài khoản xuống `chưa đăng nhập` và không tự hồi phục (14 ngày: ~43
    lần đăng xuất có lý do mạng/DB/proxy/500 trên desktop; 5 tài khoản QR đang kẹt).

### Giải pháp đề xuất cho mục D (02/11/2026 tối, chưa làm gì)

Kênh: **DB** = áp cho mọi runtime ngay; **VPS** = App Server mình tự deploy; **chat-sync** = deploy
akaAgentChatApi; **desktop** = theo bản phát hành (máy khách bản cũ không nhận).

- **Mục 7 (kẹt `tạm dừng`)** — gốc của 3, 4, 11. Thành công của bước tra số hiện bị gắn
  `operationState='committed'` (desktop `src/main/services/actionResultRuntime.ts:165`, chat-sync
  `packages/database/src/campaignActionResults.ts:112`; đo 02/11: 7.116/7.116 lượt tra OK đều
  `committed`). Sửa: tra số (chỉ đọc) và tên gợi nhớ/tag (lặp lại vô hại) luôn `not_committed`;
  thêm phòng thủ trong `aka_agent_settle_action_results_v1` bỏ ba mã đó khỏi `v_committed`. Riêng
  DB chưa đủ: 120/802 không ghi dòng lịch sử, `suppressedResult.operationState` do client tính.
  Tiếp tục chiến dịch không đụng input, "Chạy lại"/làm mới bỏ qua dòng `tạm dừng`
  ([campaignRepository.ts:5945](../src/main/data/repositories/campaignRepository.ts:5945), `:3796`)
  ⇒ cần thêm thao tác "Chạy lại mục tạm dừng". Dọn dữ liệu (cần duyệt): trả `chờ xử lý` các mục
  120/802 đã hết khoá và chưa có lượt gửi/kết bạn OK; 1.108 mục trong chiến dịch `hoàn thành` cần
  quyết định mở lại hay báo khách. VPS + chat-sync phủ 2.766/3.131 mục kẹt.
- **Mục 8 (tạm dừng vì lỗi tạm thời)** — (a) nhánh `explicitOnly`
  ([campaignScheduler.ts:9914](../src/main/services/campaignScheduler.ts:9914)) không áp
  `update_status_campaign` của chính sách có ngưỡng khi chưa tới ngưỡng; (b) ghi kết quả lỗi mạng thì
  thử lại 3 lần (1/3/10 s) trước khi coi là chưa xác định; nếu vẫn hỏng thì khoá riêng mục tiêu đó
  (như nay) nhưng đưa chiến dịch về `chờ xử lý`, không `tạm dừng`; (c) ghi chú nêu lỗi thật thay
  "Có lỗi xảy ra". Dọn: 93 chiến dịch đang dừng — mục tiêu dở đã khoá "không tự gửi lại" nên tiếp
  tục không gửi trùng.
- **Mục 3, 10 (lỗi tạm thời đốt mục tiêu)** — thêm chính sách lỗi tạm thời (không `detail_status` ⇒
  về hàng đợi qua [campaignScheduler.ts:14553](../src/main/services/campaignScheduler.ts:14553), không
  tính hạn mức/lỗi liên tiếp); code xếp vào đó: upload ảnh lỗi mạng (chưa gửi), lỗi gọi DB của mình
  (`Failed to … fetch failed`), `net::ERR_*`, ECONNRESET/ETIMEDOUT/socket hang up ở bước tra
  số/upload; thử lại tại chỗ 2–3 lần cho tra số và upload. `fetch failed` ở bước gửi chữ vẫn là
  "không rõ kết quả". Cần mục 7 trước. Mục 9: áp đổi trạng thái chiến dịch sau khi đã chốt mục
  tiêu đang chạy; mục tiêu mới qua tra số thì trả về hàng đợi.
- **Mục 4 (127)** — sau khi mục 7 lên: `auto_error` id 61 `input_effect='requeue'`,
  `counts_toward_limit=false`. Chưa nhận gì ⇒ quay lại sau khoá 30 phút; album đã tới
  (`partialDelivery` ⇒ `committed`) vẫn không gửi lại. Đổi trước mục 7 thì mục tiêu 127 thành
  `tạm dừng`.
- **Mục 11 (chat-sync bỏ lời mời)** — thống nhất: khoá tạm thời ở bước nhắn tin (127/126/123/120/802)
  ⇒ dừng các bước còn lại của mục tiêu và trả cả mục tiêu về hàng đợi (nhờ 7 + 4), chạy lại trọn khi
  hết khoá. Chat-sync giữ nhánh dừng ở `zaloCampaignExecutor.ts:1191`; desktop thôi gửi lời mời khi tin
  nhắn đang bị khoá (nay gửi lời mời rồi mục tiêu thành `tạm dừng`, tin nhắn không bao giờ đi).
- **Mục 13 (QR rụng đăng nhập)** — [zaloRuntimeService.ts:2860](../src/main/services/zaloRuntimeService.ts:2860):
  lỗi tạm thời không hạ `login_status`, chỉ ghi lỗi + đếm; hạ khi kéo dài (vd ≥3 lần trong ≥30
  phút); poller kiểm lại 15–30 phút/lần các tài khoản `chưa đăng nhập` còn session và lỗi cuối tạm
  thời. "Proxy Authentication Required" là lỗi cấu hình proxy, báo khách.
- **Mục 1, 2 (không nhớ mục tiêu hỏng)** — bảng kết quả cố định theo mục tiêu (khoá SĐT
  `md5(normalize_phone(phone))` như cooldown, hoặc uid nhóm + tài khoản; mã 122/không tồn tại/112/161;
  hạn gợi ý 30/30/7/30 ngày). Ghi bằng trigger sau `auto_campaign_details` (DB, mọi runtime). Đọc:
  bỏ qua trước bước tra số/gửi, không tốn hạn mức, không nghỉ. Mở rộng RPC chống gửi lặp chỉ phủ
  775/1.341 chiến dịch đang bật nó; phủ hết phải sửa app. Cần chốt phạm vi: trong tổ chức (~20% lần
  lặp) hay toàn hệ thống (~100%). Tạm thời: báo org 1835 và tài khoản 4011 bỏ ~56 nhóm luôn 112.
- **Mục 12 + nghỉ sau thất bại** — giãn cách theo mốc tin người lạ gửi OK gần nhất của tài khoản thay
  cho nghỉ cố định; sau mục tiêu hỏng nghỉ ngắn (5–10 s) và giữ tra số <40/giờ; lọc mục tiêu còn
  `chờ xử lý` trước vòng lặp ([campaignScheduler.ts:3851](../src/main/services/campaignScheduler.ts:3851))
  và kiểm hạn mức trước khi nghỉ (`:4750`, `:5883`; chat-sync `zaloCampaignScheduler.ts:965/1126`).
  VPS: poll trạng thái 5 s → 30 s ([campaignScheduler.ts:1529](../src/main/services/campaignScheduler.ts:1529)),
  bớt ~30 request/giây.
- **Mục 5 (nhóm lỗi chung)** — DB: thêm `auto_error` cho 112 và 161 với
  `zalo_action_codes=['zalo_message_group']`, `thất bại`, không tính hạn mức/lỗi liên tiếp;
  `getZaloErrorPolicyByCode` ([errorPolicyRepository.ts:52](../src/main/data/repositories/errorPolicyRepository.ts:52))
  đã khớp theo mã Zalo + mã hành động nên không cần phát hành app. Lỗi không có mã Zalo: theo mục 3.

Thứ tự: (1) ngay — chính sách 112/161, poll 30 s trên VPS, báo khách các nhóm 112 và chiến dịch đang
dừng; (2) đợt 1 — mục 7 (VPS + chat-sync + desktop), rồi mục 4, 3, 8, 11, giãn cách; (3) đợt 2 — bảng
kết quả cố định (sau khi chốt phạm vi), QR; (4) dọn dữ liệu kẹt sau khi duyệt.

Đã kiểm và **không thấy** trên production (code có nhánh nhưng chưa xảy ra/không đáng kể): chat-sync
nhận–nhả lượt chạy mỗi giây (tối đa 44 lượt/chiến dịch/24 h), gửi lại album đã tới (2 lệnh bị cắt/30
ngày, không lệnh nào sau album đã tới), chế độ chia sẻ tự tạm dừng khi runtime gián đoạn (0 ghi chú/30
ngày), một lỗi 221 đốt cả lô 50 (tối đa 4 dòng cùng giây), 122/119 tính hạn mức (live: 0 chính sách),
SMS kiêm gửi thiếu ở chat-sync (0 chiến dịch chat-sync bật), poll lệnh 100 ms (0,06 ms/lượt), nạp lại
toàn bộ input mỗi lượt (~0,012 core), media tải lỗi tạm thời (các lần dừng đều do thiếu file cục bộ).

## Phát hiện phụ

2.352 dòng nhóm `auto_account_contacts` (476 tài khoản, 234 org, từ 23/04 đến nay) có
`name` là chữ thông báo Facebook (`Chưa đọcĐã đăng chéo bài viết của bạn lên …`), làm
log hiện `Đăng bài thất bại vào Chưa đọc…`. Nguồn nghi ở workflow
`[Built-in] Facebook - Quét group đã tham gia` ([contactLoader.ts:71](../src/main/services/contactLoader.ts)); chưa sửa.
