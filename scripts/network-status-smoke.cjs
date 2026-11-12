// Smoke test of the Desktop network status signals (docs/NETWORK_STATUS_BAR_DESKTOP.md), no real network:
// - networkStatusSignals: 'failed' at most once per second, 'ok' only after a 'failed', listener errors swallowed;
// - probeNetwork: GET <server>/auth/v1/health with the publishable key, any HTTP response = reachable, throw/timeout = not;
// - the real desktopFetch (Supabase client of the Desktop) reports network failures and the first response afterwards,
//   ignores aborted requests, and probeDesktopBackend targets the Desktop data server.
// Run: node scripts/network-status-smoke.cjs
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { build } = require('esbuild')

let passed = 0
const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }

const entry = `
export * as signals from './src/main/services/networkStatusSignals'
export * as client from './src/main/data/supabaseClient'
`

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-network-status-'))
  const realFetch = globalThis.fetch
  // AbortSignal.timeout() timers are unref'd: keep the process alive while a probe waits for its timeout.
  const keepAlive = setInterval(() => {}, 1_000)
  try {
    const outfile = join(dir, 'bundle.cjs')
    await build({
      stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs',
      target: 'node20', logLevel: 'warning'
    })
    const { signals, client } = require(outfile)

    // ── Signals ────────────────────────────────────────────────────────────────────────────────────────
    signals.resetNetworkSignalsForTest()
    const seen = []
    signals.setNetworkSignalListener(signal => seen.push(signal))
    signals.reportNetworkRequestSuccess()
    assert.deepEqual(seen, [], 'no ok while nothing failed: no IPC while the network is fine')
    signals.reportNetworkRequestFailure(10_000)
    signals.reportNetworkRequestFailure(10_500)
    signals.reportNetworkRequestFailure(10_999)
    assert.deepEqual(seen, ['failed'])
    signals.reportNetworkRequestFailure(11_000)
    assert.deepEqual(seen, ['failed', 'failed'])
    ok("'failed' at most once per second (a burst of scheduler failures sends one signal)")

    signals.reportNetworkRequestSuccess()
    signals.reportNetworkRequestSuccess()
    assert.deepEqual(seen, ['failed', 'failed', 'ok'])
    signals.reportNetworkRequestFailure(20_000)
    signals.reportNetworkRequestSuccess()
    assert.deepEqual(seen, ['failed', 'failed', 'ok', 'failed', 'ok'])
    ok("'ok' once after a failure, never repeated while requests keep succeeding")

    signals.setNetworkSignalListener(() => { throw new Error('window destroyed') })
    assert.doesNotThrow(() => signals.reportNetworkRequestFailure(30_000))
    signals.setNetworkSignalListener(null)
    assert.doesNotThrow(() => signals.reportNetworkRequestSuccess())
    ok('a throwing or missing listener never breaks the request path')

    // ── Probe ──────────────────────────────────────────────────────────────────────────────────────────
    const calls = []
    let cancelled = 0
    const respond = status => async (url, init) => {
      calls.push({ url, init })
      return { status, body: { cancel: async () => { cancelled += 1 } } }
    }
    assert.equal(await signals.probeNetwork('https://demo.supabase.co', 'sb_publishable_demo', respond(200)), true)
    assert.equal(calls[0].url, 'https://demo.supabase.co/auth/v1/health')
    assert.equal(calls[0].init.method, 'GET')
    assert.equal(calls[0].init.headers.apikey, 'sb_publishable_demo')
    assert.equal(calls[0].init.cache, 'no-store')
    assert.ok(calls[0].init.signal instanceof AbortSignal)
    assert.equal(cancelled, 1, 'response body cancelled')
    assert.equal(await signals.probeNetwork('https://demo.supabase.co', 'k', respond(401)), true)
    assert.equal(await signals.probeNetwork('https://demo.supabase.co', 'k', respond(503)), true)
    ok('probe: GET /auth/v1/health with the publishable key; any HTTP status (200/401/503) counts as reachable')

    assert.equal(await signals.probeNetwork('https://demo.supabase.co', 'k', async () => { throw new TypeError('fetch failed') }), false)
    const started = Date.now()
    const hanging = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
    assert.equal(await signals.probeNetwork('https://demo.supabase.co', 'k', hanging, 150), false)
    assert.ok(Date.now() - started < 2_000)
    assert.equal(signals.NETWORK_PROBE_TIMEOUT_MS, 8_000)
    ok('probe: network error or timeout (8 s by default) = not reachable')

    // ── Real desktopFetch through the Desktop Supabase client ──────────────────────────────────────────
    signals.resetNetworkSignalsForTest()
    const relayed = []
    signals.setNetworkSignalListener(signal => relayed.push(signal))
    const requests = []
    let mode = 'down'
    globalThis.fetch = async request => {
      requests.push(request.url)
      if (mode === 'down') throw new TypeError('fetch failed')
      if (mode === 'hang') {
        return new Promise((resolve, reject) => request.signal.addEventListener('abort', () => reject(request.signal.reason)))
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const supabase = client.getSupabaseClient()
    // Bootstrap RPC: no login session needed, same desktopFetch path as every other DB request.
    let result = await supabase.rpc('aka_agent_desktop_login_content')
    assert.ok(result.error, 'network failure surfaces to the caller as before')
    assert.match(requests.at(-1), /\/rest\/v1\/rpc\/aka_agent_desktop_login_content$/)
    assert.deepEqual(relayed, ['failed'])
    mode = 'up'
    result = await supabase.rpc('aka_agent_desktop_login_content')
    assert.equal(result.error, null)
    result = await supabase.rpc('aka_agent_desktop_login_content')
    assert.deepEqual(relayed, ['failed', 'ok'])
    ok('desktopFetch: network failure → failed; first response after it → ok; caller results unchanged')

    mode = 'hang'
    const controller = new AbortController()
    const pending = supabase.rpc('aka_agent_desktop_login_content').abortSignal(controller.signal)
    setTimeout(() => controller.abort(), 20)
    result = await pending
    assert.ok(result.error)
    await new Promise(resolve => setTimeout(resolve, 1_100))
    mode = 'down'
    assert.deepEqual(relayed, ['failed', 'ok'], 'aborted request is not a network failure')
    result = await supabase.rpc('aka_agent_desktop_login_content')
    assert.deepEqual(relayed, ['failed', 'ok', 'failed'])
    ok('desktopFetch: an aborted request is not reported; a later real failure is')

    requests.length = 0
    globalThis.fetch = async (url, init) => { requests.push({ url, init }); return new Response('{}', { status: 401 }) }
    assert.equal(await client.probeDesktopBackend(), true)
    assert.equal(requests[0].url, 'https://cgjbsmqtfhqvttudyjzq.supabase.co/auth/v1/health')
    assert.match(requests[0].init.headers.apikey, /^sb_publishable_/)
    ok('probeDesktopBackend targets the Desktop data server (akachat) with the publishable key only')

    console.log(`\n${passed} passed`)
  } finally {
    clearInterval(keepAlive)
    globalThis.fetch = realFetch
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })
