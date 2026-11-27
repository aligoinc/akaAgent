// Ngày kết thúc bắt buộc của lịch tuần / tháng: luật dùng chung src/shared/campaignScheduleEnd.ts (bản chép nguyên văn của
// akaAgentWebApp packages/control-api/src/campaignScheduleEnd.ts). Không cần DB.
// Chạy: node scripts/campaign-schedule-end-smoke.cjs   (WEBAPP_REPO=<checkout akaAgentWebApp> để so md5 hai bản)
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..')
function load(file) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } })
  const module_ = { exports: {} }
  new Function('module', 'exports', 'require', outputText)(module_, module_.exports, request => {
    if (request.startsWith('.')) return load(path.join(path.dirname(file), request).replace(/\.js$/, '') + '.ts')
    return require(request)
  })
  return module_.exports
}
const end = load('src/shared/campaignScheduleEnd.ts')
let cases = 0
const ok = name => { cases++; console.log(`PASS ${name}`) }

// Bản chép khớp bản gốc ở WebApp.
const webapp = process.env.WEBAPP_REPO || path.resolve(ROOT, '..', 'akaAgentWebApp')
const original = path.join(webapp, 'packages/control-api/src/campaignScheduleEnd.ts')
if (fs.existsSync(original)) {
  const md5 = file => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
  assert.equal(md5(path.join(ROOT, 'src/shared/campaignScheduleEnd.ts')), md5(original), 'bản Desktop phải giống hệt bản WebApp')
  ok('bản chép Desktop trùng md5 bản WebApp')
} else console.log(`SKIP so md5 (không thấy ${original})`)

// Giá trị ô lúc mở form.
assert.equal(end.defaultScheduleEndDate('2026-11-27'), '2026-12-04', 'mặc định hôm nay + 7 ngày')
assert.equal(end.defaultScheduleEndDate('2026-12-28'), '2027-01-04', 'qua năm')
assert.equal(end.defaultScheduleEndDate(''), '')
assert.equal(end.initialScheduleEndDate(null, { isNew: true, today: '2026-11-27' }), '2026-12-04', 'chiến dịch mới: đặt sẵn +7 ngày')
assert.equal(end.initialScheduleEndDate('2026-11-26T16:59:59.000Z', { isNew: false, today: '2026-11-27' }), '2026-11-26', 'đang sửa: ngày đã lưu theo giờ Việt Nam')
assert.equal(end.initialScheduleEndDate(null, { isNew: false, today: '2026-11-27' }), '', 'đang sửa chiến dịch chưa có ngày: ô trống')
assert.equal(end.scheduleEndDateKey('2026-11-26T17:00:00.000Z'), '2026-11-27', '17:00 UTC là 00:00 hôm sau giờ Việt Nam')
assert.equal(end.scheduleEndDateKey('không phải ngày'), '')
ok('giá trị ô lúc mở form')

// Kiểm tra lúc lưu. Ca của khách 27/11: ngày chạy 27/11, ngày kết thúc 26/11.
const check = (date, runDate, today) => end.scheduleEndError({ date, runDate, today })
assert.equal(check('', '2026-11-27', '2026-11-27'), end.SCHEDULE_END_REQUIRED_ERROR, 'luôn phải có ngày kết thúc')
assert.equal(check('2026-11-26', '2026-11-27', '2026-11-27'), end.SCHEDULE_END_BEFORE_RUN_ERROR, 'ca 27/11: ngày kết thúc trước ngày chạy bị chặn')
assert.equal(check('2026-11-26', '2026-11-20', '2026-11-27'), end.SCHEDULE_END_PAST_ERROR, 'ngày kết thúc đã qua')
assert.equal(check('2026-11-27', '2026-11-27', '2026-11-27'), null, 'ngày kết thúc = ngày chạy = hôm nay: hợp lệ')
assert.equal(check('2026-12-01', '2026-11-27', '2026-11-27'), null)
ok('kiểm tra lúc lưu (thiếu ngày, trước ngày chạy, đã qua)')

console.log(`${cases} nhóm đạt`)
