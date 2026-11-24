#!/usr/bin/env node
/**
 * Chạy bộ kiểm cú pháp thật trên các ô nội dung đã xuất bằng scan-export.sql (chỉ đọc, không gọi DB).
 * In danh sách chiến dịch / mẫu nội dung còn lỗi, chữ số trong đoạn trích đã che. Dùng lại sau mỗi đợt phát hành.
 *   node scripts/content-syntax/scan-prod.cjs <tệp xuất>.json [--all]     (--all: in cả dòng chỉ có cảnh báo)
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'content-syntax-scan-'))
fs.writeFileSync(path.join(out, 'contentSyntax.js'), ts.transpileModule(
  fs.readFileSync(path.join(root, 'src/shared/contentSyntax.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText)
const syntax = require(path.join(out, 'contentSyntax.js'))

const file = process.argv[2]
if (!file) {
  console.error('Thiếu tệp xuất. Xem cách chạy ở đầu file.')
  process.exit(2)
}
const showAll = process.argv.includes('--all')

/** Nhận mảng dòng, kết quả `supabase db query -o json`, hoặc tệp kết quả của công cụ MCP. */
function findRows(value) {
  if (typeof value === 'string') {
    const start = value.search(/\[\s*\{/)
    const end = value.lastIndexOf(']')
    if (start < 0 || end < start) return null
    try { return findRows(JSON.parse(value.slice(start, end + 1))) } catch { return null }
  }
  if (Array.isArray(value)) {
    if (value.length && value[0] && typeof value[0] === 'object' && 'txt' in value[0]) return value
    for (const item of value) {
      const found = findRows(item)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      const found = findRows(value[key])
      if (found) return found
    }
  }
  return null
}
const raw = fs.readFileSync(file, 'utf8')
let rows = null
try { rows = findRows(JSON.parse(raw)) } catch { rows = findRows(raw) }
if (!rows) {
  console.error('Không đọc được dòng nào từ tệp xuất.')
  process.exit(2)
}

const mask = text => String(text).replace(/[0-9]/g, '•')
const reportOf = row => {
  if (row.action === 'template') {
    return { label: 'Nội dung mẫu', result: syntax.analyzeContentSyntax(row.txt, { channel: 'other', html: 'auto' }) }
  }
  const field = String(row.field)
  const item = /^advancedContentItems\[(\d+)\]\.content$/.exec(field)
  const input = { actionId: row.action, extraSettings: {} }
  if (field === 'content') input.content = row.txt
  else if (item) {
    const items = []
    items[Number(item[1])] = { content: row.txt }
    input.extraSettings.advancedContentItems = items
  } else input.extraSettings[field] = row.txt
  return syntax.analyzeCampaignContentFields(input)[0]
}

const counts = { block: 0, warn: 0, clean: 0 }
const byCode = {}
const lines = []
const merged = []
for (const row of rows) {
  const report = reportOf(row)
  if (!report) { counts.clean += 1; continue }
  const { result } = report
  const blocking = result.issues.filter(issue => issue.severity === 'block')
  if (blocking.length) counts.block += 1
  else if (result.issues.length) counts.warn += 1
  else counts.clean += 1
  for (const issue of result.issues) byCode[`${issue.severity}:${issue.code}`] = (byCode[`${issue.severity}:${issue.code}`] || 0) + 1
  if (result.lostSeparators > 0) merged.push(row.id)
  if (!blocking.length && !(showAll && result.issues.length)) continue
  const shown = (showAll ? result.issues : blocking).slice(0, 4)
    .map(issue => `${issue.severity === 'block' ? 'CHẶN' : 'nhắc'} ${issue.code} «${mask(issue.excerpt)}»`).join(' ; ')
  const who = row.id < 0 ? `mẫu nội dung ${-row.id}` : `chiến dịch ${row.id}`
  lines.push(`${who} | tổ chức ${row.org} | ${row.action} | ${row.status || '-'} | ${row.field} | ${result.variantCount} mẫu, mất ${result.lostSeparators} dấu | ${shown}`)
}
console.log(`Ô nội dung đã kiểm: ${rows.length}. Có lỗi mức chặn: ${counts.block}. Chỉ có cảnh báo: ${counts.warn}. Sạch: ${counts.clean}.`)
console.log(`Theo loại lỗi: ${JSON.stringify(byCode)}`)
console.log(`Ô đang bị gộp mẫu: ${merged.length}${merged.length ? ` (${[...new Set(merged)].join(', ')})` : ''}`)
console.log(lines.sort().join('\n'))
fs.rmSync(out, { recursive: true, force: true })
