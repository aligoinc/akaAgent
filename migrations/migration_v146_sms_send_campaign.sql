BEGIN;

ALTER TABLE public.auto_campaign_input_data
  ADD COLUMN IF NOT EXISTS content text;

COMMENT ON COLUMN public.auto_campaign_input_data.content IS
  'Materialized per-target message content. SMS campaigns pre-render this for mobile execution.';

INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES ('sms', 'Gửi tin nhắn SMS', 'sms_send')
ON CONFLICT (code) DO UPDATE SET
  flatform_type = EXCLUDED.flatform_type,
  name = EXCLUDED.name,
  is_active = true,
  is_delete = false,
  updated_at = now();

INSERT INTO public.auto_campaign_actions (
  id,
  name,
  flatform_type,
  is_active,
  workflow_id,
  test_workflow_id,
  allow_multiple_accounts,
  limit_check_action_codes,
  is_delete,
  created_at
)
VALUES (
  'sms_send',
  'SMS - Gửi tin nhắn',
  'sms',
  true,
  NULL,
  NULL,
  true,
  ARRAY['sms_send']::text[],
  false,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  flatform_type = EXCLUDED.flatform_type,
  is_active = true,
  workflow_id = NULL,
  test_workflow_id = NULL,
  allow_multiple_accounts = true,
  limit_check_action_codes = EXCLUDED.limit_check_action_codes,
  is_delete = false;

UPDATE public.ai_prompt
SET
  prompt_user = 'Trích xuất danh sách dữ liệu từ ảnh.

Nền tảng: [platform]
Action ID: [actionId]

Quy tắc output:
- Nếu platform = "zalo" hoặc "sms": trả về JSON array, mỗi item có thể có "name", "phone", "info1", "info2", "info3", "info4", "info5". Field bắt buộc là "phone".
- Nếu platform = "facebook": trả về JSON array, mỗi item có thể có "name", "uid". Field bắt buộc là "uid".
- Nếu platform = "email": trả về JSON array, mỗi item có thể có "name", "email". Field bắt buộc là "email".
- Không tự bịa dữ liệu không thấy rõ trong ảnh.
- Chuẩn JSON array duy nhất, ví dụ: [{"name":"Nguyễn Văn A","phone":"0912345678","info1":""}].',
  updated_at = now()
WHERE code = 'campaign_import_image_to_data';

NOTIFY pgrst, 'reload schema';

COMMIT;
