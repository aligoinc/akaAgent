-- Seed AI use case for generating campaign names in CampaignFormModal.

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
    'app_campaign_name_generator',
    'App campaign name generator',
    'Bạn là công cụ đặt tên chiến dịch cho akaAgent. Chỉ trả về duy nhất tên chiến dịch tiếng Việt, không markdown, không giải thích, không đặt trong dấu ngoặc kép.',
    'Tạo tên chiến dịch từ dữ liệu sau:

- Hành động: [actionName]
- Ngày hiện tại: [currentDateLabel]
- Tài khoản: [accountName]

Quy tắc:
- Tên phải tự nhiên, ngắn gọn, dễ hiểu bằng tiếng Việt.
- Tối đa 10 từ.
- Bắt buộc có ngày [currentDateLabel] đúng dạng dd/MM.
- Nếu tài khoản trống, không nhắc tên tài khoản.
- Chỉ trả về tên chiến dịch, không thêm mô tả.',
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
  SELECT id FROM public.ai_prompt WHERE code = 'app_campaign_name_generator'
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
  'app_ai_generate_campaign_name',
  'App AI generate campaign name',
  'Tạo tên chiến dịch tự động từ hành động, tài khoản và ngày hiện tại trong form chiến dịch.',
  prompt_ref.id,
  model_ref.id,
  true,
  true,
  'auto',
  '{"max_output_tokens":128,"reasoning":{"effort":"minimal"},"text":{"verbosity":"low"}}'::jsonb,
  30000
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
