#!/usr/bin/env node
// V572: engine v2 Facebook, bản "[engine] fb_comment_at_position" (block 2851): đăng nhóm kèm comment, chọn bài để comment theo mã bài của hộp
// thoại vừa mở (18/11/2026, anh: "Làm bản sửa" sau khi gỡ V568). Bộ cũ không đổi (block 34, anh chốt 17/11 "engine cũ đừng đụng vào").
//
// Kiểm trên Facebook thật 18/11 (trình duyệt thử, "Nhóm private 1", chỉ đọc):
//   - bấm ô bình luận của một bài thì link trang đổi ngay (trong cú bấm) sang /groups/<nhóm>/permalink/<mã bài>/; bấm ô của chính bài đang mở
//     thì link không đổi; đóng hộp thoại (Escape, kể cả khi đang đứng trong ô nhập) thì link về trang nhóm;
//   - hộp thoại đang mở mà bấm ô của bài khác thì nội dung hộp thoại đổi sang bài đó sau khoảng 0,5 giây, trong lúc đó ô nhập của bài cũ vẫn còn
//     (gõ sớm là comment vào bài cũ);
//   - link bài trong feed chưa nạp: hàm tìm mã bài theo link trong khung của V563 / V568 gán một mã cho nhiều bài (lý do gỡ V568);
//   - feed chỉ nạp vài bài, cuộn mới nạp thêm (bài phía trên bị gỡ khỏi trang); hộp thoại đang mở thì trang nền bị khoá cuộn;
//   - nút "Bình luận về bài viết của …" trong hộp thoại cũng khớp phần tử fb_comment_box_at_n.
//
// Sửa (chỉ vòng comment của workflow đăng nhóm, kể cả lượt bỏ qua đăng vì nhóm đã biết cần duyệt):
//   - comment bài khác: bấm lần lượt các ô chưa thử theo thứ tự trên trang (bỏ ô trong hộp thoại), đọc mã bài của hộp thoại: bài vừa đăng hoặc bài
//     đã comment / đã thử comment trong lượt (nhớ trong vars của data) thì bỏ qua, bấm ô kế; bài mới thì chờ ô nhập của bài cũ bị thay rồi mới gõ.
//     Hết ô chưa thử: đóng hộp thoại, cuộn cho feed nạp thêm bài (tối đa 6 lần, 12 cú bấm mỗi lượt comment); vẫn không có bài mới thì bỏ qua lượt
//     (không comment, không dòng lịch sử, như bỏ qua comment bài của mình). Chưa có link bài vừa đăng mà bài không chờ duyệt: bài đầu tiên trên
//     trang là bài vừa đăng như vị trí 2..N+1 của bộ cũ (nhớ mã, không comment);
//   - comment bài của mình: chọn ô như V563, bấm rồi đọc mã bài của hộp thoại; khác bài vừa đăng thì không comment (V563: thấy đúng bài mới comment);
//   - comment seeding và các workflow khác: giữ y V563.
//
// Nguồn guard: scripts/fixtures/engine-v2-facebook/v572-live-20261118.json (đọc chỉ đọc production 18/11 sau khi gỡ V568; code = bản V563
// sinh từ scripts/build-v563-sql.cjs). Phần code mới: scripts/engine-v2-facebook/v572-comment-target.fragment.js.
// Số migration: lúc làm là V570; 18/11 13:50 VN đổi sang V572 vì sổ production đã có V569 / V570 (aka_assistant, apply 13:07 / 13:10 VN) và V571
// (engine_target_check, 13:42 VN). Code block không ghi số migration (đổi số không đổi md5 code); kiểm lại sổ ngay trước khi apply.
// Chạy: node scripts/build-v572-sql.cjs (ghi migration + bản gỡ).
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v572-live-20261118.json'), 'utf8'))
const FRAGMENT = fs.readFileSync(path.join(ROOT, 'scripts/engine-v2-facebook/v572-comment-target.fragment.js'), 'utf8')
const V563 = require('./build-v563-sql.cjs')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const NAME = 'migration_v572_engine_facebook_comment_dialog_post'
const ROLLBACK_NAME = 'rollback_v572_engine_facebook_comment_dialog_post'
const OLD_CODE = V563.COMMENT.newCode
const OLD_MD5 = md5(OLD_CODE)
if (OLD_MD5 !== LIVE.block.md5) throw new Error(`Code V563 (${OLD_MD5}) khác code production đọc 18/11 (${LIVE.block.md5})`)
if (LIVE.block.id !== V563.COMMENT.live.id || LIVE.block.name !== V563.COMMENT.live.name) throw new Error('Fixture: block 2851 khác bản V563')
if (LIVE.source.id !== V563.COMMENT.live.sourceId || LIVE.source.md5 !== V563.COMMENT.live.sourceMd5) throw new Error('Fixture: block bộ cũ đã đổi')
if (LIVE.steps.length !== 1 || LIVE.steps[0].commitLevel !== 2 || JSON.stringify(LIVE.steps[0].sendOps) !== '["press:Enter"]'
  || LIVE.steps[0].reviewedMd5 !== OLD_MD5) throw new Error('Fixture: danh mục bước của block comment khác bản đã đọc (mức 2, gửi bằng Enter, md5 V563)')

const RESOLVE_START = 'async function __resolveCommentTarget(position) {\n'
const RESOLVE_END = '\n\n// Read only after comment submit/settle and the existing frequency-limit check.\n'
const resolveFrom = OLD_CODE.slice(OLD_CODE.indexOf(RESOLVE_START), OLD_CODE.indexOf(RESOLVE_END))
if (!resolveFrom.startsWith(RESOLVE_START) || !resolveFrom.endsWith('\n}')) throw new Error('Không tách được hàm __resolveCommentTarget của V563')

const EDITS = [
  {
    why: 'chú thích đầu block: mô tả cách chọn bài theo mã bài của hộp thoại',
    from: '// trước vòng comment). Comment bài khác mà ô ở đúng vị trí lại thuộc bài vừa\n'
      + '// đăng thì lấy ô của bài kế tiếp. Chỉ trong workflow đăng nhóm (vars.groupPostSubmitted); comment seeding giữ như bộ cũ.\n',
    to: '// trước vòng comment). Bản sửa 18/11/2026 (thay bản V568 đã gỡ): trong vòng comment của workflow đăng nhóm, bấm ô bình luận rồi đọc mã bài\n'
      + '// của hộp thoại vừa mở (link trang đổi ngay sang /groups/<nhóm>/permalink/<mã bài>/, thử trên Facebook thật 18/11). Bài của mình: chọn ô như\n'
      + '// V563, mã hộp thoại khác bài vừa đăng thì không comment. Bài khác: bỏ bài vừa đăng và bài đã comment trong lượt (nhớ trong vars), bấm ô kế;\n'
      + '// hết ô thì đóng hộp thoại, cuộn cho feed nạp thêm bài; gõ khi hộp thoại đã đổi sang bài mới. Trước bản sửa này (chọn ô theo vị trí / mã bài đọc\n'
      + '// từ link trong khung):\n'
      + '// feed chưa nạp link bài nên nhiều bài nhận cùng một mã, mở hộp thoại thì ô thứ N đổi bài, ô "Bình luận về bài viết…" trong hộp thoại cũng\n'
      + '// khớp, gõ khi hộp thoại chưa đổi xong thì rơi vào bài cũ: một bài bị comment 2 lần. Comment seeding giữ như bộ cũ.\n'
  },
  {
    why: 'chọn bài theo mã bài của hộp thoại (hàm mới thay __resolveCommentTarget của V563)',
    from: resolveFrom,
    to: FRAGMENT.replace(/\n+$/, '')
  },
  {
    why: 'kết quả bước khi bỏ qua lượt comment bài khác (không comment, không dòng lịch sử, như bỏ qua bài của mình)',
    from: "  return { commented: false, position: pos, text: '', imageCount: 0, ownPostSkipped: true, skipReason: __commentTarget.message }\n",
    to: "  if (__commentTarget.other) return { commented: false, position: pos, text: '', imageCount: 0, otherPostSkipped: true, skipReason: __commentTarget.message }\n"
      + "  return { commented: false, position: pos, text: '', imageCount: 0, ownPostSkipped: true, skipReason: __commentTarget.message }\n"
  },
  {
    why: 'hộp thoại của bài đã mở lúc chọn bài thì không bấm ô lần nữa',
    from: "  const boxXpath = __commentTarget.xpath || await helpers.elementWith('fb_comment_box_at_n', { n: pos })\n"
      + '  await page.waitForSelector(boxXpath, { timeout: 8000 })\n'
      + '  await page.click(boxXpath)\n',
    to: '  if (__commentTarget.opened !== true) {\n'
      + "    const boxXpath = __commentTarget.xpath || await helpers.elementWith('fb_comment_box_at_n', { n: pos })\n"
      + '    await page.waitForSelector(boxXpath, { timeout: 8000 })\n'
      + '    await page.click(boxXpath)\n'
      + '  }\n'
  },
  {
    why: 'nhớ bài vừa comment để lượt comment sau không chọn lại; ghi mã bài vào kết quả bước',
    from: "  await page.press('Enter')\n",
    to: "  await page.press('Enter')\n"
      + '  __rememberCommentedPost(__commentTarget.postId)\n'
  },
  {
    why: 'mã bài của hộp thoại trong kết quả bước (tra lỗi)',
    from: '  return { commented: true, commentUrl, position: pos, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun }\n',
    to: "  return { commented: true, commentUrl, position: pos, text: text, imageCount: imageCount, rewrittenContent: shouldRewriteCommentContentEachRun, commentPostId: __commentTarget.postId || '' }\n"
  },
  {
    why: 'bài comment lỗi cũng không chọn lại trong lượt',
    from: '} catch (e) {\n  const message = e && e.message ? String(e.message) : String(e)\n',
    to: '} catch (e) {\n  __rememberCommentedPost(__commentTarget.postId)\n  const message = e && e.message ? String(e.message) : String(e)\n'
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
const TAG = '$v572_comment$'
if (OLD_CODE.includes(TAG) || NEW_CODE.includes(TAG)) throw new Error('Code block chứa thẻ dollar-quote')
// Phần chạy trong trang nằm trong String.raw template của block: không được có ${ (bị nội suy).
for (const match of NEW_CODE.matchAll(/String\.raw`([\s\S]*?)`/g)) {
  if (match[1].includes('${')) throw new Error('Script trong trang của block comment có ${')
}
// Code block phải dựng được thành hàm async (đúng cách workflowEngine chạy block).
try {
  new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${NEW_CODE}\n})`)
} catch (error) {
  throw new Error(`Code block mới không hợp lệ: ${error.message}`)
}

const BLOCK = LIVE.block
const STEP = LIVE.steps[0]
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`

const migration = `-- V572: engine v2 Facebook, bản "[engine] fb_comment_at_position" (block ${BLOCK.id}): đăng nhóm kèm comment, chọn bài để comment theo mã bài
-- của hộp thoại vừa mở (link /groups/<nhóm>/permalink/<mã bài>/ khi bấm ô bình luận), không comment 2 lần vào một bài, không comment bài vừa
-- đăng khi chọn "Không comment vào post của mình". Chỉ sửa code block engine + md5 đã duyệt của danh mục bước; bộ cũ (block ${LIVE.source.id})
-- không đổi. SINH TỪ scripts/build-v572-sql.cjs (nguồn guard: scripts/fixtures/engine-v2-facebook/v572-live-20261118.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc code block mỗi lượt, danh mục bước ở lần nạp danh mục kế tiếp (trong
-- lúc chưa nạp lại, bước comment chạy ở mức cam kết 1 như mọi block đổi code chưa duyệt). Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v572_%') THEN
      RAISE EXCEPTION 'V572 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regclass('public.auto_engine_block_steps') IS NULL THEN
    RAISE EXCEPTION 'V572 cần V556–V560 (sổ chép block, danh mục bước)';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE b.id = ${BLOCK.id} AND b.name = ${sqlText(BLOCK.name)} AND c.source_block_id = ${LIVE.source.id} AND md5(b.code) = '${OLD_MD5}';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V572: block ${BLOCK.id} không còn đúng bản V563 (md5 ${OLD_MD5}), đọc lại và sinh lại'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V572: block ${BLOCK.id} có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND commit_level = ${STEP.commitLevel}
                   AND send_ops = '${JSON.stringify(STEP.sendOps)}'::jsonb AND reviewed_code_md5 = '${OLD_MD5}') THEN
    RAISE EXCEPTION 'V572: dòng danh mục bước ${STEP.id} của block ${BLOCK.id} khác bản đã đọc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${LIVE.source.id} AND md5(code) = '${LIVE.source.md5}') THEN
    RAISE EXCEPTION 'V572: block bộ cũ ${LIVE.source.id} khác bản đã đọc';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${NEW_CODE}${TAG}, updated_at = now()
 WHERE id = ${BLOCK.id} AND md5(code) = '${OLD_MD5}';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${NEW_MD5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${OLD_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V572 postflight: code block ${BLOCK.id} không phải bản mới (md5 ${NEW_MD5})';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V572 postflight: danh mục bước của block ${BLOCK.id} chưa ghi md5 bản mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${LIVE.source.id} AND md5(code) = '${LIVE.source.md5}') THEN
    RAISE EXCEPTION 'V572 postflight: block bộ cũ ${LIVE.source.id} đã đổi (V572 không được đụng bộ cũ)';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V572: trả bản "[engine] fb_comment_at_position" (block ${BLOCK.id}) và md5 đã duyệt của danh mục bước về bản V563. Chỉ chạy khi block đang
-- đúng bản V572 (đã ai sửa sau V572 thì dừng, không ghi đè). Bộ cũ không đổi. SINH TỪ scripts/build-v572-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V572: block ${BLOCK.id} không phải bản V572 (md5 ${NEW_MD5}), không ghi đè';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${OLD_CODE}${TAG}, updated_at = now()
 WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${OLD_MD5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${NEW_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${OLD_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V572 postflight: block ${BLOCK.id} chưa về bản V563';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${OLD_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V572 postflight: danh mục bước của block ${BLOCK.id} chưa về md5 V563';
  END IF;
END $post$;

COMMIT;
`

module.exports = { NAME, ROLLBACK_NAME, LIVE, EDITS, OLD_CODE, NEW_CODE, OLD_MD5, NEW_MD5, migration, rollback }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`V572: block ${BLOCK.id} ${OLD_MD5} → ${NEW_MD5}; migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
