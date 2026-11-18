#!/usr/bin/env node
// V565: engine v2 kiểm SĐT trên toàn hệ thống trước khi gọi Zalo (anh chốt 18/11/2026).
//
// "Nhắn tin theo SĐT" (zalo_message_phone): SĐT mà lịch sử của mọi tổ chức đã ghi là hỏng với một thao tác (mã lỗi bật target_check ở
// auto_outcome_policies, trong target_check_days ngày, chưa có lần thành công nào sau đó) thì bước đó không gọi Zalo: claim trả quyết định
// skip (gate target_check), lõi báo bước bị bỏ qua như mọi cổng skip (lõi 9.6.0+ và worker Fly đã có, không cần phát hành app), và
// report_v1 đổi kết quả đó thành đúng kết quả lỗi của mã đã biết (cùng chính sách, trạng thái, câu lịch sử, data đi đâu) nhưng không tính
// lượt, không đổi chuỗi data lỗi, không nghỉ giữa data, không khoá thao tác, không đổi chiến dịch / tài khoản. Khách thấy dòng tiến trình
// và lịch sử như khi Zalo trả lỗi; không có câu nào nhắc tới việc kiểm.
//
// Mã anh duyệt 18/11: Tìm SĐT × err_zalo_user_not_found (Z216; gồm 216 "không có Zalo" và 212 "tắt tìm SĐT"), Tìm SĐT ×
// err_zalo_219_find_phone_invalid (Z219), Nhắn tin người lạ × err_zalo_receiver_blocks_stranger_message (Z122); xét 365 ngày.
// Z122 chỉ bỏ bước nhắn tin; chiến dịch chỉ nhắn tin (không kết bạn, không tag Zalo, không đổi tên, không tag akaBiz) thì bỏ cả bước
// tìm SĐT (cả data). Chiến dịch kiêm SMS không kiểm (SMS đẩy theo kết quả thật của từng bước).
//
// Dữ liệu: private.auto_engine_phone_results (mỗi SĐT × thao tác một dòng: lần hỏng gần nhất, lần thành công gần nhất), nạp nền từ
// auto_campaign_details theo id (pg_cron mỗi phút, ngân sách 20 giây), kèm số đo "nếu đã bật thì bỏ qua đúng bao nhiêu" (stats) để
// anh xem trước khi bật. Bật / tắt: auto_system_settings engine.target_check (mode off | orgs | all, như engine.facebook).
//
// Hai phần: p1 chỉ thêm hai cột vào auto_outcome_policies và bật 3 dòng (bảng danh mục engine đọc mỗi lần báo kết quả: giao dịch riêng,
// vài mili giây); p2 tạo bảng / hàm / thiết lập / job và thay thân claim_target_v1 (bản V564) + report_v1 (bản V558).
// Chạy: node scripts/build-v565-sql.cjs (ghi 2 migration + 2 bản gỡ). Không sửa tay các file sinh ra.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const v558 = require('./build-v558-sql.cjs')
const v564 = require('./build-v564-sql.cjs')

const NAME_P1 = 'migration_v565_engine_target_check_p1'
const NAME_P2 = 'migration_v565_engine_target_check_p2'
const ROLLBACK_P1 = 'rollback_v565_engine_target_check_p1'
const ROLLBACK_P2 = 'rollback_v565_engine_target_check_p2'
const CLAIM_SIG = 'public.aka_agent_engine_claim_target_v1(jsonb)'
const REPORT_SIG = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'
const SETTING_KEY = 'engine.target_check'
const SETTING_VALUE = '{"mode":"off","organizationIds":[],"ingest":true,"ingestBudgetMs":20000,"ingestChunk":5000,"backfillDayBudgetMs":3000,"backfillDayHours":[8,18],"backfillThresholdIds":50000}'
const JOB = 'aka-agent-engine-phone-results'
/** md5 pg_get_functiondef trên production, đọc chỉ đọc 18/11/2026: claim = bản V564 sinh ra (03d72830…), report = bản V558 sinh ra (bb8bc00f…). */
const LIVE = { claim: v564.NEW_MD5, report: v558.NEW_MD5.report }
if (!LIVE.claim.startsWith('03d72830') || !LIVE.report.startsWith('bb8bc00f')) throw new Error('Bản claim / report của V564 / V558 không còn là bản production 18/11')
/** Ba dòng chính sách anh duyệt (error_code × action_code), xét 365 ngày. */
const RULES = [
  ['err_zalo_user_not_found', 'zalo_find_phone_user'],
  ['err_zalo_219_find_phone_invalid', 'zalo_find_phone_user'],
  ['err_zalo_receiver_blocks_stranger_message', 'zalo_message_stranger']
]
const DAYS = 365
const ROLES = ['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api']
const FUNCS = {
  config: 'private.aka_agent_engine_target_check_config()',
  on: 'private.aka_agent_engine_target_check_on(bigint)',
  rules: 'private.aka_agent_engine_target_check_rules()',
  key: 'private.aka_agent_engine_phone_key(text)',
  probe: 'private.aka_agent_engine_target_check_probe(text)',
  ingest: 'private.aka_agent_engine_phone_results_ingest(integer,integer)'
}
const TABLES = ['private.auto_engine_phone_results', 'private.auto_engine_phone_results_state']

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

const liveClaim = v564.texts.new
const liveReport = v558.texts.new.report
if (md5(liveClaim) !== LIVE.claim) throw new Error(`Thân claim của V564 không còn khớp bản đang chạy (${LIVE.claim})`)
if (md5(liveReport) !== LIVE.report) throw new Error(`Thân report của V558 không còn khớp bản đang chạy (${LIVE.report})`)

// ---- claim_target_v1 --------------------------------------------------------------------------------------------------------
let c = liveClaim
c = patch(c, `  v_shuffle_count integer;
`, `  v_shuffle_count integer;
  -- V565: kiểm SĐT trên toàn hệ thống (engine.target_check): mã lỗi đã biết của SĐT theo từng thao tác; chiến dịch chỉ nhắn tin.
  v_tc jsonb;
  v_tc_msg_only boolean := false;
`, 1, 'claim: khai báo')

c = patch(c, `  v_target_key := public.aka_agent_engine_target_key(t.phone, t.uid, t.email);
`, `  v_target_key := public.aka_agent_engine_target_key(t.phone, t.uid, t.email);
  -- V565: "Nhắn tin theo SĐT" (không kiêm SMS): SĐT đã biết là hỏng trên toàn hệ thống (bảng tóm tắt lịch sử, theo các dòng chính sách bật
  -- target_check) thì bước tương ứng nhận quyết định skip ở vòng dưới. Kiểm lỗi thì coi như chưa biết (chạy như thường).
  IF NOT v_slot_mode AND c.action_id = 'zalo_message_phone' AND nullif(btrim(coalesce(t.phone, '')), '') IS NOT NULL
     AND NOT coalesce(c.extra_settings->'internalSmsEnabled' = 'true'::jsonb, false)
     AND NOT coalesce(c.extra_settings->'externalSmsEnabled' = 'true'::jsonb, false)
     AND private.aka_agent_engine_target_check_on(c.organization_id) THEN
    BEGIN
      SELECT jsonb_object_agg(x.action_code, x.error_code) INTO v_tc FROM private.aka_agent_engine_target_check_probe(t.phone) x;
    EXCEPTION WHEN OTHERS THEN
      v_tc := NULL;
    END;
    -- Chỉ nhắn tin (không kết bạn, tag Zalo, đổi tên, tag akaBiz): mã của bước nhắn tin bỏ luôn bước tìm SĐT (cả data).
    v_tc_msg_only := coalesce(v_tc ? 'zalo_message_stranger', false)
      AND coalesce(c.extra_settings->'enableMessage' = 'true'::jsonb, false)
      AND NOT coalesce(c.extra_settings->'enableAddFriend' = 'true'::jsonb, false)
      AND NOT coalesce(c.extra_settings->'enableZaloTag' = 'true'::jsonb, false)
      AND NOT coalesce(c.extra_settings->'enableZaloAlias' = 'true'::jsonb, false)
      AND NOT coalesce(c.extra_settings->'enableAkaBizTag' = 'true'::jsonb, false);
  END IF;
`, 1, 'claim: kiểm SĐT')

c = patch(c, `    -- Thao tác không bắt buộc chỉ được bỏ qua với các cổng khai trong skippableGates (không khai = mọi cổng),
`, `    -- V565: SĐT đã biết là hỏng: bước tìm SĐT bỏ qua kể cả khi đang khoá / hết lượt (không gọi Zalo, không tính lượt); bước gửi chỉ bỏ qua
    -- khi đang được phép (đang chờ thì vẫn chờ như thường).
    IF v_tc IS NOT NULL THEN
      IF v_code = 'zalo_find_phone_user' THEN
        IF coalesce(v_tc->>v_code, CASE WHEN v_tc_msg_only THEN v_tc->>'zalo_message_stranger' END) IS NOT NULL THEN
          v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check',
            'errorCode', coalesce(v_tc->>v_code, v_tc->>'zalo_message_stranger'));
        END IF;
      ELSIF v_tc->>v_code IS NOT NULL AND NOT v_tc_msg_only AND NOT (v_tc ? 'zalo_find_phone_user')
            AND v_decision->>'decision' = 'allow' THEN
        v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc->>v_code);
      END IF;
    END IF;

    -- Thao tác không bắt buộc chỉ được bỏ qua với các cổng khai trong skippableGates (không khai = mọi cổng),
`, 1, 'claim: quyết định skip')
const NEW_CLAIM = c

// ---- report_v1 --------------------------------------------------------------------------------------------------------------
let r = liveReport
r = patch(r, `  v_detail_id bigint;
`, `  v_detail_id bigint;
  -- V565: bước bỏ qua vì SĐT đã biết là hỏng (gate target_check): mã lỗi đã biết, thao tác ghi lịch sử.
  v_tc_code text;
  v_tc_action text;
`, 1, 'report: khai báo')

r = patch(r, `      v_error_code := NULL; v_status_id := NULL; v_rule_id := NULL; v_matched_by := NULL; v_catch_all := NULL; v_err := NULL; v_detail_id := NULL;
`, `      v_error_code := NULL; v_status_id := NULL; v_rule_id := NULL; v_matched_by := NULL; v_catch_all := NULL; v_err := NULL; v_detail_id := NULL;
      -- V565: bước bỏ qua vì SĐT đã biết là hỏng: ghi như kết quả lỗi thật của mã đã biết (cùng chính sách, trạng thái, câu lịch sử, data
      -- đi đâu); hiệu ứng phụ bỏ ở dưới. Chỉ nhắn tin thì mã chặn tin người lạ ghi dưới thao tác nhắn tin (bước tìm SĐT không chạy).
      v_tc_code := NULL; v_tc_action := NULL;
      IF v_ok AND o->>'statusCode' = 'campaign_detail_skipped' AND o->'data'->>'gate' = 'target_check'
         AND EXISTS (SELECT 1 FROM public.auto_error e WHERE e.error_code = o->'data'->>'rememberedErrorCode') THEN
        v_tc_code := o->'data'->>'rememberedErrorCode';
        SELECT x.action_code INTO v_tc_action FROM private.aka_agent_engine_target_check_rules() x
         WHERE x.error_code = v_tc_code ORDER BY (x.action_code = v_action) DESC, x.action_code LIMIT 1;
        IF v_tc_action IS NOT NULL AND v_tc_action IS DISTINCT FROM v_action THEN
          v_action := v_tc_action;
          SELECT aa.flatform_type, coalesce(aa.operation_class, 'delivery'), aa.name INTO v_platform, v_op_class, v_action_name
            FROM public.auto_account_actions aa WHERE aa.code = v_action;
          -- Tên như bộ chạy gửi kèm (helper Desktop), không phải tên danh mục.
          v_action_name := CASE v_action WHEN 'zalo_message_stranger' THEN 'Nhắn tin người lạ' WHEN 'zalo_find_phone_user' THEN 'Tìm SĐT'
                                         WHEN 'zalo_add_friend' THEN 'Kết bạn' ELSE coalesce(v_action_name, v_action) END;
        END IF;
        v_ok := false;
        v_phase := 'after_send';
        v_signal := jsonb_build_object('kind', 'engine', 'code', 'target_check', 'errorCode', v_tc_code);
        v_evidence := '{}'::jsonb;
      END IF;
`, 1, 'report: đổi kết quả bỏ qua')

r = patch(r, `      SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);

      -- Trạng thái giao: chỉ thao tác loại delivery mới có thể "đã giao".
`, `      -- V565: kết quả thay cho bước bỏ qua vì SĐT đã biết là hỏng: không tính lượt, không đổi chuỗi data lỗi, không nghỉ giữa data, không khoá
      -- thao tác, không đổi chiến dịch / tài khoản / đăng nhập, lượt chạy tiếp; trạng thái, câu lịch sử, data đi đâu theo chính sách của mã.
      IF v_tc_code IS NOT NULL THEN
        v_policy := v_policy || jsonb_build_object('quota_effect', 'no_count', 'target_streak_effect', 'ignore', 'pace_mode', 'none',
          'pace_seconds', NULL, 'lock_action_codes', '[]'::jsonb, 'campaign_effect', 'none', 'account_effect', 'none', 'login_effect', 'none',
          'run_effect', 'continue');
      END IF;
      SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);

      -- Trạng thái giao: chỉ thao tác loại delivery mới có thể "đã giao".
`, 1, 'report: bỏ hiệu ứng phụ')

r = patch(r, `            jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery, 'signal', v_signal - 'trace', 'evidence', v_evidence)
              || coalesce(o->'data', '{}'::jsonb),
`, `            -- V565: dòng thay cho bước bỏ qua không ghi tín hiệu / dữ liệu của cổng (không có gì nhắc tới việc kiểm).
            CASE WHEN v_tc_code IS NOT NULL THEN jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery)
                 ELSE jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery, 'signal', v_signal - 'trace', 'evidence', v_evidence)
                        || coalesce(o->'data', '{}'::jsonb) END,
`, 1, 'report: dữ liệu dòng lịch sử')

r = patch(r, `                'policyIds', v_policy->'policy_ids', 'revisions', v_policy->'revisions', 'targetRunId', r.id)),
`, `                'policyIds', v_policy->'policy_ids', 'revisions', v_policy->'revisions', 'targetRunId', r.id)
                -- V565: dấu nội bộ để việc nạp lịch sử bỏ qua dòng này (không phải kết quả Zalo thật).
                || CASE WHEN v_tc_code IS NOT NULL THEN jsonb_build_object('targetCheck', true) ELSE '{}'::jsonb END),
`, 1, 'report: dấu nội bộ')
const NEW_REPORT = r

const NEW = { claim: md5(NEW_CLAIM), report: md5(NEW_REPORT) }

// ---- Đối tượng mới (p2) -------------------------------------------------------------------------------------------------------
const OBJECTS = `-- Bảng tóm tắt: mỗi SĐT (md5 của SĐT đã chuẩn hoá) × thao tác một dòng: lần hỏng gần nhất (mã của dòng chính sách bật / theo dõi
-- target_check) và lần thành công gần nhất của cùng thao tác. Chỉ SĐT từng hỏng mới có dòng.
CREATE TABLE private.auto_engine_phone_results (
  phone_key uuid NOT NULL,
  action_code text NOT NULL,
  bad_error_code text NOT NULL,
  bad_zalo_code text,
  bad_at timestamptz NOT NULL,
  bad_detail_id bigint NOT NULL,
  ok_at timestamptz,
  PRIMARY KEY (phone_key, action_code)
) WITH (fillfactor = 90);
COMMENT ON TABLE private.auto_engine_phone_results IS
  'V565: kết quả theo SĐT trên toàn hệ thống (md5(normalize_phone(phone))::uuid × thao tác): lần hỏng gần nhất với mã có target_check ở auto_outcome_policies (bad_zalo_code = mã Zalo gốc nếu có), lần thành công gần nhất (ok_at). Nạp nền từ auto_campaign_details (aka_agent_engine_phone_results_ingest); claim_target_v1 đọc qua aka_agent_engine_target_check_probe.';
ALTER TABLE private.auto_engine_phone_results ENABLE ROW LEVEL SECURITY;

CREATE TABLE private.auto_engine_phone_results_state (
  id integer PRIMARY KEY CHECK (id = 1),
  last_detail_id bigint NOT NULL DEFAULT 0,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  runs bigint NOT NULL DEFAULT 0,
  last_run jsonb,
  cleaned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE private.auto_engine_phone_results_state IS
  'V565: mốc nạp (id auto_campaign_details đã nạp tới) và số đo cộng dồn: "<thao tác>|all|<bad|ok|other>" = mọi kết quả đã nạp; "<thao tác>|pred|<mã hỏng trước>/<mã Zalo>|<d007|d030|d090|d365|d999>|<bad|ok|other>" = kết quả mà lúc đó SĐT đã có lần hỏng còn hiệu lực (tuổi lần hỏng), tức kết quả lẽ ra bị bỏ qua nếu đã bật. Số đo chỉ đúng ở lần nạp đầu (đặt lại mốc để nạp lại thì xoá cả bảng kết quả lẫn stats).';
ALTER TABLE private.auto_engine_phone_results_state ENABLE ROW LEVEL SECURITY;
INSERT INTO private.auto_engine_phone_results_state (id) VALUES (1);

CREATE FUNCTION private.aka_agent_engine_target_check_config()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v_raw text;
  v jsonb;
BEGIN
  SELECT s.value INTO v_raw FROM public.auto_system_settings s WHERE s.key = '${SETTING_KEY}' AND s.is_active LIMIT 1;
  IF v_raw IS NULL OR NOT pg_input_is_valid(v_raw, 'jsonb') THEN RETURN '{}'::jsonb; END IF;
  v := v_raw::jsonb;
  RETURN CASE WHEN jsonb_typeof(v) = 'object' THEN v ELSE '{}'::jsonb END;
END $function$;
COMMENT ON FUNCTION ${FUNCS.config} IS 'V565: thiết lập ${SETTING_KEY} (thiếu dòng / sai định dạng = {}).';

CREATE FUNCTION private.aka_agent_engine_target_check_on(p_organization_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF p_organization_id IS NULL THEN RETURN false; END IF;
  v := private.aka_agent_engine_target_check_config();
  IF v->>'mode' = 'all' THEN RETURN true; END IF;
  IF v->>'mode' = 'orgs' AND jsonb_typeof(v->'organizationIds') = 'array' THEN
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v->'organizationIds') e
                    WHERE jsonb_typeof(e.value) IN ('number', 'string') AND (e.value #>> '{}') = p_organization_id::text);
  END IF;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $function$;
COMMENT ON FUNCTION ${FUNCS.on} IS 'V565: tổ chức có bật kiểm SĐT trên toàn hệ thống không (${SETTING_KEY}: mode off | orgs (organizationIds) | all; thiếu / sai = không).';

CREATE FUNCTION private.aka_agent_engine_target_check_rules()
RETURNS TABLE(action_code text, error_code text, enabled boolean, days integer)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT p.action_code, p.error_code, bool_or(p.target_check_enabled), max(p.target_check_days)
    FROM public.auto_outcome_policies p
   WHERE p.target_check_enabled IS NOT NULL AND p.is_active AND NOT p.is_delete
     AND p.action_code IS NOT NULL AND p.error_code IS NOT NULL
   GROUP BY p.action_code, p.error_code
$function$;
COMMENT ON FUNCTION ${FUNCS.rules} IS 'V565: các cặp (thao tác, mã lỗi) có target_check ở auto_outcome_policies: enabled = true thì claim bỏ qua bước; false = chỉ nạp lịch sử (theo dõi), không bỏ qua. days = số ngày xét.';

CREATE FUNCTION private.aka_agent_engine_phone_key(p_phone text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT CASE WHEN n IS NULL OR n = '' THEN NULL ELSE md5(n)::uuid END FROM (SELECT public.normalize_phone(p_phone) AS n) s
$function$;
COMMENT ON FUNCTION ${FUNCS.key} IS 'V565: khoá SĐT = md5(normalize_phone(phone))::uuid (như idx_campaign_input_cooldown_phone); SĐT không có chữ số = NULL.';

CREATE FUNCTION private.aka_agent_engine_target_check_probe(p_phone text)
RETURNS TABLE(action_code text, error_code text, zalo_code text, bad_at timestamptz)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT x.action_code, x.bad_error_code, x.bad_zalo_code, x.bad_at
    FROM private.auto_engine_phone_results x
    JOIN private.aka_agent_engine_target_check_rules() rl ON rl.action_code = x.action_code AND rl.error_code = x.bad_error_code
   WHERE x.phone_key = private.aka_agent_engine_phone_key(p_phone)
     AND rl.enabled
     AND x.bad_at > clock_timestamp() - make_interval(days => rl.days)
     AND (x.ok_at IS NULL OR x.ok_at < x.bad_at)
$function$;
COMMENT ON FUNCTION ${FUNCS.probe} IS 'V565: các thao tác mà SĐT đã biết là hỏng (mã đang bật target_check, trong số ngày xét, chưa thành công lại sau đó).';

CREATE FUNCTION private.aka_agent_engine_phone_results_ingest(p_budget_ms integer DEFAULT NULL, p_chunk integer DEFAULT NULL)
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
  v_actions text[];
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
  IF NOT pg_try_advisory_xact_lock(hashtextextended('aka-agent-engine-phone-results-ingest', 0)) THEN
    RETURN jsonb_build_object('status', 'busy');
  END IF;
  v_budget := greatest(500, least(90000, coalesce(p_budget_ms,
    CASE WHEN jsonb_typeof(v_cfg->'ingestBudgetMs') = 'number' THEN (v_cfg->>'ingestBudgetMs')::numeric::integer END, 20000)));
  v_chunk := greatest(100, least(200000, coalesce(p_chunk,
    CASE WHEN jsonb_typeof(v_cfg->'ingestChunk') = 'number' THEN (v_cfg->>'ingestChunk')::numeric::integer END, 5000)));
  SELECT array_agg(DISTINCT rl.action_code), max(rl.days) INTO v_actions, v_keep FROM private.aka_agent_engine_target_check_rules() rl;
  IF v_actions IS NULL THEN RETURN jsonb_build_object('status', 'no_rules'); END IF;
  SELECT s.last_detail_id, s.stats, s.cleaned_at INTO v_from, v_stats, v_cleaned
    FROM private.auto_engine_phone_results_state s WHERE s.id = 1 FOR UPDATE;
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
    WITH rl AS MATERIALIZED (
      SELECT * FROM private.aka_agent_engine_target_check_rules()
    ), src AS MATERIALIZED (
      SELECT d.id, d.created_at, d.action_code, d.error_code,
             (d.error_code IS NULL AND (d.report_group = 'success' OR d.status = 'thành công')) AS is_ok,
             left(coalesce(nullif(d.data->'signal'->>'code', ''), nullif(d.data->'zalo'->>'code', '')), 40) AS raw_code,
             -- Như aka_agent_engine_phone_key (viết thẳng để không gọi thêm một hàm mỗi dòng).
             md5(np.n)::uuid AS phone_key
        FROM public.auto_campaign_details d
        JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id
        CROSS JOIN LATERAL (SELECT public.normalize_phone(i.phone) AS n) np
       WHERE d.id > v_from AND d.id <= v_to
         AND d.action_code = ANY (v_actions)
         AND i.phone IS NOT NULL AND btrim(i.phone) <> '' AND np.n IS NOT NULL AND np.n <> ''
         -- Dòng do chính việc kiểm ghi (bước bỏ qua) không phải kết quả Zalo thật.
         AND NOT coalesce(d.policy_snapshot->'v2'->'targetCheck' = 'true'::jsonb, false)
    ), rws AS MATERIALIZED (
      SELECT s.*, (rl.error_code IS NOT NULL) AS is_bad
        FROM src s LEFT JOIN rl ON rl.action_code = s.action_code AND rl.error_code = s.error_code
    ), agg AS MATERIALIZED (
      SELECT w.phone_key, w.action_code, max(w.id) FILTER (WHERE w.is_bad) AS bad_id, max(w.created_at) FILTER (WHERE w.is_ok) AS ok_at
        FROM rws w GROUP BY w.phone_key, w.action_code
    ), win AS MATERIALIZED (
      SELECT w.id, w.phone_key, w.action_code, w.created_at, w.is_bad, w.is_ok,
             max(w.id) FILTER (WHERE w.is_bad) OVER pw AS prev_bad_id,
             max(w.created_at) FILTER (WHERE w.is_ok) OVER pw AS prev_ok_at
        FROM rws w
      WINDOW pw AS (PARTITION BY w.phone_key, w.action_code ORDER BY w.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
    ), ev AS MATERIALIZED (
      -- Trạng thái của SĐT ngay trước kết quả này: lần hỏng trước (trong phần đang nạp, không thì trong bảng) và lần thành công trước.
      SELECT w.action_code, w.created_at,
             CASE WHEN w.is_bad THEN 'bad' WHEN w.is_ok THEN 'ok' ELSE 'other' END AS outcome,
             CASE WHEN pb.id IS NOT NULL THEN pb.created_at ELSE x.bad_at END AS prior_bad_at,
             CASE WHEN pb.id IS NOT NULL THEN pb.error_code ELSE x.bad_error_code END AS prior_code,
             CASE WHEN pb.id IS NOT NULL THEN pb.raw_code ELSE x.bad_zalo_code END AS prior_raw,
             greatest(x.ok_at, w.prev_ok_at) AS prior_ok_at
        FROM win w
        LEFT JOIN rws pb ON pb.id = w.prev_bad_id
        LEFT JOIN private.auto_engine_phone_results x ON x.phone_key = w.phone_key AND x.action_code = w.action_code
    ), st AS (
      SELECT jsonb_object_agg(z.k, z.n) AS j FROM (
        SELECT e.action_code || '|all|' || e.outcome AS k, count(*) AS n FROM ev e GROUP BY 1
        UNION ALL
        SELECT e.action_code || '|pred|' || coalesce(e.prior_code, '?') || '/' || coalesce(e.prior_raw, '-') || '|'
                 || CASE WHEN e.created_at - e.prior_bad_at < interval '7 days' THEN 'd007'
                         WHEN e.created_at - e.prior_bad_at < interval '30 days' THEN 'd030'
                         WHEN e.created_at - e.prior_bad_at < interval '90 days' THEN 'd090'
                         WHEN e.created_at - e.prior_bad_at < interval '365 days' THEN 'd365' ELSE 'd999' END
                 || '|' || e.outcome, count(*)
          FROM ev e
         WHERE e.prior_bad_at IS NOT NULL AND e.prior_bad_at < e.created_at AND (e.prior_ok_at IS NULL OR e.prior_ok_at < e.prior_bad_at)
         GROUP BY 1
      ) z
    ), ins AS (
      INSERT INTO private.auto_engine_phone_results AS x (phone_key, action_code, bad_error_code, bad_zalo_code, bad_at, bad_detail_id, ok_at)
      SELECT a.phone_key, a.action_code, b.error_code, b.raw_code, b.created_at, b.id, a.ok_at
        FROM agg a JOIN rws b ON b.id = a.bad_id
      ON CONFLICT (phone_key, action_code) DO UPDATE SET
        bad_error_code = CASE WHEN EXCLUDED.bad_detail_id >= x.bad_detail_id THEN EXCLUDED.bad_error_code ELSE x.bad_error_code END,
        bad_zalo_code = CASE WHEN EXCLUDED.bad_detail_id >= x.bad_detail_id THEN EXCLUDED.bad_zalo_code ELSE x.bad_zalo_code END,
        bad_at = CASE WHEN EXCLUDED.bad_detail_id >= x.bad_detail_id THEN EXCLUDED.bad_at ELSE x.bad_at END,
        bad_detail_id = greatest(EXCLUDED.bad_detail_id, x.bad_detail_id),
        ok_at = greatest(x.ok_at, EXCLUDED.ok_at)
      RETURNING 1
    ), upd AS (
      UPDATE private.auto_engine_phone_results x SET ok_at = a.ok_at
        FROM agg a
       WHERE a.bad_id IS NULL AND a.ok_at IS NOT NULL
         AND x.phone_key = a.phone_key AND x.action_code = a.action_code AND (x.ok_at IS NULL OR x.ok_at < a.ok_at)
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM rws), (SELECT count(*) FROM ins), (SELECT count(*) FROM upd), (SELECT st.j FROM st)
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

  -- Mỗi ngày một lần: bỏ lần hỏng đã quá số ngày xét lớn nhất (+1 ngày).
  IF v_cleaned IS NULL OR v_cleaned < v_started - interval '1 day' THEN
    DELETE FROM private.auto_engine_phone_results x WHERE x.bad_at < v_started - make_interval(days => coalesce(v_keep, 365) + 1);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_cleaned := v_started;
  END IF;

  UPDATE private.auto_engine_phone_results_state s SET last_detail_id = v_from, stats = coalesce(v_stats, '{}'::jsonb), runs = s.runs + 1,
         cleaned_at = v_cleaned, updated_at = clock_timestamp(),
         last_run = jsonb_build_object('at', v_started, 'from', v_start, 'to', v_from, 'cap', v_cap, 'budgetMs', v_budget, 'throttled', v_throttled,
           'chunks', v_chunks, 'rows', v_rows,
           'badUpserts', v_bad, 'okUpdates', v_ok, 'deleted', v_deleted,
           'ms', round(extract(epoch FROM clock_timestamp() - v_started) * 1000))
   WHERE s.id = 1;
  RETURN jsonb_build_object('status', 'ok', 'from', v_start, 'to', v_from, 'cap', v_cap, 'budgetMs', v_budget, 'throttled', v_throttled,
    'chunks', v_chunks, 'rows', v_rows,
    'badUpserts', v_bad, 'okUpdates', v_ok, 'deleted', v_deleted, 'caughtUp', v_from >= v_cap);
END $function$;
COMMENT ON FUNCTION ${FUNCS.ingest} IS
  'V565: nạp auto_campaign_details (theo id, từ mốc ở auto_engine_phone_results_state) vào auto_engine_phone_results và số đo. pg_cron ${JOB} gọi mỗi phút với ngân sách ${SETTING_KEY}.ingestBudgetMs (mặc định 20 giây, ingestChunk id mỗi phần, mặc định 5.000); còn tồn hơn backfillThresholdIds id (nạp lần đầu) trong backfillDayHours giờ VN (mặc định 8–18h) thì chỉ backfillDayBudgetMs (mặc định 3 giây). Gọi tay với p_budget_ms để nạp bù (không giới hạn theo giờ).';

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('${SETTING_KEY}', '${SETTING_VALUE}',
   'Kiểm SĐT trên toàn hệ thống trước khi gọi Zalo (V565), chỉ engine v2, chiến dịch "Nhắn tin theo SĐT" không kiêm SMS. JSON: mode off | orgs (chỉ organizationIds) | all; thiếu dòng / sai định dạng = off. Mã nào kiểm: cột target_check_enabled / target_check_days của auto_outcome_policies. ingest = false: job ngừng nạp lịch sử (claim vẫn đọc bảng đã nạp nếu mode bật). ingestBudgetMs / ingestChunk: ngân sách mỗi phút và số id mỗi phần nạp; backfillDayBudgetMs / backfillDayHours [giờ bắt đầu, giờ kết thúc) VN / backfillThresholdIds: ngân sách ban ngày khi còn tồn nhiều (nạp lần đầu). Claim đọc lại mỗi lần nhận data nên đổi có hiệu lực ngay.',
   false, true);

DO $grants$
DECLARE v_role text; v_obj text;
BEGIN
  FOREACH v_obj IN ARRAY ARRAY[${TABLES.map(t => `'${t}'`).join(', ')}] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', v_obj);
  END LOOP;
  FOREACH v_obj IN ARRAY ARRAY[${Object.values(FUNCS).map(f => `'${f}'`).join(', ')}] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_obj);
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY[${ROLES.map(x => `'${x}'`).join(', ')}] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      FOREACH v_obj IN ARRAY ARRAY[${TABLES.map(t => `'${t}'`).join(', ')}] LOOP
        EXECUTE format('REVOKE ALL ON TABLE %s FROM %I', v_obj, v_role);
      END LOOP;
      FOREACH v_obj IN ARRAY ARRAY[${Object.values(FUNCS).map(f => `'${f}'`).join(', ')}] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_obj, v_role);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;`

// ---- p1 -----------------------------------------------------------------------------------------------------------------------
const RULE_TUPLES = RULES.map(([e, a]) => `('${e}', '${a}')`).join(', ')
const migrationP1 = `-- V565 phần 1: cột kiểm SĐT trên toàn hệ thống ở auto_outcome_policies. SINH TỪ scripts/build-v565-sql.cjs, không sửa tay.
-- Thêm target_check_enabled (NULL = không phải mã kiểm; false = chỉ nạp lịch sử để theo dõi; true = engine bỏ qua bước khi SĐT đã biết
-- hỏng) và target_check_days (số ngày xét, 1–3650), rồi bật 3 dòng anh duyệt 18/11/2026 (365 ngày):
--   ${RULES.map(([e, a]) => `${a} × ${e}`).join('\n--   ')}
-- Chưa có tác dụng tới khi apply phần 2 và bật engine.target_check. Bảng danh mục engine đọc mỗi lần báo kết quả: giao dịch riêng, vài
-- mili giây; DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: ${ROLLBACK_P1}.sql (sau khi gỡ phần 2).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v565_%') THEN
      RAISE EXCEPTION 'V565 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass
              AND attname IN ('target_check_enabled', 'target_check_days') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V565 p1: cột target_check đã có';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies p
   WHERE p.is_active AND NOT p.is_delete AND p.status_id IS NULL AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL
     AND (p.error_code, p.action_code) IN (${RULE_TUPLES});
  IF v_n <> ${RULES.length} THEN RAISE EXCEPTION 'V565 p1: cần đúng ${RULES.length} dòng chính sách (mã × thao tác), thấy %', v_n; END IF;
END $pre$;

ALTER TABLE public.auto_outcome_policies
  ADD COLUMN target_check_enabled boolean,
  ADD COLUMN target_check_days integer,
  ADD CONSTRAINT auto_outcome_policies_target_check_v565 CHECK (
    (target_check_enabled IS NULL AND target_check_days IS NULL)
    OR (target_check_enabled IS NOT NULL AND target_check_days IS NOT NULL AND target_check_days BETWEEN 1 AND 3650
        AND error_code IS NOT NULL AND action_code IS NOT NULL AND status_id IS NULL AND campaign_action_id IS NULL AND runtime_target IS NULL));
COMMENT ON COLUMN public.auto_outcome_policies.target_check_enabled IS
  'V565: kiểm SĐT trên toàn hệ thống cho (error_code × action_code) của dòng này. NULL = không kiểm, không nạp; false = chỉ nạp lịch sử (theo dõi, xem số đo); true = engine v2 bỏ qua bước khi SĐT đã hỏng với mã này trong target_check_days ngày và chưa thành công lại (thêm mã mới thì đặt lại mốc nạp để nạp lịch sử cũ). Bật cả hệ thống: auto_system_settings engine.target_check.';
COMMENT ON COLUMN public.auto_outcome_policies.target_check_days IS
  'V565: số ngày xét lần hỏng của SĐT (1–3650); bắt buộc khi target_check_enabled khác NULL.';

DO $set$
DECLARE v_n integer;
BEGIN
  UPDATE public.auto_outcome_policies p SET target_check_enabled = true, target_check_days = ${DAYS}
   WHERE p.is_active AND NOT p.is_delete AND p.status_id IS NULL AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL
     AND (p.error_code, p.action_code) IN (${RULE_TUPLES});
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> ${RULES.length} THEN RAISE EXCEPTION 'V565 p1: bật được % dòng, cần ${RULES.length}', v_n; END IF;
END $set$;

COMMIT;
`

const rollbackP1 = `-- Gỡ V565 phần 1: bỏ hai cột target_check của auto_outcome_policies. SINH TỪ scripts/build-v565-sql.cjs.
-- Gỡ phần 2 trước (${ROLLBACK_P2}.sql): claim / report / hàm nạp đọc hai cột này.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regprocedure('${FUNCS.rules}') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V565 p1: gỡ phần 2 trước (${ROLLBACK_P2}.sql)'; END IF;
END $pre$;

ALTER TABLE public.auto_outcome_policies
  DROP CONSTRAINT IF EXISTS auto_outcome_policies_target_check_v565,
  DROP COLUMN IF EXISTS target_check_enabled,
  DROP COLUMN IF EXISTS target_check_days;

COMMIT;
`

// ---- p2 -----------------------------------------------------------------------------------------------------------------------
const capture = (label, expect, done, msgDone, msgDrift) => `  v_oid := to_regprocedure('${label === 'claim' ? CLAIM_SIG : REPORT_SIG}');
  IF v_oid IS NULL THEN RAISE EXCEPTION '%: không có ${label === 'claim' ? CLAIM_SIG : REPORT_SIG}', v_label; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '${done}' THEN RAISE EXCEPTION '${msgDone}'; END IF;
  IF v_md5 IS DISTINCT FROM '${expect}' THEN RAISE EXCEPTION '${msgDrift} (${label}: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.v565_acl_${label}', v_acl, true);`
const verify = (label, expect, what) => `  v_oid := '${label === 'claim' ? CLAIM_SIG : REPORT_SIG}'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${expect}' THEN
    RAISE EXCEPTION '${what} postflight: định nghĩa ${label} %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v565_acl_${label}', true) THEN RAISE EXCEPTION '${what} postflight: quyền / chủ sở hữu ${label} bị đổi'; END IF;`

const migrationP2 = `-- V565 phần 2: kiểm SĐT trên toàn hệ thống trước khi gọi Zalo (engine v2, "Nhắn tin theo SĐT"). SINH TỪ scripts/build-v565-sql.cjs, không sửa tay.
-- Cần phần 1. Tạo private.auto_engine_phone_results (+ _state), 6 hàm private, thiết lập ${SETTING_KEY} (mode off: chưa bỏ qua gì), job
-- pg_cron ${JOB} (mỗi phút, nạp lịch sử 20 giây), rồi thay thân aka_agent_engine_claim_target_v1 (bản V564) và aka_agent_engine_report_v1
-- (bản V558), giữ chữ ký / chủ sở hữu / quyền. Khi mode off, claim và report trả đúng như trước (chỉ thêm một lần đọc thiết lập mỗi lần nhận
-- data "Nhắn tin theo SĐT").
-- Nguồn = pg_get_functiondef production 18/11/2026: claim ${LIVE.claim}, report ${LIVE.report}. Bản mới: claim ${NEW.claim}, report ${NEW.report}.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Lần nạp đầu đọc cả auto_campaign_details (~15 triệu dòng) trong vài chục
-- phút (20 giây mỗi phút). Gỡ: ${ROLLBACK_P2}.sql rồi ${ROLLBACK_P1}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text; v_label text := 'V565 p2';
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '${NAME_P2}') THEN
      RAISE EXCEPTION 'V565 p2 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass
                  AND attname = 'target_check_enabled' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V565 p2: cần p1 (${NAME_P1}.sql) trước';
  END IF;
  IF to_regclass('private.auto_engine_phone_results') IS NOT NULL OR to_regprocedure('${FUNCS.ingest}') IS NOT NULL THEN
    RAISE EXCEPTION 'V565 p2: bảng / hàm kiểm SĐT đã có';
  END IF;
  IF to_regprocedure('public.normalize_phone(text)') IS NULL THEN RAISE EXCEPTION 'V565 p2: thiếu public.normalize_phone(text)'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = '${SETTING_KEY}') THEN RAISE EXCEPTION 'V565 p2: thiết lập ${SETTING_KEY} đã có'; END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${JOB}') THEN RAISE EXCEPTION 'V565 p2: job ${JOB} đã có'; END IF;
  END IF;
${capture('claim', LIVE.claim, NEW.claim, 'V565 đã chạy (claim)', 'V565: định nghĩa claim khác bản production 18/11 (V564), dừng để đối chiếu bản live')}
${capture('report', LIVE.report, NEW.report, 'V565 đã chạy (report)', 'V565: định nghĩa report khác bản production 18/11 (V558), dừng để đối chiếu bản live')}
END $pre$;

${OBJECTS}

${NEW_CLAIM};

${NEW_REPORT};

DO $cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('${JOB}', '* * * * *', 'SELECT private.aka_agent_engine_phone_results_ingest()');
  END IF;
END $cron$;

DO $post$
DECLARE v_oid oid; v_acl text; v_role text; v_obj text;
BEGIN
${verify('claim', NEW.claim, 'V565')}
${verify('report', NEW.report, 'V565')}
  FOREACH v_obj IN ARRAY ARRAY[${TABLES.map(t => `'${t}'`).join(', ')}] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_obj::regclass) THEN RAISE EXCEPTION 'V565 postflight: % chưa bật RLS', v_obj; END IF;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY[${ROLES.map(x => `'${x}'`).join(', ')}] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      FOREACH v_obj IN ARRAY ARRAY[${TABLES.map(t => `'${t}'`).join(', ')}] LOOP
        IF has_table_privilege(v_role, v_obj, 'SELECT') OR has_table_privilege(v_role, v_obj, 'INSERT') OR has_table_privilege(v_role, v_obj, 'UPDATE')
           OR has_table_privilege(v_role, v_obj, 'DELETE') THEN RAISE EXCEPTION 'V565 postflight: % có quyền trên %', v_role, v_obj; END IF;
      END LOOP;
      FOREACH v_obj IN ARRAY ARRAY[${Object.values(FUNCS).map(f => `'${f}'`).join(', ')}] LOOP
        IF has_function_privilege(v_role, v_obj, 'EXECUTE') THEN RAISE EXCEPTION 'V565 postflight: % chạy được %', v_role, v_obj; END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF private.aka_agent_engine_target_check_on(1) THEN RAISE EXCEPTION 'V565 postflight: thiết lập phải ở mode off'; END IF;
  IF (SELECT count(*) FROM private.aka_agent_engine_target_check_rules() WHERE enabled) <> ${RULES.length} THEN
    RAISE EXCEPTION 'V565 postflight: cần ${RULES.length} cặp mã đang bật';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${JOB}') THEN RAISE EXCEPTION 'V565 postflight: chưa có job ${JOB}'; END IF;
  END IF;
END $post$;

COMMIT;
`

const rollbackP2 = `-- Gỡ V565 phần 2: trả claim_target_v1 về bản V564 và report_v1 về bản V558, bỏ job, thiết lập, hàm và bảng kiểm SĐT (mất bảng đã nạp).
-- SINH TỪ scripts/build-v565-sql.cjs. Data đang chạy không bị ảnh hưởng (lõi chỉ thấy quyết định skip khi mode bật). Sau đó có thể gỡ
-- phần 1 (${ROLLBACK_P1}.sql).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text; v_label text := 'Gỡ V565 p2';
BEGIN
${capture('claim', NEW.claim, LIVE.claim, 'Gỡ V565: claim đã là bản trước V565', 'Gỡ V565: định nghĩa claim không phải bản V565')}
${capture('report', NEW.report, LIVE.report, 'Gỡ V565: report đã là bản trước V565', 'Gỡ V565: định nghĩa report không phải bản V565')}
END $pre$;

${liveClaim};

${liveReport};

DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = '${JOB}';
  END IF;
END $cron$;

DELETE FROM public.auto_system_settings WHERE key = '${SETTING_KEY}';
DROP FUNCTION ${FUNCS.ingest};
DROP FUNCTION ${FUNCS.probe};
DROP FUNCTION ${FUNCS.key};
DROP FUNCTION ${FUNCS.rules};
DROP FUNCTION ${FUNCS.on};
DROP FUNCTION ${FUNCS.config};
DROP TABLE private.auto_engine_phone_results_state;
DROP TABLE private.auto_engine_phone_results;

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
${verify('claim', LIVE.claim, 'Gỡ V565')}
${verify('report', LIVE.report, 'Gỡ V565')}
END $post$;

COMMIT;
`

module.exports = {
  migrationP1, migrationP2, rollbackP1, rollbackP2, NAME_P1, NAME_P2, ROLLBACK_P1, ROLLBACK_P2,
  LIVE, NEW, SETTING_KEY, SETTING_VALUE, JOB, RULES, DAYS, FUNCS, TABLES, CLAIM_SIG, REPORT_SIG,
  texts: { live: { claim: liveClaim, report: liveReport }, new: { claim: NEW_CLAIM, report: NEW_REPORT } }
}
if (require.main === module) {
  const files = { [NAME_P1]: migrationP1, [NAME_P2]: migrationP2, [ROLLBACK_P1]: rollbackP1, [ROLLBACK_P2]: rollbackP2 }
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(ROOT, `migrations/${name}.sql`), text)
    console.log(name, md5(text))
  }
  console.log('claim', LIVE.claim, '->', NEW.claim, '| report', LIVE.report, '->', NEW.report)
}
