// Exercise request/timer races with the real session manager and a controlled clock.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const source = ts.transpileModule(fs.readFileSync(path.join(root, 'src/main/data/desktopSession.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const settle = () => new Promise(setImmediate)
let checks = 0
const pass = name => { checks++; console.log('PASS', name) }

function harness() {
  let now = 1_800_000_000_000
  const timers = new Set()
  const exports = {}
  vm.runInNewContext(source, {
    exports, Buffer, AbortSignal, Date, Error, Promise, Number, JSON,
    setTimeout(callback, delay) {
      const timer = { callback, at: now + delay, unref() {} }
      timers.add(timer)
      return timer
    },
    clearTimeout(timer) { timers.delete(timer) }
  })
  return {
    ...exports, now: () => now,
    elapse(ms) { now += ms },
    async runTimers() {
      for (;;) {
        const due = [...timers].filter(timer => timer.at <= now).sort((a, b) => a.at - b.at)[0]
        if (!due) return
        timers.delete(due)
        due.callback()
        await settle()
      }
    },
    session(seconds = 50) {
      const sessionId = '11111111-1111-4111-8111-111111111111'
      const expiresAt = now / 1000 + seconds
      const claims = { role: 'aka_agent_desktop', sub: '22222222-2222-4222-8222-222222222222', session_id: sessionId, exp: expiresAt }
      return { accessToken: `fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`,
        refreshToken: 'fixture-refresh', expiresAt, sessionId, staffId: 1, organizationId: 10 }
    }
  }
}

async function main() {
  for (const error of [new Error('HTTP 429'), new Error('network down')]) {
    const h = harness()
    let calls = 0
    const manager = new h.DesktopSessionManager(async () => {
      calls++
      if (calls === 1) throw error
      return h.session(3600)
    }, h.now)
    const initial = h.session()
    manager.install(initial, manager.revision())
    for (let i = 0; i < 20; i++) {
      assert.equal(await manager.token(), initial.accessToken)
      await settle()
    }
    assert.equal(calls, 1, 'sequential requests must not bypass the retry interval')
    h.elapse(29_999)
    await h.runTimers()
    assert.equal(await manager.token(), initial.accessToken)
    assert.equal(calls, 1)
    h.elapse(1)
    await h.runTimers()
    assert.equal(calls, 2, 'requests during backoff must not postpone the timer')
    assert.notEqual(await manager.token(), initial.accessToken)
    h.elapse(30_000)
    await h.runTimers()
    assert.equal(calls, 2, 'successful renewal must restore normal scheduling')
    manager.clear()
    pass(`${error.message}: 20 requests share one failed renewal; timer recovers after 30s`)
  }

  {
    const h = harness()
    let calls = 0, finish
    const manager = new h.DesktopSessionManager(async () => {
      calls++
      if (calls === 1) throw new Error('HTTP 503')
      return new Promise(resolve => { finish = resolve })
    }, h.now)
    const initial = h.session(10)
    manager.install(initial, 0)
    assert.equal(await manager.token(), initial.accessToken)
    await settle()
    h.elapse(8_000)
    assert.equal(await manager.token(), initial.accessToken, 'backoff keeps the still-valid JWT without a wait')
    h.elapse(2_001)
    await assert.rejects(manager.token(), { name: 'TypeError', message: 'fetch failed' })
    const abort = new AbortController()
    abort.abort(new Error('caller deadline'))
    await assert.rejects(manager.token(abort.signal), /caller deadline/)
    assert.equal(calls, 1, 'expiry or abort must not bypass backoff')
    h.elapse(19_999)
    const callers = Array.from({ length: 20 }, () => manager.token())
    await h.runTimers()
    assert.equal(calls, 2, 'request/timer race must share one renewal')
    const next = h.session(3600)
    finish(next)
    assert.deepEqual(await Promise.all(callers), Array(20).fill(next.accessToken))
    manager.clear()
    pass('expired JWT is never returned; request/timer race shares one retry after backoff')
  }

  {
    const h = harness()
    let calls = 0, failLate
    const manager = new h.DesktopSessionManager(async () => {
      calls++
      if (calls === 1) return new Promise((_, reject) => { failLate = reject })
      if (calls === 2) throw new Error('HTTP 429')
      return h.session(3600)
    }, h.now)
    manager.install(h.session(), 0)
    await manager.token()
    manager.clear()
    manager.install(h.session(), manager.revision())
    failLate(new Error('old session failed late'))
    await settle()
    await manager.token()
    await settle()
    assert.equal(calls, 2, 'late failure must not add backoff to the new login')
    manager.install(h.session(), manager.revision())
    await manager.token()
    await settle()
    assert.equal(calls, 3, 'install must clear the previous session backoff')
    manager.clear()
    pass('logout/new login and late failures do not carry backoff across sessions')
  }

  {
    const h = harness()
    let online = false, calls = 0, rejected = 0
    const manager = new h.DesktopSessionManager(async () => {
      calls++
      if (!online) throw new Error('network down')
      return h.session(3600)
    }, h.now)
    manager.onRejected(() => { rejected++ })
    manager.install(h.session(), 0)
    await manager.token(); await settle()
    for (let i = 0; i < 960; i++) {
      h.elapse(30_000); await h.runTimers()
      if (i >= 1) await assert.rejects(manager.token(), { name: 'TypeError', message: 'fetch failed' })
    }
    assert.equal(calls, 961)
    assert.equal(rejected, 0)
    assert.equal(manager.matches(1, 10), true)
    online = true
    h.elapse(30_000); await h.runTimers()
    assert.ok(await manager.token())
    assert.equal(calls, 962)
    assert.equal(rejected, 0)
    manager.clear()
    pass('8h outage keeps retrying with ordinary fetch errors and recovers without logout')
  }

  {
    const h = harness()
    let calls = 0
    const manager = new h.DesktopSessionManager(async () => { calls++; return h.session(3600) }, h.now)
    const initial = h.session(3600)
    manager.install(initial, 0)
    h.elapse(24 * 60 * 60 * 1000)
    const tokens = await Promise.all(Array.from({ length: 20 }, () => manager.token()))
    assert.equal(calls, 1)
    assert.equal(new Set(tokens).size, 1)
    assert.notEqual(tokens[0], initial.accessToken)
    await h.runTimers()
    assert.equal(calls, 1)
    manager.clear()
    pass('24h sleep refreshes once on first request without waiting for the old timer')
  }

  {
    const h = harness()
    let calls = 0, finish
    const manager = new h.DesktopSessionManager(async () => {
      calls++
      if (calls === 1) return new Promise(resolve => { finish = resolve })
      return h.session(3600)
    }, h.now)
    manager.install(h.session(), 0)
    const staleResponse = h.session(3600)
    await manager.token()
    h.elapse(24 * 60 * 60 * 1000)
    const waiting = assert.rejects(manager.token(), { name: 'TypeError', message: 'fetch failed' })
    finish(staleResponse)
    await waiting
    assert.equal(manager.matches(1, 10), true)
    h.elapse(30_000); await h.runTimers()
    assert.ok(await manager.token())
    assert.equal(calls, 2)
    manager.clear()
    pass('response expired during sleep uses the ordinary error path and recovers on retry')
  }

  {
    const h = harness()
    let calls = 0, rejected = 0
    const manager = new h.DesktopSessionManager(async () => {
      calls++
      throw new h.DesktopSessionRejected()
    }, h.now)
    manager.onRejected(() => { rejected++ })
    manager.install(h.session(1), 0)
    await assert.rejects(manager.token(), /không còn hợp lệ/)
    await assert.rejects(manager.token(), /Chưa có phiên/)
    h.elapse(60_000)
    await h.runTimers()
    assert.equal(calls, 1)
    assert.equal(rejected, 1)
    pass('permanent rejection still clears the session without retry')
  }

  console.log(JSON.stringify({ checks, status: 'passed' }))
}

main().catch(error => { console.error(error); process.exitCode = 1 })
