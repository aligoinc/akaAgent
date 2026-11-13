-- Gỡ V520: xoá hai hàm của thông báo "Gói sắp hết hạn", xoá các thông báo loại này rồi đưa ràng buộc loại thông báo về 6 giá
-- trị của V457. Tắt `bell` trong `renewal.reminder` TRƯỚC khi gỡ để job của API Web không gọi hàm nữa (job gặp lỗi thiếu
-- hàm chỉ ghi log rồi bỏ qua). Không xoá dòng trong sổ migration. Lệnh sửa schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DROP FUNCTION IF EXISTS public.aka_agent_notification_emit_package_expiring(jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_notification_resolve_package_expiring();
DELETE FROM public.auto_notifications WHERE event_type = 'package.expiring';
ALTER TABLE public.auto_notifications DROP CONSTRAINT auto_notifications_event_type_check;
ALTER TABLE public.auto_notifications ADD CONSTRAINT auto_notifications_event_type_check
  CHECK (event_type IN ('campaign.status_changed', 'account.status_changed', 'report.scheduled',
    'data_group.membership_changed', 'system.test', 'system.verify_email'));
DO $post$
BEGIN
  IF to_regprocedure('public.aka_agent_notification_emit_package_expiring(jsonb)') IS NOT NULL
     OR to_regprocedure('public.aka_agent_notification_resolve_package_expiring()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback V520 postflight: hàm vẫn còn';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conrelid = 'public.auto_notifications'::regclass AND c.conname = 'auto_notifications_event_type_check'
                AND pg_get_constraintdef(c.oid) LIKE '%package.expiring%') THEN
    RAISE EXCEPTION 'Rollback V520 postflight: ràng buộc vẫn còn package.expiring';
  END IF;
END $post$;
COMMIT;
