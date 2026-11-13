# Nhắc gia hạn trong phần mềm — Desktop

13/11/2026. **Mã nhánh `claude/exciting-archimedes-wu7hz6`, chưa merge, chưa build/phát hành; V518 (hàm trạng thái + dòng cài
đặt), V519 (vé gia hạn dùng một lần) và V520 (chuông "Gói sắp hết hạn") đều chưa apply; chưa có dòng `renewal.reminder` nên
đang tắt với mọi máy.** Phương án và quy tắc:
[RENEWAL_REMINDER_PLAN.md](RENEWAL_REMINDER_PLAN.md) (mục 3, 4, 5, 7.5). Màn Gia hạn sau khi hết hạn (không đổi):
[RENEWAL_PORTAL_DESKTOP.md](RENEWAL_PORTAL_DESKTOP.md). Web, API, iOS và bảng cài đặt `renewal.reminder`: akaAgentWebApp
`docs/RENEWAL_REMINDER.md`.

## Luồng dữ liệu

Tiến trình chính tính thông báo, renderer chỉ hiển thị.

- Quy tắc: `src/shared/renewalReminder.ts`, chép nguyên văn WebApp `packages/control-api/src/renewalReminder.ts` (không
  sửa ở Desktop). Phần riêng Desktop: `src/shared/renewalReminderDesktop.ts` (chuyển gói, kiểm RPC, trạng thái công khai,
  link, quyết định bỏ thông báo kiểu cũ).
- Gói: `AuthUser.accountProducts` (đã gộp Facebook 3/10, Zalo 16/18 theo dòng hết hạn xa nhất; lượt kiểm 30 giây sẵn có
  đọc lại). Thêm `duration_days` vào câu đọc `loadOrganizationAccountProducts` → `AuthAccountProduct.durationDays`. Chỉ
  lấy gói còn hạn; tên `akaAgent <nhãn>` trừ khi nhãn đã bắt đầu bằng "aka".
- Service: `src/main/services/renewalReminderService.ts` (singleton). Giữ trong RAM: cài đặt, `{today, serverTimeOffsetMs,
  loginDays, offers}`. Xoá khi đổi phiên (`onCurrentUserSessionChanged`, kể cả đăng xuất rồi đăng nhập lại cùng nhân viên).
  Riêng đổi mật khẩu (cùng nhân viên, chỉ đổi thông tin đăng nhập) thì mã phiên đổi để cửa sổ gia hạn đang mở đóng lại,
  còn cài đặt và dữ liệu máy chủ được giữ, vì renderer chỉ đọc cài đặt một lần mỗi phiên.
  Tính lại khi: có kết quả RPC, sau mỗi lượt kiểm gói (`runSessionExpiryCheck`, kể cả lượt 30 giây và 00:05), đổi ngày.
- Renderer: `stores/renewalReminderStore.ts` + `components/RenewalReminder/` (nhãn trên `AppUtilityTopbar`, dải dưới
  `AppNotificationBar`, hộp thoại, bảng nhỏ dùng thử, cửa sổ "Gia hạn gói"), "Thông tin tài khoản" thêm "Còn N ngày" và
  nút cho đúng gói đang được nhắc. "Đã xem" ở `localStorage` khóa `akaAgent.renewalReminder.seen:<org>:<staff>` (lỗi đọc/ghi
  = coi như chưa xem). Hộp thoại `always` một lần mỗi lần đăng nhập (cờ RAM). Đồng hồ đếm ngược vẽ lại mỗi giây chỉ khi
  đang hiện đếm ngược; "bây giờ" = `Date.now() + (serverTimeMs − lúc nhận)`.

## Đọc DB — khi nào

| Đọc | Khi | Ghi chú |
|---|---|---|
| `auto_system_settings` `renewal.reminder` | Một lần mỗi phiên, **chung câu** `getDesktopPollingSettings` (renderer gọi khi vào phiên) | Thiếu/sai = tắt. Handler `desktop-ui:polling-settings` chuyển giá trị đã parse cho service |
| `aka_agent_renewal_reminder_state()` | Sau khi biết tính năng bật cho người dùng; khi đổi ngày (so ngày ở mỗi lượt kiểm gói, tối đa 1 lượt/ngày); sau khi trang CRM báo đã kích hoạt; khi đóng cửa sổ gia hạn; khi quay lại cửa sổ sau "Mở bằng trình duyệt" (hai mục sau tối đa 1 lượt/20 giây) | Không có đồng hồ riêng. Tắt/ngoài nhóm thấy = không gọi |
| Gói (`org_organization_product`) | Như cũ (30 giây); thêm một lượt ngay khi trang CRM báo đã kích hoạt / khi đóng cửa sổ / quay lại cửa sổ | Dùng đúng `runSessionExpiryCheck('renewal')` |
| `aka_agent_renewal_link_ticket(opid)` (V519) | Chỉ khi mở cửa sổ/tải lại/mở bằng trình duyệt | Một vé mỗi lần mở; DB chưa có hàm hoặc từ chối → link thường |

Nhóm thấy: `renewalReminderEnabledFor(settings, { isAdminAkabiz, isAdmin })`, tính lại mỗi lần (quyền admin đổi được giữa phiên).

## RPC và dự phòng

`aka_agent_renewal_reminder_state()` ([V518](../migrations/migration_v518_renewal_reminder_state.sql), chưa apply; chỉ
`aka_agent_desktop`, nhân viên lấy từ phiên Desktop; `bash scripts/test-v518-renewal-reminder-state.sh` 22 khẳng định trên
PG16): `{ today, serverTime, loginDays[], offers[] }`. Ngày đăng nhập lấy từ `auto_staff_device_presence` và
`auto_control_sessions` trong 60 ngày; ưu đãi chỉ có khi `aka_promotion` đã có cột `min_days_before_expiry` (file SQL của CRM).
V518 cũng thêm dòng cài đặt `renewal.reminder` = `{"audience":"admin_akabiz"}` (chỉ admin akaBiz thấy, để thử).
`parseRenewalReminderServerState` kiểm chặt: ngày `YYYY-MM-DD` có thật, `today` trùng ngày VN của `serverTime`, lệch giờ
≤ 400 ngày, ≤ 400 ngày đăng nhập, ≤ 50 ưu đãi, số hữu hạn, `discountType` ∈ percent/fixed/null. Lỗi gọi (kể cả PGRST202
khi chưa apply), hết 10 giây, hoặc sai định dạng → ngày theo đồng hồ máy, không ngày đăng nhập, không ưu đãi; không thử lại
tới lần kích hoạt sau. Lần đọc đầu chưa xong thì chưa hiện gì.

## IPC (`RENEWAL_REMINDER_IPC`)

| Kênh | Loại | Nội dung |
|---|---|---|
| `renewal-reminder:state` | invoke | `RenewalReminderState` |
| `renewal-reminder:changed` | main → renderer | `RenewalReminderState` khi đổi (so `enabled/today/reminder`) |
| `renewal-reminder:refresh` | invoke | Đọc lại gói + RPC (giới hạn 20 giây), trả trạng thái |
| `renewal-reminder:open` | invoke `{reminderKey}` | `{ok, partition, url:'about:blank'}` hoặc `{ok:false, code: no_reminder/not_logged_in}` |
| `renewal-reminder:web-reload` | invoke | Tải lại trang (link mới) |
| `renewal-reminder:web-state` | main → renderer | `RenewalWebState` của cửa sổ |
| `renewal-reminder:close` | invoke | Đóng guest, xoá phân vùng, đọc lại gói |
| `renewal-reminder:open-external` | invoke `{reminderKey}` | Link mới → `shell.openExternal`, trả `{ok, signed}` |

`reminderKey` chỉ để đối chiếu: main luôn dùng thông báo tính lại tại thời điểm đó; không có thông báo → `no_reminder`.

## Cửa sổ "Gia hạn gói" khi đang đăng nhập

- `renewalWebHandlers.ts` giữ **một** `RenewalWebService` với chủ sở hữu `pending` (màn Gia hạn trước đăng nhập, gắn
  `currentRenewalId` như cũ) hoặc `reminder` (gắn mã phiên đăng nhập của service nhắc gia hạn). Hai chế độ dùng chung
  phân vùng `akaagent_renewal` và chung một chuỗi dọn dẹp nên không bao giờ cùng tồn tại (dispose đặt lại handler của
  session). Kênh `AUTH_RENEWAL_*` và cách gắn với lượt gia hạn giữ nguyên.
- `RenewalWebService` chỉ thêm hai tuỳ chọn: `stateChannel` (mặc định kênh cũ `AUTH_RENEWAL_WEB_STATE`) và
  `onOrderCompleted`. Chặn điều hướng ngoài `https://crm.akabiz.net/gia-han*`, link ngoài/popup → trình duyệt, chặn tải
  file, chỉ cấp quyền ghi clipboard, xoá storage/cache/kết nối khi đóng: như cũ.
- Link dùng **vé gia hạn một lần do DB cấp** ([V519](../migrations/migration_v519_renewal_link_tickets.sql), chưa apply):
  `issueRenewalLinkTicket(opid = reminder.product.organizationProductId)` gọi RPC `aka_agent_renewal_link_ticket` (chỉ
  `aka_agent_desktop`; nhân viên và tổ chức lấy từ phiên Desktop, không nhận từ tham số) → `{ ok, token }` →
  `renewalReminderTicketUrl(token, kind, src)` = `https://crm.akabiz.net/gia-han?t=<vé 64 hex>&next=…&src=…`. Cổng CRM đổi
  vé bằng hàm DB `aka_renewal_link_ticket_redeem` (chỉ `service_role`). Vé dùng một lần, sống 10 phút, DB chỉ lưu mã băm
  SHA-256, mỗi nhân viên tối đa 12 vé trong 10 phút. **Không có khoá ký nào ở Fly hay Supabase Edge cho luồng này.**
  Không có vé (DB chưa có hàm, `{ok:false}` như `rate_limited`, mã sai dạng, lỗi gọi, hết 10 giây) →
  `renewalReminderPlainUrl(kind, src)`, khách đăng nhập cổng bằng mật khẩu (cửa sổ hiện dòng nhắc). `src` = `desktop.dN`/
  `desktop.eN`/`desktop.tN`, tính trong main từ thông báo gốc. Link và mã vé không qua renderer, không ghi log. Phiên đổi
  trong lúc xin vé thì bỏ link vừa tạo (`not_logged_in`).
- Màn Gia hạn **trước đăng nhập** (tổ chức đã hết hạn) không đổi: vẫn đi Edge `renewal_link` rồi rơi về link thường, vì lúc
  đó chưa có phiên Desktop để xin vé ([RENEWAL_PORTAL_DESKTOP.md](RENEWAL_PORTAL_DESKTOP.md)).
- Mở cửa sổ không dừng bộ chạy, không đăng xuất. Đăng xuất/đổi tài khoản thì main đóng guest.
- Trang CRM đổi tiêu đề `RENEWAL_ORDER_COMPLETED_TITLE` → main đọc lại gói ngay (chờ lượt kiểm đang chạy tối đa 15 giây),
  đọc lại RPC, tính lại, gửi trạng thái; renderer hiện nhãn xanh "Đã gia hạn thành công." 15 giây và trong đầu cửa sổ.
  Gói gia hạn xa hơn ngưỡng thì thông báo tự mất.

## Kênh cũ `org_staff.app_notification`

`getActiveAppNotification`: khi nhắc gia hạn bật cho người dùng và giá trị thô là thông báo `kind = renewal_reminder`
(`isRenewalLegacyNotice`) thì bỏ qua, rơi xuống `app.notification` chung. Tắt thì như cũ. Renderer phát
`aka-agent:app-notification-refresh` khi trạng thái chuyển sang bật để dải chung đọc lại một lần.

## Chuông "Gói sắp hết hạn"

Job của API Web ghi thông báo loại `package.expiring` vào trung tâm thông báo
([V520](../migrations/migration_v520_notification_package_expiring.sql), chưa apply; bật bằng `bell: true` trong
`renewal.reminder`; chi tiết lượt chạy và câu chữ ở akaAgentWebApp `docs/RENEWAL_REMINDER.md`). Desktop chỉ hiển thị, không
thêm lượt đọc nào: thông báo đi qua danh sách/chi tiết/số chưa đọc sẵn có của trung tâm thông báo (V457).

- `src/shared/notificationCenter.ts`: `NOTIFICATION_PACKAGE_EXPIRING`, nhãn "Gói dịch vụ" qua `notificationEventLabel`,
  `isPackageExpiringNotification`; nội dung `kind: 'package'` hiển thị chung (tiêu đề + các dòng). Loại này **không** nằm
  trong `NOTIFICATION_EVENT_TYPES`: không có nút lọc, không bao giờ gửi làm tham số `type` (hàm danh sách của DB từ chối).
- `components/Notifications/notificationTargets.ts`: đích `{ kind: 'renewal', label }` chỉ khi store nhắc gia hạn đang có
  lời nhắc; nhãn nút là `renewalReminderTexts(...).button` ("Gia hạn" / "Gia hạn ngay" / "Nâng cấp"). Bấm ở trang Thông báo
  thì đánh dấu đã đọc rồi `openNotificationTarget` gọi `useRenewalReminderStore.getState().openWindow()` (cửa sổ "Gia hạn
  gói"). Đã gia hạn hoặc tính năng tắt: không có nút, chỉ xem chi tiết.
- Gói gia hạn xong thì job của API đánh dấu đã đọc thông báo cũ (tối đa 15 phút sau), nên số trên chuông tự giảm.
- Desktop bản đã phát hành (9.x) hiện loại này dưới nhãn chung "Thông báo", không có nút.

## Quyền riêng tư

- Các ngày có đăng nhập chỉ ở RAM của service; không log (kể cả lỗi RPC chỉ ghi mã lỗi), không gửi xuống renderer.
- Trạng thái gửi renderer chỉ có 4 trường của hợp đồng, và đi qua `toPublicRenewalReminder` (cùng hàm với API của Web):
  `reminder.early` luôn `false`, `stageKey` thành `s<mốc>:<mức>` (bỏ tiền tố `e`/`d` tiết lộ việc nhắc sớm); trạng thái
  "đã xem" vẫn đúng.
- Nhắc sớm hiện y như nhắc thường cùng mức; mọi câu chữ lấy từ `renewalReminderTexts`. Không có giá ở đâu cả.

## Kiểm chứng

Đã chạy: `npx tsc --noEmit -p tsconfig.node.json` và `-p tsconfig.web.json` (0 lỗi, không đổi cấu hình typecheck),
`node scripts/renewal-reminder-desktop-smoke.cjs` (14 nhóm: chuyển gói, kiểm RPC + dự phòng, trạng thái không có ngày đăng
nhập/dấu nhắc sớm, bỏ thông báo kiểu cũ, link có vé/link thường với bộ cấp vé giả — vé hợp lệ, `rate_limited`, null, mã sai
dạng, bộ cấp vé ném lỗi —, mã vé không tới renderer, đổi phiên trong lúc xin vé, giới hạn refresh, đổi mật khẩu),
`bash scripts/test-v518-renewal-reminder-state.sh` (22 khẳng định), `bash scripts/test-v519-renewal-link-tickets.sh` (40
khẳng định: quyền gọi, phiên, chỉ lưu mã băm, hạn 10 phút, dùng một lần kể cả 6 lượt đổi đồng thời, hạn mức, dọn vé cũ, apply
lại bị từ chối, rollback), `bash scripts/test-v520-notification-package-expiring.sh` (38 khẳng định: loại mới, quyền gọi,
công tắc trung tâm thông báo, không sinh trùng, mốc mới đánh dấu mốc cũ đã đọc, một lượt một thông báo mỗi gói, gói đã gia
hạn/không còn thì thành đã đọc đúng ranh giới ngày Việt Nam, phần tử sai, giới hạn 500, rollback). Ba bài SQL chạy trên PG16
cục bộ. Tệp quy tắc trùng byte với bản WebApp (`cmp`).

Dữ liệu thật 13/11 (chỉ đọc): mọi dòng gói akaAgent còn hạn đều có `package_type`; dùng thử chỉ có loại `demo`, 3 ngày
(38 dòng) nên quy tắc "loại trống = dùng thử" hiện không gắn nhầm gói trả phí nào. `org_organization_product.expiration_date`
là `timestamptz`; `auto_notifications` 189 dòng, ràng buộc loại thông báo đúng bản V457. Sổ migration mới tới V514 (18:58
VN 13/11); V515–V517 đã có chủ ở các nhánh khác, V518–V520 chưa ai dùng (kiểm lại ngay trước khi apply).

Giao diện: `node scripts/run-renewal-reminder-ui-smoke.cjs` (11 nhóm) dựng các component và `global.css` thật bằng esbuild
rồi mở bằng Chromium của Playwright với IPC giả lập (cùng nhân với Electron, không cần binary Electron; container cloud tự
dùng `/opt/pw-browsers/chromium`, máy khác đặt `RENEWAL_UI_CHROMIUM` nếu Playwright không tìm thấy trình duyệt). Kiểm: không
có gì để nhắc thì không hiện gì; mức nhẹ/vừa/mạnh/ngày cuối đúng cách ẩn dải và hộp thoại; dùng thử có bảng đếm ngược; ưu
đãi; Thông tin tài khoản; bấm Gia hạn mở cửa sổ và gọi main đúng một lần; chuông "Gói sắp hết hạn" (nhãn "Gói dịch vụ",
không có nút lọc riêng, lượt đọc danh sách không mang `type`, chi tiết gói, nút Gia hạn chỉ khi có lời nhắc và mở cửa sổ đúng
một lần); giao diện tối; không có chữ nào nhắc thói quen đăng nhập; không lỗi console. `RENEWAL_UI_SHOTS=<thư mục>` để chụp
màn hình từng bước (đã xem bằng mắt 13/11, sáng và tối; nhóm chuông chưa xem bằng mắt).

Chưa làm: chạy trong Electron thật (không có binary trong container) nên trang CRM bên trong `<webview>` của cửa sổ "Gia
hạn gói", việc đóng/xoá phân vùng và luồng thanh toán xong → đọc lại gói chưa được chạy thật; DB thật (apply V518–V520, gọi
RPC vé bằng phiên Desktop thật, cổng CRM đổi vé thật), thanh toán thật. Bài smoke giao diện dùng bản sao nhánh `renewal` của
`openNotificationTarget`, không chạy chính `App.tsx`.
