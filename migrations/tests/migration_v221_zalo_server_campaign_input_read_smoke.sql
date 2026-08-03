-- Rollback smoke test for migration_v221_zalo_server_campaign_input_read.sql.
-- Verifies that credentialed tenant reads route by account subtype while the
-- service-only core reader remains target-guarded.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
DECLARE
  v_signature text;
  v_definition text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,integer,integer,text,text)',
    'public.aka_agent_list_campaign_input_data_page(bigint,bigint,bigint,text,text,timestamptz,timestamptz,text,integer,integer,text,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'v221_smoke: wrapper missing: %', v_signature;
    END IF;

    SELECT pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(v_signature))
    INTO v_definition;

    IF position('auto_assert_automation_identity' IN v_definition) = 0
      OR position('account.is_zalo_server' IN v_definition) = 0
      OR position('account.is_zalo_show_web' IN v_definition) = 0
      OR position(
        'aka_agent.zalo_runtime_target'', v_runtime_target'
        IN v_definition
      ) = 0
    THEN
      RAISE EXCEPTION 'v221_smoke: subtype-aware authenticated routing missing from %', v_signature;
    END IF;

    IF NOT pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
      OR NOT pg_catalog.has_function_privilege(
        'authenticated', v_signature, 'EXECUTE'
      )
      OR NOT pg_catalog.has_function_privilege('service_role', v_signature, 'EXECUTE')
    THEN
      RAISE EXCEPTION 'v221_smoke: wrapper grants are wrong for %', v_signature;
    END IF;
  END LOOP;
END;
$metadata$;

DO $behavior$
DECLARE
  v_staff_id bigint;
  v_organization_id bigint;
  v_auth_username text;
  v_auth_password text;
  v_action_id text;
  v_local_account_id constant bigint := 8800221000000001;
  v_server_account_id constant bigint := 8800221000000002;
  v_local_campaign_id constant bigint := 8800221000000003;
  v_server_campaign_id constant bigint := 8800221000000004;
  v_local_input_id constant bigint := 8800221000000005;
  v_server_input_id constant bigint := 8800221000000006;
  v_row_count bigint;
  v_total_count bigint;
  v_rejected boolean := false;
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

  SELECT action.id INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE action.id = 'zalo_message_phone'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  LIMIT 1;

  IF v_staff_id IS NULL OR v_organization_id IS NULL
    OR v_auth_username IS NULL OR v_auth_password IS NULL
    OR v_action_id IS NULL
  THEN
    RAISE NOTICE 'v221_smoke: active fixture tenant/action missing; behavior fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aka-agent-v221-input-read-smoke', 0)
  );

  IF EXISTS (
    SELECT 1 FROM public.auto_accounts
    WHERE id IN (v_local_account_id, v_server_account_id)
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaigns
    WHERE id IN (v_local_campaign_id, v_server_campaign_id)
  ) THEN
    RAISE EXCEPTION 'v221_smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (v_local_account_id, '__v221_local_account__', 'zalo', false, false,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false),
    (v_server_account_id, '__v221_server_account__', 'zalo', false, true,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false);

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, data_target_source_mode,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (v_local_campaign_id, '__v221_local_campaign__', v_action_id,
      v_local_account_id, 'hoàn thành', '', now(), now(), 'direct',
      v_staff_id, v_organization_id, false),
    (v_server_campaign_id, '__v221_server_campaign__', v_action_id,
      v_server_account_id, 'hoàn thành', '', now(), now(), 'direct',
      v_staff_id, v_organization_id, false);

  INSERT INTO public.auto_campaign_input_data (
    id, campaign_id, uid, status, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (v_local_input_id, v_local_campaign_id, '__v221_local_input__',
      'hoàn thành', false),
    (v_server_input_id, v_server_campaign_id, '__v221_server_input__',
      'hoàn thành', false);

  PERFORM pg_catalog.set_config(
    'aka_agent.zalo_runtime_target', 'server', true
  );
  SELECT count(*), max(page.total_count)
  INTO v_row_count, v_total_count
  FROM public.aka_agent_list_campaign_input_data_page(
    v_staff_id, v_organization_id, v_local_campaign_id,
    NULL, NULL, NULL, NULL, 0, 100, v_auth_username, v_auth_password
  ) AS page;
  IF v_row_count <> 1 OR v_total_count <> 1 THEN
    RAISE EXCEPTION 'v221_smoke: authenticated local read returned % rows / % total',
      v_row_count, v_total_count;
  END IF;
  IF current_setting('aka_agent.zalo_runtime_target', true) <> 'server' THEN
    RAISE EXCEPTION 'v221_smoke: local wrapper did not restore runtime target';
  END IF;

  PERFORM pg_catalog.set_config(
    'aka_agent.zalo_runtime_target', 'desktop', true
  );
  SELECT count(*), max(page.total_count)
  INTO v_row_count, v_total_count
  FROM public.aka_agent_list_campaign_input_data_page(
    v_staff_id, v_organization_id, v_server_campaign_id,
    NULL, NULL, NULL, NULL, 'all', 0, 100,
    v_auth_username, v_auth_password
  ) AS page;
  IF v_row_count <> 1 OR v_total_count <> 1 THEN
    RAISE EXCEPTION 'v221_smoke: authenticated Server read returned % rows / % total',
      v_row_count, v_total_count;
  END IF;
  IF current_setting('aka_agent.zalo_runtime_target', true) <> 'desktop' THEN
    RAISE EXCEPTION 'v221_smoke: Server wrapper did not restore runtime target';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM 1
    FROM public.aka_agent_list_campaign_input_data_page(
      v_staff_id, v_organization_id, v_server_campaign_id,
      NULL, NULL, NULL, NULL, 'all', 0, 100
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'campaign_not_found';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v221_smoke: desktop-targeted service core exposed Server campaign';
  END IF;
END;
$behavior$;

ROLLBACK;
