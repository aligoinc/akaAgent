// Real discovery, session verification, restorer and manager; no production I/O.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }

function fixture() {
  const user = { staffId: 890, organizationId: 865, isChatSync: false }
  const state = { rows: [], queries: [], claims: [], released: [], logs: [], events: [], held: new Set(),
    running: true, capability: true, now: 0, logins: 0, verifications: 0, error: null, loginWait: null,
    claimWait: null, claimDenied: false, keepClaim: false, beforeClaim: null, reads: 0,
    profiles: [], writes: [], profileError: null, writeError: null, beforeProfile: null }
  const auth = { requireCurrentUser: () => user, getCurrentUser: () => user, runWithCurrentUser: (_user, fn) => fn() }
  const registry = { has: id => state.held.has(id), stop() {}, waitForProducers: async () => true, recover: async () => state.held.clear() }
  function load(relative, overrides = {}) {
    const file = path.join(root, relative)
    const exports = {}
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    const fallback = new Proxy({}, { get: (_, key) => key === 'IPC_EVENTS'
      ? new Proxy({}, { get: (_, name) => name }) : class {} })
    vm.runInNewContext(code, { exports, Error, Buffer, URL, AbortController, setTimeout, clearTimeout,
      setInterval, clearInterval, queueMicrotask,
      console: { log: (...args) => state.logs.push(args), warn: (...args) => state.logs.push(args), error: (...args) => state.logs.push(args) },
      require: id => id.endsWith('/accountLogService')
        ? new Proxy({ recordAccountState: account => account, rememberAccountLogSnapshot: account => account }, { get: (obj, key) => obj[key] || (() => {}) })
        : overrides[id] || (id.startsWith('node:') || id === 'crypto' ? require(id) : fallback)
    }, { filename: file })
    return exports
  }
  const db = { from(table) {
    assert.equal(table, 'auto_accounts')
    const query = { filters: [], select: null, limit: null }
    state.queries.push(query)
    const builder = {
      select(value) { query.select = value; return this },
      eq(key, value) { query.filters.push(row => row[key] === value); return this },
      is(key, value) { query.filters.push(row => row[key] === value); return this },
      not(key, operator, value) { assert.equal(operator, 'is'); query.filters.push(row => row[key] !== value); return this },
      gt(key, value) { query.filters.push(row => row[key] > value); return this },
      order(key, options) { assert.equal(key, 'id'); assert.equal(options.ascending, true); return this },
      limit(value) { query.limit = value; return this },
      update(value) { query.update = value; return this },
      single() { query.single = true; return this },
      maybeSingle() { query.single = true; return this },
      then(resolve, reject) {
        let rows = state.rows.filter(row => query.filters.every(test => test(row))).sort((a, b) => a.id - b.id)
        if (query.limit !== null) rows = rows.slice(0, query.limit)
        if (query.update) {
          state.writes.push(query.update)
          if (state.writeError) return Promise.resolve({ data: null, error: state.writeError }).then(resolve, reject)
          if (!rows.length) return Promise.resolve({ data: null, error: { message: 'No matching account' } }).then(resolve, reject)
          rows.forEach(row => Object.assign(row, query.update))
        }
        const data = rows.map(row => query.select === 'id, zalo_session_updated_at'
          ? { id: row.id, zalo_session_updated_at: row.zalo_session_updated_at } : { ...row })
        return Promise.resolve({ data: query.single ? data[0] ?? null : data, error: null }).then(resolve, reject)
      }
    }
    return builder
  } }
  const repo = load('src/main/data/repositories/accountRepository.ts', {
    '../currentUser': auth, '../supabaseClient': { getSupabaseClient: () => db },
    '../mappers': { mapAccountFromDB: row => account(row) },
    './entitlementRepository': { loadCurrentUserZaloAccountCapabilities: () => ({ server: state.capability }),
      ensureCurrentUserFeatureActive: async () => {}, ensureCurrentUserCanUseZaloAccountType: async () => {},
      loadCurrentUserEffectiveEntitlements: async () => ({}), canUseAccountWithEntitlementsAndCapabilities: () => true }
  })
  function add(id = 4224, overrides = {}) {
    const row = { id, staff_id: 890, organization_id: 865, is_active: true, is_delete: false,
      flatform_type: 'zalo', is_zalo_show_web: false, is_zalo_server: true,
      status: 'chờ xử lý', login_status: 'chưa đăng nhập', zalo_session_updated_at: '2026-09-18T07:23:00Z',
      zalo_session_last_verified_at: null, zalo_session_last_error: null, zalo_account_id: null,
      zalo_session: { cookie: [{ value: 'TEST_SESSION_SECRET' }], imei: 'test-imei', userAgent: 'test-agent' }, ...overrides }
    state.rows.push(row)
    return row
  }
  const account = row => row && ({ id: row.id, staffId: row.staff_id, organizationId: row.organization_id,
    isActive: row.is_active, isDelete: row.is_delete, flatformType: row.flatform_type,
    isZaloShowWeb: row.is_zalo_show_web, isZaloServer: row.is_zalo_server,
    loginStatus: row.login_status, status: row.status, zaloSessionUpdatedAt: row.zalo_session_updated_at,
    zaloSessionLastVerifiedAt: row.zalo_session_last_verified_at, zaloSessionLastError: row.zalo_session_last_error,
    zaloAccountId: row.zalo_account_id })
  const find = id => state.rows.find(row => row.id === id)
  const supabase = {
    listPendingZaloServerSessions: repo.listPendingZaloServerSessions,
    listZaloAccountsWithSession: async () => state.rows.filter(row => row.zalo_session).map(row => ({ account: account(row), session: row.zalo_session })),
    updateAccountZaloSession: repo.updateAccountZaloSession,
    async upsertZaloAccount(profile) {
      if (state.beforeProfile) await state.beforeProfile()
      if (state.profileError) throw state.profileError
      state.profiles.push(profile)
      return { id: 9001, ...profile }
    },
    getAccount: async id => account(find(id)),
    getAccountZaloSession: async id => { state.reads++; const row = find(id); return row && {
      account: account(row), session: row.zalo_session?.imei ? row.zalo_session : null
    } },
    async markAccountZaloSessionCheck(id, result, showWeb) {
      assert.equal(showWeb, false)
      const row = find(id)
      row.login_status = result.ok ? 'đã đăng nhập' : 'chưa đăng nhập'
      row.zalo_session_last_error = result.ok ? null : result.error
      if (result.ok) row.zalo_session_last_verified_at = '2026-09-18T08:00:00Z'
      return account(row)
    },
    async claimZaloAccountRuntimeOperation(id, target, requiresLogin, name) {
      state.claims.push({ id, target, requiresLogin, name })
      assert.equal(target, 'server'); assert.equal(requiresLogin, false)
      if (state.claimWait) await state.claimWait.promise
      if (state.beforeClaim) state.beforeClaim(find(id))
      if (state.claimDenied) return { claimed: false, reason: 'runtime_not_owner' }
      state.held.add(id)
      const row = find(id), previousStatus = row.status
      row.status = 'đang chạy'
      return { claimed: true, previousStatus, claimToken: `token-${id}`, staffId: 890 }
    },
    async releaseZaloAccountRuntimeOperation(id, target, previousStatus, staffId, token) {
      assert.equal(target, 'server'); assert.equal(staffId, 890); assert.equal(token, `token-${id}`)
      state.released.push(id)
      if (state.keepClaim) return false
      state.held.delete(id)
      if (find(id).status === 'đang chạy') find(id).status = previousStatus
      return true
    },
    recoverServerZaloRunningState: async () => state.held.clear(),
    recoverCampaignRuntimeUnitLeasesV2: async () => ({ ok: true })
  }
  class ZaloApiError extends Error {}
  const api = {
    async fetchAccountInfo() { state.verifications++; return { profile: {
      userId: 'test-user', displayName: 'Test Zalo', phoneNumber: '0900000000', avatar: 'https://example.com/avatar.jpg'
    } } },
    getOwnId: () => 'test-user',
    getContext: () => ({ cookie: { toJSON: () => ({ cookies: [{ value: 'ROTATED_TEST_SESSION_SECRET' }] }) }, imei: 'test-imei', userAgent: 'test-agent' })
  }
  class Zalo {
    async login(session) {
      assert.ok(session.imei); state.logins++
      if (state.loginWait) await state.loginWait.promise
      if (state.error) throw state.error
      return api
    }
  }
  const { ZaloRuntimeService } = load('src/main/services/zaloRuntimeService.ts', {
    'zca-js': { Zalo, ZaloApiError },
    './zaloWebRuntimeService': { ZaloWebRuntimeService: class { invalidateApi() {} clearAll() {} } }
  })
  const zaloRuntime = new ZaloRuntimeService(supabase, async () => null, () => { throw new Error('Must not start QR') })
  const { CampaignScheduler } = load('src/main/services/campaignScheduler.ts', {
    './accountOperationRegistry': { accountOperationRegistry: registry }
  })
  const scheduler = Object.assign(Object.create(CampaignScheduler.prototype), {
    activeAccountRuns: new Map(), externalAccountRuns: new Map(), failedCampaignRuns: new Map(),
    stop() {}, blockZaloRuntimeForRestart() {}, stopAcceptingNewZaloWork() {}, waitForIdle: async () => true
  })
  const { ZaloServerSessionRestorer } = load('src/server/main/zaloServerSessionRestorer.ts', {
    '../../main/services/accountOperationRegistry': { accountOperationRegistry: registry }
  })
  const restorer = new ZaloServerSessionRestorer({ supabase, scheduler, zaloRuntime,
    isRunning: () => state.running, onStatusUpdated: () => state.events.push('ACCOUNT_STATUS_UPDATED'), now: () => state.now })
  return { state, add, repo, user, supabase, zaloRuntime, restorer, scheduler, api, load, auth, registry, ZaloServerSessionRestorer }
}

let passed = 0
async function test(name, run) { await run(); passed++; console.log('PASS ' + name) }
async function main() {
  await test('discovery is paginated, tenant scoped and never reads credentials', async () => {
    const f = fixture()
    for (let id = 1; id <= 1001; id++) f.add(id)
    const excluded = [{ staff_id: 2 }, { organization_id: 2 }, { is_active: false }, { is_delete: true },
      { is_zalo_server: false }, { is_zalo_show_web: true }, { flatform_type: 'facebook' },
      { zalo_session: null }, { zalo_session_last_verified_at: '2026-09-18T09:00:00Z' }]
    excluded.forEach((row, index) => f.add(2000 + index, row))
    const result = await f.repo.listPendingZaloServerSessions()
    assert.equal(result.length, 1001); assert.equal(result.at(-1).accountId, 1001)
    assert.equal(f.state.queries.length, 2)
    assert.ok(f.state.queries.every(query => query.select === 'id, zalo_session_updated_at'))
    f.user.isChatSync = true; assert.equal((await f.repo.listPendingZaloServerSessions()).length, 0)
    f.user.isChatSync = false; f.state.capability = false
    assert.equal((await f.repo.listPendingZaloServerSessions()).length, 0)
  })
  await test('a session imported after startup automatically logs in and caches the usable API', async () => {
    const f = fixture(); await f.restorer.run()
    const row = f.add(); await f.restorer.run()
    assert.equal(row.login_status, 'đã đăng nhập'); assert.ok(row.zalo_session_last_verified_at)
    assert.equal(row.status, 'chờ xử lý'); assert.equal(f.state.logins, 1); assert.equal(f.state.verifications, 1)
    assert.equal(row.zalo_account_id, 9001)
    assert.equal(f.state.profiles[0].zaloUid, 'test-user')
    assert.equal(f.state.profiles[0].displayName, 'Test Zalo')
    assert.equal(f.state.profiles[0].phone, '0900000000')
    assert.equal(f.state.profiles[0].avatarUrl, 'https://example.com/avatar.jpg')
    assert.equal(row.zalo_session.cookie[0].value, 'ROTATED_TEST_SESSION_SECRET')
    assert.equal(f.state.writes.length, 1, 'link, credentials and verified status are one account write')
    assert.equal(f.state.writes[0].zalo_account_id, 9001)
    assert.ok(f.state.writes[0].zalo_session_last_verified_at)
    assert.equal(await f.zaloRuntime.ensureApi(row.id), f.api); assert.equal(f.state.logins, 1)
    await f.restorer.run(); assert.equal(f.state.claims.length, 1)
    assert.deepEqual(f.state.events, ['ACCOUNT_STATUS_UPDATED'])
    assert.equal(f.scheduler.externalAccountRuns.size, 0)
    assert.equal(JSON.stringify([f.state.logs, f.state.events]).includes('TEST_SESSION_SECRET'), false)
  })
  await test('missing session is left logged out; malformed credentials require login without QR side effects', async () => {
    const f = fixture(), missing = f.add(1, { zalo_session: null, zalo_session_updated_at: null }), broken = f.add(2, { zalo_session: {} })
    await f.restorer.run(); f.state.now += 3600000; await f.restorer.run()
    assert.equal(f.state.logins, 0); assert.equal(f.state.claims.length, 1)
    assert.equal(missing.login_status, 'chưa đăng nhập'); assert.equal(broken.login_status, 'chưa đăng nhập')
    assert.equal(broken.zalo_session_last_error, 'Chưa có session Zalo')
  })
  await test('expired session is retained and not repeatedly retried; replacement is picked up', async () => {
    const f = fixture(), row = f.add(), original = row.zalo_session
    f.state.error = new Error('session expired'); await f.restorer.run()
    assert.equal(row.login_status, 'chưa đăng nhập'); assert.equal(row.zalo_session, original)
    assert.equal(row.zalo_session_last_verified_at, null); assert.equal(f.state.logins, 2)
    f.state.now += 3600000; await f.restorer.run(); assert.equal(f.state.logins, 2)
    row.zalo_session_updated_at = '2026-09-18T09:00:00Z'; f.state.error = null
    await f.restorer.run(); assert.equal(row.login_status, 'đã đăng nhập'); assert.equal(f.state.logins, 3)
  })
  await test('network errors retain credentials and retry with backoff', async () => {
    const f = fixture(), row = f.add(), original = row.zalo_session
    f.state.error = new Error('network timeout'); await f.restorer.run()
    assert.equal(row.zalo_session, original); assert.equal(row.login_status, 'chưa đăng nhập')
    f.state.now = 59999; await f.restorer.run(); assert.equal(f.state.logins, 2)
    f.state.now = 60000; await f.restorer.run(); assert.equal(f.state.logins, 4)
    f.state.now = 179999; await f.restorer.run(); assert.equal(f.state.logins, 4)
    f.state.now = 180000; f.state.error = null; await f.restorer.run()
    assert.equal(row.login_status, 'đã đăng nhập'); assert.equal(f.state.logins, 5)
  })
  for (const failure of ['profileError', 'writeError']) await test(`${failure} keeps import pending and retries without another Zalo login`, async () => {
    const f = fixture(), row = f.add(), original = row.zalo_session
    f.state[failure] = new Error('temporary DB failure TEST_SESSION_SECRET')
    await f.restorer.run()
    assert.equal(row.zalo_account_id, null); assert.equal(row.zalo_session_last_verified_at, null)
    assert.equal(row.login_status, 'chưa đăng nhập'); assert.equal(row.zalo_session, original)
    assert.equal(f.state.released.length, 1); assert.equal(f.state.logins, 1)
    f.state.now = 59999; await f.restorer.run(); assert.equal(f.state.claims.length, 1)
    f.state.now = 60000; f.state[failure] = null; await f.restorer.run()
    assert.equal(row.zalo_account_id, 9001); assert.ok(row.zalo_session_last_verified_at)
    assert.equal(row.login_status, 'đã đăng nhập'); assert.equal(f.state.logins, 1)
    assert.equal(JSON.stringify([f.state.logs, f.state.events]).includes('TEST_SESSION_SECRET'), false)
  })
  for (const [name, change] of Object.entries({
    'newer QR session': row => { row.zalo_session_updated_at = '2026-09-18T10:00:00Z'; row.zalo_account_id = 9002; row.zalo_session = { imei: 'replacement' } },
    'already verified': row => { row.zalo_session_last_verified_at = '2026-09-18T10:00:00Z' },
    'logged out': row => { row.zalo_session_updated_at = null; row.zalo_session = null },
    'disabled': row => { row.is_active = false },
    'moved to Desktop': row => { row.is_zalo_server = false },
    'deleted': row => { row.is_delete = true }
  })) await test(`account write protects concurrent change during profile persistence: ${name}`, async () => {
    const f = fixture(), row = f.add(); let expected
    f.state.beforeProfile = () => { change(row); expected = { ...row } }
    await f.restorer.run()
    assert.equal(row.zalo_account_id, expected.zalo_account_id)
    assert.equal(row.zalo_session, expected.zalo_session)
    assert.equal(row.zalo_session_updated_at, expected.zalo_session_updated_at)
    assert.equal(row.zalo_session_last_verified_at, expected.zalo_session_last_verified_at)
    assert.equal(row.login_status, 'chưa đăng nhập'); assert.equal(f.state.released.length, 1)
  })
  await test('unversioned legacy session can finalize its identity with a null timestamp guard', async () => {
    const f = fixture(), row = f.add(1, { zalo_session_updated_at: null, zalo_account_id: 8999 })
    await f.restorer.run()
    assert.equal(row.zalo_account_id, 9001); assert.ok(row.zalo_session_last_verified_at)
  })
  await test('unversioned session cleared during verification is not restored', async () => {
    const f = fixture(), row = f.add(1, { zalo_session_updated_at: null })
    f.state.beforeProfile = () => { row.zalo_session = null }
    await f.restorer.run()
    assert.equal(row.zalo_session, null); assert.equal(row.zalo_account_id, null)
    assert.equal(row.zalo_session_last_verified_at, null); assert.equal(row.login_status, 'chưa đăng nhập')
  })
  await test('server startup also finalizes pending identity before marking verified', async () => {
    const f = fixture(), row = f.add()
    await f.zaloRuntime.warmStoredSessions('server')
    assert.equal(row.zalo_account_id, 9001); assert.equal(row.login_status, 'đã đăng nhập')
    assert.ok(row.zalo_session_last_verified_at); assert.equal(f.state.verifications, 1)
    assert.equal(f.state.released.length, 1); assert.equal(f.state.claims[0].name, 'zalo.session.warm')
    await f.restorer.run(); assert.equal(f.state.claims.length, 1)
    assert.equal(await f.zaloRuntime.ensureApi(row.id), f.api); assert.equal(f.state.logins, 1)
  })
  await test('failed startup persistence leaves the account eligible for background retry', async () => {
    const f = fixture(), row = f.add(); f.state.profileError = new Error('DB unavailable')
    await f.zaloRuntime.warmStoredSessions('server')
    assert.equal(row.zalo_session_last_verified_at, null); assert.equal(row.zalo_account_id, null)
    assert.equal(f.state.released.length, 1)
    f.state.profileError = null; await f.restorer.run()
    assert.equal(row.zalo_account_id, 9001); assert.equal(row.login_status, 'đã đăng nhập')
  })
  await test('campaign/QR reservations and DB ownership refusal defer the account without logging in', async () => {
    const f = fixture(), row = f.add()
    f.scheduler.activeAccountRuns.set(row.id, {})
    await f.restorer.run(); assert.equal(f.state.claims.length, 0)
    f.scheduler.activeAccountRuns.clear(); f.state.claimDenied = true
    await f.restorer.run(); assert.equal(f.state.logins, 0); assert.equal(f.scheduler.externalAccountRuns.size, 0)
    f.state.claimDenied = false; await f.restorer.run(); assert.equal(row.login_status, 'đã đăng nhập')
  })
  await test('overlapping discovery calls share one verification and one claim', async () => {
    const f = fixture(); f.add(); f.state.loginWait = deferred()
    const first = f.restorer.run(), second = f.restorer.run(); assert.equal(first, second)
    await flush(); assert.equal(f.state.logins, 1); assert.equal(f.state.claims.length, 1)
    f.state.loginWait.resolve(); await first
  })
  await test('stopping while claim is pending releases it without starting a login', async () => {
    const f = fixture(); f.add(); f.state.claimWait = deferred()
    const job = f.restorer.run(); await flush(); f.state.running = false
    f.state.claimWait.resolve(); await job
    assert.equal(f.state.logins, 0); assert.equal(f.state.released.length, 1)
    assert.equal(f.scheduler.externalAccountRuns.size, 0)
  })
  for (const [name, change] of Object.entries({
    'QR already verified': row => { row.zalo_session_last_verified_at = '2026-09-18T09:00:00Z'; row.login_status = 'đã đăng nhập' },
    'session replaced': row => { row.zalo_session_updated_at = '2026-09-18T09:00:00Z' },
    'logged out': row => { row.zalo_session = null; row.zalo_session_updated_at = null },
    'disabled': row => { row.is_active = false },
    'moved to Desktop': row => { row.is_zalo_server = false },
    'deleted': row => { row.is_delete = true }
  })) await test(`stale discovery is rechecked after the claim: ${name}`, async () => {
    const f = fixture(); f.add(); f.state.beforeClaim = change
    await f.restorer.run(); assert.equal(f.state.logins, 0); assert.equal(f.state.reads, 0)
    assert.equal(f.state.released.length, 1)
  })
  await test('unconfirmed cleanup retains the reservation and prevents another login', async () => {
    const f = fixture(); f.add(); f.state.keepClaim = true
    await f.restorer.run(); assert.equal(f.state.held.size, 1)
    assert.equal(f.scheduler.externalAccountRuns.size, 1)
    assert.equal(f.scheduler.tryReserveExternalAccount(4224), false)
    await f.restorer.run(); assert.equal(f.state.logins, 1)
  })
  await test('manager discovery starts background restoration; shutdown drains its actual producer', async () => {
    const f = fixture(); f.add(); f.state.loginWait = deferred()
    const { ZaloServerRuntimeManager } = f.load('src/server/main/zaloServerRuntimeManager.ts', {
      '../../main/services/accountOperationRegistry': { accountOperationRegistry: f.registry },
      '../../main/data/currentUser': f.auth,
      '../../main/data/repositories/serverRuntimeRepository': { listActiveZaloServerUsers: async () => [f.user] }
    })
    const manager = new ZaloServerRuntimeManager({ ownershipStore: { claim() {}, release() {} }, broadcastSnapshot() {} })
    manager.state = 'running'; manager.notifySnapshot = () => {}
    const runtime = { user: f.user, state: 'running', ownsZaloRuntimeState: true, activeCommands: new Set(),
      qrAccountClaims: new Map(), qrReleasePromises: new Map(), scheduler: f.scheduler, zaloRuntime: f.zaloRuntime,
      supabase: f.supabase, realtimeManager: { stop() {}, waitForIdle: async () => true } }
    runtime.sessionRestorer = new f.ZaloServerSessionRestorer({ supabase: f.supabase, scheduler: f.scheduler,
      zaloRuntime: f.zaloRuntime, isRunning: () => manager.canRestoreSessions(runtime), onStatusUpdated() {} })
    manager.runtimes.set(890, runtime)
    await manager.doReconcile(); await flush()
    assert.equal(runtime.activeCommands.size, 1); assert.equal(f.state.logins, 1)
    await manager.doReconcile(); assert.equal(f.state.logins, 1)
    const background = Promise.all([...runtime.activeCommands])
    const stopping = manager.stopRuntime(890); await flush()
    assert.equal(manager.runtimes.has(890), true, 'do not recover while login is in progress')
    f.state.loginWait.resolve(); await background; await stopping
    assert.equal(runtime.activeCommands.size, 0); assert.equal(manager.runtimes.has(890), false)
  })
  await test('one blocked runtime does not block future discovery for healthy staff', async () => {
    const f = fixture(), blocked = deferred(); let healthyRuns = 0, blockedRuns = 0
    const { ZaloServerRuntimeManager } = f.load('src/server/main/zaloServerRuntimeManager.ts', { '../../main/data/currentUser': f.auth })
    const manager = new ZaloServerRuntimeManager({}); manager.state = 'running'
    const addRuntime = (staffId, run) => {
      const runtime = { user: { staffId }, state: 'running', ownsZaloRuntimeState: true, activeCommands: new Set(), sessionRestorer: { run } }
      manager.runtimes.set(staffId, runtime); return runtime
    }
    const slow = addRuntime(1, () => { blockedRuns++; return blocked.promise })
    const healthy = addRuntime(2, async () => { healthyRuns++ })
    manager.queueSessionRestores(); await flush()
    manager.queueSessionRestores(); await flush()
    manager.queueSessionRestores(); await flush()
    assert.equal(healthyRuns, 3); assert.equal(blockedRuns, 1)
    assert.equal(slow.activeCommands.size, 1); assert.equal(healthy.activeCommands.size, 0)
    blocked.resolve(); await Promise.all([...slow.activeCommands]); assert.equal(manager.activeSessionRestores.size, 0)
  })
  await test('restore queue caps concurrency, deduplicates ticks and skips lost ownership/stopped work', async () => {
    const f = fixture(), jobs = new Map(); let peak = 0, active = 0
    const { ZaloServerRuntimeManager } = f.load('src/server/main/zaloServerRuntimeManager.ts', { '../../main/data/currentUser': f.auth })
    const manager = new ZaloServerRuntimeManager({}); manager.state = 'running'
    for (let staffId = 1; staffId <= 30; staffId++) {
      const runtime = { user: { staffId }, state: 'running', ownsZaloRuntimeState: true, activeCommands: new Set(),
        sessionRestorer: { async run() {
          assert.equal(jobs.has(staffId), false, 'one queued run per staff')
          const job = deferred(); jobs.set(staffId, job); peak = Math.max(peak, ++active)
          try { await job.promise } finally { active-- }
        } } }
      manager.runtimes.set(staffId, runtime)
    }
    manager.queueSessionRestores(); manager.queueSessionRestores(); await flush()
    assert.equal(jobs.size, 25); assert.equal(manager.queuedSessionRestores.size, 5)
    manager.runtimes.get(26).ownsZaloRuntimeState = false
    jobs.get(1).resolve(); await flush()
    assert.equal(jobs.has(26), false); assert.equal(jobs.has(27), true); assert.equal(active, 25)
    manager.state = 'stopping'
    for (const job of jobs.values()) job.resolve()
    await flush()
    assert.equal(peak, 25); assert.equal(jobs.has(28), false)
    assert.equal(manager.activeSessionRestores.size, 0); assert.equal(manager.queuedSessionRestores.size, 0)
    assert.ok([...manager.runtimes.values()].every(runtime => runtime.activeCommands.size === 0))
  })
  console.log(`${passed} session restore smoke tests passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
