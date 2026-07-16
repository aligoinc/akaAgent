-- Rollback smoke test for migration_v176_automation_target_data_schedule.sql.
--
-- Run only after migration v176 has been applied. The harness deliberately
-- chooses a tenant that has no non-deleted automation rules, acquires the same
-- tenant advisory lock used by the save RPC, creates marker-prefixed fixtures,
-- runs all assertions, and rolls every write back.
--
-- Safety notes:
--   * claim_auto_automation_details is called only after verifying that the
--     selected tenant has exactly one eligible execution and that it belongs
--     to this smoke-test marker.
--   * no usernames, passwords, customer data, or service-role keys are read.
--   * PostgreSQL identity sequences are non-transactional, so their numeric
--     values may advance even though every inserted row is rolled back.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';

-- The RPC identity guard accepts the request claim used by service-side SQL.
-- This is transaction-local and is discarded by ROLLBACK.
SELECT set_config('request.jwt.claim.role', 'service_role', true);

-- ---------------------------------------------------------------------------
-- Migration/RPC shape preflight
-- ---------------------------------------------------------------------------

DO $preflight$
DECLARE
  v_function_count integer;
  v_argument_count integer;
  v_default_count integer;
BEGIN
  SELECT
    count(*)::integer,
    min(proc.pronargs)::integer,
    min(proc.pronargdefaults)::integer
  INTO
    v_function_count,
    v_argument_count,
    v_default_count
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'aka_agent_save_automation';

  IF v_function_count <> 1
    OR v_argument_count <> 20
    OR v_default_count <> 5 THEN
    RAISE EXCEPTION
      'v176_smoke: save RPC overload/signature mismatch (count %, args %, defaults %)',
      v_function_count,
      v_argument_count,
      v_default_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_automation'
      AND column_name = 'delay_value'
      AND data_type = 'integer'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_automation'
      AND column_name = 'delay_unit'
      AND data_type = 'text'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_automation'
      AND column_name = 'daily_time'
      AND data_type = 'time without time zone'
  ) THEN
    RAISE EXCEPTION 'v176_smoke: canonical schedule columns are missing';
  END IF;

  IF to_regprocedure(
    'public.claim_auto_automation_details(bigint,bigint,text,integer,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v176_smoke: claim RPC is missing';
  END IF;

  IF to_regprocedure(
    'public.materialize_auto_automation_detail(bigint,bigint,bigint,text,jsonb,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'v176_smoke: materialize RPC is missing';
  END IF;
END;
$preflight$;

-- ---------------------------------------------------------------------------
-- Isolated fixture context
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE v176_smoke_context (
  marker text PRIMARY KEY,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  account_id bigint NOT NULL,
  action_id text NOT NULL,
  source_campaign_id bigint
) ON COMMIT DROP;

INSERT INTO pg_temp.v176_smoke_context (
  marker,
  staff_id,
  organization_id,
  account_id,
  action_id
)
SELECT
  '__codex_v176_rollback_smoke__',
  campaign.staff_id,
  campaign.organization_id,
  campaign.account_id,
  campaign.action_id
FROM public.auto_campaigns AS campaign
JOIN public.org_staff AS staff
  ON staff.id = campaign.staff_id
 AND staff.organization_id = campaign.organization_id
 AND staff.is_active = true
JOIN public.auto_accounts AS account
  ON account.id = campaign.account_id
 AND account.staff_id = campaign.staff_id
 AND account.organization_id = campaign.organization_id
 AND COALESCE(account.is_delete, false) = false
JOIN public.auto_campaign_actions AS campaign_action
  ON campaign_action.id = campaign.action_id
 AND campaign_action.is_active = true
 AND COALESCE(campaign_action.is_delete, false) = false
JOIN public.auto_campaign_action_data_types AS source_mapping
  ON source_mapping.campaign_action_id = campaign.action_id
 AND source_mapping.data_type_code = 'phone'
 AND source_mapping.can_source = true
 AND source_mapping.is_active = true
 AND source_mapping.is_delete = false
JOIN public.auto_campaign_action_data_types AS target_mapping
  ON target_mapping.campaign_action_id = campaign.action_id
 AND target_mapping.data_type_code = 'phone'
 AND target_mapping.can_target = true
 AND target_mapping.is_active = true
 AND target_mapping.is_delete = false
WHERE COALESCE(campaign.is_delete, false) = false
  AND campaign.action_id <> 'sms_send'
  AND NOT EXISTS (
    SELECT 1
    FROM public.auto_automation AS automation
    WHERE automation.staff_id = campaign.staff_id
      AND automation.organization_id = campaign.organization_id
      AND automation.is_delete = false
  )
ORDER BY campaign.staff_id, campaign.organization_id, campaign.id
LIMIT 1;

DO $isolation$
DECLARE
  v_context record;
  v_source_campaign_id bigint;
BEGIN
  SELECT *
  INTO v_context
  FROM pg_temp.v176_smoke_context;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'v176_smoke: no isolated tenant with a bidirectional phone action is available';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_automation AS automation
    WHERE left(automation.name, length(v_context.marker)) = v_context.marker
  ) OR EXISTS (
    SELECT 1
    FROM public.auto_campaigns AS campaign
    WHERE left(campaign.name, length(v_context.marker)) = v_context.marker
  ) THEN
    RAISE EXCEPTION 'v176_smoke: marker rows already exist before the test';
  END IF;

  -- Do not wait behind a real automation edit. The save RPC uses this exact
  -- advisory-lock key, so holding it prevents a new RPC-created rule from
  -- entering the selected tenant while the harness is claiming work.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'auto_automation_graph:'
      || v_context.staff_id::text
      || ':'
      || v_context.organization_id::text,
    0
  )) THEN
    RAISE EXCEPTION 'v176_smoke: selected tenant automation graph is busy';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.auto_automation AS automation
    WHERE automation.staff_id = v_context.staff_id
      AND automation.organization_id = v_context.organization_id
      AND automation.is_delete = false
  ) THEN
    RAISE EXCEPTION
      'v176_smoke: selected tenant gained an automation before isolation lock';
  END IF;

  INSERT INTO public.auto_campaigns (
    name,
    action_id,
    account_id,
    status,
    schedule,
    original_schedule,
    content,
    is_delete,
    staff_id,
    organization_id
  )
  VALUES (
    v_context.marker || ':campaign_a',
    v_context.action_id,
    v_context.account_id,
    'chờ xử lý',
    clock_timestamp() + interval '30 days',
    clock_timestamp() + interval '30 days',
    '',
    false,
    v_context.staff_id,
    v_context.organization_id
  )
  RETURNING id INTO v_source_campaign_id;

  UPDATE pg_temp.v176_smoke_context
  SET source_campaign_id = v_source_campaign_id
  WHERE marker = v_context.marker;
END;
$isolation$;

-- ---------------------------------------------------------------------------
-- Transaction-local helper functions
-- ---------------------------------------------------------------------------

CREATE FUNCTION pg_temp.v176_smoke_make_target(
  p_label text,
  p_status text
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_context record;
  v_campaign_id bigint;
BEGIN
  SELECT *
  INTO STRICT v_context
  FROM pg_temp.v176_smoke_context;

  INSERT INTO public.auto_campaigns (
    name,
    action_id,
    account_id,
    status,
    schedule,
    original_schedule,
    completed_at,
    note,
    content,
    is_delete,
    staff_id,
    organization_id
  )
  VALUES (
    v_context.marker || ':campaign_b:' || p_label,
    v_context.action_id,
    v_context.account_id,
    p_status,
    clock_timestamp() + interval '8 days',
    clock_timestamp() + interval '9 days',
    CASE WHEN p_status = 'hoàn thành' THEN clock_timestamp() ELSE NULL END,
    CASE WHEN p_status = 'hoàn thành' THEN 'smoke completed note' ELSE 'smoke preserved note' END,
    '',
    false,
    v_context.staff_id,
    v_context.organization_id
  )
  RETURNING id INTO v_campaign_id;

  RETURN v_campaign_id;
END;
$function$;

CREATE FUNCTION pg_temp.v176_smoke_save_rule(
  p_label text,
  p_target_campaign_id bigint,
  p_schedule_mode text,
  p_delay_value integer DEFAULT NULL,
  p_delay_unit text DEFAULT NULL,
  p_daily_time time without time zone DEFAULT NULL,
  p_fixed_at timestamptz DEFAULT NULL,
  p_delay_days integer DEFAULT 0,
  p_delay_hours integer DEFAULT 0,
  p_old_client boolean DEFAULT false,
  p_automation_id bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_context record;
  v_saved jsonb;
  v_rule_id bigint;
  v_status_value text;
BEGIN
  SELECT *
  INTO STRICT v_context
  FROM pg_temp.v176_smoke_context;

  v_status_value := v_context.marker || ':status:' || p_label;

  IF p_old_client THEN
    -- Deliberately use only the v174 argument set. The canonical v176 suffix
    -- is omitted to verify old PostgREST callers remain resolvable.
    v_saved := public.aka_agent_save_automation(
      p_staff_id => v_context.staff_id,
      p_organization_id => v_context.organization_id,
      p_automation_id => p_automation_id,
      p_name => v_context.marker || ':rule:' || p_label,
      p_source_campaign_id => v_context.source_campaign_id,
      p_target_campaign_id => p_target_campaign_id,
      p_data_type_code => 'phone',
      p_target_contact_group_id => NULL,
      p_schedule_mode => p_schedule_mode,
      p_delay_days => p_delay_days,
      p_delay_hours => p_delay_hours,
      p_fixed_at => p_fixed_at,
      p_note => 'v176 rollback smoke',
      p_is_active => true,
      p_trigger_statuses => jsonb_build_array(
        jsonb_build_object('statusValue', v_status_value)
      ),
      p_auth_username => NULL,
      p_auth_password => NULL
    );
  ELSE
    v_saved := public.aka_agent_save_automation(
      p_staff_id => v_context.staff_id,
      p_organization_id => v_context.organization_id,
      p_automation_id => p_automation_id,
      p_name => v_context.marker || ':rule:' || p_label,
      p_source_campaign_id => v_context.source_campaign_id,
      p_target_campaign_id => p_target_campaign_id,
      p_data_type_code => 'phone',
      p_target_contact_group_id => NULL,
      p_schedule_mode => p_schedule_mode,
      p_delay_days => p_delay_days,
      p_delay_hours => p_delay_hours,
      p_fixed_at => p_fixed_at,
      p_note => 'v176 rollback smoke',
      p_is_active => true,
      p_trigger_statuses => jsonb_build_array(
        jsonb_build_object('statusValue', v_status_value)
      ),
      p_auth_username => NULL,
      p_auth_password => NULL,
      p_delay_value => p_delay_value,
      p_delay_unit => p_delay_unit,
      p_daily_time => p_daily_time
    );
  END IF;

  v_rule_id := NULLIF(v_saved ->> 'id', '')::bigint;
  IF v_rule_id IS NULL THEN
    RAISE EXCEPTION 'v176_smoke: save RPC returned no rule id for %', p_label;
  END IF;

  RETURN v_rule_id;
END;
$function$;

CREATE FUNCTION pg_temp.v176_smoke_emit(
  p_automation_id bigint,
  p_label text,
  p_event_at timestamptz
)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_context record;
  v_source_input_id bigint;
  v_source_detail_id bigint;
  v_execution_id bigint;
  v_status_value text;
  v_failure text;
BEGIN
  SELECT *
  INTO STRICT v_context
  FROM pg_temp.v176_smoke_context;

  v_status_value := v_context.marker || ':status:' || p_label;

  UPDATE public.auto_automation AS automation
  SET
    activated_at = p_event_at - interval '1 second',
    updated_at = clock_timestamp()
  WHERE automation.id = p_automation_id
    AND automation.staff_id = v_context.staff_id
    AND automation.organization_id = v_context.organization_id
    AND automation.is_active = true
    AND automation.is_delete = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'v176_smoke: rule % is not active for emit', p_automation_id;
  END IF;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id,
    name,
    phone,
    status,
    schedule,
    is_delete
  )
  VALUES (
    v_context.source_campaign_id,
    v_context.marker || ':source_input:' || p_label,
    '+84900000000',
    'hoàn thành',
    p_event_at,
    false
  )
  RETURNING id INTO v_source_input_id;

  PERFORM set_config('aka_agent.automation_reconcile', 'on', true);
  PERFORM set_config('aka_agent.automation_event_at', p_event_at::text, true);

  INSERT INTO public.auto_campaign_details (
    input_data_id,
    campaign_id,
    account_id,
    action_name,
    status,
    log,
    data,
    is_delete
  )
  VALUES (
    v_source_input_id,
    v_context.source_campaign_id,
    v_context.account_id,
    v_context.marker || ':action:' || p_label,
    v_status_value,
    'v176 rollback smoke',
    '{}'::jsonb,
    false
  )
  RETURNING id INTO v_source_detail_id;

  PERFORM set_config('aka_agent.automation_reconcile', 'off', true);
  PERFORM set_config('aka_agent.automation_event_at', '', true);

  SELECT execution.id
  INTO v_execution_id
  FROM public.auto_automation_detail AS execution
  WHERE execution.automation_id = p_automation_id
    AND execution.source_campaign_detail_id = v_source_detail_id;

  IF v_execution_id IS NULL THEN
    SELECT failure.last_error
    INTO v_failure
    FROM public.auto_automation_enqueue_failures AS failure
    WHERE failure.source_campaign_detail_id = v_source_detail_id;

    RAISE EXCEPTION
      'v176_smoke: enqueue produced no execution for % (failure: %)',
      p_label,
      COALESCE(v_failure, 'none');
  END IF;

  RETURN v_execution_id;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('aka_agent.automation_reconcile', 'off', true);
    PERFORM set_config('aka_agent.automation_event_at', '', true);
    RAISE;
END;
$function$;

CREATE FUNCTION pg_temp.v176_smoke_claim_one(
  p_execution_id bigint,
  p_worker_id text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_context record;
  v_eligible_count integer;
  v_claimed_count integer;
  v_matching_count integer;
BEGIN
  SELECT *
  INTO STRICT v_context
  FROM pg_temp.v176_smoke_context;

  IF EXISTS (
    SELECT 1
    FROM public.auto_automation AS automation
    WHERE automation.staff_id = v_context.staff_id
      AND automation.organization_id = v_context.organization_id
      AND automation.is_active = true
      AND automation.is_delete = false
      AND left(automation.name, length(v_context.marker)) <> v_context.marker
  ) THEN
    RAISE EXCEPTION
      'v176_smoke safety: refusing to claim a tenant containing a real active automation';
  END IF;

  SELECT count(*)::integer
  INTO v_eligible_count
  FROM public.auto_automation_detail AS execution
  JOIN public.auto_automation AS automation
    ON automation.id = execution.automation_id
  WHERE execution.staff_id = v_context.staff_id
    AND execution.organization_id = v_context.organization_id
    AND execution.status = 'chờ xử lý'
    AND execution.next_attempt_at <= clock_timestamp()
    AND automation.is_active = true
    AND automation.is_delete = false;

  IF v_eligible_count <> 1 OR NOT EXISTS (
    SELECT 1
    FROM public.auto_automation_detail AS execution
    JOIN public.auto_automation AS automation
      ON automation.id = execution.automation_id
    WHERE execution.id = p_execution_id
      AND execution.staff_id = v_context.staff_id
      AND execution.organization_id = v_context.organization_id
      AND execution.status = 'chờ xử lý'
      AND execution.next_attempt_at <= clock_timestamp()
      AND automation.is_active = true
      AND automation.is_delete = false
      AND left(automation.name, length(v_context.marker)) = v_context.marker
  ) THEN
    RAISE EXCEPTION
      'v176_smoke safety: expected only execution %, found % eligible rows',
      p_execution_id,
      v_eligible_count;
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE claimed.automation_detail_id = p_execution_id
    )::integer
  INTO v_claimed_count, v_matching_count
  FROM public.claim_auto_automation_details(
    p_staff_id => v_context.staff_id,
    p_organization_id => v_context.organization_id,
    p_worker_id => p_worker_id,
    p_limit => 200,
    p_auth_username => NULL,
    p_auth_password => NULL
  ) AS claimed;

  IF v_claimed_count <> 1 OR v_matching_count <> 1 THEN
    RAISE EXCEPTION
      'v176_smoke: claim expected execution %, got % rows/% matches',
      p_execution_id,
      v_claimed_count,
      v_matching_count;
  END IF;
END;
$function$;

CREATE FUNCTION pg_temp.v176_smoke_materialize(
  p_execution_id bigint,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_context record;
BEGIN
  SELECT *
  INTO STRICT v_context
  FROM pg_temp.v176_smoke_context;

  RETURN public.materialize_auto_automation_detail(
    p_staff_id => v_context.staff_id,
    p_organization_id => v_context.organization_id,
    p_automation_detail_id => p_execution_id,
    p_worker_id => p_worker_id,
    p_target_input => '{}'::jsonb,
    p_auth_username => NULL,
    p_auth_password => NULL
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- Schedule calculation and immutable snapshot assertions
-- ---------------------------------------------------------------------------

DO $schedule_math$
DECLARE
  v_target_campaign_id bigint;
  v_rule_id bigint;
  v_execution_id bigint;
  v_event_at timestamptz;
  v_expected_at timestamptz;
  v_execution record;
  v_case record;
  v_local_day date;
BEGIN
  v_target_campaign_id := pg_temp.v176_smoke_make_target(
    'schedule_math',
    'chờ xử lý'
  );
  v_event_at := date_trunc('minute', clock_timestamp()) - interval '2 days';

  FOR v_case IN
    SELECT *
    FROM (VALUES
      ('delay_minute', 15, 'minute', interval '15 minutes'),
      ('delay_hour', 2, 'hour', interval '2 hours'),
      ('delay_day', 3, 'day', interval '3 days')
    ) AS cases(label, delay_value, delay_unit, expected_interval)
  LOOP
    v_rule_id := pg_temp.v176_smoke_save_rule(
      v_case.label,
      v_target_campaign_id,
      'after_delay',
      v_case.delay_value,
      v_case.delay_unit
    );
    v_execution_id := pg_temp.v176_smoke_emit(
      v_rule_id,
      v_case.label,
      v_event_at
    );
    v_expected_at := v_event_at + v_case.expected_interval;

    SELECT *
    INTO STRICT v_execution
    FROM public.auto_automation_detail
    WHERE id = v_execution_id;

    IF v_execution.scheduled_at IS DISTINCT FROM v_expected_at
      OR v_execution.next_attempt_at IS DISTINCT FROM v_event_at
      OR v_execution.config_snapshot ->> 'schedule_mode' <> 'after_delay'
      OR (v_execution.config_snapshot ->> 'delay_value')::integer
        <> v_case.delay_value
      OR v_execution.config_snapshot ->> 'delay_unit' <> v_case.delay_unit
      OR v_execution.config_snapshot ->> 'schedule_time_zone'
        <> 'Asia/Ho_Chi_Minh'
      OR (v_execution.config_snapshot ->> 'scheduled_at')::timestamptz
        IS DISTINCT FROM v_expected_at THEN
      RAISE EXCEPTION 'v176_smoke: schedule math failed for %', v_case.label;
    END IF;

    UPDATE public.auto_automation_detail
    SET
      status = 'bỏ qua',
      processed_at = clock_timestamp(),
      last_error = 'smoke_math_complete'
    WHERE id = v_execution_id;
  END LOOP;

  v_rule_id := pg_temp.v176_smoke_save_rule(
    'immediate',
    v_target_campaign_id,
    'immediate'
  );
  v_execution_id := pg_temp.v176_smoke_emit(
    v_rule_id,
    'immediate',
    v_event_at
  );

  SELECT *
  INTO STRICT v_execution
  FROM public.auto_automation_detail
  WHERE id = v_execution_id;

  IF v_execution.scheduled_at IS DISTINCT FROM v_event_at
    OR v_execution.next_attempt_at IS DISTINCT FROM v_event_at
    OR v_execution.config_snapshot ->> 'schedule_mode' <> 'immediate' THEN
    RAISE EXCEPTION 'v176_smoke: immediate schedule calculation failed';
  END IF;

  UPDATE public.auto_automation_detail
  SET
    status = 'bỏ qua',
    processed_at = clock_timestamp(),
    last_error = 'smoke_math_complete'
  WHERE id = v_execution_id;

  v_local_day := (
    clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh'
  )::date - 2;

  FOR v_case IN
    SELECT *
    FROM (VALUES
      ('daily_before', time '07:59', 0),
      ('daily_equal', time '08:30', 0),
      ('daily_after', time '08:31', 1)
    ) AS cases(label, event_time, expected_day_offset)
  LOOP
    v_event_at := (
      v_local_day + v_case.event_time
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh';
    v_expected_at := (
      (v_local_day + v_case.expected_day_offset) + time '08:30'
    ) AT TIME ZONE 'Asia/Ho_Chi_Minh';

    v_rule_id := pg_temp.v176_smoke_save_rule(
      v_case.label,
      v_target_campaign_id,
      'daily_time',
      NULL,
      NULL,
      time '08:30'
    );
    v_execution_id := pg_temp.v176_smoke_emit(
      v_rule_id,
      v_case.label,
      v_event_at
    );

    SELECT *
    INTO STRICT v_execution
    FROM public.auto_automation_detail
    WHERE id = v_execution_id;

    IF v_execution.scheduled_at IS DISTINCT FROM v_expected_at
      OR v_execution.next_attempt_at IS DISTINCT FROM v_event_at
      OR v_execution.config_snapshot ->> 'schedule_mode' <> 'daily_time'
      OR (v_execution.config_snapshot ->> 'daily_time')::time
        IS DISTINCT FROM time '08:30'
      OR v_execution.config_snapshot ->> 'schedule_time_zone'
        <> 'Asia/Ho_Chi_Minh' THEN
      RAISE EXCEPTION 'v176_smoke: daily_time calculation failed for %', v_case.label;
    END IF;

    UPDATE public.auto_automation_detail
    SET
      status = 'bỏ qua',
      processed_at = clock_timestamp(),
      last_error = 'smoke_daily_complete'
    WHERE id = v_execution_id;
  END LOOP;
END;
$schedule_math$;

-- ---------------------------------------------------------------------------
-- Future input materialization, snapshot immutability and idempotency
-- ---------------------------------------------------------------------------

DO $future_materialization$
DECLARE
  v_context record;
  v_target_campaign_id bigint;
  v_rule_id bigint;
  v_execution_id bigint;
  v_source_detail_id bigint;
  v_event_at timestamptz := clock_timestamp();
  v_expected_at timestamptz;
  v_original_schedule timestamptz;
  v_result jsonb;
  v_input record;
  v_campaign record;
  v_count integer;
BEGIN
  SELECT *
  INTO STRICT v_context
  FROM pg_temp.v176_smoke_context;

  v_target_campaign_id := pg_temp.v176_smoke_make_target(
    'future_idempotent',
    'chờ xử lý'
  );
  SELECT original_schedule
  INTO v_original_schedule
  FROM public.auto_campaigns
  WHERE id = v_target_campaign_id;

  v_rule_id := pg_temp.v176_smoke_save_rule(
    'future_idempotent',
    v_target_campaign_id,
    'after_delay',
    15,
    'minute'
  );
  v_execution_id := pg_temp.v176_smoke_emit(
    v_rule_id,
    'future_idempotent',
    v_event_at
  );
  v_expected_at := v_event_at + interval '15 minutes';

  SELECT source_campaign_detail_id
  INTO v_source_detail_id
  FROM public.auto_automation_detail
  WHERE id = v_execution_id;

  -- Fast-path no-change update, followed by forced reconciliation. Both must
  -- keep the unique execution ledger at exactly one row.
  UPDATE public.auto_campaign_details
  SET status = status
  WHERE id = v_source_detail_id;

  PERFORM set_config('aka_agent.automation_reconcile', 'on', true);
  PERFORM set_config('aka_agent.automation_event_at', v_event_at::text, true);
  UPDATE public.auto_campaign_details
  SET status = status
  WHERE id = v_source_detail_id;
  PERFORM set_config('aka_agent.automation_reconcile', 'off', true);
  PERFORM set_config('aka_agent.automation_event_at', '', true);

  SELECT count(*)::integer
  INTO v_count
  FROM public.auto_automation_detail
  WHERE automation_id = v_rule_id
    AND source_campaign_detail_id = v_source_detail_id;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'v176_smoke: trigger/reconcile idempotency created % executions', v_count;
  END IF;

  -- Editing the rule after enqueue must not change the execution snapshot.
  PERFORM pg_temp.v176_smoke_save_rule(
    p_label => 'future_idempotent',
    p_target_campaign_id => v_target_campaign_id,
    p_schedule_mode => 'after_delay',
    p_delay_value => 99,
    p_delay_unit => 'minute',
    p_automation_id => v_rule_id
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_automation_detail AS execution
    WHERE execution.id = v_execution_id
      AND execution.scheduled_at = v_expected_at
      AND (execution.config_snapshot ->> 'delay_value')::integer = 15
      AND execution.config_snapshot ->> 'delay_unit' = 'minute'
  ) THEN
    RAISE EXCEPTION 'v176_smoke: queued execution snapshot changed after rule edit';
  END IF;

  PERFORM pg_temp.v176_smoke_claim_one(
    v_execution_id,
    'v176-smoke-future-worker'
  );
  v_result := pg_temp.v176_smoke_materialize(
    v_execution_id,
    'v176-smoke-future-worker'
  );

  IF v_result ->> 'result' <> 'materialized' THEN
    RAISE EXCEPTION 'v176_smoke: future materialize returned %', v_result;
  END IF;

  SELECT *
  INTO STRICT v_input
  FROM public.auto_campaign_input_data
  WHERE auto_automation_detail_id = v_execution_id;

  IF v_input.schedule IS DISTINCT FROM v_expected_at
    OR v_input.schedule <= clock_timestamp()
    OR v_input.created_at >= v_input.schedule
    OR v_input.status <> 'chờ xử lý'
    OR v_input.is_delete IS TRUE THEN
    RAISE EXCEPTION 'v176_smoke: future target input is missing or already due';
  END IF;

  SELECT *
  INTO STRICT v_campaign
  FROM public.auto_campaigns
  WHERE id = v_target_campaign_id;

  IF v_campaign.status <> 'chờ xử lý'
    OR v_campaign.schedule IS DISTINCT FROM v_expected_at
    OR v_campaign.original_schedule IS DISTINCT FROM v_original_schedule THEN
    RAISE EXCEPTION 'v176_smoke: pending B runtime/original schedule mismatch';
  END IF;

  v_result := pg_temp.v176_smoke_materialize(
    v_execution_id,
    'v176-smoke-future-worker'
  );
  SELECT count(*)::integer
  INTO v_count
  FROM public.auto_campaign_input_data
  WHERE auto_automation_detail_id = v_execution_id;

  IF v_result ->> 'result' <> 'already_materialized' OR v_count <> 1 THEN
    RAISE EXCEPTION 'v176_smoke: materialize idempotency failed (% / %)', v_result, v_count;
  END IF;
END;
$future_materialization$;

-- ---------------------------------------------------------------------------
-- Target campaign state matrix
-- ---------------------------------------------------------------------------

DO $target_states$
DECLARE
  v_case record;
  v_target_campaign_id bigint;
  v_rule_id bigint;
  v_execution_id bigint;
  v_event_at timestamptz;
  v_original_schedule timestamptz;
  v_result jsonb;
  v_campaign record;
  v_input_count integer;
BEGIN
  FOR v_case IN
    SELECT *
    FROM (VALUES
      ('target_pending', 'chờ xử lý', 'chờ xử lý'),
      ('target_completed', 'hoàn thành', 'chờ xử lý'),
      ('target_paused', 'tạm dừng', 'tạm dừng')
    ) AS cases(label, initial_status, expected_status)
  LOOP
    v_target_campaign_id := pg_temp.v176_smoke_make_target(
      v_case.label,
      v_case.initial_status
    );
    SELECT original_schedule
    INTO v_original_schedule
    FROM public.auto_campaigns
    WHERE id = v_target_campaign_id;

    v_event_at := clock_timestamp() - interval '1 minute';
    v_rule_id := pg_temp.v176_smoke_save_rule(
      v_case.label,
      v_target_campaign_id,
      'immediate'
    );
    v_execution_id := pg_temp.v176_smoke_emit(
      v_rule_id,
      v_case.label,
      v_event_at
    );

    PERFORM pg_temp.v176_smoke_claim_one(
      v_execution_id,
      'v176-smoke-' || v_case.label
    );
    v_result := pg_temp.v176_smoke_materialize(
      v_execution_id,
      'v176-smoke-' || v_case.label
    );

    SELECT *
    INTO STRICT v_campaign
    FROM public.auto_campaigns
    WHERE id = v_target_campaign_id;
    SELECT count(*)::integer
    INTO v_input_count
    FROM public.auto_campaign_input_data
    WHERE auto_automation_detail_id = v_execution_id;

    IF v_result ->> 'result' <> 'materialized'
      OR v_campaign.status <> v_case.expected_status
      OR v_campaign.schedule IS DISTINCT FROM v_event_at
      OR v_campaign.original_schedule IS DISTINCT FROM v_original_schedule
      OR v_input_count <> 1 THEN
      RAISE EXCEPTION 'v176_smoke: target state failed for % (% / %)',
        v_case.label,
        v_result,
        v_campaign.status;
    END IF;

    IF v_case.initial_status = 'hoàn thành'
      AND (v_campaign.completed_at IS NOT NULL OR v_campaign.note IS NOT NULL) THEN
      RAISE EXCEPTION 'v176_smoke: completed B was not fully reopened';
    END IF;
  END LOOP;
END;
$target_states$;

DO $target_running$
DECLARE
  v_context record;
  v_target_campaign_id bigint;
  v_rule_id bigint;
  v_execution_id bigint;
  v_event_at timestamptz := clock_timestamp() - interval '1 minute';
  v_original_schedule timestamptz;
  v_result jsonb;
  v_retry jsonb;
  v_input_count integer;
BEGIN
  SELECT *
  INTO STRICT v_context
  FROM pg_temp.v176_smoke_context;

  v_target_campaign_id := pg_temp.v176_smoke_make_target(
    'target_running',
    'đang chạy'
  );
  SELECT original_schedule
  INTO v_original_schedule
  FROM public.auto_campaigns
  WHERE id = v_target_campaign_id;

  v_rule_id := pg_temp.v176_smoke_save_rule(
    'target_running',
    v_target_campaign_id,
    'immediate'
  );
  v_execution_id := pg_temp.v176_smoke_emit(
    v_rule_id,
    'target_running',
    v_event_at
  );

  PERFORM pg_temp.v176_smoke_claim_one(
    v_execution_id,
    'v176-smoke-running-worker-1'
  );
  v_result := pg_temp.v176_smoke_materialize(
    v_execution_id,
    'v176-smoke-running-worker-1'
  );
  SELECT count(*)::integer
  INTO v_input_count
  FROM public.auto_campaign_input_data
  WHERE auto_automation_detail_id = v_execution_id;

  IF v_result ->> 'result' <> 'target_running'
    OR v_input_count <> 0
    OR NOT EXISTS (
      SELECT 1
      FROM public.auto_automation_detail
      WHERE id = v_execution_id
        AND status = 'đang xử lý'
        AND locked_by = 'v176-smoke-running-worker-1'
    ) THEN
    RAISE EXCEPTION 'v176_smoke: running B was not deferred safely (%)', v_result;
  END IF;

  v_retry := public.retry_auto_automation_detail(
    p_staff_id => v_context.staff_id,
    p_organization_id => v_context.organization_id,
    p_automation_detail_id => v_execution_id,
    p_worker_id => 'v176-smoke-running-worker-1',
    p_error => 'target_running',
    p_delay_seconds => 0,
    p_terminal => false,
    p_skip => false,
    p_count_attempt => false,
    p_auth_username => NULL,
    p_auth_password => NULL
  );

  IF v_retry ->> 'result' <> 'retry_scheduled' THEN
    RAISE EXCEPTION 'v176_smoke: running B retry was not scheduled (%)', v_retry;
  END IF;

  UPDATE public.auto_campaigns
  SET status = 'chờ xử lý'
  WHERE id = v_target_campaign_id;

  PERFORM pg_temp.v176_smoke_claim_one(
    v_execution_id,
    'v176-smoke-running-worker-2'
  );
  v_result := pg_temp.v176_smoke_materialize(
    v_execution_id,
    'v176-smoke-running-worker-2'
  );
  SELECT count(*)::integer
  INTO v_input_count
  FROM public.auto_campaign_input_data
  WHERE auto_automation_detail_id = v_execution_id;

  IF v_result ->> 'result' <> 'materialized'
    OR v_input_count <> 1
    OR NOT EXISTS (
      SELECT 1
      FROM public.auto_campaigns
      WHERE id = v_target_campaign_id
        AND status = 'chờ xử lý'
        AND original_schedule = v_original_schedule
    ) THEN
    RAISE EXCEPTION 'v176_smoke: running B retry materialization failed (%)', v_result;
  END IF;
END;
$target_running$;

DO $target_deleted$
DECLARE
  v_target_campaign_id bigint;
  v_rule_id bigint;
  v_execution_id bigint;
  v_result jsonb;
  v_input_count integer;
BEGIN
  v_target_campaign_id := pg_temp.v176_smoke_make_target(
    'target_deleted',
    'chờ xử lý'
  );
  v_rule_id := pg_temp.v176_smoke_save_rule(
    'target_deleted',
    v_target_campaign_id,
    'immediate'
  );
  v_execution_id := pg_temp.v176_smoke_emit(
    v_rule_id,
    'target_deleted',
    clock_timestamp() - interval '1 minute'
  );

  UPDATE public.auto_campaigns
  SET is_delete = true
  WHERE id = v_target_campaign_id;

  PERFORM pg_temp.v176_smoke_claim_one(
    v_execution_id,
    'v176-smoke-deleted-worker'
  );
  v_result := pg_temp.v176_smoke_materialize(
    v_execution_id,
    'v176-smoke-deleted-worker'
  );
  SELECT count(*)::integer
  INTO v_input_count
  FROM public.auto_campaign_input_data
  WHERE auto_automation_detail_id = v_execution_id;

  IF v_result ->> 'result' <> 'failed'
    OR COALESCE((v_result ->> 'retryable')::boolean, false)
    OR v_result ->> 'error' <> 'target_campaign_changed_or_deleted'
    OR v_input_count <> 0
    OR NOT EXISTS (
      SELECT 1
      FROM public.auto_automation_detail
      WHERE id = v_execution_id
        AND status = 'lỗi'
        AND last_error = 'target_campaign_changed_or_deleted'
    ) THEN
    RAISE EXCEPTION 'v176_smoke: deleted B handling failed (%)', v_result;
  END IF;
END;
$target_deleted$;

-- ---------------------------------------------------------------------------
-- Legacy fixed_at and old-client delay compatibility
-- ---------------------------------------------------------------------------

DO $legacy_compatibility$
DECLARE
  v_target_campaign_id bigint;
  v_rule_id bigint;
  v_execution_id bigint;
  v_event_at timestamptz;
  v_fixed_at timestamptz;
  v_result jsonb;
  v_rule record;
  v_execution record;
BEGIN
  v_target_campaign_id := pg_temp.v176_smoke_make_target(
    'legacy_delay',
    'chờ xử lý'
  );
  v_event_at := clock_timestamp();
  v_rule_id := pg_temp.v176_smoke_save_rule(
    p_label => 'legacy_delay',
    p_target_campaign_id => v_target_campaign_id,
    p_schedule_mode => 'after_delay',
    p_delay_days => 1,
    p_delay_hours => 2,
    p_old_client => true
  );
  v_execution_id := pg_temp.v176_smoke_emit(
    v_rule_id,
    'legacy_delay',
    v_event_at
  );

  SELECT *
  INTO STRICT v_rule
  FROM public.auto_automation
  WHERE id = v_rule_id;
  SELECT *
  INTO STRICT v_execution
  FROM public.auto_automation_detail
  WHERE id = v_execution_id;

  IF v_rule.delay_days <> 1
    OR v_rule.delay_hours <> 2
    OR v_rule.delay_value <> 26
    OR v_rule.delay_unit <> 'hour'
    OR v_execution.scheduled_at IS DISTINCT FROM v_event_at + interval '26 hours'
    OR v_execution.next_attempt_at IS DISTINCT FROM v_event_at
    OR (v_execution.config_snapshot ->> 'delay_value')::integer <> 26
    OR v_execution.config_snapshot ->> 'delay_unit' <> 'hour' THEN
    RAISE EXCEPTION 'v176_smoke: old-client after_delay compatibility failed';
  END IF;

  UPDATE public.auto_automation_detail
  SET
    status = 'bỏ qua',
    processed_at = clock_timestamp(),
    last_error = 'smoke_legacy_delay_complete'
  WHERE id = v_execution_id;

  v_target_campaign_id := pg_temp.v176_smoke_make_target(
    'legacy_fixed',
    'chờ xử lý'
  );
  v_event_at := clock_timestamp();
  v_fixed_at := v_event_at + interval '2 hours';
  v_rule_id := pg_temp.v176_smoke_save_rule(
    p_label => 'legacy_fixed',
    p_target_campaign_id => v_target_campaign_id,
    p_schedule_mode => 'fixed_at',
    p_fixed_at => v_fixed_at,
    p_old_client => true
  );
  v_execution_id := pg_temp.v176_smoke_emit(
    v_rule_id,
    'legacy_fixed',
    v_event_at
  );

  SELECT *
  INTO STRICT v_rule
  FROM public.auto_automation
  WHERE id = v_rule_id;
  SELECT *
  INTO STRICT v_execution
  FROM public.auto_automation_detail
  WHERE id = v_execution_id;

  IF v_rule.delay_value IS NOT NULL
    OR v_rule.delay_unit IS NOT NULL
    OR v_rule.daily_time IS NOT NULL
    OR v_rule.fixed_at IS DISTINCT FROM v_fixed_at
    OR v_execution.scheduled_at IS DISTINCT FROM v_fixed_at
    OR v_execution.next_attempt_at IS DISTINCT FROM v_event_at
    OR v_execution.config_snapshot ->> 'schedule_mode' <> 'fixed_at' THEN
    RAISE EXCEPTION 'v176_smoke: legacy fixed_at snapshot failed';
  END IF;

  PERFORM pg_temp.v176_smoke_claim_one(
    v_execution_id,
    'v176-smoke-fixed-worker'
  );
  v_result := pg_temp.v176_smoke_materialize(
    v_execution_id,
    'v176-smoke-fixed-worker'
  );

  IF v_result ->> 'result' <> 'materialized'
    OR NOT EXISTS (
      SELECT 1
      FROM public.auto_campaign_input_data
      WHERE auto_automation_detail_id = v_execution_id
        AND schedule = v_fixed_at
        AND schedule > clock_timestamp()
    ) THEN
    RAISE EXCEPTION 'v176_smoke: legacy fixed_at materialization failed (%)', v_result;
  END IF;

  -- A fixed schedule that was valid when saved still preserves v174's
  -- one-shot expiry behavior if its source event occurs after that instant.
  v_target_campaign_id := pg_temp.v176_smoke_make_target(
    'legacy_fixed_expired',
    'chờ xử lý'
  );
  v_fixed_at := clock_timestamp() + interval '3 hours';
  v_rule_id := pg_temp.v176_smoke_save_rule(
    p_label => 'legacy_fixed_expired',
    p_target_campaign_id => v_target_campaign_id,
    p_schedule_mode => 'fixed_at',
    p_fixed_at => v_fixed_at,
    p_old_client => true
  );
  v_execution_id := pg_temp.v176_smoke_emit(
    v_rule_id,
    'legacy_fixed_expired',
    v_fixed_at + interval '1 minute'
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_automation_detail
    WHERE id = v_execution_id
      AND status = 'bỏ qua'
      AND last_error = 'fixed_schedule_expired'
      AND scheduled_at = v_fixed_at
  ) THEN
    RAISE EXCEPTION 'v176_smoke: expired fixed_at compatibility failed';
  END IF;
END;
$legacy_compatibility$;

-- ---------------------------------------------------------------------------
-- Canonical delay validation boundaries
-- ---------------------------------------------------------------------------

DO $validation_boundaries$
DECLARE
  v_target_campaign_id bigint;
  v_case record;
BEGIN
  v_target_campaign_id := pg_temp.v176_smoke_make_target(
    'validation_boundaries',
    'chờ xử lý'
  );

  FOR v_case IN
    SELECT *
    FROM (VALUES
      ('invalid_minute_zero', 0, 'minute'),
      ('invalid_minute_max', 5256001, 'minute'),
      ('invalid_hour_max', 87601, 'hour'),
      ('invalid_day_max', 3651, 'day')
    ) AS cases(label, delay_value, delay_unit)
  LOOP
    BEGIN
      PERFORM pg_temp.v176_smoke_save_rule(
        v_case.label,
        v_target_campaign_id,
        'after_delay',
        v_case.delay_value,
        v_case.delay_unit
      );
      RAISE EXCEPTION
        'v176_smoke: invalid delay unexpectedly accepted for %',
        v_case.label;
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%invalid_delay_schedule%' THEN
          RAISE;
        END IF;
    END;
  END LOOP;
END;
$validation_boundaries$;

-- Every write above is intentionally discarded.
ROLLBACK;

-- ---------------------------------------------------------------------------
-- Post-rollback proof: no marker row survived in any touched durable table.
-- ---------------------------------------------------------------------------

DO $post_rollback$
DECLARE
  v_marker constant text := '__codex_v176_rollback_smoke__';
  v_remaining bigint;
BEGIN
  SELECT sum(marker_rows.row_count)
  INTO v_remaining
  FROM (
    SELECT count(*)::bigint AS row_count
    FROM public.auto_automation
    WHERE left(name, length(v_marker)) = v_marker

    UNION ALL

    SELECT count(*)::bigint
    FROM public.auto_campaigns
    WHERE left(name, length(v_marker)) = v_marker

    UNION ALL

    SELECT count(*)::bigint
    FROM public.auto_campaign_input_data
    WHERE left(COALESCE(name, ''), length(v_marker)) = v_marker

    UNION ALL

    SELECT count(*)::bigint
    FROM public.auto_campaign_details
    WHERE left(action_name, length(v_marker)) = v_marker
      OR left(status, length(v_marker)) = v_marker

    UNION ALL

    SELECT count(*)::bigint
    FROM public.auto_campaign_action_detail_statuses
    WHERE left(status_value, length(v_marker)) = v_marker

    UNION ALL

    SELECT count(*)::bigint
    FROM public.auto_automation_trigger_statuses
    WHERE left(status_value, length(v_marker)) = v_marker
  ) AS marker_rows;

  IF COALESCE(v_remaining, 0) <> 0 THEN
    RAISE EXCEPTION
      'v176_smoke: rollback left % marker rows',
      v_remaining;
  END IF;
END;
$post_rollback$;

SELECT jsonb_build_object(
  'test', 'migration_v176_automation_target_data_schedule_smoke',
  'passed', true,
  'persistent_marker_rows', 0
) AS result;
