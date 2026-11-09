# Sales Kit akaAgent Zalo

Bộ tài liệu để nhân viên bán hàng và CSKH gửi khách qua Zalo, Facebook, email hoặc in ra. Năm chủ đề:

1. Giới thiệu sản phẩm akaAgent Zalo
2. Gửi tin & kết bạn tới danh sách số điện thoại
3. Gửi tin & kết bạn tới thành viên nhóm Zalo, kể cả nhóm ẩn thành viên
4. Gửi tin tới bạn bè Zalo
5. Gửi tin vào nhóm Zalo

Kèm **28 ảnh từng tính năng** (mỗi tính năng, chiến dịch hoặc thông tin một ảnh dọc 1080×1350 để gửi khách từng ảnh) và **bảng giá 4 sản phẩm**: akaAgent Zalo Web, Zalo Desktop, Facebook Desktop, SMS Mobile (mỗi sản phẩm ảnh 4 cỡ + PDF A4 + tin báo giá, thêm một PDF tổng hợp); bảng giá nhân viên gửi riêng khi khách hỏi giá.

Mọi định dạng dựng từ một nguồn nội dung duy nhất: [`nguon/noi-dung.cjs`](nguon/noi-dung.cjs) (chữ trên ảnh, PDF, video, landing page) và [`nguon/tin-nhan-mau.cjs`](nguon/tin-nhan-mau.cjs) (tin nhắn mẫu). Sửa chữ ở đó rồi dựng lại, các định dạng tự khớp nhau.

## Trang trực tuyến (Artifact, đang ở chế độ riêng tư)

| Trang | Dùng để | Link |
|---|---|---|
| Sales Kit nội bộ | Nhân viên xem trước, tải ảnh/PDF/video/bảng giá, sao chép tin nhắn mẫu bằng một chạm (trên điện thoại, nút Tải mở bảng chia sẻ để gửi thẳng vào Zalo) | https://claude.ai/artifact/N1s6ZCBPiZb9oF7AqXt4kc |
| Landing page cho khách | Gửi link cho khách đọc trên điện thoại | https://claude.ai/artifact/Jt9u4tyD4vyvwcAzRkXYH8 |
| Slide thuyết trình 16:9 | Trình chiếu khi demo online; 15 trang (trang 13–14 là bảng giá Zalo Desktop và Zalo Web) có ghi chú thuyết trình; tải PPTX hoặc PDF trong trang slide | https://claude.ai/artifact/FuvhnesrgWoAF9YbPismdk |
| Ảnh từng tính năng | Xem 28 ảnh tính năng, lọc theo nhóm, mở cỡ lớn (trên điện thoại nhấn giữ ảnh để lưu rồi gửi Zalo) | https://claude.ai/artifact/5TMvQxZ9YVki6gP5NrnLnp |

Bốn trang đang riêng tư: người khác chỉ mở được sau khi chủ tài khoản bật chia sẻ trong menu **Share** của từng trang. Landing page cũng có bản HTML tự chứa ở [`landing/index.html`](landing/index.html) để đưa lên website riêng (ví dụ akabiz.net).

## Có gì trong thư mục

| Định dạng | File | Kích thước | Gửi khi nào |
|---|---|---|---|
| Ảnh vuông | `anh/<chủ đề>/*-vuong-1080x1080.png` | 1:1 | Gửi kèm tin mở đầu, đăng bài Zalo/Facebook |
| Ảnh dọc infographic | `anh/<chủ đề>/*-doc-1080x1350.png` | 4:5 | Khách hỏi "làm thế nào": 4 bước + điểm nổi bật |
| Ảnh story | `anh/<chủ đề>/*-story-1080x1920.png` | 9:16 | Story Zalo/Facebook/TikTok, ảnh dọc gửi chat |
| Banner ngang | `anh/<chủ đề>/*-ngang-1200x628.png` | 1.91:1 | Bài đăng có link, ảnh bìa bài viết, website, quảng cáo |
| Ảnh từng tính năng | `anh/07-tinh-nang/tinh-nang-NN-*-1080x1350.png` (28 ảnh) | 4:5 | Khách hỏi tính năng nào thì gửi đúng ảnh đó: giới thiệu 2, chiến dịch 9, tính năng 11, an toàn & bền 4, hỗ trợ 2. Không ghi giá |
| Brochure | `pdf/akaAgent-Zalo-brochure-A4.pdf` | A4, 8 trang | Khách doanh nghiệp, gửi email, in khi gặp trực tiếp |
| Tờ giới thiệu | `pdf/to-gioi-thieu-0N-*.pdf` | A4, 1 trang | Gửi file cho đúng chủ đề khách quan tâm, in được |
| Video | `video/0N-*-9x16.mp4` (+ `*-caption.txt`) | 1080×1920, 27 giây | TikTok, Reels, story; khách thích xem video. Thêm nhạc thịnh hành khi đăng |
| Landing page | `landing/index.html` | Web, mobile | Gửi link cho khách còn phân vân |
| Tin nhắn mẫu | [`tin-nhan-mau.md`](tin-nhan-mau.md) | Văn bản | Mở đầu → giải thích → mời dùng thử, kèm câu hỏi thường gặp; mục 6 là tin báo giá |
| Bảng giá (ảnh) | `anh/06-bang-gia/bang-gia-<sản phẩm>-{vuong,doc,story,ngang}-*.png` | 1:1, 4:5, 9:16, 1.91:1 | Khách hỏi giá: gửi kèm tin báo giá |
| Bảng giá (PDF) | `pdf/bang-gia-akaAgent-<Sản-Phẩm>-A4.pdf`; tổng hợp `pdf/bang-gia-akaAgent-tong-hop-A4.pdf` | A4, 1 trang; tổng hợp 4 trang | Khách cần file để in, gửi kế toán; có 3 bước đăng ký |

Gợi ý gửi theo giai đoạn: **khách mới hỏi** → tin mở đầu + ảnh vuông; **khách hỏi cách làm** → tin giải thích + ảnh dọc hoặc tờ PDF; **khách hỏi một tính năng cụ thể** → ảnh tính năng tương ứng trong `anh/07-tinh-nang/`; **khách phân vân** → video hoặc link landing page; **chốt** → tin mời dùng thử, xin số điện thoại chưa đăng ký akaBiz; **khách hỏi giá** → ảnh bảng giá + tin báo giá.

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
| Số chưa có Zalo nhận SMS: bật Gửi SMS trong chiến dịch SĐT, gửi từ điện thoại Android, cần gói akaAgent SMS | `src/shared/types.ts:622` (`internalSmsEnabled`); `src/shared/authProductCatalog.ts:26` |
| Kết bạn với người Zalo gợi ý; nhắn lại khách đã từng gửi tin | `src/main/services/campaignScheduler.ts:15268` (`zalo_friend_recommendations`); `src/shared/types.ts:1116` (`zalo_message_remarketing_customer`) |
| AI đặt lịch chạy bằng câu nói thường | `src/shared/campaignScheduleAi.ts` |

## Bảng giá

| Gói | Zalo Web | Zalo Desktop (Windows, Mac) | Facebook Desktop (Windows, Mac) | SMS Mobile (Android) |
|---|---|---|---|---|
| 2 tháng | 700.000đ | 500.000đ | 500.000đ | 500.000đ |
| 1 năm, nhãn "Khuyên dùng" | 3.000.000đ | 2.000.000đ | 2.000.000đ | 2.000.000đ |
| 2 năm | 5.000.000đ | | | |
| 3 năm trở lên | Giảm 15% (chưa in số tiền) | | | |
| 4 năm | | 4.000.000đ | 4.000.000đ | 4.000.000đ |
| Vĩnh viễn | | 10.000.000đ | 10.000.000đ | |

- Giá do quản lý akaBiz chốt ngày 09/11/2026, nhập ở `nguon/noi-dung.cjs` (mục `pricing`, mỗi sản phẩm một mục). Giá mỗi tháng và số tiền tiết kiệm do `nguon/mau/bang-gia.cjs` tự tính; tiết kiệm = so với gia hạn gói 2 tháng liên tục (ghi ngay dưới bảng giá). Thẻ xanh là gói dài nhất của từng sản phẩm.
- Dòng chân mọi bảng giá: "Ngoài ra còn nhiều ưu đãi khác. Liên hệ nhân viên tư vấn để được hỗ trợ chương trình tốt nhất."
- Căn cứ tính năng ghi trên bảng giá:
  - **Zalo Web**: 5 tài khoản Zalo song song, tắt máy vẫn chạy, dùng được Mac/iPad/điện thoại theo kịch bản bán hàng bản Web 06/2026; 4 kiểu chiến dịch, tự tạm nghỉ, hỗ trợ 1:1 theo bảng "Căn cứ tính năng".
  - **Zalo Desktop**: cài Windows và Mac (`package.json`: `build:win`, `build:mac`, `build:mac:intel`), proxy riêng (`ProxyManagerModal.tsx`), AI viết nội dung (`src/shared/campaignContentAi.ts`), còn lại theo bảng "Căn cứ tính năng".
  - **Facebook Desktop**: đăng bài nhóm, trang cá nhân, fanpage; nhắn tin bạn bè, người lạ, khách inbox page; kết bạn, tham gia và mời vào nhóm (`src/shared/campaignActionDescriptors.ts`); fanpage dùng chung quyền Facebook (`src/shared/authProductCatalog.ts`, sản phẩm 3 và 10).
  - **SMS Mobile**: gửi bằng app SMS trên điện thoại Android đăng nhập tài khoản SMS (`AccountPanel.tsx`, mục đổi điện thoại), có dấu hoặc không dấu (`smsUseUnicode`), không gửi trùng theo số ngày, đặt lịch, nhập số từ Excel/Google Sheet (`CampaignFormModal.tsx`); cước SMS do nhà mạng tính (kịch bản bán hàng).
  - Không ghi lên bảng giá: số tài khoản mỗi gói Desktop, comment/seeding Facebook, gọi tự động qua SIM.
- Đổi giá: sửa `pricing` rồi chạy `node xay-dung.cjs bang-gia [mã sản phẩm]` và `node xuat-tin-nhan.cjs` (tin báo giá lấy giá từ cùng nguồn).

## Không nói với khách

- **Số liệu "đã xem / đã phản hồi"**: tính năng theo dõi tương tác Zalo đang tắt từ 06/10/2026 (`docs/ZALO_CAMPAIGN_ENGAGEMENT.md`), cột này sẽ trống.
- **"Nghỉ ngẫu nhiên"**: khoảng nghỉ giữa hai lần gửi là số giây cố định khách tự đặt.
- **Lấy số điện thoại từ nhóm**: quét nhóm trả về tên, Zalo ID, vai trò; nhắn tin và kết bạn chạy bằng Zalo ID.
- **"Thời gian thực" = gửi ngay**: người được ghi nhận trong nhóm sẽ được nhắn vào hôm sau, đúng giờ đã cài. Tính năng này dùng với tài khoản mã QR hoặc chạy trên server, app/server phải đang chạy.
- **Tag @ cả nhóm**: gửi vào nhóm không có gắn thẻ thành viên.
- **Cam kết 100% gửi thành công**: Zalo có giới hạn riêng (người nhận chặn tin người lạ, giới hạn tra số theo giờ...).
- **Giá**: chỉ có trong bảng giá (`anh/06-bang-gia/`, `pdf/bang-gia-*.pdf`), gửi riêng khi khách hỏi; không in lên ảnh chủ đề, brochure, video, landing page công khai.

## Cần chốt lại với đội kinh doanh

- **Máy Mac**: repo có bản cài macOS (chip Apple và Intel), trong khi kịch bản bán hàng cũ hướng khách Mac sang bản chạy trên server. Tài liệu đang ghi trung tính "chạy trên máy tính hoặc trên server"; câu trả lời cho khách Mac nằm ở `nguon/tin-nhan-mau.cjs` (mục câu hỏi chung).
- **Nhóm ẩn thành viên**: mã nguồn không có xử lý riêng cho chế độ ẩn danh sách thành viên; tài liệu mô tả qua hai cách có thật (quét bằng link nhóm và theo dõi nhóm theo thời gian thực). Trước khi hứa với khách về một nhóm cụ thể, quét thử link nhóm đó trên tài khoản demo.
- **Gói 3 năm trở lên "giảm 15%"** (đổi từ 25% ngày 09/11/2026): chưa rõ giảm trên giá nào (ví dụ 3 × giá 1 năm = 9.000.000đ thì còn 7.650.000đ), nên bảng giá chưa in số tiền. Chốt cách tính thì thêm `vnd`/`months` cho gói này để in giá cụ thể.
- **Tính năng bản Web trên bảng giá**: "5 tài khoản Zalo song song, tắt máy vẫn chạy, dùng được Mac/iPad/điện thoại" lấy từ kịch bản bán hàng 06/2026; xác nhận lại nếu gói đã đổi. Kịch bản đó còn ghi bản Web "không có gói vĩnh viễn, không áp ưu đãi giảm (trừ gom 5 user gói năm)"; nay có giảm 15% từ 3 năm, nên cập nhật kịch bản cho khớp.
- **Bảng giá mới khác kịch bản bán hàng 06/2026**: kịch bản ghi Desktop "2 tháng 500k, 1 năm 2tr, vĩnh viễn 4tr" và SMS "1 năm 1tr5, vĩnh viễn 3tr"; bảng giá 09/11 là Desktop 4 năm 4tr, vĩnh viễn 10tr và SMS 1 năm 2tr, 4 năm 4tr. Cập nhật kịch bản cho khớp.
- **Số tài khoản mỗi gói Desktop/SMS**: bảng giá chưa ghi; tin mẫu hướng nhân viên hỏi nhu cầu rồi tư vấn.
- **Phiên bản phát hành**: bản Desktop xác nhận trên kênh cập nhật là 9.1.0; các tính năng nêu trong bộ này đều có từ bản đó, trừ báo cáo hiệu quả trên Desktop (không đưa vào tài liệu).

## Dựng lại sau khi sửa nội dung

Cần Node 22 và Chromium của Playwright (có sẵn trong môi trường cloud), `ffmpeg` cho video.

```bash
cd marketing/zalo-sales-kit/nguon
node xay-dung.cjs tat-ca        # ảnh (4 cỡ × 5 chủ đề), brochure + tờ PDF, bảng giá (4 sản phẩm × 4 ảnh + PDF, PDF tổng hợp), 28 ảnh tính năng, landing page
node xay-dung.cjs tinh-nang     # chỉ dựng lại 28 ảnh từng tính năng 1080×1350 (anh/07-tinh-nang/)
node xay-dung.cjs bang-gia      # chỉ dựng lại bảng giá (4 sản phẩm + PDF tổng hợp)
node xay-dung.cjs bang-gia zalo-web   # chỉ một sản phẩm (zalo-web, zalo-desktop, facebook-desktop, sms-mobile) + PDF tổng hợp
node quay-tat-ca-video.cjs      # 5 video 9:16 + caption (~1 phút/video); thêm số để quay riêng: node quay-tat-ca-video.cjs 3
node xuat-tin-nhan.cjs          # cập nhật tin-nhan-mau.md
```

Bản PDF dùng màu cam đặc thay cho chữ chuyển sắc (`@media print` trong `nguon/mau/a4.cjs`) vì Chromium in `background-clip:text` còn viền mảnh quanh khung chữ. Ảnh từng tính năng lấy chữ từ mục `features` trong `noi-dung.cjs` (mẫu `nguon/mau/tinh-nang.cjs`): tiêu đề ngắt dòng bằng `\n` để không tách đôi từ ghép, mỗi ảnh 3–4 ý, ảnh không có ví dụ tin nhắn dùng chữ lớn hơn; thêm hoặc bớt một mục trong `features` thì số thứ tự tên file tự đổi theo. `render.cjs` báo `TRAN` khi chữ tràn khung; sửa câu ngắn lại trong `noi-dung.cjs` rồi dựng lại. Mẫu thiết kế nằm trong `nguon/mau/`, màu và font trong `nguon/assets/base.css`. Font Be Vietnam Pro dùng giấy phép SIL OFL (`nguon/assets/fonts/OFL-LICENSE.txt`). Logo lấy từ `build/icon.png` của app.
