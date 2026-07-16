-- Fix the automation worker claim RPC after migration v171.
--
-- The function returns a column named target_campaign_id. In PL/pgSQL that
-- output column is also a variable, so ON CONFLICT (target_campaign_id) is
-- ambiguous at runtime. Target the primary-key constraint explicitly.

BEGIN;

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
      AND detail.scheduled_at <= clock_timestamp()
      AND automation.staff_id = p_staff_id
      AND automation.organization_id = p_organization_id
      AND automation.is_active = true
      AND automation.is_delete = false
    ORDER BY detail.scheduled_at ASC, detail.created_at ASC, detail.id ASC
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

COMMIT;
