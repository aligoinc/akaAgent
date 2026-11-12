// Sinh migration V509: Zalo 112 khi nhắn người lạ / bạn bè xử lý như 118 "Nội dung quá dài" (anh chốt 12/11/2026: "cứ gặp 112 thì xử lý
// như 118", chỉ nhắn người lạ / bạn bè; nhắn group giữ nguyên vì 112 ở group là group từ chối). Chỉ dữ liệu của engine v2.
//
// Đo trên production 12/11 (chỉ đọc, toàn bộ auto_zalo_api_error_logs từ 06/2026): 112 và 118 khi nhắn người lạ / bạn bè gửi thường có
// 743 lượt, 741 lượt chữ dài hơn 2.000 ký tự (ngắn nhất 2.341), 2 lượt chữ rỗng. Không có ngưỡng gọn (kèm 1 ảnh gửi được tới 2.157 ký tự;
// 2.663–2.782 ký tự ảnh jpg lúc được lúc 112, png luôn 112; album rồi chữ riêng 3.214 ký tự luôn 112) nên không kiểm độ dài, cứ 112 là
// xử lý như 118. Nhắn group gửi dạng chia sẻ có 43.139 lượt 112, chữ ngắn: group từ chối, không đụng.
//
// Thêm mã engine v2 err_engine_zalo_112_message_too_long (Z112, content_config) không có mã Zalo trong auto_error nên bộ chạy cũ không
// khớp; chép 3 dòng chính sách của err_zalo_message_too_long (dòng theo mã, nhắn người lạ, nhắn bạn bè), đổi câu cho khách; thêm 2 luật
// (zalo_code 112 × zalo_message_stranger / zalo_message_friend). Chạy: node scripts/build-v509-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')

const CODE = 'err_engine_zalo_112_message_too_long'
const BASE = 'err_zalo_message_too_long'
const ACTIONS = ['zalo_message_stranger', 'zalo_message_friend']
const TITLE = 'Nội dung quá dài'
const NOTE = 'Nội dung quá dài, vui lòng rút ngắn nội dung chiến dịch (gửi kèm 1 ảnh thì chữ dưới 2.000 ký tự)'
const HELP = 'Rút ngắn nội dung tin nhắn rồi chạy tiếp chiến dịch. Gửi kèm đúng 1 ảnh thì chữ thành chú thích ảnh, Zalo chỉ nhận khoảng 2.000 ký tự.'
const sqlText = s => `'${s.replace(/'/g, "''")}'`
const sqlArr = a => `ARRAY[${a.map(sqlText).join(', ')}]`

// Dòng chính sách của 118 dùng làm bản chép: dòng theo mã (seed V495) và dòng nhắn người lạ / bạn bè (V500). Kiểm đúng giá trị đã duyệt
// trước khi chép, khác thì dừng.
const BASE_ROWS = `p.error_code = '${BASE}' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL OR p.action_code = ANY (${sqlArr(ACTIONS)}))`

const COLS = `error_code, error_class, status_id, action_code, campaign_action_id, runtime_target, detail_mode, detail_status_id, sub_status_id,
  log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps,
  lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes,
  account_effect, login_effect, description, source`

// Ảnh chụp chính sách đã gộp và phân loại mã Zalo của mọi cặp (mã, thao tác) Zalo, cả hai nơi chạy; so trước / sau để chứng minh chỉ đúng
// hai cặp 112 × nhắn người lạ / bạn bè đổi. Bảng tạm (pg_temp) không làm PostgREST nạp lại schema.
const SNAPSHOT = name => `CREATE TEMP TABLE ${name}_policy ON COMMIT DROP AS
SELECT pair.error_code, pair.action_code, rt.t AS runtime_target,
       public.aka_agent_engine_resolve_policy(pair.error_code, NULL, pair.action_code, NULL, rt.t, 'after_send') - 'revisions' AS p
  FROM (SELECT DISTINCT r.error_code, a.code AS action_code
          FROM public.auto_outcome_signal_rules r
          JOIN public.auto_account_actions a ON (r.action_code IS NULL OR r.action_code = a.code)
         WHERE r.platform = 'zalo' AND r.is_active AND a.flatform_type = 'zalo') pair
 CROSS JOIN (VALUES ('desktop'), ('fly')) rt(t);
CREATE TEMP TABLE ${name}_class ON COMMIT DROP AS
SELECT z.code, a.code AS action_code, ph.p AS phase,
       (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a.code, ph.p, jsonb_build_object('kind', 'zalo_code', 'code', z.code)) cs) AS error_code
  FROM (SELECT DISTINCT r.pattern AS code FROM public.auto_outcome_signal_rules r
         WHERE r.platform = 'zalo' AND r.signal_kind = 'zalo_code' AND r.pattern <> '*' UNION SELECT '112') z
 CROSS JOIN (SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo') a
 CROSS JOIN (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p);
CREATE TEMP TABLE ${name}_lint ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;`

const UNCHANGED = (name, label, changedClassFilter) => `  SELECT count(*) INTO n FROM ${name}_policy b
   WHERE (public.aka_agent_engine_resolve_policy(b.error_code, NULL, b.action_code, NULL, b.runtime_target, 'after_send') - 'revisions') IS DISTINCT FROM b.p;
  IF n > 0 THEN RAISE EXCEPTION '${label}: % cặp (mã, thao tác) có sẵn bị đổi chính sách', n; END IF;
  SELECT count(*) INTO n FROM ${name}_class b
   WHERE NOT (${changedClassFilter})
     AND (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', b.action_code, b.phase, jsonb_build_object('kind', 'zalo_code', 'code', b.code)) cs)
         IS DISTINCT FROM b.error_code;
  IF n > 0 THEN RAISE EXCEPTION '${label}: % cặp (mã Zalo, thao tác, pha) khác bị đổi phân loại', n; END IF;
  SELECT count(*) INTO n FROM public.aka_agent_engine_policy_lint l
   WHERE NOT EXISTS (SELECT 1 FROM ${name}_lint b WHERE b.issue IS NOT DISTINCT FROM l.issue AND b.subject IS NOT DISTINCT FROM l.subject);
  IF n > 0 THEN RAISE EXCEPTION '${label}: % dòng lint mới', n; END IF;`

const IS_TARGET = `b.code = '112' AND b.action_code = ANY (${sqlArr(ACTIONS)})`

const migration = `-- V509: Zalo 112 khi nhắn người lạ / bạn bè xử lý như 118 "Nội dung quá dài" (12/11/2026, anh chốt; nhắn group giữ nguyên).
-- SINH TỪ scripts/build-v509-sql.cjs, không sửa tay.
--
-- Chỉ dữ liệu của engine v2:
--   * mã ${CODE} (error_type 'engine v2', Z112, content_config, không có mã Zalo nên bộ chạy cũ không khớp);
--   * 3 dòng auto_outcome_policies chép từ ${BASE} (theo mã, nhắn người lạ, nhắn bạn bè), đổi câu cho khách, source 'v509':
--     tạm dừng chiến dịch ngay, dừng lượt, data chưa gửi được gì về hàng đợi, không tính lượt, không đếm chuỗi;
--   * 2 luật auto_outcome_signal_rules: zalo_code 112 × zalo_message_stranger / zalo_message_friend → ${CODE}.
-- Không DDL (bảng tạm chỉ trong giao dịch), không đổi hàm. Nhắn group (112 = group từ chối) và mọi cặp khác giữ nguyên.
-- Gỡ: rollback_v509_zalo_personal_112_too_long.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE n integer; r record;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v509_%') THEN
      RAISE EXCEPTION 'V509 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = '${CODE}' AND error_type IS DISTINCT FROM 'engine v2') THEN
    RAISE EXCEPTION 'V509: mã ${CODE} đã có và không phải engine v2';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = '${CODE}' AND is_active AND NOT is_delete)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v509' OR (platform = 'zalo' AND signal_kind = 'zalo_code'
       AND pattern = '112' AND action_code = ANY (${sqlArr(ACTIONS)}) AND is_active)) THEN
    RAISE EXCEPTION 'V509: đã có chính sách hoặc luật 112 cho nhắn người lạ / bạn bè';
  END IF;
  -- Bản chép phải đúng như đã duyệt (seed V495 + V500 Q2/Q3).
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE ${BASE_ROWS};
  IF n <> 3 THEN RAISE EXCEPTION 'V509: cần đúng 3 dòng chính sách của ${BASE} (thấy %)', n; END IF;
  FOR r IN SELECT p.* FROM public.auto_outcome_policies p WHERE ${BASE_ROWS} LOOP
    IF r.action_code IS NULL AND (r.detail_mode IS DISTINCT FROM 'write' OR r.campaign_effect IS DISTINCT FROM 'pause'
       OR r.log_template IS DISTINCT FROM 'Nội dung quá dài') THEN
      RAISE EXCEPTION 'V509: dòng theo mã của ${BASE} khác bản đã đọc (id %)', r.id;
    END IF;
    IF r.action_code IS NOT NULL AND (r.detail_mode IS DISTINCT FROM 'suppress' OR r.quota_effect IS DISTINCT FROM 'no_count'
       OR r.target_streak_effect IS DISTINCT FROM 'ignore' OR r.target_effect IS DISTINCT FROM 'requeue'
       OR r.remaining_steps IS DISTINCT FROM 'skip' OR r.run_effect IS DISTINCT FROM 'stop_campaign') THEN
      RAISE EXCEPTION 'V509: dòng % × ${BASE} khác bản V500 (id %)', r.action_code, r.id;
    END IF;
  END LOOP;
END $pre$;

${SNAPSHOT('v509_before')}

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', '${CODE}', 'Nội dung quá dài (Zalo trả 112)',
  'V509 (engine v2): nhắn người lạ / bạn bè gặp 112 vì chữ quá dài, xử lý như 118', NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}',
  true, false, 'Z112', 'content_config', ${sqlText(TITLE)}, ${sqlText(HELP)})
ON CONFLICT (error_code) DO UPDATE SET is_active = true, is_delete = false, public_code = EXCLUDED.public_code, error_class = EXCLUDED.error_class,
  customer_title = EXCLUDED.customer_title, customer_help = EXCLUDED.customer_help
  WHERE public.auto_error.error_type = 'engine v2';

INSERT INTO public.auto_outcome_policies (${COLS})
SELECT '${CODE}', p.error_class, p.status_id, p.action_code, p.campaign_action_id, p.runtime_target, p.detail_mode, p.detail_status_id, p.sub_status_id,
       CASE WHEN p.action_code IS NULL THEN ${sqlText(TITLE)} ELSE p.log_template END,
       CASE WHEN p.action_code IS NULL THEN ${sqlText(NOTE)} ELSE p.campaign_note_template END,
       p.quota_effect, p.target_streak_effect, p.streak_threshold, p.target_effect, p.requeue_after_minutes, p.remaining_steps,
       p.lock_action_codes, p.lock_mode, p.lock_minutes, p.lock_days, p.lock_time, p.run_effect, p.pace_mode, p.pace_seconds, p.campaign_effect,
       p.campaign_hold_minutes, p.account_effect, p.login_effect,
       '[V509] Chép từ ${BASE} (id ' || p.id || '): 112 khi nhắn người lạ / bạn bè là chữ quá dài (đo 12/11/2026), xử lý như 118.', 'v509'
  FROM public.auto_outcome_policies p WHERE ${BASE_ROWS};

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
${ACTIONS.map(a => `  ('zalo', '${a}', NULL, 'zalo_code', '112', 10, '${CODE}', 'v509', '[V509] ${a === 'zalo_message_stranger' ? 'Nhắn người lạ' : 'Nhắn bạn bè'} gặp 112: chữ quá dài (741/743 lượt 112/118 có chữ trên 2.000 ký tự), xử lý như 118.')`).join(',\n')};

DO $post$
DECLARE n integer; t text; a text; v_new jsonb; v_base jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.auto_outcome_policies WHERE error_code = '${CODE}' AND source = 'v509' AND is_active AND NOT is_delete;
  IF n <> 3 THEN RAISE EXCEPTION 'V509 postflight: cần 3 dòng chính sách mới (thấy %)', n; END IF;
  FOREACH a IN ARRAY ${sqlArr(ACTIONS)} LOOP
    FOREACH t IN ARRAY ARRAY['before_send', 'in_flight', 'after_send'] LOOP
      IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, t, '{"kind": "zalo_code", "code": "112"}'::jsonb) cs)
         IS DISTINCT FROM '${CODE}' THEN
        RAISE EXCEPTION 'V509 postflight: 112 × % (%) chưa ra ${CODE}', a, t;
      END IF;
    END LOOP;
    FOREACH t IN ARRAY ARRAY['desktop', 'fly'] LOOP
      v_new := public.aka_agent_engine_resolve_policy('${CODE}', NULL, a, NULL, t, 'after_send');
      v_base := public.aka_agent_engine_resolve_policy('${BASE}', NULL, a, NULL, t, 'after_send');
      IF (v_new - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template') IS DISTINCT FROM
         (v_base - 'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template') THEN
        RAISE EXCEPTION 'V509 postflight: chính sách % (%) khác 118: % / %', a, t, v_new, v_base;
      END IF;
      IF v_new->>'log_template' IS DISTINCT FROM ${sqlText(TITLE)} OR v_new->>'campaign_note_template' IS DISTINCT FROM ${sqlText(NOTE)} THEN
        RAISE EXCEPTION 'V509 postflight: câu cho khách % (%) chưa đúng: %', a, t, v_new;
      END IF;
    END LOOP;
  END LOOP;
${UNCHANGED('v509_before', 'V509 postflight', IS_TARGET)}
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V509: xoá chính sách và luật source 'v509', tắt mã ${CODE} (không xoá dòng auto_error vì lịch sử có thể đã tham chiếu).
-- SINH TỪ scripts/build-v509-sql.cjs. Chỉ dữ liệu.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = 'v509') THEN
    RAISE EXCEPTION 'Gỡ V509: chưa có V509';
  END IF;
END $pre$;

${SNAPSHOT('v509_rollback_before')}

DELETE FROM public.auto_outcome_signal_rules WHERE source = 'v509';
DELETE FROM public.auto_outcome_policies WHERE source = 'v509';
UPDATE public.auto_error SET is_active = false, is_delete = true WHERE error_type = 'engine v2' AND error_code = '${CODE}';

DO $post$
DECLARE n integer; a text;
BEGIN
  FOREACH a IN ARRAY ${sqlArr(ACTIONS)} LOOP
    IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a, 'after_send', '{"kind": "zalo_code", "code": "112"}'::jsonb) cs)
       IS NOT DISTINCT FROM '${CODE}' THEN
      RAISE EXCEPTION 'Gỡ V509 postflight: 112 × % vẫn ra ${CODE}', a;
    END IF;
  END LOOP;
  -- Cặp của mã đã tắt không còn trong ảnh chụp sau (không còn luật trỏ tới), nên chỉ so các cặp còn lại.
  DELETE FROM v509_rollback_before_policy WHERE error_code = '${CODE}';
${UNCHANGED('v509_rollback_before', 'Gỡ V509 postflight', IS_TARGET)}
END $post$;

COMMIT;
`

module.exports = { migration, rollback, CODE, BASE, ACTIONS, TITLE, NOTE }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v509_zalo_personal_112_too_long.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v509_zalo_personal_112_too_long.sql'), rollback)
  console.log('V509 migration', md5(migration), 'rollback', md5(rollback))
}
