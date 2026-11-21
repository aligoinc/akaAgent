CREATE OR REPLACE FUNCTION public.aka_agent_engine_claim_batch_v1(p_ctx jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- V503: nhận cả lô cho gửi dạng chia sẻ (executeZaloShareMessageBatchCampaign của Desktop). Gọi claim_target_v1 nhiều lần trong cùng
-- giao dịch và cùng lease. Lô tối đa min(50, maxTargets, lượt còn lại trong ngày, lượt còn lại trong khung giờ) của thao tác chia sẻ
-- (actions[0], getZaloShareMessageBatchCapacity): hạn mức chỉ được giữ chỗ khi ghi dấu "sắp gửi", nên lô tự giới hạn theo lượt còn lại.
-- Lần nhận đầu không được thì trả nguyên phản hồi của claim_target_v1 (lõi xử lý như lượt thường). Lần nhận sau trả trạng thái khác
-- "claimed" / "cooldown_scan" thì kết thúc lô và hoàn tác lần nhận đó (ghi chú chờ, đổi trạng thái), lô sau sẽ gặp lại.
-- Cả lô dừng ở một mốc chung (engine.batch_claim_ms, mặc định 1.500 ms; vòng chống gửi lặp của từng lần nhận cũng dừng ở mốc này).
DECLARE
  v_start timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_budget_ms integer;
  v_deadline timestamptz;
  v_max integer;
  v_cap integer;
  v_account_id bigint;
  v_campaign_id bigint;
  v_code text;
  v_limit jsonb;
  v_daily numeric;
  v_window_count numeric;
  v_window_minutes numeric;
  v_used numeric;
  v_first jsonb;
  v_next jsonb;
  v_ctx jsonb;
  v_items jsonb;
  v_paused jsonb;
BEGIN
  v_budget_ms := CASE WHEN public.aka_agent_engine_setting('engine.batch_claim_ms', '1500') ~ '^[0-9]{1,6}$'
                      THEN greatest(100, public.aka_agent_engine_setting('engine.batch_claim_ms', '1500')::integer) ELSE 1500 END;
  v_deadline := v_start + make_interval(secs => v_budget_ms / 1000.0);
  v_max := CASE WHEN coalesce(p_ctx->>'maxTargets', '') ~ '^[0-9]{1,3}$' THEN least(50, greatest(1, (p_ctx->>'maxTargets')::integer)) ELSE 50 END;
  PERFORM set_config('aka.engine.claim_deadline', v_deadline::text, true);
  v_first := public.aka_agent_engine_claim_target_v1(p_ctx);
  IF v_first->>'status' IS DISTINCT FROM 'claimed' THEN
    PERFORM set_config('aka.engine.claim_deadline', '', true);
    RETURN v_first;
  END IF;

  v_account_id := (p_ctx->>'accountId')::bigint;
  v_campaign_id := (p_ctx->>'campaignId')::bigint;
  v_code := p_ctx->'actions'->0->>'code';
  v_cap := v_max;
  IF v_code IS NOT NULL THEN
    v_limit := public.aka_agent_engine_action_limit(v_campaign_id, v_account_id, v_code);
    IF v_limit IS NOT NULL THEN
      v_daily := (v_limit->>'daily')::numeric;
      v_window_count := (v_limit->>'windowCount')::numeric;
      v_window_minutes := (v_limit->>'windowMinutes')::numeric;
      -- Cùng cách đếm như claim_target_v1 (lượt trong ngày đã giữ chỗ; khung giờ = lịch sử tính lượt + dấu "sắp gửi" đang chờ).
      IF coalesce(v_daily, 0) > 0 THEN
        SELECT CASE WHEN s.count_date = v_vn THEN s.count_action_in_day ELSE 0 END INTO v_used
          FROM public.auto_account_action_status s WHERE s.account_id = v_account_id AND s.action_code = v_code;
        v_cap := least(v_cap, greatest(1, floor(v_daily - coalesce(v_used, 0))::integer));
      END IF;
      IF coalesce(v_window_count, 0) > 0 AND coalesce(v_window_minutes, 0) > 0 THEN
        SELECT count(*) INTO v_used FROM (
          SELECT d.id FROM public.auto_campaign_details d
           WHERE d.account_id = v_account_id AND d.action_code = v_code
             AND d.created_at >= v_start - make_interval(secs => (v_window_minutes * 60)::double precision)
             AND (d.counts_toward_limit IS TRUE OR (d.counts_toward_limit IS NULL AND d.status IN ('thành công', 'thất bại')))
          UNION ALL
          SELECT rr.id FROM public.auto_engine_target_runs rr, jsonb_array_elements(rr.marks) m
           WHERE rr.account_id = v_account_id AND rr.completed_at IS NULL
             AND m.value->>'actionCode' = v_code AND m.value->>'state' = 'pending'
        ) x;
        v_cap := least(v_cap, greatest(1, floor(v_window_count - coalesce(v_used, 0))::integer));
      END IF;
    END IF;
  END IF;

  v_items := jsonb_build_array(jsonb_build_object('targetRunId', v_first->'targetRunId', 'target', v_first->'target',
    'targetKey', v_first->'targetKey', 'actions', v_first->'actions'));
  v_paused := coalesce(v_first->'cooldownPaused', '[]'::jsonb);
  v_ctx := p_ctx || jsonb_build_object('leaseToken', v_first->>'leaseToken');
  WHILE jsonb_array_length(v_items) < v_cap AND clock_timestamp() < v_deadline LOOP
    BEGIN
      v_next := public.aka_agent_engine_claim_target_v1(v_ctx);
      IF v_next->>'status' NOT IN ('claimed', 'cooldown_scan') THEN
        RAISE EXCEPTION USING ERRCODE = 'AKB02', MESSAGE = v_next::text;
      END IF;
    EXCEPTION WHEN SQLSTATE 'AKB02' THEN
      -- Hoàn tác lần nhận không được (ghi chú chờ, đổi trạng thái…): lô sau sẽ gặp lại đúng trạng thái này.
      EXIT;
    END;
    v_paused := v_paused || coalesce(v_next->'cooldownPaused', '[]'::jsonb);
    IF v_next->>'status' = 'claimed' THEN
      v_items := v_items || jsonb_build_array(jsonb_build_object('targetRunId', v_next->'targetRunId', 'target', v_next->'target',
        'targetKey', v_next->'targetKey', 'actions', v_next->'actions'));
    END IF;
  END LOOP;
  PERFORM set_config('aka.engine.claim_deadline', '', true);
  RETURN (v_first - 'targetRunId' - 'target' - 'targetKey' - 'cooldownPaused')
    || jsonb_build_object('items', v_items, 'cooldownPaused', v_paused, 'capacity', v_cap);
END $function$
