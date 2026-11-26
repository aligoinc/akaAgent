// V663 chạy thật trong Electron, không chạm Facebook: đóng gói v663-electron-main.ts bằng esbuild (electron để ngoài; helpers.element đổi tên
// phần tử ra XPath bằng ảnh chụp production 26/11 scripts/fixtures/engine-v2-facebook/v663-live-20261126.json thay cho DB), mở Electron của
// repo, in kết quả. Code block: bản production (ảnh chụp) và bản V663 (scripts/build-v663-sql.cjs).
// Chạy: node scripts/engine-v2-facebook/v663-electron-smoke.cjs   (V663_EXPECT_NEW_ON_OLD=1: kỳ vọng của V663 chạy trên code production, phải
// hỏng; Linux không màn hình: xvfb-run -a …, ELECTRON_DISABLE_SANDBOX=1 nếu chạy bằng root)
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { build } = require('esbuild')
const V = require('../build-v663-sql.cjs')

const ROOT = path.resolve(__dirname, '../..')
const FIXTURE = path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v663-live-20261126.json')

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-v663-electron-build-'))
  const outfile = path.join(dir, 'main.cjs')
  const codesFile = path.join(dir, 'codes.json')
  fs.writeFileSync(codesFile, JSON.stringify({ get: { production: V.GET.code, V663: V.GET.newCode }, switch: { production: V.SWITCH.code, V663: V.SWITCH.newCode } }))
  await build({
    entryPoints: [path.join(__dirname, 'v663-electron-main.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node20',
    external: ['electron'], logLevel: 'warning',
    plugins: [{
      name: 'stub-elements',
      setup(b) {
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
  const env = { ...process.env, FB_ELECTRON_FIXTURE: FIXTURE, V663_ELECTRON_CODES: codesFile, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  const args = process.env.ELECTRON_DISABLE_SANDBOX ? [outfile, '--no-sandbox'] : [outfile]
  const child = spawn(electron, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', chunk => { out += chunk; process.stdout.write(chunk) })
  child.stderr.on('data', chunk => { const text = String(chunk); if (/FAIL|Error|lỗi/i.test(text)) process.stderr.write(text) })
  const timer = setTimeout(() => { console.log('FAIL quá 8 phút, dừng Electron'); child.kill('SIGKILL') }, 8 * 60_000)
  const code = await new Promise(resolve => child.on('exit', resolve))
  clearTimeout(timer)
  fs.rmSync(dir, { recursive: true, force: true })
  if (code !== 0 || /^FAIL/m.test(out) || !/kiểm tra đạt/.test(out)) process.exit(1)
}

main().catch(error => { console.error(error); process.exit(1) })
