-- Run after migration_v241_campaign_config_version.sql.
-- All fixture rows and behavior checks are rolled back.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
DECLARE
  v_core regprocedure := pg_catalog.to_regprocedure(
    'public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)'
  );
  v_helper regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_campaign_config_version(public.auto_campaigns)'
  );
  v_wrapper regprocedure := pg_catalog.to_regprocedure(
    'public.update_control_campaign_by_config_version_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)'
  );
  v_acl_valid boolean;
BEGIN
  IF v_core IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_core))
      IS DISTINCT FROM '0d03ac88faa1b01608129a33b64752f8'
  THEN
    RAISE EXCEPTION 'v241 smoke: existing core RPC changed';
  END IF;

  IF v_helper IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_helper))
      IS DISTINCT FROM '5992a9958a3df3ccba087f9c9388ebb4'
    OR v_wrapper IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_wrapper))
      IS DISTINCT FROM '4d824c50515201bc8410d7114bd3a8a7'
  THEN
    RAISE EXCEPTION 'v241 smoke: config-version functions are missing or changed';
  END IF;

  SELECT
    p.proacl IS NOT NULL
      AND (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl)) = 2
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(p.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ])
          OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
  INTO v_acl_valid
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = v_helper;
  IF v_acl_valid IS DISTINCT FROM true
    OR pg_catalog.has_function_privilege('anon', v_helper, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_helper, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', v_helper, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'v241 smoke: helper grants changed';
  END IF;

  SELECT
    p.proacl IS NOT NULL
      AND (SELECT count(*) FROM pg_catalog.aclexplode(p.proacl)) = 2
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(p.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ])
          OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
  INTO v_acl_valid
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = v_wrapper;
  IF v_acl_valid IS DISTINCT FROM true
    OR pg_catalog.has_function_privilege('anon', v_wrapper, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_wrapper, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', v_wrapper, 'EXECUTE')
  THEN
    RAISE EXCEPTION 'v241 smoke: wrapper grants changed';
  END IF;
END;
$metadata$;

DO $behavior$
DECLARE
  v_account_id constant bigint := 8800241000000001;
  v_campaign_id constant bigint := 8800241000000002;
  v_staff_id bigint;
  v_organization_id bigint;
  v_action_id text;
  v_loaded_updated_at timestamptz;
  v_loaded_config_version text;
  v_current_config_version text;
  v_result jsonb;
  v_rejected boolean;
BEGIN
  SELECT staff.id, staff.organization_id
  INTO v_staff_id, v_organization_id
  FROM public.org_staff AS staff
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
  ORDER BY staff.id
  LIMIT 1;

  SELECT action.id
  INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE action.flatform_type = 'sms'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  ORDER BY action.id
  LIMIT 1;

  IF v_staff_id IS NULL OR v_action_id IS NULL THEN
    RAISE NOTICE 'v241 smoke: active staff or SMS action missing; behavioral fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aka-agent-v241-smoke-fixture', 0)
  );
  IF EXISTS (SELECT 1 FROM public.auto_accounts WHERE id = v_account_id)
    OR EXISTS (SELECT 1 FROM public.auto_campaigns WHERE id = v_campaign_id) THEN
    RAISE EXCEPTION 'v241 smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_account_id, '__v241_sms_account__', 'sms', false, false,
    'chưa đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status,
    schedule, original_schedule, content, schedule_type,
    extra_settings, images, data_target_source_mode,
    note, log, updated_at,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_campaign_id, '__v241_campaign__', v_action_id, v_account_id, 'tạm dừng',
    now() + interval '1 hour', now() + interval '1 hour',
    '__v241_content__', 'daily',
    '{"v241":true}'::jsonb, '[]'::jsonb, 'direct',
    NULL, '', now() - interval '1 minute',
    v_staff_id, v_organization_id, false
  );

  SELECT campaign.updated_at, public.aka_agent_campaign_config_version(campaign)
  INTO v_loaded_updated_at, v_loaded_config_version
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;

  IF v_loaded_config_version !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'v241 smoke: helper did not return a stable digest';
  END IF;

  -- Reproduce the reported failure: runtime note/log maintenance advances the
  -- shared timestamp while the paused campaign's editable config is unchanged.
  UPDATE public.auto_campaigns
  SET note = '__v241_runtime_note__',
      log = '__v241_runtime_log__',
      updated_at = v_loaded_updated_at + interval '1 second'
  WHERE id = v_campaign_id;

  SELECT public.aka_agent_campaign_config_version(campaign)
  INTO v_current_config_version
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  IF v_current_config_version IS DISTINCT FROM v_loaded_config_version THEN
    RAISE EXCEPTION 'v241 smoke: runtime-only write changed the config digest';
  END IF;

  v_result := public.update_control_campaign_by_config_version_atomic(
    v_staff_id,
    v_organization_id,
    v_campaign_id,
    v_loaded_updated_at,
    jsonb_build_object(
      '_expected_config_version', v_loaded_config_version,
      'name', '__v241_saved_after_runtime_write__'
    )
  );
  IF NOT COALESCE((v_result->>'updated')::boolean, false)
    OR (SELECT name FROM public.auto_campaigns WHERE id = v_campaign_id)
      IS DISTINCT FROM '__v241_saved_after_runtime_write__'
    OR (SELECT status FROM public.auto_campaigns WHERE id = v_campaign_id)
      IS DISTINCT FROM 'tạm dừng'
    OR (SELECT note FROM public.auto_campaigns WHERE id = v_campaign_id)
      IS DISTINCT FROM '__v241_runtime_note__'
  THEN
    RAISE EXCEPTION 'v241 smoke: stale runtime timestamp still blocked save: %', v_result;
  END IF;

  -- A real concurrent configuration edit must still fail closed.
  SELECT campaign.updated_at, public.aka_agent_campaign_config_version(campaign)
  INTO v_loaded_updated_at, v_loaded_config_version
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  UPDATE public.auto_campaigns
  SET content = '__v241_external_config_edit__',
      updated_at = v_loaded_updated_at + interval '1 second'
  WHERE id = v_campaign_id;

  v_result := public.update_control_campaign_by_config_version_atomic(
    v_staff_id,
    v_organization_id,
    v_campaign_id,
    v_loaded_updated_at,
    jsonb_build_object(
      '_expected_config_version', v_loaded_config_version,
      'name', '__v241_must_not_overwrite__'
    )
  );
  IF v_result->>'reason' IS DISTINCT FROM 'version_conflict'
    OR (SELECT name FROM public.auto_campaigns WHERE id = v_campaign_id)
      IS DISTINCT FROM '__v241_saved_after_runtime_write__'
  THEN
    RAISE EXCEPTION 'v241 smoke: true config conflict was not preserved: %', v_result;
  END IF;

  -- Runtime state and tenant/account ownership guards still belong to the
  -- existing core RPC and must pass through unchanged.
  SELECT public.aka_agent_campaign_config_version(campaign)
  INTO v_current_config_version
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  UPDATE public.auto_campaigns
  SET status = 'đang chạy', updated_at = updated_at + interval '1 second'
  WHERE id = v_campaign_id;
  v_result := public.update_control_campaign_by_config_version_atomic(
    v_staff_id,
    v_organization_id,
    v_campaign_id,
    v_loaded_updated_at,
    jsonb_build_object(
      '_expected_config_version', v_current_config_version,
      'name', '__v241_running_must_not_update__'
    )
  );
  IF v_result->>'reason' IS DISTINCT FROM 'campaign_running' THEN
    RAISE EXCEPTION 'v241 smoke: running guard regressed: %', v_result;
  END IF;

  v_result := public.update_control_campaign_by_config_version_atomic(
    v_staff_id + 8800241,
    v_organization_id,
    v_campaign_id,
    v_loaded_updated_at,
    jsonb_build_object(
      '_expected_config_version', v_current_config_version,
      'name', '__v241_foreign_must_not_update__'
    )
  );
  IF v_result->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'v241 smoke: tenant ownership guard regressed: %', v_result;
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.update_control_campaign_by_config_version_atomic(
      v_staff_id,
      v_organization_id,
      v_campaign_id,
      v_loaded_updated_at,
      jsonb_build_object('_expected_config_version', 'not-a-digest')
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'invalid_campaign_config_version';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v241 smoke: malformed config version was accepted';
  END IF;
END;
$behavior$;

ROLLBACK;
