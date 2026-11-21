CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_stale_v1(p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_stale interval := make_interval(mins => greatest(1, public.aka_agent_engine_setting('engine.stale_target_minutes', '10')::integer));
  v_orphan_setting text := btrim(public.aka_agent_engine_setting('engine.orphan_target_seconds', '120'));
  v_orphan_age interval;
  v_id bigint;
  v_kind text;
  v_closed integer := 0;
  v_orphans integer := 0;
  v_final integer := 0;
  v_released integer := 0;
  v_lease record;
BEGIN
  v_orphan_age := make_interval(secs => CASE WHEN v_orphan_setting ~ '^[0-9]{1,6}$' THEN greatest(30, v_orphan_setting::integer) ELSE 120 END);
  -- V576 (B): lượt mồ côi. Claim đã tạo lượt nhưng nơi chạy không nhận được câu trả lời, gọi lại claim cùng lease và chạy data kế: lượt cũ
  -- chưa ghi dấu, chưa có kết quả, trong khi cùng lease đã có lượt bắt đầu sau nó ≥ 3 giây (khác lần nhận cả lô: cả lô nhận trong một lần
  -- gọi ≤ 1,5 giây) và đã chốt. Nơi chạy làm data tuần tự nên không còn làm lượt cũ: trả về hàng đợi ngay, không chờ lease hết hạn.
  FOR v_id IN
    SELECT tr.id FROM public.auto_engine_target_runs tr
     WHERE tr.completed_at IS NULL AND tr.input_data_id IS NOT NULL AND tr.started_at < v_now - v_orphan_age
       AND tr.marks = '[]'::jsonb
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = tr.id)
       AND EXISTS (SELECT 1 FROM public.auto_engine_target_runs n
                    WHERE n.account_id = tr.account_id AND n.lease_token = tr.lease_token
                      AND n.started_at >= tr.started_at + interval '3 seconds' AND n.started_at <= tr.started_at + interval '15 minutes'
                      AND n.completed_at IS NOT NULL AND n.close_reason = 'reported')
     ORDER BY tr.id LIMIT greatest(1, p_limit)
     FOR UPDATE OF tr SKIP LOCKED
  LOOP
    v_kind := public.aka_agent_engine_close_run_v1(v_id, 'orphan');
    IF v_kind <> 'skipped' THEN v_orphans := v_orphans + 1; END IF;
  END LOOP;

  FOR v_id IN
    SELECT tr.id FROM public.auto_engine_target_runs tr
     WHERE tr.completed_at IS NULL AND tr.started_at < v_now - v_stale
       AND NOT EXISTS (SELECT 1 FROM public.auto_engine_leases l
                        WHERE l.account_id = tr.account_id AND l.lease_token = tr.lease_token AND l.expires_at > v_now - v_stale)
     ORDER BY tr.id LIMIT greatest(1, p_limit)
     FOR UPDATE SKIP LOCKED
  LOOP
    v_kind := public.aka_agent_engine_close_run_v1(v_id, 'stale');
    IF v_kind = 'final' THEN v_final := v_final + 1; END IF;
    IF v_kind <> 'skipped' THEN v_closed := v_closed + 1; END IF;
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
  RETURN jsonb_build_object('closedTargets', v_closed, 'releasedLeases', v_released, 'orphanTargets', v_orphans, 'finalizedTargets', v_final);
END $function$
