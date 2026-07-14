-- Phase 3/3. Apply only after the two earlier v165 phase files succeeded.
-- Atomic control-web mutations and Zalo account quota enforcement.
BEGIN;

DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = index_class.relnamespace
    JOIN pg_catalog.pg_index AS index_state
      ON index_state.indexrelid = index_class.oid
    WHERE namespace.nspname = 'public'
      AND index_class.relname = 'uq_auto_campaign_input_data_control_append'
      AND index_state.indisvalid = true
      AND index_state.indisready = true
  ) THEN
    RAISE EXCEPTION 'v165_concurrent_index_missing_or_invalid';
  END IF;
END;
$guard$;

CREATE OR REPLACE FUNCTION public.create_control_campaign_v2(
  p_staff_id bigint,
  p_organization_id bigint,
  p_idempotency_key text,
  p_campaign jsonb,
  p_inputs jsonb DEFAULT '[]'::jsonb,
  p_initial_status text DEFAULT 'chờ xử lý'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_result jsonb;
  v_campaign_id bigint;
BEGIN
  IF p_initial_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'invalid_control_campaign_initial_status';
  END IF;

  v_result := public.create_control_campaign(
    p_staff_id,
    p_organization_id,
    p_idempotency_key,
    p_campaign,
    p_inputs
  );

  -- The inner insert and this update share a transaction, so a cloned campaign is
  -- never externally visible in the runnable state.
  IF p_initial_status = 'tạm dừng' AND COALESCE((v_result->>'created')::boolean, false) THEN
    v_campaign_id := NULLIF(v_result->>'campaign_id', '')::bigint;
    UPDATE public.auto_campaigns
    SET status = 'tạm dừng', updated_at = now()
    WHERE id = v_campaign_id
      AND staff_id = p_staff_id
      AND organization_id = p_organization_id
      AND COALESCE(is_delete, false) = false;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_control_campaign_v2(bigint, bigint, text, jsonb, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_control_campaign_v2(bigint, bigint, text, jsonb, jsonb, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.append_control_campaign_inputs(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_idempotency_key text,
  p_expected_input_count integer,
  p_inputs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_campaign_status text;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_input_count integer := 0;
  v_existing_count integer := 0;
  v_inserted integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;
  IF v_key IS NULL OR length(v_key) > 200 THEN
    RAISE EXCEPTION 'invalid_idempotency_key';
  END IF;
  IF jsonb_typeof(COALESCE(p_inputs, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) < 1
    OR jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) > 5000 THEN
    RAISE EXCEPTION 'invalid_control_campaign_inputs';
  END IF;

  -- Validate tenant ownership before taking any row locks.
  PERFORM campaign.id
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type IN ('zalo', 'sms')
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'not_found');
  END IF;

  -- SMS status recording locks an input row before it may complete its campaign.
  -- Follow the same input -> campaign order so appending cannot leave new pending
  -- data underneath a campaign that concurrently became completed.
  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE;

  SELECT campaign.status
  INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type IN ('zalo', 'sms')
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'not_found');
  END IF;

  SELECT count(*)::integer INTO v_existing_count
  FROM public.auto_campaign_input_data
  WHERE campaign_id = p_campaign_id
    AND control_append_idempotency_key = v_key;
  IF v_existing_count > 0 THEN
    RETURN jsonb_build_object('inserted', v_existing_count, 'created', false);
  END IF;

  IF v_campaign_status = 'đang chạy' THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'campaign_running');
  END IF;
  IF v_campaign_status = 'hoàn thành' THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'campaign_completed');
  END IF;

  SELECT count(*)::integer INTO v_input_count
  FROM public.auto_campaign_input_data
  WHERE campaign_id = p_campaign_id
    AND COALESCE(is_delete, false) = false;
  IF p_expected_input_count IS NULL OR p_expected_input_count <> v_input_count THEN
    RETURN jsonb_build_object('inserted', 0, 'created', false, 'reason', 'input_count_conflict');
  END IF;

  INSERT INTO public.auto_campaign_input_data (
    campaign_id, input_id, name, phone, phone_carrier, uid, email,
    info1, info2, info3, info4, info5, content,
    status, note, schedule, is_delete, created_at,
    control_append_idempotency_key, control_append_row_index
  )
  SELECT
    p_campaign_id,
    NULL,
    NULLIF(item.value->>'name', ''),
    NULLIF(item.value->>'phone', ''),
    NULLIF(item.value->>'phoneCarrier', ''),
    NULLIF(item.value->>'uid', ''),
    NULLIF(item.value->>'email', ''),
    NULLIF(item.value->>'info1', ''),
    NULLIF(item.value->>'info2', ''),
    NULLIF(item.value->>'info3', ''),
    NULLIF(item.value->>'info4', ''),
    NULLIF(item.value->>'info5', ''),
    NULLIF(item.value->>'content', ''),
    'chờ xử lý',
    NULLIF(item.value->>'note', ''),
    NULLIF(item.value->>'schedule', '')::timestamptz,
    false,
    now(),
    v_key,
    (item.ordinality - 1)::integer
  FROM jsonb_array_elements(COALESCE(p_inputs, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('inserted', v_inserted, 'created', true);
END;
$$;

REVOKE ALL ON FUNCTION public.append_control_campaign_inputs(bigint, bigint, bigint, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_control_campaign_inputs(bigint, bigint, bigint, text, integer, jsonb)
  TO service_role;
-- Remove the earlier seven-argument draft signature if a development database
-- saw a partial v165 apply before update+append became one atomic operation.
DROP FUNCTION IF EXISTS public.update_control_campaign_atomic(
  bigint, bigint, bigint, timestamptz, jsonb, jsonb, boolean
);

CREATE OR REPLACE FUNCTION public.update_control_campaign_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_expected_updated_at timestamptz,
  p_campaign_patch jsonb,
  p_sms_inputs jsonb DEFAULT NULL,
  p_update_sms_schedule boolean DEFAULT false,
  p_append_idempotency_key text DEFAULT NULL,
  p_expected_input_count integer DEFAULT NULL,
  p_append_inputs jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_campaign public.auto_campaigns%ROWTYPE;
  v_account_platform text;
  v_payload_input_count integer := 0;
  v_payload_unique_input_count integer := 0;
  v_eligible_input_count integer := 0;
  v_current_eligible_input_count integer := 0;
  v_updated_inputs integer := 0;
  v_append_key text := NULLIF(btrim(COALESCE(p_append_idempotency_key, '')), '');
  v_append_input_count integer := 0;
  v_existing_append_count integer := 0;
  v_current_input_count integer := 0;
  v_appended_inputs integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(p_campaign_patch, '{}'::jsonb)) <> 'object'
    OR (p_sms_inputs IS NOT NULL AND jsonb_typeof(p_sms_inputs) <> 'array')
    OR (p_append_inputs IS NOT NULL AND jsonb_typeof(p_append_inputs) <> 'array') THEN
    RAISE EXCEPTION 'invalid_control_campaign_update_payload';
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    v_append_input_count := jsonb_array_length(p_append_inputs);
    IF v_append_input_count < 1 OR v_append_input_count > 5000
      OR v_append_key IS NULL OR length(v_append_key) > 200
      OR p_expected_input_count IS NULL OR p_expected_input_count < 0 THEN
      RAISE EXCEPTION 'invalid_control_campaign_append_payload';
    END IF;
  ELSIF v_append_key IS NOT NULL OR p_expected_input_count IS NOT NULL THEN
    RAISE EXCEPTION 'orphan_control_campaign_append_metadata';
  END IF;

  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type IN ('zalo', 'sms')
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  SELECT account.flatform_type
  INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id;

  -- A network retry after the transaction committed still carries the stale
  -- version. The durable append key proves that this exact edit already won.
  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_existing_append_count
    FROM public.auto_campaign_input_data
    WHERE campaign_id = p_campaign_id
      AND control_append_idempotency_key = v_append_key;
    IF v_existing_append_count > 0 THEN
      IF v_existing_append_count <> v_append_input_count THEN
        RETURN jsonb_build_object('updated', false, 'reason', 'append_idempotency_conflict');
      END IF;
      RETURN jsonb_build_object(
        'updated', true,
        'campaign_id', p_campaign_id,
        'updated_input_count', 0,
        'appended_input_count', v_existing_append_count,
        'updated_at', v_campaign.updated_at,
        'idempotent', true
      );
    END IF;
  END IF;

  IF v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;
  IF v_campaign.status = 'đang chạy' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_running');
  END IF;
  IF p_append_inputs IS NOT NULL AND v_campaign.status = 'hoàn thành' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_completed');
  END IF;
  IF p_sms_inputs IS NOT NULL AND v_account_platform <> 'sms' THEN
    RAISE EXCEPTION 'control_sms_materialization_platform_mismatch';
  END IF;

  IF p_sms_inputs IS NOT NULL OR p_append_inputs IS NOT NULL THEN
    -- SMS status recording locks an input row before it may complete the
    -- campaign. Lock every current row before taking the campaign lock so an
    -- update+append cannot commit below a concurrently completed campaign.
    PERFORM input_data.id
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
    ORDER BY input_data.id
    FOR UPDATE;
  END IF;

  IF p_sms_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_eligible_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');

    SELECT
      count(*)::integer,
      count(DISTINCT NULLIF(item->>'id', '')::bigint)::integer
    INTO v_payload_input_count, v_payload_unique_input_count
    FROM jsonb_array_elements(p_sms_inputs) AS item;

    IF v_payload_input_count <> v_payload_unique_input_count
      OR v_payload_unique_input_count <> v_eligible_input_count
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_sms_inputs) AS item
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.id = NULLIF(item->>'id', '')::bigint
            AND input_data.campaign_id = p_campaign_id
            AND COALESCE(input_data.is_delete, false) = false
            AND input_data.status IN ('chờ xử lý', 'tạm dừng')
        )
      ) THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'sms_inputs_changed');
    END IF;
  END IF;

  -- Mobile status recording locks input rows before it may complete the campaign;
  -- take the campaign lock only after the SMS input locks to keep that order.
  SELECT campaign.*
  INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type IN ('zalo', 'sms')
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'not_found');
  END IF;

  SELECT account.flatform_type
  INTO v_account_platform
  FROM public.auto_accounts AS account
  WHERE account.id = v_campaign.account_id;

  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_existing_append_count
    FROM public.auto_campaign_input_data
    WHERE campaign_id = p_campaign_id
      AND control_append_idempotency_key = v_append_key;
    IF v_existing_append_count > 0 THEN
      IF v_existing_append_count <> v_append_input_count THEN
        RETURN jsonb_build_object('updated', false, 'reason', 'append_idempotency_conflict');
      END IF;
      RETURN jsonb_build_object(
        'updated', true,
        'campaign_id', p_campaign_id,
        'updated_input_count', 0,
        'appended_input_count', v_existing_append_count,
        'updated_at', v_campaign.updated_at,
        'idempotent', true
      );
    END IF;
  END IF;

  IF v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'version_conflict');
  END IF;
  IF v_campaign.status = 'đang chạy' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_running');
  END IF;
  IF p_append_inputs IS NOT NULL AND v_campaign.status = 'hoàn thành' THEN
    RETURN jsonb_build_object('updated', false, 'reason', 'campaign_completed');
  END IF;
  IF p_sms_inputs IS NOT NULL AND v_account_platform <> 'sms' THEN
    RAISE EXCEPTION 'control_sms_materialization_platform_mismatch';
  END IF;

  IF p_campaign_patch ? 'account_id' AND NOT EXISTS (
    SELECT 1
    FROM public.auto_accounts AS account
    WHERE account.id = NULLIF(p_campaign_patch->>'account_id', '')::bigint
      AND account.staff_id = p_staff_id
      AND account.organization_id = p_organization_id
      AND account.flatform_type = v_account_platform
      AND COALESCE(account.is_delete, false) = false
  ) THEN
    RAISE EXCEPTION 'control_account_not_found';
  END IF;

  IF p_sms_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_current_eligible_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');
    IF v_current_eligible_input_count <> v_payload_unique_input_count THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'sms_inputs_changed');
    END IF;
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    SELECT count(*)::integer INTO v_current_input_count
    FROM public.auto_campaign_input_data AS input_data
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false;
    IF v_current_input_count <> p_expected_input_count THEN
      RETURN jsonb_build_object('updated', false, 'reason', 'input_count_conflict');
    END IF;
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET
    name = CASE WHEN p_campaign_patch ? 'name' THEN p_campaign_patch->>'name' ELSE campaign.name END,
    account_id = CASE WHEN p_campaign_patch ? 'account_id' THEN NULLIF(p_campaign_patch->>'account_id', '')::bigint ELSE campaign.account_id END,
    schedule = CASE WHEN p_campaign_patch ? 'schedule' THEN NULLIF(p_campaign_patch->>'schedule', '')::timestamptz ELSE campaign.schedule END,
    original_schedule = CASE WHEN p_campaign_patch ? 'original_schedule' THEN NULLIF(p_campaign_patch->>'original_schedule', '')::timestamptz ELSE campaign.original_schedule END,
    content = CASE WHEN p_campaign_patch ? 'content' THEN COALESCE(p_campaign_patch->>'content', '') ELSE campaign.content END,
    schedule_type = CASE WHEN p_campaign_patch ? 'schedule_type' THEN p_campaign_patch->>'schedule_type' ELSE campaign.schedule_type END,
    schedule_end_date = CASE WHEN p_campaign_patch ? 'schedule_end_date' THEN NULLIF(p_campaign_patch->>'schedule_end_date', '')::timestamptz ELSE campaign.schedule_end_date END,
    daily_stop_time = CASE WHEN p_campaign_patch ? 'daily_stop_time' THEN NULLIF(p_campaign_patch->>'daily_stop_time', '')::time ELSE campaign.daily_stop_time END,
    schedule_days = CASE WHEN p_campaign_patch ? 'schedule_days' THEN NULLIF(p_campaign_patch->>'schedule_days', '') ELSE campaign.schedule_days END,
    schedule_week_days = CASE WHEN p_campaign_patch ? 'schedule_week_days' THEN NULLIF(p_campaign_patch->>'schedule_week_days', '') ELSE campaign.schedule_week_days END,
    continue_next_day = CASE WHEN p_campaign_patch ? 'continue_next_day' THEN (p_campaign_patch->>'continue_next_day')::boolean ELSE campaign.continue_next_day END,
    refresh_data = CASE WHEN p_campaign_patch ? 'refresh_data' THEN (p_campaign_patch->>'refresh_data')::boolean ELSE campaign.refresh_data END,
    extra_settings = CASE WHEN p_campaign_patch ? 'extra_settings' THEN p_campaign_patch->'extra_settings' ELSE campaign.extra_settings END,
    images = CASE WHEN p_campaign_patch ? 'images' THEN p_campaign_patch->'images' ELSE campaign.images END,
    status = CASE WHEN p_campaign_patch ? 'status' THEN p_campaign_patch->>'status' ELSE campaign.status END,
    updated_at = now()
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
  RETURNING * INTO v_campaign;

  IF p_sms_inputs IS NOT NULL THEN
    WITH materialized AS (
      SELECT
        NULLIF(item->>'id', '')::bigint AS id,
        NULLIF(item->>'phone', '') AS phone,
        NULLIF(item->>'phoneCarrier', '') AS phone_carrier,
        NULLIF(item->>'content', '') AS content,
        NULLIF(item->>'schedule', '')::timestamptz AS schedule
      FROM jsonb_array_elements(p_sms_inputs) AS item
    )
    UPDATE public.auto_campaign_input_data AS input_data
    SET
      phone = materialized.phone,
      phone_carrier = materialized.phone_carrier,
      content = materialized.content,
      schedule = CASE WHEN p_update_sms_schedule THEN materialized.schedule ELSE input_data.schedule END
    FROM materialized
    WHERE input_data.id = materialized.id
      AND input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status IN ('chờ xử lý', 'tạm dừng');
    GET DIAGNOSTICS v_updated_inputs = ROW_COUNT;
    IF v_updated_inputs <> v_eligible_input_count THEN
      RAISE EXCEPTION 'control_sms_inputs_changed';
    END IF;
  END IF;

  IF p_append_inputs IS NOT NULL THEN
    INSERT INTO public.auto_campaign_input_data (
      campaign_id, input_id, name, phone, phone_carrier, uid, email,
      info1, info2, info3, info4, info5, content,
      status, note, schedule, is_delete, created_at,
      control_append_idempotency_key, control_append_row_index
    )
    SELECT
      p_campaign_id,
      NULL,
      NULLIF(item.value->>'name', ''),
      NULLIF(item.value->>'phone', ''),
      NULLIF(item.value->>'phoneCarrier', ''),
      NULLIF(item.value->>'uid', ''),
      NULLIF(item.value->>'email', ''),
      NULLIF(item.value->>'info1', ''),
      NULLIF(item.value->>'info2', ''),
      NULLIF(item.value->>'info3', ''),
      NULLIF(item.value->>'info4', ''),
      NULLIF(item.value->>'info5', ''),
      NULLIF(item.value->>'content', ''),
      'chờ xử lý',
      NULLIF(item.value->>'note', ''),
      NULLIF(item.value->>'schedule', '')::timestamptz,
      false,
      now(),
      v_append_key,
      (item.ordinality - 1)::integer
    FROM jsonb_array_elements(p_append_inputs) WITH ORDINALITY AS item(value, ordinality);
    GET DIAGNOSTICS v_appended_inputs = ROW_COUNT;
    IF v_appended_inputs <> v_append_input_count THEN
      RAISE EXCEPTION 'control_campaign_append_incomplete';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'updated', true,
    'campaign_id', p_campaign_id,
    'updated_input_count', v_updated_inputs,
    'appended_input_count', v_appended_inputs,
    'updated_at', v_campaign.updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_control_campaign_atomic(bigint, bigint, bigint, timestamptz, jsonb, jsonb, boolean, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_control_campaign_atomic(bigint, bigint, bigint, timestamptz, jsonb, jsonb, boolean, text, integer, jsonb)
  TO service_role;

-- Lock current input rows before the campaign so a status update and a web
-- delete cannot commit a partially observed campaign state.
CREATE OR REPLACE FUNCTION public.delete_control_campaign_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_campaign_status text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR p_campaign_id IS NULL OR p_campaign_id <= 0 THEN
    RAISE EXCEPTION 'invalid_control_identity';
  END IF;

  -- This is an optimistic platform read only; it deliberately takes no campaign
  -- row lock. The mutation locks input rows before taking the campaign row lock.
  SELECT campaign.status
  INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type IN ('zalo', 'sms')
    AND COALESCE(account.is_delete, false) = false;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;

  PERFORM input_data.id
  FROM public.auto_campaign_input_data AS input_data
  WHERE input_data.campaign_id = p_campaign_id
    AND COALESCE(input_data.is_delete, false) = false
  ORDER BY input_data.id
  FOR UPDATE;

  SELECT campaign.status
  INTO v_campaign_status
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND account.organization_id = p_organization_id
    AND account.flatform_type IN ('zalo', 'sms')
    AND COALESCE(account.is_delete, false) = false
  FOR UPDATE OF campaign;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'not_found');
  END IF;
  IF v_campaign_status = 'đang chạy' THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'campaign_running');
  END IF;

  UPDATE public.auto_campaigns AS campaign
  SET is_delete = true, updated_at = now()
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status <> 'đang chạy';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'campaign_running');
  END IF;

  RETURN jsonb_build_object('deleted', true, 'campaign_id', p_campaign_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_control_campaign_atomic(bigint, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_control_campaign_atomic(bigint, bigint, bigint)
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_control_zalo_account_atomic(
  p_staff_id bigint,
  p_organization_id bigint,
  p_max_accounts integer,
  p_account jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_account_id bigint;
  v_account_count integer := 0;
  v_account_group_id bigint := NULLIF(p_account->>'accountGroupId', '')::bigint;
  v_proxy_id bigint := NULLIF(p_account->>'proxyId', '')::bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0
    OR p_organization_id IS NULL OR p_organization_id <= 0
    OR jsonb_typeof(COALESCE(p_account, '{}'::jsonb)) <> 'object'
    OR NULLIF(btrim(COALESCE(p_account->>'name', '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_control_zalo_account_payload';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.org_staff
    WHERE id = p_staff_id
      AND organization_id = p_organization_id
      AND is_active = true
      AND is_zalo_server = true
  ) THEN
    RAISE EXCEPTION 'inactive_control_staff';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('control-zalo-account:' || p_staff_id::text, 0));

  SELECT count(*)::integer INTO v_account_count
  FROM public.auto_accounts
  WHERE staff_id = p_staff_id
    AND organization_id = p_organization_id
    AND flatform_type = 'zalo'
    AND COALESCE(is_delete, false) = false;
  IF p_max_accounts IS NOT NULL AND p_max_accounts > 0 AND v_account_count >= p_max_accounts THEN
    RETURN jsonb_build_object('created', false, 'reason', 'account_limit_reached');
  END IF;

  IF v_account_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auto_account_groups
    WHERE id = v_account_group_id
      AND staff_id = p_staff_id
      AND organization_id = p_organization_id
      AND flatform_type = 'zalo'
      AND COALESCE(is_delete, false) = false
  ) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'account_group_not_found');
  END IF;
  IF v_proxy_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.auto_proxies
    WHERE id = v_proxy_id
      AND staff_id = p_staff_id
      AND organization_id = p_organization_id
      AND COALESCE(is_delete, false) = false
  ) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'proxy_not_found');
  END IF;

  INSERT INTO public.auto_accounts (
    name, flatform_type, login_status, status, is_active,
    account_group_id, proxy_id, staff_id, organization_id, is_delete
  ) VALUES (
    btrim(p_account->>'name'),
    'zalo',
    'chưa đăng nhập',
    'chờ xử lý',
    COALESCE((p_account->>'isActive')::boolean, true),
    v_account_group_id,
    v_proxy_id,
    p_staff_id,
    p_organization_id,
    false
  ) RETURNING id INTO v_account_id;

  RETURN jsonb_build_object('created', true, 'account_id', v_account_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_control_zalo_account_atomic(bigint, bigint, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_control_zalo_account_atomic(bigint, bigint, integer, jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
