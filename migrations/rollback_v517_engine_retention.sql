-- Gỡ V517: bỏ job aka-agent-engine-retention, hàm aka_agent_engine_retention_v1, thiết lập engine.retention_days, chỉ mục auto_engine_target_events_created_v517; trả report_v1
-- về thân V515 (decision lại có policy). Dòng đã bị xoá không lấy lại được; dòng kết quả ghi trong lúc có V517 vẫn không có policy (vô hại).
-- SINH TỪ scripts/build-v517-sql.cjs. DDL: apply ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regprocedure('public.aka_agent_engine_retention_v1(integer,integer)') IS NULL THEN RAISE EXCEPTION 'Gỡ V517: chưa có V517'; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)');
  IF v_md5 IS DISTINCT FROM '21afaaf3b1300cea2bf282e3cb9650c3' THEN RAISE EXCEPTION 'Gỡ V517: thân report_v1 không phải bản V517 (%)', v_md5; END IF;
END $pre$;

DO $cron$
BEGIN
  -- IF lồng: câu đọc cron.job chỉ được phân tích khi pg_cron có cài.
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'aka-agent-engine-retention';
  END IF;
END $cron$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_report_v1(
  p_target_run_id bigint, p_lease_token uuid, p_outcomes jsonb, p_final boolean DEFAULT false, p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  r public.auto_engine_target_runs%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  t public.auto_campaign_input_data%ROWTYPE;
  v_lease_ok boolean;
  v_run_open boolean;
  o jsonb;
  v_results jsonb := '[]'::jsonb;
  v_rk text;
  v_prev public.auto_engine_outcomes%ROWTYPE;
  v_is_replay boolean;
  v_action text;
  v_phase text;
  v_ok boolean;
  v_status_id bigint;
  v_signal jsonb;
  v_evidence jsonb;
  v_platform text;
  v_op_class text;
  v_action_name text;
  v_rule_id bigint;
  v_matched_by text;
  v_catch_all boolean;
  v_error_code text;
  v_policy jsonb;
  v_err public.auto_error%ROWTYPE;
  v_delivery text;
  v_count boolean;
  v_mark_idx integer;
  v_mark jsonb;
  v_reserved boolean;
  v_sem record;
  v_log text;
  v_detail_id bigint;
  v_until timestamptz;
  v_lock_until_max timestamptz;
  v_lc text;
  v_side boolean;
  v_decision jsonb;
  v_contrib jsonb;
  v_call jsonb := '[]'::jsonb;
  v_call_new jsonb := '[]'::jsonb;
  v_all jsonb;
  -- Chỉ thị của lượt gọi này.
  v_target_done boolean := false;
  v_run_rank integer := 0;
  v_rank integer;
  v_pace jsonb;
  v_pace_rank integer := 0;
  v_camp_effect text := 'none';
  v_camp_note text;
  v_camp_hold integer;
  v_acc_effect text := 'none';
  v_login_effect text := 'none';
  -- Tổng hợp theo data: mọi kết quả của lượt chạy data này, kể cả các lần gọi trước.
  v_target_effect text;
  v_target_rank integer := 0;
  v_requeue_minutes integer;
  v_note text;
  v_last_error_code text;
  v_last_action text;
  v_streak text := 'ignore';
  v_covered boolean := false;
  v_thr_effect text := 'none';
  v_thr_threshold integer;
  v_thr_hold integer;
  v_thr_source text;
  v_guard_code text;
  v_gp jsonb;
  v_streak_count integer;
  v_any_committed boolean := false;
  v_final_status text;
  v_schedule timestamptz;
  v_safety jsonb := '[]'::jsonb;
  v_camp_applied text := 'none';
  v_camp_rows integer;
  v_next text;
  v_outcome_count integer := 0;
  v_more boolean;
  v_response jsonb;
  -- V503: chế độ báo theo lô, chỉ report_batch_v1 đặt (trong cùng giao dịch, đặt lại rỗng sau mỗi data).
  v_scope text := nullif(current_setting('aka.engine.batch_scope', true), '');
BEGIN
  -- Lô rỗng chỉ hợp lệ khi chốt data (các bước còn lại bị bỏ vì bước trước không đạt).
  IF p_outcomes IS NULL OR jsonb_typeof(p_outcomes) <> 'array' OR (jsonb_array_length(p_outcomes) = 0 AND NOT p_final) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'outcomes_required');
  END IF;
  IF (SELECT count(DISTINCT btrim(x.value->>'resultKey')) FROM jsonb_array_elements(p_outcomes) x) <> jsonb_array_length(p_outcomes) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'result_key_duplicate');
  END IF;
  SELECT * INTO r FROM public.auto_engine_target_runs WHERE id = p_target_run_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'run_not_found'); END IF;
  IF r.lease_token IS DISTINCT FROM p_lease_token THEN RETURN jsonb_build_object('ok', false, 'reason', 'lease_token_mismatch'); END IF;

  -- Kiểm cả lô trước khi ghi: lô sai thì không ghi phần nào.
  FOR o IN SELECT x.value FROM jsonb_array_elements(p_outcomes) x LOOP
    v_rk := nullif(btrim(o->>'resultKey'), '');
    IF v_rk IS NULL OR length(v_rk) NOT BETWEEN 8 AND 200 THEN RETURN jsonb_build_object('ok', false, 'reason', 'result_key_required'); END IF;
    SELECT * INTO v_prev FROM public.auto_engine_outcomes WHERE result_key = v_rk;
    IF FOUND THEN
      IF v_prev.target_run_id <> r.id THEN RETURN jsonb_build_object('ok', false, 'reason', 'result_key_conflict', 'resultKey', v_rk); END IF;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = o->>'actionCode') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'action_unknown', 'actionCode', o->>'actionCode');
    END IF;
    IF coalesce(nullif(o->>'phase', ''), 'after_send') NOT IN ('before_send', 'in_flight', 'after_send') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'phase_invalid', 'phase', o->>'phase');
    END IF;
    IF jsonb_typeof(coalesce(o->'ok', 'false'::jsonb)) <> 'boolean' THEN RETURN jsonb_build_object('ok', false, 'reason', 'ok_invalid'); END IF;
    IF coalesce((o->>'ok')::boolean, false) AND NOT EXISTS (SELECT 1 FROM public.auto_status s
         WHERE s.code = coalesce(nullif(o->>'statusCode', ''), 'campaign_detail_success') AND s.component_type = 'campaign_detail'
           AND s.is_active AND NOT s.is_delete) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'status_unknown', 'statusCode', o->>'statusCode');
    END IF;
  END LOOP;

  -- V515 (B): gọi lại đúng lần báo đã chốt data (câu trả lời lần đầu bị mất: mạng, hết giờ) khi lease của lượt chạy còn hạn: trả lại câu
  -- trả lời của lần đầu, không áp lại hiệu ứng. Trước V515 lượt data đã đóng nên DB trả 'ownership_lost', lượt chạy dừng mà không nhả
  -- lease (tài khoản đứng tới khi lease hết hạn). Lease hết hạn, hay lời gọi có kết quả mới, thì đi đường cũ.
  IF NOT p_dry_run AND r.completed_at IS NOT NULL AND r.final_response IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_outcomes) x
                      WHERE NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes eo
                                         WHERE eo.result_key = btrim(x.value->>'resultKey') AND eo.target_run_id = r.id))
     AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
                  WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now) THEN
    SELECT coalesce(jsonb_agg((eo.decision->'result') || jsonb_build_object('replay', true) ORDER BY x.ordinality), '[]'::jsonb)
      INTO v_results
      FROM jsonb_array_elements(p_outcomes) WITH ORDINALITY x
      JOIN public.auto_engine_outcomes eo ON eo.result_key = btrim(x.value->>'resultKey');
    RETURN r.final_response || jsonb_build_object('outcomes', v_results, 'replay', true);
  END IF;

  SELECT * INTO c FROM public.auto_campaigns WHERE id = r.campaign_id;
  SELECT * INTO t FROM public.auto_campaign_input_data WHERE id = r.input_data_id FOR UPDATE;
  v_run_open := r.completed_at IS NULL;
  v_lease_ok := v_run_open AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
    WHERE l.account_id = r.account_id AND l.lease_token = p_lease_token AND l.expires_at > v_now);

  FOR o IN SELECT x.value FROM jsonb_array_elements(p_outcomes) x LOOP
    v_rk := btrim(o->>'resultKey');
    -- Gọi lại cùng result_key: trả lại đúng quyết định cũ, không gộp chính sách lần nữa.
    SELECT * INTO v_prev FROM public.auto_engine_outcomes WHERE result_key = v_rk;
    v_is_replay := FOUND;
    IF v_is_replay THEN
      v_decision := v_prev.decision;
      v_results := v_results || jsonb_build_array((v_decision->'result') || jsonb_build_object('replay', true));
      v_contrib := v_decision->'contrib';
    ELSE
      v_action := o->>'actionCode';
      SELECT aa.flatform_type, coalesce(aa.operation_class, 'delivery'), aa.name INTO v_platform, v_op_class, v_action_name
        FROM public.auto_account_actions aa WHERE aa.code = v_action;
      -- Tên thao tác ghi vào lịch sử: như helper Desktop ("Tìm SĐT"…) khi bộ chạy gửi kèm, không thì tên trong danh mục.
      v_action_name := coalesce(nullif(left(btrim(coalesce(o->>'actionName', '')), 120), ''), v_action_name);
      v_phase := coalesce(nullif(o->>'phase', ''), 'after_send');
      v_ok := coalesce((o->>'ok')::boolean, false);
      v_signal := coalesce(o->'signal', '{}'::jsonb);
      v_evidence := coalesce(o->'evidence', '{}'::jsonb);
      v_error_code := NULL; v_status_id := NULL; v_rule_id := NULL; v_matched_by := NULL; v_catch_all := NULL; v_err := NULL; v_detail_id := NULL;

      IF v_ok THEN
        SELECT s.id INTO v_status_id FROM public.auto_status s
         WHERE s.code = coalesce(nullif(o->>'statusCode', ''), 'campaign_detail_success') AND s.component_type = 'campaign_detail';
      ELSE
        SELECT cs.error_code, cs.rule_id, cs.matched_by, cs.is_catch_all INTO v_error_code, v_rule_id, v_matched_by, v_catch_all
          FROM public.aka_agent_engine_classify_signal(v_platform, v_action, v_phase, v_signal) cs;
        v_error_code := coalesce(v_error_code, 'err_undefined');
        IF coalesce(v_catch_all, true) AND NOT p_dry_run THEN
          INSERT INTO public.auto_outcome_unmatched AS u (platform, action_code, phase, signal_kind, pattern_key, fallback_error_code, sample, hit_count, first_seen_at, last_seen_at)
          VALUES (v_platform, v_action, v_phase, coalesce(nullif(v_signal->>'kind', ''), 'unknown'), coalesce(public.aka_agent_engine_pattern_key(v_signal), ''),
                  v_error_code, v_signal, 1, v_now, v_now)
          ON CONFLICT (platform, action_code, phase, signal_kind, pattern_key) DO UPDATE SET
            hit_count = u.hit_count + 1, last_seen_at = EXCLUDED.last_seen_at, sample = EXCLUDED.sample, fallback_error_code = EXCLUDED.fallback_error_code;
        END IF;
        SELECT * INTO v_err FROM public.auto_error e WHERE e.error_code = v_error_code;
      END IF;

      v_policy := public.aka_agent_engine_resolve_policy(v_error_code, v_status_id, v_action, c.action_id, r.runtime_target, v_phase);
      SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);

      -- Trạng thái giao: chỉ thao tác loại delivery mới có thể "đã giao".
      v_delivery := CASE
        WHEN v_op_class <> 'delivery' THEN 'none'
        WHEN v_ok THEN CASE WHEN coalesce(v_sem.counts_as_delivered, false) THEN 'delivered' ELSE 'none' END
        WHEN coalesce((v_evidence->>'partialDelivery')::boolean, false) THEN 'partial'
        WHEN v_phase = 'in_flight' OR v_policy->>'error_class' = 'unknown_delivery' OR v_evidence->>'deliveryState' = 'unknown' THEN 'unknown'
        ELSE 'not_delivered' END;
      -- V501: giao một phần như finalizeZaloPartialSendDetail của Desktop: luôn ghi dòng "thất bại", không đổi chuỗi data lỗi
      -- (trừ khi do media quá giờ), data hoàn thành; chính sách không ghi lịch sử (như khoá 802 với người lạ) vẫn ghi.
      IF v_delivery = 'partial' AND NOT v_ok THEN
        v_policy := v_policy || jsonb_build_object('detail_mode', 'write',
          'detail_status_id', coalesce((SELECT s.id FROM public.auto_status s WHERE s.code = 'campaign_detail_failed' AND s.component_type = 'campaign_detail'
                                         ORDER BY s.id LIMIT 1), (v_policy->>'detail_status_id')::bigint),
          'target_streak_effect', CASE WHEN v_signal->>'code' = 'campaign_media_timeout' THEN v_policy->>'target_streak_effect' ELSE 'ignore' END,
          -- Hiệu ứng chiến dịch phụ thuộc ngưỡng (N lần liền, ví dụ 127 [Q4]) chỉ có nghĩa khi kết quả cộng chuỗi; không cộng chuỗi
          -- thì không được áp ngay (khoá thao tác của mã vẫn giữ).
          'campaign_effect', CASE WHEN v_signal->>'code' IS DISTINCT FROM 'campaign_media_timeout' AND (v_policy->>'streak_threshold') IS NOT NULL
                                  THEN 'none' ELSE v_policy->>'campaign_effect' END,
          'target_effect', 'complete');
        SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);
      END IF;

      -- V503: báo cả lô gửi dạng chia sẻ (policyHandling của Desktop). Lô có người đã nhận được (chia sẻ xong hoặc đã nhận media) thì lỗi
      -- của người khác chỉ ghi cho người đó (target_only): không khoá thao tác, không đổi chiến dịch / tài khoản / đăng nhập, không dừng
      -- lượt, không cộng chuỗi data lỗi. Lô không ai nhận được thì chỉ người có hiệu ứng mạnh nhất áp đủ chính sách; người khác
      -- (batch_followup) bỏ hiệu ứng phụ nhưng vẫn theo chuỗi data lỗi. Data đi đâu, ghi lịch sử, hạn mức, nhớ mục tiêu: theo chính sách.
      IF NOT v_ok AND v_scope IN ('target_only', 'batch_followup') THEN
        v_policy := v_policy || jsonb_build_object('lock_action_codes', '[]'::jsonb, 'campaign_effect', 'none', 'account_effect', 'none',
          'login_effect', 'none', 'run_effect', 'continue')
          || CASE WHEN v_scope = 'target_only' THEN jsonb_build_object('target_streak_effect', 'ignore') ELSE '{}'::jsonb END;
      END IF;

      -- Giải quyết dấu "sắp gửi" của bước này.
      v_reserved := false; v_mark_idx := NULL; v_mark := NULL;
      SELECT (x.ordinality - 1)::integer, x.value INTO v_mark_idx, v_mark
        FROM jsonb_array_elements(r.marks) WITH ORDINALITY x
       WHERE x.value->>'stepKey' = coalesce(nullif(o->>'stepKey', ''), v_action) AND x.value->>'state' = 'pending'
       LIMIT 1;
      IF v_mark_idx IS NOT NULL THEN
        v_reserved := (v_mark->>'reservedQuotaDate')::date = v_vn;
        r.marks := jsonb_set(r.marks, ARRAY[v_mark_idx::text, 'state'],
          to_jsonb(CASE WHEN v_delivery = 'none' THEN 'not_delivered' ELSE v_delivery END));
      ELSIF v_op_class = 'delivery' AND v_delivery IN ('delivered', 'partial', 'unknown') THEN
        v_safety := v_safety || jsonb_build_array(jsonb_build_object('rule', 'unmarked_delivery', 'actionCode', v_action, 'resultKey', v_rk));
      END IF;

      -- Giao một phần luôn tính lượt (giống partialDelivery hiện nay).
      v_count := CASE v_policy->>'quota_effect' WHEN 'count' THEN true WHEN 'no_count' THEN false
                 ELSE v_delivery IN ('delivered', 'partial', 'unknown') END
                 OR v_delivery = 'partial';
      IF NOT p_dry_run THEN
        IF v_reserved AND NOT v_count THEN
          UPDATE public.auto_account_action_status SET count_action_in_day = greatest(count_action_in_day - 1, 0), updated_at = v_now
           WHERE account_id = r.account_id AND action_code = v_action AND count_date = v_vn;
        ELSIF NOT v_reserved AND v_count THEN
          INSERT INTO public.auto_account_action_status AS s (account_id, action_code, count_action_in_day, count_date)
          VALUES (r.account_id, v_action, 1, v_vn)
          ON CONFLICT (account_id, action_code) DO UPDATE SET
            count_action_in_day = CASE WHEN s.count_date = v_vn THEN s.count_action_in_day + 1 ELSE 1 END, count_date = v_vn, updated_at = v_now;
        END IF;
      END IF;

      -- Khoá thao tác (sự thật về tài khoản: áp cả khi lease đã mất).
      v_until := NULL;
      IF jsonb_array_length(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) > 0 THEN
        v_until := public.aka_agent_engine_lock_until(v_policy->>'lock_mode', (v_policy->>'lock_minutes')::integer,
          (v_policy->>'lock_days')::integer, (v_policy->>'lock_time')::time, v_now);
      END IF;

      v_log := CASE
        WHEN v_ok THEN coalesce(public.aka_agent_engine_render(v_policy->>'log_template',
                  jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name)), nullif(o->>'customerLog', ''),
                  coalesce(v_action_name, v_action) || ': ' || coalesce(v_sem.status_value, 'thành công'))
        ELSE coalesce(
                  public.aka_agent_engine_render(v_policy->>'log_template',
                    jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                      'until', public.aka_agent_engine_format_vn(v_until), 'code', v_err.public_code)),
                  public.aka_agent_engine_render(coalesce(v_err.customer_title, v_err.noti_running_process, v_err.error_name),
                    jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                      'until', public.aka_agent_engine_format_vn(v_until), 'code', v_err.public_code)),
                  coalesce(v_action_name, v_action) || ' không thành công')
             || CASE WHEN v_err.public_code IS NOT NULL THEN ' (' || v_err.public_code || ')' ELSE '' END
        END;
      -- V501: tiền tố của Desktop cho giao một phần.
      IF v_delivery = 'partial' AND NOT v_ok THEN
        v_log := CASE WHEN v_evidence->>'partialStage' = 'media_after_content' THEN 'Đã gửi nội dung nhưng gửi file thất bại. '
                      ELSE 'Đã gửi file nhưng gửi nội dung thất bại. ' END || v_log;
      END IF;

      IF NOT p_dry_run THEN
        FOR v_lc IN SELECT jsonb_array_elements_text(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) LOOP
          IF EXISTS (SELECT 1 FROM public.auto_account_actions aa WHERE aa.code = v_lc) THEN
            INSERT INTO public.auto_account_action_status AS s (account_id, action_code, is_disable, date_enable, disabled_error_code, disabled_reason, disabled_at)
            VALUES (r.account_id, v_lc, true, v_until, v_error_code, v_log, v_now)
            ON CONFLICT (account_id, action_code) DO UPDATE SET is_disable = true, date_enable = EXCLUDED.date_enable,
              disabled_error_code = EXCLUDED.disabled_error_code, disabled_reason = EXCLUDED.disabled_reason, disabled_at = EXCLUDED.disabled_at, updated_at = v_now;
          END IF;
        END LOOP;

        IF v_policy->>'detail_mode' = 'write' THEN
          INSERT INTO public.auto_campaign_details (input_data_id, campaign_id, account_id, action_name, action_code, status, status_id, sub_status_id,
            error_code, counts_toward_limit, report_group, log, data, policy_snapshot, result_key, created_at)
          VALUES (r.input_data_id, r.campaign_id, r.account_id, v_action_name, v_action, coalesce(v_sem.status_value, 'thất bại'),
            (v_policy->>'detail_status_id')::bigint, (v_policy->>'sub_status_id')::bigint, v_error_code, v_count, v_sem.report_group, v_log,
            jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery, 'signal', v_signal, 'evidence', v_evidence)
              || coalesce(o->'data', '{}'::jsonb),
            jsonb_build_object('engine', 'v2',
              'operationState', CASE WHEN v_delivery IN ('delivered', 'partial') THEN 'committed'
                                     WHEN v_delivery = 'unknown' THEN 'unknown' ELSE 'not_committed' END,
              'actionCode', v_action, 'statusCode', v_sem.status_code, 'errorCode', v_error_code, 'countsTowardLimit', v_count,
              'badTargetEffect', v_policy->>'target_streak_effect',
              'v2', jsonb_build_object('errorClass', v_policy->>'error_class', 'ruleId', v_rule_id, 'matchedBy', v_matched_by,
                'policyIds', v_policy->'policy_ids', 'revisions', v_policy->'revisions', 'targetRunId', r.id)),
            v_rk, v_now)
          RETURNING id INTO v_detail_id;
        END IF;
      END IF;

      v_side := jsonb_array_length(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) > 0
        OR coalesce(v_policy->>'campaign_effect', 'none') <> 'none'
        OR coalesce(v_policy->>'account_effect', 'none') <> 'none'
        OR coalesce(v_policy->>'login_effect', 'none') <> 'none';
      v_contrib := jsonb_build_object(
        'seq', r.outcome_count + v_outcome_count + 1,
        'ok', v_ok, 'actionCode', v_action, 'errorCode', v_error_code, 'delivery', v_delivery,
        'targetEffect', CASE WHEN v_ok AND v_policy->>'remaining_steps' <> 'skip' THEN NULL ELSE v_policy->>'target_effect' END,
        'requeueAfterMinutes', v_policy->'requeue_after_minutes',
        'remaining', v_policy->>'remaining_steps',
        'streak', v_policy->>'target_streak_effect', 'streakThreshold', v_policy->'streak_threshold', 'sideEffect', v_side,
        'runEffect', v_policy->>'run_effect',
        'pace', jsonb_build_object('mode', v_policy->>'pace_mode', 'seconds', v_policy->'pace_seconds'),
        'campaignEffect', v_policy->>'campaign_effect', 'campaignHoldMinutes', v_policy->'campaign_hold_minutes',
        'campaignNote', CASE WHEN v_policy->>'campaign_effect' IN ('pause', 'hold') THEN
             -- Như renderZaloPolicyCampaignNote: [x]/[t] là số phút khoá (khoá theo phút), không thì câu lỗi.
             coalesce(public.aka_agent_engine_render(coalesce(v_policy->>'campaign_note_template', v_err.noti_campaign),
               jsonb_build_object('name', coalesce(t.name, ''), 'action', v_action_name, 'message', coalesce(v_signal->>'message', ''),
                 'until', public.aka_agent_engine_format_vn(v_until),
                 'x', CASE WHEN v_policy->>'lock_mode' IS DISTINCT FROM 'days_at_time' AND coalesce((v_policy->>'lock_minutes')::integer, 0) > 0
                           THEN v_policy->>'lock_minutes' ELSE coalesce(v_signal->>'message', '') END,
                 't', CASE WHEN v_policy->>'lock_mode' IS DISTINCT FROM 'days_at_time' AND coalesce((v_policy->>'lock_minutes')::integer, 0) > 0
                           THEN v_policy->>'lock_minutes' ELSE '' END)), v_log)
             || CASE WHEN v_err.public_code IS NOT NULL
                     AND position('(' || v_err.public_code || ')' IN coalesce(public.aka_agent_engine_render(coalesce(v_policy->>'campaign_note_template', v_err.noti_campaign), '{}'::jsonb), v_log)) = 0
                  THEN ' (' || v_err.public_code || ')' ELSE '' END
           ELSE NULL END,
        'accountEffect', v_policy->>'account_effect', 'loginEffect', v_policy->>'login_effect',
        'lockUntil', v_until, 'log', v_log);
      v_decision := jsonb_build_object(
        'result', jsonb_build_object('resultKey', v_rk, 'actionCode', v_action, 'actionName', v_action_name, 'ok', v_ok, 'errorCode', v_error_code,
          'publicCode', v_err.public_code, 'errorClass', v_policy->>'error_class', 'statusId', (v_policy->>'detail_status_id')::bigint,
          'statusCode', v_sem.status_code, 'reportGroup', v_sem.report_group, 'deliveryState', v_delivery, 'countsTowardLimit', v_count,
          'detailId', v_detail_id, 'log', v_log, 'lockUntil', v_until),
        'contrib', v_contrib,
        'policy', v_policy);
      IF NOT p_dry_run THEN
        INSERT INTO public.auto_engine_outcomes (result_key, target_run_id, input_data_id, campaign_id, account_id, action_code, phase, ok,
          error_code, status_id, delivery_state, detail_id, decision, signal, created_at)
        VALUES (v_rk, r.id, r.input_data_id, r.campaign_id, r.account_id, v_action, v_phase, v_ok, v_error_code,
          (v_policy->>'detail_status_id')::bigint, v_delivery, v_detail_id, v_decision, v_signal, v_now);
      END IF;
      v_results := v_results || jsonb_build_array(v_decision->'result');
      v_outcome_count := v_outcome_count + 1;
      v_call_new := v_call_new || jsonb_build_array(v_contrib);
    END IF;
    v_call := v_call || jsonb_build_array(v_contrib);
  END LOOP;

  -- Lượt gọi này: data xong chưa (bước còn lại có chạy tiếp không), hiệu ứng áp ngay.
  -- run_effect (dừng lượt/tài khoản/chiến dịch) chỉ có hiệu lực SAU khi data hiện tại xong,
  -- giống stopAfterTarget hiện nay; các bước còn lại của data vẫn chạy trừ khi remaining_steps=skip.
  FOR v_contrib IN SELECT x.value FROM jsonb_array_elements(v_call) x LOOP
    IF v_contrib->>'remaining' = 'skip' THEN v_target_done := true; END IF;
    -- Hiệu ứng chiến dịch áp ngay khi mã không có ngưỡng hoặc kết quả không tăng chuỗi
    -- (applyRuntimeErrorPolicy hiện nay); có ngưỡng và tăng chuỗi thì xét ở cuối data.
    IF coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
       AND ((v_contrib->>'streakThreshold') IS NULL OR v_contrib->>'streak' IS DISTINCT FROM 'increment')
       AND (v_camp_effect = 'none' OR (v_contrib->>'campaignEffect' = 'pause' AND v_camp_effect = 'hold')) THEN
      v_camp_effect := v_contrib->>'campaignEffect';
      v_camp_note := v_contrib->>'campaignNote';
      v_camp_hold := (v_contrib->>'campaignHoldMinutes')::integer;
    END IF;
    IF coalesce(v_contrib->>'accountEffect', 'none') = 'pause' THEN v_acc_effect := 'pause'; END IF;
    IF coalesce(v_contrib->>'loginEffect', 'none') <> 'none' THEN v_login_effect := v_contrib->>'loginEffect'; END IF;
    IF (v_contrib->>'lockUntil') IS NOT NULL THEN
      v_lock_until_max := greatest(coalesce(v_lock_until_max, (v_contrib->>'lockUntil')::timestamptz), (v_contrib->>'lockUntil')::timestamptz);
    END IF;
  END LOOP;
  v_target_done := v_target_done OR p_final;

  IF v_target_done THEN
    SELECT coalesce(jsonb_agg(eo.decision->'contrib' ORDER BY (eo.decision->'contrib'->>'seq')::integer, eo.result_key), '[]'::jsonb) INTO v_all
      FROM public.auto_engine_outcomes eo WHERE eo.target_run_id = r.id;
    IF p_dry_run THEN v_all := v_all || v_call_new; END IF;
    -- Không bao giờ đóng data mà không có kết quả nào (chống "thành công giả"): runtime phải báo no_outcome.
    IF jsonb_array_length(v_all) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_outcomes'); END IF;
    FOR v_contrib IN SELECT x.value FROM jsonb_array_elements(v_all) x LOOP
      IF v_contrib->>'delivery' IN ('delivered', 'partial', 'unknown') THEN v_any_committed := true; END IF;
      -- Sau khi data xong: dừng lượt/tài khoản/chiến dịch theo kết quả nặng nhất của data này.
      v_rank := greatest(
        CASE v_contrib->>'runEffect' WHEN 'stop_campaign' THEN 4 WHEN 'stop_account' THEN 3 WHEN 'end_unit' THEN 2 ELSE 0 END,
        CASE WHEN coalesce(v_contrib->>'campaignEffect', 'none') <> 'none'
              AND ((v_contrib->>'streakThreshold') IS NULL OR v_contrib->>'streak' IS DISTINCT FROM 'increment') THEN 4 ELSE 0 END,
        CASE WHEN coalesce(v_contrib->>'accountEffect', 'none') <> 'none' OR coalesce(v_contrib->>'loginEffect', 'none') <> 'none' THEN 3 ELSE 0 END);
      IF v_rank > v_run_rank THEN v_run_rank := v_rank; END IF;
      -- Nghỉ sau data theo kết quả "nặng" nhất: full > short > none (bản cũ nghỉ sau mọi data).
      v_rank := CASE v_contrib->'pace'->>'mode' WHEN 'full' THEN 3 WHEN 'short' THEN 2 WHEN 'none' THEN 1 ELSE 0 END;
      IF v_rank > v_pace_rank OR (v_rank = v_pace_rank AND v_rank > 0
           AND coalesce((v_contrib->'pace'->>'seconds')::integer, -1) > coalesce((v_pace->>'seconds')::integer, -1)) THEN
        v_pace_rank := v_rank; v_pace := v_contrib->'pace';
      END IF;
      IF v_contrib->>'targetEffect' IS NOT NULL THEN
        v_rank := CASE v_contrib->>'targetEffect' WHEN 'hold' THEN 3 WHEN 'requeue' THEN 2 WHEN 'requeue_after' THEN 2 ELSE 1 END;
        IF v_rank > v_target_rank THEN
          v_target_rank := v_rank; v_target_effect := v_contrib->>'targetEffect';
          v_requeue_minutes := (v_contrib->>'requeueAfterMinutes')::integer;
        END IF;
      END IF;
      IF NOT coalesce((v_contrib->>'ok')::boolean, false) THEN
        v_note := v_contrib->>'log'; v_last_error_code := v_contrib->>'errorCode'; v_last_action := v_contrib->>'actionCode';
      END IF;
      -- Chuỗi mục tiêu lỗi: increment > reset > ignore (giống aggregateResultEffects).
      IF v_contrib->>'streak' = 'increment' THEN
        v_streak := 'increment';
        IF (v_contrib->>'streakThreshold') IS NOT NULL OR coalesce((v_contrib->>'sideEffect')::boolean, false) THEN v_covered := true; END IF;
      ELSIF v_contrib->>'streak' = 'reset' AND v_streak <> 'increment' THEN
        v_streak := 'reset';
      END IF;
      IF coalesce(v_contrib->>'campaignEffect', 'none') <> 'none' AND (v_contrib->>'streakThreshold') IS NOT NULL
         AND v_contrib->>'streak' = 'increment'
         AND (v_thr_effect = 'none' OR (v_contrib->>'campaignEffect' = 'pause' AND v_thr_effect = 'hold')) THEN
        v_thr_effect := v_contrib->>'campaignEffect';
        v_thr_threshold := (v_contrib->>'streakThreshold')::integer;
        v_thr_hold := (v_contrib->>'campaignHoldMinutes')::integer;
        v_thr_source := v_contrib->>'errorCode';
      END IF;
    END LOOP;
    -- Bước đã giao trước đó trong lượt này cũng chặn việc trả về hàng đợi.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.marks) m WHERE m.value->>'state' IN ('pending', 'delivered', 'partial', 'unknown')) THEN
      v_any_committed := true;
    END IF;

    v_target_effect := coalesce(v_target_effect, 'complete');
    IF v_target_effect IN ('requeue', 'requeue_after') AND v_any_committed THEN
      v_safety := v_safety || jsonb_build_array(jsonb_build_object('rule', 'no_requeue_after_delivery', 'from', v_target_effect));
      v_target_effect := 'complete';
    END IF;
    v_final_status := CASE v_target_effect WHEN 'hold' THEN 'tạm dừng' WHEN 'complete' THEN 'hoàn thành' ELSE 'chờ xử lý' END;
    v_schedule := CASE WHEN v_target_effect = 'requeue_after'
      THEN coalesce(v_lock_until_max, v_now + make_interval(mins => coalesce(v_requeue_minutes, 0))) ELSE NULL END;
    -- V501 (G3): data vừa về hàng đợi không được nhận lại trong cùng lượt (claim bỏ qua data đã thử với lease này), nên
    -- lượt chạy tiếp các data phía sau thay vì kết thúc.

    -- Chuỗi lỗi chỉ đổi khi lượt chạy còn mở (báo muộn sau khi data đã bị đóng không đếm lại).
    IF v_run_open AND NOT p_dry_run AND v_streak = 'increment' THEN
      INSERT INTO public.auto_campaign_error_state AS es (campaign_id, count_consecutive_bad_targets, last_input_data_id, last_reason, last_bad_target_at)
      VALUES (r.campaign_id, 1, r.input_data_id, coalesce(v_last_error_code, v_note), v_now)
      ON CONFLICT (campaign_id) DO UPDATE SET count_consecutive_bad_targets = es.count_consecutive_bad_targets + 1,
        last_input_data_id = EXCLUDED.last_input_data_id, last_reason = EXCLUDED.last_reason, last_bad_target_at = EXCLUDED.last_bad_target_at, updated_at = v_now
      RETURNING count_consecutive_bad_targets INTO v_streak_count;
    ELSIF v_run_open AND NOT p_dry_run AND v_streak = 'reset' THEN
      UPDATE public.auto_campaign_error_state SET count_consecutive_bad_targets = 0, updated_at = v_now WHERE campaign_id = r.campaign_id;
      v_streak_count := 0;
    ELSE
      SELECT es.count_consecutive_bad_targets INTO v_streak_count FROM public.auto_campaign_error_state es WHERE es.campaign_id = r.campaign_id;
      v_streak_count := CASE WHEN NOT v_run_open THEN coalesce(v_streak_count, 0)
                             WHEN v_streak = 'increment' THEN coalesce(v_streak_count, 0) + 1
                             WHEN v_streak = 'reset' THEN 0 ELSE coalesce(v_streak_count, 0) END;
    END IF;

    -- Ngưỡng chung: mã tăng chuỗi mà không có ngưỡng/hiệu ứng riêng thì theo mã canh chuỗi
    -- (mặc định err_undefined), giống guard đang chạy ở campaignScheduler.
    IF v_streak = 'increment' AND NOT v_covered AND v_thr_effect = 'none' THEN
      v_guard_code := nullif(btrim(public.aka_agent_engine_setting('engine.bad_target_guard_error_code', 'err_undefined')), '');
      IF v_guard_code IS NOT NULL AND EXISTS (SELECT 1 FROM public.auto_error e WHERE e.error_code = v_guard_code AND e.is_active AND NOT e.is_delete) THEN
        v_gp := public.aka_agent_engine_resolve_policy(v_guard_code, NULL, coalesce(v_last_action, ''), c.action_id, r.runtime_target, 'after_send');
        IF (v_gp->>'streak_threshold') IS NOT NULL AND coalesce(v_gp->>'campaign_effect', 'none') <> 'none' THEN
          v_thr_effect := v_gp->>'campaign_effect';
          v_thr_threshold := (v_gp->>'streak_threshold')::integer;
          v_thr_hold := (v_gp->>'campaign_hold_minutes')::integer;
          v_thr_source := v_guard_code;
        END IF;
      END IF;
    END IF;
    IF v_run_open AND v_thr_effect <> 'none' AND v_streak = 'increment' AND v_streak_count >= v_thr_threshold
       AND (v_camp_effect = 'none' OR (v_thr_effect = 'pause' AND v_camp_effect = 'hold')) THEN
      v_camp_effect := v_thr_effect;
      v_camp_hold := v_thr_hold;
      v_camp_note := 'Dừng sau ' || v_streak_count || ' data lỗi/thất bại liên tiếp (ngưỡng ' || v_thr_threshold || '): '
        || coalesce(v_note, 'Lỗi không xác định');
    END IF;

    IF NOT p_dry_run THEN
      IF v_run_open THEN
        -- V515 (D): ghi chú của data là kết quả của lượt chốt này, như bộ chạy Desktop (thành công thì note = null). Trước V515 data từng
        -- về hàng đợi kèm ghi chú (NET01…) rồi gửi thành công vẫn giữ ghi chú cũ.
        UPDATE public.auto_campaign_input_data SET status = v_final_status,
          note = v_note,
          schedule = CASE WHEN v_schedule IS NOT NULL THEN v_schedule ELSE schedule END,
          date_action = v_now
        WHERE id = r.input_data_id AND status = 'đang chạy';
      END IF;
      UPDATE public.auto_engine_target_runs SET marks = r.marks, completed_at = coalesce(completed_at, v_now),
        final_target_status = coalesce(final_target_status, v_final_status), final_error_code = coalesce(final_error_code, v_last_error_code),
        close_reason = coalesce(close_reason, 'reported'), outcome_count = outcome_count + v_outcome_count
      WHERE id = r.id;
    END IF;
  ELSIF NOT p_dry_run THEN
    UPDATE public.auto_engine_target_runs SET marks = r.marks, outcome_count = outcome_count + v_outcome_count WHERE id = r.id;
  END IF;
  -- Còn data đến hạn phía sau không: runtime chỉ nghỉ giữa 2 lần gửi khi còn việc.
  IF v_target_done THEN
    -- V501: không tính data đã thử trong lượt này (lượt sau mới thử lại).
    v_more := EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
      WHERE d.campaign_id = r.campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
        AND (d.schedule IS NULL OR d.schedule <= v_now)
        AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = r.lease_token));
  END IF;

  -- Hiệu ứng chiến dịch/tài khoản chỉ áp khi còn giữ chỗ; mô phỏng thì chỉ báo sẽ áp gì.
  IF v_lease_ok AND NOT p_dry_run THEN
    IF v_camp_effect <> 'none' THEN
      -- V501: không ghi đè trạng thái người dùng vừa đổi trong lúc data chạy (tạm dừng từ Web/Desktop), như VPS. Hoãn theo
      -- phút chỉ dời lịch khi còn trong ngày, trước giờ dừng (G2).
      UPDATE public.auto_campaigns SET
        status = CASE v_camp_effect WHEN 'pause' THEN 'tạm dừng' ELSE 'chờ xử lý' END,
        schedule = CASE WHEN v_camp_effect = 'hold' AND coalesce(v_camp_hold, 0) > 0
                         AND v_now + make_interval(mins => v_camp_hold)
                             < ((v_vn + least(coalesce(daily_stop_time, time '23:59:00'), time '23:59:00')) AT TIME ZONE 'Asia/Ho_Chi_Minh')
                        THEN v_now + make_interval(mins => v_camp_hold) ELSE schedule END,
        note = coalesce(v_camp_note, note), updated_at = v_now
      WHERE id = r.campaign_id AND status IN ('đang chạy', 'chờ xử lý');
      GET DIAGNOSTICS v_camp_rows = ROW_COUNT;
      v_camp_applied := CASE WHEN v_camp_rows > 0 THEN v_camp_effect ELSE 'none' END;
    END IF;
    IF v_acc_effect = 'pause' THEN UPDATE public.auto_accounts SET status = 'tạm dừng', updated_at = v_now WHERE id = r.account_id; END IF;
    IF v_login_effect <> 'none' THEN
      UPDATE public.auto_accounts SET login_status = CASE v_login_effect WHEN 'checkpoint' THEN 'checkpoint' ELSE 'chưa đăng nhập' END, updated_at = v_now
       WHERE id = r.account_id;
    END IF;
  ELSIF p_dry_run AND v_lease_ok THEN
    v_camp_applied := v_camp_effect;
  END IF;

  v_next := CASE
    WHEN NOT v_lease_ok THEN 'ownership_lost'
    WHEN NOT v_target_done THEN 'next_step'
    WHEN v_camp_applied <> 'none' OR v_run_rank = 4 THEN 'stop_campaign'
    WHEN v_run_rank = 3 THEN 'stop_account'
    WHEN v_run_rank = 2 THEN 'end_unit'
    ELSE 'next_target' END;

  v_response := jsonb_build_object('ok', true, 'dryRun', p_dry_run, 'next', v_next,
    'pace', CASE WHEN v_target_done THEN v_pace ELSE NULL END,
    'outcomes', v_results,
    'target', jsonb_build_object('done', v_target_done, 'status', v_final_status, 'note', v_note, 'schedule', v_schedule, 'morePending', v_more),
    'streak', CASE WHEN v_target_done THEN jsonb_build_object('effect', v_streak, 'count', v_streak_count, 'threshold', v_thr_threshold, 'source', v_thr_source) END,
    'campaign', jsonb_build_object('effect', v_camp_applied, 'note', CASE WHEN v_camp_applied <> 'none' THEN v_camp_note END),
    'account', jsonb_build_object('effect', v_acc_effect, 'loginEffect', v_login_effect),
    'safety', v_safety);
  -- V515 (B): lưu câu trả lời của lần chốt (không kèm danh sách kết quả, dựng lại từ auto_engine_outcomes khi gọi lại).
  IF v_target_done AND v_run_open AND NOT p_dry_run THEN
    UPDATE public.auto_engine_target_runs SET final_response = v_response - 'outcomes' WHERE id = r.id;
  END IF;
  RETURN v_response;
END $f$;

DROP FUNCTION public.aka_agent_engine_retention_v1(integer,integer);
DELETE FROM public.auto_system_settings WHERE key = 'engine.retention_days';
DROP INDEX public.auto_engine_target_events_created_v517;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '49cbb00b81024d3af3560922e67fd864' THEN RAISE EXCEPTION 'Gỡ V517 postflight: report_v1 %', v_md5; END IF;
  IF to_regprocedure('public.aka_agent_engine_retention_v1(integer,integer)') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V517 postflight: còn retention_v1'; END IF;
  IF to_regclass('public.auto_engine_target_events_created_v517') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V517 postflight: còn chỉ mục auto_engine_target_events_created_v517'; END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'aka-agent-engine-retention') THEN RAISE EXCEPTION 'Gỡ V517 postflight: còn job aka-agent-engine-retention'; END IF;
  END IF;
END $post$;

COMMIT;
