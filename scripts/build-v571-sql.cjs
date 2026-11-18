#!/usr/bin/env node
// V571: engine v2 kiểm người nhận trên toàn hệ thống trước khi gọi Zalo (anh chốt 18/11/2026, thiết kế mở rộng duyệt cùng ngày).
//
// Người nhận (SĐT và / hoặc global id Zalo) mà lịch sử của mọi tổ chức đã ghi là hỏng với một thao tác (mã bật target_check ở
// auto_outcome_policies, trong target_check_days ngày, chưa thành công lại) thì bước đó không gọi Zalo: claim trả quyết định skip
// (gate target_check, lõi 9.6.0+ / worker Fly đã xử lý, không cần phát hành app), report_v1 đổi kết quả đó thành đúng kết quả lỗi của mã đã
// biết (cùng chính sách, trạng thái, câu lịch sử, data đi đâu) nhưng không tính lượt, không đổi chuỗi data lỗi, không nghỉ, không khoá,
// không đổi chiến dịch / tài khoản. Khách thấy dòng tiến trình và lịch sử như khi Zalo trả lỗi; không câu nào nhắc tới việc kiểm.
//
// Loại chiến dịch: "Nhắn tin theo SĐT" (khoá SĐT; có UID cũ thì thêm global id) và chiến dịch nhắn người lạ theo UID (thành viên nhóm,
// group thời gian thực, đề xuất Zalo, khách hàng cũ; UID gắn theo tài khoản nên lấy global id + cờ bạn bè ở zalo_users theo (tài khoản,
// UID)). Chiến dịch kiêm SMS không kiểm. Mã anh duyệt: Tìm SĐT × Z216 (216, 212), Tìm SĐT × Z219, Nhắn tin người lạ × Z122; 365 ngày.
// Z122 không áp khi tài khoản gửi đã là bạn bè (zalo_users.is_fr). Mọi bước gửi của chiến dịch theo SĐT đã biết hỏng và không tag Zalo /
// đổi tên / tag akaBiz thì bỏ luôn bước tìm SĐT (report tách thành một dòng cho mỗi bước gửi).
//
// Kiểm từng data lúc nhận, không theo lô (anh hỏi 18/11): sổ đã gộp sẵn lịch sử theo người nhận nên mỗi lần kiểm là một lần đọc khoá
// chính; gom lô không rẻ hơn, phải lưu kết quả lô tới lúc chạy tới data (bảng / cột mới), kết quả lô cũ đi trong lúc chờ, và cỡ lô theo
// hạn mức từng thao tác đổi liên tục. Tra thẳng lịch sử theo lô thì quá chậm (đo 12/11: lô 500 SĐT 43,9 giây). Chi tiết:
// docs/ENGINE_V2_TARGET_CHECK_V571.md mục "Vì sao không kiểm theo lô".
//
// Dữ liệu: private.auto_engine_receiver_results (khoá người nhận md5('p:'||SĐT chuẩn hoá) / md5('g:'||global id) × thao tác × mã: lần hỏng
// gần nhất, lần thành công gần nhất), nạp nền từ auto_campaign_details (pg_cron mỗi phút) cho mọi mã "thuộc về người nhận" của Tìm SĐT /
// Nhắn tin người lạ / Kết bạn (bật mã mới sau này có hiệu lực ngay), kèm số đo bỏ đúng / nhầm. Bật / tắt: engine.target_check.
//
// Hai phần: p1 chỉ thêm hai cột vào auto_outcome_policies và bật 3 dòng (giao dịch riêng, vài mili giây); p2 tạo bảng / hàm / thiết lập /
// job và thay thân claim_target_v1 (bản V564) + report_v1 (bản V558). Chạy: node scripts/build-v571-sql.cjs. Không sửa tay file sinh ra.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const v558 = require('./build-v558-sql.cjs')
const v564 = require('./build-v564-sql.cjs')

const NAME_P1 = 'migration_v571_engine_target_check_p1'
const NAME_P2 = 'migration_v571_engine_target_check_p2'
const ROLLBACK_P1 = 'rollback_v571_engine_target_check_p1'
const ROLLBACK_P2 = 'rollback_v571_engine_target_check_p2'
const CLAIM_SIG = 'public.aka_agent_engine_claim_target_v1(jsonb)'
const REPORT_SIG = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'
const SETTING_KEY = 'engine.target_check'
const SETTING_VALUE = '{"mode":"off","organizationIds":[],"ingest":true,"ingestBudgetMs":40000,"ingestChunk":5000,"backfillDayBudgetMs":3000,"backfillDayHours":[8,18],"backfillThresholdIds":50000}'
const JOB = 'aka-agent-engine-receiver-results'
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
/** Thao tác nạp vào sổ (người nhận là một người). */
const TRACK_ACTIONS = ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend']
/**
 * Mã "thuộc về người nhận" được theo dõi sẵn (dù chưa bật): mã Zalo nhóm target_permanent của auto_error, trừ mã chung / mơ hồ (lỗi Zalo
 * chung, tham số sai, kết bạn không thành công chung) và mã do engine / cấu hình đặt ra. Mã có dòng target_check ở bảng chính sách luôn được
 * theo dõi.
 */
const TRACK_EXCLUDE = ['err_zalo_api_business_failed', 'err_zalo_invalid_param', 'err_zalo_add_friend_failed']
/** Chiến dịch được kiểm (engine v2). */
const CAMPAIGN_TYPES = ['zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_friend_recommendation',
  'zalo_message_remarketing_customer']
const ROLES = ['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api']
const FUNCS = {
  config: 'private.aka_agent_engine_target_check_config()',
  on: 'private.aka_agent_engine_target_check_on(bigint)',
  rules: 'private.aka_agent_engine_target_check_rules()',
  tracked: 'private.aka_agent_engine_target_check_tracked()',
  key: 'private.aka_agent_engine_receiver_key(text,text)',
  probe: 'private.aka_agent_engine_target_check_probe(text,text)',
  ingest: 'private.aka_agent_engine_receiver_results_ingest(integer,integer)'
}
const TABLES = ['private.auto_engine_receiver_results', 'private.auto_engine_receiver_results_state']
const sqlList = items => items.map(x => `'${x}'`).join(', ')

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
  -- V571: kiểm người nhận trên toàn hệ thống (engine.target_check).
  v_tc jsonb;                       -- {thao tác: mã} người nhận đã biết hỏng (mã đang bật, còn hiệu lực)
  v_tc_global text;                 -- global id của người nhận (zalo_users theo tài khoản + UID)
  v_tc_friend boolean := false;     -- tài khoản gửi đã là bạn bè (zalo_users.is_fr)
  v_tc_sends jsonb;                 -- mọi bước gửi đã biết hỏng: {thao tác gửi: mã}, bỏ luôn bước tìm SĐT
`, 1, 'claim: khai báo')

c = patch(c, `  v_target_key := public.aka_agent_engine_target_key(t.phone, t.uid, t.email);
`, `  v_target_key := public.aka_agent_engine_target_key(t.phone, t.uid, t.email);
  -- V571: chiến dịch nhắn người lạ (theo SĐT / theo UID), không kiêm SMS, tổ chức bật engine.target_check: tra sổ theo SĐT và global id
  -- (UID gắn theo tài khoản nên lấy global id ở zalo_users). Bước tương ứng nhận quyết định skip ở vòng dưới. Kiểm lỗi thì coi như chưa
  -- biết (chạy như thường).
  IF NOT v_slot_mode AND c.action_id IN (${sqlList(CAMPAIGN_TYPES)})
     AND NOT coalesce(c.extra_settings->'internalSmsEnabled' = 'true'::jsonb, false)
     AND NOT coalesce(c.extra_settings->'externalSmsEnabled' = 'true'::jsonb, false)
     AND private.aka_agent_engine_target_check_on(c.organization_id) THEN
    BEGIN
      IF nullif(btrim(coalesce(t.uid, '')), '') IS NOT NULL THEN
        SELECT nullif(btrim(coalesce(zu.global_id, '')), ''), coalesce(zu.is_fr = 1, false) INTO v_tc_global, v_tc_friend
          FROM public.zalo_users zu WHERE zu.account_id = v_account_id AND zu.zalo_uid = btrim(t.uid) LIMIT 1;
        v_tc_friend := coalesce(v_tc_friend, false);
      END IF;
      SELECT jsonb_object_agg(x.action_code, x.error_code) INTO v_tc FROM private.aka_agent_engine_target_check_probe(t.phone, v_tc_global) x;
    EXCEPTION WHEN OTHERS THEN
      v_tc := NULL;
    END;
    -- Chặn tin người lạ không áp với tài khoản đã là bạn bè.
    IF v_tc IS NOT NULL AND v_tc_friend THEN v_tc := v_tc - 'zalo_message_stranger'; END IF;
    IF v_tc = '{}'::jsonb THEN v_tc := NULL; END IF;
    -- "Nhắn tin theo SĐT": mọi bước gửi của chiến dịch đã biết hỏng và không tag Zalo / đổi tên / tag akaBiz (các bước cần kết quả tìm SĐT)
    -- thì bỏ luôn bước tìm SĐT; report tách thành một dòng cho mỗi bước gửi.
    IF v_tc IS NOT NULL AND c.action_id = 'zalo_message_phone' AND NOT (v_tc ? 'zalo_find_phone_user')
       AND NOT coalesce(c.extra_settings->'enableZaloTag' = 'true'::jsonb, false)
       AND NOT coalesce(c.extra_settings->'enableZaloAlias' = 'true'::jsonb, false)
       AND NOT coalesce(c.extra_settings->'enableAkaBizTag' = 'true'::jsonb, false) THEN
      -- (Bí danh "ja": "a" là biến bản ghi tài khoản của hàm.)
      SELECT CASE WHEN count(*) > 0 AND bool_and(v_tc ? (ja.value->>'code')) THEN jsonb_object_agg(ja.value->>'code', v_tc->(ja.value->>'code')) END
        INTO v_tc_sends
        FROM jsonb_array_elements(coalesce(p_ctx->'actions', '[]'::jsonb)) ja WHERE ja.value->>'code' <> 'zalo_find_phone_user';
    END IF;
  END IF;
`, 1, 'claim: kiểm người nhận')

c = patch(c, `    -- Thao tác không bắt buộc chỉ được bỏ qua với các cổng khai trong skippableGates (không khai = mọi cổng),
`, `    -- V571: người nhận đã biết hỏng: bước tìm SĐT bỏ qua kể cả khi đang khoá / hết lượt (không gọi Zalo, không tính lượt); bước gửi chỉ bỏ
    -- qua khi đang được phép (đang chờ thì vẫn chờ như thường) và khi bước tìm SĐT không bị bỏ.
    IF v_tc IS NOT NULL THEN
      IF v_code = 'zalo_find_phone_user' THEN
        IF v_tc ? v_code THEN
          v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc->>v_code);
        ELSIF v_tc_sends IS NOT NULL THEN
          v_decision := jsonb_build_object('decision', 'skip', 'gate', 'target_check', 'errorCode', v_tc_sends::text);
        END IF;
      ELSIF v_tc ? v_code AND v_tc_sends IS NULL AND NOT (c.action_id = 'zalo_message_phone' AND v_tc ? 'zalo_find_phone_user')
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
  -- V571: bước bỏ qua vì người nhận đã biết hỏng (gate target_check): mã lỗi đã biết.
  v_tc_code text;
`, 1, 'report: khai báo')

r = patch(r, `  IF (SELECT count(DISTINCT btrim(x.value->>'resultKey')) FROM jsonb_array_elements(p_outcomes) x) <> jsonb_array_length(p_outcomes) THEN
`, `  -- V571: bước tìm SĐT bỏ qua vì mọi bước gửi đã biết hỏng (rememberedErrorCode là JSON {thao tác gửi: mã}): tách thành một kết quả cho mỗi
  -- bước gửi (resultKey đầu giữ nguyên, kết quả sau thêm ':<thao tác>'), như khi các bước đó chạy và Zalo trả lỗi. Gọi lại thì tách y hệt.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_outcomes) x WHERE x.value->>'statusCode' = 'campaign_detail_skipped'
              AND x.value->'data'->>'gate' = 'target_check' AND left(coalesce(x.value->'data'->>'rememberedErrorCode', ''), 1) = '{') THEN
    SELECT jsonb_agg(z.e ORDER BY z.ord, z.sub) INTO p_outcomes FROM (
      SELECT x.ordinality AS ord, 0::bigint AS sub, x.value AS e FROM jsonb_array_elements(p_outcomes) WITH ORDINALITY x
       WHERE NOT (x.value->>'statusCode' = 'campaign_detail_skipped' AND x.value->'data'->>'gate' = 'target_check'
                  AND left(coalesce(x.value->'data'->>'rememberedErrorCode', ''), 1) = '{')
      UNION ALL
      SELECT x.ordinality, k.n, x.value || jsonb_build_object(
               'actionCode', k.key,
               'actionName', CASE k.key WHEN 'zalo_message_stranger' THEN 'Nhắn tin người lạ' WHEN 'zalo_add_friend' THEN 'Kết bạn' ELSE k.key END,
               'stepKey', k.key,
               'resultKey', btrim(x.value->>'resultKey') || CASE WHEN k.n = 1 THEN '' ELSE ':' || k.key END,
               'data', jsonb_build_object('gate', 'target_check', 'rememberedErrorCode', k.code))
        FROM jsonb_array_elements(p_outcomes) WITH ORDINALITY x
        CROSS JOIN LATERAL (
          SELECT e.key, e.value #>> '{}' AS code,
                 row_number() OVER (ORDER BY CASE e.key WHEN 'zalo_message_stranger' THEN 1 WHEN 'zalo_add_friend' THEN 2 ELSE 3 END, e.key) AS n
            FROM jsonb_each(CASE WHEN pg_input_is_valid(x.value->'data'->>'rememberedErrorCode', 'jsonb')
                                  AND jsonb_typeof((x.value->'data'->>'rememberedErrorCode')::jsonb) = 'object'
                                 THEN (x.value->'data'->>'rememberedErrorCode')::jsonb ELSE '{}'::jsonb END) e) k
       WHERE x.value->>'statusCode' = 'campaign_detail_skipped' AND x.value->'data'->>'gate' = 'target_check'
         AND left(coalesce(x.value->'data'->>'rememberedErrorCode', ''), 1) = '{'
    ) z;
    IF p_outcomes IS NULL OR (jsonb_array_length(p_outcomes) = 0 AND NOT p_final) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'outcomes_required');
    END IF;
  END IF;
  IF (SELECT count(DISTINCT btrim(x.value->>'resultKey')) FROM jsonb_array_elements(p_outcomes) x) <> jsonb_array_length(p_outcomes) THEN
`, 1, 'report: tách kết quả bỏ bước tìm SĐT')

r = patch(r, `      v_error_code := NULL; v_status_id := NULL; v_rule_id := NULL; v_matched_by := NULL; v_catch_all := NULL; v_err := NULL; v_detail_id := NULL;
`, `      v_error_code := NULL; v_status_id := NULL; v_rule_id := NULL; v_matched_by := NULL; v_catch_all := NULL; v_err := NULL; v_detail_id := NULL;
      -- V571: bước bỏ qua vì người nhận đã biết hỏng: ghi như kết quả lỗi thật của mã đã biết (cùng chính sách, trạng thái, câu lịch sử,
      -- data đi đâu); hiệu ứng phụ bỏ ở dưới.
      v_tc_code := NULL;
      IF v_ok AND o->>'statusCode' = 'campaign_detail_skipped' AND o->'data'->>'gate' = 'target_check'
         AND EXISTS (SELECT 1 FROM public.auto_error e WHERE e.error_code = o->'data'->>'rememberedErrorCode') THEN
        v_tc_code := o->'data'->>'rememberedErrorCode';
        v_ok := false;
        v_phase := 'after_send';
        v_signal := jsonb_build_object('kind', 'engine', 'code', 'target_check', 'errorCode', v_tc_code);
        v_evidence := '{}'::jsonb;
      END IF;
`, 1, 'report: đổi kết quả bỏ qua')

r = patch(r, `      SELECT * INTO v_sem FROM public.aka_agent_status_semantics((v_policy->>'detail_status_id')::bigint);

      -- Trạng thái giao: chỉ thao tác loại delivery mới có thể "đã giao".
`, `      -- V571: kết quả thay cho bước bỏ qua vì người nhận đã biết hỏng: không tính lượt, không đổi chuỗi data lỗi, không nghỉ giữa data, không
      -- khoá thao tác, không đổi chiến dịch / tài khoản / đăng nhập, lượt chạy tiếp; trạng thái, câu lịch sử, data đi đâu theo chính sách của mã.
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
`, `            -- V571: dòng thay cho bước bỏ qua không ghi tín hiệu / dữ liệu của cổng (không có gì nhắc tới việc kiểm).
            CASE WHEN v_tc_code IS NOT NULL THEN jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery)
                 ELSE jsonb_build_object('engine', 'v2', 'phase', v_phase, 'deliveryState', v_delivery, 'signal', v_signal - 'trace', 'evidence', v_evidence)
                        || coalesce(o->'data', '{}'::jsonb) END,
`, 1, 'report: dữ liệu dòng lịch sử')

r = patch(r, `                'policyIds', v_policy->'policy_ids', 'revisions', v_policy->'revisions', 'targetRunId', r.id)),
`, `                'policyIds', v_policy->'policy_ids', 'revisions', v_policy->'revisions', 'targetRunId', r.id)
                -- V571: dấu nội bộ để việc nạp lịch sử bỏ qua dòng này (không phải kết quả Zalo thật).
                || CASE WHEN v_tc_code IS NOT NULL THEN jsonb_build_object('targetCheck', true) ELSE '{}'::jsonb END),
`, 1, 'report: dấu nội bộ')
const NEW_REPORT = r

const NEW = { claim: md5(NEW_CLAIM), report: md5(NEW_REPORT) }

// ---- Đối tượng mới (p2) -------------------------------------------------------------------------------------------------------
const OBJECTS = `-- Sổ người nhận: mỗi người nhận (khoá md5('p:'||SĐT chuẩn hoá) hoặc md5('g:'||global id Zalo)) × thao tác × mã một dòng: lần hỏng gần nhất
-- và lần thành công gần nhất của cùng thao tác (thành công của tài khoản đã là bạn bè không tính). Chỉ người nhận từng hỏng mới có dòng.
CREATE TABLE private.auto_engine_receiver_results (
  receiver_key uuid NOT NULL,
  key_kind text NOT NULL CHECK (key_kind IN ('phone', 'global')),
  action_code text NOT NULL,
  error_code text NOT NULL,
  bad_zalo_code text,
  bad_at timestamptz NOT NULL,
  bad_detail_id bigint NOT NULL,
  ok_at timestamptz,
  PRIMARY KEY (receiver_key, action_code, error_code)
) WITH (fillfactor = 90);
COMMENT ON TABLE private.auto_engine_receiver_results IS
  'V571: kết quả theo người nhận trên toàn hệ thống. receiver_key = md5(''p:''||normalize_phone(SĐT))::uuid hoặc md5(''g:''||global id)::uuid (một kết quả có cả hai thì ghi cả hai). Theo dõi mọi mã "thuộc về người nhận" của Tìm SĐT / Nhắn tin người lạ / Kết bạn (aka_agent_engine_target_check_tracked), bật bỏ qua theo cột target_check của auto_outcome_policies. bad_zalo_code = mã Zalo gốc nếu có; ok_at = lần thành công gần nhất của cùng thao tác (trừ khi tài khoản gửi đã là bạn bè). Nạp nền: aka_agent_engine_receiver_results_ingest; claim_target_v1 đọc qua aka_agent_engine_target_check_probe.';
ALTER TABLE private.auto_engine_receiver_results ENABLE ROW LEVEL SECURITY;

CREATE TABLE private.auto_engine_receiver_results_state (
  id integer PRIMARY KEY CHECK (id = 1),
  last_detail_id bigint NOT NULL DEFAULT 0,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  runs bigint NOT NULL DEFAULT 0,
  last_run jsonb,
  cleaned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE private.auto_engine_receiver_results_state IS
  'V571: mốc nạp (id auto_campaign_details đã nạp tới) và số đo cộng dồn. "<thao tác>|all|<mã lỗi|ok|other>" = mọi kết quả đã nạp; "<thao tác>|pred|<mã hỏng trước>/<mã Zalo>|<phone|global>|<d007|d030|d090|d365|d999>|<same|bad|ok|other>" = kết quả mà lúc đó người nhận đã có lần hỏng còn hiệu lực (khoá, tuổi lần hỏng), tức kết quả lẽ ra bị bỏ qua nếu mã đó bật: same = hỏng lại đúng mã (bỏ đúng), ok = Zalo lại thành công (bỏ nhầm). Số đo chỉ đúng ở lần nạp đầu (nạp lại thì xoá cả bảng kết quả lẫn stats).';
ALTER TABLE private.auto_engine_receiver_results_state ENABLE ROW LEVEL SECURITY;
INSERT INTO private.auto_engine_receiver_results_state (id) VALUES (1);

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
COMMENT ON FUNCTION ${FUNCS.config} IS 'V571: thiết lập ${SETTING_KEY} (thiếu dòng / sai định dạng = {}).';

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
COMMENT ON FUNCTION ${FUNCS.on} IS 'V571: tổ chức có bật kiểm người nhận trên toàn hệ thống không (${SETTING_KEY}: mode off | orgs (organizationIds) | all; thiếu / sai = không).';

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
COMMENT ON FUNCTION ${FUNCS.rules} IS 'V571: các cặp (thao tác, mã) có target_check ở auto_outcome_policies: enabled = true thì claim bỏ qua bước; false = chỉ theo dõi. days = số ngày xét.';

CREATE FUNCTION private.aka_agent_engine_target_check_tracked()
RETURNS TABLE(action_code text, error_code text)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  SELECT a.code, e.error_code
    FROM unnest(ARRAY[${sqlList(TRACK_ACTIONS)}]) a(code)
    CROSS JOIN public.auto_error e
   WHERE e.error_class = 'target_permanent' AND starts_with(e.error_code, 'err_zalo_') AND e.is_active AND NOT e.is_delete
     AND e.error_code <> ALL (ARRAY[${sqlList(TRACK_EXCLUDE)}])
  UNION
  SELECT rl.action_code, rl.error_code FROM private.aka_agent_engine_target_check_rules() rl
$function$;
COMMENT ON FUNCTION ${FUNCS.tracked} IS 'V571: các cặp (thao tác, mã) được nạp vào sổ: mã Zalo "thuộc về người nhận" (auto_error target_permanent, trừ ${TRACK_EXCLUDE.join(', ')}) của ${TRACK_ACTIONS.join(' / ')}, cộng mọi cặp có target_check ở bảng chính sách. Bật bỏ qua một mã đã theo dõi có hiệu lực ngay, không phải nạp lại.';

CREATE FUNCTION private.aka_agent_engine_receiver_key(p_kind text, p_value text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN p_kind = 'phone' THEN (SELECT CASE WHEN n IS NULL OR n = '' THEN NULL ELSE md5('p:' || n)::uuid END FROM (SELECT public.normalize_phone(p_value) AS n) s)
    WHEN p_kind = 'global' THEN (SELECT CASE WHEN g IS NULL OR g = '' THEN NULL ELSE md5('g:' || g)::uuid END FROM (SELECT btrim(p_value) AS g) s)
  END
$function$;
COMMENT ON FUNCTION ${FUNCS.key} IS 'V571: khoá người nhận: phone = md5(''p:''||normalize_phone(SĐT))::uuid (SĐT không có chữ số = NULL); global = md5(''g:''||global id)::uuid.';

CREATE FUNCTION private.aka_agent_engine_target_check_probe(p_phone text, p_global_id text)
RETURNS TABLE(action_code text, error_code text, key_kind text, zalo_code text, bad_at timestamptz)
LANGUAGE sql
STABLE
SET search_path TO ''
AS $function$
  WITH k AS (
    SELECT private.aka_agent_engine_receiver_key('phone', p_phone) AS pk, private.aka_agent_engine_receiver_key('global', p_global_id) AS gk
  ), rws AS (
    SELECT x.* FROM private.auto_engine_receiver_results x, k WHERE x.receiver_key = k.pk OR x.receiver_key = k.gk
  ), okmax AS (
    -- Thành công gần nhất của cùng thao tác qua mọi khoá của người nhận.
    SELECT w.action_code, max(w.ok_at) AS ok_at FROM rws w GROUP BY w.action_code
  )
  SELECT DISTINCT ON (w.action_code) w.action_code, w.error_code, w.key_kind, w.bad_zalo_code, w.bad_at
    FROM rws w
    JOIN okmax o ON o.action_code = w.action_code
    JOIN private.aka_agent_engine_target_check_rules() rl ON rl.action_code = w.action_code AND rl.error_code = w.error_code AND rl.enabled
   WHERE w.bad_at > clock_timestamp() - make_interval(days => rl.days)
     AND (o.ok_at IS NULL OR o.ok_at < w.bad_at)
   ORDER BY w.action_code, w.bad_at DESC
$function$;
COMMENT ON FUNCTION ${FUNCS.probe} IS 'V571: các thao tác mà người nhận (SĐT, global id) đã biết hỏng: mã đang bật target_check, trong số ngày xét, chưa thành công lại (qua mọi khoá); mỗi thao tác lần hỏng gần nhất.';

CREATE FUNCTION private.aka_agent_engine_receiver_results_ingest(p_budget_ms integer DEFAULT NULL, p_chunk integer DEFAULT NULL)
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
  SELECT greatest(${DAYS}, coalesce(max(rl.days), ${DAYS})) INTO v_keep FROM private.aka_agent_engine_target_check_rules() rl;
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
         AND d.action_code = ANY (ARRAY[${sqlList(TRACK_ACTIONS)}])
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
END $function$;
COMMENT ON FUNCTION ${FUNCS.ingest} IS
  'V571: nạp auto_campaign_details (theo id, từ mốc ở auto_engine_receiver_results_state) vào auto_engine_receiver_results và số đo. pg_cron ${JOB} gọi mỗi phút với ngân sách ${SETTING_KEY}.ingestBudgetMs (mặc định 40 giây, ingestChunk id mỗi phần, mặc định 5.000); còn tồn hơn backfillThresholdIds id (nạp lần đầu) trong backfillDayHours giờ VN (mặc định 8–18h) thì chỉ backfillDayBudgetMs (mặc định 3 giây). Gọi tay với p_budget_ms để nạp bù (không giới hạn theo giờ).';

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active) VALUES
  ('${SETTING_KEY}', '${SETTING_VALUE}',
   'Kiểm người nhận trên toàn hệ thống trước khi gọi Zalo (V571), chỉ engine v2: "Nhắn tin theo SĐT" và nhắn người lạ theo UID (thành viên nhóm, group thời gian thực, đề xuất Zalo, khách hàng cũ), không kiêm SMS. JSON: mode off | orgs (chỉ organizationIds) | all; thiếu dòng / sai định dạng = off. Mã nào bỏ qua: cột target_check_enabled / target_check_days của auto_outcome_policies. ingest = false: job ngừng nạp lịch sử (claim vẫn đọc sổ đã nạp nếu mode bật). ingestBudgetMs / ingestChunk: ngân sách mỗi phút và số id mỗi phần nạp; backfillDayBudgetMs / backfillDayHours [giờ bắt đầu, giờ kết thúc) VN / backfillThresholdIds: ngân sách ban ngày khi còn tồn nhiều (nạp lần đầu). Claim đọc lại mỗi lần nhận data nên đổi có hiệu lực ngay.',
   false, true);

DO $grants$
DECLARE v_role text; v_obj text;
BEGIN
  FOREACH v_obj IN ARRAY ARRAY[${sqlList(TABLES)}] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC', v_obj);
  END LOOP;
  FOREACH v_obj IN ARRAY ARRAY[${sqlList(Object.values(FUNCS))}] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_obj);
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY[${sqlList(ROLES)}] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      FOREACH v_obj IN ARRAY ARRAY[${sqlList(TABLES)}] LOOP
        EXECUTE format('REVOKE ALL ON TABLE %s FROM %I', v_obj, v_role);
      END LOOP;
      FOREACH v_obj IN ARRAY ARRAY[${sqlList(Object.values(FUNCS))}] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_obj, v_role);
      END LOOP;
    END IF;
  END LOOP;
END $grants$;`

// ---- p1 -----------------------------------------------------------------------------------------------------------------------
const RULE_TUPLES = RULES.map(([e, a]) => `('${e}', '${a}')`).join(', ')
const migrationP1 = `-- V571 phần 1: cột kiểm người nhận trên toàn hệ thống ở auto_outcome_policies. SINH TỪ scripts/build-v571-sql.cjs, không sửa tay.
-- Thêm target_check_enabled (NULL = không kiểm; false = chỉ theo dõi, xem số đo; true = engine bỏ qua bước khi người nhận đã biết hỏng) và
-- target_check_days (số ngày xét, 1–3650), rồi bật 3 dòng anh duyệt 18/11/2026 (365 ngày):
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
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v571_%') THEN
      RAISE EXCEPTION 'V571 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass
              AND attname IN ('target_check_enabled', 'target_check_days') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V571 p1: cột target_check đã có';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies p
   WHERE p.is_active AND NOT p.is_delete AND p.status_id IS NULL AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL
     AND (p.error_code, p.action_code) IN (${RULE_TUPLES});
  IF v_n <> ${RULES.length} THEN RAISE EXCEPTION 'V571 p1: cần đúng ${RULES.length} dòng chính sách (mã × thao tác), thấy %', v_n; END IF;
END $pre$;

ALTER TABLE public.auto_outcome_policies
  ADD COLUMN target_check_enabled boolean,
  ADD COLUMN target_check_days integer,
  ADD CONSTRAINT auto_outcome_policies_target_check_v571 CHECK (
    (target_check_enabled IS NULL AND target_check_days IS NULL)
    OR (target_check_enabled IS NOT NULL AND target_check_days IS NOT NULL AND target_check_days BETWEEN 1 AND 3650
        AND error_code IS NOT NULL AND action_code IS NOT NULL AND status_id IS NULL AND campaign_action_id IS NULL AND runtime_target IS NULL));
COMMENT ON COLUMN public.auto_outcome_policies.target_check_enabled IS
  'V571: kiểm người nhận trên toàn hệ thống cho (error_code × action_code) của dòng này. NULL = không kiểm; false = chỉ theo dõi (xem số đo); true = engine v2 bỏ qua bước khi người nhận (SĐT / global id) đã hỏng với mã này trong target_check_days ngày và chưa thành công lại. Mã Zalo "thuộc về người nhận" của Tìm SĐT / Nhắn tin người lạ / Kết bạn đã được theo dõi sẵn nên bật có hiệu lực ngay. Bật cả hệ thống: auto_system_settings engine.target_check.';
COMMENT ON COLUMN public.auto_outcome_policies.target_check_days IS
  'V571: số ngày xét lần hỏng của người nhận (1–3650); bắt buộc khi target_check_enabled khác NULL.';

DO $set$
DECLARE v_n integer;
BEGIN
  UPDATE public.auto_outcome_policies p SET target_check_enabled = true, target_check_days = ${DAYS}
   WHERE p.is_active AND NOT p.is_delete AND p.status_id IS NULL AND p.campaign_action_id IS NULL AND p.runtime_target IS NULL
     AND (p.error_code, p.action_code) IN (${RULE_TUPLES});
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> ${RULES.length} THEN RAISE EXCEPTION 'V571 p1: bật được % dòng, cần ${RULES.length}', v_n; END IF;
END $set$;

COMMIT;
`

const rollbackP1 = `-- Gỡ V571 phần 1: bỏ hai cột target_check của auto_outcome_policies. SINH TỪ scripts/build-v571-sql.cjs.
-- Gỡ phần 2 trước (${ROLLBACK_P2}.sql): claim / report / hàm nạp đọc hai cột này.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF to_regprocedure('${FUNCS.rules}') IS NOT NULL THEN RAISE EXCEPTION 'Gỡ V571 p1: gỡ phần 2 trước (${ROLLBACK_P2}.sql)'; END IF;
END $pre$;

ALTER TABLE public.auto_outcome_policies
  DROP CONSTRAINT IF EXISTS auto_outcome_policies_target_check_v571,
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
  PERFORM set_config('aka.v571_acl_${label}', v_acl, true);`
const verify = (label, expect, what) => `  v_oid := '${label === 'claim' ? CLAIM_SIG : REPORT_SIG}'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${expect}' THEN
    RAISE EXCEPTION '${what} postflight: định nghĩa ${label} %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.v571_acl_${label}', true) THEN RAISE EXCEPTION '${what} postflight: quyền / chủ sở hữu ${label} bị đổi'; END IF;`

const migrationP2 = `-- V571 phần 2: kiểm người nhận trên toàn hệ thống trước khi gọi Zalo (engine v2). SINH TỪ scripts/build-v571-sql.cjs, không sửa tay.
-- Cần phần 1. Tạo private.auto_engine_receiver_results (+ _state), ${Object.keys(FUNCS).length} hàm private, thiết lập ${SETTING_KEY} (mode off: chưa bỏ
-- qua gì), job pg_cron ${JOB} (mỗi phút, nạp lịch sử tối đa 40 giây), rồi thay thân aka_agent_engine_claim_target_v1 (bản V564) và
-- aka_agent_engine_report_v1 (bản V558), giữ chữ ký / chủ sở hữu / quyền. Khi mode off, claim và report trả đúng như trước (chỉ thêm một lần
-- đọc thiết lập mỗi lần nhận data của chiến dịch nhắn người lạ).
-- Nguồn = pg_get_functiondef production 18/11/2026: claim ${LIVE.claim}, report ${LIVE.report}. Bản mới: claim ${NEW.claim}, report ${NEW.report}.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Lần nạp đầu đọc cả auto_campaign_details (~15 triệu dòng), xong trong khoảng
-- một đêm (40 giây / phút, ban ngày 3 giây / phút). Gỡ: ${ROLLBACK_P2}.sql rồi ${ROLLBACK_P1}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text; v_label text := 'V571 p2';
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = '${NAME_P2}') THEN
      RAISE EXCEPTION 'V571 p2 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid = 'public.auto_outcome_policies'::regclass
                  AND attname = 'target_check_enabled' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V571 p2: cần p1 (${NAME_P1}.sql) trước';
  END IF;
  IF to_regclass('private.auto_engine_receiver_results') IS NOT NULL OR to_regprocedure('${FUNCS.ingest}') IS NOT NULL THEN
    RAISE EXCEPTION 'V571 p2: bảng / hàm kiểm người nhận đã có';
  END IF;
  IF to_regprocedure('public.normalize_phone(text)') IS NULL THEN RAISE EXCEPTION 'V571 p2: thiếu public.normalize_phone(text)'; END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid = to_regclass('public.zalo_users')
       AND attname IN ('account_id', 'zalo_uid', 'global_id', 'is_fr') AND NOT attisdropped) <> 4 THEN
    RAISE EXCEPTION 'V571 p2: thiếu public.zalo_users(account_id, zalo_uid, global_id, is_fr)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = '${SETTING_KEY}') THEN RAISE EXCEPTION 'V571 p2: thiết lập ${SETTING_KEY} đã có'; END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${JOB}') THEN RAISE EXCEPTION 'V571 p2: job ${JOB} đã có'; END IF;
  END IF;
${capture('claim', LIVE.claim, NEW.claim, 'V571 đã chạy (claim)', 'V571: định nghĩa claim khác bản production 18/11 (V564), dừng để đối chiếu bản live')}
${capture('report', LIVE.report, NEW.report, 'V571 đã chạy (report)', 'V571: định nghĩa report khác bản production 18/11 (V558), dừng để đối chiếu bản live')}
END $pre$;

${OBJECTS}

${NEW_CLAIM};

${NEW_REPORT};

DO $cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL THEN
    PERFORM cron.schedule('${JOB}', '* * * * *', 'SELECT private.aka_agent_engine_receiver_results_ingest()');
  END IF;
END $cron$;

DO $post$
DECLARE v_oid oid; v_acl text; v_role text; v_obj text;
BEGIN
${verify('claim', NEW.claim, 'V571')}
${verify('report', NEW.report, 'V571')}
  FOREACH v_obj IN ARRAY ARRAY[${sqlList(TABLES)}] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_obj::regclass) THEN RAISE EXCEPTION 'V571 postflight: % chưa bật RLS', v_obj; END IF;
  END LOOP;
  FOREACH v_role IN ARRAY ARRAY[${sqlList(ROLES)}] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role) THEN
      FOREACH v_obj IN ARRAY ARRAY[${sqlList(TABLES)}] LOOP
        IF has_table_privilege(v_role, v_obj, 'SELECT') OR has_table_privilege(v_role, v_obj, 'INSERT') OR has_table_privilege(v_role, v_obj, 'UPDATE')
           OR has_table_privilege(v_role, v_obj, 'DELETE') THEN RAISE EXCEPTION 'V571 postflight: % có quyền trên %', v_role, v_obj; END IF;
      END LOOP;
      FOREACH v_obj IN ARRAY ARRAY[${sqlList(Object.values(FUNCS))}] LOOP
        IF has_function_privilege(v_role, v_obj, 'EXECUTE') THEN RAISE EXCEPTION 'V571 postflight: % chạy được %', v_role, v_obj; END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF private.aka_agent_engine_target_check_on(1) THEN RAISE EXCEPTION 'V571 postflight: thiết lập phải ở mode off'; END IF;
  IF (SELECT count(*) FROM private.aka_agent_engine_target_check_rules() WHERE enabled) <> ${RULES.length} THEN
    RAISE EXCEPTION 'V571 postflight: cần ${RULES.length} cặp mã đang bật';
  END IF;
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = '${JOB}') THEN RAISE EXCEPTION 'V571 postflight: chưa có job ${JOB}'; END IF;
  END IF;
END $post$;

COMMIT;
`

const rollbackP2 = `-- Gỡ V571 phần 2: trả claim_target_v1 về bản V564 và report_v1 về bản V558, bỏ job, thiết lập, hàm và bảng kiểm người nhận (mất sổ đã nạp).
-- SINH TỪ scripts/build-v571-sql.cjs. Data đang chạy không bị ảnh hưởng (lõi chỉ thấy quyết định skip khi mode bật). Sau đó có thể gỡ
-- phần 1 (${ROLLBACK_P1}.sql).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text; v_label text := 'Gỡ V571 p2';
BEGIN
${capture('claim', NEW.claim, LIVE.claim, 'Gỡ V571: claim đã là bản trước V571', 'Gỡ V571: định nghĩa claim không phải bản V571')}
${capture('report', NEW.report, LIVE.report, 'Gỡ V571: report đã là bản trước V571', 'Gỡ V571: định nghĩa report không phải bản V571')}
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
DROP FUNCTION ${FUNCS.tracked};
DROP FUNCTION ${FUNCS.rules};
DROP FUNCTION ${FUNCS.on};
DROP FUNCTION ${FUNCS.config};
DROP TABLE private.auto_engine_receiver_results_state;
DROP TABLE private.auto_engine_receiver_results;

DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
${verify('claim', LIVE.claim, 'Gỡ V571')}
${verify('report', LIVE.report, 'Gỡ V571')}
END $post$;

COMMIT;
`

module.exports = {
  migrationP1, migrationP2, rollbackP1, rollbackP2, NAME_P1, NAME_P2, ROLLBACK_P1, ROLLBACK_P2,
  LIVE, NEW, SETTING_KEY, SETTING_VALUE, JOB, RULES, DAYS, FUNCS, TABLES, CLAIM_SIG, REPORT_SIG, TRACK_ACTIONS, TRACK_EXCLUDE, CAMPAIGN_TYPES,
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
