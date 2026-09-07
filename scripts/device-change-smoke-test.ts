import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { DeviceChangeRequestClient } from '../src/main/services/deviceChangeRequest'
import { PassiveDevicePresence } from '../src/main/services/passiveDevicePresence'

const device = { fingerprintHash: 'a'.repeat(64), label: 'Smoke', platform: 'mac' as const, appVersion: 'test' }
const credentials = { username: 'smoke', password: 'must-not-be-persisted' }
const binding = { staffId: '42', hash: device.fingerprintHash, boundAt: '2026-09-07T00:00:00Z' }
const changed = { success: true, changed: true, code: 'changed', remainingChanges: 4 }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function requestsSmoke(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'aka-device-request-'))
  let prepares = 0
  let mutations = 0
  const attempts: Array<Record<string, unknown>> = []
  let loseResponse = true
  const options = {
    directory,
    getDevice: async () => device,
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'aka_agent_prepare_device_change') { prepares++; return { code: 'prepared', binding } }
      attempts.push(args)
      if (attempts.length === 1) mutations++
      const files = await readdir(directory)
      const journal = await readFile(join(directory, files.find(name => name.endsWith('.json'))!), 'utf8')
      assert(!journal.includes(credentials.password), 'journal never contains credentials')
      assert.equal(JSON.parse(journal).requestId, args.p_request_id, 'journal persisted before mutation')
      if (loseResponse) throw new Error('Response lost after commit')
      return changed
    }
  }
  try {
    const client = new DeviceChangeRequestClient(options)
    const a = client.reset(' smoke ', 'account_menu', credentials.password)
    const b = client.reset('smoke', 'account_menu', credentials.password)
    assert.equal(a, b, 'double click shares one request')
    await assert.rejects(a, /Response lost/)
    assert.equal(attempts.length, 1)
    assert.equal(prepares, 1)
    loseResponse = false
    const restarted = new DeviceChangeRequestClient(options)
    assert.deepEqual(await restarted.reset('smoke', 'account_menu', credentials.password), changed)
    assert.equal(attempts[0].p_request_id, attempts[1].p_request_id, 'restart reuses ID')
    assert.deepEqual(attempts[0].p_expected_binding, attempts[1].p_expected_binding, 'restart preserves original CAS')
    assert.equal(prepares, 1, 'retry does not refresh binding')
    assert.equal(mutations, 1)
    assert.deepEqual(await readdir(directory), [], 'known response clears pending')

    // Invalid responses keep the original journal; a later conflict is terminal.
    let invalid = true
    const broken = new DeviceChangeRequestClient({ ...options, rpc: async (name) => name.includes('prepare')
      ? { code: 'prepared', binding }
      : invalid ? null : { success: false, changed: false, code: 'binding_conflict', remainingChanges: 4 } })
    await assert.rejects(broken.reset('smoke', 'login'), /chưa được xác nhận/)
    assert.equal((await readdir(directory)).length, 1)
    invalid = false
    assert.equal((await broken.reset('smoke', 'login')).code, 'binding_conflict')
    assert.deepEqual(await readdir(directory), [])
  } finally { await rm(directory, { recursive: true, force: true }) }
}

async function presenceSmoke(): Promise<void> {
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 0 })
  const sends: Array<Record<string, unknown>> = []
  let online = false
  let hang = false
  let warnings = 0
  let active = 0
  let maxActive = 0
  const service = new PassiveDevicePresence({
    getDevice: async () => device,
    warn: () => { warnings++ },
    send: async (args, signal) => {
      sends.push(args)
      active++
      maxActive = Math.max(maxActive, active)
      try {
        if (hang) await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
        if (!online) throw new Error('offline')
      } finally { active-- }
    }
  })
  try {
    service.start(credentials)
    await flush()
    const id = sends[0].p_instance_id
    // Ten minutes of failures still produce heartbeats for the original login.
    for (let i = 0; i < 20; i++) { mock.timers.tick(30_000); await flush() }
    assert.equal(sends.length, 21)
    assert(sends.every(request => request.p_instance_id === id && request.p_ended === false))
    assert.equal(warnings, 3, 'diagnostics limited to one per five minutes')
    online = true
    mock.timers.tick(30_000); await flush()
    assert.equal(sends.at(-1)!.p_instance_id, id, 'reconnect keeps instance')

    hang = true
    mock.timers.tick(30_000); await flush()
    service.heartbeat(); service.heartbeat(); await flush()
    assert.equal(active, 1, 'single flight')
    mock.timers.tick(5_000); await flush()
    assert.equal(active, 0, 'five second request abort')
    hang = false
    service.updateCredentials({ ...credentials, password: 'new-password' })
    mock.timers.tick(25_000); await flush()
    assert.equal(sends.at(-1)!.p_password, 'new-password')
    assert.equal(sends.at(-1)!.p_instance_id, id)
    service.stop()
    await flush()
    assert.equal(sends.at(-1)!.p_ended, true)
    const endedCount = sends.length
    mock.timers.tick(600_000); await flush()
    assert.equal(sends.length, endedCount, 'no heartbeat after logout')
    service.start(credentials); await flush()
    assert.notEqual(sends.at(-1)!.p_instance_id, id, 'next login creates a new instance')
    assert.equal(maxActive, 1)
    service.stop(); await flush()

    // Quit during an outstanding registration returns immediately, then ends
    // the same instance after that request's deadline, even while offline.
    hang = true
    service.start(credentials); await flush()
    const quittingId = sends.at(-1)!.p_instance_id
    service.stop()
    assert.equal(sends.at(-1)!.p_ended, false)
    mock.timers.tick(5_000); await flush()
    assert.equal(sends.at(-1)!.p_instance_id, quittingId)
    assert.equal(sends.at(-1)!.p_ended, true)
    mock.timers.tick(5_000); await flush()
    assert.equal(maxActive, 1)
  } finally { service.stop(); mock.timers.reset() }
}

async function presenceReloginSmoke(): Promise<void> {
  for (const scenario of ['relogin', 'replace_queued_login', 'stop_queued_login'] as const) {
    mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 0 })
    const endReply = deferred()
    const sends: Array<Record<string, unknown>> = []
    let active = 0
    let maxActive = 0
    const service = new PassiveDevicePresence({
      getDevice: async () => device,
      warn: () => {},
      send: async args => {
        sends.push(args)
        maxActive = Math.max(maxActive, ++active)
        try { if (args.p_ended) await endReply.promise } finally { active-- }
      }
    })
    try {
      service.start(credentials); await flush()
      const originalId = sends[0].p_instance_id
      service.stop(); await flush()
      service.start(credentials)
      if (scenario === 'replace_queued_login') service.start(credentials)
      if (scenario === 'stop_queued_login') service.stop()
      await flush()
      assert.equal(sends.filter(args => !args.p_ended).length, 1, 'new login waits for the existing request')
      endReply.resolve(); await flush()
      const heartbeats = sends.filter(args => !args.p_ended)
      if (scenario === 'stop_queued_login') {
        assert.equal(heartbeats.length, 1, 'stopped pending login never registers')
      } else {
        assert.equal(heartbeats.length, 2, 'current login registers immediately when the queue drains')
        assert.notEqual(heartbeats[1].p_instance_id, originalId)
        assert.equal(Date.now(), 0, 'initial heartbeat does not wait for the 30 second interval')
        const endedIds = new Set(sends.filter(args => args.p_ended).map(args => args.p_instance_id))
        assert(!endedIds.has(heartbeats[1].p_instance_id), 'a replaced login cannot send a late initial heartbeat')
      }
      assert.equal(maxActive, 1, 'relogin preserves single flight')
    } finally {
      endReply.resolve()
      service.stop(); await flush()
      mock.timers.reset()
    }
  }
}

async function presenceQuitSmoke(): Promise<void> {
  // Execute the actual before-quit callback with controlled runtime services.
  // Loading the full Electron handler module would start unrelated services.
  const path = join(process.cwd(), 'src/main/ipc/handlers.ts')
  const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
  let registration: ts.CallExpression | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(source) === 'app' && node.expression.name.text === 'on'
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'before-quit') {
      registration = node
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert(registration, 'before-quit handler exists')
  const code = ts.transpileModule(registration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'], now: 0 })
  const automationStopped = deferred()
  const recoveryFinished = deferred()
  const endReply = deferred()
  const order: string[] = []
  const service = new PassiveDevicePresence({
    getDevice: async () => device,
    warn: () => {},
    send: async args => {
      order.push(args.p_ended ? 'presence_end' : 'heartbeat')
      if (args.p_ended) await endReply.promise
    }
  })
  let beforeQuit!: (event: { preventDefault(): void }) => void
  const noop = () => {}
  try {
    runInNewContext(code, {
      quitCleanupStarted: false, quitCleanupCompleted: false,
      runtimeCredentials: credentials, restartRequiredActivation: null,
      devicePresence: service,
      app: { on: (_event: string, handler: typeof beforeQuit) => { beforeQuit = handler }, quit: () => { order.push('quit') } },
      getCurrentUser: () => ({ staffId: 42 }),
      clearSessionExpiryTimer: noop, cancelLocalHandoffRetry: noop, cancelDesktopHandoffAckRetry: noop,
      clearZaloLocalStartupHandoffBlock: noop, stopZaloRemoteClients: noop,
      contactLoader: { stopAll: noop }, campaignScheduler: { stop: noop },
      automationProcessor: { stop: () => automationStopped.promise },
      accountPollerController: { blockZaloRuntime: noop },
      zaloRealtimeGroupManager: { stop: noop }, accountZaloOperations: { stopAll: async () => {} },
      zaloRuntime: { clearAll: noop }, emailRuntime: { clearAll: noop },
      runScopedRecovery: async () => { await recoveryFinished.promise; order.push('recovery_done') },
      console: { error: (message: string) => { throw new Error(message) } }
    })
    service.start(credentials); await flush()
    beforeQuit({ preventDefault: noop }); await flush()
    assert(!order.includes('presence_end'), 'presence stays active while automation stops')
    mock.timers.tick(30_000); await flush()
    assert.equal(order.filter(event => event === 'heartbeat').length, 2, 'cleanup keeps sending heartbeats')
    automationStopped.resolve(); await flush()
    assert(!order.includes('presence_end'), 'presence stays active through DB recovery')
    mock.timers.tick(30_000); await flush()
    assert.equal(order.filter(event => event === 'heartbeat').length, 3)
    recoveryFinished.resolve(); await flush()
    assert(order.indexOf('presence_end') > order.indexOf('recovery_done'), 'end only after runtime cleanup')
    assert(order.includes('quit'), 'quit does not await the pending end response')
    const sentBeforeQuit = order.filter(event => event === 'heartbeat').length
    endReply.resolve(); await flush()
    mock.timers.tick(30_000); await flush()
    assert.equal(order.filter(event => event === 'heartbeat').length, sentBeforeQuit, 'no heartbeat after quit')
  } finally {
    automationStopped.resolve(); recoveryFinished.resolve(); endReply.resolve()
    service.stop(); await flush()
    mock.timers.reset()
  }
}

async function main(): Promise<void> {
  await requestsSmoke()
  await presenceSmoke()
  await presenceReloginSmoke()
  await presenceQuitSmoke()
  console.log('Device change smoke passed: persisted retry, outage/reconnect, single flight, immediate relogin heartbeat, superseded sessions, presence through quit cleanup and nonblocking quit.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
