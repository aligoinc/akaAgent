# Trung tâm thông báo akaBiz — hợp đồng DB (V457)

**Trạng thái: candidate, CHƯA apply.** Giai đoạn 1 của phương án đã chốt 04/11/2026
(push iOS và email cho 4 loại sự kiện). V456 đã live. Apply V457 cần duyệt riêng, chạy ngoài
cao điểm (ALTER TABLE và CREATE OR REPLACE FUNCTION làm PostgREST nạp lại schema).

SQL: [migration](../migrations/migration_v457_notification_center.sql),
[rollback](../migrations/rollback_v457_notification_center.sql),
kiểm thử `NOTIFY_PG_BIN=/usr/lib/postgresql/17/bin scripts/notification-center/smoke.sh`.

## Thành phần

| Đối tượng | Vai trò |
| --- | --- |
| Cột mới `auto_email_notification_settings` | `push_enabled`, `revision` (so khớp, lệch → 40001), `settings_version` (1 cũ, 2 mới), `timezone`, `verified_emails`, `hourly_push_cap`, `quiet_hours`, `updated_by_client` |
| `auto_notification_subscriptions` | 1 dòng / (staff, loại, scope `own`): bật, kênh email/push, `filters`, thời gian chờ, lịch báo cáo, `next_run_at` |
| `auto_notifications` | 1 dòng / sự kiện × người nhận; nội dung app/email đã chốt; trạng thái kênh; `read_at` |
| `auto_notification_deliveries` | 1 lượt / (thông báo, kênh, đích); thử lại 1/5/15/60 phút, tối đa 4 lần |
| `auto_notification_devices` | iPhone gắn phiên `auto_control_sessions` (native); token APNs |
| `auto_data_group_member_events` | Nhật ký vào/rời nhóm (ghi ở V458) |
| `private.aka_agent_notification_dispatch_state` | Khóa thuê 60 giây cho lượt gọi worker, mốc dọn dữ liệu |

Năm bảng public bật RLS, không policy, thu hồi mọi quyền (kể cả `service_role`): chỉ đi qua
hàm SECURITY DEFINER. Không thêm job cron, pool hay kết nối.

## Bắt sự kiện

- `trg_aka_agent_notify_campaign_status` (AFTER UPDATE OF status, `auto_campaigns`): theo
  `filters.toStatuses`, `campaignIds`; chờ 10 phút cho Hoàn thành/Tạm dừng, 15 phút cho
  Đang chạy/Chờ xử lý (trong thời gian chờ chỉ tăng `payload.suppressedCount`);
  `deliver_after` = +30 giây; nguồn ghi suy từ role (desktop/chat_api/server/system).
- `trg_aka_agent_notify_account_status` (status, login_status, mobile_device_id): đăng nhập/
  đăng xuất/checkpoint (`loginEvents`), gắn/gỡ máy SMS tính là đăng nhập/đăng xuất, trạng thái
  chạy (`runStatuses`, mặc định rỗng); đăng xuất/checkpoint là `critical`.
- `trg_aka_agent_notify_session_revoked`: thu hồi phiên thì ngưng thiết bị của phiên đó.
- Báo cáo theo lịch: bước điều phối chọn `next_run_at <= now()` (SKIP LOCKED, 200/lượt), chèn
  1 báo cáo cho mốc đến hạn rồi nhảy tới mốc tương lai (không bù dồn nhiều mốc).
- Mọi trigger đọc theo khóa rồi chèn 1 dòng; không đếm số liệu; công tắc
  `notifications.enabled` tắt thì không làm gì.

## Cầu nối client cũ

Desktop cũ upsert 9 cột và API cũ `/settings/email-notifications` vẫn chạy:
`trg_aka_agent_notification_settings_before` tăng `revision`, ghi `updated_by_client='legacy'`,
giữ `verified_emails` ⊆ `recipient_emails`; `..._after` đồng bộ: `notify_campaign_completed`
↔ chiến dịch kênh email có Hoàn thành; `daily_report_enabled` ↔ báo cáo kênh email;
`daily_report_time` thay mốc sớm nhất. Email mới thêm từ bất kỳ client nào nhận một thư xác minh
(tối đa 1 thư/địa chỉ/ngày). RPC mới đặt `aka.notification_center_write='on'` để hai trigger bỏ qua
và tự ghi lại 3 cột cũ cho khớp.

Dữ liệu cũ khi apply: 18 dòng cài đặt → 36 subscription giữ đúng hành vi email cũ (chỉ báo
Hoàn thành, báo cáo 1 mốc/ngày); email đang nhận coi là đã xác minh.

## Điều phối và worker

Tick 30 giây `aka_agent_data_group_background_tick` thêm khối thứ ba
`aka_agent_notification_dispatch()` (checksum đích `10a2465bf8273b269ed5123344cff4db`, nguồn
`873b2939cc09a51e0e9d71f685dfd0e0`). Khi có việc và không có khóa thuê: `net.http_post` tới
Vault `AKA_AGENT_NOTIFICATION_DISPATCH_URL` với header `x-internal-token` =
`AKA_AGENT_NOTIFICATION_DISPATCH_TOKEN`, timeout 30 giây (máy Fly có thể đang ngủ).

`aka_agent_notification_worker(p_action, p_payload)` — chỉ `service_role`:

| Action | Payload → kết quả |
| --- | --- |
| `claim_render` | `{limit≤50, leaseSeconds}` → `{items:[{id, leaseToken, eventType, severity, staffId, organizationId, staffName, timezone, campaignId, accountId, dataGroupId, entityKey, occurredAt, payload, attempt}]}`. Gộp trước: ≥5 thông báo chiến dịch cùng nhân viên + trạng thái trong 2 phút → 1 (`payload.merged`, `mergedCount`). Quá 5 lần dựng → `failed`. |
| `complete_render` | `{id, leaseToken, status:'ready'|'suppressed'|'failed'|'retry', appTitle(1–200), appBody(≤1000), emailSubject(1–300), contentSnapshot(object ≤512 KB), templateVersion, error}`. `ready` → chia lượt gửi ngay. Lệch lease → `{ok:false,error:'lease_lost'}`. |
| `claim_deliveries` | `{limit≤100, leaseSeconds}` → `{items:[{id, leaseToken, channel, provider, destination(email), attempt, maxAttempts, notification:{id, eventType, severity, staffId, organizationId, entityKey, occurredAt, appTitle, appBody, emailSubject, templateVersion, contentSnapshot(email), payload(verify)}, device:{id, pushToken, apnsEnvironment, bundleId, active}, badge}]}` |
| `complete_delivery` | `{id, leaseToken, outcome:'sent'|'retry'|'failed'|'invalid_token'|'cancelled', providerMessageId, errorCode, error}`; `invalid_token` ngưng thiết bị; `device.active=false` thì gửi `cancelled`. |
| `release` | Mở khóa thuê để tick kế tiếp gọi lại ngay. |
| `stats` | Số việc tồn, chế độ gửi. |

Chia lượt gửi đọc cài đặt tại lúc gửi: email chỉ tới địa chỉ đã xác minh (tối đa 5); push tới
thiết bị còn hiệu lực có phiên chưa thu hồi/hết hạn; bỏ qua nhân viên không còn quyền akaAgent;
trần push/giờ (`notifications.push.hourly_cap`, mặc định 60). `notifications.delivery_mode`
= `dry_run` ghi lượt gửi `skipped` (`last_error_code='dry_run'`) để đối chiếu trước khi gửi thật.

`aka_agent_notification_snapshot(p_kind, p_payload)` — chỉ `service_role`, chỉ đọc:
`campaign` (đếm đối tượng theo trạng thái, kết quả theo hành động × nhóm, hôm nay/lũy kế; dòng
cũ `report_group` NULL quy về nhóm theo trạng thái), `account` (proxy, máy SMS, lỗi phiên akaChat,
log ±2 phút, máy Desktop đang mở), `report` (tài khoản, chiến dịch ≤50, vấn đề ≤20), `data_group`.
Bắt buộc `staffId`; dữ liệu ngoài phạm vi trả `{found:false}`.

## Cài đặt, hộp thư, thiết bị

- Web/iOS qua API: `aka_agent_control_notification_center(p_staff_id, p_organization_id, p_client 'web'|'ios', p_action, p_payload, p_session_id)` — chỉ `service_role`; staff/tổ chức/phiên lấy từ phiên đăng nhập.
- Desktop: `aka_agent_notification_center(p_staff_id, p_organization_id, p_auth_username, p_auth_password, p_action, p_payload)` — ràng token Desktop + `auto_assert_automation_identity`; không được `register_device`, `verify_email`, `unsubscribe`.

| Action | Ghi chú |
| --- | --- |
| `get_settings` | `{revision, timezone, centerEnabled, deliveryMode, channels:{email:{enabled, recipients, unverified}, push:{enabled, devices}}, subscriptions:{campaignStatus, accountStatus, scheduledReport, dataGroupMembership}}`; chưa có dòng → revision 0 + mặc định |
| `save_settings` | Bắt buộc `revision`; thiếu khóa nào giữ giá trị cũ. Lỗi: `notification_settings_conflict` (40001), `notification_invalid_email`, `notification_email_required`, `notification_invalid_filter`, `notification_invalid_schedule`, `notification_invalid_cooldown`, `notification_ids_not_owned` |
| `list` | `{cursor:{createdAt,id}, limit≤50, type, unreadOnly}` → `{items, nextCursor, unreadCount}` (keyset, chỉ `ready`) |
| `detail` | Nội dung đã chốt + lượt gửi (email che bớt) |
| `mark_read` | `{ids≤200}` hoặc `{upToId, type?}` → `unreadCount` (tối đa 100). `upToId` phải là thông báo đã hiện của chính nhân viên; đánh dấu mọi mục có `(created_at, id)` ≤ mục đó, tùy chọn chỉ một loại |
| `unread_count`, `set_device_enabled`, `unregister_device` (`deviceId` hoặc `current`), `resend_verification` | |
| `register_device` | Chỉ `ios` + phiên native còn hạn; token đã thuộc máy khác thì ngưng ràng buộc cũ (`staff_changed`). Máy bị gỡ từ nơi khác (`user_removed`) chỉ bật lại khi gửi `explicit: true` (người dùng tự bật trên máy); trả `{ok, deviceId, active}` |
| `test` | `{channel}`; tối đa 3 lần/10 phút (`54000`); công tắc tắt → `55000` |
| `verify_email`, `unsubscribe` | Chỉ web, sau khi API kiểm token HMAC trong link |

### Client Desktop (source, chưa phát hành)

Cài đặt chung → **Nhận thông báo** dùng
[NotificationCenterSettings](../src/renderer/src/components/Settings/NotificationCenterSettings.tsx); main gọi RPC qua
[notificationCenterRepository](../src/main/data/repositories/notificationCenterRepository.ts) (staff/tổ chức và mật khẩu
lấy từ phiên trong main, timeout 15 giây, client Supabase sẵn có), IPC `notification-center:*` trả
`{ok, data}` hoặc `{ok:false, code, message}`; chỉ chuyển mã `notification_*`, không chuyển SQL sang renderer. Hợp đồng
kiểu/nhãn/lỗi chép từ WebApp `packages/control-api/src/notifications.ts` vào
[shared/notificationCenter.ts](../src/shared/notificationCenter.ts).

- RPC chưa có (`PGRST202`/`42883` → `notification_center_not_ready`): hiện nguyên form email cũ
  (`emailNotificationRepository`), chỉ hỏi lại RPC sau 10 phút.
- Lưu theo `revision`; lệch phiên bản giữ nội dung đang nhập, khóa nút Lưu và mời tải lại. Tắt kênh Email/App làm mờ
  cột tương ứng nhưng giữ lựa chọn; mỗi loại bật khi có ít nhất một kênh. "Đã chọn" chiến dịch/tài khoản dùng dữ liệu
  store sẵn có; nhóm data chỉ liệt kê nhóm tự tạo (danh sách Desktop không phân biệt chia sẻ toàn tổ chức với chia sẻ
  đích danh, mà `notification_ids_not_owned` chỉ nhận nhóm sở hữu hoặc có dòng người nhận).
- "Thông báo gần đây" (Desktop chưa có chuông): 20 thông báo mới nhất, lọc loại, đánh dấu đã đọc tất cả (`upToId` =
  thông báo mới nhất đã thấy), chi tiết dựng từ `content.sections` + lượt gửi và đánh dấu đã đọc. Chỉ tải khi mở mục
  hoặc bấm tải lại; không poll, không hẹn giờ.

## Cấu hình

`auto_system_settings` (không bí mật): `notifications.enabled`=`false`,
`notifications.delivery_mode`=`dry_run`, `notifications.cooldown_minutes.campaign`=10,
`notifications.cooldown_minutes.account`=15, `notifications.push.hourly_cap`=60, thời gian giữ
`notifications.retention_days`=90, `notifications.report_retention_days`=30,
`notifications.member_event_retention_days`=90. Dọn theo lô trong bước điều phối, 1 lần/giờ.

## Thứ tự bật (mỗi bước duyệt riêng)

1. Apply V457 ngoài cao điểm (công tắc vẫn tắt, chưa tạo gì), rồi V458 (cũng không ghi gì khi công tắc tắt).
2. Deploy API WebApp có worker; đặt Vault URL/token điều phối; bật `notifications.enabled` ở
   `dry_run`, so nội dung với email cũ vài ngày.
3. Chuyển `live`, tắt trigger `trg_aka_agent_enqueue_campaign_completed_email` và 2 job cron
   email 5 phút (giữ bảng outbox cũ để tra cứu).
4. Phát hành Desktop/iOS dùng cài đặt mới; push iOS sau khi có key APNs.

## Kiểm chứng

`scripts/notification-center/smoke.sh`: PG17 tạm dựng theo metadata live (hàm live chính xác
theo checksum, không dữ liệu khách), **104 ca đạt**: chuyển dữ liệu cũ, công tắc tắt không bắt
gì, bắt sự kiện Desktop/Chat API và thời gian chờ, cài đặt mới và lỗi kiểm tra, cầu nối Desktop
cũ (V456 vẫn giới hạn dòng), dựng/gộp/chia lượt gửi ở `dry_run` và `live`, thử lại và token hỏng,
báo cáo theo lịch, khóa thuê điều phối, thiết bị và thu hồi phiên, hộp thư, wrapper Desktop,
quyền từng role, số liệu, dọn dữ liệu; chạy lại bị preflight từ chối; rollback khôi phục tick
rồi apply lại được. Khối preflight chạy trên akachat ở chế độ READ ONLY ngày 04/11/2026: đạt.

## V458 — nhật ký vào/rời nhóm data (candidate, chưa apply)

`migrations/migration_v458_data_group_member_events.sql` sửa `aka_agent_process_data_group_dynamic_filters_core`
từ đúng bản đang chạy trên akachat (md5 `d40d1a23943ae1a4a66339504382526f`, chụp nguyên văn ngày 04/11/2026 tại
`migrations/snapshots/data-group-member-events-v458/core_live.sql`), chỉ 3 chỗ:

1. Vòng bộ lọc đọc thêm `revision`.
2. Hai điểm đang tăng `last_entered_count`/`last_exited_count` gọi `private.aka_agent_data_group_record_member_event`
   trong cùng subtransaction của từng liên hệ (liên hệ lỗi thì nhật ký của nó rollback theo). Bản ghi chỉ rời bộ
   lọc mà vẫn ở lại nhờ nguồn khác không phải "rời nhóm", không ghi.
3. Cuối lượt gọi `private.aka_agent_data_group_finish_member_events`: gắn `group_total_after` cho sự kiện cuối của
   mỗi nhóm (đếm 1 lần/nhóm/lượt) rồi gộp thông báo: 1 dòng `auto_notifications` cho mỗi (người nhận, nhóm, khung
   `bucketMinutes`), `dedupe_key = dg:{staff}:{group}:{minutes}:{bucket UTC}`, `deliver_after` = cuối khung + 30 giây,
   cộng dồn số vào/rời khi còn `pending`. Người nhận: chủ nhóm; người được chia sẻ nếu bật `includeSharedGroups`.
   Lọc theo `groupIds` và `actions`; payload mang `groupId, groupName, from, to, added, removed, actions, shared`.

Hai hàm ghi/chốt tự bắt lỗi (`RAISE WARNING`), nên lỗi nhật ký hay thông báo không bao giờ làm rollback thay đổi
thành viên. Chỉ ghi khi `notifications.enabled = true` hoặc khóa mới `notifications.member_events.enabled = true`
(mặc định `false`): có thể bật riêng nhật ký để quan sát lượng ghi trước khi bật thông báo. Dọn nhật ký 90 ngày chạy
trong bước điều phối, tức chỉ khi `notifications.enabled = true`.

Rollback: `migrations/rollback_v458_data_group_member_events.sql` (khôi phục đúng bản md5 `d40d1a23…`, xóa hàm
phụ và khóa cấu hình; giữ dữ liệu đã ghi). Rollback V457 nay tự từ chối khi V458 còn áp dụng.

Kiểm chứng: `scripts/data-group-member-events/smoke.sh` (PG17 tạm, metadata live, không dữ liệu khách),
**40 ca đạt**: hàm lõi fixture khớp checksum live; cùng một kịch bản cho kết quả thành viên/nguồn/bộ đếm/revision
giống hệt bản cũ cả khi tắt và bật công tắc (5 vào, 2 rời; ở lại nhờ nguồn khác không tính rời); ghi nhãn, mô tả
luật, revision, tổng sau thay đổi; gộp theo khung và người nhận được chia sẻ; lọc nhóm/hành động; lỗi chèn nhật ký,
lỗi gộp thông báo và lỗi so khớp một liên hệ không làm hỏng lượt; số liệu `data_group` và `claim_render` đọc đúng
khung; chạy lại bị từ chối; rollback V457 bị chặn khi có V458; rollback khôi phục checksum và hành vi; apply lại được.
Preflight phần không phụ thuộc V457 chạy READ ONLY trên akachat ngày 04/11/2026: 16/16 cột, index thành viên đang
hoạt động, metadata hàm lõi và checksum khớp.

### Thứ tự hộp thư

`created_at` của thông báo là lúc nó vào hộp thư (được đặt lại khi `complete_render` chuyển sang `ready`); thời điểm sự kiện
nằm ở `occurred_at`. Nhờ vậy thông báo gộp theo khung (tạo từ đầu khung, dựng sau khi khung đóng) hiện lên đầu danh sách,
và "Đánh dấu đã đọc tất cả" (`upToId` theo `(created_at, id)`) không đánh dấu thông báo dựng sau lúc người dùng xem.
