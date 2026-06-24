-- Seed AI use case for importing campaign input data from an image.

BEGIN;

WITH prompt_upsert AS (
  INSERT INTO public.ai_prompt (
    code,
    name,
    prompt_system,
    prompt_user,
    is_reasoning,
    is_system,
    is_active
  )
  VALUES (
    'campaign_import_image_to_data',
    'Campaign import image to data',
    'Bạn là bộ trích xuất dữ liệu từ ảnh cho akaAgent. Chỉ trả về JSON hợp lệ, không markdown, không giải thích.',
    'Trích xuất danh sách dữ liệu từ ảnh.

Nền tảng: [platform]
Action ID: [actionId]

Quy tắc output:
- Nếu platform = "zalo": trả về JSON array, mỗi item có thể có "name", "phone", "info1", "info2", "info3", "info4", "info5". Field bắt buộc là "phone".
- Nếu platform = "facebook": trả về JSON array, mỗi item có thể có "name", "uid". Field bắt buộc là "uid".
- Nếu platform = "email": trả về JSON array, mỗi item có thể có "name", "email". Field bắt buộc là "email".
- Không tự bịa dữ liệu không thấy rõ trong ảnh.
- Chuẩn JSON array duy nhất, ví dụ: [{"name":"Nguyễn Văn A","phone":"0912345678","info1":""}].',
    false,
    true,
    true
  )
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    prompt_system = EXCLUDED.prompt_system,
    prompt_user = EXCLUDED.prompt_user,
    is_reasoning = EXCLUDED.is_reasoning,
    is_system = true,
    is_active = true,
    updated_at = now()
  RETURNING id
),
prompt_ref AS (
  SELECT id FROM prompt_upsert
  UNION ALL
  SELECT id FROM public.ai_prompt WHERE code = 'campaign_import_image_to_data'
  LIMIT 1
),
model_ref AS (
  SELECT id FROM public.ai_model
  WHERE code = 'openai_akabiz_write_content'
    AND is_active = true
  LIMIT 1
)
INSERT INTO public.ai_using (
  code,
  name,
  description,
  prompt_id,
  model_id,
  is_system,
  is_active,
  response_parser,
  request_options,
  timeout_ms
)
SELECT
  'app_campaign_import_image_to_data',
  'App campaign import image to data',
  'Trích xuất danh sách data campaign từ ảnh upload/paste trong form Upload dữ liệu.',
  prompt_ref.id,
  model_ref.id,
  true,
  true,
  'auto',
  '{}'::jsonb,
  120000
FROM prompt_ref, model_ref
WHERE prompt_ref.id IS NOT NULL
  AND model_ref.id IS NOT NULL
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  prompt_id = EXCLUDED.prompt_id,
  model_id = EXCLUDED.model_id,
  is_system = true,
  is_active = true,
  response_parser = EXCLUDED.response_parser,
  request_options = EXCLUDED.request_options,
  timeout_ms = EXCLUDED.timeout_ms,
  updated_at = now();

COMMIT;
