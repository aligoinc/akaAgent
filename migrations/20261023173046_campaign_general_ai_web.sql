-- Bind the existing General config to Web; all prompt/schema/model/options stay unchanged.
-- Source: akachat config 14, captured 24 October 2026 Vietnam.
DO $migration$
DECLARE
  before_row jsonb;
  after_row jsonb;
BEGIN
  SELECT to_jsonb(c) INTO before_row FROM public.ai_form_configs c WHERE code = 'app_facebook_form_general' FOR UPDATE;
  IF before_row IS NULL OR md5((before_row - 'updated_at')::text) <> '1e7c3783de9f65165548bf1bdc7e2ebe' THEN
    RAISE EXCEPTION 'campaign_general_ai_web: source config differs from reviewed snapshot';
  END IF;
  UPDATE public.ai_form_configs SET web_section_id = 'campaign.facebook.general' WHERE code = 'app_facebook_form_general';
  SELECT to_jsonb(c) INTO after_row FROM public.ai_form_configs c WHERE code = 'app_facebook_form_general';
  IF after_row->>'web_section_id' IS DISTINCT FROM 'campaign.facebook.general'
    OR (before_row - 'web_section_id' - 'updated_at') IS DISTINCT FROM (after_row - 'web_section_id' - 'updated_at') THEN
    RAISE EXCEPTION 'campaign_general_ai_web: preservation check failed';
  END IF;
END;
$migration$;
