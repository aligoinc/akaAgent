import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as hardwareIdentity from '../../src/main/services/hardwareDeviceIdentity'
import * as hardwareReaders from '../../src/main/services/deviceHardwareReaders'
import { DeviceBindingMigration } from '../../src/main/services/deviceBindingMigration'
import { DeviceChangeRequestClient } from '../../src/main/services/deviceChangeRequest'
import { IPC_EVENTS } from '../../src/shared/types'

const hash = (n: number) => n.toString(16).padStart(64, '0')
const credentials = { username: 'alice', password: 'fixture-password' }
const secret = 'd'.repeat(64)
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))
async function load(file: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}): Promise<any> {
  const exports = {}
  const code = ts.transpileModule(await readFile(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  runInNewContext(code, { exports, console, Buffer, AbortSignal, ...globals, require: (name: string) => {
    if (name in mocks) return mocks[name]
    if (name.startsWith('node:')) return require(name)
    throw new Error('Unexpected dependency ' + name)
  } })
  return exports
}

export async function reviewRegressions(root: string): Promise<number> {
  let checks = 0
  const pass = (name: string) => { checks++; console.log('PASS', name) }
  // Real proof file, proof reader, repository, migration journal and registration;
  // mock only hardware and RPC responses, keeping each account/hash binding explicit.
  for (const scenario of ['v3', 'v2', 'v2-collision', 'v3-collision', 'invalid', 'network', 'timeout', 'no-proof', 'corrupt-proof', 'hardware-error'] as const) {
    const directory = join(root, 'review-proof-' + scenario)
    await mkdir(directory)
    if (scenario !== 'no-proof') await writeFile(join(directory, 'staff-device-recovery-v1.key'), scenario === 'corrupt-proof' ? 'partial' : secret)
    const reads: string[] = [], actions: string[] = []
    let boundHash = scenario === 'v3' ? hash(3) : hash(2), oldReads = 0
    const builder: any = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ data: { id: 1, name: 'fixture' } }) }
    const client = { from: (table: string) => { assert.equal(table, 'org_organization'); return builder }, rpc: (name: string, input: any) => {
      assert.equal(name, 'aka_agent_recover_staff_credentials')
      reads.push(input.p_fingerprint_hash)
      assert.equal(input.p_secret, secret, 'both attempts require the same local proof')
      return { abortSignal: async () => {
        if (scenario === 'network' || scenario === 'timeout') return { data: null, error: { code: scenario === 'network' ? 'NETWORK' : '57014', message: 'unavailable' } }
        if (scenario === 'invalid' || input.p_fingerprint_hash !== boundHash) return { data: null, error: { code: 'P0001', message: 'staff_recovery_invalid' } }
        return { data: scenario === 'v2-collision' ? { status: 'manual_login_required' } : credentials, error: null }
      } }
    } }
    const rpc = async (auth: any, action: string, input: any) => {
      assert.deepEqual(plain(auth), credentials)
      actions.push(action)
      if (action === 'prepare_device_v3' || action === 'bind_device_v3') {
        assert.equal(input.source, 'recovery', 'proof login never upgrades itself to manual')
        assert.equal(input.fingerprintHash, hash(3))
        assert.equal(input.legacyHash, hash(2))
      }
      if (action === 'bind_device_v3') boundHash = hash(3)
      if (action === 'register_recovery') {
        assert.equal(boundHash, hash(3))
        assert.equal(input.fingerprintHash, hash(3))
        assert.equal(input.secretHash, createHash('sha256').update(secret).digest('hex'))
      }
      return { id: 1, organization_id: 1, username: 'alice', is_active: true, is_policy_accepted: true,
        deviceV3: { decision: scenario === 'v3-collision' ? 'manual_login_required' : 'allowed', automaticAllowed: true,
          needsBinding: boundHash !== hash(3), binding: { hash: boundHash, version: boundHash === hash(3) ? 3 : 2, revision: '0' } } }
    }
    const proof = await load('src/main/services/staffDeviceRecovery.ts', {
      electron: { app: { getPath: () => directory } }, '../data/supabaseClient': { getSupabaseClient: () => client },
      '../data/repositories/staffClientRepository': { callStaffClient: rpc }
    })
    const repo = await load('src/main/data/repositories/authRepository.ts', {
      electron: { app: { getPath: () => directory } }, '../../services/deviceBindingMigration': { DeviceBindingMigration },
      '../../services/deviceIdentity': { getCurrentDeviceIdentity: async () => ({ fingerprintHash: hash(3), platform: 'win', label: 'fixture' }),
        getV2DeviceIdentity: async () => { oldReads++; if (scenario === 'hardware-error') throw new Error('WMI unavailable'); return { fingerprintHash: hash(2) } } },
      '../../services/deviceChangeService': {}, '../currentUser': {}, '../supabaseClient': { callDesktopSessionEndpoint:async()=>({staffId:1,organizationId:1,products:[]}),desktopSession:{revision:()=>0,install:()=>{},clear:()=>{}},desktopSessionTransport:{login:async()=>({staffId:1,organizationId:1,accessToken:'fixture'}),revoke:async()=>{}},getSupabaseClient: () => client },
      './staffClientRepository': { callStaffClient: rpc }, '../../services/staffDeviceRecovery': proof,
      './entitlementRepository': { ensureLoginProductsActive: async () => {}, loadOrganizationEntitlementAccess: async () => ({ entitlements: {}, zaloAccountCapabilities: {}, chatSyncEnabled: false }), loadOrganizationAccountProducts: async () => [], loadOrganizationChatSyncProducts: async () => [] },
      './zaloRuntimeModeRepository': { loadStaffZaloServerModeSnapshot: async () => ({}) },
      './staffManagementRepository': { readStaffAccess: async () => ({ isActive: true, timeAllowed: true }) }
    })
    if (scenario === 'v2' || scenario === 'v3') {
      assert.deepEqual(plain(await repo.recoverDeviceCredentials()), credentials)
      assert.deepEqual(reads, scenario === 'v2' ? [hash(3), hash(2)] : [hash(3)])
      assert.equal((await repo.login('alice', credentials.password, undefined, 'recovery')).status, 'authenticated')
      assert(actions.includes('register_recovery'))
      reads.length = 0
      assert.deepEqual(plain(await repo.recoverDeviceCredentials()), credentials)
      assert.deepEqual(reads, [hash(3)], 'next recovery uses the confirmed v3 binding')
    } else if (scenario.endsWith('collision')) {
      assert.equal(await repo.recoverDeviceCredentials(), null)
      assert.deepEqual(actions, scenario === 'v2-collision' ? [] : ['prepare_device_v3'])
    } else {
      await assert.rejects(repo.recoverDeviceCredentials())
      assert.equal(actions.length, 0)
      assert.equal(reads.length, scenario === 'invalid' ? 2 : ['no-proof', 'corrupt-proof'].includes(scenario) ? 0 : 1)
      if (scenario !== 'invalid' && scenario !== 'hardware-error') assert.equal(oldReads, 0)
    }
    pass('review proof upgrade ' + scenario)
  }

  // Real identity/selection, reset request journal and Main IPC. A newly readable
  // onboard Ethernet adapter must not replace the Wi-Fi selected for Alice.
  const directory = join(root, 'review-reset')
  await mkdir(directory)
  const wifi = { key: 'pci:wifi', kind: 'wifi' as const, permanentAddress: '00:11:22:33:44:55' }
  const ethernet = { key: 'pci:ethernet', kind: 'ethernet' as const, permanentAddress: '00:11:22:33:44:66' }
  let hardware: hardwareIdentity.CompositeHardware = { uuid: '12345678-1234-1234-1234-123456789012', serials: ['board-111'], machineGuid: '22345678-1234-1234-1234-123456789012', adapters: [wifi] }
  let failedRead = false, oldReads = 0
  const identity = await load('src/main/services/deviceIdentity.ts', {
    electron: { app: { getPath: () => directory } }, './hardwareDeviceIdentity': hardwareIdentity, './deviceHardwareReaders': hardwareReaders,
    child_process: { execFile: () => {} }, crypto: { createHash }, os: { hostname: () => 'fixture' },
    util: { promisify: () => async (_file: string, args: string[]) => {
      if (args.join(' ').includes('MSFT_NetAdapter')) { if (failedRead) throw new Error('WMI timeout'); return { stdout: JSON.stringify(hardware) } }
      oldReads++; return { stdout: JSON.stringify({ uuid: hardware.uuid, serials: hardware.serials }) }
    } }
  }, { process: { platform: 'win32' } })
  const original = (await identity.getCurrentDeviceIdentity(true)).fingerprintHash
  const file = join(directory, 'device-identity-v3.json'), manifest = await readFile(file, 'utf8')
  hardware.adapters = [ethernet, wifi]
  let outcome = 'changed', resetCalls = 0, lostResponse = false, afterReset: (() => void) | undefined
  const requests = new DeviceChangeRequestClient({ directory: join(directory, 'requests'), bindingVersion: 2,
    getDevice: async () => ({ ...await identity.getDeviceForBindingReset(), appVersion: 'fixture' }),
    rpc: async (name, input) => {
      if (name.includes('prepare')) return { code: 'prepared', binding: { staffId: '2', hash: original, version: 2, revision: '1' } }
      resetCalls++
      if (lostResponse) throw new Error('response lost')
      afterReset?.()
      return { code: outcome, success: outcome !== 'binding_conflict', changed: outcome === 'changed', remainingChanges: 4 }
    }
  })
  const callbacks: Record<string, Function> = {}
  const handler = await load('src/main/ipc/handlers/authHandlers.ts', {
    electron: { app: {}, ipcMain: { handle: (key: string, fn: Function) => callbacks[key] = fn } }, '../../../shared/types': { IPC_EVENTS },
    '../../services/deviceIdentity': identity, '../../data/repositories/authRepository': { resetDeviceLock: () => requests.reset('alice', 'account_menu', credentials.password) },
    '../../data/currentUser': { getCurrentUser: () => ({ username: 'alice' }), getCurrentUserCredentials: () => credentials },
    '../../services/localLoginService': { getLocalLoginStore: () => ({ updateOptions: async () => ({ loginOptions: {} }) }) },
    '../../services/deviceChangeService': { getDeviceChangeRequests: () => requests }, '../../services/devicePresenceService': {}, '../../services/zaloCampaignEngagement': {}
  })
  handler.registerAuthHandlers()
  for (const code of ['changed', 'already_unbound', 'binding_conflict']) {
    outcome = code
    await callbacks[IPC_EVENTS.AUTH_RESET_DEVICE_LOCK_BY_USERNAME](null, 'bob')
    assert.equal(await readFile(file, 'utf8'), manifest)
    assert.equal((await identity.getCurrentDeviceIdentity(true)).fingerprintHash, original)
    pass('review reset another account preserves selected adapter: ' + code)
  }
  outcome = 'changed'
  await callbacks[IPC_EVENTS.AUTH_RESET_DEVICE_LOCK]()
  assert.equal(await readFile(file, 'utf8'), manifest)
  pass('review account-menu reset preserves valid selection')
  hardware.adapters = [ethernet]
  outcome = 'binding_conflict'
  await callbacks[IPC_EVENTS.AUTH_RESET_DEVICE_LOCK_BY_USERNAME](null, 'alice')
  assert.equal(await readFile(file, 'utf8'), manifest)
  assert.equal(oldReads, 0, 'confirmed missing adapter uses remaining hardware for reset audit, never v2')
  pass('review rejected reset cannot repair missing hardware selection')
  const callsBeforeFailure = resetCalls
  failedRead = true
  await assert.rejects(callbacks[IPC_EVENTS.AUTH_RESET_DEVICE_LOCK_BY_USERNAME](null, 'alice'))
  assert.equal(resetCalls, callsBeforeFailure)
  assert.equal(oldReads, 0, 'transient read error must not fall back to v2')
  assert.equal(await readFile(file, 'utf8'), manifest)
  pass('review WMI error never resets or erases selection')
  failedRead = false; outcome = 'changed'; lostResponse = true
  await assert.rejects(callbacks[IPC_EVENTS.AUTH_RESET_DEVICE_LOCK_BY_USERNAME](null, 'alice'))
  assert.equal(await readFile(file, 'utf8'), manifest)
  pass('review unknown reset result keeps selection')
  lostResponse = false
  afterReset = () => { hardware.adapters = [ethernet, wifi] }
  await callbacks[IPC_EVENTS.AUTH_RESET_DEVICE_LOCK_BY_USERNAME](null, 'alice')
  assert.equal(await readFile(file, 'utf8'), manifest)
  assert.equal((await identity.getCurrentDeviceIdentity(true)).fingerprintHash, original)
  pass('review hardware returning before reset confirmation retains original selection')
  afterReset = undefined; hardware.adapters = [ethernet]
  await callbacks[IPC_EVENTS.AUTH_RESET_DEVICE_LOCK_BY_USERNAME](null, 'alice')
  await assert.rejects(readFile(file), { code: 'ENOENT' })
  assert.notEqual((await identity.getCurrentDeviceIdentity(true)).fingerprintHash, original)
  pass('review confirmed reset repairs genuinely missing selected hardware')
  checks += await resetJournalRegressions(root)
  return checks
}

async function resetJournalRegressions(root: string): Promise<number> {
  let checks = 0
  const pass = (name: string) => { checks++; console.log('PASS', name) }
  const directory = join(root, 'reset-without-v2')
  await mkdir(directory)
  const wifi = { key: 'pci:wifi', kind: 'wifi' as const, permanentAddress: '00:11:22:33:44:55' }
  let hardware: hardwareIdentity.CompositeHardware = { uuid: '00000000-0000-0000-0000-000000000000', serials: ['Default string'],
    machineGuid: '22345678-1234-1234-1234-123456789012', adapters: [wifi] }
  let failedRead = false, hardwareReads = 0
  const loadIdentity = () => load('src/main/services/deviceIdentity.ts', {
    electron: { app: { getPath: () => directory } }, './hardwareDeviceIdentity': hardwareIdentity, './deviceHardwareReaders': hardwareReaders,
    child_process: { execFile: () => {} }, crypto: { createHash }, os: { hostname: () => 'fixture' },
    util: { promisify: () => async (_file: string, args: string[]) => {
      if (!args.join(' ').includes('MSFT_NetAdapter')) throw new Error('must not depend on v2')
      hardwareReads++
      if (failedRead) throw new Error('WMI timeout')
      return { stdout: JSON.stringify(hardware) }
    } }
  }, { process: { platform: 'win32' } })
  let identity = await loadIdentity()
  const original = (await identity.getCurrentDeviceIdentity(true)).fingerprintHash
  const file = join(directory, 'device-identity-v3.json'), manifest = await readFile(file, 'utf8')
  hardware.adapters = []
  // Restart rules out relying on a cached v2 or last successful v3 identity.
  identity = await loadIdentity()
  const audit = await identity.getDeviceForBindingReset()
  assert.match(audit.fingerprintHash, /^[a-f0-9]{64}$/)
  assert.notEqual(audit.fingerprintHash, original)
  assert.equal(await readFile(file, 'utf8'), manifest)
  await assert.rejects(identity.getCurrentDeviceIdentity(true), hardwareIdentity.SelectedHardwareMissingError)
  await assert.rejects(readFile(join(directory, 'device-identity-v2.json')), { code: 'ENOENT' })
  pass('reset audit works after restart without any v2 identity and cannot become login identity')

  let loseResponse = true, prepareCalls = 0, mutations = 0
  const attempts: any[] = []
  const requestsDirectory = join(directory, 'requests')
  const options = { directory: requestsDirectory, bindingVersion: 2 as const,
    getDevice: async () => ({ ...await identity.getDeviceForBindingReset(), appVersion: 'fixture' }),
    rpc: async (name: string, input: any) => {
      if (name.includes('prepare')) { prepareCalls++; return { code: 'prepared', binding: { staffId: '1', hash: original, version: 2, revision: '1' } } }
      const journal = JSON.parse(await readFile(join(requestsDirectory, (await readdir(requestsDirectory))[0]), 'utf8'))
      assert.equal(journal.version, 2)
      assert.deepEqual(journal.device, plain(input.p_device), 'exact reset payload is durable before mutation')
      assert(!JSON.stringify(journal).includes(credentials.password))
      attempts.push(plain(input))
      if (attempts.length === 1) mutations++
      else assert.deepEqual(input.p_device, attempts[0].p_device, 'server receipt compares the original device hash')
      if (loseResponse) throw new Error('committed, response lost')
      return { success: true, changed: true, code: 'changed', remainingChanges: 4 }
    }
  }
  await assert.rejects(new DeviceChangeRequestClient(options).reset('alice', 'login'))
  assert.equal(await readFile(file, 'utf8'), manifest)
  const readsBeforeReplay = hardwareReads
  // The card is back, but the reader also could be unavailable: neither changes replay.
  hardware.adapters = [wifi]; identity = await loadIdentity(); failedRead = true; loseResponse = false
  const replay = await new DeviceChangeRequestClient(options).reset('alice', 'login')
  assert.equal(replay.remainingChanges, 4)
  assert.equal(hardwareReads, readsBeforeReplay)
  assert.equal(prepareCalls, 1); assert.equal(mutations, 1)
  assert.deepEqual(attempts[1], attempts[0])
  assert.equal((await readdir(requestsDirectory)).length, 0)
  failedRead = false
  await identity.resetCompositeSelection()
  assert.equal((await identity.getCurrentDeviceIdentity(true)).fingerprintHash, original)
  pass('reset replay survives restart, returning adapter and read outage with identical ID/CAS/device and one quota charge')

  hardware.adapters = []
  await new DeviceChangeRequestClient({ ...options, rpc: async (name: string) => name.includes('prepare')
    ? { code: 'prepared', binding: { staffId: '1', hash: original, version: 2, revision: '1' } }
    : { success: true, changed: false, code: 'already_unbound', remainingChanges: 4 } }).reset('alice', 'login')
  await identity.resetCompositeSelection()
  await assert.rejects(readFile(file), { code: 'ENOENT' })
  const nextHash = (await identity.getCurrentDeviceIdentity(true)).fingerprintHash
  assert.notEqual(nextHash, audit.fingerprintHash, 'reset audit domain never becomes the replacement login hash')
  pass('successful reset without v2 allows a new valid selection from remaining hardware')
  hardware = { uuid: null, serials: [], machineGuid: null, adapters: [] }
  await assert.rejects(identity.getDeviceForBindingReset())
  pass('empty hardware cannot produce even a reset audit hash')

  // Compatibility is isolated to journals from the published v2 client. New
  // journals with missing/corrupt metadata must fail closed, never reconstruct it.
  const legacyDirectory = join(root, 'legacy-reset-journal')
  await mkdir(legacyDirectory)
  const key = createHash('sha256').update(JSON.stringify(['login', 'alice'])).digest('hex')
  const legacyFile = join(legacyDirectory, key + '.json')
  const legacy = { version: 1, username: 'alice', source: 'login', requestId: randomUUID(), binding: { staffId: '1', hash: hash(2), version: 2, revision: '1' } }
  await writeFile(legacyFile, JSON.stringify(legacy))
  let legacyReads = 0, legacyRpc = 0, loseLegacy = true
  const legacyDevice = { fingerprintHash: hash(2), platform: 'win' as const, label: 'old', appVersion: 'old' }
  const legacyOptions = { directory: legacyDirectory, bindingVersion: 2 as const,
    getDevice: async () => { throw new Error('must not replace old audit metadata with v3') },
    getLegacyJournalDevice: async () => { legacyReads++; return legacyDevice },
    rpc: async (_name: string, input: any) => {
      legacyRpc++
      assert.equal(input.p_request_id, legacy.requestId)
      assert.deepEqual(plain(input.p_expected_binding), legacy.binding)
      assert.deepEqual(plain(input.p_device), legacyDevice)
      assert.equal(JSON.parse(await readFile(legacyFile, 'utf8')).version, 2)
      if (loseLegacy) throw new Error('lost')
      return { success: true, changed: true, code: 'changed', remainingChanges: 4 }
    }
  }
  await assert.rejects(new DeviceChangeRequestClient(legacyOptions).reset('alice', 'login'))
  loseLegacy = false
  await new DeviceChangeRequestClient({ ...legacyOptions, getLegacyJournalDevice: async () => { throw new Error('legacy read must happen once') } }).reset('alice', 'login')
  assert.equal(legacyReads, 1); assert.equal(legacyRpc, 2)
  pass('old v2 journal preserves ID/CAS and freezes v2 audit metadata once before replay')
  for (const device of [undefined, { ...legacyDevice, fingerprintHash: 'bad' }]) {
    await writeFile(legacyFile, JSON.stringify({ ...legacy, version: 2, device }))
    await assert.rejects(new DeviceChangeRequestClient(legacyOptions).reset('alice', 'login'))
    assert.equal(legacyReads, 1); assert.equal(legacyRpc, 2)
  }
  pass('corrupt current journal never reconstructs request metadata or reaches the server')
  await writeFile(legacyFile, JSON.stringify(legacy))
  await assert.rejects(new DeviceChangeRequestClient({ ...legacyOptions, getLegacyJournalDevice: async () => { throw new Error('old identity unavailable') } }).reset('alice', 'login'))
  assert.deepEqual(JSON.parse(await readFile(legacyFile, 'utf8')), legacy)
  assert.equal(legacyRpc, 2)
  pass('unreadable legacy identity preserves the old pending journal without sending a guessed payload')
  const diskFailure = await load('src/main/services/deviceChangeRequest.ts', {
    './atomicLocalFile': { writeAtomicLocalFile: async () => { throw new Error('disk full') } }
  })
  let diskMutations = 0
  await assert.rejects(new diskFailure.DeviceChangeRequestClient({
    directory: join(root, 'reset-disk-failure'), bindingVersion: 2, getDevice: async () => legacyDevice,
    rpc: async (name: string) => {
      if (name.includes('prepare')) return { code: 'prepared', binding: legacy.binding }
      diskMutations++; return { success: true, changed: true, code: 'changed', remainingChanges: 4 }
    }
  }).reset('alice', 'login'), /disk full/)
  assert.equal(diskMutations, 0)
  pass('reset journal write failure cannot send a mutation')
  return checks
}
