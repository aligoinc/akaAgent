# Phương án: chặn lưu nội dung sai cú pháp biến / ngoặc (nhiều nội dung bị gộp vào một tin)

Ngày lập: 24/11/2026. Trạng thái: **anh bảo "Thực thi" 24/11; đã code bộ kiểm, chặn ở API Web và ở đường lưu Desktop (mục 13); chưa merge, chưa deploy, chưa build; chưa đổi gì trên production. Giao diện báo lỗi khi gõ chờ duyệt thiết kế; chiến dịch đang lỗi (mục 8) chờ anh chọn cách xử lý.**

Phạm vi (anh chốt lại 24/11): **chỉ kiểm ở giao diện và chặn tương ứng ở API lúc lưu. Không can thiệp vào logic chạy.**
Bản đầu của phương án có thêm phần bộ chạy tạm dừng chiến dịch (mã CFG21, một migration); phần đó đã bỏ.

## 1. Sự cố

Khách 1871.0962737366, chiến dịch 59428 (`zalo_message_group_member`, Zalo Server chạy trên App Server VPS, bộ chạy cũ).
Nội dung có 3 mẫu ngăn bằng `|`, mỗi mẫu kết thúc bằng `#{SEX{anh-chị-anh/chị}` (thiếu một dấu `}`).
Người nhận nhận một tin chứa cả 3 mẫu, kèm nguyên chữ `#{SEX{anh-chị-anh/chị}|`.

Nguyên nhân trong code (đã tái hiện bằng bộ tách thật: nội dung của khách ra 1 mẫu, thêm `}` thì ra 3):

- `findContentVariantSeparatorIndexes` ([src/shared/contentSpin.ts](../src/shared/contentSpin.ts)) gặp dấu `{` không có `}` đóng thì `break`:
  mọi dấu `|` phía sau không còn là dấu ngăn mẫu.
- Biến chỉ được thay khi khớp đúng `#{SEX{...}}` ([src/shared/campaignContentTemplate.ts](../src/shared/campaignContentTemplate.ts)),
  nên biến thiếu ngoặc được gửi nguyên văn.
- Không nơi nào báo cho khách: form Desktop, form Web, app iOS và API lưu đều nhận nội dung này im lặng.

## 2. Số đo trên production (quét chỉ đọc 24/11/2026)

22.972 chiến dịch chưa xoá có nội dung. Chạy bộ tách thật trên 28 chiến dịch có ngoặc `{ }` lệch:

| Loại | Số chiến dịch | Ghi chú |
|---|---|---|
| Nhiều mẫu bị gộp vào một tin | 9 (5 tổ chức: 485, 1744, 1871, 1877, 2189) | 59428, 61004, 48492, 42610, 9031, 9108, 9164, 47257, 9019 |
| trong đó đang chờ / đang chạy | 2 | 59428 (tổ chức 1871), 61004 (tổ chức 2189) |
| Biến hỏng bị gửi nguyên văn, không gộp | 2 | 45029, 45030 (tổ chức 1133, đã hoàn thành) |
| Ngoặc lệch nhưng không ảnh hưởng tin gửi | 17 | dấu `}` thừa, hoặc `{` lẻ trong bài không có `\|` |

Số tin "Nhắn tin" thành công của các chiến dịch bị gộp: 59428: 501, 48492: 916, 42610: 272, 61004: 87, bốn chiến dịch còn lại
26 dòng. Đây là số trên: nội dung có thể được sửa giữa chừng, và 61004 chỉ gộp từ mẫu thứ hai.

Ngoài cột nội dung chính:

- 4 chiến dịch có `#{SEX{...}` thiếu ngoặc trong `extra_settings`: lời mời kết bạn (49656, 15083, 60005, 61004) và nội dung
  nâng cao (61004). Ba cái chưa hoàn thành: 49656, 60005, 61004.
- 1 / 2.373 mẫu nội dung (`auto_content_templates`) có biến thiếu ngoặc.
- 3 chiến dịch email của tổ chức 1454 dùng `#{INPUT_Fullname}` (sai chữ hoa) nên gửi nguyên văn.

Kết luận: lỗi hiếm (khoảng 0,05% chiến dịch) nhưng mỗi lần xảy ra là hàng trăm tin sai tới khách của khách, không gửi lại được.
Phần quét `extra_settings` mới chỉ tìm mẫu `#{SEX{`, chưa chạy bộ tách đầy đủ; đợt 1 sẽ quét lại bằng bộ kiểm mới.

## 3. Nguyên tắc

1. Khách phải thấy lỗi ngay lúc gõ, bằng câu tiếng Việt chỉ đúng chỗ sai và cách sửa.
2. Nội dung sai cú pháp không lưu được: form chặn, API chặn lại lần nữa.
3. Một bộ kiểm duy nhất cho form Desktop, form Web, iOS và API. Không viết luật riêng từng nơi.
4. Không đụng logic chạy: bộ tách `contentSpin`, bộ lập lịch, lõi engine và ChatApi giữ nguyên. Không migration.
5. Có công tắc tắt khẩn cho phần chặn, vì bộ kiểm bắt nhầm là khách không lưu được.

## 4. Bộ kiểm cú pháp dùng chung

Module mới `contentSyntax.ts`, tự đứng một mình (không import gì), viết ở WebApp `packages/campaign-core/src/` (Web, iOS và API
cùng dùng) rồi chép nguyên văn sang Desktop `src/shared/` (bài kiểm so md5 như các hợp đồng dùng chung khác).
Không chép vào lõi `packages/campaign-engine`.

```ts
analyzeContentSyntax(text, { channel, html }) => {
  issues: Array<{ code, severity: 'block' | 'warn', start, end, excerpt, message, fix? }>,
  variantCount: number,        // số mẫu bộ tách thật sẽ gửi
  lostSeparators: number       // số dấu | bị mất tác dụng vì lỗi
}
```

Nội dung có định dạng (HTML) được kiểm trên phần chữ, đúng như `splitFormattedContentVariants` đang làm.

### 4.1. Luật

| Mã | Tình huống | Ví dụ | Mức đề xuất |
|---|---|---|---|
| B1 | Biến `#{` chưa đóng | `#{SEX{anh-chị-anh/chị}`, `#{FULL_NAME` | Chặn |
| B2 | Dấu `{` chưa đóng và phía sau còn dấu `\|` ngăn mẫu | `{anh\|chị ... \| mẫu 2` | Chặn |
| B3 | Biến không có trong hệ thống, hoặc sai dạng, trên kênh có biến (Zalo, SMS, Email, Gọi tự động) | `#{INPUT_Fullname}`, `#{TODAY}`, `#{SEX{anh\|chị}}` | Chặn (cần anh chốt, mục 10) |
| W1 | Dấu `{` chưa đóng nhưng không làm mất dấu `\|` nào | bài Facebook có một dấu `{` lẻ | Cảnh báo |
| W2 | Dấu `}` thừa | `...nhé}` | Cảnh báo |
| W3 | Facebook: `#{a\|b}` (hashtag dính liền ngoặc xoay vòng nên không xoay) | `#{sale\|giảm giá}` | Cảnh báo |

Danh sách biến hợp lệ lấy từ code đang chạy: `TODAY(...)`, `TOMORROW(...)`, `YESTERDAY(...)`, `SEX{a-b-c}`, `FULL_NAME`,
`ORIGINAL_NAME`, `INPUT_FULLNAME`, `UID`, `PHONE`, `MOBILE`, `EMAIL`, `INFO1`–`INFO5`, `STOP_MESSAGES_LINK`.
Ký tự thoát giữ như hiện nay: `\{`, `\}`, `\|`, `\\`.

"Chặn" nghĩa là không lưu được, ở form lẫn API. "Cảnh báo" nghĩa là hiện câu nhắc, vẫn lưu được.

### 4.2. Sửa giúp

Chỉ với lỗi có đúng một cách sửa:

- `#{SEX{a-b-c}` ngay trước `|`, xuống dòng hoặc hết nội dung: thêm `}`.
- `#{TÊN_BIẾN_HỢP_LỆ` thiếu `}`: thêm `}`.
- Biến sai chữ hoa / thường của một biến hợp lệ: đổi về đúng tên.

Nút "Sửa giúp" chỉ sửa khi khách bấm. Không tự sửa lúc lưu.

### 4.3. Câu cho khách (bản nháp, chờ anh duyệt từng câu)

| Mã | Câu |
|---|---|
| B1 | Biến `#{SEX{anh-chị-anh/chị}` đang thiếu dấu `}` ở cuối. Viết đúng là `#{SEX{anh-chị-anh/chị}}`. |
| B2 | Dấu `{` ở "…" chưa có dấu `}` đóng. Nếu muốn gửi đúng ký tự `{`, hãy viết `\{`. |
| kèm B1 / B2 khi `lostSeparators > 0` | Vì lỗi này, N mẫu nội dung phía sau sẽ bị gộp chung vào một tin. |
| B3 | `#{INPUT_Fullname}` không phải biến của hệ thống nên sẽ bị gửi nguyên văn. Có thể anh/chị muốn dùng `#{INPUT_FULLNAME}`. |
| W1 | Dấu `{` ở "…" chưa có dấu `}` đóng. |
| W2 | Dấu `}` ở "…" không có dấu `{` mở. |
| Dòng đếm | Nội dung này có N mẫu, gửi luân phiên. |
| Khi bấm Lưu mà còn lỗi | Nội dung còn lỗi cú pháp nên chưa lưu được. Vui lòng sửa các chỗ được đánh dấu. |

## 5. Giao diện

Áp cho mọi ô nhập nội dung có `|` hoặc biến: nội dung chính, từng mục nội dung nâng cao, lời mời kết bạn, nội dung comment,
comment newsfeed, nội dung up tin, SMS gửi kèm, tiêu đề email, mẫu nội dung, bước gửi của Quy trình tự động.

Hành vi chung trên cả ba nền tảng:

1. **Báo lỗi ngay dưới ô nhập**, cập nhật khi gõ (bộ kiểm chạy trên chuỗi, không gọi mạng). Mỗi lỗi một dòng: câu ở 4.3, đoạn
   trích chỗ sai, nút "Sửa giúp" nếu có, bấm vào dòng thì con trỏ nhảy tới chỗ sai.
2. **Dòng đếm mẫu** luôn hiện khi nội dung có dấu `|`: "Nội dung này có 3 mẫu, gửi luân phiên." Khi có lỗi làm mất dấu `|`:
   "Có 3 dấu `|` nhưng chỉ tách được 1 mẫu." Đây là thứ giúp khách tự nhận ra kể cả với lỗi bộ kiểm chưa biết.
3. **Không cho lưu khi còn lỗi mức Chặn**: nút Lưu báo lỗi và cuộn tới ô sai. Mức Cảnh báo không chặn.
4. **Xem trước** ("Xem trước", "Khách sẽ nhận") hiện dải cảnh báo ở đầu khi nội dung còn lỗi.
5. **Mở sửa chiến dịch cũ đang có lỗi**: lỗi hiện ngay khi mở form, không đợi khách gõ.
6. **Nội dung do AI viết** (Viết lại, form AI, Agent): bản AI trả về mà có lỗi mức Chặn thì không áp vào form, báo "AI trả nội
   dung sai cú pháp, vui lòng thử lại".

Chỗ sửa:

| Nền tảng | File chính |
|---|---|
| Web | `apps/web/src/features/CampaignContentForm.tsx` (đã có tô màu theo `contentSegments`: thêm màu đỏ cho đoạn lỗi), `CampaignFormPage.tsx`, `CampaignQuickEditModals.tsx`, `CampaignRuntimeOptions.tsx`, `recipientPreview/RecipientPreviewPanel.tsx`, form mẫu nội dung, `journeys/formControls.tsx`; luật form ở `packages/campaign-core/src/validation.ts` |
| iOS | `apps/mobile/src/features/campaign/Content.tsx`, `TokenInput.tsx`, `review.ts`, `ContentSheets.tsx`, `features/TemplateForm.tsx` |
| Desktop | `CampaignFormModal.tsx` và `CampaignAgentFormModal.tsx` (kiểm lúc lưu quanh các câu "Vui lòng nhập nội dung…"), `CampaignQuickEditModals.tsx`, `ContentPreviewModal.tsx`, `CampaignContentPreviewTab.tsx`, `ContentTemplates/ContentTemplateWorkspace.tsx` |

Trước khi code giao diện em sẽ gửi bản thiết kế (trang xem thử) để anh duyệt, như các tính năng trước.

## 6. Chặn ở API lúc lưu

Form chỉ che được bản app mới và người dùng đi qua form. API chặn lại bằng đúng bộ kiểm đó:

- **API Web** (`apps/api/src/modules/aka-agent-control/aka-agent-control.service.ts`, cạnh `validateStopMessagesSettings`): tạo
  chiến dịch, sửa chiến dịch, sửa nhanh, nhân bản, Agent tạo chiến dịch, mẫu nội dung, bước gửi của Quy trình tự động.
  Còn lỗi mức Chặn thì trả 400, mã `campaign_content_syntax_invalid`, kèm câu ở 4.3 và tên ô sai để form đánh dấu đúng chỗ.
  Che được Web, iOS mọi phiên bản và tab Web chưa tải lại.
- **Chỉ kiểm ô nội dung có trong yêu cầu lưu.** Sửa nhanh lịch chạy, giới hạn, tạm dừng / tiếp tục của một chiến dịch cũ đang
  có nội dung lỗi vẫn làm được; lưu cả form thì phải sửa nội dung trước.
- **Desktop** không lưu qua API Web mà ghi DB từ tiến trình chính. Chỗ tương ứng là đường lưu của tiến trình chính
  (`campaignRepository.createCampaign` / `updateCampaign`, lưu mẫu nội dung): kiểm trước khi ghi, trả đúng mã và câu như API Web.
  Đây vẫn là bước lưu, không phải logic chạy.

Công tắc: một khoá `auto_system_settings` ba mức `block` / `warn` (chỉ nhắc, vẫn lưu) / `off`. Thiếu dòng = `block`.
API Web đọc mỗi lần lưu, form Web lấy mức này từ API, Desktop đọc chung câu đọc cài đặt lúc đăng nhập. Không cần migration.

## 7. Phần không làm: logic chạy

Theo anh chốt, bộ chạy không đổi gì. Hệ quả cần biết:

1. **Chiến dịch đã lưu với nội dung lỗi vẫn gửi như hiện nay** cho tới khi khách mở ra sửa. Phần này chỉ xử lý được bằng mục 8.
2. **Bản Desktop cũ vẫn lưu được nội dung lỗi**, vì nó ghi thẳng DB, không qua API Web và chưa có bước kiểm. Hết khi khách
   cập nhật app.
3. **Chiến dịch do hệ thống tự tạo trong lúc chạy** (chiến dịch up tin, chiến dịch SMS gửi kèm) chép nội dung từ chiến dịch
   nguồn, không qua form hay API. Nguồn đã được chặn lúc lưu thì bản chép cũng sạch; nguồn cũ còn lỗi thì bản chép lỗi theo.

Lưới đỡ cho ba trường hợp này là script quét ở mục 8, chạy lại sau mỗi đợt phát hành.

## 8. Chiến dịch đang lỗi

Đang chờ / đang chạy với nội dung lỗi: 59428 (1871), 61004 (2189), 49656 (560), 60005 (2116, đang tạm dừng).
Mỗi lượt chạy tiếp là thêm tin sai, và vì không đụng bộ chạy nên chỉ có cách xử lý tay. Ba cách, anh chọn ở mục 10:

1. Tạm dừng 59428, 61004, 49656 kèm ghi chú chỉ chỗ sai, rồi CSKH báo khách sửa.
2. Sửa hộ nội dung (chỉ thêm đúng dấu `}` thiếu), ghi biên nhận trước / sau.
3. Không đụng DB, chỉ gửi danh sách cho CSKH liên hệ.

Kèm theo: script quét chỉ đọc `scripts/content-syntax/scan-prod.cjs` (xuất nội dung ra tệp, chạy bộ kiểm thật, in danh sách
chiến dịch + mẫu nội dung lỗi theo tổ chức, kèm trạng thái và số tin đã gửi).

## 9. Kiểm thử

- **Trên dữ liệu thật**: chạy bộ kiểm trên toàn bộ ~23.000 nội dung chiến dịch, 2.373 mẫu nội dung và các ô trong `extra_settings`
  (xuất chỉ đọc ra tệp). Yêu cầu trước khi bật chặn: mọi lỗi mức Chặn đều được xem tay và đúng là lỗi; kỳ vọng dưới 30 dòng.
- **Bất biến với bộ tách**: nội dung không có lỗi mức Chặn thì số mẫu của `splitContentVariants` phải bằng số mẫu tính kiểu
  "bỏ qua ngoặc lỗi" (kiểm trên dữ liệu thật và trên chuỗi sinh ngẫu nhiên). Bộ kiểm lệch bộ tách là bài kiểm đỏ.
- **Ca cố định**: 9 nội dung bị gộp và 2 nội dung biến hỏng ở mục 2 (đã ẩn danh) phải ra đúng mã lỗi và đúng số mẫu bị mất;
  các ca thoát ký tự `\{ \} \|`; nội dung HTML; biến lồng trong ngoặc xoay vòng `{a #{FULL_NAME}|b}`.
- **Giao diện**: bài kiểm form thật trên Electron (Desktop) và Playwright (Web): gõ nội dung của khách → thấy câu lỗi, dòng đếm,
  không lưu được; bấm "Sửa giúp" → lưu được, 3 mẫu.
- **API**: gọi thẳng API (bỏ qua form) với nội dung lỗi → 400 đúng mã, không ghi gì; nội dung đúng và nội dung chỉ có cảnh báo →
  lưu như cũ; sửa nhanh ô khác của chiến dịch cũ đang lỗi → vẫn lưu được; công tắc `warn` / `off` → lưu được.
- md5 hai bản `contentSyntax.ts` (WebApp, Desktop) trùng nhau.
- Bộ chạy không đổi nên không thêm bài kiểm bộ chạy; chạy lại hai typecheck và bộ kiểm lõi để xác nhận không lệch.

## 10. Việc cần anh quyết

1. **B3 (biến lạ / sai dạng)**: chặn (em đề xuất, vì cũng làm lộ chữ `#{...}` tới người nhận) hay chỉ cảnh báo?
2. **Chiến dịch đang lỗi (mục 8)**: cách 1, 2 hay 3? Em đề xuất cách 1 cho 59428, 61004, 49656.
3. **Câu cho khách (4.3)**: anh duyệt hoặc sửa từng câu.
4. **Desktop**: em hiểu "chặn tương ứng với API" ở Desktop là kiểm ở đường lưu của tiến trình chính (mục 6). Nếu anh chỉ muốn
   kiểm ở form Desktop thì em bỏ bước này.

## 11. Thứ tự làm sau khi duyệt

| Đợt | Nội dung | Kết quả |
|---|---|---|
| 0 | Xử lý chiến dịch đang lỗi theo quyết định 2 | Ngừng gửi thêm tin sai |
| 1 | `contentSyntax.ts` + bài kiểm + quét dữ liệu thật | Danh sách lỗi đầy đủ, số bắt nhầm |
| 2 | Thiết kế giao diện, anh duyệt | Chốt cách hiển thị và câu chữ |
| 3 | Web + API Web, deploy | Khách Web / iOS bị chặn lúc lưu |
| 4 | Form Desktop + đường lưu Desktop; iOS | Đủ ba nền tảng (theo bản phát hành) |
| 5 | Quét lại production sau mỗi lần phát hành | Xác nhận không còn chiến dịch lỗi đang chạy |

Gỡ: công tắc về `off` (có hiệu lực không cần phát hành). Không có migration, không đổi dữ liệu.

## 12. Ngoài phạm vi

- Logic chạy: bộ tách `contentSpin`, bộ lập lịch Desktop / App Server, lõi engine v2, ChatApi (anh chốt 24/11).
- Gửi lại / đính chính các tin đã gửi sai.
- Gộp các bản chép `contentSpin` về một nguồn (việc riêng).

## 13. Tình trạng thực thi (24/11/2026)

Anh bảo "Thực thi". Các quyết định ở mục 10 anh chưa trả lời riêng nên em làm theo đề xuất: biến lạ = chặn, Desktop kiểm ở
đường lưu của tiến trình chính, câu cho khách dùng bản nháp (chờ anh duyệt), thêm cảnh báo email dùng biến hồ sơ Zalo.

### Đã làm (trên nhánh `claude/ecstatic-carson-0q5vlw` của hai repo, chưa merge)

| Phần | Ở đâu | Kiểm |
|---|---|---|
| Bộ kiểm `contentSyntax.ts` | WebApp `packages/campaign-core/src/`, chép nguyên văn sang `src/shared/` | 18 ca, có 6.000 chuỗi ngẫu nhiên so với bộ tách thật |
| Luật lưu của form Web | WebApp `validation.ts` (`validateCampaignForm`) | `submission.test.ts` |
| Chặn ở API Web | WebApp `apps/api/.../contentSyntaxGuard.ts`: tạo / sửa chiến dịch, tạo / sửa mẫu nội dung; 400 `campaign_content_syntax_invalid` | 5 ca + 5 ca công tắc |
| Chặn ở đường lưu Desktop | [contentSyntaxGuard.ts](../src/main/services/contentSyntaxGuard.ts), gọi ở IPC `DB_CREATE_CAMPAIGN` / `DB_UPDATE_CAMPAIGN` và lưu mẫu nội dung | `node scripts/content-syntax/desktop-smoke.cjs` (9 nhóm) |
| Kiểm trước khi lưu ở form Desktop | `CampaignFormModal.tsx`, `CampaignAgentFormModal.tsx` (trước mọi bước tạo dữ liệu kèm) | hai typecheck |
| Công tắc | khoá `campaign.content_syntax_guard` (`block` / `warn` / `off`, thiếu dòng = `block`); API Web đọc khi có nội dung lỗi, Web nhận qua cài đặt lúc vào trang, Desktop đọc chung câu đọc cài đặt lúc đăng nhập | có trong các bài trên |
| Script quét | `scripts/content-syntax/scan-export.sql` (chỉ đọc) + `scan-prod.cjs` | đã chạy trên dữ liệu thật |

Bộ chặn nằm ở lớp IPC / API, không nằm trong `campaignRepository`: bộ lập lịch, App Server và chiến dịch do hệ thống tự tạo
gọi thẳng repository nên không đi qua. Bài kiểm Desktop khẳng định `campaignScheduler.ts` và `packages/campaign-engine`
không gọi bộ kiểm, và hai bản `contentSpin.ts` vẫn trùng nhau.

Sửa chiến dịch: API và đường lưu Desktop chỉ kiểm ô nội dung lần lưu này thật sự đổi so với bản đang lưu. Chiến dịch cũ đang
lỗi vẫn sửa được lịch, giới hạn, trạng thái; form thì kiểm nội dung đang hiện mỗi lần bấm Lưu.

### Chạy bộ kiểm trên dữ liệu thật (chỉ đọc, 24/11)

22.362 ô nội dung có biến / ngoặc (nội dung chính, nội dung nâng cao, lời mời kết bạn, tên gợi nhớ, các ô SMS / comment, mẫu
nội dung). Mọi dòng bị chặn đã xem tay, đều là lỗi thật:

| Loại | Ở đâu | Số |
|---|---|---|
| Biến thiếu ngoặc đóng | 9 chiến dịch bị gộp mẫu ở mục 2, cộng lời mời kết bạn / nội dung nâng cao | 18 ô |
| Biến lạ hoặc sai dạng, bị gửi nguyên văn | `#{INPUT_Fullname}` (1454), `#{INPUT FULLNAME}` (1836), `#{FULLNAME}` (1), `#{INPUT_NAME}` (713), `#{NAME}` (1293), `#{SEX{…} }` (2219, 2116, một mẫu nội dung) | 18 ô |

Hai điều dữ liệu thật buộc phải đổi so với bản nháp:

- **Ô "Tên gợi nhớ" chỉ nhắc, không chặn.** 45 chiến dịch (chủ yếu tổ chức 704) cố ý viết nhãn kiểu `#{DIỆU}`, `#{F2 BITRIX}`
  trong tên gợi nhớ. Đây là nhãn nội bộ của khách, chặn là làm hỏng cách họ đang dùng.
- **Thêm "Sửa giúp" cho các kiểu gõ sai gặp thật**: sai chữ hoa / thường, thiếu gạch dưới (`#{FULLNAME}`), khoảng trắng thay
  gạch dưới (`#{INPUT FULLNAME}`), khoảng trắng thừa (`#{SEX{…} }`). Chỉ sửa khi có đúng một biến khớp; `#{NAME}`,
  `#{INPUT_NAME}` không đoán.

Chiến dịch đang chờ chạy có lỗi mức chặn (danh sách đầy đủ hơn mục 8): 59428 (1871), 61004 (2189), 49656 (560),
58672 (2219, `#{SEX{…} }` bị gửi nguyên văn), 41331 (1293, `#{NAME}` trong lời mời kết bạn). Đang tạm dừng: 60005, 32998, 9019.

### Chưa làm

1. **Đợt 0, chiến dịch đang lỗi**: chưa đụng production, chờ anh chọn cách ở mục 8.
2. **Giao diện báo lỗi ngay khi gõ** (danh sách lỗi dưới ô nhập, dòng đếm mẫu, nút "Sửa giúp", dải cảnh báo ở Xem trước) trên
   Web, iOS, Desktop: chờ anh duyệt thiết kế. Hiện tại Web báo ở ô lỗi sẵn có khi bấm Lưu, Desktop hiện hộp báo lỗi khi bấm
   Lưu, iOS nhận câu lỗi từ API.
3. Bước gửi của Quy trình tự động, sửa nhanh nội dung trên Desktop (đã được đường lưu chặn, chưa có kiểm trước ở cửa sổ sửa nhanh).
4. Chưa chạy trong Electron thật và chưa chạy bài kiểm giao diện (Playwright / Electron) cho phần này.
5. Câu cho khách chờ anh duyệt.

### Thứ tự đưa lên

Deploy API / Web trước (chặn được Web, iOS mọi phiên bản), rồi phát hành Desktop. Không migration. Muốn chỉ nhắc mà chưa
chặn trong những ngày đầu: thêm dòng `campaign.content_syntax_guard` = `warn` trước khi deploy.
