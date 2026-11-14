-- Gỡ cấu hình "Thêm nhóm khách hàng bằng Agent": tắt dòng ai_form_configs và đặt công tắc off. Không xoá dòng nào
-- (prompt còn nguyên để bật lại bằng config_data_group_friend_agent.sql). Nút ở trang Nhóm khách hàng ẩn sau lượt tải trang kế tiếp;
-- API từ chối lượt chat ngay (công tắc đọc lại mỗi lượt).
BEGIN;
SET LOCAL lock_timeout = '5s';
UPDATE public.ai_form_configs SET is_active = false WHERE code = 'app_data_group_friend_agent_web';
UPDATE public.auto_system_settings SET value = '{"audience":"off"}', updated_at = now() WHERE key = 'web.data_group_agent';
COMMIT;
