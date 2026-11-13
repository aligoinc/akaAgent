# Nhắc gia hạn trong phần mềm — Desktop

13/11/2026. **Mã nhánh `claude/exciting-archimedes-wu7hz6`, chưa merge, chưa build/phát hành; V518 chưa apply (chờ duyệt);
Edge `renewal_link` chưa deploy; chưa có dòng `renewal.reminder` nên đang tắt với mọi máy.** Phương án và quy tắc:
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
| Edge `renewal_link` | Chỉ khi mở cửa sổ/tải lại/mở bằng trình duyệt | |

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
- Link: `createRenewalPortalLink(credentials, fingerprintHash, opid = reminder.product.organizationProductId)` →
  `renewalReminderSignedUrl(url, kind, src)`; ký lỗi hoặc link lạ (bình thường hôm nay vì Edge chưa có action) →
  `renewalReminderPlainUrl(kind, src)`, khách đăng nhập cổng bằng mật khẩu (cửa sổ hiện dòng nhắc). `src` = `desktop.dN`/
  `desktop.eN`/`desktop.tN`, tính trong main từ thông báo gốc. Link và token không qua renderer.
- Mở cửa sổ không dừng bộ chạy, không đăng xuất. Đăng xuất/đổi tài khoản thì main đóng guest.
- Trang CRM đổi tiêu đề `RENEWAL_ORDER_COMPLETED_TITLE` → main đọc lại gói ngay (chờ lượt kiểm đang chạy tối đa 15 giây),
  đọc lại RPC, tính lại, gửi trạng thái; renderer hiện nhãn xanh "Đã gia hạn thành công." 15 giây và trong đầu cửa sổ.
  Gói gia hạn xa hơn ngưỡng thì thông báo tự mất.

## Kênh cũ `org_staff.app_notification`

`getActiveAppNotification`: khi nhắc gia hạn bật cho người dùng và giá trị thô là thông báo `kind = renewal_reminder`
(`isRenewalLegacyNotice`) thì bỏ qua, rơi xuống `app.notification` chung. Tắt thì như cũ. Renderer phát
`aka-agent:app-notification-refresh` khi trạng thái chuyển sang bật để dải chung đọc lại một lần.

## Quyền riêng tư

- Các ngày có đăng nhập chỉ ở RAM của service; không log (kể cả lỗi RPC chỉ ghi mã lỗi), không gửi xuống renderer.
- Trạng thái gửi renderer chỉ có 4 trường của hợp đồng, và đi qua `toPublicRenewalReminder` (cùng hàm với API của Web):
  `reminder.early` luôn `false`, `stageKey` thành `s<mốc>:<mức>` (bỏ tiền tố `e`/`d` tiết lộ việc nhắc sớm); trạng thái
  "đã xem" vẫn đúng.
- Nhắc sớm hiện y như nhắc thường cùng mức; mọi câu chữ lấy từ `renewalReminderTexts`. Không có giá ở đâu cả.

## Kiểm chứng

Đã chạy: `npx tsc --noEmit -p tsconfig.node.json` và `-p tsconfig.web.json` (0 lỗi, không đổi cấu hình typecheck),
`node scripts/renewal-reminder-desktop-smoke.cjs` (12 nhóm: chuyển gói, kiểm RPC + dự phòng, trạng thái không có ngày đăng
nhập/dấu nhắc sớm, bỏ thông báo kiểu cũ, link ký số/link thường với bộ ký giả, đổi phiên, giới hạn refresh, đổi mật khẩu),
`bash scripts/test-v518-renewal-reminder-state.sh` (22 khẳng định). Tệp quy tắc trùng byte với bản WebApp (`cmp`).

Dữ liệu thật 13/11 (chỉ đọc): mọi dòng gói akaAgent còn hạn đều có `package_type`; dùng thử chỉ có loại `demo`, 3 ngày
(38 dòng) nên quy tắc "loại trống = dùng thử" hiện không gắn nhầm gói trả phí nào. Sổ migration mới tới V514; V515–V517 đã
có chủ ở các nhánh khác, V518 chưa ai dùng (kiểm lại ngay trước khi apply).

Chưa làm: chạy Electron (không có binary trong container), DB thật, apply V518, deploy Edge `renewal_link`, thanh toán thật,
smoke giao diện. Chưa kiểm bằng mắt màu/tương phản trên app thật (đã tính tay ≥ 4.5:1 cho chữ và nút ở hai giao diện).
