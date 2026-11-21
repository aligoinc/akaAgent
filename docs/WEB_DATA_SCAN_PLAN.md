# Quét data từ batdongsan, Trang Vàng, Nhà Tốt: phương án (bản nháp, chờ anh duyệt)

Viết 21/11/2026. Chưa code, chưa đổi gì trên DB. Số liệu trang web xem bằng trình duyệt ngày 21/11/2026, chỉ đọc (bấm "Hiện số" đúng 1 lần mỗi trang để biết cách trang ẩn SĐT).

## 0. Anh đã chốt (21/11/2026)

- Làm thành **ba loại chiến dịch "Tìm data" trong akaAgent** (không làm trong akaMap).
- **Chỉ tổ chức 1 thấy** loại chiến dịch này lúc đầu.
- nhatot: khách chọn Cá nhân / Môi giới / Cả hai, **mặc định Môi giới**.
- batdongsan: DOM không có số (mục 1.1); anh chọn **đăng nhập tài khoản batdongsan rồi bấm "Hiện số"**.
- Trang Vàng: **chỉ lấy số di động** (bỏ số bàn), mỗi số một data.
- **Làm cả ba cùng lúc**, ra cùng một bản Desktop.
- Thử ngưỡng "Hiện SĐT" của nhatot ngay (mục 1.2).

## 1. Ba trang hôm nay

| | batdongsan.com.vn | yellowpages.vn (Trang Vàng) | nhatot.com (Chợ Tốt Nhà) |
|---|---|---|---|
| Đọc bằng HTTP thường (không phải trình duyệt) | Bị chặn: Cloudflare trả 403, kể cả từ IP Việt Nam | Được (200, đủ dữ liệu) | Bị chặn: Cloudflare trả 403 |
| Quy mô | 117.930 tin bán; 20 tin/trang, link trang `/nha-dat-ban/p2` | Hơn 250.000 doanh nghiệp, 3.400 ngành; ~20 doanh nghiệp/trang, `?page=N`; có link lọc theo tỉnh | 20 tin/trang, `?page=N`; mỗi lần tìm tối đa 10.000 tin (500 trang) |
| SĐT ở trang danh sách | Che 3 số cuối. Bấm "Hiện số" thì trang bắt đăng nhập tài khoản batdongsan (SĐT + mã) | Hiện đủ: SĐT, email, website, địa chỉ | Không có SĐT, phải mở từng tin |
| SĐT ở trang chi tiết | Che 3 số cuối, cũng bắt đăng nhập | Thêm mã số thuế, ngành nghề, loại hình | Che 4 số cuối. "Hiện SĐT" hiện ngay, không cần đăng nhập (thử 1 lần; chưa biết bấm nhiều có bị chặn không) |
| Tên người đăng | Có trên thẻ tin | Tên doanh nghiệp | Có (`account_name`), có cờ cá nhân / môi giới (`company_ad`) |
| Nguồn SĐT công khai khác | Danh bạ môi giới `/nha-moi-gioi`: tên công ty / cá nhân môi giới, địa chỉ, SĐT hiện sẵn; 54 trang (khoảng 1.000) | | |
| Bộ lọc có sẵn trên link | Loại nhà đất, giá, diện tích, khu vực | Ngành, tỉnh | Loại, khu vực, giá; "Cá nhân / Môi giới" (`f=p` / `f=c`) |
| robots.txt | Cho phép mọi trang, chặn `/microservice-architecture-router/` (API nội bộ) | Cho phép, `Crawl-delay: 5` (5 giây mỗi request) | Cho phép trang, chặn link có tham số lọc (`f=`, `price=`, `q=`…) |

Mẫu 20 tin nhatot TP.HCM: 16 tin môi giới, 4 tin cá nhân.

Hệ quả kỹ thuật: batdongsan và nhatot phải chạy trong trình duyệt thật (Electron), không chạy được trên máy chủ (Fly, Edge Function). Trang Vàng chạy được cả hai nơi.

### 1.1 batdongsan: số trong DOM (kiểm 21/11/2026, chưa đăng nhập)

- Trang danh sách và trang chi tiết **không có số đầy đủ ở dạng chữ** ở bất kỳ đâu (chữ, thuộc tính, script, JSON-LD, link `tel:`).
- Mỗi nút "Hiện số" chỉ mang một chuỗi đã mã hoá (`raw`, `phone-key`); link "Chat qua Zalo" cũng là mã (`zalo.me/<mã>`), không chứa số. Trang chỉ giải ra số sau khi đăng nhập.
- Ngoại lệ: số người đăng tự gõ vào **tiêu đề tin**. Chữ hiển thị bị trang che (`0906 836 ***`), nhưng bản tiêu đề gốc trong dữ liệu nhúng của trang danh sách còn nguyên số. Trang mẫu: 1/20 tin.
- Em không làm phần giải mã chuỗi `raw` / link Zalo: đó là vượt bước đăng nhập mà trang dựng để che số người đăng.

Nên còn ba cách lấy SĐT từ batdongsan (anh chọn ở mục 6):

1. **Đăng nhập tài khoản batdongsan rồi bấm "Hiện số"**, như người dùng. Lấy được mọi tin. Mỗi lần bấm tính vào tài khoản đó; chưa biết bấm bao nhiêu thì bị giới hạn hoặc khoá.
2. **Chỉ số người đăng tự ghi trong tiêu đề**, đọc từ dữ liệu trang. Không cần đăng nhập, nhưng ít (khoảng 1/20 tin), và trang cố ý che số này khi hiển thị.
3. **Chỉ danh bạ môi giới** (SĐT công khai, khoảng 1.000).

### 1.2 Thử trong cửa sổ ẩn Electron (21/11/2026, máy dev, IP văn phòng)

Cửa sổ ẩn cấu hình như `BackgroundPageManager` của akaAgent (`show: false`, `offscreen: true`), mỗi lần một phân vùng mới:

| | UA giả Chrome 120 Windows (akaAgent đang dùng cho Facebook) | UA giả khác (Chrome 130 Windows / Mac, bỏ chữ Electron) | UA mặc định của Electron (`Chrome/130 … Electron/33.4.11`) |
|---|---|---|---|
| batdongsan | Kẹt ở "Chờ một chút…" của Cloudflare, có ô xác minh (Turnstile) | Kẹt như vậy | **Qua** sau ~15 giây (cả cửa sổ ẩn lẫn hiện) |
| Trang Vàng | Qua ngay | | |
| nhatot | Qua (trang tải chậm, ~30 giây vì nhiều quảng cáo) | | |

Kết luận: cửa sổ quét **không được đổi UA**, dùng đúng UA thật của Electron trên máy khách (UA của app đóng gói còn có tên app). Lý do khả dĩ: Cloudflare so UA với các header "client hints" mà Chromium tự gửi; UA giả lệch với chúng.

**Thử "Hiện SĐT" nhatot 200 tin** (10:58–11:42 VN 21/11/2026; cửa sổ ẩn Electron, UA thật, không proxy, nghỉ 10 giây giữa 2 tin; danh sách nhà đất TP.HCM 12 trang; chỉ đếm, không lưu số):

| Ra số | Người bán ẩn số | Không thấy nút | Bị chặn / Cloudflare | API `gateway.chotot.com/v1/public/ad-listing/phone` |
|---|---|---|---|---|
| 198 | 1 | 1 | 0 / 0 | 198 lần, đều HTTP 200 |

Mỗi tin mất trung bình 2,3 giây (mở trang + bấm + đọc) cộng 10 giây nghỉ ⇒ khoảng 270–290 tin / giờ. Chưa chạm ngưỡng chặn ở 200 tin / 44 phút; ngưỡng thật chưa biết.

## 2. Đã có sẵn trong hệ thống

- **akaAgent**:
  - Chiến dịch "Tìm data" Facebook (`facebook_find_data_group`, `facebook_find_data_search`): 158 chiến dịch / 36 tổ chức trong 30 ngày. Ghi một dòng lịch sử "Tìm data" (không gắn thao tác) cho mỗi data đầu vào, toàn bộ kết quả trong cột `data` ([campaignScheduler.ts:13365](../src/main/services/campaignScheduler.ts:13365)); đẩy data mới sang Nhóm data bằng `ingestDataGroup` kiểu `scan` ([campaignScheduler.ts:14164](../src/main/services/campaignScheduler.ts:14164)) và sang chiến dịch Zalo "Nhắn tin theo SĐT" ([campaignScheduler.ts:15405](../src/main/services/campaignScheduler.ts:15405)); tab "Data tìm được" + xuất Excel ([foundDataExport.ts:287](../src/renderer/src/components/CampaignPanels/foundDataExport.ts)).
  - Nhóm data loại SĐT đưa thẳng data mới vào chiến dịch "Nhắn tin theo SĐT" (9.006 chiến dịch / 732 tổ chức trong 30 ngày); chỉ cần SĐT hợp lệ, không xét nền tảng.
  - Trang chạy ngầm cho tài khoản: `BackgroundPageManager` (cửa sổ ẩn dùng phân vùng `persist:account_<id>` của tài khoản, có proxy của tài khoản), và `createTemporary(..., webOnly)` chỉ cho http(s), chặn tải file và cửa sổ bật lên ([backgroundPageManager.ts:79](../src/main/v2/runtime/backgroundPageManager.ts:79)). "Làm ấm tài khoản bằng web" (`fb_web_enrichment`) đã mở trang web bất kỳ theo cách này.
  - Gói đang hoạt động: akaAgent Zalo 655 tổ chức, Zalo trình duyệt 272, akaAgent Facebook 244.
- **akaMap** (repo `google-map`, 53 tổ chức có gói): đã có bộ quét Trang Vàng (18/01/2026, viết cho trangvangvietnam.com, chưa kiểm còn chạy với giao diện yellowpages.vn), chỗ chờ cho `'bds'` / `'nhatot'`, và đẩy được vào Nhóm data akaAgent. Anh chọn không làm ở đây; khi viết bộ quét Trang Vàng có thể tham khảo.

## 3. Những chỗ trong akaAgent phải mở rộng

Đọc code 21/11/2026:

- Mọi chiến dịch thuộc một `auto_accounts`; bộ lập lịch lặp theo tài khoản, đòi tài khoản "chờ xử lý" + "đã đăng nhập" ([campaignScheduler.ts:1886](../src/main/services/campaignScheduler.ts:1886), [:1938](../src/main/services/campaignScheduler.ts:1938)), và đòi tab trình duyệt đang mở trừ chiến dịch không cần trình duyệt ([:1960](../src/main/services/campaignScheduler.ts:1960), `isBrowserlessCampaign` [:9073](../src/main/services/campaignScheduler.ts:9073)).
- Nền tảng tài khoản mới bị lọc bỏ ở `canUseAccountPlatformWithEntitlements` ([entitlementRepository.ts:722](../src/main/data/repositories/entitlementRepository.ts:722)); danh sách nền tảng cứng ở cài đặt ẩn / hiện loại chiến dịch và bộ lọc danh sách chiến dịch.
- Hai mã chiến dịch Tìm data xuất hiện cứng ở khoảng 22 file (bộ lập lịch, form, tab Data tìm được, sửa nhanh…).
- Bước lọc "data mới" đọc lại mọi dòng lịch sử của chiến dịch mỗi lượt ([campaignScheduler.ts:14833](../src/main/services/campaignScheduler.ts:14833)): ổn với Facebook (ít data), nặng với nhatot (hàng nghìn tin).
- Không có trường địa chỉ riêng: địa chỉ, giá, ngành… đi vào `info1–5` / `extraData` của Nhóm data; mẫu Excel hiện là `Tên, Uid, Sđt, Email, Info1-5`.

## 4. Thiết kế

### 4.1 Tài khoản "Website" (anh chốt 21/11/2026: một loại chung, cho gắn proxy, không giới hạn số lượng lúc đầu)

Vì sao vẫn cần tài khoản: bộ lập lịch và engine v2 chạy theo tài khoản (mỗi tài khoản một chiến dịch một lúc; hạn mức, khung giờ, khoá thao tác tính theo tài khoản + thao tác); hồ sơ trình duyệt (cookie, phiên đăng nhập batdongsan, "giấy thông hành" Cloudflare) và proxy gắn theo phân vùng `persist:account_<id>`, dùng chung giữa tab Trình duyệt và cửa sổ chạy ngầm.

- **Một loại tài khoản "Website"** (`flatform_type = 'web'`), dùng được cho cả ba trang; các chiến dịch trên cùng tài khoản chạy lần lượt.
- **Proxy**: tuỳ chọn, dùng cơ chế proxy hiện có. Nhiều tài khoản trên cùng một máy chia nhau một IP nên không quét được nhiều hơn; proxy là cách tăng và cách đổi IP khi trang chặn.
- **Số lượng**: không giới hạn lúc chỉ tổ chức 1 dùng; khi mở cho khách thì gắn giới hạn theo gói.
- **UA thật**: tab Trình duyệt hiện đặt cứng UA giả Chrome 120 cho mọi tài khoản ([BrowserPage.tsx:480](../src/renderer/src/pages/BrowserPage.tsx:480)). Tài khoản Website phải dùng UA thật của Electron ở cả tab lẫn cửa sổ ngầm: UA giả bị batdongsan bắt giải captcha, và "giấy thông hành" Cloudflare gắn với UA + IP nên qua kiểm tra trong tab mà cửa sổ ngầm khác UA thì vô ích.
- **Đăng nhập**: trạng thái chung của tài khoản luôn là "đã đăng nhập" (Trang Vàng, nhatot không cần đăng nhập). Đăng nhập batdongsan theo dõi riêng, xem 4.1.1. AutoCheck hiện chỉ biết Facebook / Zalo nên không đụng tài khoản Website.
- **Web / iOS**: chiến dịch loại này chỉ chạy trên Desktop; ẩn tài khoản và chiến dịch Website trên Web / iOS lúc đầu (phải kiểm Web chịu được nền tảng lạ trước khi tạo tài khoản đầu tiên).
- Tab Trình duyệt của tài khoản Website là chỗ khách đăng nhập batdongsan và tự qua bước kiểm tra của Cloudflare khi trang đòi.

#### 4.1.1 Đăng nhập batdongsan không chặn Trang Vàng / nhatot (đề xuất, chờ anh duyệt)

Anh hỏi có cách kiểm đăng nhập batdongsan mà không chặn hai trang kia không. Có, hai lớp:

1. **Lúc chạy (chốt cuối)**: chiến dịch batdongsan gặp hộp đăng nhập khi bấm "Hiện số" thì chỉ **khoá thao tác "Hiện số batdongsan"** của tài khoản đó (cơ chế khoá thao tác theo tài khoản + mã thao tác đang có), ghi câu "Chưa đăng nhập batdongsan" kèm nút "Mở trình duyệt". Chiến dịch Trang Vàng / nhatot cùng tài khoản chạy tiếp vì là thao tác khác.
2. **Kiểm nhẹ định kỳ**: khi app mở, đọc cookie trong phân vùng của tài khoản (không mở trang, không gửi request lên batdongsan). Có cookie đăng nhập thì mở khoá thao tác và hiện "batdongsan: đã đăng nhập" cạnh tài khoản; không có thì hiện "batdongsan: chưa đăng nhập". Không đổi trạng thái chung của tài khoản.

Cookie nào báo đã đăng nhập phải xem bằng một lần đăng nhập thật (khi thử với tài khoản của anh sau khi code xong). Cookie còn chưa chắc phiên còn hạn phía batdongsan, nên lớp 1 vẫn là chốt cuối.

**Anh chốt 21/11/2026**: làm theo hai lớp trên; khi chưa đăng nhập, chiến dịch batdongsan **giữ "chờ xử lý"** với ghi chú "Chưa đăng nhập batdongsan" + nút "Mở trình duyệt", app thấy đã đăng nhập thì mở khoá và chạy tiếp (không tạm dừng).

### 4.2 Ba loại chiến dịch và form

| Mã | Tên hiển thị | Lấy gì |
|---|---|---|
| `web_find_data_yellowpages` | Trang Vàng - Tìm data doanh nghiệp | Tên DN, **chỉ SĐT di động** (bỏ số bàn, mỗi số một data), email, website, địa chỉ, ngành; tuỳ chọn mở trang chi tiết lấy mã số thuế, loại hình |
| `web_find_data_nhatot` | Nhà Tốt - Tìm data người đăng tin | Tên người đăng, SĐT, cá nhân / môi giới, khu vực, loại BĐS, giá, tiêu đề, ngày đăng, link tin |
| `web_find_data_batdongsan` | Batdongsan - Tìm data người đăng tin | Như nhatot; SĐT lấy bằng tài khoản batdongsan đã đăng nhập, bấm "Hiện số" |

Form (theo khung Tìm data Facebook):

- **Cấu hình tìm kiếm** (anh yêu cầu 21/11/2026 dùng danh sách từ khoá, Trang Vàng thêm được link; đánh giá ở 4.2.1):
  - Trang Vàng: **từ khoá** (mỗi dòng một từ khoá) + **tỉnh / thành** tuỳ chọn (danh sách tỉnh của Trang Vàng, mỗi từ khoá tìm riêng ở từng tỉnh) + **link ngành / link tìm kiếm** tuỳ chọn. Cần ít nhất một từ khoá hoặc một link.
  - nhatot, batdongsan: **chỉ từ khoá** (anh chốt 21/11/2026, sau khi xem đề xuất chọn khu vực ở 4.2.1), mỗi dòng một từ khoá, không có ô chọn khu vực, không dán link. Mỗi từ khoá tìm ở **cả mục mua bán lẫn cho thuê** (anh chốt 21/11/2026), mỗi data ghi thêm trường "Mua bán / Cho thuê".
    - nhatot: từ khoá gửi lên trang bằng `q=` trên `/mua-ban-bat-dong-san` và `/thue-bat-dong-san` (cả nước; thử cho thuê "nhà quận 7": 1.731 tin, 19/20 ở Quận 7, 16/20 môi giới, có cả phòng trọ), giữ thứ tự "Liên quan" mặc định của trang khi có `q=`; app không lọc lại (lọc chặt theo chữ trên tin thử thấy hoặc quá lỏng: 18/20 tin có đủ chữ "nhà", "quận", "7" nhưng chỉ 8/20 là Quận 7; hoặc quá chặt: cả cụm chỉ khớp 2/20). Thử "nhà quận 7" cả nước: 2.300 tin; trang 1 có 18/20 tin ở Quận 7, trang 5 có 14/20; tin trong thứ tự "Liên quan" vẫn mới (phần lớn trong 1–5 ngày). Xếp "Tin mới nhất" (`sp=0`) thì chỉ 8/20 là Quận 7, nên không dùng. Chấp nhận robots.txt của nhatot chặn `q=` (anh chọn cách này khi bảng đề xuất đã ghi điều đó).
    - batdongsan: không có tìm chữ tự do, nên app gõ từ khoá vào ô tìm của chính trang trong cửa sổ chạy ngầm rồi bấm "Tìm kiếm" như người dùng, lấy trang kết quả trang chọn (gợi ý đầu tiên); gõ từ trang `/nha-dat-ban` ra mục bán, từ `/nha-dat-cho-thue` ra mục cho thuê ("quận 7" → `/nha-dat-cho-thue-quan-7`, 20 thẻ, 18 thẻ có nút hiện số). Thử: "Vinhomes Grand Park" → `/nha-dat-ban-vinhomes-grand-park` (1.106 tin), "quận 7" → `/nha-dat-ban-quan-7`; chữ mô tả "nhà hẻm xe hơi" → "Đường Bờ Xe Lam, Bình Chánh" (sai). Form dặn chỉ gõ địa điểm / dự án; mỗi lượt tiến trình ghi một dòng "🔎 "<từ khoá>" → <tiêu đề trang kết quả>" để khách tự thấy trang hiểu sai. Gợi ý lấy qua ô tìm, không gọi API gợi ý của trang (`/microservice-architecture-router/` bị robots.txt chặn).
- **Số trang tối đa mỗi lần tìm** (một từ khoá × một mục bán / cho thuê, hoặc một link Trang Vàng) và **số data tối đa mỗi lượt**.
- **Bỏ qua tin đã quét ở lượt trước**: nhatot (thứ tự "Liên quan") và batdongsan (không có cách xếp tin mới nhất: chỉ "Mặc định" đẩy tin VIP lên đầu, "Tin xác thực xếp trước", giá, diện tích) đều đọc đủ số trang đã đặt rồi bỏ tin đã quét; Trang Vàng cũng vậy (bỏ doanh nghiệp đã lấy).
- nhatot: **Cá nhân / Môi giới / Cả hai**, mặc định Môi giới (lọc theo cờ của tin, không cần tham số `f=` trên link).
- **Nghỉ giữa 2 lần mở trang / bấm Hiện số**: mặc định 15 giây, thấp nhất 10 giây, cả ba trang (4.5.1).
- **Giới hạn trong ngày / trong giờ**: khách tự đặt, có trần (4.5.1).
- **Đích**: Nhóm data loại SĐT + tuỳ chọn đẩy thẳng vào chiến dịch đang có, như Tìm data Facebook.
- **Lịch**: lịch chiến dịch hiện có (một lần, hằng ngày, lặp lại sau khi xong).

#### 4.2.1 Tìm theo từ khoá: thử trên ba trang (21/11/2026, trình duyệt của app)

| Trang | Tìm chữ tự do | Kết quả |
|---|---|---|
| Trang Vàng | Có: `/srch/<từ khoá>.html`, lọc tỉnh `/srch/<tỉnh>/<từ khoá>.html` (trang kết quả tự liệt kê link theo tỉnh) | "bao bì nhựa" ra 893 doanh nghiệp, 38 thẻ trang đầu; robots.txt cho phép |
| nhatot | Có: `q=` trên link danh sách, ghép được với khu vực | Khớp lỏng: "nhà quận 7" trong TP.HCM, xếp "Tin mới nhất" (`sp=0`), ra cả tin quận 8, quận 3, Q11 (1.813 tin); chọn đúng khu vực `/mua-ban-bat-dong-san-quan-7-tp-ho-chi-minh` thì 20/20 tin là Quận 7 (1.966 tin). Xếp "Liên quan trước" thì khớp tốt hơn nhưng không theo ngày, không dừng được ở tin cũ. **robots.txt chặn `/*q=` và `/*f=`** |
| batdongsan | Không: ô tìm chỉ gợi ý địa điểm / dự án; tham số `keyword=` trên link bị bỏ qua | "nhà hẻm xe hơi" thành "Đường Bờ Xe Lam, Huyện Bình Chánh", 7 tin không liên quan |

Đánh giá lúc đó (anh đã chọn "chỉ từ khoá", cách làm ở 4.2): Trang Vàng dùng từ khoá đúng ý anh. Với nhatot và batdongsan, từ khoá không thay được khu vực + loại nhà đất (nhatot khớp lỏng và robots chặn `q=`, batdongsan không có tìm chữ), nên đề xuất chọn khu vực + loại trong form, từ khoá chỉ để app lọc thêm (lọc trước khi hiện số, không tốn lượt hiện SĐT), giữ tab dán link. Cái giá: phải dựng và giữ danh sách khu vực theo từng trang (nhatot mã vùng riêng, batdongsan đuôi link riêng, cả hai còn theo quận / huyện cũ trước sáp nhập; danh sách của nhatot không có sẵn trong trang, phải lấy từ API của trang), lưu ở DB để sửa không phải phát hành app.

#### 4.2.2 Ba loại chiến dịch, không gộp một loại (anh hỏi lại rồi chốt giữ ba loại, 21/11/2026)

Form đã có bước chọn nền tảng trước khi chọn loại (`renderActionPlatformSwitcher`, [CampaignFormModal.tsx:3142](../src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx:3142), lọc theo `flatform_type`). Ba loại có `flatform_type = 'web'` nằm chung một nút "Website", khách thấy như "chọn Website rồi chọn trang". Giữ ba loại vì mỗi trang khác hẳn: cách tìm, trường lấy thêm, hành động tính giới hạn (Hiện SĐT nhatot / Hiện số batdongsan / Mở trang Trang Vàng), điều kiện chạy (batdongsan cần đăng nhập), workflow. Trong code, workflow (`auto_campaign_actions.workflow_id`), danh sách hành động và giới hạn, câu chờ, tab Hành động, báo cáo, bộ lọc danh sách chiến dịch, lõi engine (`registry.ts`) đều đi theo loại chiến dịch; gộp một loại thì mọi chỗ đó phải đọc thêm "trang nào" trong cài đặt, và danh sách chiến dịch / báo cáo không phân biệt được trang. Một chiến dịch quét nhiều trang cùng lúc: không làm; muốn cả ba thì tạo ba chiến dịch cùng đổ vào một Nhóm data.

### 4.3 Một lượt chạy

1. Dựng các lần tìm (Trang Vàng: từ khoá × tỉnh + link khách dán; nhatot: link `q=`; batdongsan: gõ từ khoá vào ô tìm của trang) rồi mở từng trang danh sách trong trang chạy ngầm của tài khoản Website.
2. Đọc các thẻ:
   - Trang Vàng: đọc thẳng từ thẻ `.ypx-card` (đủ SĐT, email, website); tuỳ chọn mở trang `/lgs/<mã>/…` lấy mã số thuế.
   - nhatot: đọc danh sách tin từ dữ liệu trang (`__NEXT_DATA__`: 20 tin, mã tin `list_id`, tên, cờ môi giới); với tin chưa đọc và đúng loại người đăng, mở trang tin, bấm "Hiện SĐT", đọc số.
   - batdongsan: đọc 20 thẻ tin (mã tin `prid`, tên người đăng); với tin chưa đọc, bấm "Hiện số" ngay trên thẻ (tài khoản batdongsan đã đăng nhập trong hồ sơ của tài khoản Website), đọc số; gặp hộp đăng nhập thì làm như 4.1.1.
3. Bỏ tin / doanh nghiệp đã đọc ở lượt trước (theo mã tin, mã doanh nghiệp; lưu riêng, không đọc lại cả lịch sử như Facebook), chuẩn hoá SĐT, bỏ SĐT trùng.
4. Ghi vào Nhóm data theo lô (kiểu cộng dồn, chia lô như hiện nay), rồi đẩy sang chiến dịch đích nếu có.
5. Sang trang kế tới khi đủ số trang / số data hoặc hết trang.

Code quét đặt trong workflow / block ở DB như Facebook (sửa khi trang đổi giao diện không cần phát hành app); chỗ tìm phần tử để ở `auto_elements`.

### 4.4 Khi trang chặn hoặc đổi giao diện

Theo nguyên tắc "chỉ phát mã cụ thể khi thấy dấu hiệu của đúng lỗi":

- Thấy trang kiểm tra của Cloudflare / captcha: dừng chiến dịch, câu cho khách kèm nút "Mở trình duyệt" (như Quét data) để khách tự qua bước kiểm tra rồi bấm Tiếp tục. Không thử lại liên tục (dễ bị khoá IP của khách).
- Thấy hộp đăng nhập (batdongsan) hoặc nhatot bắt đăng nhập mới hiện SĐT: dừng, câu riêng.
- Không thấy thẻ nào trên trang danh sách: ghi lỗi, dừng sau N trang liền (có thể trang đổi giao diện).
- Bấm "Hiện SĐT" không ra số: bỏ qua tin đó, đếm; quá N tin liền thì dừng.

Câu cho khách anh duyệt từng câu khi làm.

### 4.5 Data ghi ra

Trường lấy được (kiểm trên trang thật 21/11/2026):

| Trang | Có sẵn, không tốn thêm lượt mở trang | Phải mở thêm trang chi tiết (tuỳ chọn, chậm hơn) |
|---|---|---|
| Trang Vàng | Tên DN, địa chỉ, SĐT di động, email, website, mô tả ngắn, ngành (theo link đang quét), nhãn Xác thực / Tài trợ, link hồ sơ | Mã số thuế, địa chỉ theo MST, hotline, loại hình, thị trường, khách hàng chính, ngành nghề kinh doanh, sản phẩm dịch vụ |
| nhatot | Trang tin vốn đã mở để hiện SĐT: SĐT, tên người đăng, cá nhân / môi giới, **địa chỉ đầy đủ** (`ad_params.address`), tỉnh / quận / phường, toạ độ, tiêu đề, giá, giá/m², diện tích đất / sử dụng, ngang × dài, phòng ngủ, toilet, số tầng, loại nhà, hướng, pháp lý, nội thất, dự án, mô tả, ngày đăng, mã tin, link | Không cần |
| batdongsan | Thẻ tin: SĐT (bấm Hiện số), tên người đăng, mã tin, tiêu đề, giá, diện tích, giá/m², phòng ngủ, WC, tỉnh / thành, mô tả ngắn, ngày đăng, loại tin (VIP…), link | **Địa chỉ đầy đủ** (kèm tên phường mới sau sáp nhập), mặt tiền, đường vào, số tầng, hướng nhà / ban công, pháp lý, nội thất, ngày hết hạn, dự án |

- Một data = một SĐT đã chuẩn hoá. Tên ở cột tên.
- Form có phần **"Thông tin lấy thêm"**: khách chọn trường cần lấy, và chọn trường nào vào cột **Info1–Info5** của Nhóm data (dùng làm biến khi soạn tin nhắn); trường đã chọn mà không vào Info thì vẫn có trong tab "Data tìm được" và file Excel.
- Tab "Data tìm được" của chiến dịch hiện cột theo trường đã chọn + xuất Excel. SĐT hiện đầy đủ, không che (anh chốt 21/11/2026).

### 4.5.1 Giới hạn ngày cài được (anh yêu cầu 21/11/2026)

Theo thẻ giới hạn hành động đang có của form (giới hạn trong ngày, trong giờ, thời gian nghỉ): mỗi trang một thao tác có hạn mức, tính theo tài khoản Website (các chiến dịch cùng trang trên cùng tài khoản dùng chung).

Anh chốt 21/11/2026: cả ba dùng chung một mức (thay bảng đề xuất trước: nhatot 500 / 2.000 / 10–8 giây, batdongsan 50 / 200 / 15–10 giây, Trang Vàng 1.000 / 5.000 / 5–5 giây).

| Thao tác | Mặc định ngày | Trần (khách không đặt quá, sửa ở DB) | Nghỉ mặc định / tối thiểu |
|---|---|---|---|
| Hiện SĐT nhatot | 100 lần | 500 | 15 / 10 giây |
| Hiện số batdongsan | 100 lần | 500 | 15 / 10 giây |
| Mở trang Trang Vàng | 100 trang (≈ 2.000 doanh nghiệp khi không mở trang chi tiết) | 500 | 15 / 10 giây (trên mức 5 giây robots.txt của Trang Vàng yêu cầu) |

Giới hạn trong giờ: mặc định bằng giới hạn ngày (không chặn thêm theo giờ; anh chưa đặt mức riêng). Số data tối đa mỗi lượt mặc định 100 cho nhatot / batdongsan (bằng giới hạn ngày), Trang Vàng giữ 1.000.

Bản thiết kế giao diện để duyệt: https://claude.ai/artifact/6s57dV55jtFr6zRBWVU14y (form nhatot đủ các phần; phần khác của Trang Vàng, batdongsan; tài khoản Website; tab Data tìm được và câu ghi chú nháp).

### 4.6 Hiển thị chỉ cho tổ chức 1

Một dòng `auto_system_settings` (ví dụ `web_scan.campaigns` = `{"organizationIds":[1]}`), đọc chung câu đọc cài đặt lúc đăng nhập (không thêm request). Khi bật cho tổ chức nào thì tổ chức đó thấy ba loại chiến dịch và loại tài khoản Website; mở rộng chỉ cần sửa dòng này. Bộ chạy cũng kiểm dòng này để tổ chức khác không chạy được dù có chiến dịch.

### 4.7 Bộ chạy: engine v2 hay bộ cũ

- Engine v2 hiện chỉ biết Facebook và Zalo: các hàm DB nhận / báo / kết thúc lượt rẽ nhánh cứng theo `flatform_type = 'facebook'` ([migration_v558_engine_facebook_functions.sql:203](../migrations/migration_v558_engine_facebook_functions.sql:203)), lõi chỉ đăng ký 13 loại chiến dịch Facebook ([registry.ts:26](../packages/campaign-engine/src/facebook/registry.ts:26)). Cho nền tảng `web` chạy bằng engine nghĩa là sửa các hàm nhận / báo lượt mà mọi tổ chức đang dùng mỗi giây.
- Bộ cũ (`executeCampaignV2` + workflow trong DB) vẫn chạy được Tìm data, và Tìm data không gửi gì cho ai: chạy lại một lượt chỉ là quét lại, data trùng bị Nhóm data bỏ theo SĐT. Cái lợi chính của engine (không gửi trùng khi máy tắt ngang) gần như không dùng tới.
- **Anh chốt 21/11/2026: chạy bằng engine v2 ngay.** Việc phải làm:
  - Các hàm DB của engine có rẽ nhánh theo nền tảng (đọc production 21/11): `aka_agent_engine_claim_target_v1` (3 chỗ `'facebook'`, 6 chỗ `'zalo'`), `aka_agent_engine_report_v1` (1 chỗ), `aka_agent_engine_health_v1` (3), `aka_agent_engine_error_watch_tick_v1` (12, bộ kiểm lỗi Facebook), `aka_agent_engine_close_desktop_runs_v1` / `aka_agent_engine_receiver_results_ingest` (Zalo). Hướng: nền tảng `web` đi cùng nhánh "chạy bằng trình duyệt trên Desktop" với Facebook.
  - Migration sửa thân hàm nhận / báo lượt: sinh từ thân production bằng script, kiểm md5 trước / sau, có bản gỡ, chạy thử trong giao dịch rồi huỷ, apply buổi tối (PostgREST nạp lại schema).
  - Cờ bật riêng (dòng `auto_system_settings` ở 4.6, tổ chức 1), không dùng `engine.facebook`.
  - Lõi: thêm đăng ký ba loại chiến dịch web, adapter Desktop dùng lại phần của Facebook (vết thao tác, dấu hiệu lỗi trên trang, ảnh lỗi, block treo).
  - Mã lỗi và chính sách ở `auto_outcome_policies` / `auto_outcome_signal_rules`; câu cho khách anh duyệt.

### 4.8 Ước lượng tốc độ và tải

- Trang Vàng: một trang ra ~20 doanh nghiệp; nghỉ 5 giây ⇒ khoảng 4.000–5.000 doanh nghiệp / giờ nếu không mở trang chi tiết; mở chi tiết thì ~700 / giờ.
- nhatot: đo thật ở mục 1.2, khoảng 270–290 tin / giờ với nghỉ 10 giây.
- batdongsan danh bạ môi giới: 54 trang, vài phút là hết.
- DB: thêm lượt nạp Nhóm data theo lô và dòng lịch sử; không đáng kể so với tải hiện tại.

## 5. Pháp lý và điều khoản trang (để anh cân nhắc, em không phải luật sư)

- SĐT của cá nhân (người bán nhà, môi giới cá nhân) là dữ liệu cá nhân. Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 có hiệu lực từ 01/01/2026, cấm mua bán dữ liệu cá nhân; người có dữ liệu có quyền biết, đồng ý, phản đối việc xử lý.
- Nhắn tin / gọi quảng cáo khi người nhận chưa đồng ý là tin nhắn rác theo Nghị định 91/2020/NĐ-CP; Nghị định 330/2026/NĐ-CP (hiệu lực 19/8/2026) có mức phạt cho việc này. Data quét về rồi đẩy vào chiến dịch nhắn Zalo hàng loạt rơi đúng vào trường hợp này.
- Mức rủi ro theo trang: Trang Vàng thấp nhất (SĐT doanh nghiệp tự đăng để được liên hệ, B2B); nhatot trung bình (người đăng công khai số để được gọi về đúng tin đó); batdongsan tin đăng cao nhất (trang cố ý che số).
- Chưa đọc điều khoản sử dụng của ba trang.

## 6. Còn chờ anh chốt

1. Đã duyệt 21/11/2026: giao diện (bản thiết kế phiên bản 10, link ở 4.5.1); giới hạn ngày chung 100 / trần 500 / nghỉ 15–10 giây.
1a. Đã chốt 21/11/2026: nhatot / batdongsan chỉ từ khoá (4.2); Trang Vàng từ khoá + tỉnh + link; SĐT hiện đầy đủ trong app (không che). Tìm cả mua bán lẫn cho thuê. Giữ ba loại chiến dịch chung nút "Website" (4.2.2).
2. Câu cho khách (dừng vì Cloudflare, chưa đăng nhập batdongsan, trang đổi giao diện…): anh duyệt từng câu khi code.
3. Thử batdongsan "Hiện số" bằng tài khoản batdongsan của anh: sau khi code xong (anh đã chốt).

## 7. Kế hoạch code (viết 21/11/2026 sau khi anh duyệt giao diện; chưa code)

Đọc code `origin/dev_3` và thân hàm production 21/11/2026 (chỉ đọc). Code làm ở worktree mới tách từ `origin/dev_3` (checkout chính đang chậm 18 commit). Số migration trống kế tiếp lúc đọc: **V618** (sổ đã tới V613), kiểm lại sổ + `git log --all` ngay trước khi apply.

### 7.1 Phát hiện làm đổi thiết kế

- **Tìm data Facebook không có hạn mức nào**: `limit_check_action_codes` của `facebook_find_data_group` / `_search` là `[]`, dòng "Tìm data" không gắn thao tác. Ba loại web có hạn mức (hiện SĐT / hiện số / mở trang) nên phải có mã thao tác riêng, và mỗi lần dùng phải được đếm (7.4).
- **Một lượt data (một từ khoá) tốn nhiều lượt hạn mức**, trong khi engine kiểm hạn mức ở lúc nhận data (`aka_agent_engine_action_limit` trong claim, [migration_v558…:492](../migrations/migration_v558_engine_facebook_functions.sql:492)). Block phải biết còn bao nhiêu lượt và dừng đúng lúc (7.4).
- **`report_v1` từ chối dòng "Tìm data" của nền tảng khác Facebook** (dòng không có mã thao tác chỉ nhận khi `auto_campaign_actions.flatform_type = 'facebook'`, [migration_v558…:913](../migrations/migration_v558_engine_facebook_functions.sql:913)): không sửa thì lỗi `action_unknown`.
- **`auto_outcome_signal_rules.platform` có CHECK** `IN ('zalo','facebook','email','system')`: phải thêm `'web'`.
- Đẩy data vào Nhóm data / chiến dịch đích của Facebook chạy trong bộ lập lịch, ngay sau khi dựng dòng "Tìm data" ([campaignScheduler.ts:13412](../src/main/services/campaignScheduler.ts:13412)), không qua móc `afterReport` của lõi. Web làm cùng chỗ đó.
- `ingestDataGroup` đã nhận `email`, `info1..info5`, `extraData` ([types.ts:2256](../src/shared/types.ts:2256)); DB giữ giá trị Info cũ nếu đã có (quét lại không ghi đè).
- Hàm snapshot tài khoản Desktop lọc theo `p_access->>flatform_type`, mà khoá `web` trong `p_access` đang là "Zalo Web" ([migration_v446…:942](../migrations/migration_v446_app_access_callers.sql:942)): tài khoản `flatform_type='web'` sẽ hiện / ẩn theo quyền Zalo Web. Phải sửa bằng migration.

### 7.2 Một công tắc cho mọi thứ

`auto_system_settings` key `web_scan.campaigns` = `{"organizationIds":[1]}` (thêm `limits` ở 7.4). Đọc bằng hàm mới `aka_agent_web_scan_org_enabled(org)` (chép kiểu `aka_agent_engine_facebook_org_enabled`) và RPC Desktop `aka_agent_web_scan_enabled_v1()` (tổ chức lấy từ phiên). Dùng cho: hiện loại tài khoản Website, hiện ba loại chiến dịch, claim của engine (tổ chức không bật thì `not_enabled`). Desktop chốt cờ `AuthUser.webScanEnabled` lúc đăng nhập ([authRepository.ts:180](../src/main/data/repositories/authRepository.ts:180)) và giữ qua vòng kiểm phiên 30 giây (vòng đó đang dựng lại quyền từ gói, [handlers.ts:939](../src/main/ipc/handlers.ts:939)). Không dùng `campaignTypeVisibility` (chỉ là danh sách ẩn do admin tổ chức sửa).

### 7.3 DB (một nhánh migration, chia phần như V556–V560)

- **p1 (DDL ngắn, giao dịch riêng)**: CHECK `auto_outcome_signal_rules.platform` thêm `'web'`; bảng `private.auto_web_scan_seen` (campaign_id, site, listing_key, first_seen_at; khoá chính 3 cột) cho "bỏ qua tin đã quét"; bảng `private.auto_web_scan_listings` (organization_id, site, listing_key, phone, name, data jsonb, revealed_at) để dùng lại số đã hiện trong tổ chức 30 ngày (7.4); retention theo job pg_cron.
- **p2 (thân hàm, sinh từ thân production bằng script, kiểm md5 trước / sau, có bản gỡ)**:
  - `aka_agent_engine_claim_target_v1`: nhánh `web` cạnh nhánh Facebook (chỉ `desktop`, tổ chức bật `web_scan.campaigns`, không đòi gói); trả thêm số lượt còn lại trong ngày / trong khung giờ của mã thao tác web để block giới hạn số lần hiện SĐT.
  - `aka_agent_engine_report_v1`: dòng không mã thao tác nhận `flatform_type IN ('facebook','web')`.
  - `aka_agent_engine_action_limit`: mã `web_*` lấy mặc định 100 / ngày và kẹp trần 500 theo `web_scan.campaigns.limits` (không dùng mặc định chung 30 / 9 / 65 phút).
  - `aka_agent_engine_finish_campaign_v2`: thêm ba mã vào danh sách "Chạy lại sau mỗi N giờ" của Tìm data (dòng 268 thân hiện tại).
  - Hàm snapshot tài khoản Desktop: tài khoản `flatform_type='web'` đọc khoá riêng (`webScan`), không đọc khoá `web` của Zalo Web.
  - RPC mới cho Desktop: `aka_agent_web_scan_seen_v1(campaign, site, keys[])` (trả khoá đã quét + số đã hiện nếu có), `aka_agent_web_scan_record_v1(campaign, site, items)`; quyền `aka_agent_desktop`, tổ chức lấy từ phiên.
- **p3 (chỉ dữ liệu)**: 3 dòng `auto_account_actions` (`web_nhatot_phone` "Hiện SĐT nhatot", `web_batdongsan_phone` "Hiện số batdongsan", `web_yellowpages_page` "Mở trang Trang Vàng", nền tảng `web`); 3 dòng `auto_campaign_actions` (`flatform_type='web'`, `limit_check_action_codes` = mã của trang, `allow_multiple_accounts` như Tìm data Facebook, **`is_active = false`**: Desktop hiện tại lấy loại chiến dịch `is_active` rồi coi nền tảng lạ là Facebook ([campaignActionRepository.ts:72](../src/main/data/repositories/campaignActionRepository.ts:72), [entitlementRepository.ts:660](../src/main/data/repositories/entitlementRepository.ts:660)), nên dòng bật sẵn sẽ hiện ba loại cho mọi tổ chức có gói Facebook; bản mới đọc riêng ba dòng khi `webScanEnabled`, phải kiểm hàm claim / tạo chiến dịch / Web không đòi `is_active`); workflow + block "[engine]" + `auto_engine_workflows` (purpose = mã chiến dịch) + `auto_engine_block_steps` (bước `result`); `auto_elements` cho mọi chỗ tìm phần tử; mã lỗi `WB01…` ở `auto_error` + chính sách theo `campaign_action_id` + luật `auto_outcome_signal_rules` platform `web` (câu cho khách anh duyệt từng câu lúc code); dòng `web_scan.campaigns`.
- Code block viết ở `scripts/web-scan/*.fragment.js`, sinh SQL bằng `scripts/build-v6xx-sql.cjs` như V577 / V578 (không ghi số migration trong chú thích code block).
- Không làm đợt đầu: bộ kiểm lỗi (`error_watch_tick`) và `health_v1` cho web (đang cứng Facebook), App Server / Fly (web chỉ chạy Desktop).

### 7.4 Đếm hạn mức và bỏ tin đã quét

- Mỗi lần hiện SĐT (nhatot, batdongsan) / mở trang (Trang Vàng) là một lượt của mã thao tác của trang. **Anh chốt 21/11/2026**: mỗi lượt ghi một dòng Lịch sử hành động (ví dụ "📞 Hiện SĐT "<tiêu đề tin>": 0909…", "📄 Mở trang Trang Vàng: <link> (18 doanh nghiệp)"), như cách mỗi comment là một dòng. Lý do: hạn mức ngày (`count_action_in_day`) và hạn mức theo giờ (đếm dòng có `counts_toward_limit`) của engine đều dựa vào dòng lịch sử; không ghi dòng thì phải làm bộ đếm riêng và bỏ ô giới hạn trong giờ. Cuối mỗi từ khoá vẫn có một dòng "Tìm data" mang toàn bộ data tìm được.
- Claim trả số lượt còn lại; block không hiện số / mở trang vượt số đó. Hết lượt giữa một từ khoá thì từ khoá về hàng đợi (lượt sau làm tiếp, tin đã quét được bỏ qua), lần claim sau bị chặn theo hạn mức và chiến dịch chờ với câu kiểu "Đã đủ 100 lần hiện SĐT hôm nay. Chạy tiếp lúc 00:00 ngày 22/11." (câu chờ của engine đã có sẵn cơ chế).
- "Bỏ qua tin đã quét ở lượt trước" theo chiến dịch: Desktop đọc khoá đã quét qua RPC trước mỗi trang danh sách (không đọc lại toàn bộ lịch sử như Facebook, [campaignScheduler.ts:14846](../src/main/services/campaignScheduler.ts:14846)).
- **Anh chốt 21/11/2026**: tin đã có SĐT do chiến dịch khác **cùng tổ chức** hiện trong 30 ngày thì dùng lại số, không bấm hiện số lần nữa (không tốn lượt). Chỉ trong tổ chức, không dùng chéo tổ chức (bảng `private.auto_web_scan_listings` ở 7.3 là bắt buộc).

### 7.5 Desktop: tài khoản Website

- `AccountPanel.tsx`: thêm nền tảng Website khi `webScanEnabled` ([AccountPanel.tsx:180](../src/renderer/src/components/CampaignPanels/AccountPanel.tsx:180), `:1172`), tạo với `login_status = 'đã đăng nhập'` ([accountRepository.ts:405](../src/main/data/repositories/accountRepository.ts:405)), cho chọn proxy.
- Quyền: nhánh `web` theo `webScanEnabled` (không theo gói) ở `canUseAccountPlatformWithEntitlements`, `ensureCurrentUserCanUseAccountPlatform`, `getCampaignActionFeature`, `getAccountActionFeature` ([entitlementRepository.ts:660-753](../src/main/data/repositories/entitlementRepository.ts:660)) và bản renderer ([utils/entitlements.ts:120-194](../src/renderer/src/utils/entitlements.ts:120)); `normalizeNonZaloRuntimePlatform` nhận `web` ([accountRepository.ts:1126](../src/main/data/repositories/accountRepository.ts:1126)). Tài khoản Website không tính số tài khoản tối đa của gói nào.
- Nhãn "Website": `accountLabels.ts`, `CAMPAIGN_ACTION_PLATFORM_LABELS/ORDER` (form thường + form Agent), `CampaignPanel.tsx` (thứ tự, suy nền tảng từ tiền tố `web_`), `ReportPage.tsx`, `accountRepository.getPlatformDisplayName`, nhóm tài khoản.
- Trình duyệt: tab Trình duyệt và cửa sổ chạy ngầm của tài khoản Website **không đặt UA giả** (Cloudflare của batdongsan), sửa [BrowserPage.tsx:480](../src/renderer/src/pages/BrowserPage.tsx:480) và `BackgroundPageManager` ([backgroundPageManager.ts:62](../src/main/v2/runtime/backgroundPageManager.ts:62)); trang chủ của tab Website là trang trống.
- AutoCheck bỏ qua tài khoản khác Facebook ([accountPoller.ts:56](../src/main/domain/accounts/accountPoller.ts:56)) để tab Website lỡ mở facebook.com không bị hạ trạng thái.
- Đăng nhập batdongsan (4.1.1): đọc cookie của phân vùng `persist:account_<id>` (không gửi request) mỗi khi tab tải xong trang batdongsan và trước mỗi lượt; chưa đăng nhập thì khoá riêng mã `web_batdongsan_phone` của tài khoản đó, đăng nhập lại thì mở khoá; chip trên danh sách tài khoản và form. Cookie nào báo đăng nhập xác định bằng lần đăng nhập thật với tài khoản của anh.

### 7.6 Desktop: chạy chiến dịch

- Lõi: `packages/campaign-engine/src/web/registry.ts` (ba mã, tên kết quả "Tìm data", mã thao tác mặc định, kế hoạch claim), xuất ở `index.ts`.
- `DesktopEngineRunner`: thêm host `web` cạnh `facebook` ([desktopEngineRunner.ts:97-136](../src/main/engineAdapters/desktopEngineRunner.ts:97)); `support()` nhận tài khoản `web` khi `webScanEnabled` và danh mục có workflow.
- Bộ lập lịch: `openWebEngineUnit` / `runWebEngineTarget` gọn hơn bản Facebook (không danh tính Page, không bộ dựng lịch sử cũ): dựng biến (từ khoá, trang, mục mua bán / cho thuê, tỉnh và link của Trang Vàng, số trang, số data, trường cần lấy, số lượt còn lại, khoá đã quét), lấy trang chạy ngầm ([campaignScheduler.ts:16061](../src/main/services/campaignScheduler.ts:16061)), chạy workflow, nhận `records` + `uses` + `stopReason` từ block, báo từng lượt dùng rồi dòng "Tìm data" qua `api.reportMilestone`, ghi khoá đã quét, đẩy data (7.8), in dòng tiến trình (có dòng "🔎 "<từ khoá>" → <trang kết quả>" của batdongsan). Dùng lại vết thao tác, ảnh lỗi + DOM, bộ cắt block treo của Facebook.
- Nghỉ giữa 2 lần hiện số / mở trang nằm trong block (biến `sleepSeconds`, kẹp thấp nhất 10 giây ở form, khi lưu và khi chạy). Nghỉ giữa hai từ khoá dùng `pacing` sẵn có.
- Block theo trang (code trong DB, chỗ tìm phần tử ở `auto_elements`):
  - nhatot: mở `/mua-ban-bat-dong-san?q=` rồi `/thue-bat-dong-san?q=`, đọc `__NEXT_DATA__` (20 tin, `list_id`, `company_ad`, tên, khu vực…), lọc Cá nhân / Môi giới theo cờ của tin, mở trang tin chưa quét, bấm "Hiện SĐT", đọc số; tin "Người bán ẩn số" bỏ qua.
  - batdongsan: mở `/nha-dat-ban` rồi `/nha-dat-cho-thue`, gõ từ khoá vào ô tìm, bấm "Tìm kiếm", ghi trang kết quả; đọc thẻ `.js__card-listing` (`prid`), bấm "Hiện số" trên thẻ chưa quét; gặp hộp đăng nhập thì dừng và khoá mã hiện số (4.1.1); tuỳ chọn mở trang tin lấy địa chỉ đầy đủ.
  - Trang Vàng: `/srch/<tỉnh>/<từ khoá>.html` hoặc link khách dán, `?page=N`, đọc `.ypx-card`, chỉ giữ số di động (mỗi số một data), tuỳ chọn mở `/lgs/<mã>/…`.
  - Nhận ra chặn theo dấu hiệu có mặt: trang "Chờ một chút" / khung Turnstile của Cloudflare → mã riêng, tạm dừng chiến dịch + ghi chú có nút "Mở trình duyệt" (dùng lại cách của cửa sổ Quét data); không thấy thẻ tin nào trên trang danh sách (trang đổi giao diện) → mã "Không thấy …", dừng sau N data liền.

### 7.7 Desktop: form

- `CampaignFormModal.tsx`: nhánh `isWebFindDataCampaign` trong danh sách phần ([CampaignFormModal.tsx:3607](../src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx:3607)): Thông tin chung, Cấu hình tìm kiếm (từ khoá lưu thành data đầu vào như từ khoá tìm kiếm Facebook; Trang Vàng thêm tỉnh + link), Thông tin lấy thêm (ô chọn trường + chọn Info1–5), Xử lý data tìm được (dùng lại phần Nhóm data loại SĐT và chiến dịch "Nhắn tin theo SĐT", [:12289](../src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx:12289)), Lịch chạy (+ Chạy lại sau mỗi), Giới hạn hành động (`renderActionLimitCard` với mã của trang; mặc định 100 / 100, tối đa 500, nghỉ mặc định 15 giây, thấp nhất 10). Không gộp vào `isFindDataCampaign` (kéo theo trạng thái Facebook). Cài đặt lưu ở `extra_settings.webScan` (`site`, `provinces`, `links`, `pagesPerSearch`, `maxDataPerRun`, `skipSeen`, `poster` (nhatot), `openDetail`, `fields`, `infoMap`).
- Lọc ba loại theo `webScanEnabled`; form Agent (AI) không hiện ba loại ở đợt đầu.
- Các chỗ khác cần nhánh web (danh sách ở 25 file đã rà): chi tiết chiến dịch / sửa nhanh / xem cài đặt, lý do đang chờ, chiến dịch đích chờ nguồn Tìm data, lặp lại sau khi xong, nhãn và đơn vị mã thao tác (`ACTION_CODE_LABELS`, `campaignActionDescriptors.ts`), tab Hành động.

### 7.8 Data tìm được, Excel, Nhóm data

- Dòng "Tìm data" mang `data.webRecords = [{phone, name, email, listingKey, link, section, fields}]` + `data.webFields` / `infoMap` của lúc chạy.
- Tab "Data tìm được": cột theo trường đã chọn, SĐT hiện đầy đủ ([CampaignPanel.tsx:3564](../src/renderer/src/components/CampaignPanels/CampaignPanel.tsx:3564)). Excel ([foundDataExport.ts](../src/renderer/src/components/CampaignPanels/foundDataExport.ts)): điền Email + Info1–5 theo lựa chọn, thêm cột cho trường còn lại.
- Đẩy Nhóm data: dòng loại SĐT có `info1..info5`, `email`, `extraData` (mọi trường đã chọn, trang, mã tin, link); chuẩn hoá SĐT di động Việt Nam trước khi bỏ trùng. Chiến dịch đích "Nhắn tin theo SĐT" dùng lại đường đẩy sẵn có.

### 7.9 Kiểm thử

- PG17: migration + bản gỡ, claim / report với tài khoản web (tổ chức bật / không bật, runtime `fly` bị từ chối, hạn mức 100 / trần 500, dòng "Tìm data" không mã thao tác), RPC khoá đã quét.
- Chromium (như `v591-smoke`): chạy code block thật trên trang giả dựng theo DOM thật của từng trang (danh sách, trang tin, nút hiện số, tin ẩn số, hộp đăng nhập batdongsan, trang Cloudflare, trang đổi giao diện).
- Đường Desktop qua bộ dựng `desktop-harness.cjs` với block giả theo đúng biến / kết quả của block thật: hết lượt giữa từ khoá, máy tắt giữa từ khoá, Nhóm data nhận đúng Info.
- Giao diện: form và tab Data tìm được trên Chromium với IPC giả.
- Thử thật trên tổ chức 1 bằng app dev: nhatot, Trang Vàng, rồi batdongsan với tài khoản batdongsan của anh.

### 7.10 Thứ tự đưa vào dùng

1. Merge code (một PR: DB + Desktop), chưa apply.
2. Apply migration buổi tối (p1 → p2 → p3; p2 đổi thân claim / report nên làm PostgREST nạp lại schema). Công tắc `web_scan.campaigns` để tổ chức 1. Trước khi apply p3 kiểm bằng bản Desktop đang phát hành và Web / iOS rằng ba loại không hiện ra (dòng `is_active = false`).
3. Thử thật bằng app dev trên tổ chức 1, rồi build Desktop.

## 8. Tình trạng code (21/11/2026, worktree `.claude/worktrees/web-data-scan`, nhánh `claude/web-data-scan`; chưa commit, chưa apply, chưa build)

Anh yêu cầu "Bắt đầu code" sau khi chốt hai câu hỏi của 7.4.

### 8.1 DB: V618 (ba phần + bản gỡ, sinh bằng `node scripts/build-v618-sql.cjs`)

- Thân hàm production đọc 21/11/2026 ở `scripts/fixtures/web-scan/live-20261121/` (md5 kiểm lúc sinh và trong migration).
- p1: bảng `private.auto_web_scan_seen` (tin đã quét theo chiến dịch) và `private.auto_web_scan_listings` (số đã hiện theo tổ chức, dùng lại 30 ngày).
- p2: hàm mới `aka_agent_web_scan_org_enabled`, `aka_agent_web_scan_seen_v1`, `aka_agent_web_scan_record_v1`, `aka_agent_web_scan_retention_v1` (job
  pg_cron 02:41 VN: tin đã quét giữ 180 ngày, số đã hiện 30 ngày); vá thân claim (cổng web chỉ Desktop + tổ chức bật, trả `remainingDaily` /
  `remainingWindow`), report (dòng "Tìm data" nhận cả `web`), action_limit (mã `web_*` mặc định 100 / ngày, trần 500 theo setting, khung giờ = ngày
  trong 60 phút), finish (chạy lại sau N giờ), snapshot tài khoản Desktop (khoá `webScan`), gói (nền tảng `web` theo gói Facebook / Zalo), nháp
  chiến dịch (`aka_agent_campaign_drafts` nhận ba loại web dù `is_active = false`), dọn lượt bỏ dở (`aka_agent_engine_close_run_v1`: lượt quét
  web bị bỏ dở thì từ khoá về hàng đợi dù đã có kết quả; loại khác giữ nguyên).
- p3: setting `web_scan.campaigns` (tổ chức 1, giới hạn anh chốt), 3 mã thao tác (`operation_class = read`), 3 loại chiến dịch (`is_active = false`),
  8 block `[engine] web_*`, 8 element, mã lỗi WB01–WB04 + chính sách, chặn theo thao tác (mỗi lần dùng tính một lượt), 3 quy tắc đẩy SĐT sang
  "Nhắn tin theo SĐT" (V608).
- WB02 (chưa đăng nhập batdongsan) khoá riêng "Hiện số batdongsan" 30 phút rồi thử lại, không khoá vô hạn: app chưa biết cookie nào báo đã đăng nhập.
- Kiểm: `LC_ALL=C CHAT_REPO=<akaAgentChatApi> node scripts/web-scan/v618-smoke.cjs` (PG17, 15 nhóm, có apply lại bị từ chối và gỡ về đúng md5).

### 8.2 Block (code ở `scripts/web-scan/blocks/`, bộ sinh ghép `block-common.js` + `page-common.js`)

- Mở trang bằng `page.open(url)` mới của PageController (xong ở `dom-ready`, có hạn 30 giây). `page.navigate` chờ mọi tài nguyên: trang tin nhatot
  không bao giờ xong (thử 21/11: treo hơn 10 phút).
- Script trong trang chỉ kiểm một lần rồi trả `{ pending }`, block tự gọi lại (`evaluateReady`): Cloudflare tải lại trang khi qua bước kiểm tra,
  script đang chạy dở trên trang cũ thì lời gọi không bao giờ trả về.
- Cửa sổ chạy ngầm của tài khoản Website chạy script bằng `mainFrame.executeJavaScript` (`PageController` tuỳ chọn `immediateScripts`):
  `webContents.executeJavaScript` của Electron 33 đợi trang hết "đang tải" mới chạy, mà trang nhatot có script quảng cáo (`btloader.com`) treo 30 giây
  (thử 21/11: DOM xong ở 1,4 giây, mỗi lần đọc trang vẫn chờ 31 giây; sau khi đổi: danh sách 1,3 giây, hiện số 0,5–2 giây). Facebook / Zalo giữ cách cũ.
- Chạy sớm như vậy thì trang nhatot chưa gắn sự kiện React: nút "Hiện SĐT" có sẵn nhưng bấm chưa ăn, chữ trang còn câu "ẩn số điện thoại" của khung
  mẫu (thử 21/11: báo nhầm 2/4 tin là ẩn số). Script hiện số chờ nút có khoá `__reactProps` / `__reactFiber` rồi mới bấm, chỉ kết luận ẩn số khi chờ
  hết hạn vẫn không có nút (thử lại 4/4 tin ra số). Link tin bỏ phần `#…` (tin quảng cáo có đuôi `#px=…`).
- batdongsan gõ từ khoá bằng setter gốc của ô + sự kiện input / keyup (gợi ý hiện đúng). Không dùng `insertText` của Electron: gọi khi ô chưa được chọn
  thì treo cả trang (thử 21/11).
- Thử trên trang thật (`node scripts/web-scan/live-blocks-check.cjs <thư mục>`, Electron của repo, cửa sổ ẩn, UA thật; SĐT in ra đã che):
  Trang Vàng danh sách 1–2 giây / trang (38 doanh nghiệp), trang chi tiết 0,6–1 giây; nhatot (sau khi đổi cách chạy script ở trên) danh sách
  1,3 giây, hiện số 0,5–4 giây (ra số + địa chỉ đầy đủ); batdongsan: hồ sơ mới gặp "Chờ một chút..." của Cloudflare, qua sau
  ~6 giây; tìm "quận 7" → `/nha-dat-ban-quan-7`, "Vinhomes Grand Park" (cho thuê) → `/nha-dat-cho-thue-vinhomes-grand-park`; danh sách 20 thẻ
  ~3 giây; bấm hiện số khi chưa đăng nhập → hộp đăng nhập (`loginRequired`); trang tin cho địa chỉ đầy đủ (có tên phường mới).
- Số tin tổng ("Hiện có N bất động sản") của batdongsan chưa đọc được (trang đổi chữ), chỉ dùng trong câu tiến trình.

### 8.3 Desktop

- Tài khoản "Website" (`flatform_type = 'web'`): AccountPanel, quyền theo `webScanEnabled` (chốt lúc đăng nhập từ `web_scan.campaigns`), tạo với
  "đã đăng nhập", AutoCheck bỏ qua, tab Trình duyệt và cửa sổ chạy ngầm giữ UA thật của Electron; tab mở trang đầu có link tới ba trang (trang
  Trình duyệt không có ô địa chỉ).
- Bộ chạy: `DesktopEngineRunner.runWeb` ([desktopWebRunner.ts](../src/main/engineAdapters/web/desktopWebRunner.ts)) + vòng một từ khoá
  [webScanTarget.ts](../src/main/engineAdapters/web/webScanTarget.ts) (thuần logic) + phiên của bộ lập lịch (`openWebEngineUnit` /
  `runWebEngineTarget`: trang chạy ngầm, vết thao tác, block treo 5 phút thì đóng cửa sổ ngầm; `pushWebScanRecords`: Nhóm data loại SĐT có
  Info1–5 / email / extraData, rồi đường đẩy V608). Chiến dịch web không bao giờ chạy bộ cũ.
- Form ([WebScanFormSections.tsx](../src/renderer/src/components/CampaignPanels/WebScanFormSections.tsx)): Cấu hình tìm kiếm, Thông tin lấy thêm,
  Danh sách từ khoá (mỗi dòng một data; Trang Vàng nhận cả link), Xử lý data tìm được (dùng lại phần SĐT của Tìm data Facebook), Lịch (+ chạy lại
  sau mỗi), Giới hạn (mặc định 100 / ngày, khung giờ = ngày, nghỉ 15 giây, thấp nhất 10). Form AI không hiện ba loại.
- Tab "Data tìm được" + Excel ([webScanFoundData.ts](../src/renderer/src/components/CampaignPanels/webScanFoundData.ts)): đọc `data.webRecords`
  của các dòng lịch sử, bỏ trùng theo SĐT; Excel 9 cột đầu theo mẫu Nhóm data (Tên, Uid, Sđt, Email, Info1–5), rồi từ khoá, ngày, các trường.
- Kiểm: `node scripts/web-scan/runner-smoke.cjs` (14 nhóm, block giả: đếm lượt, WB01–WB04, NET01, SYS99, RUN01, tin đã quét, số dùng lại, nghỉ,
  đẩy theo trang, so mã giữa lõi / shared / bộ sinh); `node scripts/web-scan/live-runner-check.cjs <thư mục>` (vòng thật trên trang thật, API lõi
  giả; 21/11: Trang Vàng 60 SĐT / 2 lượt, nhatot 2 lượt rồi WB03, batdongsan tới hộp đăng nhập rồi WB02); hai typecheck sạch; bài kiểm có sẵn của
  engine Facebook trên Desktop (`desktop-fb-smoke.cjs` 57 nhóm, `electron-real-smoke.cjs` 6 nhóm) vẫn đạt.

### 8.4 Giả lập trọn đường (21/11/2026, anh yêu cầu "giả lập test giúp tôi, tự test giúp tôi")

- `LC_ALL=C CHAT_REPO=<akaAgentChatApi> node scripts/web-scan/desktop-web-sim.cjs` (chạy trong Electron của repo, ~5 phút; `WEB_SIM_ONLY=a|b` chạy
  riêng ca có tên chứa a hoặc b): bộ lập lịch Desktop thật (esbuild) → hàng đợi `runAccountCampaignQueue` → `DesktopEngineRunner.runWeb` → lõi →
  hàm engine thật + V618 trên PG17 cục bộ (thân production 21/11) → block `[engine] web_*` đọc từ DB → `PageController` thật trên cửa sổ ẩn →
  trang thật. Chỉ giả Supabase (client nối PG), Nhóm data / đẩy chiến dịch (ghi lại yêu cầu). Ca lỗi trang dùng máy chủ cục bộ thay trang thật
  (chuyển hướng yêu cầu của cửa sổ ngầm). SĐT in ra đã che.
- `node scripts/web-scan/form-ui-smoke.cjs` (`WEB_FORM_SHOTS=<thư mục>` để chụp): form thật trên Electron với IPC giả: nút "Website" chỉ ba loại,
  mặc định (môi giới, 100 / ngày, nghỉ 15 giây), từ khoá bỏ trùng thành data, nghỉ / giới hạn kẹp theo DB, Trang Vàng tỉnh + link (link sai bị
  chặn), sửa chiến dịch đọc lại cài đặt, Data tìm được + Excel.
- Lỗi tìm ra và đã sửa:
  - Lượt dừng giữa từ khoá (hết lượt WB03, chưa đăng nhập WB02, tạm dừng / thoát app RUN01, lỗi mạng NET01) mà kết quả mang mã thao tác của
    trang thì dòng chính sách "chỉ có mã thao tác" của V618 (mỗi lần dùng tính một lượt, chạy tiếp) được hàm chọn chính sách áp sau cùng, đè lên
    chính sách của mã lỗi: tính thêm một lượt (hạn 2 lượt mà đếm 3), không dừng lượt. Sửa: kết quả dừng báo không kèm mã thao tác (dòng "Tìm
    data"); khoá "Hiện số batdongsan" của WB02 nằm ở chính sách của mã lỗi nên vẫn khoá đúng 30 phút.
  - Form đòi "Vui lòng nhập nội dung chiến dịch hoặc chọn ít nhất một ảnh." khi lưu chiến dịch web (không có nội dung): bỏ điều kiện cho ba loại web.
  - Cửa sổ "Cập nhật nội dung + media" hiện ô nội dung cho chiến dịch web: ẩn như Tìm data Facebook. Cửa sổ "Cập nhật giới hạn gửi" lưu được nghỉ
    dưới 10 giây: kẹp theo mức của DB như form.
  - Mở trang quá thời gian chờ ("Mở trang quá 30 giây") từng ra lỗi chung SYS99 (cộng chuỗi data lỗi): nay là NET01 (về hàng đợi) như lỗi mạng.
- Các ca đã chạy (21/11, 13/13 đạt): Trang Vàng từ khoá × tỉnh + mở trang chi tiết (mỗi lần mở trang một dòng tính lượt, data vào Nhóm data đủ
  Info1–5 / email / trường), chạy lại bỏ doanh nghiệp đã quét; nhatot hạn 2 lượt → bấm 2 lần rồi WB03 (từ khoá về hàng đợi), lượt sau chờ hạn mức
  (LIM01) không bấm thêm; chiến dịch nhatot khác cùng tổ chức dùng lại số đã hiện, không bấm lại tin đó; batdongsan chưa đăng nhập → 🔎 trang kết quả
  của ô tìm, WB02 khoá "Hiện số batdongsan" 30 phút, lượt sau chờ; tạm dừng giữa từ khoá (RUN01, về hàng đợi, không tính lượt); thoát app giữa block
  (dừng ngay, nhả tài khoản, mở lại chạy tiếp không lấy lại tin đã lấy); tổ chức bị tắt giữa phiên (không chạy, không rơi về bộ cũ); Trang Vàng
  đổi giao diện (WB04 mỗi từ khoá một dòng "thất bại", 3 từ khoá liền thì tạm dừng chiến dịch); máy chủ từ chối / trang treo 30 giây (NET01, về
  hàng đợi, chiến dịch giữ "chờ xử lý" kèm ghi chú); app chết ngang không kịp báo; cuối cùng hạn mức ngày khớp đúng số dòng tính lượt.
- App chết ngang / máy ngủ giữa một từ khoá: hàm dọn lượt dùng chung của engine (`aka_agent_engine_close_run_v1`, khi đăng nhập lại hoặc job
  đóng lượt) từng đóng từ khoá là "hoàn thành" kèm "Bị ngắt trước khi gửi (SYS01)" vì lượt đã có kết quả (lần mở trang đã ghi), bỏ phần trang
  còn lại. Anh chốt "Sửa luôn" (21/11): V618 p2 vá thêm hàm này, lượt của chiến dịch web về hàng đợi (quét chỉ đọc, chạy lại bỏ tin đã quét);
  loại chiến dịch khác giữ nguyên (đối chứng trong `v618-smoke`). Production 21/11 có thân `72b8c969…` (khớp bản đọc sáng), thiết lập
  `engine.stale_unsent_target_action` = `requeue_unstarted`. Giả lập: mở lại app thì quét tiếp, bỏ 40 tin đã quét, từ khoá hoàn thành, xoá ghi
  chú bị ngắt.
- Đẩy SĐT sang chiến dịch "Nhắn tin theo SĐT" và Nhóm data (21/11 tối, anh: "Làm bài kiểm đẩy"):
  `LC_ALL=C CHAT_REPO=<akaAgentChatApi> node scripts/web-scan/push-smoke.cjs` (PG17, ~10 giây, 11 nhóm). DB: fixture của bài kiểm V608 + nguyên văn
  V608 → V610 → V614; thân `aka_agent_find_data_push_v1` và 4 hàm khoá / quy tắc kiểm md5 `prosrc` bằng bản production đọc chỉ đọc tối 21/11
  (hàm đẩy `a9298a62…`, sổ tới V617, 11 quy tắc); khối quy tắc của V618 p3 chạy nguyên văn từ file migration. Mã app: lớp `CampaignScheduler`
  thật (esbuild) gọi `pushWebScanRecords` → `findDataPushRepository` / `dataGroupRepository` thật. Đạt: thêm SĐT vào đích (bỏ số đã có dù viết
  khác), mở lại đích "hoàn thành", báo đích chạy bằng Nhóm data / đã xoá / của người khác bằng câu có sẵn, lượt sau không thêm lại, ba trang đẩy
  vào một đích không trùng, sổ đẩy đúng từng nguồn, gói không có Zalo thì đích không nhận, lỗi mạng gửi lại không trùng, Nhóm data lỗi vẫn đẩy
  sang chiến dịch Zalo, bản gỡ p3 xoá quy tắc / liên kết / sổ đẩy của nguồn web và giữ của Facebook. Dòng gửi lên Nhóm data: loại SĐT (mã 34),
  Info1–5 theo lựa chọn, email, `extra_data` có site / link / trường / cờ số dùng lại, cùng lô thì cùng mã yêu cầu. Hàm nạp Nhóm data không có
  trong DB thử: đọc chỉ đọc thân production `aka_agent_ingest_data_group_v186_internal` (md5 `prosrc` `f1bdba98…`) thì hàm đọc `info1`–`info5`,
  `extra_data` của dòng loại `phone`; bản ghi đã có thì giữ `extra_data` cũ (`v_extra || cũ`). Form (`form-ui-smoke`, 9 ca): chọn chiến dịch
  Zalo đích và Nhóm data ở chiến dịch web lưu đúng `findPhoneZaloMessagePhoneTargetCampaignIds` / `findDataTargetDataGroups.phone`, sửa chiến
  dịch hiện lại và giữ. Câu có sẵn khi nguồn bị xoá giữa lượt in mã thô `find_data_push_source_not_found` (đường chung với Tìm data Facebook,
  không sửa).
- Nhận xét (không sửa): bỏ trùng theo tin, không theo số (doanh nghiệp / tin khác cùng số vẫn lấy, Nhóm data tự gộp theo số); nhatot môi giới đăng
  nhiều tin nên vài lần bấm hiện số ra lại số đã có (không biết trước khi bấm); giới hạn ngày nhập quá 500 lưu thành 500 không báo.

### 8.5 Câu cho khách (anh duyệt tối 21/11/2026, 5 lượt hộp chọn)

- Mã lỗi (`auto_error`, bộ sinh V618): WB01 "Trang web đang yêu cầu xác minh truy cập" + bước tiếp theo "Mở tab Website ở trang Trình duyệt, xác
  minh trên trang rồi bấm Tiếp tục chiến dịch"; WB02 "Chưa đăng nhập trang batdongsan.com.vn" (không có bước tiếp theo); WB03 "Đã đủ số lượt trong
  hạn mức, từ khoá này quét tiếp ở lượt sau"; WB04 "Không đọc được danh sách trên trang".
- Tên thao tác: "Hiện SĐT Nhà Tốt", "Hiện SĐT Batdongsan", "Mở trang Trang Vàng". Tên loại chiến dịch: "Tìm data Nhà Tốt", "Tìm data Batdongsan",
  "Tìm data Trang Vàng".
- Dòng tiến trình: `📞 Hiện SĐT Nhà Tốt "<tin>": <SĐT>` (giữ); `♻️ Tin "<tin>" đã có số từ trước: <SĐT>`; `🔎 "quận 7" (bán): Batdongsan mở trang
  "<tiêu đề trang>"` / `🔎 "<từ khoá>" (cho thuê): Batdongsan không có trang kết quả cho từ khoá này`; tổng kết `🔎 Tìm data "<từ khoá>": N SĐT,
  bỏ X tin đã quét, M lần <thao tác>` (anh bỏ phần "số có từ trước"); Trang Vàng `📄 Mở trang Trang Vàng: "<từ khoá>" ở <tỉnh>, trang N (…)` (giữ) và
  trang chi tiết `📄 Mở trang chi tiết: <tên doanh nghiệp>`.
- Form: gợi ý Batdongsan "Batdongsan chỉ tìm được theo tên khu vực hoặc tên dự án, ví dụ "quận 7", "Vinhomes Grand Park". Mỗi từ khoá tìm ở cả
  mục bán và cho thuê."; Nhà Tốt "Mỗi từ khoá tìm ở cả mục mua bán và cho thuê. Từ khoá nên có loại nhà và khu vực, ví dụ "nhà quận 7"."; tỉnh
  Trang Vàng "Không chọn tỉnh thì tìm cả nước. Link dán ở danh sách từ khoá không theo tỉnh."; ô mở trang chi tiết "Mở trang chi tiết từng doanh
  nghiệp (mỗi trang tính một lượt)" / "Mở trang từng tin (chậm hơn)"; giữ: gợi ý "Luôn lấy…" + "Dùng làm biến…", nhãn nghỉ, ô từ khoá.
- Trang đầu tab Website: "Trình duyệt này dùng chung với chiến dịch Tìm data. Đăng nhập batdongsan.com.vn ở đây để lấy được SĐT của Batdongsan."

### 8.6 Chưa làm / chưa kiểm

- Số migration: lúc viết là V614, nhưng production đã có `migration_v614_find_data_push_match_key_v2` (phiên khác), V615–V617 cũng đã dùng;
  tối 21/11 (anh: "Làm luôn") đổi sang **V618** (sổ tới V617, không nhánh / tệp nào giữ V618) bằng bộ sinh `scripts/build-v618-sql.cjs`. Kiểm chỉ
  đọc production cùng lúc: 8 hàm bị vá còn đúng md5 bản đã đọc sáng; bảng `auto_campaign_data_link_rules` không đổi cột; hàm đẩy
  `aka_agent_find_data_push_v1` (md5 `f43d4541…`) chọn theo bảng quy tắc, không điều kiện cứng theo loại nguồn, nên 3 dòng web của p3 khớp;
  mã loại SĐT (`data_type` / `phone`) = 34 như dòng đẩy SĐT đang có. Kiểm lại sổ ngay trước khi apply.
- Chưa chạy trong app thật với DB có V618 (chưa apply). Chưa thử đăng nhập batdongsan thật và bấm hiện số khi đã đăng nhập.
- Nút "Mở trình duyệt" trên ghi chú chiến dịch khi WB01 / WB02 chưa có (câu nháp hướng dẫn mở tab Website).
- Báo cáo, tab Hành động, lý do đang chờ: chưa rà riêng cho ba loại web.
