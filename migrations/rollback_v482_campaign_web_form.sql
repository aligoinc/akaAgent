-- Rollback V482 (auto_campaigns.web_campaign_form), bước 1 — chỉ dữ liệu.
-- Web thôi khóa form khi sửa/nhân bản theo cột (mở theo danh sách form của nhân viên như trước V482), giữ nguyên dữ liệu đã ghi,
-- không đổi schema, không làm PostgREST nạp lại schema. Cần khóa web.campaign_form (V481); chưa có khóa thì lệnh không đổi gì
-- (Web bản mới coi thiếu khóa là theo form của chiến dịch) — khi đó dùng bước 2.
-- Bước 2 (gỡ hẳn: thôi ghi cột, xoá cột, mất phân loại đã ghi): migrations/rollback_v482_campaign_web_form_remove.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
UPDATE public.auto_system_settings
SET value = ((CASE WHEN value ~ '^[[:space:]]*[{]' THEN value::jsonb ELSE '{}'::jsonb END) || '{"followCampaignForm":false}'::jsonb)::text,
    updated_at = now()
WHERE key = 'web.campaign_form';
COMMIT;
