# "Khách sẽ nhận": xem trước trên điện thoại khách (Desktop)

Ngày 09/11/2026 · **Trạng thái: code xong trên nhánh `claude/sharp-brahmagupta-gafh0j` (nối từ `claude/optimistic-clarke-031fhs`), CHƯA merge `dev_3`, CHƯA phát hành Desktop.** Không migration, không đổi DB/RPC, không thêm IPC, không đổi nháp hay dữ liệu chiến dịch. Đây là bản Desktop của tính năng Web akaAgentWebApp #174; phương án gốc và số liệu production: akaAgentWebApp `docs/CAMPAIGN_RECIPIENT_PREVIEW_PLAN.md`, bản Web: akaAgentWebApp `docs/CAMPAIGN_RECIPIENT_PREVIEW.md`.

Người dùng thấy ngay trên form chiến dịch khách sẽ nhận gì trên điện thoại: tin nhắn Zalo cá nhân/group, lời mời kết bạn, SMS, cuộc gọi tự động. Xem được mọi phiên bản nội dung và media, kể cả file chỉ có trên máy này.

## 1. Hợp đồng

- **Chỉ đọc state form.** Không request mạng/DB, không polling, không gọi AI, không gửi thử. Ảnh trên máy đọc qua IPC có sẵn `readCampaignPreviewFileDataUrl` (chỉ ảnh, tối đa 8 MB) với bộ đệm 24 đường dẫn trong renderer. Tab Preview nội dung giữ đúng lượt đọc cũ: một `listCampaignInputDataPage(limit 3)` khi mở tab.
- **Không đi vào nháp/payload.** State của khung (mở/đóng, phiên bản đang xem, Xem như, hạt giống) không qua `useCampaignDraftField`. Smoke giao diện so payload nháp khi khung bật và tắt: giống hệt. Lựa chọn bật/tắt của form thường nhớ ở `localStorage` `aka.campaignForm.preview.v1` (`'0'`/`'1'`, bọc try/catch, chỉ ghi khi cửa sổ từ 1.280 px).
- **Không chặn Lưu.** "Cần kiểm tra" chỉ cảnh báo; lỗi chặn vẫn là validate cũ của form.
- **Gõ phím không vẽ lại form.** Form không vẽ lại khi gõ nội dung (`docs/CAMPAIGN_CONTENT_TYPING.md`), nên khung tự đăng ký `contentStore` và một store vị trí con trỏ riêng (`createRecipientCaretStore`); gõ phím chỉ vẽ lại khung.
- **Một bộ luật.** Mọi luật nằm ở `src/shared/recipientPreview.ts`, chép từ akaAgentWebApp `packages/campaign-core/src/recipientPreview.ts`. Sửa luật ở WebApp trước rồi chép lại. Khác bản Web đúng ba điểm: API spin dạng options của Desktop; media nhận `CampaignMediaInput` (chuỗi hoặc snapshot, file trên máy xem được nên có `localPath` và không có cảnh báo `desktop_local_media`); tài khoản Zalo trình duyệt xét cả đuôi file trên máy.

Luật theo runtime (thứ tự tin nhắn rồi lời mời, tách ảnh/chữ theo `zaloSendSequence`, media ngẫu nhiên, điền biến bằng `renderCampaignTemplateText`, gửi chia sẻ không điền biến, SMS theo dòng của `renderSmsInputContent`, lời mời cắt 150 ký tự sau khi điền, link từ chối nhận tin, Zalo trình duyệt chỉ gửi ảnh) giống bản Web, xem mục 1 của tài liệu Web.

## 2. Giao diện

| Nơi | Cách mở |
| --- | --- |
| Form thêm/sửa/nhân bản/nháp (`CampaignFormModal`) | Nút **Xem trước** trên đầu form. Cửa sổ từ 1.280 px: cột phải `clamp(320px, 26vw, 390px)`, mở sẵn trừ khi đã tắt, form rộng 96vw/1.600 px. Hẹp hơn: lớp nổi bên phải. Dưới 760 px: toàn màn có **← Về form**. Nút Xem trước cạnh ô nội dung và ô lời mời của Zalo nhắn tin/SMS/gọi thoại mở khung ở phiên bản con trỏ đang đứng; Facebook/Email giữ modal cũ |
| Form Agent (`CampaignAgentFormModal`) | Mặc định đóng, không nhớ lựa chọn; khung nổi trên vùng chat. Agent hoặc người dùng đổi thứ khách nhận khi khung đóng thì nút có chấm báo |
| Sửa nhanh nội dung (`CampaignQuickEditModals`) | Nút **Xem trước** ở đầu hộp: ngăn kéo bên phải (cửa sổ từ 1.280 px thì hộp dịch trái chừa chỗ). Đọc state đang sửa; bật Nhắn tin/Kết bạn lấy theo cấu hình đã lưu như runtime. Không có "Xem như" dòng data; nút Sửa chỉ đóng ngăn kéo |
| Modal Nội dung nâng cao | Ô xem trước bên phải của Zalo nhắn tin/SMS dùng `RecipientItemPreview` (cùng luật, theo nút "Đổi mẫu ngẫu nhiên" và "Điền dữ liệu khách mẫu" của modal). Facebook giữ thẻ cũ |
| Chi tiết chiến dịch, tab Preview nội dung | Zalo nhắn tin, SMS, gọi thoại: lưới thẻ mọi phiên bản (cả lời mời và cuộc gọi tự động, vốn không có mẫu nội dung nên trước đây không có tab); Xem như Khách mẫu / Giữ nguyên biến / 3 dòng data đầu. Số trên tab đếm mọi phiên bản khách có thể nhận. Facebook/Email giữ thẻ cũ |
| Mẫu nội dung Zalo/SMS (bộ chọn mẫu của hai form, trang Mẫu nội dung) | Cùng bộ vẽ `RecipientPhone`; chú thích "Dữ liệu thay thế khi gửi" lấy từ `CONTENT_TEMPLATE_SAMPLE_VALUES` để khớp khách mẫu |

Trong khung: dải bước ① Tin nhắn → ② Lời mời; **Xem như** (Khách mẫu có Nữ/Nam/Không rõ, Giữ nguyên biến, tới 50 dòng data đầu của form); **Gửi từ** khi chọn nhiều tài khoản; điều hướng phiên bản; **Xem tất cả** (lưới thẻ, lọc Có cảnh báo/Có media); Theo con trỏ (chỉ ô nội dung thường); Đổi cách trộn, Xem các cách viết (tới 200); Đổi media; **Cần kiểm tra** với nút Sửa về đúng phần và đúng phiên bản (ô thường chọn đúng đoạn, mục Nâng cao mở modal ở đúng mục, lời mời đặt con trỏ vào ô lời nhắn); **Khi chạy thật**. Đang Lưu hoặc AI form đang chạy: khung vẫn xem được, nút Sửa tạm tắt. Esc trong khung (trừ cột cố định ở cửa sổ rộng) chỉ đóng khung, không đi tiếp tới form.

## 3. Mã nguồn

| File | Vai trò |
| --- | --- |
| `src/shared/recipientPreview.ts` | Mô hình: phiên bản, tách ảnh/chữ, điền biến (nhãn biến chờ runtime/trống/lạ), spin theo hạt giống, lời mời 150, SMS, cuộc gọi, cảnh báo, ghi chú, con trỏ ↔ phiên bản |
| `src/shared/smsRecipientContent.ts` | Nội dung SMS theo dòng như `renderSmsInputContent`, thêm tham số `rng` |
| `src/shared/contentSpin.ts` | Thêm `seededRandom`, `countContentSpinOptions`, `listContentSpinOptions` (runtime vẫn dùng `Math.random`) |
| `src/shared/voiceCall.ts` | Hằng số và kiểm độ dài cuộc gọi (thông báo AI + nội dung) |
| `src/renderer/src/components/CampaignPanels/recipientPreview/*` | `RecipientPreviewPanel` (bố cục dock/overlay/drawer, `RecipientPreviewLive`, `RecipientPreviewToggle`), `RecipientPhone` (các màn điện thoại), `RecipientBubbles` (bong bóng, ảnh trên máy qua IPC), `RecipientVersionBrowser` (lưới thẻ dùng chung), `RecipientPreviewGallery`, `RecipientItemPreview`, `recipientPreviewModel.ts` (state form/chiến dịch → mô hình), CSS |
| `CampaignFormModal.tsx`, `CampaignAgentFormModal.tsx` | Nút đầu form, khung, lớp bọc `.campaign-form-body` (luôn có để bật/tắt khung không dựng lại form), Sửa và theo con trỏ |
| `CampaignQuickEditModals.tsx` | Nút và ngăn kéo của Sửa nhanh |
| `CampaignContentPreviewTab.tsx`, `CampaignPanel.tsx` | Tab Preview nội dung, hiện tab và đếm phiên bản cho Zalo nhắn tin/SMS/gọi thoại |
| `ContentTemplatePreview.tsx`, `ContentTemplateWorkspace.tsx` | Xem trước mẫu Zalo/SMS và chú thích khách mẫu |

## 4. Kiểm chứng (09/11/2026, máy cloud của phiên làm việc)

| Bước | Kết quả |
| --- | --- |
| `node scripts/recipient-preview-smoke.cjs` | 40/40: so từng byte với `renderSmsInputContent` và `renderCampaignTemplateText` của Desktop; đối chứng âm (sai hạt giống thì lệch 7/12) |
| `xvfb-run -a -s "-screen 0 1920x1200x24" node scripts/run-recipient-preview-ui-smoke.cjs` | Đạt 2/2 lần liên tiếp. Electron thật với IPC giả, chặn mọi http/https. 16 bước: nháp giống hệt khi khung bật/tắt; nhớ lựa chọn; thứ tự màn và media (ảnh trên máy, file thiếu); gõ và theo con trỏ; cảnh báo biến lạ và nút Sửa; Xem như dòng data; lời mời; Xem tất cả và Esc; SMS; Facebook không có khung; form Agent; Nội dung nâng cao và ô trong modal; tab Preview nội dung (một lượt đọc 3 dòng); tab của chiến dịch gọi tự động; Sửa nhanh; mẫu nội dung |
| `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json` | 0 lỗi |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run build` | Đạt |

Ảnh chụp đặt bằng `RECIPIENT_PREVIEW_ARTIFACTS_DIR` (mặc định thư mục tạm, xoá khi xong). Cửa sổ Electron phải hiện (trong container là màn hình ảo xvfb) và chụp bằng `page.screenshot` (CDP): cửa sổ ẩn thì `page.screenshot` treo, còn `webContents.capturePage` trả khung hình cũ không khớp DOM. Chưa chạy trên Windows/macOS thật, chưa đóng gói.

## 5. Chưa làm / giới hạn

- **SMS kèm theo** của chiến dịch Zalo: chưa đưa vào khung (như bản Web).
- "Xem như" không tải khách từ nhóm data hay khách lấy khi chạy: các nguồn đó dùng khách mẫu.
- Sửa nhanh: không có "Xem như" dòng data; nút Sửa chỉ đóng ngăn kéo.
- Theo con trỏ chỉ có ở ô nội dung thường (không nâng cao, không định dạng).
- Luật 150 ký tự của form vẫn đếm cả chuỗi lời mời (mọi biến thể `|`, trước khi điền biến), trong khi runtime cắt từng biến thể sau khi điền: hai biến thể 100 ký tự bị chặn oan, còn một biến thể 138 ký tự có `#{FULL_NAME}` qua kiểm tra rồi có thể bị cắt đuôi. Khung chỉ cảnh báo chiều sau; sửa luật là việc riêng, làm cùng Web (phương án Web mục 10.1).

## 6. Phát hành và rollback

Chỉ đổi renderer và `src/shared`; không DB, không main process. Rollback: phát hành lại bản trước; khóa `localStorage` thừa không ảnh hưởng.
