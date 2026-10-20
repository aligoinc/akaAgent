-- Run after the migration inside a transaction; caller must ROLLBACK.
DO $checks$
DECLARE f public.ai_form_configs; original public.ai_form_configs; changed_id bigint;
BEGIN
  SELECT * INTO STRICT original FROM public.ai_form_configs WHERE code='app_campaign_schedule';
  IF original.model_id <> 21 OR original.campaign_scope <> 'all' OR cardinality(original.campaign_action_ids) <> 0
    OR original.mobile_section_id IS NOT NULL OR NOT original.is_active THEN RAISE EXCEPTION 'Seed differs'; END IF;
  IF (SELECT count(*) FROM public.ai_form_configs) <> 2 THEN RAISE EXCEPTION 'Seed count differs'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_form_configs c JOIN public.ai_using u USING(code)
    JOIN public.ai_prompt p ON p.id=u.prompt_id
    WHERE c.prompt_system IS DISTINCT FROM p.prompt_system OR c.prompt_user IS DISTINCT FROM p.prompt_user
      OR c.request_options IS DISTINCT FROM u.request_options OR c.model_id <> u.model_id
  ) THEN RAISE EXCEPTION 'Prompt/model/options drift'; END IF;

  SELECT id INTO STRICT changed_id FROM public.ai_model
  WHERE id<>21 AND organization_id IS NULL AND is_active AND provider='openai'
    AND endpoint ~ '/(responses|chat/completions)/?$' ORDER BY id LIMIT 1;
  UPDATE public.ai_form_configs SET model_id=changed_id WHERE id=original.id RETURNING * INTO f;
  IF f.model_id <> changed_id THEN RAISE EXCEPTION 'Model switch ignored'; END IF;
  UPDATE public.ai_form_configs SET model_id=original.model_id WHERE id=original.id;

  BEGIN
    UPDATE public.ai_form_configs SET campaign_scope='selected' WHERE id=original.id;
    RAISE EXCEPTION 'Empty selected accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.ai_form_configs SET campaign_action_ids=ARRAY['sms_send'] WHERE id=original.id;
    RAISE EXCEPTION 'All with list accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.ai_form_configs SET campaign_scope='selected',campaign_action_ids=ARRAY['no_such_action_v416'] WHERE id=original.id;
    RAISE EXCEPTION 'Unknown action accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.ai_form_configs SET campaign_scope='selected',campaign_action_ids=ARRAY['sms_send','sms_send'] WHERE id=original.id;
    RAISE EXCEPTION 'Duplicate action accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.ai_form_configs SET campaign_scope='selected',campaign_action_ids=ARRAY[NULL]::text[] WHERE id=original.id;
    RAISE EXCEPTION 'Null action accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.ai_form_configs SET model_id=-416 WHERE id=original.id;
    RAISE EXCEPTION 'Unknown model accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    UPDATE public.ai_form_configs SET desktop_section_id='campaign.action_limits' WHERE id=original.id;
    RAISE EXCEPTION 'Duplicate section accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    UPDATE public.ai_form_configs SET output_schema='[]' WHERE id=original.id;
    RAISE EXCEPTION 'Array schema accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE public.ai_form_configs SET desktop_section_id=NULL,web_section_id=NULL WHERE id=original.id;
    RAISE EXCEPTION 'Missing placement accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  UPDATE public.ai_form_configs SET campaign_scope='selected',campaign_action_ids=ARRAY['sms_send'] WHERE id=original.id RETURNING * INTO f;
  IF f.campaign_scope <> 'selected' THEN RAISE EXCEPTION 'Selected failed'; END IF;
  UPDATE public.ai_form_configs SET campaign_scope='all',campaign_action_ids='{}',is_active=false WHERE id=original.id;
END $checks$;

SET LOCAL ROLE anon;
DO $anon$
DECLARE config_id bigint; log_id bigint;
BEGIN
  IF (SELECT count(*) FROM public.ai_form_configs) <> 1 THEN RAISE EXCEPTION 'Inactive row visible'; END IF;
  BEGIN
    UPDATE public.ai_form_configs SET name='not allowed';
    RAISE EXCEPTION 'Anon update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.ai_form_configs;
    RAISE EXCEPTION 'Anon delete allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.ai_form_configs(code,name,model_id,output_schema,desktop_section_id,prompt_user)
    VALUES ('forbidden','forbidden',21,'{}','forbidden','forbidden');
    RAISE EXCEPTION 'Anon insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT id INTO STRICT config_id FROM public.ai_form_configs WHERE code='app_campaign_action_limits';
  INSERT INTO public.ai_log(form_config_id,model_id,using_code,status)
  VALUES(config_id,21,'app_campaign_action_limits','success') RETURNING id INTO log_id;
  IF log_id IS NULL THEN RAISE EXCEPTION 'Anon insert-returning-ID failed'; END IF;
  IF has_column_privilege(current_user,'public.ai_log','form_config_id','SELECT') THEN
    RAISE EXCEPTION 'Anon gained log content read'; END IF;
END $anon$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $authenticated$
BEGIN
  IF (SELECT count(*) FROM public.ai_form_configs) <> 1 THEN RAISE EXCEPTION 'Inactive row visible'; END IF;
  IF has_table_privilege(current_user,'public.ai_form_configs','INSERT')
    OR has_table_privilege(current_user,'public.ai_form_configs','UPDATE')
    OR has_table_privilege(current_user,'public.ai_form_configs','DELETE') THEN
    RAISE EXCEPTION 'Authenticated has write grants';
  END IF;
END $authenticated$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $service$
DECLARE config_id bigint; log_id bigint;
BEGIN
  IF (SELECT count(*) FROM public.ai_form_configs) <> 2 THEN RAISE EXCEPTION 'Service cannot read inactive'; END IF;
  SELECT id INTO STRICT config_id FROM public.ai_form_configs WHERE code='app_campaign_schedule';
  INSERT INTO public.ai_log(form_config_id,model_id,using_code,status)
  VALUES(config_id,21,'app_campaign_schedule','success') RETURNING id INTO log_id;
  IF NOT EXISTS (SELECT 1 FROM public.ai_log WHERE id=log_id AND using_id IS NULL AND prompt_id IS NULL AND form_config_id=config_id)
    THEN RAISE EXCEPTION 'Log link failed'; END IF;
  DELETE FROM public.ai_log WHERE id=log_id;
END $service$;
RESET ROLE;
SELECT 'PASS V416 constraints, preserved prompts, RLS, write denial and log FK' AS result;
