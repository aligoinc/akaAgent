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

Hệ quả: album ≥3 ảnh + chữ khiến chữ thành tin thứ 4+, đúng vùng bị chặn. Giữ tổng ≤3 tin cho
mỗi người lạ (vd 1 ảnh + caption, hoặc ≤2 ảnh + chữ) hoặc đưa chữ lên tin đầu.

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
