#!/usr/bin/env node
// Sinh migration V677 + bản gỡ (chỉ dữ liệu): mã EXC06 err_engine_zalo_profile_unavailable cho tín hiệu engine profile_unavailable của lõi
// (packages/campaign-engine/src/zalo/messagePhone.ts, bước opt_out): chiến dịch theo UID cần Zalo global ID để kiểm loại trừ gửi mà
// đọc hồ sơ Zalo của người nhận không ra. Trước đó ra EXC02 và data bị giữ "tạm dừng" từng cái một, không nghỉ (chiến dịch 63333 ngày
// 27/11/2026: tài khoản 1828 từ 11:55 VN không đọc được hồ sơ nào, 364 data bị giữ trong vài phút).
// Chính sách (anh chốt 27/11/2026): như EXC02 (data giữ "tạm dừng" kèm câu, không ghi lịch sử, không tính lượt, chạy data kế) nhưng cộng
// chuỗi lỗi, 4 data liền thì tạm dừng chiến dịch; không khoá tài khoản. Một người đọc hồ sơ hỏng lẻ thì chiến dịch chạy tiếp, cả tài khoản
// hỏng thì chỉ 4 data bị giữ. (Không chép NET01: data về hàng đợi được lượt sau lấy lại đầu tiên, nên một người hỏng lẻ cũng dừng chiến dịch.)
// Chưa có V677 thì tín hiệu lạ trước khi gửi rơi vào luật chung NET01 (data về hàng đợi), không giữ data, nên lõi mới chạy được trước V677.
// Chạy: node scripts/build-v677-sql.cjs   Kiểm: mục 8 của scripts/campaign-outcome-engine-v581-smoke.cjs
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ROOT = path.resolve(__dirname, '..')
const md5 = s => crypto.createHash('md5').update(s).digest('hex')

const NUMBER = 677
const NAME = 'migration_v677_zalo_profile_unavailable'
const ROLLBACK_NAME = 'rollback_v677_zalo_profile_unavailable'
const SOURCE = 'v677'
const BASE = 'err_engine_send_exclusion_unknown'
const SIGNAL = 'profile_unavailable'
const CODE = {
  code: 'err_engine_zalo_profile_unavailable', publicCode: 'EXC06', name: 'Không đọc được hồ sơ Zalo của người nhận',
  // Câu cho khách: anh duyệt 27/11/2026; không có câu bước tiếp theo.
  title: 'Chưa đọc được hồ sơ Zalo của người nhận nên chưa kiểm tra được điều kiện loại trừ gửi',
  help: null,
  desc: `V${NUMBER} (engine v2): chiến dịch theo UID cần Zalo global ID để kiểm loại trừ gửi mà đọc hồ sơ Zalo của người nhận không ra`
}

const sqlText = s => (s === null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`)
const COLS = `error_code, error_class, status_id, action_code, campaign_action_id, runtime_target, detail_mode, detail_status_id, sub_status_id,
  log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, requeue_after_minutes, remaining_steps,
  lock_action_codes, lock_mode, lock_minutes, lock_days, lock_time, run_effect, pace_mode, pace_seconds, campaign_effect, campaign_hold_minutes,
  account_effect, login_effect, description, source`
const BASE_ROWS = `p.error_code = '${BASE}' AND p.status_id IS NULL AND p.error_class IS NULL AND p.campaign_action_id IS NULL
     AND p.runtime_target IS NULL AND p.is_active AND NOT p.is_delete AND (p.action_code IS NULL OR p.action_code LIKE 'zalo\\_%')`
// Khác EXC02 đúng ba trường (chuỗi lỗi, ngưỡng, hiệu ứng chiến dịch) và câu.
const CHANGED = { target_streak_effect: 'increment', streak_threshold: 4, campaign_effect: 'pause' }
const TEXT_KEYS = `'revisions' - 'policy_ids' - 'log_template' - 'campaign_note_template'`
const MESSAGE_ACTIONS = `ARRAY['zalo_message_stranger', 'zalo_message_friend']`
const DIFF_KEYS = `${TEXT_KEYS} - 'target_streak_effect' - 'streak_threshold' - 'campaign_effect'`
const ACTIONS = `(SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo')`

const migration = `-- V${NUMBER} (27/11/2026): mã EXC06 "${CODE.name}" (${CODE.code}) cho tín hiệu engine '${SIGNAL}' của lõi.
-- Chỉ dữ liệu: 1 dòng auto_error, dòng auto_outcome_policies chép từ ${BASE} (EXC02) đổi câu và thêm cộng chuỗi lỗi, 4 data liền thì
-- tạm dừng chiến dịch (anh chốt 27/11/2026), 1 luật auto_outcome_signal_rules. Không thay hàm nào nên PostgREST không nạp lại schema. Sinh bằng: node scripts/build-v677-sql.cjs
-- Kiểm: mục 8 của scripts/campaign-outcome-engine-v581-smoke.cjs   Gỡ: migrations/${ROLLBACK_NAME}.sql
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
DECLARE n integer;
BEGIN
  -- Hai IF lồng: một biểu thức AND vẫn phân tích bảng sổ cả khi to_regclass trả NULL (DB không có sổ).
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration\\_v${NUMBER}\\_%') THEN
      RAISE EXCEPTION 'V${NUMBER} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE (error_code = '${CODE.code}' OR public_code = '${CODE.publicCode}') AND NOT is_delete) THEN
    RAISE EXCEPTION 'Đã có mã ${CODE.code} / ${CODE.publicCode}, dừng';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = '${CODE.code}' AND NOT is_delete)
     OR EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE platform = 'zalo' AND signal_kind = 'engine' AND pattern = '${SIGNAL}') THEN
    RAISE EXCEPTION 'Đã có chính sách hoặc luật cho mã mới, dừng';
  END IF;
  SELECT count(*) INTO n FROM public.auto_outcome_policies p WHERE ${BASE_ROWS};
  IF n < 1 THEN RAISE EXCEPTION 'Không thấy dòng chính sách của ${BASE} để chép'; END IF;
END $pre$;

CREATE TEMP TABLE v${NUMBER}_lint ON COMMIT DROP AS SELECT issue, subject FROM public.aka_agent_engine_policy_lint;

INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', '${CODE.code}', ${sqlText(CODE.name)}, ${sqlText(CODE.desc)}, NULL, NULL, '{}', false, false, 'fixed_minutes', '{}', '{}',
  true, false, '${CODE.publicCode}', (SELECT error_class FROM public.auto_error WHERE error_code = '${BASE}'), ${sqlText(CODE.title)}, ${sqlText(CODE.help)})
ON CONFLICT (error_code) DO UPDATE SET is_active = true, is_delete = false, public_code = EXCLUDED.public_code, error_class = EXCLUDED.error_class,
  error_name = EXCLUDED.error_name, error_desc = EXCLUDED.error_desc, customer_title = EXCLUDED.customer_title, customer_help = EXCLUDED.customer_help
  WHERE public.auto_error.error_type = 'engine v2';

INSERT INTO public.auto_outcome_policies (${COLS})
SELECT '${CODE.code}', p.error_class, p.status_id, p.action_code, p.campaign_action_id, p.runtime_target, p.detail_mode, p.detail_status_id, p.sub_status_id,
       ${sqlText(CODE.title)}, ${sqlText(CODE.title)},
       p.quota_effect, '${CHANGED.target_streak_effect}', ${CHANGED.streak_threshold}, p.target_effect, p.requeue_after_minutes, p.remaining_steps,
       p.lock_action_codes, p.lock_mode, p.lock_minutes, p.lock_days, p.lock_time, p.run_effect, p.pace_mode, p.pace_seconds, '${CHANGED.campaign_effect}',
       p.campaign_hold_minutes, p.account_effect, p.login_effect,
       '[V${NUMBER}] Chép từ ${BASE} (id ' || p.id || '): đọc hồ sơ Zalo không ra khi cần Global ID để kiểm loại trừ. Như EXC02 nhưng cộng chuỗi, 4 data liền thì tạm dừng chiến dịch (anh chốt 27/11/2026).', '${SOURCE}'
  FROM public.auto_outcome_policies p WHERE ${BASE_ROWS};

INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('zalo', NULL, NULL, 'engine', '${SIGNAL}', 10, '${CODE.code}', '${SOURCE}',
   '[V${NUMBER}] Lõi: chiến dịch theo UID cần Global ID để kiểm loại trừ gửi mà đọc hồ sơ Zalo của người nhận không ra.');

DO $post$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM ${ACTIONS} a(code), (VALUES ('before_send'), ('in_flight'), ('after_send')) ph(p)
   WHERE (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', a.code, ph.p, '{"kind": "engine", "code": "${SIGNAL}"}'::jsonb) cs)
         IS DISTINCT FROM '${CODE.code}';
  IF n > 0 THEN RAISE EXCEPTION 'Tín hiệu ${SIGNAL}: % cặp (thao tác, pha) không ra ${CODE.code}', n; END IF;
  SELECT count(*) INTO n FROM ${ACTIONS} a(code), (VALUES ('desktop'), ('fly'), ('server')) rt(t), (VALUES ('before_send'), ('after_send')) ph(p)
   WHERE (public.aka_agent_engine_resolve_policy('${CODE.code}', NULL, a.code, NULL, rt.t, ph.p) - ${DIFF_KEYS})
         IS DISTINCT FROM (public.aka_agent_engine_resolve_policy('${BASE}', NULL, a.code, NULL, rt.t, ph.p) - ${DIFF_KEYS});
  IF n > 0 THEN RAISE EXCEPTION '% cặp (thao tác, nơi chạy, pha) có chính sách khác ${BASE} ngoài câu và phần đã chốt', n; END IF;
  -- Lõi chỉ phát tín hiệu ở bước nhắn tin (gắn tag / đổi tên có dòng riêng của bước phụ, không cộng chuỗi).
  SELECT count(*) INTO n FROM unnest(${MESSAGE_ACTIONS}) a(code), (VALUES ('desktop'), ('fly'), ('server')) rt(t), (VALUES ('before_send'), ('after_send')) ph(p),
       LATERAL public.aka_agent_engine_resolve_policy('${CODE.code}', NULL, a.code, NULL, rt.t, ph.p) r
   WHERE r ->> 'target_streak_effect' IS DISTINCT FROM '${CHANGED.target_streak_effect}' OR r ->> 'streak_threshold' IS DISTINCT FROM '${CHANGED.streak_threshold}'
      OR r ->> 'campaign_effect' IS DISTINCT FROM '${CHANGED.campaign_effect}' OR r ->> 'target_effect' IS DISTINCT FROM 'hold';
  IF n > 0 THEN RAISE EXCEPTION 'Bước nhắn tin: % cặp chưa cộng chuỗi / tạm dừng sau 4 data / giữ data', n; END IF;
  SELECT count(*) INTO n FROM public.aka_agent_engine_policy_lint l
   WHERE NOT EXISTS (SELECT 1 FROM v${NUMBER}_lint b WHERE b.issue IS NOT DISTINCT FROM l.issue AND b.subject IS NOT DISTINCT FROM l.subject);
  IF n > 0 THEN RAISE EXCEPTION '% dòng lint mới', n; END IF;
END $post$;
COMMIT;
`

const rollback = `-- Gỡ V${NUMBER}: bỏ luật và chính sách của mã ${CODE.code}, tắt mã (tín hiệu ${SIGNAL} lại rơi vào luật chung NET01: data về hàng đợi).
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_signal_rules WHERE source = '${SOURCE}') THEN RAISE EXCEPTION 'Chưa có V${NUMBER}, không gỡ'; END IF;
END $pre$;
DELETE FROM public.auto_outcome_signal_rules WHERE source = '${SOURCE}';
DELETE FROM public.auto_outcome_policies WHERE source = '${SOURCE}';
UPDATE public.auto_error SET is_active = false, is_delete = true WHERE error_type = 'engine v2' AND error_code = '${CODE.code}';
DO $post$
BEGIN
  IF (SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', 'zalo_message_stranger', 'before_send', '{"kind": "engine", "code": "${SIGNAL}"}'::jsonb) cs)
     = '${CODE.code}' THEN RAISE EXCEPTION 'Gỡ V${NUMBER}: tín hiệu vẫn ra mã mới'; END IF;
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    DELETE FROM supabase_migrations.schema_migrations WHERE name = '${NAME}';
  END IF;
END $post$;
COMMIT;
`

module.exports = { NUMBER, NAME, ROLLBACK_NAME, SOURCE, SIGNAL, CODE, BASE, CHANGED, migration, rollback }

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations', NAME + '.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations', ROLLBACK_NAME + '.sql'), rollback)
  console.log(`V${NUMBER}: migration md5 ${md5(migration)}`)
}
