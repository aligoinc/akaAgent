// Real updater + repository; isolated version-server and database fixtures.
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')

const root = resolve(__dirname, '..')
const directory = mkdtempSync(join(tmpdir(), 'akaagent-update-prompt-'))
const key = 'desktop.updates.startup_prompt_max_version'
let fixture
let reads

globalThis.startupUpdateVersion = () => fixture.local
globalThis.startupUpdateHttpGet = (_url, _options, callback) => {
  const request = new EventEmitter()
  request.setTimeout = () => request
  process.nextTick(() => {
    if (fixture.remoteError) { request.emit('error', new Error('Version server offline')); return }
    const response = new PassThrough()
    response.statusCode = 200
    callback(response)
    process.nextTick(() => response.end(fixture.remote))
  })
  return request
}
globalThis.startupUpdateDb = {
  from(table) {
    reads++
    assert.equal(table, 'auto_system_settings')
    const filters = {}
    const query = {
      select(columns) { assert.equal(columns, 'value'); return query },
      eq(name, value) { filters[name] = value; return query },
      abortSignal(signal) { assert(signal instanceof AbortSignal); return query },
      async maybeSingle() {
        assert.deepEqual(filters, { key, is_active: true, is_secret: false })
        if (fixture.throwDb) throw new Error('Connection aborted')
        if (fixture.errorDb) return { data: null, error: { message: 'Database unavailable' } }
        const row = fixture.row
        return { data: row && row.is_active && !row.is_secret ? { value: row.value } : null, error: null }
      }
    }
    return query
  }
}

async function main() {
  const modules = {
    electron: 'export const app = { getAppPath: () => "unused", getVersion: () => globalThis.startupUpdateVersion() }; export const BrowserWindow = {}; export const shell = {};',
    fs: `export * from 'node:fs'; export const existsSync = () => false;`,
    https: 'export const get = (...args) => globalThis.startupUpdateHttpGet(...args);',
    http: 'export const get = (...args) => globalThis.startupUpdateHttpGet(...args);',
    '../supabaseClient': 'export const getSupabaseClient = () => globalThis.startupUpdateDb;',
    '../currentUser': 'export const requireCurrentUser = () => { throw new Error("Startup must work before authentication"); };'
  }
  await build({
    entryPoints: [join(root, 'src/main/services/updater.ts')], outfile: join(directory, 'updater.cjs'),
    bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning',
    define: { 'process.platform': '"win32"' },
    plugins: [{ name: 'update-fixtures', setup(builder) {
      builder.onResolve({ filter: /^(electron|fs|https|http|\.\.\/(supabaseClient|currentUser))$/ }, args => ({ path: args.path, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: modules[args.path], loader: 'js' }))
    } }]
  })
  const { checkForUpdate } = require(join(directory, 'updater.cjs'))
  async function check(overrides, expected, startup = true) {
    fixture = { local: '7.7.0', remote: '8.0.0', row: { value: null, is_active: true, is_secret: false }, ...overrides }
    reads = 0
    const result = await checkForUpdate(startup)
    assert.equal(result.promptOnStartup, expected, JSON.stringify(overrides))
    assert.equal(result.localVersion, fixture.local)
    return result
  }
  const threshold = value => ({ value, is_active: true, is_secret: false })
  await check({}, true)
  await check({ row: threshold('') }, true)
  await check({ row: threshold('  ') }, true)
  for (const [local, max, expected] of [
    ['5.9.9', '6.0.0', true], ['6.0.0', '6.0.0', true],
    ['6.0.1', '6.0.0', false], ['6.1.0', '6.0.0', false], ['7.0.0', '6.0.0', false],
    ['6.9.9', '6.10.0', true], ['6.10.0', '6.9.9', false],
    ['7.7.0', ' 7.7.0 ', true]
  ]) {
    await check({ local, row: threshold(max) }, expected)
    assert.equal(reads, 1)
  }
  console.log('PASS startup: NULL/empty, numeric major/minor/patch comparison, inclusive threshold, before auth')
  for (const value of ['null', '6', '6.0', 'v6.0.0', '6.0.0-beta', 'bad', '999999999999999999.0.0']) {
    assert.equal((await check({ row: threshold(value) }, false)).hasUpdate, true)
  }
  for (const overrides of [
    { row: null }, { row: { ...threshold(null), is_active: false } },
    { row: { ...threshold(null), is_secret: true } }, { throwDb: true }, { errorDb: true }
  ]) assert.equal((await check(overrides, false)).hasUpdate, true)
  console.log('PASS unavailable/invalid policy: update still available; no automatic prompt or blocked login')
  await check({}, false, false)
  assert.equal(reads, 0, 'manual and periodic checks must not read the startup policy')
  for (const overrides of [{ remote: '7.7.0' }, { remote: '7.6.9' }, { remote: 'invalid' }, { remoteError: true }]) {
    assert.equal((await check(overrides, false)).hasUpdate, false)
    assert.equal(reads, 0, 'no policy read when there is no confirmed newer version')
  }
  console.log('PASS manual/periodic/no-update/error: no additional database reads')
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  rmSync(directory, { recursive: true, force: true })
  delete globalThis.startupUpdateVersion
  delete globalThis.startupUpdateHttpGet
  delete globalThis.startupUpdateDb
})
