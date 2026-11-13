# Nhắc gia hạn trong phần mềm — phương án

Ngày 13/11/2026. **Đây là phương án, chưa có mã, chưa đổi DB, chưa deploy gì.** Người dùng đã duyệt hướng làm và 5 quyết
định ở mục 3 cùng ngày. Phạm vi: akaAgent Desktop (repo này), Web/iOS (akaAgentWebApp), cổng gia hạn của CRM
(SqlServerDashboard, `https://crm.akabiz.net/gia-han`).

Mục tiêu: tăng tỷ lệ khách gia hạn, và để khách tự gia hạn nhanh nhất — từ thông báo trong phần mềm tới mã QR thanh toán
trong hai lần bấm, không gõ lại mật khẩu.

Tài liệu liên quan: [màn Gia hạn sau khi hết hạn](RENEWAL_PORTAL_DESKTOP.md), akaAgentWebApp
`docs/LOGIN_RENEWAL_REDIRECT.md`, SqlServerDashboard `docs/trang-gia-han-khach-hang.md`.

## 1. Hiện trạng (đo 13/11/2026, chỉ đọc)

- **Trong phần mềm chưa có thông báo nào trước ngày hết hạn.** Desktop chỉ mở màn Gia hạn sau khi gói đã hết; Web chỉ
  chuyển sang cổng khi đăng nhập bị chặn. Ngày hết hạn chỉ nằm trong "Thông tin tài khoản".
- **CRM cũng không báo trước cho khách.** Lịch việc cho nhân viên bắt đầu từ ngày hết hạn (`PAID_RENEWAL_OFFSETS_LIVE =
  [0, 1, 7, 15]`); SMS trước 3 ngày tắt từ 27/10 (`SMS_PRE3_ENABLED = false`). Không có gì tự gửi tới khách trước hạn.
- **Cổng tự gia hạn** mở 07/11: 1 đơn `self_service` hoàn thành, so với 1.298 đơn do nhân viên lên trong 30 ngày
  (753 `crm_purchase`, 545 `payment_qr`).

| Chỉ số | Giá trị |
|---|---|
| Tổ chức còn hạn akaAgent (sản phẩm 3/10/13/16/17/18) | 1.103 — 1.126 gói trả phí, 43 gói dùng thử |
| Gói trả phí hết hạn trong 30 ngày tới | 385 (34%); 79% gói trả phí là gói 2 tháng (60–61 ngày) |
| Gói dùng thử | đều 3 ngày; 42/43 hết hạn trong 3 ngày tới |
| Hết hạn trong 30 ngày qua, chưa gia hạn | 147 gói trả phí, 240 gói dùng thử |
| Tổ chức sắp hết hạn (≤ 30 ngày) mở app ≤ 5 ngày trong 30 ngày qua | khoảng 208/374 (56%); 32 tổ chức không mở lần nào |
| Tổ chức chỉ có 1 nhân viên | 1.101/1.103 |
| Tổ chức có từ 2 dòng sản phẩm akaAgent còn hạn | 55 (24 tổ chức lệch hạn nhau trên 7 ngày) |
| Tổ chức có email / nhân viên có email | 150 / 61 |

Số ngày dùng Web bị đếm thấp hơn thực tế: DB chỉ ghi lúc đăng nhập (`auto_control_sessions.created_at`), không ghi từng
ngày mở app.

Nếu bật hôm nay: 71 tổ chức ở mức đỏ (còn 0–3 ngày), 35 ở mức vàng (4–7 ngày), 308 ở mức nhãn nhỏ (8–30 ngày).

## 2. Chỉ số cần đạt và mốc so sánh

| Chỉ số | Mốc trước khi làm |
|---|---|
| Tỷ lệ gói trả phí được gia hạn trước hạn hoặc trong 7 ngày sau hạn | chưa có số; chụp nhóm theo dõi trước khi bật (mục 11) |
| Tỷ lệ dùng thử thành trả phí | chưa có số; 240 bản dùng thử hết hạn 30 ngày qua chưa mua |
| Số đơn khách tự gia hạn (`self_service`) | 1 đơn hoàn thành / 30 ngày |
| Thời gian từ lúc bấm Gia hạn tới lúc thanh toán | chưa đo được (đơn chưa ghi nguồn) |

## 3. Quyết định đã chốt (13/11/2026)

1. **Bật link ký số** (bản vá Edge `renewal_link` hoãn từ 04/11): bấm Gia hạn là vào thẳng trang thanh toán, không gõ lại
   mật khẩu.
2. **Mốc 30 ngày với gói 2 tháng:** giữ, nhưng chỉ hiện nhãn nhỏ, không dải thông báo, không hộp thoại.
3. **iOS:** chỉ hiện số ngày còn lại, không đặt nút Gia hạn (sau lần duyệt App Store 03/10 app đã bỏ link nâng cấp/thanh
   toán ở màn đăng nhập).
4. **Có ưu đãi gia hạn sớm** (mục 6). Mức ưu đãi do người dùng đặt.
5. **Thay đổi DB:** viết SQL gửi duyệt trước khi chạy (mục 8). Lưu ý: ưu đãi gia hạn sớm cần thêm **một cột** trên
   `aka_promotion`; các phần còn lại không thêm bảng hay cột.

## 4. Hành vi

### 4.1 Số ngày còn lại

- `số ngày còn lại = ngày hết hạn − hôm nay`, cả hai theo ngày Việt Nam. Số 0 là ngày cuối còn dùng được — trùng quy tắc
  đăng nhập hiện tại (`expiration_date ≥ đầu ngày VN`).
- Lấy ngày từ máy chủ, không lấy đồng hồ máy khách.
- Nhóm Facebook (3/10) và Zalo (16/18) tính theo dòng hết hạn **xa nhất** trong nhóm, đúng như `accountProducts` của
  Desktop đang gộp: nhóm chỉ thật sự hết khi dòng cuối cùng hết.
- Không nhắc: gói vĩnh viễn (thời hạn từ 9.000 ngày), gói còn trên 60 ngày, nhân viên hết hạn do quản trị tổ chức đặt
  (`use_staff_expiration`), tổ chức ở chế độ tách quyền chưa vào được app.

### 4.2 Mốc và mức hiển thị — gói trả phí

Mốc: 30, 14, 7, 5, 3, 1 ngày và ngày hết hạn. "Giai đoạn" là mốc nhỏ nhất còn lớn hơn hoặc bằng số ngày còn lại, nên
khách không mở app đúng ngày mốc vẫn thấy thông báo của giai đoạn đó ở lần mở kế tiếp.

| Giai đoạn | Còn lại | Hình thức | Tắt được |
|---|---|---|---|
| 30 | 30–15 ngày | Nhãn nhỏ "Còn N ngày" + nút Gia hạn trên thanh trên cùng. Gói dài hơn 2 tháng có thêm dải thông báo một lần; **gói 2 tháng chỉ có nhãn** | Dải: có, tới giai đoạn sau |
| 14 | 14–8 ngày | Nhãn nhỏ + dải thông báo một lần | Có, tới giai đoạn sau |
| 7 | 7–6 ngày | Dải vàng + hộp thoại một lần | Trong ngày |
| 5 | 5–4 ngày | Dải vàng + hộp thoại một lần | Trong ngày |
| 3 | 3–2 ngày | Dải đỏ luôn hiện + hộp thoại mỗi ngày một lần | Chỉ thu gọn thành nhãn |
| 1 | 1 ngày | Như giai đoạn 3 | Chỉ thu gọn |
| 0 | Ngày hết hạn | Dải đỏ + hộp thoại mỗi lần mở app, đồng hồ đếm tới 24:00 | Không |

Nhãn nhỏ luôn hiện từ giai đoạn 30 tới khi gia hạn xong; bấm vào nhãn mở cùng luồng Gia hạn.

### 4.3 Dùng thử

- Bộ đếm hiện từ lần đăng nhập đầu, trên thanh trên cùng: "Dùng thử còn 2 ngày 5 giờ"; ngày cuối đếm giờ:phút:giây tới
  24:00. Nút **Nâng cấp** luôn đi kèm.
- Hộp thoại khi còn 1 ngày và ở ngày cuối (mỗi lần mở app).
- Sau khi hết hạn: giữ luồng hiện có (màn Gia hạn, trang hết hạn dùng thử, xin thêm 3 ngày). Khi được cộng 3 ngày, bộ đếm
  tính lại theo hạn mới.

### 4.4 Nhắc theo thói quen đăng nhập

Lý do: 56% tổ chức sắp hết hạn mở app không quá 5 ngày mỗi tháng, nên nhiều khách không có mặt ở các mốc 7/5/3/1.

- **Ngày có đăng nhập** của một nhân viên, trong 60 ngày gần nhất, gộp mọi thiết bị:
  - Desktop: ngày VN của `started_at` và `last_seen_at` mỗi dòng `auto_staff_device_presence` (mỗi lần mở app là một dòng).
  - Web/iOS: ngày VN của `created_at` mỗi dòng `auto_control_sessions`.
  - Luôn tính cả hôm nay.
- **Chu kỳ** = trung vị khoảng cách (ngày) giữa các ngày có đăng nhập liền nhau, tối thiểu 1. Cần ít nhất 3 ngày có đăng
  nhập; thiếu thì chỉ dùng mốc ngày ở 4.2.
- **Số lần đăng nhập còn lại** = số ngày còn lại chia chu kỳ, làm tròn xuống.
- Còn **3 lần trở xuống**: hiện thông báo ở mức giai đoạn 7 (dải vàng + hộp thoại một lần) dù chưa tới mốc ngày. Còn **1
  lần trở xuống**: mức giai đoạn 1 (dải đỏ, hộp thoại). Luôn lấy mức mạnh hơn giữa mốc ngày và thói quen.
- Chỉ áp dụng khi gói còn từ 60 ngày trở xuống.

| Thói quen | Chu kỳ | Bắt đầu nhắc theo thói quen khi còn |
|---|---|---|
| Mở hằng ngày | 1 | 3 ngày (trùng mốc 3) |
| 3 ngày một lần | 3 | 11 ngày |
| Mỗi tuần một lần | 7 | 27 ngày |
| 10 ngày một lần | 10 | 39 ngày |
| 15 ngày một lần trở lên | ≥ 15 | 59–60 ngày (chạm trần 60) |

Hạn chế đã biết: phiên Web giữ nhiều ngày nên số lần đăng nhập Web thấp hơn số ngày thật sự dùng; chu kỳ tính ra dài hơn,
tức nhắc sớm hơn — lệch về phía an toàn. App Desktop để mở liên tục cũng vậy, và khi đó dải thông báo vốn luôn trước mắt
khách.

### 4.5 Nội dung (bản nháp, cần người dùng duyệt câu chữ)

| Tình huống | Câu | Nút |
|---|---|---|
| Nhãn nhỏ | Còn 12 ngày | Gia hạn |
| Mốc ngày | Gói akaAgent Zalo – 2 tháng còn 7 ngày (hết hạn 20/11/2026). Gia hạn hôm nay, hạn mới cộng tiếp từ 20/11 nên không mất ngày nào. | Gia hạn |
| Có ưu đãi gia hạn sớm | …thêm dòng: Gia hạn trước 13/11 được tặng thêm N ngày. | Gia hạn |
| Theo thói quen | Gói … còn 28 ngày. Bạn thường mở phần mềm khoảng 10 ngày một lần, nên chỉ còn khoảng 2 lần đăng nhập trước khi gói hết hạn. | Gia hạn |
| Lần đăng nhập cuối | Gói … còn 6 ngày. Đây có thể là lần đăng nhập cuối của bạn trước khi gói hết hạn. | Gia hạn ngay |
| Ngày hết hạn | Gói … hết hạn hôm nay. Sau 24:00 phần mềm sẽ ngừng chạy chiến dịch. | Gia hạn ngay |
| Dùng thử | Bản dùng thử … còn 1 ngày 3 giờ. Nâng cấp để giữ nguyên tài khoản và chiến dịch đã tạo. | Nâng cấp |
| Sau khi thanh toán | Đã gia hạn gói … tới 19/01/2027. | — |

Câu "cộng tiếp từ hạn hiện tại" đúng với mã CRM đang chạy (`calculateRenewalExpiration`, chế độ `renewal`) cho gói trả phí
còn hạn. Gói dùng thử tính từ lúc thanh toán nên không dùng câu này.

### 4.6 Ai thấy, nhiều sản phẩm

- Mọi nhân viên đang hoạt động của tổ chức đều thấy (1.101/1.103 tổ chức chỉ có 1 nhân viên). Có sẵn tuỳ chọn chỉ hiện cho
  quản trị tổ chức trong khóa cấu hình, mặc định tắt.
- Tổ chức nhiều sản phẩm: nhắc sản phẩm hết hạn sớm nhất, ghi thêm "và N gói khác"; hộp thoại liệt kê đủ.

### 4.7 Trạng thái "đã xem"

Lưu tại máy (Desktop: tệp trong `userData`; Web: `localStorage`), không ghi DB. Khóa theo
`<id dòng sản phẩm>:<ngày hết hạn>`, nên gia hạn xong (ngày hết hạn đổi) là tự bắt đầu lại. Đổi máy thì khách thấy lại
thông báo của giai đoạn hiện tại một lần — chấp nhận được.

## 5. Bấm "Gia hạn" tới mã QR

Luồng đích: bấm **Gia hạn** → trang thanh toán nhanh đã chọn sẵn đúng gói đang dùng → bấm **Tạo mã QR thanh toán** → quét
→ hệ thống tự nâng cấp (webhook SePay và engine nâng cấp đã có).

**Link:** `https://crm.akabiz.net/gia-han?t=<JWT>&next=<trang>&src=<nguồn>`

- `t`: JWT HS256 (`aud = akabiz-renewal-link`, `sub = org_staff.id`, `opid = id dòng sản phẩm cần gia hạn`, sống 10 phút).
  Luôn gửi `opid`: tổ chức nhiều sản phẩm mà thiếu `opid` thì cổng chọn sẵn mọi sản phẩm.
- `next`: gói trả phí còn hạn → `/gia-han/het-han-goi`; dùng thử còn hạn → `/gia-han/het-han-dung-thu`. Hai trang này có
  thẻ thanh toán nhanh; nếu không gửi `next`, gói còn hạn rơi vào trang Nâng cấp (giỏ hàng đầy đủ, nhiều bước hơn).
- `src`: nguồn và mốc để đo, dạng `desktop.d7`, `web.d3`, `web.u2` (`d` = mốc ngày, `u` = số lần đăng nhập còn lại),
  `banner.d14` (kênh ở Đợt 0). Chỉ dùng để thống kê, không dùng để phân quyền.

**Ký link:**

- Desktop: Edge `aka-agent-desktop-session`, action `renewal_link` — bản vá đã viết sẵn ở
  [RENEWAL_PORTAL_DESKTOP.md](RENEWAL_PORTAL_DESKTOP.md), không cần sửa thêm. Main đang giữ thông tin đăng nhập trong RAM
  (`getCurrentUserCredentials`) nên gọi được khi đang đăng nhập. Link chỉ đi trong main, không qua renderer.
- Web: API thêm `POST /renewal/link`, ký bằng `node:crypto` (API chưa có thư viện JWT, không cần thêm). Kiểm `opid` thuộc
  đúng tổ chức của phiên.
- Khóa `RENEWAL_PORTAL_LINK_SECRET` phải cùng giá trị ở ba nơi: Supabase Edge secrets, Fly `aka10000` (CRM), Fly
  `aka-agent-web-app` (API Web).
- Ký lỗi hoặc chưa có khóa: mở link thường `/gia-han?next=…`, khách đăng nhập cổng bằng mật khẩu như hiện nay.

**Chỗ mở:**

- Desktop: cửa sổ nổi ngay trong app, dùng lại `RenewalWebService` (phân vùng `akaagent_renewal`, chặn điều hướng ngoài
  cổng, xoá dữ liệu khi đóng). Chiến dịch vẫn chạy nền trong lúc khách thanh toán. Có nút "Mở bằng trình duyệt".
- Web: tab mới.

**Sau khi thanh toán:** Desktop đang đọc lại gói mỗi 30 giây và đã nghe tiêu đề `RENEWAL_ORDER_COMPLETED_TITLE`; khi thấy
tiêu đề thì đọc lại ngay, thông báo tự ẩn, hiện câu "Đã gia hạn…". Web đọc lại khi khách quay về tab.

## 6. Ưu đãi gia hạn sớm

- **Điều kiện:** gói trả phí còn hạn, gia hạn khi còn ít nhất N ngày (đề xuất N = 7, tức áp dụng trong các giai đoạn 30,
  14, 7). **Lợi ích:** tặng thêm ngày (`bonus_days`), cùng kiểu với 3 chương trình đang chạy.
- **Kỹ thuật (CRM):** hệ thống khuyến mại hiện không có điều kiện theo số ngày trước hạn. Thêm cột
  `aka_promotion.min_days_before_expiry` (số nguyên, NULL = không điều kiện); `isPromotionEligible` xét thêm hạn hiện tại
  của dòng sản phẩm; trang *Chương trình khuyến mại* thêm một ô. Chương trình không mã nên cổng tự áp vào báo giá và mã QR.
- **Hiện trong app:** thông báo thêm dòng "Gia hạn trước dd/mm được tặng thêm N ngày"; qua hạn chót thì dòng này mất.
- **Cần lưu ý:** mỗi dòng đơn chỉ nhận một chương trình (cái lợi nhất). Hiện có 3 chương trình tặng ngày không mã, phạm vi
  `both`, đang chạy; mức gia hạn sớm phải cao hơn mức của chúng thì mới có tác dụng.
- **Chưa chốt:** số ngày tặng cho từng loại gói, và N.

## 7. Việc theo từng nơi

### 7.1 Quy tắc dùng chung

Một mô-đun thuần `renewalReminder.ts`: đầu vào là danh sách gói, ngày máy chủ, các ngày có đăng nhập, cấu hình, trạng thái
đã xem; đầu ra là thông báo cần hiện (hoặc không). Viết ở akaAgentWebApp `packages/control-api`, chép nguyên văn sang
`src/shared` của Desktop như các hợp đồng khác (sửa ở WebApp trước).

### 7.2 CRM (SqlServerDashboard)

- `client/src/pages/gia-han/package-expired-page.tsx`: nhãn "Gói đã hết hạn" và tiêu đề trang đang ghi cứng; đổi theo
  trạng thái — gói còn hạn hiện "Còn N ngày · hết hạn dd/mm" và "Gia hạn sớm, hạn mới cộng tiếp từ hạn hiện tại".
  (`trial-expired-page.tsx` đã xử lý đúng trường hợp còn hạn.)
- Trang đăng nhập cổng đọc `src`, đưa vào phiên, `createPortalOrder` ghi `custom_config.entry` (cột jsonb có sẵn). Trang
  *Khách tự gia hạn* thêm cột và bộ lọc nguồn.
- Ưu đãi gia hạn sớm (mục 6).
- Đặt `RENEWAL_PORTAL_LINK_SECRET` trên Fly `aka10000` nếu chưa có.

### 7.3 API Web (akaAgentWebApp `apps/api`)

- `GET /renewal/reminder`: trả ngày máy chủ, mọi dòng sản phẩm akaAgent của tổ chức (kèm cờ dùng thử — `/me` hiện bỏ
  `package_type` và chỉ có Zalo/SMS), các ngày có đăng nhập, ưu đãi gia hạn sớm, cấu hình. Gọi một lần khi mở app, khi
  sang ngày mới, khi quay lại tab sau lúc mở cổng. **Không** nằm trong vòng `/me` 60 giây.
- `POST /renewal/link` (mục 5). Ghi một dòng log mỗi lần ký để đếm lượt bấm.
- Job của Đợt 0 (mục 10).
- `GET /app-notification` với client iOS: bỏ link của thông báo nhắc gia hạn (quyết định 3).

### 7.4 Web (`apps/web`)

Dải thông báo đặt cạnh `AppNotificationBar` trong `AppShell`, nhãn đếm ngược ở đầu trang, hộp thoại theo mốc. Sửa luôn
"Thông tin tài khoản" để hiện số ngày còn lại và nút Gia hạn.

### 7.5 Desktop (repo này)

- Dữ liệu gói đã có sẵn: `AuthUser.accountProducts` có `organizationProductId`, `packageType`, `expirationDate`, và được
  cập nhật mỗi 30 giây (`AUTH_USER_UPDATED`). Mốc ngày không cần đọc DB thêm.
- Các ngày có đăng nhập và ưu đãi: một RPC chỉ đọc mới (mục 8), gọi một lần lúc đăng nhập và lúc sang ngày (đồng hồ 00:05
  có sẵn). RPC lỗi hoặc chưa có: chỉ dùng mốc ngày.
- Giao diện: nhãn trong `AppUtilityTopbar`, dải cạnh `AppNotificationBar` (`App.tsx`), hộp thoại, "Thông tin tài khoản"
  (`AccountProfileModal`) thêm số ngày còn lại và nút Gia hạn.
- Cửa sổ gia hạn khi đang đăng nhập: `RenewalWebService` và các handler `AUTH_RENEWAL_WEB_*` hiện chỉ chạy khi có
  `pendingRenewal` (chưa đăng nhập); thêm chế độ "đang đăng nhập" dùng phiên hiện tại.
- App Server không có giao diện, không đổi.

### 7.6 iOS (`apps/mobile`)

Chỉ hiện "Gói … còn N ngày" ở Cài đặt và Tổng quan, không nút, không link. Cần bản build mới và duyệt App Store.

## 8. Thay đổi DB — đều phải gửi SQL duyệt trước khi chạy

| # | Thay đổi | Loại | Thuộc | Đợt |
|---|---|---|---|---|
| 1 | Dòng `auto_system_settings` khóa `renewal.reminder` | dữ liệu | akaAgent | 0 |
| 2 | Cột `aka_promotion.min_days_before_expiry` (số nguyên, cho phép NULL) | thêm cột | CRM | 0 |
| 3 | Hàm `aka_agent_renewal_reminder_state()` — chỉ đọc, STABLE, EXECUTE chỉ `aka_agent_desktop`, lấy nhân viên từ phiên; trả ngày máy chủ, các ngày có đăng nhập 60 ngày, ưu đãi gia hạn sớm | hàm mới | akaAgent | 2 |
| 4 | Loại thông báo "Gói sắp hết hạn" trong trung tâm thông báo (V457) | sửa hàm | akaAgent | 3 |

- Mục 3 cần vì `auto_staff_device_presence` chỉ `service_role` đọc được; Web không cần hàm này (API đọc thẳng).
- Số migration lấy theo sổ chung lúc làm (kiểm `supabase_migrations.schema_migrations` và `git log --all`).
- Mục 2, 3, 4 là DDL, làm PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm.

## 9. Khóa cấu hình `renewal.reminder`

Một dòng JSON, đọc theo cách các công tắc hiện có (Web: `webPollingSettings`; Desktop: cùng câu đọc cài đặt lúc đăng
nhập). **Thiếu dòng hoặc sai định dạng = tắt.**

| Trường | Ý nghĩa | Mặc định đề xuất |
|---|---|---|
| `audience` | `off` / `admin_akabiz` / `all` | bắt đầu `admin_akabiz` |
| `milestones` | các mốc ngày | `[30,14,7,5,3,1,0]` |
| `popupFromDays` | từ mốc nào có hộp thoại | 7 |
| `lockedFromDays` | từ mốc nào không tắt được | 3 |
| `shortPackageDays` | gói ngắn: mốc 30 chỉ hiện nhãn | 61 |
| `usageCycles` | số lần đăng nhập còn lại để bắt đầu nhắc | 3 |
| `usageWindowDays` / `usageMaxDaysLeft` / `usageMinLoginDays` | cửa sổ tính thói quen | 60 / 60 / 3 |
| `adminOnly` | chỉ quản trị tổ chức thấy | `false` |
| `legacyBanner` | bật kênh Đợt 0 | `true` |

## 10. Lộ trình

**Đợt 0 — không cần phát hành app.**

1. Bật link ký số: áp bản vá Edge, đặt khóa ở ba nơi (mục 5).
2. CRM: sửa trang hết hạn gói cho gói còn hạn, ghi nguồn đơn, ưu đãi gia hạn sớm.
3. Kênh có sẵn `org_staff.app_notification`: Desktop 9.x, Web và iOS đều đã đọc cột này trước thông báo chung và đã hiện
   dải có nút link. Một job trong API Web ghi thông báo theo mốc cho nhân viên của tổ chức sắp hết hạn:
   - Nội dung: `{title, message, level, linkLabel: "Gia hạn", linkUrl, kind: "renewal_reminder"}`. Bộ đọc hiện tại bỏ qua
     trường lạ nên `kind` an toàn với bản cũ.
   - Chạy lúc 00:10 VN để cập nhật số ngày, và 15 phút một lần để gỡ thông báo của tổ chức vừa gia hạn. Chỉ ghi khi nội
     dung đổi; chỉ sửa/xoá thông báo có `kind` của chính nó.
   - Khối lượng: khoảng 414 tổ chức trong cửa sổ 30 ngày, tối đa một lượt ghi nhỏ mỗi tổ chức mỗi ngày.
   - Đã kiểm 13/11: 0 nhân viên đang dùng cột này; hai trigger nhạy cảm trên `org_staff` (khoá máy, ghi nhớ đăng nhập)
     không phản ứng khi chỉ ghi cột này.
   - Hạn chế: link thường nên khách gõ mật khẩu ở cổng (link ký số cần mã phía app), không tắt được, không đếm ngược, không
     có quy tắc thói quen đăng nhập.

**Đợt 1 — Web** (deploy API/Web): đủ hành vi ở mục 4 và 5. Khi bản mới chạy, client bỏ qua thông báo `kind =
renewal_reminder` của Đợt 0 để không hiện hai dải.

**Đợt 2 — Desktop** (phát hành bản mới): đủ hành vi, gồm cửa sổ gia hạn trong app. Khách tự cập nhật nên phủ chậm; máy
chưa cập nhật vẫn có kênh Đợt 0.

**Đợt 3 — ngoài app và iOS:** thông báo chuông + email "Gói sắp hết hạn" cho khách ít mở app (email chỉ tới được khoảng
150 tổ chức có email); đưa "số lần đăng nhập còn lại" vào ưu tiên việc gia hạn của CRM; iOS hiện số ngày.

Mở dần ở mỗi đợt: `admin_akabiz` → một nhóm tổ chức thử → `all`.

## 11. Đo lường

- **Trước khi bật:** chụp danh sách gói sẽ hết hạn trong 45 ngày tới (id dòng sản phẩm, ngày hết hạn, loại gói) làm nhóm
  theo dõi; đối chiếu sau với đơn gia hạn hoàn thành (`aka_sale_order_item.is_gia_han`).
- **Phễu:** số link được ký (log API/Edge) → đơn tạo (`custom_config.entry`) → đơn thanh toán → đơn kích hoạt, tách theo
  nguồn và theo mốc.
- **Kết quả:** các chỉ số ở mục 2, so nhóm đã thấy thông báo với nhóm chưa thấy trong giai đoạn mở dần.
- Không thêm bảng sự kiện ở các đợt đầu; cân nhắc lại nếu cần đo lượt hiển thị.

## 12. Kiểm thử

- Quy tắc dùng chung: bảng ca theo ngày (đúng mốc, giữa mốc, ngày cuối, qua nửa đêm VN, gói 2 tháng và gói năm, gói vĩnh
  viễn, nhiều sản phẩm, dùng thử, đủ và thiếu dữ liệu đăng nhập, sau khi gia hạn).
- Chạy lại quy tắc trên dữ liệu thật (chỉ đọc) trước khi bật: số tổ chức ở từng mức phải khớp số đo tay ở mục 1.
- Web: Playwright cho dải, hộp thoại, mở link, tự ẩn sau gia hạn. Desktop: smoke Electron theo cách các script hiện có;
  hai typecheck phải sạch.
- Cổng: bộ mô phỏng vòng đời của CRM thêm ca "gia hạn khi còn hạn qua thanh toán nhanh" và ca ưu đãi gia hạn sớm.
- Thanh toán thật một đơn nhỏ trên tổ chức thử trước khi mở cho khách.

## 13. Tài nguyên và rủi ro

- **Không thêm vòng hỏi định kỳ lên DB từ máy khách.** Web: một lượt `GET /renewal/reminder` mỗi lần mở app/ngày. Desktop:
  một RPC mỗi lần đăng nhập/ngày. Ký link chỉ khi bấm.
- **Nhắc quá nhiều làm khách khó chịu:** mức nhẹ tắt được; mọi ngưỡng nằm trong khóa cấu hình, đổi không cần phát hành.
- **Tắt khẩn cấp:** `audience = off` (app), `legacyBanner = false` (kênh Đợt 0, job tự gỡ thông báo của nó).
- **Thông báo còn hiện sau khi đã gia hạn:** bản mới tự ẩn trong 30 giây (Desktop) hoặc khi quay lại tab (Web); kênh Đợt 0
  gỡ trong tối đa 15 phút.
- **Khóa ký lộ:** token sống 10 phút, khóa chỉ ở máy chủ, không vào bộ cài.
- **Khách ít mở app** (32 tổ chức sắp hết hạn không mở lần nào trong 30 ngày): thông báo trong app không tới được; phụ
  thuộc Đợt 3 và việc của nhân viên CRM.

## 14. Còn cần người dùng cung cấp

1. Mức ưu đãi gia hạn sớm: số ngày tặng theo loại gói, và N (đề xuất 7).
2. Duyệt câu chữ ở mục 4.5.
3. Duyệt SQL của từng thay đổi ở mục 8 khi tới đợt tương ứng.
