// Cột "Giới hạn lượt" và tab "Hành động" dạng thẻ trên Desktop (V502): bộ đọc RPC Desktop, bộ dựng số liệu
// (so khớp từng trường với bộ đọc cũ trên cùng dữ liệu), cách đếm theo bộ chạy, kết quả hôm nay, thông tin quản trị,
// quay về bộ đọc cũ khi DB chưa có hàm, và ranh giới IPC `campaign:limit-progress`. Supabase giả lập, không gọi mạng.
// Dùng: node scripts/campaign-limit-progress-smoke.cjs
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')

function load(file, imports = {}) {
  const mod = { exports: {} }, code = ts.transpileModule(readFileSync(resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  new Function('require', 'module', 'exports', code)(id => { if (id in imports) return imports[id]; throw new Error(`Unexpected dependency ${id} in ${file}`) }, mod, mod.exports)
  return mod.exports
}

const limitsModule = load('src/shared/accountActionLimits.ts')
const descriptors = load('src/shared/campaignActionDescriptors.ts')
const limitShared = load('src/shared/campaignLimitProgress.ts')
const shared = load('src/shared/campaignAccountActions.ts')

// --- Supabase giả: from() cho bộ đọc cũ (đếm theo từng câu), rpc() cho V502 ---
let queries = [], statusRows = [], counts = {}, rpcCalls = [], rpcResult = { data: null, error: null }
const has = (q, method, column, value) => q.calls.some(call => call[0] === method
  && (column === undefined || call[1] === column) && (value === undefined || JSON.stringify(call[2]) === JSON.stringify(value)))
const countKey = q => `${q.calls.find(call => call[0] === 'eq' && call[1] === 'action_code')?.[2]}:${has(q, 'eq', 'counts_toward_limit', true) ? 'explicit' : 'legacy'}`
function from(table) {
  const state = { table, calls: [] }
  queries.push(state)
  const builder = {}
  for (const method of ['select', 'eq', 'in', 'is', 'gte', 'or', 'order', 'limit', 'maybeSingle', 'abortSignal']) {
    builder[method] = (...args) => { state.calls.push([method, ...args]); return builder }
  }
  builder.then = (ok, fail) => Promise.resolve().then(() => {
    if (table === 'auto_account_action_status') return { data: structuredClone(statusRows), error: null }
    if (table === 'auto_campaign_details') return { data: null, error: null, count: counts[countKey(state)] ?? 0 }
    return { data: [], error: null }
  }).then(ok, fail)
  return builder
}
function rpc(name, args) {
  rpcCalls.push({ name, args })
  const builder = { abortSignal: () => builder, then: (ok, fail) => Promise.resolve(structuredClone(rpcResult)).then(ok, fail) }
  return builder
}
const client = { from, rpc }
let user = { staffId: 9, organizationId: 1, isChatSync: false }
const currentUser = { requireCurrentUser: () => user, requireCurrentUserCredentials: () => ({ username: 'nv9', password: 'pw9' }) }
const caps = { zalo_message_stranger: 40, zalo_add_friend: 40, sms_send: 25 }
const entitlementRepository = {
  getAccountActionDailySendLimit: code => code === 'zalo_find_phone_user' ? null : caps[code] ?? null,
  loadCurrentUserEffectiveEntitlements: async () => ({})
}
const diagnostics = load('src/main/data/repositories/campaignDiagnosticsRepository.ts', {
  '../../../shared/accountActionLimits': limitsModule,
  '../supabaseClient': { getSupabaseClient: () => client },
  '../currentUser': currentUser,
  '../mappers': { mapCampaignFromDB: row => row },
  '../../domain/campaigns/campaignActionDescriptors': descriptors,
  './entitlementRepository': entitlementRepository
})
const repo = load('src/main/data/repositories/campaignLimitProgressRepository.ts', {
  '../supabaseClient': { getSupabaseClient: () => client },
  '../currentUser': currentUser
})
let fallbackCalls = []
class CampaignAccountActionsError extends Error {}
const svc = load('src/main/services/campaignLimitProgressService.ts', {
  '../../shared/campaignLimitProgress': limitShared,
  '../data/currentUser': currentUser,
  '../data/repositories/campaignDiagnosticsRepository': diagnostics,
  '../data/repositories/entitlementRepository': entitlementRepository,
  '../data/repositories/campaignLimitProgressRepository': repo,
  '../domain/campaigns/campaignActionDescriptors': descriptors,
  './campaignAccountActionsService': {
    CampaignAccountActionsError,
    readCampaignAccountActions: async id => { fallbackCalls.push(id); return { campaignId: id, fallback: true, actions: [] } }
  }
})

// --- Dữ liệu chung: cùng kịch bản với scripts/campaign-account-actions-smoke.cjs ---
const NOW = '2026-11-10T03:00:00.000Z', NOW_MS = Date.parse(NOW)
const CLOCK = { dbNow: NOW, vietnamDateKey: '2026-11-10', nextVietnamMidnight: '2026-11-10T17:00:00.000Z' }
const ago = minutes => new Date(NOW_MS - minutes * 60_000).toISOString()
const phoneExtra = () => ({
  enableMessage: true, enableAddFriend: true, enableZaloTag: true,
  actionLimits: { enabledActionCodes: ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend'], continueWhenActionLimitReached: true,
    byActionCode: {
      zalo_find_phone_user: { dailyLimit: 1000, rateLimitCount: 1000, rateLimitMinutes: 65 },
      zalo_message_stranger: { dailyLimit: 30, rateLimitCount: 9, rateLimitMinutes: 65 },
      zalo_add_friend: { dailyLimit: 100, rateLimitCount: 5, rateLimitMinutes: 60 }
    } }
})
const groupLimits = { zalo_message_stranger: { dailyLimit: 20, rateLimitCount: 6 } }
const phoneCodes = ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend']
const oldStatusRows = () => [
  { action_code: 'zalo_message_stranger', count_action_in_day: 12, count_date: CLOCK.vietnamDateKey, is_disable: true, date_enable: '2026-11-10T03:17:30Z', disabled_reason: 'Zalo hạn chế gửi tin', disabled_error_code: 'E1' },
  { action_code: 'zalo_add_friend', count_action_in_day: 7, count_date: '2026-11-09', is_disable: true, date_enable: '2026-11-10T02:00:00Z', disabled_reason: 'cũ' },
  { action_code: 'zalo_tag_contact', count_action_in_day: 4, count_date: CLOCK.vietnamDateKey, is_disable: false, date_enable: null }
]
// Cùng trạng thái ở dạng V502 trả (camelCase, kèm disabledAt).
const v502Status = row => ({ accountId: 11, actionCode: row.action_code, countActionInDay: row.count_action_in_day, countDate: row.count_date,
  isDisable: row.is_disable, dateEnable: row.date_enable, disabledReason: row.disabled_reason ?? null, disabledErrorCode: row.disabled_error_code ?? null,
  disabledAt: row.is_disable ? '2026-11-10T01:30:00Z' : null, updatedAt: NOW })
const campaignRow = (over = {}) => ({
  id: 101, name: 'CD theo SĐT', accountId: 11, actionId: 'zalo_message_phone', status: 'đang chạy',
  schedule: '2026-11-10T04:00:00Z', scheduleType: 'daily', dailyStopTime: '18:00:00', continueNextDay: true, timeSleepBetween2: 120,
  lastRunAt: ago(3), extra: phoneExtra(), limitCheckActionCodes: phoneCodes,
  account: { id: 11, name: 'Zalo A', flatform_type: 'zalo', is_zalo_server: true, is_zalo_show_web: false, is_delete: false },
  group: { name: 'Nhóm A', organization_id: 1, is_active: true, is_delete: false, settings: { byActionCode: groupLimits } },
  ...over
})
const facts = (over = {}) => ({
  now: NOW, vietnamDate: CLOCK.vietnamDateKey, dayStartsAt: '2026-11-09T17:00:00.000Z', nextDayStartsAt: CLOCK.nextVietnamMidnight, chatSync: false,
  campaigns: [campaignRow()],
  statuses: oldStatusRows().map(v502Status),
  windows: [
    // Nhắn người lạ: 1 dòng có cờ, 2 dòng cũ thành công/thất bại, 3 dòng cũ trạng thái khác (chỉ SMS/gọi tính).
    { accountId: 11, actionCode: 'zalo_message_stranger', lookbackMinutes: 65, e: [ago(10)], l: [ago(40), ago(20)], o: [ago(5), ago(6), ago(7)], truncated: false },
    // Kết bạn khung 60 phút: dòng 62 phút trước nằm trong lookback nhưng ngoài khung.
    { accountId: 11, actionCode: 'zalo_add_friend', lookbackMinutes: 65, e: [ago(62), ago(50), ago(30), ago(2)], l: [], o: [], truncated: false },
    { accountId: 11, actionCode: 'zalo_find_phone_user', lookbackMinutes: 65, e: [ago(64), ago(50), ago(40), ago(30), ago(1)], l: [], o: [], truncated: false }
  ],
  siblings: [
    { accountId: 11, campaignId: 101, name: 'CD theo SĐT', actionId: 'zalo_message_phone', limitCheckActionCodes: phoneCodes },
    { accountId: 11, campaignId: 202, name: 'CD khác', actionId: 'zalo_message_phone', limitCheckActionCodes: phoneCodes },
    { accountId: 11, campaignId: 203, name: 'CD bạn bè', actionId: 'zalo_message_friend', limitCheckActionCodes: ['zalo_message_friend'] }
  ],
  actionNames: [],
  today: null,
  ...over
})
const signal = () => new AbortController().signal
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key]]))

async function repository() {
  rpcCalls = []
  rpcResult = { data: facts(), error: null }
  const parsed = await repo.readCampaignLimitFacts([101, 102], true, signal())
  assert.deepEqual(rpcCalls, [{ name: 'aka_agent_read_campaign_limit_progress', args: {
    p_staff_id: 9, p_organization_id: 1, p_auth_username: 'nv9', p_auth_password: 'pw9', p_campaign_ids: [101, 102],
    p_extra_keys: ['enableMessage', 'enableAddFriend', 'enableZaloTag', 'enableZaloAlias', 'zaloMessageSendMode', 'enableComment', 'enablePostLike',
      'newsfeedLikeKind', 'newsfeedLikeLimit', 'newsfeedCommentKind', 'newsfeedCommentLimit', 'groupPostShareFromPost'],
    p_detail: true } }])
  assert.equal(parsed.checkedAt, NOW)
  assert.equal(parsed.today, '2026-11-10')
  assert.deepEqual(parsed.windows.get('11:zalo_message_stranger').legacy.length, 2)
  assert.equal(parsed.statuses.get('11:zalo_add_friend').countActionInDay, 7)
  assert.equal(parsed.todayRows, null, 'list mode has no today rows')
  // Mọi cờ extra mà bộ mô tả hành động đọc đều được hỏi (thiếu cờ = sai danh sách hành động).
  const source = readFileSync(resolve(__dirname, '../src/shared/campaignActionDescriptors.ts'), 'utf8')
  const read = new Set([...source.matchAll(/extra\??\.([A-Za-z]+)/g)].map(match => match[1]))
  read.delete('actionLimits')
  for (const key of read) assert(repo.LIMIT_PROGRESS_EXTRA_KEYS.includes(key), `extra key ${key} must be requested`)
  for (const code of ['PGRST202', '42883']) {
    rpcResult = { data: null, error: { code, message: 'function not found' } }
    assert.equal(await repo.readCampaignLimitFacts([1], false, signal()), null, `${code} = DB chưa có V502`)
  }
  rpcResult = { data: null, error: { code: 'P0001', message: 'automation_auth_invalid' } }
  await assert.rejects(repo.readCampaignLimitFacts([1], false, signal()), error => error.message === 'automation_auth_invalid')
  rpcResult = { data: { now: 'x', campaigns: [] }, error: null }
  await assert.rejects(repo.readCampaignLimitFacts([1], false, signal()), error => error instanceof repo.CampaignLimitFactsInvalid)
  console.log('PASS repository: Desktop RPC with token identity + automation credentials, every descriptor flag requested, missing function = null, errors and malformed payloads rejected')
}

async function parityWithOldReader() {
  // Bộ đọc cũ (từng câu đếm) và bộ dựng V502 trên cùng dữ liệu: mọi trường cũ phải giống hệt.
  for (const chat of [false, true]) {
    queries = []
    statusRows = oldStatusRows()
    counts = chat
      ? { 'zalo_message_stranger:explicit': 1, 'zalo_add_friend:explicit': 3, 'zalo_find_phone_user:explicit': 5 }
      : { 'zalo_message_stranger:explicit': 1, 'zalo_message_stranger:legacy': 2, 'zalo_add_friend:explicit': 3, 'zalo_find_phone_user:explicit': 5 }
    const account = { id: 11, flatformType: 'zalo', isDelete: false, accountGroupSettings: { byActionCode: groupLimits } }
    const old = await diagnostics.readCampaignAccountActionRows(account, { id: 101, accountId: 11, actionId: 'zalo_message_phone', extraSettings: phoneExtra() },
      { id: 'zalo_message_phone', limitCheckActionCodes: phoneCodes }, CLOCK, chat, signal())
    user = { staffId: 9, organizationId: 1, isChatSync: chat }
    rpcResult = { data: facts(), error: null }
    const parsed = await repo.readCampaignLimitFacts([101], false, signal())
    const built = await svc.buildDesktopCampaignActions(parsed, parsed.campaigns[0])
    assert.equal(built.result.runtime, chat ? 'chat' : 'scheduler')
    assert.deepEqual(built.result.actions.map(row => pick(row, Object.keys(old[0]))), old, `parity ${chat ? 'akaChat' : 'bộ chạy akaAgent'}`)
  }
  user = { staffId: 9, organizationId: 1, isChatSync: false }
  console.log('PASS parity: V502 rows equal the per-query reader field by field (akaChat and akaAgent runtime: locks, counters, group/campaign/cap sources, window counts)')
}

async function builderDetails() {
  rpcResult = { data: facts({ today: [
    { accountId: 11, actionCode: 'zalo_message_stranger', campaignId: 101, campaignName: 'CD theo SĐT', status: 'thành công', countsTowardLimit: true, count: 5, lastAt: ago(4) },
    { accountId: 11, actionCode: 'zalo_message_stranger', campaignId: 202, campaignName: 'CD khác', status: 'thành công', countsTowardLimit: null, count: 4, lastAt: ago(8) },
    { accountId: 11, actionCode: 'zalo_message_stranger', campaignId: 101, campaignName: 'CD theo SĐT', status: 'lỗi', countsTowardLimit: null, count: 2, lastAt: ago(9) },
    { accountId: 11, actionCode: 'zalo_message_stranger', campaignId: 999, campaignName: null, status: 'thất bại', countsTowardLimit: false, count: 1, lastAt: ago(1) },
    { accountId: 11, actionCode: 'zalo_tag_contact', campaignId: 101, campaignName: 'CD theo SĐT', status: 'thành công', countsTowardLimit: false, count: 3, lastAt: ago(15) }
  ] }), error: null }
  const parsed = await repo.readCampaignLimitFacts([101], true, signal())
  const built = await svc.buildDesktopCampaignActions(parsed, parsed.campaigns[0])
  const rows = Object.fromEntries(built.result.actions.map(row => [row.code, row]))
  const stranger = rows.zalo_message_stranger
  assert.deepEqual(stranger.windowTimes, [ago(40), ago(20), ago(10)], 'counted times ascending (bộ chạy akaAgent: có cờ + cũ thành công/thất bại)')
  assert.equal(stranger.windowAtLeast, false)
  assert.equal(stranger.lockedAt, '2026-11-10T01:30:00.000Z')
  assert.equal(stranger.sharedCampaigns, 1, 'one other campaign checks the same action today')
  assert.deepEqual(stranger.today, {
    counted: 9, uncounted: 3,
    statuses: [{ status: 'thành công', counted: 9, uncounted: 0 }, { status: 'lỗi', counted: 0, uncounted: 2 }, { status: 'thất bại', counted: 0, uncounted: 1 }],
    campaigns: [{ campaignId: 101, name: 'CD theo SĐT', current: true, counted: 5 }, { campaignId: 202, name: 'CD khác', current: false, counted: 4 }]
  })
  assert.equal(stranger.lastRunAt, ago(1), 'last run = newest result of the day')
  assert.equal(rows.zalo_add_friend.windowTimes.length, 3, '62-minute-old row is outside the 60-minute window')
  assert.equal(rows.zalo_add_friend.sharedCampaigns, 1)
  assert.deepEqual([rows.zalo_tag_contact.limited, rows.zalo_tag_contact.sharedCampaigns, rows.zalo_tag_contact.today.counted, rows.zalo_tag_contact.today.uncounted], [false, 0, 0, 3])
  assert.equal(rows.zalo_add_friend.today, null, 'no result today')
  assert.deepEqual(built.result.management, {
    status: 'đang chạy', schedule: '2026-11-10T04:00:00.000Z', scheduleType: 'daily', dailyStopTime: '18:00:00', sleepSeconds: 120, resumeKnown: true,
    skippableCodes: ['zalo_message_stranger', 'zalo_add_friend'], blockingCodes: ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend']
  })
  assert.deepEqual([built.result.groupApplied, built.result.groupName, built.result.continueWhenActionLimitReached], [true, 'Nhóm A', true])

  // akaChat: chỉ dòng có cờ; nhóm tắt thì không áp nhóm.
  user = { staffId: 9, organizationId: 1, isChatSync: true }
  const chat = await svc.buildDesktopCampaignActions(parsed, { ...parsed.campaigns[0], group: { ...parsed.campaigns[0].group, is_active: false } })
  const chatRows = Object.fromEntries(chat.result.actions.map(row => [row.code, row]))
  assert.deepEqual([chat.result.runtime, chat.result.groupApplied, chat.result.groupName, chatRows.zalo_message_stranger.windowUsed, chatRows.zalo_message_stranger.dayLimitSource],
    ['chat', false, null, 1, 'campaign'])
  assert.deepEqual([chatRows.zalo_message_stranger.today.counted, chatRows.zalo_message_stranger.today.uncounted], [5, 7], 'akaChat counts flagged rows only')
  user = { staffId: 9, organizationId: 1, isChatSync: false }

  // Không cài tiếp tục: không có hành động được bỏ qua; Facebook: chưa biết giờ chạy lại; sleepBetweenActions ưu tiên.
  const strict = await svc.buildDesktopCampaignActions(parsed, campaignRow({ extra: { ...phoneExtra(), actionLimits: { ...phoneExtra().actionLimits, continueWhenActionLimitReached: false, sleepBetweenActions: 45 } } }))
  assert.deepEqual([strict.result.management.skippableCodes, strict.result.management.sleepSeconds], [[], 45])
  const facebook = await svc.buildDesktopCampaignActions(parsed, campaignRow({ actionId: 'facebook_group_post', extra: { enableComment: true, actionLimits: { continueWhenActionLimitReached: true } },
    limitCheckActionCodes: ['fb_post_group', 'fb_comment'], account: { id: 11, flatform_type: 'facebook', is_delete: false }, group: null }))
  assert.deepEqual([facebook.result.management.resumeKnown, facebook.result.management.skippableCodes, facebook.result.actions.map(row => row.code)],
    [false, ['fb_comment'], ['fb_post_group', 'fb_comment']])

  // SMS: mọi dòng cũ NULL đều tính; khung bị cắt ở trần đọc hoặc dài hơn lookback = "ít nhất".
  rpcResult = { data: facts({
    campaigns: [{ id: 102, accountId: 12, actionId: 'sms_send', status: 'đang chạy', extra: { actionLimits: { byActionCode: { sms_send: { dailyLimit: 60, rateLimitCount: 9, rateLimitMinutes: 65 } } } },
      limitCheckActionCodes: ['sms_send'], account: { id: 12, flatform_type: 'sms', is_delete: false }, group: null }],
    statuses: [{ accountId: 12, actionCode: 'sms_send', countActionInDay: 25, countDate: CLOCK.vietnamDateKey, isDisable: false }],
    windows: [{ accountId: 12, actionCode: 'sms_send', lookbackMinutes: 65, e: [ago(1)], l: [ago(2)], o: [ago(3), ago(4)], truncated: true }],
    siblings: []
  }), error: null }
  const smsFacts = await repo.readCampaignLimitFacts([102], false, signal())
  const sms = (await svc.buildDesktopCampaignActions(smsFacts, smsFacts.campaigns[0])).result.actions[0]
  assert.deepEqual([sms.windowUsed, sms.windowAtLeast, sms.dayLimit, sms.dayLimitCapped], [4, true, 25, true])
  const longWindow = await svc.buildDesktopCampaignActions(smsFacts, { ...smsFacts.campaigns[0], extra: { actionLimits: { byActionCode: { sms_send: { rateLimitMinutes: 90 } } } } })
  assert.equal(longWindow.result.actions[0].windowAtLeast, true, 'window longer than the read lookback')
  console.log('PASS builder: window times by runtime, today split counted/uncounted per campaign, shared campaigns, management (schedule, pacing, skippable/blocking codes), akaChat group rule, Facebook resume unknown, SMS legacy rows and at-least windows')
}

async function listAndDetail() {
  // Danh sách: hành động có giới hạn + hành động bộ chạy thực hiện đang khóa; bỏ chiến dịch của tài khoản đã xóa.
  rpcResult = { data: facts({ campaigns: [campaignRow(), campaignRow({ id: 102, account: { id: 11, flatform_type: 'zalo', is_zalo_server: true, is_delete: true } })] }), error: null }
  const list = await svc.readCampaignLimitProgress([101, 102], signal())
  assert.equal(list.ready, true)
  assert.deepEqual(list.items.map(item => item.campaignId), [101])
  const item = list.items[0]
  assert.deepEqual(item.actions.map(action => action.code), ['zalo_find_phone_user', 'zalo_message_stranger', 'zalo_add_friend'], 'tag/alias without lock not listed')
  assert.deepEqual(pick(item.actions[1], ['dayUsed', 'dayLimit', 'windowLimit', 'windowMinutes', 'windowUsed', 'locked', 'lockedUntil', 'lockReason', 'sharedCampaigns']),
    { dayUsed: 12, dayLimit: 20, windowLimit: 6, windowMinutes: 65, windowUsed: 3, locked: true, lockedUntil: '2026-11-10T03:17:30Z', lockReason: 'Zalo hạn chế gửi tin', sharedCampaigns: 1 })
  // Hàm thuần dùng chung: hành động bắt buộc (Tìm SĐT) bình thường, hai hành động được bỏ qua đều bị chặn -> chờ mốc sớm nhất.
  const resume = limitShared.campaignLimitResume(item, NOW_MS, Date.parse(CLOCK.nextVietnamMidnight))
  assert.deepEqual([resume.blocked, resume.state, resume.actionCode], [false, 'ok', null], 'add friend still has room (3/5 in the hour)')
  rpcResult = { data: null, error: { code: 'PGRST202' } }
  assert.deepEqual((await svc.readCampaignLimitProgress([101], signal())).ready, false, 'DB chưa có V502: ẩn số')

  // Chi tiết: V502 trước; thiếu hàm hoặc chiến dịch ngoài phạm vi V502 thì bộ đọc cũ; tài khoản đã xóa báo lỗi nghiệp vụ.
  fallbackCalls = []
  assert.deepEqual(await svc.readCampaignAccountActionsDetail(101, signal()), { campaignId: 101, fallback: true, actions: [] })
  rpcResult = { data: facts({ campaigns: [] }), error: null }
  assert.equal((await svc.readCampaignAccountActionsDetail(101, signal())).fallback, true)
  assert.deepEqual(fallbackCalls, [101, 101])
  rpcResult = { data: facts({ today: [] }), error: null }
  const detail = await svc.readCampaignAccountActionsDetail(101, signal())
  assert.deepEqual([detail.campaignId, detail.management.status, detail.actions[0].today], [101, 'đang chạy', null])
  rpcResult = { data: facts({ campaigns: [campaignRow({ account: { id: 11, flatform_type: 'zalo', is_delete: true } })] }), error: null }
  await assert.rejects(svc.readCampaignAccountActionsDetail(101, signal()), error => error instanceof CampaignAccountActionsError && error.message === 'Tài khoản của chiến dịch đã bị xóa.')
  rpcResult = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
  await assert.rejects(svc.readCampaignAccountActionsDetail(101, signal()), error => /statement timeout/.test(error.message))
  console.log('PASS list/detail: limited + locked executable actions, deleted accounts skipped, shared resume rule, ready=false without V502, detail fallback to the previous reader')
}

async function ipcBoundary() {
  const auth = load('src/main/data/currentUser.ts', {
    'node:async_hooks': require('node:async_hooks'),
    './supabaseClient': { isTrustedServerSupabaseConfigured: () => true, desktopSession: { matches: () => true, clear: () => {} } }
  })
  const deadline = load('src/main/services/requestDeadline.ts')
  const handlers = {}
  let reads = 0, mode = 'ok'
  const pending = []
  const window = { webContents: { mainFrame: {} } }
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
  load('src/main/ipc/handlers/campaignAccountActionsHandlers.ts', {
    electron: { ipcMain: { handle: (channel, callback) => { handlers[channel] = callback } } },
    '../../../shared/campaignAccountActions': shared,
    '../../../shared/campaignLimitProgress': limitShared,
    '../../data/currentUser': auth,
    '../../services/requestDeadline': deadline,
    '../../services/campaignAccountActionsService': { CampaignAccountActionsError },
    '../../services/campaignLimitProgressService': {
      readCampaignAccountActionsDetail: async () => { throw new Error('not used') },
      readCampaignLimitProgress: async ids => {
        reads++
        assert.equal(auth.requireCurrentUser().staffId, 9)
        if (mode === 'error') throw new Error('relation secret does not exist')
        return new Promise(done => pending.push(() => done({ ready: true, checkedAt: NOW, nextDayStartsAt: NOW, items: ids.map(campaignId => ({ campaignId })) })))
      }
    }
  }).registerCampaignAccountActionsHandlers(window)
  const handler = handlers[shared.CAMPAIGN_LIMIT_PROGRESS_IPC]
  assert(handler && handlers[shared.CAMPAIGN_ACCOUNT_ACTIONS_IPC], 'both channels registered')
  auth.setCurrentUser({ staffId: 9, organizationId: 1 }); auth.setCurrentUserCredentials({ username: 'nv9', password: 'pw9' })
  const invalid = /Danh sách chiến dịch không hợp lệ/
  await assert.rejects(handler({ sender: {}, senderFrame: {} }, [1]), invalid)
  await assert.rejects(handler(event, []), invalid)
  await assert.rejects(handler(event, 'x'), invalid)
  await assert.rejects(handler(event, [1, 0]), invalid)
  await assert.rejects(handler(event, [1, 1.5]), invalid)
  await assert.rejects(handler(event, Array.from({ length: 102 }, (_, index) => index + 1)), invalid)
  const first = handler(event, [3, 1, 2]), duplicate = handler(event, [1, 2, 3, 3])
  await new Promise(done => setImmediate(done))
  assert.equal(reads, 1, 'same set (any order, duplicates) shares one flight')
  const second = handler(event, [4])
  await new Promise(done => setImmediate(done))
  await assert.rejects(handler(event, [5]), new RegExp(limitShared.CAMPAIGN_LIMIT_PROGRESS_UNAVAILABLE.slice(0, 20)), '2-flight cap')
  pending.splice(0).forEach(done => done())
  assert.deepEqual((await first).items.map(item => item.campaignId), [1, 2, 3])
  assert.deepEqual((await duplicate).items.map(item => item.campaignId), [1, 2, 3])
  await second
  const stale = handler(event, [6])
  await new Promise(done => setImmediate(done))
  auth.setCurrentUserCredentials({ username: 'other', password: 'other' })
  pending.splice(0).forEach(done => done())
  await assert.rejects(stale, error => error.message === limitShared.CAMPAIGN_LIMIT_PROGRESS_UNAVAILABLE, 'result of a replaced session is dropped')
  auth.setCurrentUserCredentials({ username: 'nv9', password: 'pw9' })
  mode = 'error'
  await assert.rejects(handler(event, [7]), error => error.message === limitShared.CAMPAIGN_LIMIT_PROGRESS_UNAVAILABLE, 'no transport/SQL text leaks')
  console.log('PASS IPC boundary: main-frame only, id validation (1..101 positive integers), shared flight per set, 2-flight cap, stale session drop, generic error')
}

;(async () => {
  await repository()
  await parityWithOldReader()
  await builderDetails()
  await listAndDetail()
  await ipcBoundary()
  console.log('PASS campaign limit progress smoke')
})().catch(error => { console.error(error); process.exit(1) })
