CREATE OR REPLACE FUNCTION public.aka_agent_engine_take_content_index_v1(p_target_run_id bigint, p_lease_token uuid, p_action_code text, p_variant_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  r public.auto_engine_target_runs%ROWTYPE;
  v_input public.auto_campaign_input_data%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_raw text;
  v_index integer;
  v_first boolean;
BEGIN
  IF p_action_code IS NULL OR btrim(p_action_code) = '' OR length(p_action_code) > 128 OR coalesce(p_variant_count, 0) < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id FOR UPDATE;
  IF NOT FOUND OR r.completed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'run_closed'); END IF;
  IF r.lease_token IS DISTINCT FROM p_lease_token OR NOT EXISTS (
       SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost');
  END IF;
  IF p_variant_count = 1 THEN RETURN jsonb_build_object('ok', true, 'index', 0); END IF;
  SELECT * INTO v_input FROM public.auto_campaign_input_data WHERE id = r.input_data_id FOR UPDATE;
  SELECT * INTO v_campaign FROM public.auto_campaigns WHERE id = r.campaign_id FOR UPDATE;
  -- Data đã lấy nội dung cho thao tác này thì đi tiếp từ vị trí của data; lần đầu lấy theo chiến dịch.
  v_first := NOT (coalesce(v_input.content_rotation_indexes, '{}'::jsonb) ? p_action_code);
  IF v_first THEN
    v_raw := v_campaign.content_rotation_indexes->>p_action_code;
    IF v_raw IS NULL AND v_campaign.action_id IN ('facebook_timeline_post','facebook_page_post')
       AND p_action_code IN ('fb_post_my_profile','fb_post_page') THEN
      v_raw := v_campaign.extra_settings->>'contentRotationIndex';
    END IF;
  ELSE
    v_raw := v_input.content_rotation_indexes->>p_action_code;
  END IF;
  v_index := CASE WHEN v_raw ~ '^[0-9]{1,16}$' THEN mod(v_raw::numeric, p_variant_count)::integer ELSE 0 END;
  IF v_first THEN
    UPDATE public.auto_campaigns SET content_rotation_indexes = jsonb_set(coalesce(content_rotation_indexes, '{}'::jsonb),
      ARRAY[p_action_code], to_jsonb((v_index + 1) % p_variant_count), true) WHERE id = r.campaign_id;
  END IF;
  UPDATE public.auto_campaign_input_data SET content_rotation_indexes = jsonb_set(coalesce(content_rotation_indexes, '{}'::jsonb),
    ARRAY[p_action_code], to_jsonb((v_index + 1) % p_variant_count), true) WHERE id = r.input_data_id;
  RETURN jsonb_build_object('ok', true, 'index', v_index);
END $function$
