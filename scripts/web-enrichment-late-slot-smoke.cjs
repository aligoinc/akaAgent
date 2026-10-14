// Actual planner/service/browser cancellation with offline clock, DB and page adapters.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), root = path.resolve(__dirname, '..')
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
const day = '2026-10-15', at = value => Date.parse(`${day}T${value}+07:00`)
const midnight = Date.parse('2026-10-16T00:00:00+07:00'), flush = () => new Promise(resolve => setImmediate(resolve))
const config = { ...shared.emptyWebEnrichmentConfig(), revision: 1, industry: 'Fixture',
  keywords: ['one', 'two', 'three'], websites: ['a', 'b', 'c'].map(x => `https://${x}.example/`),
  slots: ['00:25', '23:55'], minutesPerSession: 10, stopDate: null }
const account = { id: 1, flatformType: 'facebook', isActive: true, status: 'chờ xử lý',
  loginStatus: 'đã đăng nhập', facebookWebEnrichmentEnabled: true, facebookWebEnrichmentRevision: 1 }
const observe = (p, time, c = config) => p.observe(c, at(time), day, midnight)
const passed = []
async function fixture(initial = account, initialConfig = config) {
  const f = { now: at('00:30:00'), clockReady: true, profileReady: true, runs: 0, destroyed: 0,
    settings: { enabled: initial.facebookWebEnrichmentEnabled, config: initialConfig } }
  f.read = async () => f.settings
  const { WebEnrichmentService } = load('src/main/services/webEnrichmentService.ts', {
    '../../shared/facebookWebEnrichment': shared, './webEnrichmentPlanner': planner,
    './webEnrichmentBrowser': browser, './webEnrichmentControl': control,
    '../data/repositories/runtimeClockRepository': { peekDatabaseRuntimeClock: () => f.clockReady ? {
      dbNow: new Date(f.now).toISOString(), vietnamDateKey: day, nextVietnamMidnight: new Date(midnight).toISOString()
    } : null },
    '../data/repositories/webEnrichmentRepository': { webEnrichmentRpc: () => f.read() },
    '../data/repositories/workflowV2Repository': {}, '../data/repositories/blockRepository': {}, '../data/supabaseClient': {},
    './accountLogService': { recordAccountLog() {} },
    '../v2/runtime/workflowEngine': { WorkflowEngineV2: class { async run() { f.runs++; return { status: 'completed' } } } }
  })
  f.service = new WebEnrichmentService({ ready: () => f.profileReady, createPage: () => ({ page: {}, destroy() { f.destroyed++ } }), wake() {} })
  f.service.start(); f.service.package = { workflow: {}, blocks: new Map(), selectors: {} }
  f.service.observe([initial]); await flush()
  f.refresh = async (a = account) => { f.service.observe([a]); await flush() }
  f.revise = async ({ local = true, enabled = true, changes = {} } = {}) => {
    f.settings = { enabled, config: { ...f.settings.config, ...changes, revision: f.settings.config.revision + 1 } }
    if (local) f.service.invalidate(1)
    f.live = { ...account, facebookWebEnrichmentEnabled: enabled, facebookWebEnrichmentRevision: f.settings.config.revision }
    await f.refresh(f.live)
    return f.live
  }
  return f
}
async function main() {
  const revised = new planner.WebEnrichmentPlanner()
  assert.equal(observe(revised, '00:30:00').key, '00:25')
  assert.equal(observe(revised, '00:31:00', { ...config, revision: 2 })?.key, '00:25', 'saving inside the window must retain eligibility')
  passed.push('pending-revision-inside-window')
  for (const [time, allowed] of [['00:54:59', true], ['00:55:00', false], ['00:55:01', false]]) {
    const p = new planner.WebEnrichmentPlanner()
    observe(p, '00:24:00', { ...config, slots: ['23:55'] })
    assert.equal(!!observe(p, time, { ...config, revision: 2 }), allowed)
    passed.push(`new-slot-${time}`)
  }
  const capped = new planner.WebEnrichmentPlanner()
  observe(capped, '00:30:00')
  assert.equal(observe(capped, '00:35:00', { ...config, revision: 2, slots: ['00:25', '00:35'] })?.key, '00:35')
  const midnightSlot = new planner.WebEnrichmentPlanner()
  assert.equal(observe(midnightSlot, '23:59:00')?.key, '23:55')
  assert.equal(midnightSlot.pending.expires, midnight)
  passed.push('next-slot-and-midnight-cap')
  const remaining = new planner.WebEnrichmentPlanner()
  observe(remaining, '00:24:00', { ...config, slots: ['23:55'] })
  const revisedConfig = { ...config, revision: 2 }
  assert.equal(observe(remaining, '00:54:00', revisedConfig)?.key, '00:25', 'an unused slot is immediately eligible inside its window')
  assert.equal(remaining.pending.expires, at('00:55:00'))
  assert.equal(observe(remaining, '00:54:15', revisedConfig)?.key, '00:25')
  assert.equal(remaining.pending.expires, at('00:55:00'), 'ticks must not extend the start window')
  assert.equal(observe(remaining, '00:54:30', revisedConfig)?.key, '00:25')
  passed.push('immediate-start-in-remaining-window')
  const waiting = new planner.WebEnrichmentPlanner()
  observe(waiting, '00:30:00')
  assert.equal(observe(waiting, '01:00:00'), undefined, 'an accepted slot must expire while waiting for a campaign')
  assert.equal(observe(waiting, '01:01:00', revisedConfig), undefined, 'saving after the window cannot reacquire a discarded slot')
  passed.push('save-after-window-drops-old-pending')
  for (const [time, allowed] of [['00:30:00', true], ['00:54:59', true], ['00:55:00', false], ['00:56:00', false]]) {
    const f = await fixture({ ...account, status: 'đang chạy' })
    try {
      await f.refresh({ ...account, status: 'đang chạy' })
      assert.equal(f.service.tryRun({ ...account, status: 'đang chạy' }, false), undefined)
      f.now = at(time); await f.refresh()
      const running = f.service.tryRun(account, false)
      assert.equal(!!running, allowed, 'start as soon as the account is idle, only before the window closes')
      await running; assert.equal(f.runs, allowed ? 1 : 0)
    } finally { f.service.stop() }
    passed.push(`idle-after-campaign-${time}`)
  }
  const unavailable = await fixture()
  try {
    unavailable.profileReady = false; await unavailable.refresh()
    assert.equal(unavailable.service.tryRun(account, false), undefined)
    unavailable.now = at('00:55:00'); unavailable.profileReady = true
    assert.equal(unavailable.service.tryRun(account, false), undefined, 'profile readiness cannot extend the window')
  } finally { unavailable.service.stop() }
  passed.push('profile-ready-after-window-skips-slot')
  for (const [time, allowed] of [['00:54:59', true], ['00:55:00', false]]) {
    const f = await fixture(), other = { ...account, id: 2 }
    try {
      f.service.observe([account, other]); await flush()
      f.service.engine.run = async () => { f.runs++; return new Promise(() => {}) }
      const first = f.service.tryRun(account, false); assert.ok(first)
      assert.equal(f.service.tryRun(other, false), undefined, 'one optional session per Desktop')
      f.now = at(time); f.service.preempt(account.id); await first
      f.service.engine.run = async () => { f.runs++; return { status: 'completed' } }
      const second = f.service.tryRun(other, false)
      assert.equal(!!second, allowed, 'waiting for another account must respect the original deadline')
      await second; assert.equal(f.runs, allowed ? 2 : 1)
    } finally { f.service.stop() }
    passed.push(`desktop-capacity-released-${time}`)
  }
  const startedLate = await fixture()
  try {
    let remainingBudget
    startedLate.service.engine.run = async (_workflow, variables) => {
      startedLate.runs++; remainingBudget = variables.webUntil - Date.now()
      return new Promise(() => {})
    }
    startedLate.now = at('00:54:59')
    const running = startedLate.service.tryRun(account, false); assert.ok(running)
    assert.ok(remainingBudget > 599_000, 'starting near the cutoff keeps the configured ten-minute session')
    startedLate.now = at('00:55:01'); await startedLate.refresh()
    assert.equal(startedLate.service.isActive(account.id), true, 'the start window does not cancel a running session')
    startedLate.service.preempt(account.id); await running
    assert.equal(startedLate.destroyed, 1)
  } finally { startedLate.service.stop() }
  passed.push('running-session-keeps-duration-past-start-window')
  const overlapping = new planner.WebEnrichmentPlanner()
  observe(overlapping, '00:26:00'); overlapping.started(at('00:26:00')); overlapping.finished(at('00:40:00'))
  assert.equal(observe(overlapping, '00:41:00', { ...config, revision: 2, slots: ['00:25', '00:30', '23:55'] }), undefined)
  passed.push('save-cannot-replay-overlapped-slot')
  for (const local of [true, false]) {
    const f = await fixture()
    try {
      await f.refresh(); f.now = at('00:31:00')
      const live = await f.revise({ local })
      const running = f.service.tryRun(live, false)
      assert.ok(running, 'a pending slot survives local/remote config revision inside its window')
      await running; assert.equal(f.runs, 1)
    } finally { f.service.stop() }
    passed.push(local ? 'local-save' : 'remote-revision')
  }
  for (const initialEnabled of [false, true]) {
    const f = await fixture({ ...account, facebookWebEnrichmentEnabled: initialEnabled })
    try {
      if (initialEnabled) { await f.refresh(); await f.revise({ enabled: false }) }
      f.now = at('00:31:00')
      const live = await f.revise()
      assert.ok(f.service.canRun(live, false)); await f.service.tryRun(live, false)
      assert.equal(f.runs, 1)
    } finally { f.service.stop() }
    passed.push(initialEnabled ? 'enable-pending-slot-again' : 'first-enable-inside-window')
  }
  for (const outcome of ['completed', 'failed', 'running']) {
    const f = await fixture()
    try {
      if (outcome !== 'completed') f.service.engine.run = async () => {
        f.runs++; return outcome === 'failed' ? { status: 'failed' } : new Promise(() => {})
      }
      const original = f.service.tryRun(account, false); assert.ok(original)
      if (outcome !== 'running') await original
      f.now = at('00:31:00'); const live = await f.revise(); await original
      assert.equal(f.service.tryRun(live, false), undefined, 'a consumed slot must never be replayed after save')
      assert.equal(f.runs, 1); assert.equal(f.destroyed, 1)
    } finally { f.service.stop() }
    passed.push(`no-replay-${outcome}`)
  }
  for (const boundary of ['pause', 'manual', 'removed']) {
    const f = await fixture()
    try {
      await f.refresh(); f.now = at('00:31:00')
      if (boundary === 'pause') await f.refresh({ ...account, status: 'tạm dừng' })
      if (boundary === 'manual') f.service.preempt(1)
      if (boundary === 'removed') f.service.observe([])
      const live = await f.revise()
      assert.equal(f.service.tryRun(live, false), undefined)
      assert.equal(f.runs, 0)
    } finally { f.service.stop() }
    passed.push(`preserve-${boundary}`)
  }
  const toggled = await fixture()
  try {
    await toggled.service.tryRun(account, false)
    await toggled.revise({ enabled: false })
    const live = await toggled.revise()
    assert.equal(toggled.service.tryRun(live, false), undefined)
    assert.equal(toggled.runs, 1)
  } finally { toggled.service.stop() }
  passed.push('toggle-cannot-replay-consumed-slot')
  const priority = await fixture()
  try {
    const live = await priority.revise()
    assert.equal(priority.service.tryRun(live, true), undefined)
    priority.service.campaignFinished(1)
    assert.ok(priority.service.canRun(live, true)); await priority.service.tryRun(live, true)
    assert.equal(priority.runs, 1)
  } finally { priority.service.stop() }
  passed.push('campaign-priority-after-save')
  const cold = await fixture()
  try {
    cold.clockReady = false; const live = await cold.revise()
    assert.equal(cold.service.canRun(live, false), false)
    cold.clockReady = true; await cold.refresh(live)
    assert.ok(cold.service.canRun(live, false)); await cold.service.tryRun(live, false)
  } finally { cold.service.stop() }
  passed.push('save-with-cold-clock')
  const expired = await fixture(account, { ...config, stopDate: '2026-10-14' })
  try {
    await expired.refresh()
    const live = await expired.revise({ changes: { stopDate: null } })
    assert.ok(expired.service.canRun(live, false)); await expired.service.tryRun(live, false)
  } finally { expired.service.stop() }
  passed.push('extend-stop-date-inside-window')
  const stale = await fixture()
  try {
    let resolve
    stale.service.invalidate(1)
    stale.read = () => new Promise(r => { resolve = r })
    stale.service.observe([account])
    stale.service.invalidate(1)
    resolve(stale.settings); await flush()
    assert.equal(stale.service.accounts.get(1).settings, undefined, 'late config reads must not undo a successful save')
    stale.read = async () => stale.settings
    const live = await stale.revise()
    assert.ok(stale.service.canRun(live, false)); await stale.service.tryRun(live, false)
  } finally { stale.service.stop() }
  passed.push('ignore-stale-config-load')
  assert.equal(control.webEnrichmentSnapshot().length, 0)
  console.log(JSON.stringify({ cases: passed.length, passed, externalOperations: 0 }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
