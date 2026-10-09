// Offline catalog reads only: no production DB, RPC writes or outbound actions.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const cachePath = path.join(root, 'src/shared/actionResultCatalogCache.ts')
let checks = 0
const pass = name => { checks++; console.log(`PASS ${name}`) }

function loadSource(stubs = {}, clock = Date, globals = {}) {
  const modules = new Map()
  return function load(file) {
    if (modules.has(file)) return modules.get(file).exports
    const mod = { exports: {} }
    modules.set(file, mod)
    const req = name => {
      for (const [suffix, value] of Object.entries(stubs)) if (name.endsWith(suffix)) return value
      if (!name.startsWith('.')) return require(name)
      return load(path.resolve(path.dirname(file), `${name}.ts`))
    }
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    vm.runInNewContext(code, { module: mod, exports: mod.exports, require: req, Date: clock, console,
      AbortController, setTimeout, clearTimeout, ...globals }, { filename: file })
    return mod.exports
  }
}

async function cacheContract() {
  const { ActionResultCatalogCache } = loadSource()(cachePath)
  let now = 0, reads = 0, complete
  const cache = new ActionResultCatalogCache(() => {
    reads++
    return new Promise(resolve => { complete = resolve })
  }, () => now)
  const pending = Array.from({ length: 40 }, () => cache.get())
  await Promise.resolve()
  assert.equal(reads, 1)
  now = 90_000 // TTL starts when the entire read completes, not when it starts.
  const first = Object.freeze({ generation: 1 })
  complete(first)
  for (const value of await Promise.all(pending)) assert.equal(value, first)
  now = 149_999
  assert.equal(await cache.get(), first)
  assert.equal(reads, 1)
  now = 150_000
  const refresh = cache.get()
  await Promise.resolve()
  assert.equal(reads, 2)
  complete({ generation: 2 })
  assert.equal((await refresh).generation, 2)
  assert.equal(first.generation, 1)
  pass('concurrent callers share one load; exact 60s TTL starts on successful completion')

  let attempts = 0, fail = false
  const failures = new ActionResultCatalogCache(() => {
    attempts++
    if (fail) throw new Error('read failed')
    return Promise.resolve({ generation: attempts })
  }, () => now)
  const previous = await failures.get()
  now += 60_000
  fail = true
  const failed = await Promise.all(Array.from({ length: 20 }, () => failures.get()))
  assert(failed.every(result => result === previous))
  assert.equal(attempts, 2)
  fail = false
  assert.equal(await failures.get(), previous)
  now += 59_999
  assert.equal(await failures.get(), previous)
  assert.equal(attempts, 2)
  now++
  assert.equal((await failures.get()).generation, 3)
  assert.equal(previous.generation, 1)
  now--
  assert.equal((await failures.get()).generation, 4)
  pass('failed refresh serves the last complete catalog, waits 60s before retry, and handles clock rollback')

  let coldReads = 0, unavailable = true
  const cold = new ActionResultCatalogCache(async () => {
    coldReads++
    if (unavailable) throw new Error('no catalog yet')
    return { ready: true }
  }, () => now)
  await assert.rejects(cold.get(), /no catalog yet/)
  unavailable = false
  now += 59_999
  await assert.rejects(cold.get(), /no catalog yet/)
  assert.equal(coldReads, 1)
  now++
  assert.equal((await cold.get()).ready, true)
  assert.equal(coldReads, 2)
  pass('cold load cannot invent a catalog and also waits 60s before retry')
}

function fixture() {
  let now = 0, failedTable = null, heldTable = null, releaseRead
  const requests = [], timers = new Map()
  let nextTimer = 0
  const statuses = ['success', 'failed', 'error'].map((code, index) => ({
    id: index + 1, code: `campaign_detail_${code}`, name: code, status_value: code,
    color: null, component_type: 'campaign_detail', flatform_type: 'all', is_active: true, is_delete: false
  }))
  const policies = statuses.map(status => ({
    id: status.id, status_id: status.id, action_code: null, report_group: 'success',
    counts_toward_limit: true, bad_target_effect: 'reset', reset_error_streak: true,
    input_effect: 'complete', is_active: true, is_delete: false
  }))
  // More than one page verifies that the cache is published only after all pages.
  const tables = {
    auto_status: [...statuses, ...Array.from({ length: 499 }, (_, i) => ({
      ...statuses[0], id: i + 4, code: `extra_${i}`, status_value: `extra_${i}`
    }))],
    auto_account_action_status_policies: policies,
    auto_error: [{ id: 1, errorCode: 'fixture', errorType: 'system', zaloActionCodes: [],
      detailMode: 'inherit', notiCampaign: 'original', is_active: true, is_delete: false }],
    auto_account_actions: [{ id: 1, code: 'test_action', is_active: true, is_delete: false }]
  }
  const client = { from(table) {
    let afterId = 0, size = 0, signal
    const query = { select: () => query, order: () => query, gt: (_key, value) => { afterId = value; return query },
      limit: value => { size = value; return query },
      abortSignal: value => { signal = value; return query },
      then: (resolve, reject) => read().then(resolve, reject)
    }
    async function read() {
        requests.push({ table, afterId, signal })
        signal.throwIfAborted()
        if (table === heldTable) await new Promise((resolve, reject) => {
          const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
          releaseRead = () => { signal.removeEventListener('abort', abort); resolve() }
          signal.addEventListener('abort', abort, { once: true })
        })
        if (table === failedTable) return { data: null, error: { code: 'fixture_failure' } }
        return { data: structuredClone(tables[table].filter(row => row.id > afterId).slice(0, size)), error: null }
    }
    return query
  } }
  class Clock extends Date { static now() { return now } }
  const load = loadSource({
    '/supabaseClient': { getSupabaseClient: () => client },
    '/mappers': { mapAutoErrorPolicyFromDB: row => row },
    '/zaloCampaignEngagement': { stageCampaignEngagementSource() {}, failCampaignEngagementDetail() {} }
  }, Clock, {
    setTimeout: (callback, ms) => { const id = ++nextTimer; timers.set(id, { callback, ms }); return id },
    clearTimeout: id => timers.delete(id)
  })
  return { tables, requests, load, setTime: value => { now = value }, fail: value => { failedTable = value },
    hold: value => { heldTable = value }, release: () => { heldTable = null; releaseRead() }, timers,
    expireRead: () => { assert.equal(timers.size, 1); const [timer] = timers.values(); assert.equal(timer.ms, 60_000); timer.callback() } }
}

async function repositoryAndRuntime() {
  const f = fixture()
  const repository = f.load(path.join(root, 'src/main/data/repositories/actionStatusPolicyRepository.ts'))
  const runtime = f.load(path.join(root, 'src/main/services/actionResultRuntime.ts'))
  const start = (campaignId, action = 'test_action') => runtime.beginActionResultRun({
    campaignId, accountId: campaignId, staffId: campaignId, platform: 'zalo', claimToken: String(campaignId)
  }, [action])
  await Promise.all(Array.from({ length: 30 }, (_, i) => start(i + 1)))
  assert.equal(f.requests.length, 5) // 2 status pages + 3 other tables, shared across staff.
  const old = await repository.loadRunResultCatalog()
  assert.equal(old.statuses.length, 502)
  await assert.rejects(start(100, 'unknown_action'), /output_invalid/)
  assert.equal(f.requests.length, 5)
  pass('Desktop/Server share all paginated catalog reads across staff; preflight still runs per campaign')

  f.tables.auto_account_action_status_policies[0].counts_toward_limit = false
  f.tables.auto_error[0].notiCampaign = 'updated'
  f.setTime(59_999)
  await start(101)
  assert.equal(f.requests.length, 5)
  f.setTime(60_000)
  f.hold('auto_error')
  let completed = false
  const refresh = Promise.all([start(102), start(103)]).then(() => { completed = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(completed, false)
  assert.equal(runtime.withActionResultRunContext(1, () => runtime.currentActionResultErrors().get('fixture').notiCampaign), 'original')
  f.release()
  await refresh
  assert.equal(f.requests.length, 10)
  const current = await repository.loadRunResultCatalog()
  assert.equal(current.catalog.selectPolicy('test_action', 'campaign_detail_success').countsTowardLimit, false)
  assert.equal(old.catalog.selectPolicy('test_action', 'campaign_detail_success').countsTowardLimit, true)
  assert.equal(runtime.withActionResultRunContext(101, () => runtime.currentActionResultErrors().get('fixture').notiCampaign), 'original')
  assert.equal(runtime.withActionResultRunContext(102, () => runtime.currentActionResultErrors().get('fixture').notiCampaign), 'updated')
  pass('refresh waits for the complete catalog and preserves every active run snapshot')

  f.setTime(120_000)
  f.fail('auto_error')
  await start(104)
  assert.equal(runtime.withActionResultRunContext(104, () => runtime.currentActionResultErrors().get('fixture').notiCampaign), 'updated')
  assert.equal(runtime.withActionResultRunContext(1, () => runtime.currentActionResultErrors().get('fixture').notiCampaign), 'original')
  const failedRequests = f.requests.length
  f.fail(null)
  f.setTime(179_999)
  await start(105)
  assert.equal(f.requests.length, failedRequests)
  f.setTime(180_000)
  f.tables.auto_account_action_status_policies[0].report_group = 'invalid'
  await start(106)
  assert.equal(await repository.loadRunResultCatalog(), current)
  f.tables.auto_account_action_status_policies[0].report_group = 'success'
  f.setTime(240_000)
  f.tables.auto_error[0].notiCampaign = 'recovered'
  await start(107)
  assert.equal(runtime.withActionResultRunContext(107, () => runtime.currentActionResultErrors().get('fixture').notiCampaign), 'recovered')
  assert.equal(runtime.withActionResultRunContext(106, () => runtime.currentActionResultErrors().get('fixture').notiCampaign), 'updated')
  f.setTime(300_000)
  f.tables.auto_account_action_status_policies[0].is_active = false
  await assert.rejects(start(108), /policy_disabled/)
  assert.equal(f.timers.size, 0)
  pass('read/validation failures retain the old catalog; a successfully loaded disabled policy still blocks')

  const stalled = fixture()
  const stalledRepository = stalled.load(path.join(root, 'src/main/data/repositories/actionStatusPolicyRepository.ts'))
  const initial = await stalledRepository.loadRunResultCatalog()
  stalled.setTime(60_000)
  stalled.hold('auto_error')
  const callers = Array.from({ length: 10 }, () => stalledRepository.loadRunResultCatalog())
  await new Promise(resolve => setImmediate(resolve))
  stalled.setTime(120_000)
  stalled.expireRead()
  for (const value of await Promise.all(callers)) assert.equal(value, initial)
  assert.equal(stalled.timers.size, 0)
  assert(stalled.requests.slice(5).every(request => request.signal.aborted))
  const requestsAfterTimeout = stalled.requests.length
  stalled.hold(null)
  stalled.tables.auto_error[0].notiCampaign = 'after timeout'
  stalled.setTime(179_999)
  assert.equal(await stalledRepository.loadRunResultCatalog(), initial)
  assert.equal(stalled.requests.length, requestsAfterTimeout)
  stalled.setTime(180_000)
  const recovered = await stalledRepository.loadRunResultCatalog()
  assert.equal(recovered.errors.get('fixture').notiCampaign, 'after timeout')
  assert.equal(stalled.timers.size, 0)
  pass('stalled HTTP is really aborted; all waiters fall back, then one later load recovers')

  const cold = fixture()
  cold.hold('auto_error')
  const coldRepository = cold.load(path.join(root, 'src/main/data/repositories/actionStatusPolicyRepository.ts'))
  const firstRead = coldRepository.loadRunResultCatalog()
  const rejection = assert.rejects(firstRead, /abort/i)
  await new Promise(resolve => setImmediate(resolve))
  cold.setTime(60_000)
  cold.expireRead()
  await rejection
  assert.equal(cold.timers.size, 0)
  cold.hold(null)
  cold.setTime(120_000)
  assert.equal((await coldRepository.loadRunResultCatalog()).statuses.length, 502)
  pass('cold HTTP timeout rejects without a fallback and releases all requests for later recovery')
}

async function main() {
  const chatCache = path.join(root, '../akaAgentChatApi/packages/database/src/result-policy/actionResultCatalogCache.ts')
  assert.equal(fs.readFileSync(cachePath, 'utf8'), fs.readFileSync(chatCache, 'utf8'))
  pass('Desktop/Server and Chat use the same cache contract')
  await cacheContract()
  await repositoryAndRuntime()
  console.log(JSON.stringify({ checks, productionQueries: 0, outboundActions: 0 }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
