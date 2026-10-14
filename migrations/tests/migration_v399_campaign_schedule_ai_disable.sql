-- Disable this feature only; retain prompt and AI logs for audit. No schema reload.
BEGIN;
SET LOCAL statement_timeout = '10s';
DO $guard$
BEGIN
  IF (SELECT count(*) FROM public.ai_using u JOIN public.ai_prompt p ON p.id=u.prompt_id
    JOIN public.ai_model m ON m.id=u.model_id
    WHERE u.code='app_campaign_schedule' AND p.code='app_campaign_schedule'
      AND u.organization_id IS NULL AND p.organization_id IS NULL AND u.is_system AND p.is_system
      AND m.code='openai_campaign_diagnostics_sol61' AND m.model='gpt-6.1-sol'
      AND u.timeout_ms=120000 AND u.response_parser='auto' AND u.request_options='{"store":false}'::jsonb
      AND md5(p.prompt_system)='08dffa2e40317ce384fd0ec054bcd33e' AND p.prompt_user='{{scheduleContext}}') <> 1 THEN
    RAISE EXCEPTION 'Schedule AI changed; inspect before disabling';
  END IF;
END $guard$;
UPDATE public.ai_using SET is_active=false WHERE code='app_campaign_schedule' AND organization_id IS NULL;
COMMIT;
