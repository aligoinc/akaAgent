// Desktop session renewal must not depend on the machine clock.
// Simulates a server clock, a skewed/jumping machine wall clock, a monotonic
// clock that stops during sleep, and a request every 5 seconds for 6 hours.
// The server accepts a JWT until 30 seconds after `exp` (measured on production).
//
//   node scripts/desktop-session-rls/session-clock-skew-smoke.cjs
//   node scripts/desktop-session-rls/session-clock-skew-smoke.cjs <other desktopSession.ts>   (report only)
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const transpile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const sessionFile = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'src/main/data/desktopSession.ts')
const reportOnly = Boolean(process.argv[2])
const sessionSource = transpile(sessionFile)
const settle = () => new Promise(setImmediate)
const HOUR = 3_600_000
const SERVER_GRACE_MS = 30_000
let checks = 0
const pass = name => { checks++; console.log('PASS', name) }

function decode(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

async function simulate({ skewMs = 0, hours = 6, withIat = true, jumpBackEveryHourMs = 0, sleep = null, useExpireHook = true }) {
  let server = 1_800_000_000_000
  let mono = 0
  let wallOffset = skewMs
  let sleeping = false
  const timers = new Set()
  const exports = {}
  vm.runInNewContext(sessionSource, {
    exports, Buffer, AbortSignal, Date, Error, TypeError, Promise, Number, JSON, Math,
    setTimeout(callback, delay) { const timer = { callback, at: mono + delay, unref() {} }; timers.add(timer); return timer },
    clearTimeout(timer) { timers.delete(timer) }
  })
  let issued = 0
  const sessionId = '11111111-1111-4111-8111-111111111111'
  const issue = () => {
    issued++
    const iat = Math.floor(server / 1000)
    const exp = iat + 3600
    const claims = { role: 'aka_agent_desktop', sub: '22222222-2222-4222-8222-222222222222', session_id: sessionId, exp }
    if (withIat) claims.iat = iat
    return { accessToken: `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s.${issued}`,
      refreshToken: `refresh-${issued}`, expiresAt: exp, sessionId, staffId: 1, organizationId: 10 }
  }
  const wallNow = () => server + wallOffset
  const manager = new exports.DesktopSessionManager(async () => issue(), wallNow, undefined, () => mono)
  const result = { loginRejected: false, rejected: 0, failedFast: 0, accepted: 0, renewals: 0 }
  try {
    const mark = typeof manager.clockMark === 'function' ? manager.clockMark() : undefined
    manager.install(issue(), manager.revision(), mark)
  } catch { result.loginRejected = true; return result }

  const start = server
  let nextJump = server + HOUR
  for (let second = 1; second <= hours * 3600; second++) {
    server += 1000
    if (sleep && server - start === sleep.atMs) sleeping = true
    if (sleep && server - start === sleep.atMs + sleep.forMs) sleeping = false
    if (!sleeping) mono += 1000
    if (jumpBackEveryHourMs && server >= nextJump) { wallOffset -= jumpBackEveryHourMs; nextJump += HOUR }
    if (!sleeping) {
      for (;;) {
        const due = [...timers].filter(timer => timer.at <= mono).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        timers.delete(due)
        due.callback()
        await settle()
      }
    }
    if (sleeping || second % 5 !== 0) continue
    let token
    try { token = await manager.token() } catch { result.failedFast++; continue }
    if (server <= decode(token).exp * 1000 + SERVER_GRACE_MS) result.accepted++
    else {
      result.rejected++
      if (useExpireHook && typeof manager.expire === 'function') manager.expire(token)
    }
  }
  result.renewals = issued - 1
  manager.clear()
  return result
}

const scenarios = [
  { name: 'đúng giờ', options: {} },
  { name: 'chậm 104 giây (staff 385)', options: { skewMs: -104_000 } },
  { name: 'chậm 118 giây (staff 2173)', options: { skewMs: -118_000 } },
  { name: 'chậm 252 giây (staff 2214 trên 9.6.0)', options: { skewMs: -252_000 } },
  { name: 'chậm 12 giờ 42 phút (staff 2285)', options: { skewMs: -45_747_000 } },
  { name: 'nhanh 165 giây (staff 2283)', options: { skewMs: 165_000 } },
  { name: 'nhanh 2 giờ', options: { skewMs: 2 * HOUR } },
  { name: 'chậm 28 giờ, bị kéo lùi 1 giờ mỗi giờ (staff 2214 ngày 12/11)', options: { skewMs: -28 * HOUR, jumpBackEveryHourMs: HOUR } },
  { name: 'máy ngủ 3 giờ giữa chừng', options: { sleep: { atMs: 1.5 * HOUR, forMs: 3 * HOUR } } },
  { name: 'chậm 104 giây và ngủ 3 giờ', options: { skewMs: -104_000, sleep: { atMs: 0.75 * HOUR, forMs: 3 * HOUR } } }
]

async function main() {
  console.log(`source: ${path.relative(process.cwd(), sessionFile)}`)
  for (const scenario of scenarios) {
    const result = await simulate(scenario.options)
    console.log(`${reportOnly ? 'REPORT' : 'RESULT'} ${scenario.name}: ${JSON.stringify(result)}`)
    if (reportOnly) continue
    assert.equal(result.loginRejected, false, `${scenario.name}: login must succeed`)
    assert.equal(result.rejected, 0, `${scenario.name}: server must never see an expired JWT`)
    assert.equal(result.failedFast, 0, `${scenario.name}: requests must not fail locally`)
    const awakeHours = 6 - (scenario.options.sleep ? scenario.options.sleep.forMs / HOUR : 0)
    assert.ok(result.renewals >= Math.floor(awakeHours) - 1, `${scenario.name}: token must keep renewing (${result.renewals})`)
    pass(scenario.name)
  }
  if (reportOnly) return

  // Tokens without `iat` keep the previous rule (compare `exp` with the machine clock).
  const legacy = await simulate({ withIat: false })
  assert.equal(legacy.loginRejected, false)
  assert.equal(legacy.rejected, 0)
  assert.equal((await simulate({ withIat: false, skewMs: 2 * HOUR })).loginRejected, true)
  pass('token không có iat: giữ cách cũ (so exp với giờ máy)')

  // A "JWT expired" reply renews before the next request, except right after issue.
  {
    let mono = 0, wall = 1_800_000_000_000, calls = 0
    const exports = {}
    vm.runInNewContext(sessionSource, { exports, Buffer, AbortSignal, Date, Error, TypeError, Promise, Number, JSON, Math,
      setTimeout: () => ({ unref() {} }), clearTimeout() {} })
    const make = () => {
      const iat = Math.floor(wall / 1000)
      const claims = { role: 'aka_agent_desktop', sub: 's', session_id: 'sid', exp: iat + 3600, iat }
      return { accessToken: `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${calls}`, refreshToken: 'r',
        expiresAt: iat + 3600, sessionId: 'sid', staffId: 1, organizationId: 10 }
    }
    const manager = new exports.DesktopSessionManager(async () => { calls++; return make() }, () => wall, undefined, () => mono)
    manager.install(make(), manager.revision(), manager.clockMark())
    const first = await manager.token()
    wall += 10_000; mono += 10_000
    manager.expire(first)
    assert.equal(await manager.token(), first)
    assert.equal(calls, 0, 'a token younger than 30 seconds is not renewed by a 401')
    wall += 30_000; mono += 30_000
    manager.expire('some-older-token')
    assert.equal(await manager.token(), first)
    assert.equal(calls, 0, 'a 401 for a token no longer in use changes nothing')
    manager.expire(first)
    const second = await manager.token()
    assert.equal(calls, 1)
    assert.notEqual(second, first)
    manager.clear()
    pass('401 "JWT expired" gia hạn trước request kế tiếp, bỏ qua token vừa cấp < 30 giây')
  }

  // A cleanup that hit "JWT expired" retries instead of giving up.
  {
    const exports = {}
    vm.runInNewContext(transpile(path.join(root, 'src/main/services/runtimeCleanupRetry.ts')), { exports, Number, String, Promise, setTimeout, clearTimeout, AbortSignal })
    const temporary = exports.isTemporaryCleanupError
    assert.equal(temporary(Object.assign(new Error('JWT expired'), { code: 'PGRST303', status: 401 })), true)
    assert.equal(temporary(Object.assign(new Error('JWT expired'), { code: 'PGRST301', status: 401 })), true)
    assert.equal(temporary(Object.assign(new Error('JWSError JWSInvalidSignature'), { code: 'PGRST301', status: 401 })), false)
    assert.equal(temporary(Object.assign(new Error('permission denied for function x'), { code: '42501', status: 403 })), false)
    assert.equal(temporary(new TypeError('fetch failed')), true)
    pass('lệnh dọn coi "JWT expired" là lỗi tạm thời, lỗi quyền vẫn là vĩnh viễn')
  }
  // Real Supabase SDK through desktopFetch: a 401 "JWT expired" reaches the
  // caller unchanged, and the next request renews first and sends the new JWT.
  {
    const http = require('node:http')
    const load = (file, mocks = {}, globals = {}) => {
      const exports = {}
      vm.runInNewContext(transpile(path.join(root, file)), { exports, require: n => mocks[n] || require(n), Buffer, fetch, Request, Response, Headers,
        URL, AbortSignal, AbortController, setTimeout, clearTimeout, Date, Error, TypeError, Promise, Number, JSON, Math, console, ...globals }, { filename: file })
      return exports
    }
    let wall = Date.now(), mono = 0, refreshes = 0
    const seen = []
    const sid = '22222222-2222-4222-8222-222222222222'
    const make = tag => {
      const iat = Math.floor(wall / 1000)
      const claims = { role: 'aka_agent_desktop', sub: '11111111-1111-4111-8111-111111111111', session_id: sid, exp: iat + 3600, iat }
      return { accessToken: `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${tag}`, refreshToken: 'r', expiresAt: iat + 3600,
        staffId: 1, organizationId: 10, sessionId: sid }
    }
    const first = make('first')
    const server = http.createServer((req, res) => {
      seen.push(req.headers.authorization)
      const expired = req.headers.authorization === `Bearer ${first.accessToken}`
      res.writeHead(expired ? 401 : 200, { 'Content-Type': 'application/json' })
      res.end(expired ? '{"code":"PGRST303","details":null,"hint":null,"message":"JWT expired"}' : '[{"id":1}]')
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    try {
      const session = load('src/main/data/desktopSession.ts')
      const transport = { endpoint: async () => { throw Error('unexpected') }, refresh: async () => { refreshes++; return make('second') }, revoke: async () => {} }
      const client = load('src/main/data/supabaseClient.ts', { './desktopSession': session,
        './desktopSessionTransport': { createDesktopSessionTransport: () => transport }, dotenv: { config() {} }, ws: class {},
        perf_hooks: { performance: { now: () => mono } } }, {
        Date: { now: () => wall },
        process: { env: { SUPABASE_URL: base, SUPABASE_PUBLISHABLE_KEY: 'public-project-id' }, cwd: () => root }
      })
      const manager = client.desktopSession
      manager.install(first, manager.revision(), manager.clockMark())
      wall += 120_000; mono += 120_000
      const rejected = await client.getSupabaseClient().from('auto_accounts').select('id')
      assert.equal(rejected.status, 401)
      assert.match(rejected.error.message, /JWT expired/)
      assert.equal(refreshes, 0, 'the failed request itself is not replayed')
      const ok = await client.getSupabaseClient().from('auto_accounts').select('id')
      assert.equal(ok.error, null)
      assert.equal(refreshes, 1)
      assert.equal(seen.at(-1), `Bearer ${make('second').accessToken}`)
      manager.clear()
      pass('HTTP thật: 401 "JWT expired" trả nguyên cho nơi gọi, request kế tiếp gia hạn rồi gửi token mới')
    } finally { server.close() }
  }
  console.log(JSON.stringify({ checks, status: 'passed' }))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
