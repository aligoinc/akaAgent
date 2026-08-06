-- Rollback smoke for migration_v224_zalo_server_data_group_tenant_routing.sql.
-- Authenticated tenant wrappers must route both Desktop and Server campaign
-- accounts while the service-only cores remain explicitly target-guarded.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
DECLARE
  v_signature text;
  v_definition text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint,text,text)',
    'public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint,text,text)',
    'public.aka_agent_get_campaign_data_group_source(bigint,bigint,bigint,text,text)',
    'public.aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)',
    'public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_signature) IS NULL THEN
      RAISE EXCEPTION 'v224_smoke: wrapper missing: %', v_signature;
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
      RAISE EXCEPTION 'v224_smoke: subtype-aware routing missing from %', v_signature;
    END IF;

    IF NOT pg_catalog.has_function_privilege('anon', v_signature, 'EXECUTE')
      OR NOT pg_catalog.has_function_privilege(
        'authenticated', v_signature, 'EXECUTE'
      )
      OR NOT pg_catalog.has_function_privilege(
        'service_role', v_signature, 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION 'v224_smoke: wrapper grants are wrong for %', v_signature;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) AS privilege
      WHERE routine.oid = pg_catalog.to_regprocedure(v_signature)
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'v224_smoke: PUBLIC can execute %', v_signature;
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
  v_data_group_id constant bigint := 8800224000000001;
  v_local_account_id constant bigint := 8800224000000002;
  v_server_account_id constant bigint := 8800224000000003;
  v_local_campaign_id constant bigint := 8800224000000004;
  v_server_campaign_id constant bigint := 8800224000000005;
  v_preflight record;
  v_result jsonb;
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
    RAISE NOTICE 'v224_smoke: active fixture tenant/action missing; behavior fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aka-agent-v224-data-group-routing-smoke', 0)
  );

  IF EXISTS (
    SELECT 1 FROM public.auto_account_contact_groups
    WHERE id = v_data_group_id
  ) OR EXISTS (
    SELECT 1 FROM public.auto_accounts
    WHERE id IN (v_local_account_id, v_server_account_id)
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaigns
    WHERE id IN (v_local_campaign_id, v_server_campaign_id)
  ) THEN
    RAISE EXCEPTION 'v224_smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.auto_account_contact_groups (
    id, account_id, contact_type, name, purpose,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_data_group_id, NULL, NULL, '__v224_data_group__', 'data_group',
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (v_local_account_id, '__v224_local_account__', 'zalo', false, false,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false),
    (v_server_account_id, '__v224_server_account__', 'zalo', false, true,
      'đã đăng nhập', 'chờ xử lý', true,
      v_staff_id, v_organization_id, false);

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, data_target_source_mode,
    provisioning_state, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (v_local_campaign_id, '__v224_local_campaign__', v_action_id,
      v_local_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false),
    (v_server_campaign_id, '__v224_server_campaign__', v_action_id,
      v_server_account_id, 'tạm dừng', '', now(), now(), 'direct',
      'ready', v_staff_id, v_organization_id, false);

  PERFORM pg_catalog.set_config(
    'aka_agent.zalo_runtime_target', 'server', true
  );
  SELECT * INTO v_preflight
  FROM public.aka_agent_preflight_campaign_data_group_change(
    v_staff_id, v_organization_id,
    v_local_campaign_id, v_data_group_id,
    v_auth_username, v_auth_password
  );
  IF NOT COALESCE(v_preflight.allowed, false) THEN
    RAISE EXCEPTION 'v224_smoke: authenticated local preflight rejected: %',
      row_to_json(v_preflight);
  END IF;
  IF current_setting('aka_agent.zalo_runtime_target', true) <> 'server' THEN
    RAISE EXCEPTION 'v224_smoke: local preflight did not restore runtime target';
  END IF;

  PERFORM pg_catalog.set_config(
    'aka_agent.zalo_runtime_target', 'desktop', true
  );
  SELECT * INTO v_preflight
  FROM public.aka_agent_preflight_campaign_data_group_change(
    v_staff_id, v_organization_id,
    v_server_campaign_id, v_data_group_id,
    v_auth_username, v_auth_password
  );
  IF NOT COALESCE(v_preflight.allowed, false) THEN
    RAISE EXCEPTION 'v224_smoke: authenticated Server preflight rejected: %',
      row_to_json(v_preflight);
  END IF;
  IF current_setting('aka_agent.zalo_runtime_target', true) <> 'desktop' THEN
    RAISE EXCEPTION 'v224_smoke: Server preflight did not restore runtime target';
  END IF;

  v_result := public.aka_agent_bind_campaign_data_group_source(
    v_staff_id, v_organization_id,
    '__v224_bind_local__' || v_staff_id::text,
    v_local_campaign_id, v_data_group_id, NULL::bigint,
    v_auth_username, v_auth_password
  );
  IF v_result->>'status' <> 'active' THEN
    RAISE EXCEPTION 'v224_smoke: authenticated local bind failed: %', v_result;
  END IF;

  v_result := public.aka_agent_bind_campaign_data_group_source(
    v_staff_id, v_organization_id,
    '__v224_bind_server__' || v_staff_id::text,
    v_server_campaign_id, v_data_group_id, NULL::bigint,
    v_auth_username, v_auth_password
  );
  IF v_result->>'status' <> 'active' THEN
    RAISE EXCEPTION 'v224_smoke: authenticated Server bind failed: %', v_result;
  END IF;

  IF public.aka_agent_get_campaign_data_group_source(
    v_staff_id, v_organization_id, v_local_campaign_id,
    v_auth_username, v_auth_password
  )->>'status' <> 'active' THEN
    RAISE EXCEPTION 'v224_smoke: authenticated local get missed active source';
  END IF;
  IF public.aka_agent_get_campaign_data_group_source(
    v_staff_id, v_organization_id, v_server_campaign_id,
    v_auth_username, v_auth_password
  )->>'status' <> 'active' THEN
    RAISE EXCEPTION 'v224_smoke: authenticated Server get missed active source';
  END IF;

  v_result := public.aka_agent_stop_campaign_data_group_source(
    v_staff_id, v_organization_id, v_local_campaign_id,
    '__v224_stop_local__' || v_staff_id::text, 'manual_stop',
    v_auth_username, v_auth_password
  );
  IF v_result->>'status' <> 'stopped' THEN
    RAISE EXCEPTION 'v224_smoke: authenticated local stop failed: %', v_result;
  END IF;

  v_result := public.aka_agent_stop_campaign_data_group_source(
    v_staff_id, v_organization_id, v_server_campaign_id,
    '__v224_stop_server__' || v_staff_id::text, 'manual_stop',
    v_auth_username, v_auth_password
  );
  IF v_result->>'status' <> 'stopped' THEN
    RAISE EXCEPTION 'v224_smoke: authenticated Server stop failed: %', v_result;
  END IF;

  v_result := public.aka_agent_reactivate_campaign_data_group_source(
    v_staff_id, v_organization_id, v_local_campaign_id,
    '__v224_reactivate_local__' || v_staff_id::text, NULL::text,
    v_auth_username, v_auth_password
  );
  IF v_result->>'status' <> 'active' THEN
    RAISE EXCEPTION 'v224_smoke: authenticated local reactivate failed: %', v_result;
  END IF;

  v_result := public.aka_agent_reactivate_campaign_data_group_source(
    v_staff_id, v_organization_id, v_server_campaign_id,
    '__v224_reactivate_server__' || v_staff_id::text, NULL::text,
    v_auth_username, v_auth_password
  );
  IF v_result->>'status' <> 'active' THEN
    RAISE EXCEPTION 'v224_smoke: authenticated Server reactivate failed: %', v_result;
  END IF;

  PERFORM pg_catalog.set_config(
    'aka_agent.zalo_runtime_target', 'server', true
  );
  IF public.aka_agent_get_campaign_data_group_source(
    v_staff_id, v_organization_id, v_local_campaign_id
  ) IS NOT NULL OR public.aka_agent_get_campaign_data_group_source(
    v_staff_id, v_organization_id, v_server_campaign_id
  ) IS NULL THEN
    RAISE EXCEPTION 'v224_smoke: server-targeted core ownership changed';
  END IF;

  PERFORM pg_catalog.set_config(
    'aka_agent.zalo_runtime_target', 'desktop', true
  );
  IF public.aka_agent_get_campaign_data_group_source(
    v_staff_id, v_organization_id, v_local_campaign_id
  ) IS NULL OR public.aka_agent_get_campaign_data_group_source(
    v_staff_id, v_organization_id, v_server_campaign_id
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'v224_smoke: desktop-targeted core ownership changed';
  END IF;
END;
$behavior$;

ROLLBACK;
