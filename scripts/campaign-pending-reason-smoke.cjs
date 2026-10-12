const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')

function load(file, imports = {}) {
  const mod = { exports: {} }
  const source = ts.transpileModule(readFileSync(resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  new Function('require', 'module', 'exports', source)(id => {
    if (id in imports) return imports[id]
    throw new Error(`Unexpected dependency ${id}`)
  }, mod, mod.exports)
  return mod.exports
}
const shared = load('src/shared/campaignPendingReason.ts')
const base = { id: 1, name: 'Pending', actionId: 'facebook_message_uid', accountId: 2,
  status: 'chờ xử lý', note: null, isDelete: false, schedule: '2026-10-12T02:00:00Z',
  scheduleType: 'daily', updatedAt: '2026-10-12T01:00:00.123456Z', extraSettings: {} }
const accountBase = { id: 2, name: 'Account', flatformType: 'facebook', status: 'chờ xử lý', loginStatus: 'đã đăng nhập',
  isActive: true, isDelete: false, isZaloServer: false, isZaloShowWeb: false }
const user = { staffId: 9, organizationId: 1, entitlements: {}, useTestWorkflow: false }
let campaign, account, hasClaim, hasOperation, input, busy, source, clock, authorized, access, readCount, changeOnFinish, trace, action
function reset() {
  campaign = { ...base }; account = { ...accountBase }; hasClaim = hasOperation = source = false
  input = 'due'; busy = null; clock = '2026-10-12T03:00:00Z'; authorized = true
  access = { isActive: true, timeAllowed: true }; readCount = 0; changeOnFinish = null; trace = []
  action = { id: base.actionId, workflowId: 12 }
}
const reads = {
  readPendingReasonCampaign: async () => { readCount++; return { campaign: readCount > 1 && changeOnFinish ? { ...campaign, ...changeOnFinish } : campaign, hasClaim } },
  readPendingReasonAccount: async () => ({ account, hasOperation }),
  readPendingReasonAction: async () => action,
  readBusyCampaign: async () => busy,
  readPendingInputAvailability: async () => input === 'future' ? { state: input, scheduledAt: '2026-10-12T04:00:00Z' } : { state: input },
  hasPendingFindDataSource: async () => source,
  countBusyBrowserAccounts: async () => 0,
  hasPendingReasonWorkflow: async () => true
}
const service = load('src/main/services/campaignPendingReasonService.ts', {
  '../../shared/campaignPendingReason': shared,
  '../data/currentUser': { requireCurrentUser: () => user, requireCurrentUserCredentials: () => ({ username: 'fixture', password: 'fixture' }) },
  '../data/repositories/runtimeClockRepository': { getDatabaseRuntimeClock: async () => ({ dbNow: clock }) },
  '../data/repositories/entitlementRepository': { canUseCampaignActionWithEntitlements: () => authorized,
    canUseAccountWithEntitlementsAndCapabilities: () => authorized, getUserZaloAccountCapabilities: () => ({}) },
  '../data/repositories/staffManagementRepository': { readStaffAccess: async () => access },
  '../data/repositories/browserRunLimitsRepository': { getBrowserRunLimits: async () => ({ facebookMax: null, zaloWebMax: null }) },
  '../data/repositories/campaignPendingReasonRepository': reads,
  '../data/repositories/campaignPendingChatLimitRepository': { readChatPendingLimitReason: () => { throw new Error('Unexpected akaChat path') } }
})
const runtime = { busyReason: () => null, readinessReason: () => null, configurationReason: () => null,
  limitReason: async () => { trace.push('limit-read'); return null } }
const inspect = () => service.inspectPendingCampaign(1, runtime, new AbortController().signal)

async function verifyIpcBoundary() {
  const auth = load('src/main/data/currentUser.ts', { 'node:async_hooks': require('node:async_hooks') })
  const deadline = load('src/main/services/requestDeadline.ts')
  let handler, count = 0, delay = 1000, fail = false
  const pending = []
  const window = { webContents: { mainFrame: {} } }
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  const ipc = load('src/main/ipc/handlers/campaignPendingReasonHandlers.ts', {
    electron: { ipcMain: { handle: (_, callback) => { handler = callback } } },
    '../../../shared/campaignPendingReason': shared,
    '../../data/currentUser': auth,
    '../../services/requestDeadline': { withRequestDeadline: (signal, run) => deadline.withRequestDeadline(signal, run, delay) }
  })
  ipc.registerCampaignPendingReasonHandlers(window, { inspectPendingReason: async id => {
    count++
    if (fail) throw new Error('private transport details')
    return new Promise(resolve => pending.push(() => resolve({ campaignId: id, message: 'fixture reason', version: 'v1' })))
  } })
  const login = () => { auth.setCurrentUser({ staffId: 9, organizationId: 1 }); auth.setCurrentUserCredentials({ username: 'fixture', password: 'fixture' }) }
  login()
  await assert.rejects(handler({ ...event, senderFrame: {} }, 1), /không hợp lệ/)
  await assert.rejects(handler({ ...event, sender: {} }, 1), /không hợp lệ/)
  await assert.rejects(handler(event, -1), /không hợp lệ/)
  assert.equal(count, 0)
  const first = handler(event, 1), duplicate = handler(event, 1)
  await Promise.resolve(); assert.equal(count, 1)
  pending.shift()(); assert.deepEqual(await first, await duplicate)
  const obsolete = handler(event, 1)
  await Promise.resolve(); auth.setCurrentUser(null); login(); pending.shift()()
  assert.equal((await obsolete).message, null, 'same-staff relogin must invalidate the old credentials')
  const burst = [1, 2, 3, 4].map(id => handler(event, id))
  await assert.rejects(handler(event, 5), error => error.message === shared.CAMPAIGN_PENDING_REASON_UNAVAILABLE)
  while (pending.length) pending.shift()()
  await Promise.all(burst)
  fail = true
  await assert.rejects(handler(event, 1), error => error.message === shared.CAMPAIGN_PENDING_REASON_UNAVAILABLE)
  fail = false; delay = 10
  await assert.rejects(handler(event, 1), error => error.message === shared.CAMPAIGN_PENDING_REASON_UNAVAILABLE)
  pending.shift()() // Consume late transport completion after deadline.
  auth.setCurrentUser(null)
  await assert.rejects(handler(event, 1), /Chưa đăng nhập/)
  console.log('PASS IPC frame/ID/auth guards, request dedup/cap/deadline, stale credentials and sanitized failures')
}
async function main() {
  reset()
  assert.equal(shared.campaignPendingReasonVersion(base), shared.campaignPendingReasonVersion({ ...base,
    schedule: '2026-10-12T02:00:00+00:00', updatedAt: '2026-10-12T01:00:00.123456+00:00' }))
  assert.equal(shared.campaignPendingReasonVersion({ ...base, dailyStopTime: '18:00' }),
    shared.campaignPendingReasonVersion({ ...base, dailyStopTime: '18:00:00' }))
  assert.notEqual(shared.campaignPendingReasonVersion(base), shared.campaignPendingReasonVersion({ ...base, updatedAt: '2026-10-12T01:00:00.123457Z' }))
  const reason = service.pendingCampaignScheduleReason
  assert.match(reason({ ...base, schedule: '2026-10-12T04:00:00Z' }, clock), /Chưa đến lịch chạy/)
  assert.equal(reason({ ...base, schedule: undefined }, clock), 'Lịch chạy chưa hợp lệ. Vui lòng kiểm tra lại cài đặt lịch.')
  assert.equal(reason({ ...base, dailyStopTime: '10:00' }, clock), 'Đã quá giờ dừng gửi 10:00. Chiến dịch không nhận lượt mới trong hôm nay.')
  assert.match(reason(base, '2026-10-12T16:59:00Z'), /23:59/)
  assert.equal(reason({ ...base, actionId: 'sms_send' }, '2026-10-12T16:59:00Z'), null)
  assert.equal(reason({ ...base, schedule: '2026-10-11T02:00:00Z', continueNextDay: false }, clock), null)
  assert.match(reason({ ...base, schedule: '2026-10-11T02:00:00Z', continueNextDay: true }, clock), /cập nhật lịch/)
  assert.equal(reason({ ...base, scheduleType: 'weekly', scheduleWeekDays: '' }, clock), 'Lịch chạy chưa hợp lệ. Vui lòng kiểm tra lại cài đặt lịch.')
  assert.match(reason({ ...base, dataTargetSourceMode: 'data_group', scheduleEndDate: '2026-10-11T16:59:59Z' }, clock), /đang chờ cập nhật trạng thái/)
  reset(); input = 'future'; assert.equal((await inspect()).message, 'Chưa có data đến giờ chạy. Data gần nhất được hẹn lúc 11:00 12/10/2026.')
  reset(); input = 'empty'; assert.match((await inspect()).message, /Chưa phát hiện điều kiện chặn/, 'empty input is not proof that a dynamic campaign cannot run')
  reset(); input = 'empty'; source = true; assert.equal((await inspect()).message, 'Đang chờ data từ chiến dịch tìm data.')
  reset(); input = 'finished'; campaign.dataTargetSourceMode = 'data_group'; assert.match((await inspect()).message, /Nhóm data/)
  reset(); input = 'empty'; campaign.actionId = 'zalo_message_group_realtime'; campaign.extraSettings = { zaloRealtimeEndDate: '2026-10-12' }; assert.match((await inspect()).message, /theo thời gian thực/)
  reset(); input = 'empty'; campaign.actionId = 'zalo_message_group_realtime'; campaign.extraSettings = { zaloRealtimeEndDate: '2026-10-11' }; assert.match((await inspect()).message, /Chưa phát hiện/, 'finished intake cannot be reported as still waiting for realtime data')
  reset(); busy = 'Other campaign'; assert.equal((await inspect()).message, 'Tài khoản đang bận chạy chiến dịch “Other campaign”. Chiến dịch này đang chờ đến lượt.'); assert.deepEqual(trace, [])
  reset(); hasOperation = true; assert.equal((await inspect()).message, 'Tài khoản đang bận, chưa thể chạy chiến dịch.')
  reset(); hasClaim = true; assert.match((await inspect()).message, /lượt chạy hoặc tác vụ trước/)
  reset(); campaign.note = 'Real note'; assert.equal((await inspect()).message, null); assert.equal(readCount, 1)
  reset(); changeOnFinish = { note: 'New real note' }; assert.equal((await inspect()).message, null)
  reset(); changeOnFinish = { status: 'đang chạy' }; assert.equal((await inspect()).message, null)
  reset(); changeOnFinish = { updatedAt: '2026-10-12T03:00:00Z' }; assert.equal((await inspect()).message, null)
  reset(); account.flatformType = 'zalo'; account.isZaloServer = true; assert.match((await inspect()).message, /Chưa xác minh được trạng thái/)
  reset(); campaign.actionId = 'voice_call'; action = { id: 'voice_call' }; account.flatformType = 'sms'; assert.match((await inspect()).message, /điện thoại/)
  reset(); authorized = false; assert.match((await inspect()).message, /Chưa có quyền/)
  reset(); access.timeAllowed = false; assert.match((await inspect()).message, /nhân viên đã hết hạn/)
  reset(); await assert.rejects(service.inspectPendingCampaign(1, runtime, AbortSignal.abort()))
  console.log('PASS read-only diagnosis: DB time/cutoff, no-data rules, mobile/server, busy/permissions, real-note and configuration races')
  await verifyIpcBoundary()
}
main().catch(error => { console.error(error); process.exitCode = 1 })
