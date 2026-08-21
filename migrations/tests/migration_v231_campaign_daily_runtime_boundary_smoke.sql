-- Rollback smoke test for
-- migration_v231_campaign_daily_runtime_boundary.sql.

BEGIN;

SET LOCAL statement_timeout = '2min';
SET LOCAL lock_timeout = '5s';
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $metadata$
DECLARE
  v_top_claim_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_claim_campaign_runtime_v2(bigint,bigint,bigint,text,uuid)'
  );
  v_unit_claim_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_claim_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,date,uuid,bigint[])'
  );
  v_unit_settle_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_settle_campaign_run_unit_v2(bigint,bigint,bigint,text,uuid,boolean)'
  );
  v_unit_recovery_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_recover_campaign_runtime_unit_leases(bigint,text,text)'
  );
  v_desktop_control_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_set_desktop_campaign_status_v2(bigint,bigint,bigint,text)'
  );
  v_check_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_check_campaign_daily_boundary(bigint,bigint,bigint,text,date)'
  );
  v_yield_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_yield_campaign_daily_boundary(bigint,bigint,bigint,text,uuid,date)'
  );
  v_barrier_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_check_daily_maintenance_barrier(bigint,text,date)'
  );
  v_trigger_function_oid oid := pg_catalog.to_regprocedure(
    'public.aka_agent_clear_campaign_runtime_claim_metadata()'
  );
  v_zalo_operation_claim_oid oid := pg_catalog.to_regprocedure(
    'public.claim_zalo_account_runtime_operation(bigint,bigint,text,boolean)'
  );
  v_zalo_type_claim_oid oid := pg_catalog.to_regprocedure(
    'public.claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)'
  );
  v_oid oid;
  v_column record;
  v_trigger record;
  v_definition text;
  v_arg_names text[];
  v_arg_defaults smallint;
BEGIN
  IF v_top_claim_oid IS NULL
    OR v_unit_claim_oid IS NULL
    OR v_unit_settle_oid IS NULL
    OR v_unit_recovery_oid IS NULL
    OR v_desktop_control_oid IS NULL
    OR v_check_oid IS NULL
    OR v_yield_oid IS NULL
    OR v_barrier_oid IS NULL
    OR v_trigger_function_oid IS NULL
    OR v_zalo_operation_claim_oid IS NULL
    OR v_zalo_type_claim_oid IS NULL
  THEN
    RAISE EXCEPTION 'v231_smoke: required v231 functions are missing';
  END IF;

  FOR v_column IN
    SELECT expected.name, expected.type_name, attribute.attnotnull,
      attribute.atthasdef,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS actual_type
    FROM (
      VALUES
        ('runtime_claim_token'::text, 'uuid'::text),
        ('runtime_claim_target'::text, 'text'::text),
        ('runtime_claim_vietnam_date'::text, 'date'::text),
        ('runtime_claimed_at'::text, 'timestamp with time zone'::text),
        ('runtime_unit_token'::text, 'uuid'::text),
        ('runtime_unit_vietnam_date'::text, 'date'::text),
        ('runtime_unit_claimed_at'::text, 'timestamp with time zone'::text),
        ('runtime_unit_input_data_ids'::text, 'bigint[]'::text)
    ) AS expected(name, type_name)
    LEFT JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = 'public.auto_campaigns'::regclass
     AND attribute.attname = expected.name
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
  LOOP
    IF v_column.actual_type IS NULL
      OR v_column.actual_type IS DISTINCT FROM v_column.type_name
      OR v_column.attnotnull IS DISTINCT FROM false
      OR v_column.atthasdef IS DISTINCT FROM false
    THEN
      RAISE EXCEPTION
        'v231_smoke: column % must be nullable % without a default',
        v_column.name,
        v_column.type_name;
    END IF;
  END LOOP;

  SELECT routine.proargnames, routine.pronargdefaults
  INTO v_arg_names, v_arg_defaults
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = v_top_claim_oid;

  IF v_arg_names[5] IS DISTINCT FROM 'p_runtime_claim_token'
    OR v_arg_defaults IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION
      'v231_smoke: top-level v2 claim must require the client UUID argument';
  END IF;

  SELECT routine.proargnames, routine.pronargdefaults
  INTO v_arg_names, v_arg_defaults
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = v_unit_claim_oid;

  IF v_arg_names[7] IS DISTINCT FROM 'p_runtime_unit_token'
    OR v_arg_names[8] IS DISTINCT FROM 'p_input_data_ids'
    OR v_arg_defaults IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION
      'v231_smoke: run-unit v2 claim must require unit UUID and retain empty-array default';
  END IF;

  SELECT routine.proargnames, routine.pronargdefaults
  INTO v_arg_names, v_arg_defaults
  FROM pg_catalog.pg_proc AS routine
  WHERE routine.oid = v_unit_recovery_oid;

  IF v_arg_names[3] IS DISTINCT FROM 'p_platform_scope'
    OR v_arg_defaults IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION
      'v231_smoke: unit recovery must retain two-arg compatibility through all scope default';
  END IF;

  FOREACH v_oid IN ARRAY ARRAY[
    v_top_claim_oid,
    v_unit_claim_oid,
    v_unit_settle_oid,
    v_unit_recovery_oid,
    v_desktop_control_oid,
    v_check_oid,
    v_yield_oid,
    v_barrier_oid,
    v_zalo_operation_claim_oid,
    v_zalo_type_claim_oid
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = v_oid
        AND (
          routine.prosecdef
          OR routine.provolatile IS DISTINCT FROM 'v'
        )
    ) THEN
      RAISE EXCEPTION
        'v231_smoke: function % must remain VOLATILE SECURITY INVOKER',
        v_oid::regprocedure;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL unnest(
        COALESCE(routine.proconfig, ARRAY[]::text[])
      ) AS setting(value)
      WHERE routine.oid = v_oid
        AND setting.value LIKE 'search_path=%public%'
    ) THEN
      RAISE EXCEPTION 'v231_smoke: function % search_path is not pinned',
        v_oid::regprocedure;
    END IF;

    IF NOT pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
      OR NOT pg_catalog.has_function_privilege(
        'authenticated', v_oid, 'EXECUTE'
      )
      OR NOT pg_catalog.has_function_privilege(
        'service_role', v_oid, 'EXECUTE'
      )
    THEN
      RAISE EXCEPTION 'v231_smoke: runtime roles cannot execute function %',
        v_oid::regprocedure;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS routine
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
      ) AS privilege
      WHERE routine.oid = v_oid
        AND privilege.grantee = 0
        AND privilege.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'v231_smoke: PUBLIC retains EXECUTE on function %',
        v_oid::regprocedure;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    WHERE routine.oid = v_trigger_function_oid
      AND (
        routine.prosecdef
        OR routine.provolatile IS DISTINCT FROM 'v'
        OR routine.prorettype <> 'pg_catalog.trigger'::regtype
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL unnest(
      COALESCE(routine.proconfig, ARRAY[]::text[])
    ) AS setting(value)
    WHERE routine.oid = v_trigger_function_oid
      AND setting.value LIKE 'search_path=%public%'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS routine
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) AS privilege
    WHERE routine.oid = v_trigger_function_oid
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'v231_smoke: runtime-claim cleanup trigger function metadata/ACL changed';
  END IF;

  SELECT trigger.oid, trigger.tgenabled, trigger.tgtype,
    trigger.tgfoid, pg_catalog.pg_get_triggerdef(trigger.oid, true) AS definition
  INTO v_trigger
  FROM pg_catalog.pg_trigger AS trigger
  WHERE trigger.tgrelid = 'public.auto_campaigns'::regclass
    AND trigger.tgname = 'aka_agent_clear_campaign_runtime_claim_metadata'
    AND NOT trigger.tgisinternal;

  IF NOT FOUND
    OR v_trigger.tgenabled = 'D'
    OR v_trigger.tgfoid IS DISTINCT FROM v_trigger_function_oid
    OR (v_trigger.tgtype & 1) = 0
    OR (v_trigger.tgtype & 2) = 0
    OR (v_trigger.tgtype & 16) = 0
    OR position('BEFORE UPDATE OF status' IN v_trigger.definition) = 0
  THEN
    RAISE EXCEPTION
      'v231_smoke: status cleanup trigger is missing or has the wrong shape';
  END IF;

  -- Text guards retain coverage of the exact inclusive operator and default
  -- even when the behavior smoke executes during Vietnam's final minute.
  FOREACH v_oid IN ARRAY ARRAY[
    v_top_claim_oid,
    v_unit_claim_oid,
    v_check_oid,
    v_yield_oid
  ]
  LOOP
    SELECT pg_catalog.pg_get_functiondef(v_oid)
    INTO v_definition;

    IF position('time ''23:59:00''' IN v_definition) = 0
      OR position('v_now >= v_boundary_at' IN v_definition) = 0
    THEN
      RAISE EXCEPTION
        'v231_smoke: function % lost the inclusive 23:59 boundary',
        v_oid::regprocedure;
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_functiondef(v_barrier_oid)
  INTO v_definition;
  IF position(
      'campaign.runtime_claim_vietnam_date IS NOT NULL' IN v_definition
    ) = 0
    OR position(
      'campaign.runtime_claim_vietnam_date IS NULL' IN v_definition
    ) = 0
    OR position(
      'campaign.runtime_unit_vietnam_date < v_vietnam_date' IN v_definition
    ) = 0
  THEN
    RAISE EXCEPTION
      'v231_smoke: maintenance barrier lost unit/parent/legacy run-date routing';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_trigger_function_oid)
  INTO v_definition;
  IF position('NEW.runtime_unit_token' IN v_definition) > 0
    OR position('OLD.status = ''đang chạy''' IN v_definition) = 0
    OR position('NEW.status = ''tạm dừng''' IN v_definition) = 0
    OR position(
      'OLD.runtime_claim_target = ''server''' IN v_definition
    ) = 0
    OR position(
      'NEW.runtime_claim_token := OLD.runtime_claim_token'
      IN v_definition
    ) = 0
    OR position(
      'NEW.runtime_claim_target := OLD.runtime_claim_target'
      IN v_definition
    ) = 0
  THEN
    RAISE EXCEPTION
      'v231_smoke: status trigger lost paused parent/unit ownership semantics';
  END IF;

  FOREACH v_oid IN ARRAY ARRAY[
    v_zalo_operation_claim_oid,
    v_zalo_type_claim_oid
  ]
  LOOP
    SELECT pg_catalog.pg_get_functiondef(v_oid)
    INTO v_definition;
    IF position(
      'campaign.runtime_unit_token IS NOT NULL' IN v_definition
    ) = 0 OR position('''reason'', ''work_running''' IN v_definition) = 0
    THEN
      RAISE EXCEPTION
        'v231_smoke: Zalo account operation % lost durable-unit guard',
        v_oid::regprocedure;
    END IF;
  END LOOP;
END;
$metadata$;

DO $behavior$
DECLARE
  v_staff_id constant bigint := 8800231000000001;
  v_account_id constant bigint := 8800231000000002;
  v_campaign_id constant bigint := 8800231000000003;
  v_input_data_id_1 constant bigint := 8800231000000004;
  v_input_data_id_2 constant bigint := 8800231000000005;
  v_server_account_id constant bigint := 8800231000000006;
  v_server_campaign_id constant bigint := 8800231000000007;
  v_server_input_data_id constant bigint := 8800231000000008;
  v_claim_token constant uuid := '23100000-0000-4000-8000-000000000001';
  v_newer_token constant uuid := '23100000-0000-4000-8000-000000000002';
  v_stale_token constant uuid := '23100000-0000-4000-8000-000000000003';
  v_unit_token constant uuid := '23100000-0000-4000-8000-000000000011';
  v_newer_unit_token constant uuid := '23100000-0000-4000-8000-000000000012';
  v_stale_unit_token constant uuid := '23100000-0000-4000-8000-000000000013';
  v_empty_unit_token constant uuid := '23100000-0000-4000-8000-000000000014';
  v_server_campaign_pause_claim_token constant uuid :=
    '23100000-0000-4000-8000-000000000021';
  v_server_account_pause_claim_token constant uuid :=
    '23100000-0000-4000-8000-000000000022';
  v_server_active_unit_claim_token constant uuid :=
    '23100000-0000-4000-8000-000000000023';
  v_server_active_unit_token constant uuid :=
    '23100000-0000-4000-8000-000000000031';
  v_interrupted_note constant text :=
    'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_action_id text;
  v_zalo_action_id text;
  v_now timestamptz;
  v_today date;
  v_yesterday date;
  v_schedule timestamptz;
  v_original_schedule timestamptz;
  v_fresh_boundary timestamptz;
  v_due_stop time without time zone;
  v_claim_date date;
  v_claimed_at timestamptz;
  v_input_before jsonb;
  v_input_after jsonb;
  v_result record;
  v_operation_result jsonb;
  v_campaign_status text;
  v_account_status text;
  v_stored_token uuid;
  v_stored_target text;
  v_stored_date date;
  v_stored_claimed_at timestamptz;
  v_stored_unit_token uuid;
  v_stored_unit_date date;
  v_stored_unit_claimed_at timestamptz;
  v_stored_unit_input_data_ids bigint[];
  v_legacy_claimed boolean;
  v_fresh_claim_safe boolean;
BEGIN
  v_now := clock_timestamp();
  v_today := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_yesterday := v_today - 1;
  v_schedule := (
    v_today + time '00:00:00'
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_original_schedule := (
    v_yesterday + time '08:15:00'
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';

  SELECT staff.organization_id
  INTO v_organization_id
  FROM public.org_staff AS staff
  JOIN public.org_organization AS organization
    ON organization.id = staff.organization_id
  CROSS JOIN LATERAL
    public.resolve_organization_zalo_account_capabilities(
      staff.organization_id
    ) AS capabilities
  WHERE staff.is_active = true
    AND staff.organization_id IS NOT NULL
    AND COALESCE(capabilities.qr_enabled, false) = true
    AND COALESCE(capabilities.server_enabled, false) = true
  ORDER BY staff.id
  LIMIT 1;

  SELECT action.id
  INTO v_action_id
  FROM public.auto_campaign_actions AS action
  WHERE lower(btrim(COALESCE(action.flatform_type, ''))) = 'facebook'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  ORDER BY action.id
  LIMIT 1;

  SELECT action.id
  INTO v_zalo_action_id
  FROM public.auto_campaign_actions AS action
  WHERE lower(btrim(COALESCE(action.flatform_type, ''))) = 'zalo'
    AND COALESCE(action.is_active, true) = true
    AND COALESCE(action.is_delete, false) = false
  ORDER BY action.id
  LIMIT 1;

  IF v_organization_id IS NULL
    OR v_action_id IS NULL
    OR v_zalo_action_id IS NULL
  THEN
    RAISE NOTICE
      'v231_smoke: Server-enabled organization or Facebook/Zalo action missing; behavior fixture skipped';
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('aka-agent-v231-daily-boundary-smoke', 0)
  );

  IF EXISTS (SELECT 1 FROM public.org_staff WHERE id = v_staff_id)
    OR EXISTS (
      SELECT 1 FROM public.auto_accounts
      WHERE id IN (v_account_id, v_server_account_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns
      WHERE id IN (v_campaign_id, v_server_campaign_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.auto_campaign_input_data
      WHERE id IN (
        v_input_data_id_1, v_input_data_id_2, v_server_input_data_id
      )
    )
  THEN
    RAISE EXCEPTION 'v231_smoke: reserved fixture ID collision';
  END IF;

  -- A dedicated staff keeps every barrier count independent from production
  -- campaign rows in the selected organization.
  INSERT INTO public.org_staff (
    id, organization_id, name, phone, username, password, is_active
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_staff_id,
    v_organization_id,
    '__v231_boundary_staff__',
    '8800231000000001',
    '__v231_boundary_staff__',
    '__v231_rollback_only__',
    true
  );

  INSERT INTO public.auto_accounts (
    id, name, flatform_type, is_zalo_show_web, is_zalo_server,
    login_status, status, is_active,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_account_id, '__v231_boundary_account__', 'facebook', false, false,
    'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  ), (
    v_server_account_id, '__v231_boundary_server_account__', 'zalo', false, true,
    'đã đăng nhập', 'chờ xử lý', true,
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_campaigns (
    id, name, action_id, account_id, status, content,
    schedule, original_schedule, schedule_type, daily_stop_time,
    continue_next_day, data_target_source_mode,
    staff_id, organization_id, is_delete
  ) OVERRIDING SYSTEM VALUE VALUES (
    v_campaign_id, '__v231_boundary_campaign__', v_action_id,
    v_account_id, 'chờ xử lý', '',
    v_schedule, v_original_schedule, 'daily', NULL,
    true, 'direct',
    v_staff_id, v_organization_id, false
  ), (
    v_server_campaign_id, '__v231_boundary_server_campaign__',
    v_zalo_action_id, v_server_account_id, 'chờ xử lý', '',
    v_schedule, v_original_schedule, 'daily', NULL,
    true, 'direct',
    v_staff_id, v_organization_id, false
  );

  INSERT INTO public.auto_campaign_input_data (
    id, campaign_id, name, uid, status, note, schedule, is_delete
  ) VALUES
    (
      v_input_data_id_1, v_campaign_id, '__v231_target_1__',
      '__v231_uid_1__', 'chờ xử lý', '__v231_preserve_input_1__',
      v_schedule, false
    ),
    (
      v_input_data_id_2, v_campaign_id, '__v231_target_2__',
      '__v231_uid_2__', 'chờ xử lý', '__v231_preserve_input_2__',
      v_schedule, false
    ),
    (
      v_server_input_data_id, v_server_campaign_id,
      '__v231_server_target__', '__v231_server_uid__',
      'chờ xử lý', '__v231_preserve_server_input__',
      v_schedule, false
    );

  -- A fresh v2 claim is intentionally skipped near/after the 23:59 default
  -- boundary. The DO statement itself times out before the safety margin, so
  -- this branch cannot become a clock-crossing false negative.
  v_now := clock_timestamp();
  v_today := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_fresh_boundary := (
    v_today + time '23:59:00'
  ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_fresh_claim_safe := v_now + interval '2 minutes 5 seconds'
    < v_fresh_boundary;

  IF v_fresh_claim_safe THEN
    -- Desktop no-stop: paused old-day schedule is resumed before maintenance.
    -- The first/new claim must leave both rows pending until today's schedule
    -- has been written, after which the exact same client token may claim.
    UPDATE public.auto_campaigns
    SET status = 'tạm dừng',
      schedule = (
        v_yesterday + time '12:00:00'
      ) AT TIME ZONE 'Asia/Ho_Chi_Minh',
      daily_stop_time = NULL
    WHERE id = v_campaign_id;
    UPDATE public.auto_accounts
    SET status = 'chờ xử lý'
    WHERE id = v_account_id;

    SELECT * INTO v_result
    FROM public.aka_agent_set_desktop_campaign_status_v2(
      v_campaign_id, v_account_id, v_staff_id, 'chờ xử lý'
    );
    IF v_result.ok IS DISTINCT FROM true
      OR v_result.reason IS DISTINCT FROM 'updated'
    THEN
      RAISE EXCEPTION
        'v231_smoke: stale Desktop campaign could not enter resume race fixture';
    END IF;

    SELECT * INTO v_result
    FROM public.aka_agent_claim_campaign_runtime_v2(
      v_campaign_id, v_account_id, v_staff_id, 'desktop', v_stale_token
    );
    IF v_result.ok IS DISTINCT FROM false
      OR v_result.reason IS DISTINCT FROM 'daily_maintenance_required'
      OR v_result.campaign_status IS DISTINCT FROM 'chờ xử lý'
      OR v_result.account_status IS DISTINCT FROM 'chờ xử lý'
      OR EXISTS (
        SELECT 1 FROM public.auto_campaigns AS campaign
        WHERE campaign.id = v_campaign_id
          AND (
            campaign.runtime_claim_token IS NOT NULL
            OR campaign.status IS DISTINCT FROM 'chờ xử lý'
          )
      )
    THEN
      RAISE EXCEPTION
        'v231_smoke: stale Desktop schedule crossed maintenance claim gate';
    END IF;

    UPDATE public.auto_campaigns
    SET schedule = (
      v_today + time '00:00:00'
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh'
    WHERE id = v_campaign_id;
    SELECT * INTO v_result
    FROM public.aka_agent_claim_campaign_runtime_v2(
      v_campaign_id, v_account_id, v_staff_id, 'desktop', v_stale_token
    );
    IF v_result.ok IS DISTINCT FROM true
      OR v_result.reason IS DISTINCT FROM 'claimed'
    THEN
      RAISE EXCEPTION
        'v231_smoke: maintained Desktop schedule was not claimable';
    END IF;

    UPDATE public.auto_campaigns
    SET status = 'chờ xử lý', schedule = v_schedule,
      daily_stop_time = NULL
    WHERE id = v_campaign_id;
    UPDATE public.auto_accounts
    SET status = 'chờ xử lý'
    WHERE id = v_account_id;

    -- Server with an explicit stop follows the same fail-closed ordering.
    UPDATE public.auto_campaigns
    SET status = 'tạm dừng',
      schedule = (
        v_yesterday + time '12:00:00'
      ) AT TIME ZONE 'Asia/Ho_Chi_Minh',
      daily_stop_time = time '23:59:00'
    WHERE id = v_server_campaign_id;
    UPDATE public.auto_accounts
    SET status = 'chờ xử lý'
    WHERE id = v_server_account_id;

    SELECT * INTO v_result
    FROM public.aka_agent_set_zalo_server_campaign_status(
      v_server_campaign_id, v_staff_id, 'chờ xử lý'
    );
    IF v_result.ok IS DISTINCT FROM true
      OR v_result.reason NOT IN ('updated', 'already_target')
    THEN
      RAISE EXCEPTION
        'v231_smoke: stale Server campaign could not enter resume race fixture';
    END IF;

    SELECT * INTO v_result
    FROM public.aka_agent_claim_campaign_runtime_v2(
      v_server_campaign_id,
      v_server_account_id,
      v_staff_id,
      'server',
      v_newer_token
    );
    IF v_result.ok IS DISTINCT FROM false
      OR v_result.reason IS DISTINCT FROM 'daily_maintenance_required'
      OR v_result.campaign_status IS DISTINCT FROM 'chờ xử lý'
      OR v_result.account_status IS DISTINCT FROM 'chờ xử lý'
      OR EXISTS (
        SELECT 1 FROM public.auto_campaigns AS campaign
        WHERE campaign.id = v_server_campaign_id
          AND (
            campaign.runtime_claim_token IS NOT NULL
            OR campaign.status IS DISTINCT FROM 'chờ xử lý'
          )
      )
    THEN
      RAISE EXCEPTION
        'v231_smoke: stale Server schedule crossed maintenance claim gate';
    END IF;

    UPDATE public.auto_campaigns
    SET schedule = (
      v_today + time '00:00:00'
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh'
    WHERE id = v_server_campaign_id;
    SELECT * INTO v_result
    FROM public.aka_agent_claim_campaign_runtime_v2(
      v_server_campaign_id,
      v_server_account_id,
      v_staff_id,
      'server',
      v_newer_token
    );
    IF v_result.ok IS DISTINCT FROM true
      OR v_result.reason IS DISTINCT FROM 'claimed'
    THEN
      RAISE EXCEPTION
        'v231_smoke: maintained Server schedule was not claimable';
    END IF;

    UPDATE public.auto_campaigns
    SET status = 'chờ xử lý', schedule = v_schedule,
      daily_stop_time = NULL
    WHERE id = v_server_campaign_id;
    UPDATE public.auto_accounts
    SET status = 'chờ xử lý'
    WHERE id = v_server_account_id;
  ELSE
    RAISE NOTICE
      'v231_smoke: stale resume/maintenance claims skipped near 23:59';
  END IF;

  -- A Server campaign pause can commit after the top-level claim committed but
  -- before its response reached the executor. Preserve that exact ownership so
  -- the retry observes the paused campaign and cleanup releases the account at
  -- the normal executor boundary, never early from the control RPC.
  v_claim_date := timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date;
  v_claimed_at := clock_timestamp();
  UPDATE public.auto_campaigns
  SET status = 'đang chạy', schedule = v_schedule, daily_stop_time = NULL
  WHERE id = v_server_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy'
  WHERE id = v_server_account_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_server_campaign_pause_claim_token,
    runtime_claim_target = 'server',
    runtime_claim_vietnam_date = v_claim_date,
    runtime_claimed_at = v_claimed_at,
    runtime_unit_token = NULL,
    runtime_unit_vietnam_date = NULL,
    runtime_unit_claimed_at = NULL,
    runtime_unit_input_data_ids = NULL
  WHERE id = v_server_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_server_campaign_id, v_staff_id, 'tạm dừng'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
    OR v_result.account_status IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION
      'v231_smoke: Server campaign pause fixture was not applied';
  END IF;

  SELECT campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_claim_vietnam_date,
    campaign.runtime_claimed_at,
    campaign.runtime_unit_token
  INTO v_stored_token, v_stored_target, v_stored_date, v_stored_claimed_at,
    v_stored_unit_token
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_server_campaign_id;
  IF v_stored_token IS DISTINCT FROM v_server_campaign_pause_claim_token
    OR v_stored_target IS DISTINCT FROM 'server'
    OR v_stored_date IS DISTINCT FROM v_claim_date
    OR v_stored_claimed_at IS DISTINCT FROM v_claimed_at
    OR v_stored_unit_token IS NOT NULL
  THEN
    RAISE EXCEPTION
      'v231_smoke: campaign pause discarded lost-response parent ownership';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_runtime_v2(
    v_server_campaign_id,
    v_server_account_id,
    v_staff_id,
    'server',
    v_server_campaign_pause_claim_token
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'already_claimed'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
    OR v_result.account_status IS DISTINCT FROM 'đang chạy'
    OR v_result.runtime_claim_token
      IS DISTINCT FROM v_server_campaign_pause_claim_token
    OR v_result.runtime_claim_vietnam_date IS DISTINCT FROM v_claim_date
    OR v_result.runtime_claimed_at IS DISTINCT FROM v_claimed_at
  THEN
    RAISE EXCEPTION
      'v231_smoke: campaign-pause lost top-claim response was not recovered';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_finalize_zalo_server_campaign(
    v_server_campaign_id, v_staff_id, NULL, false
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'campaign_control_won'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
    OR v_result.account_status IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION
      'v231_smoke: campaign-pause safe cleanup boundary was not observed';
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(
    v_server_account_id, v_staff_id, 'server', 'chờ xử lý'
  ) THEN
    RAISE EXCEPTION
      'v231_smoke: campaign-pause cleanup did not release Server account';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.id = v_server_campaign_id
      AND (
        campaign.status IS DISTINCT FROM 'tạm dừng'
        OR account.status IS DISTINCT FROM 'chờ xử lý'
        OR campaign.runtime_claim_token
          IS DISTINCT FROM v_server_campaign_pause_claim_token
        OR campaign.runtime_claim_target IS DISTINCT FROM 'server'
      )
  ) THEN
    RAISE EXCEPTION
      'v231_smoke: campaign-pause cleanup released ownership unsafely';
  END IF;

  -- Resuming the paused campaign is a new dispatch decision and must clear the
  -- dormant parent tuple, preserving the old Server control RPC contract.
  SELECT * INTO v_result
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_server_campaign_id, v_staff_id, 'chờ xử lý'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_server_campaign_id
        AND (
          campaign.status IS DISTINCT FROM 'chờ xử lý'
          OR campaign.runtime_claim_token IS NOT NULL
          OR campaign.runtime_claim_target IS NOT NULL
          OR campaign.runtime_claim_vietnam_date IS NOT NULL
          OR campaign.runtime_claimed_at IS NOT NULL
        )
    )
  THEN
    RAISE EXCEPTION
      'v231_smoke: campaign resume did not clear dormant parent ownership';
  END IF;

  -- The symmetric lost-response race through account pause keeps the campaign
  -- parent tuple while the account becomes paused. The normal finalizer then
  -- observes account control, returns the campaign to pending, and lets the
  -- status trigger clear ownership without ever reopening the account.
  v_claimed_at := clock_timestamp();
  UPDATE public.auto_campaigns
  SET status = 'đang chạy'
  WHERE id = v_server_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy'
  WHERE id = v_server_account_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_server_account_pause_claim_token,
    runtime_claim_target = 'server',
    runtime_claim_vietnam_date = v_claim_date,
    runtime_claimed_at = v_claimed_at
  WHERE id = v_server_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_set_zalo_server_account_status(
    v_server_account_id, v_staff_id, 'tạm dừng'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
    OR v_result.account_status IS DISTINCT FROM 'tạm dừng'
    OR v_result.campaign_status IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION
      'v231_smoke: Server account pause fixture was not applied';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_runtime_v2(
    v_server_campaign_id,
    v_server_account_id,
    v_staff_id,
    'server',
    v_server_account_pause_claim_token
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'already_claimed'
    OR v_result.campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_result.account_status IS DISTINCT FROM 'tạm dừng'
    OR v_result.runtime_claim_token
      IS DISTINCT FROM v_server_account_pause_claim_token
    OR v_result.runtime_claim_vietnam_date IS DISTINCT FROM v_claim_date
    OR v_result.runtime_claimed_at IS DISTINCT FROM v_claimed_at
  THEN
    RAISE EXCEPTION
      'v231_smoke: account-pause lost top-claim response was not recovered';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_finalize_zalo_server_campaign(
    v_server_campaign_id, v_staff_id, NULL, false
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'account_control_won'
    OR v_result.campaign_status IS DISTINCT FROM 'chờ xử lý'
    OR v_result.account_status IS DISTINCT FROM 'tạm dừng'
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_server_campaign_id
        AND (
          campaign.runtime_claim_token IS NOT NULL
          OR campaign.runtime_claim_target IS NOT NULL
          OR campaign.runtime_claim_vietnam_date IS NOT NULL
          OR campaign.runtime_claimed_at IS NOT NULL
        )
    )
  THEN
    RAISE EXCEPTION
      'v231_smoke: account-pause normal cleanup did not release parent ownership';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_set_zalo_server_account_status(
    v_server_account_id, v_staff_id, 'chờ xử lý'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
    OR v_result.account_status IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION
      'v231_smoke: Server account did not resume after safe cleanup';
  END IF;

  -- An already-started unit is stronger than either mutable control status.
  -- Campaign pause preserves both parent and unit leases; both exact retries
  -- recover their responses. Only explicit settlement may clear the unit.
  v_claimed_at := clock_timestamp();
  UPDATE public.auto_campaigns
  SET status = 'đang chạy'
  WHERE id = v_server_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy'
  WHERE id = v_server_account_id;
  UPDATE public.auto_campaign_input_data
  SET status = 'đang chạy', date_action = v_claimed_at
  WHERE id = v_server_input_data_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_server_active_unit_claim_token,
    runtime_claim_target = 'server',
    runtime_claim_vietnam_date = v_claim_date,
    runtime_claimed_at = v_claimed_at,
    runtime_unit_token = v_server_active_unit_token,
    runtime_unit_vietnam_date = v_claim_date,
    runtime_unit_claimed_at = v_claimed_at,
    runtime_unit_input_data_ids = ARRAY[v_server_input_data_id]::bigint[]
  WHERE id = v_server_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_server_campaign_id, v_staff_id, 'tạm dừng'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
    OR v_result.account_status IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION
      'v231_smoke: active-unit Server campaign pause was not applied';
  END IF;

  SELECT campaign.runtime_claim_token, campaign.runtime_claim_target,
    campaign.runtime_unit_token
  INTO v_stored_token, v_stored_target, v_stored_unit_token
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_server_campaign_id;
  IF v_stored_token IS DISTINCT FROM v_server_active_unit_claim_token
    OR v_stored_target IS DISTINCT FROM 'server'
    OR v_stored_unit_token IS DISTINCT FROM v_server_active_unit_token
  THEN
    RAISE EXCEPTION
      'v231_smoke: active-unit pause discarded durable ownership';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_runtime_v2(
    v_server_campaign_id,
    v_server_account_id,
    v_staff_id,
    'server',
    v_server_active_unit_claim_token
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'already_claimed'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
    OR v_result.account_status IS DISTINCT FROM 'đang chạy'
  THEN
    RAISE EXCEPTION
      'v231_smoke: active-unit paused parent retry was not recovered';
  END IF;

  -- Staff/entitlement state is mutable after the unit transaction commits.
  -- Exact response recovery must still pass under the full campaign/input row
  -- locks so the caller can settle the known token and unblock maintenance.
  UPDATE public.org_staff
  SET is_active = false
  WHERE id = v_staff_id;
  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_run_unit_v2(
    v_server_campaign_id,
    v_server_account_id,
    v_staff_id,
    'server',
    v_server_active_unit_claim_token,
    v_claim_date,
    v_server_active_unit_token,
    ARRAY[v_server_input_data_id]::bigint[]
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'already_claimed'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
    OR v_result.account_status IS DISTINCT FROM 'đang chạy'
    OR v_result.runtime_unit_token
      IS DISTINCT FROM v_server_active_unit_token
  THEN
    RAISE EXCEPTION
      'v231_smoke: inactive-staff exact unit retry was not recovered';
  END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'hoàn thành', date_action = clock_timestamp()
  WHERE id = v_server_input_data_id;
  SELECT * INTO v_result
  FROM public.aka_agent_settle_campaign_run_unit_v2(
    v_server_campaign_id,
    v_server_account_id,
    v_staff_id,
    'server',
    v_server_active_unit_token,
    false
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'settled'
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_server_campaign_id
        AND (
          campaign.runtime_unit_token IS NOT NULL
          OR campaign.runtime_unit_vietnam_date IS NOT NULL
          OR campaign.runtime_unit_claimed_at IS NOT NULL
          OR campaign.runtime_unit_input_data_ids IS NOT NULL
          OR campaign.runtime_claim_token
            IS DISTINCT FROM v_server_active_unit_claim_token
          OR campaign.runtime_claim_target IS DISTINCT FROM 'server'
        )
    )
  THEN
    RAISE EXCEPTION
      'v231_smoke: active-unit lease changed before/after exact settlement';
  END IF;

  UPDATE public.org_staff
  SET is_active = true
  WHERE id = v_staff_id;

  SELECT * INTO v_result
  FROM public.aka_agent_finalize_zalo_server_campaign(
    v_server_campaign_id, v_staff_id, NULL, false
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'campaign_control_won'
  THEN
    RAISE EXCEPTION
      'v231_smoke: settled paused unit missed normal cleanup boundary';
  END IF;
  IF NOT public.release_zalo_account_runtime_operation(
    v_server_account_id, v_staff_id, 'server', 'chờ xử lý'
  ) THEN
    RAISE EXCEPTION
      'v231_smoke: settled paused unit did not release Server account';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_server_campaign_id, v_staff_id, 'chờ xử lý'
  );
  UPDATE public.auto_campaign_input_data
  SET status = 'chờ xử lý', date_action = NULL
  WHERE id = v_server_input_data_id;
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_server_campaign_id
        AND (
          campaign.runtime_claim_token IS NOT NULL
          OR campaign.runtime_claim_target IS NOT NULL
          OR campaign.runtime_claim_vietnam_date IS NOT NULL
          OR campaign.runtime_claimed_at IS NOT NULL
          OR campaign.runtime_unit_token IS NOT NULL
        )
    )
  THEN
    RAISE EXCEPTION
      'v231_smoke: active-unit cleanup did not prepare a new dispatch';
  END IF;

  -- DB-first control can make every mutable status idle before an empty-ID
  -- aggregate unit has completed its external effect. Both legacy account
  -- operations and tokenized subtype conversion must still see work_running;
  -- only token-CAS unit settlement may reopen the account claim.
  UPDATE public.auto_campaigns
  SET status = 'tạm dừng',
    runtime_claim_token = NULL,
    runtime_claim_target = NULL,
    runtime_claim_vietnam_date = NULL,
    runtime_claimed_at = NULL,
    runtime_unit_token = v_empty_unit_token,
    runtime_unit_vietnam_date = v_today,
    runtime_unit_claimed_at = clock_timestamp(),
    runtime_unit_input_data_ids = ARRAY[]::bigint[]
  WHERE id = v_server_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'tạm dừng', runtime_operation_claim_token = NULL
  WHERE id = v_server_account_id;

  v_operation_result := public.claim_zalo_account_runtime_operation(
    v_server_account_id, v_staff_id, 'server', false
  );
  IF v_operation_result->>'claimed' IS DISTINCT FROM 'false'
    OR v_operation_result->>'reason' IS DISTINCT FROM 'work_running'
  THEN
    RAISE EXCEPTION
      'v231_smoke: legacy Zalo operation crossed empty durable unit';
  END IF;

  v_operation_result := public.claim_zalo_account_runtime_operation(
    v_server_account_id,
    v_staff_id,
    'server',
    'tạm dừng',
    v_stale_unit_token,
    false
  );
  IF v_operation_result->>'claimed' IS DISTINCT FROM 'false'
    OR v_operation_result->>'reason' IS DISTINCT FROM 'work_running'
    OR EXISTS (
      SELECT 1
      FROM public.auto_accounts AS account
      WHERE account.id = v_server_account_id
        AND (
          account.status IS DISTINCT FROM 'tạm dừng'
          OR account.runtime_operation_claim_token IS NOT NULL
          OR COALESCE(account.is_zalo_show_web, false)
          OR NOT COALESCE(account.is_zalo_server, false)
        )
    )
  THEN
    RAISE EXCEPTION
      'v231_smoke: tokenized subtype claim crossed empty durable unit';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_settle_campaign_run_unit_v2(
    v_server_campaign_id,
    v_server_account_id,
    v_staff_id,
    'server',
    v_empty_unit_token,
    false
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'settled'
  THEN
    RAISE EXCEPTION
      'v231_smoke: empty Zalo subtype-guard unit did not settle';
  END IF;

  v_operation_result := public.claim_zalo_account_runtime_operation(
    v_server_account_id,
    v_staff_id,
    'server',
    'tạm dừng',
    v_stale_unit_token,
    false
  );
  IF v_operation_result->>'claimed' IS DISTINCT FROM 'true'
    OR v_operation_result->>'claim_token'
      IS DISTINCT FROM v_stale_unit_token::text
    OR NOT EXISTS (
      SELECT 1
      FROM public.auto_accounts AS account
      WHERE account.id = v_server_account_id
        AND account.status = 'đang chạy'
        AND account.runtime_operation_claim_token = v_stale_unit_token
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
    )
  THEN
    RAISE EXCEPTION
      'v231_smoke: settled unit did not reopen tokenized subtype claim';
  END IF;

  IF NOT public.release_zalo_account_runtime_operation(
    v_server_account_id,
    v_staff_id,
    'server',
    'tạm dừng',
    v_stale_unit_token
  ) THEN
    RAISE EXCEPTION
      'v231_smoke: subtype-guard fixture operation did not release';
  END IF;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = v_server_account_id;

  -- A paused Server parent may survive until an idle account is converted back
  -- to Desktop. Desktop resume is allowed to consume only this dormant Server
  -- tuple (with no unit/account run); paused -> pending clears it atomically.
  v_claimed_at := clock_timestamp();
  UPDATE public.auto_campaigns
  SET status = 'đang chạy'
  WHERE id = v_server_campaign_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_server_campaign_pause_claim_token,
    runtime_claim_target = 'server',
    runtime_claim_vietnam_date = v_claim_date,
    runtime_claimed_at = v_claimed_at
  WHERE id = v_server_campaign_id;
  SELECT * INTO v_result
  FROM public.aka_agent_set_zalo_server_campaign_status(
    v_server_campaign_id, v_staff_id, 'tạm dừng'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
  THEN
    RAISE EXCEPTION
      'v231_smoke: subtype-handoff paused Server parent fixture failed';
  END IF;

  UPDATE public.auto_accounts
  SET is_zalo_server = false
  WHERE id = v_server_account_id;
  SELECT * INTO v_result
  FROM public.aka_agent_set_desktop_campaign_status_v2(
    v_server_campaign_id,
    v_server_account_id,
    v_staff_id,
    'chờ xử lý'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
    OR v_result.campaign_status IS DISTINCT FROM 'chờ xử lý'
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_server_campaign_id
        AND (
          campaign.runtime_claim_token IS NOT NULL
          OR campaign.runtime_claim_target IS NOT NULL
          OR campaign.runtime_claim_vietnam_date IS NOT NULL
          OR campaign.runtime_claimed_at IS NOT NULL
        )
    )
  THEN
    RAISE EXCEPTION
      'v231_smoke: Desktop resume could not consume dormant Server parent';
  END IF;
  UPDATE public.auto_accounts
  SET is_zalo_server = true
  WHERE id = v_server_account_id;

  IF v_fresh_claim_safe THEN
    UPDATE public.auto_campaigns
    SET daily_stop_time = time '23:59:00'
    WHERE id = v_campaign_id;

    SELECT * INTO v_result
    FROM public.aka_agent_claim_campaign_runtime_v2(
      v_campaign_id,
      v_account_id,
      v_staff_id,
      'desktop',
      v_claim_token
    );

    IF v_result.ok IS DISTINCT FROM true
      OR v_result.reason IS DISTINCT FROM 'claimed'
      OR v_result.runtime_claim_token IS DISTINCT FROM v_claim_token
      OR v_result.runtime_claim_vietnam_date IS DISTINCT FROM v_today
      OR v_result.runtime_claimed_at IS NULL
      OR v_result.campaign_status IS DISTINCT FROM 'đang chạy'
      OR v_result.account_status IS DISTINCT FROM 'đang chạy'
      OR (
        SELECT campaign.runtime_claim_target
        FROM public.auto_campaigns AS campaign
        WHERE campaign.id = v_campaign_id
      ) IS DISTINCT FROM 'desktop'
      OR v_result.db_now >= v_result.boundary_at
    THEN
      RAISE EXCEPTION 'v231_smoke: fresh top-level v2 claim failed';
    END IF;

    v_claim_date := v_result.runtime_claim_vietnam_date;
    v_claimed_at := v_result.runtime_claimed_at;

    -- Deliberately reverse the request; the DB contract stores/returns one
    -- canonical ascending payload so retry identity is independent of order.
    SELECT * INTO v_result
    FROM public.aka_agent_claim_campaign_run_unit_v2(
      v_campaign_id,
      v_account_id,
      v_staff_id,
      'desktop',
      v_claim_token,
      v_claim_date,
      v_unit_token,
      ARRAY[v_input_data_id_2, v_input_data_id_1]::bigint[]
    );

    IF v_result.ok IS DISTINCT FROM true
      OR v_result.reason IS DISTINCT FROM 'claimed'
      OR v_result.claimed_count IS DISTINCT FROM 2
      OR v_result.runtime_claim_token IS DISTINCT FROM v_claim_token
      OR v_result.runtime_claim_vietnam_date IS DISTINCT FROM v_claim_date
      OR v_result.runtime_unit_token IS DISTINCT FROM v_unit_token
      OR v_result.runtime_unit_vietnam_date IS DISTINCT FROM v_claim_date
      OR v_result.runtime_unit_claimed_at IS NULL
      OR v_result.runtime_unit_input_data_ids IS DISTINCT FROM
        ARRAY[v_input_data_id_1, v_input_data_id_2]::bigint[]
      OR (
        SELECT count(*)
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.id IN (v_input_data_id_1, v_input_data_id_2)
          AND input_data.status = 'đang chạy'
          AND input_data.date_action IS NOT NULL
      ) IS DISTINCT FROM 2::bigint
    THEN
      RAISE EXCEPTION 'v231_smoke: exact Desktop run unit was not claimed';
    END IF;

    SELECT jsonb_agg(to_jsonb(input_data) ORDER BY input_data.id)
    INTO v_input_before
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id IN (v_input_data_id_1, v_input_data_id_2);

    -- Both retry paths recover an already-committed ownership decision even
    -- after the configured boundary becomes due. No second claim is created.
    v_now := clock_timestamp();
    v_due_stop := timezone('Asia/Ho_Chi_Minh', v_now)::time;
    UPDATE public.auto_campaigns
    SET daily_stop_time = v_due_stop
    WHERE id = v_campaign_id;

    SELECT * INTO v_result
    FROM public.aka_agent_claim_campaign_runtime_v2(
      v_campaign_id,
      v_account_id,
      v_staff_id,
      'desktop',
      v_claim_token
    );

    IF v_result.ok IS DISTINCT FROM true
      OR v_result.reason IS DISTINCT FROM 'already_claimed'
      OR v_result.runtime_claim_token IS DISTINCT FROM v_claim_token
      OR v_result.runtime_claim_vietnam_date IS DISTINCT FROM v_claim_date
      OR v_result.runtime_claimed_at IS DISTINCT FROM v_claimed_at
      OR v_result.db_now < v_result.boundary_at
    THEN
      RAISE EXCEPTION
        'v231_smoke: same-token top-level retry did not recover ownership';
    END IF;

    SELECT * INTO v_result
    FROM public.aka_agent_claim_campaign_run_unit_v2(
      v_campaign_id,
      v_account_id,
      v_staff_id,
      'desktop',
      v_claim_token,
      v_claim_date,
      v_unit_token,
      ARRAY[v_input_data_id_2, v_input_data_id_1]::bigint[]
    );

    SELECT jsonb_agg(to_jsonb(input_data) ORDER BY input_data.id)
    INTO v_input_after
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.id IN (v_input_data_id_1, v_input_data_id_2);

    IF v_result.ok IS DISTINCT FROM true
      OR v_result.reason IS DISTINCT FROM 'already_claimed'
      OR v_result.claimed_count IS DISTINCT FROM 2
      OR v_result.runtime_claim_token IS DISTINCT FROM v_claim_token
      OR v_result.runtime_claim_vietnam_date IS DISTINCT FROM v_claim_date
      OR v_result.runtime_unit_token IS DISTINCT FROM v_unit_token
      OR v_result.runtime_unit_input_data_ids IS DISTINCT FROM
        ARRAY[v_input_data_id_1, v_input_data_id_2]::bigint[]
      OR v_result.db_now < v_result.boundary_at
      OR v_input_after IS DISTINCT FROM v_input_before
    THEN
      RAISE EXCEPTION
        'v231_smoke: exact run-unit retry was not idempotent';
    END IF;
  ELSE
    -- Fresh ownership is impossible at/after the drain, but committed-response
    -- recovery remains testable by seeding the state a prior transaction would
    -- have left behind. Exact top/unit retries must still return ownership.
    v_claim_date := timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date;
    v_claimed_at := clock_timestamp();
    UPDATE public.auto_campaigns
    SET status = 'đang chạy', daily_stop_time = NULL
    WHERE id = v_campaign_id;
    UPDATE public.auto_accounts
    SET status = 'đang chạy'
    WHERE id = v_account_id;
    UPDATE public.auto_campaigns
    SET runtime_claim_token = v_claim_token,
      runtime_claim_target = 'desktop',
      runtime_claim_vietnam_date = v_claim_date,
      runtime_claimed_at = v_claimed_at,
      runtime_unit_token = v_unit_token,
      runtime_unit_vietnam_date = v_claim_date,
      runtime_unit_claimed_at = v_claimed_at,
      runtime_unit_input_data_ids =
        ARRAY[v_input_data_id_1, v_input_data_id_2]::bigint[]
    WHERE id = v_campaign_id;

    SELECT * INTO v_result
    FROM public.aka_agent_claim_campaign_runtime_v2(
      v_campaign_id,
      v_account_id,
      v_staff_id,
      'desktop',
      v_claim_token
    );

    IF v_result.ok IS DISTINCT FROM true
      OR v_result.reason IS DISTINCT FROM 'already_claimed'
      OR v_result.runtime_claim_token IS DISTINCT FROM v_claim_token
      OR v_result.runtime_claim_vietnam_date IS DISTINCT FROM v_claim_date
      OR v_result.runtime_claimed_at IS DISTINCT FROM v_claimed_at
    THEN
      RAISE EXCEPTION
        'v231_smoke: post-boundary top-level retry did not recover ownership';
    END IF;

    UPDATE public.auto_campaign_input_data
    SET status = 'đang chạy', date_action = v_claimed_at
    WHERE id IN (v_input_data_id_1, v_input_data_id_2);

    SELECT * INTO v_result
    FROM public.aka_agent_claim_campaign_run_unit_v2(
      v_campaign_id,
      v_account_id,
      v_staff_id,
      'desktop',
      v_claim_token,
      v_claim_date,
      v_unit_token,
      ARRAY[v_input_data_id_2, v_input_data_id_1]::bigint[]
    );

    IF v_result.ok IS DISTINCT FROM true
      OR v_result.reason IS DISTINCT FROM 'already_claimed'
      OR v_result.claimed_count IS DISTINCT FROM 2
      OR v_result.runtime_claim_token IS DISTINCT FROM v_claim_token
      OR v_result.runtime_claim_vietnam_date IS DISTINCT FROM v_claim_date
      OR v_result.runtime_unit_token IS DISTINCT FROM v_unit_token
      OR v_result.runtime_unit_input_data_ids IS DISTINCT FROM
        ARRAY[v_input_data_id_1, v_input_data_id_2]::bigint[]
    THEN
      RAISE EXCEPTION
        'v231_smoke: post-boundary exact unit retry did not recover ownership';
    END IF;

    RAISE NOTICE
      'v231_smoke: fresh top/unit claims skipped near or after 23:59; retry recovery still verified';
  END IF;

  -- Normal settlement clears only the durable lease. It intentionally leaves
  -- input status untouched because the ordinary caller settles DB output first.
  SELECT * INTO v_result
  FROM public.aka_agent_settle_campaign_run_unit_v2(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_unit_token,
    false
  );

  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'settled'
    OR v_result.requeued_count IS DISTINCT FROM 0
    OR EXISTS (
      SELECT 1
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
        AND (
          campaign.runtime_unit_token IS NOT NULL
          OR campaign.runtime_unit_vietnam_date IS NOT NULL
          OR campaign.runtime_unit_claimed_at IS NOT NULL
          OR campaign.runtime_unit_input_data_ids IS NOT NULL
        )
    )
    OR (
      SELECT count(*)
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id IN (v_input_data_id_1, v_input_data_id_2)
        AND input_data.status = 'đang chạy'
    ) IS DISTINCT FROM 2::bigint
  THEN
    RAISE EXCEPTION 'v231_smoke: normal unit settlement mutated input state';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_settle_campaign_run_unit_v2(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_unit_token,
    false
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'already_settled'
    OR v_result.requeued_count IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION
      'v231_smoke: lost settlement response was not retry-idempotent';
  END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'chờ xử lý', date_action = NULL
  WHERE id IN (v_input_data_id_1, v_input_data_id_2);
  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý', daily_stop_time = NULL,
    schedule = v_schedule, original_schedule = v_original_schedule
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = v_account_id;

  -- Legacy callers remain able to claim after the mandatory v2 drain. Their
  -- pending-to-running status transition clears any stale v2 metadata.
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_stale_token,
    runtime_claim_target = 'desktop',
    runtime_claim_vietnam_date = v_yesterday,
    runtime_claimed_at = clock_timestamp()
  WHERE id = v_campaign_id;

  v_legacy_claimed := public.claim_campaign_runtime(
    v_campaign_id, v_account_id, v_staff_id, 'desktop'
  );

  SELECT campaign.status, campaign.runtime_claim_token,
    campaign.runtime_claim_target, campaign.runtime_claim_vietnam_date,
    campaign.runtime_claimed_at
  INTO v_campaign_status, v_stored_token, v_stored_target, v_stored_date,
    v_stored_claimed_at
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  SELECT account.status
  INTO v_account_status
  FROM public.auto_accounts AS account
  WHERE account.id = v_account_id;

  IF v_legacy_claimed IS DISTINCT FROM true
    OR v_campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_account_status IS DISTINCT FROM 'đang chạy'
    OR v_stored_token IS NOT NULL
    OR v_stored_target IS NOT NULL
    OR v_stored_date IS NOT NULL
    OR v_stored_claimed_at IS NOT NULL
  THEN
    RAISE EXCEPTION
      'v231_smoke: legacy claim compatibility/metadata cleanup failed';
  END IF;

  -- Desktop running -> paused clears its parent tuple/target so an ordinary
  -- resume cannot deadlock, while an active empty-ID unit lease remains
  -- recoverable by its stronger exact unit token until explicit settlement.
  v_today := timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_newer_token,
    runtime_claim_target = 'desktop',
    runtime_claim_vietnam_date = v_today,
    runtime_claimed_at = clock_timestamp(),
    runtime_unit_token = v_empty_unit_token,
    runtime_unit_vietnam_date = v_today,
    runtime_unit_claimed_at = clock_timestamp(),
    runtime_unit_input_data_ids = ARRAY[]::bigint[]
  WHERE id = v_campaign_id;
  UPDATE public.auto_campaigns
  SET status = 'tạm dừng'
  WHERE id = v_campaign_id;

  SELECT campaign.runtime_claim_token,
    campaign.runtime_claim_target,
    campaign.runtime_claim_vietnam_date,
    campaign.runtime_claimed_at,
    campaign.runtime_unit_token,
    campaign.runtime_unit_vietnam_date,
    campaign.runtime_unit_claimed_at,
    campaign.runtime_unit_input_data_ids
  INTO v_stored_token, v_stored_target, v_stored_date, v_stored_claimed_at,
    v_stored_unit_token, v_stored_unit_date,
    v_stored_unit_claimed_at, v_stored_unit_input_data_ids
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;

  IF v_stored_token IS NOT NULL
    OR v_stored_target IS NOT NULL
    OR v_stored_date IS NOT NULL
    OR v_stored_claimed_at IS NOT NULL
    OR v_stored_unit_token IS DISTINCT FROM v_empty_unit_token
    OR v_stored_unit_date IS DISTINCT FROM v_today
    OR v_stored_unit_claimed_at IS NULL
    OR v_stored_unit_input_data_ids IS DISTINCT FROM ARRAY[]::bigint[]
  THEN
    RAISE EXCEPTION
      'v231_smoke: Desktop pause did not separate cleared parent from durable unit ownership';
  END IF;

  UPDATE public.org_staff
  SET is_active = false
  WHERE id = v_staff_id;
  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_run_unit_v2(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_newer_token,
    v_today,
    v_empty_unit_token,
    ARRAY[]::bigint[]
  );

  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'already_claimed'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
    OR v_result.claimed_count IS DISTINCT FROM 0
    OR v_result.runtime_claim_token IS NOT NULL
    OR v_result.runtime_unit_token IS DISTINCT FROM v_empty_unit_token
    OR v_result.runtime_unit_input_data_ids IS DISTINCT FROM ARRAY[]::bigint[]
  THEN
    RAISE EXCEPTION
      'v231_smoke: cleared-parent/inactive-staff exact unit retry was not recovered';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_settle_campaign_run_unit_v2(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_empty_unit_token,
    true
  );

  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'requeued_unstarted'
    OR v_result.requeued_count IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION
      'v231_smoke: paused empty-ID unit lease did not settle';
  END IF;

  UPDATE public.org_staff
  SET is_active = true
  WHERE id = v_staff_id;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy', daily_stop_time = NULL
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy'
  WHERE id = v_account_id;

  -- NULL daily_stop_time always projects to 23:59. If midnight happens inside
  -- this smoke, vietnam_day_changed is the authoritative first reason.
  v_today := timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_newer_token,
    runtime_claim_target = 'desktop',
    runtime_claim_vietnam_date = v_today,
    runtime_claimed_at = clock_timestamp(),
    runtime_unit_token = v_newer_unit_token,
    runtime_unit_vietnam_date = v_today,
    runtime_unit_claimed_at = clock_timestamp(),
    runtime_unit_input_data_ids = ARRAY[v_input_data_id_1]::bigint[]
  WHERE id = v_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_check_campaign_daily_boundary(
    v_campaign_id, v_account_id, v_staff_id, 'desktop', v_today
  );

  IF v_result.effective_stop_time IS DISTINCT FROM time '23:59:00'
    OR timezone('Asia/Ho_Chi_Minh', v_result.boundary_at)::date
      IS DISTINCT FROM v_today
    OR timezone('Asia/Ho_Chi_Minh', v_result.boundary_at)::time
      IS DISTINCT FROM time '23:59:00'
    OR (
      v_result.day_changed
      AND (
        v_result.allow_new_unit IS DISTINCT FROM false
        OR v_result.reason IS DISTINCT FROM 'vietnam_day_changed'
      )
    )
    OR (
      NOT v_result.day_changed
      AND v_result.db_now >= v_result.boundary_at
      AND (
        v_result.allow_new_unit IS DISTINCT FROM false
        OR v_result.reason IS DISTINCT FROM 'daily_drain_due'
      )
    )
    OR (
      NOT v_result.day_changed
      AND v_result.db_now < v_result.boundary_at
      AND (
        v_result.allow_new_unit IS DISTINCT FROM true
        OR v_result.reason IS DISTINCT FROM 'allowed'
      )
    )
  THEN
    RAISE EXCEPTION 'v231_smoke: NULL daily stop did not resolve to 23:59';
  END IF;

  -- Capture a configured cutoff from an earlier DB-clock sample. If this exact
  -- sample crosses midnight, refresh once using the date returned by the RPC.
  v_now := clock_timestamp();
  v_today := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_due_stop := LEAST(
    timezone('Asia/Ho_Chi_Minh', v_now)::time,
    time '23:59:00'
  );
  UPDATE public.auto_campaigns
  SET daily_stop_time = v_due_stop,
    runtime_claim_vietnam_date = v_today,
    runtime_claimed_at = v_now
  WHERE id = v_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_check_campaign_daily_boundary(
    v_campaign_id, v_account_id, v_staff_id, 'desktop', v_today
  );

  IF v_result.reason = 'vietnam_day_changed' THEN
    v_now := clock_timestamp();
    v_today := timezone('Asia/Ho_Chi_Minh', v_now)::date;
    v_due_stop := LEAST(
      timezone('Asia/Ho_Chi_Minh', v_now)::time,
      time '23:59:00'
    );
    UPDATE public.auto_campaigns
    SET daily_stop_time = v_due_stop,
      runtime_claim_vietnam_date = v_today,
      runtime_claimed_at = v_now
    WHERE id = v_campaign_id;

    SELECT * INTO v_result
    FROM public.aka_agent_check_campaign_daily_boundary(
      v_campaign_id, v_account_id, v_staff_id, 'desktop', v_today
    );
  END IF;

  IF v_result.allow_new_unit IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'daily_stop_due'
    OR v_result.effective_stop_time IS DISTINCT FROM v_due_stop
    OR v_result.db_now < v_result.boundary_at
  THEN
    RAISE EXCEPTION 'v231_smoke: configured inclusive cutoff was not enforced';
  END IF;

  -- A boundary yield is legal only after the current durable unit has reached
  -- its explicit settlement point. This synthetic unit owns no running input,
  -- so normal settlement clears only the lease before the parent is yielded.
  SELECT * INTO v_result
  FROM public.aka_agent_settle_campaign_run_unit_v2(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_newer_unit_token,
    false
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'settled'
  THEN
    RAISE EXCEPTION
      'v231_smoke: boundary fixture unit did not settle before yield';
  END IF;

  SELECT jsonb_agg(to_jsonb(input_data) ORDER BY input_data.id)
  INTO v_input_before
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.id IN (v_input_data_id_1, v_input_data_id_2);

  SELECT * INTO v_result
  FROM public.aka_agent_yield_campaign_daily_boundary(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_newer_token,
    v_today
  );

  SELECT jsonb_agg(to_jsonb(input_data) ORDER BY input_data.id)
  INTO v_input_after
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.id IN (v_input_data_id_1, v_input_data_id_2);
  SELECT campaign.status, campaign.runtime_claim_token,
    campaign.runtime_claim_vietnam_date, campaign.runtime_claimed_at
  INTO v_campaign_status, v_stored_token, v_stored_date, v_stored_claimed_at
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  SELECT account.status
  INTO v_account_status
  FROM public.auto_accounts AS account
  WHERE account.id = v_account_id;

  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason NOT IN (
      'yielded_daily_stop_due',
      'yielded_vietnam_day_changed'
    )
    OR v_result.running_input_count IS DISTINCT FROM 0::bigint
    OR v_campaign_status IS DISTINCT FROM 'chờ xử lý'
    OR v_account_status IS DISTINCT FROM 'chờ xử lý'
    OR v_stored_token IS NOT NULL
    OR v_stored_date IS NOT NULL
    OR v_stored_claimed_at IS NOT NULL
    OR v_input_after IS DISTINCT FROM v_input_before
    OR (
      SELECT campaign.schedule
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
    ) IS DISTINCT FROM v_schedule
    OR (
      SELECT campaign.original_schedule
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
    ) IS DISTINCT FROM v_original_schedule
  THEN
    RAISE EXCEPTION
      'v231_smoke: tokenized boundary yield did not preserve campaign/input state: result=%, campaign=%, account=%, parent=(%,%,%), input_equal=%, schedule=%, expected_schedule=%, original=%, expected_original=%',
      to_jsonb(v_result),
      v_campaign_status,
      v_account_status,
      v_stored_token,
      v_stored_date,
      v_stored_claimed_at,
      v_input_after IS NOT DISTINCT FROM v_input_before,
      (SELECT campaign.schedule FROM public.auto_campaigns AS campaign
       WHERE campaign.id = v_campaign_id),
      v_schedule,
      (SELECT campaign.original_schedule FROM public.auto_campaigns AS campaign
       WHERE campaign.id = v_campaign_id),
      v_original_schedule;
  END IF;

  -- A stale token must not classify a newer running input as its retry, change
  -- that input, or release the newer campaign/account ownership.
  v_today := timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date;
  UPDATE public.auto_campaigns
  SET status = 'đang chạy', daily_stop_time = NULL
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy'
  WHERE id = v_account_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_newer_token,
    runtime_claim_target = 'desktop',
    runtime_claim_vietnam_date = v_today,
    runtime_claimed_at = clock_timestamp(),
    runtime_unit_token = v_newer_unit_token,
    runtime_unit_vietnam_date = v_today,
    runtime_unit_claimed_at = clock_timestamp(),
    runtime_unit_input_data_ids = ARRAY[v_input_data_id_1]::bigint[]
  WHERE id = v_campaign_id;
  UPDATE public.auto_campaign_input_data
  SET status = 'đang chạy',
    date_action = timestamptz '2001-02-03 04:05:06+00'
  WHERE id = v_input_data_id_1;

  SELECT to_jsonb(input_data)
  INTO v_input_before
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.id = v_input_data_id_1;

  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_runtime_v2(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_stale_token
  );

  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'unit_lease_busy'
    OR (
      SELECT campaign.runtime_claim_token
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
    ) IS DISTINCT FROM v_newer_token
  THEN
    RAISE EXCEPTION
      'v231_smoke: a new parent claim crossed an active unit lease';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_claim_campaign_run_unit_v2(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_newer_token,
    v_today,
    v_stale_unit_token,
    ARRAY[v_input_data_id_1]::bigint[]
  );

  SELECT to_jsonb(input_data)
  INTO v_input_after
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.id = v_input_data_id_1;

  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'unit_lease_busy'
    OR v_result.claimed_count IS DISTINCT FROM 0
    OR v_result.runtime_unit_token IS DISTINCT FROM v_newer_unit_token
    OR v_input_after IS DISTINCT FROM v_input_before
    OR (
      SELECT campaign.runtime_claim_token
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
    ) IS DISTINCT FROM v_newer_token
  THEN
    RAISE EXCEPTION
      'v231_smoke: stale unit claim acted on a newer running unit';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_settle_campaign_run_unit_v2(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_stale_unit_token,
    true
  );

  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'unit_lease_mismatch'
    OR v_result.requeued_count IS DISTINCT FROM 0
  THEN
    RAISE EXCEPTION
      'v231_smoke: stale settlement cleared a newer unit lease';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_yield_campaign_daily_boundary(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_stale_token,
    v_today
  );

  SELECT to_jsonb(input_data)
  INTO v_input_after
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.id = v_input_data_id_1;
  SELECT campaign.status, campaign.runtime_claim_token,
    campaign.runtime_claim_vietnam_date
  INTO v_campaign_status, v_stored_token, v_stored_date
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  SELECT account.status
  INTO v_account_status
  FROM public.auto_accounts AS account
  WHERE account.id = v_account_id;

  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'unit_still_running'
    OR v_result.running_input_count IS DISTINCT FROM 1::bigint
    OR v_campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_account_status IS DISTINCT FROM 'đang chạy'
    OR v_stored_token IS DISTINCT FROM v_newer_token
    OR v_stored_date IS DISTINCT FROM v_today
    OR v_input_after IS DISTINCT FROM v_input_before
  THEN
    RAISE EXCEPTION
      'v231_smoke: stale yield acted on a newer running unit';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_settle_campaign_run_unit_v2(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_newer_unit_token,
    true
  );

  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'requeued_unstarted'
    OR v_result.requeued_count IS DISTINCT FROM 1
    OR (
      SELECT input_data.status
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = v_input_data_id_1
    ) IS DISTINCT FROM 'chờ xử lý'
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
        AND campaign.runtime_unit_token IS NOT NULL
    )
  THEN
    RAISE EXCEPTION
      'v231_smoke: exact requeue-unstarted settlement was not isolated';
  END IF;

  -- Manual campaign pause wins before token mismatch and is never overwritten.
  UPDATE public.auto_campaigns
  SET status = 'tạm dừng'
  WHERE id = v_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_yield_campaign_daily_boundary(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_newer_token,
    v_today
  );

  SELECT campaign.status, campaign.runtime_claim_token,
    campaign.runtime_claim_target, campaign.runtime_claim_vietnam_date,
    campaign.runtime_claimed_at
  INTO v_campaign_status, v_stored_token, v_stored_target, v_stored_date,
    v_stored_claimed_at
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  SELECT status INTO v_account_status
  FROM public.auto_accounts
  WHERE id = v_account_id;

  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'runtime_control_paused'
    OR v_campaign_status IS DISTINCT FROM 'tạm dừng'
    OR v_account_status IS DISTINCT FROM 'đang chạy'
    OR v_stored_token IS NOT NULL
    OR v_stored_target IS NOT NULL
    OR v_stored_date IS NOT NULL
    OR v_stored_claimed_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'v231_smoke: manual campaign pause did not win CAS';
  END IF;

  -- completeCampaignPause releases the Desktop account before renderer resume.
  -- With no unit lease left, the cleared parent tuple must allow the existing
  -- Desktop control RPC to resume this paused campaign normally.
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = v_account_id;
  SELECT * INTO v_result
  FROM public.aka_agent_set_desktop_campaign_status_v2(
    v_campaign_id, v_account_id, v_staff_id, 'chờ xử lý'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
    OR v_result.campaign_status IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION
      'v231_smoke: Desktop soft pause left a parent token blocking resume';
  END IF;

  -- The same control rule applies when the account itself was paused. Campaign
  -- ownership remains untouched because no campaign status transition occurs.
  UPDATE public.auto_campaigns
  SET status = 'đang chạy'
  WHERE id = v_campaign_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_newer_token,
    runtime_claim_target = 'desktop',
    runtime_claim_vietnam_date = v_today,
    runtime_claimed_at = clock_timestamp()
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'tạm dừng'
  WHERE id = v_account_id;

  SELECT * INTO v_result
  FROM public.aka_agent_yield_campaign_daily_boundary(
    v_campaign_id,
    v_account_id,
    v_staff_id,
    'desktop',
    v_newer_token,
    v_today
  );

  SELECT campaign.status, campaign.runtime_claim_token
  INTO v_campaign_status, v_stored_token
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = v_campaign_id;
  SELECT account.status
  INTO v_account_status
  FROM public.auto_accounts AS account
  WHERE account.id = v_account_id;

  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'runtime_control_paused'
    OR v_campaign_status IS DISTINCT FROM 'đang chạy'
    OR v_account_status IS DISTINCT FROM 'tạm dừng'
    OR v_stored_token IS DISTINCT FROM v_newer_token
  THEN
    RAISE EXCEPTION 'v231_smoke: manual account pause did not win CAS';
  END IF;

  -- Desktop pause/resume is one locked CAS, so renderer read/update races can
  -- neither pause a newly claimed runtime nor resume across an active lease.
  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý'
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = v_account_id;

  SELECT * INTO v_result
  FROM public.aka_agent_set_desktop_campaign_status_v2(
    v_campaign_id, v_account_id, v_staff_id, 'tạm dừng'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
  THEN
    RAISE EXCEPTION 'v231_smoke: Desktop pause CAS failed';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_set_desktop_campaign_status_v2(
    v_campaign_id, v_account_id, v_staff_id, 'chờ xử lý'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'updated'
    OR v_result.campaign_status IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION 'v231_smoke: Desktop resume CAS failed';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_set_desktop_campaign_status_v2(
    v_campaign_id, v_account_id, v_staff_id, 'chờ xử lý'
  );
  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'invalid_transition'
    OR v_result.campaign_status IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION 'v231_smoke: duplicate resume was not rejected';
  END IF;

  UPDATE public.auto_campaigns
  SET status = 'đang chạy'
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy'
  WHERE id = v_account_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_newer_token,
    runtime_claim_target = 'desktop',
    runtime_claim_vietnam_date = v_today,
    runtime_claimed_at = clock_timestamp()
  WHERE id = v_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_set_desktop_campaign_status_v2(
    v_campaign_id, v_account_id, v_staff_id, 'tạm dừng'
  );
  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'runtime_busy'
    OR v_result.campaign_status IS DISTINCT FROM 'đang chạy'
    OR (
      SELECT campaign.runtime_claim_token
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
    ) IS DISTINCT FROM v_newer_token
  THEN
    RAISE EXCEPTION 'v231_smoke: pause CAS overwrote a new runtime claim';
  END IF;

  UPDATE public.auto_campaigns
  SET status = 'tạm dừng'
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = v_account_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = NULL,
    runtime_claim_target = NULL,
    runtime_claim_vietnam_date = NULL,
    runtime_claimed_at = NULL,
    runtime_unit_token = v_empty_unit_token,
    runtime_unit_vietnam_date = v_today,
    runtime_unit_claimed_at = clock_timestamp(),
    runtime_unit_input_data_ids = ARRAY[]::bigint[]
  WHERE id = v_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_set_desktop_campaign_status_v2(
    v_campaign_id, v_account_id, v_staff_id, 'chờ xử lý'
  );
  IF v_result.ok IS DISTINCT FROM false
    OR v_result.reason IS DISTINCT FROM 'unit_lease_busy'
    OR v_result.campaign_status IS DISTINCT FROM 'tạm dừng'
  THEN
    RAISE EXCEPTION 'v231_smoke: resume crossed an active unit lease';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_settle_campaign_run_unit_v2(
    v_campaign_id, v_account_id, v_staff_id,
    'desktop', v_empty_unit_token, false
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'settled'
  THEN
    RAISE EXCEPTION 'v231_smoke: control fixture lease did not settle';
  END IF;

  -- The maintenance barrier classifies a v2 run by its immutable claim date,
  -- even after schedule maintenance has moved schedule into the future.
  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý'
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = v_account_id;

  v_now := clock_timestamp();
  v_today := timezone('Asia/Ho_Chi_Minh', v_now)::date;
  v_yesterday := v_today - 1;
  UPDATE public.auto_campaigns
  SET status = 'đang chạy'
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy'
  WHERE id = v_account_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_newer_token,
    runtime_claim_target = 'desktop',
    runtime_claim_vietnam_date = v_yesterday,
    runtime_claimed_at = v_now,
    schedule = (
      (v_today + 2) + time '12:00:00'
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh'
  WHERE id = v_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_check_daily_maintenance_barrier(
    v_staff_id, 'desktop', v_today
  );

  IF v_result.vietnam_date_key IS DISTINCT FROM v_today THEN
    v_today := v_result.vietnam_date_key;
    v_yesterday := v_today - 1;
    UPDATE public.auto_campaigns
    SET runtime_claim_vietnam_date = v_yesterday,
      schedule = (
        (v_today + 2) + time '12:00:00'
      ) AT TIME ZONE 'Asia/Ho_Chi_Minh'
    WHERE id = v_campaign_id;

    SELECT * INTO v_result
    FROM public.aka_agent_check_daily_maintenance_barrier(
      v_staff_id, 'desktop', v_today
    );
  END IF;

  IF v_result.ready IS DISTINCT FROM false
    OR v_result.running_campaign_count IS DISTINCT FROM 1::bigint
    OR v_result.vietnam_date_key IS DISTINCT FROM v_today
  THEN
    RAISE EXCEPTION
      'v231_smoke: immutable old run date did not close maintenance barrier';
  END IF;

  -- A current non-NULL run date suppresses the legacy stale-schedule fallback.
  UPDATE public.auto_campaigns
  SET runtime_claim_vietnam_date = v_today,
    schedule = (
      (v_today - 1) + time '12:00:00'
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh'
  WHERE id = v_campaign_id;

  SELECT * INTO v_result
  FROM public.aka_agent_check_daily_maintenance_barrier(
    v_staff_id, 'desktop', v_today
  );

  IF v_result.ready IS DISTINCT FROM true
    OR v_result.running_campaign_count IS DISTINCT FROM 0::bigint
  THEN
    RAISE EXCEPTION
      'v231_smoke: barrier consulted schedule for a current v2 run';
  END IF;

  -- Unit lease date, not visible campaign status, is authoritative while a
  -- 23:58 unit drains beyond midnight or a DB-first pause wins concurrently.
  UPDATE public.auto_campaigns
  SET status = 'tạm dừng'
  WHERE id = v_campaign_id;
  UPDATE public.auto_campaigns
  SET runtime_unit_token = v_newer_unit_token,
    runtime_unit_vietnam_date = v_yesterday,
    runtime_unit_claimed_at = v_now,
    runtime_unit_input_data_ids = ARRAY[v_input_data_id_1]::bigint[],
    schedule = (
      (v_today + 2) + time '12:00:00'
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh'
  WHERE id = v_campaign_id;
  UPDATE public.auto_campaign_input_data
  SET status = 'đang chạy', date_action = v_now
  WHERE id = v_input_data_id_1;

  SELECT * INTO v_result
  FROM public.aka_agent_check_daily_maintenance_barrier(
    v_staff_id, 'desktop', v_today
  );
  IF v_result.ready IS DISTINCT FROM false
    OR v_result.running_campaign_count IS DISTINCT FROM 1::bigint
  THEN
    RAISE EXCEPTION
      'v231_smoke: paused old-day unit lease did not close maintenance barrier';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_settle_campaign_run_unit_v2(
    v_campaign_id, v_account_id, v_staff_id,
    'desktop', v_newer_unit_token, true
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'requeued_unstarted'
    OR v_result.requeued_count IS DISTINCT FROM 1
  THEN
    RAISE EXCEPTION
      'v231_smoke: paused old-day unit lease did not settle';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_check_daily_maintenance_barrier(
    v_staff_id, 'desktop', v_today
  );
  IF v_result.ready IS DISTINCT FROM true
    OR v_result.running_campaign_count IS DISTINCT FROM 0::bigint
  THEN
    RAISE EXCEPTION
      'v231_smoke: settled paused lease did not open maintenance barrier';
  END IF;

  -- Startup recovery is token-agnostic only within this staff/runtime owner
  -- and requeues exactly the IDs stored by each durable lease.
  UPDATE public.auto_campaigns
  SET runtime_unit_token = v_unit_token,
    runtime_unit_vietnam_date = v_yesterday,
    runtime_unit_claimed_at = v_now,
    runtime_unit_input_data_ids = ARRAY[v_input_data_id_2]::bigint[]
  WHERE id = v_campaign_id;
  UPDATE public.auto_campaign_input_data
  SET status = 'đang chạy', date_action = v_now
  WHERE id = v_input_data_id_2;
  UPDATE public.auto_campaign_input_data
  SET status = 'đang chạy',
    date_action = timestamptz '2002-03-04 05:06:07+00'
  WHERE id = v_input_data_id_1;

  -- Reuse the Zalo fixture as a Desktop-owned QR account so this scoped call
  -- also proves the positive handoff path while the Facebook lease above is
  -- still live. The Server subtype is restored immediately after recovery.
  UPDATE public.auto_accounts
  SET is_zalo_server = false
  WHERE id = v_server_account_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = NULL,
    runtime_claim_target = NULL,
    runtime_claim_vietnam_date = NULL,
    runtime_claimed_at = NULL,
    runtime_unit_token = v_newer_unit_token,
    runtime_unit_vietnam_date = v_yesterday,
    runtime_unit_claimed_at = v_now,
    runtime_unit_input_data_ids = ARRAY[v_server_input_data_id]::bigint[]
  WHERE id = v_server_campaign_id;
  UPDATE public.auto_campaign_input_data
  SET status = 'đang chạy', date_action = v_now
  WHERE id = v_server_input_data_id;

  -- Server -> Desktop handoff proves only the Zalo scheduler idle. Its scoped
  -- recovery must clear the Zalo Desktop lease without touching/requeueing the
  -- still-live Facebook Desktop lease.
  SELECT * INTO v_result
  FROM public.aka_agent_recover_campaign_runtime_unit_leases(
    v_staff_id, 'desktop', 'zalo'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'recovered'
    OR v_result.recovered_lease_count IS DISTINCT FROM 1::bigint
    OR v_result.requeued_input_count IS DISTINCT FROM 1::bigint
    OR (
      SELECT campaign.runtime_unit_token
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
    ) IS DISTINCT FROM v_unit_token
    OR (
      SELECT input_data.status
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = v_input_data_id_2
    ) IS DISTINCT FROM 'đang chạy'
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_server_campaign_id
        AND campaign.runtime_unit_token IS NOT NULL
    )
    OR (
      SELECT input_data.status
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = v_server_input_data_id
    ) IS DISTINCT FROM 'chờ xử lý'
  THEN
    RAISE EXCEPTION
      'v231_smoke: Zalo-scoped Desktop recovery crossed platform scope';
  END IF;

  UPDATE public.auto_accounts
  SET is_zalo_server = true
  WHERE id = v_server_account_id;

  -- The unchanged two-argument call defaults to broad startup/quit recovery.
  SELECT * INTO v_result
  FROM public.aka_agent_recover_campaign_runtime_unit_leases(
    v_staff_id, 'desktop'
  );
  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'recovered'
    OR v_result.recovered_lease_count IS DISTINCT FROM 1::bigint
    OR v_result.requeued_input_count IS DISTINCT FROM 1::bigint
    OR (
      SELECT input_data.status
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = v_input_data_id_2
    ) IS DISTINCT FROM 'chờ xử lý'
    OR (
      SELECT jsonb_build_object(
        'status', input_data.status,
        'date_action', input_data.date_action
      )
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = v_input_data_id_1
    ) IS DISTINCT FROM jsonb_build_object(
      'status', 'đang chạy',
      'date_action', timestamptz '2002-03-04 05:06:07+00'
    )
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
        AND campaign.runtime_unit_token IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'v231_smoke: startup unit-lease recovery failed';
  END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'chờ xử lý', date_action = NULL
  WHERE id = v_input_data_id_1;

  -- A legacy NULL-date running row still uses the old stale-schedule heuristic.
  UPDATE public.auto_campaigns
  SET status = 'đang chạy',
    runtime_claim_token = NULL,
    runtime_claim_target = NULL,
    runtime_claim_vietnam_date = NULL,
    runtime_claimed_at = NULL,
    schedule = (
      (v_today - 1) + time '12:00:00'
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh'
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'đang chạy'
  WHERE id = v_account_id;

  SELECT * INTO v_result
  FROM public.aka_agent_check_daily_maintenance_barrier(
    v_staff_id, 'desktop', v_today
  );

  IF v_result.ready IS DISTINCT FROM false
    OR v_result.running_campaign_count IS DISTINCT FROM 1::bigint
  THEN
    RAISE EXCEPTION
      'v231_smoke: legacy stale schedule no longer closes maintenance barrier';
  END IF;

  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý'
  WHERE id = v_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = v_account_id;

  SELECT * INTO v_result
  FROM public.aka_agent_check_daily_maintenance_barrier(
    v_staff_id, 'desktop', v_today
  );

  IF v_result.ready IS DISTINCT FROM true
    OR v_result.running_campaign_count IS DISTINCT FROM 0::bigint
  THEN
    RAISE EXCEPTION
      'v231_smoke: settled campaign did not open maintenance barrier';
  END IF;

  -- Rehearse the exact production startup order. Existing platform recovery
  -- first applies its established uncertainty/no-retry policy and resets the
  -- visible runtime rows; durable-lease recovery then clears only the lease.
  -- It must not resurrect a terminal uncertain input into a duplicate retry.
  UPDATE public.auto_accounts
  SET status = 'đang chạy'
  WHERE id = v_account_id;
  UPDATE public.auto_campaigns
  SET status = 'đang chạy'
  WHERE id = v_campaign_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_newer_token,
    runtime_claim_target = 'desktop',
    runtime_claim_vietnam_date = v_today,
    runtime_claimed_at = clock_timestamp(),
    runtime_unit_token = v_unit_token,
    runtime_unit_vietnam_date = v_today,
    runtime_unit_claimed_at = clock_timestamp(),
    runtime_unit_input_data_ids = ARRAY[v_input_data_id_1]::bigint[]
  WHERE id = v_campaign_id;
  UPDATE public.auto_campaign_input_data
  SET status = 'đang chạy', note = '__v231_desktop_recovery__',
    date_action = clock_timestamp()
  WHERE id = v_input_data_id_1;

  PERFORM public.reset_desktop_running_statuses_no_retry(
    v_staff_id, false, true
  );
  SELECT * INTO v_result
  FROM public.aka_agent_recover_campaign_runtime_unit_leases(
    v_staff_id, 'desktop'
  );

  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'recovered'
    OR v_result.recovered_lease_count IS DISTINCT FROM 1::bigint
    OR v_result.requeued_input_count IS DISTINCT FROM 0::bigint
    OR (
      SELECT jsonb_build_object(
        'status', input_data.status,
        'note', input_data.note
      )
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = v_input_data_id_1
    ) IS DISTINCT FROM jsonb_build_object(
      'status', 'hoàn thành',
      'note', v_interrupted_note
    )
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_campaign_id
        AND (
          campaign.runtime_unit_token IS NOT NULL
          OR campaign.runtime_unit_vietnam_date IS NOT NULL
          OR campaign.runtime_unit_claimed_at IS NOT NULL
          OR campaign.runtime_unit_input_data_ids IS NOT NULL
        )
    )
  THEN
    RAISE EXCEPTION
      'v231_smoke: Desktop startup recovery order changed uncertainty safety';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_check_daily_maintenance_barrier(
    v_staff_id, 'desktop', v_today
  );
  IF v_result.ready IS DISTINCT FROM true
    OR v_result.running_campaign_count IS DISTINCT FROM 0::bigint
  THEN
    RAISE EXCEPTION
      'v231_smoke: Desktop shutdown recovery left maintenance closed';
  END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'chờ xử lý', note = '__v231_preserve_input_1__',
    date_action = NULL
  WHERE id = v_input_data_id_1;
  UPDATE public.auto_accounts
  SET status = 'đang chạy'
  WHERE id = v_server_account_id;
  UPDATE public.auto_campaigns
  SET status = 'đang chạy'
  WHERE id = v_server_campaign_id;
  UPDATE public.auto_campaigns
  SET runtime_claim_token = v_newer_token,
    runtime_claim_target = 'server',
    runtime_claim_vietnam_date = v_today,
    runtime_claimed_at = clock_timestamp(),
    runtime_unit_token = v_newer_unit_token,
    runtime_unit_vietnam_date = v_today,
    runtime_unit_claimed_at = clock_timestamp(),
    runtime_unit_input_data_ids = ARRAY[v_server_input_data_id]::bigint[]
  WHERE id = v_server_campaign_id;
  UPDATE public.auto_campaign_input_data
  SET status = 'đang chạy', note = '__v231_server_recovery__',
    date_action = clock_timestamp()
  WHERE id = v_server_input_data_id;

  PERFORM public.recover_server_zalo_running_state(
    v_staff_id, NULL::text, false
  );
  SELECT * INTO v_result
  FROM public.aka_agent_recover_campaign_runtime_unit_leases(
    v_staff_id, 'server'
  );

  IF v_result.ok IS DISTINCT FROM true
    OR v_result.reason IS DISTINCT FROM 'recovered'
    OR v_result.recovered_lease_count IS DISTINCT FROM 1::bigint
    OR v_result.requeued_input_count IS DISTINCT FROM 0::bigint
    OR (
      SELECT jsonb_build_object(
        'status', input_data.status,
        'note', input_data.note
      )
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.id = v_server_input_data_id
    ) IS DISTINCT FROM jsonb_build_object(
      'status', 'hoàn thành',
      'note', v_interrupted_note
    )
    OR EXISTS (
      SELECT 1 FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_server_campaign_id
        AND (
          campaign.runtime_unit_token IS NOT NULL
          OR campaign.runtime_unit_vietnam_date IS NOT NULL
          OR campaign.runtime_unit_claimed_at IS NOT NULL
          OR campaign.runtime_unit_input_data_ids IS NOT NULL
        )
    )
  THEN
    RAISE EXCEPTION
      'v231_smoke: Server startup recovery order changed uncertainty safety';
  END IF;

  SELECT * INTO v_result
  FROM public.aka_agent_check_daily_maintenance_barrier(
    v_staff_id, 'server', v_today
  );
  IF v_result.ready IS DISTINCT FROM true
    OR v_result.running_campaign_count IS DISTINCT FROM 0::bigint
  THEN
    RAISE EXCEPTION
      'v231_smoke: Server stop/handoff recovery left maintenance closed';
  END IF;

  UPDATE public.auto_campaign_input_data
  SET status = 'chờ xử lý', note = '__v231_preserve_server_input__',
    date_action = NULL
  WHERE id = v_server_input_data_id;
  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý'
  WHERE id = v_server_campaign_id;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = v_server_account_id;
  UPDATE public.auto_accounts
  SET status = 'chờ xử lý'
  WHERE id = v_account_id;

  SELECT * INTO v_result
  FROM public.aka_agent_check_daily_maintenance_barrier(
    v_staff_id, 'desktop', v_yesterday
  );

  IF v_result.ready IS DISTINCT FROM false
    OR v_result.running_campaign_count IS DISTINCT FROM 0::bigint
  THEN
    RAISE EXCEPTION
      'v231_smoke: stale caller date opened maintenance barrier';
  END IF;
END;
$behavior$;

ROLLBACK;
