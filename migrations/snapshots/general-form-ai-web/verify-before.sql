BEGIN;
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

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_form_configs c WHERE code = 'app_facebook_form_general'
    AND md5((to_jsonb(c)-'updated_at')::text) = '8fca42886abc4b29b5d76271d13fb0b6') THEN
    RAISE EXCEPTION 'unexpected post-migration checksum';
  END IF;
END;
$check$;
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
  IF NOT EXISTS (SELECT 1 FROM public.ai_form_configs c WHERE code = 'app_facebook_form_general'
    AND md5((to_jsonb(c)-'updated_at')::text) = '1e7c3783de9f65165548bf1bdc7e2ebe') THEN
    RAISE EXCEPTION 'rollback did not restore source';
  END IF;
  UPDATE public.ai_form_configs SET prompt_system = prompt_system || ' [drift fixture]' WHERE code = 'app_facebook_form_general';
  BEGIN
    EXECUTE $candidate$-- Bind the existing General config to Web; all prompt/schema/model/options stay unchanged.
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
$candidate$;
    RAISE EXCEPTION 'source-drift guard did not reject';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'campaign_general_ai_web: source config differs from reviewed snapshot' THEN RAISE; END IF;
  END;
END;
$check$;
ROLLBACK;
BEGIN;
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

DO $check$
BEGIN
  UPDATE public.ai_form_configs SET prompt_system = prompt_system || ' [drift fixture]' WHERE code = 'app_facebook_form_general';
  BEGIN
    EXECUTE $candidate$-- Restore only the Web binding; retain config 14 and its Desktop configuration.
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
$candidate$;
    RAISE EXCEPTION 'rollback-drift guard did not reject';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'campaign_general_ai_web: rollback source drifted' THEN RAISE; END IF;
  END;
END;
$check$;
ROLLBACK;
SELECT md5((to_jsonb(c)-'updated_at')::text) = '1e7c3783de9f65165548bf1bdc7e2ebe' AS source_unchanged
FROM public.ai_form_configs c WHERE code = 'app_facebook_form_general';
