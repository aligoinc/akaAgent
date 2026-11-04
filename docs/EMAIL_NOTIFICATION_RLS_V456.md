# Cài đặt/outbox thông báo email theo chủ sở hữu — V456

**Đã apply akachat lúc 12:21:05 VN ngày 04/11/2026** theo yêu cầu người dùng, ledger
`20261104052006 / migration_v456_email_notification_owner_rls`, sha256 file và ledger
`f2bda26473b3c5a2e050e82cf85cb7fca1cbf7e7152d64fc69bf59b7f2a087b3`.
[Receipt](../migrations/snapshots/email-notification-rls-v456/apply-receipt.json). Không apply lại.
Giai đoạn 0 của phương án Thông báo akaBiz (chốt 04/11/2026).

## Apply production — 04/11/2026

- **Thử trước (12:19:42 VN, ROLLBACK):** chạy trọn migration rồi kiểm bằng token Desktop thật:
  trước V456 thấy 18/18 dòng cài đặt; sau V456 thấy 1 dòng của chính mình, UPDATE dòng staff
  khác 0 dòng, chèn outbox cho staff khác bị từ chối `42501`, token lạ thấy 0. Không để lại dòng
  hoặc policy nào.
- **Apply (12:21:05 VN):** migration và INSERT `supabase_migrations.schema_migrations` trong cùng
  transaction, có chặn ghi trùng `migration_v456_%`. Lúc apply DB 0–4/8 vCPU; CREATE POLICY không
  làm PostgREST nạp lại schema.
- **Hậu kiểm:** hai policy đúng biểu thức, 4 policy trên hai bảng; ACL bảng và 13 mục ACL cột giữ
  nguyên; token Desktop của staff khác chỉ thấy dòng của mình; token lạ 0; service_role thấy đủ 18.
- **Lưu lượng 24 giờ trước apply:** worker Edge và API WebApp đọc/ghi qua service_role (không chịu
  RLS); Desktop chỉ đọc theo `staff_id` của chính mình, không có POST/PATCH; 0 lỗi.

## Vấn đề

V435 cho `aka_agent_desktop` policy PERMISSIVE `v435_existing_role_access USING (true)`
trên `auto_email_notification_settings` và `auto_email_notification_deliveries`, kèm
SELECT cả bảng cài đặt. Token Desktop của staff A đọc được email nhận thông báo của mọi
staff và chèn outbox cho staff khác.

## Thay đổi

- Thêm RESTRICTIVE policy `v456_desktop_owner` (FOR ALL, chỉ role `aka_agent_desktop`) trên
  hai bảng: `staff_id = (SELECT private.aka_agent_staff_scope_for_request())`, cùng mẫu V436/
  `desktop_owned_resource`. Policy AND với policy cũ.
- Không đổi ACL, không bật/tắt RLS, không sửa hàm/trigger, không đụng role khác
  (`service_role`, `aka_agent_chat_api` BYPASSRLS giữ nguyên).
- Preflight fail-closed: owner/RLS/ACL bảng và cột, đúng một policy cũ với đúng 27 role,
  checksum helper scope `d417807fa9dc08cfecbd6cd0aab7df3e` và trigger hoàn thành
  `0523c07b0878e3aaa53efb0bc97a74b8` (SECURITY INVOKER). Đã chạy riêng khối preflight
  trên akachat trong transaction READ ONLY ngày 04/11/2026: đạt.

Desktop cũ không cần cập nhật: `emailNotificationRepository` đọc theo `staff_id` của mình và
upsert 9 cột `onConflict: staff_id` + RETURNING trên dòng của mình.

## Kiểm chứng local

`EMAIL_RLS_PG_BIN=/usr/lib/postgresql/17/bin scripts/email-notification-rls/smoke.sh`
dựng cluster PG17 tạm theo metadata live (không dữ liệu khách, không pg_net), 21 ca đạt:
rò rỉ có trước V456; sau V456 Desktop chỉ thấy/ghi dòng của mình, upsert legacy chèn và cập
nhật được, upsert/update/outbox cho staff khác bị chặn, token lạ không thấy gì;
`service_role`/Chat API đọc đủ; chạy lại bị preflight từ chối; rollback trả hành vi cũ rồi
apply lại được.

## Phát hiện có sẵn, ngoài phạm vi V456

Trigger `aka_agent_enqueue_campaign_completed_email` dùng `ON CONFLICT (dedupe_key)`, cần
SELECT cột `dedupe_key`; Desktop chỉ có INSERT 4 cột. Vì vậy nếu token Desktop tự UPDATE
chiến dịch sang "hoàn thành" cho staff đang bật email hoàn thành, câu UPDATE lỗi
`permission denied` — đúng cả trước V456. Live 7 ngày: 19/19 lượt hoàn thành đủ điều kiện
đều vào outbox, nên luồng thực tế đi qua caller khác. Không mở thêm quyền trong V456; luồng
thông báo mới sẽ thay trigger này.

## Rollback

Thủ công: `migrations/rollback_v456_email_notification_owner_rls.sql` chỉ DROP hai policy
V456 sau khi kiểm tra đúng định nghĩa. Rollback mở lại lỗ hổng; cần chỉ thị rõ.

## Sửa tạm worker email cũ

`supabase/functions/aka-agent-email-notification-worker` (`findDailyCampaigns`): truy vấn
`auto_campaign_details` theo ngày nay inner join `auto_campaigns` lọc `staff_id`. Trước đây
quét chi tiết của mọi tenant, lặp mỗi 5 phút và để dòng của staff khác chiếm giới hạn
2.000 dòng. EXPLAIN live: index `auto_campaigns_staff_id_idx` → index-only scan
`idx_campaign_details_page`.

**Đã deploy version 7 lúc 12:25:35 VN ngày 04/11/2026** theo yêu cầu người dùng, giữ
`verify_jwt=false` (xác thực bằng `x-internal-token`). Bản đang chạy trước đó (version 6, deploy
27/05/2026) khớp `origin/dev_3` trước commit sửa, nên deploy chỉ mang đúng thay đổi này. Lượt cron
12:30 VN trên version 7 trả 200 (`ok: true`). Đoạn đã sửa chỉ chạy khi qua giờ báo cáo, sớm nhất là
16:13 VN, nên lượt dùng thật đầu tiên là 16:15 VN cùng ngày. Mốc 24 giờ trước deploy: 550 lượt 200
(trung bình 781 ms), 12 lượt 502 và 4 lượt 503 khoảng 10 ms (lỗi hạ tầng Edge).
Rollback: deploy lại file `supabase/functions/aka-agent-email-notification-worker/index.ts` của
`origin/dev_3` trước commit này (bằng version 6), giữ `verify_jwt=false`.
