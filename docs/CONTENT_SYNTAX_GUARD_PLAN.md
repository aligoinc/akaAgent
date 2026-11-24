# Phương án: chặn nội dung sai cú pháp biến / ngoặc (nhiều nội dung bị gộp vào một tin)

Ngày lập: 24/11/2026. Trạng thái: **chờ anh duyệt, chưa code, chưa đổi gì trên production.**

## 1. Sự cố

Khách 1871.0962737366, chiến dịch 59428 (`zalo_message_group_member`, Zalo Server chạy trên App Server VPS, bộ chạy cũ).
Nội dung có 3 mẫu ngăn bằng `|`, mỗi mẫu kết thúc bằng `#{SEX{anh-chị-anh/chị}` (thiếu một dấu `}`).
Người nhận nhận một tin chứa cả 3 mẫu, kèm nguyên chữ `#{SEX{anh-chị-anh/chị}|`.

Nguyên nhân trong code (đã tái hiện bằng bộ tách thật: nội dung của khách ra 1 mẫu, thêm `}` thì ra 3):

- `findContentVariantSeparatorIndexes` ([src/shared/contentSpin.ts](../src/shared/contentSpin.ts)) gặp dấu `{` không có `}` đóng thì `break`:
  mọi dấu `|` phía sau không còn là dấu ngăn mẫu.
- Biến chỉ được thay khi khớp đúng `#{SEX{...}}` ([src/shared/campaignContentTemplate.ts](../src/shared/campaignContentTemplate.ts)),
  nên biến thiếu ngoặc được gửi nguyên văn.
- Không nơi nào báo cho khách: form Desktop, form Web, app iOS, API lưu và cả ba bộ chạy đều nhận nội dung này im lặng.

Cùng một bộ tách đang có ở 5 nơi: Desktop `src/shared`, lõi `packages/campaign-engine/src/content` (giống Desktop từng byte),
WebApp `packages/campaign-core`, WebApp `apps/api/src/shared`, và bản chép lõi ở ChatApi. Cả 5 đều xử lý như nhau.

## 2. Số đo trên production (quét chỉ đọc 24/11/2026)

22.972 chiến dịch chưa xoá có nội dung. Chạy bộ tách thật trên 28 chiến dịch có ngoặc `{ }` lệch:

| Loại | Số chiến dịch | Ghi chú |
|---|---|---|
| Nhiều mẫu bị gộp vào một tin | 9 (5 tổ chức: 485, 1744, 1871, 1877, 2189) | 59428, 61004, 48492, 42610, 9031, 9108, 9164, 47257, 9019 |
| trong đó đang chờ / đang chạy | 2 | 59428 (tổ chức 1871, VPS bộ cũ), 61004 (tổ chức 2189, Fly engine v2) |
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
Phần quét `extra_settings` mới chỉ tìm mẫu `#{SEX{`, chưa chạy bộ tách đầy đủ; bước 1 của đợt 1 sẽ quét lại bằng bộ kiểm mới.

## 3. Nguyên tắc

1. Nội dung sai cú pháp không được gửi đi. Không tự đoán ý khách lúc chạy.
2. Khách phải thấy lỗi ngay lúc gõ, bằng câu tiếng Việt chỉ đúng chỗ sai và cách sửa.
3. Một bộ kiểm duy nhất cho form Desktop, form Web, iOS, API lưu và bộ chạy. Không viết luật riêng từng nơi.
4. Không đổi cách tách của nội dung đúng cú pháp. Bộ tách `contentSpin` giữ nguyên.
5. Có công tắc tắt khẩn cho phần chặn, vì bộ kiểm sai là khách không lưu / không chạy được.

## 4. Bộ kiểm cú pháp dùng chung

Module mới `contentSyntax.ts`, tự đứng một mình (không import gì), viết ở WebApp `packages/campaign-core/src/` rồi chép nguyên văn
sang Desktop `src/shared/` và lõi `packages/campaign-engine/src/content/` (bài kiểm so md5 như các hợp đồng dùng chung khác;
ChatApi nhận qua `scripts/sync-campaign-engine.cjs`).

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

"Chặn" nghĩa là: không lưu được, và bộ chạy không gửi. "Cảnh báo" nghĩa là: hiện câu nhắc, vẫn lưu và chạy được.

### 4.2. Sửa giúp

Chỉ với lỗi có đúng một cách sửa:

- `#{SEX{a-b-c}` ngay trước `|`, xuống dòng hoặc hết nội dung: thêm `}`.
- `#{TÊN_BIẾN_HỢP_LỆ` thiếu `}`: thêm `}`.
- Biến sai chữ hoa / thường của một biến hợp lệ: đổi về đúng tên.

Nút "Sửa giúp" chỉ sửa khi khách bấm. Không tự sửa lúc lưu hay lúc chạy.

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
| Ghi chú khi bộ chạy dừng | Nội dung chiến dịch có lỗi nên chưa gửi: <câu lỗi đầu tiên> Vui lòng sửa nội dung rồi bấm Tiếp tục. |

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

## 6. Chặn lúc lưu (phía máy chủ)

Giao diện chỉ che được bản app mới. Phía máy chủ chặn thêm:

- **API Web** (`aka-agent-control.service.ts`, cạnh `validateStopMessagesSettings`): tạo / sửa chiến dịch, sửa nhanh, mẫu nội dung,
  Quy trình tự động. Lỗi mức Chặn trả 400 mã `campaign_content_syntax_invalid` kèm câu ở 4.3. Che Web, iOS mọi phiên bản và
  tab Web chưa tải lại.
- **Desktop tiến trình chính** (`campaignRepository.createCampaign` / `updateCampaign`, lưu mẫu nội dung): kiểm trước khi ghi DB.

Không đề xuất trigger DB từ chối ghi ở đợt này: các đường ghi tự động (tạo chiến dịch SMS con, chiến dịch up tin, chiến dịch của
Quy trình, nhân bản) sẽ lỗi giữa lượt chạy khi nội dung nguồn vốn đã sai, và bảng `auto_campaigns` là bảng nóng. Hệ quả: bản
Desktop cũ vẫn lưu được nội dung sai cho tới khi khách cập nhật; phần này do bộ chạy (mục 7) và script quét (mục 8) đỡ.

## 7. Logic chạy

Hiện chưa bộ chạy nào kiểm (đã đọc `dev_3` mới nhất; từ 22/11 không nhánh nào sửa `contentSpin` hay phần chuẩn bị nội dung).

Hành vi đề xuất: **đầu lượt chạy, nội dung còn lỗi mức Chặn thì không gửi gì, tạm dừng chiến dịch kèm ghi chú chỉ chỗ sai.**
Data giữ nguyên trong hàng đợi, không tính lượt, không cộng chuỗi lỗi. Khách sửa nội dung rồi bấm Tiếp tục là chạy tiếp.
Khi chiến dịch bị tạm dừng, trung tâm thông báo sẵn có sẽ báo cho khách (chuông, Trợ lý aka, email nếu bật).

| Bộ chạy | Cách làm | Cần phát hành |
|---|---|---|
| Engine v2 (Desktop + Fly) | Thêm luật vào `packages/campaign-engine/src/validation.ts`, gọi trong `validateZaloMessagePhone`, `shareAwareValidate`, phiên Facebook / Website (`session.issues`). Dùng đúng đường "kiểm cấu hình đầu lượt" đang có cho CFG10–CFG20: báo một lần, DB quyết định tạm dừng. Mã mới `err_cfg_content_syntax`, mã công khai **CFG21** | Migration (dưới) → chép lõi sang ChatApi, deploy `worker` → bản Desktop mới |
| Bộ cũ Desktop / App Server | Thêm kiểm cạnh `getAdvancedContentConfigError` trong `campaignScheduler.ts` (5 chỗ gọi: 1274, 2134, 4595, 6009, 7513) và đường SMS (`smsContent.ts`) | Build + cài App Server VPS; bản Desktop mới |
| Bộ cũ ChatApi (`zaloCampaignExecutor.ts`) | Cùng luật, cho vài cấu hình hiếm còn rơi về bộ cũ trên Fly | Cùng lần deploy `worker` |

Migration (chỉ dữ liệu, theo mẫu CFG16 của V501): một dòng `auto_error` (`err_cfg_content_syntax`, CFG21, lớp `content_config`),
một dòng `auto_outcome_policies` (không tính lượt, không cộng chuỗi, data về hàng đợi, tạm dừng chiến dịch). Phải apply trước khi
lõi mới chạy, nếu không tín hiệu mới rơi về lỗi chung. Số migration lấy theo sổ production ngay trước lúc apply.

Hai điểm cần biết:

- Bộ chạy chỉ dừng với lỗi mức Chặn. 17 chiến dịch "ngoặc lệch nhưng vô hại" ở mục 2 không bị dừng.
- Công tắc tắt khẩn: một khoá `auto_system_settings` cho ba mức `off` / `warn` (giao diện chỉ nhắc, bộ chạy không dừng) / `block`.
  Thiếu dòng = `block` sau khi phát hành. Cách bộ chạy đọc khoá này em chốt lúc code (ưu tiên đường đọc thiết lập sẵn có, không
  thêm request).

## 8. Chiến dịch đang lỗi (việc trước khi có code)

Đang chờ / đang chạy với nội dung lỗi: 59428 (1871), 61004 (2189), 49656 (560), 60005 (2116, đang tạm dừng).
Mỗi lượt chạy tiếp là thêm tin sai. Ba cách, anh chọn ở mục 10:

1. Tạm dừng 59428, 61004, 49656 kèm ghi chú chỉ chỗ sai, rồi CSKH báo khách sửa.
2. Sửa hộ nội dung (chỉ thêm đúng dấu `}` thiếu), ghi biên nhận trước / sau.
3. Không đụng DB, chỉ gửi danh sách cho CSKH liên hệ.

Kèm theo: script quét chỉ đọc `scripts/content-syntax/scan-prod.cjs` (xuất nội dung ra tệp, chạy bộ kiểm thật, in danh sách
chiến dịch + mẫu nội dung lỗi theo tổ chức). Chạy lại sau mỗi đợt phát hành cho tới khi các bản app cũ hết.

## 9. Kiểm thử

- **Trên dữ liệu thật**: chạy bộ kiểm trên toàn bộ ~23.000 nội dung chiến dịch, 2.373 mẫu nội dung và các ô trong `extra_settings`
  (xuất chỉ đọc ra tệp). Yêu cầu trước khi bật chặn: mọi lỗi mức Chặn đều được xem tay và đúng là lỗi; kỳ vọng dưới 30 dòng.
- **Bất biến với bộ tách**: nội dung không có lỗi mức Chặn thì số mẫu của `splitContentVariants` phải bằng số mẫu tính kiểu
  "bỏ qua ngoặc lỗi" (kiểm trên dữ liệu thật và trên chuỗi sinh ngẫu nhiên). Bộ kiểm lệch bộ tách là bài kiểm đỏ.
- **Ca cố định**: 9 nội dung bị gộp và 2 nội dung biến hỏng ở mục 2 (đã ẩn danh) phải ra đúng mã lỗi và đúng số mẫu bị mất;
  các ca thoát ký tự `\{ \} \|`; nội dung HTML; biến lồng trong ngoặc xoay vòng `{a #{FULL_NAME}|b}`.
- **Giao diện**: bài kiểm form thật trên Electron (Desktop) và Playwright (Web): gõ nội dung của khách → thấy câu lỗi, dòng đếm,
  không lưu được; bấm "Sửa giúp" → lưu được, 3 mẫu.
- **Bộ chạy**: ca mới trong smoke lõi và bộ kịch bản engine: nội dung lỗi → 0 lệnh gửi, chiến dịch tạm dừng, ghi chú đúng câu,
  data còn trong hàng đợi; sửa nội dung → chạy tiếp. Bộ cũ: ca tương tự trên bộ lập lịch nạp ngoài Electron.
- md5 ba bản `contentSyntax.ts` (WebApp, Desktop, lõi) trùng nhau.

## 10. Việc cần anh quyết

1. **Bộ chạy gặp nội dung lỗi**: tạm dừng, không gửi (em đề xuất), hay vẫn gửi và chỉ tách lại cho đúng?
2. **B3 (biến lạ / sai dạng)**: chặn (em đề xuất, vì cũng làm lộ chữ `#{...}` tới người nhận) hay chỉ cảnh báo?
3. **Chiến dịch đang lỗi (mục 8)**: cách 1, 2 hay 3? Em đề xuất cách 1 cho 59428, 61004, 49656.
4. **Câu cho khách (4.3)**: anh duyệt hoặc sửa từng câu.
5. **Thứ tự phát hành**: em đề xuất Web + API trước (khách bị lỗi đang dùng Web, deploy nhanh nhất), rồi migration CFG21 →
   `worker` Fly → App Server VPS → Desktop → iOS.

## 11. Thứ tự làm sau khi duyệt

| Đợt | Nội dung | Kết quả |
|---|---|---|
| 0 | Xử lý chiến dịch đang lỗi theo quyết định 3 | Ngừng gửi thêm tin sai |
| 1 | `contentSyntax.ts` + bài kiểm + quét dữ liệu thật | Danh sách lỗi đầy đủ, số dương tính giả |
| 2 | Thiết kế giao diện, anh duyệt; Web + API | Khách Web / iOS bị chặn lúc lưu |
| 3 | Migration CFG21; lõi engine; bộ cũ; ChatApi | Bộ chạy không gửi nội dung lỗi |
| 4 | Form Desktop; iOS | Đủ ba nền tảng |
| 5 | Quét lại production sau mỗi lần phát hành | Xác nhận không còn chiến dịch lỗi đang chạy |

Gỡ: công tắc về `off` (có hiệu lực không cần phát hành); migration CFG21 có bản gỡ; code giao diện và bộ chạy không đổi dữ liệu.

## 12. Ngoài phạm vi

- Không đổi bộ tách `contentSpin` (nội dung đúng cú pháp chạy y như cũ).
- Không gửi lại / đính chính các tin đã gửi sai.
- Không gộp 5 bản chép `contentSpin` về một nguồn (việc riêng).
