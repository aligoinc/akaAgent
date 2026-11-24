-- rollback_v642_ai_config_history_eval: bỏ trigger lịch sử cấu hình AI. Giữ bảng (lịch sử và bộ mẫu) để không mất dữ liệu; muốn xoá hẳn thì DROP riêng.
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP TRIGGER IF EXISTS ai_config_history_v642 ON public.ai_prompt;
DROP TRIGGER IF EXISTS ai_config_history_v642 ON public.ai_using;
DROP TRIGGER IF EXISTS ai_config_history_v642 ON public.ai_model;
DROP FUNCTION IF EXISTS private.ai_config_history_capture();
COMMIT;
