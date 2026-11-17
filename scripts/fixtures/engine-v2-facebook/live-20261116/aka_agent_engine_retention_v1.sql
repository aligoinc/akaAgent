CREATE OR REPLACE FUNCTION public.aka_agent_engine_retention_v1(p_max_runs integer DEFAULT 20000, p_budget_ms integer DEFAULT 20000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_raw text := btrim(coalesce(public.aka_agent_engine_setting('engine.retention_days', '30'), ''));
  v_days integer := CASE WHEN v_raw ~ '^[0-9]{1,4}$' THEN least(greatest(v_raw::integer, 1), 3650) ELSE 30 END;
  v_cutoff timestamptz := clock_timestamp() - make_interval(days => v_days);
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => greatest(coalesce(p_budget_ms, 20000), 100) / 1000.0);
  v_max integer := greatest(coalesce(p_max_runs, 20000), 1);
  v_runs integer := 0;
  v_outcomes bigint := 0;
  v_events integer := 0;
  v_n integer;
  v_o bigint;
  v_stopped boolean := false;
BEGIN
  -- Lượt data đã đóng, cũ hơn mốc: xoá kéo theo kết quả và sự kiện của lượt (FK ON DELETE CASCADE). Lượt còn mở (completed_at NULL)
  -- không bao giờ bị xoá; close_stale_v1 đóng lượt bỏ dở sau engine.stale_target_minutes.
  LOOP
    IF v_runs >= v_max OR clock_timestamp() >= v_deadline THEN v_stopped := true; EXIT; END IF;
    WITH doomed AS (
      SELECT tr.id FROM public.auto_engine_target_runs tr
       WHERE tr.started_at < v_cutoff AND tr.completed_at IS NOT NULL
       ORDER BY tr.started_at LIMIT least(1000, v_max - v_runs)
       FOR UPDATE SKIP LOCKED
    ), gone AS (
      DELETE FROM public.auto_engine_target_runs tr USING doomed d WHERE tr.id = d.id RETURNING tr.outcome_count
    )
    SELECT count(*), coalesce(sum(gone.outcome_count), 0) INTO v_n, v_o FROM gone;
    v_runs := v_runs + v_n;
    v_outcomes := v_outcomes + v_o;
    EXIT WHEN v_n = 0;
  END LOOP;
  -- Sự kiện không gắn lượt (target_run_id NULL) hoặc còn sót: theo giờ ghi.
  LOOP
    IF clock_timestamp() >= v_deadline THEN v_stopped := true; EXIT; END IF;
    WITH doomed AS (
      SELECT e.id FROM public.auto_engine_target_events e
       WHERE e.created_at < v_cutoff ORDER BY e.created_at LIMIT 1000 FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.auto_engine_target_events e USING doomed d WHERE e.id = d.id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_events := v_events + v_n;
    EXIT WHEN v_n = 0;
  END LOOP;
  RETURN jsonb_build_object('retentionDays', v_days, 'cutoff', v_cutoff, 'runs', v_runs, 'outcomes', v_outcomes, 'events', v_events,
    'stoppedEarly', v_stopped);
END $function$
