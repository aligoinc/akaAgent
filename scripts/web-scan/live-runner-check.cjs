#!/usr/bin/env node
// Dựng live-runner-check.main.ts (PageController + BlockExecutor thật, code block V618 từ bộ sinh, element V618) rồi chạy bằng Electron của repo
// trên trang thật. Ra mạng thật: chỉ chạy khi cần thử block với trang thật.
//   node scripts/web-scan/live-runner-check.cjs <thư mục ra>
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { build } = require('esbuild')
const V = require('../build-v618-sql.cjs')

const outDir = path.resolve(process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'web-scan-live-')))
fs.mkdirSync(outDir, { recursive: true })
const ROOT = path.resolve(__dirname, '../..')
const elements = Object.fromEntries(V.ELEMENTS.map(e => [e.name, e.xpath]))
const blocks = Object.fromEntries(V.BLOCKS.map(b => [b.name, b.code]))

async function main() {
  const bundle = path.join(outDir, 'main.js')
  await build({
    entryPoints: [path.join(__dirname, 'live-runner-check.main.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: bundle,
    external: ['electron'], define: { __BLOCKS__: JSON.stringify(blocks) }, logLevel: 'error',
    plugins: [{ name: 'element-stub', setup(b) {
      b.onResolve({ filter: /elementV2Repository$/ }, () => ({ path: 'element-stub', namespace: 'stub' }))
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: `const M = ${JSON.stringify(elements)};
        exports.resolveXpathByName = async name => { if (!M[name]) throw new Error('Element không có: ' + name); return M[name] };
        exports.invalidateElementCache = () => {};` }))
    } }]
  })
  const electron = require(path.join(ROOT, 'node_modules/electron'))
  const out = path.join(outDir, 'runner.json')
  const r = spawnSync(electron, [bundle], { stdio: 'inherit', env: { ...process.env, LIVE_OUT: out, LIVE_USERDATA: path.join(outDir, 'userdata'), ELECTRON_ENABLE_LOGGING: '0' }, timeout: 15 * 60 * 1000 })
  if (r.status !== 0) console.log('electron exit', r.status, r.signal)
  console.log(out)
}
main().catch(error => { console.error(error); process.exit(1) })
