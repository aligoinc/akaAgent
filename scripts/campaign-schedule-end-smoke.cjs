// "Đặt ngày kết thúc" (V674): luật dùng chung src/shared/campaignScheduleEnd.ts (bản chép nguyên văn của akaAgentWebApp
// packages/control-api/src/campaignScheduleEnd.ts) và bản vá applyScheduleAiPatch. Không cần DB.
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

// Trạng thái lúc mở form.
assert.deepEqual(end.initialScheduleEnd(null), { enabled: false, date: '', legacyDate: '' })
assert.deepEqual(end.initialScheduleEnd({ scheduleEndDate: null, scheduleEndStrict: true }), { enabled: false, date: '', legacyDate: '' })
assert.deepEqual(end.initialScheduleEnd({ scheduleEndDate: '2026-11-26T16:59:59.000Z', scheduleEndStrict: false }),
  { enabled: true, date: '2026-11-26', legacyDate: '2026-11-26' }, 'chiến dịch cũ: ngày theo giờ Việt Nam, nhớ ngày kiểu cũ')
assert.deepEqual(end.initialScheduleEnd({ scheduleEndDate: '2026-11-26T16:59:59.000Z', scheduleEndStrict: true }),
  { enabled: true, date: '2026-11-26', legacyDate: '' }, 'chiến dịch đã dừng đúng ngày: không có ngày kiểu cũ')
assert.deepEqual(end.initialScheduleEnd({ scheduleEndDate: '2026-11-26T16:59:59.000Z', scheduleEndStrict: false }, { clone: true }),
  { enabled: true, date: '2026-11-26', legacyDate: '' }, 'bản nhân bản là chiến dịch mới')
assert.equal(end.scheduleEndDateKey('2026-11-26T17:00:00.000Z'), '2026-11-27', '17:00 UTC là 00:00 hôm sau giờ Việt Nam')
assert.equal(end.scheduleEndDateKey('không phải ngày'), '')
ok('trạng thái ô lúc mở form')

// Giá trị lưu.
const legacy = end.initialScheduleEnd({ scheduleEndDate: '2026-11-26T16:59:59.000Z', scheduleEndStrict: false })
assert.deepEqual(end.scheduleEndForSave(legacy), { date: '2026-11-26', strict: false }, 'chiến dịch cũ không đổi ngày: giữ cách chạy cũ')
assert.deepEqual(end.scheduleEndForSave({ ...legacy, date: '2026-12-10' }), { date: '2026-12-10', strict: true }, 'đổi ngày: dừng đúng ngày')
assert.deepEqual(end.scheduleEndForSave({ ...legacy, enabled: false }), { date: null, strict: false }, 'bỏ tích: không có ngày kết thúc')
assert.deepEqual(end.scheduleEndForSave({ enabled: true, date: '2026-12-10', legacyDate: '' }), { date: '2026-12-10', strict: true })
assert.deepEqual(end.scheduleEndForSave({ enabled: true, date: '', legacyDate: '' }), { date: null, strict: false })
ok('giá trị lưu: chiến dịch cũ giữ kiểu cũ, chiến dịch mới / đổi ngày thì dừng đúng ngày')

// Kiểm tra lúc lưu. Ca của khách 27/11: ngày chạy 27/11, ngày kết thúc 26/11.
const check = (state, runDate, today) => end.scheduleEndError({ state, runDate, today })
assert.equal(check({ enabled: false, date: '2026-11-26', legacyDate: '' }, '2026-11-27', '2026-11-27'), null, 'không tích: không kiểm')
assert.equal(check({ enabled: true, date: '', legacyDate: '' }, '2026-11-27', '2026-11-27'), end.SCHEDULE_END_REQUIRED_ERROR)
assert.equal(check(legacy, '2026-11-27', '2026-11-27'), end.SCHEDULE_END_BEFORE_RUN_ERROR, 'ca 27/11: ngày kết thúc trước ngày chạy bị chặn')
assert.equal(check({ enabled: true, date: '2026-11-26', legacyDate: '' }, '2026-11-20', '2026-11-27'), end.SCHEDULE_END_PAST_ERROR, 'ngày kết thúc đã qua')
assert.equal(check({ enabled: true, date: '2026-11-27', legacyDate: '' }, '2026-11-27', '2026-11-27'), null, 'ngày kết thúc = ngày chạy = hôm nay: hợp lệ')
assert.equal(check({ enabled: true, date: '2026-12-01', legacyDate: '' }, '2026-11-27', '2026-11-27'), null)
ok('kiểm tra lúc lưu (thiếu ngày, trước ngày chạy, đã qua)')

// Dòng giải thích và nhãn.
assert.equal(end.scheduleEndHint({ enabled: false, date: '', legacyDate: '' }), end.SCHEDULE_END_OFF_HINT)
assert.equal(end.scheduleEndHint(legacy), end.SCHEDULE_END_LEGACY_HINT)
assert.equal(end.scheduleEndHint({ ...legacy, date: '2026-12-10' }), end.SCHEDULE_END_STRICT_HINT)
const past = { scheduleEndDate: '2026-11-26T16:59:59.000Z', scheduleType: 'weekly', status: 'chờ xử lý', dataTargetSourceMode: 'direct' }
const now = Date.parse('2026-11-27T03:00:00.000Z')
assert.equal(end.isRunningPastLegacyScheduleEnd(past, now), true)
assert.equal(end.isRunningPastLegacyScheduleEnd({ ...past, scheduleEndStrict: true }, now), false, 'dừng đúng ngày: DB tự đóng, không cần nhãn')
assert.equal(end.isRunningPastLegacyScheduleEnd({ ...past, status: 'hoàn thành' }, now), false)
assert.equal(end.isRunningPastLegacyScheduleEnd({ ...past, status: 'tạm dừng' }, now), false)
assert.equal(end.isRunningPastLegacyScheduleEnd({ ...past, scheduleType: 'daily' }, now), false)
assert.equal(end.isRunningPastLegacyScheduleEnd({ ...past, dataTargetSourceMode: 'data_group' }, now), false)
assert.equal(end.isRunningPastLegacyScheduleEnd(past, Date.parse('2026-11-26T10:00:00.000Z')), false, 'chưa qua ngày kết thúc')
assert.equal(end.scheduleEndDetailSuffix({ scheduleEndDate: 'x', scheduleEndStrict: true }), end.SCHEDULE_END_DETAIL_STRICT)
assert.equal(end.scheduleEndDetailSuffix({ scheduleEndDate: 'x' }), end.SCHEDULE_END_DETAIL_LEGACY)
assert.equal(end.scheduleEndDetailSuffix({ scheduleEndDate: null }), '')
ok('dòng giải thích, nhãn chạy nốt data, dòng chi tiết')

// AI điền lịch: điền ngày kết thúc thì tích ô, xoá ngày thì bỏ tích; form không có ô thì không thêm khoá.
const ai = load('src/shared/campaignScheduleAi.ts')
const form = { schedule: '2026-11-27T08:00', scheduleEndDate: '', scheduleEndEnabled: false }
assert.deepEqual(ai.applyScheduleAiPatch(form, { scheduleEndDate: '2026-12-31' }), { schedule: '2026-11-27T08:00', scheduleEndDate: '2026-12-31', scheduleEndEnabled: true })
assert.deepEqual(ai.applyScheduleAiPatch({ ...form, scheduleEndDate: '2026-12-31', scheduleEndEnabled: true }, { scheduleEndDate: '' }),
  { schedule: '2026-11-27T08:00', scheduleEndDate: '', scheduleEndEnabled: false })
assert.deepEqual(ai.applyScheduleAiPatch(form, { startTime: '09:30' }), { schedule: '2026-11-27T09:30', scheduleEndDate: '', scheduleEndEnabled: false })
assert.equal('scheduleEndEnabled' in ai.applyScheduleAiPatch({ schedule: '2026-11-27T08:00' }, { scheduleEndDate: '2026-12-31' }), false)
ok('AI điền lịch đồng bộ ô tích')

console.log(`${cases} nhóm đạt`)
