// Kiểm ranh giới tĩnh cho engine kết quả v2: chặn những kiểu code làm lọt lỗi hoặc treo.
// Quét packages/campaign-engine/src và (khi có) adapter của Desktop src/main/engineAdapters.
// Chạy: node scripts/campaign-engine-boundary-check.cjs   (thoát 1 nếu có vi phạm)
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const CORE = path.join(ROOT, 'packages/campaign-engine/src')
const ADAPTERS = [path.join(ROOT, 'src/main/engineAdapters')]
const PORT_METHODS = ['claimTarget', 'markSending', 'report', 'heartbeat', 'release', 'recordWait']
// API Zalo/Facebook/Email giao tới người nhận: chỉ được gọi trong run() của bước delivery: true.
const SEND_APIS = ['sendMessage', 'sendText', 'sendMedia', 'sendFriendRequest', 'addUserToGroup', 'forwardMessage', 'sendVideo', 'sendVoice', 'sendLink',
  'sendCard', 'sendSticker', 'sendMail', 'sendEmail', 'postToGroup', 'publishPost']

const listTs = dir => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? listTs(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : [])
  : []
const lineOf = (text, index) => text.slice(0, index).split('\n').length
/** Bỏ chú thích và chuỗi để regex không khớp nhầm vào chữ. */
const stripCode = text => text
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
  .replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, m => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[m.length - 1])

const violations = []
const report = (file, index, text, rule, message) => violations.push(`${path.relative(ROOT, file)}:${lineOf(text, index)} [${rule}] ${message}`)

function checkCommon(file, raw) {
  const code = stripCode(raw)
  // 1. Nuốt lỗi: catch rỗng (không lệnh, không chú thích).
  for (const m of raw.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)) report(file, m.index, raw, 'EMPTY_CATCH', 'catch rỗng nuốt lỗi; ghi vết hoặc chuyển thành kết quả')
  // 2. Lời gọi DB không hạn giờ: mọi lời gọi cổng dữ liệu phải nằm trong withDeadline/callUntilAvailable.
  const portCall = new RegExp(`\\b(?:deps\\.)?data\\.(${PORT_METHODS.join('|')})\\(`, 'g')
  for (const m of code.matchAll(portCall)) {
    const before = code.slice(Math.max(0, m.index - 400), m.index)
    const wrapper = Math.max(before.lastIndexOf('withDeadline('), before.lastIndexOf('callUntilAvailable('))
    if (wrapper < 0 || !before.slice(wrapper).includes('=>')) report(file, m.index, raw, 'UNBOUNDED_DB_CALL', `${m[1]}() phải chạy trong withDeadline/callUntilAvailable`)
  }
  // 3. Promise trôi nổi: lời gọi cổng dữ liệu đứng một mình không await/return.
  for (const m of code.matchAll(new RegExp(`^[ \\t]*(?!await\\b|return\\b|void\\b)[\\w.]*\\.(${PORT_METHODS.join('|')})\\([^\\n]*$`, 'gm'))) {
    report(file, m.index, raw, 'FLOATING_PROMISE', `${m[1]}() không được await`)
  }
  // 4. setInterval tự chạy mãi: heartbeat/thăm dò phải là vòng async có huỷ.
  for (const m of code.matchAll(/\bsetInterval\(/g)) report(file, m.index, raw, 'UNCANCELLABLE_TIMER', 'dùng vòng sleep(ms, signal) có huỷ thay cho setInterval')
}

function checkCore(file, raw) {
  // Lõi phải là TypeScript thuần: không Electron, không Supabase client, không pg/kysely.
  for (const m of raw.matchAll(/from\s+['"](electron|@supabase\/[^'"]+|pg|kysely)['"]/g)) report(file, m.index, raw, 'CORE_PURITY', `lõi không được import ${m[1]}`)
}

/**
 * Bước của lõi và adapter: lệnh gửi qua cổng chỉ được gọi trong run() của bước delivery: true (runUnit ghi dấu "sắp gửi" trước khi gọi
 * run()), hoặc trong chế độ lô (gửi dạng chia sẻ) sau một lần ghi dấu markSending( của API lô.
 */
function checkSendInDeliveryStep(file, raw) {
  const code = stripCode(raw)
  for (const m of code.matchAll(new RegExp(`\\.(${SEND_APIS.join('|')})\\(`, 'g'))) {
    const before = code.slice(0, m.index)
    const stepStart = before.lastIndexOf('delivery:')
    const marked = before.lastIndexOf('markSending(')
    const declared = (stepStart >= 0 && stepStart > marked && /delivery:\s*true/.test(code.slice(stepStart, stepStart + 20)))
      || (marked >= 0 && marked > stepStart)
    if (!declared) report(file, m.index, raw, 'SEND_OUTSIDE_DELIVERY_STEP', `${m[1]}() phải nằm trong run() của bước delivery: true (hoặc sau markSending của lô)`)
  }
}

// Module của Desktop chép NGUYÊN VĂN vào lõi (dựng nội dung, tra số). Sửa ở Desktop rồi chép lại; lệch là lỗi.
const VERBATIM = [
  ['content/campaignContentTemplate.ts', 'src/shared/campaignContentTemplate.ts'],
  ['content/contentSpin.ts', 'src/shared/contentSpin.ts'],
  ['content/zaloMessageOptOut.ts', 'src/shared/zaloMessageOptOut.ts'],
  ['content/campaignContentPreparation.ts', 'src/shared/campaignContentPreparation.ts'],
  ['content/phone.ts', 'src/shared/phone.ts'],
  ['content/zaloPhoneSearch.ts', 'src/main/services/zaloPhoneSearch.ts'],
  ['content/zaloAuxiliaryActions.ts', 'src/shared/zaloAuxiliaryActions.ts'],
  ['content/formattedContent.ts', 'src/shared/formattedContent.ts'],
  ['content/zaloFormattedContent.ts', 'src/shared/zaloFormattedContent.ts'],
  ['content/messageOptOutSource.ts', 'src/shared/messageOptOutSource.ts']
]
// Lõi biên dịch theo NodeNext nên import tương đối phải có đuôi .js; chỉ khác đúng chỗ đó so với bản gốc của Desktop.
const withoutRelativeJs = text => text.replace(/(from\s+['"]\.{1,2}\/[^'"]+?)\.js(['"])/g, '$1$2')
for (const [core, desktop] of VERBATIM) {
  const a = path.join(CORE, core), b = path.join(ROOT, desktop)
  if (!fs.existsSync(a) || !fs.existsSync(b)) violations.push(`${path.relative(ROOT, a)} [VERBATIM_MISSING] thiếu bản chép hoặc bản gốc ${desktop}`)
  else if (withoutRelativeJs(fs.readFileSync(a, 'utf8')) !== fs.readFileSync(b, 'utf8')) {
    violations.push(`${path.relative(ROOT, a)} [VERBATIM_DRIFT] khác ${desktop}; chép lại nguyên văn (chỉ thêm .js cho import tương đối)`)
  }
}
const verbatimCore = new Set(VERBATIM.map(([core]) => path.join(CORE, core)))

const coreFiles = listTs(CORE)
// Bản chép nguyên văn không sửa được ở lõi: chỉ kiểm độ thuần (không import Electron/Supabase/pg).
for (const file of coreFiles) {
  const raw = fs.readFileSync(file, 'utf8')
  if (verbatimCore.has(file)) { checkCore(file, raw); continue }
  checkCommon(file, raw); checkCore(file, raw); checkSendInDeliveryStep(file, raw)
}
const adapterFiles = ADAPTERS.flatMap(listTs)
for (const file of adapterFiles) { const raw = fs.readFileSync(file, 'utf8'); checkCommon(file, raw); checkSendInDeliveryStep(file, raw) }

if (process.argv.includes('--self-test')) {
  const sample = 'try { x() } catch {}\nconst r = deps.data.report(1)\ndeps.data.release(1, t)\nsetInterval(() => 0, 5)\n'
  const before = violations.length
  checkCommon(path.join(CORE, '__sample__.ts'), sample)
  checkSendInDeliveryStep(path.join(CORE, '__sample__.ts'),
    "const ok = { key: 'a', delivery: true, run: () => port.sendText('u', 'm') }\nconst bad = { key: 'b', delivery: false, run: () => port.sendFriendRequest('u', 'm') }\n"
    + "async function batch(api) { await api.markSending(item, step); await port.forwardMessage(ctx, input) }\n")
  const found = violations.splice(before).map(v => v.match(/\[(\w+)\]/)[1])
  for (const rule of ['EMPTY_CATCH', 'UNBOUNDED_DB_CALL', 'FLOATING_PROMISE', 'UNCANCELLABLE_TIMER', 'SEND_OUTSIDE_DELIVERY_STEP']) {
    if (!found.includes(rule)) { console.error('self-test: luật không bắt được mẫu vi phạm', rule); process.exit(1) }
  }
  if (found.filter(rule => rule === 'SEND_OUTSIDE_DELIVERY_STEP').length !== 1) { console.error('self-test: luật bước gửi bắt nhầm'); process.exit(1) }
  console.log('self-test: 5 luật bắt đúng mẫu vi phạm')
}

console.log(`Đã quét ${coreFiles.length} file lõi (${VERBATIM.length} bản chép nguyên văn từ Desktop), ${adapterFiles.length} file adapter${adapterFiles.length ? '' : ' (chưa có src/main/engineAdapters)'}`)
if (violations.length) {
  console.error(violations.join('\n'))
  console.error(`\n${violations.length} vi phạm ranh giới`)
  process.exit(1)
}
console.log('Không có vi phạm ranh giới')
