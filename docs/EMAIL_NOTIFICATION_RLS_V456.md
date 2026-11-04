# Cài đặt/outbox thông báo email theo chủ sở hữu — V456

**Trạng thái: candidate, CHƯA apply.** Giai đoạn 0 của phương án Thông báo akaBiz
(chốt 04/11/2026). Chỉ apply khi người dùng đồng ý rõ ràng.

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
`idx_campaign_details_page`. Chưa deploy Edge function.
