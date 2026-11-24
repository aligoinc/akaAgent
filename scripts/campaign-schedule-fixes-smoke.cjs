// Ba lỗi hẹn giờ khách báo 24/11/2026 (anh duyệt phương án "Vậy hãy thực thi phương án"):
//  - Ca 1: hằng ngày, có giờ dừng, không tích "hôm sau tiếp tục" → chạy tiếp từ 00:00. Nay: chỉ chạy ngày đầu, bảo trì đầu ngày
//    đóng data còn lại và hoàn thành; chưa chạy data nào thì hẹn giờ chạy hôm nay. Không giờ dừng thì giữ như cũ.
//  - Ca 2: lịch tuần / tháng làm mới data chạy xong trong ngày → "hoàn thành". Nay: đặt lại data, hẹn ngày chạy kế.
//  - Ca 3: lịch tuần / tháng có data "tạm dừng" (mã Zalo 161) → bảo trì không bao giờ làm mới data. Nay: "tạm dừng" coi như xong.
// Hàm thật maintainCampaignSchedules (campaignRepository.ts) và hàm thật của bộ lập lịch chạy với kho giả trong bộ nhớ.
// Không mạng, không DB. Chạy: node scripts/campaign-schedule-fixes-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
const transpile = (code, module = true) => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, ...(module ? { module: ts.ModuleKind.CommonJS } : {}) }
}).outputText
function loadTs(rel) {
  const module = { exports: {} }
  new Function('module', 'exports', 'require', transpile(read(rel)))(module, module.exports, require)
  return module.exports
}
const pass = loadTs('src/shared/campaignRecurringPass.ts')
const postBump = loadTs('src/shared/postBumpContent.ts')

/** Lấy nguyên văn các khai báo cấp module (hàm, hằng) theo tên trong một file TS. */
function pickDeclarations(rel, names) {
  const file = path.join(root, rel)
  const source = ts.createSourceFile(file, read(rel), ts.ScriptTarget.Latest, true)
  return names.map(name => {
    const node = source.statements.find(st =>
      (ts.isFunctionDeclaration(st) && st.name?.text === name) ||
      (ts.isVariableStatement(st) && st.declarationList.declarations.some(d => d.name.getText(source) === name)))
    assert.ok(node, `không thấy ${name} trong ${rel}`)
    return node.getText(source).replace(/^export\s+/, '')
  }).join('\n')
}

const results = []
const check = (name, fn) => results.push({ name, fn })

// ------------------------------------------------------------------------------------------------ luật dùng chung
check('isRefreshablePassDone: tạm dừng coi như xong, cần ít nhất một dòng hoàn thành', () => {
  const f = pass.isRefreshablePassDone
  assert.equal(f([{ status: 'hoàn thành' }, { status: 'tạm dừng' }]), true, 'ca Lê Minh Đức: một nhóm 161')
  assert.equal(f([{ status: 'hoàn thành' }, { status: 'hoàn thành' }]), true)
  assert.equal(f([{ status: 'tạm dừng' }, { status: 'tạm dừng' }]), false, 'không còn gì chạy lại')
  assert.equal(f([{ status: 'hoàn thành' }, { status: 'chờ xử lý' }]), false, 'còn data chưa chạy')
  assert.equal(f([{ status: 'hoàn thành' }, { status: 'đang chạy' }]), false)
  assert.equal(f([]), false)
  assert.equal(f([{ status: 'hoàn thành' }, { status: 'chờ xử lý', isDelete: true }]), true, 'dòng đã xoá bỏ qua')
})
check('isSingleDayStopCampaign / isRecurringRefreshCampaign', () => {
  assert.equal(pass.isSingleDayStopCampaign({ scheduleType: 'daily', continueNextDay: false, dailyStopTime: '20:00:00' }), true)
  assert.equal(pass.isSingleDayStopCampaign({ continueNextDay: false, dailyStopTime: '20:00' }), true, 'thiếu loại lịch = hằng ngày')
  assert.equal(pass.isSingleDayStopCampaign({ scheduleType: 'daily', continueNextDay: true, dailyStopTime: '20:00' }), false)
  assert.equal(pass.isSingleDayStopCampaign({ scheduleType: 'daily', continueNextDay: false, dailyStopTime: null }), false, 'không giờ dừng: như cũ')
  assert.equal(pass.isSingleDayStopCampaign({ scheduleType: 'daily', continueNextDay: false, dailyStopTime: '  ' }), false)
  assert.equal(pass.isSingleDayStopCampaign({ scheduleType: 'weekly', continueNextDay: false, dailyStopTime: '20:00' }), false)
  assert.equal(pass.isRecurringRefreshCampaign({ scheduleType: 'weekly', refreshData: true }), true)
  assert.equal(pass.isRecurringRefreshCampaign({ scheduleType: 'monthly', refreshData: true }), true)
  assert.equal(pass.isRecurringRefreshCampaign({ scheduleType: 'weekly', refreshData: false }), false)
  assert.equal(pass.isRecurringRefreshCampaign({ scheduleType: 'daily', refreshData: true }), false)
})

// ------------------------------------------------------------------------------------------------ kho giả
function fakeStore(campaigns, inputs) {
  const tables = { auto_campaigns: campaigns, auto_campaign_input_data: inputs }
  const writes = []
  const apply = (rows, filters) => rows.filter(row => filters.every(([op, key, value]) => {
    if (key.includes('.')) return true // lọc theo bảng nối: kho giả không mô phỏng
    const v = row[key]
    switch (op) {
      case 'eq': return v === value
      case 'neq': return v !== value
      case 'in': return value.includes(v)
      case 'lt': return v != null && String(v) < String(value)
      case 'gt': return v != null && v > value
      case 'not': return value.op === 'is' ? v !== null && v !== undefined : !String(value.list).slice(1, -1).split(',').includes(v)
      default: return true
    }
  }))
  const client = () => ({
    from(table) {
      const st = { filters: [], patch: null, limit: Infinity }
      const exec = async () => {
        let rows = apply(tables[table], st.filters).sort((a, b) => a.id - b.id)
        if (st.patch) { for (const row of rows) Object.assign(row, st.patch); writes.push({ table, patch: st.patch, ids: rows.map(r => r.id) }) }
        return { data: rows.slice(0, st.limit).map(r => ({ ...r })), error: null }
      }
      const b = {
        select: () => b, update: patch => { st.patch = patch; return b },
        eq: (k, v) => { st.filters.push(['eq', k, v]); return b }, neq: (k, v) => { st.filters.push(['neq', k, v]); return b },
        in: (k, v) => { st.filters.push(['in', k, v]); return b }, lt: (k, v) => { st.filters.push(['lt', k, v]); return b },
        gt: (k, v) => { st.filters.push(['gt', k, v]); return b },
        not: (k, op, list) => { st.filters.push(['not', k, { op, list }]); return b },
        or: () => b, order: () => b, limit: n => { st.limit = n; return b },
        then: (res, rej) => exec().then(res, rej)
      }
      return b
    }
  })
  const map = row => ({
    id: row.id, name: row.name, actionId: row.action_id, accountId: row.account_id, status: row.status, schedule: row.schedule,
    originalSchedule: row.original_schedule, scheduleType: row.schedule_type, scheduleWeekDays: row.schedule_week_days,
    scheduleDays: row.schedule_days, scheduleEndDate: row.schedule_end_date, dailyStopTime: row.daily_stop_time,
    continueNextDay: row.continue_next_day, refreshData: row.refresh_data, note: row.note, extraSettings: row.extra_settings || {},
    dataTargetSourceMode: row.data_target_source_mode || 'direct'
  })
  const updateCampaign = async (id, updates) => {
    const row = campaigns.find(r => r.id === id)
    const keys = { status: 'status', schedule: 'schedule', note: 'note', extraSettings: 'extra_settings' }
    for (const [k, v] of Object.entries(updates)) row[keys[k] || k] = v
    writes.push({ table: 'auto_campaigns', patch: updates, ids: [id] })
    return map(row)
  }
  const listCampaignInputData = async id => inputs.filter(r => r.campaign_id === id && !r.is_delete).map(r => ({ id: r.id, status: r.status, isDelete: r.is_delete }))
  return { client, map, updateCampaign, listCampaignInputData, writes, campaigns, inputs }
}

function loadMaintenance(store) {
  const REPO = 'src/main/data/repositories/campaignRepository.ts'
  const helpers = pickDeclarations(REPO, ['VIETNAM_TIME_ZONE', 'VIETNAM_UTC_OFFSET', 'vietnamDateTimeFormatter', 'vietnamWeekdayFormatter', 'pad2',
    'parseVietnamParts', 'makeVietnamDate', 'startOfVietnamDateKey', 'addVietnamDays', 'withVietnamTime', 'formatVietnamTimeForQuery',
    'isAtOrAfterDailyDrainTime', 'getVietnamWeekdayNumber', 'SCHEDULE_DAY_TOKEN', 'parseNumberList', 'resolveNextSchedule', 'isPastScheduleEnd',
    'resolveNextRecurringRun', 'maintainCampaignSchedules'])
  const code = transpile(helpers, false)
  const scope = {
    client: store.client, requireCurrentUser: () => ({ staffId: 1, organizationId: 1 }), mapCampaignFromDB: store.map,
    MOBILE_MANAGED_SMS_ACTION_IDS: ['sms_send'], updateCampaign: store.updateCampaign, listCampaignInputData: store.listCampaignInputData,
    getCampaign: async id => store.map(store.campaigns.find(r => r.id === id)),
    finalizeCampaign: async () => ({ reason: 'completed' }), finalizeDataGroupCampaign: async () => {}, finalizeZaloServerMaintenanceCampaign: async () => ({ reason: 'completed' }),
    clearCampaignInputData: async () => {}, getEarliestPendingInputSchedule: async () => null,
    isPostBumpTargetCampaign: postBump.isPostBumpTargetCampaign, planPostBumpMaintenanceSchedule: postBump.planPostBumpMaintenanceSchedule,
    ZALO_MESSAGE_BIRTHDAY_ACTION_ID: 'zalo_message_birthday', NEWSFEED_INTERACTION_ACTION_ID: 'facebook_newsfeed_interaction',
    ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID: 'zalo_message_friend_recommendation', ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID: 'zalo_cancel_sent_friend_request',
    clearZaloFriendRecommendationMaterializedExtra: x => x, clearZaloCancelSentFriendRequestMaterializedExtra: x => x, clearZaloBirthdayMaterializedExtra: x => x,
    isRefreshablePassDone: pass.isRefreshablePassDone, isSingleDayStopCampaign: pass.isSingleDayStopCampaign,
    SINGLE_DAY_STOP_INPUT_NOTE: pass.SINGLE_DAY_STOP_INPUT_NOTE, SINGLE_DAY_STOP_CAMPAIGN_NOTE: pass.SINGLE_DAY_STOP_CAMPAIGN_NOTE
  }
  return new Function(...Object.keys(scope), `${code}; return { maintainCampaignSchedules, resolveNextRecurringRun }`)(...Object.values(scope))
}

// Hôm nay giờ VN: thứ Tư 25/11/2026. Lịch cũ: thứ Ba 24/11 08:00 VN.
const TODAY = '2026-11-25'
const OLD = '2026-11-24T01:00:00.000Z' // 08:00 24/11 VN
const campaignRow = (id, more = {}) => ({ id, name: `C${id}`, action_id: 'zalo_message_group', account_id: 9, status: 'chờ xử lý', schedule: OLD,
  original_schedule: OLD, schedule_type: 'daily', schedule_week_days: null, schedule_days: null, schedule_end_date: null, daily_stop_time: null,
  continue_next_day: true, refresh_data: false, note: null, extra_settings: {}, is_delete: false, staff_id: 1, ...more })
let inputId = 1000
const inputs = (campaignId, statuses) => statuses.map(status => ({ id: ++inputId, campaign_id: campaignId, status, note: '', is_delete: false }))

check('ca 1: có giờ dừng, không tích, đã chạy data → đóng data còn lại kèm ghi chú, hoàn thành', async () => {
  const c = campaignRow(1, { daily_stop_time: '20:00:00', continue_next_day: false, schedule: '2026-11-24T12:00:00.000Z' })
  const store = fakeStore([c], inputs(1, ['hoàn thành', 'hoàn thành', 'chờ xử lý', 'chờ xử lý', 'tạm dừng']))
  await loadMaintenance(store).maintainCampaignSchedules(TODAY)
  assert.deepEqual([c.status, c.note], ['hoàn thành', pass.SINGLE_DAY_STOP_CAMPAIGN_NOTE])
  assert.deepEqual(store.inputs.map(r => r.status), ['hoàn thành', 'hoàn thành', 'hoàn thành', 'hoàn thành', 'tạm dừng'])
  assert.deepEqual(store.inputs.slice(2, 4).map(r => r.note), [pass.SINGLE_DAY_STOP_INPUT_NOTE, pass.SINGLE_DAY_STOP_INPUT_NOTE])
  assert.equal(store.inputs[0].note, '', 'data đã gửi giữ ghi chú cũ')
})
check('ca 1: có giờ dừng, không tích, chưa chạy data nào (app tắt ngày đầu) → hẹn giờ chạy hôm nay', async () => {
  const c = campaignRow(2, { daily_stop_time: '20:00:00', continue_next_day: false })
  const store = fakeStore([c], inputs(2, ['chờ xử lý', 'chờ xử lý']))
  await loadMaintenance(store).maintainCampaignSchedules(TODAY)
  assert.deepEqual([c.status, c.schedule], ['chờ xử lý', '2026-11-25T01:00:00.000Z'])
  assert.deepEqual(store.inputs.map(r => r.status), ['chờ xử lý', 'chờ xử lý'])
})
check('ca 1: không giờ dừng + không tích → giữ lịch cũ (chạy liên tục như trước); có tích → hẹn giờ hôm nay', async () => {
  const a = campaignRow(3, { continue_next_day: false })
  const b = campaignRow(4, { continue_next_day: true, daily_stop_time: '20:00:00' })
  const store = fakeStore([a, b], [...inputs(3, ['hoàn thành', 'chờ xử lý']), ...inputs(4, ['hoàn thành', 'chờ xử lý'])])
  await loadMaintenance(store).maintainCampaignSchedules(TODAY)
  assert.deepEqual([a.status, a.schedule], ['chờ xử lý', OLD])
  assert.deepEqual([b.status, b.schedule], ['chờ xử lý', '2026-11-25T01:00:00.000Z'])
  assert.equal(store.inputs.filter(r => r.status === 'chờ xử lý').length, 2, 'không đóng data nào')
})
check('ca 3: lịch tuần làm mới data, có dòng tạm dừng (161) → làm mới, dòng tạm dừng giữ nguyên', async () => {
  const c = campaignRow(5, { schedule_type: 'weekly', schedule_week_days: '2,3,4,5,6,7', refresh_data: true, status: 'hoàn thành' })
  const store = fakeStore([c], inputs(5, ['hoàn thành', 'tạm dừng', 'hoàn thành']))
  await loadMaintenance(store).maintainCampaignSchedules(TODAY)
  assert.deepEqual([c.status, c.schedule], ['chờ xử lý', '2026-11-25T01:00:00.000Z'])
  assert.deepEqual(store.inputs.map(r => r.status), ['chờ xử lý', 'tạm dừng', 'chờ xử lý'])
})
check('ca 3: mọi dòng tạm dừng → không làm mới (không có gì chạy lại), chỉ dời lịch', async () => {
  const c = campaignRow(6, { schedule_type: 'weekly', schedule_week_days: '2,3,4,5,6,7', refresh_data: true, status: 'hoàn thành' })
  const store = fakeStore([c], inputs(6, ['tạm dừng', 'tạm dừng']))
  await loadMaintenance(store).maintainCampaignSchedules(TODAY)
  assert.deepEqual([c.status, c.schedule], ['hoàn thành', '2026-11-25T01:00:00.000Z'])
})
check('ngày chạy kế (resolveNextRecurringRun): từ ngày mai, theo thứ / ngày đã chọn, giờ của lịch gốc, quá ngày kết thúc → null', () => {
  const store = fakeStore([], [])
  const { resolveNextRecurringRun } = loadMaintenance(store)
  const now = new Date('2026-11-25T05:00:00.000Z') // 12:00 thứ Tư 25/11 VN
  const base = store.map(campaignRow(7, { schedule_type: 'weekly', schedule_week_days: '2,3,4,5,6,7' }))
  assert.equal(resolveNextRecurringRun(base, now).toISOString(), '2026-11-26T01:00:00.000Z', 'thứ Năm 08:00')
  const sat = { ...base, scheduleWeekDays: '2,3,4,5,6,7' }
  assert.equal(resolveNextRecurringRun(sat, new Date('2026-11-28T05:00:00.000Z')).toISOString(), '2026-11-30T01:00:00.000Z', 'thứ Bảy → thứ Hai')
  assert.equal(resolveNextRecurringRun({ ...base, scheduleWeekDays: '4' }, now).toISOString(), '2026-12-02T01:00:00.000Z', 'chỉ thứ Tư → tuần sau')
  const monthly = { ...base, scheduleType: 'monthly', scheduleDays: '25,31' }
  assert.equal(resolveNextRecurringRun(monthly, now).toISOString(), '2026-12-25T01:00:00.000Z', 'tháng 11 không có ngày 31')
  assert.equal(resolveNextRecurringRun({ ...base, scheduleEndDate: '2026-11-25T16:59:59.000Z' }, now), null, 'quá ngày kết thúc')
  assert.equal(resolveNextRecurringRun({ ...base, scheduleWeekDays: 'x' }, now), null)
})

// ------------------------------------------------------------------------------------------------ bộ lập lịch (ca 2)
function loadSchedulerMethods(names, scope) {
  const rel = 'src/main/services/campaignScheduler.ts'
  const source = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true)
  const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
  const methods = names.map(name => {
    const m = cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
    assert.ok(m, name)
    return m.getText(source)
  }).join('\n')
  const compiled = transpile(`class Harness { ${methods} }`, false)
  return new Function(...Object.keys(scope), `${compiled}; return Harness`)(...Object.values(scope))
}
const Scheduler = loadSchedulerMethods(['handleRecurringRefreshAfterCompletion'], {
  isRecurringRefreshCampaign: pass.isRecurringRefreshCampaign, isPostBumpTargetCampaign: postBump.isPostBumpTargetCampaign,
  ZALO_MESSAGE_BIRTHDAY_ACTION_ID: 'zalo_message_birthday', ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID: 'zalo_message_friend_recommendation',
  ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID: 'zalo_cancel_sent_friend_request', ZALO_MESSAGE_FRIEND_ACTION_ID: 'zalo_message_friend',
  ZALO_MESSAGE_GROUP_ACTION_ID: 'zalo_message_group'
})
function scheduler({ server = false, claimed = false, next = new Date('2026-11-26T01:00:00.000Z') } = {}) {
  const s = new Scheduler()
  s.runtimeTarget = server ? 'server' : 'desktop'
  s.claimedServerZaloCampaignIds = new Set(claimed ? [10] : [])
  s.claimedServerZaloAccountIds = new Set(claimed ? [9] : [])
  s.supabase = { resolveNextRecurringRun: () => next, listCampaignInputData: async () => s.rows }
  s.rows = [{ id: 1, status: 'hoàn thành', isDelete: false }]
  s.formatVietnamDateTime = d => d.toISOString()
  s.calls = []
  s.rescheduleCompletedCampaignPass = async (campaign, now, nextSchedule, labels) => { s.calls.push({ nextSchedule, labels }); return true }
  return s
}
const weekly = (more = {}) => ({ id: 10, accountId: 9, name: 'Đăng bài', actionId: 'facebook_group_post', scheduleType: 'weekly', refreshData: true, ...more })

check('ca 2: lịch tuần làm mới data chạy xong → hẹn ngày chạy kế (không hoàn thành)', async () => {
  const s = scheduler()
  assert.equal(await s.handleRecurringRefreshAfterCompletion(weekly(), new Date()), true)
  assert.equal(s.calls.length, 1)
  assert.equal(s.calls[0].nextSchedule.toISOString(), '2026-11-26T01:00:00.000Z')
  assert.match(s.calls[0].labels.scheduledLog, /^⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch "Đăng bài" lúc /)
})
check('ca 2: các trường hợp vẫn hoàn thành như cũ', async () => {
  const cases = [
    ['không làm mới', weekly({ refreshData: false })],
    ['hằng ngày', weekly({ scheduleType: 'daily' })],
    ['sinh nhật', weekly({ actionId: 'zalo_message_birthday' })],
    ['đề xuất kết bạn', weekly({ actionId: 'zalo_message_friend_recommendation' })],
    ['huỷ lời mời', weekly({ actionId: 'zalo_cancel_sent_friend_request' })],
    ['up tin', weekly({ actionId: 'facebook_comment_seeding_post', name: `${postBump.POST_BUMP_TARGET_NAME_PREFIX}A` })]
  ]
  for (const [label, campaign] of cases) {
    const s = scheduler()
    assert.equal(await s.handleRecurringRefreshAfterCompletion(campaign, new Date()), false, label)
    assert.equal(s.calls.length, 0, label)
  }
  const noNext = scheduler({ next: null })
  assert.equal(await noNext.handleRecurringRefreshAfterCompletion(weekly(), new Date()), false, 'quá ngày kết thúc')
  // Không có dòng data nào: chỉ chiến dịch Facebook không cần data (trừ Page) hẹn lượt kế, như engine v2 (giả lập 24/11/2026).
  for (const [actionId, expected] of [['zalo_message_phone', false], ['facebook_page_post', false], ['facebook_timeline_post', true]]) {
    const s = scheduler()
    s.rows = []
    assert.equal(await s.handleRecurringRefreshAfterCompletion(weekly({ actionId }), new Date()), expected, `không data: ${actionId}`)
  }
})
check('ca 2, Zalo Server đang giữ lượt: chỉ nhắn bạn bè / nhắn nhóm (RPC chuyển lượt của Server chỉ nhận hai loại)', async () => {
  for (const [actionId, expected] of [['zalo_message_group', true], ['zalo_message_friend', true], ['zalo_message_phone', false]]) {
    const s = scheduler({ server: true, claimed: true })
    assert.equal(await s.handleRecurringRefreshAfterCompletion(weekly({ actionId }), new Date()), expected, actionId)
  }
  const notClaimed = scheduler({ server: true, claimed: false })
  assert.equal(await notClaimed.handleRecurringRefreshAfterCompletion(weekly({ actionId: 'zalo_message_phone' }), new Date()), true)
})
check('ca 2 (mã nguồn): gọi sau "chạy lại sau N giờ", trước hoàn thành', () => {
  const src = read('src/main/services/campaignScheduler.ts')
  const start = src.indexOf('private async handleCampaignCompletion(')
  const body = src.slice(start, src.indexOf('\n  }\n', start))
  const rerun = body.indexOf('handleRerunAfterCompletion'), rec = body.indexOf('handleRecurringRefreshAfterCompletion')
  const done = body.lastIndexOf('transitionCampaignToCompleted')
  assert.ok(rerun > 0 && rec > rerun && done > rec)
})

;(async () => {
  let failed = 0
  for (const { name, fn } of results) {
    try { await fn(); console.log('PASS', name) } catch (error) { failed++; console.log('FAIL', name); console.log(error) }
  }
  console.log(`\n${results.length - failed}/${results.length} đạt`)
  process.exit(failed ? 1 : 0)
})()
