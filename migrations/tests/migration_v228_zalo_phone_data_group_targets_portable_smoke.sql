-- Rollback smoke for migration_v228_zalo_phone_data_group_targets_portable.sql.
-- Both Zalo phone routes must accept a valid phone from Facebook-typed source
-- data while rejecting invalid phone data and preserving UID-only Zalo guards.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
DECLARE
  v_helper regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_data_group_membership_has_valid_phone(bigint,bigint)'
  );
  v_live text := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.aka_agent_internal_route_data_group_member(bigint,bigint,bigint,bigint)'
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
  v_origin text := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(
      'public.aka_agent_propagate_campaign_origin_semantic_type()'
    )
  );
BEGIN
  IF v_helper IS NULL
    OR pg_catalog.strpos(v_live, 'v228: valid-phone routes ignore semantic') = 0
    OR pg_catalog.strpos(v_snapshot, 'v228: valid-phone routes ignore all source') = 0
    OR pg_catalog.strpos(v_preview, 'v228: preview applies the same valid-phone-only') = 0
    OR pg_catalog.strpos(v_origin, 'v228: the materialized phone determines semantic') = 0
  THEN
    RAISE EXCEPTION 'v228_smoke: one or more v228 phone route patches are missing';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_helper, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_helper, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_helper, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'v228_smoke: internal phone helper is externally executable';
  END IF;

  IF pg_catalog.strpos(
    v_live,
    $$v_action_id IN ('zalo_message_phone', 'zalo_add_group_member')$$
  ) = 0 OR pg_catalog.strpos(
    v_snapshot,
    $$v_action IN ('zalo_message_phone', 'zalo_add_group_member')$$
  ) = 0 OR pg_catalog.strpos(
    v_preview,
    $$v_action IN ('zalo_message_phone', 'zalo_add_group_member')$$
  ) = 0 THEN
    RAISE EXCEPTION 'v228_smoke: phone bypass does not cover both actions';
  END IF;

  IF pg_catalog.strpos(
    v_snapshot,
    $$ELSIF v_platform = 'zalo' AND v_contact_type = 'person'$$
  ) = 0 OR pg_catalog.strpos(
    v_preview,
    $$ELSIF v_platform = 'zalo'$$
  ) = 0 THEN
    RAISE EXCEPTION 'v228_smoke: UID-only add-member Zalo guards were removed';
  END IF;
END;
$metadata$;

DO $behavior$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_auth_username text;
  v_auth_password text;
  v_zalo_account_id constant bigint := 2024228001;
  v_facebook_account_id constant bigint := 2024228002;
  v_group_id constant bigint := 8800228000000001;
  v_live_phone_campaign_id constant bigint := 8800228000000002;
  v_direct_phone_campaign_id constant bigint := 8800228000000003;
  v_add_member_campaign_id constant bigint := 8800228000000004;
  v_valid_contact_id constant bigint := 8800228000000010;
  v_invalid_contact_id constant bigint := 8800228000000011;
  v_facebook_person_type_id bigint;
  v_valid_membership_id bigint;
  v_invalid_membership_id bigint;
  v_preview record;
  v_input_count bigint;
  v_input_phone text;
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

  v_facebook_person_type_id :=
    public.aka_agent_data_type_category_item_id('facebook_person');

  IF v_staff_id IS NULL OR v_organization_id IS NULL
    OR v_auth_username IS NULL OR v_auth_password IS NULL
    OR v_facebook_person_type_id IS NULL
    OR (
      SELECT count(*)
      FROM public.auto_campaign_actions AS action
      WHERE action.id IN ('zalo_message_phone', 'zalo_add_group_member')
        AND action.is_active = true
        AND COALESCE(action.is_delete, false) = false
    ) <> 2
  THEN
    RAISE NOTICE 'v228_smoke: active fixture tenant/actions/types missing; behavior fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aka-agent-v228-zalo-phone-portable-smoke', 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.auto_accounts
    WHERE id IN (v_zalo_account_id, v_facebook_account_id)
  ) OR EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups WHERE id = v_group_id
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaigns
    WHERE id IN (
      v_live_phone_campaign_id,
      v_direct_phone_campaign_id,
      v_add_member_campaign_id
    )
  ) OR EXISTS (
    SELECT 1 FROM public.auto_account_contacts
    WHERE id IN (v_valid_contact_id, v_invalid_contact_id)
  ) THEN
    RAISE EXCEPTION 'v228_smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_zalo_account_id, '__v228_zalo_account__', 'zalo', false, false,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false
    ),
    (
      v_facebook_account_id, '__v228_facebook_source__', 'facebook', false, false,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false
    );

  INSERT INTO public.auto_account_contact_groups (
    id, account_id, contact_type, name, purpose,
    data_type_category_item_id,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_group_id, v_facebook_account_id, 'person',
    '__v228_facebook_typed_group__', 'data_group',
    v_facebook_person_type_id,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_account_contacts (
    id, account_id, contact_type, name, uid, phone, flatform_type,
    is_friend, is_joined, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_valid_contact_id, v_facebook_account_id, 'person',
      '__v228_valid_facebook_phone__', 'fb-valid-phone', '+84 901 228 001',
      'facebook', false, false,
      v_staff_id, v_organization_id, false
    ),
    (
      v_invalid_contact_id, v_facebook_account_id, 'person',
      '__v228_invalid_phone_uid__', 'fb-uid-only', '123',
      'facebook', false, false,
      v_staff_id, v_organization_id, false
    );

  INSERT INTO public.auto_account_contact_group_members (
    group_id, contact_id, is_delete, change_revision
  ) VALUES (v_group_id, v_valid_contact_id, false, 0)
  RETURNING id INTO v_valid_membership_id;

  INSERT INTO public.auto_account_contact_group_members (
    group_id, contact_id, is_delete, change_revision
  ) VALUES (v_group_id, v_invalid_contact_id, false, 0)
  RETURNING id INTO v_invalid_membership_id;

  IF NOT public.aka_agent_data_group_type_compatible(
    v_group_id, 'zalo_message_phone'
  ) OR NOT public.aka_agent_data_group_type_compatible(
    v_group_id, 'zalo_add_group_member'
  ) OR public.aka_agent_data_group_type_compatible(
    v_group_id, 'zalo_message_friend'
  ) THEN
    RAISE EXCEPTION 'v228_smoke: group-level phone compatibility is wrong';
  END IF;

  IF NOT public.aka_agent_data_group_membership_has_valid_phone(
    v_valid_membership_id, v_group_id
  ) OR public.aka_agent_data_group_membership_has_valid_phone(
    v_invalid_membership_id, v_group_id
  ) THEN
    RAISE EXCEPTION 'v228_smoke: normalized phone validation is wrong';
  END IF;

  SELECT * INTO v_preview
  FROM public.aka_agent_preview_data_group_campaign_targets(
    v_staff_id,
    v_organization_id,
    v_group_id,
    'zalo_message_phone',
    ARRAY[v_zalo_account_id]::bigint[],
    v_auth_username,
    v_auth_password
  );
  IF v_preview.active_membership_count IS DISTINCT FROM 2::bigint
    OR v_preview.compatible_membership_count IS DISTINCT FROM 1::bigint
    OR v_preview.valid_target_count IS DISTINCT FROM 1::bigint
    OR v_preview.incompatible_membership_count IS DISTINCT FROM 1::bigint
  THEN
    RAISE EXCEPTION 'v228_smoke: message-phone preview is wrong: %',
      row_to_json(v_preview);
  END IF;

  SELECT * INTO v_preview
  FROM public.aka_agent_preview_data_group_campaign_targets(
    v_staff_id,
    v_organization_id,
    v_group_id,
    'zalo_add_group_member',
    ARRAY[v_zalo_account_id]::bigint[],
    v_auth_username,
    v_auth_password
  );
  IF v_preview.compatible_membership_count IS DISTINCT FROM 1::bigint
    OR v_preview.valid_target_count IS DISTINCT FROM 1::bigint
    OR v_preview.incompatible_membership_count IS DISTINCT FROM 1::bigint
  THEN
    RAISE EXCEPTION 'v228_smoke: add-member preview or UID fallback guard is wrong: %',
      row_to_json(v_preview);
  END IF;

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, data_target_source_mode,
    provisioning_state, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (
      v_live_phone_campaign_id, '__v228_live_phone__', 'zalo_message_phone',
      v_zalo_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    ),
    (
      v_direct_phone_campaign_id, '__v228_direct_phone__', 'zalo_message_phone',
      v_zalo_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    ),
    (
      v_add_member_campaign_id, '__v228_add_member__', 'zalo_add_group_member',
      v_zalo_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false
    );

  PERFORM public.aka_agent_bind_campaign_data_group_source(
    v_staff_id,
    v_organization_id,
    '__v228_bind_phone__' || v_staff_id::text,
    v_live_phone_campaign_id,
    v_group_id,
    NULL::bigint,
    v_auth_username,
    v_auth_password
  );

  SELECT count(*)::bigint, min(input_data.phone), min(input_data.uid)
  INTO v_input_count, v_input_phone, v_input_uid
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = v_live_phone_campaign_id
    AND COALESCE(input_data.is_delete, false) = false;
  IF v_input_count IS DISTINCT FROM 1::bigint
    OR v_input_phone IS DISTINCT FROM '0901228001'
  THEN
    RAISE EXCEPTION 'v228_smoke: live phone bind is wrong: %, %, %',
      v_input_count, v_input_phone, v_input_uid;
  END IF;

  PERFORM public.aka_agent_snapshot_data_group_to_direct_campaign(
    v_staff_id,
    v_organization_id,
    '__v228_snapshot_phone__' || v_staff_id::text,
    v_direct_phone_campaign_id,
    v_group_id,
    now(),
    'tạm dừng',
    v_auth_username,
    v_auth_password
  );

  SELECT count(*)::bigint, min(input_data.phone)
  INTO v_input_count, v_input_phone
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = v_direct_phone_campaign_id
    AND COALESCE(input_data.is_delete, false) = false;
  IF v_input_count IS DISTINCT FROM 1::bigint
    OR v_input_phone IS DISTINCT FROM '0901228001'
  THEN
    RAISE EXCEPTION 'v228_smoke: direct phone snapshot is wrong: %, %',
      v_input_count, v_input_phone;
  END IF;

  PERFORM public.aka_agent_bind_campaign_data_group_source(
    v_staff_id,
    v_organization_id,
    '__v228_bind_add_member__' || v_staff_id::text,
    v_add_member_campaign_id,
    v_group_id,
    NULL::bigint,
    v_auth_username,
    v_auth_password
  );

  SELECT count(*)::bigint, min(input_data.phone), min(input_data.uid)
  INTO v_input_count, v_input_phone, v_input_uid
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = v_add_member_campaign_id
    AND COALESCE(input_data.is_delete, false) = false;
  IF v_input_count IS DISTINCT FROM 1::bigint
    OR v_input_phone IS DISTINCT FROM '0901228001'
    OR COALESCE(v_input_uid, '') <> ''
  THEN
    RAISE EXCEPTION 'v228_smoke: add-member phone bind is wrong: %, %, %',
      v_input_count, v_input_phone, v_input_uid;
  END IF;
END;
$behavior$;

ROLLBACK;
