-- Add canonical target-data scheduling to campaign-detail automations.
--
-- Executions are claimed/materialized as soon as the worker can process them;
-- auto_campaign_input_data.schedule remains the source of truth for when the
-- target campaign may actually run the materialized row.

BEGIN;

-- ---------------------------------------------------------------------------
-- Canonical schedule columns and legacy backfill
-- ---------------------------------------------------------------------------

ALTER TABLE public.auto_automation
  ADD COLUMN IF NOT EXISTS delay_value integer,
  ADD COLUMN IF NOT EXISTS delay_unit text,
  ADD COLUMN IF NOT EXISTS daily_time time without time zone;

-- Preserve the exact legacy duration deterministically. Pure-day delays remain
-- days; any delay containing hours becomes total hours. The old schema allowed
-- 3650 days plus 23 hours, so that out-of-new-domain edge is capped at the new
-- product maximum of exactly 3650 days.
UPDATE public.auto_automation AS automation
SET
  delay_value = CASE
    WHEN automation.delay_hours = 0
      THEN LEAST(automation.delay_days, 3650)
    ELSE LEAST((automation.delay_days * 24) + automation.delay_hours, 87600)
  END,
  delay_unit = CASE
    WHEN automation.delay_hours = 0 THEN 'day'
    ELSE 'hour'
  END
WHERE automation.schedule_mode = 'after_delay'
  AND (
    automation.delay_value IS NULL
    OR automation.delay_unit IS NULL
  );

ALTER TABLE public.auto_automation
  DROP CONSTRAINT IF EXISTS auto_automation_schedule_mode_check,
  DROP CONSTRAINT IF EXISTS auto_automation_schedule_config_check,
  DROP CONSTRAINT IF EXISTS auto_automation_delay_value_unit_check,
  DROP CONSTRAINT IF EXISTS auto_automation_daily_time_minute_check;

ALTER TABLE public.auto_automation
  ADD CONSTRAINT auto_automation_schedule_mode_check
    CHECK (schedule_mode IN ('immediate', 'after_delay', 'daily_time', 'fixed_at')),
  ADD CONSTRAINT auto_automation_delay_value_unit_check
    CHECK ((
      (delay_value IS NULL AND delay_unit IS NULL)
      OR (
        delay_value IS NOT NULL
        AND delay_unit IS NOT NULL
        AND (
          (delay_unit = 'minute' AND delay_value BETWEEN 1 AND 5256000)
          OR (delay_unit = 'hour' AND delay_value BETWEEN 1 AND 87600)
          OR (delay_unit = 'day' AND delay_value BETWEEN 1 AND 3650)
        )
      )
    ) IS TRUE),
  ADD CONSTRAINT auto_automation_daily_time_minute_check
    CHECK (
      daily_time IS NULL
      OR EXTRACT(SECOND FROM daily_time) = 0
    ),
  ADD CONSTRAINT auto_automation_schedule_config_check
    CHECK ((
      (
        schedule_mode = 'immediate'
        AND delay_days = 0
        AND delay_hours = 0
        AND delay_value IS NULL
        AND delay_unit IS NULL
        AND daily_time IS NULL
        AND fixed_at IS NULL
      )
      OR (
        schedule_mode = 'after_delay'
        AND delay_value IS NOT NULL
        AND delay_unit IN ('minute', 'hour', 'day')
        AND daily_time IS NULL
        AND fixed_at IS NULL
      )
      OR (
        schedule_mode = 'daily_time'
        AND delay_days = 0
        AND delay_hours = 0
        AND delay_value IS NULL
        AND delay_unit IS NULL
        AND daily_time IS NOT NULL
        AND fixed_at IS NULL
      )
      OR (
        schedule_mode = 'fixed_at'
        AND delay_days = 0
        AND delay_hours = 0
        AND delay_value IS NULL
        AND delay_unit IS NULL
        AND daily_time IS NULL
        AND fixed_at IS NOT NULL
      )
    ) IS TRUE);

COMMENT ON COLUMN public.auto_automation.delay_value IS
  'Canonical positive delay amount for after_delay automations.';
COMMENT ON COLUMN public.auto_automation.delay_unit IS
  'Canonical delay unit: minute, hour, or day.';
COMMENT ON COLUMN public.auto_automation.daily_time IS
  'Nearest daily wall-clock time in Asia/Ho_Chi_Minh; each source result still enqueues only once.';

-- PostgreSQL identifies a function by name plus input argument types. Rename
-- the v174 functions before publishing the appended optional parameters so
-- PostgREST sees exactly one callable function per RPC name, never an overload.
ALTER FUNCTION public.auto_validate_automation_rule_internal(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean
) RENAME TO auto_validate_automation_rule_v174_internal;

ALTER FUNCTION public.aka_agent_validate_automation_rule(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean, text, text
) RENAME TO aka_agent_validate_automation_rule_v174_internal;

ALTER FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text
) RENAME TO auto_save_automation_v174_internal;

ALTER FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
) RENAME TO materialize_auto_automation_detail_v174_internal;

REVOKE ALL ON FUNCTION public.auto_validate_automation_rule_v174_internal(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_validate_automation_rule_v174_internal(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean, text, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.auto_save_automation_v174_internal(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.materialize_auto_automation_detail_v174_internal(
  bigint, bigint, bigint, text, jsonb, text, text
) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Validation and RPC compatibility
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.auto_validate_automation_rule_internal(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_source_campaign_id bigint,
  p_target_campaign_id bigint,
  p_data_type_code text,
  p_target_contact_group_id bigint,
  p_schedule_mode text,
  p_delay_days integer,
  p_delay_hours integer,
  p_fixed_at timestamptz,
  p_is_active boolean,
  p_require_trigger_statuses boolean,
  p_delay_value integer DEFAULT NULL,
  p_delay_unit text DEFAULT NULL,
  p_daily_time time without time zone DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source record;
  v_target record;
  v_data_type public.auto_automation_data_types%ROWTYPE;
  v_target_mapping public.auto_campaign_action_data_types%ROWTYPE;
  v_group record;
  v_schedule_mode text := lower(NULLIF(btrim(COALESCE(p_schedule_mode, '')), ''));
  v_delay_days integer := COALESCE(p_delay_days, 0);
  v_delay_hours integer := COALESCE(p_delay_hours, 0);
  v_delay_value integer := p_delay_value;
  v_delay_unit text := lower(NULLIF(btrim(COALESCE(p_delay_unit, '')), ''));
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0 THEN
    RAISE EXCEPTION 'invalid_automation_tenant';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
  ) THEN
    RAISE EXCEPTION 'inactive_automation_staff';
  END IF;

  IF p_source_campaign_id IS NULL
    OR p_target_campaign_id IS NULL
    OR p_source_campaign_id = p_target_campaign_id THEN
    RAISE EXCEPTION 'automation_campaigns_must_be_distinct';
  END IF;

  SELECT
    campaign.id,
    campaign.action_id,
    campaign.account_id,
    campaign.staff_id,
    campaign.organization_id,
    campaign_action.flatform_type AS action_flatform_type,
    account.flatform_type AS account_flatform_type
  INTO v_source
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_campaign_actions AS campaign_action
    ON campaign_action.id = campaign.action_id
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
  WHERE campaign.id = p_source_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign_action.is_active = true
    AND COALESCE(campaign_action.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_source_campaign';
  END IF;

  SELECT
    campaign.id,
    campaign.action_id,
    campaign.account_id,
    campaign.staff_id,
    campaign.organization_id,
    campaign.status,
    campaign_action.flatform_type AS action_flatform_type,
    account.flatform_type AS account_flatform_type
  INTO v_target
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_campaign_actions AS campaign_action
    ON campaign_action.id = campaign.action_id
  JOIN public.auto_accounts AS account
    ON account.id = campaign.account_id
  WHERE campaign.id = p_target_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign_action.is_active = true
    AND COALESCE(campaign_action.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_target_campaign';
  END IF;

  SELECT *
  INTO v_data_type
  FROM public.auto_automation_data_types AS data_type
  WHERE data_type.code = p_data_type_code
    AND data_type.is_active = true
    AND data_type.is_delete = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_automation_data_type';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.auto_campaign_action_data_types AS mapping
    WHERE mapping.campaign_action_id = v_source.action_id
      AND mapping.data_type_code = p_data_type_code
      AND mapping.can_source = true
      AND mapping.is_active = true
      AND mapping.is_delete = false
  ) THEN
    RAISE EXCEPTION 'source_campaign_data_type_not_supported';
  END IF;

  SELECT *
  INTO v_target_mapping
  FROM public.auto_campaign_action_data_types AS mapping
  WHERE mapping.campaign_action_id = v_target.action_id
    AND mapping.data_type_code = p_data_type_code
    AND mapping.can_target = true
    AND mapping.is_active = true
    AND mapping.is_delete = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_campaign_data_type_not_supported';
  END IF;

  IF v_data_type.is_account_scoped
    AND v_source.account_id <> v_target.account_id THEN
    RAISE EXCEPTION 'account_scoped_data_requires_same_account';
  END IF;

  IF p_target_contact_group_id IS NOT NULL THEN
    SELECT
      contact_group.id,
      contact_group.account_id,
      contact_group.contact_type,
      contact_group.purpose
    INTO v_group
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_target_contact_group_id
      AND contact_group.account_id = v_target.account_id
      AND contact_group.staff_id = p_staff_id
      AND contact_group.organization_id = p_organization_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.contact_type = v_target_mapping.target_contact_type
      AND contact_group.is_delete = false;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_target_contact_group';
    END IF;
  END IF;

  IF v_schedule_mode IS NULL
    OR v_schedule_mode NOT IN ('immediate', 'after_delay', 'daily_time', 'fixed_at')
    OR v_delay_days < 0
    OR v_delay_days > 3650
    OR v_delay_hours < 0
    OR v_delay_hours > 23 THEN
    RAISE EXCEPTION 'invalid_automation_schedule';
  END IF;

  -- Old clients only send delay_days/delay_hours. Convert those parameters to
  -- the canonical representation without changing their exact duration.
  IF v_schedule_mode = 'after_delay'
    AND v_delay_value IS NULL
    AND v_delay_unit IS NULL
    AND (v_delay_days > 0 OR v_delay_hours > 0) THEN
    IF v_delay_hours = 0 THEN
      v_delay_value := v_delay_days;
      v_delay_unit := 'day';
    ELSE
      v_delay_value := (v_delay_days * 24) + v_delay_hours;
      v_delay_unit := 'hour';
    END IF;
  END IF;

  IF v_schedule_mode = 'immediate'
    AND (
      v_delay_days <> 0
      OR v_delay_hours <> 0
      OR v_delay_value IS NOT NULL
      OR v_delay_unit IS NOT NULL
      OR p_daily_time IS NOT NULL
      OR p_fixed_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'invalid_immediate_schedule';
  ELSIF v_schedule_mode = 'after_delay'
    AND (
      p_fixed_at IS NOT NULL
      OR p_daily_time IS NOT NULL
      OR v_delay_value IS NULL
      OR v_delay_unit IS NULL
      OR v_delay_unit NOT IN ('minute', 'hour', 'day')
      OR v_delay_value <= 0
      OR (v_delay_unit = 'minute' AND v_delay_value > 5256000)
      OR (v_delay_unit = 'hour' AND v_delay_value > 87600)
      OR (v_delay_unit = 'day' AND v_delay_value > 3650)
    ) THEN
    RAISE EXCEPTION 'invalid_delay_schedule';
  ELSIF v_schedule_mode = 'daily_time'
    AND (
      v_delay_days <> 0
      OR v_delay_hours <> 0
      OR v_delay_value IS NOT NULL
      OR v_delay_unit IS NOT NULL
      OR p_daily_time IS NULL
      OR EXTRACT(SECOND FROM p_daily_time) <> 0
      OR p_fixed_at IS NOT NULL
    ) THEN
    RAISE EXCEPTION 'invalid_daily_time_schedule';
  ELSIF v_schedule_mode = 'fixed_at'
    AND (
      p_fixed_at IS NULL
      OR v_delay_days <> 0
      OR v_delay_hours <> 0
      OR v_delay_value IS NOT NULL
      OR v_delay_unit IS NOT NULL
      OR p_daily_time IS NOT NULL
      OR (COALESCE(p_is_active, false) AND p_fixed_at <= clock_timestamp())
    ) THEN
    RAISE EXCEPTION 'invalid_fixed_schedule';
  END IF;

  IF COALESCE(p_require_trigger_statuses, false)
    AND (
      p_automation_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.auto_automation_trigger_statuses AS trigger_status
        WHERE trigger_status.automation_id = p_automation_id
      )
    ) THEN
    RAISE EXCEPTION 'automation_trigger_status_required';
  END IF;

  IF COALESCE(p_is_active, false) AND EXISTS (
    WITH RECURSIVE reachable(campaign_id, visited) AS (
      SELECT
        p_target_campaign_id,
        ARRAY[p_target_campaign_id]::bigint[]

      UNION ALL

      SELECT
        automation.target_campaign_id,
        reachable.visited || automation.target_campaign_id
      FROM reachable
      JOIN public.auto_automation AS automation
        ON automation.source_campaign_id = reachable.campaign_id
      WHERE automation.staff_id = p_staff_id
        AND automation.organization_id = p_organization_id
        AND automation.is_active = true
        AND automation.is_delete = false
        AND (p_automation_id IS NULL OR automation.id <> p_automation_id)
        AND NOT automation.target_campaign_id = ANY(reachable.visited)
    )
    SELECT 1
    FROM reachable
    WHERE reachable.campaign_id = p_source_campaign_id
  ) THEN
    RAISE EXCEPTION 'automation_cycle_detected';
  END IF;

  RETURN jsonb_build_object(
    'source_campaign_id', v_source.id,
    'source_action_id', v_source.action_id,
    'source_account_id', v_source.account_id,
    'target_campaign_id', v_target.id,
    'target_action_id', v_target.action_id,
    'target_account_id', v_target.account_id,
    'data_type_code', v_data_type.code,
    'target_contact_type', v_target_mapping.target_contact_type,
    'schedule_mode', v_schedule_mode,
    'delay_value', v_delay_value,
    'delay_unit', v_delay_unit,
    'daily_time', p_daily_time
  );
END;
$$;

CREATE FUNCTION public.aka_agent_validate_automation_rule(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_source_campaign_id bigint,
  p_target_campaign_id bigint,
  p_data_type_code text,
  p_target_contact_group_id bigint,
  p_schedule_mode text,
  p_delay_days integer,
  p_delay_hours integer,
  p_fixed_at timestamptz,
  p_is_active boolean,
  p_require_trigger_statuses boolean DEFAULT false,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL,
  p_delay_value integer DEFAULT NULL,
  p_delay_unit text DEFAULT NULL,
  p_daily_time time without time zone DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT public.auto_validate_automation_rule_internal(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    COALESCE(p_is_active, false),
    COALESCE(p_require_trigger_statuses, false),
    p_delay_value,
    p_delay_unit,
    p_daily_time
  );
$$;

CREATE FUNCTION public.aka_agent_save_automation(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_name text,
  p_source_campaign_id bigint,
  p_target_campaign_id bigint,
  p_data_type_code text,
  p_target_contact_group_id bigint,
  p_schedule_mode text,
  p_delay_days integer,
  p_delay_hours integer,
  p_fixed_at timestamptz,
  p_note text,
  p_is_active boolean,
  p_trigger_statuses jsonb,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL,
  p_delay_value integer DEFAULT NULL,
  p_delay_unit text DEFAULT NULL,
  p_daily_time time without time zone DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_validation jsonb;
  v_saved jsonb;
  v_rule_id bigint;
  v_schedule_mode text;
  v_delay_value integer;
  v_delay_unit text;
  v_daily_time time without time zone;
  v_legacy_delay_days integer := 0;
  v_legacy_delay_hours integer := 0;
  v_total_legacy_hours integer;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'auto_automation_graph:' || p_staff_id::text || ':' || p_organization_id::text,
    0
  ));

  v_validation := public.auto_validate_automation_rule_internal(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    COALESCE(p_is_active, false),
    false,
    p_delay_value,
    p_delay_unit,
    p_daily_time
  );

  v_schedule_mode := v_validation ->> 'schedule_mode';
  v_delay_value := NULLIF(v_validation ->> 'delay_value', '')::integer;
  v_delay_unit := NULLIF(v_validation ->> 'delay_unit', '');
  v_daily_time := NULLIF(v_validation ->> 'daily_time', '')::time;

  IF v_schedule_mode = 'after_delay' THEN
    CASE v_delay_unit
      WHEN 'day' THEN
        v_legacy_delay_days := v_delay_value;
      WHEN 'hour' THEN
        v_legacy_delay_days := v_delay_value / 24;
        v_legacy_delay_hours := v_delay_value % 24;
      WHEN 'minute' THEN
        -- Minute delays that are not an exact number of hours cannot be
        -- represented by the legacy columns. They remain zero while the
        -- canonical fields retain the exact duration.
        IF v_delay_value % 60 = 0 THEN
          v_total_legacy_hours := v_delay_value / 60;
          v_legacy_delay_days := v_total_legacy_hours / 24;
          v_legacy_delay_hours := v_total_legacy_hours % 24;
        END IF;
      ELSE
        RAISE EXCEPTION 'invalid_delay_schedule';
    END CASE;
  END IF;

  -- The v174 implementation still owns name/status replacement, tenant
  -- checks, activation boundaries and config-version increments. Put an
  -- existing row into a constraint-valid neutral schedule, invoke that proven
  -- implementation, then atomically persist the validated canonical schedule.
  IF p_automation_id IS NOT NULL THEN
    UPDATE public.auto_automation AS automation
    SET
      schedule_mode = 'immediate',
      delay_days = 0,
      delay_hours = 0,
      delay_value = NULL,
      delay_unit = NULL,
      daily_time = NULL,
      fixed_at = NULL
    WHERE automation.id = p_automation_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_delete = false;
  END IF;

  v_saved := public.auto_save_automation_v174_internal(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_name,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    'immediate',
    0,
    0,
    NULL,
    p_note,
    p_is_active,
    p_trigger_statuses,
    p_auth_username,
    p_auth_password
  );

  v_rule_id := NULLIF(v_saved ->> 'id', '')::bigint;
  IF v_rule_id IS NULL THEN
    RAISE EXCEPTION 'automation_save_failed';
  END IF;

  UPDATE public.auto_automation AS automation
  SET
    schedule_mode = v_schedule_mode,
    delay_days = v_legacy_delay_days,
    delay_hours = v_legacy_delay_hours,
    delay_value = v_delay_value,
    delay_unit = v_delay_unit,
    daily_time = v_daily_time,
    fixed_at = p_fixed_at,
    updated_at = clock_timestamp()
  WHERE automation.id = v_rule_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id;

  PERFORM public.auto_validate_automation_rule_internal(
    p_staff_id,
    p_organization_id,
    v_rule_id,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    v_schedule_mode,
    v_legacy_delay_days,
    v_legacy_delay_hours,
    p_fixed_at,
    COALESCE(p_is_active, false),
    true,
    v_delay_value,
    v_delay_unit,
    v_daily_time
  );

  RETURN public.auto_automation_to_json(
    v_rule_id,
    p_staff_id,
    p_organization_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_set_automation_active(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_id bigint,
  p_is_active boolean,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rule public.auto_automation%ROWTYPE;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'auto_automation_graph:' || p_staff_id::text || ':' || p_organization_id::text,
    0
  ));

  SELECT *
  INTO v_rule
  FROM public.auto_automation AS automation
  WHERE automation.id = p_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id
    AND automation.is_delete = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_not_found';
  END IF;

  IF COALESCE(p_is_active, false) THEN
    PERFORM public.auto_validate_automation_rule_internal(
      p_staff_id,
      p_organization_id,
      v_rule.id,
      v_rule.source_campaign_id,
      v_rule.target_campaign_id,
      v_rule.data_type_code,
      v_rule.target_contact_group_id,
      v_rule.schedule_mode,
      v_rule.delay_days,
      v_rule.delay_hours,
      v_rule.fixed_at,
      true,
      true,
      v_rule.delay_value,
      v_rule.delay_unit,
      v_rule.daily_time
    );
  END IF;

  UPDATE public.auto_automation AS automation
  SET
    is_active = COALESCE(p_is_active, false),
    activated_at = CASE
      WHEN COALESCE(p_is_active, false) AND NOT automation.is_active
        THEN clock_timestamp()
      ELSE automation.activated_at
    END,
    updated_at = clock_timestamp()
  WHERE automation.id = v_rule.id;

  RETURN public.auto_automation_to_json(
    v_rule.id,
    p_staff_id,
    p_organization_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Immutable execution schedule snapshot
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aka_agent_prepare_automation_detail_schedule()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_rule public.auto_automation%ROWTYPE;
  v_event_at timestamptz := COALESCE(NEW.created_at, clock_timestamp());
  v_local_event timestamp without time zone;
  v_local_schedule timestamp without time zone;
BEGIN
  SELECT *
  INTO v_rule
  FROM public.auto_automation AS automation
  WHERE automation.id = NEW.automation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_not_found';
  END IF;

  CASE v_rule.schedule_mode
    WHEN 'immediate' THEN
      NEW.scheduled_at := v_event_at;
    WHEN 'after_delay' THEN
      NEW.scheduled_at := CASE v_rule.delay_unit
        WHEN 'minute' THEN v_event_at + make_interval(mins => v_rule.delay_value)
        WHEN 'hour' THEN v_event_at + make_interval(hours => v_rule.delay_value)
        WHEN 'day' THEN v_event_at + make_interval(days => v_rule.delay_value)
        ELSE NULL
      END;

      IF NEW.scheduled_at IS NULL THEN
        RAISE EXCEPTION 'invalid_delay_schedule';
      END IF;
    WHEN 'daily_time' THEN
      v_local_event := v_event_at AT TIME ZONE 'Asia/Ho_Chi_Minh';
      v_local_schedule := v_local_event::date + v_rule.daily_time;

      -- Equality belongs to today. Only a strictly passed wall-clock time
      -- moves the one-shot execution to tomorrow.
      IF v_local_event > v_local_schedule THEN
        v_local_schedule := v_local_schedule + interval '1 day';
      END IF;

      NEW.scheduled_at := v_local_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh';
    WHEN 'fixed_at' THEN
      NEW.scheduled_at := v_rule.fixed_at;
    ELSE
      RAISE EXCEPTION 'invalid_automation_schedule';
  END CASE;

  -- Claim/materialize immediately. scheduled_at is copied to the target input
  -- later and gates the target campaign scheduler, not the automation worker.
  NEW.next_attempt_at := v_event_at;

  NEW.config_snapshot := COALESCE(NEW.config_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'schedule_mode', v_rule.schedule_mode,
      'delay_days', v_rule.delay_days,
      'delay_hours', v_rule.delay_hours,
      'delay_value', v_rule.delay_value,
      'delay_unit', v_rule.delay_unit,
      'daily_time', v_rule.daily_time,
      'fixed_at', v_rule.fixed_at,
      'schedule_time_zone', 'Asia/Ho_Chi_Minh',
      'scheduled_at', NEW.scheduled_at
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_aka_agent_prepare_automation_detail_schedule
  ON public.auto_automation_detail;
CREATE TRIGGER trg_aka_agent_prepare_automation_detail_schedule
  BEFORE INSERT ON public.auto_automation_detail
  FOR EACH ROW
  EXECUTE FUNCTION public.aka_agent_prepare_automation_detail_schedule();

-- Initial v174 executions used the future run schedule as their first claim
-- time. Make only never-attempted queued rows immediately claimable; deliberate
-- retry backoff (attempt_count > 0) remains untouched.
UPDATE public.auto_automation_detail AS detail
SET
  next_attempt_at = detail.created_at,
  updated_at = clock_timestamp()
WHERE detail.status = 'chờ xử lý'
  AND detail.attempt_count = 0
  AND detail.next_attempt_at > detail.created_at;

-- ---------------------------------------------------------------------------
-- Worker claim: gate only on next_attempt_at, never on target scheduled_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_auto_automation_details(
  p_staff_id bigint,
  p_organization_id bigint,
  p_worker_id text,
  p_limit integer DEFAULT 50,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS TABLE (
  automation_detail_id bigint,
  automation_id bigint,
  parent_automation_detail_id bigint,
  source_campaign_detail_id bigint,
  source_campaign_input_data_id bigint,
  source_campaign_id bigint,
  source_account_id bigint,
  source_action_id text,
  source_action_code text,
  source_status text,
  target_campaign_id bigint,
  target_account_id bigint,
  target_action_id text,
  data_type_code text,
  data_value text,
  source_input_snapshot jsonb,
  config_snapshot jsonb,
  target_contact_group_id bigint,
  scheduled_at timestamptz,
  target_row_index bigint,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_execution record;
  v_row_index bigint;
  v_existing_input_count bigint;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF NULLIF(btrim(COALESCE(p_worker_id, '')), '') IS NULL
    OR length(btrim(p_worker_id)) > 200 THEN
    RAISE EXCEPTION 'invalid_automation_worker_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff AS staff
    WHERE staff.id = p_staff_id
      AND staff.organization_id = p_organization_id
      AND staff.is_active = true
  ) THEN
    RAISE EXCEPTION 'inactive_automation_staff';
  END IF;

  FOR v_execution IN
    SELECT detail.id, detail.target_campaign_id, detail.target_row_index
    FROM public.auto_automation_detail AS detail
    JOIN public.auto_automation AS automation
      ON automation.id = detail.automation_id
    WHERE detail.staff_id = p_staff_id
      AND detail.organization_id = p_organization_id
      AND detail.status = 'chờ xử lý'
      AND detail.next_attempt_at <= clock_timestamp()
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_active = true
      AND automation.is_delete = false
    ORDER BY
      detail.next_attempt_at ASC,
      detail.scheduled_at ASC,
      detail.created_at ASC,
      detail.id ASC
    FOR UPDATE OF detail SKIP LOCKED
    LIMIT v_limit
  LOOP
    v_row_index := v_execution.target_row_index;

    IF v_row_index IS NULL THEN
      SELECT count(*)::bigint
      INTO v_existing_input_count
      FROM public.auto_campaign_input_data AS input_data
      WHERE input_data.campaign_id = v_execution.target_campaign_id
        AND COALESCE(input_data.is_delete, false) = false;

      INSERT INTO public.auto_automation_target_counters AS counter (
        target_campaign_id,
        next_row_index,
        staff_id,
        organization_id,
        updated_at
      )
      VALUES (
        v_execution.target_campaign_id,
        v_existing_input_count + 1,
        p_staff_id,
        p_organization_id,
        clock_timestamp()
      )
      ON CONFLICT ON CONSTRAINT auto_automation_target_counters_pkey
      DO UPDATE SET
        next_row_index = GREATEST(
          counter.next_row_index + 1,
          EXCLUDED.next_row_index
        ),
        updated_at = clock_timestamp()
      RETURNING counter.next_row_index - 1
      INTO v_row_index;
    END IF;

    UPDATE public.auto_automation_detail AS detail
    SET
      status = 'đang xử lý',
      target_row_index = v_row_index,
      attempt_count = detail.attempt_count + 1,
      locked_at = clock_timestamp(),
      locked_by = btrim(p_worker_id),
      last_error = NULL,
      updated_at = clock_timestamp()
    WHERE detail.id = v_execution.id;

    RETURN QUERY
    SELECT
      claimed.id,
      claimed.automation_id,
      claimed.parent_automation_detail_id,
      claimed.source_campaign_detail_id,
      claimed.source_campaign_input_data_id,
      claimed.source_campaign_id,
      claimed.source_account_id,
      claimed.source_action_id,
      claimed.source_action_code,
      claimed.source_status,
      claimed.target_campaign_id,
      claimed.target_account_id,
      claimed.target_action_id,
      claimed.data_type_code,
      claimed.data_value,
      claimed.source_input_snapshot,
      claimed.config_snapshot,
      claimed.target_contact_group_id,
      claimed.scheduled_at,
      claimed.target_row_index,
      claimed.attempt_count
    FROM public.auto_automation_detail AS claimed
    WHERE claimed.id = v_execution.id;
  END LOOP;
END;
$$;

-- Keep the proven v174 materialization/idempotency behavior, then make the
-- campaign runtime schedule exactly match its earliest pending input. This
-- corrects a stale/past campaign.schedule without ever changing
-- auto_campaigns.original_schedule.
CREATE FUNCTION public.materialize_auto_automation_detail(
  p_staff_id bigint,
  p_organization_id bigint,
  p_automation_detail_id bigint,
  p_worker_id text,
  p_target_input jsonb,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
  v_target_campaign_id bigint;
  v_earliest_pending_schedule timestamptz;
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  v_result := public.materialize_auto_automation_detail_v174_internal(
    p_staff_id,
    p_organization_id,
    p_automation_detail_id,
    p_worker_id,
    p_target_input,
    p_auth_username,
    p_auth_password
  );

  IF v_result ->> 'result' IN ('materialized', 'already_materialized') THEN
    SELECT detail.target_campaign_id
    INTO v_target_campaign_id
    FROM public.auto_automation_detail AS detail
    WHERE detail.id = p_automation_detail_id
      AND detail.staff_id = p_staff_id
      AND detail.organization_id = p_organization_id
      AND detail.target_input_data_id IS NOT NULL;

    IF v_target_campaign_id IS NOT NULL THEN
      -- The v174 materialized path already holds this row lock; the
      -- already-materialized path does not. Lock in both paths so the
      -- scheduler cannot complete the final pending input between MIN() and
      -- the campaign update, which would otherwise reopen a completed target.
      PERFORM campaign.id
      FROM public.auto_campaigns AS campaign
      WHERE campaign.id = v_target_campaign_id
        AND campaign.staff_id = p_staff_id
        AND campaign.organization_id = p_organization_id
        AND COALESCE(campaign.is_delete, false) = false
      FOR UPDATE;

      IF FOUND THEN
        SELECT min(COALESCE(
          input_data.schedule,
          input_data.created_at,
          clock_timestamp()
        ))
        INTO v_earliest_pending_schedule
        FROM public.auto_campaign_input_data AS input_data
        WHERE input_data.campaign_id = v_target_campaign_id
          AND input_data.status = 'chờ xử lý'
          AND COALESCE(input_data.is_delete, false) = false;

        IF v_earliest_pending_schedule IS NOT NULL THEN
          UPDATE public.auto_campaigns AS campaign
          SET
            status = CASE
              WHEN campaign.status = 'hoàn thành' THEN 'chờ xử lý'
              ELSE campaign.status
            END,
            schedule = v_earliest_pending_schedule,
            completed_at = CASE
              WHEN campaign.status = 'hoàn thành' THEN NULL
              ELSE campaign.completed_at
            END,
            note = CASE
              WHEN campaign.status = 'hoàn thành' THEN NULL
              ELSE campaign.note
            END,
            updated_at = clock_timestamp()
          WHERE campaign.id = v_target_campaign_id;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges and PostgREST schema refresh
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.auto_validate_automation_rule_internal(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean,
  integer, text, time without time zone
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.aka_agent_prepare_automation_detail_schedule()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.aka_agent_validate_automation_rule(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean, text, text,
  integer, text, time without time zone
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
  integer, text, time without time zone
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.aka_agent_set_automation_active(
  bigint, bigint, bigint, boolean, text, text
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_auto_automation_details(
  bigint, bigint, text, integer, text, text
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.aka_agent_validate_automation_rule(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean, text, text,
  integer, text, time without time zone
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
  integer, text, time without time zone
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_set_automation_active(
  bigint, bigint, bigint, boolean, text, text
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_auto_automation_details(
  bigint, bigint, text, integer, text, text
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.materialize_auto_automation_detail(
  bigint, bigint, bigint, text, jsonb, text, text
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
