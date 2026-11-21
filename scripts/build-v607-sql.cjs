#!/usr/bin/env node
// V607: engine v2 Facebook, bản "[engine] fb_comment_current_post" (block 2869, workflow 317 "comment vào bài post" / Up tin): link bài mở ra trang
// xác minh của Facebook (/checkpoint/) hoặc trang đăng nhập (/login) thì trả đúng mã trạng thái đăng nhập (FB04 / FB43), không còn FB41 "không
// thấy ô bình luận" (câu 533 / 602 của bộ kiểm lỗi, 21/11/2026; anh chọn làm cả block lẫn bộ lập lịch Desktop).
//
// Đo trên production 18–20/11 (chỉ đọc; private.auto_engine_error_items theo khoá ca, vết bước comment_current_post của lượt mẫu):
//   - 31 lượt, 4 tổ chức, 8 tài khoản, 16 chiến dịch; 6 lần dừng chiến dịch (4 chiến dịch tổ chức 1370 còn tạm dừng sáng 21/11);
//   - bước nav trả currentUrl là trang /checkpoint/, block 2869 nhận ra (reason checkpoint) nhưng trả errorCode err_fb_comment_box_not_found:
//     chính sách 339 (FB41) đóng data, cộng chuỗi, không đổi trạng thái đăng nhập, nên tài khoản đang bị xác minh vẫn được giao data liên tục;
//   - 31 data đều "hoàn thành", 8 tài khoản vẫn "đã đăng nhập"; engine chưa ra lượt err_fb_checkpoint / err_engine_fb_logged_out nào (4 ngày).
//
// Sửa (hai nhánh xét URL đầu classifyCommentPage, trước mọi luật câu chữ V472 và nhánh /pending_posts/ V598, nên FB15 / FB17 không đổi):
//   - /checkpoint/ → err_fb_checkpoint (FB04, chính sách 281: data chưa gửi về hàng đợi, tài khoản "checkpoint", dừng tài khoản ở lượt này,
//     không cộng chuỗi, không ghi lịch sử) đúng như Q6 (16/11);
//   - /login → err_engine_fb_logged_out (FB43, chính sách 341: như trên, tài khoản "chưa đăng nhập"), mã đăng xuất Q6 / V559.
//   Câu của block (data.reason, message) giữ nguyên; không đổi chính sách, câu cho khách, element. Host Desktop nhận mã block trả thẳng làm tín
//   hiệu (detailInputOutcome, có từ 9.9.0) và DB nhận mã trực tiếp có trong auto_error, nên có hiệu lực ngay ở mọi bản app chạy engine.
// Bộ cũ (block 2616, workflow 207 / 244, máy Desktop < 9.9.0) không đổi, như V563 / V572 / V598 chỉ sửa bản engine.
//
// Nguồn guard: scripts/fixtures/engine-v2-facebook/v607-live-20261121.json (đọc chỉ đọc production 21/11). Code cũ = bản V598
// (scripts/build-v598-sql.cjs NEW_CODE, md5 = block 2869 production). Code block không ghi số migration (đổi số không đổi md5 code); kiểm lại sổ
// ngay trước khi apply. Chạy: node scripts/build-v607-sql.cjs (ghi migration + bản gỡ).
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v607-live-20261121.json'), 'utf8'))
const OLD_CODE = require('./build-v598-sql.cjs').NEW_CODE
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const NAME = 'migration_v607_engine_facebook_comment_checkpoint'
const ROLLBACK_NAME = 'rollback_v607_engine_facebook_comment_checkpoint'
const OLD_MD5 = md5(OLD_CODE)
if (OLD_MD5 !== LIVE.block.md5) throw new Error(`Code V598 (${OLD_MD5}) khác block ${LIVE.block.id} production đọc 21/11 (${LIVE.block.md5})`)
if (LIVE.block.id !== 2869 || LIVE.block.name !== '[engine] fb_comment_current_post') throw new Error('Fixture: block engine khác 2869')
if (LIVE.source.id !== 2616 || LIVE.source.md5 !== '83bcdb4081685f2c858f4e0937348767') throw new Error('Fixture: block bộ cũ 2616 khác bản V472')
if (LIVE.copy.engineBlockId !== LIVE.block.id || LIVE.copy.sourceBlockId !== LIVE.source.id) throw new Error('Fixture: sổ chép block khác 2616 → 2869')
if (LIVE.steps.length !== 1 || LIVE.steps[0].commitLevel !== 2 || JSON.stringify(LIVE.steps[0].sendOps) !== '["press:Enter"]'
  || LIVE.steps[0].reviewedMd5 !== OLD_MD5) throw new Error('Fixture: danh mục bước của block comment khác bản đã đọc (mức 2, gửi bằng Enter, md5 V598)')
const CHECKPOINT_CODE = 'err_fb_checkpoint'
const LOGGED_OUT_CODE = 'err_engine_fb_logged_out'
for (const [code, publicCode, login] of [[CHECKPOINT_CODE, 'FB04', 'checkpoint'], [LOGGED_OUT_CODE, 'FB43', 'logged_out']]) {
  if (!LIVE.errors.some(e => e.errorCode === code && e.publicCode === publicCode && e.active)) throw new Error(`Fixture: thiếu mã ${code} (${publicCode})`)
  const policies = LIVE.policies.filter(p => p.errorCode === code && p.active)
  if (policies.length !== 1 || policies[0].targetEffect !== 'requeue' || policies[0].loginEffect !== login || policies[0].streak !== 'ignore'
    || policies[0].actionCode || policies[0].campaignActionId) throw new Error(`Fixture: chính sách của ${code} khác bản đã đọc (một dòng chung, về hàng đợi, ${login})`)
}

const BRANCH_NOTE = '  // 21/11/2026 (câu 533 của bộ kiểm lỗi, Q6): trang xác minh / trang đăng nhập là trạng thái đăng nhập chứ không phải "không thấy ô\n'
  + '  // bình luận": trả đúng mã FB04 / FB43 (chính sách có sẵn: data chưa gửi về hàng đợi, tài khoản đổi trạng thái đăng nhập, không cộng chuỗi).\n'
const EDITS = [
  {
    why: 'trang xác minh (/checkpoint/): FB04 thay FB41',
    from: "  if (/\\/checkpoint\\//i.test(url)) {\n    return { reason: 'checkpoint', statusCode: 'campaign_detail_error', errorCode: COMMENT_BOX_NOT_FOUND,\n",
    to: BRANCH_NOTE + "  if (/\\/checkpoint\\//i.test(url)) {\n    return { reason: 'checkpoint', statusCode: 'campaign_detail_error', errorCode: '" + CHECKPOINT_CODE + "',\n"
  },
  {
    why: 'trang đăng nhập (/login): FB43 thay FB41',
    from: "    return { reason: 'logged_out', statusCode: 'campaign_detail_error', errorCode: COMMENT_BOX_NOT_FOUND,\n",
    to: "    return { reason: 'logged_out', statusCode: 'campaign_detail_error', errorCode: '" + LOGGED_OUT_CODE + "',\n"
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
const TAG = '$v607_comment$'
if (OLD_CODE.includes(TAG) || NEW_CODE.includes(TAG)) throw new Error('Code block chứa thẻ dollar-quote')
if (NEW_CODE.normalize('NFC') !== NEW_CODE) throw new Error('Code block mới có chữ không ở dạng NFC (so chữ trang đã chuẩn hoá NFC)')
// Code block phải dựng được thành hàm async (đúng cách workflowEngine chạy block).
try {
  new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${NEW_CODE}\n})`)
} catch (error) {
  throw new Error(`Code block mới không hợp lệ: ${error.message}`)
}

const BLOCK = LIVE.block
const SOURCE = LIVE.source
const STEP = LIVE.steps[0]
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`
const codesGuard = `SELECT count(*) INTO v_n FROM public.auto_error WHERE error_code IN ('${CHECKPOINT_CODE}', '${LOGGED_OUT_CODE}') AND is_active AND NOT is_delete;
  IF v_n <> 2 THEN RAISE EXCEPTION 'V607: mã ${CHECKPOINT_CODE} / ${LOGGED_OUT_CODE} chưa có hoặc đang tắt trong auto_error (cần V559)'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_outcome_policies WHERE error_code IN ('${CHECKPOINT_CODE}', '${LOGGED_OUT_CODE}') AND is_active
     AND action_code IS NULL AND campaign_action_id IS NULL AND target_effect = 'requeue';
  IF v_n <> 2 THEN RAISE EXCEPTION 'V607: chính sách chung (về hàng đợi) của ${CHECKPOINT_CODE} / ${LOGGED_OUT_CODE} khác bản đã đọc'; END IF;`

const migration = `-- V607: engine v2 Facebook, bản "[engine] fb_comment_current_post" (block ${BLOCK.id}): link bài mở ra trang xác minh (/checkpoint/) thì trả
-- err_fb_checkpoint (FB04), trang đăng nhập (/login) thì err_engine_fb_logged_out (FB43) thay cho FB41 "không thấy ô bình luận" (câu 533 / 602 của
-- bộ kiểm lỗi, 21/11/2026; Q6). Chính sách FB04 / FB43 có sẵn (V559): data chưa gửi về hàng đợi, tài khoản đổi trạng thái đăng nhập, không cộng
-- chuỗi. Chỉ sửa code block engine + md5 đã duyệt của danh mục bước; bộ cũ (block ${SOURCE.id}) không đổi. SINH TỪ scripts/build-v607-sql.cjs
-- (nguồn guard: scripts/fixtures/engine-v2-facebook/v607-live-20261121.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc code block mỗi lượt, danh mục bước ở lần nạp danh mục kế tiếp (trong
-- lúc chưa nạp lại, bước comment chạy ở mức cam kết 1 như mọi block đổi code chưa duyệt). Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v607_%') THEN
      RAISE EXCEPTION 'V607 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regclass('public.auto_engine_block_steps') IS NULL THEN
    RAISE EXCEPTION 'V607 cần V556–V560 (sổ chép block, danh mục bước)';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE b.id = ${BLOCK.id} AND b.name = ${sqlText(BLOCK.name)} AND c.source_block_id = ${SOURCE.id} AND md5(b.code) = '${OLD_MD5}';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V607: block ${BLOCK.id} không còn đúng bản production (md5 ${OLD_MD5}), đọc lại và sinh lại'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V607: block ${BLOCK.id} có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND commit_level = ${STEP.commitLevel}
                   AND send_ops = '${JSON.stringify(STEP.sendOps)}'::jsonb AND reviewed_code_md5 = '${OLD_MD5}') THEN
    RAISE EXCEPTION 'V607: dòng danh mục bước ${STEP.id} của block ${BLOCK.id} khác bản đã đọc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${SOURCE.id} AND md5(code) = '${SOURCE.md5}') THEN
    RAISE EXCEPTION 'V607: block bộ cũ ${SOURCE.id} khác bản đã đọc';
  END IF;
  ${codesGuard}
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${NEW_CODE}${TAG}, updated_at = now()
 WHERE id = ${BLOCK.id} AND md5(code) = '${OLD_MD5}';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${NEW_MD5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${OLD_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V607 postflight: code block ${BLOCK.id} không phải bản mới (md5 ${NEW_MD5})';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V607 postflight: danh mục bước của block ${BLOCK.id} chưa ghi md5 bản mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${SOURCE.id} AND md5(code) = '${SOURCE.md5}') THEN
    RAISE EXCEPTION 'V607 postflight: block bộ cũ ${SOURCE.id} đã đổi (V607 không được đụng bộ cũ)';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V607: trả bản "[engine] fb_comment_current_post" (block ${BLOCK.id}) và md5 đã duyệt của danh mục bước về bản production trước V607 (bản V598,
-- md5 ${OLD_MD5}). Chỉ chạy khi block đang đúng bản V607 (đã ai sửa sau V607 thì dừng, không ghi đè). Bộ cũ không đổi.
-- SINH TỪ scripts/build-v607-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V607: block ${BLOCK.id} không phải bản V607 (md5 ${NEW_MD5}), không ghi đè';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${OLD_CODE}${TAG}, updated_at = now()
 WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${OLD_MD5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${NEW_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${OLD_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V607 postflight: block ${BLOCK.id} chưa về bản trước V607';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${OLD_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V607 postflight: danh mục bước của block ${BLOCK.id} chưa về md5 trước V607';
  END IF;
END $post$;

COMMIT;
`

module.exports = { NAME, ROLLBACK_NAME, LIVE, EDITS, OLD_CODE, NEW_CODE, OLD_MD5, NEW_MD5, CHECKPOINT_CODE, LOGGED_OUT_CODE, migration, rollback }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`V607: block ${BLOCK.id} ${OLD_MD5} → ${NEW_MD5}; migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
