// Real Facebook startup + scheduler with local adapters. No production DB/Facebook requests.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const harness = path.join(__dirname, 'facebook-login-smoke-test.cjs')
const prefix = fs.readFileSync(harness, 'utf8').split('async function run() {')[0]
const tests = `
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const flush = () => new Promise(resolve => setImmediate(resolve))
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await flush() }
  assert.fail('Fixture did not reach expected boundary')
}
async function bounded(work) {
  let timer
  try { return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Fixture hung')), 1500) })]) }
  finally { clearTimeout(timer) }
}
// Load the complete scheduler so its real constructor receives the startup guard.
function Stub() {}
const imports = new Proxy({}, { get: (_, key) => key === 'IPC_EVENTS' || key === 'IPC_EVENTS_V2'
  ? new Proxy({}, { get: (_, value) => value }) : Stub })
const schedulerModule = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/main/services/campaignScheduler.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText, { exports: schedulerModule, require: name => name === './accountOperationRegistry'
  ? { accountOperationRegistry: { has: () => false } }
  : ['crypto', 'fs', 'os', 'path'].includes(name) ? require(name) : imports,
  AbortController, Buffer, URL, setTimeout, clearTimeout, queueMicrotask, console,
  setInterval() { throw Error('This fixture invokes the existing scheduler tick directly') }, clearInterval() {} })
function schedulerFixture(service, accounts) {
  const started = [], db = {
    getEligibleAccounts: async () => accounts,
    enableDueAccountActions: async () => {},
    getPendingCampaigns: async id => [{ id, accountId: id }]
  }
  const scheduler = new schedulerModule.CampaignScheduler(db, { isRegistered: () => true }, { webContents: { send() {} } },
    undefined, undefined, undefined, { isAccountStartupPending: account => service.isStartupPending(account) })
  Object.assign(scheduler, {
    running: true, getReadyRuntimeClock: async () => ({ dbNow: new Date().toISOString() }),
    shouldProcessAccountForRuntime: () => true, isSmsAccount: () => false,
    finalizeDataGroupCampaignAtHardEnd: async () => false, isRealtimeCampaignDisabledForRuntime: () => false,
    isBrowserlessCampaign: () => false, runAccountCampaignQueue: async account => { started.push(account.id) },
    sendLog: message => assert.fail(message)
  })
  return { scheduler, started, db, tick: async () => { started.length = 0; await scheduler.tick(); await flush(); return [...started] } }
}
async function runConcurrency() {
  const ids = [40, 41, 42, 43, 44, 45, 46]
  const gates = new Map(ids.map(id => [id, deferred()])), discovery = deferred(), started = [], released = []
  const checkGates = new Map(ids.map(id => [id, deferred()])), checked = []
  const f = fixture({ localState: 'logged_out', startupAccounts: ids, hooks: {
    listAccounts: () => discovery.promise,
    load: async browser => {
      const id = Number(browser.partition.replace('persist:account_', ''))
      if (!checked.includes(id)) { checked.push(id); await checkGates.get(id).promise }
    },
    claim: async args => { const id = args[0]; started.push(id); await gates.get(id).promise;
      return { claimed: true, claimToken: 'token', staffId: 1, previousStatus: 'tạm dừng' } },
    release: async args => { released.push(args[0]); return true }
  } })
  // A healthy account at the end must not queue behind the six missing sessions.
  f.ses('persist:account_46').cookiesData = [{ name: 'c_user', value: '100000000002222', domain: '.facebook.com' }]
  const account = id => ({ ...f.accountFor(id), status: 'chờ xử lý', loginStatus: 'đã đăng nhập' })
  const otherAccounts = [{ ...account(90), facebookLoginManaged: false },
    { ...account(91), flatformType: 'zalo', facebookLoginManaged: false },
    { ...account(92), flatformType: 'email', facebookLoginManaged: false }]
  const s = schedulerFixture(f.service, [...ids.map(account), ...otherAccounts])
  f.service.startSession(); const work = f.service.startupWork
  assert(ids.every(id => f.service.isStartupPending(account(id))), 'barrier starts before discovery completes')
  assert.deepEqual(await s.tick(), [90, 91, 92], 'the startup scheduler tick still runs unmanaged FB/Zalo/Email')
  discovery.resolve(); await until(() => checked.length === ids.length)
  assert.deepEqual(checked, ids, 'all session checks start independently')
  assert.deepEqual(started, [], 'checking a session owns no DB claim')
  for (const gate of checkGates.values()) gate.resolve()
  await until(() => started.length === 1 && !f.service.isStartupPending(account(46)))
  assert.deepEqual(started, [40], 'only one missing session may restore at a time')
  assert.equal(f.service.startupQueued.size, 5)
  assert.deepEqual(await s.tick(), [46, 90, 91, 92], 'the healthy account is ready while missing sessions wait')
  s.scheduler.startAccountCampaignQueue(account(43), [])
  await flush(); assert(!s.started.includes(43), 'direct queue dispatch obeys the same guard')
  gates.get(40).resolve(); await until(() => started.includes(41))
  assert(released.includes(40)); assert.deepEqual(started, [40, 41])
  assert.equal(f.service.isStartupPending(account(40)), false)
  assert.equal(f.service.isStartupPending(account(43)), true)
  assert.deepEqual(await s.tick(), [40, 46, 90, 91, 92], 'finished account can run without waiting for the slow accounts')
  for (const gate of gates.values()) gate.resolve()
  await bounded(work)
  assert.deepEqual(started, ids.slice(0, -1))
  assert.equal(released.length, ids.length - 1)
  assert.equal(f.calls.filter(call => call === 'verify').length, 13, 'one initial check each, plus one promotion check for each restore')
  assert(!f.calls.includes('visible.load'), 'healthy checks do not reload a browser')
  assert.equal(f.service.active.size, 0)
  assert.deepEqual(await s.tick(), [...ids, 90, 91, 92])
  await f.service.stop()

  // The slot remains occupied through cleanup; it cannot be reused while its token is still draining.
  const cleanupGates = new Map([40, 41, 42].map(id => [id, deferred()])), cleaning = [], claims = []
  const cleanup = fixture({ localState: 'logged_out', startupAccounts: [40, 41, 42, 43], hooks: {
    claim: async args => { claims.push(args[0]); return { claimed: true, claimToken: 'token', staffId: 1, previousStatus: 'tạm dừng' } },
    release: async args => { cleaning.push(args[0]); await cleanupGates.get(args[0])?.promise; return true }
  } })
  cleanup.service.startSession(); const cleanupWork = cleanup.service.startupWork
  await until(() => cleaning.length === 1)
  assert.deepEqual(claims, [40])
  assert(cleanup.service.isStartupPending(cleanup.accountFor(40)))
  cleanupGates.get(40).resolve(); await until(() => claims.includes(41))
  assert.deepEqual(claims, [40, 41])
  for (const gate of cleanupGates.values()) gate.resolve()
  await bounded(cleanupWork); await cleanup.service.stop()

  // Stop does not start queued work, and it drains in-flight claims rather than dropping their ownership.
  const stopGates = new Map(ids.map(id => [id, deferred()])), stopClaims = [], stopReleases = []
  const stopped = fixture({ localState: 'logged_out', startupAccounts: ids, hooks: {
    claim: async args => { stopClaims.push(args[0]); await stopGates.get(args[0]).promise;
      return { claimed: true, claimToken: 'token', staffId: 1, previousStatus: 'tạm dừng' } },
    release: async args => { stopReleases.push(args[0]); return true }
  } })
  stopped.service.startSession(); await until(() => stopClaims.length === 1 && stopped.service.startupQueued.size === 6)
  let stoppedDone = false
  const stopping = stopped.service.stop().then(() => { stoppedDone = true })
  await flush(); assert.equal(stoppedDone, false)
  for (const gate of stopGates.values()) gate.resolve()
  await bounded(stopping)
  assert.deepEqual(stopClaims, [40]); assert.deepEqual(stopReleases, [40])
  assert.equal(stopped.service.active.size, 0)
  assert(ids.every(id => !stopped.service.isStartupPending(stopped.accountFor(id))))
  assert.equal(stopped.calls.filter(call => call === 'verify').length, ids.length)
  assert(!stopped.calls.includes('login')); assert(!stopped.calls.includes('copy'))
  stopped.service.startSession(false)
  assert.equal(stopped.service.isStartupPending(stopped.accountFor(40)), false)
  await stopped.service.stop()

  // A failed account or a read timeout must release its local startup barrier and let the queue continue.
  for (const mode of ['error', 'timeout', 'discovery-error']) {
    const readDeadline = load('src/main/services/requestDeadline.ts', {}, { setTimeout: (fn, ms) => setTimeout(fn, ms === 18000 ? 15 : ms) })
    const hooks = mode === 'discovery-error' ? { listAccounts: async () => { throw Error('fixture list failed') } }
      : { getAccount: async id => { if (id === 40) { if (mode === 'error') throw Error('fixture read failed'); await new Promise(() => {}) } } }
    const failed = fixture({ localState: 'logged_out', startupAccounts: ids, readDeadline, hooks })
    failed.service.startSession(); await bounded(failed.service.startupWork)
    assert(ids.every(id => !failed.service.isStartupPending(failed.accountFor(id))), mode)
    assert.equal(failed.service.active.size, 0, mode)
    if (mode !== 'discovery-error') assert.equal(failed.calls.filter(call => call === 'release').length, ids.length - 1)
    await failed.service.stop()
  }

  // Unknown/challenge do not mean logout and must never send a password or claim a restore.
  for (const state of ['unknown', 'challenge']) {
    const f = fixture({ localState: state, startupAccounts: ids })
    f.service.startSession(); await bounded(f.service.startupWork)
    assert(!f.calls.includes('claim')); assert(!f.calls.includes('get')); assert(!f.calls.includes('login'))
    assert.equal(f.service.active.size, 0); await f.service.stop()
  }

  // Ordinary UI changes never cancel a queued restore; a newly authenticated session wins at admission.
  for (const action of ['cookie', 'open-browser', 'close-browser', 'navigation', 'input', 'cancel']) {
    const gate = deferred(), claims = []
    const f = fixture({ localState: 'logged_out', startupAccounts: [40, 41, 42], hooks: {
      claim: async args => { claims.push(args[0]); if (args[0] === 40) await gate.promise;
        return { claimed: true, claimToken: 'token', staffId: 1, previousStatus: 'tạm dừng' } }
    } })
    if (action === 'navigation' || action === 'input') f.mountVisible('logged_out')
    f.service.startSession(); const work = f.service.startupWork
    await until(() => claims.length === 1 && f.service.startupQueued.has(41))
    if (action === 'cookie') f.cookieChanged(41, '100000000002222')
    if (action === 'open-browser') {
      assert.equal(await bounded(f.service.prepareStartupBrowser(41)), true, 'allow reuse only after checking the actually applied proxy')
      f.mountVisible('logged_out'); f.service.startupBrowserRegistered(41, f.service.visible(41))
    }
    if (action === 'close-browser') f.service.detachStartupBrowser(41)
    if (action === 'cancel') f.service.active.get(41).abort.abort()
    if (action === 'navigation') f.service.visible(41).emit('did-start-navigation', {}, 'https://www.facebook.com/login/', false, true)
    if (action === 'input') f.service.visible(41).emit('before-input-event', {}, {})
    if (action === 'cancel') await until(() => !f.service.isStartupPending(f.accountFor(41)))
    else { await flush(); assert(f.service.isStartupPending(f.accountFor(41)), action) }
    assert.deepEqual(claims, [40], action)
    gate.resolve(); await bounded(work)
    assert.equal(claims.includes(41), !['cookie', 'cancel'].includes(action), action)
    if (action === 'cookie') assert.equal(f.ses('persist:account_41').cookiesData[0].value, '100000000002222')
    await f.service.stop()
  }

  // Queuing time does not consume the 120-second restore budget; changed eligibility is re-read at admission.
  for (const change of ['elapsed', 'inactive', 'proxy', 'running', 'manual']) {
    const gate = deferred(), claims = [], deadlines = [], reads = new Map(), proxies = []
    const f = fixture({ localState: 'logged_out', startupAccounts: [40, 41], serviceGlobals: {
      AbortSignal: { any: signals => AbortSignal.any(signals), timeout: ms => {
        const controller = new AbortController(); deadlines.push({ ms, controller }); return controller.signal
      } }
    }, hooks: {
      getProxy: async id => ({ id }),
      applyProxy: async (partition, proxy) => { proxies.push({ partition, proxy }) },
      getAccount: async id => { reads.set(id, (reads.get(id) || 0) + 1) },
      account: (id, c) => ({ ...c.accountFor(id), ...(id === 41 && reads.get(id) === 2
        ? change === 'inactive' ? { isActive: false } : change === 'proxy' ? { proxyId: 9 }
          : change === 'running' ? { status: 'đang chạy' } : change === 'manual' ? { facebookLoginManaged: false } : {} : {}) }),
      claim: async args => { claims.push(args[0]); if (args[0] === 40) await gate.promise;
        return { claimed: true, claimToken: 'token', staffId: 1, previousStatus: 'tạm dừng' } }
    } })
    f.service.startSession(); const work = f.service.startupWork
    await until(() => claims.length === 1 && f.service.startupQueued.has(41))
    // Expire only the initial verification deadlines, as if the predecessor took >120s.
    deadlines[0].controller.abort(); deadlines[1].controller.abort()
    gate.resolve(); await bounded(work)
    assert.deepEqual(claims, ['elapsed', 'proxy'].includes(change) ? [40, 41] : [40], change)
    if (change === 'proxy') assert(proxies.some(p => p.partition === 'persist:account_41' && p.proxy?.id === 9), 'queued restore uses the latest proxy')
    assert.equal(f.service.startupQueued.size, 0); await f.service.stop()
  }

  // A stuck synchronization cannot keep a healthy account pending forever; no late result revives it.
  for (const action of ['metadata', 'observe']) {
    const late = deferred(), entered = deferred()
    const readDeadline = load('src/main/services/requestDeadline.ts', {}, { setTimeout: (fn, ms) => setTimeout(fn, ms === 18000 ? 15 : ms) })
    const f = fixture({ startupAccounts: [40, 41], readDeadline, hooks: {
      rpc: async (name, payload) => { if (name === action && payload.accountId === 40) { entered.resolve(); await late.promise } }
    } })
    f.service.startSession(); const work = f.service.startupWork
    await entered.promise; await bounded(work)
    assert.equal(f.service.active.size, 0); assert(!f.calls.includes('claim'))
    const count = f.calls.length; late.resolve(); await flush()
    assert.equal(f.calls.length, count); await f.service.stop()
  }

  // The admitted restore's fresh deadline must also reach the real generation-fenced claim.
  const lateClaim = deferred(), claimDeadlines = [], timedClaims = [], cleaned = [], registry = new AccountOperationRegistry()
  const timed = fixture({ localState: 'logged_out', startupAccounts: [40, 41], operationRegistry: registry, serviceGlobals: {
    AbortSignal: { any: signals => AbortSignal.any(signals), timeout: () => {
      const controller = new AbortController(); claimDeadlines.push(controller); return controller.signal
    } }
  }, hooks: {
    claim: async args => {
      const context = { accountId: args[0], staffId: 1, platform: 'facebook', runtimeTarget: 'desktop',
        previousStatus: 'tạm dừng', claimToken: 'token', operationName: 'facebook.login', facebookClaimGeneration: 0 }
      return registry.claim(context, async () => {
        timedClaims.push(args[0]); if (args[0] === 40) await lateClaim.promise
        return { claimed: true, ...context }
      }, async () => { cleaned.push(args[0]); return { ok: true, reason: 'cleaned' } }, args[5])
    },
    release: async args => ['cleaned', 'not_owner'].includes(await registry.release(args[0], args[3], 1))
  } })
  timed.service.startSession(); const timedWork = timed.service.startupWork
  await until(() => timedClaims.length === 1 && timed.service.startupQueued.has(41))
  claimDeadlines[2].abort(Error('fixture restore deadline'))
  await bounded(timedWork)
  assert.deepEqual(timedClaims, [40, 41]); assert.deepEqual(cleaned, [40, 41])
  assert.equal(timed.calls.filter(call => call === 'login').length, 1)
  assert(!registry.has(40)); assert(!registry.has(41))
  const timedCount = timed.calls.length; lateClaim.resolve(); await flush()
  assert.equal(timed.calls.length, timedCount); await timed.service.stop()

  // Startup begins during asynchronous campaign preflight: do not issue even the first campaign claim.
  const preflight = deferred(), entered = deferred()
  let pending = false, campaignClaims = 0
  const fence = schedulerFixture({ isStartupPending: () => pending }, [])
  fence.db.getCampaign = async () => ({ id: 1, actionId: 'facebook_message_uid', status: 'chờ xử lý' })
  fence.db.getCampaignAction = async () => ({})
  fence.db.claimCampaignRuntimeV2 = async () => { campaignClaims++; throw Error('unexpected claim') }
  fence.scheduler.getCampaignPreclaimLimitStatus = async () => { entered.resolve(); await preflight.promise; return null }
  fence.scheduler.restoreFacebookPageIdentity = async () => {}
  fence.scheduler.clearZaloSmsPushKeysForCampaign = () => {}
  const dispatch = fence.scheduler.executeCampaign(account(40), { id: 1 })
  await entered.promise; pending = true; preflight.resolve(); await bounded(dispatch)
  assert.equal(campaignClaims, 0)
  console.log('PASS Facebook startup: parallel claim-free checks, serial restore, scheduler isolation, cleanup drain, queue cancellation/deadlines, eligibility recheck, unknown/challenge, bounded synchronization, claim timeout/late response and preclaim race.')
}
runConcurrency().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => fs.rmSync(directory, { recursive: true, force: true }))
`
vm.runInThisContext('(function(require,__dirname){' + prefix + tests + '\n})', { filename: harness })(require, __dirname)
