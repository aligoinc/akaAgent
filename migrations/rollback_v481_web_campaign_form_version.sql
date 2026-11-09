-- Rollback V481 (Form chiến dịch 2 trên Web). Bước 1 chỉ dữ liệu: mọi người về form 1 ngay (kể cả nhân viên đang '2' hay '1,2'),
-- không đổi schema, không làm PostgREST nạp lại schema. Web/API bản mới vẫn chạy (đọc cột/khóa nhưng đều là form 1).
BEGIN;
SET LOCAL lock_timeout = '3s';
UPDATE public.auto_system_settings SET value = '{"defaultVersion":1}', updated_at = now()
  WHERE key = 'web.campaign_form' AND value IS DISTINCT FROM '{"defaultVersion":1}';
UPDATE public.org_staff SET web_campaign_form_version = NULL WHERE web_campaign_form_version IS NOT NULL;
COMMIT;
-- Bước 2 (chỉ khi gỡ hẳn tính năng, ngoài giờ cao điểm vì DDL làm PostgREST nạp lại schema).
-- API bản mới tự bỏ cột khi DB thiếu (lỗi 42703/PGRST204 → đọc lại không có cột, thử lại sau 5 phút) nên không cần rollback API trước:
-- BEGIN;
-- SET LOCAL lock_timeout = '3s';
-- ALTER TABLE public.org_staff DROP COLUMN IF EXISTS web_campaign_form_version;
-- DELETE FROM public.auto_system_settings WHERE key = 'web.campaign_form';
-- COMMIT;
