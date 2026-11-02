// Real planning service, AI runtime and deadline helper; controlled clock and I/O.
// No production DB, provider, Facebook, or extra connection.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), ts = require('typescript')
const { schedulerClass } = require('./campaign-media-timeout-smoke-test.cjs')
const root = path.resolve(__dirname, '..')
function load(file, imports = {}, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  new Function('exports', 'require', ...Object.keys(globals), code)(exports,
    name => Object.hasOwn(imports, name) ? imports[name] : require(name), ...Object.values(globals))
  return exports
}
const shared = load('src/shared/facebookRandomRun.ts')
const now = '2026-11-02T03:00:00Z', actionId = 'facebook_group_post', codes = ['fb_post_group', 'fb_comment']
const rules = [{ campaignActionId: actionId, quantity: 3, unit: 'data' }]
const flush = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function clock() {
  let time = 0, next = 0
  const timers = new Map()
  return {
    globals: {
      setTimeout: (fn, delay) => { const id = ++next; timers.set(id, { at: time + delay, fn }); return id },
      clearTimeout: id => timers.delete(id)
    },
    advance: ms => { time += ms; for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.fn() } },
    pending: () => timers.size
  }
}
function fixture({ hold, rows = [] } = {}) {
  const time = clock(), blocked = deferred()
  let onSession, ai = null, settled = false
  const seen = { config: 0, provider: 0, log: 0, operations: [], signals: [], requests: [] }
  const db = { from(table) {
    let after = 0
    const q = {
      select() { return q }, eq() { return q }, in() { return q }, lt() { return q },
      gt(_key, value) { after = value; return q }, order() { return q }, limit() { return q }, abortSignal() { return q },
      then(resolve, reject) { return Promise.resolve({ data: table === 'auto_campaigns' && after === 0 ? rows : [], error: null }).then(resolve, reject) }
    }
    return q
  } }
  const config = {
    using: { id: 1, code: 'app_facebook_random_run_plan', timeoutMs: 120000, requestOptions: {} },
    model: { id: 21, provider: 'openai', model: 'fixture', endpoint: 'https://provider.invalid/v1/responses', defaultBody: {} },
    prompt: { id: 1, promptSystem: 'JSON', promptUser: '{{planContext}}' }
  }
  const runtime = load('src/main/services/aiRuntimeService.ts', {
    '../../shared/formAiClaude': { isFormAiClaude: () => false },
    '../data/supabaseClient': { isTrustedServerSupabaseConfigured: () => false },
    './desktopAiTransport': { fetchDesktopAi: async (_config, _body, signal) => {
      seen.signals.push(signal)
      if (++seen.provider === 1 && hold === 'provider') await blocked.promise // Simulate a transport ignoring abort.
      return new Response(JSON.stringify({ output_text: JSON.stringify({ rules }) }), { status: 200 })
    } },
    '../data/repositories/aiRepository': {
      getAiUsingConfigByCode: async () => { if (++seen.config === 1 && hold === 'config') await blocked.promise; return config },
      createAiLog: async () => { if (++seen.log === 1 && hold === 'log') await blocked.promise; return 1 }
    }
  })
  const service = load('src/main/services/facebookRandomAiService.ts', {
    '../data/supabaseClient': { getSupabaseClient: () => db },
    '../data/currentUser': {
      requireCurrentUser: () => ({ staffId: 1, organizationId: 1, entitlements: { dailySendLimits: { facebookCore: 100 } } }),
      onCurrentUserSessionChanged: fn => { onSession = fn }
    },
    '../data/repositories/campaignActionRepository': {
      listCampaignActions: async () => [{ id: actionId, name: 'Đăng nhóm', flatformType: 'facebook', limitCheckActionCodes: codes }]
    },
    '../data/repositories/facebookRandomRunRepository': { randomRunRpc: async (_id, op, input) => {
      seen.operations.push(op)
      if (op === 'ai_status') return { date: '2026-11-02', ai, canAttempt: !ai || ai.status === 'retry_wait' }
      if (op === 'ai_acquire') {
        seen.requests.push(input.requestId)
        ai = { status: 'generating', requestId: input.requestId, context: input.context, attempts: (ai?.attempts || 0) + 1 }
        return { owned: true, leaseToken: 'fixture', date: '2026-11-02', ai }
      }
      assert.equal(input.requestId, ai.requestId, 'no mutation from an old request')
      if (op === 'ai_fail') ai = { ...ai, status: 'retry_wait' }
      else if (op === 'ai_commit') ai = { ...ai, status: 'ready', rules: input.rules }
      else throw Error(op)
      return { date: '2026-11-02', ai }
    } },
    '../../shared/facebookRandomRun': shared,
    './aiRuntimeService': runtime,
    './requestDeadline': load('src/main/services/requestDeadline.ts', {}, time.globals)
  })
  return {
    service, seen, time, blocked, state: () => ai, isSettled: () => settled,
    ensure: () => { settled = false; return service.ensureFacebookRandomAiPlan({ id: 1 }, 1, now).then(result => { settled = true; return result }) },
    logout: () => { onSession(); ai = null }
  }
}
async function waitFor(read) {
  for (let i = 0; i < 100; i++) { if (read()) return; await flush() }
  throw Error('Expected test boundary was not reached')
}
async function limitsParity() {
  const Scheduler = schedulerClass({}), scheduler = new Scheduler({}, {}, { webContents: { send() {} } })
  const configs = [
    { dailyLimit: 3, rateLimitCount: 1, rateLimitMinutes: 30 },
    { dailyLimit: 3, rateLimitCount: 1, rateLimitMinutes: 30, byActionCode: { fb_post_group: { dailyLimit: 7, rateLimitCount: 2, rateLimitMinutes: 65 } } },
    { dailyLimit: 3, rateLimitCount: 1, rateLimitMinutes: 30, byActionCode: { fb_post_group: { dailyLimit: 9 } } },
    { dailyLimit: 3, rateLimitCount: 1, rateLimitMinutes: 30, byActionCode: { fb_post_group: {} } },
    { dailyLimit: 3, rateLimitCount: 1, rateLimitMinutes: 30, byActionCode: { fb_post_group: null } },
    { dailyLimit: 0, rateLimitCount: 0, rateLimitMinutes: 0 },
    { dailyLimit: -1, rateLimitCount: 'SECRET', rateLimitMinutes: Infinity },
    undefined
  ]
  for (const limits of configs) {
    const row = { id: 1, action_id: actionId, status: 'chờ xử lý', schedule: now, limits, content: 'SECRET' }
    const f = fixture({ rows: [row] })
    const context = await f.service.buildFacebookRandomAiContext({ id: 1 }, now, new AbortController().signal)
    const expected = {}
    for (const code of codes) {
      const effective = scheduler.getCampaignActionLimitConfig(code, limits)
      for (const key of ['dailyLimit', 'rateLimitCount', 'rateLimitMinutes']) {
        const value = effective?.[key]
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) expected[code + '.' + key] = { min: value, max: value }
      }
    }
    assert.deepEqual(context.actions[0].limits, expected)
    assert(!JSON.stringify(context).includes('SECRET'))
  }
  const rows = [3, 8, 100].map((dailyLimit, index) => ({ id: index + 1, action_id: actionId, schedule: now,
    status: index === 2 ? 'tạm dừng' : 'chờ xử lý', limits: { dailyLimit, sleepBetweenActions: 2 } }))
  const f = fixture({ rows })
  const context = await f.service.buildFacebookRandomAiContext({ id: 1 }, now, new AbortController().signal)
  assert.deepEqual(context.actions[0].limits['fb_post_group.dailyLimit'], { min: 3, max: 8 })
  assert.deepEqual(context.actions[0].limits.sleepBetweenActions, { min: 2, max: 2 })
  assert.equal(context.actions[0].pausedCount, 1)
}
async function deadlineCase(hold, cancel, rejectLate) {
  const f = fixture({ hold }), active = f.ensure()
  await waitFor(() => f.seen[hold] === 1)
  assert.equal(f.time.pending(), 1)
  if (cancel === 'logout') f.logout()
  else if (cancel === 'mode') f.service.cancelFacebookRandomAi(1)
  else {
    f.time.advance(119999); await flush()
    assert.equal(f.isSettled(), false)
    f.time.advance(1)
  }
  // No need to release the original I/O to unblock the account.
  await waitFor(f.isSettled)
  assert.equal(await active, false)
  assert.equal(f.time.pending(), 0)
  assert.equal(f.seen.operations.filter(op => op === 'ai_fail').length, cancel === 'logout' ? 0 : 1)
  assert.equal(f.seen.operations.filter(op => op === 'ai_commit').length, 0)
  if (f.seen.signals.length) assert.equal(f.seen.signals[0].aborted, true)
  // Retry admission itself is covered by the SQL smoke; this fixture allows
  // the next attempt immediately to prove the local controller was released.
  assert.equal(await f.ensure(), true)
  const saved = f.state(), writes = f.seen.operations.filter(op => op === 'ai_commit' || op === 'ai_fail')
  if (rejectLate) f.blocked.reject(Error('late I/O failure'))
  else f.blocked.resolve()
  await flush(); await flush()
  assert.deepEqual(f.state(), saved)
  assert.deepEqual(f.seen.operations.filter(op => op === 'ai_commit' || op === 'ai_fail'), writes)
  assert.equal(new Set(f.seen.requests).size, 2)
  assert.equal(f.seen.provider, hold === 'config' ? 1 : 2, 'cancelled metadata cannot start a late provider call')
  assert.equal(f.time.pending(), 0)
}
async function main() {
  const unhandled = [], onUnhandled = reason => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    await limitsParity()
    for (const hold of ['config', 'provider', 'log']) {
      await deadlineCase(hold)
      await deadlineCase(hold, 'mode')
      await deadlineCase(hold, 'logout')
    }
    await deadlineCase('config', undefined, true)
    await deadlineCase('log', undefined, true)
    await flush()
    assert.deepEqual(unhandled, [])
    console.log(JSON.stringify({ limitsParityCases: 8, pausedExcluded: true, deadlineCancellationCases: 11,
      realRuntimeAndDeadline: true, lateResultsDropped: true, controllerReleased: true, externalCalls: 0 }))
  } finally { process.removeListener('unhandledRejection', onUnhandled) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
