-- Run the canonical migration inside BEGIN first; these assertions must pass before ROLLBACK.

DO $check$
DECLARE c public.ai_form_configs%ROWTYPE; m public.ai_model%ROWTYPE;
BEGIN
  SELECT * INTO STRICT c FROM public.ai_form_configs WHERE code='app_campaign_content';
  SELECT * INTO STRICT m FROM public.ai_model WHERE id=c.model_id;
  IF c.desktop_section_id <> 'campaign.content' OR c.web_section_id <> 'campaign.content' OR c.mobile_section_id IS NOT NULL
    OR c.campaign_scope <> 'all' OR cardinality(c.campaign_action_ids) <> 0 OR NOT c.is_active
    OR m.model <> 'claude-haiku-5-5' OR m.organization_id IS NOT NULL OR NOT m.is_active
    OR m.api_key IS DISTINCT FROM (SELECT api_key FROM public.ai_model WHERE id=7)
    OR m.default_body IS DISTINCT FROM '{"max_tokens":16384}'::jsonb THEN RAISE EXCEPTION 'V417 row contract failed'; END IF;
  IF has_table_privilege('anon','public.ai_form_configs','UPDATE') THEN RAISE EXCEPTION 'Client must not update form configuration'; END IF;
  IF (SELECT md5(to_jsonb(old_config)::text) FROM public.ai_form_configs old_config WHERE code='app_campaign_schedule') <> '8d5756e1b68cf0ad5aad3c5c3a2fa7e6'
    OR (SELECT md5(to_jsonb(old_config)::text) FROM public.ai_form_configs old_config WHERE code='app_campaign_action_limits') <> '243aa41a6f4111f6ffaa69392be2dbb4' THEN RAISE EXCEPTION 'Existing config changed'; END IF;
END $check$;
SET LOCAL ROLE anon;
DO $read$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_form_configs WHERE code='app_campaign_content') THEN RAISE EXCEPTION 'Client cannot read active config'; END IF;
END $read$;
RESET ROLE;
