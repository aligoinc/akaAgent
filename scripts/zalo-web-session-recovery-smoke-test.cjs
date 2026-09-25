const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const compile = code => ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const warnings = []
const quietConsole = { ...console, warn: (...args) => warnings.push(args), info() {}, log() {} }
const globals = { Buffer, URL, Headers, AbortController, AbortSignal, setTimeout, clearTimeout, console: quietConsole }
const deadline = {}
vm.runInNewContext(compile(read('src/main/services/requestDeadline.ts')), { ...globals, exports: deadline })
class FakeAPI {
  constructor(context) { this.context = context; this.listener = { start() {} } }
  async fetchAccountInfo() {
    const response = await this.context.options.polyfill('https://profile.fixture/api/social/profile/me-v2')
    return response.json()
  }
}
const web = {}
vm.runInNewContext(compile(read('src/main/services/zaloWebRuntimeService.ts')), {
  ...globals, exports: web, require: name => name === 'electron' ? { session: {} }
    : name === 'zca-js' ? { API: FakeAPI }
      : name === './requestDeadline' ? deadline : require(name)
})
// Execute the production check method without loading unrelated QR/server dependencies.
const source = ts.createSourceFile('runtime.ts', read('src/main/services/zaloRuntimeService.ts'), ts.ScriptTarget.Latest, true)
const runtimeClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ZaloRuntimeService')
const checkMethod = runtimeClass.members.find(node => node.name?.getText(source) === 'checkSession')
const checks = {}
vm.runInNewContext(compile(`export class CheckSubject { ${checkMethod.getText(source)} }`), { ...globals, exports: checks })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await sleep(2) }
  assert.fail('fixture condition did not settle')
}
let nextId = 1
async function fixture(initialStatus = 'đã đăng nhập') {
  const id = nextId++
  let attached = false
  const state = {
    cookies: [{ name: 'zpsid', value: 'fixture' }, { name: 'zpw_sek', value: 'fixture' }],
    account: { id, flatformType: 'zalo', isZaloShowWeb: true, isActive: true, isDelete: false, status: 'chờ xử lý', loginStatus: initialStatus },
    reloads: 0, failedWrites: 0, verifiedWrites: 0, reads: 0, loading: false, destroyed: false, crashed: false,
    uid: 'fixture-user', mode: 'ok', requests: [], onReload: undefined
  }
  const dbg = new EventEmitter()
  Object.assign(dbg, {
    isAttached: () => attached, attach: () => { attached = true },
    detach: () => { attached = false; dbg.emit('detach', {}, 'fixture interrupted') },
    sendCommand: async () => ({})
  })
  const wc = new EventEmitter()
  Object.assign(wc, {
    id, debugger: dbg, isDestroyed: () => state.destroyed, isCrashed: () => state.crashed,
    isLoadingMainFrame: () => state.loading, getURL: () => 'https://chat.zalo.me/', getUserAgent: () => 'fixture',
    reload: () => { state.reloads++; state.onReload?.() },
    session: {
      cookies: { get: async () => { state.reads++; return state.cookies } },
      fetch: async (url, init) => {
        state.requests.push({ url, signal: init.signal })
        if (state.mode === 'network-error') throw Error('fixture network unavailable')
        if (state.mode === 'every-second-error' && state.requests.length % 2 === 0) throw Error('fixture second request failed')
        if (state.mode === 'pending-headers') return new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        })
        return { json: () => state.mode === 'pending-body' ? new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
        }) : Promise.resolve({ profile: { userId: state.uid } }) }
      }
    }
  })
  const service = new web.ZaloWebRuntimeService(undefined, 25, async () => {
    state.verifiedWrites++
    state.account = { ...state.account, loginStatus: 'đã đăng nhập' }
  })
  const checker = new checks.CheckSubject()
  Object.assign(checker, {
    webRuntime: service, getErrorMessage: error => error.message,
    supabase: {
      getAccount: async () => state.account,
      markAccountZaloSessionCheck: async (_, result) => {
        state.failedWrites++
        state.account = { ...state.account, loginStatus: result.ok ? 'đã đăng nhập' : 'chưa đăng nhập' }
        return state.account
      }
    }
  })
  await service.attach(id, wc)
  const promote = () => service.promoteCandidate(service.entries.get(id), {
    loaderId: 'fixture', loginInfo: { uid: state.uid, zpw_enk: 'fixture', zpw_service_map_v3: { profile: ['https://profile.fixture'] }, zpw_ws: ['wss://fixture.invalid'] },
    serverInfo: { settings: {} }, imei: 'fixture', apiType: 30, apiVersion: 1
  })
  const age = () => { service.entries.get(id).armedAt = Date.now() - 100 }
  return { id, state, wc, service, checker, promote, age, close: () => service.clearAll() }
}
async function runServiceChecks() {
  {
    const f = await fixture()
    const result = await f.checker.checkSession(f.id)
    assert.equal(result.success, false)
    assert.equal(result.status, 'đã đăng nhập')
    assert.equal(f.state.failedWrites, 0, 'missing bootstrap is not logout')
    assert.equal(f.state.reloads, 0, 'campaign checks cannot reload')
    f.promote()
    await until(() => f.service.hasVerifiedSession(f.id))
    assert.equal(f.state.verifiedWrites, 1, 'late bootstrap auto-verifies')
    f.close()
  }
  {
    const f = await fixture('chưa đăng nhập')
    f.state.loading = true
    const check = f.checker.checkSession(f.id, { recoverWebSession: true })
    setTimeout(() => { f.state.loading = false; f.promote() }, 5)
    assert.equal((await check).loggedIn, true)
    assert.equal(f.state.reloads, 0, 'slow loading page is given time to finish')
    assert.equal(f.state.verifiedWrites, 1, 'waiting checker and auto-verifier share one build')
    assert.equal(f.state.requests.length, 1, 'new API build verifies profile exactly once')
    f.close()
  }
  {
    const f = await fixture()
    f.promote()
    await until(() => f.service.hasVerifiedSession(f.id))
    const requests = f.state.requests.length
    assert.equal((await f.checker.checkSession(f.id, { recoverWebSession: true })).success, true)
    assert.equal(f.state.requests.length, requests + 1, 'cached API still gets a fresh verification')
    assert.equal(f.service.entries.get(f.id).recoveryAttempted, false, 'healthy manual check returns recovery budget')
    f.wc.debugger.detach()
    await f.service.attach(f.id, f.wc)
    f.age()
    assert.equal(f.service.takeRecovery(f.id), true, 'later CDP interruption can recover')
    f.close()
  }
  {
    const f = await fixture('chưa đăng nhập')
    f.age()
    f.state.mode = 'every-second-error'
    f.state.onReload = () => setTimeout(f.promote, 2)
    assert.equal((await f.checker.checkSession(f.id, { recoverWebSession: true })).success, true)
    assert.equal(f.state.requests.length, 1, 'no redundant request after a successful recovery build')
    assert.equal(f.state.verifiedWrites, 1)
    for (let i = 0; i < 10; i++) assert.equal(f.service.takeRecovery(f.id), false)
    f.close()
  }
  {
    const f = await fixture()
    f.promote()
    await until(() => f.service.hasVerifiedSession(f.id))
    f.state.mode = 'network-error'
    assert.equal((await f.checker.checkSession(f.id, { recoverWebSession: true })).success, false)
    assert.equal(f.service.entries.get(f.id).recoveryAttempted, true, 'failed cached verification consumes recovery budget')
    for (let i = 0; i < 10; i++) assert.equal(f.service.takeRecovery(f.id), false)
    f.state.mode = 'ok'
    assert.equal((await f.checker.checkSession(f.id, { recoverWebSession: true })).success, true)
    assert.equal(f.service.entries.get(f.id).recoveryAttempted, false, 'manual retry returns budget only on success')
    f.close()
  }
  {
    const f = await fixture('chưa đăng nhập')
    f.age()
    f.state.onReload = () => setTimeout(f.promote, 2)
    let reads = 0
    f.checker.supabase.getAccount = async () => {
      if (++reads > 1) throw Error('fixture final DB read failed')
      return f.state.account
    }
    assert.equal((await f.checker.checkSession(f.id, { recoverWebSession: true })).success, false)
    assert.equal(f.state.verifiedWrites, 1, 'API build succeeded before final DB read failed')
    assert.equal(f.state.requests.length, 1)
    assert.equal(f.service.entries.get(f.id).recoveryAttempted, true, 'partial success cannot reopen automatic recovery')
    for (let i = 0; i < 10; i++) assert.equal(f.service.takeRecovery(f.id), false)
    f.close()
  }
  {
    const f = await fixture()
    f.promote()
    await until(() => f.service.hasVerifiedSession(f.id))
    const check = f.service.beginSessionCheck(f.id)
    f.service.invalidate(f.id)
    f.age()
    assert.equal(f.service.takeRecovery(f.id), true)
    check.finish(check.cachedApi)
    check.finish(check.cachedApi)
    assert.equal(f.service.entries.get(f.id).checksInProgress, 0, 'check completion is idempotent')
    assert.equal(f.service.entries.get(f.id).recoveryAttempted, true, 'old API completion cannot return a newer recovery budget')
    f.close()
  }
  {
    const f = await fixture('chưa đăng nhập')
    f.age()
    f.state.onReload = () => { void f.service.attach(f.id, f.wc); setTimeout(f.promote, 2) }
    assert.equal((await f.checker.checkSession(f.id, { recoverWebSession: true })).loggedIn, true)
    assert.equal(f.state.reloads, 1)
    assert.equal(f.state.verifiedWrites, 1)
    f.wc.debugger.detach()
    await f.service.attach(f.id, f.wc)
    assert.match(f.service.entries.get(f.id).lastCaptureResetReason, /CDP/)
    f.age()
    assert.equal(f.service.takeRecovery(f.id), true)
    assert.equal((await f.checker.checkSession(f.id, { recoverWebSession: true })).loggedIn, true)
    assert.equal(f.state.reloads, 2, 'new interruption after verified success allows one recovery')
    f.close()
  }
  {
    const f = await fixture()
    f.age()
    assert(f.service.takeRecovery(f.id))
    const result = await f.checker.checkSession(f.id, { recoverWebSession: true })
    assert.equal(result.success, false)
    assert.equal(f.state.reloads, 1)
    assert.equal(f.state.failedWrites, 0)
    const requestsAfterFailure = f.state.requests.length
    await f.checker.checkSession(f.id)
    assert.equal(f.state.requests.length, requestsAfterFailure, 'ordinary checks do not restart exhausted verification')
    await f.service.attach(f.id, f.wc)
    for (let i = 0; i < 10; i++) assert.equal(f.service.takeRecovery(f.id), false)
    await f.checker.checkSession(f.id, { recoverWebSession: true })
    assert.equal(f.state.reloads, 2, 'explicit manual check grants one more attempt')
    f.promote()
    await until(() => f.service.hasVerifiedSession(f.id))
    f.close()
  }
  for (const mode of ['network-error', 'pending-headers', 'pending-body']) {
    const f = await fixture()
    f.promote()
    await until(() => f.service.hasVerifiedSession(f.id))
    f.state.mode = mode
    const result = await f.checker.checkSession(f.id)
    assert.equal(result.loggedIn, false)
    assert.equal(result.success, false)
    assert.equal(result.status, 'đã đăng nhập')
    assert.equal(f.state.failedWrites, 0)
    if (mode.startsWith('pending')) assert(f.state.requests.at(-1).signal.aborted, 'verification aborts the actual fetch/body')
    f.close()
  }
  {
    const f = await fixture()
    f.age(); f.state.cookies = []
    const result = await f.checker.checkSession(f.id, { recoverWebSession: true })
    assert.equal(result.status, 'chưa đăng nhập')
    assert.equal(f.state.failedWrites, 1)
    assert.equal(f.state.reloads, 0, 'real logout must not reload')
    f.close()
  }
  {
    const f = await fixture()
    f.age(); f.state.cookies = []; f.state.loading = true
    const result = await f.checker.checkSession(f.id, { recoverWebSession: true })
    assert.equal(result.success, false)
    assert.equal(f.state.failedWrites, 0, 'cookie gap while navigation is not confirmed logout')
    assert.equal(f.state.reloads, 0)
    f.close()
  }
  {
    const f = await fixture()
    f.age(); f.state.crashed = true; f.wc.emit('render-process-gone')
    assert.equal(f.service.takeRecovery(f.id), false)
    assert.equal((await f.checker.checkSession(f.id, { recoverWebSession: true })).success, false)
    assert.equal(f.state.reloads, 0, 'never reload crashed webContents')
    assert.equal(f.state.failedWrites, 0)
    f.close()
  }
  {
    const f = await fixture()
    f.state.loading = true
    const check = f.checker.checkSession(f.id, { recoverWebSession: true })
    f.close()
    assert.equal((await check).success, false)
    assert.equal(f.state.reloads, 0, 'detaching cancels recovery')
    assert.equal(f.state.failedWrites, 0)
  }
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
async function pollerFixture() {
  const f = await fixture('chưa đăng nhập')
  const other = await fixture()
  f.age()
  const state = { claims: [], releases: [], producers: 0, dbReads: 0, fbChecks: 0, events: [],
    claimGate: null, cleanupGate: null, claimSucceeds: true, producerThrows: false, user: { staffId: 1 } }
  const held = new Set()
  const fixtures = new Map([[f.id, f], [other.id, other]])
  const fb = { id: 99999, flatformType: 'facebook', loginStatus: 'đã đăng nhập' }
  const pages = new Map([...fixtures].map(([id, item]) => [id, item.wc]))
  pages.set(fb.id, { isDestroyed: () => false, getURL: () => 'https://www.facebook.com/',
    executeJavaScript: async () => { state.fbChecks++; return { loggedIn: true } } })
  let tick
  const out = {}
  const repository = {
    listAccounts: async () => { state.dbReads++; return [f.state.account, other.state.account, fb] },
    claimZaloAccountRuntimeOperation: async (...args) => {
      state.claims.push(args)
      assert.equal(args[2], false)
      assert.equal(args[3], 'zalo.web.recover')
      held.add(args[0])
      if (state.claimGate) await state.claimGate.promise
      if (!state.claimSucceeds) { held.delete(args[0]); return { claimed: false } }
      return { claimed: true, previousStatus: 'chờ xử lý', claimToken: `fixture-${args[0]}`, staffId: 1 }
    },
    releaseZaloAccountRuntimeOperation: async (...args) => {
      state.releases.push(args)
      assert.deepEqual(args, [args[0], 'desktop', 'chờ xử lý', 1, `fixture-${args[0]}`])
      if (state.cleanupGate) await state.cleanupGate.promise
      held.delete(args[0])
    },
    markAccountZaloSessionCheck: async (id, result) => fixtures.get(id).checker.supabase.markAccountZaloSessionCheck(id, result)
  }
  const runtime = {
    takeWebSessionRecovery: id => fixtures.get(id).service.takeRecovery(id),
    hasVerifiedWebSession: id => fixtures.get(id).service.hasVerifiedSession(id),
    invalidateWebSession: id => fixtures.get(id).service.invalidate(id),
    checkSession: async (id, options) => {
      state.producers++
      if (state.producerThrows) throw Error('fixture producer failure')
      return fixtures.get(id).checker.checkSession(id, options)
    }
  }
  const dependencies = {
    electron: { webContents: { fromId: id => pages.get(id) } },
    '../../../shared/types': { IPC_EVENTS: { ACCOUNT_STATUS_UPDATED: 'status', CAMPAIGN_LOG: 'log' } },
    '../../data/currentUser': { getCurrentUser: () => state.user },
    '../../data/repositories/accountRepository': repository,
    '../../data/repositories/zaloRuntimeModeRepository': {
      getZaloRuntimeRestartRequired: () => false, isZaloLocalStartupHandoffBlocked: () => false
    },
    '../../services/accountOperationRegistry': { accountOperationRegistry: { has: id => held.has(id) } }
  }
  vm.runInNewContext(compile(read('src/main/domain/accounts/accountPoller.ts')), {
    ...globals, exports: out, setInterval: (fn, ms) => { assert.equal(ms, 30_000); tick = fn },
    require: name => { assert(Object.hasOwn(dependencies, name), name); return dependencies[name] }
  })
  const registry = { listRegistered: () => [...pages.keys()].map(accountId => ({ accountId, connected: true })), getWebContentsId: id => id }
  const controller = out.startAccountPoller(registry, { webContents: { send: (...args) => state.events.push(args) } }, runtime)
  const boundedTick = async () => {
    let timer
    try {
      await Promise.race([tick(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('recovery held shared poller tick')), 250)
      })])
    } finally { clearTimeout(timer) }
  }
  return { f, other, state, held, controller, tick: boundedTick, close: () => { f.close(); other.close() } }
}
async function runPollerChecks() {
  {
    const p = await pollerFixture()
    const { f, state, held, controller } = p
    p.other.state.account.isActive = false
    f.state.account.status = 'đang chạy'
    await p.tick(); assert.equal(state.claims.length, 0)
    f.state.account.status = 'chờ xử lý'; held.add(f.id)
    await p.tick(); assert.equal(state.claims.length, 0)
    held.delete(f.id)
    await p.tick()
    assert.equal(await controller.waitForZaloIdle(250), true)
    assert.equal(state.claims.length, 1); assert.equal(state.releases.length, 1); assert.equal(f.state.reloads, 1)
    for (let i = 0; i < 10; i++) await p.tick()
    assert.equal(state.claims.length, 1, 'exhausted recovery does not poll Supabase')
    f.service.invalidate(f.id); f.age(); state.producerThrows = true
    await p.tick(); assert.equal(await controller.waitForZaloIdle(250), true)
    assert.equal(state.releases.length, 2, 'producer exception still releases its exact claim')
    f.service.invalidate(f.id); f.age(); state.claimSucceeds = false
    await p.tick(); assert.equal(await controller.waitForZaloIdle(250), true)
    await p.tick(); assert.equal(state.claims.length, 3); assert.equal(state.releases.length, 2)
    p.close()
  }
  for (const pendingPhase of ['claim', 'cleanup']) {
    const p = await pollerFixture()
    const { f, state, controller } = p
    const gate = deferred()
    if (pendingPhase === 'claim') state.claimGate = gate
    else state.cleanupGate = gate
    await p.tick()
    await until(() => pendingPhase === 'claim' ? state.claims.length === 1 : state.releases.length === 1)
    assert.equal(await controller.waitForZaloIdle(5), false, 'lifecycle continues to track pending work')
    // Another eligible account must not start a concurrent recovery claim.
    p.other.age()
    for (let i = 0; i < 3; i++) await p.tick()
    assert.equal(state.claims.length, 1, 'single recovery slot avoids accumulating DB claims')
    assert.equal(state.dbReads, 4)
    assert.equal(state.fbChecks, 4, `Facebook checks continue during pending ${pendingPhase}`)
    p.other.state.cookies = []
    await p.tick()
    assert.equal(p.other.state.failedWrites, 1, `other Zalo logout is detected during pending ${pendingPhase}`)
    assert.equal(state.fbChecks, 5)
    assert.equal(await controller.waitForZaloIdle(5), false, 'later ticks cannot forget pending cleanup')
    gate.resolve()
    assert.equal(await controller.waitForZaloIdle(250), true)
    assert.equal(state.releases.length, 1)
    assert.equal(p.held.has(f.id), false, 'claim remains held until actual cleanup completion')
    p.close()
  }
  for (const transition of ['block-reset', 'abandon-reset', 'staff-change']) {
    const p = await pollerFixture()
    const { f, state, controller } = p
    const gate = deferred()
    state.claimGate = gate
    await p.tick()
    assert.equal(state.claims.length, 1)
    if (transition === 'block-reset') { controller.blockZaloRuntime(); controller.resetZaloRuntimeBlock() }
    if (transition === 'abandon-reset') { controller.abandonZaloClaims(); controller.resetZaloClaims() }
    if (transition === 'staff-change') state.user = { staffId: 2 }
    gate.resolve()
    assert.equal(await controller.waitForZaloIdle(250), true)
    assert.equal(state.producers, 0, `${transition}: late claim cannot run an old producer`)
    assert.equal(state.events.length, 0, `${transition}: stale completion cannot notify current staff`)
    assert.equal(state.releases.length, transition === 'abandon-reset' ? 0 : 1,
      'ordinary stop drains original token; abandoned claims are handed to lifecycle recovery')
    assert.equal(f.state.reloads, 0)
    p.close()
  }
}
async function runSchedulerChecks() {
  const parsed = ts.createSourceFile('scheduler.ts', read('src/main/services/campaignScheduler.ts'), ts.ScriptTarget.Latest, true)
  const klass = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'CampaignScheduler')
  const tick = klass.members.find(node => node.name?.getText(parsed) === 'tick')
  const out = {}
  vm.runInNewContext(compile(`export class SchedulerSubject { ${tick.getText(parsed)} }`), {
    ...globals, exports: out, queueMicrotask,
    accountOperationRegistry: { has: () => false }, isSchedulerConnectivityError: () => false,
    getErrorMessage: error => { throw error }
  })
  const accounts = [
    { id: 1, flatformType: 'zalo', isZaloShowWeb: true },
    { id: 2, flatformType: 'facebook' },
    { id: 3, flatformType: 'zalo', isZaloShowWeb: false }
  ].map(account => ({ ...account, status: 'chờ xử lý', loginStatus: 'đã đăng nhập' }))
  const started = []
  let ready = false
  const scheduler = new out.SchedulerSubject()
  Object.assign(scheduler, {
    running: true, activeAccountRuns: new Set(), externalAccountRuns: new Set(),
    getReadyRuntimeClock: async () => ({ dbNow: new Date().toISOString() }),
    supabase: {
      enableDueAccountActions: async () => {}, getEligibleAccounts: async () => accounts,
      getPendingCampaigns: async id => [{ id, accountId: id }]
    },
    shouldProcessAccountForRuntime: () => true, isSmsAccount: () => false,
    finalizeDataGroupCampaignAtHardEnd: async () => false, isRealtimeCampaignDisabledForRuntime: () => false,
    zaloRuntime: { hasVerifiedWebSession: () => ready }, isBrowserlessCampaign: () => true,
    webviewRegistry: { isRegistered: () => true },
    startAccountCampaignQueue: account => started.push(account.id), sendLog: message => assert.fail(message)
  })
  await scheduler.tick()
  assert.deepEqual(started, [2, 3], 'unverified Web waits; FB/QR still run')
  started.length = 0; ready = true
  await scheduler.tick()
  assert.deepEqual(started, [1, 2, 3], 'verified Web resumes ordinary scheduling')
}
(async () => {
  await runServiceChecks()
  await runPollerChecks()
  await runSchedulerChecks()
  console.log('Zalo Web recovery smoke passed: unknown/logout, late bootstrap, one reload, manual retry, crash, HTTP/body timeout, single profile verification, recovery budget, pending claim/cleanup isolation, lifecycle fencing and no repeated DB calls.')
})().catch(error => { console.error(error); process.exitCode = 1 })
