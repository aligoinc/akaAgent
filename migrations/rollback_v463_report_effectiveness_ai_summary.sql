-- Rollback V463: removes the "Tóm tắt bằng AI" configuration. Data only, no DDL.
-- ai_log keeps a foreign key to ai_using/ai_prompt: once the feature has been used, the rows are switched off
-- (is_active = false) so the AI history stays valid; never-used rows are deleted. The Web then shows
-- "Tóm tắt bằng AI đang được chuẩn bị" and every other report keeps working.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

DO $rollback_v463$
DECLARE
  v_using_id bigint;
  v_prompt_id bigint;
BEGIN
  SELECT id, prompt_id INTO v_using_id, v_prompt_id FROM public.ai_using
  WHERE code = 'app_report_effectiveness_summary' FOR UPDATE;
  IF v_using_id IS NULL THEN
    RAISE NOTICE 'v463 rollback: nothing to remove';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_using WHERE prompt_id = v_prompt_id AND id <> v_using_id)
     OR NOT EXISTS (SELECT 1 FROM public.ai_prompt WHERE id = v_prompt_id AND code = 'app_report_effectiveness_summary') THEN
    RAISE EXCEPTION 'v463_rollback_prompt_shared_or_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ai_log WHERE using_id = v_using_id OR prompt_id = v_prompt_id) THEN
    UPDATE public.ai_using SET is_active = false, updated_at = now() WHERE id = v_using_id;
    UPDATE public.ai_prompt SET is_active = false, updated_at = now() WHERE id = v_prompt_id;
  ELSE
    DELETE FROM public.ai_using WHERE id = v_using_id;
    DELETE FROM public.ai_prompt WHERE id = v_prompt_id;
  END IF;
END
$rollback_v463$;

COMMIT;
