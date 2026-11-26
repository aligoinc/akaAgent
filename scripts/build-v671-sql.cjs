#!/usr/bin/env node
// Sinh migration V671 (anh đồng ý 26/11/2026 sau kiểm thử lặp Cách A, mục 10.1 của docs/ZALO_TAG_AUTO_SEND_PLAN.md): khoá thao tác của tài
// khoản trong aka_agent_engine_report_v1 không còn bị khoá đến sau ghi đè khi khoá đang có còn hiệu lực và dài hơn.
//   Trước V671: ON CONFLICT ... SET date_enable = EXCLUDED.date_enable (lỗi đến sau thắng). Đo production 22–26/11: 6 / 219 khoá 120 / 802
//   "Nhắn tin người lạ" (tới 09:45 hôm sau / sau 2 ngày) bị một lỗi mạng (NET01, 5 phút) đè, 1 lần tài khoản gửi lại người lạ trong lúc Zalo
//   còn cấm và gặp lại 120 / 802. Cách A (nhắn tin bạn bè gửi cả người chưa là bạn) làm chuyện này dễ gặp hơn.
//   Sau V671: giữ nguyên cả dòng khoá (giờ mở, mã, câu, lúc khoá) khi khoá đang có còn hiệu lực (is_disable, date_enable NULL = không thời hạn
//   hoặc > giờ hiện tại) và dài hơn khoá mới. Khoá mới không thời hạn (date_enable NULL) luôn được ghi; khoá đang có đã hết hạn luôn bị thay.
//   Không đổi chỗ khác: giờ hẹn lại data và câu "tới {until}" của lượt này vẫn theo khoá của chính lỗi này (lượt nhận sau vẫn chờ theo khoá
//   dài hơn vì claim đọc auto_account_action_status).
//   Chỉ thay thân hàm (CREATE OR REPLACE: PostgREST nạp lại schema, apply ngoài giờ cao điểm). Bộ chạy cũ (Desktop / App Server / ChatApi) không đổi.
//   node scripts/build-v671-sql.cjs   → migrations/migration_v671_engine_action_lock_keep_longer.sql + rollback
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const v659 = require('./build-v659-sql.cjs')

const ROOT = path.resolve(__dirname, '..')
const NAME = 'migration_v671_engine_action_lock_keep_longer'
const ROLLBACK_NAME = 'rollback_v671_engine_action_lock_keep_longer'
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const lit = text => `'${String(text).replace(/'/g, "''")}'`

const SIG = v659.REPORT_SIG
// Thân production đọc 26/11/2026 (md5 = bản sau V659): dựng lại từ bản sao danh mục + đoạn vá V659.
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/engine-catalog-20261126.json'), 'utf8'))
const BEFORE_DEF = CATALOG.functions.find(f => f.name === 'aka_agent_engine_report_v1').def.replace(v659.REPORT_OLD, v659.REPORT_NEW)
const BEFORE_MD5 = 'b39e1e9dbcab4775d96779bd4799b63a'
if (md5(BEFORE_DEF) !== BEFORE_MD5 || v659.REPORT_AFTER_MD5 !== BEFORE_MD5) throw new Error('Thân report_v1 dựng lại khác production 26/11')

const OLD = `            ON CONFLICT (account_id, action_code) DO UPDATE SET is_disable = true, date_enable = EXCLUDED.date_enable,
              disabled_error_code = EXCLUDED.disabled_error_code, disabled_reason = EXCLUDED.disabled_reason, disabled_at = EXCLUDED.disabled_at, updated_at = v_now;`
const NEW = `            ON CONFLICT (account_id, action_code) DO UPDATE SET is_disable = true, date_enable = EXCLUDED.date_enable,
              disabled_error_code = EXCLUDED.disabled_error_code, disabled_reason = EXCLUDED.disabled_reason, disabled_at = EXCLUDED.disabled_at, updated_at = v_now
            -- V671: khoá đang có còn hiệu lực và dài hơn (kể cả không thời hạn) thì giữ nguyên, khoá đến sau không ghi đè.
            WHERE NOT coalesce(s.is_disable AND EXCLUDED.date_enable IS NOT NULL
                               AND (s.date_enable IS NULL OR (s.date_enable > v_now AND s.date_enable > EXCLUDED.date_enable)), false);`
if (BEFORE_DEF.split(OLD).length !== 2) throw new Error('Đoạn ghi khoá report_v1 không còn đúng một chỗ')
const AFTER_DEF = BEFORE_DEF.replace(OLD, NEW)
const AFTER_MD5 = md5(AFTER_DEF)

const patch = (from, to, beforeMd5, afterMd5, label) => `DO $${label}$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('${SIG}'::regprocedure);
  IF md5(v_def) IS DISTINCT FROM '${beforeMd5}' THEN RAISE EXCEPTION 'V671: aka_agent_engine_report_v1 đã đổi (md5 %)', md5(v_def); END IF;
  IF array_length(string_to_array(v_def, ${lit(from)}), 1) <> 2 THEN RAISE EXCEPTION 'V671: đoạn ghi khoá không đúng một chỗ'; END IF;
  v_new := replace(v_def, ${lit(from)}, ${lit(to)});
  IF md5(v_new) IS DISTINCT FROM '${afterMd5}' THEN RAISE EXCEPTION 'V671: thân report_v1 sau vá lệch (md5 %)', md5(v_new); END IF;
  EXECUTE v_new;
  IF md5(pg_get_functiondef('${SIG}'::regprocedure)) IS DISTINCT FROM '${afterMd5}' THEN RAISE EXCEPTION 'V671: thân report_v1 sau khi tạo lại lệch'; END IF;
END $${label}$;`

const header = title => `-- ${title}
-- Sinh bằng: node scripts/build-v671-sql.cjs (không sửa tay). aka_agent_engine_report_v1 md5 ${BEFORE_MD5} → ${AFTER_MD5}.
-- Khoá thao tác đến sau không ghi đè khoá đang còn hiệu lực và dài hơn (kể cả khoá không thời hạn). CREATE OR REPLACE: apply ngoài giờ cao điểm.
`
const migration = `${header('V671: engine giữ khoá thao tác dài hơn khi lỗi mới khoá ngắn hơn')}BEGIN;
SET LOCAL lock_timeout = '5s';
DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration\\_v671\\_%') THEN
    RAISE EXCEPTION 'V671: số 671 đã có trong sổ migration';
  END IF;
END $pre$;

${patch(OLD, NEW, BEFORE_MD5, AFTER_MD5, 'patch')}
COMMIT;
`
const rollback = `${header('Gỡ V671: trả aka_agent_engine_report_v1 về bản V659 (khoá đến sau ghi đè)')}BEGIN;
SET LOCAL lock_timeout = '5s';
${patch(NEW, OLD, AFTER_MD5, BEFORE_MD5, 'unpatch')}
COMMIT;
`

if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations', `${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations', `${ROLLBACK_NAME}.sql`), rollback)
  console.log(`${NAME}.sql md5 ${md5(migration)}; rollback md5 ${md5(rollback)}; report_v1 ${BEFORE_MD5} → ${AFTER_MD5}`)
}

module.exports = { NAME, ROLLBACK_NAME, SIG, BEFORE_DEF, BEFORE_MD5, AFTER_DEF, AFTER_MD5, OLD, NEW, migration, rollback }
