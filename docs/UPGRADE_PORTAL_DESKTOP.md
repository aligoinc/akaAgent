# Nâng cấp và mua gói trên Desktop

Từ 19/11/2026 (người dùng chốt: "Đối với phần mềm sao ko làm theo hướng Open form. Trong form đó kéo trang crm vào", rồi "Đồng ý
phương án- thực thi"): mọi lối gia hạn / nâng cấp trong phần mềm mở **chung một form trong phần mềm**, trong form nhúng trang
Nâng cấp của cổng CRM (`https://crm.akabiz.net/gia-han/nang-cap`). Phần mềm không có trang mua riêng: giá, đơn, thanh toán và
bật dùng thử nằm ở cổng. Phương án đủ các đợt: akaAgentWebApp `docs/UPGRADE_AND_BUY_PLAN.md` (mục 7 là phần Desktop).

Trạng thái: mã ở nhánh `claude/determined-newton-h8xa33`, **chưa build bộ cài, chưa chạy trên Electron thật**. Không migration,
không hàm DB mới (dùng lại vé V521 đã apply 13/11/2026). Trang đích `?shop=1` / `?product=<id>` do cổng CRM xử lý
(SqlServerDashboard, làm ở đợt khác); cổng chưa có thì trang Nâng cấp vẫn mở như hiện nay.

## Các lối vào

| Lối vào | `from` | Mã nguồn trên link | Mở gì |
|---|---|---|---|
| Menu tài khoản → "Nâng cấp và mua gói" (ngay dưới "Thông tin tài khoản", mọi tài khoản đều thấy) | `menu` | `desktop.m1` | Form, chế độ mua hàng |
| "Thông tin tài khoản" → nút "Gia hạn / Nâng cấp" của từng gói | `account` + `entitlementId` | `desktop.m2` | Form, chọn sẵn sản phẩm đó |
| "Thông tin tài khoản" → "Mua thêm hoặc dùng thử sản phẩm khác" | `account` | `desktop.m2` | Form, chế độ mua hàng |
| Màn đăng nhập → link "Nâng cấp và thanh toán" khi địa chỉ là cổng | `login` | `desktop.l1` | Form, không vé: khách đăng nhập ngay trên trang CRM |
| Dải thông báo chung có link tới `crm.akabiz.net/gia-han…` | `banner` | `desktop.b1` | Form, chế độ mua hàng |
| Thông báo lỗi "… chưa được kích hoạt hoặc đã hết hạn." → nút "Mua hoặc dùng thử" | `feature` | `desktop.f1` | Form, chế độ mua hàng |

Giữ nguyên, không đi qua form này:

- Lời nhắc gia hạn (nhãn "Còn N ngày", dải, hộp thoại, chuông "Gói sắp hết hạn") và nút của **gói đang được nhắc** trong
  "Thông tin tài khoản": vẫn mở cửa sổ "Gia hạn gói" (`renewal-reminder:open`, [RENEWAL_REMINDER_DESKTOP.md](RENEWAL_REMINDER_DESKTOP.md)).
- Màn Gia hạn trước đăng nhập (`RenewalPage`, gói đã hết hạn).
- "Đối tác akaBiz", "Đăng ký dùng thử", "Lấy lại tài khoản": vẫn mở trình duyệt.
- Link ở màn đăng nhập hoặc trên dải thông báo trỏ tới địa chỉ khác cổng: vẫn mở trình duyệt.
- Link trong khung thông báo của màn đăng nhập (`notification.linkUrl`): chưa đổi, vẫn mở trình duyệt kể cả khi trỏ tới cổng.

Thông báo tính năng: hộp báo lỗi chung (`AlertModal`) tự thêm nút khi câu báo có cụm "chưa được kích hoạt hoặc đã hết hạn"
(`isUpgradePortalFeatureMessage`), đang đăng nhập, và thông báo chưa có nút riêng. Cách này phủ cả các câu do tiến trình chính
trả về (`entitlementRepository.ts`), không phải sửa từng nơi gọi `showAlert`. Hộp "Nhóm tài khoản" báo lỗi ngay trong hộp nên
có nút riêng cạnh câu lỗi. Các câu "Gói hiện tại không hỗ trợ tài khoản Zalo (…)" chưa có nút.

## Thành phần

- Hợp đồng: `src/shared/upgradePortal.ts`, chép **nguyên văn** từ akaAgentWebApp `packages/control-api/src/upgradePortal.ts`
  (sửa ở WebApp trước rồi chép lại; smoke giữ md5 `967dafaa…`). Phần riêng Desktop ở `src/shared/upgradePortalDesktop.ts`: tên
  kênh IPC, mã lỗi, câu chữ của form, `buildUpgradePortalDesktopLink`, `isUpgradePortalFeatureMessage`.
- Tiến trình chính: `src/main/ipc/handlers/upgradePortalHandlers.ts` (`createUpgradePortalWebControl`: một hàm mở cổng cho mọi
  lối) và các kênh `upgrade-portal:*` trong `src/main/ipc/handlers/renewalWebHandlers.ts`.
- Giao diện: `src/renderer/src/stores/upgradePortalStore.ts` (mọi lối gọi `open({ from, entitlementId? })`),
  `components/UpgradePortal/UpgradePortalHost.tsx` + `UpgradePortalWindow.tsx`. Khung cửa sổ dùng chung với "Gia hạn gói" ở
  `components/RenewalReminder/PortalWebWindow.tsx` (`RenewalReminderWindow.tsx` nay chỉ là lớp bọc, giao diện không đổi).

## IPC

| Kênh | Chiều | Nội dung |
|---|---|---|
| `upgrade-portal:open` `{ from, entitlementId? }` | giao diện → main | Chuẩn bị form. Trả `{ ok: true, partition, url: 'about:blank' }` hoặc `{ ok: false, code, message }` (`invalid_request`, `not_logged_in`, `busy`, `unavailable`). |
| `upgrade-portal:web-state` | main → giao diện | `{ status, signed, orderCompleted, message? }` của webview. |
| `upgrade-portal:web-reload` | giao diện → main | Nút "Tải lại" / "Thử lại": main xin vé mới rồi nạp lại. |
| `upgrade-portal:close` | giao diện → main | Xoá dữ liệu phiên cổng, đọc lại gói một lượt, trả `{ updated }`. |
| `upgrade-portal:open-external` `{ from, entitlementId? }` | giao diện → main | Nút "Mở bằng trình duyệt": main dựng link rồi mở trình duyệt ngoài, trả `{ ok, signed }`. |

Link (có thể có vé) **chỉ đi trong tiến trình chính**: giao diện gắn `<webview src="about:blank">`, main nạp link vào guest
(`RenewalWebService.loadPortal`). Không kênh nào trả link hay mã vé về giao diện; không ghi link hay vé ra log.

`RenewalWebService` có ba chủ sở hữu dùng chung phân vùng `akaagent_renewal`, không bao giờ cùng tồn tại:

- `pending`: màn Gia hạn trước đăng nhập (như cũ).
- `reminder`: cửa sổ "Gia hạn gói" (như cũ).
- `shop`: form này. Gắn với mã phiên đăng nhập, hoặc với trạng thái chưa đăng nhập khi mở từ màn đăng nhập.

Quy tắc giữa ba chế độ:

- Cửa sổ "Gia hạn gói" đang mở mà bấm một lối mới: dùng lại cửa sổ đang mở (store không mở thêm; main trả `busy` nếu vẫn bị gọi).
- Hai lối mới bấm liên tiếp: dùng lại một form, giữ trang của lối bấm đầu.
- Form đang mở mà lời nhắc mở cửa sổ "Gia hạn gói": form nhường chỗ.
- Đang ở màn Gia hạn trước đăng nhập: không mở form (`busy`).
- Đổi phiên (đăng nhập, đăng xuất, đổi tài khoản, đổi mật khẩu): main đóng form và xoá dữ liệu phân vùng; link đang chờ vé bị bỏ.

Các chốt an toàn của cửa sổ giữ nguyên, không đổi dòng nào: chỉ điều hướng trong `https://crm.akabiz.net/gia-han*`, link ngoài
và cửa sổ bật lên mở bằng trình duyệt, chặn tải file, chỉ cấp quyền ghi clipboard, xoá storage / cache / kết nối khi đóng.
`RenewalWebService` chỉ thêm tuỳ chọn `texts` (câu báo lỗi riêng của form).

## Khi nào gọi DB

- Mở form khi đang đăng nhập: **1 lượt** `aka_agent_renewal_link_ticket(<id dòng sản phẩm> | null)` (V521), xin lúc webview gắn
  xong. "Tải lại" và "Mở bằng trình duyệt" mỗi lần 1 lượt nữa (vé dùng một lần). Không có vé (DB chưa có hàm, quá 12 vé / 10
  phút, lỗi gọi) thì form mở link thường và hiện dòng nhắc khách đăng nhập cổng.
- Mở form ở màn đăng nhập: **0 lượt**.
- `entitlementId` chỉ được gửi cho DB khi trùng `organizationProductId` của một gói trong phiên (so trong RAM, không đọc DB);
  lạ thì mở chế độ mua hàng.
- Trang CRM đổi tiêu đề "Đã kích hoạt gói – akaBiz": đọc lại gói ngay một lượt (`refreshEntitlementsForRenewal`, cùng lượt
  kiểm gói 30 giây).
- Đóng form khi đang đăng nhập: đọc lại gói thêm một lượt, để nhận cả bản dùng thử vừa bật (trường hợp này trang không đổi
  tiêu đề). Gói khác lúc mở thì hiện "Gói đã được cập nhật.". Form mở từ màn đăng nhập không đọc lại gì.
- Không đọc gì lúc đăng nhập, không hẹn giờ, không đọc cài đặt nào. Mở form không dừng bộ chạy, không đăng xuất.

## Giới hạn

- Form chặn tải file, nên nút **"Lưu ảnh QR"** của màn thanh toán không tải được ảnh trong form. Khách quét mã trên màn hình,
  hoặc bấm "Mở bằng trình duyệt".
- Thanh toán bằng "Mở bằng trình duyệt" rồi không đóng form: gói mới chỉ nhận ở lượt kiểm gói định kỳ hoặc khi đóng form.
- Phải build và phát hành Desktop; bản đã cài không có các thay đổi này.

## Kiểm thử

- `node scripts/upgrade-portal-desktop-smoke.cjs` (22 nhóm; không DB, không Electron): hợp đồng trùng WebApp (md5, và từng byte
  khi có checkout `../akaAgentWebApp` hoặc `WEBAPP_REPO`), link có vé / không vé / chưa đăng nhập, mã thật của
  `renewalWebHandlers.ts` + `renewalWebService.ts` + `renewalReminderService.ts` với electron giả (vé không tới giao diện, link
  ngoài cổng không vào form, hai lối liên tiếp một form, đóng form đọc lại gói, đổi phiên bỏ link, cửa sổ "Gia hạn gói" đang
  mở), store giao diện, các câu báo tính năng.
- `node scripts/run-upgrade-portal-ui-smoke.cjs` (10 nhóm; giao diện thật trên Chromium của Playwright với IPC giả;
  `UPGRADE_UI_SHOTS=<thư mục>` để chụp màn hình): mục menu, Thông tin tài khoản, dải thông báo, màn đăng nhập, thông báo tính
  năng, khung form. Form dùng `<webview>` nên chỉ kiểm khung và lệnh gửi xuống main, không kiểm trang CRM bên trong.
- Chạy lại sau khi sửa: `node scripts/renewal-reminder-desktop-smoke.cjs` (14 nhóm), `node scripts/run-renewal-reminder-ui-smoke.cjs`
  (11 nhóm), `node scripts/aff-partner-desktop-smoke.cjs` (8 nhóm), hai lệnh `tsc`.
- **Chưa kiểm:** chạy trên Electron thật (trang CRM trong `<webview>`, vé thật, thanh toán xong đọc lại gói, bật dùng thử rồi
  đóng form), bản đóng gói Windows / macOS, hộp "Nhóm tài khoản" và các form chiến dịch trong luồng thật.
