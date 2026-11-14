// Smoke test of the Desktop "Thêm nhóm data bằng Agent" / "Agent chọn bạn bè" service (no DB, no real AI): switch,
// RPC contract (V533–V538 via V539), error mapping, read slots, recipients batches, group creation and one agent turn.
// Run: node scripts/data-group-agent-service-smoke.cjs
// Contract: docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const ROOT = path.resolve(__dirname, '..')
const stubs = {
  currentUser: `
    export const requireCurrentUser = () => { if (!globalThis.__user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi thao tác dữ liệu.'); return globalThis.__user }
    export const requireCurrentUserCredentials = () => ({ username: 'fixture-user', password: 'fixture-password' })
    export const runWithCurrentUser = (_user, operation) => operation()`,
  supabaseClient: `
    function builder(table) {
      const state = { table, filters: [] }
      const self = {
        select(columns) { state.columns = columns; return self },
        eq(column, value) { state.filters.push(['eq', column, value]); return self },
        in(column, value) { state.filters.push(['in', column, value]); return self },
        not(column, op, value) { state.filters.push(['not', column, op, value]); return self },
        abortSignal(signal) { state.signal = signal; return self },
        maybeSingle() { state.maybeSingle = true; return self },
        then(resolve, reject) { globalThis.__calls.push(state); return Promise.resolve().then(() => globalThis.__table(state)).then(resolve, reject) }
      }
      return self
    }
    export const getSupabaseClient = () => ({
      from: table => builder(table),
      rpc: (name, params) => ({ abortSignal: signal => Promise.resolve().then(() => globalThis.__rpc(name, params, signal)) })
    })`,
  aiRepository: `export const getDataGroupAgentAiConfig = (section, signal) => globalThis.__aiConfig(section, signal)`,
  aiRuntimeService: `export const callAiUsing = (code, payload, metadata, options) => globalThis.__ai(code, payload, metadata, options)`
}

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const filter = (extra = {}) => ({
  version: 1, source: 'zalo_friends', accountId: 9, match: 'all', excludeOptedOut: true, excludeBlocked: true, sort: null, limit: null,
  groups: [{ match: 'all', conditions: [{ field: 'zalo_tag', op: 'has_any', tagIds: ['7'] }] }], ...extra
})
const draft = () => { const { accountId, ...rest } = filter(); return rest }
const catalog = (extra = {}) => ({
  version: 1, account: { id: 9, name: 'Shop Hoa Mai', kind: 'desktop', available: true, friendCount: 1725, friendsUpdatedAt: '2026-11-13T14:30:00Z' },
  zaloTags: [{ id: '7', name: 'VIP 2025', count: 95 }], akaBizTags: [{ id: 3, name: 'Đã mua' }], dataGroups: [{ id: 5, name: 'Khách VIP' }],
  dataGroupsIncomplete: false, campaigns: [{ id: 10, name: 'Black Friday' }], campaignsIncomplete: false,
  coverage: { messagesSince: '2026-06-03T02:00:00Z', trackingSince: '2026-10-02T03:00:00Z', deliveredAvailable: false, maxMessageDays: 365 }, ...extra
})
const filterResult = (mode, extra = {}) => ({
  version: 1, mode, accountId: 9, totalFriends: 1725, matched: 3, notes: [], evaluatedAt: '2026-11-14T10:00:00Z',
  coverage: { messagesSince: null, trackingSince: null, factsFrom: null, deliveredAvailable: false },
  ...(mode === 'page' ? { rows: [] } : {}), ...(mode === 'ids' ? { contactIds: [11, 12, 13] } : {}), ...extra
})

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-group-agent-'))
  try {
    const outfile = path.join(dir, 'service.cjs')
    await build({
      stdin: {
        contents: `export * from './src/main/services/dataGroupAgentService'; export { DATA_GROUP_AGENT_SCHEMA } from './src/shared/dataGroupAgent'`,
        resolveDir: ROOT, loader: 'ts'
      },
      outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
      plugins: [{
        name: 'stubs',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /(^|\/)(currentUser|supabaseClient|aiRepository|aiRuntimeService)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }))
          // Ngân sách và thời gian chờ chỗ ngắn để bài chạy trong một giây.
          pluginBuild.onLoad({ filter: /dataGroupAgentService\.ts$/ }, args => ({
            loader: 'ts', contents: fs.readFileSync(args.path, 'utf8')
              .replace('FRIEND_READ_BUDGET_MS = 65_000', 'FRIEND_READ_BUDGET_MS = 400')
              .replace('FRIEND_READ_WAIT_MS = 20_000', 'FRIEND_READ_WAIT_MS = 150')
          }))
        }
      }]
    })
    const svc = require(outfile)
    let passed = 0
    const ok = (condition, message, detail) => {
      assert.ok(condition, `${message}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 600)}`}`)
      passed++
      console.log(`ok ${passed} - ${message}`)
    }
    const rejects = async (promise, code, message) => {
      try { await promise } catch (error) { ok(error.code === code, message, { code: error.code, message: error.message, details: error.details }); return error }
      assert.fail(`${message}: không lỗi`)
    }
    const signal = () => AbortSignal.timeout(5_000)
    let setting = { value: '{"audience":"all"}' }
    const reset = () => {
      globalThis.__user = { staffId: 724, organizationId: 701, isAdminAkabiz: false }
      globalThis.__calls = []
      globalThis.__table = state => state.table === 'auto_system_settings'
        ? (setting instanceof Error ? { data: null, error: { code: 'XX000', message: 'fail' } } : { data: setting, error: null })
        : { data: [], error: null }
      globalThis.__rpc = () => ({ data: null, error: { code: 'XX000', message: 'unexpected' } })
      globalThis.__aiConfig = () => null
      globalThis.__ai = () => ({ ok: false, content: '' })
    }
    reset()

    // --- Công tắc ---
    setting = null
    ok((await svc.readDataGroupAgentSettingSafe()).audience === 'off', 'thiếu dòng công tắc = tắt')
    setting = new Error('x')
    ok((await svc.readDataGroupAgentSettingSafe()).audience === 'off', 'đọc công tắc lỗi = tắt (nút ẩn)')
    setting = { value: '{"audience":"all","campaignForm":false}' }
    const read = await svc.readDataGroupAgentSettingSafe()
    ok(read.audience === 'all' && read.campaignForm === false, 'đọc audience và campaignForm', read)
    const settingCall = globalThis.__calls.at(-1)
    ok(JSON.stringify(settingCall.filters) === JSON.stringify([['eq', 'key', 'web.data_group_agent'], ['eq', 'is_active', true], ['eq', 'is_secret', false]]),
      'một dòng auto_system_settings không bí mật', settingCall.filters)
    await rejects(svc.assertDataGroupAgentAccess(signal(), 'campaign_recipients'), 'data_group_agent_forbidden', 'campaignForm false: chặn form chiến dịch')
    await svc.assertDataGroupAgentAccess(signal(), 'data_group')
    ok(true, 'campaignForm false: trang Nhóm data vẫn dùng được')
    setting = { value: '{"audience":"admin_akabiz"}' }
    await rejects(svc.listFriendAccounts(signal()), 'data_group_agent_forbidden', 'admin_akabiz: nhân viên thường bị chặn')
    globalThis.__user.isAdminAkabiz = true
    globalThis.__rpc = (name, params) => ({ data: { accounts: [{ id: 9, name: 'Shop', kind: 'desktop', available: true, friendCount: 5, friendsUpdatedAt: '2026-11-13T00:00:00Z' }, { id: 'x' }] }, error: null, name, params })
    let rpcSeen
    const wrap = fn => (name, params, sig) => { rpcSeen = { name, params }; return fn(name, params, sig) }
    globalThis.__rpc = wrap(globalThis.__rpc)
    const accounts = await svc.listFriendAccounts(signal())
    ok(accounts.accounts.length === 1 && accounts.accounts[0].kind === 'desktop', 'admin akaBiz: danh sách tài khoản, bỏ dòng hỏng', accounts)
    ok(rpcSeen.name === 'aka_agent_list_zalo_friend_accounts_v1' && rpcSeen.params.p_staff_id === 724 && rpcSeen.params.p_organization_id === 701
      && rpcSeen.params.p_auth_username === 'fixture-user' && rpcSeen.params.p_auth_password === 'fixture-password',
    'RPC nhận nhân viên/tổ chức của phiên và mật khẩu tự động hóa', rpcSeen)
    setting = { value: '{"audience":"off"}' }
    await rejects(svc.listFriendAccounts(signal()), 'data_group_agent_forbidden', 'off: chặn mọi lượt')
    setting = { value: '{"audience":"all"}' }
    globalThis.__user.isAdminAkabiz = false

    // --- Đổi lỗi DB ---
    const cases = [
      [{ code: '42501', message: 'permission denied for function aka_agent_list_zalo_friend_accounts_v1' }, 'friend_filter_unavailable', 'V539 chưa apply: đang được cập nhật'],
      [{ code: 'PGRST202', message: 'Could not find the function' }, 'friend_filter_unavailable', 'DB chưa có hàm'],
      [{ code: 'P0001', message: 'automation_auth_invalid' }, 'session_invalid', 'mật khẩu tự động hóa sai: đăng nhập lại'],
      [{ code: '42501', message: 'desktop_staff_scope_denied' }, 'session_invalid', 'token gắn nhân viên khác: đăng nhập lại'],
      [{ code: 'P0001', message: 'friend_filter_account_unavailable' }, 'friend_filter_account_unavailable', 'tài khoản ngoài gói'],
      [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'friend_filter_timeout', 'hết 55 giây của DB'],
      [{ code: 'XX000', message: 'boom' }, 'friend_filter_failed', 'lỗi khác: câu chung, không lộ SQL']
    ]
    for (const [error, code, label] of cases) {
      globalThis.__rpc = () => ({ data: null, error })
      const failure = await rejects(svc.listFriendAccounts(signal()), code, `lỗi DB → ${code}: ${label}`)
      ok(!/permission|automation|desktop_staff|statement|boom/i.test(failure.message), `câu báo tiếng Việt (${code})`, failure.message)
    }
    globalThis.__rpc = () => ({ data: null, error: { code: 'P0001', message: 'friend_filter_too_many_messages', details: '12' } })
    const many = await rejects(svc.filterZaloFriends({ requestId: crypto.randomUUID(), mode: 'count', filter: filter(), offset: null, limit: null }, signal()),
      'friend_filter_too_many_messages', 'quá 30.000 lượt gửi: mã riêng')
    ok(many.details.maxDays === 12 && many.message.includes('12 ngày'), 'kèm số ngày tối đa', many.details)

    // --- Lọc ---
    await rejects(svc.filterZaloFriends({ requestId: 'mã sai', mode: 'count', filter: filter(), offset: null, limit: null }, signal()), 'invalid_friend_filter', 'requestId sai: từ chối, không gọi DB')
    await rejects(svc.filterZaloFriends({ requestId: crypto.randomUUID(), mode: 'count', filter: filter({ accountId: 0 }), offset: null, limit: null }, signal()),
      'invalid_friend_filter', 'bộ lọc sai: từ chối')
    globalThis.__rpc = wrap((name, params) => ({ data: filterResult(params.p_request.mode), error: null }))
    const page = await svc.filterZaloFriends({ requestId: crypto.randomUUID(), mode: 'page', filter: filter(), offset: 0, limit: 20 }, signal())
    ok(page.matched === 3 && rpcSeen.name === 'aka_agent_read_zalo_friend_filter_v1'
      && JSON.stringify(Object.keys(rpcSeen.params.p_request)) === JSON.stringify(['mode', 'filter', 'offset', 'limit']) && rpcSeen.params.p_request.limit === 20,
    'đếm thử: một RPC chế độ page, 20 người', rpcSeen.params.p_request)

    // --- Giới hạn lượt lọc nặng: 2 lượt, chờ chỗ, lượt bị hủy giữ chỗ tới hết ngân sách ---
    const gates = []
    globalThis.__rpc = (name, params, sig) => new Promise((resolve) => {
      gates.push(() => resolve({ data: filterResult('count'), error: null }))
      sig.addEventListener('abort', () => resolve({ data: null, error: { code: '', message: 'AbortError' } }), { once: true })
    })
    const req = () => ({ requestId: crypto.randomUUID(), mode: 'count', filter: filter(), offset: null, limit: null })
    const a = new AbortController()
    const first = svc.filterZaloFriends(req(), a.signal)
    const second = svc.filterZaloFriends(req(), signal())
    await new Promise(resolve => setTimeout(resolve, 20))
    ok(svc.friendReadSlotsInUse() === 2, 'hai lượt lọc chạy cùng lúc')
    await rejects(svc.filterZaloFriends(req(), signal()), 'friend_filter_busy', 'lượt thứ ba chờ 150 ms không có chỗ: báo bận')
    a.abort()
    await rejects(first, 'friend_filter_cancelled', 'lượt bị hủy')
    ok(svc.friendReadSlotsInUse() === 2, 'lượt bị hủy vẫn giữ chỗ (DB có thể còn chạy)')
    gates[1]()
    await second
    ok(svc.friendReadSlotsInUse() === 1, 'lượt xong thì trả chỗ ngay')
    await new Promise(resolve => setTimeout(resolve, 450))
    ok(svc.friendReadSlotsInUse() === 0, 'lượt bị hủy trả chỗ khi hết ngân sách')

    // --- Người nhận (form chiến dịch) ---
    const recipientsReq = () => ({ requestId: crypto.randomUUID(), filter: filter() })
    globalThis.__rpc = () => ({ data: filterResult('ids', { matched: 5001, contactIds: [] }), error: null })
    const tooMany = await rejects(svc.readZaloFriendRecipients(recipientsReq(), signal()), 'friend_recipients_too_many', 'hơn 5.000 người: từ chối')
    ok(tooMany.details.matched === 5001 && tooMany.details.max === 5000, 'kèm số khớp và trần', tooMany.details)
    const ids = Array.from({ length: 1201 }, (_, index) => 100 + index)
    globalThis.__rpc = wrap(() => ({ data: filterResult('ids', { matched: ids.length, contactIds: ids }), error: null }))
    globalThis.__calls = []
    globalThis.__table = state => state.table === 'auto_system_settings' ? { data: setting, error: null } : {
      data: state.filters.find(item => item[0] === 'in')[2].filter(id => id !== 105).reverse().map(id => ({ id, uid: `u${id}`, name: id === 106 ? '' : `Bạn ${id}` })), error: null }
    const recipients = await svc.readZaloFriendRecipients(recipientsReq(), signal())
    const batches = globalThis.__calls.filter(call => call.table === 'auto_account_contacts')
    ok(rpcSeen.params.p_request.mode === 'ids' && rpcSeen.params.p_request.offset === null, 'một lượt lọc chế độ ids', rpcSeen.params.p_request)
    ok(batches.length === 3 && batches.map(call => call.filters.find(item => item[0] === 'in')[2].length).join() === '500,500,201',
      'đọc UID và tên theo khóa chính, lô 500 tuần tự', batches.length)
    const scope = JSON.stringify(batches[0].filters.filter(item => item[0] !== 'in'))
    ok(scope === JSON.stringify([['eq', 'account_id', 9], ['eq', 'staff_id', 724], ['eq', 'organization_id', 701], ['eq', 'contact_type', 'person'],
      ['eq', 'is_friend', true], ['not', 'is_delete', 'is', true]]) && batches[0].columns === 'id,uid,name', 'lô đọc giữ tài khoản/nhân viên/tổ chức, chỉ bạn bè còn', scope)
    ok(recipients.recipients.length === 1200 && recipients.missing === 1 && recipients.recipients[0].contactId === 100
      && recipients.recipients[5].contactId === 106 && recipients.recipients[5].name === null, 'giữ thứ tự của bộ lọc, đếm người không còn', recipients.recipients.slice(0, 7))
    setting = { value: '{"audience":"all","campaignForm":false}' }
    await rejects(svc.readZaloFriendRecipients(recipientsReq(), signal()), 'data_group_agent_forbidden', 'campaignForm false: không lấy người nhận')
    setting = { value: '{"audience":"all"}' }

    // --- Tạo nhóm ---
    const createReq = { requestId: crypto.randomUUID(), name: 'Khách VIP', color: null, filter: filter(), summary: ['Bạn bè của Shop', 'Tag Zalo: VIP 2025'] }
    globalThis.__rpc = wrap(() => ({ data: { groupId: 77, filterId: 5, matched: 3, inserted: 3, replayed: false }, error: null }))
    const created = await svc.createDataGroupFromFriendFilter(createReq, signal())
    ok(created.groupId === 77 && created.inserted === 3 && rpcSeen.name === 'aka_agent_create_data_group_from_friend_filter_v1'
      && rpcSeen.params.p_request.requestId === createReq.requestId && rpcSeen.params.p_auth_password === 'fixture-password',
    'tạo nhóm: một RPC kèm mật khẩu tự động hóa', created)
    globalThis.__rpc = () => ({ data: null, error: { code: '', message: 'TypeError: fetch failed' } })
    const lost = await rejects(svc.createDataGroupFromFriendFilter(createReq, signal()), 'friend_filter_timeout', 'mất kết nối khi tạo nhóm')
    ok(/không tạo trùng/.test(lost.message), 'câu báo nói bấm lại không tạo trùng', lost.message)
    let release
    globalThis.__rpc = () => new Promise(resolve => { release = () => resolve({ data: { groupId: 78, filterId: 6, matched: 1, inserted: 1, replayed: false }, error: null }) })
    const pending = svc.createDataGroupFromFriendFilter({ ...createReq, requestId: crypto.randomUUID() }, signal())
    await new Promise(resolve => setTimeout(resolve, 20))
    await rejects(svc.createDataGroupFromFriendFilter({ ...createReq, requestId: crypto.randomUUID() }, signal()), 'friend_filter_busy', 'một lượt tạo nhóm mỗi tiến trình')
    release()
    ok((await pending).groupId === 78, 'lượt đang tạo vẫn xong')

    // --- Lượt chat ---
    const turnReq = (extra = {}) => ({ requestId: crypto.randomUUID(), purpose: 'campaign_recipients', sourceType: 'zalo_friends', accountId: 9,
      message: 'Bạn bè tag VIP, số 0912 345 678', history: [{ role: 'user', text: 'mail a.b@shop.vn' }], draft: null, lastPreview: null, groupName: null, ...extra })
    ok((await svc.runDataGroupAgentTurn({ bad: true }, signal())).code === 'invalid', 'yêu cầu sai: invalid')
    globalThis.__rpc = () => ({ data: catalog({ account: { ...catalog().account, friendCount: 0 } }), error: null })
    ok((await svc.runDataGroupAgentTurn(turnReq(), signal())).code === 'no_friends', 'chưa có danh bạ: no_friends, không gọi AI')
    globalThis.__rpc = () => ({ data: catalog(), error: null })
    ok((await svc.runDataGroupAgentTurn(turnReq(), signal())).code === 'not_configured', 'chưa có dòng cấu hình Desktop (V539 chưa apply): not_configured')
    globalThis.__aiConfig = () => ({ using: { code: 'app_data_group_friend_agent_web' }, model: { provider: 'openai', endpoint: 'https://api.openai.com/v1/responses' },
      formConfigId: 25, outputSchema: svc.DATA_GROUP_AGENT_SCHEMA })
    let aiSeen
    globalThis.__ai = (code, payload, metadata, options) => {
      aiSeen = { code, payload, metadata, options }
      const content = JSON.stringify({ status: 'confirm', message: 'Mình sẽ lấy bạn bè có tag VIP 2025.', questions: [], assumptions: [], unresolved: [],
        groupName: null, filter: draft() })
      assert.ok(options.validateContent(content), 'nội dung mẫu qua schema')
      return { ok: true, content }
    }
    const turn = await svc.runDataGroupAgentTurn(turnReq(), signal())
    ok(turn.ok && turn.reply.status === 'confirm' && turn.reply.filter.accountId === 9 && turn.reply.summaryLines.length > 0, 'lượt chat: bộ lọc gắn tài khoản, có tóm tắt', turn)
    const context = JSON.parse(aiSeen.payload.dataGroupAgentContext)
    ok(aiSeen.code === 'app_data_group_friend_agent_web' && aiSeen.options.formConfig.formConfigId === 25 && aiSeen.metadata.accountId === 9
      && aiSeen.metadata.organizationId === 701, 'gọi đúng dòng cấu hình qua proxy, ghi log theo tài khoản', aiSeen.metadata)
    ok(context.purpose === 'campaign_recipients' && !JSON.stringify(context).includes('0912') && !JSON.stringify(context).includes('a.b@shop.vn'),
      'ngữ cảnh gửi AI có mục đích, đã che SĐT và email', context.request ?? context)
    ok(aiSeen.payload.bodyOverrides.text.format.name === 'data_group_friend_agent' && aiSeen.payload.bodyOverrides.text.format.strict === true,
      'Structured Outputs strict, cùng tên định dạng với API Web', aiSeen.payload.bodyOverrides)
    ok(aiSeen.options.validateContent('{"status":"confirm"}') === false, 'nội dung sai schema bị loại')
    globalThis.__aiConfig = () => ({ using: { code: 'app_data_group_friend_agent_web' }, model: { provider: 'openai', endpoint: 'https://api.openai.com/v1/responses' },
      formConfigId: 25, outputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false } })
    ok((await svc.runDataGroupAgentTurn(turnReq(), signal())).code === 'not_configured', 'schema trên DB lệch hợp đồng: not_configured')
    globalThis.__aiConfig = () => ({ using: { code: 'app_data_group_friend_agent_web' }, model: { provider: 'openai', endpoint: 'https://api.openai.com/v1/responses' },
      formConfigId: 25, outputSchema: svc.DATA_GROUP_AGENT_SCHEMA })
    globalThis.__ai = () => ({ ok: false, content: '', error: 'HTTP 500' })
    ok((await svc.runDataGroupAgentTurn(turnReq(), signal())).code === 'unavailable', 'AI lỗi: unavailable')
    setting = { value: '{"audience":"all","campaignForm":false}' }
    const blocked = await svc.runDataGroupAgentTurn(turnReq(), signal())
    ok(blocked.code === 'forbidden', 'campaignForm false: lượt chat của form chiến dịch bị chặn', blocked)
    setting = { value: '{"audience":"all"}' }
    globalThis.__rpc = () => ({ data: null, error: { code: 'P0001', message: 'friend_filter_account_unavailable' } })
    ok((await svc.runDataGroupAgentTurn(turnReq(), signal())).code === 'account_unavailable', 'tài khoản ngoài gói: account_unavailable')
    const aborted = new AbortController(); aborted.abort()
    ok((await svc.runDataGroupAgentTurn(turnReq(), aborted.signal)).code === 'cancelled', 'đã hủy: cancelled')

    globalThis.__user = null
    await assert.rejects(svc.listFriendAccounts(signal()), /đăng nhập/)
    ok(true, 'chưa đăng nhập: từ chối')
    console.log(`\nAll ${passed} checks passed.`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })
