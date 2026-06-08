BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_model (
  id bigint GENERATED ALWAYS AS IDENTITY,
  code text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  endpoint text NOT NULL,
  api_key text,
  default_body jsonb NOT NULL DEFAULT '{}'::jsonb,
  organization_id bigint NULL,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_model_pkey PRIMARY KEY (id),
  CONSTRAINT ai_model_code_unique UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS public.ai_prompt (
  id bigint GENERATED ALWAYS AS IDENTITY,
  code text NOT NULL,
  name text NOT NULL,
  prompt_system text,
  prompt_user text NOT NULL DEFAULT '',
  is_reasoning boolean NOT NULL DEFAULT false,
  organization_id bigint NULL,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_prompt_pkey PRIMARY KEY (id),
  CONSTRAINT ai_prompt_code_unique UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS public.ai_personalization (
  id bigint GENERATED ALWAYS AS IDENTITY,
  source_table text NOT NULL,
  source_column text NOT NULL,
  text_symbol text NOT NULL,
  description text,
  organization_id bigint NULL,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_personalization_pkey PRIMARY KEY (id),
  CONSTRAINT ai_personalization_symbol_unique UNIQUE (source_table, source_column, text_symbol)
);

CREATE TABLE IF NOT EXISTS public.ai_using (
  id bigint GENERATED ALWAYS AS IDENTITY,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  prompt_id bigint NOT NULL REFERENCES public.ai_prompt(id),
  model_id bigint NOT NULL REFERENCES public.ai_model(id),
  organization_id bigint NULL,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  timeout_ms integer NOT NULL DEFAULT 120000,
  response_parser text NOT NULL DEFAULT 'auto',
  response_path text,
  request_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_using_pkey PRIMARY KEY (id),
  CONSTRAINT ai_using_code_unique UNIQUE (code)
);

CREATE TABLE IF NOT EXISTS public.ai_log (
  id bigint GENERATED ALWAYS AS IDENTITY,
  using_id bigint NULL REFERENCES public.ai_using(id),
  model_id bigint NULL REFERENCES public.ai_model(id),
  prompt_id bigint NULL REFERENCES public.ai_prompt(id),
  organization_id bigint NULL,
  campaign_id bigint NULL,
  campaign_input_id bigint NULL,
  campaign_input_data_id bigint NULL,
  account_id bigint NULL,
  workflow_id bigint NULL,
  run_id bigint NULL,
  run_step_id bigint NULL,
  node_id text NULL,
  block_id bigint NULL,
  block_name text NULL,
  using_code text,
  provider text,
  model text,
  endpoint text,
  status text NOT NULL,
  http_status integer NULL,
  rendered_system_prompt text NULL,
  rendered_user_prompt text NULL,
  sanitized_request jsonb NOT NULL DEFAULT '{}'::jsonb,
  sanitized_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_text text NULL,
  error_message text NULL,
  token_input integer NULL,
  token_output integer NULL,
  duration_ms integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_log_pkey PRIMARY KEY (id),
  CONSTRAINT ai_log_status_check CHECK (status IN ('success', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_ai_model_active_code
  ON public.ai_model (code)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_ai_prompt_active_code
  ON public.ai_prompt (code)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_ai_using_active_code
  ON public.ai_using (code)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_ai_log_created_at
  ON public.ai_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_log_campaign
  ON public.ai_log (campaign_id, created_at DESC)
  WHERE campaign_id IS NOT NULL;

INSERT INTO public.ai_model (code, provider, model, endpoint, api_key, default_body, is_system, is_active)
VALUES (
  'openai_akabiz_write_content',
  'openai',
  'gpt-5-mini',
  'https://api.openai.com/v1/responses',
  '',
  '{}'::jsonb,
  true,
  true
)
ON CONFLICT (code) DO UPDATE SET
  provider = EXCLUDED.provider,
  model = CASE WHEN public.ai_model.model = '' THEN EXCLUDED.model ELSE public.ai_model.model END,
  endpoint = EXCLUDED.endpoint,
  default_body = CASE WHEN public.ai_model.default_body = '{}'::jsonb THEN EXCLUDED.default_body ELSE public.ai_model.default_body END,
  is_system = true,
  is_active = true,
  updated_at = now();

INSERT INTO public.ai_model (code, provider, model, endpoint, api_key, default_body, is_system, is_active)
SELECT
  'deepseek_default',
  'deepseek',
  COALESCE(NULLIF(model_setting.value, ''), 'deepseek-v4-flash'),
  COALESCE(NULLIF(endpoint_setting.value, ''), 'https://api.deepseek.com/chat/completions'),
  COALESCE(api_key_setting.value, ''),
  COALESCE(NULLIF(body_setting.value, '')::jsonb, '{}'::jsonb),
  true,
  true
FROM (SELECT 1) seed
LEFT JOIN public.auto_system_settings AS api_key_setting
  ON api_key_setting.key = 'ai.deepseek.api_key'
LEFT JOIN public.auto_system_settings AS endpoint_setting
  ON endpoint_setting.key = 'ai.deepseek.endpoint'
LEFT JOIN public.auto_system_settings AS model_setting
  ON model_setting.key = 'ai.deepseek.model'
LEFT JOIN public.auto_system_settings AS body_setting
  ON body_setting.key = 'ai.deepseek.default_body'
ON CONFLICT (code) DO UPDATE SET
  provider = EXCLUDED.provider,
  model = EXCLUDED.model,
  endpoint = EXCLUDED.endpoint,
  api_key = CASE WHEN COALESCE(public.ai_model.api_key, '') = '' THEN EXCLUDED.api_key ELSE public.ai_model.api_key END,
  default_body = EXCLUDED.default_body,
  is_system = true,
  is_active = true,
  updated_at = now();

INSERT INTO public.ai_prompt (code, name, prompt_system, prompt_user, is_reasoning, is_system, is_active)
VALUES
  (
    'akabiz_rewrite_content',
    'AkaBiz - Rewrite content',
    NULL,
    'Viết lại nội dung sau bằng tiếng Việt tự nhiên, giữ nguyên ý chính và không thêm giải thích ngoài nội dung kết quả:

[content]',
    false,
    true,
    true
  ),
  (
    'akabiz_write_multi_other_content',
    'AkaBiz - Write multi other content',
    NULL,
    'Viết [count] nội dung khác nhau dựa trên nội dung sau. Chỉ trả về danh sách nội dung:

[content]',
    false,
    true,
    true
  ),
  (
    'passthrough_question',
    'Pass-through question',
    NULL,
    '[question]',
    false,
    true,
    true
  ),
  (
    'newsfeed_like_check',
    'Newsfeed like condition check',
    NULL,
    'Bài viết sau có tính chất "[kind]" không? Chỉ trả lời có hoặc không.

[content]',
    false,
    true,
    true
  ),
  (
    'newsfeed_comment_check',
    'Newsfeed comment condition check',
    NULL,
    'Bài viết sau có tính chất "[kind]" không? Chỉ trả lời có hoặc không.

[content]',
    false,
    true,
    true
  ),
  (
    'find_data_meaning_check',
    'Find data meaning filter',
    'Bạn là bộ lọc dữ liệu cho chiến dịch tìm data Facebook. Trả về JSON hợp lệ duy nhất, không giải thích ngoài JSON.',
    'Kiểm tra nội dung bên dưới có khớp ÍT NHẤT 1 tính chất trong danh sách hay không.

Danh sách tính chất cần tìm:
[criteria]

Loại dữ liệu: [entity_type]

Nội dung cần kiểm tra:
[content]

Format JSON:
{"matched":true,"matchMode":"any","matchedTraits":[{"index":1,"trait":"...","reason":"..."}],"reason":"..."}',
    true,
    true,
    true
  ),
  (
    'facebook_campaign_assistant',
    'Facebook campaign assistant',
    COALESCE(
      (SELECT NULLIF(value, '') FROM public.auto_system_settings WHERE key = 'assistant.facebook.campaign.system_prompt' LIMIT 1),
      'Bạn là trợ lý hỗ trợ khách hàng của AkaBiz, chuyên giúp người dùng xử lý chiến dịch Facebook.'
    ),
    '[question]',
    true,
    true,
    true
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  prompt_system = CASE WHEN COALESCE(public.ai_prompt.prompt_system, '') = '' THEN EXCLUDED.prompt_system ELSE public.ai_prompt.prompt_system END,
  prompt_user = CASE WHEN COALESCE(public.ai_prompt.prompt_user, '') = '' THEN EXCLUDED.prompt_user ELSE public.ai_prompt.prompt_user END,
  is_reasoning = EXCLUDED.is_reasoning,
  is_system = true,
  is_active = true,
  updated_at = now();

INSERT INTO public.ai_personalization (source_table, source_column, text_symbol, description, is_system, is_active)
VALUES
  ('auto_campaign_input_data', 'name', '{{tên khách hàng}}', 'Tên khách hàng/target từ data chiến dịch.', true, true),
  ('auto_campaign_input_data', 'name', '{{ten_khach_hang}}', 'Tên khách hàng/target không dấu.', true, true),
  ('auto_campaign_input_data', 'uid', '{{uid}}', 'UID hoặc URL target từ data chiến dịch.', true, true),
  ('auto_accounts', 'name', '{{tên tài khoản}}', 'Tên tài khoản Facebook đang chạy.', true, true),
  ('auto_accounts', 'name', '{{ten_tai_khoan}}', 'Tên tài khoản Facebook đang chạy không dấu.', true, true)
ON CONFLICT (source_table, source_column, text_symbol) DO UPDATE SET
  description = EXCLUDED.description,
  is_system = true,
  is_active = true,
  updated_at = now();

WITH refs AS (
  SELECT
    (SELECT id FROM public.ai_model WHERE code = 'openai_akabiz_write_content') AS openai_model_id,
    (SELECT id FROM public.ai_model WHERE code = 'deepseek_default') AS deepseek_model_id,
    (SELECT id FROM public.ai_prompt WHERE code = 'akabiz_rewrite_content') AS rewrite_prompt_id,
    (SELECT id FROM public.ai_prompt WHERE code = 'akabiz_write_multi_other_content') AS multi_prompt_id,
    (SELECT id FROM public.ai_prompt WHERE code = 'passthrough_question') AS passthrough_prompt_id,
    (SELECT id FROM public.ai_prompt WHERE code = 'find_data_meaning_check') AS find_data_prompt_id,
    (SELECT id FROM public.ai_prompt WHERE code = 'facebook_campaign_assistant') AS assistant_prompt_id
), seed_rows AS (
  SELECT * FROM refs, (VALUES
    ('fb_type_post_content_rewrite', 'Block fb_type_post_content - rewrite nội dung', 'Viết lại nội dung trước khi gõ vào composer.', 'rewrite', 'openai'),
    ('fb_send_message_rewrite', 'Block fb_send_message - rewrite tin nhắn', 'Viết lại nội dung tin nhắn trước khi gửi Messenger.', 'rewrite', 'openai'),
    ('fb_share_post_rewrite', 'Block fb_share_post - rewrite nội dung share', 'Viết lại nội dung khi share bài từ source link.', 'rewrite', 'openai'),
    ('fb_post_reels_rewrite', 'Block fb_post_reels - rewrite nội dung reels', 'Viết lại nội dung khi đăng reels.', 'rewrite', 'openai'),
    ('fb_comment_at_position_rewrite', 'Block fb_comment_at_position - rewrite comment', 'Viết lại nội dung comment trong feed/group.', 'rewrite', 'openai'),
    ('fb_comment_current_post_rewrite', 'Block fb_comment_current_post - rewrite comment', 'Viết lại nội dung comment trên permalink.', 'rewrite', 'openai'),
    ('fb_page_post_api_rewrite', 'Block fb_page_post_api - rewrite nội dung page API', 'Viết lại nội dung đăng fanpage bằng Graph API.', 'rewrite', 'openai'),
    ('fb_post_current_identity_ui_rewrite', 'Block fb_post_current_identity_ui - rewrite nội dung page UI', 'Viết lại nội dung đăng fanpage bằng UI.', 'rewrite', 'openai'),
    ('fb_send_page_inbox_message_rewrite', 'Block fb_send_page_inbox_message - rewrite tin nhắn page inbox', 'Viết lại nội dung nhắn khách từng inbox page.', 'rewrite', 'openai'),
    ('fb_rewrite_source_content_ai', 'Block fb_rewrite_source_content_ai', 'Edit phần nội dung copy từ nguồn bằng prompt tuỳ chỉnh.', 'passthrough', 'openai'),
    ('fb_newsfeed_check_like', 'Block fb_newsfeed_check_like', 'Kiểm tra bài newsfeed có phù hợp điều kiện like.', 'passthrough', 'openai'),
    ('fb_newsfeed_check_comment', 'Block fb_newsfeed_check_comment', 'Kiểm tra bài newsfeed và tạo comment khi bật AI.', 'passthrough', 'openai'),
    ('fb_extract_data_from_group_posts_ai_filter', 'Block fb_extract_data_from_group_posts - AI filter', 'Lọc ý nghĩa nội dung bài viết trong group.', 'find_data', 'deepseek'),
    ('fb_collect_group_comments_ai_filter', 'Block fb_collect_group_comments - AI filter', 'Lọc ý nghĩa comment trong group.', 'find_data', 'deepseek'),
    ('fb_extract_data_from_search_posts_ai_filter', 'Block fb_extract_data_from_search_posts - AI filter', 'Lọc ý nghĩa bài viết từ Facebook search.', 'find_data', 'deepseek'),
    ('fb_collect_search_post_comments_ai_filter', 'Block fb_collect_search_post_comments - AI filter', 'Lọc ý nghĩa comment từ Facebook search.', 'find_data', 'deepseek'),
    ('app_ai_rewrite_content', 'App AI rewrite content', 'Công cụ viết lại nội dung trong form nội dung.', 'rewrite', 'openai'),
    ('app_ai_write_multi_other_content', 'App AI write multi other content', 'Công cụ tạo nhiều biến thể nội dung trong form nội dung.', 'multi', 'openai'),
    ('app_campaign_assistant_chat', 'App campaign assistant chat', 'Trợ lý chiến dịch Facebook trong app.', 'assistant', 'deepseek')
  ) AS v(code, name, description, prompt_kind, model_kind)
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
  request_options
)
SELECT
  code,
  name,
  description,
  CASE prompt_kind
    WHEN 'rewrite' THEN rewrite_prompt_id
    WHEN 'multi' THEN multi_prompt_id
    WHEN 'find_data' THEN find_data_prompt_id
    WHEN 'assistant' THEN assistant_prompt_id
    ELSE passthrough_prompt_id
  END AS prompt_id,
  CASE model_kind
    WHEN 'deepseek' THEN deepseek_model_id
    ELSE openai_model_id
  END AS model_id,
  true,
  true,
  'auto',
  '{}'::jsonb
FROM seed_rows
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  prompt_id = EXCLUDED.prompt_id,
  model_id = EXCLUDED.model_id,
  is_system = true,
  is_active = true,
  response_parser = EXCLUDED.response_parser,
  updated_at = now();

COMMENT ON TABLE public.ai_model IS 'Central AI provider/model/key configuration for akaAgent.';
COMMENT ON TABLE public.ai_prompt IS 'Central AI prompt templates used by ai_using.';
COMMENT ON TABLE public.ai_personalization IS 'Supported personalization tokens for AI prompt/content rendering.';
COMMENT ON TABLE public.ai_using IS 'Named AI use cases that bind a prompt to a model.';
COMMENT ON TABLE public.ai_log IS 'Sanitized AI request/response logs. API keys are not logged.';
COMMENT ON COLUMN public.ai_model.api_key IS 'Secret API key. Do not expose in renderer/UI logs.';
COMMENT ON COLUMN public.ai_prompt.prompt_user IS 'Template supports [key] and {{key}} placeholders rendered from payload.';
COMMENT ON COLUMN public.ai_using.code IS 'Stable application code used by aiRuntimeService.callAiUsing.';

COMMIT;
