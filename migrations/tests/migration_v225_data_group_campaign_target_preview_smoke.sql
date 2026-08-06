-- Rollback smoke for migration_v225_data_group_campaign_target_preview.sql.
-- The preview must match the number of canonical input rows produced by bind.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
DECLARE
  v_core regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_preview_data_group_campaign_targets(bigint,bigint,bigint,text,bigint[])'
  );
  v_wrapper regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_preview_data_group_campaign_targets(bigint,bigint,bigint,text,bigint[],text,text)'
  );
  v_helper regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_preview_data_group_target_key(bigint,bigint,bigint,bigint,text,bigint)'
  );
BEGIN
  IF v_core IS NULL OR v_wrapper IS NULL OR v_helper IS NULL THEN
    RAISE EXCEPTION 'v225_smoke: preview functions are missing';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_core, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_core, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_helper, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_helper, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', v_helper, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('anon', v_wrapper, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('authenticated', v_wrapper, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', v_wrapper, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'v225_smoke: preview privileges are wrong';
  END IF;
END;
$metadata$;

DO $behavior$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_auth_username text;
  v_auth_password text;
  v_account_id constant bigint := 2024225001;
  v_group_id constant bigint := 8800225000000001;
  v_campaign_id constant bigint := 8800225000000002;
  v_contact_id_base constant bigint := 8800225000000010;
  v_preview record;
  v_input_count bigint;
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
      WHERE action.id = 'zalo_message_phone'
        AND COALESCE(action.is_delete, false) = false
    )
  THEN
    RAISE NOTICE 'v225_smoke: active fixture tenant/action missing; behavior fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aka-agent-v225-target-preview-smoke', 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.auto_accounts WHERE id = v_account_id
  ) OR EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups WHERE id = v_group_id
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaigns WHERE id = v_campaign_id
  ) OR EXISTS (
    SELECT 1 FROM public.auto_account_contacts
    WHERE id BETWEEN v_contact_id_base AND v_contact_id_base + 4
  ) THEN
    RAISE EXCEPTION 'v225_smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_account_id, '__v225_account__', 'zalo', false, false,
    'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_account_contact_groups (
    id, account_id, contact_type, name, purpose,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_group_id, NULL, NULL, '__v225_group__', 'data_group',
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_account_contacts (
    id, account_id, contact_type, name, phone, flatform_type,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (v_contact_id_base, NULL, 'phone', '__v225_phone_a__',
      '0901234567', NULL, v_staff_id, v_organization_id, false),
    (v_contact_id_base + 1, NULL, 'phone', '__v225_phone_a_duplicate__',
      '+84901234567', NULL, v_staff_id, v_organization_id, false),
    (v_contact_id_base + 2, NULL, 'phone', '__v225_phone_b__',
      '0912345678', NULL, v_staff_id, v_organization_id, false),
    (v_contact_id_base + 3, NULL, 'phone', '__v225_phone_invalid__',
      'invalid', NULL, v_staff_id, v_organization_id, false),
    (v_contact_id_base + 4, NULL, 'phone', '__v225_contact_deleted__',
      '0987654321', NULL, v_staff_id, v_organization_id, true);

  INSERT INTO public.auto_account_contact_group_members (
    group_id, contact_id, is_delete, change_revision
  )
  SELECT v_group_id, contact.id, false, 0
  FROM public.auto_account_contacts AS contact
  WHERE contact.id BETWEEN v_contact_id_base AND v_contact_id_base + 4
  ORDER BY contact.id;

  SELECT * INTO v_preview
  FROM public.aka_agent_preview_data_group_campaign_targets(
    v_staff_id,
    v_organization_id,
    v_group_id,
    'zalo_message_phone',
    ARRAY[v_account_id]::bigint[],
    v_auth_username,
    v_auth_password
  );
  IF v_preview.account_id IS DISTINCT FROM v_account_id
    OR v_preview.active_membership_count IS DISTINCT FROM 5::bigint
    OR v_preview.compatible_membership_count IS DISTINCT FROM 3::bigint
    OR v_preview.valid_target_count IS DISTINCT FROM 2::bigint
    OR v_preview.incompatible_membership_count IS DISTINCT FROM 2::bigint
    OR v_preview.duplicate_target_count IS DISTINCT FROM 1::bigint
  THEN
    RAISE EXCEPTION 'v225_smoke: preview counts are wrong: %',
      row_to_json(v_preview);
  END IF;

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, data_target_source_mode,
    provisioning_state, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_campaign_id, '__v225_campaign__', 'zalo_message_phone',
    v_account_id, 'tạm dừng', '', now(), now(), 'direct',
    'ready', v_staff_id, v_organization_id, false
  );

  PERFORM public.aka_agent_bind_campaign_data_group_source(
    v_staff_id,
    v_organization_id,
    '__v225_bind__' || v_staff_id::text,
    v_campaign_id,
    v_group_id,
    NULL::bigint,
    v_auth_username,
    v_auth_password
  );

  SELECT count(*)::bigint
  INTO v_input_count
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = v_campaign_id
    AND COALESCE(input_data.is_delete, false) = false;
  IF v_input_count IS DISTINCT FROM v_preview.valid_target_count THEN
    RAISE EXCEPTION 'v225_smoke: preview % differs from materialized inputs %',
      v_preview.valid_target_count, v_input_count;
  END IF;
END;
$behavior$;

ROLLBACK;
