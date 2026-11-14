// Smoke test of the Desktop "Kết quả chạy" action filter / merged service (no DB): RPC contract, real V539 JSON shapes
// (scripts/fixtures/campaign-result-actions-rpc-samples.json), action options, usesInputData, query mapping, validation
// before any RPC, error codes, in-flight dedupe, busy gate (3) and deadline.
// Run: node scripts/campaign-result-actions-service-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const samples = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/campaign-result-actions-rpc-samples.json'), 'utf8'))

const stubs = {
  currentUser: `
    export const requireCurrentUser = () => { if (!globalThis.__user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi thao tác dữ liệu.'); return globalThis.__user }
    export const requireCurrentUserCredentials = () => ({ username: 'fixture-user', password: 'fixture-password' })
    export const runWithCurrentUser = (_user, operation) => operation()`,
  supabaseClient: `
    function builder(table, calls) {
      const state = { table, filters: [], maybeSingle: false }
      const self = {
        select(columns) { state.columns = columns; return self },
        eq(column, value) { state.filters.push(['eq', column, value]); return self },
        gt(column, value) { state.filters.push(['gt', column, value]); return self },
        order() { return self }, limit() { return self },
        abortSignal(signal) { state.signal = signal; return self },
        maybeSingle() { state.maybeSingle = true; return self },
        then(resolve, reject) { calls.push(state); return Promise.resolve(globalThis.__table(state)).then(resolve, reject) }
      }
      return self
    }
    export const getSupabaseClient = () => ({
      from: table => builder(table, globalThis.__calls),
      rpc: (name, params) => ({ abortSignal: signal => globalThis.__rpc(name, params, signal) })
    })`,
  reportReadRpc: 'export const REPORT_READ_TIMEOUT_MS = globalThis.__deadlineMs || 65000'
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-result-actions-'))
  try {
    await build({
      entryPoints: [path.resolve(__dirname, '../src/main/services/campaignResultActionsService.ts')], outfile: path.join(dir, 'service.cjs'),
      bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
      plugins: [{
        name: 'stubs',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /(^|\/)(currentUser|supabaseClient|reportReadRpc)$/ }, args => ({
            path: args.path.split('/').pop(), namespace: 'stub'
          }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }))
        }
      }]
    })
    globalThis.__deadlineMs = 300
    const service = require(path.join(dir, 'service.cjs'))
    const handle = request => service.handleCampaignResultActionsRequest(request)
    let passed = 0
    const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }

    const campaigns = new Map([
      [301, { id: 301, action_id: 'zalo_message_phone', extra_settings: {}, primary_account: { flatform_type: 'zalo' } }],
      [302, { id: 302, action_id: 'facebook_timeline_post', extra_settings: {}, primary_account: { flatform_type: 'facebook' } }],
      [303, { id: 303, action_id: 'facebook_post_group', extra_settings: {}, primary_account: { flatform_type: 'facebook' } }]
    ])
    globalThis.__user = { staffId: 7, organizationId: 9 }
    globalThis.__calls = []
    globalThis.__table = state => {
      assert.equal(state.table, 'auto_campaigns')
      const id = state.filters.find(filter => filter[1] === 'id')[2]
      assert.deepEqual(state.filters.filter(filter => filter[1] !== 'id'),
        [['eq', 'staff_id', 7], ['eq', 'organization_id', 9], ['eq', 'is_delete', false]])
      return { data: campaigns.get(id) ?? null, error: null }
    }
    let rpcCalls = []
    let rpcImpl = (_name, params) => ({ data: samples[params.p_query.mode], error: null })
    globalThis.__rpc = (name, params, signal) => { rpcCalls.push({ name, params, signal }); return Promise.resolve(rpcImpl(name, params, signal)) }
    const reset = () => { rpcCalls = []; globalThis.__calls = [] }

    // 1. actions: one campaign read + one RPC with the Desktop identity; options from configuration, then history, '' last.
    let result = await handle({ kind: 'actions', campaignId: 301 })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(rpcCalls.length, 1)
    assert.equal(rpcCalls[0].name, 'aka_agent_read_campaign_result_recipients')
    assert.deepEqual({ ...rpcCalls[0].params }, {
      p_staff_id: 7, p_organization_id: 9, p_auth_username: 'fixture-user', p_auth_password: 'fixture-password',
      p_campaign_id: 301, p_query: { mode: 'actions' }
    })
    assert.equal(globalThis.__calls.length, 1)
    assert.equal(result.data.campaignId, 301)
    assert.equal(result.data.total, 67)
    assert.equal(result.data.usesInputData, true)
    const options = result.data.actions
    const firstHistory = options.findIndex(option => !option.configured)
    assert.ok(firstHistory > 0, 'configured actions come first')
    assert.ok(options.slice(0, firstHistory).every(option => option.configured))
    assert.ok(options.slice(firstHistory).every(option => !option.configured))
    assert.equal(options.at(-1).code, '')
    assert.equal(options.at(-1).name, 'Chưa rõ hành động')
    assert.equal(options.at(-1).count, 1)
    assert.equal(options.reduce((sum, option) => sum + option.count, 0), 67)
    const find = options.find(option => option.code === 'zalo_find_phone_user')
    assert.ok(find && find.auxiliary && find.name === 'Tìm SĐT', JSON.stringify(find))
    const stranger = options.find(option => option.code === 'zalo_message_stranger')
    assert.equal(stranger.count, 60)
    ok('actions: Desktop identity, configured first, history after, "Chưa rõ hành động" last, Desktop names')

    reset()
    result = await handle({ kind: 'actions', campaignId: 302 })
    assert.equal(result.ok, true)
    assert.equal(result.data.usesInputData, false)
    result = await handle({ kind: 'actions', campaignId: 303 })
    assert.equal(result.data.usesInputData, true)
    ok('actions: usesInputData false only for Facebook types without input data')

    // 2. page: query mapping (defaults, trimming, ISO dates, engagement "all" omitted), offset/limit, parsed items.
    reset()
    result = await handle({
      kind: 'page', campaignId: 301, page: 2, pageSize: 3,
      query: { search: '  An  ', status: ' thành công ', dateFrom: '2026-11-01T00:00:00.000+07:00', dateTo: '2026-11-30T23:59:59.999+07:00', engagementFilter: 'all' }
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(rpcCalls[0].params.p_query, {
      mode: 'page', sort: 'processed_desc', search: 'An', status: 'thành công',
      dateFrom: '2026-10-31T17:00:00.000Z', dateTo: '2026-11-30T16:59:59.999Z', offset: 3, limit: 3
    })
    assert.equal(globalThis.__calls.length, 0, 'page does not read the campaign row (the RPC checks ownership)')
    assert.equal(result.data.total, 6)
    assert.equal(result.data.page, 2)
    assert.equal(result.data.pageSize, 3)
    assert.equal(result.data.items[0].name, 'Em')
    assert.equal(result.data.items[0].resultCount, 55)
    assert.equal(result.data.items[0].results.length, 50)
    ok('page: filters mapped like the results tab, page offset, real payload parsed (55 results, 50 returned)')

    reset()
    result = await handle({ kind: 'keys', campaignId: 301, query: { sort: 'created_asc', engagementFilter: 'seen' } })
    assert.equal(result.ok, true)
    assert.deepEqual(rpcCalls[0].params.p_query, { mode: 'keys', sort: 'created_asc', engagementFilter: 'seen' })
    assert.deepEqual(result.data, { ids: [5, 3, 2, 1, 7, 4], total: 6, truncated: false })
    reset()
    result = await handle({ kind: 'byKeys', campaignId: 301, ids: [1] })
    assert.equal(result.ok, true)
    assert.deepEqual(rpcCalls[0].params.p_query, { mode: 'byKeys', ids: [1] })
    assert.equal(result.data.items[0].name, 'An')
    assert.ok(result.data.items[0].results.length >= 4)
    ok('keys and byKeys: exact p_query, parsed result')

    // 3. Validation happens before any RPC.
    reset()
    const invalid = [
      { kind: 'page', campaignId: 301, page: 1, query: { sort: 'newest' } },
      { kind: 'page', campaignId: 301, page: 0, query: {} },
      { kind: 'page', campaignId: 301, page: 1, pageSize: 101, query: {} },
      { kind: 'page', campaignId: 301, page: 1, query: { engagementFilter: 'liked' } },
      { kind: 'page', campaignId: 301, page: 1, query: { dateFrom: 'hôm qua' } },
      { kind: 'page', campaignId: 301, page: 1, query: { dateFrom: '2026-11-02T00:00:00Z', dateTo: '2026-11-01T00:00:00Z' } },
      { kind: 'keys', campaignId: 301, query: { sort: 'id' } },
      { kind: 'byKeys', campaignId: 301, ids: [] },
      { kind: 'byKeys', campaignId: 301, ids: [1, 1] },
      { kind: 'byKeys', campaignId: 301, ids: [1, 0] },
      { kind: 'byKeys', campaignId: 301, ids: Array.from({ length: 201 }, (_, index) => index + 1) },
      { kind: 'unknown', campaignId: 301 }
    ]
    for (const request of invalid) {
      result = await handle(request)
      assert.equal(result.ok, false, JSON.stringify(request))
      assert.equal(result.code, 'invalid_campaign_result_query', JSON.stringify(request))
    }
    result = await handle({ kind: 'actions', campaignId: 0 })
    assert.equal(result.code, 'invalid_campaign_id')
    assert.equal(rpcCalls.length, 0)
    assert.equal(globalThis.__calls.length, 0)
    ok('invalid requests refused before any DB read')

    // 4. Error mapping (no SQL text reaches the renderer).
    const cases = [
      [{ code: 'PGRST202', message: 'Could not find the function' }, 'campaign_result_actions_not_ready'],
      [{ code: '42883', message: 'function does not exist' }, 'campaign_result_actions_not_ready'],
      [{ code: '42501', message: 'permission denied for function aka_agent_read_campaign_result_recipients' }, 'campaign_result_actions_not_ready'],
      [{ code: '42501', message: 'desktop_staff_scope_denied' }, 'report_access_denied'],
      [{ code: 'P0001', message: 'automation_auth_invalid' }, 'session_invalid'],
      [{ code: 'P0001', message: 'campaign_not_found' }, 'campaign_not_found'],
      [{ code: '22023', message: 'invalid_campaign_result_recipients' }, 'invalid_campaign_result_query'],
      [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'campaign_result_recipients_timeout'],
      [{ code: 'XX000', message: 'boom select * from x' }, 'campaign_result_recipients_unavailable']
    ]
    for (const [error, code] of cases) {
      rpcImpl = () => ({ data: null, error })
      result = await handle({ kind: 'keys', campaignId: 301, query: {} })
      assert.equal(result.ok, false)
      assert.equal(result.code, code, JSON.stringify(error))
      assert.ok(!/select|function|aka_agent/i.test(result.message), result.message)
    }
    rpcImpl = () => ({ data: { items: 'x' }, error: null })
    result = await handle({ kind: 'page', campaignId: 301, page: 1, query: {} })
    assert.equal(result.code, 'campaign_result_recipients_unavailable')
    rpcImpl = () => ({ data: { actions: [], total: 0 }, error: null })
    result = await handle({ kind: 'actions', campaignId: 999 })
    assert.equal(result.code, 'campaign_not_found')
    globalThis.__user = null
    result = await handle({ kind: 'actions', campaignId: 301 })
    assert.equal(result.code, 'session_invalid')
    globalThis.__user = { staffId: 7, organizationId: 9 }
    ok('errors map to stable codes and Vietnamese messages; not-ready covers missing function and missing Desktop grant')

    // 5. In-flight dedupe, busy gate of 3 distinct reads, deadline.
    reset()
    const gates = []
    rpcImpl = (_name, params) => new Promise(resolve => gates.push(() => resolve({ data: samples[params.p_query.mode], error: null })))
    const same = [handle({ kind: 'page', campaignId: 301, page: 1, query: { search: 'a' } }), handle({ kind: 'page', campaignId: 301, page: 1, query: { search: 'a' } })]
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(rpcCalls.length, 1, 'identical requests share one read')
    const others = [handle({ kind: 'page', campaignId: 301, page: 2, query: { search: 'a' } }), handle({ kind: 'keys', campaignId: 301, query: {} })]
    await new Promise(resolve => setImmediate(resolve))
    result = await handle({ kind: 'byKeys', campaignId: 301, ids: [1] })
    assert.equal(result.code, 'campaign_result_recipients_busy')
    gates.forEach(open => open())
    const settled = await Promise.all([...same, ...others])
    assert.ok(settled.every(item => item.ok))
    assert.deepEqual(settled[0], settled[1])
    rpcImpl = (_name, params) => ({ data: samples[params.p_query.mode], error: null })
    result = await handle({ kind: 'byKeys', campaignId: 301, ids: [1] })
    assert.equal(result.ok, true, 'gate frees after completion')
    ok('identical reads deduplicated, a 4th distinct read is busy, the gate frees afterwards')

    rpcImpl = (_name, _params, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve({ data: null, error: { code: '20', message: 'AbortError' } })))
    const started = Date.now()
    // AbortSignal.timeout does not keep Node alive; hold the loop open while the deadline fires.
    const keepAlive = setInterval(() => {}, 1000)
    result = await handle({ kind: 'keys', campaignId: 301, query: { search: 'slow' } })
    clearInterval(keepAlive)
    assert.equal(result.code, 'campaign_result_recipients_timeout')
    assert.ok(Date.now() - started < 3000)
    ok('deadline aborts the read and reports the timeout')

    console.log(`campaign result actions service: ${passed}/${passed} passed`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

let finished = false
// A promise that never settles would let Node exit 0 silently: treat that as a failure.
process.on('beforeExit', () => { if (!finished) { console.error('FAIL - smoke test stopped before the end'); process.exitCode = 1 } })
main().then(() => { finished = true }, error => { console.error(error); process.exit(1) })
