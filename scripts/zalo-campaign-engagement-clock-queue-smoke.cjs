const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)) }
function load(file, mocks, globals = {}, extra = '') {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8') + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports,
    require: key => Object.hasOwn(mocks, key) ? mocks[key] : require(key),
    console, Buffer, AbortSignal, Date, setTimeout, clearTimeout, ...globals }, { filename: file })
  return module.exports
}

function harness(skew = 17_500) {
  const epoch = Date.parse('2026-10-03T01:00:00Z')
  let elapsed = 0, wallSkew = skew, timers = [], current = { staffId: 1, organizationId: 1 }
  let clockReads = 0, configReads = 0, inFlight = 0, maximumInFlight = 0, rpcOverride, configOverride
  const calls = [], disk = new Map(), watches = new Map()
  const credentials = { username: 'fixture', password: 'fixture' }
  class WallClock extends Date {
    constructor(...args) { super(...(args.length ? args : [epoch + elapsed + wallSkew])) }
    static now() { return epoch + elapsed + wallSkew }
  }
  const globals = { Date: WallClock,
    setTimeout: (fn, ms) => { const timer = { fn, at: elapsed + ms, unref() {} }; timers.push(timer); return timer },
    clearTimeout: timer => { timers = timers.filter(value => value !== timer) }
  }
  const shared = load('src/shared/zaloCampaignEngagement.ts', {}, globals)
  const settings = shared.ENGAGEMENT_KEYS.map((key, i) => ({ key, value: ['true', '5', '100', '48'][i],
    updated_at: '2026-10-02T00:00:00.123456+00:00', is_active: true, is_secret: false }))
  const ownerQuery = { eq() { return this }, abortSignal() { return this },
    maybeSingle: async () => ({ data: credentials }) }
  const client = {
    from: table => ({ select: () => table === 'org_staff' ? ownerQuery : {
      in: () => ({ abortSignal: async () => { configReads++; return configOverride ? configOverride() : { data: settings } } })
    } }),
    rpc(name, args) {
      if (name === 'aka_agent_get_runtime_clock') {
        clockReads++
        return Promise.resolve({ data: { db_now: new Date(epoch + elapsed).toISOString(),
          vietnam_date_key: '2026-10-03', next_vietnam_midnight: '2026-10-03T17:00:00Z' } })
      }
      return { abortSignal: async () => {
        const call = { name, args, elapsed }; calls.push(call)
        maximumInFlight = Math.max(maximumInFlight, ++inFlight)
        try {
          if (rpcOverride) await rpcOverride(call)
          return { data: { enabled: true, updated: 1, recoveryDone: true, catalogDone: true, pending: [],
            items: name.includes('register') ? args.p_items.map(item => watches.get(item.detailId)) : [] } }
        } finally { inFlight-- }
      } }
    }
  }
  const clock = load('src/main/data/repositories/runtimeClockRepository.ts', {
    '../supabaseClient': { getSupabaseClient: () => client },
    'node:perf_hooks': { performance: { now: () => elapsed } }
  }, globals)
  const io = { mkdir: async () => {}, readdir: async () => [],
    stat: async file => { if (!disk.has(file)) throw Object.assign(Error('missing'), { code: 'ENOENT' }); return { size: Buffer.byteLength(disk.get(file)) } },
    readFile: async file => disk.get(file), writeFile: async (file, data) => { disk.set(file, data) },
    rename: async (from, to) => { disk.set(to, disk.get(from)); disk.delete(from) }
  }
  const coordinator = load('src/main/services/zaloCampaignEngagement.ts', {
    electron: { app: { getPath: () => '/fixture' } }, 'node:fs/promises': io,
    '../data/currentUser': { getCurrentUser: () => current, getCurrentUserCredentials: () => credentials },
    '../data/supabaseClient': { getSupabaseClient: () => client },
    '../data/repositories/runtimeClockRepository': clock, '../../shared/zaloCampaignEngagement': shared
  }, globals, '\nexport const testIdle = () => !writing && [...scopes.values()].every(s => !s.saving);')
  const h = {
    coordinator, clock, calls, settings,
    now: () => epoch + elapsed, skew: value => { wallSkew = value },
    counts: () => ({ clockReads, configReads, maximumInFlight, timers: timers.length }),
    user: staffId => { current = { staffId, organizationId: 1 } },
    attach: staffId => coordinator.attachServerCampaignEngagementOwner(staffId, 1),
    warm: async () => { await clock.getDatabaseRuntimeClock(); coordinator.campaignEngagementEnabled(); await settle() },
    rpc: override => { rpcOverride = override },
    config: override => { configOverride = override },
    advance: async ms => {
      elapsed += ms
      const due = timers.filter(timer => timer.at <= elapsed)
      timers = timers.filter(timer => timer.at > elapsed)
      for (const timer of due) timer.fn()
      await settle()
    },
    send(detailId = '1') {
      const context = coordinator.beginCampaignEngagementSend({ id: current.staffId, zaloUid: 'own' }, 'target')
      if (!context.revision) return context
      const source = shared.makeEngagementSource('own', 'target', 'message', context.sentAt,
        { message: { msgId: 'm' + detailId } }, context.revision, context.operationId)
      watches.set(detailId, { campaign_detail_id: detailId, account_id: current.staffId, account_zalo_uid: 'own',
        target_zalo_uid: 'target', action_type: 'message', message_ids: source.messageIds,
        sent_at: source.sentAt, tracking_until: new Date(Date.parse(source.sentAt) + 48 * 3600000).toISOString() })
      coordinator.recordCampaignEngagementDetail(Number(detailId), source)
      return context
    },
    reply: () => coordinator.receiveCampaignEngagement('message', { type: 0, isSelf: false,
      data: { uidFrom: 'target', idTo: 'own', ts: epoch + elapsed } }, current.staffId, 'own'),
    seen: (detailId = '1') => coordinator.receiveCampaignEngagement('seen_messages', {
      type: 0, isSelf: false, threadId: 'target', data: { idTo: 'target', msgId: 'm' + detailId }
    }, current.staffId, 'own')
  }
  return h
}

async function main() {
  // Both positive and negative clock skew: no per-event clock RPC, including
  // seen receipts which have no source timestamp and must use a cached fallback.
  for (const skew of [17_500, -300_000]) {
    const h = harness(skew); await h.warm()
    assert.equal(Date.parse(h.send().sentAt), h.now())
    const pending = h.coordinator.engagementMetrics.backlog
    for (const [accountId, ownUid, targetUid] of [[2, 'own', 'target'], [1, 'other-session', 'target'], [1, 'own', 'unrelated']]) {
      h.coordinator.receiveCampaignEngagement('message', { type: 0, isSelf: false,
        data: { uidFrom: targetUid, idTo: ownUid, ts: h.now() } }, accountId, ownUid)
    }
    assert.equal(h.coordinator.engagementMetrics.backlog, pending, 'pending registration admits only its exact account/session/recipient')
    assert.equal(h.calls.length, 0, 'rejected events cannot trigger a lookup')
    await h.advance(1000); h.reply(); h.seen(); await settle()
    await h.advance(4000); await h.advance(1000)
    const events = h.calls.filter(call => call.name.includes('record')).flatMap(call => call.args.p_items)
    assert.deepEqual(events.map(event => event.kind).sort(), ['message', 'seen'])
    assert(events.every(event => Date.parse(event.occurredAt) === h.now() - 5000))
    assert.equal(h.counts().clockReads, 1)
    assert.equal(h.counts().maximumInFlight, 1)
    // Once background work finishes, an ordinary event still waits 5s, not
    // 5s +/- the host's clock offset. Later arrivals cannot reset its deadline.
    await h.advance(5000); await h.advance(5000)
    const before = h.calls.length; h.reply(); await settle()
    await h.advance(4000); h.seen(); await settle()
    await h.advance(999); assert.equal(h.calls.length, before)
    await h.advance(1); assert.equal(h.calls.length, before + 1)
    assert(h.calls.at(-1).name.includes('record'))
    // Wall-clock corrections do not move the DB clock anchor or sentAt.
    h.skew(-3_600_000); assert.equal(Date.parse(h.send('2').sentAt), h.now())
    assert.equal(h.counts().clockReads, 1)
  }

  // A second reply minutes after seen must survive the lazy 60s config refresh.
  // Reproduce with both host clock directions and a recent setting revision.
  for (const skew of [17_500, -300_000]) {
    const quiet = harness(skew)
    quiet.settings[0].updated_at = new Date(quiet.now() - 500).toISOString()
    await quiet.warm(); quiet.send(); quiet.seen(); await settle()
    for (const ms of [5000, 1, 5000, 5000]) await quiet.advance(ms)
    assert(quiet.calls.some(call => call.name.includes('record') && call.args.p_items.some(event => event.kind === 'seen')))
    await quiet.advance(180_000)
    const before = quiet.calls.length, receivedAt = new Date(quiet.now()).toISOString()
    quiet.reply(); await settle(); await quiet.advance(5000)
    const records = quiet.calls.slice(before).filter(call => call.name.includes('record'))
    assert.equal(records.length, 1, 'first reply after the quiet interval must not be consumed by the config refresh')
    assert.equal(records[0].args.p_items[0].occurredAt, receivedAt)
    assert.equal(quiet.counts().configReads, 2, 'one shared refresh, no extra config request')
  }

  // Awaiting configuration uses the existing bounded/coalescing queue. It must
  // not write while refresh fails, replay across a toggle, or move receipt time.
  for (const scenario of ['same', 'disabled', 'new-revision', 'read-error']) {
    const h = harness(); await h.warm(); h.send(); h.seen(); await settle()
    for (const ms of [5000, 1, 5000, 5000, 180_000]) await h.advance(ms)
    const before = h.calls.length, firstAt = new Date(h.now()).toISOString()
    let resolveConfig, rejectConfig
    h.config(() => new Promise((resolve, reject) => { resolveConfig = resolve; rejectConfig = reject }))
    for (let i = 0; i < 1000; i++) assert.equal(h.seen(), undefined)
    await settle()
    assert.equal(h.counts().configReads, 2, 'one in-flight config read for the entire burst')
    assert.equal(h.coordinator.engagementMetrics.backlog, 1, 'duplicates coalesce while config is pending')
    assert.equal(h.calls.length, before, 'unvalidated config cannot authorize a write')
    if (scenario === 'disabled') h.settings[0].value = 'false'
    if (scenario === 'new-revision') h.settings[0].updated_at = new Date(h.now()).toISOString()
    if (scenario === 'read-error') rejectConfig(Error('config unavailable'))
    else resolveConfig({ data: h.settings })
    await settle(); await h.advance(5000)
    if (scenario === 'read-error') {
      assert.equal(h.calls.length, before, 'read error pauses engagement writes')
      assert.equal(h.counts().configReads, 2, 'read error keeps the existing 60s backoff')
      h.config(undefined); await h.advance(60_000)
    }
    const records = h.calls.slice(before).filter(call => call.name.includes('record'))
    if (scenario === 'same' || scenario === 'read-error') {
      assert.equal(records.length, 1)
      assert.equal(records[0].args.p_items[0].occurredAt, firstAt, 'fallback timestamp survives config wait/retry')
    } else {
      assert.equal(records.length, 0, 'disabled/revised config discards deferred events')
    }
    assert.equal(h.coordinator.engagementMetrics.backlog, 0)
    assert.equal(h.counts().clockReads, 1, 'config recovery never requests a new clock')
    assert.equal(h.counts().maximumInFlight, 1)
  }

  // Sixty cold Server owners used to run 120 metadata requests ahead of the
  // campaign owner. Two active owners must register/record before those sweeps.
  const busy = harness(); await busy.warm()
  for (let staff = 1; staff <= 62; staff++) busy.attach(staff)
  for (const staff of [61, 62]) { busy.user(staff); busy.send(String(staff)); busy.reply(); busy.seen(String(staff)) }
  await settle()
  await busy.advance(5000)
  for (let turn = 0; turn < 3; turn++) await busy.advance(1)
  assert.deepEqual(busy.calls.map(call => call.args.p_staff_id), [61, 62, 61, 62])
  assert.deepEqual(busy.calls.map(call => call.name.split('_')[2]), ['register', 'register', 'record', 'record'])
  assert.equal(busy.counts().maximumInFlight, 1)
  const beforeBackground = busy.calls.length
  await busy.advance(5000)
  assert.equal(busy.calls.length, beforeBackground + 1, 'only one background page in an idle turn')
  assert(busy.calls.at(-1).name.includes('read'))

  // A background request already in flight is allowed to finish; new live work
  // runs next without overlapping it or starting a second background page.
  const inflight = harness(); await inflight.warm()
  for (let staff = 1; staff <= 60; staff++) inflight.attach(staff)
  let release
  inflight.rpc(call => call.name.includes('read') ? new Promise(resolve => { release = resolve }) : undefined)
  await settle(); await inflight.advance(1)
  assert.equal(inflight.calls.length, 1)
  inflight.user(60); inflight.send('60'); inflight.reply(); await settle()
  await inflight.advance(5000); assert.equal(inflight.calls.length, 1)
  inflight.rpc(undefined); release(); await settle(); await inflight.advance(1); await inflight.advance(1)
  assert.deepEqual(inflight.calls.map(call => call.name.split('_')[2]), ['read', 'register', 'record'])
  assert.equal(inflight.counts().maximumInFlight, 1)

  // Peek is strictly cache-only: cold/expired/invalidated clocks skip optional
  // source/event metadata, without calling or waiting for a refresh RPC.
  const cold = harness()
  cold.coordinator.campaignEngagementEnabled(); await settle()
  assert.equal(cold.clock.peekDatabaseRuntimeClock(), null)
  assert.equal(cold.send().revision, '')
  assert.equal(cold.counts().clockReads, 0)
  await cold.warm(); cold.send(); await cold.advance(5000)
  cold.clock.invalidateDatabaseRuntimeClock()
  const count = cold.coordinator.engagementMetrics.backlog
  cold.reply(); cold.seen()
  assert.equal(cold.coordinator.engagementMetrics.backlog, count)
  assert.equal(cold.send('2').revision, '')
  assert.equal(cold.counts().clockReads, 1)
  await cold.clock.getDatabaseRuntimeClock()
  await cold.advance(10 * 60_000)
  assert.equal(cold.clock.peekDatabaseRuntimeClock(), null)
  assert.equal(cold.send('3').revision, '')
  assert.equal(cold.counts().clockReads, 2)
  console.log('PASS: skewed/jumping host clocks, source/receipt timestamps, reply minutes after seen, config refresh/error/toggle fences and burst dedup, fixed 5s batching, 60 cold owners, foreground fairness, one writer/background page, cold/expired clock adds zero requests')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
