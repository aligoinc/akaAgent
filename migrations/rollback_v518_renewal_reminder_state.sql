-- Gỡ V518: xoá hàm public.aka_agent_renewal_reminder_state() và tắt dòng cài đặt renewal.reminder.
-- Desktop bản mới gặp lỗi hàm không có (PGRST202) thì chỉ nhắc theo mốc ngày; khi dòng cài đặt tắt thì Web, Desktop và job
-- của API đều ngừng nhắc (job tự gỡ các thông báo nó đã ghi vào org_staff.app_notification ở lượt kế tiếp).
-- Không xoá dòng cài đặt (giữ lịch sử giá trị), chỉ đặt is_active = false. Không xoá dòng trong sổ migration.
-- Lệnh sửa schema: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DROP FUNCTION IF EXISTS public.aka_agent_renewal_reminder_state();
UPDATE public.auto_system_settings SET is_active = false WHERE key = 'renewal.reminder' AND is_active;
DO $post$
BEGIN
  IF to_regprocedure('public.aka_agent_renewal_reminder_state()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback V518 postflight: hàm vẫn còn';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'renewal.reminder' AND is_active) THEN
    RAISE EXCEPTION 'Rollback V518 postflight: dòng cài đặt renewal.reminder vẫn bật';
  END IF;
END $post$;
COMMIT;
