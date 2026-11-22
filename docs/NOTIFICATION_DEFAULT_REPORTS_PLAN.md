# Thông báo mặc định cho mọi tài khoản: chào ngày mới, báo cáo 12:00/18:00, chiến dịch hoàn thành

Phương án code, viết 21/11/2026 sau khi anh duyệt bản thiết kế
(https://claude.ai/artifact/WsdfsCQkHiEapvM2yiwR3E).

**Tình trạng (21/11/2026 tối, anh: "Thực thi trên webapp"):** đã code bước 1–3 (mục 8), **chưa apply, chưa deploy, chưa merge**.
- DB (repo này, nhánh `claude/practical-albattani-jm21p0`): [migration_v621_notification_daily_reports.sql](../migrations/migration_v621_notification_daily_reports.sql)
  + [p2](../migrations/migration_v621_notification_daily_reports_p2.sql) + [gỡ](../migrations/rollback_v621_notification_daily_reports.sql),
  sinh bằng `python3 scripts/build-v621-sql.py` từ thân production đọc 21/11 (`migrations/snapshots/notification-daily-reports-v621/live/`,
  md5 khoá trước/sau) và hàm mới ở `scripts/notification-daily-reports/v621_new_functions.sql`. Sổ production lúc viết tới V620;
  kiểm lại sổ và `git log --all` ngay trước khi apply.
- Kiểm: `scripts/notification-daily-reports/smoke_v621.sh` (cụm Postgres tạm, nền setup + V457/V465/V466/V467/V520): bộ kiểm cũ
  103/20/27 vẫn đạt trên V621, bộ kiểm V621 (gieo mặc định, có/không email, cài đặt Chào ngày mới, client cũ, lập lịch, rải giờ,
  snapshot `account_actions` / `morning` / `failure_reasons` / `completedToday`, chia hạn mức theo giờ chạy, tick), apply lại bị
  từ chối, gỡ trả đúng md5 mọi hàm và ràng buộc, apply lại, p2. Đo chỉ đọc trên production 21/11: phần "chiến dịch hôm nay"
  của `morning` 60–125 ms/nhân viên (284, 2362, 1108, 385); `account_actions` 0,26 s khi nóng, ~4 s khi nguội (đọc riêng, lỗi thì
  bỏ bảng).
- Khác phương án: không sửa `capture_campaign` (bỏ "Up tin cho chiến dịch …" làm ở API khi dựng, và ở `completed_today`); rải giờ
  là `deliver_after` + `staff_id % (notifications.report_spread_seconds + 1)` giây (cài đặt mới, mặc định 240, 0 = như cũ) thay
  vì dời `next_run_at`; lập lịch 500 dòng/lượt (trước 200); `updated_by_client` thêm giá trị `default_seed` (mở CHECK);
  dự kiến hôm nay tính trong DB bằng `aka_agent_engine_action_limit` (không gọi `campaign_limit_progress` từ API), chiến dịch cùng
  tài khoản chia phần giới hạn còn lại theo giờ chạy.
- WebApp (nhánh `claude/practical-albattani-jm21p0`): hợp đồng, worker dựng 3 loại, email ô số, thông báo nổi + chip + cài đặt Web.
  DB chưa có V621 thì API dựng báo cáo như bản 1 (các phần đọc thêm báo lỗi → bỏ mục) và giao diện ẩn mục Chào ngày mới.

Dựng trên Trung tâm thông báo đang chạy (V457/V465/V466/V467, xem
[NOTIFICATION_CENTER.md](NOTIFICATION_CENTER.md)): DB lập lịch và giữ hàng đợi, worker trong API WebApp trên Fly dựng nội dung
và gửi email/APNs, Web/Desktop/iOS đọc hộp thư. Nội dung được dựng sẵn thành `sections` dùng chung, nên Desktop và iOS bản
đang cài vẫn hiện được loại thông báo mới (chỉ thiếu nhãn lọc và thông báo nổi).

## 1. Quyết định đã chốt

| Mục | Chốt |
|---|---|
| Ai nhận | Mọi nhân viên đang hoạt động, tổ chức còn gói **kể cả gói dùng thử** (`org_organization_product` chưa xoá, `expiration_date` chưa qua, bất kể `is_paid`), bật sẵn; khách mới được gieo trong vòng 1 giờ sau khi tạo; ai đã tự lưu cài đặt thì giữ nguyên |
| Chào ngày mới | 07:00 mặc định, khách chọn 06:00–08:00; không gửi khi hôm qua không có kết quả **và** hôm nay không có chiến dịch |
| Báo cáo tổng hợp | 12:00 + 18:00, hằng ngày; không gửi khi trong ngày chưa có kết quả và không có vấn đề |
| Chiến dịch | Chỉ "Hoàn thành"; không báo chiến dịch "Up tin cho chiến dịch …" |
| Hành động | Theo thao tác (`action_code`: Tìm SĐT, Nhắn tin người lạ, Kết bạn…) |
| Tỷ lệ | Thành công ÷ (Thành công + Thất bại); bỏ qua không tính |
| Chờ gửi | Data `chờ xử lý` của chiến dịch đang chạy / chờ chạy dùng thao tác đó; tổng chờ đếm theo data, không cộng dồn các dòng |
| Kênh | Email, push iOS, thông báo nổi trên App Desktop và Web; chuông/hộp thư luôn lưu |
| Email | Gửi thẳng tới email đăng ký (không qua bước xác minh), kèm link tắt nhận; chưa có email thì không gửi, không xin email (kể cả khách dùng thử), có email lúc nào thì bắt đầu gửi từ thông báo kế tiếp |

## 2. Hiện trạng liên quan (đo 21/11/2026)

- 1.265 nhân viên đang hoạt động còn gói; 113 có dòng cài đặt, 14 bật báo cáo, 17 nhận email chiến dịch.
- Email: 93 nhân viên có `org_staff.email`; tính thêm email tổ chức của tổ chức chỉ có 1 nhân viên thì 268.
- Push: 0 thiết bị. Nguyên nhân trong mã iOS: app chỉ xin quyền và đăng ký khi người dùng tự bật công tắc
  "Nhận thông báo trên iPhone này" trong Cài đặt hoặc bấm thẻ mời ở tab Hội thoại (WebApp
  `apps/mobile/src/notifications/push.ts:223-246`, `app/notification-settings/index.tsx:103-124`); không có lời mời sau đăng nhập.
- Web: số chưa đọc đi kèm `/me`, đọc lại mỗi 60 giây khi tab đang hiện (`apps/web/src/auth/AuthContext.tsx:137-146`); chưa có
  thông báo nổi. Desktop: số chưa đọc chỉ đọc khi đăng nhập / focus / đổi trang ([notificationCenterStore.ts](../src/renderer/src/stores/notificationCenterStore.ts)); chưa có thông báo nổi.
- Worker: `renderNotification` chỉ dựng 6 loại, loại lạ bị `suppressed` (`notifications.render.ts:174-216`); báo cáo chưa có bảng
  tài khoản × hành động, chưa có tỷ lệ.
- Đã có sẵn để dùng lại:
  - bảng tài khoản × hành động (thành công / bỏ qua / thất bại / chờ) của trang Báo cáo: `GET /reports/account-actions` →
    `accountActionReport` → RPC `aka_agent_read_report_page` (WebApp `aka-agent-control.repository.ts:2697`, chờ ở `:2928-2957`);
  - hạn mức ngày đã dùng / còn lại theo chiến dịch: RPC V502 `aka_agent_control_campaign_limit_progress` + `campaignLimitProgress.ts`;
  - đọc số liệu ngay trong worker đã có tiền lệ: `readAchievements` gọi `ControlEffectivenessService` bằng `service_role`.
- Hàm DB đang chạy (md5 `pg_get_functiondef`, đọc 21/11 để migration khoá trước khi thay):
  `aka_agent_notification_schedule_reports` `801b8ea2…`, `aka_agent_notification_snapshot` `c67d59fa…`,
  `aka_agent_notification_worker` `60eb06ec…`, `aka_agent_notification_fanout` `461b803b…`,
  `aka_agent_notification_capture_campaign` `51729056…` (bản V561), `private.aka_agent_notification_center` `ce94e582…`,
  `aka_agent_notification_subscription_json` `b400edcd…`, `aka_agent_notification_settings_json` `7f73a571…`,
  `aka_agent_notification_save_subscription` `208e5a5c…`, `aka_agent_notification_default_filters` `c5cc0691…`,
  `aka_agent_notification_tick` `18973d97…`. CHECK `event_type` của `auto_notifications` có 8 loại (gồm `package.expiring`,
  `assistant.result`), của `auto_notification_subscriptions` có 4 loại.

## 3. Thiết kế dữ liệu

### 3.1 Loại thông báo

- `report.scheduled` giữ cho báo cáo 12:00/18:00 (đổi nội dung, không đổi loại, để hộp thư và bộ lọc cũ vẫn đúng).
- Thêm `report.morning` cho Chào ngày mới: có dòng đăng ký riêng (giờ gửi, bật/tắt riêng), nhãn "Chào ngày mới".
- `campaign.status_changed` giữ nguyên, thêm cột Chờ gửi / Tỷ lệ ở phần dựng nội dung.

### 3.2 Nội dung dựng sẵn

Thêm một trường tuỳ chọn vào `NotificationContentSection`: `display?: 'tiles'`. Mục có `display: 'tiles'` vẫn dùng `rows`, nên
Desktop/iOS bản cũ hiện thành danh sách nhãn – giá trị (đủ số, chỉ khác dáng); bản mới và email vẽ thành ô số như bản thiết kế.
Không thêm loại mục mới để bản cũ không mất dữ liệu.

### 3.3 Mặc định và lộ trình bật

- Cài đặt `auto_system_settings` `notifications.default_reports` (JSON): `{"audience":"off"|"admin_akabiz"|"orgs"|"all",
  "organizationIds":[…], "batch":200}`. Migration đặt `off`.
- Hàm `private.aka_agent_notification_seed_defaults(p_limit)` chạy trong bước dọn hằng giờ của tick (đã có, chỉ chạy ở chế độ
  `fly`), mỗi lượt tối đa `batch` nhân viên đủ điều kiện mà **chưa có** dòng tương ứng:
  - `auto_email_notification_settings`: `email_enabled = true` nếu có email, `push_enabled = true`, `recipient_emails` /
    `verified_emails` = `org_staff.email`, không có thì email tổ chức khi tổ chức chỉ có 1 nhân viên; ghi
    `updated_by_client = 'default_seed'`.
  - Đăng ký (chỉ chèn khi chưa có, `ON CONFLICT DO NOTHING`): `report.morning` 07:00, `report.scheduled` 12:00 + 18:00 với
    `skipWhenIdle = true`, `campaign.status_changed` với `toStatuses = ['hoàn thành']`; mỗi dòng `is_enabled`, `email_enabled`,
    `push_enabled` = true.
  - Người đã có dòng (113 người) không bị đụng: muốn họ nhận chào ngày mới thì chỉ thêm dòng `report.morning` còn thiếu.
- `next_run_at` của báo cáo theo lịch rải thêm `(staff_id % 300)` giây sau mốc (0–5 phút), để 600 báo cáo không dựng cùng giây.
- Gỡ: đặt `audience = off` (dừng gieo thêm); tắt hàng loạt những dòng đã gieo bằng một câu UPDATE lọc
  `updated_by_client = 'default_seed'` và chưa bị khách sửa (`revision` không đổi so với lúc gieo), có sẵn trong file gỡ.

### 3.4 Snapshot

`aka_agent_notification_snapshot` (thay từ thân đang chạy, khoá md5 trước/sau):

- `report`: giữ mọi trường cũ, thêm `reportTimes` (giờ của các báo cáo còn lại trong ngày). Bảng tài khoản × hành động do worker
  lấy từ `aka_agent_read_report_page` (mục 4.1), không viết lại trong snapshot.
- `morning` (mới), chỉ đọc:
  - `campaignsToday` ≤ 50: chiến dịch chưa xoá, `status` `chờ xử lý` / `đang chạy`, `schedule` < cuối ngày hôm nay (VN),
    `schedule_end_date` trống hoặc ≥ đầu ngày, tài khoản chưa xoá; mỗi dòng có `id, name, accountId, accountName, actionName,
    runTime` (giờ của `schedule` nếu là hôm nay, không thì giờ chạy gốc), `pendingInputs`. Bỏ chiến dịch không có data chờ, trừ
    loại không cần data (lướt newsfeed, đăng trang cá nhân, đăng fanpage).
  - `issues`: dùng lại khối "tài khoản đăng xuất / máy SMS chưa gắn mà còn chiến dịch" của `report`, chỉ giữ các tài khoản có
    chiến dịch trong `campaignsToday`.
  - `reportTimes` và `campaignNotify` (đã bật thông báo Hoàn thành hay chưa) từ dòng đăng ký của chính nhân viên.

Trước khi apply phải đo trên production (chỉ đọc, `EXPLAIN (ANALYZE, BUFFERS)` lúc nguội) cho nhân viên nhiều chiến dịch nhất
(465: 43 chiến dịch hoàn thành / ngày) và nhân viên nhiều data chờ nhất; trần 15 giây của worker, mục tiêu < 2 giây.

### 3.5 Lập lịch và capture

- `aka_agent_notification_schedule_reports`: xử lý cả `report.scheduled` lẫn `report.morning` (chèn đúng loại của dòng đăng ký,
  `entity_key` `report:` / `morning:` + mốc, `dedupe_key` theo nhân viên + loại + mốc). Index `report_due` thay bằng
  `WHERE event_type IN ('report.scheduled','report.morning') AND is_enabled` (tạo `CONCURRENTLY` ở file riêng, bỏ index cũ sau).
- `aka_agent_notification_capture_campaign`: bỏ qua chiến dịch có tên bắt đầu "Up tin cho chiến dịch " và loại
  `facebook_comment_seeding_post` (cùng quy tắc `isPostBumpTargetCampaign` của Desktop) khi đổi sang Hoàn thành.
- `auto_notifications_event_type_check` và `auto_notification_subscriptions_event_type_check` thêm `report.morning`
  (`NOT VALID` rồi `VALIDATE` ở giao dịch riêng, tránh khoá lâu bảng đang được ghi).
- `private.aka_agent_notification_center`: `get_settings` trả thêm `subscriptions.morningReport {enabled,email,push,time,
  skipWhenIdle,nextRunAt}`; `save_settings` nhận khoá này (giờ 06:00–08:00, bước 30 phút); `list` nhận bộ lọc `report.morning`.
  Client cũ không gửi khoá mới nên không đổi hành vi.
- Fanout giữ nguyên (đã đọc kênh theo dòng đăng ký). Bỏ yêu cầu xác minh chỉ cho email do gieo mặc định (đã nằm sẵn trong
  `verified_emails`), không đổi luật cho email khách tự thêm.

### 3.6 Migration

Ba file theo thứ tự, số lấy ngay trước lúc apply (kiểm sổ production và `git log --all`):

1. `…_p1`: cài đặt `notifications.default_reports` = off, mở CHECK (NOT VALID), hàm snapshot / schedule / capture / center /
   seed (khoá md5 nguồn ở mục 2), thêm gọi seed vào bước dọn hằng giờ của tick. Không gieo gì vì `off`.
2. `…_p2`: `VALIDATE CONSTRAINT`, index mới `CONCURRENTLY` (chạy từng lệnh, không trong giao dịch).
3. File gỡ: trả 6 hàm về đúng md5 cũ, CHECK về danh sách cũ (chỉ khi không còn dòng `report.morning`), xoá cài đặt.

Apply buổi tối (DDL làm PostgREST nạp lại schema). Kiểm thử cục bộ bằng bộ `scripts/notification-center/` (PG17, dựng theo
metadata production như V465/V475): chạy lại toàn bộ 103 + 20 + 27 + 24 + 27 ca cũ trên nền mới, thêm ca mới cho gieo mặc định,
lịch hai loại, rải giờ, bỏ Up tin, snapshot `morning`, bộ lọc, gỡ rồi apply lại.

## 4. API WebApp (worker, route)

### 4.1 Đọc số liệu

`notifications.accountActions.ts` (mới, giống `notifications.achievements.ts`): `readAccountActions({staffId, organizationId,
from, to})` gọi lại đúng `repository.getAccountActionReport` của trang Báo cáo, trả
`[{accountId, accountName, platform, actions: [{code, name, success, failure, skipped, pending}]}]`. Lỗi / quá 8 giây thì trả
`null`, báo cáo vẫn gửi phần còn lại (như `readAchievements`).

`notifications.expectedToday.ts` (mới): nhận `campaignsToday` của snapshot, gọi `aka_agent_control_campaign_limit_progress`
(tối đa 101 chiến dịch / lần) rồi tính `dự kiến = min(data chờ, giới hạn ngày còn lại của thao tác chính)` bằng hàm có sẵn
trong `packages/control-api/src/campaignLimitProgress.ts`; kèm nhãn "giới hạn N/ngày" khi bị chặn bởi hạn mức.

### 4.2 Dựng nội dung (`notifications.render.ts`)

- `renderReport`: thêm ô số (Thành công / Thất bại / Chờ gửi / Tỷ lệ) và bảng "Kết quả theo tài khoản và hành động
  (00:00–HH:MM)" lên đầu; dòng tổng; "Chiến dịch hoàn thành hôm nay" dạng bảng; giữ mục Tài khoản và Vấn đề. `appBody` =
  "770 thành công · 59 thất bại · 506 chờ gửi · Tỷ lệ 92,9%". `isIdleReport` xét thêm bảng hành động.
- `renderMorning` (mới): tiêu đề "Chào buổi sáng · Thứ Hai 23/11"; ô số; khung "Cần làm trước HH:MM" từ `issues`; kết quả hôm
  qua theo tài khoản (`readAccountActions` khoảng hôm qua, gộp theo tài khoản); bảng chiến dịch hôm nay (giờ, data chờ, dự kiến);
  "Báo cáo sẽ gửi hôm nay". `appBody` = "Hôm qua 1.386 thành công (93,0%) · Hôm nay 5 chiến dịch, dự kiến 801 data", thêm
  "· 1 tài khoản cần xử lý" khi có vấn đề. Không có gì để báo thì `suppressed` (`idle_morning`).
- `renderCampaign`: bảng kết quả thêm cột Chờ gửi và Tỷ lệ; mục "Lý do thất bại" (mã công khai + số lượt) khi snapshot có.
- `renderEmail`: vẽ `display: 'tiles'` thành hàng ô; giữ bản chữ thuần.
- `TEMPLATE_VERSION` lên 2.

### 4.3 Gửi

- `UNSUBSCRIBABLE` thêm `report.morning`; link tắt nhận tắt đúng loại.
- Push: `threadId = eventType`; độ ưu tiên 5 cho `report.scheduled` và `report.morning`.
- `packages/control-api/src/notifications.ts`: thêm loại `report.morning`, nhãn, kiểu `MorningReportSubscription`, kiểm giờ
  06:00–08:00, `display` của section. Desktop chép nguyên văn sang `src/shared/notificationCenter.ts` như mọi lần.

### 4.4 Kiểm thử

- Test đơn vị cho 3 hàm dựng (dữ liệu mẫu đúng bản thiết kế, so từng dòng chữ email và `appBody`).
- Phát lại 3 ngày lịch sử thật như [NOTIFICATION_REPLAY_20261105.md](NOTIFICATION_REPLAY_20261105.md) (PG17 + libfaketime, worker
  thật, email/APNs giả), lần này với mọi nhân viên còn gói: số thông báo / email / push mỗi người mỗi ngày, thời gian dựng mỗi
  báo cáo, số báo cáo bị bỏ vì không có gì, chuỗi kỹ thuật lọt vào nội dung.
- Đo độ đúng của "chiến dịch chạy hôm nay" trên 7 ngày thật (chỉ đọc): danh sách dự đoán lúc 07:00 so với chiến dịch có kết quả
  trong ngày đó; số dự kiến so với số chạy thật. Mục tiêu: sót < 5%, dự kiến lệch thật < 20% ở 80% chiến dịch.

## 5. Thông báo nổi trên Web và App Desktop

### Web (`apps/web`)

- `/me` đã trả `notificationUnreadCount` mỗi 60 giây. Khi số này tăng, đọc `GET /notifications?limit=3&unreadOnly=true` một lần và
  hiện thông báo nổi cho mục mới nhất thuộc `report.morning`, `report.scheduled`, `campaign.status_changed` mà trình duyệt chưa
  hiện (nhớ id cuối trong `localStorage` theo nhân viên).
- Component `NotificationToast` góc phải trên, tối đa 1 cái, tự ẩn sau 12 giây, nút "Xem báo cáo" / "Xem chiến dịch" mở đúng
  trang, nút đóng; không hiện khi đang ở trang Thông báo.
- Thêm chip "Chào ngày mới"; đổi câu trống của chuông ("Thông báo mặc định tắt") và banner mời bật thông báo
  (`useNotificationInvite.ts`) vì nay đã bật sẵn.
- Thêm request: chỉ 1 lượt đọc danh sách mỗi lần số chưa đọc tăng.

### App Desktop (repo này)

- Thêm một hẹn giờ trong renderer: đọc `unread_count` 45 giây sau mỗi mốc lịch trong ngày (lấy `nextRunAt` từ `get_settings`,
  đọc một lần khi đăng nhập và sau khi lưu cài đặt), và khi danh sách chiến dịch (đang tải theo nhịp sẵn có) thấy chiến dịch
  chuyển sang Hoàn thành. Tối đa vài lượt mỗi ngày, không đọc theo chu kỳ.
- Số tăng thì đọc `list` 3 mục, hiện thông báo nổi như Web (component trong `components/Notifications/`), mở đúng trang bằng
  `openNotificationTarget` có sẵn. Cửa sổ đang thu nhỏ thì không hiện (dùng tín hiệu `desktop-ui:attention` có sẵn); có thể dùng
  thêm `Notification` của hệ điều hành ở bản sau nếu anh muốn.
- `src/shared/notificationCenter.ts` chép lại từ WebApp; trang Thông báo và Cài đặt thêm loại / mục Chào ngày mới.
- Bản Desktop đang cài vẫn thấy thông báo mới trong chuông (nội dung dựng sẵn), chỉ thiếu thông báo nổi và chip lọc.

## 6. App iOS

- Sau lần đăng nhập đầu (và một lần cho người đang đăng nhập khi lên bản mới), hiện màn mời "Nhận báo cáo trên iPhone" trước
  hộp xin quyền của iOS; đồng ý thì gọi `enablePushOnThisDevice({requestPermission:true})` có sẵn. Từ chối thì nhắc lại sau 7 ngày,
  tối đa 3 lần.
- `activatePushDevice` bật thêm `push` của các đăng ký mặc định nếu đang tắt.
- Thêm chip "Chào ngày mới", mục Chào ngày mới ở Cài đặt, vẽ `display: 'tiles'`.
- Bấm thông báo mở đúng báo cáo (route `/notifications/<id>` đã có).
- Kiểm bản 17–19 trên TestFlight có `aps-environment` không; bản mới build với `IOS_PUSH_NOTIFICATIONS=1`.
- Bản đang cài: báo cáo vẫn hiện trong hộp thư; push chỉ có ở bản mới vì cần đăng ký thiết bị.

## 7. Email gửi đi

- Ước lượng khi bật cho mọi người: khoảng 220 nhân viên vừa có email vừa đang chạy chiến dịch × (chào ngày mới + 2 báo cáo) +
  thông báo hoàn thành ≈ 900–1.000 thư/ngày, vượt trần ~500 thư/ngày của Gmail đang gửi (`akabizzm@gmail.com`).
- Việc phải xong trước khi bật cho tất cả: hộp thư tên miền akabiz.net (hoặc dịch vụ gửi thư) có SPF/DKIM/DMARC, gắn cờ
  `is_send_noti_akabiz` sang tài khoản đó (không cần code). Trần `notifications.email.hourly_cap` (20/giờ/nhân viên) giữ nguyên.
- Không làm lời mời nhập email (anh chốt 21/11/2026); ô nhập email ở Cài đặt → Nhận thông báo vẫn có như hiện nay.
- Khách dùng thử gần như không có email: 30 ngày tới 21/11/2026 có 218 tổ chức dùng thử mới, chỉ 16 có email (nhân viên hoặc
  tổ chức), 122 đã tạo chiến dịch, 2 đăng nhập iOS. Anh chốt 21/11/2026: không xin email, không gửi email khi chưa có; họ nhận
  trong chuông, thông báo nổi Desktop/Web và push iOS.
- Khi nào có email thì mới gửi:
  - Gieo mặc định: không có email thì `email_enabled = false`, `recipient_emails` rỗng; không tạo lượt gửi email nào.
  - Bước gieo hằng giờ xét lại các dòng `updated_by_client = 'default_seed'` chưa bị khách sửa mà chưa có người nhận: nếu
    `org_staff.email` (hoặc email tổ chức chỉ có 1 nhân viên) đã có thì điền vào `recipient_emails` / `verified_emails` và bật
    `email_enabled`. Thư đầu tiên là thông báo kế tiếp sau đó, không gửi bù.
  - Khách tự nhập email ở Cài đặt → Nhận thông báo thì kênh Email bật cùng lúc lưu (luật xác minh email khách tự thêm giữ như cũ).

## 8. Thứ tự làm và triển khai

| Bước | Việc | Repo | Phát hành |
|---|---|---|---|
| 1 | Migration p1/p2 (+ gỡ) và kiểm thử PG17 | akaAgent | Apply tối, `default_reports = off` |
| 2 | Hợp đồng `notifications.ts`, worker dựng 3 loại, đọc số liệu, email ô số, test + phát lại | WebApp | Deploy API (người đang bật báo cáo thấy bản mới ngay) |
| 3 | Thông báo nổi + chip + cài đặt trên Web | WebApp | Deploy Web cùng bước 2 |
| 4 | Đổi tài khoản gửi email | — | Cấu hình |
| 5 | Bật `default_reports`: `admin_akabiz` → vài tổ chức đang chạy nhiều → `all` | — | Mỗi đợt theo dõi 1–2 ngày |
| 6 | Thông báo nổi + Chào ngày mới trên Desktop | akaAgent | Bản Desktop kế tiếp |
| 7 | Màn mời push, chip, cài đặt trên iOS | WebApp | Bản iOS kế tiếp |

Theo dõi sau mỗi đợt bật: số thông báo `failed` / `suppressed` theo lý do, thời gian dựng p95, email bị trả về, số người tắt
(đếm dòng đăng ký đổi `is_enabled` khỏi giá trị gieo), số thiết bị push đăng ký mới.

## 9. Rủi ro

- Báo cáo của người nhiều tài khoản đọc nhiều kết quả trong một lần: đo trước (mục 3.4, 4.4), rải giờ 0–5 phút, đọc lỗi thì gửi
  phần còn lại.
- "Chiến dịch chạy hôm nay" là ước lượng: Desktop tắt qua đêm thì lịch chưa được dời sang hôm nay; quy tắc `schedule < cuối ngày`
  vẫn tính chúng vào (sẽ chạy khi mở app). Đo độ đúng ở bước kiểm thử, ghi rõ trong email "Dự kiến".
- Email tới địa chỉ chưa xác minh có thể bị trả về nhiều; theo dõi tỉ lệ trả về, địa chỉ lỗi cứng thì tự bỏ khỏi `recipient_emails`.
