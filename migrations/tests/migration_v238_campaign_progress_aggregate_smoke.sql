-- Run after migration_v238_campaign_progress_aggregate.sql.
-- All fixture rows and behavior checks are rolled back.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';

DO $metadata$
DECLARE
  v_core oid := pg_catalog.to_regprocedure(
    'public.aka_agent_control_campaign_progress(bigint,bigint,bigint[])'
  );
  v_guard oid := pg_catalog.to_regprocedure(
    'public.auto_assert_automation_identity(bigint,bigint,text,text)'
  );
  v_wrapper oid := pg_catalog.to_regprocedure(
    'public.aka_agent_control_campaign_progress(bigint,bigint,bigint[],text,text)'
  );
  v_owner text;
  v_security_definer boolean;
  v_volatility "char";
  v_parallel "char";
  v_config text[];
  v_acl_valid boolean;
  v_result text;
  v_definition text;
BEGIN
  IF v_core IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_core))
      IS DISTINCT FROM 'fdff962116bb5f2c98830dbfaec6a7f4'
  THEN
    RAISE EXCEPTION 'v238 smoke: service-only core changed';
  END IF;

  IF v_guard IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_guard))
      IS DISTINCT FROM '5a9a503db72b965eb644739f5f60905d'
  THEN
    RAISE EXCEPTION 'v238 smoke: automation identity guard changed';
  END IF;

  IF v_wrapper IS NULL
    OR pg_catalog.md5(pg_catalog.pg_get_functiondef(v_wrapper))
      IS DISTINCT FROM '954ab48ce0eec97b433d2cdc6da3b57e'
  THEN
    RAISE EXCEPTION 'v238 smoke: authenticated wrapper is not installed';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.provolatile,
    proc.proparallel,
    proc.proconfig,
    pg_catalog.pg_get_function_result(proc.oid),
    pg_catalog.pg_get_functiondef(proc.oid),
    proc.proacl IS NOT NULL
      AND (SELECT count(*) FROM pg_catalog.aclexplode(proc.proacl)) = 4
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(proc.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('anon')::oid,
          pg_catalog.to_regrole('authenticated')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ])
          OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
  INTO
    v_owner, v_security_definer, v_volatility, v_parallel, v_config,
    v_result, v_definition, v_acl_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_wrapper;

  IF v_owner IS DISTINCT FROM 'postgres'
    OR v_security_definer IS DISTINCT FROM true
    OR v_volatility IS DISTINCT FROM 's'::"char"
    OR v_parallel IS DISTINCT FROM 'u'::"char"
    OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    OR v_result IS DISTINCT FROM
      'TABLE(campaign_id bigint, input_total bigint, input_completed bigint, input_failed bigint)'
    OR v_acl_valid IS DISTINCT FROM true
    OR pg_catalog.strpos(v_definition, 'auto_assert_automation_identity') = 0
    OR pg_catalog.strpos(v_definition, 'campaign_progress_batch_too_large') = 0
  THEN
    RAISE EXCEPTION 'v238 smoke: wrapper metadata, privileges, or guard changed';
  END IF;

  IF pg_catalog.has_function_privilege(
      'anon', v_core, 'EXECUTE'
    ) OR pg_catalog.has_function_privilege(
      'authenticated', v_core, 'EXECUTE'
    ) OR NOT pg_catalog.has_function_privilege(
      'service_role', v_core, 'EXECUTE'
    )
  THEN
    RAISE EXCEPTION 'v238 smoke: service-only core privileges changed';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(proc.proowner),
    proc.prosecdef,
    proc.provolatile,
    proc.proparallel,
    proc.proconfig,
    proc.proacl IS NOT NULL
      AND (SELECT count(*) FROM pg_catalog.aclexplode(proc.proacl)) = 2
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(proc.proacl) AS acl
        WHERE acl.grantee <> ALL(ARRAY[
          pg_catalog.to_regrole('postgres')::oid,
          pg_catalog.to_regrole('service_role')::oid
        ])
          OR acl.grantor <> pg_catalog.to_regrole('postgres')::oid
          OR acl.privilege_type <> 'EXECUTE'
          OR acl.is_grantable
      )
  INTO v_owner, v_security_definer, v_volatility, v_parallel, v_config, v_acl_valid
  FROM pg_catalog.pg_proc AS proc
  WHERE proc.oid = v_guard;
  IF v_owner IS DISTINCT FROM 'postgres'
    OR v_security_definer IS DISTINCT FROM true
    OR v_volatility IS DISTINCT FROM 's'::"char"
    OR v_parallel IS DISTINCT FROM 'u'::"char"
    OR v_config IS DISTINCT FROM ARRAY['search_path=pg_catalog, public']::text[]
    OR v_acl_valid IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'v238 smoke: automation identity guard metadata or privileges changed';
  END IF;
END;
$metadata$;

DO $behavior$
DECLARE
  v_account_id constant bigint := 8800238000000001;
  v_campaign_id constant bigint := 8800238000000002;
  v_empty_campaign_id constant bigint := 8800238000000003;
  v_deleted_campaign_id constant bigint := 8800238000000004;
  v_first_input_id constant bigint := 8800238000000010;
  v_staff_id bigint;
  v_organization_id bigint;
  v_auth_username text;
  v_auth_password text;
  v_action_id text;
  v_foreign_campaign_id bigint;
  v_row_count bigint;
  v_total bigint;
  v_completed bigint;
  v_failed bigint;
  v_rejected boolean;
BEGIN
  SELECT
    staff.id,
    staff.organization_id,
    staff.username,
    staff.password
  INTO
    v_staff_id,
    v_organization_id,
    v_auth_username,
    v_auth_password
  FROM public.org_staff AS staff
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
    AND staff.username IS NOT NULL
    AND staff.password IS NOT NULL
  ORDER BY staff.id
  LIMIT 1;

  SELECT action.id
  INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  ORDER BY action.id
  LIMIT 1;

  IF v_staff_id IS NULL OR v_organization_id IS NULL
    OR v_auth_username IS NULL OR v_auth_password IS NULL
    OR v_action_id IS NULL
  THEN
    RAISE EXCEPTION 'v238 smoke: fixture dependencies are unavailable';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aka-agent-v238-campaign-progress-smoke', 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.auto_accounts WHERE id = v_account_id
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaigns
    WHERE id IN (v_campaign_id, v_empty_campaign_id, v_deleted_campaign_id)
  ) OR EXISTS (
    SELECT 1 FROM public.auto_campaign_input_data
    WHERE id BETWEEN v_first_input_id AND v_first_input_id + 6
  ) THEN
    RAISE EXCEPTION 'v238 smoke: reserved fixture ID collision';
  END IF;

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_account_id, '__v238_campaign_progress_account__',
    'facebook', false, false,
    'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content, schedule,
    data_target_source_mode, staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (v_campaign_id, '__v238_progress_campaign__', v_action_id,
      v_account_id, 'tạm dừng', '', pg_catalog.clock_timestamp(),
      'direct', v_staff_id, v_organization_id, false),
    (v_empty_campaign_id, '__v238_empty_campaign__', v_action_id,
      v_account_id, 'tạm dừng', '', pg_catalog.clock_timestamp(),
      'direct', v_staff_id, v_organization_id, false),
    (v_deleted_campaign_id, '__v238_deleted_campaign__', v_action_id,
      v_account_id, 'tạm dừng', '', pg_catalog.clock_timestamp(),
      'direct', v_staff_id, v_organization_id, true);

  INSERT INTO public.auto_campaign_input_data (
    id, campaign_id, uid, status, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES
    (v_first_input_id, v_campaign_id, '__v238_completed_1__', 'hoàn thành', false),
    (v_first_input_id + 1, v_campaign_id, '__v238_completed_2__', 'hoàn thành', false),
    (v_first_input_id + 2, v_campaign_id, '__v238_pending__', 'chờ xử lý', false),
    (v_first_input_id + 3, v_campaign_id, '__v238_running__', 'đang chạy', false),
    (v_first_input_id + 4, v_campaign_id, '__v238_paused__', 'tạm dừng', false),
    (v_first_input_id + 5, v_campaign_id, '__v238_deleted_input__', 'hoàn thành', true),
    (v_first_input_id + 6, v_deleted_campaign_id, '__v238_deleted_campaign_input__', 'hoàn thành', false);

  SELECT campaign.id
  INTO v_foreign_campaign_id
  FROM public.auto_campaigns AS campaign
  WHERE COALESCE(campaign.is_delete, false) = false
    AND EXISTS (
      SELECT 1
      FROM public.auto_campaign_input_data AS foreign_input
      WHERE foreign_input.campaign_id = campaign.id
        AND foreign_input.is_delete = false
    )
    AND (
      campaign.staff_id IS DISTINCT FROM v_staff_id
      OR campaign.organization_id IS DISTINCT FROM v_organization_id
    )
  ORDER BY campaign.id
  LIMIT 1;
  IF v_foreign_campaign_id IS NULL THEN
    RAISE EXCEPTION 'v238 smoke: a foreign-tenant campaign is required';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'anon', true);
  SELECT
    count(*),
    max(progress.input_total),
    max(progress.input_completed),
    max(progress.input_failed)
  INTO v_row_count, v_total, v_completed, v_failed
  FROM public.aka_agent_control_campaign_progress(
    v_staff_id,
    v_organization_id,
    ARRAY[
      v_campaign_id,
      v_campaign_id,
      v_empty_campaign_id,
      v_deleted_campaign_id,
      v_foreign_campaign_id
    ],
    v_auth_username,
    v_auth_password
  ) AS progress;

  IF v_row_count <> 1 OR v_total <> 5 OR v_completed <> 2 OR v_failed <> 0 THEN
    RAISE EXCEPTION
      'v238 smoke: aggregate mismatch (rows=%, total=%, completed=%, failed=%)',
      v_row_count, v_total, v_completed, v_failed;
  END IF;

  SELECT count(*)
  INTO v_row_count
  FROM public.aka_agent_control_campaign_progress(
    v_staff_id,
    v_organization_id,
    ARRAY[v_empty_campaign_id, v_deleted_campaign_id],
    v_auth_username,
    v_auth_password
  );
  IF v_row_count <> 0 THEN
    RAISE EXCEPTION 'v238 smoke: zero-input or deleted campaign returned a row';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM 1
    FROM public.aka_agent_control_campaign_progress(
      v_staff_id,
      v_organization_id,
      ARRAY[v_campaign_id],
      v_auth_username,
      v_auth_password || '__invalid__'
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'automation_auth_invalid';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v238 smoke: invalid credentials were not rejected';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM 1
    FROM public.aka_agent_control_campaign_progress(
      v_staff_id,
      v_organization_id,
      ARRAY[v_campaign_id],
      NULL,
      NULL
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'automation_auth_required';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v238 smoke: missing credentials were not rejected';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM 1
    FROM public.aka_agent_control_campaign_progress(
      v_staff_id,
      v_organization_id,
      ARRAY(SELECT v_campaign_id FROM pg_catalog.generate_series(1, 101)),
      v_auth_username,
      v_auth_password
    );
  EXCEPTION WHEN raise_exception THEN
    v_rejected := SQLERRM = 'campaign_progress_batch_too_large';
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'v238 smoke: oversized ID batch was not rejected';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  SELECT max(progress.input_total), max(progress.input_completed)
  INTO v_total, v_completed
  FROM public.aka_agent_control_campaign_progress(
    v_staff_id,
    v_organization_id,
    ARRAY[v_campaign_id],
    NULL,
    NULL
  ) AS progress;
  IF v_total <> 5 OR v_completed <> 2 THEN
    RAISE EXCEPTION 'v238 smoke: service-role delegation contract changed';
  END IF;
END;
$behavior$;

ROLLBACK;
