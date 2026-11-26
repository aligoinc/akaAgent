#!/usr/bin/env node
// Đóng gói bộ đọc + chuẩn hoá dòng Google Sheet (src/shared) thành một tệp ESM cho Edge Function.
// `--check`: báo lỗi nếu tệp đã commit khác bản sinh từ mã hiện tại.
'use strict'
const path = require('node:path')
const fs = require('node:fs')
const esbuild = require('esbuild')
const ROOT = path.resolve(__dirname, '../..')
const OUT = path.join(ROOT, 'supabase/functions/aka-agent-campaign-sheet-sync/core.generated.js')
const result = esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'edge-core-entry.ts')], bundle: true, format: 'esm', platform: 'neutral',
  target: 'es2022', write: false, legalComments: 'none', charset: 'utf8', logLevel: 'error'
})
const code = '// TỆP SINH TỰ ĐỘNG từ src/shared (scripts/campaign-sheet-sync/build-edge-core.cjs). Không sửa tay.\n' + result.outputFiles[0].text
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  if (current !== code) { console.error('core.generated.js đã cũ: chạy node scripts/campaign-sheet-sync/build-edge-core.cjs'); process.exit(1) }
  console.log('core.generated.js khớp mã nguồn')
} else {
  fs.writeFileSync(OUT, code)
  console.log(`Đã ghi ${path.relative(ROOT, OUT)} (${code.length} byte)`)
}
