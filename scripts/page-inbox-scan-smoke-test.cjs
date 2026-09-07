// Run: node scripts/page-inbox-scan-smoke-test.cjs
// Uses Electron's Node ABI for the real SQLite repository, with a temporary DB.
// Browser, account claims and Graph transport are isolated; no production writes.
const assert = require('node:assert/strict')
const { readFileSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, dirname, join } = require('node:path')
const { spawnSync } = require('node:child_process')

if (!process.versions.electron) {
  const result = spawnSync(require('electron'), [__filename], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit'
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

const ts = require('typescript')
const Database = require('better-sqlite3')
const root = resolve(__dirname, '..')
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'akaagent-page-inbox-test-'))
const user = { staffId: 4, organizationId: 1 }
const modules = new Map()
const ipcHandlers = new Map()
let failSaves = false
let repo

function loadSource(relativePath) {
  const filename = resolve(root, relativePath)
  if (modules.has(filename)) return modules.get(filename)
  const module = { exports: {} }
  modules.set(filename, module.exports)
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  const localRequire = id => {
    if (id === 'electron') return {
      app: { getPath: () => temporaryDirectory },
      ipcMain: { handle: (event, handler) => ipcHandlers.set(event, handler) }
    }
    if (id.endsWith('/currentUser')) return { requireCurrentUser: () => user }
    if (id.endsWith('/backgroundPageManager')) return { BackgroundPageManager: class {} }
    if (id.endsWith('/workflowEngine')) return { WorkflowEngineV2: class {} }
    if (id.endsWith('/workflowV2Repository')) return {}
    if (id.endsWith('/entitlementRepository')) return {
      ensureCurrentUserFeatureActive: async () => {},
      ensureCurrentUserCanUseAccountPlatform: async () => {}
    }
    if (id.endsWith('/localAccountContactRepository')) return {
      ...repo,
      upsertPageInboxContacts: rows => {
        if (failSaves) throw new Error('Synthetic SQLite failure')
        return repo.upsertPageInboxContacts(rows)
      }
    }
    if (!id.startsWith('.')) return require(id)
    const path = resolve(dirname(filename), `${id}.ts`)
    if (!path.includes('/shared/')) throw new Error(`Unexpected runtime dependency: ${id}`)
    return loadSource(path)
  }
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports)
  return module.exports
}

repo = loadSource('src/main/data/repositories/localAccountContactRepository.ts')
const helpers = loadSource('src/shared/pageInboxScan.ts')
const { ContactLoader } = loadSource('src/main/services/contactLoader.ts')
const { registerAccountContactHandlers } = loadSource('src/main/ipc/handlers/accountContactHandlers.ts')
const { IPC_EVENTS } = loadSource('src/shared/types.ts')
const PAGE = '999'
const NOW = '2026-09-07T00:00:00+07:00'
const BEFORE = '2026-09-06T23:59:59+07:00'
const recentOptions = { mode: 'last_days', days: 1, maxCustomers: 5000 }

function clear() {
  failSaves = false
  repo.getLatestPageInboxMessageAt(1, PAGE)
  const db = new Database(repo.getLocalDataDbPath())
  db.exec('DELETE FROM auto_account_contacts')
  db.close()
}

function seed(uid, lastMessageAt, overrides = {}) {
  repo.upsertPageInboxContacts([{
    accountId: 1, name: `Customer ${uid}`, uid: String(uid),
    extraData: { pageUid: PAGE, lastMessageAt }, ...overrides
  }])
}

function conversation(uid, timestamp = NOW, extra = {}) {
  return {
    id: `conversation-${uid}`, updated_time: timestamp,
    participants: { data: [{ id: PAGE }, { id: String(uid), name: `Customer ${uid}` }] },
    messages: { data: [{ id: `message-${uid}`, created_time: timestamp, message: 'Hello 0901234567', from: { id: String(uid) } }] },
    ...extra
  }
}

function fixture(pages, setting = '2400') {
  const events = []
  const stats = { claims: 0, releases: 0 }
  let claimed = false
  let requests = 0
  const service = {
    getAccount: async () => ({ id: 1, isActive: true, loginStatus: 'đã đăng nhập', status: 'chờ xử lý', flatformType: 'facebook' }),
    getAccountIgnoringCapability: async () => ({ id: 1, flatformType: 'facebook' }),
    getRuntimeClock: async () => ({ vietnamDateKey: '2026-09-07', dbNow: '2026-09-06T17:30:00Z' }),
    getSystemSettingValue: async () => { if (setting instanceof Error) throw setting; return setting }
  }
  const loader = new ContactLoader(service, {}, { webContents: { send: (event, payload) => {
    if (event === IPC_EVENTS.CONTACTS_COMPLETED) {
      assert.equal(claimed, false, 'completion must follow runtime release')
      assert.equal(loader.activeLoads.size, 0, 'completion must follow cleanup')
      events.push(payload.result)
    }
  } } })
  loader.claimAccountForScan = async () => { stats.claims++; claimed = true; return { previousStatus: 'chờ xử lý', claimToken: 'test', staffId: 4 } }
  loader.restoreAccountStatus = async () => { stats.releases++; claimed = false }
  loader.backgroundPages = { getOrCreate: () => ({ navigate: async () => {} }), destroy: () => {} }
  loader.startBackgroundPreview = () => {}
  loader.stopBackgroundPreview = () => {}
  loader.sleep = async () => {}
  loader.extractFacebookUserAccessToken = async () => 'test-user-token'
  loader.getFacebookCookieHeader = async () => ''
  loader.getPageAccessToken = async () => 'test-page-token'
  loader.fetchGraphJson = async url => {
    const query = new URL(url).searchParams
    for (const key of ['limit', 'since', 'until', 'maxCustomers', 'days']) assert.equal(query.has(key), false)
    if (requests === 0) assert.match(query.get('fields'), /updated_time,participants,messages.limit\(25\)/)
    const index = requests++
    const next = pages[Math.min(index, pages.length - 1)]
    if (next instanceof Error) throw next
    if (typeof next === 'function') return next(loader)
    assert.ok(next, 'unexpected pagination')
    return { data: next, ...(index < pages.length - 1 ? { paging: { next: `https://graph.facebook.com/next?page=${index + 1}` } } : {}) }
  }
  return { loader, service, stats, events, requests: () => requests }
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function withinDeadline(promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Cancellation did not settle within 1 second')), 1000)
    })])
  } finally {
    clearTimeout(timer)
  }
}

function registerIpc(f) {
  ipcHandlers.clear()
  registerAccountContactHandlers(f.service, f.loader)
  return {
    load: () => ipcHandlers.get(IPC_EVENTS.CONTACTS_LOAD_PAGE_INBOX_CUSTOMERS)(null, 1, PAGE),
    cancel: () => ipcHandlers.get(IPC_EVENTS.CONTACTS_CANCEL_LOAD)(null, 1)
  }
}

async function scan(pages, options) {
  const f = fixture(pages)
  const result = await f.loader.loadPageInboxCustomers(1, PAGE, 'Test Page', options)
  assert.equal(f.events.length, 1)
  assert.deepEqual(f.events[0], result)
  return { ...f, result }
}

async function testOptionsAndEstimate() {
  assert.deepEqual(helpers.validatePageInboxScanOptions(), { mode: 'since_latest_message', days: 30, maxCustomers: 5000 })
  for (const maxCustomers of [0, -1, 1.5, 20001, NaN, '', null]) {
    assert.throws(() => helpers.validatePageInboxScanOptions({ mode: 'since_latest_message', maxCustomers }))
  }
  for (const days of [0, -1, 1.1, NaN, '', undefined]) {
    assert.throws(() => helpers.validatePageInboxScanOptions({ ...recentOptions, days }))
    assert.doesNotThrow(() => helpers.validatePageInboxScanOptions({ mode: 'since_latest_message', maxCustomers: 1, days }))
  }
  for (const options of [null, [], { mode: 'invalid', maxCustomers: 1 }]) assert.throws(() => helpers.validatePageInboxScanOptions(options))
  assert.equal(helpers.estimatePageInboxScanMinutes(5000, 2400), 10)
  assert.equal(helpers.estimatePageInboxScanMinutes(20000, 2400), 40)
  assert.equal(helpers.estimatePageInboxScanMinutes(1, 2400), 1)
  assert.equal(helpers.estimatePageInboxScanMinutes(5000, 4800), 20)
  for (const setting of [null, '', 'bad', 0, -1, Infinity, new Error('unavailable')]) {
    const { loader } = fixture([], setting)
    assert.equal((await loader.getPageInboxScanInfo(1, PAGE)).estimatedSecondsPer20000, 2400)
  }
  assert.equal(helpers.getPageInboxScanCutoff(helpers.validatePageInboxScanOptions({ ...recentOptions, days: 30 }), '2026-09-07', null), Date.parse('2026-08-09T00:00:00+07:00'))
  assert.equal(helpers.formatPageInboxScanDate('2026-09-06T17:00:00Z'), '07/09/2026')
  const f = fixture([])
  const invalid = await f.loader.loadPageInboxCustomers(1, PAGE, '', { ...recentOptions, maxCustomers: 20001 })
  assert.equal(invalid.pageInboxStopReason, 'error')
  assert.equal(f.requests(), 0)
}

async function testLatestScopeAndFilters() {
  clear()
  for (const [uid, value] of [[1, null], [2, 'garbage'], [3, 'now'], [4, '999999'], [5, 2450000]]) seed(uid, value)
  assert.equal(repo.getLatestPageInboxMessageAt(1, PAGE), null)
  seed(10, '2026-09-06T19:00:00+07:00')
  seed(11, '2026-09-06T17:10:00Z')
  seed(12, '2030-01-01T00:00:00Z', { accountId: 2 })
  seed(13, '2030-01-01T00:00:00Z', { extraData: { pageUid: '888', lastMessageAt: '2030-01-01T00:00:00Z' } })
  for (const uid of [14, 15, 16]) seed(uid, '2030-01-01T00:00:00Z')
  const db = new Database(repo.getLocalDataDbPath())
  db.exec("UPDATE auto_account_contacts SET is_delete=1 WHERE uid='14'; UPDATE auto_account_contacts SET staff_id=42 WHERE uid='15'; UPDATE auto_account_contacts SET organization_id=42 WHERE uid='16'; UPDATE auto_account_contacts SET updated_at='2040-01-01'")
  db.close()
  assert.equal(repo.getLatestPageInboxMessageAt(1, PAGE), '2026-09-06T17:10:00.000Z')
  assert.equal(repo.listPageInboxContacts(1, { pageUid: PAGE, search: 'does-not-match' }).total, 0)
  assert.equal(repo.getLatestPageInboxMessageAt(1, PAGE), '2026-09-06T17:10:00.000Z')
  // Reopen the repository to model app restart; the watermark is derived, never cached.
  modules.delete(resolve(root, 'src/main/data/repositories/localAccountContactRepository.ts'))
  const reopened = loadSource('src/main/data/repositories/localAccountContactRepository.ts')
  assert.equal(reopened.getLatestPageInboxMessageAt(1, PAGE), '2026-09-06T17:10:00.000Z')
}

async function testDefaultAndCaps() {
  clear()
  const old = Array.from({ length: 5002 }, (_, index) => conversation(index + 10000, '2020-01-01T00:00:00Z'))
  const defaults = await scan([old])
  assert.equal(defaults.result.count, 5000)
  assert.equal(defaults.result.pageInboxStopReason, 'customer_limit')
  assert.equal(defaults.result.stopped, undefined)
  assert.equal(repo.listPageInboxContacts(1, { pageUid: PAGE }).total, 5000)
  clear()
  seed(1, NOW)
  const capped = await scan([[conversation('bad'), conversation(0), conversation(PAGE), conversation(1)], [conversation(1), conversation(2), conversation(3)]], { ...recentOptions, maxCustomers: 2 })
  assert.equal(capped.result.count, 2)
  assert.equal(capped.result.pageInboxStopReason, 'customer_limit')
  assert.equal(repo.listPageInboxContacts(1, { pageUid: PAGE }).total, 2)
  clear()
  const maximum = await scan([Array.from({ length: 20001 }, (_, index) => conversation(index + 10000))], { ...recentOptions, maxCustomers: 20000 })
  assert.equal(maximum.result.count, 20000)
  assert.equal(repo.listPageInboxContacts(1, { pageUid: PAGE }).total, 20000)
}

async function testDatePages() {
  clear()
  seed(80, '2026-09-06T18:00:00Z')
  const mixed = await scan([
    [conversation(1, NOW), conversation(2, BEFORE), conversation(3, NOW)],
    [conversation(4, BEFORE), conversation(5, BEFORE)],
    [conversation(6, NOW)]
  ])
  assert.equal(mixed.requests(), 2)
  assert.equal(mixed.result.count, 2)
  assert.equal(mixed.result.pageInboxStopReason, 'date_limit')
  clear()
  const unknown = await scan([
    [conversation(1, BEFORE), conversation(2, 'invalid')],
    [conversation(3, 'invalid', { messages: { data: [{ created_time: BEFORE }, { created_time: NOW }] } })],
    [conversation(4, BEFORE)]
  ], recentOptions)
  assert.equal(unknown.requests(), 3, 'missing timestamps cannot prove the end of the date range')
  assert.equal(unknown.result.count, 2)
  assert.equal(repo.getLatestPageInboxMessageAt(1, PAGE), '2026-09-06T17:00:00.000Z')
  clear()
  const empty = await scan([[]])
  assert.equal(empty.result.success, true)
  assert.equal(empty.result.pageInboxStopReason, 'exhausted')
  const noMemento = await scan([[conversation(1, '2010-01-01T00:00:00Z')]])
  assert.equal(noMemento.result.count, 1)
}

async function testPartialFailureCancelAndFrozenCutoff() {
  clear()
  const failed = await scan([
    Array.from({ length: 500 }, (_, index) => conversation(index + 10000)),
    [conversation(1)], new Error('Synthetic Graph failure')
  ], recentOptions)
  assert.equal(failed.result.success, false)
  assert.equal(failed.result.count, 501)
  assert.equal(failed.result.pageInboxStopReason, 'error')
  assert.equal(repo.listPageInboxContacts(1, { pageUid: PAGE }).total, 501)
  assert.equal(repo.getLatestPageInboxMessageAt(1, PAGE), '2026-09-06T17:00:00.000Z')
  clear()
  const cancelled = await scan([loader => {
    loader.cancelLoad(1)
    return { data: [conversation(1), conversation(2)], paging: { next: 'https://graph.facebook.com/unused' } }
  }])
  assert.equal(cancelled.result.stopped, true)
  assert.equal(cancelled.result.pageInboxStopReason, 'cancelled')
  assert.equal(cancelled.result.count, 2)
  assert.equal(repo.getLatestPageInboxMessageAt(1, PAGE), '2026-09-06T17:00:00.000Z')
  clear()
  const dbFailure = await scan([() => { failSaves = true; return { data: [conversation(1)] } }])
  assert.equal(dbFailure.result.pageInboxStopReason, 'error')
  assert.equal(dbFailure.result.count, 0)
  clear()
  seed(90, '2026-09-04T00:00:00+07:00')
  const f = fixture([[conversation(1, '2026-09-04T01:00:00+07:00'), conversation(2, NOW)], [conversation(3, '2026-09-04T02:00:00+07:00')]])
  await f.loader.getPageInboxScanInfo(1, PAGE)
  seed(90, '2026-09-05T00:00:00+07:00')
  const fresh = await f.loader.loadPageInboxCustomers(1, PAGE)
  assert.equal(fresh.count, 1, 'main rereads the latest date at startup')
  clear()
  seed(90, '2026-09-04T00:00:00+07:00')
  const frozen = await scan([
    Array.from({ length: 500 }, (_, index) => conversation(index + 10000)),
    [conversation(1, '2026-09-04T01:00:00+07:00')]
  ])
  assert.equal(frozen.result.count, 501, 'saving new timestamps must not move this run cutoff')
}

async function testSavedFiltersAndOutput() {
  clear()
  await scan([[conversation(1, NOW), conversation(2, BEFORE), conversation(3, NOW, {
    messages: { data: [{ created_time: NOW, message: 'No phone here', from: { id: '3' } }] }
  })]])
  const phoneRows = repo.listPageInboxContacts(1, { pageUid: PAGE, phoneFilter: 'has_phone' })
  assert.equal(phoneRows.total, 2)
  assert.equal(repo.listPageInboxContacts(1, { pageUid: PAGE, phoneFilter: 'no_phone' }).total, 1)
  assert.equal(repo.listPageInboxContacts(1, { pageUid: PAGE, messageFilterMode: 'contain_all', messageKeywords: 'hello,0901234567' }).total, 2)
  const selectedId = phoneRows.contacts[0].id
  const selected = repo.exportPageInboxContacts(1, { pageUid: PAGE, ids: [selectedId] })
  assert.equal(selected.length, 1)
  assert.equal(selected[0].id, selectedId)
  assert.ok(selected[0].uid && selected[0].extraData.pageUid === PAGE)
  const range = repo.exportPageInboxContacts(1, { pageUid: PAGE, limit: 1, offset: 1 })
  assert.equal(range.length, 1)
  assert.equal(repo.exportPageInboxContacts(1, { pageUid: PAGE, excludeIds: [selectedId] }).length, 2)
  assert.equal(repo.getLatestPageInboxMessageAt(1, PAGE), '2026-09-06T17:00:00.000Z')
}

async function testCancelDuringIpcAndLoaderPreflight() {
  // The first read belongs to IPC authorization; the next two are loader checks.
  for (const pendingRead of [1, 2, 3]) {
    clear()
    const f = fixture([[conversation(1)]])
    const ipc = registerIpc(f)
    const originalGetAccount = f.service.getAccount
    const entered = deferred()
    const response = deferred()
    let reads = 0
    f.service.getAccount = async () => {
      if (++reads === pendingRead) { entered.resolve(); return response.promise }
      return originalGetAccount()
    }
    const run = ipc.load()
    await withinDeadline(entered.promise)
    assert.equal(f.loader.activeLoads.size, 1, 'reserve the run before the first IPC access read')
    assert.equal((await ipc.cancel()).success, true)
    const result = await withinDeadline(run)
    assert.equal(result.pageInboxStopReason, 'cancelled')
    assert.equal(result.stopped, true)
    assert.equal(result.count, 0)
    assert.equal(f.requests(), 0)
    assert.deepEqual(f.stats, { claims: 0, releases: 0 })
    assert.equal(f.events.length, 1)
    assert.equal(f.loader.activeLoads.size, 0)
    // The abandoned read may fail late, even after the next scan has begun.
    const next = ipc.load()
    response.reject(new Error('Late preflight failure'))
    assert.equal((await withinDeadline(next)).count, 1)
    assert.equal(f.events.length, 2)
  }
  clear()
  const denied = fixture([])
  const deniedIpc = registerIpc(denied)
  denied.service.getAccount = async () => null
  assert.equal((await deniedIpc.load()).pageInboxStopReason, 'error')
  assert.deepEqual(denied.stats, { claims: 0, releases: 0 })
  assert.equal(denied.requests(), 0, 'moving authorization must not allow unauthorized Graph reads')
  assert.equal(denied.loader.activeLoads.size, 0)
}

async function testCancelPendingGraphRequestAndBody() {
  for (const stage of ['request', 'body', 'page_token']) {
    clear()
    const f = fixture([])
    f.loader.fetchGraphJson = ContactLoader.prototype.fetchGraphJson
    if (stage === 'page_token') f.loader.getPageAccessToken = ContactLoader.prototype.getPageAccessToken
    const entered = deferred()
    const originalFetch = globalThis.fetch
    let requests = 0
    let aborted = false
    globalThis.fetch = async (_url, init) => {
      requests++
      if (stage !== 'page_token' && requests === 1) {
        return new Response(JSON.stringify({ data: [conversation(1)], paging: { next: 'https://graph.facebook.com/next' } }))
      }
      assert.ok(init.signal, 'Page token and conversation requests must both carry the run signal')
      const waitForAbort = () => new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('Synthetic fetch abort')) }, { once: true })
        entered.resolve()
      })
      if (stage === 'body') return { ok: true, json: waitForAbort }
      return waitForAbort()
    }
    try {
      const run = f.loader.loadPageInboxCustomers(1, PAGE)
      await withinDeadline(entered.promise)
      f.loader.cancelLoad(1)
      const result = await withinDeadline(run)
      assert.equal(aborted, true, `Stop must abort the pending ${stage}`)
      assert.equal(requests, stage === 'page_token' ? 1 : 2, 'never retry an intentionally aborted request')
      assert.equal(result.pageInboxStopReason, 'cancelled')
      assert.equal(result.count, stage === 'page_token' ? 0 : 1)
      assert.equal(repo.listPageInboxContacts(1, { pageUid: PAGE }).total, result.count, 'flush contacts below the batch threshold')
      assert.deepEqual(f.stats, { claims: 1, releases: 1 })
      assert.equal(f.events.length, 1)
      assert.equal(f.loader.activeLoads.size, 0)
    } finally {
      globalThis.fetch = originalFetch
    }
  }
}

async function testCancelWhileClaimPending() {
  clear()
  const f = fixture([])
  const entered = deferred()
  const claimResponse = deferred()
  const originalClaim = f.loader.claimAccountForScan
  f.loader.claimAccountForScan = async () => { entered.resolve(); await claimResponse.promise; return originalClaim() }
  const run = f.loader.loadPageInboxCustomers(1, PAGE)
  await withinDeadline(entered.promise)
  f.loader.cancelLoad(1)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.events.length, 0, 'must retain the run until the mutating claim settles')
  assert.equal(f.loader.activeLoads.size, 1)
  claimResponse.resolve()
  assert.equal((await withinDeadline(run)).pageInboxStopReason, 'cancelled')
  assert.deepEqual(f.stats, { claims: 1, releases: 1 }, 'release even a claim that succeeds after Stop')
  assert.equal(f.requests(), 0)
}

async function testDelayedCancelCannotCancelNextRun() {
  clear()
  const f = fixture([[conversation(1)]])
  const ipc = registerIpc(f)
  const accessEntered = deferred()
  const accessResponse = deferred()
  const cancelResponse = deferred()
  const originalGetAccount = f.service.getAccount
  f.service.getAccount = async () => { accessEntered.resolve(); await accessResponse.promise; return originalGetAccount() }
  f.service.getAccountIgnoringCapability = () => cancelResponse.promise
  const first = ipc.load()
  await withinDeadline(accessEntered.promise)
  const lateCancel = ipc.cancel()
  accessResponse.resolve()
  assert.equal((await withinDeadline(first)).count, 1)

  const nextFetchEntered = deferred()
  let nextSignal
  f.loader.fetchGraphJson = async (_url, _cookie, signal) => new Promise((_, reject) => {
    nextSignal = signal
    signal.addEventListener('abort', () => reject(new Error('Aborted next run')), { once: true })
    nextFetchEntered.resolve()
  })
  const next = ipc.load()
  await withinDeadline(nextFetchEntered.promise)
  cancelResponse.resolve({ id: 1, flatformType: 'facebook' })
  await withinDeadline(lateCancel)
  assert.equal(nextSignal.aborted, false, 'the delayed access check belongs to the previous run')
  f.loader.cancelLoad(1)
  assert.equal((await withinDeadline(next)).pageInboxStopReason, 'cancelled')
  assert.equal(f.events.length, 2)
}

async function main() {
  for (const test of [testOptionsAndEstimate, testLatestScopeAndFilters, testDefaultAndCaps, testDatePages, testPartialFailureCancelAndFrozenCutoff, testSavedFiltersAndOutput, testCancelDuringIpcAndLoaderPreflight, testCancelPendingGraphRequestAndBody, testCancelWhileClaimPending, testDelayedCancelCannotCancelNextRun]) {
    clear()
    await test()
    console.log(`PASS ${test.name}`)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true })
})
