#!/usr/bin/env node
// V576 (số tạm, kiểm lại sổ ngay trước khi apply): engine v2 đóng lượt data bị bỏ dở cho đúng (anh chốt 18/11/2026 "Làm A, B, D1", sau khi
// chẩn đoán lượt 175931 / 179149; docs/ENGINE_V2_ORPHAN_RUNS_V576.md). Chỉ đổi DB, không cần phát hành app.
//
//   A. Hàm reset của Desktop (reset_desktop_running_statuses_no_retry, gọi lúc đăng nhập / đăng xuất / thoát app) đánh "hoàn thành – Dừng đột
//      ngột…" mọi data "đang chạy", kể cả data của lượt engine chưa gửi gì (lượt 175931 mất một nhóm ngày 18/11). Nay trước bước đó, lượt engine
//      còn mở của nhân viên trên Desktop được đóng như hàm đóng lượt cũ của engine: chưa ghi dấu "sắp gửi" thì về hàng đợi, đã ghi dấu thì
//      "hoàn thành", không gửi lại. Phần còn lại của hàm giữ nguyên từng chữ.
//   B. Lượt mồ côi (claim đã tạo lượt nhưng nơi chạy không nhận được câu trả lời, gọi lại claim cùng lease và chạy data kế): close_stale chỉ
//      đóng được khi lease hết hạn + 10 phút, mà lease được giữ suốt lượt (lượt 175931 treo 3 giờ). Nay close_stale trả về hàng đợi lượt chưa
//      ghi dấu, chưa có kết quả, mở quá 2 phút, khi cùng lease đã có lượt bắt đầu sau nó ít nhất 3 giây và đã chốt ('reported'): nơi chạy đã
//      đi tiếp nên không còn làm lượt đó. Lượt cùng một lần nhận cả lô (claim_batch_v1, cùng lần gọi ≤ 1,5 giây) không bị tính.
//   D1. Lượt đã ghi dấu mà mọi dấu đã có kết quả báo về (không còn dấu "pending") bị bỏ dở (lõi dừng khi lần báo giữa chừng nhận
//      ownership_lost, máy ngủ…): close_stale chốt theo kết quả đã ghi bằng lần chốt rỗng của report_v1 (như lõi chốt khi bị dừng) thay vì
//      "Bị ngắt khi đang gửi, không rõ kết quả (SYS02)" (lượt 179149 đã gửi thành công). Không đổi chuỗi data lỗi (lượt đã bị bỏ, data sau
//      có thể đã chạy); không áp hiệu ứng chiến dịch / tài khoản (lease đã mất). Lỗi thì quay về cách cũ.
//
// Thân mới viết đúng dạng pg_get_functiondef in ra để md5 tính được ở đây; bài kiểm so md5 sau khi apply trên PostgreSQL 17 cục bộ.
// Chạy: node scripts/build-v576-sql.cjs (ghi migration + rollback). Không sửa tay file sinh ra.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const NUMBER = 576
const NAME = `migration_v${NUMBER}_engine_orphan_runs`
const ROLLBACK_NAME = `rollback_v${NUMBER}_engine_orphan_runs`
const LIVE_FILE = path.join(ROOT, 'scripts/fixtures/engine-v2-orphan-runs-v576/live-20261118.json')
const LIVE = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'))

const SIG = {
  closeStale: 'aka_agent_engine_close_stale_v1(integer)',
  wrapper: 'reset_desktop_running_statuses_no_retry(bigint,boolean,boolean)',
  report: 'aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)',
  closeRun: 'aka_agent_engine_close_run_v1(bigint,text)',
  closeDesktop: 'aka_agent_engine_close_desktop_runs_v1(bigint,boolean)'
}
/** md5 pg_get_functiondef trên production, đọc chỉ đọc 18/11/2026 17:37 VN (sau V575). */
const OLD = {
  closeStale: '1208cfa12d71eda90df525f1a8727bef',
  wrapper: '6803509057e6ec91b349c9543757f3d3',
  report: '09fe52a53d9f419207506f1033bdb800'
}
const liveDef = key => {
  const fn = LIVE.functions[SIG[key]]
  if (!fn) throw new Error(`Thiếu ${SIG[key]} trong ${LIVE_FILE}`)
  if (md5(fn.definition) !== OLD[key] || fn.md5 !== OLD[key]) throw new Error(`${SIG[key]}: bản đọc khác md5 ${OLD[key]}`)
  return fn.definition
}
const OLD_DEF = { closeStale: liveDef('closeStale'), wrapper: liveDef('wrapper') }
liveDef('report')

// ---------------------------------------------------------------------------------------------------------------------------------
// Hàm mới: đóng một lượt (cách của close_stale V515 + D1).
// ---------------------------------------------------------------------------------------------------------------------------------
const CLOSE_RUN_DEF = `CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_run_v1(p_run_id bigint, p_via text)
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
`

// ---------------------------------------------------------------------------------------------------------------------------------
// close_stale: thêm vòng lượt mồ côi (B); vòng cũ gọi close_run (D1 nằm trong đó); vòng nhả lease giữ nguyên.
// ---------------------------------------------------------------------------------------------------------------------------------
const CLOSE_STALE_DEF = `CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_stale_v1(p_limit integer DEFAULT 200)
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
`

// ---------------------------------------------------------------------------------------------------------------------------------
// A: đóng lượt engine còn mở của nhân viên trên Desktop, gọi từ hàm reset của Desktop.
// ---------------------------------------------------------------------------------------------------------------------------------
const CLOSE_DESKTOP_DEF = `CREATE OR REPLACE FUNCTION public.aka_agent_engine_close_desktop_runs_v1(p_staff_id bigint, p_exclude_zalo boolean DEFAULT false)
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
END $function$
`

// ---------------------------------------------------------------------------------------------------------------------------------
// Hàm reset của Desktop: thêm đúng một lời gọi, phần còn lại giữ nguyên từng chữ.
// ---------------------------------------------------------------------------------------------------------------------------------
const WRAPPER_ANCHOR = `    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  UPDATE public.auto_campaign_input_data AS input_data
  SET status = 'hoàn thành', note = v_interrupted_note
`
const WRAPPER_INSERT = `    PERFORM public.aka_agent_lock_campaign_input_serialization(v_campaign_id);
  END LOOP;

  -- V576 (A): lượt engine v2 còn mở của nhân viên trên Desktop được đóng như hàm đóng lượt cũ của engine trước khi bước dưới đánh dấu mọi data
  -- "đang chạy" là "hoàn thành": chưa ghi dấu "sắp gửi" thì về hàng đợi (chưa gửi gì), đã ghi dấu thì hoàn thành, không gửi lại.
  PERFORM public.aka_agent_engine_close_desktop_runs_v1(p_staff_id, COALESCE(p_exclude_zalo, false));

  UPDATE public.auto_campaign_input_data AS input_data
  SET status = 'hoàn thành', note = v_interrupted_note
`
if (OLD_DEF.wrapper.split(WRAPPER_ANCHOR).length !== 2) throw new Error('Không thấy đúng một chỗ chèn trong hàm reset của Desktop')
const WRAPPER_DEF = OLD_DEF.wrapper.replace(WRAPPER_ANCHOR, WRAPPER_INSERT)

const NEW = {
  closeRun: md5(CLOSE_RUN_DEF),
  closeStale: md5(CLOSE_STALE_DEF),
  closeDesktop: md5(CLOSE_DESKTOP_DEF),
  wrapper: md5(WRAPPER_DEF)
}

const stmt = def => `${def.replace(/\n$/, '')};\n`

const HEADER = `-- ${NAME} (số tạm: kiểm lại sổ migration ngay trước khi apply): engine v2 đóng lượt data bị bỏ dở cho đúng. Anh chốt 18/11/2026
-- "Làm A, B, D1" sau khi chẩn đoán lượt 175931 / 179149 (docs/ENGINE_V2_ORPHAN_RUNS_V576.md). Sinh bằng scripts/build-v576-sql.cjs, không sửa tay.
--   A. reset_desktop_running_statuses_no_retry (Desktop đăng nhập / đăng xuất / thoát): trước khi đánh "hoàn thành – Dừng đột ngột…" mọi data
--      "đang chạy", đóng lượt engine còn mở như engine: chưa ghi dấu → về hàng đợi, đã ghi dấu → hoàn thành (không gửi lại).
--   B. close_stale: lượt mồ côi (mất câu trả lời của claim; chưa ghi dấu, chưa có kết quả, cùng lease đã có lượt sau đã chốt) về hàng đợi ngay,
--      không chờ lease hết hạn.
--   D1. close_stale: lượt bị bỏ dở mà mọi dấu đã có kết quả thì chốt theo kết quả đã ghi (lần chốt rỗng của report_v1), không còn SYS02 cho
--      lượt đã gửi xong; chuỗi data lỗi giữ nguyên.
-- Tạo / thay hàm nên PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: ${ROLLBACK_NAME}.sql.
`

const migration = `${HEADER}BEGIN;
SET LOCAL lock_timeout = '3s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  -- Hai IF lồng nhau: một biểu thức AND vẫn phân tích cả câu đọc bảng sổ trên DB không có bảng đó.
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v${NUMBER}_%') THEN
      RAISE EXCEPTION 'V${NUMBER}: sổ migration đã có migration_v${NUMBER}_%%, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.${SIG.closeRun}') IS NOT NULL OR to_regprocedure('public.${SIG.closeDesktop}') IS NOT NULL THEN
    RAISE EXCEPTION 'V${NUMBER}: hàm đóng lượt mới đã có';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.${SIG.closeStale}')));
  IF v_md5 IS DISTINCT FROM '${OLD.closeStale}' THEN RAISE EXCEPTION 'V${NUMBER}: close_stale_v1 khác bản đọc 18/11 (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.${SIG.wrapper}')));
  IF v_md5 IS DISTINCT FROM '${OLD.wrapper}' THEN RAISE EXCEPTION 'V${NUMBER}: reset_desktop_running_statuses_no_retry khác bản đọc 18/11 (md5 %)', v_md5; END IF;
  -- D1 dựa vào lần chốt rỗng của report_v1 (đóng lượt còn mở khi mất lease, không áp hiệu ứng chiến dịch): đúng bản đã đọc.
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.${SIG.report}')));
  IF v_md5 IS DISTINCT FROM '${OLD.report}' THEN RAISE EXCEPTION 'V${NUMBER}: report_v1 khác bản đọc 18/11 (md5 %)', v_md5; END IF;
  IF to_regprocedure('public.aka_agent_engine_scope_ok(bigint)') IS NULL OR to_regprocedure('public.aka_agent_engine_setting(text,text)') IS NULL THEN
    RAISE EXCEPTION 'V${NUMBER}: thiếu hàm engine dùng chung';
  END IF;
END $pre$;

${stmt(CLOSE_RUN_DEF)}
${stmt(CLOSE_DESKTOP_DEF)}
${stmt(CLOSE_STALE_DEF)}
${stmt(WRAPPER_DEF)}
COMMENT ON FUNCTION public.${SIG.closeRun} IS
  'V${NUMBER}: đóng một lượt data engine còn mở mà nơi chạy đã bỏ (close_stale, lượt mồ côi, Desktop đăng nhập / đăng xuất / thoát). Cách V515; mọi dấu đã có kết quả thì chốt theo kết quả đã ghi (report_v1 chốt rỗng), giữ chuỗi data lỗi. Chỉ postgres / service_role.';
COMMENT ON FUNCTION public.${SIG.closeDesktop} IS
  'V${NUMBER}: đóng lượt engine còn mở của nhân viên trên Desktop, gọi từ reset_desktop_running_statuses_no_retry trước khi đánh dấu data đang chạy. Phiên Desktop chỉ đóng lượt của chính nhân viên.';

DO $grants$
DECLARE v_role text;
BEGIN
  REVOKE ALL ON FUNCTION public.${SIG.closeRun} FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.${SIG.closeDesktop} FROM PUBLIC;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.${SIG.closeRun} FROM %I', v_role);
      EXECUTE format('REVOKE ALL ON FUNCTION public.${SIG.closeDesktop} FROM %I', v_role);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.${SIG.closeRun} TO service_role;
    GRANT EXECUTE ON FUNCTION public.${SIG.closeDesktop} TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT EXECUTE ON FUNCTION public.${SIG.closeDesktop} TO aka_agent_desktop;
  END IF;
END $grants$;

DO $post$
DECLARE v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.${SIG.closeRun}')));
  IF v_md5 IS DISTINCT FROM '${NEW.closeRun}' THEN RAISE EXCEPTION 'V${NUMBER}: close_run_v1 sau khi tạo khác bản sinh (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.${SIG.closeDesktop}')));
  IF v_md5 IS DISTINCT FROM '${NEW.closeDesktop}' THEN RAISE EXCEPTION 'V${NUMBER}: close_desktop_runs_v1 sau khi tạo khác bản sinh (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.${SIG.closeStale}')));
  IF v_md5 IS DISTINCT FROM '${NEW.closeStale}' THEN RAISE EXCEPTION 'V${NUMBER}: close_stale_v1 sau khi thay khác bản sinh (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.${SIG.wrapper}')));
  IF v_md5 IS DISTINCT FROM '${NEW.wrapper}' THEN RAISE EXCEPTION 'V${NUMBER}: hàm reset Desktop sau khi thay khác bản sinh (md5 %)', v_md5; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('anon', 'authenticated', 'aka_agent_desktop')) = 3 THEN
    IF has_function_privilege('anon', to_regprocedure('public.${SIG.closeRun}'), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure('public.${SIG.closeRun}'), 'EXECUTE')
       OR has_function_privilege('aka_agent_desktop', to_regprocedure('public.${SIG.closeRun}'), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure('public.${SIG.closeDesktop}'), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure('public.${SIG.closeDesktop}'), 'EXECUTE')
       OR NOT has_function_privilege('aka_agent_desktop', to_regprocedure('public.${SIG.closeDesktop}'), 'EXECUTE') THEN
      RAISE EXCEPTION 'V${NUMBER}: quyền gọi hai hàm mới không đúng';
    END IF;
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- ${ROLLBACK_NAME}: gỡ V${NUMBER}, trả close_stale_v1 và reset_desktop_running_statuses_no_retry về bản đọc 18/11, xoá hai hàm mới.
-- Sinh bằng scripts/build-v576-sql.cjs, không sửa tay. Tạo / thay hàm nên PostgREST nạp lại schema: chạy ngoài giờ cao điểm.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.${SIG.closeStale}')));
  IF v_md5 IS DISTINCT FROM '${NEW.closeStale}' THEN RAISE EXCEPTION 'gỡ V${NUMBER}: close_stale_v1 không phải bản V${NUMBER} (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.${SIG.wrapper}')));
  IF v_md5 IS DISTINCT FROM '${NEW.wrapper}' THEN RAISE EXCEPTION 'gỡ V${NUMBER}: hàm reset Desktop không phải bản V${NUMBER} (md5 %)', v_md5; END IF;
END $pre$;

${stmt(OLD_DEF.closeStale)}
${stmt(OLD_DEF.wrapper)}
DROP FUNCTION public.${SIG.closeDesktop};
DROP FUNCTION public.${SIG.closeRun};

DO $post$
DECLARE v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.${SIG.closeStale}')));
  IF v_md5 IS DISTINCT FROM '${OLD.closeStale}' THEN RAISE EXCEPTION 'gỡ V${NUMBER}: close_stale_v1 khác bản cũ (md5 %)', v_md5; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.${SIG.wrapper}')));
  IF v_md5 IS DISTINCT FROM '${OLD.wrapper}' THEN RAISE EXCEPTION 'gỡ V${NUMBER}: hàm reset Desktop khác bản cũ (md5 %)', v_md5; END IF;
END $post$;

COMMIT;
`

module.exports = { NUMBER, NAME, ROLLBACK_NAME, SIG, OLD, NEW, LIVE, OLD_DEF, CLOSE_RUN_DEF, CLOSE_STALE_DEF, CLOSE_DESKTOP_DEF, WRAPPER_DEF, migration, rollback }

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations', `${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations', `${ROLLBACK_NAME}.sql`), rollback)
  console.log(`${NAME}.sql md5 ${md5(migration)}`)
  console.log(`${ROLLBACK_NAME}.sql md5 ${md5(rollback)}`)
  console.log('md5 hàm sau khi apply:', JSON.stringify(NEW))
}
