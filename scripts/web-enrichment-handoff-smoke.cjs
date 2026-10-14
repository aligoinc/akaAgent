// Real scheduler/service/planner/browser fence, with offline DB/page adapters.
// Covers the review regressions without customer accounts or external navigation.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), { schedulerClass } = require('./campaign-media-timeout-smoke-test.cjs')
const root = path.resolve(__dirname, '..')
function load(file, imports = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext(code, { exports, require: name => imports[name] ?? require(name), console, process,
    URL, Date, Math, Map, Set, Promise, AbortController, AbortSignal, setTimeout, clearTimeout, setImmediate })
  return exports
}
const shared = load('src/shared/facebookWebEnrichment.ts'), planner = load('src/main/services/webEnrichmentPlanner.ts')
const browser = load('src/main/services/webEnrichmentBrowser.ts'), control = load('src/main/services/webEnrichmentControl.ts')
const randomShared = load('src/shared/facebookRandomRun.ts')
const at = value => Date.parse(`2026-10-14T${value}:00+07:00`)
const flush = () => new Promise(resolve => setImmediate(resolve))
let now = at('08:00'), runs = 0, destroyed = 0, onBrowse = () => {}, clockReady = true
const clock = () => clockReady ? { dbNow: new Date(now).toISOString(), vietnamDateKey: '2026-10-14', nextVietnamMidnight: '2026-10-14T17:00:00Z' } : null
const config = { ...shared.emptyWebEnrichmentConfig(), revision: 1, industry: 'Fixture',
  keywords: ['one', 'two', 'three', 'four', 'five'], websites: ['a', 'b', 'c', 'd', 'e'].map(x => `https://${x}.example/`),
  slots: ['08:00', '08:30'], minutesPerSession: 5, stopDate: null }
const account = { id: 1, name: 'fixture', flatformType: 'facebook', isActive: true, status: 'chờ xử lý',
  loginStatus: 'đã đăng nhập', facebookWebEnrichmentEnabled: true, facebookWebEnrichmentRevision: 1 }
const campaigns = [3, 4].map(id => ({ id, accountId: 1, name: 'fixture', actionId: 'facebook_group_post',
  status: 'chờ xử lý', schedule: '2026-10-01T00:00:00Z' }))
const { WebEnrichmentService } = load('src/main/services/webEnrichmentService.ts', {
  '../../shared/facebookWebEnrichment': shared, './webEnrichmentPlanner': planner, './webEnrichmentBrowser': browser, './webEnrichmentControl': control,
  '../data/repositories/runtimeClockRepository': { peekDatabaseRuntimeClock: clock },
  '../data/repositories/webEnrichmentRepository': { webEnrichmentRpc: async () => ({ enabled: true, config }) },
  '../data/repositories/workflowV2Repository': {}, '../data/repositories/blockRepository': {}, '../data/supabaseClient': {},
  './accountLogService': { recordAccountLog() {} },
  '../v2/runtime/workflowEngine': { WorkflowEngineV2: class { async run() { runs++; onBrowse(); return { status: 'completed' } } } }
})
let operationBusy = false
const registry = { accountOperationRegistry: { has: () => operationBusy } }
const Scheduler = schedulerClass({}, { './accountOperationRegistry': registry })
async function serviceFor(a = account) {
  now = at('08:00'); clockReady = true; operationBusy = false; onBrowse = () => {}
  const service = new WebEnrichmentService({ ready: () => !operationBusy,
    createPage: () => ({ page: {}, destroy() { destroyed++ } }), wake() {} })
  service.start(); service.package = { workflow: {}, blocks: new Map(), selectors: {} }
  service.observe([a]); await flush()
  return service
}
function queue(service, db, Class = Scheduler) {
  const scheduler = new Class(db, {}, { webContents: { send() {} } })
  Object.assign(scheduler, { running: true, getReadyRuntimeClock: async () => clock(), webEnrichment: service, sendLog() {} })
  return scheduler
}
const passed = []
async function main() {
  // A campaign handing the account back must honor the original 30-minute
  // start window, even when the next configured slot is hours away.
  for (const [finish, allowed] of [[at('08:00'), true], [at('08:30') - 1, true], [at('08:30'), false], [at('08:31'), false]]) {
    const service = await serviceFor(), before = runs, events = []
    service.accounts.get(1).settings.config = { ...config, slots: ['08:00', '12:00'] }
    service.observe([account])
    onBrowse = () => events.push('browse')
    const scheduler = queue(service, { getAccount: async () => account, getCampaign: async id => campaigns.find(c => c.id === id) })
    scheduler.executeCampaign = async (_a, c) => { events.push(`execute:${c.id}`); now = finish; events.push(`released:${c.id}`) }
    await scheduler.runAccountCampaignQueue(account, campaigns)
    assert.equal(runs - before, allowed ? 1 : 0, 'campaign handoff uses a bounded start window')
    if (allowed) assert.deepEqual(events, ['execute:3', 'released:3', 'browse', 'execute:4', 'released:4'])
    service.stop(); passed.push(`campaign-window-${finish - at('08:00')}ms`)
  }
  // Actual executeCampaign early returns must never fall through to stale browsing.
  for (const reason of ['account_not_available', 'daily_drain_due', 'vietnam_day_changed', 'concurrency_limit_reached']) {
    const service = await serviceFor(), before = runs
    const live = reason === 'account_not_available' ? { ...account, status: 'tạm dừng' } : account
    const scheduler = queue(service, { getAccount: async () => live, getCampaign: async id => campaigns.find(c => c.id === id),
      getCampaignAction: async () => null, claimCampaignRuntimeV2: async () => ({ ok: false, reason }) })
    scheduler.executeCampaign = scheduler.executeCampaignWithResultContext.bind(scheduler)
    await scheduler.runAccountCampaignQueue(account, campaigns)
    assert.equal(runs, before, reason); service.stop(); passed.push(reason)
  }

  // Existing next-iteration read supplies the post-cleanup state; no extra DB read.
  for (const [name, patch] of [
    ['normal-ready', {}], ['normal-paused', { status: 'tạm dừng' }], ['normal-busy', { status: 'đang chạy' }],
    ['normal-disabled', { isActive: false }], ['normal-logged-out', { loginStatus: 'chưa đăng nhập' }],
    ['feature-disabled', { facebookWebEnrichmentEnabled: false }], ['revision-changed', { facebookWebEnrichmentRevision: 2 }],
    ['proxy-changed', { proxyId: 99 }], ['normal-deleted', null]
  ]) {
    const service = await serviceFor(), before = runs, events = []
    let live = account, reads = 0
    onBrowse = () => events.push('browse')
    const scheduler = queue(service, { getAccount: async () => { reads++; return live }, getCampaign: async id => campaigns.find(c => c.id === id) })
    scheduler.executeCampaign = async (_a, c) => {
      events.push(`execute:${c.id}`)
      if (c.id === 3) live = patch === null ? null : { ...account, ...patch }
      events.push(`released:${c.id}`)
    }
    await scheduler.runAccountCampaignQueue(account, campaigns)
    assert.equal(runs - before, name === 'normal-ready' ? 1 : 0, name)
    assert.equal(reads, 2, 'reuse the two existing queue reads')
    if (name === 'normal-ready') assert.deepEqual(events, ['execute:3', 'released:3', 'browse', 'execute:4', 'released:4'])
    service.stop(); passed.push(name)
  }

  for (const failure of ['ownership-lost', 'cleanup-pending', 'unit-pending', 'manual-operation']) {
    const service = await serviceFor(), before = runs
    const scheduler = queue(service, { getAccount: async () => account, getCampaign: async id => campaigns.find(c => c.id === id) })
    scheduler.executeCampaign = async (_a, c) => {
      if (failure === 'ownership-lost') scheduler.boundaryStoppedAccountQueues.add(account.id)
      if (failure === 'cleanup-pending') scheduler.hasFailedAccountRun = () => true
      if (failure === 'unit-pending') scheduler.activeCampaignRunUnits.set(c.id, {})
      if (failure === 'manual-operation') operationBusy = true
    }
    await scheduler.runAccountCampaignQueue(account, campaigns)
    assert.equal(runs, before, failure); service.stop(); passed.push(failure)
  }

  // Last campaign exits without a stale handoff; the existing fresh tick can still run it.
  {
    const service = await serviceFor(), before = runs
    const scheduler = queue(service, { getAccount: async () => account, getCampaign: async () => campaigns[0] })
    scheduler.executeCampaign = async () => {}
    await scheduler.runAccountCampaignQueue(account, [campaigns[0]])
    assert.equal(runs, before)
    service.observe([account]); await service.tryRun(account, false)
    assert.equal(runs, before + 1); service.stop(); passed.push('queue-exit-fresh-tick')
  }

  // Random turns must finish before the next live-account read and browsing.
  for (const mode of ['ready', 'paused-before-queue', 'paused-after-turn', 'boundary', 'finish-error', 'unit-pending']) {
    const initial = { ...account, facebookRandomRunEnabled: true }, service = await serviceFor(initial), before = runs, events = []
    let live = mode === 'paused-before-queue' ? { ...initial, status: 'tạm dừng' } : initial, rounds = 0
    onBrowse = () => events.push('browse')
    const rules = [{ campaignActionId: 'facebook_group_post', unit: 'data', quantity: 1 }]
    const rpc = {
      getRandomSettings: async () => ({ enabled: true, config: { version: 1, revision: 1, rules } }),
      planRandomRound: async () => ({ enabled: true, turns: ++rounds === 1 ? campaigns.map((c, i) => ({
        ...rules[0], id: String(i), campaignId: c.id, revision: 1, processed: 0 })) : [] }),
      finishRandomTurn: async (_id, turn) => {
        if (mode === 'finish-error') throw Error('unconfirmed finish')
        events.push(`finished:${turn.campaignId}`)
        if (mode === 'paused-after-turn') live = { ...initial, status: 'tạm dừng' }
        return { ...turn, status: 'completed' }
      }
    }
    const RandomScheduler = schedulerClass({}, { './accountOperationRegistry': registry,
      '../../shared/facebookRandomRun': randomShared, '../data/repositories/facebookRandomRunRepository': rpc })
    const scheduler = queue(service, { getAccount: async () => live, getPendingCampaigns: async () => campaigns,
      getCampaign: async id => campaigns.find(c => c.id === id) }, RandomScheduler)
    scheduler.randomCampaignBlockedReason = async () => null
    scheduler.logCampaignProgress = async () => {}
    scheduler.executeCampaign = async (_a, c) => {
      events.push(`execute:${c.id}`); scheduler.facebookRandomTurns.get(c.id).processed = 1
      if (mode === 'boundary') scheduler.boundaryStoppedAccountQueues.add(account.id)
      if (mode === 'unit-pending') scheduler.activeCampaignRunUnits.set(c.id, {})
    }
    if (mode === 'finish-error') await assert.rejects(scheduler.runAccountCampaignQueue(initial, campaigns), /unconfirmed finish/)
    else await scheduler.runAccountCampaignQueue(initial, campaigns)
    assert.equal(runs - before, mode === 'ready' ? 1 : 0, mode)
    if (mode === 'ready') assert.deepEqual(events, ['execute:3', 'finished:3', 'browse', 'execute:4', 'finished:4'])
    service.stop(); passed.push(`random-${mode}`)
  }

  // Exercise the actual tick and random candidate filter: scheduled != runnable.
  for (const mode of ['outside-rules', 'no-due-data', 'eligible', 'eligible-after-read-error', 'active-browse']) {
    const initial = { ...account, facebookRandomRunEnabled: true, facebookRandomRunRevision: 1 }
    const service = await serviceFor(initial)
    await service.tryRun(initial, false)
    const before = runs, events = []
    const campaign = { ...campaigns[0], actionId: mode === 'outside-rules' ? 'facebook_timeline_post' : 'facebook_group_post' }
    const randomConfig = { version: 1, revision: 1, rules: [{ campaignActionId: 'facebook_group_post', quantity: 1, unit: 'data' }] }
    let eligible = mode === 'eligible', reads = 0, optionalReads = 0, executions = 0, plans = 0, releaseBrowse
    const rpc = {
      getRandomSettings: async () => ({ enabled: true, config: randomConfig }),
      planRandomRound: async (_id, _config, choices) => {
        plans++; events.push(`plan:${choices.length}`)
        return { enabled: true, config: randomConfig, turns: choices.map(choice => ({ ...randomConfig.rules[0],
          id: 'turn', revision: 1, campaignId: choice.campaignId, processed: 0 })) }
      },
      finishRandomTurn: async (_id, turn) => { events.push('finish'); return { ...turn, status: 'completed' } }
    }
    const RandomScheduler = schedulerClass({}, { './accountOperationRegistry': registry,
      '../../shared/facebookRandomRun': randomShared, '../data/repositories/facebookRandomRunRepository': rpc })
    const scheduler = queue(service, {
      getEligibleAccounts: async () => [initial], enableDueAccountActions: async () => {},
      getAccount: async (_id, signal) => {
        reads++
        if (signal) { optionalReads++; if (mode === 'eligible-after-read-error' && optionalReads === 1) throw Error('offline') }
        return initial
      },
      getPendingCampaigns: async () => [campaign], getCampaign: async () => campaign,
      getCampaignAction: async () => ({ isActive: true }),
      listCampaignInputData: async () => eligible ? [{ status: 'chờ xử lý' }] : []
    }, RandomScheduler)
    scheduler.webviewRegistry = { isRegistered: () => true }
    scheduler.finalizeDataGroupCampaignAtHardEnd = async () => false
    scheduler.resolveCampaignWorkflow = () => ({ workflowId: 1 })
    scheduler.getCampaignPreclaimLimitStatus = async () => null
    scheduler.logCampaignProgress = async () => {}
    scheduler.executeCampaign = async (_a, c) => {
      executions++; events.push('execute'); eligible = false
      scheduler.facebookRandomTurns.get(c.id).processed = 1
    }
    onBrowse = () => events.push('browse')
    if (mode === 'active-browse') service.engine.run = async () => {
      runs++; onBrowse(); await new Promise(resolve => { releaseBrowse = resolve }); return { status: 'completed' }
    }
    now = at('08:30'); await scheduler.tick(); await flush()
    if (mode === 'eligible-after-read-error') {
      assert.equal(runs, before); assert.equal(service.accounts.get(1).preferCampaign, true)
      eligible = true; now = at('08:31'); await scheduler.tick(); await flush()
    }
    assert.equal(runs - before, 1, mode)
    if (mode === 'eligible' || mode === 'eligible-after-read-error') {
      assert.equal(executions, 1)
      assert.ok(events.indexOf('execute') < events.indexOf('finish') && events.indexOf('finish') < events.indexOf('browse'), mode)
    } else assert.equal(executions, 0, mode)
    if (mode === 'active-browse') {
      const priorPlans = plans
      eligible = true; now = at('08:31'); await scheduler.tick(); await flush()
      assert.equal(service.isActive(1), true, 'new campaign does not interrupt browsing')
      assert.equal(plans, priorPlans); assert.equal(executions, 0)
      releaseBrowse(); await flush()
      assert.equal(service.isActive(1), false)
      now = at('08:35'); await scheduler.tick(); await flush()
      assert.equal(executions, 1, 'campaign runs after browsing releases account')
    }
    now = at('08:40'); await scheduler.tick(); await flush()
    assert.equal(runs - before, 1, 'no replay of consumed slot')
    assert.equal(scheduler.activeAccountRuns.size, 0)
    assert.equal(optionalReads, mode === 'eligible-after-read-error' ? 2 : 1, 'no extra account reads without a due slot')
    assert.ok(reads >= optionalReads)
    service.stop(); passed.push(`random-idle-${mode}`)
  }

  // An empty plan is not permission to reuse a pre-plan account snapshot.
  for (const mode of ['paused', 'busy', 'disabled', 'logged-out', 'feature-off', 'web-revision', 'proxy', 'deleted',
    'random-off', 'random-revision', 'manual-operation', 'preempt', 'boundary', 'cleanup-pending', 'stopped',
    'planner-error', 'planner-disabled', 'planner-config-mismatch', 'settings-disabled', 'no-settings',
    'read-error', 'read-timeout-late-result', 'no-due-slot', 'cold-package', 'slot-expired']) {
    const initial = { ...account, facebookRandomRunEnabled: true, facebookRandomRunRevision: 1 }
    const service = await serviceFor(initial)
    await service.tryRun(initial, false)
    const before = runs
    now = at(mode === 'no-due-slot' ? '08:10' : '08:30')
    if (mode === 'cold-package') service.package = undefined
    const randomConfig = { version: 1, revision: 1, rules: [{ campaignActionId: 'facebook_group_post', quantity: 1, unit: 'data' }] }
    let live = initial, reads = 0, readSignal, lateResult
    const changes = { paused: { status: 'tạm dừng' }, busy: { status: 'đang chạy' }, disabled: { isActive: false },
      'logged-out': { loginStatus: 'chưa đăng nhập' }, 'feature-off': { facebookWebEnrichmentEnabled: false },
      'web-revision': { facebookWebEnrichmentRevision: 2 }, proxy: { proxyId: 99 },
      'random-off': { facebookRandomRunEnabled: false }, 'random-revision': { facebookRandomRunRevision: 2 } }
    const rpc = {
      getRandomSettings: async () => ({ enabled: mode !== 'settings-disabled', config: mode === 'no-settings' ? null : randomConfig }),
      planRandomRound: async () => {
        if (mode === 'planner-error') throw Error('planner unavailable')
        if (changes[mode]) live = { ...initial, ...changes[mode] }
        if (mode === 'deleted') live = null
        return { enabled: mode !== 'planner-disabled', config: { ...randomConfig, revision: mode === 'planner-config-mismatch' ? 2 : 1 }, turns: [] }
      }
    }
    const RandomScheduler = schedulerClass({}, { './accountOperationRegistry': registry,
      '../../shared/facebookRandomRun': randomShared, '../data/repositories/facebookRandomRunRepository': rpc })
    const scheduler = queue(service, {
      getAccount: async (_id, signal) => {
        reads++
        if (signal) {
          readSignal = signal
          if (mode === 'read-error') throw Error('offline')
          if (mode === 'read-timeout-late-result') return new Promise(resolve => { lateResult = resolve })
          if (mode === 'manual-operation') operationBusy = true
          if (mode === 'preempt') service.preempt(1)
          if (mode === 'boundary') scheduler.boundaryStoppedAccountQueues.add(1)
          if (mode === 'cleanup-pending') scheduler.hasFailedAccountRun = () => true
          if (mode === 'stopped') scheduler.running = false
          if (mode === 'slot-expired') now = Date.parse('2026-10-15T00:00:00+07:00')
        }
        return live
      }, getPendingCampaigns: async () => []
    }, RandomScheduler)
    if (mode === 'read-timeout-late-result') {
      // The shared scheduler loader has a manually advanced clock. Bind this
      // actual method to host timers so a hung read really reaches its deadline.
      const Timed = new Function('setTimeout', 'clearTimeout', `return class { ${scheduler.withTimeout.toString()} }`)(setTimeout, clearTimeout)
      scheduler.withTimeout = (promise, ms, message) => {
        assert.equal(ms, 5000); return Timed.prototype.withTimeout.call(scheduler, promise, 10, message)
      }
    }
    if (mode === 'planner-error') await assert.rejects(scheduler.runAccountCampaignQueue(initial, []), /planner unavailable/)
    else await scheduler.runAccountCampaignQueue(initial, [])
    if (readSignal) assert.equal(readSignal.aborted, true)
    if (lateResult) { lateResult(initial); await flush() }
    assert.equal(runs, before, mode)
    assert.equal(service.isActive(1), false, mode)
    if (['planner-error', 'planner-disabled', 'planner-config-mismatch', 'settings-disabled', 'no-settings', 'no-due-slot', 'cold-package'].includes(mode)) {
      assert.equal(reads, 1, 'no handoff read without a confirmed plan and ready slot')
    }
    service.stop(); passed.push(`empty-plan-guard-${mode}`)
  }

  // Removing an account from the eligible snapshot must not erase its session schedule.
  for (const phase of ['completed', 'pending', 'running', 'cold-clock']) {
    const service = await serviceFor(), before = runs
    const savedPlanner = service.accounts.get(1).planner
    let running
    if (phase === 'running') service.engine.run = () => new Promise(() => {})
    if (phase === 'completed' || phase === 'cold-clock') await service.tryRun(account, false)
    if (phase === 'running') running = service.tryRun(account, false)
    if (phase === 'pending') service.observe([account])
    now = at('08:05'); if (phase === 'cold-clock') clockReady = false
    service.observe([]); await running
    assert.equal(service.isActive(1), false)
    assert.equal(service.tryRun(account, false), undefined, 'missing account stays interrupted')
    now = at('08:06'); clockReady = true; service.observe([account]); await flush()
    assert.equal(service.accounts.get(1).planner, savedPlanner)
    assert.equal(service.tryRun(account, false), undefined, 'do not replay 08:00 on re-enable')
    now = at('08:30'); service.observe([account])
    assert.equal(service.tryRun(account, true), undefined, 'campaign priority survives re-enable')
    service.campaignFinished(1)
    service.engine.run = async () => { runs++; return { status: 'completed' } }
    await service.tryRun(account, true)
    assert.equal(runs - before, phase === 'completed' || phase === 'cold-clock' ? 2 : 1)
    service.stop(); assert.equal(service.accounts.size, 0)
    passed.push(`reenable-${phase}`)
  }
  assert.equal(control.webEnrichmentSnapshot().length, 0)
  console.log(JSON.stringify({ cases: passed.length, passed, destroyedPages: destroyed, externalOperations: 0 }))
}
const watchdog = setTimeout(() => { console.error('Handoff smoke did not finish'); process.exit(1) }, 60_000)
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => clearTimeout(watchdog))
