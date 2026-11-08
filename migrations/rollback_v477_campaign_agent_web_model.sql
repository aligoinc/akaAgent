-- Rollback V477: tắt model gpt-6.1-terra của Agent Web. Không DELETE vì ai_log/ai_form_configs có FK tới ai_model.
-- Tắt cấu hình Agent Web (nếu đã thêm ở migration sau) trước, rồi mới tắt model; Web khi đó báo "Agent chưa được cấu hình".
DO $rollback$
DECLARE
  target public.ai_model%ROWTYPE;
BEGIN
  SELECT * INTO STRICT target FROM public.ai_model WHERE code = 'openai_campaign_agent_web_terra' FOR UPDATE;
  IF target.model IS DISTINCT FROM 'gpt-6.1-terra' OR target.provider IS DISTINCT FROM 'openai' THEN
    RAISE EXCEPTION 'V477 rollback: target model changed; review before rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_form_configs WHERE model_id = target.id AND is_active)
    OR EXISTS (SELECT 1 FROM public.ai_using WHERE model_id = target.id AND is_active) THEN
    RAISE EXCEPTION 'V477 rollback: disable configurations using this model first';
  END IF;
  UPDATE public.ai_model SET is_active = false, updated_at = now() WHERE id = target.id;
END;
$rollback$;
