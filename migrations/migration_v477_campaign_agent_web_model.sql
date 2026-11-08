-- V477: model gpt-6.1-terra dùng riêng cho "Thêm chiến dịch bằng Agent" trên Web (akaAgentWebApp).
-- Chỉ thêm một hàng ai_model; key OpenAI chép trong DB từ model 21 (cùng tài khoản OpenAI), không in ra.
-- Không đổi model/cấu hình đang chạy, không DDL/RPC/quyền. Chưa có ai_form_configs nào trỏ tới hàng này:
-- cấu hình Agent Web (web_section_id 'campaign.agent', prompt + schema) thêm ở migration sau, cùng code API.
-- Phương án: akaAgentWebApp docs/CAMPAIGN_AGENT_WEB_PLAN.md. Rollback: rollback_v477_campaign_agent_web_model.sql.
DO $migration$
DECLARE
  source_model public.ai_model%ROWTYPE;
  target public.ai_model%ROWTYPE;
  model_count bigint;
  sequence_value bigint;
  max_id bigint;
BEGIN
  SELECT * INTO STRICT source_model FROM public.ai_model WHERE id = 21 FOR SHARE;
  IF source_model.code IS DISTINCT FROM 'openai_campaign_diagnostics_sol61' OR source_model.provider IS DISTINCT FROM 'openai'
    OR source_model.model IS DISTINCT FROM 'gpt-6.1-sol'
    OR source_model.endpoint IS DISTINCT FROM 'https://api.openai.com/v1/responses'
    OR source_model.organization_id IS NOT NULL OR NOT source_model.is_active
    OR nullif(btrim(source_model.api_key), '') IS NULL THEN
    RAISE EXCEPTION 'V477: source model 21 changed or has no active key';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_model WHERE code = 'openai_campaign_agent_web_terra' OR model = 'gpt-6.1-terra') THEN
    RAISE EXCEPTION 'V477: target model already exists';
  END IF;
  -- id là identity GENERATED ALWAYS: sequence phải đứng sau mọi id đã có.
  SELECT last_value INTO STRICT sequence_value FROM pg_sequences
    WHERE schemaname = 'public' AND sequencename = 'ai_model_id_seq';
  SELECT max(id), count(*) INTO max_id, model_count FROM public.ai_model;
  IF sequence_value IS NULL OR sequence_value < max_id THEN
    RAISE EXCEPTION 'V477: ai_model_id_seq is behind max(id)';
  END IF;

  INSERT INTO public.ai_model (code, provider, model, endpoint, api_key, default_body, organization_id, is_system, is_active)
  VALUES ('openai_campaign_agent_web_terra', 'openai', 'gpt-6.1-terra', source_model.endpoint, source_model.api_key,
    '{"model":"gpt-6.1-terra","store":false,"reasoning":{"effort":"medium"}}'::jsonb, NULL, true, true)
  RETURNING * INTO STRICT target;

  IF target.provider IS DISTINCT FROM 'openai' OR target.model IS DISTINCT FROM 'gpt-6.1-terra'
    OR target.endpoint IS DISTINCT FROM 'https://api.openai.com/v1/responses'
    OR target.organization_id IS NOT NULL OR NOT target.is_system OR NOT target.is_active
    OR target.api_key IS DISTINCT FROM source_model.api_key
    OR (SELECT count(*) FROM public.ai_model) <> model_count + 1
    OR EXISTS (SELECT 1 FROM public.ai_form_configs WHERE model_id = target.id)
    OR EXISTS (SELECT 1 FROM public.ai_using WHERE model_id = target.id) THEN
    RAISE EXCEPTION 'V477: postflight check failed';
  END IF;
END;
$migration$;
