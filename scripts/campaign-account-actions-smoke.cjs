// Tab "Hành động" trong chi tiết chiến dịch: công thức giới hạn (dùng chung với Chẩn đoán), đọc chỉ-đọc,
// cách đếm khung giờ akaChat/bộ chạy/SMS, service và ranh giới IPC. Supabase giả lập, không gọi mạng.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')

function load(file, imports = {}) {
  const mod = { exports: {} }, code = ts.transpileModule(readFileSync(resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  new Function('require', 'module', 'exports', code)(id => { if (id in imports) return imports[id]; throw new Error(`Unexpected dependency ${id}`) }, mod, mod.exports)
  return mod.exports
}

const limitsModule = load('src/shared/accountActionLimits.ts')
const descriptors = load('src/shared/campaignActionDescriptors.ts')
const shared = load('src/shared/campaignAccountActions.ts')

let queries = []
let statusRows = []
let counts = {}
let failTable = null
const has = (q, method, column, value) => q.calls.some(call => call[0] === method
  && (column === undefined || call[1] === column) && (value === undefined || JSON.stringify(call[2]) === JSON.stringify(value)))
const countKey = q => `${q.calls.find(call => call[0] === 'eq' && call[1] === 'action_code')?.[2]}:${has(q, 'eq', 'counts_toward_limit', true) ? 'explicit' : 'legacy'}`
function from(table) {
  const state = { table, calls: [] }
  queries.push(state)
  const builder = {}
  for (const method of ['select', 'eq', 'in', 'is', 'gte', 'or', 'order', 'limit', 'maybeSingle', 'abortSignal', 'insert', 'update', 'upsert', 'delete']) {
    builder[method] = (...args) => { state.calls.push([method, ...args]); return builder }
  }
  builder.then = (resolveResult, reject) => Promise.resolve().then(() => {
    if (failTable === table) return { data: null, error: { message: 'relation secret does not exist' } }
    if (table === 'auto_account_action_status') return { data: structuredClone(statusRows), error: null }
    if (table === 'auto_campaign_details') return { data: null, error: null, count: counts[countKey(state)] ?? 0 }
    return { data: [], error: null }
  }).then(resolveResult, reject)
  return builder
}
const client = { from, rpc: from }
const caps = { zalo_message_stranger: 40, zalo_add_friend: 40, sms_send: 25 }
const repo = load('src/main/data/repositories/campaignDiagnosticsRepository.ts', {
  '../../../shared/accountActionLimits': limitsModule,
  '../supabaseClient': { getSupabaseClient: () => client },
  '../currentUser': { requireCurrentUser: () => ({ staffId: 9, organizationId: 1 }), requireCurrentUserCredentials: () => ({ username: 'fixture', password: 'fixture' }) },
  '../mappers': { mapCampaignFromDB: row => row },
  '../../domain/campaigns/campaignActionDescriptors': descriptors,
  './entitlementRepository': {
    getAccountActionDailySendLimit: code => code === 'zalo_find_phone_user' ? null : caps[code] ?? null,
    loadCurrentUserEffectiveEntitlements: async () => ({})
  }
})

const CLOCK = { dbNow: '2026-11-10T03:00:00.000Z', vietnamDateKey: '2026-11-10', nextVietnamMidnight: '2026-11-10T17:00:00.000Z' }
const phoneCampaign = (extra = {}) => ({ id: 101, accountId: 11, actionId: 'zalo_message_phone', extraSettings: {
  enableMessage: true, enableAddFriend: true, enableZaloTag: true,
  actionLimits: { enabledActionCodes: ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend'], continueWhenActionLimitReached: true,
    byActionCode: {
      zalo_find_phone_user: { dailyLimit: 1000, rateLimitCount: 1000, rateLimitMinutes: 65 },
      zalo_message_stranger: { dailyLimit: 30, rateLimitCount: 9, rateLimitMinutes: 65 },
      zalo_add_friend: { dailyLimit: 100, rateLimitCount: 5, rateLimitMinutes: 60 }
    } },
  ...extra } })
const account = (groupLimits = { zalo_message_stranger: { dailyLimit: 20, rateLimitCount: 6 } }) =>
  ({ id: 11, flatformType: 'zalo', isDelete: false, accountGroupSettings: groupLimits ? { byActionCode: groupLimits } : null })
const phoneAction = { id: 'zalo_message_phone', limitCheckActionCodes: ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend'] }
const reset = () => {
  queries = []; counts = {}; failTable = null
  statusRows = [
    { action_code: 'zalo_message_stranger', count_action_in_day: 12, count_date: CLOCK.vietnamDateKey, is_disable: true, date_enable: '2026-11-10T03:17:30Z', disabled_reason: 'Zalo hạn chế gửi tin', disabled_error_code: 'E1' },
    { action_code: 'zalo_add_friend', count_action_in_day: 7, count_date: '2026-11-09', is_disable: true, date_enable: '2026-11-10T02:00:00Z', disabled_reason: 'cũ' },
    { action_code: 'zalo_tag_contact', count_action_in_day: 4, count_date: CLOCK.vietnamDateKey, is_disable: false, date_enable: null }
  ]
}
const byCode = rows => Object.fromEntries(rows.map(row => [row.code, row]))
const signal = () => new AbortController().signal

async function limitFormula() {
  const resolveLimit = repo.resolveCampaignActionQuotaLimit
  assert.deepEqual(resolveLimit('zalo_add_friend', undefined, undefined, null), {
    dailyLimit: 30, dailySource: 'default', dailyCapped: false, packageDailyLimit: null, campaignDailyLimit: null,
    rateLimitCount: 9, rateLimitMinutes: 65, windowSource: 'default', campaignRateLimitCount: null, campaignRateLimitMinutes: null })
  assert.deepEqual(resolveLimit('zalo_add_friend', { byActionCode: { zalo_add_friend: { dailyLimit: 50, rateLimitCount: 4, rateLimitMinutes: 30 } } }, undefined, null),
    { dailyLimit: 50, dailySource: 'campaign', dailyCapped: false, packageDailyLimit: null, campaignDailyLimit: 50,
      rateLimitCount: 4, rateLimitMinutes: 30, windowSource: 'campaign', campaignRateLimitCount: 4, campaignRateLimitMinutes: 30 })
  // Nhóm thay ngày/lượt, số phút vẫn của chiến dịch; giá trị 0 coi như không cài.
  assert.deepEqual(resolveLimit('zalo_message_stranger', { byActionCode: { zalo_message_stranger: { dailyLimit: 30, rateLimitCount: 9, rateLimitMinutes: 65 } } },
    { dailyLimit: 20, rateLimitCount: 6, rateLimitMinutes: 0 }, 40), {
    dailyLimit: 20, dailySource: 'group', dailyCapped: false, packageDailyLimit: 40, campaignDailyLimit: 30,
    rateLimitCount: 6, rateLimitMinutes: 65, windowSource: 'group', campaignRateLimitCount: 9, campaignRateLimitMinutes: 65 })
  assert.deepEqual(resolveLimit('zalo_add_friend', { byActionCode: { zalo_add_friend: { dailyLimit: 100 } } }, undefined, 40),
    { dailyLimit: 40, dailySource: 'campaign', dailyCapped: true, packageDailyLimit: 40, campaignDailyLimit: 100,
      rateLimitCount: 9, rateLimitMinutes: 65, windowSource: 'default', campaignRateLimitCount: null, campaignRateLimitMinutes: null })
  assert.equal(resolveLimit('zalo_add_friend', { dailyLimit: 45, rateLimitCount: 3, rateLimitMinutes: 20 }, undefined, null).dailyLimit, 45, 'legacy shared block')
  assert.equal(resolveLimit('zalo_add_friend', { byActionCode: { zalo_add_friend: { dailyLimit: 0 } } }, undefined, null).dailySource, 'default')
  const lookup = resolveLimit('zalo_find_phone_user', { rateLimitMinutes: 45 }, undefined, null)
  assert.deepEqual([lookup.dailyLimit, lookup.dailySource, lookup.rateLimitCount, lookup.rateLimitMinutes, lookup.windowSource, lookup.campaignDailyLimit],
    [1000, 'default', 1000, 45, 'campaign', null])
  // Đúng giá trị bộ chạy đặt cho kiểm tra quota: resolveAccountActionLimitConfig + mặc định của resolveAccountRateLimitStatus.
  const runtime = (config) => ({
    daily: config?.dailyLimit && config.dailyLimit > 0 ? config.dailyLimit : 30,
    count: config?.rateLimitCount && config.rateLimitCount > 0 ? config.rateLimitCount : 9,
    minutes: config?.rateLimitMinutes && config.rateLimitMinutes > 0 ? config.rateLimitMinutes : 65
  })
  const samples = [undefined, {}, { dailyLimit: 0 }, { dailyLimit: 12, rateLimitCount: 0, rateLimitMinutes: 15 }, { dailyLimit: 500, rateLimitCount: 50 }]
  for (const campaignLimit of samples) for (const group of [undefined, {}, { dailyLimit: 7 }, { rateLimitCount: 2, rateLimitMinutes: 90 }]) for (const cap of [null, 10, 1000]) {
    const limits = campaignLimit === undefined ? undefined : { byActionCode: { fb_comment: campaignLimit } }
    const expected = runtime(limitsModule.resolveAccountActionLimitConfig(campaignLimit, group, cap))
    const actual = resolveLimit('fb_comment', limits, group, cap)
    assert.deepEqual([actual.dailyLimit, actual.rateLimitCount, actual.rateLimitMinutes], [expected.daily, expected.count, expected.minutes],
      `parity ${JSON.stringify([campaignLimit, group, cap])}`)
  }
  console.log('PASS limit formula: group → campaign → defaults → package cap, find-phone fixed 1000, zero values, sources and scheduler parity (60 combinations)')
}

async function schedulerRows() {
  reset()
  counts = { 'zalo_message_stranger:explicit': 1, 'zalo_message_stranger:legacy': 2, 'zalo_add_friend:explicit': 3, 'zalo_find_phone_user:explicit': 5 }
  const rows = await repo.readCampaignAccountActionRows(account(), phoneCampaign(), phoneAction, CLOCK, false, signal())
  assert.deepEqual(rows.map(row => [row.code, row.name, row.limited]), [
    ['zalo_find_phone_user', 'Tìm SĐT', true], ['zalo_message_stranger', 'Nhắn tin người lạ', true],
    ['zalo_add_friend', 'Kết bạn', true], ['zalo_tag_contact', 'Gắn tag Zalo', false]
  ])
  const actions = byCode(rows)
  assert.deepEqual(actions.zalo_message_stranger, {
    code: 'zalo_message_stranger', name: 'Nhắn tin người lạ', limited: true, disabled: true, enableAt: '2026-11-10T03:17:30Z', remainingMinutes: 18,
    disabledReason: 'Zalo hạn chế gửi tin', dayUsed: 12, dayLimit: 20, dayLimitSource: 'group', dayLimitCapped: false, packageDailyLimit: 40,
    campaignDayLimit: 30, windowUsed: 3, windowLimit: 6, windowMinutes: 65, windowLimitSource: 'group', campaignWindowLimit: 9, campaignWindowMinutes: 65 })
  assert.deepEqual([actions.zalo_add_friend.disabled, actions.zalo_add_friend.enableAt, actions.zalo_add_friend.dayUsed, actions.zalo_add_friend.dayLimit,
    actions.zalo_add_friend.dayLimitCapped, actions.zalo_add_friend.windowUsed, actions.zalo_add_friend.windowMinutes], [false, null, 0, 40, true, 3, 60])
  assert.deepEqual([actions.zalo_find_phone_user.dayLimit, actions.zalo_find_phone_user.dayLimitSource, actions.zalo_find_phone_user.packageDailyLimit, actions.zalo_find_phone_user.windowUsed],
    [1000, 'default', null, 5])
  assert.deepEqual([actions.zalo_tag_contact.dayUsed, actions.zalo_tag_contact.dayLimit, actions.zalo_tag_contact.windowUsed], [4, null, null])
  assert(queries.every(q => q.calls.every(call => !['insert', 'update', 'upsert', 'delete'].includes(call[0]))), 'read-only')
  assert.equal(queries.filter(q => q.table === 'auto_account_action_status').length, 1)
  const statusRead = queries.find(q => q.table === 'auto_account_action_status')
  assert(has(statusRead, 'eq', 'account_id', 11))
  assert(has(statusRead, 'in', 'action_code', ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend', 'zalo_tag_contact']))
  const countReads = queries.filter(q => q.table === 'auto_campaign_details')
  assert.deepEqual(countReads.map(countKey), ['zalo_find_phone_user:explicit', 'zalo_find_phone_user:legacy', 'zalo_message_stranger:explicit',
    'zalo_message_stranger:legacy', 'zalo_add_friend:explicit', 'zalo_add_friend:legacy'])
  assert(countReads.filter(q => countKey(q).endsWith(':legacy')).every(q => has(q, 'is', 'counts_toward_limit', null) && has(q, 'in', 'status', ['thành công', 'thất bại'])))
  assert(has(countReads[4], 'gte', 'created_at', new Date(Date.parse(CLOCK.dbNow) - 60 * 60_000).toISOString()), 'campaign window minutes')
  console.log('PASS scheduler rows: menu order/names, group/campaign/cap/default sources, DB-time locks, expired lock and stale counter, legacy NULL success/failure counts, select-only')
}

async function chatAndEdges() {
  reset()
  counts = { 'zalo_message_stranger:explicit': 4 }
  const campaign = phoneCampaign()
  campaign.extraSettings.actionLimits.enabledActionCodes = ['zalo_message_stranger']
  const rows = await repo.readCampaignAccountActionRows(account(null), campaign, phoneAction, CLOCK, true, signal())
  assert.deepEqual(rows.map(row => [row.code, row.limited]), [['zalo_find_phone_user', false], ['zalo_message_stranger', true], ['zalo_add_friend', false], ['zalo_tag_contact', false]])
  assert.deepEqual(queries.filter(q => q.table === 'auto_campaign_details').map(countKey), ['zalo_message_stranger:explicit'], 'akaChat counts explicit rows only')
  assert.equal(byCode(rows).zalo_message_stranger.dayLimitSource, 'campaign')

  reset()
  statusRows = [{ action_code: 'zalo_message_stranger', count_action_in_day: 9, count_date: '2026-11-11', is_disable: true, date_enable: 'not-a-date' }]
  const edge = byCode(await repo.readCampaignAccountActionRows(account(), phoneCampaign(), phoneAction, CLOCK, false, signal()))
  assert.deepEqual([edge.zalo_message_stranger.dayUsed, edge.zalo_message_stranger.disabled, edge.zalo_message_stranger.enableAt], [null, true, null])

  reset()
  statusRows = [{ action_code: 'sms_send', count_action_in_day: 25, count_date: CLOCK.vietnamDateKey, is_disable: false }]
  counts = { 'sms_send:explicit': 2, 'sms_send:legacy': 3 }
  const sms = await repo.readCampaignAccountActionRows({ id: 12, flatformType: 'sms', accountGroupSettings: null },
    { id: 102, accountId: 12, actionId: 'sms_send', extraSettings: { actionLimits: { enabledActionCodes: ['sms_send'], byActionCode: { sms_send: { dailyLimit: 60, rateLimitCount: 9, rateLimitMinutes: 65 } } } } },
    { id: 'sms_send', limitCheckActionCodes: ['sms_send'] }, CLOCK, false, signal())
  assert.deepEqual(sms.map(row => [row.code, row.dayUsed, row.dayLimit, row.dayLimitCapped, row.packageDailyLimit, row.windowUsed]), [['sms_send', 25, 25, true, 25, 5]])
  const smsLegacy = queries.find(q => q.table === 'auto_campaign_details' && countKey(q) === 'sms_send:legacy')
  assert(!has(smsLegacy, 'in', 'status'), 'SMS/gọi đếm mọi dòng NULL như countLimitDetailsInWindow')

  reset()
  const empty = await repo.readCampaignAccountActionRows(account(), { id: 103, accountId: 11, actionId: 'facebook_find_data_group', extraSettings: {} }, null, CLOCK, false, signal())
  assert.deepEqual(empty, [])
  assert.equal(queries.length, 0, 'no reads without actions')

  reset(); failTable = 'auto_account_action_status'
  await assert.rejects(repo.readCampaignAccountActionRows(account(), phoneCampaign(), phoneAction, CLOCK, false, signal()))
  console.log('PASS akaChat explicit-only counts and saved code filter, unverifiable counter/enable date, SMS legacy counts and cap, empty campaigns, DB errors')
}

async function service() {
  const clock = { ...CLOCK }
  let campaignRow = { campaign: { ...phoneCampaign(), isDelete: false } }
  let accountState = { account: { ...account(), isDelete: false }, isChatManaged: false }
  const svc = load('src/main/services/campaignAccountActionsService.ts', {
    '../data/repositories/runtimeClockRepository': { getDatabaseRuntimeClock: async () => clock },
    '../data/repositories/campaignPendingReasonRepository': {
      readPendingReasonCampaign: async () => campaignRow,
      readPendingReasonAccount: async () => accountState,
      readPendingReasonAction: async () => phoneAction
    },
    '../data/repositories/campaignDiagnosticsRepository': { readCampaignAccountActionRows: async () => [{ code: 'zalo_message_stranger' }] }
  })
  const result = await svc.readCampaignAccountActions(101, signal())
  assert.deepEqual(result, { campaignId: 101, accountId: 11, checkedAt: clock.dbNow, nextDayStartsAt: clock.nextVietnamMidnight, runtime: 'scheduler',
    groupApplied: true, continueWhenActionLimitReached: true, actions: [{ code: 'zalo_message_stranger' }] })
  accountState = { account: { ...account(null), isDelete: false }, isChatManaged: true }
  assert.deepEqual([(await svc.readCampaignAccountActions(101, signal())).runtime, (await svc.readCampaignAccountActions(101, signal())).groupApplied], ['chat', false])
  accountState = { account: { ...account(), isDelete: true }, isChatManaged: false }
  await assert.rejects(svc.readCampaignAccountActions(101, signal()), error => error instanceof svc.CampaignAccountActionsError && error.message === 'Tài khoản của chiến dịch đã bị xóa.')
  campaignRow = null
  await assert.rejects(svc.readCampaignAccountActions(101, signal()), error => error instanceof svc.CampaignAccountActionsError && error.message === 'Không tìm thấy chiến dịch trong tài khoản của bạn.')
  console.log('PASS service composition: DB clock, runtime, applied group, continue setting, missing campaign and deleted account messages')
}

async function ipcBoundary() {
  const auth = load('src/main/data/currentUser.ts', {
    'node:async_hooks': require('node:async_hooks'),
    './supabaseClient': { isTrustedServerSupabaseConfigured: () => true, desktopSession: { matches: () => true, clear: () => {} } }
  })
  const deadline = load('src/main/services/requestDeadline.ts')
  class CampaignAccountActionsError extends Error {}
  let handler, reads = 0
  const pending = []
  let mode = 'ok'
  const window = { webContents: { mainFrame: {} } }
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  load('src/main/ipc/handlers/campaignAccountActionsHandlers.ts', {
    electron: { ipcMain: { handle: (channel, callback) => { assert.equal(channel, shared.CAMPAIGN_ACCOUNT_ACTIONS_IPC); handler = callback } } },
    '../../../shared/campaignAccountActions': shared,
    '../../data/currentUser': auth,
    '../../services/requestDeadline': deadline,
    '../../services/campaignAccountActionsService': {
      CampaignAccountActionsError,
      readCampaignAccountActions: async id => {
        reads++
        assert.equal(auth.requireCurrentUser().staffId, 9)
        if (mode === 'business') throw new CampaignAccountActionsError('Tài khoản của chiến dịch đã bị xóa.')
        if (mode === 'transport') throw new Error('relation secret does not exist')
        return new Promise(done => pending.push(() => done({ campaignId: id, actions: [] })))
      }
    }
  }).registerCampaignAccountActionsHandlers(window)
  auth.setCurrentUser({ staffId: 9, organizationId: 1 }); auth.setCurrentUserCredentials({ username: 'fixture', password: 'fixture' })
  await assert.rejects(handler({ sender: {}, senderFrame: {} }, 1), /không hợp lệ/)
  await assert.rejects(handler(event, 0), /không hợp lệ/)
  const first = handler(event, 101), duplicate = handler(event, 101)
  await new Promise(done => setImmediate(done))
  assert.equal(reads, 1, 'duplicate reads share one flight')
  const others = [102, 103, 104].map(id => handler(event, id))
  await new Promise(done => setImmediate(done))
  await assert.rejects(handler(event, 105), new RegExp(shared.CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE.slice(0, 20)))
  pending.splice(0).forEach(done => done())
  assert.deepEqual([(await first).campaignId, (await duplicate).campaignId], [101, 101])
  await Promise.all(others)
  const stale = handler(event, 106)
  await new Promise(done => setImmediate(done))
  auth.setCurrentUserCredentials({ username: 'other', password: 'other' })
  pending.splice(0).forEach(done => done())
  await assert.rejects(stale, new RegExp(shared.CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE.slice(0, 20)), 'result of a replaced session is dropped')
  auth.setCurrentUserCredentials({ username: 'fixture', password: 'fixture' })
  mode = 'business'
  await assert.rejects(handler(event, 107), /Tài khoản của chiến dịch đã bị xóa\./)
  mode = 'transport'
  await assert.rejects(handler(event, 108), error => error.message === shared.CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE)
  console.log('PASS IPC boundary: main-frame only, ID validation, shared flight, 4-flight cap, stale session drop, business vs transport messages')
}

;(async () => {
  await limitFormula()
  await schedulerRows()
  await chatAndEdges()
  await service()
  await ipcBoundary()
  console.log('PASS campaign account actions tab smoke')
})().catch(error => { console.error(error); process.exit(1) })
