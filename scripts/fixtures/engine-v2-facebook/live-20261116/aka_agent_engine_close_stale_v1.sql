CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_stale_v1(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_stale interval := make_interval(mins => greatest(1, public.aka_agent_engine_setting('engine.stale_target_minutes', '10')::integer));
  v_unsent text := public.aka_agent_engine_setting('engine.stale_unsent_target_action', 'complete');
  rr public.auto_engine_target_runs%ROWTYPE;
  v_marked boolean;
  v_code text;
  v_msg text;
  v_status text;
  v_closed integer := 0;
  v_released integer := 0;
  v_lease record;
BEGIN
  FOR rr IN
    SELECT tr.* FROM public.auto_engine_target_runs tr
     WHERE tr.completed_at IS NULL AND tr.started_at < v_now - v_stale
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases l
                        WHERE l.account_id = tr.account_id AND l.lease_token = tr.lease_token AND l.expires_at > v_now - v_stale)
     ORDER BY tr.id LIMIT greatest(1, p_limit)
     FOR UPDATE SKIP LOCKED
  LOOP
    v_marked := EXISTS (SELECT 1 FROM jsonb_array_elements(rr.marks) m WHERE m.value->>'state' IN ('pending', 'delivered', 'partial', 'unknown'))
             OR EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = rr.id AND eo.delivery_state IN ('delivered', 'partial', 'unknown'));
    IF v_marked THEN
      v_code := 'err_engine_interrupted_while_sending'; v_status := 'hoàn thành';
    -- V515 (C): 'requeue_unstarted' chỉ trả về hàng đợi lượt data chưa có kết quả nào, tức bộ chạy chưa làm gì với data (mất câu trả
    -- lời của claim, chết khi đang tra số). Lượt đã có kết quả (ví dụ nhắn bị từ chối rồi đã kiêm SMS) thì đóng như 'complete': chạy lại
    -- sẽ lặp các việc sau kết quả đó (kiêm SMS không lọc trùng). 'requeue' giữ nghĩa cũ: mọi lượt chưa có dấu "sắp gửi".
    ELSIF v_unsent = 'requeue'
       OR (v_unsent = 'requeue_unstarted' AND NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = rr.id)) THEN
      v_code := 'err_engine_interrupted_before_send'; v_status := 'chờ xử lý';
    ELSE
      v_code := 'err_engine_interrupted_before_send'; v_status := 'hoàn thành';
    END IF;
    SELECT coalesce(e.customer_title, e.error_name) || CASE WHEN e.public_code IS NOT NULL THEN ' (' || e.public_code || ')' ELSE '' END
      INTO v_msg FROM public.auto_error e WHERE e.error_code = v_code;
    -- Bộ cũ đã nhận lại chiến dịch (cập nhật app ngược, tắt cờ): không đụng data, chỉ đóng sổ lượt của bộ mới.
    UPDATE public.auto_campaign_input_data SET status = v_status, note = coalesce(v_msg, note), date_action = v_now
     WHERE id = rr.input_data_id AND status = 'đang chạy'
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.id = rr.campaign_id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL));
    INSERT INTO public.auto_engine_target_events (input_data_id, campaign_id, target_run_id, kind, error_code, message, data)
    VALUES (rr.input_data_id, rr.campaign_id, rr.id, 'interrupted', v_code, coalesce(v_msg, v_code),
            jsonb_build_object('marked', v_marked, 'runnerId', rr.runner_id, 'leaseToken', rr.lease_token));
    UPDATE public.auto_engine_target_runs SET completed_at = v_now, final_target_status = v_status, final_error_code = v_code, close_reason = 'stale'
     WHERE id = rr.id;
    v_closed := v_closed + 1;
  END LOOP;

  FOR v_lease IN
    SELECT l.account_id, l.campaign_id, l.lease_token FROM public.auto_engine_leases l
     WHERE l.expires_at < v_now - v_stale
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.account_id = l.account_id AND tr.lease_token = l.lease_token AND tr.completed_at IS NULL)
     ORDER BY l.expires_at LIMIT greatest(1, p_limit)
     FOR UPDATE SKIP LOCKED
  LOOP
    DELETE FROM public.auto_engine_leases WHERE account_id = v_lease.account_id AND lease_token = v_lease.lease_token;
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = v_lease.campaign_id AND status = 'đang chạy' AND runtime_claim_token IS NULL AND runtime_unit_token IS NULL;
    UPDATE public.auto_accounts SET status = 'chờ xử lý', updated_at = v_now WHERE id = v_lease.account_id AND status = 'đang chạy' AND runtime_operation_claim_token IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.account_id = auto_accounts.id
                        AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL));
    v_released := v_released + 1;
  END LOOP;
  RETURN jsonb_build_object('closedTargets', v_closed, 'releasedLeases', v_released);
END $function$
