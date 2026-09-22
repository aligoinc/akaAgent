// Real registry, repositories and Server manager with in-memory transports.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function createClock() {
  let now = 0, next = 0
  const tasks = new Map()
  return {
    tasks, intervals: [], get now() { return now },
    set(fn, ms) { const id = ++next; tasks.set(id, { fn, at: now + ms }); return id },
    clear(id) { tasks.delete(id) },
    async advance(ms) { now += ms; for (const [id, t] of [...tasks]) if (t.at <= now) { tasks.delete(id); t.fn() }; await flush() }
  }
}
const temporary = () => Object.assign(new Error('schema cache unavailable'), { code: 'PGRST002', status: 503 })
function fixture() {
  const clock = createClock(), logs = []
  const user = { staffId: 811, organizationId: 788 }
  function load(relative, overrides = {}) {
    const file = path.join(root, relative), exports = {}
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    function Stub() {}
    const fallback = new Proxy({}, { get: (_, key) => key === 'IPC_EVENTS' || key === 'IPC_EVENTS_V2' ? new Proxy({}, { get: (_, k) => k }) : Stub })
    class FakeDate extends Date { static now() { return clock.now } }
    vm.runInNewContext(code, { exports,
      require: id => overrides[id] || (id.startsWith('node:') || ['crypto', 'fs', 'os', 'path'].includes(id) ? require(id) : fallback),
      AbortController, Date: FakeDate, console: { warn: (...v) => logs.push(v), error: (...v) => logs.push(v), log() {} },
      setTimeout: (fn, ms) => clock.set(fn, ms), clearTimeout: id => clock.clear(id),
      setInterval: fn => clock.intervals.push(fn), clearInterval() {}, queueMicrotask, Buffer, URL
    }, { filename: file })
    return exports
  }
  const retry = load('src/main/services/runtimeCleanupRetry.ts')
  const operations = load('src/main/services/accountOperationRegistry.ts', { './runtimeCleanupRetry': retry })
  const registry = operations.accountOperationRegistry
  const account = { id: 3883, staffId: user.staffId, organizationId: user.organizationId, flatformType: 'zalo',
    isZaloServer: true, isZaloShowWeb: false, isActive: true, status: 'chờ xử lý', loginStatus: 'đã đăng nhập', hasZaloSession: true }
  const state = { token: null, claimFailures: 0, claimWait: null, claimError: null, cleanupFailures: 0, loseClaim: false, loseCleanup: false, cleanupReason: null, cleanupWait: null,
    calls: [], sends: 0, recovery: 0, claims: 0, cleanups: 0,
    capabilityError: null, capabilityReads: 0, serverEnabled: true }
  const db = {
    from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: { status: account.status }, error: null }) }),
    rpc(name, args) {
      return { abortSignal(signal) {
        state.calls.push({ name, args: { ...args }, time: clock.now, signal })
        const run = async () => {
          if (name === 'aka_agent_claim_account_operation') {
            state.claims++
            if (state.claimWait) await state.claimWait.promise
            if (state.claimError) throw state.claimError
            if (state.claimFailures-- > 0) throw temporary()
            account.status = 'đang chạy'; state.token = args.p_claim_token
            if (state.loseClaim) { state.loseClaim = false; throw temporary() }
            return { data: { claimed: true, previous_status: args.p_previous_status, claim_token: args.p_claim_token }, error: null }
          }
          assert.equal(name, 'aka_agent_cleanup_account_operation')
          state.cleanups++
          if (state.cleanupWait) await state.cleanupWait.promise
          if (state.cleanupFailures-- > 0) throw temporary()
          if (state.cleanupReason) return { data: { ok: false, reason: state.cleanupReason }, error: null }
          if (state.token !== args.p_claim_token) return { data: { ok: true, reason: 'not_owner' }, error: null }
          if (account.status === 'đang chạy') account.status = args.p_previous_status
          state.token = null
          if (state.loseCleanup) { state.loseCleanup = false; throw temporary() }
          return { data: { ok: true, reason: 'cleaned' }, error: null }
        }
        return new Promise((resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
          else run().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
        })
      } }
    }
  }
  const auth = { requireCurrentUser: () => user, getCurrentUser: () => user, runWithCurrentUser: (_u, fn) => fn() }
  const repo = load('src/main/data/repositories/accountRepository.ts', {
    '../../services/accountOperationRegistry': operations, '../supabaseClient': { getSupabaseClient: () => db }, '../currentUser': auth
  })
  const { CampaignScheduler } = load('src/main/services/campaignScheduler.ts', { './accountOperationRegistry': operations })
  const scheduler = Object.assign(Object.create(CampaignScheduler.prototype), {
    activeAccountRuns: new Map(), externalAccountRuns: new Map(), failedCampaignRuns: new Map(),
    waitForIdle: async () => true, stop() {}, blockZaloRuntimeForRestart() {}, stopAcceptingNewZaloWork() {}
  })
  const { ZaloServerRuntimeManager } = load('src/server/main/zaloServerRuntimeManager.ts', {
    '../../main/services/accountOperationRegistry': operations, '../../main/data/currentUser': auth,
    '../../main/data/repositories/zaloRuntimeModeRepository': { loadStaffZaloAccountCapabilitySnapshot: async () => {
      state.capabilityReads++
      if (state.capabilityError) throw state.capabilityError
      return { server: state.serverEnabled }
    } }
  })
  const manager = new ZaloServerRuntimeManager({ ownershipStore: { release() {} }, broadcastSnapshot() {} })
  manager.state = 'running'; manager.notifySnapshot = () => {}
  const runtime = {
    user, state: 'running', startedAt: '2026-09-22T00:00:00.000Z', ownsZaloRuntimeState: true, activeCommands: new Set(), qrAccountClaims: new Map(), qrReleasePromises: new Map(), controlOperationIds: new Map(),
    eventWindow: { webContents: { send() {} } }, scheduler,
    contactLoader: { stopAll() {}, waitForIdle: async () => true },
    realtimeManager: { stop() {}, waitForIdle: async () => true, refreshSoon() {} },
    zaloRuntime: { checkSession: async () => { state.sends++; return { loggedIn: true } }, logout: async () => { state.sends++; return { success: true } },
      cancelAllLoginQrAndWait: async () => true, clearAll() {} },
    supabase: { ...repo, getAccount: async () => account, getAccountIgnoringCapability: async () => account,
      recoverServerZaloRunningState: async () => { state.recovery++; account.status = 'chờ xử lý'; state.token = null },
      recoverCampaignRuntimeUnitLeasesV2: async () => ({ ok: true }) }
  }
  manager.runtimes.set(user.staffId, runtime)
  return { clock, logs, load, operations, registry, repo, auth, account, state, manager, runtime, scheduler, retry }
}

function startWarmup(f, verification = async () => {}) {
  const { ZaloRuntimeService } = f.load('src/main/services/zaloRuntimeService.ts')
  const warmer = Object.assign(Object.create(ZaloRuntimeService.prototype), {
    supabase: {
      ...f.runtime.supabase,
      listZaloAccountsWithSession: async () => [{ account: f.account }],
      markAccountZaloSessionCheck: async () => f.account
    },
    cacheVersion: 0, warmSessionClaimsAbandoned: false, activeWarmSessionOperations: new Set(),
    verifyAccountSession: async () => { f.state.sends++; await verification() },
    updateCachedVerification() {}
  })
  f.manager.state = 'starting'; f.runtime.state = 'starting'
  const startup = f.manager.runStaffLifecycle(811, async () => {
    await warmer.warmStoredSessions('server')
    f.manager.assertRuntimeMayStart(f.runtime)
  })
  const result = startup.then(() => null, error => error)
  // Discovery awaits this same lifecycle. Public stop must unblock both waits.
  f.manager.reconcilePromise = result.then(() => undefined)
  return result
}

let passed = 0
async function test(name, run) { await run(); console.log('PASS ' + name); passed++ }
async function main() {
  await test('staff expiry: Stop reaches a running scan; received rows persist before the account is released', async () => {
    const f = fixture(), page = deferred(), saved = []
    const { ContactLoader } = f.load('src/main/services/contactLoader.ts')
    let reads = 0
    f.runtime.zaloRuntime.getAllGroups = async () => ({ group1: '1', group2: '1' })
    f.runtime.zaloRuntime.getGroupInfoBatch = async () => { reads++; return page.promise }
    f.runtime.supabase.upsertZaloGroupContacts = async rows => {
      assert.equal(f.registry.has(3883), true, 'retain ownership through result persistence')
      saved.push(...rows); return rows.length
    }
    const loader = Object.assign(Object.create(ContactLoader.prototype), {
      supabase: f.runtime.supabase, mainWindow: f.runtime.eventWindow, zaloRuntime: f.runtime.zaloRuntime,
      zaloRuntimeTarget: 'server', contactDatasetAuth: 'server_claim', zaloRuntimeClaimsAbandoned: false,
      activeLoads: new Map(), cancelledLoads: new Set(), sendProgress() {}
    })
    f.runtime.contactLoader = loader
    const scan = f.manager.executeCommand(811, 'contacts.loadGroups', [3883]); await flush()
    assert.equal(reads, 1); assert.equal(f.registry.has(3883), true)
    // This is the error returned by the capability loader after v305 staff expiry.
    f.state.capabilityError = new Error('Không thể kiểm tra quyền tài khoản Zalo. Vui lòng thử lại sau.')
    const readsBeforeCancel = f.state.capabilityReads
    const result = await f.manager.executeCommand(811, 'contacts.cancel', [3883, { expectedRuntimeStartedAt: f.runtime.startedAt }])
    assert.equal(result.success, true)
    assert.equal(loader.activeLoads.get(3883).variables.contactScanCancelled, true)
    assert.equal(f.registry.has(3883), true, 'Stop must not release a still-pending external read')
    assert.equal(f.state.capabilityReads, readsBeforeCancel, 'owned cleanup is independent of the new-work permission RPC')
    page.resolve({ gridInfoMap: { group1: { groupId: 'group1', name: 'One' }, group2: { groupId: 'group2', name: 'Two' } } })
    const completed = await scan
    assert.equal(completed.stopped, true); assert.equal(completed.count, 2)
    assert.deepEqual(saved.map(row => row.zaloGroupId), ['group1', 'group2'])
    assert.equal(reads, 1); assert.equal(f.state.cleanups, 1)
    assert.equal(f.registry.has(3883), false); assert.equal(f.scheduler.externalAccountRuns.has(3883), false)
    assert.equal(f.runtime.activeCommands.size, 0); assert.equal(loader.activeLoads.size, 0)
    assert.equal(f.account.status, 'chờ xử lý')
    await assert.rejects(f.manager.executeCommand(811, 'contacts.loadGroups', [3883]), /Không thể kiểm tra quyền/)
    assert.equal(f.state.claims, 1, 'expiry still rejects new work')
  })
  for (const draining of [false, true]) await test(`staff expiry: cancel QR waits for completion and releases its token (draining=${draining})`, async () => {
    const f = fixture(), qr = deferred(), cancel = deferred()
    f.runtime.zaloRuntime.startLoginQr = async () => ({ success: true })
    f.runtime.zaloRuntime.waitForLoginQrIdle = () => qr.promise
    f.runtime.zaloRuntime.cancelLoginQrAndWait = async () => { await cancel.promise; qr.resolve(); return true }
    await f.manager.executeCommand(811, 'zalo.loginQr.start', [3883])
    assert.equal(f.registry.has(3883), true)
    f.state.capabilityError = new Error('Active staff 811 was not found')
    if (draining) Object.assign(f.runtime, { state: 'stopping', gracefulCapabilityLoss: true, acceptsCleanupCommands: true })
    const stop = f.manager.executeCommand(811, 'zalo.loginQr.cancel', [3883, { expectedRuntimeStartedAt: f.runtime.startedAt }])
    await flush(); assert.equal(f.state.cleanups, 0); assert.equal(f.registry.has(3883), true)
    cancel.resolve(); assert.equal((await stop).success, true); await flush()
    assert.equal(f.state.cleanups, 1); assert.equal(f.state.token, null)
    assert.equal(f.registry.has(3883), false); assert.equal(f.scheduler.externalAccountRuns.has(3883), false)
    assert.equal(f.runtime.qrAccountClaims.size, 0); assert.equal(f.runtime.activeCommands.size, 0)
  })
  await test('expiry drain still accepts QR cancellation and completes scoped recovery', async () => {
    const f = fixture(), qr = deferred()
    f.runtime.zaloRuntime.startLoginQr = async () => ({ success: true })
    f.runtime.zaloRuntime.waitForLoginQrIdle = () => qr.promise
    f.runtime.zaloRuntime.cancelLoginQrAndWait = async () => { qr.resolve(); return true }
    await f.manager.executeCommand(811, 'zalo.loginQr.start', [3883])
    f.state.capabilityError = new Error('Active staff 811 was not found')
    const drain = f.manager.stopRuntime(811, true); await flush()
    assert.equal(f.runtime.state, 'stopping'); assert.equal(f.runtime.acceptsCleanupCommands, true)
    assert.equal(f.state.recovery, 0)
    await f.manager.executeCommand(811, 'zalo.loginQr.cancel', [3883, { expectedRuntimeStartedAt: f.runtime.startedAt }])
    await flush(); await f.clock.advance(50); await drain
    assert.equal(f.state.recovery, 1); assert.equal(f.registry.has(3883), false)
    assert.equal(f.manager.runtimes.has(811), false); assert.equal(f.account.status, 'chờ xử lý')
  })
  await test('cleanup rejects a stale runtime, foreign staff/account, changed subtype and forced shutdown', async () => {
    for (const scenario of ['stale', 'staff', 'account', 'local', 'web', 'forced', 'closed-cleanup', 'server-stop', 'replaced-during-read', 'forced-during-read']) {
      const f = fixture(); let cancelled = 0
      f.runtime.contactLoader.cancelLoad = () => { cancelled++ }
      const guard = { expectedRuntimeStartedAt: f.runtime.startedAt }
      if (scenario === 'stale') guard.expectedRuntimeStartedAt = 'old-runtime'
      if (scenario === 'account') f.runtime.supabase.getAccountIgnoringCapability = async () => null
      if (scenario === 'local') f.account.isZaloServer = false
      if (scenario === 'web') f.account.isZaloShowWeb = true
      if (scenario === 'forced') Object.assign(f.runtime, { state: 'stopping', gracefulCapabilityLoss: false, acceptsCleanupCommands: false })
      if (scenario === 'closed-cleanup') Object.assign(f.runtime, { state: 'stopping', gracefulCapabilityLoss: true, acceptsCleanupCommands: false })
      if (scenario === 'server-stop') f.manager.state = 'stopping'
      if (scenario.endsWith('during-read')) f.runtime.supabase.getAccountIgnoringCapability = async () => {
        if (scenario === 'replaced-during-read') f.manager.runtimes.set(811, { ...f.runtime, startedAt: 'new-runtime' })
        else Object.assign(f.runtime, { state: 'stopping', gracefulCapabilityLoss: false, acceptsCleanupCommands: false })
        return f.account
      }
      await assert.rejects(f.manager.executeCommand(scenario === 'staff' ? 812 : 811, 'contacts.cancel', [3883, guard]))
      assert.equal(cancelled, 0, scenario); assert.equal(f.runtime.activeCommands.size, 0, scenario)
    }
  })
  await test('legacy unguarded cleanup still requires live access; guarded cleanup never grants new-work access', async () => {
    const f = fixture(); let cancelled = 0
    f.runtime.contactLoader.cancelLoad = () => { cancelled++ }
    await f.manager.executeCommand(811, 'contacts.cancel', [3883])
    assert.equal(cancelled, 1); assert.equal(f.state.capabilityReads, 1)
    f.state.serverEnabled = false
    await assert.rejects(f.manager.executeCommand(811, 'contacts.cancel', [3883]), /không còn quyền/)
    await f.manager.executeCommand(811, 'contacts.cancel', [3883, { expectedRuntimeStartedAt: f.runtime.startedAt }])
    assert.equal(cancelled, 2)
    for (const command of ['contacts.loadFriends', 'zalo.loginQr.start', 'zalo.session.check', 'zalo.logout', 'campaign.pause']) {
      await assert.rejects(f.manager.executeCommand(811, command, [3883, { expectedRuntimeStartedAt: f.runtime.startedAt }]), /không còn quyền/)
    }
    assert.equal(f.state.claims, 0)
    f.state.capabilityError = new Error('Active staff 811 was not found')
    await assert.rejects(f.manager.executeCommand(811, 'contacts.cancel', [3883]), /Active staff/)
    assert.equal(cancelled, 2)
  })
  await test('3883 command retains account through repeated PGRST002; no repeated Zalo action', async () => {
    const f = fixture(); f.state.cleanupFailures = 3
    const job = f.manager.executeCommand(811, 'zalo.session.check', [3883])
    await flush()
    assert.equal(f.registry.has(3883), true); assert.equal(f.scheduler.externalAccountRuns.has(3883), true)
    assert.equal(f.scheduler.tryReserveExternalAccount(3883), false)
    for (let i = 0; i < 3; i++) await f.clock.advance(2000)
    assert.equal((await job).loggedIn, true)
    assert.equal(f.state.sends, 1); assert.equal(f.state.cleanups, 4)
    assert.equal(f.registry.has(3883), false); assert.equal(f.scheduler.externalAccountRuns.has(3883), false)
    assert.equal(f.account.status, 'chờ xử lý')
  })
  await test('retry delay starts after request failure; no timer while request is pending', async () => {
    const f = fixture(); f.state.cleanupWait = deferred(); f.state.cleanupFailures = 1
    const job = f.manager.executeCommand(811, 'zalo.session.check', [3883]); await flush()
    await f.clock.advance(12000); assert.equal(f.state.cleanups, 1); assert.equal(f.clock.tasks.size, 0)
    f.state.cleanupWait.resolve(); f.state.cleanupWait = null; await flush()
    await f.clock.advance(1999); assert.equal(f.state.cleanups, 1)
    await f.clock.advance(1); await job
    assert.deepEqual(f.state.calls.filter(x => x.name.includes('cleanup')).map(x => x.time), [0, 14000])
  })
  await test('lost claim and cleanup responses reuse one token and execute Zalo once', async () => {
    const f = fixture(); f.state.loseClaim = true; f.state.loseCleanup = true
    const job = f.manager.executeCommand(811, 'zalo.session.check', [3883]); await flush()
    assert.equal(f.state.sends, 0)
    await f.clock.advance(2000); assert.equal(f.state.sends, 1)
    await f.clock.advance(2000); await job
    assert.equal(new Set(f.state.calls.map(x => x.args.p_claim_token)).size, 1)
    assert.equal(f.state.sends, 1); assert.equal(f.registry.has(3883), false)
  })
  await test('pause while cleanup waits is preserved', async () => {
    const f = fixture(); f.state.cleanupFailures = 1
    const job = f.manager.executeCommand(811, 'zalo.session.check', [3883]); await flush()
    f.account.status = 'tạm dừng'
    await f.clock.advance(2000); await job
    assert.equal(f.account.status, 'tạm dừng'); assert.equal(f.state.token, null)
  })
  await test('permanent cleanup refusal retains RAM hold without retrying', async () => {
    const f = fixture(); f.state.cleanupReason = 'work_running'
    await f.manager.executeCommand(811, 'zalo.session.check', [3883])
    assert.equal(f.registry.has(3883), true); assert.equal(f.scheduler.externalAccountRuns.has(3883), true)
    await f.clock.advance(10000); assert.equal(f.state.cleanups, 1)
    assert.equal((await f.repo.claimZaloAccountRuntimeOperation(3883, 'server')).claimed, false)
  })
  await test('shutdown drains real producer, then recovers held tokens', async () => {
    const f = fixture(), action = deferred()
    f.runtime.zaloRuntime.checkSession = () => { f.state.sends++; return action.promise }
    const job = f.manager.executeCommand(811, 'zalo.session.check', [3883]); await flush()
    const stop = f.manager.stopRuntime(811); await flush()
    assert.equal(f.state.recovery, 0); assert.equal(f.registry.has(3883), true)
    action.resolve({ loggedIn: true }); await flush(); await f.clock.advance(50)
    await job; await stop
    assert.equal(f.state.recovery, 1); assert.equal(f.registry.has(3883), false)
    assert.equal(f.manager.runtimes.has(811), false)
  })
  await test('shutdown interrupts cleanup wait and recovers without waiting for retry', async () => {
    const f = fixture(); f.state.cleanupFailures = 1
    const job = f.manager.executeCommand(811, 'zalo.session.check', [3883]); await flush()
    const stop = f.manager.stopRuntime(811); await flush(); await f.clock.advance(50)
    await job; await stop
    assert.equal(f.state.sends, 1); assert.equal(f.state.recovery, 1); assert.equal(f.registry.has(3883), false)
  })
  for (const phase of ['claim', 'cleanup']) await test(`public shutdown interrupts warm-session ${phase} retry before waiting for startup`, async () => {
    const f = fixture()
    f.state[phase === 'claim' ? 'claimFailures' : 'cleanupFailures'] = 1
    const startup = startWarmup(f); await flush()
    assert.equal(f.clock.tasks.size, 1, 'warmup is waiting for its 2s retry')
    let stopped = false
    const stop = f.manager.stop().then(() => { stopped = true })
    await flush(); await flush()
    assert.equal(stopped, true, 'shutdown must not wait for the warmup retry timer')
    await stop
    assert.ok(await startup, 'startup must not continue after shutdown')
    assert.equal(f.clock.now, 0, 'no retry interval was advanced')
    assert.equal(f.state.claims, 1)
    assert.equal(f.state.sends, phase === 'claim' ? 0 : 1)
    assert.equal(f.state.recovery, 1); assert.equal(f.registry.has(3883), false)
    const claims = f.state.claims, cleanups = f.state.cleanups
    await f.clock.advance(2000)
    assert.equal(f.state.claims, claims); assert.equal(f.state.cleanups, cleanups)
  })
  await test('public shutdown still drains the actual warm-session verification before recovery', async () => {
    const f = fixture(), verification = deferred()
    const startup = startWarmup(f, () => verification.promise); await flush()
    let stopped = false
    const stop = f.manager.stop().then(() => { stopped = true }); await flush()
    assert.equal(stopped, false); assert.equal(f.state.recovery, 0)
    assert.equal(f.registry.has(3883), true)
    verification.resolve(); await flush(); await flush()
    assert.equal(stopped, true); await stop
    assert.ok(await startup)
    assert.equal(f.state.sends, 1); assert.equal(f.state.recovery, 1)
    assert.equal(f.registry.has(3883), false)
  })
  await test('shutdown waits for an in-flight claim without starting its producer', async () => {
    const f = fixture(); f.state.claimWait = deferred()
    const job = f.manager.executeCommand(811, 'zalo.session.check', [3883])
    const rejected = assert.rejects(job, /stopped/); await flush()
    const stop = f.manager.stopRuntime(811); await flush(); await f.clock.advance(1000)
    assert.equal(f.state.recovery, 0); assert.equal(f.state.sends, 0)
    assert.equal(f.state.calls[0].signal.aborted, false, 'HTTP abort alone is not proof that SQL stopped')
    f.state.claimWait.resolve(); await flush(); await f.clock.advance(50)
    await rejected; await stop
    assert.equal(f.state.sends, 0); assert.equal(f.state.recovery, 1); assert.equal(f.registry.has(3883), false)
  })
  await test('permanent claim error retains ownership uncertainty without retry or side effect', async () => {
    const f = fixture(); f.state.claimError = Object.assign(new Error('function unavailable'), { code: 'PGRST202' })
    await assert.rejects(f.manager.executeCommand(811, 'zalo.session.check', [3883]), /unavailable/)
    await f.clock.advance(10000)
    assert.equal(f.state.claims, 1); assert.equal(f.state.sends, 0)
    assert.equal(f.registry.has(3883), true); assert.equal(f.scheduler.externalAccountRuns.has(3883), true)
  })
  await test('old QR cleanup and RAM reservation cannot release a newer QR', async () => {
    const f = fixture()
    const old = { previousStatus: 'chờ xử lý', claimToken: 'old', staffId: 811, reservationToken: 'ram-old' }
    const current = { previousStatus: 'chờ xử lý', claimToken: 'new', staffId: 811, reservationToken: 'ram-new' }
    f.runtime.qrAccountClaims.set(3883, current); f.scheduler.tryReserveExternalAccount(3883, 'ram-new')
    await f.manager.releaseQrAccountClaim(f.runtime, 3883, old)
    f.scheduler.releaseExternalAccount(3883, 'ram-old')
    assert.equal(f.runtime.qrAccountClaims.get(3883), current)
    assert.equal(f.scheduler.externalAccountRuns.get(3883), 'ram-new'); assert.equal(f.state.cleanups, 0)
  })
  await test('duplicate cleanup callers share one in-flight request', async () => {
    const f = fixture(); const claim = await f.repo.claimZaloAccountRuntimeOperation(3883, 'server')
    f.state.cleanupWait = deferred()
    const first = f.repo.releaseZaloAccountRuntimeOperation(3883, 'server', claim.previousStatus, claim.staffId, claim.claimToken)
    const second = f.repo.releaseZaloAccountRuntimeOperation(3883, 'server', claim.previousStatus, claim.staffId, claim.claimToken)
    await flush(); assert.equal(f.state.cleanups, 1)
    f.state.cleanupWait.resolve(); await Promise.all([first, second])
  })
  await test('Desktop Chat QR stop captures its claim and never releases unsettled QR work', async () => {
    for (const settled of [false, true]) {
      const f = fixture(), cancel = deferred()
      const { ZaloLocalChatSyncService } = f.load('src/main/services/zaloLocalChatSyncService.ts')
      const service = new ZaloLocalChatSyncService(f.runtime.supabase, {}, { cancelLoginQrAndWait: () => cancel.promise })
      service.resetStickerDetails = () => {}
      const old = { previousStatus: 'chờ xử lý', claimToken: 'old', staffId: 811 }
      const current = { ...old, claimToken: 'new' }
      service.activeQrOperations.set(3883, 'qr-old'); service.qrClaimPreviousStatus.set(3883, old)
      service.stop()
      if (settled) service.qrClaimPreviousStatus.set(3883, current)
      cancel.resolve(settled); await flush()
      assert.equal(f.state.cleanups, 0)
      assert.equal(service.qrClaimPreviousStatus.get(3883), settled ? current : old)
    }
  })
  await test('late release after recovery cannot remove a new registry record', async () => {
    const f = fixture(); const old = await f.repo.claimZaloAccountRuntimeOperation(3883, 'server')
    await f.repo.releaseZaloAccountRuntimeOperation(3883, 'server', old.previousStatus, old.staffId, old.claimToken)
    const current = await f.repo.claimZaloAccountRuntimeOperation(3883, 'server')
    await f.repo.releaseZaloAccountRuntimeOperation(3883, 'server', old.previousStatus, old.staffId, old.claimToken)
    assert.equal(f.registry.has(3883), true); assert.equal(f.state.token, current.claimToken)
    await f.repo.releaseZaloAccountRuntimeOperation(3883, 'server', current.previousStatus, current.staffId, current.claimToken)
  })
  await test('scan release uses shared retry for Zalo, Facebook and Email', async () => {
    for (const platform of ['zalo', 'facebook', 'email']) {
      const f = fixture()
      const { ContactLoader } = f.load('src/main/services/contactLoader.ts')
      const loader = Object.assign(Object.create(ContactLoader.prototype), { supabase: f.runtime.supabase, mainWindow: f.runtime.eventWindow,
        zaloRuntimeTarget: platform === 'zalo' ? 'server' : 'desktop', contactDatasetAuth: 'server_claim', zaloRuntimeClaimsAbandoned: false })
      f.account.flatformType = platform
      const claim = await loader.claimAccountForScan(f.account)
      f.state.cleanupFailures = 2
      const job = loader.restoreAccountStatus(f.account, claim); await flush()
      await f.clock.advance(2000); await f.clock.advance(2000); await job
      assert.equal(f.state.cleanups, 3); assert.equal(f.registry.has(3883), false)
    }
  })
  console.log(`${passed} account operation smoke checks passed`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
