CREATE OR REPLACE FUNCTION public.aka_agent_engine_error_watch_tick_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
 SET statement_timeout TO '20s'
AS $function$
DECLARE
  c_default_known CONSTANT text[] := ARRAY[
    'err_fb_group_composer_editor_not_found',   -- FB40 không thấy ô đăng bài (giữ như bộ cũ)
    'err_group_post_frequency_limit',           -- FB02 Facebook giới hạn tần suất
    'err_fb_group_cannot_post_not_member',      -- FB11 chưa vào nhóm
    'err_fb_group_cannot_post_unavailable',     -- FB14 nhóm không còn
    'err_fb_add_friend_unavailable',            -- FB22 nút kết bạn ẩn
    'err_fb_page_inbox_customer_not_found',     -- FB23
    'err_fb_page_inbox_wrong_conversation',     -- FB24
    'err_engine_fb_no_history',                 -- FB45 bước không ghi lịch sử, theo thiết kế
    'err_engine_cancelled'];                    -- RUN01 khách dừng
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_vn_start timestamptz := date_trunc('day', clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_raw text;
  v_cfg jsonb;
  v_known text[];
  st private.auto_engine_error_watch_state%ROWTYPE;
  v_from timestamptz;
  v_to timestamptz;
  v_stale_from timestamptz;
  v_stale_to timestamptz;
  v_seen integer := 0;
  v_cases integer := 0;
  v_paused integer := 0;
  v_stale integer := 0;
  v_spikes integer := 0;
  v_hour timestamptz;
  v_days numeric;
  -- chèn việc
  v_enqueue boolean;
  v_project public.ai_project%ROWTYPE;
  v_staff bigint;
  v_org bigint;
  v_max_pending integer;
  v_max_day integer;
  v_resend integer;
  v_regrow numeric;
  v_regrow_days integer;
  v_pending integer;
  v_slots integer;
  v_open_blocked boolean := false;
  v_minute integer;
  cs private.auto_engine_error_cases%ROWTYPE;
  v_thread_open boolean;
  v_question text;
  v_intake jsonb;
  v_payload jsonb;
  v_res jsonb;
  v_err text;
  v_request uuid;
  v_inserted jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_msg_id bigint;
  v_kind_label text;
  -- ảnh
  v_images boolean;
  v_image_cap_mb numeric;
  v_shot_staff bigint;
  v_req_id bigint;
  v_image_requests integer := 0;
  -- V593: chờ ảnh lỗi về trước khi hỏi
  v_image_wait integer;
  v_image_waiting integer := 0;
  v_wait_status text;
  v_wait_created timestamptz;
  v_wait_files integer;
  v_images_ready boolean;
  -- V594: trần việc mỗi giờ; mở lại ca đã bỏ qua
  v_max_hour integer;
  v_tasks_hour integer := 0;
  v_reopen_hits integer;
  v_reopened integer := 0;
  v_files integer;
  v_req_status text;
  -- V599: xin ảnh từ nhiều lượt mỗi ca
  v_image_runs integer;
  v_shot record;
  v_req_ids bigint[];
  v_wait_pending integer;
  v_wait_pending_all integer;
  v_req_list text;
  -- fire
  v_fire boolean;
  v_fire_routine text;
  v_fire_token text;
  v_fired integer := 0;
  v_result jsonb;
  -- V588: lỗi theo từng lượt, câu cho khách
  v_items integer := 0;
  v_stale_items integer := 0;
  v_notes integer := 0;
  v_item_days integer;
  it record;
  v_old_log text;
  v_new_log text;
  -- V588: gọi lại /fire khi câu chưa ai nhận
  v_fire_retry integer;
  v_fire_max integer;
  v_refired integer := 0;
  fr record;
BEGIN
  SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = 'engine.error_watch' AND s.is_active;
  BEGIN
    v_cfg := v_raw::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_cfg := NULL;
  END;
  IF v_cfg IS NULL OR jsonb_typeof(v_cfg) <> 'object' OR (v_cfg -> 'enabled') IS DISTINCT FROM 'true'::jsonb THEN
    RETURN jsonb_build_object('ok', true, 'enabled', false);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('aka-agent-engine-error-watch', 0)) THEN
    RETURN jsonb_build_object('ok', true, 'busy', true);
  END IF;

  IF jsonb_typeof(v_cfg -> 'knownCodes') = 'array' THEN
    SELECT coalesce(array_agg(value), '{}') INTO v_known FROM jsonb_array_elements_text(v_cfg -> 'knownCodes');
  ELSE
    v_known := c_default_known;
  END IF;

  INSERT INTO private.auto_engine_error_watch_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
  SELECT * INTO st FROM private.auto_engine_error_watch_state WHERE id FOR UPDATE;
  IF st.day IS DISTINCT FROM v_vn THEN
    st.day := v_vn;
    st.tasks_today := 0;
  END IF;
  st.last_error := NULL;

  -- Khoảng đọc: từ mốc lần trước tới 15 giây trước (chừa các giao dịch report đang ghi). Lần đầu đọc 30 phút; không bao giờ quá 6 giờ.
  v_to := v_now - interval '15 seconds';
  v_from := greatest(coalesce(st.cursor_at, v_now - interval '30 minutes'), v_now - interval '6 hours');

  IF v_to > v_from THEN
    -- 1. Kết quả lỗi của engine Facebook trong khoảng: đếm theo giờ (mọi mã) và gom ca (mã chưa có kết luận).
    WITH fbo AS MATERIALIZED (
      SELECT o.target_run_id, o.action_code, o.error_code, o.created_at,
             o.result_key, o.input_data_id, o.campaign_id, o.account_id, o.detail_id, left(o.signal ->> 'message', 500) AS message,
             o.decision -> 'result' ->> 'publicCode' AS public_code,
             (o.signal ? 'screenshotId') AS has_screenshot,
             regexp_replace(split_part(o.result_key, ':', 3), '#[0-9]+$', '') AS step,
             private.aka_agent_engine_error_pattern(o.signal ->> 'message') AS pattern
        FROM public.auto_engine_outcomes o
        JOIN public.auto_campaigns c ON c.id = o.campaign_id
        JOIN public.auto_campaign_actions a ON a.id = c.action_id
       WHERE o.created_at > v_from AND o.created_at <= v_to AND a.flatform_type = 'facebook' AND NOT o.ok AND o.error_code IS NOT NULL
    ), hourly AS (
      INSERT INTO private.auto_engine_error_hourly AS h (platform, error_code, action_code, hour_at, n)
      SELECT 'facebook', f.error_code, coalesce(f.action_code, ''), date_trunc('hour', f.created_at), count(*)
        FROM fbo f GROUP BY 2, 3, 4
      ON CONFLICT (platform, error_code, action_code, hour_at) DO UPDATE SET n = h.n + EXCLUDED.n
      RETURNING 1
    ), grouped AS (
      SELECT left(f.error_code || '|' || coalesce(f.action_code, '') || '|' || f.step || '|' || f.pattern, 700) AS case_key,
             CASE WHEN f.error_code = 'err_undefined' THEN 'chua_phan_loai' ELSE 'ma_chua_ket_luan' END AS kind,
             f.error_code, min(f.public_code) AS public_code, coalesce(f.action_code, '') AS action_code, f.step, f.pattern,
             count(*) AS hits, min(f.created_at) AS first_seen, max(f.created_at) AS last_seen,
             (array_agg(DISTINCT f.target_run_id))[1:5] AS sample_runs,
             max(f.target_run_id) FILTER (WHERE f.has_screenshot) AS screenshot_run
        FROM fbo f
       WHERE f.error_code <> ALL (v_known)
       GROUP BY f.error_code, coalesce(f.action_code, ''), f.step, f.pattern
    ), upserted AS (
      INSERT INTO private.auto_engine_error_cases AS k
        (case_key, platform, kind, error_code, public_code, action_code, step, pattern, hits, sample_runs, screenshot_run, first_seen_at, last_seen_at)
      SELECT g.case_key, 'facebook', g.kind, g.error_code, g.public_code, g.action_code, g.step, g.pattern, g.hits, g.sample_runs, g.screenshot_run,
             g.first_seen, g.last_seen
        FROM grouped g
      ON CONFLICT (case_key) DO UPDATE
        SET hits = k.hits + EXCLUDED.hits,
            last_seen_at = greatest(k.last_seen_at, EXCLUDED.last_seen_at),
            sample_runs = (SELECT coalesce(array_agg(x ORDER BY x DESC), '{}')
                             FROM (SELECT DISTINCT x FROM unnest(EXCLUDED.sample_runs || k.sample_runs) AS u(x) ORDER BY x DESC LIMIT 5) s),
            screenshot_run = coalesce(EXCLUDED.screenshot_run, k.screenshot_run),
            public_code = coalesce(k.public_code, EXCLUDED.public_code),
            updated_at = v_now
      RETURNING 1
    ), items AS (
      -- V588: mỗi kết quả lỗi thuộc một ca là một dòng (khách, tài khoản, chiến dịch, data lấy theo mã). Gọi lại không ghi trùng.
      INSERT INTO private.auto_engine_error_items
        (case_key, result_key, target_run_id, input_data_id, campaign_id, account_id, staff_id, organization_id, detail_id, error_code, public_code,
         action_code, step, message, occurred_at)
      SELECT left(f.error_code || '|' || coalesce(f.action_code, '') || '|' || f.step || '|' || f.pattern, 700), f.result_key, f.target_run_id,
             f.input_data_id, f.campaign_id, f.account_id, r.staff_id, r.organization_id, f.detail_id, f.error_code, f.public_code,
             coalesce(f.action_code, ''), f.step, f.message, f.created_at
        FROM fbo f LEFT JOIN public.auto_engine_target_runs r ON r.id = f.target_run_id
       WHERE f.error_code <> ALL (v_known)
      ON CONFLICT (result_key) DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM fbo), (SELECT count(*) FROM upserted), (SELECT count(*) FROM hourly), (SELECT count(*) FROM items)
      INTO v_seen, v_cases, v_files, v_items;  -- v_files ở đây chỉ để buộc CTE hourly chạy

    -- 2. Lượt làm chiến dịch bị engine tạm dừng: cộng vào ca của kết quả lỗi cuối cùng trong lượt (nếu ca đó có trong sổ). Đi từ các kết quả
    --    lỗi của 10 phút gần đây rồi tra lượt theo khoá chính; bảng lượt không có chỉ mục theo giờ đóng nên không quét bảng lượt.
    WITH err AS (
      SELECT DISTINCT ON (o.target_run_id) o.target_run_id,
             left(o.error_code || '|' || coalesce(o.action_code, '') || '|' || regexp_replace(split_part(o.result_key, ':', 3), '#[0-9]+$', '')
                  || '|' || private.aka_agent_engine_error_pattern(o.signal ->> 'message'), 700) AS case_key
        FROM public.auto_engine_outcomes o
        JOIN public.auto_campaigns c ON c.id = o.campaign_id
        JOIN public.auto_campaign_actions a ON a.id = c.action_id
       WHERE o.created_at > v_from - interval '10 minutes' AND o.created_at <= v_to AND a.flatform_type = 'facebook' AND NOT o.ok AND o.error_code IS NOT NULL
       ORDER BY o.target_run_id, o.created_at DESC
    ), paused AS (
      SELECT e.case_key, count(*) AS n
        FROM err e JOIN public.auto_engine_target_runs r ON r.id = e.target_run_id
       WHERE r.completed_at > v_from AND r.completed_at <= v_to AND r.final_response -> 'campaign' ->> 'effect' = 'pause'
       GROUP BY e.case_key
    ), bumped AS (
      UPDATE private.auto_engine_error_cases k SET pauses = k.pauses + p.n, updated_at = v_now
        FROM paused p WHERE k.case_key = p.case_key
      RETURNING 1
    )
    SELECT count(*) INTO v_paused FROM bumped;

    st.cursor_at := v_to;
  END IF;

  -- 3. Lượt bị bỏ dở (đóng stale) khi máy khách vẫn hoạt động sau đó. Lượt đóng stale không ghi kết quả nào và đóng 13 phút trở lên sau khi
  --    bắt đầu, nên mỗi lượt được xét đúng một lần, 30 phút sau khi bắt đầu, theo chỉ mục giờ bắt đầu (mỗi lần chỉ đọc vài phút lượt).
  --    V602: phân loại theo đường đóng lượt ở sự kiện interrupted (data.via, V576). desktop_reset (app khởi động lại / đăng nhập lại dọn lượt
  --    cũ, data về hàng đợi) không vào sổ ca; orphan (app nhận data kế tiếp cùng lease khi chưa báo xong) thành ca riêng, khoá thêm "|orphan";
  --    stale hoặc không có sự kiện: treo, giữ như cũ.
  v_stale_to := v_now - interval '30 minutes';
  v_stale_from := greatest(coalesce(st.stale_cursor_at, v_stale_to - interval '90 minutes'), v_stale_to - interval '6 hours');
  IF v_stale_to > v_stale_from THEN
    WITH stale_runs AS MATERIALIZED (
      SELECT r.id, r.input_data_id, r.campaign_id, r.account_id, r.staff_id, r.organization_id, r.completed_at, c.action_id, r.final_error_code,
             left('stale|' || c.action_id || '|' || coalesce(r.final_error_code, '') || CASE WHEN v.via = 'orphan' THEN '|orphan' ELSE '' END, 700) AS case_key,
             CASE WHEN v.via = 'orphan' THEN 'Lượt mồ côi: app đã nhận data kế tiếp khi chưa báo xong data này'
                  ELSE 'Lượt bị đóng vì treo quá lâu trong khi máy khách vẫn hoạt động' END AS pattern
        FROM public.auto_engine_target_runs r
        JOIN public.auto_campaigns c ON c.id = r.campaign_id
        JOIN public.auto_campaign_actions a ON a.id = c.action_id
        LEFT JOIN LATERAL (SELECT e.data ->> 'via' AS via FROM public.auto_engine_target_events e
                            WHERE e.input_data_id = r.input_data_id AND e.target_run_id = r.id AND e.kind = 'interrupted' AND e.data ? 'via'
                            ORDER BY e.id LIMIT 1) v ON true
       WHERE r.started_at > v_stale_from AND r.started_at <= v_stale_to AND r.close_reason = 'stale' AND a.flatform_type = 'facebook'
         AND v.via IS DISTINCT FROM 'desktop_reset'
         AND EXISTS (SELECT 1 FROM public.auto_staff_device_presence d
                      WHERE d.staff_id = r.staff_id AND d.last_seen_at >= r.completed_at - interval '2 minutes')
    ), stale AS (
      SELECT s0.case_key, s0.action_id, s0.final_error_code, min(s0.pattern) AS pattern,
             count(*) AS hits, min(s0.completed_at) AS first_seen, max(s0.completed_at) AS last_seen,
             (array_agg(s0.id ORDER BY s0.id DESC))[1:5] AS sample_runs
        FROM stale_runs s0
       GROUP BY s0.case_key, s0.action_id, s0.final_error_code
    ), upserted AS (
      INSERT INTO private.auto_engine_error_cases AS k
        (case_key, platform, kind, error_code, action_code, step, pattern, hits, sample_runs, first_seen_at, last_seen_at)
      SELECT s.case_key, 'facebook', 'luot_bo_do', s.final_error_code, s.action_id, '', s.pattern,
             s.hits, s.sample_runs, s.first_seen, s.last_seen
        FROM stale s
      ON CONFLICT (case_key) DO UPDATE
        SET hits = k.hits + EXCLUDED.hits, last_seen_at = greatest(k.last_seen_at, EXCLUDED.last_seen_at),
            sample_runs = (SELECT coalesce(array_agg(x ORDER BY x DESC), '{}')
                             FROM (SELECT DISTINCT x FROM unnest(EXCLUDED.sample_runs || k.sample_runs) AS u(x) ORDER BY x DESC LIMIT 5) s2),
            updated_at = v_now
      RETURNING 1
    ), stale_items AS (
      INSERT INTO private.auto_engine_error_items
        (case_key, result_key, target_run_id, input_data_id, campaign_id, account_id, staff_id, organization_id, error_code, action_code, step, message, occurred_at)
      SELECT s1.case_key, 'stale:' || s1.id, s1.id, s1.input_data_id, s1.campaign_id, s1.account_id, s1.staff_id, s1.organization_id, s1.final_error_code,
             s1.action_id, '', s1.pattern, coalesce(s1.completed_at, v_now)
        FROM stale_runs s1
      ON CONFLICT (result_key) DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM upserted), (SELECT count(*) FROM stale_items) INTO v_stale, v_stale_items;
    st.stale_cursor_at := v_stale_to;
  END IF;

  -- 4. Mã đã có kết luận tăng bất thường: giờ hiện tại >= 20 lượt và >= 3 lần trung bình cùng giờ của 7 ngày trước (cần >= 3 ngày dữ liệu).
  v_hour := date_trunc('hour', v_now);
  SELECT extract(epoch FROM (v_hour - min(h.hour_at))) / 86400.0 INTO v_days FROM private.auto_engine_error_hourly h WHERE h.platform = 'facebook';
  IF coalesce(v_days, 0) >= 3 THEN
    WITH cur AS (
      SELECT h.error_code, h.action_code, h.n,
             (SELECT coalesce(sum(b.n), 0) FROM private.auto_engine_error_hourly b
               WHERE b.platform = 'facebook' AND b.error_code = h.error_code AND b.action_code = h.action_code
                 AND b.hour_at IN (SELECT v_hour - make_interval(days => d) FROM generate_series(1, 7) AS d))
               / least(7, floor(v_days))::numeric AS baseline
        FROM private.auto_engine_error_hourly h
       WHERE h.platform = 'facebook' AND h.hour_at = v_hour AND h.n >= 20 AND h.error_code = ANY (v_known)
    ), upserted AS (
      INSERT INTO private.auto_engine_error_cases AS k
        (case_key, platform, kind, error_code, action_code, step, pattern, hits, first_seen_at, last_seen_at)
      SELECT left('spike|' || cur.error_code || '|' || cur.action_code || '|' || v_vn::text, 700), 'facebook', 'tang_bat_thuong', cur.error_code,
             cur.action_code, '', 'Trong giờ ' || to_char(v_hour AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24') || 'h có ' || cur.n
             || ' lượt, trung bình cùng giờ 7 ngày trước là ' || round(cur.baseline, 1), cur.n, v_hour, v_now
        FROM cur WHERE cur.n >= 3 * greatest(cur.baseline, 1)
      ON CONFLICT (case_key) DO UPDATE SET hits = greatest(k.hits, EXCLUDED.hits), last_seen_at = EXCLUDED.last_seen_at, updated_at = v_now
      RETURNING 1
    )
    SELECT count(*) INTO v_spikes FROM upserted;
  END IF;
  -- Dọn số theo giờ cũ hơn 15 ngày, mỗi giờ một lần.
  IF extract(minute FROM v_now) < 2 THEN
    DELETE FROM private.auto_engine_error_hourly h WHERE h.hour_at < v_now - interval '15 days';
    -- V588: lỗi theo lượt giữ itemRetentionDays ngày (mặc định 30, ít nhất 7); lượt đã ghi câu cho khách không cần dòng này để hiển thị.
    v_item_days := greatest(private.aka_agent_engine_error_num(v_cfg ->> 'itemRetentionDays', 30)::integer, 7);
    DELETE FROM private.auto_engine_error_items i WHERE i.occurred_at < v_now - make_interval(days => v_item_days);
  END IF;

  -- 5. Câu đã chèn: có báo cáo thì ca sang reported; quá hạn / lỗi / bị huỷ thì failed (sẽ gửi lại, có trần).
  -- V588: báo cáo xong thì chép kết luận về sổ ca. Câu cho khách và mã lỗi đề xuất chỉ vào trạng thái "proposed": chưa ghi gì cho khách,
  --       chưa ghi gì vào bảng mã lỗi, chờ admin akaBiz duyệt. Câu / mã đã duyệt thì báo cáo sau không ghi đè.
  UPDATE private.auto_engine_error_cases k
     SET status = CASE WHEN m.status = 'hoàn thành' THEN 'reported' ELSE 'failed' END,
         report = CASE WHEN rp.has THEN m.answer_json ELSE k.report END,
         report_message_id = CASE WHEN rp.has THEN m.id ELSE k.report_message_id END,
         report_at = CASE WHEN rp.has THEN v_now ELSE k.report_at END,
         summary = CASE WHEN rp.has THEN left(m.answer_json ->> 'tom_tat', 1000) ELSE k.summary END,
         conclusion = CASE WHEN rp.has AND coalesce(m.answer_json ->> 'ket_luan', '') <> '' THEN left(m.answer_json ->> 'ket_luan', 40) ELSE k.conclusion END,
         confidence = CASE WHEN rp.has AND coalesce(m.answer_json ->> 'do_chac', '') <> '' THEN left(m.answer_json ->> 'do_chac', 20) ELSE k.confidence END,
         customer_note = CASE WHEN rp.note IS NOT NULL AND k.customer_note_status <> 'approved' THEN rp.note ELSE k.customer_note END,
         customer_note_status = CASE WHEN rp.note IS NOT NULL AND k.customer_note_status <> 'approved' AND rp.note IS DISTINCT FROM k.customer_note
                                     THEN 'proposed' ELSE k.customer_note_status END,
         code_proposal = CASE WHEN rp.code IS NOT NULL AND k.code_proposal_status NOT IN ('approved', 'applied') THEN rp.code ELSE k.code_proposal END,
         code_proposal_status = CASE WHEN rp.code IS NOT NULL AND k.code_proposal_status NOT IN ('approved', 'applied') AND rp.code IS DISTINCT FROM k.code_proposal
                                     THEN 'proposed' ELSE k.code_proposal_status END,
         updated_at = v_now
    FROM public.ai_message m
    CROSS JOIN LATERAL (
      SELECT (m.status = 'hoàn thành' AND jsonb_typeof(m.answer_json) = 'object') AS has,
             CASE WHEN m.status = 'hoàn thành' AND jsonb_typeof(m.answer_json -> 'cau_cho_khach') = 'string' AND btrim(m.answer_json ->> 'cau_cho_khach') <> ''
                  THEN left(regexp_replace(btrim(m.answer_json ->> 'cau_cho_khach'), '\s+', ' ', 'g'), 200) END AS note,
             CASE WHEN m.status = 'hoàn thành' AND jsonb_typeof(m.answer_json -> 'de_xuat_ma_loi') = 'object' THEN m.answer_json -> 'de_xuat_ma_loi' END AS code
    ) rp
   WHERE k.status = 'queued' AND m.id = k.last_message_id
     AND (m.status IN ('hoàn thành', 'lỗi', 'đã hủy') OR m.deadline_at <= v_now);
  UPDATE private.auto_engine_error_cases k SET status = 'failed', updated_at = v_now
   WHERE k.status = 'queued' AND NOT EXISTS (SELECT 1 FROM public.ai_message m WHERE m.id = k.last_message_id);

  -- 5b. V588: câu cho khách. Ca đã được duyệt câu: ghi câu (kèm mã công khai) vào dòng lịch sử và ghi chú data của từng lượt thuộc ca, kể cả
  --     lượt mới về sau. Ca bị bỏ duyệt: trả lại câu cũ cho các lượt đã ghi. Mỗi lượt tick tối đa 100 lượt; ghi chú data chỉ đổi khi còn đúng
  --     câu cũ (data đã chạy lại và có ghi chú khác thì giữ nguyên). Một lượt ghi lỗi thì dừng vòng, không làm hỏng phần còn lại của tick.
  FOR it IN
    SELECT i.id, i.detail_id, i.input_data_id, i.public_code, i.original_log, i.note_applied, k.customer_note,
           (k.customer_note_status = 'approved' AND k.customer_note IS NOT NULL) AS approved
      FROM private.auto_engine_error_items i JOIN private.auto_engine_error_cases k ON k.case_key = i.case_key
     WHERE i.detail_id IS NOT NULL
       AND ((k.customer_note_status = 'approved' AND k.customer_note IS NOT NULL AND i.note_applied_at IS NULL)
            OR (k.customer_note_status <> 'approved' AND i.note_applied_at IS NOT NULL))
     ORDER BY i.id LIMIT 100
  LOOP
    BEGIN
      IF it.approved THEN
        v_new_log := it.customer_note || CASE WHEN coalesce(it.public_code, '') <> '' THEN ' (' || it.public_code || ')' ELSE '' END;
        SELECT d.log INTO v_old_log FROM public.auto_campaign_details d WHERE d.id = it.detail_id FOR UPDATE;
        IF FOUND AND v_old_log IS DISTINCT FROM v_new_log THEN
          UPDATE public.auto_campaign_details d
             SET log = v_new_log,
                 data = coalesce(d.data, '{}'::jsonb) || jsonb_build_object('errorReview',
                   jsonb_build_object('originalLog', coalesce(d.data #>> '{errorReview,originalLog}', v_old_log), 'at', v_now))
           WHERE d.id = it.detail_id;
          UPDATE public.auto_campaign_input_data x SET note = v_new_log WHERE x.id = it.input_data_id AND x.note = v_old_log;
        END IF;
        UPDATE private.auto_engine_error_items
           SET note_applied_at = v_now, note_applied = v_new_log, original_log = coalesce(original_log, v_old_log)
         WHERE id = it.id;
      ELSE
        IF it.original_log IS NOT NULL AND it.note_applied IS NOT NULL THEN
          UPDATE public.auto_campaign_details d
             SET log = it.original_log, data = coalesce(d.data, '{}'::jsonb) - 'errorReview'
           WHERE d.id = it.detail_id AND d.log = it.note_applied;
          UPDATE public.auto_campaign_input_data x SET note = it.original_log WHERE x.id = it.input_data_id AND x.note = it.note_applied;
        END IF;
        UPDATE private.auto_engine_error_items SET note_applied_at = NULL, note_applied = NULL WHERE id = it.id;
      END IF;
      v_notes := v_notes + 1;
    EXCEPTION WHEN OTHERS THEN
      st.last_error := 'Ghi câu cho khách lỗi: ' || left(SQLERRM, 200);
      EXIT;
    END;
  END LOOP;

  -- 5b (V594). Ca anh đã bỏ qua (status muted): mở lại để Claude kiểm lại khi trong 24 giờ có từ skipReopenHits24h lượt trở lên trên toàn
  --      hệ thống (mặc định 30). Đếm theo lượt lỗi của ca (auto_engine_error_items, chỉ mục case_key + occurred_at), dừng đếm khi đủ ngưỡng.
  --      Ca "tăng bất thường" mỗi ngày là một ca mới (khoá có ngày) nên bỏ qua loại ca này chỉ có tác dụng trong ngày đó.
  v_reopen_hits := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'skipReopenHits24h', 30)::integer, 1), 100000);
  WITH muted AS (
    SELECT k.case_key,
           (SELECT count(*) FROM (SELECT 1 FROM private.auto_engine_error_items i
                                   WHERE i.case_key = k.case_key AND i.occurred_at > v_now - interval '24 hours' LIMIT v_reopen_hits) z) AS n
      FROM private.auto_engine_error_cases k
     WHERE k.status = 'muted' AND k.platform = 'facebook'
  ), reopened AS (
    UPDATE private.auto_engine_error_cases k
       SET status = 'new',
           note = 'Mở lại sau khi bỏ qua: từ ' || m.n || ' lượt trong 24 giờ (' || to_char(v_now AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ')',
           updated_at = v_now
      FROM muted m
     WHERE k.case_key = m.case_key AND k.status = 'muted' AND m.n >= v_reopen_hits
    RETURNING 1
  )
  SELECT count(*) INTO v_reopened FROM reopened;

  -- 6. Chèn việc.
  v_enqueue := (v_cfg -> 'enqueue') = 'true'::jsonb;
  v_images := (v_cfg -> 'imageRequests') = 'true'::jsonb;
  v_fire := (v_cfg -> 'fire') = 'true'::jsonb;
  v_minute := extract(minute FROM v_now)::integer;
  IF v_enqueue AND jsonb_typeof(v_cfg -> 'enqueueWindow') = 'object' THEN
    -- Chế độ tác vụ cloud chạy theo lịch mỗi giờ: chỉ chèn việc trong mấy phút cuối giờ để việc còn đủ hạn khi tác vụ chạy.
    v_enqueue := v_minute BETWEEN private.aka_agent_engine_error_num(v_cfg #>> '{enqueueWindow,fromMinute}', 0)
                              AND private.aka_agent_engine_error_num(v_cfg #>> '{enqueueWindow,toMinute}', 59);
  END IF;
  IF v_enqueue THEN
    SELECT * INTO v_project FROM public.ai_project p WHERE p.code = coalesce(nullif(v_cfg ->> 'projectCode', ''), 'kiem-loi-chien-dich-facebook');
    v_staff := private.aka_agent_engine_error_num(v_cfg ->> 'staffId', NULL)::bigint;
    SELECT s.organization_id INTO v_org FROM public.org_staff s WHERE s.id = v_staff;
    IF v_project.id IS NULL OR NOT v_project.is_active OR v_staff IS NULL OR v_org IS NULL THEN
      v_enqueue := false;
      st.last_error := 'Chưa chèn việc: agent chưa bật hoặc thiết lập staffId không hợp lệ';
    END IF;
  END IF;

  IF v_enqueue THEN
    v_max_pending := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'maxPending', 2)::integer, 1), 3);
    v_max_day := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'maxPerDay', 10)::integer, 1), 45);
    v_resend := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'resendPerDay', 2)::integer, 0), 5);
    v_regrow := greatest(private.aka_agent_engine_error_num(v_cfg ->> 'regrowFactor', 3), 1.5);
    v_regrow_days := greatest(private.aka_agent_engine_error_num(v_cfg ->> 'regrowDays', 7)::integer, 1);
    v_image_cap_mb := greatest(private.aka_agent_engine_error_num(v_cfg ->> 'imageMaxTableMb', 2048), 0);
    -- V593: số phút chờ ảnh lỗi về trước khi hỏi (0 = hỏi ngay như V588), tối đa 120.
    v_image_wait := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'imageWaitMinutes', 15)::integer, 0), 120);
    -- V594: tối đa maxPerHour câu mỗi giờ (cả câu hỏi tiếp khi ảnh về); 0 hoặc bỏ trống = không giới hạn theo giờ như V593. Tối đa 10.
    v_max_hour := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'maxPerHour', 0)::integer, 0), 10);
    -- V599: số lượt lấy ảnh lỗi cho mỗi ca, mỗi lượt của một nhân viên khác nhau (mặc định 5, từ 1 tới 10).
    v_image_runs := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'imageRunsPerCase', 5)::integer, 1), 10);
    IF v_fire THEN
      v_fire_routine := nullif(v_cfg ->> 'fireRoutineId', '');
      IF v_fire_routine IS NULL OR v_fire_routine !~ '^trig_[A-Za-z0-9]+$' OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL
         OR to_regclass('vault.decrypted_secrets') IS NULL THEN
        v_fire := false;
      ELSE
        EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1' INTO v_fire_token USING 'AKA_AGENT_ENGINE_ERROR_WATCH_FIRE_TOKEN';
        IF coalesce(v_fire_token, '') = '' THEN v_fire := false; END IF;
      END IF;
    END IF;

    SELECT count(*) INTO v_pending
      FROM public.ai_message_thread t JOIN public.ai_message m ON m.thread_id = t.id AND m.seq = t.last_message_seq
     WHERE t.project_id = v_project.id AND t.org_staff_id = v_staff AND NOT t.is_delete
       AND m.status = ANY (private.aka_agent_ai_chat_active()) AND m.deadline_at > v_now;
    v_slots := least(v_max_pending - v_pending, v_max_day - st.tasks_today);
    IF v_max_hour > 0 THEN
      -- Đếm câu đã chèn trong giờ đồng hồ hiện tại (giờ VN lệch UTC đúng 7 giờ nên đầu giờ trùng nhau).
      SELECT count(*) INTO v_tasks_hour
        FROM public.ai_message_thread t JOIN public.ai_message m ON m.thread_id = t.id
       WHERE t.project_id = v_project.id AND t.org_staff_id = v_staff AND NOT t.is_delete AND m.created_at >= date_trunc('hour', v_now);
      v_slots := least(v_slots, v_max_hour - v_tasks_hour);
    END IF;

    -- 6a. Ảnh đã về cho ca đã có báo cáo: hỏi tiếp trong hội thoại của ca.
    FOR cs IN
      SELECT k.* FROM private.auto_engine_error_cases k
       WHERE k.image_request_id IS NOT NULL AND k.image_followup_at IS NULL AND k.status = 'reported' AND k.thread_id IS NOT NULL
       ORDER BY k.last_seen_at DESC LIMIT 5 FOR UPDATE
    LOOP
      -- V599: mọi yêu cầu ảnh của ca. Chưa có ảnh nào mà mọi yêu cầu đã kết thúc thì thôi. Có ảnh thì hỏi khi không còn yêu cầu nào đang
      -- chờ dưới 60 phút (máy khách tắt thì yêu cầu chờ tới 7 ngày; không đợi máy đó).
      v_req_ids := CASE WHEN cs.image_request_id IS NULL THEN '{}'::bigint[]
                       WHEN coalesce(array_length(cs.image_request_ids, 1), 0) > 0 THEN cs.image_request_ids
                       ELSE ARRAY[cs.image_request_id] END;
      SELECT count(*) FILTER (WHERE q.status IN ('pending', 'uploading') AND q.created_at > v_now - interval '60 minutes'),
             count(*) FILTER (WHERE q.status IN ('pending', 'uploading')),
             coalesce(sum(fc.n) FILTER (WHERE q.status = 'done'), 0)
        INTO v_wait_pending, v_wait_pending_all, v_files
        FROM public.auto_desktop_diagnostic_requests q
        CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.auto_desktop_diagnostic_files f WHERE f.request_id = q.id) fc
       WHERE q.id = ANY (v_req_ids);
      IF v_files = 0 AND v_wait_pending_all = 0 THEN
        UPDATE private.auto_engine_error_cases SET image_followup_at = v_now, note = 'Yêu cầu ảnh kết thúc không có ảnh', updated_at = v_now WHERE case_key = cs.case_key;
        CONTINUE;
      END IF;
      CONTINUE WHEN v_files = 0 OR v_wait_pending > 0 OR v_slots <= 0;
      v_req_list := array_to_string(v_req_ids, ', ');
      v_request := md5(cs.case_key || ':anh:' || cs.image_request_id)::uuid;
      v_question := '[Tự động] Đã có ' || v_files || ' ảnh lỗi từ máy khách cho ca này (yêu cầu ảnh ' || v_req_list || E').\n'
        || 'khoa: ' || cs.case_key || E'\n' || 'yeu cau anh: ' || v_req_list || E'\n'
        || 'Xem ảnh rồi bổ sung kết luận; chỉ báo điều mới so với báo cáo trước.';
      v_err := NULL; v_res := NULL;
      BEGIN
        v_res := public.aka_agent_ai_chat_insert(jsonb_build_object('threadId', cs.thread_id, 'question', left(v_question, 3900), 'staffId', v_staff,
          'organizationId', v_org, 'source', 'api', 'requestId', v_request::text));
      EXCEPTION WHEN OTHERS THEN
        v_err := SQLERRM;
      END;
      IF v_res IS NOT NULL AND (v_res -> 'ok') = 'true'::jsonb THEN
        v_msg_id := (v_res ->> 'messageId')::bigint;
        UPDATE private.auto_engine_error_cases
           SET status = 'queued', last_message_id = v_msg_id, last_reported_at = v_now, hits_at_last_report = hits, image_followup_at = v_now, updated_at = v_now
         WHERE case_key = cs.case_key;
        IF (v_res -> 'inserted') = 'true'::jsonb THEN st.tasks_today := st.tasks_today + 1; v_slots := v_slots - 1; END IF;
        v_inserted := v_inserted || jsonb_build_object('messageId', v_msg_id, 'khoa', cs.case_key, 'anh', true);
      ELSIF v_err = 'ai_chat_thread_closed' OR v_err = 'ai_chat_thread_not_found' THEN
        UPDATE private.auto_engine_error_cases SET thread_id = NULL, updated_at = v_now WHERE case_key = cs.case_key;
      ELSE
        v_skipped := v_skipped || jsonb_build_object('khoa', cs.case_key, 'ly_do', coalesce(v_err, v_res ->> 'code', 'khong_ro'));
      END IF;
    END LOOP;

    -- 6b. Ca cần báo: mới; đã báo mà tăng gấp v_regrow hoặc quá v_regrow_days ngày vẫn còn; câu trước quá hạn (gửi lại, có trần mỗi ngày).
    FOR cs IN
      SELECT k.* FROM private.auto_engine_error_cases k
       WHERE k.platform = 'facebook'
         AND (k.status = 'new'
              OR (k.status = 'reported' AND (k.hits >= greatest(k.hits_at_last_report, 1) * v_regrow
                                              OR (k.last_reported_at < v_now - make_interval(days => v_regrow_days) AND k.last_seen_at > k.last_reported_at)))
              OR (k.status = 'failed' AND (k.resend_day IS DISTINCT FROM v_vn OR k.resend_count < v_resend)))
       ORDER BY k.pauses DESC, k.hits DESC, (k.status = 'failed'), k.first_seen_at
       LIMIT 20 FOR UPDATE
    LOOP
      EXIT WHEN v_slots <= 0;
      SELECT EXISTS (SELECT 1 FROM public.ai_message_thread t WHERE t.id = cs.thread_id AND NOT t.is_delete AND t.status = 'đang mở'
                        AND t.project_id = v_project.id AND t.org_staff_id = v_staff)
        INTO v_thread_open;
      -- Lõi Hỏi đáp AI chỉ cho một câu mở hội thoại mới đang chờ cho cùng nhân viên + agent: ca chưa có hội thoại phải chờ lượt sau.
      CONTINUE WHEN NOT v_thread_open AND (v_open_blocked OR v_pending > 0);

      -- V599: ảnh lỗi từ tối đa imageRunsPerCase lượt có ảnh của ca, mỗi lượt của một nhân viên khác nhau (một ảnh chỉ cho thấy một tình huống:
      -- câu 585 có 4 tình huống trong 6 ảnh). Lấy trong 300 lượt gần nhất của ca trong 3 ngày, cộng lượt screenshot_run; ưu tiên nhân viên đang mở
      -- app, rồi lượt mới nhất. Mỗi nhân viên khách vẫn chỉ một yêu cầu mỗi ngày; ngừng khi bảng ảnh vượt trần dung lượng.
      IF v_images AND cs.kind <> 'luot_bo_do' AND cs.image_request_id IS NULL AND cs.screenshot_run IS NOT NULL THEN
        v_req_ids := '{}'::bigint[];
        FOR v_shot IN
          SELECT c.target_run_id, c.staff_id FROM (
            SELECT DISTINCT ON (x.staff_id) x.target_run_id, x.staff_id, x.occurred_at
              FROM (
                SELECT i.target_run_id, i.staff_id, i.occurred_at
                  FROM (SELECT i0.target_run_id, i0.staff_id, i0.occurred_at, i0.result_key
                          FROM private.auto_engine_error_items i0
                         WHERE i0.case_key = cs.case_key AND i0.occurred_at > v_now - interval '3 days'
                         ORDER BY i0.occurred_at DESC LIMIT 300) i
                 WHERE i.staff_id IS NOT NULL AND i.target_run_id IS NOT NULL
                   AND EXISTS (SELECT 1 FROM public.auto_engine_outcomes o WHERE o.result_key = i.result_key AND o.signal ? 'screenshotId')
                UNION ALL
                SELECT r.id, r.staff_id, r.started_at FROM public.auto_engine_target_runs r WHERE r.id = cs.screenshot_run AND r.staff_id IS NOT NULL
              ) x
             ORDER BY x.staff_id, x.occurred_at DESC) c
           WHERE NOT EXISTS (SELECT 1 FROM public.auto_desktop_diagnostic_requests q
                              WHERE q.staff_id = c.staff_id AND q.requested_by = 'error-watch' AND q.created_at >= v_vn_start)
           ORDER BY EXISTS (SELECT 1 FROM public.auto_staff_device_presence p
                             WHERE p.staff_id = c.staff_id AND p.ended_at IS NULL AND p.last_seen_at > v_now - interval '5 minutes') DESC,
                    c.occurred_at DESC, c.target_run_id DESC
           LIMIT v_image_runs
        LOOP
          EXIT WHEN pg_total_relation_size('public.auto_desktop_diagnostic_files'::regclass) > v_image_cap_mb * 1048576;
          BEGIN
            v_req_id := public.aka_agent_desktop_diagnostic_request_v1(v_shot.staff_id, jsonb_build_object('targetRunId', v_shot.target_run_id), 'error-watch');
            v_req_ids := v_req_ids || v_req_id;
            v_image_requests := v_image_requests + 1;
          EXCEPTION WHEN OTHERS THEN
            v_skipped := v_skipped || jsonb_build_object('khoa', cs.case_key, 'ly_do', 'xin_anh: ' || SQLERRM);
          END;
        END LOOP;
        IF coalesce(array_length(v_req_ids, 1), 0) > 0 THEN
          cs.image_request_id := v_req_ids[1];
          cs.image_request_ids := v_req_ids;
          UPDATE private.auto_engine_error_cases SET image_request_id = v_req_ids[1], image_request_ids = v_req_ids, updated_at = v_now
           WHERE case_key = cs.case_key;
        END IF;
      END IF;

      -- V593: ca đang chờ ảnh lỗi từ máy khách thì chưa hỏi, để Claude có ảnh ngay lượt kiểm đầu (không tốn chỗ trong ngày). Quá
      -- imageWaitMinutes phút mà ảnh chưa về (máy khách tắt…) thì hỏi không có ảnh; ảnh về sau thì bước 6a hỏi tiếp như V588.
      v_images_ready := false;
      v_req_ids := CASE WHEN cs.image_request_id IS NULL THEN '{}'::bigint[]
                       WHEN coalesce(array_length(cs.image_request_ids, 1), 0) > 0 THEN cs.image_request_ids
                       ELSE ARRAY[cs.image_request_id] END;
      IF cs.image_request_id IS NOT NULL AND cs.image_followup_at IS NULL THEN
        -- V599: chờ tới khi mọi yêu cầu của ca xong, hoặc quá imageWaitMinutes phút; rồi hỏi với các ảnh đã về.
        SELECT count(*) FILTER (WHERE q.status IN ('pending', 'uploading') AND q.created_at > v_now - make_interval(mins => v_image_wait)),
               coalesce(sum(fc.n) FILTER (WHERE q.status = 'done'), 0)
          INTO v_wait_pending, v_wait_files
          FROM public.auto_desktop_diagnostic_requests q
          CROSS JOIN LATERAL (SELECT count(*) AS n FROM public.auto_desktop_diagnostic_files f WHERE f.request_id = q.id) fc
         WHERE q.id = ANY (v_req_ids);
        v_images_ready := v_wait_files > 0;
        IF v_image_wait > 0 AND v_wait_pending > 0 THEN
          v_image_waiting := v_image_waiting + 1;
          CONTINUE;
        END IF;
      END IF;

      v_kind_label := CASE cs.kind WHEN 'chua_phan_loai' THEN 'lỗi chưa phân loại' WHEN 'ma_chua_ket_luan' THEN 'mã lỗi chưa có kết luận'
                                   WHEN 'tang_bat_thuong' THEN 'mã lỗi tăng bất thường' ELSE 'lượt bị bỏ dở' END;
      v_question := '[Tự động] Ca lỗi engine Facebook: ' || v_kind_label
        || CASE WHEN cs.status = 'reported' THEN ' (báo lại: số lượt tăng hoặc vẫn còn sau nhiều ngày)' WHEN cs.status = 'failed' THEN ' (gửi lại)' ELSE '' END || E'\n'
        || 'khoa: ' || cs.case_key || E'\n'
        || CASE WHEN cs.status = 'new' AND cs.note LIKE 'Mở lại sau khi bỏ qua%'
             THEN 'ghi chu: ' || cs.note || '. Anh đã bỏ qua ca này trước đó; kiểm xem có gì mới so với báo cáo trước.' || E'\n' ELSE '' END
        || 'ma: ' || coalesce(cs.public_code, '-') || ' (' || coalesce(cs.error_code, '-') || ') · thao tac: ' || coalesce(nullif(cs.action_code, ''), '-')
        || ' · buoc: ' || coalesce(nullif(cs.step, ''), '-') || E'\n'
        || 'cau loi mau: ' || coalesce(cs.pattern, '-') || E'\n'
        || 'so luot: ' || cs.hits || ' (lan bao truoc: ' || cs.hits_at_last_report || ') · so lan dung chien dich: ' || cs.pauses || E'\n'
        || 'lan dau: ' || to_char(cs.first_seen_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || ' · lan cuoi: '
        || to_char(cs.last_seen_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM HH24:MI') || E' (giờ VN)\n'
        || 'luot mau: ' || coalesce(array_to_string(cs.sample_runs, ', '), '-')
        || CASE WHEN cs.image_request_id IS NOT NULL THEN E'\nyeu cau anh: ' || array_to_string(v_req_ids, ', ') ELSE '' END
        || CASE WHEN v_images_ready THEN E'\nanh da ve: ' || v_wait_files || ' ảnh, xem bằng public.aka_agent_desktop_diagnostic_files_v1(<mã yêu cầu>)'
             || ' với từng mã ở dòng yeu cau anh' ELSE '' END;
      v_intake := jsonb_build_object('nguon', 'error-watch', 'khoa', cs.case_key, 'loai', cs.kind, 'ma', cs.public_code, 'error_code', cs.error_code,
        'thao_tac', cs.action_code, 'buoc', cs.step, 'cau_loi', cs.pattern, 'so_luot', cs.hits, 'so_lan_dung', cs.pauses,
        'luot_mau', to_jsonb(cs.sample_runs), 'yeu_cau_anh', cs.image_request_id, 'yeu_cau_anh_ds', to_jsonb(v_req_ids), 'anh_da_ve', v_images_ready);
      -- Gọi lại cùng tick (mất câu trả lời) không tạo câu thứ hai; câu gửi lại sau khi câu trước hỏng thì phải mang mã khác.
      v_request := md5(cs.case_key || ':' || cs.hits || ':' || v_vn::text || ':' || CASE WHEN cs.status = 'failed'
        THEN 'r' || CASE WHEN cs.resend_day IS DISTINCT FROM v_vn THEN 1 ELSE cs.resend_count + 1 END || ':' || coalesce(cs.last_message_id, 0) ELSE 'n' END)::uuid;
      v_payload := jsonb_build_object('question', left(v_question, 3900), 'staffId', v_staff, 'organizationId', v_org, 'source', 'api', 'requestId', v_request::text);
      IF v_thread_open THEN
        v_payload := v_payload || jsonb_build_object('threadId', cs.thread_id);
      ELSE
        v_payload := v_payload || jsonb_build_object('projectCode', v_project.code, 'intake', v_intake);
      END IF;

      v_err := NULL; v_res := NULL;
      BEGIN
        v_res := public.aka_agent_ai_chat_insert(v_payload);
      EXCEPTION WHEN OTHERS THEN
        v_err := SQLERRM;
      END;

      IF v_res IS NOT NULL AND (v_res -> 'ok') = 'true'::jsonb THEN
        v_msg_id := (v_res ->> 'messageId')::bigint;
        UPDATE private.auto_engine_error_cases
           SET status = 'queued', thread_id = (v_res ->> 'threadId')::bigint, last_message_id = v_msg_id, last_reported_at = v_now, hits_at_last_report = cs.hits,
               image_followup_at = CASE WHEN v_images_ready THEN v_now ELSE image_followup_at END,
               resend_day = CASE WHEN cs.status = 'failed' THEN v_vn ELSE resend_day END,
               resend_count = CASE WHEN cs.status <> 'failed' THEN 0 WHEN cs.resend_day IS DISTINCT FROM v_vn THEN 1 ELSE cs.resend_count + 1 END,
               updated_at = v_now
         WHERE case_key = cs.case_key;
        IF (v_res -> 'inserted') = 'true'::jsonb THEN
          st.tasks_today := st.tasks_today + 1;
          v_slots := v_slots - 1;
          v_pending := v_pending + 1;
        END IF;
        IF NOT v_thread_open THEN v_open_blocked := true; END IF;
        v_inserted := v_inserted || jsonb_build_object('messageId', v_msg_id, 'khoa', cs.case_key, 'loai', cs.kind);
      ELSIF v_res IS NOT NULL AND v_res ->> 'code' = 'ai_chat_message_pending' THEN
        v_open_blocked := true;
      ELSIF v_err IN ('ai_chat_too_many_pending', 'ai_chat_daily_limit', 'ai_chat_disabled', 'ai_chat_agent_unavailable') THEN
        st.last_error := 'Dừng chèn việc: ' || v_err;
        EXIT;
      ELSIF v_err IN ('ai_chat_thread_closed', 'ai_chat_thread_not_found') THEN
        UPDATE private.auto_engine_error_cases SET thread_id = NULL, updated_at = v_now WHERE case_key = cs.case_key;
      ELSE
        v_skipped := v_skipped || jsonb_build_object('khoa', cs.case_key, 'ly_do', coalesce(v_err, v_res ->> 'code', 'khong_ro'));
      END IF;
    END LOOP;

  END IF;

  -- 6c (V588). Đánh thức tác vụ cloud khi có câu chưa ai nhận: gọi ngay lượt đầu sau khi chèn, rồi gọi lại sau fireRetryMinutes phút nếu câu
  -- vẫn chưa ai nhận (tối đa fireMaxPerMessage lượt mỗi câu). Chạy cả ngoài khung chèn việc. pg_net gửi sau khi giao dịch xong và không báo
  -- lỗi HTTP về đây, nên "đã gọi" chưa chắc là tác vụ đã chạy: vì vậy mới cần gọi lại.
  IF (v_cfg -> 'fire') = 'true'::jsonb THEN
    v_fire_routine := nullif(v_cfg ->> 'fireRoutineId', '');
    v_fire_token := NULL;
    IF v_fire_routine ~ '^trig_[A-Za-z0-9]+$' AND to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NOT NULL
       AND to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
      EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1' INTO v_fire_token USING 'AKA_AGENT_ENGINE_ERROR_WATCH_FIRE_TOKEN';
    END IF;
    IF coalesce(v_fire_token, '') <> '' THEN
      v_fire_retry := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'fireRetryMinutes', 10)::integer, 4), 60);
      v_fire_max := least(greatest(private.aka_agent_engine_error_num(v_cfg ->> 'fireMaxPerMessage', 3)::integer, 1), 5);
      FOR fr IN
        SELECT k.case_key, k.last_message_id, (k.fired_message_id IS DISTINCT FROM k.last_message_id) AS first_fire
          FROM private.auto_engine_error_cases k
          JOIN public.ai_message m ON m.id = k.last_message_id
         WHERE k.status = 'queued' AND m.status = 'chờ câu trả lời' AND m.deadline_at > v_now + interval '5 minutes'
           AND (k.fired_message_id IS DISTINCT FROM k.last_message_id
                OR (k.fire_count < v_fire_max AND k.fired_at <= v_now - make_interval(mins => v_fire_retry)))
         ORDER BY k.last_reported_at
         LIMIT 5
      LOOP
        BEGIN
          EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
            USING 'https://api.anthropic.com/v1/claude_code/routines/' || v_fire_routine || '/fire',
                  jsonb_build_object('text', 'messageId=' || fr.last_message_id),
                  jsonb_build_object('Authorization', 'Bearer ' || v_fire_token, 'anthropic-version', '2023-06-01',
                                     'anthropic-beta', 'experimental-cc-routine-2026-04-01', 'Content-Type', 'application/json');
          UPDATE private.auto_engine_error_cases
             SET fired_message_id = fr.last_message_id, fired_at = v_now, fire_count = CASE WHEN fr.first_fire THEN 1 ELSE fire_count + 1 END
           WHERE case_key = fr.case_key;
          v_fired := v_fired + 1;
          IF NOT fr.first_fire THEN v_refired := v_refired + 1; END IF;
        EXCEPTION WHEN OTHERS THEN
          st.last_error := 'Gọi đánh thức tác vụ cloud lỗi: ' || left(SQLERRM, 200);
        END;
      END LOOP;
    END IF;
  END IF;

  v_result := jsonb_build_object('ok', true, 'enabled', true, 'from', v_from, 'to', v_to, 'seen', v_seen, 'cases', v_cases, 'paused', v_paused,
    'stale', v_stale, 'spikes', v_spikes, 'enqueue', v_enqueue, 'inserted', v_inserted, 'skipped', v_skipped, 'imageRequests', v_image_requests, 'imageWaiting', v_image_waiting,
    'fired', v_fired, 'refired', v_refired, 'tasksToday', st.tasks_today, 'tasksHour', v_tasks_hour, 'reopened', v_reopened, 'items', v_items + v_stale_items, 'notes', v_notes);
  UPDATE private.auto_engine_error_watch_state
     SET cursor_at = st.cursor_at, stale_cursor_at = st.stale_cursor_at, last_tick_at = v_now, day = st.day, tasks_today = st.tasks_today, last_error = st.last_error, last_result = v_result
   WHERE id;
  RETURN v_result;
END $function$
