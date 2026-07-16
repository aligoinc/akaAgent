-- Rollback smoke test for migration_v174_automation_delay_exact_time_and_status_scope.sql.
--
-- Run after v174 is applied. This file verifies the public RPC shape, exact
-- wall-clock schedule calculation and immutable snapshot. The v173 smoke test
-- remains the full claim/materialize/idempotency/status-state regression test;
-- both tests should be run for an automation release.

BEGIN;

SET LOCAL statement_timeout = '5min';
SET LOCAL lock_timeout = '5s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

DO $preflight$
DECLARE
  v_save_count integer;
  v_save_args integer;
  v_save_defaults integer;
  v_validate_count integer;
  v_validate_args integer;
  v_validate_defaults integer;
BEGIN
  SELECT count(*)::integer, min(pronargs)::integer, min(pronargdefaults)::integer
  INTO v_save_count, v_save_args, v_save_defaults
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'aka_agent_save_automation';

  SELECT count(*)::integer, min(pronargs)::integer, min(pronargdefaults)::integer
  INTO v_validate_count, v_validate_args, v_validate_defaults
  FROM pg_catalog.pg_proc AS proc
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'aka_agent_validate_automation_rule';

  IF v_save_count <> 1 OR v_save_args <> 22 OR v_save_defaults <> 7 THEN
    RAISE EXCEPTION 'v174_smoke: save RPC mismatch (%/%/%)',
      v_save_count, v_save_args, v_save_defaults;
  END IF;

  IF v_validate_count <> 1 OR v_validate_args <> 20 OR v_validate_defaults <> 8 THEN
    RAISE EXCEPTION 'v174_smoke: validate RPC mismatch (%/%/%)',
      v_validate_count, v_validate_args, v_validate_defaults;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auto_automation'
      AND column_name = 'delay_exact_time'
      AND data_type = 'time without time zone'
  ) THEN
    RAISE EXCEPTION 'v174_smoke: delay_exact_time is missing';
  END IF;
END;
$preflight$;

CREATE TEMP TABLE v174_smoke_context (
  marker text PRIMARY KEY,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  account_id bigint NOT NULL,
  action_id text NOT NULL,
  source_campaign_id bigint NOT NULL,
  target_campaign_id bigint,
  source_input_id bigint,
  source_detail_id bigint
) ON COMMIT DROP;

INSERT INTO pg_temp.v174_smoke_context (
  marker, staff_id, organization_id, account_id, action_id, source_campaign_id
)
SELECT
  '__codex_v174_exact_schedule_smoke__',
  campaign.staff_id,
  campaign.organization_id,
  campaign.account_id,
  campaign.action_id,
  campaign.id
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
  AND NOT EXISTS (
    SELECT 1
    FROM public.auto_automation AS automation
    WHERE automation.staff_id = campaign.staff_id
      AND automation.organization_id = campaign.organization_id
      AND automation.is_delete = false
  )
ORDER BY campaign.id
LIMIT 1;

DO $fixtures$
DECLARE
  v_context record;
  v_target_campaign_id bigint;
  v_source_input_id bigint;
  v_source_detail_id bigint;
BEGIN
  SELECT * INTO STRICT v_context FROM pg_temp.v174_smoke_context;

  IF NOT pg_try_advisory_xact_lock(hashtextextended(
    'auto_automation_graph:' || v_context.staff_id::text || ':' || v_context.organization_id::text,
    0
  )) THEN
    RAISE EXCEPTION 'v174_smoke: selected tenant is busy';
  END IF;

  INSERT INTO public.auto_campaigns (
    name, action_id, account_id, status, schedule, original_schedule,
    content, is_delete, staff_id, organization_id
  ) VALUES (
    v_context.marker || ':campaign_b',
    v_context.action_id,
    v_context.account_id,
    'chờ xử lý',
    clock_timestamp() + interval '30 days',
    clock_timestamp() + interval '30 days',
    '', false, v_context.staff_id, v_context.organization_id
  ) RETURNING id INTO v_target_campaign_id;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, name, phone, status, schedule, is_delete
  ) VALUES (
    v_context.source_campaign_id,
    v_context.marker || ':source_input',
    '+84900000000',
    'hoàn thành',
    '2026-07-16 07:00:00+07'::timestamptz,
    false
  ) RETURNING id INTO v_source_input_id;

  INSERT INTO public.auto_campaign_details (
    input_data_id, campaign_id, account_id, action_name, status,
    log, data, is_delete, created_at
  ) VALUES (
    v_source_input_id,
    v_context.source_campaign_id,
    v_context.account_id,
    v_context.marker || ':action',
    v_context.marker || ':status',
    'v174 rollback smoke',
    '{}'::jsonb,
    false,
    '2026-07-16 07:00:00+07'::timestamptz
  ) RETURNING id INTO v_source_detail_id;

  UPDATE pg_temp.v174_smoke_context
  SET target_campaign_id = v_target_campaign_id,
      source_input_id = v_source_input_id,
      source_detail_id = v_source_detail_id;
END;
$fixtures$;

DO $schedule_math$
DECLARE
  v_context record;
  v_case record;
  v_rule_id bigint;
  v_execution record;
BEGIN
  SELECT * INTO STRICT v_context FROM pg_temp.v174_smoke_context;

  FOR v_case IN
    SELECT *
    FROM (VALUES
      ('before', '2026-07-16 07:59:00+07'::timestamptz, 15, 'minute', '08:30'::time, '2026-07-16 08:30:00+07'::timestamptz),
      ('equal', '2026-07-16 08:15:00+07'::timestamptz, 15, 'minute', '08:30'::time, '2026-07-16 08:30:00+07'::timestamptz),
      ('past', '2026-07-16 08:20:00+07'::timestamptz, 15, 'minute', '08:30'::time, '2026-07-17 08:30:00+07'::timestamptz),
      ('ninety_minutes', '2026-07-16 23:30:00+07'::timestamptz, 90, 'minute', '08:30'::time, '2026-07-17 08:30:00+07'::timestamptz),
      ('one_day', '2026-07-16 10:00:00+07'::timestamptz, 1, 'day', '08:30'::time, '2026-07-18 08:30:00+07'::timestamptz),
      ('midnight', '2026-07-16 22:00:00+07'::timestamptz, 1, 'hour', '00:00'::time, '2026-07-17 00:00:00+07'::timestamptz),
      ('last_minute', '2026-07-16 23:00:00+07'::timestamptz, 30, 'minute', '23:59'::time, '2026-07-16 23:59:00+07'::timestamptz)
    ) AS cases(label, event_at, delay_value, delay_unit, exact_time, expected_at)
  LOOP
    INSERT INTO public.auto_automation (
      name, source_campaign_id, target_campaign_id, data_type_code,
      schedule_mode, delay_days, delay_hours, delay_value, delay_unit,
      delay_exact_time, is_active, staff_id, organization_id
    ) VALUES (
      v_context.marker || ':rule:' || v_case.label,
      v_context.source_campaign_id,
      v_context.target_campaign_id,
      'phone', 'after_delay', 0, 0,
      v_case.delay_value, v_case.delay_unit, v_case.exact_time,
      false, v_context.staff_id, v_context.organization_id
    ) RETURNING id INTO v_rule_id;

    INSERT INTO public.auto_automation_detail (
      automation_id, source_campaign_detail_id, source_campaign_input_data_id,
      source_campaign_id, source_account_id, source_action_id, source_status,
      target_campaign_id, target_account_id, target_action_id, data_type_code,
      source_input_snapshot, config_snapshot, scheduled_at, next_attempt_at,
      staff_id, organization_id, created_at
    ) VALUES (
      v_rule_id, v_context.source_detail_id, v_context.source_input_id,
      v_context.source_campaign_id, v_context.account_id, v_context.action_id,
      v_context.marker || ':status',
      v_context.target_campaign_id, v_context.account_id, v_context.action_id,
      'phone', '{}'::jsonb, '{}'::jsonb,
      v_case.event_at, v_case.event_at,
      v_context.staff_id, v_context.organization_id, v_case.event_at
    ) RETURNING scheduled_at, next_attempt_at, config_snapshot INTO v_execution;

    IF v_execution.scheduled_at IS DISTINCT FROM v_case.expected_at
      OR v_execution.next_attempt_at IS DISTINCT FROM v_case.event_at
      OR (v_execution.config_snapshot ->> 'delay_exact_time')::time IS DISTINCT FROM v_case.exact_time
      OR v_execution.config_snapshot ->> 'schedule_policy' <> 'first_wall_clock_at_or_after_delay_v1'
      OR v_execution.config_snapshot ->> 'schedule_time_zone' <> 'Asia/Ho_Chi_Minh'
      OR (v_execution.config_snapshot ->> 'scheduled_at')::timestamptz IS DISTINCT FROM v_case.expected_at
    THEN
      RAISE EXCEPTION 'v174_smoke: schedule failed for % (got %, expected %, snapshot %)',
        v_case.label, v_execution.scheduled_at, v_case.expected_at, v_execution.config_snapshot;
    END IF;
  END LOOP;

  BEGIN
    UPDATE public.auto_automation
    SET delay_exact_time = '24:00'::time
    WHERE id = v_rule_id;
    RAISE EXCEPTION 'v174_smoke: 24:00 was accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$schedule_math$;

SELECT jsonb_build_object(
  'test', 'migration_v174_automation_delay_exact_time_and_status_scope_smoke',
  'passed', true,
  'persistent_marker_rows', 0
) AS result;

ROLLBACK;
