#!/usr/bin/env node
// V617: đăng bài nhóm ẩn danh, có công tắc "Đăng ẩn danh" mà app bấm (và bấm OK) 15 giây vẫn không bật được (thường do Facebook đổi cách bật)
// thì trả mã riêng FB52 thay cho lỗi chung SYS99 (anh yêu cầu 21/11/2026 "nếu fb đổi cách bật công tắc thì phải trả mã lỗi rõ ràng"; anh duyệt qua
// hộp chọn: câu "Không bật được chế độ đăng bài ẩn danh"; data về hàng đợi, không tính lượt, cộng chuỗi lỗi, 4 data liền thì tạm dừng chiến dịch).
// Chính sách chép đúng FB49 ở đăng nhóm (thất bại, requeue, increment, ngưỡng chung). Không thấy công tắc vẫn là FB51 như V616 (hai mã phân biệt
// bằng việc có công tắc hay không). Block trả ok: false để engine chụp ảnh + DOM lỗi.
//
// Chỉ dữ liệu: block 2923 "[engine] fb_enable_group_anonymous_post" (V616) đổi code, thêm 1 mã + 1 chính sách. Code block:
// scripts/engine-v2-facebook/group-anonymous-block.fragment.js (bản V616 đóng băng ở v616/). Nguồn guard:
// scripts/fixtures/engine-v2-facebook/v617-live-20261121.json (đọc chỉ đọc production 21/11 18:31 VN).
// Chạy: node scripts/build-v617-sql.cjs (ghi migration + bản gỡ); --check chỉ kiểm file đang có khớp bộ sinh.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const V616 = require('./build-v616-sql.cjs')

const ROOT = path.resolve(__dirname, '..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v617-live-20261121.json'), 'utf8'))
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const lit = value => value == null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`

const NAME = 'migration_v617_engine_facebook_group_post_anonymous_switch'
const ROLLBACK_NAME = 'rollback_v617_engine_facebook_group_post_anonymous_switch'
const SOURCE = 'v617'
const ACTION = 'fb_post_group'
const CAMPAIGN_ACTION = 'facebook_group_post'
const PHASES = ['before_send', 'in_flight', 'after_send']
const FB52 = { code: 'err_fb_group_anonymous_switch_not_enabled', pub: 'FB52', cls: 'ui_changed', title: 'Không bật được chế độ đăng bài ẩn danh',
  scope: 'Đăng nhóm bật "Đăng bài ẩn danh": có công tắc "Đăng ẩn danh" nhưng bấm (và bấm OK) 15 giây vẫn không bật được.' }
const FB49_CODE = 'err_fb_group_post_upload_failed'

// ----- Kiểm nguồn -----
const BLOCK = LIVE.block
if (BLOCK.id !== 2923 || BLOCK.name !== V616.BLOCK_NAME || BLOCK.md5 !== V616.BLOCK_MD5) throw new Error('Fixture: block 2923 không phải bản V616')
if (LIVE.maxFb !== 51 || LIVE.codeTaken !== 0) throw new Error('Fixture: mã FB lớn nhất không phải FB51 hoặc FB52 đã có')
for (const ph of PHASES) {
  const p = LIVE.fb49Resolved[ph]
  if (p.detail_status_id !== 21 || p.detail_mode !== 'write' || p.quota_effect !== 'no_count' || p.target_streak_effect !== 'increment'
    || p.target_effect !== 'requeue' || p.campaign_effect !== 'none' || p.log_template !== '{message}') throw new Error(`Fixture: FB49 (${ph}) khác bản đọc 21/11`)
}
const OLD_CODE = V616.BLOCK_CODE
const NEW_CODE = '\n' + fs.readFileSync(path.join(ROOT, 'scripts/engine-v2-facebook/group-anonymous-block.fragment.js'), 'utf8').replace(/\n+$/, '') + '\n'
const NEW_MD5 = md5(NEW_CODE)
if (NEW_MD5 === V616.BLOCK_MD5) throw new Error('Code block chưa đổi')
if (!NEW_CODE.includes(`'${FB52.code}'`) || !NEW_CODE.includes(`'${FB52.title}'`) || NEW_CODE.includes('throw new Error')) throw new Error('Block không trả đúng FB52')
const TAG = '$v617_block$'
if (NEW_CODE.includes(TAG) || OLD_CODE.includes(TAG)) throw new Error('Code block chứa thẻ dollar-quote')
try { new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${NEW_CODE}\n})`) } catch (error) {
  throw new Error(`Code block không hợp lệ: ${error.message}`)
}

// ----- Mã + chính sách (= FB49 ở đăng nhóm) -----
const POLICY = {
  error_code: FB52.code, action_code: ACTION, campaign_action_id: null, detail_status_id: 21, detail_mode: 'write', log_template: '{message}',
  campaign_note_template: null, quota_effect: 'no_count', target_streak_effect: 'increment', streak_threshold: null, target_effect: 'requeue',
  remaining_steps: 'skip', lock_action_codes: [], lock_mode: 'fixed_minutes', run_effect: 'continue', pace_mode: 'full', campaign_effect: 'none',
  account_effect: 'none', login_effect: 'none', source: SOURCE,
  description: '[anh chốt 21/11/2026] FB52 đăng nhóm ẩn danh: có công tắc mà không bật được; ghi thất bại, không tính lượt, cộng chuỗi, data về hàng đợi (như FB49; 4 data liền thì tạm dừng theo ngưỡng chung).'
}
const POLICY_COLUMNS = Object.keys(POLICY)
const policyValues = POLICY_COLUMNS.map(col => {
  const v = POLICY[col]
  if (v === undefined || v === null) return 'NULL'
  if (Array.isArray(v)) return v.length ? `ARRAY[${v.map(lit).join(', ')}]::text[]` : 'ARRAY[]::text[]'
  return typeof v === 'number' ? String(v) : lit(v)
}).join(', ')
const CODES_POLICIES_SQL = `INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', ${lit(FB52.code)}, ${lit(FB52.title)}, ${lit(`V617 (engine v2): ${FB52.scope}`)}, NULL, NULL, '{}', false, false, 'fixed_minutes',
  '{}', '{}', true, false, ${lit(FB52.pub)}, ${lit(FB52.cls)}, ${lit(FB52.title)}, NULL);

INSERT INTO public.auto_outcome_policies (${POLICY_COLUMNS.join(', ')}) VALUES
  (${policyValues});
`
// So với FB49 bỏ lớp lỗi và requeue_after_minutes: dòng chung của lớp ui_changed (seed_v495_class) có requeue_after_minutes 60, nhưng
// report_v1 chỉ dùng trường này khi target_effect = 'requeue_after'; FB52 là 'requeue' (data về hàng đợi ngay như FB49).
const resolveSql = (code, phase) =>
  `public.aka_agent_engine_resolve_policy(${lit(code)}, NULL, ${lit(ACTION)}, ${lit(CAMPAIGN_ACTION)}, 'desktop', ${lit(phase)}) - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes'`
const policyChecks = PHASES.map(phase => `
  IF (${resolveSql(FB52.code, phase)}) IS DISTINCT FROM (${resolveSql(FB49_CODE, phase)})
     OR (${resolveSql(FB52.code, phase)})->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V617 postflight: chính sách FB52 (%) khác FB49: % / %', ${lit(phase)}, ${resolveSql(FB52.code, phase)}, ${resolveSql(FB49_CODE, phase)};
  END IF;`).join('')
const SIGNAL = { kind: 'block', code: FB52.code, errorCode: FB52.code, message: FB52.title }

const migration = `-- V617: đăng bài nhóm ẩn danh, có công tắc "Đăng ẩn danh" mà không bật được (Facebook đổi cách bật) thì trả mã ${FB52.pub} ${FB52.code}
-- "${FB52.title}" thay cho SYS99 (anh chốt 21/11/2026): ghi thất bại, không tính lượt, cộng chuỗi, data về hàng đợi (như FB49; 4 data liền thì
-- tạm dừng chiến dịch theo ngưỡng chung). Block ${BLOCK.id} "${BLOCK.name}" đổi code (bản V616 → bản trả FB52, ok: false để có ảnh + DOM lỗi).
-- Không thấy công tắc vẫn là FB51 (V616). SINH TỪ scripts/build-v617-sql.cjs (nguồn guard v617-live-20261121.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc block mỗi lần mở unit. Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v617_%') THEN
      RAISE EXCEPTION 'V617: sổ migration đã có V617, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND name = ${lit(BLOCK.name)} AND md5(code) = '${BLOCK.md5}') THEN
    RAISE EXCEPTION 'V617: block ${BLOCK.id} khác bản V616 (md5 ${BLOCK.md5}), đọc lại và sinh lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB52.code)} OR public_code = ${lit(FB52.pub)}) THEN
    RAISE EXCEPTION 'V617: mã ${FB52.code} / ${FB52.pub} đã có';
  END IF;
  IF (SELECT max(substring(public_code from 3)::int) FROM public.auto_error WHERE public_code ~ '^FB[0-9]+$') IS DISTINCT FROM ${LIVE.maxFb} THEN
    RAISE EXCEPTION 'V617: mã FB lớn nhất không còn là FB${LIVE.maxFb}, đọc lại và sinh lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = ${lit(FB52.code)}) THEN
    RAISE EXCEPTION 'V617: đã có chính sách cho ${FB52.code}';
  END IF;
END $pre$;

-- 1. Block ${BLOCK.id}: không bật được công tắc thì trả FB52 (không ném lỗi).
UPDATE public.auto_blocks SET code = ${TAG}${NEW_CODE}${TAG}, updated_at = now()
 WHERE id = ${BLOCK.id} AND md5(code) = '${BLOCK.md5}';

-- 2. Mã ${FB52.pub} + chính sách ở đăng nhóm.
${CODES_POLICIES_SQL}
DO $post$
DECLARE v_text text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V617 postflight: block ${BLOCK.id} không phải bản mới (md5 ${NEW_MD5})';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB52.code)} AND public_code = ${lit(FB52.pub)} AND is_active
                    AND customer_title = ${lit(FB52.title)} AND error_class = ${lit(FB52.cls)}) THEN
    RAISE EXCEPTION 'V617 postflight: mã ${FB52.pub} không đúng';
  END IF;
${policyChecks}
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', ${lit(ACTION)}, 'before_send', ${lit(JSON.stringify(SIGNAL))}::jsonb) c;
  IF v_text IS DISTINCT FROM ${lit(FB52.code)} THEN RAISE EXCEPTION 'V617 postflight: tín hiệu FB52 ra %', v_text; END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V617: block ${BLOCK.id} về code V616 (không bật được công tắc thì ném lỗi → SYS99), mã ${FB52.pub} và chính sách chỉ bị tắt. Chỉ chạy khi
-- block đang đúng bản V617 (đã ai sửa sau V617 thì dừng, không ghi đè). SINH TỪ scripts/build-v617-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V617: block ${BLOCK.id} không phải bản V617 (md5 ${NEW_MD5}), không ghi đè';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${OLD_CODE}${TAG}, updated_at = now() WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}';
UPDATE public.auto_outcome_policies SET is_active = false, updated_at = now() WHERE error_code = ${lit(FB52.code)} AND source = ${lit(SOURCE)};
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code = ${lit(FB52.code)};

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${BLOCK.md5}') THEN
    RAISE EXCEPTION 'Gỡ V617 postflight: block ${BLOCK.id} chưa về code V616';
  END IF;
END $post$;

COMMIT;
`

module.exports = { NAME, ROLLBACK_NAME, LIVE, FB52, FB49_CODE, POLICY, PHASES, BLOCK, OLD_CODE, NEW_CODE, NEW_MD5, CODES_POLICIES_SQL, migration, rollback }
if (require.main === module) {
  const files = [[`migrations/${NAME}.sql`, migration], [`migrations/${ROLLBACK_NAME}.sql`, rollback]]
  if (process.argv.includes('--check')) {
    for (const [file, text] of files) {
      if (fs.readFileSync(path.join(ROOT, file), 'utf8') !== text) { console.error(`${file} khác bản sinh`); process.exit(1) }
    }
    console.log('V617: file khớp bộ sinh')
  } else {
    for (const [file, text] of files) fs.writeFileSync(path.join(ROOT, file), text)
  }
  console.log(`V617: block ${BLOCK.md5} → ${NEW_MD5}; migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
