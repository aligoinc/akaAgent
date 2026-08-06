-- Rollback smoke for migration_v229_data_group_compatibility_before_member_routing.sql.
-- A Facebook-typed group must not become a Zalo phone campaign source merely
-- because one of its members has a valid phone. A compatible phone group must
-- still accept that same Facebook-origin member by phone.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $behavior$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_auth_username text;
  v_auth_password text;
  v_zalo_account_id constant bigint := 2024229001;
  v_facebook_account_id constant bigint := 2024229002;
  v_facebook_group_id constant bigint := 8800229000000001;
  v_phone_group_id constant bigint := 8800229000000002;
  v_untyped_group_id constant bigint := 8800229000000003;
  v_zalo_person_group_id constant bigint := 8800229000000004;
  v_blocked_campaign_id constant bigint := 8800229000000010;
  v_live_campaign_id constant bigint := 8800229000000011;
  v_direct_campaign_id constant bigint := 8800229000000012;
  v_contact_id constant bigint := 8800229000000020;
  v_facebook_person_type_id bigint;
  v_phone_type_id bigint;
  v_zalo_person_type_id bigint;
  v_picker_facebook_count bigint;
  v_picker_phone_count bigint;
  v_picker_untyped_count bigint;
  v_picker_zalo_person_count bigint;
  v_rejected boolean;
  v_input_count bigint;
  v_input_phone text;
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

  v_facebook_person_type_id :=
    public.aka_agent_data_type_category_item_id('facebook_person');
  v_phone_type_id := public.aka_agent_data_type_category_item_id('phone');
  v_zalo_person_type_id :=
    public.aka_agent_data_type_category_item_id('zalo_person');

  IF v_staff_id IS NULL OR v_organization_id IS NULL
    OR v_auth_username IS NULL OR v_auth_password IS NULL
    OR v_facebook_person_type_id IS NULL
    OR v_phone_type_id IS NULL
    OR v_zalo_person_type_id IS NULL
    OR (
      SELECT count(*)
      FROM public.auto_campaign_actions AS action
      WHERE action.id IN ('zalo_message_phone', 'zalo_add_group_member')
        AND action.is_active = true
        AND COALESCE(action.is_delete, false) = false
    ) <> 2
  THEN
    RAISE NOTICE 'v229_smoke: active fixture tenant/actions/types missing; behavior fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aka-agent-v229-group-before-member-smoke', 0)
  );

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_zalo_account_id, '__v229_zalo_account__', 'zalo', false, false,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false
    ),
    (
      v_facebook_account_id, '__v229_facebook_source__', 'facebook', false, false,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false
    );

  INSERT INTO public.auto_account_contact_groups (
    id, name, purpose, data_type_category_item_id,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_facebook_group_id, '__v229_facebook_person_group__', 'data_group',
      v_facebook_person_type_id, v_staff_id, v_organization_id, false
    ),
    (
      v_phone_group_id, '__v229_phone_group__', 'data_group',
      v_phone_type_id, v_staff_id, v_organization_id, false
    ),
    (
      v_untyped_group_id, '__v229_untyped_group__', 'data_group',
      NULL, v_staff_id, v_organization_id, false
    ),
    (
      v_zalo_person_group_id, '__v229_zalo_person_group__', 'data_group',
      v_zalo_person_type_id, v_staff_id, v_organization_id, false
    );

  INSERT INTO public.auto_account_contacts (
    id, account_id, contact_type, name, phone, flatform_type,
    is_friend, is_joined, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_contact_id, v_facebook_account_id, 'person', '__v229_facebook_phone__',
    '+84 901 229 001', 'facebook', false, false,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_account_contact_group_members (
    group_id, contact_id, is_delete, change_revision
  ) VALUES
    (v_facebook_group_id, v_contact_id, false, 0),
    (v_phone_group_id, v_contact_id, false, 0);

  IF public.aka_agent_data_group_type_compatible(
    v_facebook_group_id, 'zalo_message_phone'
  ) OR public.aka_agent_data_group_type_compatible(
    v_facebook_group_id, 'zalo_add_group_member'
  ) OR NOT public.aka_agent_data_group_type_compatible(
    v_phone_group_id, 'zalo_message_phone'
  ) OR NOT public.aka_agent_data_group_type_compatible(
    v_phone_group_id, 'zalo_add_group_member'
  ) OR NOT public.aka_agent_data_group_type_compatible(
    v_untyped_group_id, 'zalo_message_phone'
  ) OR public.aka_agent_data_group_type_compatible(
    v_zalo_person_group_id, 'zalo_message_phone'
  ) OR NOT public.aka_agent_data_group_type_compatible(
    v_zalo_person_group_id, 'zalo_add_group_member'
  ) THEN
    RAISE EXCEPTION 'v229_smoke: group-level action compatibility is wrong';
  END IF;

  SELECT
    count(*) FILTER (WHERE listed.id = v_facebook_group_id),
    count(*) FILTER (WHERE listed.id = v_phone_group_id),
    count(*) FILTER (WHERE listed.id = v_untyped_group_id),
    count(*) FILTER (WHERE listed.id = v_zalo_person_group_id)
  INTO
    v_picker_facebook_count,
    v_picker_phone_count,
    v_picker_untyped_count,
    v_picker_zalo_person_count
  FROM public.aka_agent_list_data_groups(
    v_staff_id,
    v_organization_id,
    NULL::text,
    'zalo_message_phone',
    NULL::bigint,
    NULL::bigint[],
    0,
    500,
    false
  ) AS listed;
  IF v_picker_facebook_count <> 0
    OR v_picker_phone_count <> 1
    OR v_picker_untyped_count <> 1
    OR v_picker_zalo_person_count <> 0
  THEN
    RAISE EXCEPTION 'v229_smoke: picker compatibility is wrong: %, %, %, %',
      v_picker_facebook_count,
      v_picker_phone_count,
      v_picker_untyped_count,
      v_picker_zalo_person_count;
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM 1
    FROM public.aka_agent_preview_data_group_campaign_targets(
      v_staff_id,
      v_organization_id,
      v_facebook_group_id,
      'zalo_message_phone',
      ARRAY[v_zalo_account_id]::bigint[],
      v_auth_username,
      v_auth_password
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%data_group_campaign_semantic_type_incompatible%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v229_smoke: preview accepted a Facebook group for Zalo phone';
  END IF;

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, data_target_source_mode,
    provisioning_state, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_blocked_campaign_id, '__v229_blocked__', 'zalo_message_phone',
      v_zalo_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    ),
    (
      v_live_campaign_id, '__v229_live__', 'zalo_message_phone',
      v_zalo_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    ),
    (
      v_direct_campaign_id, '__v229_direct__', 'zalo_message_phone',
      v_zalo_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    );

  v_rejected := false;
  BEGIN
    PERFORM public.aka_agent_bind_campaign_data_group_source(
      v_staff_id,
      v_organization_id,
      '__v229_blocked_bind__' || v_staff_id::text,
      v_blocked_campaign_id,
      v_facebook_group_id,
      NULL::bigint,
      v_auth_username,
      v_auth_password
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%data_group_campaign_semantic_type_incompatible%' THEN
      v_rejected := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_rejected OR EXISTS (
    SELECT 1
    FROM public.auto_campaign_data_group_sources AS source
    WHERE source.campaign_id = v_blocked_campaign_id
  ) THEN
    RAISE EXCEPTION 'v229_smoke: bind accepted a Facebook group for Zalo phone';
  END IF;

  PERFORM public.aka_agent_bind_campaign_data_group_source(
    v_staff_id,
    v_organization_id,
    '__v229_valid_bind__' || v_staff_id::text,
    v_live_campaign_id,
    v_phone_group_id,
    NULL::bigint,
    v_auth_username,
    v_auth_password
  );

  SELECT count(*)::bigint, min(input_data.phone)
  INTO v_input_count, v_input_phone
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = v_live_campaign_id
    AND COALESCE(input_data.is_delete, false) = false;
  IF v_input_count IS DISTINCT FROM 1::bigint
    OR v_input_phone IS DISTINCT FROM '0901229001'
  THEN
    RAISE EXCEPTION 'v229_smoke: valid phone group live bind is wrong: %, %',
      v_input_count, v_input_phone;
  END IF;

  PERFORM public.aka_agent_snapshot_data_group_to_direct_campaign(
    v_staff_id,
    v_organization_id,
    '__v229_valid_snapshot__' || v_staff_id::text,
    v_direct_campaign_id,
    v_phone_group_id,
    now(),
    'tạm dừng',
    v_auth_username,
    v_auth_password
  );

  SELECT count(*)::bigint, min(input_data.phone)
  INTO v_input_count, v_input_phone
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = v_direct_campaign_id
    AND COALESCE(input_data.is_delete, false) = false;
  IF v_input_count IS DISTINCT FROM 1::bigint
    OR v_input_phone IS DISTINCT FROM '0901229001'
  THEN
    RAISE EXCEPTION 'v229_smoke: valid phone group direct snapshot is wrong: %, %',
      v_input_count, v_input_phone;
  END IF;
END;
$behavior$;

ROLLBACK;
