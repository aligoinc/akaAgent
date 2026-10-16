// Real normalization, fallback, IPC and ContactLoader; only external transports/DB are mocked.
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const { randomUUID } = require('node:crypto')
const ts = require('typescript')
const root = resolve(__dirname, '..'), modules = new Map(), handlers = new Map()
const user = { staffId: 7, organizationId: 9 }
let credentials = { username: 'fixture', password: 'fixture' }
function load(file) {
  const filename = resolve(root, file)
  if (modules.has(filename)) return modules.get(filename)
  const module = { exports: {} }; modules.set(filename, module.exports)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const req = id => {
    if (id === 'electron') return { ipcMain: { handle: (name, fn) => handlers.set(name, fn) } }
    // The Web abort check exercises session.fetch directly, without creating an SDK API.
    if (id === 'zca-js') return { API: class {} }
    if (id.endsWith('/currentUser')) return { requireCurrentUser: () => user, requireCurrentUserCredentials: () => credentials, getCurrentUserCredentials: () => credentials, runWithCurrentUser: (_, fn) => fn() }
    if (id.endsWith('/entitlementRepository')) return { ensureCurrentUserFeatureActive: async () => {} }
    if (id.endsWith('/backgroundPageManager')) return { BackgroundPageManager: class { destroy() {} destroyAll() {} } }
    if (id.endsWith('/workflowEngine')) return { WorkflowEngineV2: class {} }
    if (id.endsWith('/accountLogService')) return { recordAccountLog() { throw new Error('No scan history allowed') } }
    if (!id.startsWith('.')) return require(id)
    const path = resolve(dirname(filename), `${id}.ts`)
    if (path.includes('/shared/') || /\/(zaloPhoneSearch|requestDeadline|zaloPhoneCheckStore|originPolicy|realtimeTicketVerifier)\.ts$/.test(path)) return load(path)
    return {}
  }
  new Function('require', 'module', 'exports', code)(req, module, module.exports)
  return module.exports
}
const h = load('src/shared/zaloPhoneCheck.ts')
const { searchZaloPhone } = load('src/main/services/zaloPhoneSearch.ts')
const { ContactLoader } = load('src/main/services/contactLoader.ts')
const { ZaloChatApiClient } = load('src/main/services/zaloChatApiClient.ts')
const { ZaloChatContactScanSource } = load('src/main/services/zaloChatContactScanSource.ts')
const { createZaloPhoneCheckStore } = load('src/renderer/src/stores/zaloPhoneCheckStore.ts')
const { registerZaloPhoneCheckHandlers } = load('src/main/ipc/handlers/zaloPhoneCheckHandlers.ts')
const phones = Array.from({ length: 301 }, (_, i) => `090${String(i).padStart(7, '0')}`)
const error = code => Object.assign(new Error('Fixture error'), { code })
const req = (values = phones.slice(0, 3), limit = 300) => ({ accountId: 71, runId: randomUUID(), limit, phones: values })
const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture(options = {}) {
  const events = [], calls = []
  let count = 0, held = false
  const account = { id: 71, flatformType: 'zalo', isActive: true, isZaloServer: !!options.server, isZaloShowWeb: !!options.web, loginStatus: 'đã đăng nhập', status: 'tạm dừng', ...options.account }
  const claim = async () => { calls.push('claim'); if (options.busy) return { claimed: false }; held = true; return { claimed: true, previousStatus: 'tạm dừng', claimToken: 'claim-token', staffId: 7 } }
  const db = {
    getAccount: async () => account,
    claimZaloAccountRuntimeOperation: claim, claimZaloServerContactScan: claim,
    releaseZaloAccountRuntimeOperation: async (...args) => { assert.equal(args[4], 'claim-token'); calls.push('release'); held = false; return true }
  }
  const win = { isDestroyed: () => false, webContents: { mainFrame: {}, once() {}, send: (channel, payload) => events.push({ channel, payload: structuredClone(payload) }) } }
  const runtime = {
    checkSession: async () => ({ loggedIn: !options.noSession }),
    findUserByPhone: async (id, phone, signal) => {
      assert.ok(held); assert.equal(events.at(-1).payload.row.status, 'checking')
      calls.push(phone); count++
      if (options.lookup) return options.lookup({ id, phone, signal, count })
      if (options.errorAt === count) throw error(options.code)
      return { user: { uid: '12345678901234567890', displayName: 'Tên từ API' } }
    }
  }
  const loader = new ContactLoader(db, {}, win, undefined, runtime, { zaloRuntimeTarget: options.server ? 'server' : 'desktop', ...(options.legacy ? { contactDatasetAuth: 'server_claim' } : {}) })
  loader.getZaloFriendApiDelayMs = () => 0
  return { loader, db, win, events, calls, runtime, held: () => held }
}
async function checkNativeWebAbort() {
  const { app, session } = require('electron')
  await app.whenReady()
  const { ZaloWebRuntimeService } = load('src/main/services/zaloWebRuntimeService.ts')
  const web = new ZaloWebRuntimeService()
  const entry = { accountId: 71, captureVersion: 0, bootstrap: {}, generationAbortController: new AbortController(),
    wc: { isDestroyed: () => false, session: session.fromPartition('phone-check-abort-fixture') } }
  web.entries.set(71, entry)
  const webFetch = web.createSessionFetch(entry, 0, entry.bootstrap, entry.generationAbortController.signal, {})
  let requestCount = 0, transportError
  const server = require('node:http').createServer(() => { requestCount++; web.advanceCaptureGeneration(entry) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const f = fixture({ web: true, lookup: ({ signal }) => searchZaloPhone(async () => {
      try { await webFetch(`http://127.0.0.1:${server.address().port}/`, { signal }) }
      catch (error) { transportError = error; throw error }
      throw new Error('Fixture must abort before receiving a profile')
    }, async () => null, signal) })
    const result = await f.loader.checkZaloPhones(req(phones.slice(0, 2)))
    assert.equal(transportError.name, 'AbortError'); assert.equal(transportError.code, 20)
    assert.deepEqual(result.rows.map(row => row.status), ['unknown', 'pending'])
    assert.equal(result.stopped, true); assert.equal(requestCount, 1)
    assert.equal(f.calls.filter(c => /^090/.test(c)).length, 1)
    assert.equal(f.calls.filter(c => c === 'release').length, 1)
    assert.equal(f.held(), false)
    assert.doesNotMatch(result.rows[0].note, /mã 20/)
    console.log('PASS native Electron Web generation abort: AbortError(20) => unknown, stop, next phone pending, release once')
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
async function main() {
  assert.deepEqual(h.normalizeZaloCheckPhones(['+84 901 234 567', '0901234567', 901234567, 'bad', '', '01621234567']), ['0901234567', '0321234567'])
  assert.equal(h.normalizeZaloCheckPhones(phones.slice(0, 300)).length, 300)
  assert.throws(() => h.normalizeZaloCheckPhones(phones), /chia nhỏ/)
  assert.throws(() => h.validateZaloPhoneCheckRequest(req(phones)), /300/)
  for (const limit of [0, 301, 1.2, NaN]) assert.throws(() => h.validateZaloPhoneCheckRequest(req([phones[0]], limit)))
  const row = { ...h.createZaloPhoneCheckRow(phones[0]), status: 'found', uid: '12345678901234567890', name: 'API', accountId: 71 }
  assert.deepEqual(h.zaloPhoneCheckExport([row], true)[1], ['API', '', phones[0], '', '', '', '', '', ''])
  assert.equal(h.zaloPhoneCheckExport([row], false)[1][3], row.uid)
  assert.equal(h.zaloPhoneCheckGroupRows([row], 'phone')[0].uid, null)
  assert.equal(h.zaloPhoneCheckGroupRows([row], 'zalo_person')[0].sourceAccountId, 71)
  assert.throws(() => h.zaloPhoneCheckGroupRows([h.createZaloPhoneCheckRow(phones[1])], 'zalo_person'), /Có Zalo/)
  const { utils, write, read } = require('xlsx')
  const wb = utils.book_new(); utils.book_append_sheet(wb, utils.aoa_to_sheet(h.zaloPhoneCheckExport([row], true)), 'akaBiz')
  const round = read(write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' }).Sheets.akaBiz
  assert.equal(round.C2.t, 's'); assert.equal(round.C2.v, phones[0]); assert.equal(round.B2.v, '')
  const policy = async code => ({ H: 'hour', D: 'day' }[code] || null)
  for (const first of ['H', 'D', null]) {
    const attempts = []
    assert.equal((await searchZaloPhone(async src => { attempts.push(src); if (src === 32) throw error(first); return 'ok' }, policy)).user, 'ok')
    assert.deepEqual(attempts, [32, 40])
  }
  await assert.rejects(searchZaloPhone(async src => { throw error(src === 32 ? 'H' : 'D') }, policy), { code: 'H' })
  let tries = 0
  await assert.rejects(searchZaloPhone(async () => { tries++; throw error('216') }, policy), { code: '216' }); assert.equal(tries, 1)
  const abort = new AbortController()
  tries = 0
  await assert.rejects(searchZaloPhone(async () => { tries++; abort.abort(); throw error('H') }, policy, abort.signal)); assert.equal(tries, 1)
  for (const kind of [{}, { web: true }, { server: true, legacy: true }, { server: true }]) {
    const initial = fixture(kind), request = req()
    const result = await initial.loader.checkZaloPhones({ ...request, limit: 2 })
    assert.equal(result.rows.length, 2); assert.ok(result.rows.every(r => r.status === 'found'))
    assert.equal(initial.events.filter(e => e.channel === h.ZALO_PHONE_CHECK_IPC.row).length, 4)
    assert.equal(initial.calls.at(-1), 'release'); assert.equal(initial.held(), false)
    // akaBizAuto CheckPhoneExist_ByApi: 0 or SearchPhone.LIMITS => true; other API codes => false.
    // These are Zalo response codes, not HTTP status codes.
    for (const [code, status] of [
      [0, 'found'], [312, 'found'], [313, 'found'], [304, 'found'], [221, 'found'],
      [212, 'not_found'], [214, 'not_found'], [216, 'not_found'], [401, 'not_found'],
      [429, 'not_found'], [-1, 'not_found'], [999, 'not_found'], [20, 'not_found'], [23, 'not_found']
    ]) {
      const f = fixture({ ...kind, errorAt: 1, code })
      const r = await f.loader.checkZaloPhones(req())
      assert.equal(r.rows[0].status, status, `akaBizAuto parity for ${code}`)
      assert.equal(r.rows[0].uid, ''); assert.equal(r.rows[0].name, '')
      assert.ok(r.rows.slice(1).every(row => row.status === 'found'))
      assert.equal(r.stopped, false); assert.equal(r.error, undefined)
      assert.equal(f.events.filter(e => e.channel === h.ZALO_PHONE_CHECK_IPC.row).length, 6)
      assert.equal(f.calls.filter(c => c === 'release').length, 1)
      assert.equal(f.held(), false)
      if (status === 'found') {
        assert.throws(() => h.zaloPhoneCheckGroupRows([r.rows[0]], 'zalo_person'), /Zalo ID/)
        assert.equal(h.zaloPhoneCheckGroupRows([r.rows[0]], 'phone')[0].phone, phones[0])
        assert.deepEqual(h.zaloPhoneCheckExport([r.rows[0]], true)[1], ['', '', phones[0], '', '', '', '', '', ''])
      }
    }
    for (const code of [undefined, 'ECONNRESET', 'data_scan_runtime_binding_changed', 'phone_check_update_required']) {
      const f = fixture({ ...kind, errorAt: 1, code })
      const r = await f.loader.checkZaloPhones(req())
      assert.equal(r.rows[0].status, 'unknown'); assert.equal(r.rows[1].status, 'pending')
      assert.equal(r.stopped, true); assert.equal(f.held(), false)
    }
    // Runtime-owned aborts do not necessarily abort the scan controller.
    // DOMException.code is not a Zalo response code, even after a limit fallback.
    for (const name of ['AbortError', 'TimeoutError']) {
      for (const firstLimit of [false, true]) {
        const attempts = []
        const transportError = new DOMException('Fixture request interrupted', name)
        const f = fixture({ ...kind, lookup: ({ signal }) => searchZaloPhone(async src => {
          attempts.push(src)
          if (firstLimit && src === 32) throw error('312')
          throw transportError
        }, async code => code === '312' ? 'hour' : null, signal) })
        const r = await f.loader.checkZaloPhones(req())
        assert.equal(r.rows[0].status, 'unknown')
        assert.ok(r.rows.slice(1).every(row => row.status === 'pending'))
        assert.equal(r.stopped, true); assert.equal(f.held(), false)
        assert.doesNotMatch(r.rows[0].note, /mã (20|23)/)
        assert.deepEqual(attempts, firstLimit ? [32, 40] : [32])
        assert.equal(f.calls.filter(c => /^090/.test(c)).length, 1)
        assert.equal(f.calls.filter(c => c === 'release').length, 1)
        assert.deepEqual(f.events.filter(e => e.channel === h.ZALO_PHONE_CHECK_IPC.row).map(e => e.payload.row.status), ['checking', 'unknown'])
      }
    }
    for (const opts of [{ busy: true }, { noSession: true }]) {
      const f = fixture({ ...kind, ...opts }), r = await f.loader.checkZaloPhones(req())
      assert.ok(r.error); assert.ok(r.rows.every(row => row.status === 'pending')); assert.equal(f.calls.filter(c => /^090/.test(c)).length, 0)
    }
    let finish, started
    const waiting = new Promise(resolve => { started = resolve })
    const f = fixture({ ...kind, lookup: () => { started(); return new Promise(resolve => { finish = resolve }) } }), request2 = req()
    const promise = f.loader.checkZaloPhones(request2)
    await waiting
    f.loader.cancelZaloPhoneCheck(71, request2.runId)
    const r = await promise; assert.equal(r.rows[0].status, 'unknown'); assert.equal(r.rows[1].status, 'pending')
    const eventCount = f.events.length
    finish({ user: { uid: 'late', displayName: 'late' } }); await tick()
    assert.equal(f.events.length, eventCount); assert.equal(f.held(), false)
    const early = fixture(kind), earlyRequest = req()
    early.loader.cancelZaloPhoneCheck(71, earlyRequest.runId)
    await assert.rejects(early.loader.checkZaloPhones(earlyRequest), /bị dừng/); assert.deepEqual(early.calls, [])
  }
  // A deadline aborts the request, preserves pending rows and releases exactly once.
  const nativeTimeout = global.setTimeout
  global.setTimeout = (fn, ms, ...args) => nativeTimeout(fn, ms === 30000 ? 5 : ms, ...args)
  try {
    const f = fixture({ lookup: () => new Promise(() => {}) }), r = await f.loader.checkZaloPhones(req())
    assert.equal(r.rows[0].status, 'unknown'); assert.equal(r.rows[1].status, 'pending'); assert.equal(f.calls.filter(c => c === 'release').length, 1)
  } finally { global.setTimeout = nativeTimeout }
  const store = createZaloPhoneCheckStore(); store.load(phones.slice(0, 300)); const request = req()
  store.begin(request.runId, 71, 3); const prior = store.getState(), event = { runId: request.runId, accountId: 71, sequence: 1, row }
  store.row(event); const next = store.getState()
  assert.equal(next.visibleIds, prior.visibleIds); assert.equal(next.rows[phones[299]], prior.rows[phones[299]])
  store.row({ ...event, row: { ...row, name: 'duplicate' } }); assert.equal(store.getState().rows[row.id].name, 'API')
  store.row({ ...event, runId: randomUUID(), sequence: 99 }); assert.equal(store.getState().sequence, 1)
  store.filter('found'); store.selectVisible(true); assert.equal(store.selectedRows().length, 1)
  store.complete({ runId: request.runId, accountId: 71, sequence: 2, stopped: false, rows: [row] })
  store.row({ ...event, sequence: 3 }); assert.equal(store.getState().sequence, 2)
  // Actual Chat client transport uses existing owner-scoped Data Scan routes.
  const originalFetch = globalThis.fetch
  const chat = new ZaloChatApiClient(() => {})
  chat.user = { staffId: 7, organizationId: 9, isChatSync: true, entitlements: { zalo: true }, zaloAccountCapabilities: { server: true } }
  chat.credentials = { username: 'fixture', password: 'fixture' }
  chat.dataScanToken = 'fixture-token'; chat.dataScanTokenExpiresAt = Date.now() + 3600000
  const payloads = []
  let legacy = false, responseCode = 'H', httpStatus = 0
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/data-scan-session')) return new Response(JSON.stringify({
      token: 'fixture-token', staffId: 7, organizationId: 9, expiresAt: new Date(Date.now() + 3600000).toISOString()
    }))
    assert.match(String(url), /data-scan-queries/)
    if (String(url).endsWith('/cancel')) return new Response(JSON.stringify({ status: 'cancelled' }))
    const body = JSON.parse(init.body); payloads.push(body)
    assert.equal(body.queryType, 'find_user_by_phone')
    if (httpStatus) return new Response(JSON.stringify({ error: 'http_error' }), { status: httpStatus })
    if (legacy) return new Response(JSON.stringify({ error: 'phone_check_update_required', message: 'upgrade' }), { status: 503 })
    if (responseCode === '0') return new Response(JSON.stringify({ status: 'succeeded', result: {} }), { status: 202 })
    if (responseCode !== 'H') return new Response(JSON.stringify({ status: 'failed', errorCode: responseCode }), { status: 202 })
    return new Response(JSON.stringify({ status: body.payload.reqSrc === 32 ? 'failed' : 'succeeded',
      errorCode: 'H', result: { uid: '1234', display_name: 'API' } }), { status: 202 })
  }
  try {
    const result = await searchZaloPhone(src => chat.findUserByPhoneSource(71, phones[0], src), policy)
    assert.equal(result.user.uid, '1234'); assert.deepEqual(payloads.map(p => p.payload.reqSrc), [32, 40])
    const source = new ZaloChatContactScanSource(chat, { getZaloErrorPolicyByCode: async code => ({
      disableActionCodes: ['312', '313', '304', '221'].includes(code) ? ['zalo_find_phone_user'] : [],
      disableActionMode: ['313', '304'].includes(code) ? 'end_of_day' : 'fixed_minutes', timeDisableActions: 60
    }) })
    for (const [code, status, sources] of [
      ['0', 'found', [32]],
      ['212', 'not_found', [32]], ['214', 'not_found', [32]], ['216', 'not_found', [32]],
      ['312', 'found', [32, 40]], ['313', 'found', [32, 40]],
      ['304', 'found', [32, 40]], ['221', 'found', [32, 40]], ['999', 'not_found', [32]]
    ]) {
      responseCode = code; payloads.length = 0
      const f = fixture({ server: true })
      f.runtime.findUserByPhone = source.findUserByPhone.bind(source)
      const r = await f.loader.checkZaloPhones(req(phones.slice(0, 2)))
      assert.deepEqual(r.rows.map(row => row.status), [status, status])
      assert.deepEqual(payloads.map(p => p.payload.reqSrc), [...sources, ...sources])
      assert.equal(r.stopped, false); assert.equal(f.held(), false)
    }
    // An HTTP failure is not a Zalo error_code and must still stop the scan.
    for (const status of [401, 429, 503]) {
      httpStatus = status
      const f = fixture({ server: true })
      f.runtime.findUserByPhone = source.findUserByPhone.bind(source)
      const r = await f.loader.checkZaloPhones(req())
      assert.equal(r.rows[0].status, 'unknown'); assert.equal(r.rows[1].status, 'pending')
      assert.match(r.error, /http_error/)
      assert.equal(r.stopped, true); assert.equal(f.held(), false)
    }
    httpStatus = 0
    legacy = true
    await assert.rejects(chat.findUserByPhoneSource(71, phones[0], 32), /cập nhật Chat API/)
    const stopped = new AbortController(); stopped.abort(); const before = payloads.length
    await assert.rejects(chat.findUserByPhoneSource(71, phones[0], 32, stopped.signal)); assert.equal(payloads.length, before)
  } finally { globalThis.fetch = originalFetch }
  // Real legacy gateway binds this ephemeral command to its authenticated socket.
  const { EventEmitter } = require('node:events')
  const { ZaloServerGateway } = load('src/server/main/zaloServerGateway.ts')
  let finishRemote, startedRemote
  const remoteStarted = new Promise(resolve => { startedRemote = resolve })
  const cancellations = []
  const gateway = new ZaloServerGateway({
    getSnapshot: () => ({}), getOperations: () => [],
    executeCommand: async (_staff, command, args) => { assert.equal(command, 'contacts.checkZaloPhones'); startedRemote(); return new Promise(resolve => { finishRemote = resolve }) },
    startControlOperation: () => { throw new Error('Phone scan must not outlive its socket') },
    cancelPhoneCheck: (...args) => cancellations.push(args)
  })
  class Socket extends EventEmitter { readyState = 1; send() {} close() { this.readyState = 3; this.emit('close') } }
  const socket = new Socket()
  gateway.sessions.set('session', { staffId: 7, organizationId: 9, expiresAt: Date.now() + 60000 })
  gateway.acceptSocket(socket, { headers: {} })
  const client = [...gateway.clients][0]
  await gateway.handleSocketMessage(client, JSON.stringify({ type: 'authenticate', token: 'session' }))
  const remoteRequest = req()
  const running = gateway.handleSocketMessage(client, JSON.stringify({ type: 'command', requestId: 'transport-request', command: 'contacts.checkZaloPhones', args: [71, remoteRequest] }))
  await remoteStarted; socket.close()
  assert.deepEqual(cancellations, [[7, 71, remoteRequest.runId]])
  finishRemote({}); await running; await gateway.stop()
  // Invoke real IPC handler: main frame, payload, account, run and session fences.
  const f = fixture(), serverCalls = []
  registerZaloPhoneCheckHandlers(f.win, f.db, f.loader, f.loader, { executeCommand: async (...args) => { serverCalls.push(args); throw new Error('Lệnh server không được hỗ trợ') } }, () => false)
  const ev = { sender: f.win.webContents, senderFrame: f.win.webContents.mainFrame }
  const start = handlers.get(h.ZALO_PHONE_CHECK_IPC.start), cancel = handlers.get(h.ZALO_PHONE_CHECK_IPC.cancel)
  await assert.rejects(start({ ...ev, senderFrame: {} }, req()), /quyền/)
  await assert.rejects(start(ev, req(phones)), /300/)
  assert.equal((await start(ev, req([phones[0]]))).rows[0].status, 'found')
  f.db.getAccount = async () => null
  await assert.rejects(start(ev, req()), /quyền/)
  f.db.getAccount = async () => ({ flatformType: 'zalo', isZaloServer: true })
  await assert.rejects(start(ev, req()), /cập nhật akaAgent Zalo Server/)
  await cancel(ev, randomUUID())
  let entered, settleLate
  const enteredLookup = new Promise(resolve => { entered = resolve })
  const sessionFixture = fixture({ lookup: () => { entered(); return new Promise(resolve => { settleLate = resolve }) } })
  const endSession = registerZaloPhoneCheckHandlers(sessionFixture.win, sessionFixture.db, sessionFixture.loader, sessionFixture.loader, {}, () => false)
  const sessionEvent = { sender: sessionFixture.win.webContents, senderFrame: sessionFixture.win.webContents.mainFrame }
  const oldFlight = handlers.get(h.ZALO_PHONE_CHECK_IPC.start)(sessionEvent, req())
  await enteredLookup
  credentials = { ...credentials }; endSession()
  await assert.rejects(oldFlight, /Phiên đăng nhập đã thay đổi/)
  const sentBeforeLate = sessionFixture.events.length
  settleLate({ user: { uid: '1234', displayName: 'Late session' } }); await tick()
  assert.equal(sessionFixture.events.length, sentBeforeLate)
  assert.equal(sessionFixture.held(), false)
  const mixed = [{ ...row }, { ...row, id: phones[1], phone: phones[1], accountId: 72 }]
  assert.throws(() => h.zaloPhoneCheckGroupRows(mixed, 'zalo_person'), /cùng một tài khoản/)
  let runtimeEntered
  const runtimeReady = new Promise(resolve => { runtimeEntered = resolve })
  const changing = fixture({ server: true, legacy: true, lookup: () => { runtimeEntered(); return new Promise(() => {}) } })
  const changingRun = changing.loader.checkZaloPhones(req())
  await runtimeReady; changing.loader.cancelAllZaloPhoneChecks()
  const changed = await changingRun
  assert.equal(changed.rows[0].status, 'unknown'); assert.equal(changed.rows[1].status, 'pending'); assert.equal(changing.held(), false)
  for (const user of [null, { uid: '[object Object]', displayName: 'Tên API' }]) {
    const f = fixture({ lookup: async () => ({ user }) })
    const r = await f.loader.checkZaloPhones(req())
    assert.ok(r.rows.every(row => row.status === 'found' && row.uid === ''))
    assert.equal(r.rows[0].name, user?.displayName || '')
    assert.equal(r.stopped, false)
    assert.throws(() => h.zaloPhoneCheckGroupRows(r.rows, 'zalo_person'), /Zalo ID/)
  }
  if (process.versions.electron) await checkNativeWebAbort()
  console.log('PASS akaBizAuto code parity (0/limits/other), DOM abort/timeout vs API codes, continuation and empty UID, real Chat transport/fallback vs HTTP errors, normalization, 300/301, Excel/groups, QR/Web/legacy/Chat, busy/auth, timeout/cancel/late results, store and IPC')
}
main().then(() => { if (process.versions.electron) require('electron').app.quit() }).catch(error => {
  console.error(error)
  if (process.versions.electron) require('electron').app.exit(1)
  else process.exitCode = 1
})
