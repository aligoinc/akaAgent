-- Optional operational rollback: disable only this AI feature. Keep evidence RPC and historical AI rows/logs.
-- For smoke verification, replace COMMIT with ROLLBACK. Not a migration to apply on rollout.
BEGIN;
DO $guard$
BEGIN
  IF (SELECT md5(pg_get_functiondef(oid)) FROM pg_proc
    WHERE oid=to_regprocedure('public.aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text)'))
    IS DISTINCT FROM '2b0ba11c25cc61f111f5ed068a31626c' THEN RAISE EXCEPTION 'diagnostics_definition_changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ai_using u JOIN public.ai_model m ON m.id=u.model_id JOIN public.ai_prompt p ON p.id=u.prompt_id
    WHERE u.code='app_campaign_diagnostics' AND p.code=u.code AND m.code='openai_campaign_diagnostics_sol61'
      AND m.model='gpt-6.1-sol' AND u.timeout_ms=120000 AND u.organization_id IS NULL AND u.is_system) THEN
    RAISE EXCEPTION 'diagnostics_configuration_changed';
  END IF;
END;
$guard$;
UPDATE public.ai_using SET is_active=false,updated_at=now() WHERE code='app_campaign_diagnostics';
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ai_using WHERE code='app_campaign_diagnostics' AND is_active) THEN RAISE EXCEPTION 'disable_failed'; END IF;
END;
$verify$;
COMMIT;
