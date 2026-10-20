-- Enable the existing Desktop configuration on Web. No prompt/schema/model/RPC changes.
-- Source: akachat, 2026-10-20; abort rather than overwrite any intervening config edit.
DO $migration$
DECLARE
  before_row jsonb;
  after_row jsonb;
BEGIN
  SELECT to_jsonb(c) INTO before_row FROM public.ai_form_configs c
    WHERE code = 'app_campaign_send_exclusions' FOR UPDATE;
  IF before_row IS NULL OR md5(before_row::text) <> 'a912cd1a0d1be0458ce97d75632255d1' THEN
    RAISE EXCEPTION 'campaign_send_exclusions_web: source config differs from reviewed snapshot';
  END IF;
  UPDATE public.ai_form_configs SET web_section_id = 'campaign.send_exclusions'
    WHERE code = 'app_campaign_send_exclusions';
  SELECT to_jsonb(c) INTO after_row FROM public.ai_form_configs c
    WHERE code = 'app_campaign_send_exclusions';
  IF after_row->>'web_section_id' <> 'campaign.send_exclusions'
    OR (before_row - 'web_section_id' - 'updated_at') IS DISTINCT FROM (after_row - 'web_section_id' - 'updated_at') THEN
    RAISE EXCEPTION 'campaign_send_exclusions_web: preservation check failed';
  END IF;
END;
$migration$;
