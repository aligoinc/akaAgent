import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
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
let checks = 0
async function storage(root: string): Promise<void> {
  const file = join(root, 'login.json')
  const config = { file }
  let store = new LocalLoginStore(config)
  await store.initialize(); assert(store.mayImportLegacy()); checks++
  store.importLegacy(credentials, options, 0)
  await store.updateOptions({ autoLogin: false })
  assert.equal(JSON.parse(await readFile(file, 'utf8')).credentials, null, 'imported password not persisted by checkbox'); checks++
  await store.saveAuthenticated(credentials)
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).credentials, credentials, 'remembered credentials are saved directly'); checks++
  if (process.platform !== 'win32') { assert.equal((await stat(file)).mode & 0o777, 0o600, 'login file remains owner-only'); checks++ }
  assert(!JSON.stringify(store.snapshot()).includes(credentials.password)); checks++
  store = new LocalLoginStore(config); await store.initialize()
  assert.deepEqual(store.getCredentials(), credentials, 'independent store reopens saved credential'); checks++
  await store.updateOptions({ startupEnabled: true })
  store = new LocalLoginStore(config); await store.initialize()
  assert.deepEqual(store.getCredentials(), credentials, 'option save preserves authenticated remembered credential'); checks++
  await store.updateOptions({ rememberLogin: false })
  assert.equal(store.getCredentials(), null); assert.equal(store.snapshot().loginOptions.autoLogin, false)
  assert.equal(JSON.parse(await readFile(file, 'utf8')).credentials, null); checks++
  await store.updateOptions({ autoLogin: true })
  assert.equal(store.snapshot().loginOptions.rememberLogin, true, 'checking auto enables remember')
  assert.equal(store.snapshot().loginOptions.autoLogin, true); checks++
  await store.updateOptions({ rememberLogin: false })
  await store.updateOptions({ rememberLogin: true })
  assert.equal(store.getCredentials(), null, 'rechecking does not recover deleted password'); checks++
  const failing = new LocalLoginStore({ ...config, write: async () => { throw new Error('disk full') } })
  await failing.initialize(); await failing.saveAuthenticated(credentials)
  assert(failing.snapshot().warningMessage); checks++
  await writeFile(file, '{broken')
  const corrupt = new LocalLoginStore(config); await corrupt.initialize()
  assert(!corrupt.mayImportLegacy()); assert(corrupt.snapshot().warningMessage); checks++
  await corrupt.updateOptions({ rememberLogin: true })
  const corruptRestart = new LocalLoginStore(config); await corruptRestart.initialize()
  assert(!corruptRestart.mayImportLegacy(), 'saving options cannot reopen legacy import after an unreadable file'); checks++
  const unsupportedFile = join(root, 'unsupported-version.json')
  await writeFile(unsupportedFile, JSON.stringify({ version: 99, options, credentials, requiresManualLogin: false }))
  const unsupported = new LocalLoginStore({ file: unsupportedFile }); await unsupported.initialize()
  assert.equal(unsupported.getCredentials(), null); assert(!unsupported.mayImportLegacy())
  assert(unsupported.snapshot().warningMessage, 'unsupported schema uses the normal file error path'); checks++
  const slow = new LocalLoginStore({ ...config, file: join(root, 'new.json') }); await slow.initialize()
  const rev = slow.getRevision(); const save = slow.updateOptions({ autoLogin: false })
  assert(!slow.importLegacy(credentials, options, rev), 'late DB result cannot override checkbox'); await save; checks++
  const malformedFile = join(root, 'malformed-credential.json')
  await writeFile(malformedFile, JSON.stringify({ version: 3, options, credentials: { username: credentials.username }, requiresManualLogin: false }))
  const malformed = new LocalLoginStore({ file: malformedFile }); await malformed.initialize()
  assert(!malformed.mayImportLegacy()); assert.equal(malformed.getCredentials(), null); assert(malformed.snapshot().warningMessage); checks++
}
async function plaintextLocalCompatibility(root: string): Promise<void> {
  const source = await readFile('src/main/services/localLoginService.ts', 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const rememberLogin of [false, true]) for (const autoLogin of [false, true]) {
    if (autoLogin && !rememberLogin) continue
    const directory = join(root, `plaintext-${rememberLogin}-${autoLogin}`)
    const file = join(directory, 'login-v2.json')
    await mkdir(directory)
    const savedOptions = { rememberLogin, autoLogin, startupEnabled: true }
    // Seed the exact schema already shipped to customers, independently of this writer.
    const original = JSON.stringify({ version: 3, options: savedOptions,
      credentials: rememberLogin ? credentials : null, requiresManualLogin: false })
    await writeFile(file, original)
    const exports: any = {}
    const electron = { app: { getPath: (name: string) => { assert.equal(name, 'userData'); return directory } },
      get safeStorage(): never { throw new Error('Login persistence must never access OS encryption') } }
    runInNewContext(code, { exports, require: (name: string) => {
      if (name === 'electron') return electron
      if (name === 'node:path') return { join }
      if (name === './localLoginStore') return { LocalLoginStore }
      throw new Error(`Unexpected import: ${name}`)
    } })
    const store = exports.getLocalLoginStore() as LocalLoginStore
    await store.initialize()
    assert.deepEqual(store.snapshot().loginOptions, savedOptions)
    assert.deepEqual(store.getCredentials(), rememberLogin ? credentials : null)
    assert.equal(store.snapshot().warningMessage, null)
    assert(!store.mayImportLegacy(), 'existing plaintext users never fetch legacy credentials')
    assert.equal(await readFile(file, 'utf8'), original, 'opening the app does not rewrite the saved file'); checks++
    await store.updateOptions({ startupEnabled: false })
    const restarted = new LocalLoginStore({ file }); await restarted.initialize()
    assert.deepEqual(restarted.getCredentials(), rememberLogin ? credentials : null)
    assert.deepEqual(restarted.snapshot().loginOptions, { ...savedOptions, startupEnabled: false })
    assert.equal(restarted.snapshot().warningMessage, null); checks++
  }
}
async function preferencesOnlyRestart(root: string): Promise<void> {
  const config = { file: join(root, 'preferences-only.json') }
  const first = new LocalLoginStore(config)
  await first.initialize()
  first.importLegacy(credentials, { ...options, autoLogin: false }, 0)
  await first.updateOptions({ startupEnabled: true })
  assert.equal(JSON.parse(await readFile(config.file, 'utf8')).credentials, null)

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

// Authentication/IPC/recovery behavior is now covered by device-identity-v3/client-smoke.ts.
// Keep the v2 format, hashing and reset-journal compatibility tests here.
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
  try { await storage(root); await plaintextLocalCompatibility(root); await preferencesOnlyRestart(root); await identity(root); await v2ResetJournal(root); console.log('Auth v2 smoke passed:', checks, 'checks') }
  finally { await rm(root, { recursive: true, force: true }) }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
