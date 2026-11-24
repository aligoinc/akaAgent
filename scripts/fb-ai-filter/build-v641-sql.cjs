#!/usr/bin/env node
// Sinh migration V641: 10 block lọc AI (Comment seeding, Tìm data trong group, Tìm data bằng search; bộ cũ và bản "[engine]") gọi lời dặn mới
// qua mã cấu hình `<mã cũ>_v2` (V640), thử lại 2 lần, rồi gọi mô hình dự phòng `fb_ai_content_filter_fallback`.
//   * Bộ cũ (Desktop dưới 9.9.0): cả hai mô hình đều lỗi thì giữ như hiện nay (Comment seeding bỏ bài, Tìm data báo lỗi).
//   * Bản "[engine]": cả hai mô hình đều lỗi thì báo câu "AI lọc bài tạm thời không dùng được", dấu hiệu V640 đổi thành FB53 (tạm dừng chiến dịch,
//     data về hàng đợi, không tính lượt, không cộng chuỗi).
// Phương án: docs/FB_AI_FILTER_PLAN.md mục 1.4. Chỉ dữ liệu (không DDL). Nguồn kiểm: scripts/fixtures/fb-ai-filter/blocks-live-20261124.json.
//   node scripts/fb-ai-filter/build-v641-sql.cjs           ghi migration + bản gỡ + code mới (để bài kiểm dùng)
//   node scripts/fb-ai-filter/build-v641-sql.cjs --check   chỉ kiểm file đang có khớp bộ sinh
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '../..')
const NUMBER = 'v641'
const NAME = 'migration_v641_fb_ai_filter_blocks'
const ROLLBACK_NAME = 'rollback_v641_fb_ai_filter_blocks'
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/fb-ai-filter/blocks-live-20261124.json'), 'utf8'))
const FRAGMENT = fs.readFileSync(path.join(__dirname, 'ai-filter-call.fragment.js'), 'utf8')

// Cặp bộ cũ / bản engine (sổ chép block auto_engine_block_copies) và mã cấu hình AI đang gọi.
const PAIRS = [
  { kind: 'seeding', old: 2554, engine: 2859, code: 'fb_prepare_seeding_iterations_ai_filter' },
  { kind: 'find', old: 2602, engine: 2863, code: 'fb_extract_data_from_group_posts_ai_filter' },
  { kind: 'find', old: 2603, engine: 2864, code: 'fb_collect_group_comments_ai_filter' },
  { kind: 'find', old: 2718, engine: 2904, code: 'fb_extract_data_from_search_posts_ai_filter' },
  { kind: 'find', old: 2719, engine: 2905, code: 'fb_collect_search_post_comments_ai_filter' }
]
const FINAL = {
  old: 'return { ok: false, error: lastError }',
  engine: "throw new Error(__AI_FILTER_UNAVAILABLE + ' (' + String(lastError).slice(0, 200) + ')')"
}
const helperFor = variant => {
  if (FRAGMENT.split('__AI_FILTER_FINAL__').length !== 2) throw new Error('Fragment phải có đúng một chỗ __AI_FILTER_FINAL__')
  return FRAGMENT.replace('__AI_FILTER_FINAL__', FINAL[variant])
}

const OLD_CENTRAL = [
  'const __callCentralAI = async (usingCode, payload) => {',
  "  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');",
  "  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');",
  '  const result = await helpers.callAIUsing(usingCode, payload || {});',
  "  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');",
  "  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));",
  '  return result;',
  '};'
].join('\n')

// Mỗi lần sửa là một cặp (đoạn cũ, đoạn mới) xuất hiện đúng một lần, nên migration viết bằng replace() của Postgres
// (thay mọi chỗ = thay đúng một chỗ) thay vì chép nguyên code mới; md5 trước / sau chốt kết quả.
function edit(code, from, to, edits) {
  if (code.split(from).length !== 2) throw new Error(`Đoạn cần sửa phải xuất hiện đúng một lần: ${from.slice(0, 80)}`)
  const out = code.replace(from, () => to)
  if (out.split(to).length !== 2) throw new Error(`Đoạn mới phải xuất hiện đúng một lần: ${to.slice(0, 80)}`)
  edits.push([from, to])
  return out
}
const replaceAll = (text, from, to) => text.split(from).join(to)

function rewrite(block, pair, variant, edits) {
  let code = block.code
  const helper = helperFor(variant)
  if (pair.kind === 'seeding') {
    code = edit(code, `const AI_USING_CODE = '${pair.code}'\n`, `const AI_USING_CODE = '${pair.code}_v2'\n`, edits)
    code = edit(code, '\nasync function checkMeaningAi(content) {\n', `\n${helper}\nasync function checkMeaningAi(content) {\n`, edits)
    code = edit(code, '  const result = await helpers.callAIUsing(AI_USING_CODE, {\n', '  const result = await __aiFilterCall(AI_USING_CODE, {\n', edits)
  } else {
    code = edit(code, `const __aiFindDataUsingCode = "${pair.code}";\n`, `const __aiFindDataUsingCode = "${pair.code}_v2";\n`, edits)
    code = edit(code, OLD_CENTRAL, [
      helper.trimEnd(),
      'const __callCentralAI = async (usingCode, payload) => {',
      "  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');",
      "  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');",
      '  const result = await __aiFilterCall(usingCode, payload || {});',
      "  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');",
      "  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));",
      '  return result;',
      '};'
    ].join('\n'), edits)
  }
  return code
}

const byId = new Map(LIVE.blocks.map(b => [b.id, b]))
const CHANGES = []
for (const pair of PAIRS) {
  for (const variant of ['old', 'engine']) {
    const id = pair[variant]
    const block = byId.get(id)
    if (!block) throw new Error(`Thiếu block ${id} trong fixture`)
    if (md5(block.code) !== block.md5) throw new Error(`Fixture block ${id} lệch md5`)
    const edits = []
    const code = rewrite(block, pair, variant, edits)
    // replace() thay mọi chỗ: kiểm lại cả hai chiều cho ra đúng code như bản sửa từng chỗ.
    if (edits.reduce((text, [from, to]) => replaceAll(text, from, to), block.code) !== code) throw new Error(`Block ${id}: replace() khác bản sửa`)
    if (edits.slice().reverse().reduce((text, [from, to]) => replaceAll(text, to, from), code) !== block.code) throw new Error(`Block ${id}: gỡ bằng replace() không về code cũ`)
    CHANGES.push({ id, name: block.name, variant, kind: pair.kind, code: pair.code, oldMd5: block.md5, oldCode: block.code, newCode: code, newMd5: md5(code), edits })
  }
}
// Bộ cũ và bản engine của cùng block đang trùng code; sau khi sửa chỉ khác dòng báo lỗi cuối.
for (const pair of PAIRS) {
  const o = CHANGES.find(c => c.id === pair.old)
  const e = CHANGES.find(c => c.id === pair.engine)
  if (o.oldMd5 !== e.oldMd5) throw new Error(`Block ${pair.old} và ${pair.engine} không còn trùng code`)
  if (o.newCode.replace(FINAL.old, FINAL.engine) !== e.newCode) throw new Error(`Block ${pair.engine} khác bản cũ ngoài dòng báo lỗi`)
}

const Q = `$${NUMBER}$`
for (const c of CHANGES) if (c.newCode.includes(Q) || c.oldCode.includes(Q)) throw new Error(`Code chứa ${Q}`)
const dq = text => `${Q}${text}${Q}`
const replaceExpr = edits => edits.reduce((expr, [from, to]) => `replace(${expr},\n  ${dq(from)},\n  ${dq(to)})`, 'code')

const header = [
  `-- ${NAME}: 10 block lọc AI (Comment seeding, Tìm data trong group, Tìm data bằng search; bộ cũ và bản "[engine]") gọi lời dặn mới`,
  "-- qua mã `<mã cũ>_v2` (V640), thử lại 2 lần rồi gọi mô hình dự phòng fb_ai_content_filter_fallback. Câu trả lời sai khuôn cũng tính là lỗi.",
  '-- Bản "[engine]": cả hai mô hình đều lỗi thì báo "AI lọc bài tạm thời không dùng được" (FB53: tạm dừng chiến dịch, data về hàng đợi).',
  '-- Bộ cũ (Desktop dưới 9.9.0): cả hai mô hình đều lỗi thì giữ như hiện nay. Phương án: docs/FB_AI_FILTER_PLAN.md mục 1.4.',
  '-- Sinh bằng scripts/fb-ai-filter/build-v641-sql.cjs, không sửa tay. Chỉ dữ liệu (không DDL, không nạp lại schema PostgREST). Phải apply sau V640.',
  `-- Gỡ: ${ROLLBACK_NAME}.sql.`
].join('\n')

// Sổ chép block bộ cũ ↔ engine: cả hai bên sửa cùng lúc (đã duyệt) nên ghi md5 mới như V589, để trace.cjs --drift không báo lệch.
const pairMd5 = pair => {
  const source = CHANGES.find(c => c.id === pair.old), engine = CHANGES.find(c => c.id === pair.engine)
  return { oldMd5: source.oldMd5, sourceNew: source.newMd5, engineNew: engine.newMd5 }
}
const copyGuards = (label, sourceKey, engineKey) => PAIRS.map(pair => {
  const m = pairMd5(pair)
  return `  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = ${pair.engine} AND source_block_id = ${pair.old} AND source_md5_at_copy = '${m[sourceKey]}' AND engine_md5_at_copy = '${m[engineKey]}') THEN RAISE EXCEPTION '${label}: sổ chép block ${pair.engine} khác mong đợi'; END IF;`
})
const copyUpdates = (sourceFrom, engineFrom, sourceTo, engineTo) => PAIRS.map(pair => {
  const m = pairMd5(pair)
  return `UPDATE public.auto_engine_block_copies SET source_md5_at_copy = '${m[sourceTo]}', engine_md5_at_copy = '${m[engineTo]}'\n WHERE engine_block_id = ${pair.engine} AND source_block_id = ${pair.old} AND source_md5_at_copy = '${m[sourceFrom]}' AND engine_md5_at_copy = '${m[engineFrom]}';`
}).join('\n')

function migration() {
  const pre = [
    'DO $pre$',
    'DECLARE v_n integer;',
    'BEGIN',
    "  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN",
    `    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_${NUMBER}_%') THEN`,
    `      RAISE EXCEPTION 'V641: sổ migration đã có migration_${NUMBER}_%%, không chạy lại';`,
    '    END IF;',
    "    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v640_%') THEN",
    "      RAISE EXCEPTION 'V641: cần apply V640 trước';",
    '    END IF;',
    '  END IF;',
    ...CHANGES.map(c => `  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${c.id} AND md5(code) = '${c.oldMd5}') THEN RAISE EXCEPTION 'V641: block ${c.id} khác bản đã đọc (md5 ${c.oldMd5})'; END IF;`),
    `  SELECT count(*) INTO v_n FROM public.ai_using WHERE code IN (${PAIRS.map(p => `'${p.code}_v2'`).join(', ')}, 'fb_ai_content_filter_fallback') AND is_active;`,
    "  IF v_n <> 6 THEN RAISE EXCEPTION 'V641: cần 6 mã cấu hình AI của V640, có %', v_n; END IF;",
    ...copyGuards('V641', 'oldMd5', 'oldMd5'),
    "  IF NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'facebook.error_signs' AND value LIKE '%err_fb_ai_filter_unavailable%') THEN",
    "    RAISE EXCEPTION 'V641: thiếu dấu hiệu FB53 của V640';",
    '  END IF;',
    'END $pre$;'
  ].join('\n')
  const updates = CHANGES.map(c => `UPDATE public.auto_blocks SET code = ${replaceExpr(c.edits)}, updated_at = now()\n WHERE id = ${c.id} AND md5(code) = '${c.oldMd5}';`).join('\n\n')
  const post = [
    'DO $post$',
    'BEGIN',
    ...CHANGES.map(c => `  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${c.id} AND md5(code) = '${c.newMd5}') THEN RAISE EXCEPTION 'V641 postflight: block ${c.id} không ra md5 ${c.newMd5}'; END IF;`),
    ...copyGuards('V641 postflight', 'sourceNew', 'engineNew'),
    'END $post$;'
  ].join('\n')
  return [header, 'BEGIN;', "SET LOCAL lock_timeout = '3s';", "SET LOCAL statement_timeout = '60s';", '', pre, '', updates, '',
    copyUpdates('oldMd5', 'oldMd5', 'sourceNew', 'engineNew'), '', post, '', 'COMMIT;', ''].join('\n')
}

function rollback() {
  const updates = CHANGES.map(c => `UPDATE public.auto_blocks SET code = ${replaceExpr(c.edits.slice().reverse().map(([from, to]) => [to, from]))}, updated_at = now()\n WHERE id = ${c.id} AND md5(code) = '${c.newMd5}';`).join('\n\n')
  const post = [
    'DO $post$',
    'BEGIN',
    ...CHANGES.map(c => `  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${c.id} AND md5(code) = '${c.oldMd5}') THEN RAISE EXCEPTION 'Gỡ V641: block ${c.id} không về md5 ${c.oldMd5}'; END IF;`),
    ...copyGuards('Gỡ V641', 'oldMd5', 'oldMd5'),
    'END $post$;'
  ].join('\n')
  return [`-- ${ROLLBACK_NAME}: trả 10 block lọc AI về code trước V641 (kiểm md5 bản V641 trước khi ghi). Mã cấu hình cũ vẫn còn nên chạy lại như trước.`,
    'BEGIN;', "SET LOCAL lock_timeout = '3s';", '', updates, '', copyUpdates('sourceNew', 'engineNew', 'oldMd5', 'oldMd5'), '', post, '', 'COMMIT;', ''].join('\n')
}

const OUT = {
  [path.join(ROOT, 'migrations', `${NAME}.sql`)]: migration(),
  [path.join(ROOT, 'migrations', `${ROLLBACK_NAME}.sql`)]: rollback(),
  [path.join(ROOT, 'scripts/fixtures/fb-ai-filter/blocks-v641.json')]: JSON.stringify({ note: 'Code 10 block sau V641, sinh bằng build-v641-sql.cjs.',
    blocks: CHANGES.map(c => ({ id: c.id, name: c.name, variant: c.variant, kind: c.kind, md5: c.newMd5, code: c.newCode })) }, null, 1) + '\n'
}
if (require.main === module && process.argv.includes('--check')) {
  for (const [file, text] of Object.entries(OUT)) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error('Lệch bộ sinh:', path.relative(ROOT, file)); process.exit(1) }
  }
  console.log('V641 khớp bộ sinh')
} else if (require.main === module) {
  for (const [file, text] of Object.entries(OUT)) fs.writeFileSync(file, text)
  for (const c of CHANGES) console.log(c.id, c.variant, c.oldMd5, '->', c.newMd5)
}
module.exports = { CHANGES, PAIRS, md5 }
