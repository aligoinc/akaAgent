#!/usr/bin/env node
// V568: engine v2 Facebook, bản "[engine] fb_comment_at_position" (block 2851): đăng nhóm kèm comment, comment bài khác chọn theo bài để
// không comment 2 lần vào cùng một bài (18/11/2026, anh: "sửa luôn đi"). Bộ cũ không đổi (block 34, anh chốt 17/11 "engine cũ đừng đụng vào").
//
// Lỗi (logic của V563): comment bài khác mà ô bình luận ở vị trí N thuộc bài vừa đăng thì V563 nhảy sang ô kế tiếp; lượt comment sau không
// biết ô đó đã dùng, lấy ô thứ N+1 theo vị trí, đúng ô vừa comment. Ví dụ "Không comment vào post của mình" tối đa 3, app coi bài là chờ duyệt
// (vị trí lùi về 1, 2, 3) mà bài vừa đăng vẫn hiện trên cùng: ô 1 bài mình → comment bài A; ô 2 → bài A lần nữa; ô 3 → bài B. Xảy ra khi:
//   - app ghi "chờ duyệt" theo trang my_pending_content mà bài vừa đăng vẫn hiện trên trang (anh chốt 18/11 giữ cách nhận chờ duyệt). 7 ngày
//     tới 18/11 (bộ cũ, cùng tình huống): 709 bài "Không comment vào post của mình" + 472 bài "Comment tất cả";
//   - bài vừa đăng có 2 ô (nút "Bình luận" và ô "Viết bình luận..."): bộ cũ 18/405 lần comment thứ 2 của "Comment tất cả" rơi vào bài mình.
//
// Giả lập (scripts/engine-v2-facebook/comment-options-sim.cjs, code block thật trên trang giả) tìm thêm: chưa lấy được link bài vừa đăng mà
// "Không comment vào post của mình" thì V563 / bộ cũ bấm ô thứ N theo vị trí, vượt số bài thì trúng ô bình luận trong hộp thoại vừa mở
// (comment lại bài vừa comment); "Comment tất cả" chưa có link mà bài mình có 2 ô thì vị trí 2 rơi vào ô thứ hai của bài mình.
//
// Sửa (chỉ nhánh comment bài khác trong workflow đăng nhóm): chọn theo bài trên trang, không theo ô: bỏ ô trong hộp thoại đang mở, các ô cùng
// mã bài tính là một bài. Thấy bài vừa đăng thì lấy các bài nằm dưới nó (bỏ mọi ô của bài vừa đăng), bài thứ k, k = vị trí khi bài chờ duyệt,
// vị trí trừ 1 khi không (vị trí của bộ dựng biến: "Không comment vào post của mình" 2..N+1, "Comment tất cả" 1..N, khối chỉnh comment lùi 1
// khi chờ duyệt); không thấy (chưa có link, bài chưa hiện) thì bài thứ N trên trang như bộ cũ. Hết bài để chọn: ô thứ N không có trên trang
// thì bấm ô thứ N như bộ cũ (lỗi "Không comment được bài thứ N" như hôm nay), có thì bỏ qua lượt đó (không ghi dòng lịch sử, không tính lượt,
// như khi bỏ qua comment bài của mình) vì ô đó thuộc bài đã comment. Comment bài của mình, comment seeding: giữ y V563.
//
// Nguồn guard: scripts/fixtures/engine-v2-facebook/v568-live-20261118.json (đọc chỉ đọc production 18/11; code = bản V563 sinh từ
// scripts/build-v563-sql.cjs). Chạy: node scripts/build-v568-sql.cjs (ghi migration + bản gỡ).
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v568-live-20261118.json'), 'utf8'))
const V563 = require('./build-v563-sql.cjs')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const NAME = 'migration_v568_engine_facebook_comment_other_posts'
const OLD_CODE = V563.COMMENT.newCode
const OLD_MD5 = md5(OLD_CODE)
if (OLD_MD5 !== LIVE.block.md5) throw new Error(`Code V563 (${OLD_MD5}) khác code production đọc 18/11 (${LIVE.block.md5})`)
if (LIVE.block.id !== V563.COMMENT.live.id || LIVE.block.name !== V563.COMMENT.live.name) throw new Error('Fixture: block 2851 khác bản V563')
if (LIVE.source.id !== V563.COMMENT.live.sourceId || LIVE.source.md5 !== V563.COMMENT.live.sourceMd5) throw new Error('Fixture: block bộ cũ đã đổi')
if (LIVE.steps.length !== 1 || LIVE.steps[0].commitLevel !== 2 || JSON.stringify(LIVE.steps[0].sendOps) !== '["press:Enter"]'
  || LIVE.steps[0].reviewedMd5 !== OLD_MD5) throw new Error('Fixture: danh mục bước của block comment khác bản đã đọc (mức 2, gửi bằng Enter, md5 V563)')

/** Câu chỉ hiện ở bảng thử workflow của admin (helpers.log) và trong output của bước, không tới khách. */
const NO_OTHER_POST_MESSAGE = 'Dưới bài vừa đăng không còn bài khác chưa comment nên bỏ qua lượt comment này'

const EDITS = [
  {
    why: 'chú thích đầu block: mô tả cách chọn bài khác mới',
    from: '// trước vòng comment). Comment bài khác mà ô ở đúng vị trí lại thuộc bài vừa\n'
      + '// đăng thì lấy ô của bài kế tiếp. Chỉ trong workflow đăng nhóm (vars.groupPostSubmitted); comment seeding giữ như bộ cũ.\n',
    to: '// trước vòng comment). Comment bài khác (V568, 18/11/2026): chọn theo bài trên trang, không theo ô (bỏ ô trong hộp thoại đang mở; các ô cùng\n'
      + '// mã bài tính là một bài). Thấy bài vừa đăng thì lấy bài thứ k nằm dưới bài đó (k = vị trí, trừ 1 khi bài không chờ duyệt); không thấy (chưa\n'
      + '// có link, bài chưa hiện) thì lấy bài thứ N trên trang như bộ cũ. Trước V568: ô ở vị trí đó thuộc bài vừa đăng thì nhảy sang ô kế tiếp, lượt\n'
      + '// sau lại lấy đúng ô đó; vị trí vượt số bài thì bấm trúng ô trong hộp thoại vừa mở; bài có 2 ô thì 2 vị trí rơi vào một bài: một bài bị\n'
      + '// comment 2 lần. Hết bài để chọn: ô thứ N không có trên trang thì bấm ô thứ N như bộ cũ (lỗi như hôm nay), có thì bỏ qua lượt (không comment\n'
      + '// lại bài đã comment). Chỉ trong workflow đăng nhóm (vars.groupPostSubmitted); comment seeding giữ như bộ cũ.\n'
  },
  {
    why: 'câu cho admin khi bỏ qua lượt comment bài khác',
    from: "const __OWN_POST_SKIP_MESSAGE = 'Chưa thấy bài vừa đăng trên trang nhóm nên bỏ qua comment vào bài của mình'\n",
    to: "const __OWN_POST_SKIP_MESSAGE = 'Chưa thấy bài vừa đăng trên trang nhóm nên bỏ qua comment vào bài của mình'\n"
      + `const __NO_OTHER_POST_MESSAGE = '${NO_OTHER_POST_MESSAGE}'\n`
  },
  {
    why: 'comment bài khác khi chưa có link bài vừa đăng cũng chọn theo bài trên trang (trước: bấm ô thứ N, kể cả ô trong hộp thoại)',
    from: '  if (!ownTarget && !ownId) return { xpath: null }\n',
    to: '  // V568: comment bài khác khi chưa có link bài vừa đăng cũng chọn theo bài trên trang (bỏ ô trong hộp thoại), không bấm ô thứ N.\n'
  },
  {
    why: 'trang nhận thêm thứ tự k của bài khác',
    from: 'const mode = __args[3]; const position = Number(__args[4]) || 1;',
    to: 'const mode = __args[3]; const position = Number(__args[4]) || 1; const rank = Math.max(1, Number(__args[5]) || 1);'
  },
  {
    why: 'comment bài khác: chọn theo bài (thấy bài vừa đăng: bài thứ k dưới nó; không thấy: bài thứ N trên trang), không nhảy theo ô',
    from: '    } else {\n'
      + '      const atPosition = boxes[position - 1];\n'
      + "      if (!atPosition || postIdOf(atPosition) !== ownId) return 'legacy';\n"
      + '      for (let i = position; i < boxes.length; i++) { if (postIdOf(boxes[i]) !== ownId) { chosen = boxes[i]; break; } }\n'
      + '    }\n',
    to: '    } else {\n'
      + "      const feed = boxes.filter(el => !el.closest('[role=\"dialog\"]'));\n"
      + '      const ids = feed.map(postIdOf);\n'
      + '      const ownAt = ownId ? ids.indexOf(ownId) : -1;\n'
      + '      const seen = new Set(ownId ? [ownId] : []); const others = [];\n'
      + '      for (let i = ownAt + 1; i < feed.length; i++) { const id = ids[i]; if (id) { if (seen.has(id)) continue; seen.add(id); } others.push(feed[i]); }\n'
      + '      chosen = others[(ownAt >= 0 ? rank : position) - 1] || null;\n'
      + "      if (!chosen) return position > boxes.length ? 'legacy' : 'no_other';\n"
      + '    }\n'
  },
  {
    why: 'truyền k: vị trí khi bài chờ duyệt, vị trí trừ 1 khi không',
    from: "`, union, ownId, token, ownTarget ? 'own' : 'other', position)\n",
    to: "`, union, ownId, token, ownTarget ? 'own' : 'other', position, vars.groupPostIsPending === true ? position : position - 1)\n"
  },
  {
    why: 'hết bài khác chưa comment (ô thứ N vẫn có): bỏ qua lượt',
    from: '  if (ownTarget) return { skip: true, message: __OWN_POST_SKIP_MESSAGE }\n  return { xpath: null }\n}\n',
    to: '  if (ownTarget) return { skip: true, message: __OWN_POST_SKIP_MESSAGE }\n'
      + "  if (picked === 'no_other') return { skip: true, other: true, message: __NO_OTHER_POST_MESSAGE }\n"
      + '  return { xpath: null }\n}\n'
  },
  {
    why: 'kết quả bước khi bỏ qua lượt comment bài khác (không comment, không dòng lịch sử, như bỏ qua bài của mình)',
    from: "  return { commented: false, position: pos, text: '', imageCount: 0, ownPostSkipped: true, skipReason: __commentTarget.message }\n",
    to: "  if (__commentTarget.other) return { commented: false, position: pos, text: '', imageCount: 0, otherPostSkipped: true, skipReason: __commentTarget.message }\n"
      + "  return { commented: false, position: pos, text: '', imageCount: 0, ownPostSkipped: true, skipReason: __commentTarget.message }\n"
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
const TAG = '$v568_comment$'
if (OLD_CODE.includes(TAG) || NEW_CODE.includes(TAG)) throw new Error('Code block chứa thẻ dollar-quote')
// Phần chạy trong trang nằm trong String.raw template của block: không được có ${ (bị nội suy) hay dấu backtick.
const pageScript = NEW_CODE.match(/page\.evaluate\(String\.raw`([\s\S]*?)`, union, ownId/)
if (!pageScript || pageScript[1].includes('${')) throw new Error('Script trong trang của block comment có ${ hoặc không tìm thấy')

const BLOCK = LIVE.block
const STEP = LIVE.steps[0]
const sqlText = value => `'${String(value).replace(/'/g, "''")}'`

const migration = `-- V568: engine v2 Facebook, bản "[engine] fb_comment_at_position" (block ${BLOCK.id}): đăng nhóm kèm comment, comment bài khác chọn theo
-- bài (lấy bài thứ k dưới bài vừa đăng, bỏ mọi ô của bài vừa đăng và ô trong hộp thoại đang mở), không comment 2 lần vào cùng một bài như V563
-- (nhảy sang ô kế tiếp rồi lượt sau lấy lại đúng ô đó). Chỉ sửa code block engine + md5 đã duyệt của danh mục bước; bộ cũ (block ${LIVE.source.id})
-- không đổi. SINH TỪ scripts/build-v568-sql.cjs (nguồn guard: scripts/fixtures/engine-v2-facebook/v568-live-20261118.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc code block mỗi lượt, danh mục bước ở lần nạp danh mục kế tiếp (trong
-- lúc chưa nạp lại, bước comment chạy ở mức cam kết 1 như mọi block đổi code chưa duyệt). Gỡ: rollback_v568_engine_facebook_comment_other_posts.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v568_%') THEN
      RAISE EXCEPTION 'V568 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regclass('public.auto_engine_block_steps') IS NULL THEN
    RAISE EXCEPTION 'V568 cần V556–V560 (sổ chép block, danh mục bước)';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.engine_block_id = b.id
   WHERE b.id = ${BLOCK.id} AND b.name = ${sqlText(BLOCK.name)} AND c.source_block_id = ${LIVE.source.id} AND md5(b.code) = '${OLD_MD5}';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V568: block ${BLOCK.id} không còn đúng bản V563 (md5 ${OLD_MD5}), đọc lại và sinh lại'; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V568: block ${BLOCK.id} có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND commit_level = ${STEP.commitLevel}
                   AND send_ops = '${JSON.stringify(STEP.sendOps)}'::jsonb AND reviewed_code_md5 = '${OLD_MD5}') THEN
    RAISE EXCEPTION 'V568: dòng danh mục bước ${STEP.id} của block ${BLOCK.id} khác bản đã đọc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${LIVE.source.id} AND md5(code) = '${LIVE.source.md5}') THEN
    RAISE EXCEPTION 'V568: block bộ cũ ${LIVE.source.id} khác bản đã đọc';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${NEW_CODE}${TAG}, updated_at = now()
 WHERE id = ${BLOCK.id} AND md5(code) = '${OLD_MD5}';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${NEW_MD5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${OLD_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V568 postflight: code block ${BLOCK.id} không phải bản mới (md5 ${NEW_MD5})';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V568 postflight: danh mục bước của block ${BLOCK.id} chưa ghi md5 bản mới';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${LIVE.source.id} AND md5(code) = '${LIVE.source.md5}') THEN
    RAISE EXCEPTION 'V568 postflight: block bộ cũ ${LIVE.source.id} đã đổi (V568 không được đụng bộ cũ)';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V568: trả bản "[engine] fb_comment_at_position" (block ${BLOCK.id}) và md5 đã duyệt của danh mục bước về bản V563. Chỉ chạy khi block đang
-- đúng bản V568 (đã ai sửa sau V568 thì dừng, không ghi đè). Bộ cũ không đổi. SINH TỪ scripts/build-v568-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V568: block ${BLOCK.id} không phải bản V568 (md5 ${NEW_MD5}), không ghi đè';
  END IF;
END $pre$;

UPDATE public.auto_blocks SET code = ${TAG}${OLD_CODE}${TAG}, updated_at = now()
 WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}';
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${OLD_MD5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${NEW_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${OLD_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V568 postflight: block ${BLOCK.id} chưa về bản V563';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${OLD_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V568 postflight: danh mục bước của block ${BLOCK.id} chưa về md5 V563';
  END IF;
END $post$;

COMMIT;
`

module.exports = { NAME, LIVE, EDITS, OLD_CODE, NEW_CODE, OLD_MD5, NEW_MD5, NO_OTHER_POST_MESSAGE, migration, rollback }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v568_engine_facebook_comment_other_posts.sql'), rollback)
  console.log(`V568: block ${BLOCK.id} ${OLD_MD5} → ${NEW_MD5}; migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
