-- Rollback V479 (Agent Web). Chỉ dữ liệu, không DDL, không DELETE (ai_log.form_config_id có FK tới ai_form_configs).
-- Sau rollback: API trả "Agent chưa được cấu hình"/"Agent đang tạm tắt", Web ẩn nút Thêm bằng Agent; form thường không đổi.
BEGIN;
SET LOCAL lock_timeout = '3s';
UPDATE public.ai_form_configs SET is_active = false WHERE code = 'app_campaign_agent_web' AND is_active IS TRUE;
UPDATE public.auto_system_settings SET value = '{"audience":"off"}', updated_at = now()
  WHERE key = 'web.campaign_agent' AND value IS DISTINCT FROM '{"audience":"off"}';
COMMIT;
-- Bật lại: UPDATE public.ai_form_configs SET is_active = true WHERE code = 'app_campaign_agent_web';
--          UPDATE public.auto_system_settings SET value = '{"audience":"admin_akabiz"}' WHERE key = 'web.campaign_agent';
