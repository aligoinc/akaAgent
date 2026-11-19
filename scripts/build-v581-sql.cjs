// Sinh migration V581 (số tạm, kiểm lại sổ ngay trước khi apply): tách Z114 "Tham số không hợp lệ" thành 4 mã đã rõ nguyên nhân
// (anh chốt 19/11/2026: "chỉ tách những mã biết rõ nguyên nhân", câu hiển thị anh duyệt từng câu qua hộp chọn). Chỉ dữ liệu của engine v2.
//
// Đo trên production 19/11 (chỉ đọc, docs/ZALO_114_SPLIT_V581.md):
//   * TAG01: từ 01/09 có 20.159 / 22.572 lượt mã 114 ở bước gắn tag (updateLabels) của 13 tài khoản; cả 13 bắt đầu lỗi khi tổng số hội
//     thoại đã gắn tag chạm khoảng 5.820–5.890 và từ đó không gắn thêm được lần nào, tài khoản ở 5.728 vẫn gắn bình thường.
//   * DAT02: cột UID chứa số điện thoại (9–11 chữ số; UID Zalo dài 14–19 chữ số). Lõi nhận ra trước khi gọi Zalo.
//   * DAT03: data là chính tài khoản đang gửi (mình cũng là thành viên nhóm). Lõi nhận ra trước khi gọi Zalo.
//   * DAT04: UID được quét bằng tài khoản Zalo khác (chiến dịch 58417: 257/257). Lõi chỉ phát khi Zalo đã trả 114 VÀ tra thấy UID nằm
//     trong danh bạ của tài khoản khác cùng tổ chức mà không có ở tài khoản đang gửi.
//
// Hành vi: TAG01, DAT03 giữ đúng như mã đang xử lý trường hợp đó hôm nay (TAG01 = bản chép 114 × gắn tag; DAT03 = bản chép
// err_input_invalid: data "thất bại", không tính lượt, không cộng chuỗi, chạy tiếp). DAT04 (anh chọn "Dừng sau 4 data liền"): data "thất
// bại", không tính lượt, cộng chuỗi data lỗi, 4 data liền thì tạm dừng chiến dịch, bỏ các bước còn lại của data đó. DAT02 (anh chốt
// 19/11: "lỡ user đưa nhầm danh sách SĐT thì sao?"): như err_input_invalid nhưng cộng chuỗi data lỗi, 4 data liền thì tạm dừng chiến dịch
// (không gọi Zalo và không nghỉ giữa hai data nên không dừng thì cả danh sách bị đánh "thất bại" trong vài giây).
//
// TAG01 có hiệu lực ngay khi apply (luật zalo_code 114 × zalo_tag_contact). DAT02–DAT04 chỉ phát khi lõi mới chạy (worker Fly / Desktop);
// trước đó ba luật engine không khớp gì. Chạy: node scripts/build-v581-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')

const NUMBER = 581
const SOURCE = `v${NUMBER}`
const NAME = `migration_v${NUMBER}_zalo_114_split`
const ROLLBACK_NAME = `rollback_v${NUMBER}_zalo_114_split`

const Z114 = 'err_zalo_invalid_param'
const DAT01 = 'err_input_invalid'
const TAG_ACTION = 'zalo_tag_contact'
/** Bước phát DAT04: nhắn tin (người lạ / bạn bè) và kết bạn. Đổi tên / gắn tag không chạy vì remaining_steps = skip. */
const OTHER_ACCOUNT_ACTIONS = ['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend']
const OTHER_ACCOUNT_THRESHOLD = 4
/** Bước phát DAT02: bước xác định người nhận của chiến dịch theo UID, mang mã thao tác nhắn tin (người lạ / bạn bè). */
const UID_PHONE_ACTIONS = ['zalo_message_stranger', 'zalo_message_friend']
const UID_PHONE_THRESHOLD = 4

/** Câu anh duyệt 19/11/2026 qua hộp chọn (title = dòng tiến trình / lịch sử / ghi chú data; help = bước tiếp theo trên trang tra mã). */
const CODES = {
  tagFull: {
    code: 'err_engine_zalo_tag_full', publicCode: 'TAG01', name: 'Tag Zalo đã đầy (Zalo trả 114 khi gắn tag)',
    title: 'Tài khoản đã gắn tag cho quá nhiều người, Zalo không nhận thêm',
    help: 'Gỡ bớt người khỏi các tag trong Zalo rồi chạy tiếp chiến dịch.',
    desc: `V${NUMBER} (engine v2): Zalo trả 114 ở bước gắn tag khi tổng số hội thoại đã gắn tag của tài khoản chạm khoảng 5.850`
  },
  uidPhone: {
    code: 'err_engine_zalo_uid_is_phone', publicCode: 'DAT02', name: 'Cột UID chứa số điện thoại',
    title: 'Data là số điện thoại, không phải UID Zalo',
    help: 'Dùng loại chiến dịch Nhắn tin theo SĐT cho danh sách này.',
    desc: `V${NUMBER} (engine v2): lõi nhận ra UID là số điện thoại trước khi gọi Zalo`
  },
  self: {
    code: 'err_engine_zalo_target_is_self', publicCode: 'DAT03', name: 'Data là chính tài khoản đang gửi',
    title: 'Không gửi cho chính tài khoản đang gửi',
    help: null,
    desc: `V${NUMBER} (engine v2): lõi nhận ra UID của data là UID của chính tài khoản gửi trước khi gọi Zalo`
  },
  otherAccount: {
    code: 'err_engine_zalo_uid_other_account', publicCode: 'DAT04', name: 'UID được quét bằng tài khoản Zalo khác',
    title: 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được',
    help: 'Dùng tài khoản đã quét danh sách để chạy, hoặc quét lại bằng tài khoản này.',
    desc: `V${NUMBER} (engine v2): Zalo trả 114 và UID nằm trong danh bạ của tài khoản khác cùng tổ chức, không có ở tài khoản đang gửi`
  }
}
/** Tín hiệu lõi phát (kind 'engine'). */
const SIGNALS = { uidPhone: 'uid_is_phone', self: 'target_is_self', otherAccount: 'uid_other_account' }

const sqlText = s => (s === null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`)
const sqlArr = a => `ARRAY[${a.map(sqlText).join(', ')}]`
const ALL_CODES = Object.values(CODES).map(c => c.code)

const COLS = `error_code, error_class, status_id, action_code, campaign_action_id, runtime_target, detail_mode, detail_status_id, sub_status_id,
  log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps,
  lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes,
  account_effect, login_effect, description, source`

/** Dòng chính sách đang hiệu lực của một mã gốc (không theo trạng thái / nhóm lỗi / loại chiến dịch / nơi chạy). */
const baseRows = (base, actionFilter) => `p.error_code = '${base}' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (${actionFilter})`

/** Chép các dòng của mã gốc sang mã mới, chỉ đổi câu ở dòng theo mã (action_code NULL). */
const copyPolicies = (target, base, actionFilter, note) => `INSERT INTO public.auto_outcome_policies (${COLS})
SELECT '${target.code}', p.error_class, p.status_id, p.action_code, p.campaign_action_id, p.runtime_target, p.detail_mode, p.detail_status_id, p.sub_status_id,
       CASE WHEN p.action_code IS NULL THEN ${sqlText(target.title)} ELSE p.log_template END,
       CASE WHEN p.action_code IS NULL THEN ${sqlText(target.title)} ELSE p.campaign_note_template END,
       p.quota_effect, p.target_streak_effect, p.streak_threshold, p.target_effect, p.requeue_after_minutes, p.remaining_steps,
       p.lock_action_codes, p.lock_mode, p.lock_minutes, p.lock_days, p.lock_time, p.run_effect, p.pace_mode, p.pace_seconds, p.campaign_effect,
       p.campaign_hold_minutes, p.account_effect, p.login_effect,
       '[V${NUMBER}] Chép từ ${base} (id ' || p.id || '): ${note}', '${SOURCE}'
  FROM public.auto_outcome_policies p WHERE ${baseRows(base, actionFilter)};`

const insertError = c => `INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', '${c.code}', ${sqlText(c.name)}, ${sqlText(c.desc)}, NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}',
  true, false, '${c.publicCode}', 'target_permanent', ${sqlText(c.title)}, ${sqlText(c.help)})
ON CONFLICT (error_code) DO UPDATE SET is_active = true, is_delete = false, public_code = EXCLUDED.public_code, error_class = EXCLUDED.error_class,
  error_name = EXCLUDED.error_name, error_desc = EXCLUDED.error_desc, customer_title = EXCLUDED.customer_title, customer_help = EXCLUDED.customer_help
  WHERE public.auto_error.error_type = 'engine v2';`

// Ảnh chụp chính sách đã gộp và phân loại mã Zalo của mọi cặp (mã, thao tác) Zalo, cả hai nơi chạy; so trước / sau để chứng minh chỉ đúng
// cặp 114 × gắn tag đổi phân loại và không cặp có sẵn nào đổi chính sách. Bảng tạm (pg_temp) không làm PostgREST nạp lại schema.
const SNAPSHOT = name => `CREATE TEMP TABLE ${name}_policy ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target, ph.p AS phase,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, ph.p) - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t)
 CROSS JOIN (VALUES ('before_send'), ('after_send')) ph(p);
CREATE TEMP TABLE ${name}_class ON COMMIT DROP AS
SELECT s.kind, s.code, a.code AS action_code, ph.p AS phase,
       (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a.code, ph.p, jsonb_build_object('kind', s.kind, 'code', s.code)) cs) AS error_code
  FROM (SELECT DISTINCT r.signal_kind AS kind, r.pattern AS code FROM public.auto_outcome_signal_rules r
         WHERE r.platform = 'zalo' AND r.signal_kind IN ('zalo_code', 'engine') AND r.pattern <> '*'
        UNION SELECT 'zalo_code', '114'
        UNION SELECT 'engine', x FROM unnest(${sqlArr(Object.values(SIGNALS))}) x) s
 CROSS JOIN (SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo') a
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE ${name}_lint ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;`

const UNCHANGED = (name, label, changedClassFilter) => `  SELECT count(*) INTO n FROM ${name}_policy b
   WHERE (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, b.phase) - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION '${label}: % cặp (mã, thao tác) có sẵn bị đổi chính sách', n; END IF;
  SELECT count(*) INTO n FROM ${name}_class b
   WHERE NOT (${changedClassFilter})
     AND (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', b.action_code, b.phase, jsonb_build_object('kind', b.kind, 'code', b.code)) cs)
         IS DISTINCT FROM b.error_code;
  IF n > 0 THEN RAISE EXCEPTION '${label}: % cặp (tín hiệu, thao tác, pha) khác bị đổi phân loại', n; END IF;
  SELECT count(*) INTO n FROM public.aka_agent_engine_policy_lint l
   WHERE NOT EXISTS (SELECT 1 FROM ${name}_lint b WHERE b.issue IS NOT DISTINCT FROM l.issue AND b.subject IS NOT DISTINCT FROM l.subject);
  IF n > 0 THEN RAISE EXCEPTION '${label}: % dòng lint mới', n; END IF;`

/** Cặp được phép đổi phân loại: 114 × gắn tag và ba tín hiệu engine mới. */
const IS_TARGET = `(b.kind = 'zalo_code' AND b.code = '114' AND b.action_code = '${TAG_ACTION}')
     OR (b.kind = 'engine' AND b.code = ANY (${sqlArr(Object.values(SIGNALS))}))`

const RULES = [
  { action: TAG_ACTION, kind: 'zalo_code', pattern: '114', code: CODES.tagFull.code,
    note: `[V${NUMBER}] Gắn tag gặp 114: tag của tài khoản đã đầy (13/13 tài khoản từng bị đều ở khoảng 5.820–5.890 hội thoại đã gắn tag, đo 19/11/2026).` },
  { action: null, kind: 'engine', pattern: SIGNALS.uidPhone, code: CODES.uidPhone.code,
    note: `[V${NUMBER}] Lõi: UID của data là số điện thoại, không gọi Zalo.` },
  { action: null, kind: 'engine', pattern: SIGNALS.self, code: CODES.self.code,
    note: `[V${NUMBER}] Lõi: UID của data là UID của chính tài khoản gửi, không gọi Zalo.` },
  { action: null, kind: 'engine', pattern: SIGNALS.otherAccount, code: CODES.otherAccount.code,
    note: `[V${NUMBER}] Lõi: Zalo trả 114 và UID thuộc danh bạ của tài khoản khác cùng tổ chức.` }
]

const migration = `-- V${NUMBER}: tách Z114 "Tham số không hợp lệ" thành 4 mã đã rõ nguyên nhân (19/11/2026, anh chốt; câu hiển thị anh duyệt từng câu).
-- SINH TỪ scripts/build-v${NUMBER}-sql.cjs, không sửa tay.
--
-- Chỉ dữ liệu của engine v2 (error_type 'engine v2', không có mã Zalo trong auto_error nên bộ chạy cũ không khớp):
--   * ${CODES.tagFull.code} (${CODES.tagFull.publicCode}): Zalo trả 114 ở bước gắn tag. Chính sách = bản chép 114 × gắn tag (dòng lịch sử
--     "thất bại", không tính lượt, không cộng chuỗi, chạy tiếp). Có hiệu lực ngay khi apply.
--   * ${CODES.self.code} (${CODES.self.publicCode}): lõi nhận ra trước khi gọi Zalo. Chính sách = bản chép ${DAT01} (data "thất bại",
--     không tính lượt, không cộng chuỗi, chạy tiếp).
--   * ${CODES.uidPhone.code} (${CODES.uidPhone.publicCode}): lõi nhận ra trước khi gọi Zalo. Như ${DAT01} nhưng cộng chuỗi data lỗi,
--     ${UID_PHONE_THRESHOLD} data liền thì tạm dừng chiến dịch (khách đưa nhầm cả danh sách SĐT thì không bị đánh "thất bại" hết).
--   * ${CODES.otherAccount.code} (${CODES.otherAccount.publicCode}): Zalo trả 114 và lõi tra thấy UID thuộc tài khoản khác. Data "thất bại",
--     không tính lượt, cộng chuỗi data lỗi, ${OTHER_ACCOUNT_THRESHOLD} data liền thì tạm dừng chiến dịch, bỏ các bước còn lại của data.
--   * 4 luật auto_outcome_signal_rules (source '${SOURCE}').
-- Ba mã sau chỉ phát khi lõi mới chạy; trước đó luật của chúng không khớp gì. 114 ở mọi bước khác giữ nguyên Z114.
-- Không DDL (bảng tạm chỉ trong giao dịch), không đổi hàm. Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE n integer; r record; v jsonb;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v${NUMBER}_%') THEN
      RAISE EXCEPTION 'V${NUMBER} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ANY (${sqlArr(ALL_CODES)}) AND error_type IS DISTINCT FROM 'engine v2') THEN
    RAISE EXCEPTION 'V${NUMBER}: một mã mới đã có và không phải engine v2';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE public_code = ANY (${sqlArr(Object.values(CODES).map(c => c.publicCode))})
               AND error_code <> ALL (${sqlArr(ALL_CODES)}) AND NOT is_delete) THEN
    RAISE EXCEPTION 'V${NUMBER}: mã công khai TAG01 / DAT02 / DAT03 / DAT04 đã có mã khác dùng';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = ANY (${sqlArr(ALL_CODES)}) AND is_active AND NOT is_delete)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = '${SOURCE}')
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE platform = 'zalo' AND is_active AND (
          (signal_kind = 'zalo_code' AND pattern = '114' AND action_code = '${TAG_ACTION}')
          OR (signal_kind = 'engine' AND pattern = ANY (${sqlArr(Object.values(SIGNALS))})))) THEN
    RAISE EXCEPTION 'V${NUMBER}: đã có chính sách hoặc luật của các mã mới';
  END IF;
  -- Bản chép phải đúng như đã đọc 19/11/2026 (seed V495 + V500 Q2/Q3).
  v := public.aka_agent_engine_resolve_policy('${Z114}', NULL, '${TAG_ACTION}', NULL, 'fly', 'after_send');
  IF v->>'detail_mode' IS DISTINCT FROM 'write' OR v->>'quota_effect' IS DISTINCT FROM 'no_count' OR v->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v->>'target_effect' IS DISTINCT FROM 'complete' OR v->>'remaining_steps' IS DISTINCT FROM 'continue' OR v->>'run_effect' IS DISTINCT FROM 'continue'
     OR v->>'campaign_effect' IS DISTINCT FROM 'none' OR v->>'log_template' IS DISTINCT FROM 'Tham số không hợp lệ' THEN
    RAISE EXCEPTION 'V${NUMBER}: chính sách 114 × gắn tag khác bản đã đọc: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE ${baseRows(Z114, `p.action_code IS NULL OR p.action_code = '${TAG_ACTION}'`)};
  IF n <> 2 THEN RAISE EXCEPTION 'V${NUMBER}: cần đúng 2 dòng chính sách của ${Z114} cho gắn tag (thấy %)', n; END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE ${baseRows(Z114, 'p.action_code IS NULL')};
  IF n <> 1 THEN RAISE EXCEPTION 'V${NUMBER}: cần đúng 1 dòng theo mã của ${Z114} (thấy %)', n; END IF;
  v := public.aka_agent_engine_resolve_policy('${DAT01}', NULL, 'zalo_message_stranger', NULL, 'desktop', 'before_send');
  IF v->>'detail_mode' IS DISTINCT FROM 'write' OR v->>'quota_effect' IS DISTINCT FROM 'no_count' OR v->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v->>'target_effect' IS DISTINCT FROM 'complete' OR v->>'run_effect' IS DISTINCT FROM 'continue' OR v->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v->>'log_template' IS DISTINCT FROM 'Dữ liệu đầu vào không hợp lệ' THEN
    RAISE EXCEPTION 'V${NUMBER}: chính sách ${DAT01} × nhắn người lạ khác bản đã đọc: %', v;
  END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE ${baseRows(DAT01, 'p.action_code IS NULL')};
  IF n <> 1 THEN RAISE EXCEPTION 'V${NUMBER}: cần đúng 1 dòng theo mã của ${DAT01} (thấy %)', n; END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE ${baseRows(DAT01, `p.action_code = ANY (${sqlArr(UID_PHONE_ACTIONS)})`)};
  IF n <> ${UID_PHONE_ACTIONS.length} THEN RAISE EXCEPTION 'V${NUMBER}: cần đúng ${UID_PHONE_ACTIONS.length} dòng nhắn tin của ${DAT01} (thấy %)', n; END IF;
  -- Luật 114 chung (mọi thao tác) phải còn: 114 ở bước khác vẫn ra Z114.
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE platform = 'zalo' AND signal_kind = 'zalo_code' AND pattern = '114'
                   AND action_code IS NULL AND error_code = '${Z114}' AND is_active) THEN
    RAISE EXCEPTION 'V${NUMBER}: thiếu luật 114 chung của ${Z114}';
  END IF;
END $pre$;

${SNAPSHOT(`${SOURCE}_before`)}

${Object.values(CODES).map(insertError).join('\n\n')}

-- TAG01: chép dòng theo mã và dòng gắn tag của 114.
${copyPolicies(CODES.tagFull, Z114, `p.action_code IS NULL OR p.action_code = '${TAG_ACTION}'`, '114 ở bước gắn tag là tag đã đầy (đo 19/11/2026), hành vi giữ như 114.')}

-- DAT02, DAT03: chép mọi dòng của ${DAT01} (dòng theo mã + dòng theo thao tác).
${copyPolicies(CODES.uidPhone, DAT01, 'true', 'UID là số điện thoại, như dữ liệu đầu vào không hợp lệ; dòng nhắn tin thêm chuỗi lỗi và ngưỡng tạm dừng.')}
-- DAT02 ở bước nhắn tin: cộng chuỗi data lỗi, ${UID_PHONE_THRESHOLD} data liền thì tạm dừng chiến dịch (anh chốt 19/11/2026).
UPDATE public.auto_outcome_policies
   SET target_streak_effect = 'increment', streak_threshold = ${UID_PHONE_THRESHOLD}, campaign_effect = 'pause',
       description = description || ' Anh chốt 19/11/2026: ${UID_PHONE_THRESHOLD} data liền thì tạm dừng chiến dịch.'
 WHERE error_code = '${CODES.uidPhone.code}' AND source = '${SOURCE}' AND action_code = ANY (${sqlArr(UID_PHONE_ACTIONS)});
${copyPolicies(CODES.self, DAT01, 'true', 'data là chính tài khoản đang gửi, hành vi giữ như dữ liệu đầu vào không hợp lệ.')}

-- DAT04: dòng theo mã chép từ 114; dòng theo thao tác: không tính lượt, cộng chuỗi, ${OTHER_ACCOUNT_THRESHOLD} data liền thì tạm dừng chiến dịch, bỏ bước còn lại.
${copyPolicies(CODES.otherAccount, Z114, 'p.action_code IS NULL', 'UID thuộc tài khoản Zalo khác; dòng theo thao tác quyết định tính lượt / chuỗi.')}
INSERT INTO public.auto_outcome_policies (error_code, action_code, quota_effect, target_streak_effect, streak_threshold, remaining_steps, campaign_effect,
  description, source)
SELECT '${CODES.otherAccount.code}', a.code, 'no_count', 'increment', ${OTHER_ACCOUNT_THRESHOLD}, 'skip', 'pause',
       '[V${NUMBER}] Anh chốt 19/11/2026: data "thất bại", không tính lượt, ${OTHER_ACCOUNT_THRESHOLD} data liền thì tạm dừng chiến dịch.', '${SOURCE}'
  FROM unnest(${sqlArr(OTHER_ACCOUNT_ACTIONS)}) a(code);

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
${RULES.map(r => `  ('zalo', ${sqlText(r.action)}, NULL, '${r.kind}', '${r.pattern}', 10, '${r.code}', '${SOURCE}', ${sqlText(r.note)})`).join(',\n')};

DO $post$
DECLARE n integer; t text; a text; ph text; v_new jsonb; v_base jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.auto_error WHERE error_code = ANY (${sqlArr(ALL_CODES)}) AND is_active AND NOT is_delete AND error_type = 'engine v2';
  IF n <> ${ALL_CODES.length} THEN RAISE EXCEPTION 'V${NUMBER} postflight: cần ${ALL_CODES.length} mã mới (thấy %)', n; END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_signal_rules WHERE source = '${SOURCE}' AND is_active;
  IF n <> ${RULES.length} THEN RAISE EXCEPTION 'V${NUMBER} postflight: cần ${RULES.length} luật mới (thấy %)', n; END IF;

  FOREACH ph IN ARRAY ARRAY['before_send', 'in_flight', 'after_send'] LOOP
    -- TAG01: 114 × gắn tag ở mọi pha; 114 ở thao tác khác vẫn là Z114.
    IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', '${TAG_ACTION}', ph, '{"kind": "zalo_code", "code": "114"}'::jsonb) cs)
       IS DISTINCT FROM '${CODES.tagFull.code}' THEN
      RAISE EXCEPTION 'V${NUMBER} postflight: 114 × gắn tag (%) chưa ra ${CODES.tagFull.code}', ph;
    END IF;
    FOREACH a IN ARRAY ARRAY['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend', 'zalo_change_alias', 'zalo_message_group'] LOOP
      IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, ph, '{"kind": "zalo_code", "code": "114"}'::jsonb) cs)
         IS DISTINCT FROM '${Z114}' THEN
        RAISE EXCEPTION 'V${NUMBER} postflight: 114 × % (%) không còn là ${Z114}', a, ph;
      END IF;
      IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, ph, '{"kind": "engine", "code": "${SIGNALS.uidPhone}"}'::jsonb) cs)
           IS DISTINCT FROM '${CODES.uidPhone.code}'
         OR (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, ph, '{"kind": "engine", "code": "${SIGNALS.self}"}'::jsonb) cs)
           IS DISTINCT FROM '${CODES.self.code}'
         OR (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, ph, '{"kind": "engine", "code": "${SIGNALS.otherAccount}"}'::jsonb) cs)
           IS DISTINCT FROM '${CODES.otherAccount.code}' THEN
        RAISE EXCEPTION 'V${NUMBER} postflight: tín hiệu engine mới × % (%) chưa ra đúng mã', a, ph;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['desktop', 'fly'] LOOP
    -- TAG01 = 114 × gắn tag, chỉ khác câu.
    v_new := public.aka_agent_engine_resolve_policy('${CODES.tagFull.code}', NULL, '${TAG_ACTION}', NULL, t, 'after_send');
    v_base := public.aka_agent_engine_resolve_policy('${Z114}', NULL, '${TAG_ACTION}', NULL, t, 'after_send');
    IF (v_new - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template') IS DISTINCT FROM
       (v_base - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template') THEN
      RAISE EXCEPTION 'V${NUMBER} postflight: chính sách TAG01 (%) khác 114 × gắn tag: % / %', t, v_new, v_base;
    END IF;
    IF v_new->>'log_template' IS DISTINCT FROM ${sqlText(CODES.tagFull.title)} OR v_new->>'campaign_note_template' IS DISTINCT FROM ${sqlText(CODES.tagFull.title)} THEN
      RAISE EXCEPTION 'V${NUMBER} postflight: câu TAG01 (%) chưa đúng: %', t, v_new;
    END IF;
    FOREACH a IN ARRAY ARRAY['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend', 'zalo_change_alias', 'zalo_tag_contact'] LOOP
      -- DAT03 = ${DAT01}, chỉ khác câu (pha trước khi gửi). DAT02 = ${DAT01} trừ chuỗi lỗi / ngưỡng / tạm dừng ở bước nhắn tin.
      v_base := public.aka_agent_engine_resolve_policy('${DAT01}', NULL, a, NULL, t, 'before_send');
      v_new := public.aka_agent_engine_resolve_policy('${CODES.uidPhone.code}', NULL, a, NULL, t, 'before_send');
      IF (v_new - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template' - 'target_streak_effect' - 'streak_threshold' - 'campaign_effect')
         IS DISTINCT FROM
         (v_base - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template' - 'target_streak_effect' - 'streak_threshold' - 'campaign_effect')
         OR v_new->>'log_template' IS DISTINCT FROM ${sqlText(CODES.uidPhone.title)} THEN
        RAISE EXCEPTION 'V${NUMBER} postflight: chính sách DAT02 × % (%) lệch ${DAT01} ngoài phần đã chốt: % / %', a, t, v_new, v_base;
      END IF;
      IF a = ANY (${sqlArr(UID_PHONE_ACTIONS)}) THEN
        IF v_new->>'target_streak_effect' IS DISTINCT FROM 'increment' OR (v_new->>'streak_threshold')::integer IS DISTINCT FROM ${UID_PHONE_THRESHOLD}
           OR v_new->>'campaign_effect' IS DISTINCT FROM 'pause' OR v_new->>'quota_effect' IS DISTINCT FROM 'no_count'
           OR v_new->>'target_effect' IS DISTINCT FROM 'complete' OR v_new->>'detail_mode' IS DISTINCT FROM 'write' THEN
          RAISE EXCEPTION 'V${NUMBER} postflight: chính sách DAT02 × % (%) chưa đúng: %', a, t, v_new;
        END IF;
      ELSIF v_new->>'target_streak_effect' IS DISTINCT FROM v_base->>'target_streak_effect' OR v_new->>'campaign_effect' IS DISTINCT FROM v_base->>'campaign_effect'
            OR v_new->>'streak_threshold' IS DISTINCT FROM v_base->>'streak_threshold' THEN
        RAISE EXCEPTION 'V${NUMBER} postflight: chính sách DAT02 × % (%) không được đổi chuỗi lỗi: %', a, t, v_new;
      END IF;
      v_new := public.aka_agent_engine_resolve_policy('${CODES.self.code}', NULL, a, NULL, t, 'before_send');
      IF (v_new - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template') IS DISTINCT FROM
         (v_base - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template')
         OR v_new->>'log_template' IS DISTINCT FROM ${sqlText(CODES.self.title)} THEN
        RAISE EXCEPTION 'V${NUMBER} postflight: chính sách DAT03 × % (%) khác ${DAT01}: % / %', a, t, v_new, v_base;
      END IF;
    END LOOP;
    -- DAT04: như 114 × thao tác đó, trừ chuỗi lỗi / ngưỡng / tạm dừng / bỏ bước còn lại và câu.
    FOREACH a IN ARRAY ${sqlArr(OTHER_ACCOUNT_ACTIONS)} LOOP
      v_new := public.aka_agent_engine_resolve_policy('${CODES.otherAccount.code}', NULL, a, NULL, t, 'after_send');
      v_base := public.aka_agent_engine_resolve_policy('${Z114}', NULL, a, NULL, t, 'after_send');
      IF (v_new - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template' - 'target_streak_effect' - 'streak_threshold' - 'remaining_steps' - 'campaign_effect')
         IS DISTINCT FROM
         (v_base - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template' - 'target_streak_effect' - 'streak_threshold' - 'remaining_steps' - 'campaign_effect') THEN
        RAISE EXCEPTION 'V${NUMBER} postflight: chính sách DAT04 × % (%) lệch 114 ngoài phần đã chốt: % / %', a, t, v_new, v_base;
      END IF;
      IF v_new->>'quota_effect' IS DISTINCT FROM 'no_count' OR v_new->>'target_streak_effect' IS DISTINCT FROM 'increment'
         OR (v_new->>'streak_threshold')::integer IS DISTINCT FROM ${OTHER_ACCOUNT_THRESHOLD} OR v_new->>'campaign_effect' IS DISTINCT FROM 'pause'
         OR v_new->>'remaining_steps' IS DISTINCT FROM 'skip' OR v_new->>'target_effect' IS DISTINCT FROM 'complete'
         OR v_new->>'detail_mode' IS DISTINCT FROM 'write' OR v_new->>'log_template' IS DISTINCT FROM ${sqlText(CODES.otherAccount.title)} THEN
        RAISE EXCEPTION 'V${NUMBER} postflight: chính sách DAT04 × % (%) chưa đúng: %', a, t, v_new;
      END IF;
    END LOOP;
  END LOOP;
${UNCHANGED(`${SOURCE}_before`, `V${NUMBER} postflight`, IS_TARGET)}
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V${NUMBER}: xoá chính sách và luật source '${SOURCE}', tắt 4 mã mới (không xoá dòng auto_error vì lịch sử có thể đã tham chiếu).
-- SINH TỪ scripts/build-v${NUMBER}-sql.cjs. Chỉ dữ liệu. Sau khi gỡ: 114 ở bước gắn tag lại ra Z114; ba tín hiệu của lõi mới rơi về luật
-- chung của tín hiệu engine (trước khi gửi: NET01, data về hàng đợi), nên gỡ thì cũng phải đưa lõi về bản trước.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = '${SOURCE}') THEN
    RAISE EXCEPTION 'Gỡ V${NUMBER}: chưa có V${NUMBER}';
  END IF;
END $pre$;

${SNAPSHOT(`${SOURCE}_rollback_before`)}

DELETE FROM public.auto_outcome_signal_rules WHERE source = '${SOURCE}';
DELETE FROM public.auto_outcome_policies WHERE source = '${SOURCE}';
UPDATE public.auto_error SET is_active = false, is_delete = true WHERE error_type = 'engine v2' AND error_code = ANY (${sqlArr(ALL_CODES)});

DO $post$
DECLARE n integer;
BEGIN
  IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', '${TAG_ACTION}', 'after_send', '{"kind": "zalo_code", "code": "114"}'::jsonb) cs)
     IS DISTINCT FROM '${Z114}' THEN
    RAISE EXCEPTION 'Gỡ V${NUMBER} postflight: 114 × gắn tag chưa về ${Z114}';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = ANY (${sqlArr(ALL_CODES)}) AND is_active AND NOT is_delete) THEN
    RAISE EXCEPTION 'Gỡ V${NUMBER} postflight: còn chính sách của mã mới';
  END IF;
  -- Cặp của mã đã tắt không còn trong ảnh chụp sau (không còn luật trỏ tới), nên chỉ so các cặp còn lại.
  DELETE FROM ${SOURCE}_rollback_before_policy WHERE error_code = ANY (${sqlArr(ALL_CODES)});
${UNCHANGED(`${SOURCE}_rollback_before`, `Gỡ V${NUMBER} postflight`, IS_TARGET)}
END $post$;

COMMIT;
`

module.exports = { migration, rollback, NUMBER, SOURCE, NAME, ROLLBACK_NAME, CODES, SIGNALS, RULES, Z114, DAT01, TAG_ACTION,
  OTHER_ACCOUNT_ACTIONS, OTHER_ACCOUNT_THRESHOLD, UID_PHONE_ACTIONS, UID_PHONE_THRESHOLD }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`V${NUMBER} migration`, md5(migration), 'rollback', md5(rollback))
}
