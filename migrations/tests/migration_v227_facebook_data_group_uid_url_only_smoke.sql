-- Rollback smoke for migration_v227_facebook_data_group_uid_url_only.sql.
-- A semantically-compatible Facebook target with a valid URL must route even
-- when legacy/import metadata has no platform and a generic contact type.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
DECLARE
  v_live text := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)'
    )
  );
  v_snapshot text := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
    )
  );
  v_preview text := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.aka_agent_internal_preview_data_group_target_key(bigint,bigint,bigint,bigint,text,bigint)'
    )
  );
BEGIN
  IF pg_catalog.strpos(
    v_live, 'v227: Facebook routes use semantic type plus UID/URL only'
  ) = 0 OR pg_catalog.strpos(
    v_snapshot, 'v227: snapshot Facebook routes use semantic type plus UID/URL only'
  ) = 0 OR pg_catalog.strpos(
    v_preview, 'v227: preview Facebook routes use semantic type plus UID/URL only'
  ) = 0 THEN
    RAISE EXCEPTION 'v227_smoke: one or more v227 Facebook route patches are missing';
  END IF;

  IF pg_catalog.strpos(v_live, $$v_platform <> 'facebook'$$) > 0
    OR pg_catalog.strpos(v_snapshot, $$v_platform <> 'facebook'$$) > 0
    OR pg_catalog.strpos(v_preview, $$v_platform <> 'facebook'$$) > 0
  THEN
    RAISE EXCEPTION 'v227_smoke: a Facebook platform metadata guard remains';
  END IF;

  IF pg_catalog.strpos(
    v_live,
    $$v_action = 'zalo_message_friend' AND v_contact.is_friend IS DISTINCT FROM true$$
  ) = 0 OR pg_catalog.strpos(
    v_live, $$v_contact.is_joined IS DISTINCT FROM true$$
  ) = 0 OR pg_catalog.strpos(
    v_snapshot,
    $$(v_action = 'zalo_message_friend' AND v_contact.is_friend IS DISTINCT FROM true)$$
  ) = 0 OR pg_catalog.strpos(
    v_snapshot, $$v_contact.is_joined IS DISTINCT FROM true$$
  ) = 0 THEN
    RAISE EXCEPTION 'v227_smoke: a Zalo relationship guard was removed';
  END IF;
END;
$metadata$;

DO $behavior$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_auth_username text;
  v_auth_password text;
  v_account_id constant bigint := 2024227001;
  v_group_id constant bigint := 8800227000000001;
  v_live_campaign_id constant bigint := 8800227000000002;
  v_direct_campaign_id constant bigint := 8800227000000003;
  v_contact_id constant bigint := 8800227000000010;
  v_preview record;
  v_input_count bigint;
  v_input_uid text;
BEGIN
  SELECT staff.id, staff.organization_id, staff.username, staff.password
  INTO v_staff_id, v_organization_id, v_auth_username, v_auth_password
  FROM public.org_staff AS staff
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
    AND staff.username IS NOT NULL
    AND staff.password IS NOT NULL
  ORDER BY staff.id
  LIMIT 1;

  IF v_staff_id IS NULL OR v_organization_id IS NULL
    OR v_auth_username IS NULL OR v_auth_password IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.auto_campaign_actions AS action
      WHERE action.id = 'facebook_message_uid'
        AND COALESCE(action.is_delete, false) = false
    )
  THEN
    RAISE NOTICE 'v227_smoke: active fixture tenant/action missing; behavior fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aka-agent-v227-facebook-uid-url-smoke', 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.auto_accounts WHERE id = v_account_id
  ) OR EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups WHERE id = v_group_id
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaigns
    WHERE id IN (v_live_campaign_id, v_direct_campaign_id)
  ) OR EXISTS (
    SELECT 1 FROM public.auto_account_contacts WHERE id = v_contact_id
  ) THEN
    RAISE EXCEPTION 'v227_smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_account_id, '__v227_account__', 'facebook', false, false,
    'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_account_contact_groups (
    id, account_id, contact_type, name, purpose,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_group_id, NULL, NULL, '__v227_group__', 'data_group',
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_account_contacts (
    id, account_id, contact_type, name, uid, url,
    flatform_type, is_friend, is_joined,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_contact_id, NULL, 'campaign_input', '__v227_target__',
    '22700001', 'https://www.facebook.com/profile.php?id=22700001',
    NULL, false, false,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_account_contact_group_members (
    group_id, contact_id, is_delete, change_revision
  ) VALUES (v_group_id, v_contact_id, false, 0);

  SELECT * INTO v_preview
  FROM public.aka_agent_preview_data_group_campaign_targets(
    v_staff_id,
    v_organization_id,
    v_group_id,
    'facebook_message_uid',
    ARRAY[v_account_id]::bigint[],
    v_auth_username,
    v_auth_password
  );
  IF v_preview.valid_target_count IS DISTINCT FROM 1::bigint
    OR v_preview.compatible_membership_count IS DISTINCT FROM 1::bigint
  THEN
    RAISE EXCEPTION 'v227_smoke: preview rejected valid metadata-free target: %',
      row_to_json(v_preview);
  END IF;

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, data_target_source_mode,
    provisioning_state, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_live_campaign_id, '__v227_live__', 'facebook_message_uid',
      v_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    ),
    (
      v_direct_campaign_id, '__v227_direct__', 'facebook_message_uid',
      v_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    );

  PERFORM public.aka_agent_bind_campaign_data_group_source(
    v_staff_id,
    v_organization_id,
    '__v227_bind__' || v_staff_id::text,
    v_live_campaign_id,
    v_group_id,
    NULL::bigint,
    v_auth_username,
    v_auth_password
  );

  SELECT count(*)::bigint, min(input_data.uid)
  INTO v_input_count, v_input_uid
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = v_live_campaign_id
    AND COALESCE(input_data.is_delete, false) = false;
  IF v_input_count IS DISTINCT FROM 1::bigint
    OR v_input_uid IS DISTINCT FROM 'https://www.facebook.com/profile.php?id=22700001'
  THEN
    RAISE EXCEPTION 'v227_smoke: live bind rejected metadata-free target: %, %',
      v_input_count, v_input_uid;
  END IF;

  PERFORM public.aka_agent_snapshot_data_group_to_direct_campaign(
    v_staff_id,
    v_organization_id,
    '__v227_snapshot__' || v_staff_id::text,
    v_direct_campaign_id,
    v_group_id,
    now(),
    'tạm dừng',
    v_auth_username,
    v_auth_password
  );

  SELECT count(*)::bigint, min(input_data.uid)
  INTO v_input_count, v_input_uid
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = v_direct_campaign_id
    AND COALESCE(input_data.is_delete, false) = false;
  IF v_input_count IS DISTINCT FROM 1::bigint
    OR v_input_uid IS DISTINCT FROM 'https://www.facebook.com/profile.php?id=22700001'
  THEN
    RAISE EXCEPTION 'v227_smoke: direct snapshot rejected metadata-free target: %, %',
      v_input_count, v_input_uid;
  END IF;
END;
$behavior$;

ROLLBACK;
