-- Run only when explicitly rolling back the Web binding, never during normal rollout.
DO $rollback$
DECLARE current_row jsonb;
BEGIN
  SELECT to_jsonb(c) INTO current_row FROM public.ai_form_configs c
    WHERE code = 'app_campaign_send_exclusions' FOR UPDATE;
  IF current_row IS NULL OR md5(current_row::text) <> 'cf5c07d8f50596be2db9c26b193bec63' THEN
    RAISE EXCEPTION 'Web exclusion config changed after rollout; inspect before rollback';
  END IF;
  UPDATE public.ai_form_configs SET web_section_id = NULL
    WHERE code = 'app_campaign_send_exclusions';
END;
$rollback$;
