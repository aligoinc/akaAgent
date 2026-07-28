-- Rollback smoke test for
-- migration_v210_preserve_zalo_server_data_group_waiting_note.sql.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $v210_preserve_zalo_server_data_group_waiting_note$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_package_id bigint;
  v_account_id bigint;
  v_group_id bigint;
  v_data_group_campaign_id bigint;
  v_direct_campaign_id bigint;
  v_action_id text;
  v_control record;
  v_note text;
  v_status text;
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_set_zalo_server_campaign_status(bigint,bigint,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v210_smoke: Zalo Server campaign control RPC is missing';
  END IF;

  SELECT staff.id, staff.organization_id
  INTO v_staff_id, v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
  ORDER BY staff.id
  LIMIT 1
  FOR UPDATE OF staff;

  SELECT package.id
  INTO v_package_id
  FROM public.org_product_package AS package
  ORDER BY package.id
  LIMIT 1;

  SELECT action.id
  INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE action.id LIKE 'zalo\_%' ESCAPE '\'
    AND COALESCE(action.is_delete, false) = false
  ORDER BY action.id
  LIMIT 1;

  IF v_staff_id IS NULL OR v_package_id IS NULL OR v_action_id IS NULL THEN
    RAISE NOTICE 'v210_smoke: active staff, package or Zalo action missing; behavioral fixture skipped';
    RETURN;
  END IF;

  UPDATE public.org_organization_product
  SET is_deleted = true
  WHERE organization_id = v_organization_id
    AND product_id IN (16, 18);

  INSERT INTO public.org_organization_product (
    organization_id, product_package_id, product_id, product_name,
    package_name, package_type, max_accounts, max_sends_per_day,
    expiration_date, created_at, is_deleted, is_zalo_server, is_zalo_show_web
  ) VALUES (
    v_organization_id, v_package_id, 16, '__v210_zalo_server__',
    '__v210__', 'month', 10, 1000,
    now() + interval '10 years', now() + interval '100 years',
    false, true, false
  );

  INSERT INTO public.auto_accounts (
    name, flatform_type, is_zalo_show_web, login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) VALUES (
    '__v210_qr__', 'zalo', false, 'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  ) RETURNING id INTO v_account_id;

  INSERT INTO public.auto_account_contact_groups (
    account_id, contact_type, name, purpose, is_delete,
    staff_id, organization_id
  ) VALUES (
    NULL, NULL, '__v210_data_group__', 'data_group', false,
    v_staff_id, v_organization_id
  ) RETURNING id INTO v_group_id;

  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, content, note,
    data_target_source_mode, data_group_id,
    staff_id, organization_id, is_delete
  ) VALUES (
    '__v210_data_group_campaign__', v_action_id, v_account_id,
    'chờ xử lý', '', 'Chờ data phù hợp',
    'data_group', v_group_id,
    v_staff_id, v_organization_id, false
  ) RETURNING id INTO v_data_group_campaign_id;

  INSERT INTO public.auto_campaign_data_group_sources (
    campaign_id, group_id, baseline_revision, status,
    staff_id, organization_id
  ) VALUES (
    v_data_group_campaign_id, v_group_id, 0, 'active',
    v_staff_id, v_organization_id
  );

  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_data_group_campaign_id, v_staff_id, 'tạm dừng'
  );
  SELECT note INTO v_note
  FROM public.auto_campaigns
  WHERE id = v_data_group_campaign_id;
  IF NOT COALESCE(v_control.ok, false) OR v_note IS DISTINCT FROM 'Chờ data phù hợp' THEN
    RAISE EXCEPTION 'v210_smoke: pause cleared Chờ data phù hợp';
  END IF;

  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_data_group_campaign_id, v_staff_id, 'chờ xử lý'
  );
  SELECT note INTO v_note
  FROM public.auto_campaigns
  WHERE id = v_data_group_campaign_id;
  IF NOT COALESCE(v_control.ok, false) OR v_note IS DISTINCT FROM 'Chờ data phù hợp' THEN
    RAISE EXCEPTION 'v210_smoke: resume cleared Chờ data phù hợp';
  END IF;

  UPDATE public.auto_campaigns
  SET note = 'Chờ data mới'
  WHERE id = v_data_group_campaign_id;
  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_data_group_campaign_id, v_staff_id, 'tạm dừng'
  );
  IF NOT COALESCE(v_control.ok, false)
    OR v_control.campaign_status IS DISTINCT FROM 'tạm dừng'
  THEN
    RAISE EXCEPTION 'v210_smoke: could not pause Chờ data mới fixture';
  END IF;
  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_data_group_campaign_id, v_staff_id, 'chờ xử lý'
  );
  SELECT note, status INTO v_note, v_status
  FROM public.auto_campaigns
  WHERE id = v_data_group_campaign_id;
  IF NOT COALESCE(v_control.ok, false)
    OR v_status IS DISTINCT FROM 'chờ xử lý'
    OR v_note IS DISTINCT FROM 'Chờ data mới'
  THEN
    RAISE EXCEPTION 'v210_smoke: pause/resume cleared Chờ data mới';
  END IF;

  UPDATE public.auto_campaigns
  SET note = 'Lỗi cũ'
  WHERE id = v_data_group_campaign_id;
  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_data_group_campaign_id, v_staff_id, 'tạm dừng'
  );
  SELECT note, status INTO v_note, v_status
  FROM public.auto_campaigns
  WHERE id = v_data_group_campaign_id;
  IF NOT COALESCE(v_control.ok, false)
    OR v_status IS DISTINCT FROM 'tạm dừng'
    OR v_note IS NOT NULL
  THEN
    RAISE EXCEPTION 'v210_smoke: stale Data Group error note was not cleared';
  END IF;

  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_data_group_campaign_id, v_staff_id, 'chờ xử lý'
  );
  IF NOT COALESCE(v_control.ok, false)
    OR v_control.campaign_status IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION 'v210_smoke: could not resume NULL-note fixture';
  END IF;
  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_data_group_campaign_id, v_staff_id, 'tạm dừng'
  );
  SELECT note, status INTO v_note, v_status
  FROM public.auto_campaigns
  WHERE id = v_data_group_campaign_id;
  IF NOT COALESCE(v_control.ok, false)
    OR v_status IS DISTINCT FROM 'tạm dừng'
    OR v_note IS NOT NULL
  THEN
    RAISE EXCEPTION 'v210_smoke: NULL note was derived during pause/resume';
  END IF;

  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, content, note,
    data_target_source_mode,
    staff_id, organization_id, is_delete
  ) VALUES (
    '__v210_direct_campaign__', v_action_id, v_account_id,
    'chờ xử lý', '', 'Chờ data phù hợp',
    'direct',
    v_staff_id, v_organization_id, false
  ) RETURNING id INTO v_direct_campaign_id;

  SELECT * INTO v_control
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_direct_campaign_id, v_staff_id, 'tạm dừng'
  );
  SELECT note, status INTO v_note, v_status
  FROM public.auto_campaigns
  WHERE id = v_direct_campaign_id;
  IF NOT COALESCE(v_control.ok, false)
    OR v_status IS DISTINCT FROM 'tạm dừng'
    OR v_note IS NOT NULL
  THEN
    RAISE EXCEPTION 'v210_smoke: direct campaign incorrectly preserved a waiting note';
  END IF;
END;
$v210_preserve_zalo_server_data_group_waiting_note$;

ROLLBACK;
