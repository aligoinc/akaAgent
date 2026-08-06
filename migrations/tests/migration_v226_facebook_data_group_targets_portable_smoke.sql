-- Rollback smoke for migration_v226_facebook_data_group_targets_portable.sql.
-- Facebook targets must route by a valid UID/URL without relationship flags
-- or source-account equality. Zalo guards are intentionally untouched.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
DECLARE
  v_live_definition text := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)'
    )
  );
  v_snapshot_definition text := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
    )
  );
  v_preview_definition text := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.aka_agent_internal_preview_data_group_target_key(bigint,bigint,bigint,bigint,text,bigint)'
    )
  );
BEGIN
  IF pg_catalog.strpos(
    v_live_definition,
    'v226: Facebook UID/URL targets are portable'
  ) = 0 THEN
    RAISE EXCEPTION 'v226_smoke: live Facebook portable route is missing';
  END IF;
  IF pg_catalog.strpos(
    v_snapshot_definition,
    'v226: Facebook UID/URL targets do not inherit'
  ) = 0 THEN
    RAISE EXCEPTION 'v226_smoke: direct snapshot portable route is missing';
  END IF;
  IF pg_catalog.strpos(
    v_preview_definition,
    'v226: preview follows the portable Facebook'
  ) = 0 THEN
    RAISE EXCEPTION 'v226_smoke: preview portable route is missing';
  END IF;

  -- The Zalo friend/joined guards must remain present in both materializers.
  IF pg_catalog.strpos(
    v_live_definition,
    $$v_action = 'zalo_message_friend' AND v_contact.is_friend IS DISTINCT FROM true$$
  ) = 0 OR pg_catalog.strpos(
    v_live_definition,
    $$v_contact.is_joined IS DISTINCT FROM true$$
  ) = 0 OR pg_catalog.strpos(
    v_snapshot_definition,
    $$(v_action = 'zalo_message_friend' AND v_contact.is_friend IS DISTINCT FROM true)$$
  ) = 0 OR pg_catalog.strpos(
    v_snapshot_definition,
    $$v_contact.is_joined IS DISTINCT FROM true$$
  ) = 0 THEN
    RAISE EXCEPTION 'v226_smoke: a Zalo relationship guard was removed';
  END IF;
END;
$metadata$;

DO $behavior$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_auth_username text;
  v_auth_password text;
  v_campaign_account_id constant bigint := 2024226001;
  v_source_account_id constant bigint := 2024226002;
  v_group_id constant bigint := 8800226000000001;
  v_live_campaign_id constant bigint := 8800226000000002;
  v_direct_campaign_id constant bigint := 8800226000000003;
  v_contact_id_base constant bigint := 8800226000000010;
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
      SELECT 1
      FROM public.auto_campaign_actions AS action
      WHERE action.id IN (
        'facebook_group_invite', 'facebook_page_post', 'facebook_group_post'
      )
        AND COALESCE(action.is_delete, false) = false
      HAVING count(DISTINCT action.id) = 3
    )
  THEN
    RAISE NOTICE 'v226_smoke: active fixture tenant/actions missing; behavior fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aka-agent-v226-facebook-portable-smoke', 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.auto_accounts
    WHERE id IN (v_campaign_account_id, v_source_account_id)
  ) OR EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups WHERE id = v_group_id
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaigns
    WHERE id IN (v_live_campaign_id, v_direct_campaign_id)
  ) OR EXISTS (
    SELECT 1 FROM public.auto_account_contacts
    WHERE id BETWEEN v_contact_id_base AND v_contact_id_base + 2
  ) THEN
    RAISE EXCEPTION 'v226_smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_campaign_account_id, '__v226_campaign_account__', 'facebook', false, false,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false
    ),
    (
      v_source_account_id, '__v226_source_account__', 'facebook', false, false,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false
    );

  INSERT INTO public.auto_account_contact_groups (
    id, account_id, contact_type, name, purpose,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_group_id, NULL, NULL, '__v226_group__', 'data_group',
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_account_contacts (
    id, account_id, contact_type, name, uid, url,
    flatform_type, is_friend, is_joined,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_contact_id_base, v_source_account_id, 'person', '__v226_person__',
      NULL, 'https://www.facebook.com/profile.php?id=22600001',
      'facebook', false, false,
      v_staff_id, v_organization_id, false
    ),
    (
      v_contact_id_base + 1, v_source_account_id, 'page', '__v226_page__',
      '22600002', 'https://www.facebook.com/22600002',
      'facebook', false, false,
      v_staff_id, v_organization_id, false
    ),
    (
      v_contact_id_base + 2, v_source_account_id, 'group', '__v226_group_target__',
      '22600003', 'https://www.facebook.com/groups/22600003',
      'facebook', false, false,
      v_staff_id, v_organization_id, false
    );

  INSERT INTO public.auto_account_contact_group_members (
    group_id, contact_id, is_delete, change_revision
  )
  SELECT v_group_id, contact.id, false, 0
  FROM public.auto_account_contacts AS contact
  WHERE contact.id BETWEEN v_contact_id_base AND v_contact_id_base + 2
  ORDER BY contact.id;

  SELECT * INTO v_preview
  FROM public.aka_agent_preview_data_group_campaign_targets(
    v_staff_id,
    v_organization_id,
    v_group_id,
    'facebook_group_invite',
    ARRAY[v_campaign_account_id]::bigint[],
    v_auth_username,
    v_auth_password
  );
  IF v_preview.valid_target_count IS DISTINCT FROM 1::bigint
    OR v_preview.compatible_membership_count IS DISTINCT FROM 1::bigint
  THEN
    RAISE EXCEPTION 'v226_smoke: cross-account non-friend preview failed: %',
      row_to_json(v_preview);
  END IF;

  SELECT * INTO v_preview
  FROM public.aka_agent_preview_data_group_campaign_targets(
    v_staff_id,
    v_organization_id,
    v_group_id,
    'facebook_page_post',
    ARRAY[v_campaign_account_id]::bigint[],
    v_auth_username,
    v_auth_password
  );
  IF v_preview.valid_target_count IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION 'v226_smoke: cross-account Page preview failed: %',
      row_to_json(v_preview);
  END IF;

  SELECT * INTO v_preview
  FROM public.aka_agent_preview_data_group_campaign_targets(
    v_staff_id,
    v_organization_id,
    v_group_id,
    'facebook_group_post',
    ARRAY[v_campaign_account_id]::bigint[],
    v_auth_username,
    v_auth_password
  );
  IF v_preview.valid_target_count IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION 'v226_smoke: non-joined Facebook group preview failed: %',
      row_to_json(v_preview);
  END IF;

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, data_target_source_mode,
    provisioning_state, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_live_campaign_id, '__v226_live__', 'facebook_group_invite',
      v_campaign_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    ),
    (
      v_direct_campaign_id, '__v226_direct__', 'facebook_page_post',
      v_campaign_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    );

  PERFORM public.aka_agent_bind_campaign_data_group_source(
    v_staff_id,
    v_organization_id,
    '__v226_bind__' || v_staff_id::text,
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
    OR v_input_uid IS DISTINCT FROM 'https://www.facebook.com/profile.php?id=22600001'
  THEN
    RAISE EXCEPTION 'v226_smoke: live router rejected portable person target: %, %',
      v_input_count, v_input_uid;
  END IF;

  PERFORM public.aka_agent_snapshot_data_group_to_direct_campaign(
    v_staff_id,
    v_organization_id,
    '__v226_snapshot__' || v_staff_id::text,
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
    OR v_input_uid IS DISTINCT FROM '22600002'
  THEN
    RAISE EXCEPTION 'v226_smoke: direct snapshot rejected portable Page target: %, %',
      v_input_count, v_input_uid;
  END IF;
END;
$behavior$;

ROLLBACK;
