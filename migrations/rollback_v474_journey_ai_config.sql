-- Rollback V474: TẮT cấu hình trợ lý Quy trình (ai_using + ai_prompt code 'app_journey_draft'); không đụng cấu hình AI khác.
-- Không DELETE: ai_log có FK using_id/prompt_id (không index) tới hai bảng này, xóa sẽ quét cả ai_log và lỗi khi đã có log.
-- API trả "Tính năng AI chưa được cấu hình" khi ai_using tắt; bật lại = đặt is_active = true.
BEGIN;
SET LOCAL lock_timeout = '3s';
UPDATE public.ai_using SET is_active = false, updated_at = now() WHERE code = 'app_journey_draft' AND is_active;
UPDATE public.ai_prompt SET is_active = false, updated_at = now() WHERE code = 'app_journey_draft' AND is_active;
COMMIT;
