# Phương án: link từ chối nhận tin cho SMS, email và Facebook

Viết 24/11/2026, chưa duyệt, chưa code. Tình trạng hiện tại và lý do ba kênh này chưa chạy được ở mục 1. Các câu anh cần chốt ở mục 5.

## 1. Hiện tại

Tính năng ra đời 03/09/2026 (PR #370) và từ đó chỉ làm cho 7 loại chiến dịch nhắn tin Zalo cá nhân. Không lớp nào nhận SMS, email hay Facebook:

| Lớp | Chỉ Zalo ở đâu |
| --- | --- |
| DB | Bảng `auto_zalo_message_opt_outs` dùng `zalo_global_id` làm khoá (bắt buộc có). `aka_agent_prepare_zalo_message_opt_out` và `aka_agent_check_zalo_message_opt_out` đòi tài khoản Zalo và 7 loại chiến dịch Zalo. Cột `email` để dành, chưa dùng. |
| Lúc gửi | Chỉ đường gửi Zalo thay biến và thêm dòng cuối (`renderZaloTemplate` kèm `optOut`, lõi `zalo/messagePhone.ts`). SMS dựng nội dung lúc thêm data (`renderSmsInputContent`), email gọi `renderZaloTemplate` không kèm link, Facebook (`prepareFacebookCampaignContent`) chỉ thay tên và ngày. |
| Chặn người đã từ chối | Chỉ chiến dịch nhắn tin Zalo kiểm. Người từ chối qua link Zalo vẫn nhận SMS, email, Facebook. |
| Form | Nút chèn biến và ô "Thêm link từ chối nhận tin nhắn" (`zaloOptOutLinkEnabled`) chỉ hiện ở chiến dịch nhắn tin Zalo (Desktop, Web, iOS, mẫu nội dung). Bộ kiểm nội dung chặn biến ở các kênh khác. |
| Trang từ chối | `b.akabiz.biz/s/<mã>` ghi "Từ chối nhận tin nhắn Zalo". Xác nhận chỉ ghi giờ vào dòng theo mã, không phụ thuộc kênh. |

Số liệu production (chỉ đọc, 24/11):
- Đã phát 42.071 link; 48 người xác nhận từ chối; 32.001 dòng có SĐT.
- Chưa chiến dịch SMS, email hay Facebook nào có biến này.
- Chiến dịch tạo trong 30 ngày:

| Loại | Chiến dịch | Tổ chức |
| --- | --- | --- |
| Nhắn tin Zalo theo SĐT (để so) | 9.038 | 735 |
| Facebook inbox Page `facebook_page_to_message` | 137 | — |
| Facebook UID `facebook_message_uid` | 107 | 21 |
| SMS `sms_send` | 61 | 17 |
| Email `email_send` | 18 | 7 |
| Facebook bạn bè `facebook_message_friend` | 10 | 5 |

## 2. Cách làm chung

Mỗi kênh chạy đúng như Zalo đang chạy:
1. Bật ô "Thêm link từ chối nhận tin nhắn" hoặc chèn biến `#{STOP_MESSAGES_LINK}`.
2. Lúc gửi, mỗi người nhận có một link riêng, cố định theo nhân viên.
3. Người nhận mở trang và bấm xác nhận.
4. Các lần gửi sau bỏ qua người đó: data "tạm dừng", ghi chú "Bỏ qua vì người nhận đã từ chối nhận tin nhắn <kênh>".

Khi bật ô mà nội dung không có biến, app tự thêm dòng cuối.

### 2.1. Database (một migration, chỉ thêm, không sửa dữ liệu cũ)

Dùng chung bảng `auto_zalo_message_opt_outs`, không đổi tên vì Desktop và ChatApi đang gọi bốn hàm cũ. Dùng chung bảng thì giữ được một trang từ chối, một danh sách "Khách hàng từ chối nhận tin" và 42.071 link đã phát.

- Thêm cột `channel text NOT NULL DEFAULT 'zalo'` (`zalo` / `sms` / `email` / `facebook`) và `facebook_key text`.
- Bỏ `NOT NULL` của `zalo_global_id`. Thêm CHECK theo kênh:
  - Zalo cần `zalo_global_id`;
  - SMS cần `phone`;
  - email cần `email`;
  - Facebook cần `facebook_key`.
- Khoá duy nhất riêng cho từng kênh (index một phần), cùng `staff_id`, `organization_id`:
  - SMS theo SĐT chuẩn hoá;
  - email theo `lower(btrim(email))`;
  - Facebook theo `facebook_key`.
  Khoá Zalo cũ giữ nguyên.
- Khoá Facebook:
  - inbox Page: `page:<id Page>:<id khách>` (id khách chỉ có nghĩa trong một Page);
  - UID và bạn bè: `uid:<UID số>`, chuẩn hoá các kiểu link (`profile.php?id=`, link có UID) như khoá so sánh V614.
- Hàm mới `aka_agent_prepare_message_opt_out(p_campaign_id, p_account_id, p_staff_id, p_channel, p_identity jsonb)`:
  - kiểm quyền như hàm Zalo (`private.aka_agent_assert_request_ownership`, đúng loại chiến dịch của kênh);
  - trả `id`, `is_opted_out`.
- Hàm mới `aka_agent_check_message_opt_out(...)` cùng cách kiểm.
- Bốn hàm Zalo cũ giữ nguyên. Riêng `aka_agent_check_zalo_message_opt_out` có lọc theo kênh hay không là câu hỏi 1, vì hàm này đang so theo SĐT. Không lọc thì người từ chối SMS sẽ bị chặn cả Zalo cùng số.
- `aka_agent_inspect_zalo_message_opt_out` trả thêm `channel` để trang từ chối ghi đúng kênh.
- Công tắc `auto_system_settings` `message_opt_out.channels`: `{"sms":false,"email":false,"facebook":false}`. Thiếu dòng hoặc `false` thì chạy như hôm nay.

### 2.2. SMS: sửa ở DB, dịch vụ gửi SMS không đổi

Nội dung SMS được dựng sẵn lúc thêm data, qua 5 đường: Desktop thêm data, Desktop Tự động hoá, API Web, kiêm SMS nội bộ của engine (V506), Nhóm data. Kết quả lưu ở `auto_campaign_input_data.content`.

Dịch vụ gửi SMS là một tiến trình Node riêng, không có trong các repo này (supabase-js 2.110.0, 2 IP). Nó đọc nội dung qua `aka_agent_list_sms_due_input_data`, gửi nguyên văn, rồi báo kết quả bằng `aka_agent_record_sms_message_status`.

Vì vậy đề xuất làm ở **một chỗ duy nhất là hàm `aka_agent_list_sms_due_input_data`**, giữ nguyên tham số và cột trả về. Khi công tắc SMS bật và chiến dịch bật ô:
- Người nhận đã từ chối:
  - đổi data sang "tạm dừng" kèm ghi chú;
  - ghi một dòng lịch sử "Bỏ qua" (như Zalo);
  - không trả dòng đó cho dịch vụ gửi.
- Người nhận chưa từ chối:
  - tạo hoặc lấy link theo SĐT;
  - thay biến trong `content`;
  - nếu không có biến thì thêm dòng cuối, có dấu hoặc không dấu theo `smsUseUnicode` của chiến dịch.

Hàm phải chuyển từ SQL chỉ đọc sang plpgsql có ghi, nên là DDL: apply buổi tối. Không cần build Desktop hay deploy dịch vụ gửi SMS.

Không làm ở 5 đường thêm data, vì nội dung lưu sẵn sẽ mang link từ trước khi biết người đó có từ chối hay không, và phải sửa 5 chỗ.

Độ dài SMS:
- Link dài 45 ký tự (`https://b.akabiz.biz/s/` + 22 ký tự).
- Dòng "Tu choi nhan tin: <link>" dài khoảng 63 ký tự, tức khoảng 40% một tin 160 ký tự không dấu. Nhiều khả năng tin bị tách thành 2 tin, tốn gấp đôi phí.
- Bộ đếm ký tự trên form phải cộng phần này vào.

### 2.3. Email (Desktop)

Trong `emailSendMessage` ([campaignScheduler.ts](../src/main/services/campaignScheduler.ts)):
- Kiểm và tạo link theo email trước khi gửi. Người nhận đã từ chối thì bỏ qua như SMS.
- Thay biến **sau** bước AI viết lại (`rewriteEmailPlainTextBodyForRun`). AI làm mất biến thì vẫn thêm dòng cuối.
- Thêm dòng cuối thư. Thư HTML dùng thẻ link.
- Không cho bộ đếm lượt bấm bọc link từ chối. Hiện `enableClickTracking` bọc mọi link, nên bấm từ chối sẽ bị tính là "đã bấm link". Thêm link `b.akabiz.biz/s/` vào danh sách bỏ qua ở `emailRuntimeService.ts`.
- Đề xuất thêm header `List-Unsubscribe` và `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (chuẩn RFC 8058): Gmail và Yahoo hiện nút "Hủy đăng ký" ngay cạnh tên người gửi, giúp thư ít vào thư rác. Việc này cần thêm một đường POST một chạm ở API Web (ghi xác nhận ngay, không qua trang). Xem câu hỏi 4.

### 2.4. Facebook (Desktop, cả bộ cũ lẫn engine v2)

Cả 3 loại nhắn tin đều dựng nội dung qua `prepareFacebookCampaignContent`: workflow 3, 208, 227 đều có `campaignContentPreparationVersion: 1`, và engine Facebook gọi cùng host. Nên chỉ sửa một chỗ:
- Kiểm và tạo link theo khoá Facebook ở mục 2.1.
- Thay biến sau AI viết lại, thêm dòng cuối.
- Người nhận đã từ chối thì bỏ qua trước khi mở trang Messenger.
- Chỉ áp cho 3 loại nhắn tin riêng: inbox Page, UID, bạn bè. Comment, đăng bài, lời mời kết bạn vẫn chặn biến.

Rủi ro chưa đo được: Messenger có thể hạn chế tin có link lạ từ tài khoản cá nhân (tăng checkpoint hoặc chặn gửi). Phải thử thật trên vài tài khoản trước khi bật rộng.

### 2.5. Form, bộ kiểm nội dung, trang từ chối, danh sách

- **Form Desktop, Web, iOS:** hiện nút chèn biến và ô bật link cho SMS, email và 3 loại nhắn Facebook, chỉ khi công tắc kênh bật. Dùng lại khoá `zaloOptOutLinkEnabled` (tên cũ nhưng không phải chuyển dữ liệu). Bộ đếm ký tự SMS cộng độ dài link.
- **Bộ kiểm `contentSyntax.ts`:** cho phép biến ở nội dung chính của các loại trên khi kênh bật. Lời mời kết bạn, tên gợi nhớ, comment, đăng bài vẫn chặn. Sửa ở WebApp `packages/campaign-core` rồi chép sang Desktop.
- **Trang từ chối:** tiêu đề và câu ghi đúng kênh, ví dụ "Từ chối nhận email", "… tin nhắn SMS".
- **Danh sách "Khách hàng từ chối nhận tin":** thêm cột Kênh; hiện SĐT, email hoặc UID tuỳ kênh.

## 3. Thứ tự đưa lên

1. Migration DB, công tắc để tắt. Gồm cả quyết định của câu 1 cho hàm kiểm Zalo.
2. SMS: sửa `aka_agent_list_sms_due_input_data`; deploy form Web; bật `sms` cho 1–2 tổ chức thử; gửi thử thật kiểm nhà mạng có lọc tin chứa link không.
3. Trang từ chối và API Web: câu theo kênh, đường POST một chạm.
4. Desktop: email, Facebook, form, danh sách. Phát hành Desktop.
5. Bật `email`, rồi `facebook` theo từng đợt sau khi thử thật.

Tắt khẩn: đặt kênh về `false`. Form ẩn lại nút; chiến dịch đã lưu có biến thì lúc gửi biến được thay bằng rỗng (như Zalo khi tắt ô), không gửi nguyên văn.

## 4. Kiểm thử

- Migration trên PG17 với thân hàm production:
  - link cũ của Zalo vẫn mở và xác nhận được;
  - khoá duy nhất từng kênh;
  - gỡ migration.
- Hàm SMS:
  - nhiều lượt đọc cùng dòng ra cùng một link;
  - người đã từ chối không được trả về;
  - nội dung có dấu và không dấu;
  - nội dung không có biến.
- Desktop: smoke email và Facebook với runtime giả. AI làm mất biến thì vẫn có dòng cuối. Link từ chối không bị bọc đếm lượt bấm.
- Bộ thử nội dung `fuzz-loop.cjs` thêm kênh mới, chạy tới 3 vòng sạch.

## 5. Cần anh chốt

1. **Từ chối ở một kênh thì chặn kênh nào?**
   - (a) Chỉ kênh đó. Đề xuất, vì trang xác nhận nói đúng kênh đó và không âm thầm giảm lượt gửi Zalo của khách. Cần thêm lọc `channel = 'zalo'` vào hàm kiểm Zalo.
   - (b) Mọi kênh cùng SĐT hoặc email. Trang phải ghi "không nhận thêm tin nhắn từ đơn vị này".
2. **SMS khi bật ô mà không chèn biến:** tự thêm "Tu choi nhan tin: <link>" như Zalo, hay chỉ có link khi khách tự chèn biến (vì tốn thêm 1 tin)?
3. **Facebook:** làm cả 3 loại (inbox Page, UID, bạn bè), hay chỉ inbox Page trước (khách đã nhắn Page, ít rủi ro bị chặn link nhất)?
4. **Email:** thêm nút "Hủy đăng ký" một chạm của Gmail/Yahoo (header `List-Unsubscribe`)? Đề xuất có.

Phạm vi giữ theo từng nhân viên như Zalo: từ chối nhân viên A thì nhân viên B cùng tổ chức vẫn gửi được.
