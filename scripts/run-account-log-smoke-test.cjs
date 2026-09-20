const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const flush = () => new Promise(resolve => setImmediate(resolve))

function load(file, overrides = {}, timers = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, require: id => {
    if (id in overrides) return overrides[id]
    if (id.startsWith('node:')) return require(id)
    return {}
  }, AbortController, setTimeout, clearTimeout, console, ...timers }, { filename: file })
  return exports
}

async function main() {
  const contract = load('src/shared/accountLog.ts')
  const pending = []
  const errors = []
  process.on('unhandledRejection', error => errors.push(error))
  const rows = []
  const record = contract.createAccountLogRecorder((row, signal) => {
    rows.push(row)
    return new Promise((resolve, reject) => pending.push({ resolve, reject, signal }))
  }, 20)
  const input = { accountId: 11, campaignId: 55, source: 'future-source',
    loginStatus: 'future-login', accountStatus: 'future-status', eventType: 'new-event',
    message: 'warning password="TOP_SECRET" https://host/path?token=HIDDEN',
    details: { error_code: '221', api: 'findUser', password: 'NEVER', content: 'PRIVATE', raw_error: { cookie: 'NO' } } }
  assert.equal(record(input), undefined)
  assert.equal(rows.length, 1, 'first event must dispatch without waiting for a batch')
  input.accountId = 99
  input.details.error_code = 'changed'
  record({ ...input, accountId: 22 })
  assert.equal(rows.length, 2, 'in-flight event must not delay another event')
  assert.equal(rows[0].account_id, '11')
  assert.equal(rows[0].details.error_code, '221')
  assert.equal(rows[0].account_status, 'future-status')
  assert.equal(rows[0].source, 'future-source')
  assert.ok(!JSON.stringify(rows).match(/TOP_SECRET|HIDDEN|NEVER|PRIVATE|cookie/))
  pending[0].reject(new Error('DB offline'))
  await new Promise(resolve => setTimeout(resolve, 35))
  assert.equal(pending[1].signal.aborted, true, 'deadline must abort the real transport')
  pending[1].reject(new Error('late rejection'))
  const syncFail = contract.createAccountLogRecorder(() => { throw new Error('sync fail') })
  assert.doesNotThrow(() => syncFail(input))
  const badPayload = { ...input, get details() { throw new Error('serialize failure') } }
  assert.doesNotThrow(() => record(badPayload))
  await flush()
  assert.deepEqual(errors, [])

  const stored = []
  let telemetryFails = false
  const db = { from(table) {
    assert.equal(table, 'auto_account_logs')
    return { insert(row) { stored.push(row); return { abortSignal: () => telemetryFails
      ? Promise.reject(new Error('diagnostic database offline')) : Promise.resolve({ error: null }) } } }
  } }
  const service = load('src/main/services/accountLogService.ts', {
    '../../shared/accountLog': contract,
    '../data/supabaseClient': { getSupabaseClient: () => db }
  })
  const previous = { id: 1, loginStatus: 'chưa đăng nhập', status: 'chờ xử lý' }
  service.rememberAccountLogSnapshot(previous)
  const current = { ...previous, loginStatus: 'đã đăng nhập' }
  service.recordAccountState(current, previous)
  assert.equal(stored.length, 1)
  service.recordAccountState(current)
  assert.equal(stored.length, 1, 'unchanged polling must not write log')
  service.recordCampaignState({ id: 10, accountId: 1, name: 'Campaign A', status: 'đang chạy' }, current)
  service.setAccountLogSource('zalo_server')
  service.recordAccountWarning(1, 'limit')
  assert.equal(stored.at(-1).campaign_id, '10')
  assert.equal(stored.at(-1).source, 'zalo_server')
  service.recordAccountWarning(2, 'limit')
  assert.equal(stored.at(-1).account_id, '2')
  assert.equal(stored.at(-1).campaign_id, null, 'parallel accounts must not inherit campaign context')
  service.recordCampaignState({ id: 20, accountId: 1, name: 'Campaign B', status: 'đang chạy' }, current)
  service.clearAccountCampaignLogContext(1, 10)
  service.recordAccountLog({ accountId: 1, eventType: 'test', message: 'after old cleanup' })
  assert.equal(stored.at(-1).campaign_id, '20', 'old cleanup cannot clear a newer campaign')

  service.rememberCampaignLogSnapshot({ id: 20, accountId: 2, name: 'Campaign reassigned', status: 'chờ xử lý' })
  service.recordKnownCampaignLog(20, 'campaign_pause_requested', 'pause')
  assert.equal(stored.at(-1).account_id, '2', 'reloaded campaign must use its current account')
  assert.equal(stored.at(-1).details.campaign_name, 'Campaign reassigned')
  service.recordAccountLog({ accountId: 1, eventType: 'test', message: 'after reassignment' })
  assert.equal(stored.at(-1).campaign_id, null, 'old account must not retain the reassigned campaign')
  service.rememberCampaignLogSnapshot({ id: 20, accountId: 2, name: 'Campaign renamed', status: 'đang chạy' })
  const beforeTransition = stored.length
  service.recordCampaignState({ id: 20, accountId: 2, name: 'Campaign renamed', status: 'đang chạy' })
  assert.equal(stored.length, beforeTransition + 1, 'read must not consume a pending status transition')
  service.recordCampaignState({ id: 20, accountId: 2, name: 'Campaign renamed', status: 'đang chạy' })
  assert.equal(stored.length, beforeTransition + 1, 'unchanged campaign must still be deduplicated')

  // Exercise the actual runtime emitters, not just the logger helper.
  const { ZaloRuntimeService } = load('src/main/services/zaloRuntimeService.ts', {
    './accountLogService': service,
    'zca-js': { ZaloApiError: class ZaloApiError extends Error {} }
  })
  const runtime = Object.create(ZaloRuntimeService.prototype)
  runtime.emitLoginQrEvent = () => {}
  runtime.loginQrSubscribers = new Set()
  runtime.realtimeListenerSubscribers = new Map()
  const beforeWarnings = stored.length
  for (let attempt = 0; attempt < 2; attempt++) {
    runtime.publishLoginQrEvent({ accountId: 7, status: 'qr', message: 'Quét mã QR' })
    runtime.publishLoginQrEvent({ accountId: 7, status: 'expired', message: 'Mã QR đã hết hạn' })
  }
  assert.equal(stored.length, beforeWarnings + 2, 'distinct expired QR attempts must both be logged')
  const listener = { accountId: 7, status: 'running', ready: true, lastError: 'listener warning' }
  runtime.emitZaloListenerStatus(listener)
  runtime.emitZaloListenerStatus(listener)
  assert.equal(stored.length, beforeWarnings + 3, 'identical listener state is deduplicated within that instance')
  listener.lastError = null
  runtime.emitZaloListenerStatus(listener)
  listener.lastError = 'listener warning'
  runtime.emitZaloListenerStatus(listener)
  assert.equal(stored.length, beforeWarnings + 4, 'recovered listener must log a recurring warning')
  runtime.emitZaloListenerStatus({ accountId: 7, status: 'running', ready: true, lastError: 'listener warning' })
  assert.equal(stored.length, beforeWarnings + 5, 'a new listener must have an independent baseline')
  const polling = { id: 7, flatformType: 'zalo', loginStatus: 'chưa đăng nhập', status: 'chờ xử lý' }
  service.rememberAccountLogSnapshot(polling)
  service.recordAccountState(polling, undefined, 'poll failure')
  runtime.publishLoginQrEvent({ accountId: 7, status: 'declined', message: 'Đã từ chối đăng nhập' })
  service.recordAccountState(polling, undefined, 'poll failure')
  assert.equal(stored.length, beforeWarnings + 7, 'QR events cannot reset the polling baseline')
  service.recordAccountState(polling)
  service.recordAccountState(polling, undefined, 'poll failure')
  assert.equal(stored.length, beforeWarnings + 8, 'poll recovery allows another warning')

  const listenerEmitter = new (require('node:events').EventEmitter)()
  const liveListener = { accountId: 8, status: 'running', ready: true, lastError: null,
    api: { listener: listenerEmitter } }
  runtime.listenerStates = new Map([[8, liveListener]])
  runtime.attachZaloListenerHandlers(liveListener)
  const beforeRecovery = stored.length
  listenerEmitter.emit('error', 'transient warning')
  listenerEmitter.emit('cipher_key') // already running/ready: does not publish a state change
  listenerEmitter.emit('error', 'transient warning')
  assert.equal(stored.length, beforeRecovery + 2, 'cipher recovery must reset dedupe even without a status broadcast')
  const invalidMetadata = {}; invalidMetadata.self = invalidMetadata
  assert.doesNotThrow(() => runtime.emitZaloListenerStatus(liveListener, { reason: invalidMetadata }))

  // Exercise actual repository write branches: CAS miss and DB error never report success.
  let writeResult = { data: null, error: null }
  let readRow = { id: 8, staff_id: 1, organization_id: 2, flatform_type: 'zalo',
    login_status: 'đã đăng nhập', status: 'tạm dừng', is_zalo_server: true }
  const mapper = row => row && ({ id: row.id, staffId: row.staff_id, organizationId: row.organization_id,
    flatformType: row.flatform_type, loginStatus: row.login_status, status: row.status,
    isZaloServer: row.is_zalo_server, isZaloShowWeb: false })
  const repoDb = { from() {
    let writing = false
    return { select() { return this }, eq() { return this },
      update() { writing = true; return this },
      maybeSingle() { return Promise.resolve(writing ? writeResult : { data: readRow, error: null }) } }
  } }
  const repo = load('src/main/data/repositories/accountRepository.ts', {
    '../../services/accountLogService': service,
    '../currentUser': { requireCurrentUser: () => ({ staffId: 1, organizationId: 2 }) },
    '../supabaseClient': { getSupabaseClient: () => repoDb },
    '../mappers': { mapAccountFromDB: mapper },
    './entitlementRepository': { loadCurrentUserEffectiveEntitlements: async () => ({}),
      loadCurrentUserZaloAccountCapabilities: () => ({}), canUseAccountWithEntitlementsAndCapabilities: () => true }
  })
  const count = stored.length
  const untouched = await repo.updateClaimedZaloServerAccount(8, { status: 'chờ xử lý' })
  assert.equal(untouched.status, 'tạm dừng')
  assert.equal(stored.length, count)
  writeResult = { data: null, error: { message: 'write failed' } }
  await assert.rejects(repo.updateClaimedZaloServerAccount(8, { status: 'chờ xử lý' }))
  assert.equal(stored.length, count)
  writeResult = { data: { ...readRow, status: 'future account state' }, error: null }
  await repo.updateClaimedZaloServerAccount(8, { status: 'future account state' })
  assert.equal(stored.at(-1).account_status, 'future account state')
  telemetryFails = true
  writeResult = { data: { ...readRow, status: 'another new state' }, error: null }
  assert.equal((await repo.updateClaimedZaloServerAccount(8, { status: 'another new state' })).status, 'another new state',
    'failed telemetry must not fail the completed business write')
  await flush()
  assert.deepEqual(errors, [])
  console.log('PASS: immediate send, immutable context, free-form states, timeout/late failure, secrets, polling, multi-account and CAS isolation')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
