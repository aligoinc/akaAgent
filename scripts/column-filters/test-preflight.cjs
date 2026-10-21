// Real local HTTP through supabase-js, the IPC handler, account repository and
// read coordinator. Shortened test-only budgets; no production traffic or DB.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const { EventEmitter } = require('node:events'), assert = require('node:assert/strict')
const ts = require('typescript'), { createClient } = require('@supabase/supabase-js')
const root = path.resolve(__dirname, '../..'), cache = new Map(), handlers = new Map()
let client, rpcCalls = 0, maxActive = 0
const active = new Set(), requests = [], blocked = new Set(), passed = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate) {
  const end = Date.now() + 3000
  while (!predicate()) { assert.ok(Date.now() < end, 'local fixture condition timed out'); await sleep(5) }
}
function load(relative) {
  const filename = path.resolve(root, relative)
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }; cache.set(filename, mod)
  const requireLocal = id => {
    if (id === 'electron') return { ipcMain: { handle: (key, fn) => handlers.set(key, fn) } }
    if (id.endsWith('/supabaseClient')) return { getSupabaseClient: () => client }
    if (id.endsWith('/accountLogService')) return { rememberAccountLogSnapshot: account => account }
    if (id.endsWith('/accountOperationRegistry') || id === './accountGroupRepository' || id === './proxyRepository') return {}
    if (id.endsWith('/repositories/dataGroupRepository')) return { mapDataGroupMember: row => row }
    if (id.endsWith('/repositories/localAccountContactRepository')) return { listFilteredPageInboxContacts: async () => ({ contacts: [], total: 0 }) }
    if (!id.startsWith('.')) return require(id)
    return load(path.relative(root, path.resolve(path.dirname(filename), id + '.ts')))
  }
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true
  } }).outputText
  new Function('require', 'module', 'exports', js)(requireLocal, mod, mod.exports)
  return mod.exports
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  res.setHeader('content-type', 'application/json')
  if (url.pathname === '/rest/v1/auto_accounts') {
    const id = Number(url.searchParams.get('id').replace('eq.', ''))
    assert.equal(url.searchParams.get('staff_id'), 'eq.10')
    requests.push(id); active.add(res); maxActive = Math.max(maxActive, active.size)
    res.once('close', () => active.delete(res))
    if (blocked.has(id)) return // Do not send headers; AbortSignal must close the HTTP read.
    return res.end(JSON.stringify(id === 99 ? [] : [{ id, staff_id: 10, organization_id: 1,
      name: 'Fixture', flatform_type: 'facebook', is_delete: false }]))
  }
  if (url.pathname.startsWith('/rest/v1/rpc/aka_agent_read_filtered_')) {
    rpcCalls++; req.resume()
    return res.end(JSON.stringify({ version: 1, rows: [], total: 0, hasMore: false, after: null }))
  }
  res.writeHead(404); res.end('{}')
})
;(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  client = createClient(url, 'local-fixture', { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, options) => { assert.ok(String(input).startsWith(url + '/')); return fetch(input, options) } } })
  const policy = load('src/main/data/filters/filterReadCoordinator.ts').FILTER_READ_POLICY
  assert.equal(policy.deadlineMs, 65000); assert.equal(policy.serverBudgetMs, 60000)
  policy.deadlineMs = 450; policy.serverBudgetMs = 140 // Only this isolated module instance.
  const auth = load('src/main/data/currentUser.ts')
  const service = load('src/main/data/filters/dataColumnReadService.ts')
  const accounts = load('src/main/data/repositories/accountRepository.ts')
  const ipc = load('src/main/ipc/handlers/accountContactHandlers.ts')
  const events = load('src/shared/types.ts').IPC_EVENTS
  const login = () => {
    auth.setCurrentUser({ staffId: 10, organizationId: 1, entitlements: { facebookCore: true, facebookFanpage: true, zalo: true } })
    auth.setCurrentUserCredentials({ username: 'owner', password: 'fixture' })
  }
  login()
  ipc.registerAccountContactHandlers({ getAccount: accounts.getAccount }, {})
  const sender = Object.assign(new EventEmitter(), { id: 123 })
  const read = (id, formId, source = 'contacts') => handlers.get(events.DATA_COLUMN_FILTER_READ)({ sender }, {
    source, accountId: id, formId, requestId: formId + '-request', query: { contactType: 'person', columnFilters: { version: 1, filters: [] } }
  })
  try {
    for (const source of ['contacts', 'upload', 'group_members', 'remarketing', 'page_inbox']) {
      const before = requests.length
      assert.equal((await read(10, 'normal-' + source, source)).total, 0)
      assert.equal(requests.length, before + 1)
    }
    passed.push('all scan sources retain account/capability preflight through IPC')
    const beforeDenied = rpcCalls
    await assert.rejects(read(99, 'missing'), /Tài khoản không tồn tại/)
    auth.setCurrentUser({ staffId: 10, organizationId: 1, entitlements: {} })
    await assert.rejects(read(10, 'no-capability'), /Tài khoản không tồn tại/)
    assert.equal(rpcCalls, beforeDenied); login()
    passed.push('missing account and missing capability never dispatch filtered RPC')

    blocked.add(1); blocked.add(2)
    const beforeTimeout = rpcCalls
    const one = read(1, 'timeout-one').catch(error => error.message)
    const two = read(2, 'timeout-two').catch(error => error.message)
    await until(() => active.size === 2)
    assert.ok((await Promise.all([one, two])).every(message => message.includes('thời gian')))
    await until(() => active.size === 0)
    assert.equal(rpcCalls, beforeTimeout)
    passed.push('both preflight HTTP reads close on the overall deadline; no RPC follows')
    const beforeRecovery = requests.length, recoveryStart = Date.now()
    const recovery = read(10, 'recovery')
    await sleep(25); assert.equal(requests.length, beforeRecovery)
    assert.equal((await recovery).total, 0)
    assert.ok(Date.now() - recoveryStart >= 80)
    passed.push('slots retain the uncertain server budget, then queued reads recover')

    blocked.add(3)
    const beforeCancel = rpcCalls
    const cancelled = read(3, 'cancelled').catch(error => error.message)
    await until(() => active.size === 1)
    service.cancelColumnRead(String(sender.id), 'cancelled', 'cancelled-request')
    assert.match(await cancelled, /hủy/)
    await until(() => active.size === 0)
    assert.equal(rpcCalls, beforeCancel)
    passed.push('form cancellation closes account HTTP and prevents the filtered read')
    await sleep(policy.serverBudgetMs + 20)

    blocked.add(4)
    const oldSession = read(4, 'old-session').catch(error => error.message)
    await until(() => active.size === 1)
    auth.setCurrentUserCredentials({ username: 'owner', password: 'new-fixture' })
    assert.match(await oldSession, /Phiên/)
    await until(() => active.size === 0)
    assert.equal(rpcCalls, beforeCancel)
    await sleep(policy.serverBudgetMs + 20)
    assert.equal((await read(10, 'new-session')).total, 0)
    passed.push('session changes close old preflight without authorizing a stale read')
    assert.ok(maxActive <= 2)
    passed.push('real HTTP concurrency never exceeds two account reads')
    const result = { checks: passed.length, passed, maxActiveAccountReads: maxActive,
      fixture: 'localhost HTTP; deadline 450ms / uncertain budget 140ms only in test', production_changed: false }
    fs.writeFileSync(path.join(__dirname, 'preflight-results.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result, null, 2))
  } finally {
    service.cancelColumnRead(String(sender.id))
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { console.error(error); server.closeAllConnections(); server.close(); process.exitCode = 1 })
