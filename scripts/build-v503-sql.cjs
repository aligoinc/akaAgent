// Sinh migration V503: gửi dạng chia sẻ (nhắn bạn bè / group) chạy bằng engine v2, theo đúng bộ chạy Desktop/VPS
// (executeZaloShareMessageBatchCampaign + processZaloShareMessageBatch, đặc tả docs/engine-v2-specs/zalo-other-types.md §3,
// zalo-media.md §3.4/§4.2). Chỉ engine v2 gọi các hàm này; bộ chạy cũ không đổi.
//
// Sửa tại chỗ claim_target_v1 và report_v1 (thân V501 đã apply production 12/11 07:56 VN: md5 prosrc 9af133f7… / 9c5c2586…).
// Mỗi chỗ sửa so khớp đúng số lần xuất hiện, lệch thì dừng.
//   claim:  vòng chống gửi lặp dừng ở mốc chung của cả lô khi được gọi từ claim_batch_v1 (aka.engine.claim_deadline).
//   report: chế độ báo theo lô (aka.engine.batch_scope, chỉ report_batch_v1 đặt): target_only / batch_followup bỏ khoá thao tác,
//           hiệu ứng chiến dịch / tài khoản / đăng nhập và lệnh dừng; target_only bỏ cả chuỗi data lỗi.
//   claim_batch_v1 (mới): nhận tối đa min(50, maxTargets, lượt còn lại trong ngày, lượt còn lại trong khung giờ) data trong cùng lease.
//   report_batch_v1 (mới): báo cả lô một lần, chọn chế độ cho từng data như policyHandling của Desktop, tạm dừng chiến dịch khi cả
//           lô thất bại.
// Mã mới: CFG17 (gửi dạng chia sẻ không có nội dung lẫn media), SYS09 (lô dừng sau khi đã gửi media, chưa chia sẻ phần chữ).
// Chạy: node scripts/build-v503-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v501 = require('./build-v501-sql.cjs')

function extract(text, name) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$f\\$([\\s\\S]*?)\\$f\\$;`)
  const m = re.exec(text)
  if (!m) throw new Error(`Không thấy ${name} trong V501`)
  return { block: m[0], body: m[1] }
}
function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}
const bodyOf = block => /AS \$f\$([\s\S]*?)\$f\$;$/.exec(block)[1]

const claim = extract(v501.migration, 'aka_agent_engine_claim_target_v1')
const report = extract(v501.migration, 'aka_agent_engine_report_v1')
const LIVE = { claim: v501.NEW.claim, report: v501.NEW.report }
if (md5(claim.body) !== LIVE.claim) throw new Error('Thân claim_target_v1 trong V501 không còn khớp bản đã apply')
if (md5(report.body) !== LIVE.report) throw new Error('Thân report_v1 trong V501 không còn khớp bản đã apply')
if (LIVE.claim !== '9af133f7b9355215e5b86da4868aece8' || LIVE.report !== '9c5c2586105757b9892a90656899ccb0') {
  throw new Error('md5 thân V501 khác bản đã apply production 12/11 07:56 VN')
}

// ------------------------------------------------------------------------------------------------ claim
let c = claim.block
c = patch(c, `                                                       ELSE 1500 END) / 1000.0);
`, `                                                       ELSE 1500 END) / 1000.0);
  -- V503: nhận cả lô (claim_batch_v1) đặt một mốc chung cho mọi lần nhận trong lô, để cả lời gọi không chạm trần 3 giây của Desktop.
  IF nullif(current_setting('aka.engine.claim_deadline', true), '') IS NOT NULL THEN
    v_cd_deadline := least(v_cd_deadline, current_setting('aka.engine.claim_deadline', true)::timestamptz);
  END IF;
`, 1, 'claim: mốc chung của lô')

// ------------------------------------------------------------------------------------------------ report
let r = report.block
r = patch(r, `  v_more boolean;
BEGIN`, `  v_more boolean;
  -- V503: chế độ báo theo lô, chỉ report_batch_v1 đặt (trong cùng giao dịch, đặt lại rỗng sau mỗi data).
  v_scope text := nullif(current_setting('aka.engine.batch_scope', true), '');
BEGIN`, 1, 'report: biến chế độ lô')
r = patch(r, `      -- Giải quyết dấu "sắp gửi" của bước này.
`, `      -- V503: báo cả lô gửi dạng chia sẻ (policyHandling của Desktop). Lô có người đã nhận được (chia sẻ xong hoặc đã nhận media) thì lỗi
      -- của người khác chỉ ghi cho người đó (target_only): không khoá thao tác, không đổi chiến dịch / tài khoản / đăng nhập, không dừng
      -- lượt, không cộng chuỗi data lỗi. Lô không ai nhận được thì chỉ người có hiệu ứng mạnh nhất áp đủ chính sách; người khác
      -- (batch_followup) bỏ hiệu ứng phụ nhưng vẫn theo chuỗi data lỗi. Data đi đâu, ghi lịch sử, hạn mức, nhớ mục tiêu: theo chính sách.
      IF NOT v_ok AND v_scope IN ('target_only', 'batch_followup') THEN
        v_policy := v_policy || jsonb_build_object('lock_action_codes', '[]'::jsonb, 'campaign_effect', 'none', 'account_effect', 'none',
          'login_effect', 'none', 'run_effect', 'continue')
          || CASE WHEN v_scope = 'target_only' THEN jsonb_build_object('target_streak_effect', 'ignore') ELSE '{}'::jsonb END;
      END IF;

      -- Giải quyết dấu "sắp gửi" của bước này.
`, 1, 'report: chế độ lô')

const CLAIM_BATCH_SIG = 'public.aka_agent_engine_claim_batch_v1(jsonb)'
const REPORT_BATCH_SIG = 'public.aka_agent_engine_report_batch_v1(uuid,jsonb,integer,boolean)'

const claimBatch = `CREATE FUNCTION public.aka_agent_engine_claim_batch_v1(p_ctx jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
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
END $f$;`

const reportBatch = `CREATE FUNCTION public.aka_agent_engine_report_batch_v1(p_lease_token uuid, p_items jsonb, p_batch_size integer DEFAULT NULL,
  p_already_stopped boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- V503: báo cả lô gửi dạng chia sẻ một lần (processZaloShareMessageBatch của Desktop). Mỗi data một mục { targetRunId, outcomes },
-- chốt data (final). Chế độ cho từng data như policyHandling của Desktop:
--   lô có người đã nhận được (kết quả thành công, hoặc giao một phần: đã nhận media) → mọi lỗi là target_only;
--   không ai nhận được → data có hiệu ứng mạnh nhất (getZaloPolicySideEffectPriority: đăng nhập 8, tài khoản 4, chiến dịch 2, khoá 1;
--   bằng nhau lấy data đầu) áp đủ chính sách, data khác batch_followup.
-- Không ai nhận được và chưa có chính sách nào dừng tài khoản / chiến dịch → tạm dừng chiến dịch với câu của Desktop.
-- Một mục bị report_v1 từ chối thì hoàn tác cả lô và trả lý do. p_batch_size: số data của lô (kể cả data đã báo riêng, như media quá giờ)
-- cho câu tạm dừng. p_already_stopped: lô đã dừng theo chính sách khi gửi tệp (stoppedDuringMedia của Desktop): không ai áp thêm
-- chính sách (không có data "full"), không tạm dừng "toàn bộ thất bại".
DECLARE
  v_now timestamptz := clock_timestamp();
  v_item jsonb;
  o jsonb;
  rr public.auto_engine_target_runs%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  v_campaign_id bigint;
  v_account_id bigint;
  v_runs bigint[] := '{}';
  v_run bigint;
  v_success boolean := false;
  v_best_run bigint;
  v_best integer := -1;
  v_priority integer;
  v_platform text;
  v_action text;
  v_phase text;
  v_error text;
  v_policy jsonb;
  v_scope text;
  v_res jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ok_items integer := 0;
  v_rank integer;
  v_stop_rank integer := 0;
  v_next text := 'next_target';
  v_note text;
  v_paused boolean := false;
  v_more boolean := false;
  v_rejected jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 50 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'items_invalid');
  END IF;
  FOR v_item IN SELECT x.value FROM jsonb_array_elements(p_items) x LOOP
    IF jsonb_typeof(v_item) <> 'object' OR coalesce(v_item->>'targetRunId', '') !~ '^[0-9]{1,18}$'
       OR jsonb_typeof(v_item->'outcomes') IS DISTINCT FROM 'array' OR jsonb_array_length(v_item->'outcomes') = 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'items_invalid');
    END IF;
    v_run := (v_item->>'targetRunId')::bigint;
    IF v_run = ANY (v_runs) THEN RETURN jsonb_build_object('ok', false, 'reason', 'item_duplicate', 'targetRunId', v_run); END IF;
    SELECT * INTO rr FROM public.auto_engine_target_runs WHERE id = v_run;
    IF NOT FOUND OR rr.lease_token IS DISTINCT FROM p_lease_token THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'lease_token_mismatch', 'targetRunId', v_run);
    END IF;
    IF v_campaign_id IS NULL THEN
      v_campaign_id := rr.campaign_id;
      v_account_id := rr.account_id;
    ELSIF v_campaign_id <> rr.campaign_id THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'campaign_mismatch', 'targetRunId', v_run);
    END IF;
    v_runs := v_runs || v_run;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'outcomes') y
                WHERE y.value->'ok' = 'true'::jsonb OR y.value->'evidence'->'partialDelivery' = 'true'::jsonb) THEN
      v_success := true;
    END IF;
  END LOOP;
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id;

  IF NOT v_success AND NOT coalesce(p_already_stopped, false) THEN
    FOR v_item IN SELECT x.value FROM jsonb_array_elements(p_items) x LOOP
      SELECT * INTO rr FROM public.auto_engine_target_runs WHERE id = (v_item->>'targetRunId')::bigint;
      v_priority := 0;
      FOR o IN SELECT y.value FROM jsonb_array_elements(v_item->'outcomes') y LOOP
        CONTINUE WHEN o->'ok' = 'true'::jsonb;
        v_action := o->>'actionCode';
        v_phase := coalesce(nullif(o->>'phase', ''), 'after_send');
        v_platform := NULL; v_error := NULL;
        SELECT aa.flatform_type INTO v_platform FROM public.auto_account_actions aa WHERE aa.code = v_action;
        SELECT cs.error_code INTO v_error FROM public.aka_agent_engine_classify_signal(v_platform, v_action, v_phase, coalesce(o->'signal', '{}'::jsonb)) cs;
        v_policy := public.aka_agent_engine_resolve_policy(coalesce(v_error, 'err_undefined'), NULL, v_action, c.action_id, rr.runtime_target, v_phase);
        v_priority := greatest(v_priority,
          CASE WHEN coalesce(v_policy->>'login_effect', 'none') <> 'none' THEN 8 ELSE 0 END
          + CASE WHEN coalesce(v_policy->>'account_effect', 'none') <> 'none' THEN 4 ELSE 0 END
          + CASE WHEN coalesce(v_policy->>'campaign_effect', 'none') <> 'none' THEN 2 ELSE 0 END
          + CASE WHEN jsonb_array_length(coalesce(v_policy->'lock_action_codes', '[]'::jsonb)) > 0 THEN 1 ELSE 0 END);
      END LOOP;
      IF v_priority > v_best THEN v_best := v_priority; v_best_run := rr.id; END IF;
    END LOOP;
  END IF;

  BEGIN
    FOR v_item IN SELECT x.value FROM jsonb_array_elements(p_items) x LOOP
      v_run := (v_item->>'targetRunId')::bigint;
      v_scope := CASE WHEN v_success THEN 'target_only' WHEN v_run = v_best_run THEN 'full' ELSE 'batch_followup' END;
      PERFORM set_config('aka.engine.batch_scope', CASE WHEN v_scope = 'full' THEN '' ELSE v_scope END, true);
      v_res := public.aka_agent_engine_report_v1(v_run, p_lease_token, v_item->'outcomes', true, false);
      PERFORM set_config('aka.engine.batch_scope', '', true);
      IF coalesce(v_res->>'ok', 'false') <> 'true' THEN
        RAISE EXCEPTION USING ERRCODE = 'AKB03', MESSAGE = jsonb_build_object('targetRunId', v_run, 'response', v_res)::text;
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_item->'outcomes') y WHERE y.value->'ok' = 'true'::jsonb) THEN
        v_ok_items := v_ok_items + 1;
      END IF;
      v_rank := CASE v_res->>'next' WHEN 'ownership_lost' THEN 5 WHEN 'stop_campaign' THEN 4 WHEN 'stop_account' THEN 3 WHEN 'end_unit' THEN 2 ELSE 0 END;
      IF v_rank > v_stop_rank THEN
        v_stop_rank := v_rank;
        v_next := v_res->>'next';
        v_note := coalesce(v_res->'campaign'->>'note', v_res->'target'->>'note');
      END IF;
      v_results := v_results || jsonb_build_array(jsonb_build_object('targetRunId', v_run, 'scope', v_scope, 'response', v_res));
    END LOOP;
  EXCEPTION WHEN SQLSTATE 'AKB03' THEN
    PERFORM set_config('aka.engine.batch_scope', '', true);
    v_rejected := SQLERRM::jsonb;
    RETURN jsonb_build_object('ok', false, 'reason', 'item_rejected', 'targetRunId', v_rejected->'targetRunId',
      'detail', v_rejected->'response');
  END;

  -- Không ai nhận được, chưa có chính sách nào dừng tài khoản / chiến dịch: tạm dừng chiến dịch để kiểm tra (như Desktop).
  IF NOT v_success AND NOT coalesce(p_already_stopped, false) AND v_stop_rank < 3 AND EXISTS (SELECT 1 FROM public.auto_engine_leases l
       WHERE l.account_id = v_account_id AND l.lease_token = p_lease_token AND l.expires_at > clock_timestamp()) THEN
    v_note := 'Toàn bộ ' || greatest(coalesce(p_batch_size, 0), jsonb_array_length(p_items))
      || ' target trong batch đều thất bại; chiến dịch đã tạm dừng để kiểm tra';
    UPDATE public.auto_campaigns SET status = 'tạm dừng', note = v_note, updated_at = v_now
     WHERE id = v_campaign_id AND status IN ('đang chạy', 'chờ xử lý');
    IF FOUND THEN v_paused := true; v_stop_rank := 4; v_next := 'stop_campaign'; END IF;
  END IF;

  v_more := EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
    WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' AND coalesce(d.is_delete, false) = false
      AND (d.schedule IS NULL OR d.schedule <= clock_timestamp())
      AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = p_lease_token));
  RETURN jsonb_build_object('ok', true, 'next', v_next, 'items', v_results,
    'summary', jsonb_build_object('items', jsonb_array_length(p_items), 'succeeded', v_ok_items, 'anyDelivered', v_success, 'paused', v_paused),
    'stopNote', CASE WHEN v_stop_rank >= 2 THEN v_note END, 'morePending', v_more);
END $f$;`

const NEW = {
  claim: md5(bodyOf(c)),
  report: md5(bodyOf(r)),
  claimBatch: md5(bodyOf(claimBatch)),
  reportBatch: md5(bodyOf(reportBatch))
}

const migration = `-- V503: gửi dạng chia sẻ (nhắn bạn bè / group) chạy bằng engine v2, theo đúng bộ chạy Desktop/VPS (12/11/2026).
-- SINH TỪ scripts/build-v503-sql.cjs, không sửa tay. Đặc tả: docs/engine-v2-specs/zalo-other-types.md §3, zalo-media.md §3.4/§4.2.
--
-- Chỉ engine v2 gọi các hàm này (Fly chỉ khi tổ chức bật cờ, Desktop chỉ bản cài mới); bộ chạy cũ không đổi. Không đổi dữ liệu cũ,
-- không thêm cột hay bảng. DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
--   * claim_target_v1: vòng chống gửi lặp dừng ở mốc chung của lô (aka.engine.claim_deadline, chỉ claim_batch_v1 đặt).
--   * report_v1: chế độ báo theo lô (aka.engine.batch_scope, chỉ report_batch_v1 đặt); gọi thường thì như V501.
--   * claim_batch_v1 / report_batch_v1 (mới): nhận và báo cả lô gửi dạng chia sẻ.
--   * CFG17, SYS09 (mã mới, error_type 'engine v2'), luật share_interrupted.
-- Gỡ: rollback_v503_engine_share_batch.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v503_%') THEN
      RAISE EXCEPTION 'V503 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)') IS NULL THEN RAISE EXCEPTION 'V503 cần V501'; END IF;
  IF to_regprocedure('${CLAIM_BATCH_SIG}') IS NOT NULL OR to_regprocedure('${REPORT_BATCH_SIG}') IS NOT NULL THEN
    RAISE EXCEPTION 'V503: hàm nhận / báo cả lô đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE public_code IN ('CFG17', 'SYS09')
               OR error_code IN ('err_cfg_share_content_empty', 'err_engine_share_interrupted')) THEN
    RAISE EXCEPTION 'V503: mã CFG17 / SYS09 đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE signal_kind = 'engine' AND pattern = 'share_interrupted') THEN
    RAISE EXCEPTION 'V503: luật share_interrupted đã có';
  END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)');
  IF v_md5 IS DISTINCT FROM '${LIVE.claim}' THEN RAISE EXCEPTION 'V503: thân aka_agent_engine_claim_target_v1 khác V501 (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)');
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN RAISE EXCEPTION 'V503: thân aka_agent_engine_report_v1 khác V501 (%)', v_md5; END IF;
END $pre$;

-- CFG17: gửi dạng chia sẻ mà nội dung rỗng và không chọn media (Desktop: "Vui lòng nhập nội dung hoặc chọn media để gửi Zalo"). Như các
-- mã cấu hình khác của engine: tạm dừng chiến dịch một lần kèm câu, data về hàng đợi (bản cũ: chờ + ghi chú).
-- SYS09: lô dừng theo chính sách khi đang gửi media; người đã nhận media chưa được chia sẻ phần chữ (Desktop: forwardError "Chiến dịch đã
-- dừng theo policy khi gửi media; chưa chia sẻ phần nội dung."). Luôn đi kèm giao một phần (đã nhận media) nên ghi "thất bại", data
-- hoàn thành, không gửi lại.
INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES
  ('engine v2', 'err_cfg_share_content_empty', 'Chưa có nội dung hoặc media để chia sẻ',
   'Cấu hình: gửi dạng chia sẻ mà nội dung rỗng và không chọn media.',
   NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'CFG17', 'content_config',
   'Vui lòng nhập nội dung hoặc chọn media để gửi Zalo', 'Nhập nội dung hoặc chọn ảnh/tệp cho chiến dịch.'),
  ('engine v2', 'err_engine_share_interrupted', 'Dừng chia sẻ sau khi gửi media',
   'Engine v2: lô gửi dạng chia sẻ dừng theo chính sách khi đang gửi media; người đã nhận media chưa được chia sẻ phần chữ.',
   NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}', true, false, 'SYS09', 'run_control',
   'Chiến dịch đã dừng theo policy khi gửi media; chưa chia sẻ phần nội dung', 'Không cần thao tác; người nhận này không được gửi lại để tránh trùng.');
INSERT INTO public.auto_outcome_policies (error_code, detail_mode, detail_status_id, log_template, quota_effect, target_streak_effect, target_effect,
  remaining_steps, lock_action_codes, run_effect, pace_mode, remember_target_days, campaign_effect, account_effect, login_effect, description, source)
SELECT 'err_cfg_share_content_empty', 'suppress', s.id, '{message}', 'no_count', 'ignore', 'requeue', 'skip', '{}'::text[], 'stop_campaign',
  'none', 0, 'pause', 'none', 'none', 'Gửi dạng chia sẻ không có nội dung lẫn media: tạm dừng chiến dịch một lần.', 'v503'
  FROM public.auto_status s WHERE s.code = 'campaign_detail_failed'
UNION ALL
SELECT 'err_engine_share_interrupted', 'write', s.id, '{message}', 'count', 'ignore', 'complete', 'skip', '{}'::text[], 'continue',
  'none', 0, 'none', 'none', 'none', 'Lô chia sẻ dừng sau khi đã gửi media: ghi thất bại, không gửi lại.', 'v503'
  FROM public.auto_status s WHERE s.code = 'campaign_detail_failed';
INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('system', NULL, NULL, 'engine', 'share_interrupted', 50, 'err_engine_share_interrupted', 'v503',
   'Lô chia sẻ dừng theo chính sách khi đang gửi media: người đã nhận media chưa được chia sẻ phần chữ.');

${c}

${r}

${claimBatch}

${reportBatch}

DO $grants$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['${CLAIM_BATCH_SIG}', '${REPORT_BATCH_SIG}'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_chat_api') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO aka_agent_chat_api', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO aka_agent_desktop', f); END IF;
  END LOOP;
END $grants$;

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.claim}' THEN RAISE EXCEPTION 'V503 postflight: claim_target_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.report}' THEN RAISE EXCEPTION 'V503 postflight: report_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${CLAIM_BATCH_SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.claimBatch}' THEN RAISE EXCEPTION 'V503 postflight: claim_batch_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${REPORT_BATCH_SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.reportBatch}' THEN RAISE EXCEPTION 'V503 postflight: report_batch_v1 %', v_md5; END IF;
  IF has_function_privilege('anon', '${CLAIM_BATCH_SIG}', 'EXECUTE') OR has_function_privilege('anon', '${REPORT_BATCH_SIG}', 'EXECUTE')
     OR has_function_privilege('authenticated', '${CLAIM_BATCH_SIG}', 'EXECUTE') OR has_function_privilege('authenticated', '${REPORT_BATCH_SIG}', 'EXECUTE') THEN
    RAISE EXCEPTION 'V503 postflight: quyền hàm mới quá rộng';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V503: trả claim_target_v1/report_v1 về thân V501, xoá hàm nhận / báo cả lô, mã CFG17/SYS09 và luật share_interrupted.
-- SINH TỪ scripts/build-v503-sql.cjs. Nơi chạy đang dùng gửi dạng chia sẻ của engine v2 phải được đưa về bản trước (hoặc tắt cờ tổ chức)
-- trước khi gỡ.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regprocedure('${REPORT_BATCH_SIG}') IS NULL THEN RAISE EXCEPTION 'Gỡ V503: chưa có V503'; END IF;
END $pre$;

DROP FUNCTION ${CLAIM_BATCH_SIG};
DROP FUNCTION ${REPORT_BATCH_SIG};
DELETE FROM public.auto_outcome_signal_rules WHERE signal_kind = 'engine' AND pattern = 'share_interrupted' AND source = 'v503';
-- Mã mới: xoá nếu chưa dòng lịch sử nào dùng, còn thì chỉ tắt (như cách gỡ mã engine của V495/V501).
DELETE FROM public.auto_outcome_policies WHERE error_code IN ('err_cfg_share_content_empty', 'err_engine_share_interrupted') AND source = 'v503';
UPDATE public.auto_error SET is_active = false WHERE error_code IN ('err_cfg_share_content_empty', 'err_engine_share_interrupted');
DELETE FROM public.auto_error e WHERE e.error_code IN ('err_cfg_share_content_empty', 'err_engine_share_interrupted')
   AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_details d WHERE d.error_code = e.error_code)
   AND NOT EXISTS (SELECT 1 FROM public.auto_engine_outcomes o WHERE o.error_code = e.error_code)
   AND NOT EXISTS (SELECT 1 FROM public.auto_account_action_status a WHERE a.disabled_error_code = e.error_code);

${claim.block}

${report.block}

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_claim_target_v1(jsonb)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.claim}' THEN RAISE EXCEPTION 'Gỡ V503 postflight: claim_target_v1 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.report}' THEN RAISE EXCEPTION 'Gỡ V503 postflight: report_v1 %', v_md5; END IF;
END $post$;

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v503_engine_share_batch.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v503_engine_share_batch.sql'), rollback)
  console.log('V503 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}
