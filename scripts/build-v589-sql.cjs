#!/usr/bin/env node
// Sinh migrations/migration_v589_facebook_business_token_message.sql và bản gỡ.
// Đổi đúng một câu lỗi trong ba block lấy token từ trang Facebook Business:
// 2636 (quét danh sách Page), 2669 và 2878 (đăng bài fanpage, bộ cũ và "[engine]").
// Nguồn kiểm: scripts/fixtures/facebook-business-token/v589-live-20261119.json (code đọc từ production).
//   node scripts/build-v589-sql.cjs            ghi hai file SQL
//   node scripts/build-v589-sql.cjs --check    chỉ kiểm, không ghi
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const root = path.join(__dirname, '..')
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures/facebook-business-token/v589-live-20261119.json'), 'utf8'))
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const MENU = 'Kiểm tra nhập mã xác minh Fanpage'
const LEAD = `Facebook đang yêu cầu nhập mã xác minh cho tài khoản này. Bấm chuột phải vào tài khoản, chọn "${MENU}", nhập mã rồi `
const CHANGES = [
  {
    id: 2636, name: 'fb_scan_pages_graph',
    from: 'Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử tải page.',
    to: `${LEAD}tải page lại.`
  },
  {
    id: 2669, name: 'fb_page_post_api',
    from: 'Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử chạy chiến dịch.',
    to: `${LEAD}chạy lại chiến dịch.`
  },
  {
    id: 2878, name: '[engine] fb_page_post_api',
    from: 'Không tìm thấy user access token. Hãy mở lại tab Business/Facebook rồi thử chạy chiến dịch.',
    to: `${LEAD}chạy lại chiến dịch.`
  }
]
const ENGINE = { blockId: 2878, sourceBlockId: 2669, stepId: 18 }

const plan = CHANGES.map(change => {
  const block = fixture.blocks.find(item => item.id === change.id)
  if (!block || block.name !== change.name) throw new Error(`Thiếu block ${change.id} trong fixture`)
  if (md5(block.code) !== block.md5) throw new Error(`Fixture block ${change.id} sai md5`)
  if (block.code.split(change.from).length !== 2) throw new Error(`Block ${change.id}: câu cũ phải xuất hiện đúng một lần`)
  if (!block.code.includes(`'${change.from}'`)) throw new Error(`Block ${change.id}: câu cũ không nằm trong nháy đơn`)
  if (/['\\$\n]/.test(change.to)) throw new Error(`Block ${change.id}: câu mới có ký tự làm hỏng chuỗi JS hoặc SQL`)
  const next = block.code.replace(change.from, change.to)
  return { ...change, oldMd5: block.md5, newMd5: md5(next) }
})
const engine = plan.find(item => item.id === ENGINE.blockId)
const source = plan.find(item => item.id === ENGINE.sourceBlockId)
if (engine.newMd5 !== source.newMd5) throw new Error('Bản bộ cũ và bản "[engine]" của đăng bài fanpage phải giống nhau sau khi sửa')

const q = text => `$v589$${text}$v589$`
const header = lines => lines.map(line => `-- ${line}`).join('\n')

function buildSql(direction) {
  const forward = direction === 'apply'
  const tag = forward ? 'V589' : 'Gỡ V589'
  const rows = plan.map(item => forward
    ? { ...item, a: item.from, b: item.to, before: item.oldMd5, after: item.newMd5 }
    : { ...item, a: item.to, b: item.from, before: item.newMd5, after: item.oldMd5 })
  const eng = rows.find(item => item.id === ENGINE.blockId)
  const pre = [
    forward
      ? `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v589_%') THEN
      RAISE EXCEPTION 'V589 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;`
      : null,
    ...rows.map(item => `  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${item.id} AND name = ${q(item.name)} AND md5(code) = '${item.before}') THEN
    RAISE EXCEPTION '${tag}: block ${item.id} khác bản đã đọc (md5 ${item.before}), đọc lại và sinh lại';
  END IF;`),
    `  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = ${ENGINE.blockId} AND source_block_id = ${ENGINE.sourceBlockId}
                   AND source_md5_at_copy = '${eng.before}' AND engine_md5_at_copy = '${eng.before}') THEN
    RAISE EXCEPTION '${tag}: sổ chép block ${ENGINE.blockId} khác bản đã đọc';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE block_id = ${ENGINE.blockId};
  IF v_n <> 1 THEN RAISE EXCEPTION '${tag}: block ${ENGINE.blockId} có % dòng danh mục bước, cần 1', v_n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE id = ${ENGINE.stepId} AND block_id = ${ENGINE.blockId}
                   AND reviewed_code_md5 = '${eng.before}') THEN
    RAISE EXCEPTION '${tag}: dòng danh mục bước ${ENGINE.stepId} của block ${ENGINE.blockId} khác bản đã đọc';
  END IF;`
  ].filter(Boolean).join('\n')

  const updates = rows.map(item => `UPDATE public.auto_blocks SET code = replace(code, ${q(item.a)}, ${q(item.b)}), updated_at = now()
 WHERE id = ${item.id} AND md5(code) = '${item.before}';`).join('\n')

  const post = rows.map(item => `  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${item.id} AND md5(code) = '${item.after}') THEN
    RAISE EXCEPTION '${tag} postflight: code block ${item.id} không ra đúng bản mong đợi (md5 ${item.after})';
  END IF;`).join('\n')

  const head = forward
    ? header([
      'V589: đổi câu lỗi "Không tìm thấy user access token…" của ba block lấy token từ trang Facebook Business thành câu hướng dẫn khách',
      `nhập mã xác minh qua mục menu chuột phải "${MENU}" của tài khoản: block 2636 fb_scan_pages_graph (quét danh sách Page),`,
      '2669 fb_page_post_api và 2878 "[engine] fb_page_post_api" (đăng bài fanpage). Chỉ thay đúng một chuỗi trong code mỗi block, cách lấy',
      'token và điều kiện báo lỗi giữ nguyên; kèm md5 đã duyệt của danh mục bước 18 và sổ chép block 2878. SINH TỪ scripts/build-v589-sql.cjs',
      '(nguồn kiểm: scripts/fixtures/facebook-business-token/v589-live-20261119.json), không sửa tay. Chỉ dữ liệu, không DDL (không nạp lại',
      'schema PostgREST). Mọi bản app đọc code block từ DB mỗi lượt nên câu mới hiện ngay cho cả bản chưa có mục menu: chỉ apply sau khi',
      'bản Desktop có mục menu đã phát hành. Gỡ: rollback_v589_facebook_business_token_message.sql.'
    ])
    : header([
      'Gỡ V589: trả câu lỗi cũ "Không tìm thấy user access token…" cho block 2636, 2669, 2878 cùng md5 đã duyệt của danh mục bước 18 và sổ chép',
      'block 2878. Chỉ chạy khi cả ba block đang đúng bản V589 (đã ai sửa sau V589 thì dừng, không ghi đè). SINH TỪ scripts/build-v589-sql.cjs.'
    ])

  return `${head}
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
${pre}
END $pre$;

${updates}
UPDATE public.auto_engine_block_steps SET reviewed_code_md5 = '${eng.after}', updated_at = now()
 WHERE id = ${ENGINE.stepId} AND block_id = ${ENGINE.blockId} AND reviewed_code_md5 = '${eng.before}';
UPDATE public.auto_engine_block_copies SET source_md5_at_copy = '${eng.after}', engine_md5_at_copy = '${eng.after}'
 WHERE engine_block_id = ${ENGINE.blockId} AND source_block_id = ${ENGINE.sourceBlockId};

DO $post$
BEGIN
${post}
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = ${ENGINE.blockId} AND reviewed_code_md5 IS DISTINCT FROM '${eng.after}') THEN
    RAISE EXCEPTION '${tag} postflight: danh mục bước của block ${ENGINE.blockId} chưa ghi md5 mong đợi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = ${ENGINE.blockId}
                   AND source_md5_at_copy = '${eng.after}' AND engine_md5_at_copy = '${eng.after}') THEN
    RAISE EXCEPTION '${tag} postflight: sổ chép block ${ENGINE.blockId} chưa ghi md5 mong đợi';
  END IF;
END $post$;

COMMIT;
`
}

const outputs = [
  ['migrations/migration_v589_facebook_business_token_message.sql', buildSql('apply')],
  ['migrations/rollback_v589_facebook_business_token_message.sql', buildSql('rollback')]
]
if (require.main === module) {
  const check = process.argv.includes('--check')
  for (const [file, sql] of outputs) {
    const target = path.join(root, file)
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== sql) throw new Error(`${file} lệch bộ sinh, chạy lại bộ sinh`)
    } else {
      fs.writeFileSync(target, sql)
    }
    console.log(`${check ? 'khớp' : 'đã ghi'} ${file} (md5 ${md5(sql)})`)
  }
  for (const item of plan) console.log(`block ${item.id}: ${item.oldMd5} -> ${item.newMd5}\n  ${item.to}`)
}
module.exports = { plan, CHANGES, ENGINE }
