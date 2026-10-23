BEGIN;
-- Restore only the Web binding; retain config 14 and its Desktop configuration.
DO $rollback$
BEGIN
  PERFORM 1 FROM public.ai_form_configs WHERE code = 'app_facebook_form_general' FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.ai_form_configs c WHERE code = 'app_facebook_form_general'
    AND web_section_id = 'campaign.facebook.general'
    AND md5((to_jsonb(c) - 'updated_at' - 'web_section_id')::text) = '957185f8ca4a46a6226c6e98e8ae21ef') THEN
    RAISE EXCEPTION 'campaign_general_ai_web: rollback source drifted';
  END IF;
  UPDATE public.ai_form_configs SET web_section_id = NULL WHERE code = 'app_facebook_form_general';
END;
$rollback$;

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_form_configs c WHERE code='app_facebook_form_general'
    AND md5((to_jsonb(c)-'updated_at')::text)='1e7c3783de9f65165548bf1bdc7e2ebe') THEN
    RAISE EXCEPTION 'post-apply rollback mismatch';
  END IF;
END;
$check$;
ROLLBACK;
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_form_configs c WHERE code='app_facebook_form_general'
    AND md5((to_jsonb(c)-'updated_at')::text)='8fca42886abc4b29b5d76271d13fb0b6') THEN
    RAISE EXCEPTION 'post-apply binding mismatch';
  END IF;
END;
$check$;
