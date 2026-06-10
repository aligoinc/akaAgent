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
    'campaign_error_screenshot_diagnosis',
    'Campaign error screenshot diagnosis',
    'Bạn là trợ lý chẩn đoán lỗi automation Facebook từ ảnh chụp màn hình. Trả lời bằng tiếng Việt tự nhiên, ngắn gọn, chỉ nêu nguyên nhân khả dĩ cho khách hàng. Không nhắc AI, không nhắc chi tiết kỹ thuật nội bộ, không markdown.',
    'Dựa vào ảnh trạng thái trình duyệt và thông tin lỗi bên dưới, hãy xác định nguyên nhân dễ hiểu nhất.

Chiến dịch: [campaignName]
Loại chiến dịch: [campaignActionId]
Hành động: [actionName]
Lỗi hệ thống ghi nhận: [errorMessage]
Log đầy đủ: [fullLog]
URL trình duyệt: [browserUrl]

Chỉ trả về một câu tiếng Việt ngắn, tối đa 160 ký tự.',
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
  SELECT id FROM public.ai_prompt WHERE code = 'campaign_error_screenshot_diagnosis'
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
  'campaign_error_screenshot_diagnosis',
  'Campaign error screenshot diagnosis',
  'Chẩn đoán lỗi chiến dịch chưa định nghĩa bằng screenshot khi chạm ngưỡng lỗi liên tiếp.',
  prompt_ref.id,
  model_ref.id,
  true,
  true,
  'auto',
  '{}'::jsonb,
  120000
FROM prompt_ref, model_ref
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
