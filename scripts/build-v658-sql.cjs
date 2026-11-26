#!/usr/bin/env node
// V658: engine v2 Facebook, bản "[engine] fb_prepare_seeding_iterations" (block 2859, chỉ workflow 316 "[engine] facebook_comment_seeding"): mở nhóm
// mà Facebook chuyển sang trang xác minh (/checkpoint/…) hoặc trang đăng nhập (/login) thì trả đúng mã trạng thái đăng nhập (FB04 / FB43), không còn
// quét 0 bài rồi bị đóng bằng FB45 (câu 639 / 3300 / 6279 của bộ kiểm lỗi, 26/11/2026; anh chọn làm cả block lẫn mục 6a của bộ lập lịch Desktop).
//
// Đo trên production 18–26/11 (chỉ đọc; auto_engine_target_runs + vết bước auto_run_steps theo run_id):
//   - bước nav (block 2841) trả currentUrl là trang /checkpoint/, wait_main (2843) vẫn thấy vùng chính, prepare_iters (2859) quét 0 bài
//     (stopReason no_new_posts), vòng comment 0 lần, workflow xong không có kết quả → mục 6a của bộ lập lịch báo FB45 (chính sách 343: data
//     hoàn thành, không cộng chuỗi, tài khoản không đổi) nên tài khoản đang bị xác minh nhận hết data này tới data khác;
//   - 21/11: 1.403 lượt FB45 comment ở trang xác minh (tài khoản 9717, 7998); 23/11: chiến dịch 51619 ~700 data; 24–25/11: chiến dịch 60581
//     (tài khoản 12249, app 10.6.0) 1.748 data liên tiếp. Bản sửa câu 533 (V607 + bộ lập lịch 10.3.0) không phủ vì không block nào lỗi / trả mã.
//
// Sửa (một chỗ, đầu thân block, trước khi đọc element / cuộn / quét): đọc location.href; đường dẫn /checkpoint|challenge|two_step_verification|
// two_factor|recover|confirmemail/ → err_fb_checkpoint (FB04, chính sách 281), /login → err_engine_fb_logged_out (FB43, chính sách 341); trả
// actionResult chưa gửi (operationState not_committed) cùng 0 bài để vòng comment không chạy. Host nhận mã block trả thẳng làm tín hiệu
// (detailInputOutcome, có từ 9.9.0) nên có hiệu lực ngay ở mọi bản app chạy engine. Trang khác: code chạy y như bản V641.
// Bộ cũ (block 2554) không đổi, như V563 / V572 / V598 / V607 chỉ sửa bản engine; sổ chép block giữ nguyên (như V598 / V607).
//
// Nguồn guard: scripts/fixtures/engine-v2-facebook/v658-live-20261126.json (đọc chỉ đọc production 26/11). Code cũ = bản V641
// (scripts/fixtures/fb-ai-filter/blocks-v641.json, md5 = block 2859 production). Phần code mới: scripts/engine-v2-facebook/v658-checkpoint.fragment.js.
// Code block không ghi số migration (đổi số không đổi md5 code); kiểm lại sổ ngay trước khi apply.
// Chạy: node scripts/build-v658-sql.cjs (ghi migration + bản gỡ).
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v658-live-20261126.json'), 'utf8'))
const V641 = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/fb-ai-filter/blocks-v641.json'), 'utf8'))
const OLD_CODE = (V641.blocks.find(block => block.id === 2859) || {}).code
const FRAGMENT = fs.readFileSync(path.join(ROOT, 'scripts/engine-v2-facebook/v658-checkpoint.fragment.js'), 'utf8')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const NAME = 'migration_v658_engine_facebook_seeding_checkpoint'
const ROLLBACK_NAME = 'rollback_v658_engine_facebook_seeding_checkpoint'
if (typeof OLD_CODE !== 'string') throw new Error('Không thấy code block 2859 trong blocks-v641.json')
const OLD_MD5 = md5(OLD_CODE)
if (OLD_MD5 !== LIVE.block.md5) throw new Error(`Code V641 (${OLD_MD5}) khác block ${LIVE.block.id} production đọc 26/11 (${LIVE.block.md5})`)
if (LIVE.block.id !== 2859 || LIVE.block.name !== '[engine] fb_prepare_seeding_iterations') throw new Error('Fixture: block engine khác 2859')
if (LIVE.source.id !== 2554 || LIVE.source.md5 !== '091f57483369c8b03fea65e9eba0390c') throw new Error('Fixture: block bộ cũ 2554 khác bản V641')
if (LIVE.copy.engineBlockId !== LIVE.block.id || LIVE.copy.sourceBlockId !== LIVE.source.id) throw new Error('Fixture: sổ chép block khác 2554 → 2859')
if (LIVE.steps.length !== 0) throw new Error('Fixture: block 2859 có dòng danh mục bước (bản đọc 26/11 không có)')
if (JSON.stringify(LIVE.workflowsUsing) !== '[316]') throw new Error('Fixture: block 2859 không chỉ workflow 316 dùng')
const CHECKPOINT_CODE = 'err_fb_checkpoint'
const LOGGED_OUT_CODE = 'err_engine_fb_logged_out'
for (const [code, publicCode, login] of [[CHECKPOINT_CODE, 'FB04', 'checkpoint'], [LOGGED_OUT_CODE, 'FB43', 'logged_out']]) {
  if (!LIVE.errors.some(e => e.errorCode === code && e.publicCode === publicCode && e.active)) throw new Error(`Fixture: thiếu mã ${code} (${publicCode})`)
  const policies = LIVE.policies.filter(p => p.errorCode === code && p.active)
  if (policies.length !== 1 || policies[0].targetEffect !== 'requeue' || policies[0].loginEffect !== login || policies[0].streak !== 'ignore'
    || policies[0].actionCode || policies[0].campaignActionId) throw new Error(`Fixture: chính sách của ${code} khác bản đã đọc (một dòng chung, về hàng đợi, ${login})`)
}
for (const name of ['MAX_SCANNED_POSTS', 'MAX_SCROLL_CYCLES', 'MAX_NO_GROWTH_CYCLES']) {
  const at = OLD_CODE.indexOf(`const ${name} =`)
  if (at < 0 || at > OLD_CODE.indexOf('const selectors = {')) throw new Error(`Code cũ: ${name} phải khai báo trước chỗ chèn`)
}

const ANCHOR = "const selectors = {\n  posts: await helpers.element('fb_post_in_uid'),\n"
const EDITS = [
  {
    why: 'trang xác minh / đăng nhập: trả FB04 / FB43 trước khi đọc element và quét bài',
    from: ANCHOR,
    to: FRAGMENT + ANCHOR
  }
]

let code = OLD_CODE
for (const edit of EDITS) {
  const count = code.split(edit.from).length - 1
  if (count !== 1) throw new Error(`Sửa "${edit.why}": tìm thấy ${count} chỗ, cần đúng 1`)
  code = code.replace(edit.from, () => edit.to)
}
const NEW_CODE = code
const NEW_MD5 = md5(NEW_CODE)
const TAG = '$v658_seeding$'
if (OLD_CODE.includes(TAG) || NEW_CODE.includes(TAG)) throw new Error('Code block chứa thẻ dollar-quote')
if (NEW_CODE.normalize('NFC') !== NEW_CODE) throw new Error('Code block mới có chữ không ở dạng NFC')
// Code block phải dựng được thành hàm async (đúng cách workflowEngine chạy block).
try {
  new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${NEW_CODE}\n})`)
} catch (error) {
  throw new Error(`Code block mới không hợp lệ: ${error.message}`)
}

const BLOCK = LIVE.block
const SOURCE = LIVE.source
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`
const codesGuard = `SELECT count(*) INTO v_n FROM public.auto_error WHERE error_code IN ('${CHECKPOINT_CODE}', '${LOGGED_OUT_CODE}') AND is_active AND NOT is_delete;
  IF v_n <> 2 THEN RAISE EXCEPTION 'V658: mã ${CHECKPOINT_CODE} / ${LOGGED_OUT_CODE} chưa có hoặc đang tắt trong auto_error (cần V559)'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE error_code IN ('${CHECKPOINT_CODE}', '${LOGGED_OUT_CODE}') AND is_active
     AND action_code IS NULL AND campaign_action_id IS NULL AND target_effect = 'requeue';
  IF v_n <> 2 THEN RAISE EXCEPTION 'V658: chính sách chung (về hàng đợi) của ${CHECKPOINT_CODE} / ${LOGGED_OUT_CODE} khác bản đã đọc'; END IF;`

const migration = `-- V658: engine v2 Facebook, bản "[engine] fb_prepare_seeding_iterations" (block ${BLOCK.id}, chỉ workflow 316 comment seeding): mở nhóm mà Facebook
-- chuyển sang trang xác minh (/checkpoint/…) thì trả err_fb_checkpoint (FB04), trang đăng nhập (/login) thì err_engine_fb_logged_out (FB43), thay cho
-- quét 0 bài rồi bị đóng bằng FB45 (câu 639 / 3300 / 6279 của bộ kiểm lỗi, 26/11/2026; Q6). Chính sách FB04 / FB43 có sẵn (V559): data chưa gửi về
-- hàng đợi, tài khoản đổi trạng thái đăng nhập, không cộng chuỗi. Chỉ sửa code block engine; bộ cũ (block ${SOURCE.id}) và sổ chép block không đổi.
-- SINH TỪ scripts/build-v658-sql.cjs (nguồn guard: scripts/fixtures/engine-v2-facebook/v658-live-20261126.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc code block mỗi lượt. Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v658_%') THEN
      RAISE EXCEPTION 'V658 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regclass('public.auto_engine_block_steps') IS NULL THEN
    RAISE EXCEPTION 'V658 cần V556–V560 (sổ chép block, danh mục bước)';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE b.id = ${BLOCK.id} AND b.name = ${sqlText(BLOCK.name)} AND c.source_block_id = ${SOURCE.id} AND md5(b.code) = '${OLD_MD5}';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V658: block ${BLOCK.id} không còn đúng bản production (md5 ${OLD_MD5}), đọc lại và sinh lại'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id};
  IF v_n <> 0 THEN RAISE EXCEPTION 'V658: block ${BLOCK.id} đã có % dòng danh mục bước (bản đọc không có), đọc lại', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${SOURCE.id} AND md5(code) = '${SOURCE.md5}') THEN
    RAISE EXCEPTION 'V658: block bộ cũ ${SOURCE.id} khác bản đã đọc';
  END IF;
  ${codesGuard}
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${NEW_CODE}${TAG}, updated_at = now()
 WHERE id = ${BLOCK.id} AND md5(code) = '${OLD_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V658 postflight: code block ${BLOCK.id} không phải bản mới (md5 ${NEW_MD5})';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${SOURCE.id} AND md5(code) = '${SOURCE.md5}') THEN
    RAISE EXCEPTION 'V658 postflight: block bộ cũ ${SOURCE.id} đã đổi (V658 không được đụng bộ cũ)';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V658: trả bản "[engine] fb_prepare_seeding_iterations" (block ${BLOCK.id}) về bản production trước V658 (bản V641, md5 ${OLD_MD5}). Chỉ chạy
-- khi block đang đúng bản V658 (đã ai sửa sau V658 thì dừng, không ghi đè). Bộ cũ không đổi. SINH TỪ scripts/build-v658-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V658: block ${BLOCK.id} không phải bản V658 (md5 ${NEW_MD5}), không ghi đè';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${OLD_CODE}${TAG}, updated_at = now()
 WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${OLD_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V658 postflight: block ${BLOCK.id} chưa về bản trước V658';
  END IF;
END $post$;

COMMIT;
`

module.exports = { NAME, ROLLBACK_NAME, LIVE, EDITS, OLD_CODE, NEW_CODE, OLD_MD5, NEW_MD5, CHECKPOINT_CODE, LOGGED_OUT_CODE, migration, rollback }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`V658: block ${BLOCK.id} ${OLD_MD5} → ${NEW_MD5}; migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
