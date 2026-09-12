import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { IPC_EVENTS } from '../src/shared/types'
import { LocalLoginStore } from '../src/main/services/localLoginStore'
import { HardwareDeviceIdentity, normalizeHardwareUuid, normalizeBoardSerials } from '../src/main/services/hardwareDeviceIdentity'
import { DeviceChangeRequestClient } from '../src/main/services/deviceChangeRequest'

const credentials = { username: 'dummy-user', password: 'dummy-password' }
const options = { rememberLogin: true, autoLogin: true, startupEnabled: false }
const encrypt = (value: string) => Buffer.from([...Buffer.from(value)].map(v => v ^ 93))
const decrypt = (value: Buffer) => Buffer.from([...value].map(v => v ^ 93)).toString()
let checks = 0
async function storage(root: string): Promise<void> {
  const file = join(root, 'login.json')
  const config = { file, encrypt, decrypt }
  let store = new LocalLoginStore(config)
  await store.initialize(); assert(store.mayImportLegacy()); checks++
  store.importLegacy(credentials, options, 0)
  await store.updateOptions({ autoLogin: false })
  assert.equal(JSON.parse(await readFile(file, 'utf8')).encryptedCredential, null, 'imported password not persisted by checkbox'); checks++
  await store.saveAuthenticated(credentials)
  assert(!(await readFile(file, 'utf8')).includes(credentials.password)); checks++
  assert(!JSON.stringify(store.snapshot()).includes(credentials.password)); checks++
  store = new LocalLoginStore(config); await store.initialize()
  assert.deepEqual(store.getCredentials(), credentials, 'independent store reopens saved credential'); checks++
  await store.updateOptions({ startupEnabled: true })
  store = new LocalLoginStore(config); await store.initialize()
  assert.deepEqual(store.getCredentials(), credentials, 'option save preserves authenticated remembered credential'); checks++
  await store.updateOptions({ rememberLogin: false })
  assert.equal(store.getCredentials(), null); assert.equal(store.snapshot().loginOptions.autoLogin, false)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).encryptedCredential, null); checks++
  await store.updateOptions({ autoLogin: true })
  assert.equal(store.snapshot().loginOptions.rememberLogin, true, 'checking auto enables remember')
  assert.equal(store.snapshot().loginOptions.autoLogin, true); checks++
  await store.updateOptions({ rememberLogin: false })
  await store.updateOptions({ rememberLogin: true })
  assert.equal(store.getCredentials(), null, 'rechecking does not recover deleted password'); checks++
  const failing = new LocalLoginStore({ ...config, write: async () => { throw new Error('disk full') } })
  await failing.initialize(); await failing.saveAuthenticated(credentials)
  assert(failing.snapshot().warningMessage); checks++
  const unavailable = new LocalLoginStore({ ...config, encrypt: () => { throw new Error('OS encryption unavailable') } })
  await unavailable.initialize(); await unavailable.saveAuthenticated(credentials)
  assert(unavailable.snapshot().warningMessage); checks++
  await writeFile(file, '{broken')
  const corrupt = new LocalLoginStore(config); await corrupt.initialize()
  assert(!corrupt.mayImportLegacy()); assert(corrupt.snapshot().warningMessage); checks++
  const slow = new LocalLoginStore({ ...config, file: join(root, 'new.json') }); await slow.initialize()
  const rev = slow.getRevision(); const save = slow.updateOptions({ autoLogin: false })
  assert(!slow.importLegacy(credentials, options, rev), 'late DB result cannot override checkbox'); await save; checks++
  const decryptedFailure = new LocalLoginStore({ ...config, file: join(root, 'valid.json') })
  await decryptedFailure.initialize(); await decryptedFailure.saveAuthenticated(credentials)
  const cannotRead = new LocalLoginStore({ ...config, file: join(root, 'valid.json'), decrypt: () => { throw new Error('keychain locked') } })
  await cannotRead.initialize(); assert(!cannotRead.mayImportLegacy()); checks++
}
async function preferencesOnlyRestart(root: string): Promise<void> {
  const config = { file: join(root, 'preferences-only.json'), encrypt, decrypt }
  const first = new LocalLoginStore(config)
  await first.initialize()
  first.importLegacy(credentials, { ...options, autoLogin: false }, 0)
  await first.updateOptions({ startupEnabled: true })
  assert.equal(JSON.parse(await readFile(config.file, 'utf8')).encryptedCredential, null)

  const restarted = new LocalLoginStore(config)
  await restarted.initialize()
  assert(restarted.mayImportLegacy(), 'preferences-only file must not mark credential migration complete'); checks++
  assert(restarted.importLegacy(credentials, options, restarted.getRevision()))
  assert.deepEqual(restarted.getCredentials(), credentials)
  assert.deepEqual(restarted.snapshot().loginOptions, { rememberLogin: true, autoLogin: false, startupEnabled: true }, 'legacy response preserves local checkbox choices'); checks++

  const pending = new LocalLoginStore(config)
  await pending.initialize()
  const revision = pending.getRevision()
  const change = pending.updateOptions({ autoLogin: true })
  assert(!pending.importLegacy(credentials, options, revision), 'late legacy response cannot override a new choice on a preferences-only file')
  await change; checks++

  await restarted.updateOptions({ rememberLogin: false })
  const forgotten = new LocalLoginStore(config)
  await forgotten.initialize()
  assert(!forgotten.mayImportLegacy(), 'explicit forget stays off after restart'); checks++

  await restarted.updateOptions({ rememberLogin: true })
  await restarted.saveAuthenticated(credentials)
  const remembered = new LocalLoginStore(config)
  await remembered.initialize()
  assert(!remembered.mayImportLegacy(), 'valid local credential never requests legacy credentials'); checks++
}
async function identity(root: string): Promise<void> {
  assert.equal(normalizeHardwareUuid('00000000-0000-0000-0000-000000000000'), null)
  assert.equal(normalizeHardwareUuid('FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'), null)
  assert.equal(normalizeBoardSerials(['To Be Filled By O.E.M.', 'default string']), null)
  assert.equal(normalizeBoardSerials(['BBB-2','AAA-1','BBB-2']), 'aaa-1|bbb-2'); checks += 4
  const config = { file: join(root, 'identity.json'), platform: 'win' as const,
    readHardware: async () => ({ uuid: '12345678-1234-1234-1234-123456789abc', serials: ['board-1'] }) }
  const first = await new HardwareDeviceIdentity(config).fingerprint()
  assert.equal(await new HardwareDeviceIdentity(config).fingerprint(), first, 'restart stable'); checks++
  await assert.rejects(new HardwareDeviceIdentity({ ...config, readHardware: async () => { throw new Error('timeout') } }).fingerprint())
  assert.equal(await new HardwareDeviceIdentity(config).fingerprint(), first); checks++
  const board = { ...config, file: join(root, 'board.json'), readHardware: async () => ({ uuid: '', serials: ['board-1'] }) }
  const hash = await new HardwareDeviceIdentity(board).fingerprint()
  assert.equal(await new HardwareDeviceIdentity({ ...config, file: board.file }).fingerprint(), hash, 'selected fallback stays pinned'); checks++
  const fallback = { ...config, file: join(root, 'fallback.json'), readHardware: async () => ({ uuid: '', serials: [] }) }
  const fallbackHash = await new HardwareDeviceIdentity(fallback).fingerprint()
  assert.equal(await new HardwareDeviceIdentity(fallback).fingerprint(), fallbackHash); checks++
  assert.notEqual(await new HardwareDeviceIdentity({ ...fallback, file: join(root, 'fallback2.json') }).fingerprint(), fallbackHash); checks++
  await assert.rejects(new HardwareDeviceIdentity({ ...fallback, file: join(root, 'unwritable.json'), write: async () => { throw new Error('disk') } }).fingerprint()); checks++
  const mac = { ...config, platform: 'mac' as const, file: join(root, 'mac.json') }
  assert.notEqual(await new HardwareDeviceIdentity(mac).fingerprint(), first); checks++
}

async function migrationGate(): Promise<void> {
  const source = await readFile('src/main/data/repositories/authRepository.ts', 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const scenario of ['v2-exists','legacy-multiple','other-binding','remember-off','single-remember','none']) {
    const queries: { table: string; selection: string; filters: Record<string, unknown> }[] = []
    let oldIdentityReads = 0
    const rows = scenario === 'none' ? [] : [
      { id: 1, username: credentials.username, password: credentials.password, organization_id: 1, is_active: true,
        device_fingerprint_hash: 'legacy', aka_agent_device_fingerprint_hash: scenario === 'v2-exists' ? 'new' : scenario === 'other-binding' ? 'other' : null },
      ...(scenario === 'legacy-multiple' ? [{ id: 2, device_fingerprint_hash: 'legacy', aka_agent_device_fingerprint_hash: null }] : [])
    ]
    const client = { from: (table: string) => {
      const query = { table, selection: '', filters: {} as Record<string, unknown> }; queries.push(query)
      let max = Infinity; let single = false
      const builder = {
        select: (selection: string) => { query.selection = selection; return builder },
        eq: (key: string, value: unknown) => { query.filters[key] = value; return builder },
        limit: (n: number) => { max = n; return builder },
        maybeSingle: () => { single = true; return builder },
        then: (resolve: (value: unknown) => void) => {
          const data = table === 'org_staff' ? rows.filter(row => Object.entries(query.filters).every(([k,v]) => (row as any)[k] === v)).slice(0,max)
            : [{ remember_login: scenario !== 'remember-off', auto_login: true, startup_enabled: false }]
          return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve)
        }
      }; return builder
    } }
    const exports: any = {}
    runInNewContext(code, { exports, console, require: (name: string) => {
      if (name.endsWith('supabaseClient')) return { getSupabaseClient: () => client }
      if (name.endsWith('deviceIdentity')) return { getCurrentDeviceIdentity: async () => ({ fingerprintHash: 'new' }), getLegacyDeviceIdentity: async () => { oldIdentityReads++; return { fingerprintHash: 'legacy' } } }
      if (name.endsWith('entitlementRepository')) return { ensureAkaAgentSubscriptionActive: async () => {} }
      return {}
    } })
    const result = await exports.loadLegacyLoginCandidate()
    assert.equal(queries[0].filters.aka_agent_device_fingerprint_hash, 'new', 'new fingerprint checked first')
    if (scenario === 'v2-exists') { assert.equal(oldIdentityReads, 0); assert.equal(result, null) }
    if (scenario !== 'single-remember') assert(!queries.some(q => q.selection.split(', ').includes('password')), 'no password lookup before gates')
    else assert.deepEqual(JSON.parse(JSON.stringify(result.credentials)), credentials)
    checks++
  }
}
async function handlers(root: string): Promise<void> {
  const source = await readFile('src/main/ipc/handlers/authHandlers.ts', 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const scenario of ['disk-failure', 'startup-failure', 'policy', 'late-options', 'late-username', 'failed-password', 'remembered-mismatch', 'no-legacy', 'bootstrap-logout', 'cancel-during-save', 'preferences-only-restart', 'preferences-only-no-candidate']) {
    let unblockSave!: () => void
    let startedSave!: () => void
    const saveStarted = new Promise<void>(resolve => { startedSave = resolve })
    const saveBlocked = new Promise<void>(resolve => { unblockSave = resolve })
    let writes = 0
    let store = new LocalLoginStore({ file: join(root, scenario+'.json'), encrypt, decrypt,
      ...(scenario === 'disk-failure' ? { write: async () => { throw new Error('disk full') } } : {}),
      ...(scenario === 'cancel-during-save' ? { write: async () => {
        if (++writes === 2) { startedSave(); await saveBlocked }
      } } : {}) })
    let resolveLegacy!: (v: unknown) => void
    const legacy = new Promise(resolve => { resolveLegacy = resolve })
    const routes = new Map<string, (...args: any[]) => any>()
    let current: any = null; let processCredentials: any = null; let logins = 0; let presence = 0; let cleanup = 0
    const user = { staffId: 1, organizationId: 1, username: credentials.username, isChatSync: false }
    const exports: any = {}
    runInNewContext(code, { exports, console, require: (name: string) => {
      if (name === 'electron') return { app: { setLoginItemSettings: () => {}, getLoginItemSettings: () => ({ openAtLogin: scenario === 'startup-failure' }) }, ipcMain: { handle: (key: string, handler: any) => routes.set(key, handler) } }
      if (name === 'node:crypto') return { randomUUID: () => 'dummy-session' }
      if (name.endsWith('/types')) return { IPC_EVENTS }
      if (name.endsWith('localLoginService')) return { getLocalLoginStore: () => store }
      if (name.endsWith('authRepository')) return {
        loadLegacyLoginCandidate: () => legacy,
        login: async (_u: string, password: string, check: () => void) => {
          logins++; check()
          if (password !== credentials.password) throw new Error('Mật khẩu không đúng.')
          return scenario === 'policy' ? { status: 'policy_required' } : { status: 'authenticated', user: { ...user } }
        },
        acceptPolicyAndLogin: async (_u: string, password: string) => { assert.equal(password, credentials.password); return { ...user } }
      }
      if (name.endsWith('currentUser')) return {
        getCurrentUser: () => current, setCurrentUser: (value: any) => { current = value },
        getCurrentUserCredentials: () => processCredentials, setCurrentUserCredentials: (value: any) => { processCredentials = value }
      }
      if (name.endsWith('devicePresenceService')) return { devicePresence: { start: () => { presence++ }, stop: () => {} } }
      return {}
    } })
    exports.registerAuthHandlers({ beforeLogout: () => { cleanup++ } })
    const call = (key: string, ...args: any[]) => routes.get(key)!(null, ...args)
    if (scenario.startsWith('preferences-only-')) {
      // Re-register against a fresh store to simulate a real application restart.
      await store.updateOptions({ rememberLogin: true, autoLogin: false, startupEnabled: true })
      store = new LocalLoginStore({ file: join(root, scenario+'.json'), encrypt, decrypt })
      exports.registerAuthHandlers()
      const candidate = scenario === 'preferences-only-restart' ? { credentials, loginOptions: options } : null
      resolveLegacy(candidate)
      const boot = await call(IPC_EVENTS.AUTH_BOOTSTRAP)
      assert.equal(boot.rememberedLogin?.username ?? null, candidate ? credentials.username : null)
      assert.equal(boot.loginOptions.startupEnabled, true)
      assert.equal(boot.loginOptions.autoLogin, false)
      assert.equal(boot.user, null); assert.equal(logins, 0, 'legacy auto flag never overrides the local manual-login choice'); checks++
    } else if (scenario === 'cancel-during-save') {
      const pending = call(IPC_EVENTS.AUTH_LOGIN, credentials.username, credentials.password, options)
      const rejected = assert.rejects(pending)
      await saveStarted
      assert(current, 'authentication completed before slow disk save')
      await call(IPC_EVENTS.AUTH_CANCEL_PENDING_LOGIN)
      unblockSave()
      await rejected
      assert.equal(current, null); assert.equal(processCredentials, null)
      assert.equal(presence, 0); assert.equal(cleanup, 1, 'cancel cleans services started by login'); checks++
    } else if (scenario === 'bootstrap-logout') {
      resolveLegacy({ credentials, loginOptions: options })
      const boot = await call(IPC_EVENTS.AUTH_BOOTSTRAP)
      assert(boot.user)
      await call(IPC_EVENTS.AUTH_LOGOUT)
      const again = await call(IPC_EVENTS.AUTH_BOOTSTRAP)
      assert.equal(again.user, null, 'bootstrap does not resurrect its cached authenticated result')
      assert.equal(logins, 1); assert.deepEqual(store.getCredentials(), credentials); checks++
    } else if (scenario === 'no-legacy') {
      resolveLegacy(null)
      const result = await call(IPC_EVENTS.AUTH_BOOTSTRAP)
      assert.equal(result.loginOptions.rememberLogin, false)
      assert.equal(result.loginOptions.autoLogin, false, 'ambiguous/missing legacy never silently re-enables auto'); checks++
    } else if (scenario.startsWith('late-')) {
      await store.initialize()
      const boot = call(IPC_EVENTS.AUTH_BOOTSTRAP)
      await new Promise(resolve => setImmediate(resolve))
      if (scenario === 'late-options') await call(IPC_EVENTS.AUTH_UPDATE_LOGIN_PREFERENCES, { autoLogin: false })
      else await call(IPC_EVENTS.AUTH_CANCEL_PENDING_LOGIN)
      resolveLegacy({ credentials, loginOptions: options })
      const result = await boot
      assert.equal(result.user, null); assert.equal(logins, 0, 'late legacy response never starts login'); checks++
    } else if (scenario === 'failed-password') {
      await store.initialize(); await store.saveAuthenticated(credentials)
      await assert.rejects(call(IPC_EVENTS.AUTH_LOGIN, credentials.username, 'bad-password', options))
      assert.deepEqual(store.getCredentials(), credentials); assert.equal(presence, 0); checks++
    } else if (scenario === 'remembered-mismatch') {
      await store.initialize(); await store.saveAuthenticated(credentials)
      await assert.rejects(call(IPC_EVENTS.AUTH_LOGIN_REMEMBERED, 'other-user', options)); assert.equal(logins,0); checks++
    } else {
      const result = await call(IPC_EVENTS.AUTH_LOGIN, credentials.username, credentials.password, options)
      assert(!JSON.stringify(result).includes(credentials.password), 'IPC has no password'); checks++
      if (scenario === 'disk-failure' || scenario === 'startup-failure') {
        assert.equal(result.status,'authenticated'); assert(current); assert.equal(presence,1); assert(result.loginState.warningMessage); checks++
      } else {
        assert.equal(result.status,'policy_required'); assert.equal(current,null)
        const accepted = await call(IPC_EVENTS.AUTH_ACCEPT_POLICY_AND_LOGIN)
        assert.equal(accepted.status,'authenticated'); assert(!JSON.stringify(accepted).includes(credentials.password)); checks++
        await call(IPC_EVENTS.AUTH_CANCEL_PENDING_LOGIN)
        await assert.rejects(call(IPC_EVENTS.AUTH_ACCEPT_POLICY_AND_LOGIN)); checks++
      }
    }
  }
}
async function bindingConfirmation(): Promise<void> {
  const source = await readFile('src/main/data/repositories/authRepository.ts', 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const scenario of ['matching', 'different', 'claim', 'lost-response', 'other-winner', 'read-failure', 'write-failure', 'matching-rebound', 'matching-unbound', 'matching-read-failure']) {
    let writes = 0
    let reads = 0
    const client = { from: () => {
      let writing = false
      const builder = {
        update: () => { writing = true; writes++; return builder },
        eq: () => builder, is: () => builder, select: () => builder,
        maybeSingle: async () => {
          if (writing) return scenario === 'claim' ? { data: { aka_agent_device_fingerprint_hash: 'new' }, error: null }
            : { data: null, error: scenario === 'lost-response' || scenario === 'write-failure' ? { message: 'network failure' } : null }
          reads++
          return { data: { aka_agent_device_fingerprint_hash: ['lost-response', 'matching'].includes(scenario) ? 'new' : ['write-failure', 'matching-unbound'].includes(scenario) ? null : 'other' },
            error: ['read-failure', 'matching-read-failure'].includes(scenario) ? { message: 'network failure' } : null }
        }
      }; return builder
    } }
    const exports: any = {}
    runInNewContext(code + '\nexports.checkBinding = ensureStaffDeviceLock;', { exports, console: { error: () => {} }, require: (name: string) => {
      if (name.endsWith('supabaseClient')) return { getSupabaseClient: () => client }
      if (name.endsWith('deviceIdentity')) return { getCurrentDeviceIdentity: async () => ({ fingerprintHash: 'new', label: 'test', platform: 'win' }) }
      return {}
    } })
    const attempt = exports.checkBinding({ id: 1, aka_agent_device_fingerprint_hash: scenario.startsWith('matching') ? 'new' : scenario === 'different' ? 'other' : null })
    if (['matching', 'claim', 'lost-response'].includes(scenario)) assert.equal((await attempt).aka_agent_device_fingerprint_hash, 'new')
    else await assert.rejects(attempt)
    assert.equal(writes, scenario.startsWith('matching') || scenario === 'different' ? 0 : 1)
    if (scenario.startsWith('matching')) assert.equal(reads, 1, 'matching login must confirm the current DB binding')
    checks++
  }
}
async function v2ResetJournal(root: string): Promise<void> {
  let prepared = 0
  const requests: unknown[] = []
  const config = {
    directory: join(root, 'device-change-v2'), bindingVersion: 2 as const,
    getDevice: async () => ({ fingerprintHash: 'a'.repeat(64), platform: 'win' as const, label: 'test', appVersion: 'test' }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'aka_agent_prepare_device_change_v2') {
        prepared++
        return { code: 'prepared', binding: { staffId: '1', hash: 'a'.repeat(64), revision: '1234', version: 2 } }
      }
      assert.equal(name, 'aka_agent_reset_device_binding_v2')
      requests.push(args.p_request_id)
      if (requests.length === 1) throw new Error('response lost after commit')
      return { success: true, changed: true, code: 'changed', remainingChanges: 4 }
    }
  }
  await assert.rejects(new DeviceChangeRequestClient(config).reset(credentials.username, 'login'))
  const result = await new DeviceChangeRequestClient(config).reset(credentials.username, 'login')
  assert.equal(result.remainingChanges, 4)
  assert.equal(prepared, 1); assert.equal(requests[0], requests[1], 'restart retries v2 journal with original requestId'); checks++
  const wrongVersion = new DeviceChangeRequestClient({ ...config, rpc: async () => ({ code: 'prepared', binding: { staffId: '1', hash: null, boundAt: null } }) })
  await assert.rejects(wrongVersion.reset('different-user', 'login'), 'v2 client rejects a legacy snapshot'); checks++
}
async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'aka-auth-v2-'))
  try { await storage(root); await preferencesOnlyRestart(root); await identity(root); await migrationGate(); await bindingConfirmation(); await v2ResetJournal(root); await handlers(root); console.log('Auth v2 smoke passed:', checks, 'checks') }
  finally { await rm(root, { recursive: true, force: true }) }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
