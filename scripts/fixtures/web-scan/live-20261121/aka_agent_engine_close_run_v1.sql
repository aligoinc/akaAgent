CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_run_v1(p_run_id bigint, p_via text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- V576: đóng một lượt data còn mở mà nơi chạy đã bỏ. p_via: 'stale' (lease hết hạn), 'orphan' (lượt mồ côi, B), 'desktop_reset' (Desktop
-- đăng nhập / đăng xuất / thoát, A). Cách của close_stale V515: đã ghi dấu "sắp gửi" (hoặc có kết quả đã giao / không rõ) thì "hoàn thành",
-- không gửi lại; chưa ghi dấu thì theo engine.stale_unsent_target_action. D1: mọi dấu đã có kết quả (không còn dấu 'pending') thì chốt theo kết
-- quả đã ghi bằng lần chốt rỗng của report_v1, giữ nguyên chuỗi data lỗi; lỗi thì quay về cách V515.
-- Trả 'skipped' (không còn mở), 'final' (chốt theo kết quả), 'requeued' (về hàng đợi), 'completed' (đóng "hoàn thành").
DECLARE
  v_now timestamptz := clock_timestamp();
  v_unsent text := public.aka_agent_engine_setting('engine.stale_unsent_target_action', 'complete');
  rr public.auto_engine_target_runs%ROWTYPE;
  v_marked boolean;
  v_code text;
  v_msg text;
  v_status text;
  v_res jsonb;
  v_es public.auto_campaign_error_state%ROWTYPE;
  v_es_found boolean;
  v_final_code text;
BEGIN
  SELECT * INTO rr FROM public.auto_engine_target_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR rr.completed_at IS NOT NULL THEN RETURN 'skipped'; END IF;
  v_marked := EXISTS (SELECT 1 FROM jsonb_array_elements(rr.marks) m WHERE m.value->>'state' IN ('pending', 'delivered', 'partial', 'unknown'))
           OR EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = rr.id AND eo.delivery_state IN ('delivered', 'partial', 'unknown'));
  -- D1: mọi dấu đã có kết quả. Bộ cũ đã nhận lại chiến dịch (token bộ cũ) thì không đụng data, đi cách V515 (chỉ đóng sổ lượt).
  IF v_marked AND jsonb_array_length(rr.marks) > 0
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rr.marks) m WHERE coalesce(m.value->>'state', 'pending') = 'pending')
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.id = rr.campaign_id
                      AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)) THEN
    BEGIN
      SELECT * INTO v_es FROM public.auto_campaign_error_state WHERE campaign_id = rr.campaign_id FOR UPDATE;
      v_es_found := FOUND;
      -- report_v1 giữ close_reason đã có (coalesce), nên lượt vẫn ghi là bị bỏ dở ('stale').
      UPDATE public.auto_engine_target_runs SET close_reason = 'stale' WHERE id = rr.id;
      v_res := public.aka_agent_engine_report_v1(rr.id, rr.lease_token, '[]'::jsonb, true, false);
      SELECT x.final_error_code INTO v_final_code FROM public.auto_engine_target_runs x WHERE x.id = rr.id AND x.completed_at IS NOT NULL;
      IF NOT FOUND OR coalesce((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'v576_final_from_outcomes_failed';
      END IF;
      -- Chuỗi data lỗi giữ như trước lần chốt này.
      IF v_es_found THEN
        UPDATE public.auto_campaign_error_state SET count_consecutive_bad_targets = v_es.count_consecutive_bad_targets,
          last_input_data_id = v_es.last_input_data_id, last_reason = v_es.last_reason, last_bad_target_at = v_es.last_bad_target_at,
          updated_at = v_es.updated_at
        WHERE campaign_id = rr.campaign_id;
      ELSE
        DELETE FROM public.auto_campaign_error_state WHERE campaign_id = rr.campaign_id;
      END IF;
      INSERT INTO public.auto_engine_target_events (input_data_id, campaign_id, target_run_id, kind, error_code, message, data)
      VALUES (rr.input_data_id, rr.campaign_id, rr.id, 'interrupted', v_final_code,
              'Lượt bị bỏ dở sau khi mọi bước gửi đã có kết quả; chốt theo kết quả đã báo',
              jsonb_build_object('marked', true, 'runnerId', rr.runner_id, 'leaseToken', rr.lease_token, 'via', p_via, 'final', 'outcomes'));
      RETURN 'final';
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  IF v_marked THEN
    v_code := 'err_engine_interrupted_while_sending'; v_status := 'hoàn thành';
  -- V515 (C): 'requeue_unstarted' chỉ trả về hàng đợi lượt data chưa có kết quả nào. Lượt đã có kết quả thì đóng như 'complete'.
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
          jsonb_build_object('marked', v_marked, 'runnerId', rr.runner_id, 'leaseToken', rr.lease_token, 'via', p_via));
  UPDATE public.auto_engine_target_runs SET completed_at = v_now, final_target_status = v_status, final_error_code = v_code, close_reason = 'stale'
   WHERE id = rr.id;
  RETURN CASE WHEN v_status = 'chờ xử lý' THEN 'requeued' ELSE 'completed' END;
END $function$
