// Smoke test of the Desktop "Bỏ data đã có trong nhóm này / ở nhóm data khác" service (no DB): switch read, RPC
// contract (V519 via V522), switch gate, request validation, error codes, flight limit and deadline.
// Run: node scripts/data-group-member-matches-service-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const stubs = {
  currentUser: `
    export const requireCurrentUser = () => { if (!globalThis.__user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi thao tác dữ liệu.'); return globalThis.__user }
    export const requireCurrentUserCredentials = () => ({ username: 'fixture-user', password: 'fixture-password' })
    export const runWithCurrentUser = (_user, operation) => operation()`,
  supabaseClient: `
    function builder(table, calls) {
      const state = { table, filters: [] }
      const self = {
        select(columns) { state.columns = columns; return self },
        eq(column, value) { state.filters.push([column, value]); return self },
        abortSignal(signal) { state.signal = signal; return self },
        maybeSingle() { state.maybeSingle = true; return self },
        then(resolve, reject) { calls.push(state); return Promise.resolve(globalThis.__table(state)).then(resolve, reject) }
      }
      return self
    }
    export const getSupabaseClient = () => ({
      from: table => builder(table, globalThis.__calls),
      rpc: (name, params) => ({ abortSignal: signal => globalThis.__rpc(name, params, signal) })
    })`
}

const sample = valueCount => ({
  checkedAt: '2026-11-13T12:57:24Z', groupId: 31, contactType: 'phone', valueCount,
  items: [
    { index: 0, inGroup: true, otherGroupCount: 0, otherGroup: null },
    { index: 2, inGroup: false, otherGroupCount: 2, otherGroup: { id: 44, name: 'Khách đã mua', addedAt: '2026-11-01T03:00:00Z' } }
  ]
})

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-group-member-matches-'))
  try {
    const outfile = path.join(dir, 'service.cjs')
    await build({
      entryPoints: [path.resolve(__dirname, '../src/main/services/dataGroupMemberMatchesService.ts')], outfile,
      bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
      plugins: [{
        name: 'stubs',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /(^|\/)(currentUser|supabaseClient)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }))
          // Short deadline so the timeout case runs in a fraction of a second.
          pluginBuild.onLoad({ filter: /dataGroupMemberMatchesService\.ts$/ }, args => ({
            loader: 'ts', contents: fs.readFileSync(args.path, 'utf8').replace('DATA_GROUP_MATCHES_DEADLINE_MS = 20_000', 'DATA_GROUP_MATCHES_DEADLINE_MS = 300')
          }))
        }
      }]
    })
    const { handleDataGroupMemberMatchesRequest: call, DATA_GROUP_MATCHES_DEADLINE_MS } = require(outfile)
    assert.equal(DATA_GROUP_MATCHES_DEADLINE_MS, 300)
    let passed = 0
    const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }

    let setting = { value: '{"audience":"all","defaultDays":30,"maxDays":365}' }
    let settingError = null
    let rpcCalls = []
    let rpcImpl = async (_signal, params) => ({ data: sample(params.p_query.values.length), error: null })
    globalThis.__user = { staffId: 7, organizationId: 9, isAdminAkabiz: false }
    globalThis.__calls = []
    globalThis.__table = state => {
      assert.equal(state.table, 'auto_system_settings')
      assert.equal(state.columns, 'value')
      assert.deepEqual(state.filters, [['key', 'web.campaign_input_duplicates'], ['is_active', true], ['is_secret', false]])
      assert.equal(state.maybeSingle, true)
      return settingError ? { data: null, error: settingError } : { data: setting, error: null }
    }
    globalThis.__rpc = (name, params, signal) => { rpcCalls.push({ name, params }); return rpcImpl(signal, params) }
    const request = (extra = {}) => ({ contactType: 'phone', values: ['0912345678', '0987654321', '+84 912 000 004'], otherGroups: 'all', ...extra })
    const check = (extra = {}, groupId = 31) => call({ kind: 'check', groupId, request: request(extra) })

    assert.deepEqual(await call({ kind: 'setting' }), { ok: true, data: { enabled: true } })
    setting = null
    assert.deepEqual(await call({ kind: 'setting' }), { ok: true, data: { enabled: true } })
    setting = { value: '{"audience":"off"}' }
    assert.deepEqual(await call({ kind: 'setting' }), { ok: true, data: { enabled: true } })
    ok('setting: one row by key, active, not secret; missing row or missing groupMatches = on, whatever the campaign audience')
    setting = { value: '{"audience":"all","groupMatches":false}' }
    assert.deepEqual(await call({ kind: 'setting' }), { ok: true, data: { enabled: false } })
    settingError = { code: 'PGRST301', message: 'boom' }
    assert.deepEqual(await call({ kind: 'setting' }), { ok: true, data: { enabled: false } })
    settingError = null
    ok('setting: groupMatches=false or a read error = off (window imports as before V522)')

    setting = { value: '{"audience":"all","defaultDays":30,"maxDays":365}' }
    let result = await check()
    assert.equal(result.ok, true)
    assert.deepEqual(result.data.items.map(item => item.index), [0, 2])
    assert.equal(result.data.items[1].otherGroup.name, 'Khách đã mua')
    assert.equal(rpcCalls.length, 1)
    assert.equal(rpcCalls[0].name, 'aka_agent_read_data_group_member_matches')
    assert.deepEqual(rpcCalls[0].params, {
      p_staff_id: 7, p_organization_id: 9, p_auth_username: 'fixture-user', p_auth_password: 'fixture-password',
      p_query: { groupId: 31, contactType: 'phone', platform: 'zalo', values: ['0912345678', '0987654321', '+84 912 000 004'], otherGroups: 'all' }
    })
    ok('check: Desktop token + automation credentials, staff/org from session, values as sent (DB normalizes), platform zalo')
    rpcCalls = []
    await check({ contactType: 'group', values: ['https://zalo.me/g/abc123'], otherGroups: [44, 45, 44] })
    assert.deepEqual(rpcCalls[0].params.p_query, { groupId: 31, contactType: 'group', platform: 'zalo', values: ['https://zalo.me/g/abc123'], otherGroups: [44, 45] })
    rpcCalls = []
    await check({ contactType: 'person', values: ['2254071234567890123'], otherGroups: undefined })
    assert.equal(rpcCalls[0].params.p_query.otherGroups, 'none')
    ok('check: group links and UIDs, picked other groups de-duplicated, missing otherGroups = only this group')

    rpcCalls = []
    const long = 'x'.repeat(513)
    result = await check({ values: ['0912345678', long, '0987654321'] })
    assert.deepEqual(rpcCalls[0].params.p_query.values, ['0912345678', '', '0987654321'])
    assert.equal(result.ok, true)
    rpcCalls = []
    assert.deepEqual((await check({ values: [] })).data.items, [])
    result = await check({ values: ['  ', long] })
    assert.deepEqual({ valueCount: result.data.valueCount, items: result.data.items }, { valueCount: 2, items: [] })
    assert.ok(!Number.isNaN(Date.parse(result.data.checkedAt)))
    assert.equal(rpcCalls.length, 0)
    ok('check: over-long values blanked in place (positions kept); nothing to look up = empty result without an RPC')

    setting = { value: '{"audience":"all","groupMatches":false}' }; rpcCalls = []
    assert.deepEqual(await check(), { ok: false, code: 'data_group_matches_disabled', message: 'Đối chiếu với data đã có trong nhóm đang tắt.' })
    assert.equal(rpcCalls.length, 0)
    settingError = { code: 'PGRST301', message: 'boom' }
    assert.equal((await check()).code, 'data_group_matches_unavailable')
    assert.equal(rpcCalls.length, 0)
    settingError = null
    setting = { value: '{"audience":"all"}' }
    assert.equal((await check()).ok, true)
    ok('check: switch re-read every call; off refuses before any RPC; an unreadable switch is an error to retry, never a silent skip')

    rpcCalls = []
    assert.equal((await check({ contactType: 'email' })).code, 'invalid_data_group_matches_request')
    assert.equal((await check({ values: [1, 2] })).code, 'invalid_data_group_matches_request')
    assert.equal((await check({ otherGroups: Array.from({ length: 201 }, (_, i) => i + 1) })).code, 'invalid_data_group_matches_request')
    assert.equal((await check({ otherGroups: 'some' })).code, 'invalid_data_group_matches_request')
    assert.equal((await check({ values: Array.from({ length: 2001 }, (_, i) => `09${String(10000000 + i)}`) })).code, 'invalid_data_group_matches_request')
    for (const groupId of [0, -1, 1.5, '31', null]) assert.equal((await check({}, groupId)).code, 'invalid_data_group_matches_request')
    assert.equal(rpcCalls.length, 0)
    assert.equal((await check({ values: Array.from({ length: 2000 }, (_, i) => `09${String(10000000 + i)}`) })).ok, true)
    assert.equal(rpcCalls[0].params.p_query.values.length, 2000)
    ok('check: other list type, non-string values, >200 groups, >2,000 values (RPC limit), bad group id refused locally; exactly 2,000 sent')

    const errorCases = [
      [{ code: 'PGRST202', message: 'Could not find the function' }, 'data_group_matches_not_ready'],
      [{ code: '42883', message: 'function does not exist' }, 'data_group_matches_not_ready'],
      [{ code: '42501', message: 'permission denied for function aka_agent_read_data_group_member_matches' }, 'data_group_matches_not_ready'],
      [{ code: '42501', message: 'data_group_matches_group_denied' }, 'data_group_matches_group_denied'],
      [{ code: 'P0001', message: 'automation_auth_invalid' }, 'session_invalid'],
      [{ code: '42501', message: 'desktop_staff_scope_denied' }, 'session_invalid'],
      [{ code: '42501', message: 'data_group_matches_access_denied' }, 'data_group_matches_access_denied'],
      [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'data_group_matches_timeout'],
      [{ code: '22023', message: 'data_group_matches_invalid_values' }, 'invalid_data_group_matches_request'],
      [{ code: 'XX000', message: 'select * from secret' }, 'data_group_matches_unavailable']
    ]
    for (const [error, code] of errorCases) {
      rpcImpl = async () => ({ data: null, error })
      const response = await check()
      assert.equal(response.code, code, error.message)
      assert.doesNotMatch(response.message, /select|function|statement|data_group_matches/i)
    }
    ok('check: Postgres errors mapped to stable codes and Vietnamese messages without SQL (missing grant = not ready)')

    rpcImpl = async () => ({ data: { items: 'nope' }, error: null })
    assert.equal((await check()).code, 'data_group_matches_unavailable')
    rpcImpl = async () => ({ data: sample(99), error: null })
    assert.equal((await check()).code, 'data_group_matches_unavailable')
    ok('check: malformed RPC JSON or a value count that differs from the request = unavailable (never "no match")')

    const pending = []
    rpcImpl = () => new Promise(resolve => pending.push(resolve))
    const first = check()
    const second = check()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal((await check()).code, 'data_group_matches_busy')
    pending.forEach(resolve => resolve({ data: sample(3), error: null }))
    assert.equal((await first).ok, true); assert.equal((await second).ok, true)
    rpcImpl = async (_signal, params) => ({ data: sample(params.p_query.values.length), error: null })
    assert.equal((await check()).ok, true)
    ok('check: at most 2 RPCs in flight per process, the third is told busy (no queue); slots released afterwards')

    rpcImpl = signal => new Promise(resolve => signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'AbortError' } })))
    // AbortSignal.timeout uses an unref'd timer: keep this test process alive while waiting (Electron's main loop always is).
    const keepAlive = setInterval(() => {}, 1000)
    const started = Date.now()
    assert.equal((await check()).code, 'data_group_matches_timeout')
    assert.ok(Date.now() - started < 2000)
    clearInterval(keepAlive)
    rpcImpl = async (_signal, params) => ({ data: sample(params.p_query.values.length), error: null })
    assert.equal((await check()).ok, true)
    ok('check: deadline aborts the RPC and reports a timeout; the slot is released')

    globalThis.__user = null
    assert.equal((await check()).code, 'session_invalid')
    assert.equal((await call({ kind: 'setting' })).code, 'session_invalid')
    globalThis.__user = { staffId: 7, organizationId: 9, isAdminAkabiz: false }
    assert.equal((await call({ kind: 'nope' })).code, 'invalid_data_group_matches_request')
    ok('not logged in = session_invalid; unknown request kind refused')

    console.log(`data group member matches service: ${passed}/${passed} passed`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })
