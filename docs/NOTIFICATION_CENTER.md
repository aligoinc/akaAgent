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
| `claim_deliveries` | `{limit≤100, leaseSeconds}` → `{items:[{id, leaseToken, channel, provider, destination(email), attempt, maxAttempts, notification:{...appTitle, appBody, emailSubject, contentSnapshot(email), payload(verify)}, device:{id, pushToken, apnsEnvironment, bundleId, active}, badge}]}` |
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
| `mark_read` | `{ids≤200}` hoặc `{upToId}` → `unreadCount` (tối đa 100) |
| `unread_count`, `set_device_enabled`, `unregister_device` (`deviceId` hoặc `current`), `resend_verification` | |
| `register_device` | Chỉ `ios` + phiên native còn hạn; token đã thuộc máy khác thì ngưng ràng buộc cũ (`staff_changed`) |
| `test` | `{channel}`; tối đa 3 lần/10 phút (`54000`); công tắc tắt → `55000` |
| `verify_email`, `unsubscribe` | Chỉ web, sau khi API kiểm token HMAC trong link |

## Cấu hình

`auto_system_settings` (không bí mật): `notifications.enabled`=`false`,
`notifications.delivery_mode`=`dry_run`, `notifications.cooldown_minutes.campaign`=10,
`notifications.cooldown_minutes.account`=15, `notifications.push.hourly_cap`=60, thời gian giữ
`notifications.retention_days`=90, `notifications.report_retention_days`=30,
`notifications.member_event_retention_days`=90. Dọn theo lô trong bước điều phối, 1 lần/giờ.

## Thứ tự bật (mỗi bước duyệt riêng)

1. Apply V457 ngoài cao điểm (công tắc vẫn tắt, chưa tạo gì).
2. Deploy API WebApp có worker; đặt Vault URL/token điều phối; bật `notifications.enabled` ở
   `dry_run`, so nội dung với email cũ vài ngày.
3. Chuyển `live`, tắt trigger `trg_aka_agent_enqueue_campaign_completed_email` và 2 job cron
   email 5 phút (giữ bảng outbox cũ để tra cứu).
4. Phát hành Desktop/iOS dùng cài đặt mới; push iOS sau khi có key APNs.

## Kiểm chứng

`scripts/notification-center/smoke.sh`: PG17 tạm dựng theo metadata live (hàm live chính xác
theo checksum, không dữ liệu khách), **93 ca đạt**: chuyển dữ liệu cũ, công tắc tắt không bắt
gì, bắt sự kiện Desktop/Chat API và thời gian chờ, cài đặt mới và lỗi kiểm tra, cầu nối Desktop
cũ (V456 vẫn giới hạn dòng), dựng/gộp/chia lượt gửi ở `dry_run` và `live`, thử lại và token hỏng,
báo cáo theo lịch, khóa thuê điều phối, thiết bị và thu hồi phiên, hộp thư, wrapper Desktop,
quyền từng role, số liệu, dọn dữ liệu; chạy lại bị preflight từ chối; rollback khôi phục tick
rồi apply lại được. Khối preflight chạy trên akachat ở chế độ READ ONLY ngày 04/11/2026: đạt.
