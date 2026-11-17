// Chạy thật trong Electron, không chạm Facebook (phương án mục 9.5, phần chỉ Chromium thật kiểm được): đóng gói
// electron-real-main.ts bằng esbuild (electron để ngoài; phần tử đổi tên ra XPath bằng ảnh chụp DB thay cho DB), mở Electron của repo
// với bản đóng gói, in kết quả. Ảnh chụp: scripts/fixtures/engine-v2-facebook/electron-blocks-20261117.json (code block 27, 30 và XPath
// thật, đọc chỉ đọc production 17/11). Dấu hiệu lỗi lấy đúng dòng thiết lập V559 sinh ra.
// Chạy: node scripts/engine-v2-facebook/electron-real-smoke.cjs   (Linux không màn hình: xvfb-run -a node …, ELECTRON_DISABLE_SANDBOX=1 nếu chạy bằng root)
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { build } = require('esbuild')

const ROOT = path.resolve(__dirname, '../..')
const FIXTURE = path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/electron-blocks-20261117.json')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-electron-build-'))
  const outfile = path.join(dir, 'main.cjs')
  await build({
    entryPoints: [path.join(__dirname, 'electron-real-main.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node20',
    external: ['electron'], logLevel: 'warning',
    plugins: [{
      name: 'stub-elements',
      setup(b) {
        // helpers.element đổi tên phần tử ra XPath bằng ảnh chụp DB (bản thật đọc auto_elements).
        b.onResolve({ filter: /elementV2Repository$/ }, args => ({ path: args.path, namespace: 'stub-elements' }))
        b.onLoad({ filter: /.*/, namespace: 'stub-elements' }, () => ({
          loader: 'js',
          contents: `const fixture = JSON.parse(require('node:fs').readFileSync(process.env.FB_ELECTRON_FIXTURE, 'utf8'))
exports.resolveXpathByName = async name => { const x = fixture.elements[name]; if (!x) throw new Error('Phần tử chưa có trong ảnh chụp: ' + name); return x }`
        }))
      }
    }]
  })
  const electron = require('electron')
  const env = { ...process.env, FB_ELECTRON_FIXTURE: FIXTURE, FB_ELECTRON_SIGNS: require('../build-v559-sql.cjs').SIGNS_JSON,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  const args = process.env.ELECTRON_DISABLE_SANDBOX ? [outfile, '--no-sandbox'] : [outfile]
  const child = spawn(electron, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', chunk => { out += chunk; process.stdout.write(chunk) })
  child.stderr.on('data', chunk => { const text = String(chunk); if (/FAIL|Error|lỗi/i.test(text)) process.stderr.write(text) })
  const timer = setTimeout(() => { console.log('FAIL quá 5 phút, dừng Electron'); child.kill('SIGKILL') }, 5 * 60_000)
  const code = await new Promise(resolve => child.on('exit', resolve))
  clearTimeout(timer)
  fs.rmSync(dir, { recursive: true, force: true })
  if (code !== 0 || /^FAIL/m.test(out) || !/nhóm kiểm tra đạt/.test(out)) process.exit(1)
}

main().catch(error => { console.error(error); process.exit(1) })
