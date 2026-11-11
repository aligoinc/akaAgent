// Smoke test of the Desktop "Lọc trùng dữ liệu" service (no DB): switch read, RPC contract (V491 via V493),
// switch gate, request validation, error codes, flight limit and deadline.
// Run: node scripts/campaign-input-duplicates-service-smoke.cjs
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

const sample = {
  checkedAt: '2026-11-10T16:30:00Z', since: '2026-10-11T17:00:00Z', days: 30, accountCount: 2, phoneCount: 3,
  items: [{ phone: '0912345678', matchCount: 2, campaignCount: 2, latest: {
    campaignId: 77, campaignName: 'Khách cũ tháng 10', campaignDeleted: false, accountId: 12, accountName: 'Zalo Bán hàng',
    uploadedAt: '2026-11-07T03:15:00Z', status: 'hoàn thành', processed: true
  } }]
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-input-duplicates-'))
  try {
    const outfile = path.join(dir, 'service.cjs')
    await build({
      entryPoints: [path.resolve(__dirname, '../src/main/services/campaignInputDuplicatesService.ts')], outfile,
      bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
      plugins: [{
        name: 'stubs',
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /(^|\/)(currentUser|supabaseClient)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
          pluginBuild.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js' }))
          // Short deadline so the timeout case runs in a fraction of a second.
          pluginBuild.onLoad({ filter: /campaignInputDuplicatesService\.ts$/ }, args => ({
            loader: 'ts', contents: fs.readFileSync(args.path, 'utf8').replace('INPUT_DUPLICATES_DEADLINE_MS = 25_000', 'INPUT_DUPLICATES_DEADLINE_MS = 300')
          }))
        }
      }]
    })
    const { handleCampaignInputDuplicatesRequest: call, INPUT_DUPLICATES_DEADLINE_MS } = require(outfile)
    assert.equal(INPUT_DUPLICATES_DEADLINE_MS, 300)
    let passed = 0
    const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }

    let setting = { value: '{"audience":"all","defaultDays":30,"maxDays":365}' }
    let settingError = null
    let rpcCalls = []
    let rpcImpl = async () => ({ data: sample, error: null })
    globalThis.__user = { staffId: 7, organizationId: 9, isAdminAkabiz: false }
    globalThis.__calls = []
    globalThis.__table = state => {
      assert.equal(state.table, 'auto_system_settings')
      assert.equal(state.columns, 'value')
      assert.deepEqual(state.filters, [['key', 'web.campaign_input_duplicates'], ['is_active', true], ['is_secret', false]])
      assert.equal(state.maybeSingle, true)
      return settingError ? { data: null, error: settingError } : { data: setting, error: null }
    }
    globalThis.__rpc = (name, params, signal) => { rpcCalls.push({ name, params }); return rpcImpl(signal) }
    const request = (extra = {}) => ({ actionId: 'zalo_message_phone', accountIds: [11, 12], days: 30, phones: ['0912345678', '0987654321', '0912345678'], ...extra })

    assert.deepEqual(await call({ kind: 'setting' }), { ok: true, data: { audience: 'all', defaultDays: 30, maxDays: 365 } })
    ok('setting: one row by key, active, not secret')
    settingError = { code: 'PGRST301', message: 'boom' }
    assert.deepEqual(await call({ kind: 'setting' }), { ok: true, data: { audience: 'off', defaultDays: 30, maxDays: 365 } })
    settingError = null; setting = null
    assert.deepEqual(await call({ kind: 'setting' }), { ok: true, data: { audience: 'off', defaultDays: 30, maxDays: 365 } })
    setting = { value: 'not json' }
    assert.equal((await call({ kind: 'setting' })).data.audience, 'off')
    ok('setting: read error, missing row or bad JSON = off (options hidden)')

    setting = { value: '{"audience":"all","defaultDays":30,"maxDays":365}' }
    let result = await call({ kind: 'check', request: request({ excludeCampaignId: 110 }) })
    assert.equal(result.ok, true)
    assert.deepEqual(result.data.items.map(item => item.phone), ['0912345678'])
    assert.equal(rpcCalls.length, 1)
    assert.equal(rpcCalls[0].name, 'aka_agent_read_campaign_input_duplicates')
    assert.deepEqual(rpcCalls[0].params, {
      p_staff_id: 7, p_organization_id: 9, p_auth_username: 'fixture-user', p_auth_password: 'fixture-password',
      p_query: { actionId: 'zalo_message_phone', accountIds: [11, 12], days: 30, phones: ['0912345678', '0987654321', '0912345678'], excludeCampaignId: 110 }
    })
    ok('check: Desktop token + automation credentials, staff/org from session, phones as sent (DB normalizes), excludeCampaignId sent')
    rpcCalls = []
    await call({ kind: 'check', request: request({ excludeCampaignId: null }) })
    assert.equal('excludeCampaignId' in rpcCalls[0].params.p_query, false)
    ok('check: no excludeCampaignId when the form creates a campaign')

    setting = { value: '{"audience":"off","defaultDays":30,"maxDays":365}' }; rpcCalls = []
    assert.deepEqual(await call({ kind: 'check', request: request() }), { ok: false, code: 'input_duplicates_disabled',
      message: 'Lọc trùng với chiến dịch khác chưa mở cho tài khoản này. Vui lòng chọn "Chỉ trong file này".' })
    setting = { value: '{"audience":"admin_akabiz","defaultDays":30,"maxDays":365}' }
    assert.equal((await call({ kind: 'check', request: request() })).code, 'input_duplicates_disabled')
    assert.equal(rpcCalls.length, 0)
    globalThis.__user = { staffId: 7, organizationId: 9, isAdminAkabiz: true }
    assert.equal((await call({ kind: 'check', request: request() })).ok, true)
    globalThis.__user = { staffId: 7, organizationId: 9, isAdminAkabiz: false }
    ok('check: switch re-read every call; off / admin_akabiz for a non-admin refuse before any RPC, admin passes')

    setting = { value: '{"audience":"all","defaultDays":30,"maxDays":60}' }; rpcCalls = []
    assert.equal((await call({ kind: 'check', request: request({ days: 90 }) })).code, 'invalid_input_duplicates_request')
    assert.equal((await call({ kind: 'check', request: request({ accountIds: [] }) })).code, 'invalid_input_duplicates_request')
    assert.equal((await call({ kind: 'check', request: request({ actionId: 'zalo_message_friend' }) })).code, 'invalid_input_duplicates_request')
    assert.equal((await call({ kind: 'check', request: request({ phones: Array.from({ length: 1001 }, (_, i) => `09${String(10000000 + i)}`) }) })).code, 'invalid_input_duplicates_request')
    assert.equal(rpcCalls.length, 0)
    assert.equal((await call({ kind: 'check', request: request({ phones: Array.from({ length: 1000 }, (_, i) => `09${String(10000000 + i)}`) }) })).ok, true)
    assert.equal(rpcCalls.length, 1)
    assert.equal(rpcCalls[0].params.p_query.phones.length, 1000)
    ok('check: days above the switch maxDays, no account, other campaign type, >1,000 phones refused locally; exactly 1,000 sent')

    setting = { value: '{"audience":"all","defaultDays":30,"maxDays":365}' }
    const errorCases = [
      [{ code: 'PGRST202', message: 'Could not find the function' }, 'input_duplicates_not_ready'],
      [{ code: '42883', message: 'function does not exist' }, 'input_duplicates_not_ready'],
      [{ code: '42501', message: 'permission denied for function aka_agent_read_campaign_input_duplicates' }, 'input_duplicates_not_ready'],
      [{ code: '42501', message: 'input_duplicates_account_scope_denied' }, 'input_duplicates_account_denied'],
      [{ code: 'P0001', message: 'automation_auth_invalid' }, 'session_invalid'],
      [{ code: '42501', message: 'desktop_staff_scope_denied' }, 'input_duplicates_access_denied'],
      [{ code: '57014', message: 'canceling statement due to statement timeout' }, 'input_duplicates_timeout'],
      [{ code: '22023', message: 'input_duplicates_invalid_days' }, 'invalid_input_duplicates_request'],
      [{ code: 'XX000', message: 'select * from secret' }, 'input_duplicates_unavailable']
    ]
    for (const [error, code] of errorCases) {
      rpcImpl = async () => ({ data: null, error })
      const response = await call({ kind: 'check', request: request() })
      assert.equal(response.code, code, error.message)
      assert.doesNotMatch(response.message, /select|function|statement/i)
    }
    ok('check: Postgres errors mapped to stable codes and Vietnamese messages without SQL')

    rpcImpl = async () => ({ data: { items: 'nope' }, error: null })
    assert.equal((await call({ kind: 'check', request: request() })).code, 'input_duplicates_unavailable')
    ok('check: malformed RPC JSON = unavailable')

    const pending = []
    rpcImpl = () => new Promise(resolve => pending.push(resolve))
    const first = call({ kind: 'check', request: request() })
    const second = call({ kind: 'check', request: request() })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal((await call({ kind: 'check', request: request() })).code, 'input_duplicates_busy')
    pending.forEach(resolve => resolve({ data: sample, error: null }))
    assert.equal((await first).ok, true); assert.equal((await second).ok, true)
    rpcImpl = async () => ({ data: sample, error: null })
    assert.equal((await call({ kind: 'check', request: request() })).ok, true)
    ok('check: at most 2 RPCs in flight per process, the third is told busy (no queue); slots released afterwards')

    rpcImpl = signal => new Promise(resolve => signal.addEventListener('abort', () => resolve({ data: null, error: { message: 'AbortError' } })))
    // AbortSignal.timeout uses an unref'd timer: keep this test process alive while waiting (Electron's main loop always is).
    const keepAlive = setInterval(() => {}, 1000)
    const started = Date.now()
    assert.equal((await call({ kind: 'check', request: request() })).code, 'input_duplicates_timeout')
    assert.ok(Date.now() - started < 2000)
    clearInterval(keepAlive)
    rpcImpl = async () => ({ data: sample, error: null })
    assert.equal((await call({ kind: 'check', request: request() })).ok, true)
    ok('check: deadline aborts the RPC and reports a timeout; the slot is released')

    globalThis.__user = null
    assert.equal((await call({ kind: 'check', request: request() })).code, 'session_invalid')
    assert.equal((await call({ kind: 'setting' })).code, 'session_invalid')
    globalThis.__user = { staffId: 7, organizationId: 9, isAdminAkabiz: false }
    assert.equal((await call({ kind: 'nope' })).code, 'invalid_input_duplicates_request')
    ok('not logged in = session_invalid; unknown request kind refused')

    console.log(`campaign input duplicates service: ${passed}/${passed} passed`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })
