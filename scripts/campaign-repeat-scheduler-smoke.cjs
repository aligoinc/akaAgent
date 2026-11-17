// "Lặp lại sau khi chạy xong" trên bộ chạy cũ của Desktop (docs/CAMPAIGN_REPEAT_V561.md): chạy đúng các method thật của
// CampaignScheduler với DB giả. Không gọi mạng. Chạy: node scripts/campaign-repeat-scheduler-smoke.cjs
// (container chưa cài node_modules của akaAgent: NODE_PATH=<thư mục node_modules có typescript>).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const schedulerFile = path.join(root, 'src/main/services/campaignScheduler.ts')
const source = ts.createSourceFile(schedulerFile, fs.readFileSync(schedulerFile, 'utf8'), ts.ScriptTarget.Latest, true)
const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
const methods = [
  'handleCampaignCompletion', 'handleMultiDailyTimeSlotAfterCompletion', 'rescheduleCompletedCampaignPass',
  'handleZaloShareRepeatAfterCompletion', 'handleCampaignRepeatAfterCompletion', 'getFutureInputSchedule', 'getVietnamDateTimeParts',
  'getVietnamDateKey', 'isSameVietnamDay', 'parseDailyStopTime', 'isAfterDailyStopTime', 'isAtOrAfterCampaignDispatchCutoff',
  'formatVietnamDateTime', 'parseMultiDailyTimeSlot', 'normalizeMultiDailyTimeSlots', 'getTimeSlotMinute', 'withVietnamTimeSlot'
].map(name => {
  const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
  assert.ok(method, name)
  return method.getText(source)
}).join('\n')

function loadShared(relativePath) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const module = { exports: {} }
  new Function('module', 'exports', 'require', code)(module, module.exports, require)
  return module.exports
}
const shareRepeat = loadShared('src/shared/zaloShareRepeat.ts')
const cooldown = loadShared('src/shared/campaignDeliveryCooldown.ts')
const repeat = loadShared('src/shared/campaignRepeat.ts')

const globals = {
  ZALO_MESSAGE_FRIEND_ACTION_ID: 'zalo_message_friend', ZALO_MESSAGE_GROUP_ACTION_ID: 'zalo_message_group',
  PAGE_POST_ACTION_ID: 'facebook_page_post',
  MULTI_DAILY_TIME_SLOT_ACTION_IDS: new Set(['facebook_timeline_post', 'facebook_page_post', 'zalo_message_friend', 'zalo_message_group']),
  supportsZaloShareRepeat: shareRepeat.supportsZaloShareRepeat,
  parseZaloShareRepeatMinutes: shareRepeat.parseZaloShareRepeatMinutes,
  isRecentDeliveryCooldownEnabled: cooldown.isRecentDeliveryCooldownEnabled,
  campaignRepeatUnits: repeat.campaignRepeatUnits,
  CAMPAIGN_REPEAT_NO_DATA_ACTIONS: repeat.CAMPAIGN_REPEAT_NO_DATA_ACTIONS
}
const compiled = ts.transpileModule(`class Harness { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const Scheduler = new Function(...Object.keys(globals), `${compiled}; return Harness`)(...Object.values(globals))

const vn = (clock, day = '2026-11-17') => new Date(`${day}T${clock}:00+07:00`)
const done = id => ({ id, status: 'hoàn thành', isDelete: false })
const on = (every = 2, unit = 'day', maxRuns = 5) => ({ repeatAfterCompletionEnabled: true, repeatAfterCompletionEvery: every,
  repeatAfterCompletionUnit: unit, repeatAfterCompletionMaxRuns: maxRuns })

function fixture({ now = vn('09:20'), actionId = 'zalo_message_phone', server = false, mode = 'direct', scheduleType = 'daily',
  scheduleEndDate = null, details = [done(1), done(2)], extra = on(), decision = { ok: true, enabled: true, repeat: true, reason: 'scheduled',
    run: 1, maxRuns: 5, every: 2, unit: 'day', next: vn('09:00', '2026-11-19').toISOString() } } = {}) {
  const campaign = { id: 7, accountId: 3, name: 'Nhắn tin theo SĐT', actionId, status: 'đang chạy', schedule: vn('09:00').toISOString(),
    scheduleType, dailyStopTime: '18:00:00', scheduleEndDate, dataTargetSourceMode: mode, extraSettings: extra }
  const calls = []
  const logs = []
  const scheduler = Object.assign(new Scheduler(), {
    runtimeTarget: server ? 'server' : 'desktop',
    claimedServerZaloCampaignIds: new Set(server ? [campaign.id] : []),
    claimedServerZaloAccountIds: new Set(server ? [campaign.accountId] : []),
    campaignRunBoundaries: new Map(),
    restoreFacebookPageIdentity: async () => {},
    getDatabaseBusinessNow: async () => now,
    handleZaloRealtimeGroupCompletion: async () => false,
    handleRerunAfterCompletion: async () => false,
    transitionCampaignToCompleted: async () => { calls.push('complete'); campaign.status = 'hoàn thành'; return true },
    logCampaignProgress: async (_campaign, message) => { logs.push(message) },
    updateCampaignAndBroadcast: async (_id, patch) => { calls.push({ update: patch }); Object.assign(campaign, patch); return campaign },
    updateRunningCampaignAndBroadcast: async (_id, patch) => { calls.push({ updateRunning: patch }); Object.assign(campaign, patch); return campaign },
    broadcastCampaignUpdate: () => {},
    supabase: {
      listCampaignInputData: async () => details,
      resetCampaignInputDataForRerun: async () => { calls.push('reset-inputs') },
      advanceZaloServerMultiDailySlot: async () => { calls.push('advance'); return { ok: false, reason: 'not_found' } },
      decideCampaignRepeat: async id => {
        calls.push({ decide: id })
        if (decision instanceof Error) throw decision
        return decision
      },
      getCampaign: async () => campaign,
      getAccount: async () => ({ id: campaign.accountId })
    }
  })
  return { campaign, calls, logs, run: () => scheduler.handleCampaignCompletion(campaign) }
}

async function main() {
  let cases = 0
  const check = async (name, options, verify) => {
    const value = fixture(options)
    const warn = console.warn
    console.warn = () => {}
    try { await value.run() } finally { console.warn = warn }
    try { verify(value) } catch (error) { error.message = `${name}: ${error.message}`; throw error }
    cases++
  }
  const completedPlain = value => {
    assert.deepEqual(value.calls.filter(call => call !== 'complete' && !call.decide), [])
    assert.equal(value.campaign.status, 'hoàn thành')
  }
  const lastLog = value => value.logs[value.logs.length - 1] || ''

  // 1. Lượt giữa: DB đếm lượt, bộ chạy đặt lại data và hẹn lịch tới giờ DB trả về (kể cả ngày sau).
  for (const actionId of ['zalo_message_phone', 'facebook_group_post', 'email_send', 'zalo_message_group']) {
    await check(`lượt giữa ${actionId}`, { actionId }, value => {
      assert.deepEqual(value.calls, [{ decide: 7 }, 'reset-inputs',
        { update: { status: 'chờ xử lý', schedule: vn('09:00', '2026-11-19').toISOString(), note: null } }])
      assert.equal(lastLog(value), '⏳ Đã chạy xong lượt 1/5, hẹn chạy lại chiến dịch "Nhắn tin theo SĐT" lúc 09:00 19/11/2026')
    })
  }
  // Đăng trang cá nhân không có data vẫn lặp, không đặt lại data.
  await check('đăng trang cá nhân không data', { actionId: 'facebook_timeline_post', details: [], extra: on(6, 'hour', 3) }, value => {
    assert.deepEqual(value.calls.map(call => Object.keys(call)[0] || call), ['decide', 'update'])
  })

  // Bốn loại Facebook trước đây dùng "Chạy lại sau mỗi x giờ": có data thì đặt lại data, lướt newsfeed không có data vẫn lặp.
  for (const actionId of ['facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding']) {
    await check(`lượt giữa ${actionId}`, { actionId, extra: on(30, 'minute', 4) }, value => {
      assert.deepEqual(value.calls.map(call => typeof call === 'string' ? call : Object.keys(call)[0]), ['decide', 'reset-inputs', 'update'])
    })
  }
  await check('lướt newsfeed không data', { actionId: 'facebook_newsfeed_interaction', details: [], extra: on(2, 'hour', 3) }, value => {
    assert.deepEqual(value.calls.map(call => Object.keys(call)[0] || call), ['decide', 'update'])
  })

  // 2. Lượt cuối: hoàn thành kèm lý do.
  await check('đủ số lượt', { decision: { ok: true, enabled: true, repeat: false, reason: 'max_runs', run: 5, maxRuns: 5 } }, value => {
    assert.deepEqual(value.calls, [{ decide: 7 }, 'complete'])
    assert.equal(lastLog(value), '✅ Hoàn thành chiến dịch "Nhắn tin theo SĐT" (đã chạy đủ 5 lượt)')
  })
  await check('tới ngày kết thúc', { decision: { ok: true, enabled: true, repeat: false, reason: 'end_date', run: 2, maxRuns: 5 } }, value => {
    assert.deepEqual(value.calls, [{ decide: 7 }, 'complete'])
    assert.equal(lastLog(value), '✅ Hoàn thành chiến dịch "Nhắn tin theo SĐT" (lượt lặp kế tiếp đã qua ngày kết thúc)')
  })
  // Hết ngày kết thúc được kiểm trước cả nhánh lặp, như mọi chiến dịch có ngày kết thúc.
  await check('đã qua ngày kết thúc', { scheduleEndDate: vn('09:00').toISOString() }, value => {
    assert.deepEqual(value.calls, ['complete'])
    assert.match(lastLog(value), /hết ngày kết thúc/)
  })

  // 3. Không gọi DB, hoàn thành như thường.
  for (const [name, options] of [
    ['không bật', { extra: { ...on(), repeatAfterCompletionEnabled: false } }],
    ['không có khoá', { extra: {} }],
    ['lịch tuần', { scheduleType: 'weekly' }],
    ['nguồn Nhóm data', { mode: 'data_group' }],
    ['loại không hỗ trợ', { actionId: 'zalo_message_birthday' }],
    ['SMS', { actionId: 'sms_send' }],
    ['không còn data chạy lại', { details: [{ id: 1, status: 'tạm dừng', isDelete: false }] }],
    ['không có data', { details: [] }],
    ['App Server (bộ quét trong DB lo)', { server: true }],
  ]) {
    await check(name, options, value => {
      assert.equal(value.calls.some(call => call.decide), false, 'không gọi decide')
      if (options.mode === 'data_group') return
      assert.equal(value.calls.includes('reset-inputs'), false)
      assert.equal(value.campaign.status, 'hoàn thành')
    })
  }
  // Đang bật nhiều khung giờ: nhánh nhiều khung giờ xử lý, nhánh lặp không chạy.
  await check('nhiều khung giờ được ưu tiên', { actionId: 'zalo_message_group',
    extra: { ...on(6, 'hour', 3), multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: ['09:00', '14:00'] } }, value => {
    assert.equal(value.calls.some(call => call.decide), false)
    assert.match(lastLog(value), /khung giờ 14:00/)
  })
  // Còn data chờ (thêm giữa lượt): không đếm lượt, để bước hoàn thành thường xử lý.
  await check('còn data chờ', { details: [done(1), { id: 2, status: 'chờ xử lý', isDelete: false }] }, value => {
    assert.equal(value.calls.some(call => call.decide), false)
  })

  // 4. DB chưa có V561, DB từ chối, lỗi gọi hàm, giờ lượt kế hỏng: hoàn thành như thường, không đặt lại data.
  for (const [name, decision] of [
    ['DB chưa có V561', null],
    ['chiến dịch không còn đang chạy', { ok: false, reason: 'not_running' }],
    ['DB nói không bật', { ok: true, enabled: false, repeat: false }],
    ['lỗi gọi hàm', new Error('fetch failed')],
    ['giờ lượt kế hỏng', { ok: true, enabled: true, repeat: true, run: 1, maxRuns: 5, next: 'không phải ngày' }],
  ]) {
    await check(name, { decision }, value => {
      assert.deepEqual(value.calls[0], { decide: 7 })
      completedPlain(value)
      assert.equal(lastLog(value), '✅ Hoàn thành chiến dịch "Nhắn tin theo SĐT"')
    })
  }

  // 5. Hợp đồng dùng chung chép nguyên văn từ WebApp (nếu có checkout bên cạnh).
  const webCopy = path.resolve(root, process.env.WEBAPP_REPO || '../akaAgentWebApp', 'packages/control-api/src/campaignRepeat.ts')
  if (fs.existsSync(webCopy)) {
    const md5 = file => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')
    assert.equal(md5(path.join(root, 'src/shared/campaignRepeat.ts')), md5(webCopy), 'src/shared/campaignRepeat.ts phải giống hệt bản WebApp')
    cases++
  }
  console.log(`${cases} ca đạt`)
}

main().catch(error => { console.error(error); process.exit(1) })
