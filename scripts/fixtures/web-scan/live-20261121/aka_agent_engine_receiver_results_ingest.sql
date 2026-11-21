CREATE OR REPLACE FUNCTION private.aka_agent_engine_receiver_results_ingest(p_budget_ms integer DEFAULT NULL::integer, p_chunk integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_cfg jsonb := private.aka_agent_engine_target_check_config();
  v_budget integer;
  v_chunk integer;
  v_started timestamptz := clock_timestamp();
  v_deadline timestamptz;
  v_keep integer;
  v_from bigint;
  v_start bigint;
  v_to bigint;
  v_top bigint;
  v_cap bigint;
  v_stats jsonb;
  v_add jsonb;
  v_cleaned timestamptz;
  v_hour integer;
  v_throttled boolean := false;
  v_chunks integer := 0;
  v_rows bigint := 0;
  v_bad bigint := 0;
  v_ok bigint := 0;
  v_n integer;
  v_nb integer;
  v_no integer;
  v_deleted integer := 0;
BEGIN
  -- Gọi tay có ngân sách (nạp bù) thì chạy kể cả khi ingest = false.
  IF p_budget_ms IS NULL AND v_cfg->'ingest' = 'false'::jsonb THEN RETURN jsonb_build_object('status', 'off'); END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('aka-agent-engine-receiver-results-ingest', 0)) THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;
  v_budget := greatest(500, least(90000, coalesce(p_budget_ms,
    CASE WHEN jsonb_typeof(v_cfg->'ingestBudgetMs') = 'number' THEN (v_cfg->>'ingestBudgetMs')::numeric::integer END, 40000)));
  v_chunk := greatest(100, least(200000, coalesce(p_chunk,
    CASE WHEN jsonb_typeof(v_cfg->'ingestChunk') = 'number' THEN (v_cfg->>'ingestChunk')::numeric::integer END, 5000)));
  -- Giữ ít nhất 365 ngày (giảm số ngày xét rồi tăng lại không mất dữ liệu).
  SELECT greatest(365, coalesce(max(rl.days), 365)) INTO v_keep FROM private.aka_agent_engine_target_check_rules() rl;
  SELECT s.last_detail_id, s.stats, s.cleaned_at INTO v_from, v_stats, v_cleaned
    FROM private.auto_engine_receiver_results_state s WHERE s.id = 1 FOR UPDATE;
  v_start := v_from;
  SELECT max(d.id) INTO v_top FROM public.auto_campaign_details d;
  v_top := coalesce(v_top, 0);
  -- Chỉ nạp tới dòng đã ghi hơn 3 phút (giao dịch ghi lịch sử chưa xong có thể còn giữ id nhỏ hơn dòng đã thấy).
  v_cap := coalesce((SELECT d.id FROM public.auto_campaign_details d
                      WHERE d.id > v_top - 5000 AND d.id <= v_top AND d.created_at <= v_started - interval '3 minutes'
                      ORDER BY d.id DESC LIMIT 1),
                    v_top - 5000);
  -- Nạp lần đầu (còn tồn nhiều, đọc nguội ~1 ms mỗi id): ban ngày (giờ VN, mặc định 8–18h) chỉ chạy backfillDayBudgetMs mỗi phút để
  -- không đọc đĩa nặng giờ cao điểm; gọi tay có ngân sách thì không giới hạn.
  v_hour := extract(hour FROM (v_started AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer;
  IF p_budget_ms IS NULL AND v_cap - v_from > coalesce(CASE WHEN jsonb_typeof(v_cfg->'backfillThresholdIds') = 'number'
                                                            THEN (v_cfg->>'backfillThresholdIds')::numeric END, 50000)
     AND v_hour >= coalesce(CASE WHEN jsonb_typeof(v_cfg->'backfillDayHours'->0) = 'number' THEN (v_cfg->'backfillDayHours'->>0)::numeric::integer END, 8)
     AND v_hour < coalesce(CASE WHEN jsonb_typeof(v_cfg->'backfillDayHours'->1) = 'number' THEN (v_cfg->'backfillDayHours'->>1)::numeric::integer END, 18) THEN
    v_budget := least(v_budget, greatest(500, least(90000, coalesce(CASE WHEN jsonb_typeof(v_cfg->'backfillDayBudgetMs') = 'number'
                                                                         THEN (v_cfg->>'backfillDayBudgetMs')::numeric::integer END, 3000))));
    v_throttled := true;
  END IF;
  v_deadline := v_started + make_interval(secs => v_budget / 1000.0);

  WHILE v_from < v_cap AND clock_timestamp() < v_deadline LOOP
    v_to := least(v_from + v_chunk, v_cap);
    WITH tr AS MATERIALIZED (
      SELECT * FROM private.aka_agent_engine_target_check_tracked()
    ), src AS MATERIALIZED (
      SELECT d.id, d.created_at, d.action_code, d.error_code,
             (d.error_code IS NULL AND (d.report_group = 'success' OR d.status = 'thành công')
              -- Thành công của tài khoản đã là bạn bè không xoá lần hỏng (bạn bè luôn nhắn được dù người nhận chặn người lạ).
              AND NOT coalesce(d.data->'target'->'isFriend' = 'true'::jsonb, false)) AS is_ok,
             left(coalesce(nullif(d.data->'signal'->>'code', ''), nullif(d.data->'zalo'->>'code', '')), 40) AS raw_code,
             -- Như aka_agent_engine_receiver_key (viết thẳng để không gọi thêm một hàm mỗi dòng).
             np.n AS phone_n,
             nullif(btrim(coalesce(d.data->'target'->>'globalId', '')), '') AS global_id
        FROM public.auto_campaign_details d
        LEFT JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id
        CROSS JOIN LATERAL (SELECT nullif(public.normalize_phone(coalesce(nullif(btrim(i.phone), ''), nullif(btrim(d.data->'target'->>'phone'), ''))), '') AS n) np
       WHERE d.id > v_from AND d.id <= v_to
         AND d.action_code = ANY (ARRAY['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend'])
         -- Dòng do chính việc kiểm ghi (bước bỏ qua) không phải kết quả Zalo thật.
         AND NOT coalesce(d.policy_snapshot->'v2'->'targetCheck' = 'true'::jsonb, false)
    ), srcf AS MATERIALIZED (
      SELECT s.*, (tr.error_code IS NOT NULL) AS is_bad FROM src s LEFT JOIN tr ON tr.action_code = s.action_code AND tr.error_code = s.error_code
    ), rws AS MATERIALIZED (
      -- Mỗi kết quả một dòng cho mỗi khoá có được (SĐT, global id).
      SELECT f.*, k.kind, k.key FROM srcf f
      CROSS JOIN LATERAL (VALUES ('phone', CASE WHEN f.phone_n IS NOT NULL THEN md5('p:' || f.phone_n)::uuid END),
                                 ('global', CASE WHEN f.global_id IS NOT NULL THEN md5('g:' || f.global_id)::uuid END)) k(kind, key)
       WHERE k.key IS NOT NULL
    ), agg_bad AS MATERIALIZED (
      SELECT DISTINCT ON (w.key, w.action_code, w.error_code) w.key, w.kind, w.action_code, w.error_code, w.raw_code, w.created_at, w.id
        FROM rws w WHERE w.is_bad ORDER BY w.key, w.action_code, w.error_code, w.id DESC
    ), agg_ok AS MATERIALIZED (
      SELECT w.key, w.action_code, max(w.created_at) AS ok_at FROM rws w WHERE w.is_ok GROUP BY w.key, w.action_code
    ), win AS MATERIALIZED (
      SELECT w.id, w.key, w.kind, w.action_code, w.created_at,
             max(w.id) FILTER (WHERE w.is_bad) OVER pw AS prev_bad_id,
             max(w.created_at) FILTER (WHERE w.is_ok) OVER pw AS prev_ok_at
        FROM rws w
      WINDOW pw AS (PARTITION BY w.key, w.action_code ORDER BY w.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
    ), kp AS MATERIALIZED (
      -- Theo từng khoá, ngay trước kết quả này: lần hỏng gần nhất (trong phần đang nạp hoặc trong sổ) và lần thành công gần nhất.
      SELECT w.id, w.kind, b.bad_at, b.error_code AS prior_code, b.raw_code AS prior_raw,
             greatest(w.prev_ok_at, (SELECT max(x.ok_at) FROM private.auto_engine_receiver_results x
                                      WHERE x.receiver_key = w.key AND x.action_code = w.action_code)) AS ok_at
        FROM win w
        LEFT JOIN LATERAL (
          SELECT q.bad_at, q.error_code, q.raw_code FROM (
            SELECT pb.created_at AS bad_at, pb.error_code, pb.raw_code FROM rws pb WHERE pb.id = w.prev_bad_id AND pb.key = w.key
            UNION ALL
            SELECT x.bad_at, x.error_code, x.bad_zalo_code FROM private.auto_engine_receiver_results x
             WHERE x.receiver_key = w.key AND x.action_code = w.action_code
          ) q WHERE q.bad_at < w.created_at ORDER BY q.bad_at DESC LIMIT 1) b ON true
    ), ev AS MATERIALIZED (
      -- Mỗi kết quả: lần hỏng gần nhất qua mọi khoá, và lần thành công gần nhất qua mọi khoá.
      SELECT f.id, f.action_code, f.created_at, f.error_code, f.is_bad, f.is_ok,
             pr.bad_at AS prior_bad_at, pr.prior_code, pr.prior_raw, pr.kind AS prior_kind,
             (SELECT max(k3.ok_at) FROM kp k3 WHERE k3.id = f.id) AS prior_ok_at
        FROM srcf f
        LEFT JOIN LATERAL (SELECT k2.bad_at, k2.prior_code, k2.prior_raw, k2.kind FROM kp k2
                            WHERE k2.id = f.id AND k2.bad_at IS NOT NULL ORDER BY k2.bad_at DESC LIMIT 1) pr ON true
    ), st AS (
      SELECT jsonb_object_agg(z.k, z.n) AS j FROM (
        SELECT e.action_code || '|all|' || CASE WHEN e.is_bad THEN e.error_code WHEN e.is_ok THEN 'ok' ELSE 'other' END AS k, count(*) AS n
          FROM ev e GROUP BY 1
        UNION ALL
        SELECT e.action_code || '|pred|' || e.prior_code || '/' || coalesce(e.prior_raw, '-') || '|' || e.prior_kind || '|'
                 || CASE WHEN e.created_at - e.prior_bad_at < interval '7 days' THEN 'd007'
                         WHEN e.created_at - e.prior_bad_at < interval '30 days' THEN 'd030'
                         WHEN e.created_at - e.prior_bad_at < interval '90 days' THEN 'd090'
                         WHEN e.created_at - e.prior_bad_at < interval '365 days' THEN 'd365' ELSE 'd999' END
                 || '|' || CASE WHEN e.is_bad AND e.error_code = e.prior_code THEN 'same' WHEN e.is_bad THEN 'bad' WHEN e.is_ok THEN 'ok' ELSE 'other' END,
               count(*)
          FROM ev e
         WHERE e.prior_bad_at IS NOT NULL AND (e.prior_ok_at IS NULL OR e.prior_ok_at < e.prior_bad_at)
         GROUP BY 1
      ) z
    ), ins AS (
      INSERT INTO private.auto_engine_receiver_results AS x (receiver_key, key_kind, action_code, error_code, bad_zalo_code, bad_at, bad_detail_id, ok_at)
      SELECT b.key, b.kind, b.action_code, b.error_code, b.raw_code, b.created_at, b.id, o.ok_at
        FROM agg_bad b LEFT JOIN agg_ok o ON o.key = b.key AND o.action_code = b.action_code
      ON CONFLICT (receiver_key, action_code, error_code) DO UPDATE SET
        bad_zalo_code = CASE WHEN EXCLUDED.bad_detail_id >= x.bad_detail_id THEN EXCLUDED.bad_zalo_code ELSE x.bad_zalo_code END,
        bad_at = CASE WHEN EXCLUDED.bad_detail_id >= x.bad_detail_id THEN EXCLUDED.bad_at ELSE x.bad_at END,
        bad_detail_id = greatest(EXCLUDED.bad_detail_id, x.bad_detail_id),
        ok_at = greatest(x.ok_at, EXCLUDED.ok_at)
      RETURNING 1
    ), upd AS (
      UPDATE private.auto_engine_receiver_results x SET ok_at = o.ok_at
        FROM agg_ok o
       WHERE x.receiver_key = o.key AND x.action_code = o.action_code AND (x.ok_at IS NULL OR x.ok_at < o.ok_at)
         AND NOT EXISTS (SELECT 1 FROM agg_bad b WHERE b.key = x.receiver_key AND b.action_code = x.action_code AND b.error_code = x.error_code)
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM srcf), (SELECT count(*) FROM ins), (SELECT count(*) FROM upd), (SELECT st.j FROM st)
      INTO v_n, v_nb, v_no, v_add;
    IF v_add IS NOT NULL THEN
      SELECT coalesce(jsonb_object_agg(u.k, u.n), '{}'::jsonb) INTO v_stats FROM (
        SELECT y.k, sum(y.n)::bigint AS n FROM (
          SELECT e.key AS k, (e.value #>> '{}')::bigint AS n FROM jsonb_each(coalesce(v_stats, '{}'::jsonb)) e
          UNION ALL
          SELECT e.key, (e.value #>> '{}')::bigint FROM jsonb_each(v_add) e
        ) y GROUP BY y.k
      ) u;
    END IF;
    v_rows := v_rows + v_n; v_bad := v_bad + v_nb; v_ok := v_ok + v_no; v_chunks := v_chunks + 1;
    v_from := v_to;
  END LOOP;

  -- Mỗi ngày một lần: bỏ lần hỏng đã quá số ngày giữ (ít nhất 365, hoặc số ngày xét lớn nhất) + 1 ngày.
  IF v_cleaned IS NULL OR v_cleaned < v_started - interval '1 day' THEN
    DELETE FROM private.auto_engine_receiver_results x WHERE x.bad_at < v_started - make_interval(days => v_keep + 1);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_cleaned := v_started;
  END IF;

  UPDATE private.auto_engine_receiver_results_state s SET last_detail_id = v_from, stats = coalesce(v_stats, '{}'::jsonb), runs = s.runs + 1,
         cleaned_at = v_cleaned, updated_at = clock_timestamp(),
         last_run = jsonb_build_object('at', v_started, 'from', v_start, 'to', v_from, 'cap', v_cap, 'budgetMs', v_budget, 'throttled', v_throttled,
           'chunks', v_chunks, 'rows', v_rows, 'badUpserts', v_bad, 'okUpdates', v_ok, 'deleted', v_deleted,
           'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000))
   WHERE s.id = 1;
  RETURN jsonb_build_object('status', 'ok', 'from', v_start, 'to', v_from, 'cap', v_cap, 'budgetMs', v_budget, 'throttled', v_throttled,
    'chunks', v_chunks, 'rows', v_rows, 'badUpserts', v_bad, 'okUpdates', v_ok, 'deleted', v_deleted, 'caughtUp', v_from >= v_cap);
END $function$
