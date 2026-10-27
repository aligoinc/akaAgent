// Compare renewal outages with the old data-fetch error path through the real SDK.
// Only loopback HTTP, fixture credentials and a controlled wall clock are used.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const http = require('node:http')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')

const root = path.resolve(__dirname, '../..')
let now = Date.now(), checks = 0
class TestDate extends Date { static now() { return now } }
function load(file, mocks = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, require: name => mocks[name] || require(name), Buffer,
    fetch, Request, Response, Headers, URL, AbortSignal, AbortController, setTimeout, clearTimeout,
    Date: TestDate, Error, TypeError, Promise, Number, JSON, console, ...globals }, { filename: file })
  return exports
}
const pass = name => { checks++; console.log('PASS', name) }
const sid = '22222222-2222-4222-8222-222222222222'
function fixture(seconds = 3600) {
  const exp = Math.floor(now / 1000) + seconds
  return { accessToken: 'fixture.' + Buffer.from(JSON.stringify({ role: 'aka_agent_desktop',
    sub: '11111111-1111-4111-8111-111111111111', session_id: sid, exp })).toString('base64url') + '.fixture',
    refreshToken: 'fixture-refresh', expiresAt: exp, staffId: 1, organizationId: 10, sessionId: sid }
}

async function main() {
  let dataOffline = true, refreshStatus = 0, authCalls = 0, dataCalls = 0, rejected = 0
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) { /* Drain the request before closing the socket. */ }
    if (req.url === '/auth/v1/token?grant_type=refresh_token') {
      authCalls++
      if (refreshStatus === 0) { req.socket.destroy(); return }
      res.writeHead(refreshStatus, { 'Content-Type': 'application/json' })
      const next = fixture()
      res.end(refreshStatus === 200 ? JSON.stringify({ access_token: next.accessToken,
        refresh_token: next.refreshToken }) : JSON.stringify({ message: 'fixture Auth outage' }))
      return
    }
    dataCalls++
    if (dataOffline) { req.socket.destroy(); return }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('[{"id":1}]')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const session = load('src/main/data/desktopSession.ts')
  const transport = load('src/main/data/desktopSessionTransport.ts', { './desktopSession': session })
  const clientModule = load('src/main/data/supabaseClient.ts', {
    './desktopSession': session,
    './desktopSessionTransport': { createDesktopSessionTransport: (...args) => ({
      ...transport.createDesktopSessionTransport(...args), revoke: async () => {}
    }) }, dotenv: { config() {} }, ws: class {}
  }, { process: { env: { SUPABASE_URL: base, SUPABASE_PUBLISHABLE_KEY: 'fixture-project-id' }, cwd: () => root } })
  const client = clientModule.getSupabaseClient(), manager = clientModule.desktopSession
  manager.onRejected(() => { rejected++ })
  try {
    const legacy = createClient(base, 'fixture-legacy-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
    const baseline = await legacy.from('auto_accounts').select('id')
    assert.equal(baseline.error.message, 'TypeError: fetch failed')
    const assertConnectionFailure = result => {
      assert.equal(result.error.message, baseline.error.message)
      assert.equal(result.status, baseline.status)
      assert.equal(result.error.code, baseline.error.code)
      assert.equal(result.data, null)
      assert.equal(manager.matches(1, 10), true)
      assert.equal(rejected, 0)
    }
    dataOffline = false
    manager.install(fixture(), manager.revision())
    now += 24 * 60 * 60 * 1000
    const beforeData = dataCalls
    assertConnectionFailure(await client.from('auto_accounts').update({ name: 'fixture' }).eq('id', 1))
    assert.equal(authCalls, 1)
    assert.equal(dataCalls, beforeData, 'expired JWT never reaches the write endpoint')
    pass('24h sleep + offline refresh returns the same SDK error as the old network failure')

    for (let i = 0; i < 20; i++) assertConnectionFailure(await client.from('auto_accounts').select('id'))
    assert.equal(authCalls, 1)
    assert.equal(dataCalls, beforeData)
    pass('retry interval keeps the session and returns ordinary connection errors, with no login prompt')

    const repo = load('src/main/data/repositories/webEnrichmentRepository.ts', {
      '../supabaseClient': clientModule,
      '../currentUser': { requireCurrentUser: () => ({ staffId: 1, organizationId: 10 }),
        requireCurrentUserCredentials: () => ({ username: 'fixture', password: 'fixture' }) },
      '../../../shared/facebookWebEnrichment': {}
    })
    await assert.rejects(repo.webEnrichmentRpc(1, 'get'), {
      message: 'Không thể tải cài đặt: ' + baseline.error.message
    })
    pass('existing repository keeps its ordinary load-error wording for the renderer')

    for (const status of [429, 503]) {
      now += 30_000; refreshStatus = status
      assertConnectionFailure(await client.from('auto_accounts').select('id'))
      assert.equal(dataCalls, beforeData)
      pass(`Auth HTTP ${status} does not leak a new login/rate-limit notice into data screens`)
    }
    now += 30_000; refreshStatus = 200
    const recovered = await client.from('auto_accounts').update({ name: 'fixture retry' }).eq('id', 1).select('id')
    assert.equal(recovered.error, null)
    assert.deepEqual(recovered.data, [{ id: 1 }])
    assert.equal(dataCalls, beforeData + 1, 'only the new operation runs; failed writes are not replayed')
    assert.equal(rejected, 0)
    pass('recovery succeeds without login and does not replay the previous write')

    now += 24 * 60 * 60 * 1000; refreshStatus = 401
    const denied = await client.from('auto_accounts').select('id')
    assert.match(denied.error.message, /không còn hợp lệ.*đăng nhập lại/)
    assert.equal(rejected, 1)
    assert.equal(manager.matches(1, 10), false)
    assert.equal(dataCalls, beforeData + 1)
    pass('a real Auth rejection still expires the session once')
    console.log(JSON.stringify({ checks, status: 'passed' }))
  } finally {
    manager.clear()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
