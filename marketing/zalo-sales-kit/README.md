# Sales Kit akaAgent Zalo

Bộ tài liệu để nhân viên bán hàng và CSKH gửi khách qua Zalo, Facebook, email hoặc in ra. Năm chủ đề:

1. Giới thiệu sản phẩm akaAgent Zalo
2. Gửi tin & kết bạn tới danh sách số điện thoại
3. Gửi tin & kết bạn tới thành viên nhóm Zalo, kể cả nhóm ẩn thành viên
4. Gửi tin tới bạn bè Zalo
5. Gửi tin vào nhóm Zalo

Kèm **bảng giá akaAgent Zalo Web** (ảnh 4 cỡ + PDF A4 + tin báo giá), nhân viên gửi riêng khi khách hỏi giá.

Mọi định dạng dựng từ một nguồn nội dung duy nhất: [`nguon/noi-dung.cjs`](nguon/noi-dung.cjs) (chữ trên ảnh, PDF, video, landing page) và [`nguon/tin-nhan-mau.cjs`](nguon/tin-nhan-mau.cjs) (tin nhắn mẫu). Sửa chữ ở đó rồi dựng lại, các định dạng tự khớp nhau.

## Trang trực tuyến (Artifact, đang ở chế độ riêng tư)

| Trang | Dùng để | Link |
|---|---|---|
| Sales Kit nội bộ | Nhân viên xem trước, tải ảnh/PDF/video/bảng giá, sao chép tin nhắn mẫu bằng một chạm (trên điện thoại, nút Tải mở bảng chia sẻ để gửi thẳng vào Zalo) | https://claude.ai/artifact/N1s6ZCBPiZb9oF7AqXt4kc |
| Landing page cho khách | Gửi link cho khách đọc trên điện thoại | https://claude.ai/artifact/Jt9u4tyD4vyvwcAzRkXYH8 |
| Slide thuyết trình 16:9 | Trình chiếu khi demo online; 14 trang (trang 13 là bảng giá Zalo Web) có ghi chú thuyết trình; tải PPTX hoặc PDF trong trang slide | https://claude.ai/artifact/FuvhnesrgWoAF9YbPismdk |

Ba trang đang riêng tư: người khác chỉ mở được sau khi chủ tài khoản bật chia sẻ trong menu **Share** của từng trang. Landing page cũng có bản HTML tự chứa ở [`landing/index.html`](landing/index.html) để đưa lên website riêng (ví dụ akabiz.net).

## Có gì trong thư mục

| Định dạng | File | Kích thước | Gửi khi nào |
|---|---|---|---|
| Ảnh vuông | `anh/<chủ đề>/*-vuong-1080x1080.png` | 1:1 | Gửi kèm tin mở đầu, đăng bài Zalo/Facebook |
| Ảnh dọc infographic | `anh/<chủ đề>/*-doc-1080x1350.png` | 4:5 | Khách hỏi "làm thế nào": 4 bước + điểm nổi bật |
| Ảnh story | `anh/<chủ đề>/*-story-1080x1920.png` | 9:16 | Story Zalo/Facebook/TikTok, ảnh dọc gửi chat |
| Banner ngang | `anh/<chủ đề>/*-ngang-1200x628.png` | 1.91:1 | Bài đăng có link, ảnh bìa bài viết, website, quảng cáo |
| Brochure | `pdf/akaAgent-Zalo-brochure-A4.pdf` | A4, 8 trang | Khách doanh nghiệp, gửi email, in khi gặp trực tiếp |
| Tờ giới thiệu | `pdf/to-gioi-thieu-0N-*.pdf` | A4, 1 trang | Gửi file cho đúng chủ đề khách quan tâm, in được |
| Video | `video/0N-*-9x16.mp4` (+ `*-caption.txt`) | 1080×1920, 27 giây | TikTok, Reels, story; khách thích xem video. Thêm nhạc thịnh hành khi đăng |
| Landing page | `landing/index.html` | Web, mobile | Gửi link cho khách còn phân vân |
| Tin nhắn mẫu | [`tin-nhan-mau.md`](tin-nhan-mau.md) | Văn bản | Mở đầu → giải thích → mời dùng thử, kèm câu hỏi thường gặp; mục 6 là tin báo giá |
| Bảng giá Zalo Web (ảnh) | `anh/06-bang-gia/06-bang-gia-{vuong,doc,story,ngang}-*.png` | 1:1, 4:5, 9:16, 1.91:1 | Khách hỏi giá: gửi kèm tin báo giá |
| Bảng giá Zalo Web (PDF) | `pdf/bang-gia-akaAgent-Zalo-Web-A4.pdf` | A4, 1 trang | Khách cần file để in, gửi kế toán; có 3 bước đăng ký |

Gợi ý gửi theo giai đoạn: **khách mới hỏi** → tin mở đầu + ảnh vuông; **khách hỏi cách làm** → tin giải thích + ảnh dọc hoặc tờ PDF; **khách phân vân** → video hoặc link landing page; **chốt** → tin mời dùng thử, xin số điện thoại chưa đăng ký akaBiz; **khách hỏi giá** → ảnh bảng giá + tin báo giá.

## Căn cứ tính năng (đã đối chiếu mã nguồn ngày 08/11/2026)

| Nói với khách | Căn cứ trong repo |
|---|---|
| Nhập số bằng dán, Excel/CSV, link Google Sheet, **chụp ảnh danh sách**, template akaBiz | `src/renderer/src/components/CampaignPanels/CampaignDataUploadModal.tsx:574-577`; đồng bộ Google Sheet: `docs/DATA_GROUP_GOOGLE_SHEET_SYNC.md` |
| Chiến dịch SĐT tra Zalo từng số rồi nhắn tin và/hoặc kết bạn; số chưa có Zalo được đánh dấu, không gửi | `src/shared/campaignActionDescriptors.ts` (Tìm SĐT, Nhắn tin người lạ, Kết bạn); `docs/ZALO_PHONE_CHECK.md` |
| Kiểm tra SĐT có Zalo trước khi chạy | Quét data → Kiểm tra SĐT có Zalo, `docs/ZALO_PHONE_CHECK.md` |
| Chọn nhiều tài khoản, chia đều data | `CampaignFormModal.tsx:16349` (chiến dịch SĐT và đề xuất kết bạn) |
| Gắn thẻ Zalo, đổi tên gợi nhớ sau khi gửi | `CampaignFormModal.tsx:9629`, `:9643` |
| Quét thành viên từ nhóm đã tham gia hoặc link nhóm (tự tham gia), bỏ qua trưởng/phó nhóm | `src/renderer/src/components/DataScan/DataScanModal.tsx:4264-4363`; `src/main/services/zaloRuntimeService.ts:1380-1560` |
| **Nhóm ẩn thành viên**: theo dõi nhóm theo thời gian thực, ghi nhận người vào nhóm / nhắn tin / thả cảm xúc, hôm sau nhắn tin, kết bạn | `CampaignFormModal.tsx:958-962`, `:10141`; `migrations/migration_v132_zalo_realtime_group_campaign.sql` |
| Nhắn thành viên nhóm như người lạ, không cần kết bạn trước | `docs/ZALO_GROUP_MEMBER_UID_V418.md` |
| Bạn bè: chọn tay, tất cả, theo thẻ; chúc sinh nhật tự động; chia sẻ nhanh 50 người/lượt | `CampaignFormModal.tsx:869-873`, `:10594-10619`; `campaignScheduler.ts:8271-8353` |
| Gửi vào nhóm đã tham gia, tham gia nhóm bằng link/QR, nhiều khung giờ/ngày | `migrations/migration_v124_*`, `migration_v133_*`; `CampaignFormModal.tsx:13420-13453` |
| Mẫu câu xoay vòng, gọi tên, xưng anh/chị theo giới tính, file đính kèm, AI viết/viết lại | `src/shared/campaignContentTemplate.ts`; `CampaignFormModal.tsx:5728`, `:5737`, `:9414-9476`, `:13290` |
| Lịch hằng ngày/tuần/tháng, giờ dừng; giới hạn theo giờ, theo ngày; khoảng nghỉ cố định giữa hai lần gửi | `src/shared/types.ts:786`; `CampaignFormModal.tsx:13003-13059`, `:17292` |
| Tự nghỉ khi Zalo báo giới hạn (quy tắc lưu ở DB, akaBiz đổi được không cần phát hành app) | bảng `auto_error`, `docs/ZALO_FRIEND_221_V348.md` |
| Không gửi trùng trong N ngày; chiến dịch SĐT kiểm trên mọi tài khoản của cùng nhân viên | `src/shared/campaignDeliveryCooldown.ts`; `docs/STAFF_DELIVERY_COOLDOWN.md` |
| Link từ chối nhận tin, loại trừ khách | `src/shared/zaloMessageOptOut.ts`; `docs/MESSAGE_OPT_OUT_CUSTOMERS.md`; `docs/CAMPAIGN_SEND_EXCLUSIONS.md` |
| 3 loại tài khoản: mã QR, trình duyệt, chạy trên server (tắt máy vẫn chạy); proxy riêng | `AccountPanel.tsx:1170-1176`; `docs/ZALO_SERVER_VPS.md`; `ProxyManagerModal.tsx` |
| Kết quả từng khách, xuất Excel, báo cáo, email báo cáo, trợ lý chẩn đoán | `CampaignPanel.tsx` (tab Kết quả chạy); `ReportPage.tsx`; `GeneralSettingsModal.tsx:458-509`; `CampaignAssistantMenu.tsx` |
| Theo dõi, tạm dừng chiến dịch trên web | `docs/WEB_DESKTOP_ACCOUNTS_V461.md` |

## Bảng giá akaAgent Zalo Web

| Gói | Giá | Trên ảnh/PDF ghi thêm |
|---|---|---|
| 2 tháng | 700.000đ | 350.000đ/tháng · "Gia hạn linh hoạt" |
| 1 năm | 3.000.000đ | 250.000đ/tháng · tiết kiệm 1.200.000đ · nhãn "Khuyên dùng" |
| 2 năm | 5.000.000đ | ~208.000đ/tháng · tiết kiệm 3.400.000đ |
| 3 năm trở lên | Giảm 25% | "Nhắn tư vấn viên để nhận báo giá" (chưa in số tiền) |

- Giá do quản lý akaBiz chốt ngày 09/11/2026, nhập ở `nguon/noi-dung.cjs` (mục `pricing`). Giá mỗi tháng và số tiền tiết kiệm do `nguon/mau/bang-gia.cjs` tự tính; tiết kiệm = so với gia hạn gói 2 tháng liên tục trong cùng thời gian (ghi rõ dưới bảng giá).
- Dòng chân: "Ngoài ra còn nhiều ưu đãi khác. Liên hệ nhân viên tư vấn để được hỗ trợ chương trình tốt nhất."
- Tính năng đi kèm (5 tài khoản Zalo song song, tắt máy vẫn chạy, dùng được Mac/iPad/điện thoại) lấy theo kịch bản bán hàng bản Web 06/2026; 4 kiểu chiến dịch, tự tạm nghỉ khi Zalo báo giới hạn, hỗ trợ cài đặt 1:1 theo bảng "Căn cứ tính năng" ở dưới.
- Đổi giá: sửa `pricing` rồi chạy `node xay-dung.cjs bang-gia` và `node xuat-tin-nhan.cjs` (tin báo giá lấy giá từ cùng nguồn).

## Không nói với khách

- **Số liệu "đã xem / đã phản hồi"**: tính năng theo dõi tương tác Zalo đang tắt từ 06/10/2026 (`docs/ZALO_CAMPAIGN_ENGAGEMENT.md`), cột này sẽ trống.
- **"Nghỉ ngẫu nhiên"**: khoảng nghỉ giữa hai lần gửi là số giây cố định khách tự đặt.
- **Lấy số điện thoại từ nhóm**: quét nhóm trả về tên, Zalo ID, vai trò; nhắn tin và kết bạn chạy bằng Zalo ID.
- **"Thời gian thực" = gửi ngay**: người được ghi nhận trong nhóm sẽ được nhắn vào hôm sau, đúng giờ đã cài. Tính năng này dùng với tài khoản mã QR hoặc chạy trên server, app/server phải đang chạy.
- **Tag @ cả nhóm**: gửi vào nhóm không có gắn thẻ thành viên.
- **Cam kết 100% gửi thành công**: Zalo có giới hạn riêng (người nhận chặn tin người lạ, giới hạn tra số theo giờ...).
- **Giá**: chỉ có trong bảng giá (`anh/06-bang-gia/`, `pdf/bang-gia-akaAgent-Zalo-Web-A4.pdf`), gửi riêng khi khách hỏi; không in lên ảnh chủ đề, brochure, video, landing page công khai.

## Cần chốt lại với đội kinh doanh

- **Máy Mac**: repo có bản cài macOS (chip Apple và Intel), trong khi kịch bản bán hàng cũ hướng khách Mac sang bản chạy trên server. Tài liệu đang ghi trung tính "chạy trên máy tính hoặc trên server"; câu trả lời cho khách Mac nằm ở `nguon/tin-nhan-mau.cjs` (mục câu hỏi chung).
- **Nhóm ẩn thành viên**: mã nguồn không có xử lý riêng cho chế độ ẩn danh sách thành viên; tài liệu mô tả qua hai cách có thật (quét bằng link nhóm và theo dõi nhóm theo thời gian thực). Trước khi hứa với khách về một nhóm cụ thể, quét thử link nhóm đó trên tài khoản demo.
- **Gói 3 năm trở lên "giảm 25%"**: chưa rõ giảm trên giá nào (ví dụ 3 × giá 1 năm = 9.000.000đ thì còn 6.750.000đ), nên bảng giá chưa in số tiền. Chốt cách tính thì thêm `vnd`/`months` cho gói này để in giá cụ thể.
- **Tính năng bản Web trên bảng giá**: "5 tài khoản Zalo song song, tắt máy vẫn chạy, dùng được Mac/iPad/điện thoại" lấy từ kịch bản bán hàng 06/2026; xác nhận lại nếu gói đã đổi. Kịch bản đó còn ghi bản Web "không có gói vĩnh viễn, không áp ưu đãi giảm (trừ gom 5 user gói năm)"; nay có giảm 25% từ 3 năm, nên cập nhật kịch bản cho khớp.
- **Phiên bản phát hành**: bản Desktop xác nhận trên kênh cập nhật là 9.1.0; các tính năng nêu trong bộ này đều có từ bản đó, trừ báo cáo hiệu quả trên Desktop (không đưa vào tài liệu).

## Dựng lại sau khi sửa nội dung

Cần Node 22 và Chromium của Playwright (có sẵn trong môi trường cloud), `ffmpeg` cho video.

```bash
cd marketing/zalo-sales-kit/nguon
node xay-dung.cjs tat-ca        # ảnh (4 cỡ × 5 chủ đề), brochure + tờ PDF, bảng giá (4 ảnh + PDF), landing page
node xay-dung.cjs bang-gia      # chỉ dựng lại bảng giá
node quay-tat-ca-video.cjs      # 5 video 9:16 + caption (~1 phút/video); thêm số để quay riêng: node quay-tat-ca-video.cjs 3
node xuat-tin-nhan.cjs          # cập nhật tin-nhan-mau.md
```

Bản PDF dùng màu cam đặc thay cho chữ chuyển sắc (`@media print` trong `nguon/mau/a4.cjs`) vì Chromium in `background-clip:text` còn viền mảnh quanh khung chữ. `render.cjs` báo `TRAN` khi chữ tràn khung; sửa câu ngắn lại trong `noi-dung.cjs` rồi dựng lại. Mẫu thiết kế nằm trong `nguon/mau/`, màu và font trong `nguon/assets/base.css`. Font Be Vietnam Pro dùng giấy phép SIL OFL (`nguon/assets/fonts/OFL-LICENSE.txt`). Logo lấy từ `build/icon.png` của app.
