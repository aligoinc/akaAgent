#!/usr/bin/env node
// Sinh migration V673 (anh chốt 27/11/2026, câu 9004 của hộp thư lỗi; docs/ENGINE_V2_FACEBOOK_GROUP_POST_FREQUENCY_EARLY_V673.md): đăng nhóm
// bị Facebook giới hạn tần suất thì block chờ form đóng (2871) báo FB02 ngay khi thấy chữ, không ngồi chờ hết 60 / 180 giây.
//   * Hôm nay block chỉ dò chữ giới hạn tần suất SAU khi hết giờ chờ: 12 lượt FB02 mẫu ngày 26–27/11 đều ngồi 56–57 giây ở bước chờ (277 lượt
//     FB02 / 24 giờ). Trong lúc chờ mà app thoát / cập nhật thì mất dấu hiệu: lượt 294055 ra SYS99, sau #734 ra SYS02 (tính một lượt oan).
//   * Ảnh + DOM yêu cầu 41 / 44 / 45 (27/11): hộp "Tạo bài viết" còn mở, chữ đỏ "…giới hạn tần suất bạn đăng bài…" nằm trong hộp (role=dialog +
//     form, ngoài ô soạn, một text node), nút Đăng không bị khoá, không còn vòng quay "Đang đăng": Facebook đã từ chối bài.
//   * Element mới GroupPostFrequencyLimitNotice (XPath cùng dạng V597, chỉ trong hộp, bỏ ô soạn). Element 1710 GroupPostFrequencyLimitError
//     (dò cả trang) giữ nguyên cho nhánh hết giờ và các block comment.
//   * Block 2871: trong vòng chờ 500 ms, form còn mở mà thấy element mới 2 vòng liền thì ném đúng câu cũ "Facebook báo giới hạn tần suất bạn
//     đăng bài" (luật 116 → FB02 như nay, chính sách không đổi). Ba chữ đỏ V597 (FB48 / FB49 / FB50) vẫn chỉ dò khi hết giờ: DOM FB49 yêu cầu
//     27 / 31 còn "Đang đăng" cùng lúc.
// Chỉ dữ liệu (không DDL, không nạp lại schema PostgREST), chỉ bản "[engine]" của block (bộ cũ 2624 không đổi), không cần phát hành app (Desktop
// ≥ 9.9.0 tự nạp lại element khi gặp tên mới, như V597).
//   node scripts/build-v673-sql.cjs            ghi migration + bản gỡ
//   node scripts/build-v673-sql.cjs --check    chỉ kiểm file đang có khớp bộ sinh
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const NAME = 'migration_v673_engine_facebook_group_post_frequency_early'
const ROLLBACK_NAME = 'rollback_v673_engine_facebook_group_post_frequency_early'
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const lit = text => text == null ? 'NULL' : `'${String(text).replace(/'/g, "''")}'`
const LIVE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/engine-v2-facebook/v673-live-20261127.json'), 'utf8'))

const BLOCK = { id: 2871, name: '[engine] fb_verify_group_post_form_closed', sourceId: 2624, oldMd5: 'f981cac703a91dc6c9f8a49176a61bba',
  sourceMd5: 'e433ac1a58ac08535c53010fdc5e9ba7' }
const STEP = { id: 4, commitLevel: 1 }
if (LIVE.block.id !== BLOCK.id || LIVE.block.name !== BLOCK.name || md5(LIVE.block.code) !== BLOCK.oldMd5 || LIVE.block.md5 !== BLOCK.oldMd5) {
  throw new Error('Fixture block 2871 lệch')
}
if (LIVE.sourceBlock.id !== BLOCK.sourceId || LIVE.sourceBlock.md5 !== BLOCK.sourceMd5) throw new Error('Fixture block bộ cũ 2624 lệch')
if (LIVE.step.id !== STEP.id || LIVE.step.block_id !== BLOCK.id || LIVE.step.reviewed_code_md5 !== BLOCK.oldMd5
  || LIVE.step.commit_level !== STEP.commitLevel) throw new Error('Fixture dòng danh mục bước lệch')
if (LIVE.nodes.length !== 1 || LIVE.nodes[0].wf !== 321 || LIVE.nodes[0].node !== 'verify_submit') throw new Error('Fixture: block 2871 phải chỉ ở node verify_submit của workflow 321')

// Câu block ném khi thấy giới hạn tần suất: giữ đúng chữ nhánh hết giờ đang ném (luật 116 '%giới hạn tần suất bạn đăng bài%' → FB02).
const FB02 = { code: 'err_group_post_frequency_limit', pub: 'FB02', message: 'Facebook báo giới hạn tần suất bạn đăng bài' }
const SEEN_ROUNDS = 2
const ELEMENT = {
  name: 'GroupPostFrequencyLimitNotice',
  xpath: "//*[@role='dialog' or self::form]//text()[contains(., 'giới hạn tần suất bạn đăng bài')][not(ancestor::*[@contenteditable='true'])]/..",
  description: 'V673: chữ đỏ Facebook ghi trong hộp Tạo bài viết khi giới hạn tần suất đăng bài (FB02); block 2871 dò trong lúc chờ form đóng. '
    + 'Chỉ trong hộp, bỏ ô soạn; GroupPostFrequencyLimitError (cả trang) vẫn dùng khi hết giờ. Thêm bản tiếng Anh bằng | khi có mẫu.'
}
if (LIVE.elements.some(e => e.name === ELEMENT.name)) throw new Error(`Element ${ELEMENT.name} đã có`)
for (const name of ['GroupPostSubmitButtonAfterClick', 'GroupPostFrequencyLimitError']) {
  if (!LIVE.elements.some(e => e.name === name)) throw new Error(`Fixture thiếu element ${name}`)
}

const EDITS = [
  {
    from: "const accountAccessLimitedNotice = await helpers.element('GroupPostAccountAccessLimitedNotice');\n",
    to: "const accountAccessLimitedNotice = await helpers.element('GroupPostAccountAccessLimitedNotice');\n" +
      `const frequencyLimitNotice = await helpers.element('${ELEMENT.name}');\n`
  },
  {
    from: "let message = '';\n",
    to: "let message = '';\nlet frequencyLimitSeen = 0;\n"
  },
  {
    from: "    break;\n  }\n  const remainingMs = publishTimeoutMs - (Date.now() - publishStarted);\n",
    to: [
      '    break;',
      '  }',
      '  // V673: chữ giới hạn tần suất trong hộp Tạo bài viết là Facebook đã từ chối bài (nút Đăng vẫn bấm được, không còn "Đang đăng"; ảnh + DOM',
      `  // yêu cầu 44 / 45 ngày 27/11). Thấy ${SEEN_ROUNDS} vòng liền thì báo ngay như khi hết giờ, không chờ đủ 60 / 180 giây.`,
      '  frequencyLimitSeen = await hasVisibleElement(frequencyLimitNotice) ? frequencyLimitSeen + 1 : 0;',
      `  if (frequencyLimitSeen >= ${SEEN_ROUNDS}) {`,
      `    message = '${FB02.message}';`,
      '    vars.groupPostSubmitted = false;',
      '    vars.groupPostFrequencyLimitError = true;',
      '    helpers.log(message);',
      '    throw new Error(message);',
      '  }',
      '  const remainingMs = publishTimeoutMs - (Date.now() - publishStarted);',
      ''
    ].join('\n')
  }
]
let NEW_CODE = LIVE.block.code
for (const edit of EDITS) {
  if (NEW_CODE.split(edit.from).length !== 2) throw new Error('Đoạn code cần sửa phải xuất hiện đúng một lần')
  NEW_CODE = NEW_CODE.replace(edit.from, edit.to)
}
for (const edit of EDITS) if (NEW_CODE.split(edit.to).length !== 2) throw new Error('Đoạn code mới phải xuất hiện đúng một lần')
// Câu ném trong vòng chờ phải trùng câu nhánh hết giờ (một dấu hiệu, một luật).
if (NEW_CODE.split(`message = '${FB02.message}';`).length !== 3) throw new Error('Câu giới hạn tần suất phải có ở vòng chờ và nhánh hết giờ')
const NEW_MD5 = md5(NEW_CODE)
const Q = '$v673$'
for (const text of [LIVE.block.code, NEW_CODE, ...EDITS.flatMap(e => [e.from, e.to])]) if (text.includes(Q)) throw new Error('Code chứa dấu nháy $v673$')
const dq = text => `${Q}${text}${Q}`

const migration = `-- ${NAME}: đăng nhóm bị Facebook giới hạn tần suất thì block chờ form đóng báo FB02 ngay khi thấy chữ trong hộp Tạo bài viết,
-- không chờ hết 60 / 180 giây. Anh chốt 27/11/2026 (câu 9004 của hộp thư lỗi; docs/ENGINE_V2_FACEBOOK_GROUP_POST_FREQUENCY_EARLY_V673.md). Sinh
-- bằng scripts/build-v673-sql.cjs (nguồn kiểm scripts/fixtures/engine-v2-facebook/v673-live-20261127.json), không sửa tay. Chỉ dữ liệu, không
-- DDL (không nạp lại schema PostgREST).
--   * Element mới ${ELEMENT.name}: chữ "giới hạn tần suất bạn đăng bài" trong hộp thoại / form, ngoài ô soạn.
--   * Bản "[engine]" của block chờ form đăng nhóm đóng (${BLOCK.id}; bộ cũ ${BLOCK.sourceId} không đổi): form còn mở mà thấy element đó ${SEEN_ROUNDS} vòng
--     liền (vòng 500 ms) thì ném câu "${FB02.message}" như nhánh hết giờ (luật 116 → ${FB02.pub}, chính sách không đổi).
--   * Nhánh hết giờ giữ nguyên (element 1710 cả trang, ba chữ đỏ V597).
-- Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v673_%') THEN
      RAISE EXCEPTION 'V673: sổ migration đã có migration_v673_%%, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND name = ${lit(BLOCK.name)} AND md5(code) = '${BLOCK.oldMd5}') THEN
    RAISE EXCEPTION 'V673: block ${BLOCK.id} khác bản đã đọc (md5 ${BLOCK.oldMd5}), đọc lại và sinh lại';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V673: block ${BLOCK.id} có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND commit_level = ${STEP.commitLevel}
                   AND reviewed_code_md5 = '${BLOCK.oldMd5}') THEN
    RAISE EXCEPTION 'V673: dòng danh mục bước ${STEP.id} khác bản đã đọc';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name = ${lit(ELEMENT.name)}) THEN
    RAISE EXCEPTION 'V673: đã có element ${ELEMENT.name}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_elements WHERE name = 'GroupPostFrequencyLimitError')
     OR NOT EXISTS (SELECT 1 FROM public.auto_elements WHERE name = 'GroupPostSubmitButtonAfterClick') THEN
    RAISE EXCEPTION 'V673: thiếu element block ${BLOCK.id} đang dùng';
  END IF;
END $pre$;

INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id) VALUES
  (${lit(ELEMENT.name)}, ${lit(ELEMENT.xpath)}, ${lit(ELEMENT.description)}, 'facebook', true, NULL, NULL);

${EDITS.map(e => `UPDATE public.auto_blocks SET code = replace(code, ${dq(e.from)}, ${dq(e.to)}), updated_at = now()
 WHERE id = ${BLOCK.id} AND strpos(code, ${dq(e.to)}) = 0;`).join('\n')}
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${NEW_MD5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${BLOCK.oldMd5}';

DO $post$
DECLARE v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V673 postflight: code block ${BLOCK.id} không ra đúng bản mong đợi (md5 ${NEW_MD5})';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.sourceId} AND md5(code) = '${BLOCK.sourceMd5}') THEN
    RAISE EXCEPTION 'V673 postflight: block bộ cũ ${BLOCK.sourceId} bị đổi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${NEW_MD5}') THEN
    RAISE EXCEPTION 'V673 postflight: danh mục bước của block ${BLOCK.id} chưa ghi md5 mới';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_elements WHERE name = ${lit(ELEMENT.name)} AND xpath = ${lit(ELEMENT.xpath)};
  IF v_n <> 1 THEN RAISE EXCEPTION 'V673 postflight: % element mới', v_n; END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ ${NAME}: trả block ${BLOCK.id} và dòng danh mục bước ${STEP.id} về bản trước V673 (bản V597), rồi xoá element ${ELEMENT.name} (block không
-- còn đọc). Chỉ chạy khi block đang đúng bản V673 (đã ai sửa sau V673 thì dừng, không ghi đè). Sinh bằng scripts/build-v673-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V673: block ${BLOCK.id} khác bản V673 (md5 ${NEW_MD5})';
  END IF;
END $pre$;

${[...EDITS].reverse().map(e => `UPDATE public.auto_blocks SET code = replace(code, ${dq(e.to)}, ${dq(e.from)}), updated_at = now()
 WHERE id = ${BLOCK.id};`).join('\n')}
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${BLOCK.oldMd5}', updated_at = now()
 WHERE id = ${STEP.id} AND block_id = ${BLOCK.id} AND reviewed_code_md5 = '${NEW_MD5}';
DELETE FROM public.auto_elements WHERE name = ${lit(ELEMENT.name)};

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${BLOCK.id} AND md5(code) = '${BLOCK.oldMd5}')
     OR EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${BLOCK.id} AND reviewed_code_md5 IS DISTINCT FROM '${BLOCK.oldMd5}')
     OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name = ${lit(ELEMENT.name)}) THEN
    RAISE EXCEPTION 'Gỡ V673: dữ liệu chưa về bản trước V673';
  END IF;
END $post$;

COMMIT;
`

const outputs = [[`migrations/${NAME}.sql`, migration], [`migrations/${ROLLBACK_NAME}.sql`, rollback]]
if (require.main === module) {
  const check = process.argv.includes('--check')
  for (const [file, sql] of outputs) {
    const target = path.join(ROOT, file)
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== sql) throw new Error(`${file} lệch bộ sinh, chạy lại bộ sinh`)
    } else {
      fs.writeFileSync(target, sql)
    }
    console.log(`${check ? 'khớp' : 'đã ghi'} ${file} (md5 ${md5(sql)})`)
  }
  console.log(`block ${BLOCK.id}: ${BLOCK.oldMd5} -> ${NEW_MD5}`)
}

module.exports = { NAME, ROLLBACK_NAME, BLOCK, STEP, FB02, SEEN_ROUNDS, ELEMENT, EDITS, NEW_CODE, NEW_MD5, LIVE, migration, rollback }
