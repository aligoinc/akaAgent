-- Facebook Data Group targets are portable across source accounts. Their
-- relationship flags are scan metadata, not campaign-routing authority.
-- Zalo account/relationship guards remain unchanged.

BEGIN;

DO $patch_live_facebook_routes$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)'
  );
  v_definition text;
  v_old text := $old$
  ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
    IF v_platform <> 'facebook' OR v_contact_type <> 'person'
      OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
      OR v_contact.is_friend IS DISTINCT FROM true THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'bound_facebook_friend_required');
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;
  ELSIF v_action = 'facebook_page_post' THEN
    IF v_platform <> 'facebook' OR v_contact_type <> 'page'
      OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'bound_facebook_page_required');
    END IF;
    -- Page-post workflows consume the Page ID.  Keep URL only as a legacy
    -- fallback when an older contact row has no UID.
    v_target_value := COALESCE(v_uid, v_url);
    v_target_kind := 'facebook_page';
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;
$old$;
  v_new text := $new$
  ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
    -- v226: Facebook UID/URL targets are portable across source accounts.
    -- is_friend and contact.account_id are scan metadata only.
    IF v_platform <> 'facebook' OR v_contact_type <> 'person' THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'facebook_person_required');
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    -- Retain the legacy per-campaign key namespace so existing active inputs
    -- are not duplicated when this migration is applied mid-campaign.
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;
  ELSIF v_action = 'facebook_page_post' THEN
    -- v226: Page ID/URL validity is sufficient; source account is not binding.
    IF v_platform <> 'facebook' OR v_contact_type <> 'page' THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'facebook_page_required');
    END IF;
    v_target_value := COALESCE(v_uid, v_url);
    v_target_kind := 'facebook_page';
    v_scope := 'bound:' || v_campaign.account_id::text;
    v_input_uid := v_target_value;
$new$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_v186_data_group_router_for_v226';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature) INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'v226: Facebook UID/URL targets are portable') = 0 THEN
    IF (
      length(v_definition) - length(pg_catalog.replace(v_definition, v_old, ''))
    ) <> length(v_old) THEN
      RAISE EXCEPTION 'unexpected_v186_facebook_route_shape_for_v226';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_live_facebook_routes$;

DO $patch_snapshot_facebook_routes$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
  v_definition text;
  v_old text := $old$
    ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
      IF v_platform <> 'facebook' OR v_contact_type <> 'person'
        OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
        OR v_contact.is_friend IS DISTINCT FROM true
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'facebook_person';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_target_value;
    ELSIF v_action = 'facebook_page_post' THEN
      IF v_platform <> 'facebook' OR v_contact_type <> 'page'
        OR v_contact.account_id IS DISTINCT FROM v_campaign.account_id
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_uid, v_url);
      v_target_kind := 'facebook_page';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_target_value;
$old$;
  v_new text := $new$
    ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
      -- v226: Facebook UID/URL targets do not inherit source-account or
      -- is_friend restrictions from scan metadata.
      IF v_platform <> 'facebook' OR v_contact_type <> 'person' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_url, v_uid);
      v_target_kind := 'facebook_person';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_target_value;
    ELSIF v_action = 'facebook_page_post' THEN
      -- v226: Page ID/URL validity is sufficient for a Facebook target.
      IF v_platform <> 'facebook' OR v_contact_type <> 'page' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;
      v_target_value := COALESCE(v_uid, v_url);
      v_target_kind := 'facebook_page';
      v_scope := 'bound:' || v_campaign.account_id::text;
      v_input_uid := v_target_value;
$new$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_v205_direct_snapshot_for_v226';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature) INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'v226: Facebook UID/URL targets do not inherit') = 0 THEN
    IF (
      length(v_definition) - length(pg_catalog.replace(v_definition, v_old, ''))
    ) <> length(v_old) THEN
      RAISE EXCEPTION 'unexpected_v205_snapshot_facebook_route_shape_for_v226';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_snapshot_facebook_routes$;

DO $patch_preview_facebook_routes$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_preview_data_group_target_key(bigint,bigint,bigint,bigint,text,bigint)'
  );
  v_definition text;
  v_old text := $old$
  ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
    IF v_platform <> 'facebook'
      OR v_contact_type <> 'person'
      OR v_contact.account_id IS DISTINCT FROM p_account_id
      OR v_contact.is_friend IS DISTINCT FROM true
    THEN
      RETURN NULL;
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    v_scope := 'bound:' || p_account_id::text;
  ELSIF v_action = 'facebook_page_post' THEN
    IF v_platform <> 'facebook'
      OR v_contact_type <> 'page'
      OR v_contact.account_id IS DISTINCT FROM p_account_id
    THEN
      RETURN NULL;
    END IF;
    v_target_value := COALESCE(v_uid, v_url);
    v_target_kind := 'facebook_page';
    v_scope := 'bound:' || p_account_id::text;
$old$;
  v_new text := $new$
  ELSIF v_action IN ('facebook_message_friend', 'facebook_group_invite') THEN
    -- v226: preview follows the portable Facebook UID/URL route.
    IF v_platform <> 'facebook' OR v_contact_type <> 'person' THEN
      RETURN NULL;
    END IF;
    v_target_value := COALESCE(v_url, v_uid);
    v_target_kind := 'facebook_person';
    v_scope := 'bound:' || p_account_id::text;
  ELSIF v_action = 'facebook_page_post' THEN
    IF v_platform <> 'facebook' OR v_contact_type <> 'page' THEN
      RETURN NULL;
    END IF;
    v_target_value := COALESCE(v_uid, v_url);
    v_target_kind := 'facebook_page';
    v_scope := 'bound:' || p_account_id::text;
$new$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_v225_data_group_preview_for_v226';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature) INTO v_definition;
  IF pg_catalog.strpos(v_definition, 'v226: preview follows the portable Facebook') = 0 THEN
    IF (
      length(v_definition) - length(pg_catalog.replace(v_definition, v_old, ''))
    ) <> length(v_old) THEN
      RAISE EXCEPTION 'unexpected_v225_preview_facebook_route_shape_for_v226';
    END IF;
    EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
  END IF;
END;
$patch_preview_facebook_routes$;

NOTIFY pgrst, 'reload schema';

COMMIT;
