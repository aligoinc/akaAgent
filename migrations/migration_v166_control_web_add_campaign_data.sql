-- Web equivalent of akaAgent addCampaignInputDataRows: append data and apply
-- the selected schedule/status in one transaction. Completed campaigns are
-- intentionally allowed to be scheduled again; only a running campaign is
-- rejected, matching the desktop behavior.

CREATE OR REPLACE FUNCTION public.add_control_campaign_input_rows(
  p_staff_id bigint,
  p_organization_id bigint,
  p_campaign_id bigint,
  p_idempotency_key text,
  p_expected_input_count integer,
  p_inputs jsonb,
  p_campaign_schedule timestamptz,
  p_campaign_status text
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
  IF p_campaign_schedule IS NULL THEN
    RAISE EXCEPTION 'invalid_campaign_schedule';
  END IF;
  IF p_campaign_status NOT IN ('chờ xử lý', 'tạm dừng') THEN
    RAISE EXCEPTION 'invalid_campaign_status';
  END IF;
  IF jsonb_typeof(COALESCE(p_inputs, '[]'::jsonb)) <> 'array'
    OR jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) < 1
    OR jsonb_array_length(COALESCE(p_inputs, '[]'::jsonb)) > 5000 THEN
    RAISE EXCEPTION 'invalid_control_campaign_inputs';
  END IF;

  -- Validate tenant ownership before taking locks.
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

  -- Keep the same input -> campaign lock order as SMS completion recording.
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
  FROM jsonb_array_elements(p_inputs) WITH ORDINALITY AS item(value, ordinality);
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.auto_campaigns
  SET schedule = p_campaign_schedule,
      original_schedule = p_campaign_schedule,
      status = p_campaign_status,
      updated_at = now()
  WHERE id = p_campaign_id;

  RETURN jsonb_build_object('inserted', v_inserted, 'created', true);
END;
$$;

REVOKE ALL ON FUNCTION public.add_control_campaign_input_rows(
  bigint, bigint, bigint, text, integer, jsonb, timestamptz, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_control_campaign_input_rows(
  bigint, bigint, bigint, text, integer, jsonb, timestamptz, text
) TO service_role;
