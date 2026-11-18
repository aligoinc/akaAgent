-- migration_v576_engine_orphan_runs (số tạm: kiểm lại sổ migration ngay trước khi apply): engine v2 đóng lượt data bị bỏ dở cho đúng. Anh chốt 18/11/2026
-- "Làm A, B, D1" sau khi chẩn đoán lượt 175931 / 179149 (docs/ENGINE_V2_ORPHAN_RUNS_V576.md). Sinh bằng scripts/build-v576-sql.cjs, không sửa tay.
--   A. reset_desktop_running_statuses_no_retry (Desktop đăng nhập / đăng xuất / thoát): trước khi đánh "hoàn thành – Dừng đột ngột…" mọi data
--      "đang chạy", đóng lượt engine còn mở như engine: chưa ghi dấu → về hàng đợi, đã ghi dấu → hoàn thành (không gửi lại).
--   B. close_stale: lượt mồ côi (mất câu trả lời của claim; chưa ghi dấu, chưa có kết quả, cùng lease đã có lượt sau đã chốt) về hàng đợi ngay,
--      không chờ lease hết hạn.
--   D1. close_stale: lượt bị bỏ dở mà mọi dấu đã có kết quả thì chốt theo kết quả đã ghi (lần chốt rỗng của report_v1), không còn SYS02 cho
--      lượt đã gửi xong; chuỗi data lỗi giữ nguyên.
-- Tạo / thay hàm nên PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v576_engine_orphan_runs.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  -- Hai IF lồng nhau: một biểu thức AND vẫn phân tích cả câu đọc bảng sổ trên DB không có bảng đó.
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v576_%') THEN
      RAISE EXCEPTION 'V576: sổ migration đã có migration_v576_%%, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_engine_close_run_v1(bigint,text)') IS NOT NULL OR to_regprocedure('public.aka_agent_engine_close_desktop_runs_v1(bigint,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'V576: hàm đóng lượt mới đã có';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)')));
  IF v_md5 IS DISTINCT FROM '1208cfa12d71eda90df525f1a8727bef' THEN RAISE EXCEPTION 'V576: close_stale_v1 khác bản đọc 18/11 (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)')));
  IF v_md5 IS DISTINCT FROM '6803509057e6ec91b349c9543757f3d3' THEN RAISE EXCEPTION 'V576: reset_desktop_running_statuses_no_retry khác bản đọc 18/11 (md5 %)', v_md5; END IF;
  -- D1 dựa vào lần chốt rỗng của report_v1 (đóng lượt còn mở khi mất lease, không áp hiệu ứng chiến dịch): đúng bản đã đọc.
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)')));
  IF v_md5 IS DISTINCT FROM '09fe52a53d9f419207506f1033bdb800' THEN RAISE EXCEPTION 'V576: report_v1 khác bản đọc 18/11 (md5 %)', v_md5; END IF;
  IF to_regprocedure('public.aka_agent_engine_scope_ok(bigint)') IS NULL OR to_regprocedure('public.aka_agent_engine_setting(text,text)') IS NULL THEN
    RAISE EXCEPTION 'V576: thiếu hàm engine dùng chung';
  END IF;
END $pre$;

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
END $function$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_desktop_runs_v1(p_staff_id bigint, p_exclude_zalo boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- V576 (A): Desktop đăng nhập / đăng xuất / thoát app (reset_desktop_running_statuses_no_retry, sau khi bộ lập lịch đã dừng): lượt engine v2
-- còn mở của nhân viên trên Desktop không còn ai chạy. Đóng từng lượt như hàm đóng lượt cũ của engine trước khi hàm reset đánh dấu mọi data
-- "đang chạy" là "hoàn thành": chưa ghi dấu "sắp gửi" thì về hàng đợi (chưa gửi gì), đã ghi dấu thì hoàn thành, không gửi lại.
-- Phiên Desktop chỉ đóng được lượt của chính nhân viên. Lượt đang bị khoá (job close_stale đang đóng) thì bỏ qua: job đóng nó, không chờ khoá
-- chéo. Trả số lượt đã đóng.
DECLARE
  v_id bigint;
  v_n integer := 0;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 OR NOT public.aka_agent_engine_scope_ok(p_staff_id) THEN RETURN 0; END IF;
  FOR v_id IN
    SELECT tr.id FROM public.auto_engine_target_runs tr
      JOIN public.auto_accounts a ON a.id = tr.account_id
     WHERE tr.completed_at IS NULL AND tr.staff_id = p_staff_id AND tr.runtime_target = 'desktop'
       AND NOT (coalesce(p_exclude_zalo, false) AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo')
     ORDER BY tr.id
     FOR UPDATE OF tr SKIP LOCKED
  LOOP
    IF public.aka_agent_engine_close_run_v1(v_id, 'desktop_reset') <> 'skipped' THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END $function$;

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
END $function$;

CREATE OR REPLACE FUNCTION public.reset_desktop_running_statuses_no_retry(p_staff_id bigint, p_exclude_zalo boolean DEFAULT false, p_zalo_uncertain_no_retry boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_campaign_inputs_completed integer := 0;
  v_campaign_input_data_completed integer := 0;
  v_non_zalo_accounts_reset integer := 0;
  v_non_zalo_campaigns_reset integer := 0;
  v_non_zalo_campaign_notes_reset integer := 0;
  v_interrupted_note constant text := 'Dừng đột ngột, không xác định kết quả; không tự thực hiện lại';
  v_organization_id bigint;
  v_campaign_id bigint;
  v_previous_random_reset_staff text;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RAISE EXCEPTION 'Staff ID must be a positive integer';
  END IF;

  -- Hold the same staff-row barrier as campaign/account claims for the entire
  -- no-retry completion + existing recovery sequence.
  SELECT staff.organization_id INTO v_organization_id
  FROM public.aka_agent_staff_runtime_scope(p_staff_id, 'update') AS staff
  WHERE staff.id = p_staff_id
  ;
  IF NOT FOUND OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Staff % was not found', p_staff_id;
  END IF;

  -- Match the delegated recovery's global order exactly:
  -- staff -> entitlement (shared) -> campaign barriers -> rows.
  PERFORM pg_advisory_xact_lock_shared(
    hashtextextended('aka-agent-zalo-runtime-entitlement-mutation', 0)
  );

  FOR v_campaign_id IN
    SELECT campaign.id
    FROM public.auto_campaigns AS campaign
    JOIN public.auto_accounts AS account ON account.id = campaign.account_id
    WHERE campaign.staff_id = p_staff_id
      AND campaign.action_id IS DISTINCT FROM 'sms_send'
      AND COALESCE(campaign.is_delete, false) = false
      AND account.staff_id = p_staff_id
      AND lower(btrim(COALESCE(account.flatform_type, ''))) <> 'sms'
      AND COALESCE(account.is_delete, false) = false
      AND (
        lower(btrim(COALESCE(account.flatform_type, ''))) <> 'zalo'
        OR COALESCE(account.is_zalo_server, false) = false
      )
      AND (
        campaign.status = 'đang chạy'
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_inputs AS campaign_input
          WHERE campaign_input.campaign_id = campaign.id
            AND campaign_input.status = 'đang chạy'
            AND COALESCE(campaign_input.is_delete, false) = false
        )
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_input_data AS input_data
          WHERE input_data.campaign_id = campaign.id
            AND input_data.status = 'đang chạy'
            AND COALESCE(input_data.is_delete, false) = false
        )
      )
    ORDER BY campaign.id
  LOOP
    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  -- V576 (A): lượt engine v2 còn mở của nhân viên trên Desktop được đóng như hàm đóng lượt cũ của engine trước khi bước dưới đánh dấu mọi data
  -- "đang chạy" là "hoàn thành": chưa ghi dấu "sắp gửi" thì về hàng đợi (chưa gửi gì), đã ghi dấu thì hoàn thành, không gửi lại.
  PERFORM public.aka_agent_engine_close_desktop_runs_v1(p_staff_id, COALESCE(p_exclude_zalo, false));

  UPDATE public.auto_campaign_input_data AS input_data
  SET status = 'hoàn thành', note = v_interrupted_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE input_data.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND input_data.status = 'đang chạy'
    AND COALESCE(input_data.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_input_data_completed = ROW_COUNT;

  UPDATE public.auto_campaign_inputs AS campaign_input
  SET status = 'hoàn thành', note = v_interrupted_note
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign_input.campaign_id = campaign.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND campaign_input.status = 'đang chạy'
    AND COALESCE(campaign_input.is_delete, false) = false;
  GET DIAGNOSTICS v_campaign_inputs_completed = ROW_COUNT;

  SELECT count(*)::integer INTO v_non_zalo_campaign_notes_reset
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND campaign.note IS NOT NULL
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false;

  -- Startup reset is not a successful random-turn release. Defer output to
  -- the existing lease/orphan recovery, including when random mode is off.
  v_previous_random_reset_staff := current_setting('aka_agent.facebook_random_reset_staff', true);
  PERFORM set_config('aka_agent.facebook_random_reset_staff', p_staff_id::text, true);
  UPDATE public.auto_campaigns AS campaign
  SET status = 'chờ xử lý', note = NULL, updated_at = now()
  FROM public.auto_accounts AS account
  WHERE campaign.account_id = account.id
    AND campaign.staff_id = p_staff_id
    AND campaign.action_id IS DISTINCT FROM 'sms_send'
    AND COALESCE(campaign.is_delete, false) = false
    AND campaign.status = 'đang chạy'
    AND account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false;
  GET DIAGNOSTICS v_non_zalo_campaigns_reset = ROW_COUNT;
  PERFORM set_config('aka_agent.facebook_random_reset_staff', COALESCE(v_previous_random_reset_staff, ''), true);

  UPDATE public.auto_accounts AS account
  SET status = 'chờ xử lý', updated_at = now()
  WHERE account.staff_id = p_staff_id
    AND lower(btrim(COALESCE(account.flatform_type, ''))) IN ('facebook', 'email')
    AND COALESCE(account.is_delete, false) = false
    AND account.status = 'đang chạy';
  GET DIAGNOSTICS v_non_zalo_accounts_reset = ROW_COUNT;

  v_result := public.reset_desktop_running_statuses(
    p_staff_id,
    COALESCE(p_exclude_zalo, false),
    COALESCE(p_zalo_uncertain_no_retry, false)
  );

  RETURN v_result || jsonb_build_object(
    'accounts_reset', COALESCE((v_result ->> 'accounts_reset')::integer, 0) + v_non_zalo_accounts_reset,
    'campaigns_reset', COALESCE((v_result ->> 'campaigns_reset')::integer, 0) + v_non_zalo_campaigns_reset,
    'campaign_notes_reset', COALESCE((v_result ->> 'campaign_notes_reset')::integer, 0) + v_non_zalo_campaign_notes_reset,
    'non_zalo_uncertain_no_retry', true,
    'non_zalo_campaign_inputs_completed', v_campaign_inputs_completed,
    'non_zalo_campaign_input_data_completed', v_campaign_input_data_completed
  );
END;
$function$;

COMMENT ON FUNCTION public.aka_agent_engine_close_run_v1(bigint,text) IS
  'V576: đóng một lượt data engine còn mở mà nơi chạy đã bỏ (close_stale, lượt mồ côi, Desktop đăng nhập / đăng xuất / thoát). Cách V515; mọi dấu đã có kết quả thì chốt theo kết quả đã ghi (report_v1 chốt rỗng), giữ chuỗi data lỗi. Chỉ postgres / service_role.';
COMMENT ON FUNCTION public.aka_agent_engine_close_desktop_runs_v1(bigint,boolean) IS
  'V576: đóng lượt engine còn mở của nhân viên trên Desktop, gọi từ reset_desktop_running_statuses_no_retry trước khi đánh dấu data đang chạy. Phiên Desktop chỉ đóng lượt của chính nhân viên.';

DO $grants$
DECLARE v_role text;
BEGIN
  REVOKE ALL ON FUNCTION public.aka_agent_engine_close_run_v1(bigint,text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.aka_agent_engine_close_desktop_runs_v1(bigint,boolean) FROM PUBLIC;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_engine_close_run_v1(bigint,text) FROM %I', v_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public.aka_agent_engine_close_desktop_runs_v1(bigint,boolean) FROM %I', v_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.aka_agent_engine_close_run_v1(bigint,text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.aka_agent_engine_close_desktop_runs_v1(bigint,boolean) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT EXECUTE ON FUNCTION public.aka_agent_engine_close_desktop_runs_v1(bigint,boolean) TO aka_agent_desktop;
  END IF;
END $grants$;

DO $post$
DECLARE v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_run_v1(bigint,text)')));
  IF v_md5 IS DISTINCT FROM '72b8c9698e7176640b0e1911c8c5c49f' THEN RAISE EXCEPTION 'V576: close_run_v1 sau khi tạo khác bản sinh (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_desktop_runs_v1(bigint,boolean)')));
  IF v_md5 IS DISTINCT FROM 'b2c5fc9088ec3caff36e701bad4e78ec' THEN RAISE EXCEPTION 'V576: close_desktop_runs_v1 sau khi tạo khác bản sinh (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_close_stale_v1(integer)')));
  IF v_md5 IS DISTINCT FROM '8ed4775297c061bc35cbc6f0944dc905' THEN RAISE EXCEPTION 'V576: close_stale_v1 sau khi thay khác bản sinh (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)')));
  IF v_md5 IS DISTINCT FROM '24cb4850f4a91819ef8b37eeb3b7f8c5' THEN RAISE EXCEPTION 'V576: hàm reset Desktop sau khi thay khác bản sinh (md5 %)', v_md5; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated', 'aka_agent_desktop')) = 3 THEN
    IF has_function_privilege('anon', to_regprocedure('public.aka_agent_engine_close_run_v1(bigint,text)'), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure('public.aka_agent_engine_close_run_v1(bigint,text)'), 'EXECUTE')
       OR has_function_privilege('aka_agent_desktop', to_regprocedure('public.aka_agent_engine_close_run_v1(bigint,text)'), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure('public.aka_agent_engine_close_desktop_runs_v1(bigint,boolean)'), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure('public.aka_agent_engine_close_desktop_runs_v1(bigint,boolean)'), 'EXECUTE')
       OR NOT has_function_privilege('aka_agent_desktop', to_regprocedure('public.aka_agent_engine_close_desktop_runs_v1(bigint,boolean)'), 'EXECUTE') THEN
      RAISE EXCEPTION 'V576: quyền gọi hai hàm mới không đúng';
    END IF;
  END IF;
END $post$;

COMMIT;
