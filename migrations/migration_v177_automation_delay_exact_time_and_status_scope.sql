-- Add an optional exact wall-clock time after a canonical automation delay,
-- and expose campaign-detail status scopes without collapsing wildcard and
-- action-specific mappings that happen to share the same visible label.

BEGIN;

-- ---------------------------------------------------------------------------
-- Exact wall-clock time after a minimum delay
-- ---------------------------------------------------------------------------

ALTER TABLE public.auto_automation
  ADD COLUMN IF NOT EXISTS delay_exact_time time without time zone;

ALTER TABLE public.auto_automation
  DROP CONSTRAINT IF EXISTS auto_automation_schedule_config_check,
  DROP CONSTRAINT IF EXISTS auto_automation_delay_exact_time_minute_check;

ALTER TABLE public.auto_automation
  ADD CONSTRAINT auto_automation_delay_exact_time_minute_check
    CHECK (
      delay_exact_time IS NULL
      OR (
        delay_exact_time < time '24:00'
        AND EXTRACT(SECOND FROM delay_exact_time) = 0
      )
    ),
  ADD CONSTRAINT auto_automation_schedule_config_check
    CHECK ((
      (
        schedule_mode = 'immediate'
        AND delay_days = 0
        AND delay_hours = 0
        AND delay_value IS NULL
        AND delay_unit IS NULL
        AND delay_exact_time IS NULL
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
        AND delay_exact_time IS NULL
        AND daily_time IS NOT NULL
        AND fixed_at IS NULL
      )
      OR (
        schedule_mode = 'fixed_at'
        AND delay_days = 0
        AND delay_hours = 0
        AND delay_value IS NULL
        AND delay_unit IS NULL
        AND delay_exact_time IS NULL
        AND daily_time IS NULL
        AND fixed_at IS NOT NULL
      )
    ) IS TRUE);

COMMENT ON COLUMN public.auto_automation.delay_exact_time IS
  'Optional Asia/Ho_Chi_Minh HH:mm alignment after the full after_delay duration has elapsed.';

-- Rename v176 signatures before adding optional arguments. PostgREST does not
-- support overloaded functions, so every public RPC name must resolve to one
-- callable signature only.
DO $rename_v176_signatures$
BEGIN
  IF to_regprocedure(
    'public.auto_validate_automation_rule_internal(bigint,bigint,bigint,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,boolean,boolean,integer,text,time without time zone)'
  ) IS NOT NULL
    AND to_regprocedure(
      'public.auto_validate_automation_rule_v176_internal(bigint,bigint,bigint,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,boolean,boolean,integer,text,time without time zone)'
    ) IS NULL THEN
    ALTER FUNCTION public.auto_validate_automation_rule_internal(
      bigint, bigint, bigint, bigint, bigint, text, bigint,
      text, integer, integer, timestamptz, boolean, boolean,
      integer, text, time without time zone
    ) RENAME TO auto_validate_automation_rule_v176_internal;
  END IF;

  IF to_regprocedure(
    'public.aka_agent_validate_automation_rule(bigint,bigint,bigint,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,boolean,boolean,text,text,integer,text,time without time zone)'
  ) IS NOT NULL
    AND to_regprocedure(
      'public.aka_agent_validate_automation_rule_v176_internal(bigint,bigint,bigint,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,boolean,boolean,text,text,integer,text,time without time zone)'
    ) IS NULL THEN
    ALTER FUNCTION public.aka_agent_validate_automation_rule(
      bigint, bigint, bigint, bigint, bigint, text, bigint,
      text, integer, integer, timestamptz, boolean, boolean, text, text,
      integer, text, time without time zone
    ) RENAME TO aka_agent_validate_automation_rule_v176_internal;
  END IF;

  IF to_regprocedure(
    'public.aka_agent_save_automation(bigint,bigint,bigint,text,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone)'
  ) IS NOT NULL
    AND to_regprocedure(
      'public.aka_agent_save_automation_v176_internal(bigint,bigint,bigint,text,bigint,bigint,text,bigint,text,integer,integer,timestamp with time zone,text,boolean,jsonb,text,text,integer,text,time without time zone)'
    ) IS NULL THEN
    ALTER FUNCTION public.aka_agent_save_automation(
      bigint, bigint, bigint, text, bigint, bigint, text, bigint,
      text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
      integer, text, time without time zone
    ) RENAME TO aka_agent_save_automation_v176_internal;
  END IF;
END;
$rename_v176_signatures$;

REVOKE ALL ON FUNCTION public.auto_validate_automation_rule_v176_internal(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean,
  integer, text, time without time zone
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_validate_automation_rule_v176_internal(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean, text, text,
  integer, text, time without time zone
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_save_automation_v176_internal(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
  integer, text, time without time zone
) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Validation and one-signature RPC compatibility
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_validate_automation_rule_internal(
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
  p_daily_time time without time zone DEFAULT NULL,
  p_delay_exact_time time without time zone DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_result jsonb;
  v_schedule_mode text := lower(NULLIF(btrim(COALESCE(p_schedule_mode, '')), ''));
BEGIN
  v_result := public.auto_validate_automation_rule_v176_internal(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    p_delay_days,
    p_delay_hours,
    p_fixed_at,
    p_is_active,
    p_require_trigger_statuses,
    p_delay_value,
    p_delay_unit,
    p_daily_time
  );

  IF p_delay_exact_time IS NOT NULL
    AND (
      v_schedule_mode <> 'after_delay'
      OR p_delay_exact_time >= time '24:00'
      OR EXTRACT(SECOND FROM p_delay_exact_time) <> 0
    ) THEN
    RAISE EXCEPTION 'invalid_delay_exact_time_schedule';
  END IF;

  RETURN v_result || jsonb_build_object(
    'delay_exact_time', p_delay_exact_time
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_validate_automation_rule(
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
  p_daily_time time without time zone DEFAULT NULL,
  p_delay_exact_time time without time zone DEFAULT NULL,
  p_delay_exact_time_present boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_delay_exact_time time without time zone;
  v_schedule_mode text := lower(NULLIF(btrim(COALESCE(p_schedule_mode, '')), ''));
BEGIN
  PERFORM public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  IF v_schedule_mode = 'after_delay' THEN
    IF COALESCE(p_delay_exact_time_present, false) THEN
      v_delay_exact_time := p_delay_exact_time;
    ELSIF p_automation_id IS NOT NULL THEN
      SELECT automation.delay_exact_time
      INTO v_delay_exact_time
      FROM public.auto_automation AS automation
      WHERE automation.id = p_automation_id
        AND automation.staff_id = p_staff_id
        AND automation.organization_id = p_organization_id
        AND automation.is_delete = false;
    END IF;
  END IF;

  RETURN public.auto_validate_automation_rule_internal(
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
    p_daily_time,
    v_delay_exact_time
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_save_automation(
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
  p_daily_time time without time zone DEFAULT NULL,
  p_delay_exact_time time without time zone DEFAULT NULL,
  p_delay_exact_time_present boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_saved jsonb;
  v_rule_id bigint;
  v_source_action_id text;
  v_schedule_mode text := lower(NULLIF(btrim(COALESCE(p_schedule_mode, '')), ''));
  v_effective_delay_exact_time time without time zone;
  v_status jsonb;
  v_status_mapping_id bigint;
  v_status_mapping_id_text text;
  v_mapping record;
  v_normalized_statuses jsonb := '[]'::jsonb;
  v_canonical_statuses jsonb := '[]'::jsonb;
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

  SELECT campaign.action_id
  INTO v_source_action_id
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_source_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false;

  IF v_source_action_id IS NULL THEN
    RAISE EXCEPTION 'invalid_source_campaign';
  END IF;

  IF jsonb_typeof(COALESCE(p_trigger_statuses, 'null'::jsonb)) <> 'array'
    OR jsonb_array_length(p_trigger_statuses) = 0
    OR jsonb_array_length(p_trigger_statuses) > 100 THEN
    RAISE EXCEPTION 'invalid_automation_trigger_statuses';
  END IF;

  FOR v_status IN
    SELECT item.value
    FROM jsonb_array_elements(p_trigger_statuses) AS item(value)
  LOOP
    IF jsonb_typeof(v_status) <> 'object' THEN
      RAISE EXCEPTION 'invalid_automation_trigger_status';
    END IF;

    v_status_mapping_id := NULL;
    v_status_mapping_id_text := NULLIF(btrim(COALESCE(
      v_status ->> 'statusMappingId',
      v_status ->> 'status_mapping_id',
      ''
    )), '');

    IF v_status_mapping_id_text IS NOT NULL THEN
      IF v_status_mapping_id_text !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'invalid_automation_trigger_status';
      END IF;

      v_status_mapping_id := v_status_mapping_id_text::bigint;

      SELECT
        status_mapping.id,
        status_mapping.action_code,
        status_mapping.status_id,
        status_mapping.status_value,
        status_mapping.label
      INTO v_mapping
      FROM public.auto_campaign_action_detail_statuses AS status_mapping
      WHERE status_mapping.id = v_status_mapping_id
        AND status_mapping.campaign_action_id = v_source_action_id
        AND status_mapping.is_active = true
        AND status_mapping.is_delete = false;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'invalid_automation_trigger_status';
      END IF;

      v_normalized_statuses := v_normalized_statuses || jsonb_build_array(
        jsonb_build_object(
          'statusMappingId', v_mapping.id,
          'semanticStatusId', v_mapping.status_id,
          'actionCode', v_mapping.action_code,
          'statusValue', v_mapping.status_value
        )
      );
    ELSE
      -- Legacy clients continue to submit actionCode + statusValue. The v176
      -- implementation remains the compatibility resolver/create path.
      v_normalized_statuses := v_normalized_statuses || jsonb_build_array(
        jsonb_build_object(
          'actionCode', NULLIF(btrim(COALESCE(
            v_status ->> 'actionCode',
            v_status ->> 'action_code',
            ''
          )), ''),
          'statusValue', NULLIF(btrim(COALESCE(
            v_status ->> 'statusValue',
            v_status ->> 'status_value',
            v_status ->> 'status',
            ''
          )), '')
        )
      );
    END IF;
  END LOOP;

  -- A wildcard status already includes every specific action with the same
  -- semantic status. Keep it and discard only those redundant specifics.
  SELECT COALESCE(jsonb_agg(candidate.value ORDER BY candidate.ordinality), '[]'::jsonb)
  INTO v_canonical_statuses
  FROM jsonb_array_elements(v_normalized_statuses) WITH ORDINALITY AS candidate(value, ordinality)
  WHERE NULLIF(btrim(COALESCE(candidate.value ->> 'actionCode', '')), '') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_normalized_statuses) AS wildcard(value)
      WHERE NULLIF(btrim(COALESCE(wildcard.value ->> 'actionCode', '')), '') IS NULL
        AND (
          lower(COALESCE(wildcard.value ->> 'statusValue', ''))
            = lower(COALESCE(candidate.value ->> 'statusValue', ''))
          OR (
            NULLIF(wildcard.value ->> 'semanticStatusId', '') IS NOT NULL
            AND NULLIF(candidate.value ->> 'semanticStatusId', '') IS NOT NULL
            AND (wildcard.value ->> 'semanticStatusId')
              = (candidate.value ->> 'semanticStatusId')
          )
        )
    );

  IF v_schedule_mode = 'after_delay' THEN
    IF COALESCE(p_delay_exact_time_present, false) THEN
      v_effective_delay_exact_time := p_delay_exact_time;
    ELSIF p_automation_id IS NOT NULL THEN
      SELECT automation.delay_exact_time
      INTO v_effective_delay_exact_time
      FROM public.auto_automation AS automation
      WHERE automation.id = p_automation_id
        AND automation.staff_id = p_staff_id
        AND automation.organization_id = p_organization_id
        AND automation.is_delete = false
      FOR UPDATE;
    END IF;
  END IF;

  -- Validate before touching the existing row so invalid HH:mm values return
  -- the domain error rather than a generic CHECK violation.
  PERFORM public.auto_validate_automation_rule_internal(
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
    p_daily_time,
    v_effective_delay_exact_time
  );

  IF p_automation_id IS NOT NULL THEN
    -- v176 temporarily neutralizes the schedule to immediate. Clear the new
    -- field first so that neutral state remains constraint-valid.
    UPDATE public.auto_automation AS automation
    SET delay_exact_time = NULL
    WHERE automation.id = p_automation_id
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_delete = false;
  END IF;

  v_saved := public.aka_agent_save_automation_v176_internal(
    p_staff_id,
    p_organization_id,
    p_automation_id,
    p_name,
    p_source_campaign_id,
    p_target_campaign_id,
    p_data_type_code,
    p_target_contact_group_id,
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    p_note,
    p_is_active,
    v_canonical_statuses,
    p_auth_username,
    p_auth_password,
    p_delay_value,
    p_delay_unit,
    p_daily_time
  );

  v_rule_id := NULLIF(v_saved ->> 'id', '')::bigint;
  IF v_rule_id IS NULL THEN
    RAISE EXCEPTION 'automation_save_failed';
  END IF;

  UPDATE public.auto_automation AS automation
  SET
    delay_exact_time = CASE
      WHEN automation.schedule_mode = 'after_delay'
        THEN v_effective_delay_exact_time
      ELSE NULL
    END,
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
    p_schedule_mode,
    COALESCE(p_delay_days, 0),
    COALESCE(p_delay_hours, 0),
    p_fixed_at,
    COALESCE(p_is_active, false),
    true,
    p_delay_value,
    p_delay_unit,
    p_daily_time,
    v_effective_delay_exact_time
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
      v_rule.daily_time,
      v_rule.delay_exact_time
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

-- A database-level guard keeps every stored trigger status canonical even for
-- trusted/service writes that bypass the public save RPC.
CREATE OR REPLACE FUNCTION public.aka_agent_guard_automation_trigger_status_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_mapping record;
BEGIN
  SELECT
    status_mapping.action_code,
    status_mapping.status_value
  INTO v_mapping
  FROM public.auto_automation AS automation
  JOIN public.auto_campaigns AS source_campaign
    ON source_campaign.id = automation.source_campaign_id
  JOIN public.auto_campaign_action_detail_statuses AS status_mapping
    ON status_mapping.id = NEW.status_mapping_id
   AND status_mapping.campaign_action_id = source_campaign.action_id
   AND status_mapping.is_active = true
   AND status_mapping.is_delete = false
  WHERE automation.id = NEW.automation_id
    AND automation.is_delete = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_automation_trigger_status';
  END IF;

  NEW.action_code := v_mapping.action_code;
  NEW.status_value := v_mapping.status_value;
  RETURN NEW;
END;
$$;

-- Normalize legacy selections that stored both a wildcard and one or more
-- action-specific rows for the same semantic status. The wildcard already
-- covers those actions, so it wins and the specific rows are redundant.
DELETE FROM public.auto_automation_trigger_statuses AS specific
USING public.auto_campaign_action_detail_statuses AS specific_mapping,
  public.auto_automation_trigger_statuses AS wildcard,
  public.auto_campaign_action_detail_statuses AS wildcard_mapping
WHERE specific.status_mapping_id = specific_mapping.id
  AND specific.action_code IS NOT NULL
  AND wildcard.automation_id = specific.automation_id
  AND wildcard.action_code IS NULL
  AND wildcard.status_mapping_id = wildcard_mapping.id
  AND (
    lower(wildcard.status_value) = lower(specific.status_value)
    OR (
      wildcard_mapping.status_id IS NOT NULL
      AND specific_mapping.status_id IS NOT NULL
      AND wildcard_mapping.status_id = specific_mapping.status_id
    )
  );

DO $scope_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.auto_automation_trigger_statuses AS trigger_status
    JOIN public.auto_automation AS automation
      ON automation.id = trigger_status.automation_id
    JOIN public.auto_campaigns AS source_campaign
      ON source_campaign.id = automation.source_campaign_id
    LEFT JOIN public.auto_campaign_action_detail_statuses AS status_mapping
      ON status_mapping.id = trigger_status.status_mapping_id
    WHERE status_mapping.id IS NULL
      OR status_mapping.campaign_action_id <> source_campaign.action_id
      OR status_mapping.is_active = false
      OR status_mapping.is_delete = true
      OR trigger_status.action_code IS DISTINCT FROM status_mapping.action_code
      OR lower(trigger_status.status_value) <> lower(status_mapping.status_value)
  ) THEN
    RAISE EXCEPTION 'automation_trigger_status_scope_preflight_failed';
  END IF;
END;
$scope_preflight$;

DROP TRIGGER IF EXISTS trg_aka_agent_guard_automation_trigger_status_scope
  ON public.auto_automation_trigger_statuses;
CREATE TRIGGER trg_aka_agent_guard_automation_trigger_status_scope
  BEFORE INSERT OR UPDATE OF automation_id, status_mapping_id, action_code, status_value
  ON public.auto_automation_trigger_statuses
  FOR EACH ROW
  EXECUTE FUNCTION public.aka_agent_guard_automation_trigger_status_scope();

-- ---------------------------------------------------------------------------
-- JSON/API projection with visible status scope metadata
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_automation_to_json(
  p_automation_id bigint,
  p_staff_id bigint,
  p_organization_id bigint
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    to_jsonb(automation)
    || jsonb_build_object(
      'automation_action_name', automation_action.name,
      'data_type_name', data_type.name,
      'source_campaign', jsonb_build_object(
        'id', source_campaign.id,
        'name', source_campaign.name,
        'action_id', source_campaign.action_id,
        'action_name', source_action.name,
        'account_id', source_campaign.account_id,
        'account_name', source_account.name,
        'flatform_type', source_action.flatform_type
      ),
      'target_campaign', jsonb_build_object(
        'id', target_campaign.id,
        'name', target_campaign.name,
        'action_id', target_campaign.action_id,
        'action_name', target_action.name,
        'account_id', target_campaign.account_id,
        'account_name', target_account.name,
        'flatform_type', target_action.flatform_type
      ),
      'target_contact_group', CASE
        WHEN target_group.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', target_group.id,
          'name', target_group.name,
          'contact_type', target_group.contact_type,
          'purpose', target_group.purpose
        )
      END,
      'trigger_statuses', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', trigger_status.id,
            'status_mapping_id', trigger_status.status_mapping_id,
            'semantic_status_id', status_mapping.status_id,
            'action_code', trigger_status.action_code,
            'action_name', account_action.name,
            'is_wildcard', trigger_status.action_code IS NULL,
            'status_value', trigger_status.status_value,
            'status_label', COALESCE(status_mapping.label, trigger_status.status_value)
          )
          ORDER BY lower(trigger_status.status_value),
            status_mapping.sort_order,
            trigger_status.id
        )
        FROM public.auto_automation_trigger_statuses AS trigger_status
        JOIN public.auto_campaign_action_detail_statuses AS status_mapping
          ON status_mapping.id = trigger_status.status_mapping_id
        LEFT JOIN public.auto_account_actions AS account_action
          ON account_action.code = trigger_status.action_code
        WHERE trigger_status.automation_id = automation.id
      ), '[]'::jsonb),
      'execution_summary', jsonb_build_object(
        'total', COALESCE(execution_count.total, 0),
        'queued', COALESCE(execution_count.queued, 0),
        'processing', COALESCE(execution_count.processing, 0),
        'materialized', COALESCE(execution_count.materialized, 0),
        'skipped', COALESCE(execution_count.skipped, 0),
        'failed', COALESCE(execution_count.failed, 0),
        'latest_status', latest_execution.status,
        'latest_created_at', latest_execution.created_at,
        'latest_processed_at', latest_execution.processed_at
      )
    )
  FROM public.auto_automation AS automation
  JOIN public.auto_automation_actions AS automation_action
    ON automation_action.id = automation.automation_action_id
  JOIN public.auto_automation_data_types AS data_type
    ON data_type.code = automation.data_type_code
  JOIN public.auto_campaigns AS source_campaign
    ON source_campaign.id = automation.source_campaign_id
  JOIN public.auto_campaign_actions AS source_action
    ON source_action.id = source_campaign.action_id
  JOIN public.auto_accounts AS source_account
    ON source_account.id = source_campaign.account_id
  JOIN public.auto_campaigns AS target_campaign
    ON target_campaign.id = automation.target_campaign_id
  JOIN public.auto_campaign_actions AS target_action
    ON target_action.id = target_campaign.action_id
  JOIN public.auto_accounts AS target_account
    ON target_account.id = target_campaign.account_id
  LEFT JOIN public.auto_account_contact_groups AS target_group
    ON target_group.id = automation.target_contact_group_id
  LEFT JOIN LATERAL (
    SELECT
      count(*)::integer AS total,
      count(*) FILTER (WHERE detail.status = 'chờ xử lý')::integer AS queued,
      count(*) FILTER (WHERE detail.status = 'đang xử lý')::integer AS processing,
      count(*) FILTER (WHERE detail.status = 'đã thêm')::integer AS materialized,
      count(*) FILTER (WHERE detail.status = 'bỏ qua')::integer AS skipped,
      count(*) FILTER (WHERE detail.status = 'lỗi')::integer AS failed
    FROM public.auto_automation_detail AS detail
    WHERE detail.automation_id = automation.id
  ) AS execution_count ON true
  LEFT JOIN LATERAL (
    SELECT detail.status, detail.created_at, detail.processed_at
    FROM public.auto_automation_detail AS detail
    WHERE detail.automation_id = automation.id
    ORDER BY detail.created_at DESC, detail.id DESC
    LIMIT 1
  ) AS latest_execution ON true
  WHERE automation.id = p_automation_id
    AND automation.staff_id = p_staff_id
    AND automation.organization_id = p_organization_id;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_get_automation_options(
  p_staff_id bigint,
  p_organization_id bigint,
  p_auth_username text DEFAULT NULL,
  p_auth_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.auto_assert_automation_identity(
    p_staff_id,
    p_organization_id,
    p_auth_username,
    p_auth_password
  );

  SELECT jsonb_build_object(
    'automation_actions', COALESCE((
      SELECT jsonb_agg(to_jsonb(automation_action) ORDER BY automation_action.sort_order, automation_action.id)
      FROM public.auto_automation_actions AS automation_action
      WHERE automation_action.is_active = true
        AND automation_action.is_delete = false
    ), '[]'::jsonb),
    'data_types', COALESCE((
      SELECT jsonb_agg(to_jsonb(data_type) ORDER BY data_type.sort_order, data_type.code)
      FROM public.auto_automation_data_types AS data_type
      WHERE data_type.is_active = true
        AND data_type.is_delete = false
    ), '[]'::jsonb),
    'action_data_types', COALESCE((
      SELECT jsonb_agg(to_jsonb(mapping) ORDER BY mapping.sort_order, mapping.campaign_action_id, mapping.data_type_code)
      FROM public.auto_campaign_action_data_types AS mapping
      WHERE mapping.is_active = true
        AND mapping.is_delete = false
    ), '[]'::jsonb),
    'campaigns', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', campaign.id,
          'name', campaign.name,
          'action_id', campaign.action_id,
          'action_name', campaign_action.name,
          'account_id', campaign.account_id,
          'account_name', account.name,
          'flatform_type', campaign_action.flatform_type,
          'status', campaign.status,
          'schedule', campaign.schedule,
          'original_schedule', campaign.original_schedule,
          'data_types', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'code', mapping.data_type_code,
                'can_source', mapping.can_source,
                'can_target', mapping.can_target,
                'target_contact_type', mapping.target_contact_type
              )
              ORDER BY mapping.sort_order, mapping.data_type_code
            )
            FROM public.auto_campaign_action_data_types AS mapping
            WHERE mapping.campaign_action_id = campaign.action_id
              AND mapping.is_active = true
              AND mapping.is_delete = false
          ), '[]'::jsonb)
        )
        ORDER BY campaign.updated_at DESC, campaign.id DESC
      )
      FROM public.auto_campaigns AS campaign
      JOIN public.auto_campaign_actions AS campaign_action
        ON campaign_action.id = campaign.action_id
      JOIN public.auto_accounts AS account
        ON account.id = campaign.account_id
      WHERE campaign.staff_id = p_staff_id
        AND campaign.organization_id = p_organization_id
        AND COALESCE(campaign.is_delete, false) = false
        AND campaign_action.is_active = true
        AND COALESCE(campaign_action.is_delete, false) = false
        AND account.staff_id = p_staff_id
        AND account.organization_id = p_organization_id
        AND COALESCE(account.is_delete, false) = false
        AND EXISTS (
          SELECT 1
          FROM public.auto_campaign_action_data_types AS mapping
          WHERE mapping.campaign_action_id = campaign.action_id
            AND mapping.is_active = true
            AND mapping.is_delete = false
        )
    ), '[]'::jsonb),
    'contact_groups', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', contact_group.id,
          'name', contact_group.name,
          'account_id', contact_group.account_id,
          'contact_type', contact_group.contact_type,
          'purpose', contact_group.purpose
        )
        ORDER BY lower(contact_group.name), contact_group.id
      )
      FROM public.auto_account_contact_groups AS contact_group
      JOIN public.auto_accounts AS account
        ON account.id = contact_group.account_id
      WHERE contact_group.staff_id = p_staff_id
        AND contact_group.organization_id = p_organization_id
        AND contact_group.purpose = 'data_group'
        AND contact_group.is_delete = false
        AND account.staff_id = p_staff_id
        AND account.organization_id = p_organization_id
        AND COALESCE(account.is_delete, false) = false
    ), '[]'::jsonb),
    'catalog_statuses', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', status_mapping.id,
          'status_mapping_id', status_mapping.id,
          'campaign_action_id', status_mapping.campaign_action_id,
          'action_code', status_mapping.action_code,
          'action_name', account_action.name,
          'is_wildcard', status_mapping.action_code IS NULL,
          'status_id', status_mapping.status_id,
          'semantic_status_id', status_mapping.status_id,
          'status_value', status_mapping.status_value,
          'status_label', COALESCE(status_mapping.label, status_mapping.status_value),
          'label', COALESCE(status_mapping.label, status_mapping.status_value)
        )
        ORDER BY status_mapping.campaign_action_id,
          status_mapping.sort_order,
          status_mapping.id
      )
      FROM public.auto_campaign_action_detail_statuses AS status_mapping
      LEFT JOIN public.auto_account_actions AS account_action
        ON account_action.code = status_mapping.action_code
      WHERE status_mapping.is_active = true
        AND status_mapping.is_delete = false
    ), '[]'::jsonb),
    'status_options', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'campaign_action_id', observed.campaign_action_id,
          'status_mapping_id', NULL,
          'action_code', observed.action_code,
          'action_name', account_action.name,
          'is_wildcard', observed.action_code IS NULL,
          'status_id', semantic_status.id,
          'semantic_status_id', semantic_status.id,
          'status_value', observed.status_value,
          'status_label', observed.status_value,
          'occurrence_count', observed.occurrence_count,
          'last_seen_at', observed.last_seen_at
        )
        ORDER BY observed.campaign_action_id,
          lower(observed.status_value),
          observed.action_code
      )
      FROM (
        SELECT
          campaign.action_id AS campaign_action_id,
          detail.action_code,
          detail.status AS status_value,
          count(*)::integer AS occurrence_count,
          max(detail.created_at) AS last_seen_at
        FROM public.auto_campaigns AS campaign
        JOIN public.auto_campaign_details AS detail
          ON detail.campaign_id = campaign.id
        WHERE campaign.staff_id = p_staff_id
          AND campaign.organization_id = p_organization_id
          AND COALESCE(campaign.is_delete, false) = false
          AND COALESCE(detail.is_delete, false) = false
        GROUP BY campaign.action_id, detail.action_code, detail.status
      ) AS observed
      LEFT JOIN public.auto_account_actions AS account_action
        ON account_action.code = observed.action_code
      LEFT JOIN LATERAL (
        SELECT status_catalog.id
        FROM public.auto_status AS status_catalog
        WHERE status_catalog.component_type = 'campaign_detail'
          AND status_catalog.is_active = true
          AND status_catalog.is_delete = false
          AND lower(status_catalog.name) = lower(observed.status_value)
        ORDER BY status_catalog.sort_order, status_catalog.id
        LIMIT 1
      ) AS semantic_status ON true
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.auto_campaign_action_detail_statuses AS status_mapping
        WHERE status_mapping.campaign_action_id = observed.campaign_action_id
          AND status_mapping.action_code IS NOT DISTINCT FROM observed.action_code
          AND lower(status_mapping.status_value) = lower(observed.status_value)
          AND status_mapping.is_active = true
          AND status_mapping.is_delete = false
      )
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Immutable target schedule: delay floor, then first matching HH:mm
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
  v_delay_floor timestamptz;
  v_local_event timestamp without time zone;
  v_local_floor timestamp without time zone;
  v_local_schedule timestamp without time zone;
  v_schedule_policy text;
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
      v_schedule_policy := 'immediate';
    WHEN 'after_delay' THEN
      v_delay_floor := CASE v_rule.delay_unit
        WHEN 'minute' THEN v_event_at + make_interval(mins => v_rule.delay_value)
        WHEN 'hour' THEN v_event_at + make_interval(hours => v_rule.delay_value)
        WHEN 'day' THEN v_event_at + make_interval(days => v_rule.delay_value)
        ELSE NULL
      END;

      IF v_delay_floor IS NULL THEN
        RAISE EXCEPTION 'invalid_delay_schedule';
      END IF;

      IF v_rule.delay_exact_time IS NULL THEN
        NEW.scheduled_at := v_delay_floor;
        v_schedule_policy := 'after_delay';
      ELSE
        v_local_floor := v_delay_floor AT TIME ZONE 'Asia/Ho_Chi_Minh';
        v_local_schedule := v_local_floor::date + v_rule.delay_exact_time;

        -- Equality remains on the same date. A strictly earlier candidate is
        -- moved to the following date so the full delay is never shortened.
        IF v_local_schedule < v_local_floor THEN
          v_local_schedule := v_local_schedule + interval '1 day';
        END IF;

        NEW.scheduled_at := v_local_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh';
        v_schedule_policy := 'first_wall_clock_at_or_after_delay_v1';
      END IF;
    WHEN 'daily_time' THEN
      v_local_event := v_event_at AT TIME ZONE 'Asia/Ho_Chi_Minh';
      v_local_schedule := v_local_event::date + v_rule.daily_time;

      IF v_local_event > v_local_schedule THEN
        v_local_schedule := v_local_schedule + interval '1 day';
      END IF;

      NEW.scheduled_at := v_local_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh';
      v_schedule_policy := 'nearest_daily_time_v1';
    WHEN 'fixed_at' THEN
      NEW.scheduled_at := v_rule.fixed_at;
      v_schedule_policy := 'fixed_at_legacy';
    ELSE
      RAISE EXCEPTION 'invalid_automation_schedule';
  END CASE;

  -- The worker still claims immediately; the target input schedule gates B.
  NEW.next_attempt_at := v_event_at;

  NEW.config_snapshot := COALESCE(NEW.config_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'schedule_mode', v_rule.schedule_mode,
      'delay_days', v_rule.delay_days,
      'delay_hours', v_rule.delay_hours,
      'delay_value', v_rule.delay_value,
      'delay_unit', v_rule.delay_unit,
      'delay_exact_time', v_rule.delay_exact_time,
      'delay_floor_at', v_delay_floor,
      'daily_time', v_rule.daily_time,
      'fixed_at', v_rule.fixed_at,
      'schedule_policy', v_schedule_policy,
      'schedule_time_zone', 'Asia/Ho_Chi_Minh',
      'scheduled_at', NEW.scheduled_at
    );

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges and PostgREST refresh
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.auto_validate_automation_rule_internal(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean,
  integer, text, time without time zone, time without time zone
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_guard_automation_trigger_status_scope()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.aka_agent_prepare_automation_detail_schedule()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.aka_agent_validate_automation_rule(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean, text, text,
  integer, text, time without time zone, time without time zone, boolean
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
  integer, text, time without time zone, time without time zone, boolean
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.aka_agent_validate_automation_rule(
  bigint, bigint, bigint, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, boolean, boolean, text, text,
  integer, text, time without time zone, time without time zone, boolean
) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.aka_agent_save_automation(
  bigint, bigint, bigint, text, bigint, bigint, text, bigint,
  text, integer, integer, timestamptz, text, boolean, jsonb, text, text,
  integer, text, time without time zone, time without time zone, boolean
) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
