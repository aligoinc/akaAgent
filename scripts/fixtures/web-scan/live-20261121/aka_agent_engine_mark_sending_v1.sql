CREATE OR REPLACE FUNCTION public.aka_agent_engine_mark_sending_v1(p_target_run_id bigint, p_lease_token uuid, p_action_code text, p_step_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  r public.auto_engine_target_runs%ROWTYPE;
  v_key text := coalesce(nullif(btrim(p_step_key), ''), p_action_code);
BEGIN
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id FOR UPDATE;
  IF NOT FOUND OR r.completed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'run_closed'); END IF;
  IF r.lease_token IS DISTINCT FROM p_lease_token OR NOT EXISTS (
       SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = p_action_code) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown');
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.marks) m WHERE m.value->>'stepKey' = v_key) THEN
    RETURN jsonb_build_object('ok', true, 'replay', true);
  END IF;
  -- Giữ chỗ hạn mức ngày ngay lúc ghi dấu; report hoàn lại nếu chính sách không tính.
  INSERT INTO public.auto_account_action_status AS s (account_id, action_code, count_action_in_day, count_date)
  VALUES (r.account_id, p_action_code, 1, v_vn)
  ON CONFLICT (account_id, action_code) DO UPDATE SET
    count_action_in_day = CASE WHEN s.count_date = v_vn THEN s.count_action_in_day + 1 ELSE 1 END,
    count_date = v_vn, updated_at = v_now;
  UPDATE public.auto_engine_target_runs SET
    marks = marks || jsonb_build_array(jsonb_build_object('stepKey', v_key, 'actionCode', p_action_code, 'markedAt', v_now,
      'state', 'pending', 'reservedQuotaDate', v_vn)),
    first_marked_at = coalesce(first_marked_at, v_now)
  WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'markedAt', v_now);
END $function$
