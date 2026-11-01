# Điều tra khiếu nại 01/11/2026: Zalo "chỉ có ảnh", đăng nhóm Facebook "chập chờn"

Chỉ là điều tra: đọc production **akachat — `cgjbsmqtfhqvttudyjzq`** và code, không
sửa DB/code/element. Mọi số liệu là truy vấn chỉ đọc ngày 01/11/2026 (giờ VN).
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

**Hướng xử lý:** sửa XPath `auto_elements` id 13 (và 14) — DB-only, mọi client nhận ở
lượt chạy sau. **Selector mới chưa xác minh**: phải đo DOM trên tài khoản Facebook
thật (Test block), capture row live trước khi sửa theo AGENTS.md; không đoán selector.

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

## Phát hiện phụ

2.352 dòng nhóm `auto_account_contacts` (476 tài khoản, 234 org, từ 23/04 đến nay) có
`name` là chữ thông báo Facebook (`Chưa đọcĐã đăng chéo bài viết của bạn lên …`), làm
log hiện `Đăng bài thất bại vào Chưa đọc…`. Nguồn nghi ở workflow
`[Built-in] Facebook - Quét group đã tham gia` ([contactLoader.ts:71](../src/main/services/contactLoader.ts)); chưa sửa.
