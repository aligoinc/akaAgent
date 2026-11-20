#!/usr/bin/env node
// V598: engine v2 Facebook, bản "[engine] fb_comment_current_post" (block 2869, workflow 317 "comment vào bài post" / Up tin): khách nhập link bài
// chờ duyệt (/pending_posts/) thì ghi theo trang Facebook hiện ra, không còn FB41 cộng chuỗi rồi dừng chiến dịch (câu 584 của bộ kiểm lỗi,
// 20/11/2026; anh chọn "Theo trang Facebook hiện").
//
// Đo trên production 18–20/11 (chỉ đọc; vết bước comment_current_post `output.actionResult.data` của 78 lượt link /pending_posts/, tổ chức 335):
//   - 59 lượt trang danh sách "Bài viết đang chờ · N" (bộ lọc Tác giả / Loại nội dung, không có hộp thoại bài);
//   - 17 lượt "Chưa có bài viết nào để xem xét" + "Không có bài viết nào đang chờ xem xét." (hàng chờ trống: bài không còn chờ);
//   - 2 lượt mở ra hộp thoại bài không có ô bình luận, không có chữ chờ duyệt (giữ FB41).
//   Cả 78 lượt ra FB41 (chính sách 339 cộng chuỗi, đủ 4 lượt liền thì dừng chiến dịch): 24 giờ tới 12:53 VN 20/11 dừng chiến dịch 3 lần.
//
// Sửa (chỉ một chỗ, trong classifyCommentPage, sau các luật câu chữ V472 và trước nhánh không nhận ra; chỉ khi link đang mở có /pending_posts/):
//   - thấy "Bài viết đang chờ" (± "· N") thì như luật post_pending: FB15 "Bài Facebook đang chờ duyệt nên chưa bình luận được" (chính sách 299);
//   - thấy "Chưa có bài viết nào để xem xét" / "Không có bài viết nào đang chờ xem xét" thì như luật post_not_found: FB17 (chính sách 301);
//   - FB15 / FB17 không cộng chuỗi, không tính lượt, data đóng như FB41 hôm nay. Không đổi chính sách, câu cho khách, element, code app.
//   Thứ tự giữ nguyên câu 533 (checkpoint xét URL trước) và câu 564 (FB17 theo câu "Bạn hiện không xem được nội dung này").
// Bộ cũ (block 2616, workflow 207 / 244, máy Desktop < 9.9.0) không đổi, như V563 / V572 chỉ sửa bản engine.
//
// Nguồn guard: scripts/fixtures/engine-v2-facebook/v598-live-20261120.json (đọc chỉ đọc production 20/11). Code cũ = bản V472
// (migrations/snapshots/fb-comment-post-unavailable-v472/block-2616.after.js, md5 = block 2869 = block 2616 production). Phần code mới:
// scripts/engine-v2-facebook/v598-pending-link.fragment.js. Code block không ghi số migration (đổi số không đổi md5 code); kiểm lại sổ ngay
// trước khi apply. Chạy: node scripts/build-v598-sql.cjs (ghi migration + bản gỡ).
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v598-live-20261120.json'), 'utf8'))
const OLD_CODE = fs.readFileSync(path.join(ROOT, 'migrations/snapshots/fb-comment-post-unavailable-v472/block-2616.after.js'), 'utf8')
const FRAGMENT = fs.readFileSync(path.join(ROOT, 'scripts/engine-v2-facebook/v598-pending-link.fragment.js'), 'utf8')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const NAME = 'migration_v598_engine_facebook_comment_pending_link'
const ROLLBACK_NAME = 'rollback_v598_engine_facebook_comment_pending_link'
const OLD_MD5 = md5(OLD_CODE)
if (OLD_MD5 !== LIVE.block.md5) throw new Error(`Code V472 (${OLD_MD5}) khác block ${LIVE.block.id} production đọc 20/11 (${LIVE.block.md5})`)
if (LIVE.block.id !== 2869 || LIVE.block.name !== '[engine] fb_comment_current_post') throw new Error('Fixture: block engine khác 2869')
if (LIVE.source.id !== 2616 || LIVE.source.md5 !== OLD_MD5) throw new Error('Fixture: block bộ cũ 2616 khác bản V472')
if (LIVE.copy.engineBlockId !== LIVE.block.id || LIVE.copy.sourceBlockId !== LIVE.source.id) throw new Error('Fixture: sổ chép block khác 2616 → 2869')
if (LIVE.steps.length !== 1 || LIVE.steps[0].commitLevel !== 2 || JSON.stringify(LIVE.steps[0].sendOps) !== '["press:Enter"]'
  || LIVE.steps[0].reviewedMd5 !== OLD_MD5) throw new Error('Fixture: danh mục bước của block comment khác bản đã đọc (mức 2, gửi bằng Enter, md5 V472)')

const UNKNOWN = "  return { reason: 'unknown', statusCode: 'campaign_detail_error', errorCode: COMMENT_BOX_NOT_FOUND,\n"
  + "    message: 'Không tìm thấy ô bình luận trên bài' }\n}\n"
const EDITS = [
  {
    why: 'link chờ duyệt (/pending_posts/): nhận trang danh sách bài chờ / hàng chờ trống trước nhánh không nhận ra',
    from: UNKNOWN,
    to: FRAGMENT + UNKNOWN
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
const TAG = '$v598_comment$'
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

const migration = `-- V598: engine v2 Facebook, bản "[engine] fb_comment_current_post" (block ${BLOCK.id}): comment vào link bài mà khách nhập link bài chờ duyệt
-- (/pending_posts/). Trang "Bài viết đang chờ · N" thì như bài chờ duyệt (FB15), hàng chờ trống "Chưa có bài viết nào để xem xét" thì như không
-- tìm thấy bài (FB17); hôm nay cả hai ra FB41, cộng chuỗi rồi dừng chiến dịch (câu 584 của bộ kiểm lỗi, anh chọn "Theo trang Facebook hiện"
-- 20/11/2026). Chỉ sửa code block engine + md5 đã duyệt của danh mục bước; bộ cũ (block ${SOURCE.id}) không đổi. SINH TỪ scripts/build-v598-sql.cjs
-- (nguồn guard: scripts/fixtures/engine-v2-facebook/v598-live-20261120.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc code block mỗi lượt, danh mục bước ở lần nạp danh mục kế tiếp (trong
-- lúc chưa nạp lại, bước comment chạy ở mức cam kết 1 như mọi block đổi code chưa duyệt). Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v598_%') THEN
      RAISE EXCEPTION 'V598 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regclass('public.auto_engine_block_steps') IS NULL THEN
    RAISE EXCEPTION 'V598 cần V556–V560 (sổ chép block, danh mục bước)';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE b.id = ${BLOCK.id} AND b.name = ${sqlText(BLOCK.name)} AND c.source_block_id = ${SOURCE.id} AND md5(b.code) = '${OLD_MD5}';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V598: block ${BLOCK.id} không còn đúng bản production (md5 ${OLD_MD5}), đọc lại và sinh lại'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V598: block ${BLOCK.id} có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND commit_level = ${STEP.commitLevel}
                   AND send_ops = '${JSON.stringify(STEP.sendOps)}'::jsonb AND reviewed_code_md5 = '${OLD_MD5}') THEN
    RAISE EXCEPTION 'V598: dòng danh mục bước ${STEP.id} của block ${BLOCK.id} khác bản đã đọc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${SOURCE.id} AND md5(code) = '${SOURCE.md5}') THEN
    RAISE EXCEPTION 'V598: block bộ cũ ${SOURCE.id} khác bản đã đọc';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${NEW_CODE}${TAG}, updated_at = now()
 WHERE id = ${BLOCK.id} AND md5(code) = '${OLD_MD5}';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${NEW_MD5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${OLD_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V598 postflight: code block ${BLOCK.id} không phải bản mới (md5 ${NEW_MD5})';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V598 postflight: danh mục bước của block ${BLOCK.id} chưa ghi md5 bản mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${SOURCE.id} AND md5(code) = '${SOURCE.md5}') THEN
    RAISE EXCEPTION 'V598 postflight: block bộ cũ ${SOURCE.id} đã đổi (V598 không được đụng bộ cũ)';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V598: trả bản "[engine] fb_comment_current_post" (block ${BLOCK.id}) và md5 đã duyệt của danh mục bước về bản production trước V598 (bản V472,
-- md5 ${OLD_MD5}). Chỉ chạy khi block đang đúng bản V598 (đã ai sửa sau V598 thì dừng, không ghi đè). Bộ cũ không đổi.
-- SINH TỪ scripts/build-v598-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V598: block ${BLOCK.id} không phải bản V598 (md5 ${NEW_MD5}), không ghi đè';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${OLD_CODE}${TAG}, updated_at = now()
 WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${OLD_MD5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${NEW_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${OLD_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V598 postflight: block ${BLOCK.id} chưa về bản trước V598';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${OLD_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V598 postflight: danh mục bước của block ${BLOCK.id} chưa về md5 trước V598';
  END IF;
END $post$;

COMMIT;
`

module.exports = { NAME, ROLLBACK_NAME, LIVE, EDITS, OLD_CODE, NEW_CODE, OLD_MD5, NEW_MD5, migration, rollback }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`V598: block ${BLOCK.id} ${OLD_MD5} → ${NEW_MD5}; migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
