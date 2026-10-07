// Offline: actual media class under Electron's bundled Node, no DB or network.
// Optional benchmark: node scripts/campaign-media-context-smoke-test.cjs --compare-base <git-ref>
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const sourcePath = 'src/main/services/campaignMediaExecution.ts'
const flush = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function semantics(compiled) {
  let now = 0
  const timers = new Set()
  const exports = {}
  vm.runInNewContext(fs.readFileSync(compiled, 'utf8'), {
    exports, require, AbortController, AbortSignal, Request,
    setTimeout(fn, ms) { const timer = { fn, at: now + ms, unref() {} }; timers.add(timer); return timer },
    clearTimeout(timer) { timers.delete(timer) }
  })
  const { CampaignMediaExecution } = exports
  const requests = []
  const make = () => new CampaignMediaExecution(async (url, init) => {
    requests.push({ url, signal: init?.signal })
    return new Response('offline')
  })
  const signal = url => {
    const request = requests.find(item => item.url === url)
    assert.ok(request, `missing request ${url}`)
    return request.signal
  }
  const advance = async ms => {
    now += ms
    for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.fn() }
    await flush()
  }

  // Separate sessions AND concurrent sends on the same session must stay isolated.
  for (const mode of ['timeout', 'stop', 'same-session']) {
    requests.length = 0
    const a = make(), b = mode === 'same-session' ? a : make()
    const callbacksA = new Map(), callbacksB = new Map()
    a.trackUploadCallbacks(callbacksA); b.trackUploadCallbacks(callbacksB)
    const gateA = deferred(), gateB = deferred()
    let lateRequest
    const runA = a.run(async () => {
      await a.fetch('a-upload')
      callbacksA.set('file', () => a.fetch('a-callback'))
      lateRequest = gateA.promise.then(() => a.fetch('a-late'))
      return lateRequest
    }, 20)
    const failedA = assert.rejects(runA, error => error.code ===
      (mode === 'stop' ? 'command_result_unknown' : 'campaign_media_timeout'))
    const runB = b.run(async () => {
      await b.fetch('b-upload')
      callbacksB.set('file', () => b.fetch('b-callback'))
      await gateB.promise
      await b.fetch('b-deliver')
    }, 200)
    await flush()
    const lateCallback = callbacksA.get('file')
    assert.ok(lateCallback)
    assert.notEqual(signal('a-upload'), signal('b-upload'))
    if (mode === 'stop') { a.stop(); await flush() } else await advance(20)
    await failedA
    assert.equal(signal('a-upload').aborted, true)
    assert.equal(signal('b-upload').aborted, false)
    assert.equal(callbacksA.size, 0)
    assert.equal(callbacksB.size, 1)
    await lateCallback({ fileId: 'file', fileUrl: 'offline' })
    gateA.resolve()
    await assert.rejects(lateRequest, error => error.code ===
      (mode === 'stop' ? 'command_result_unknown' : 'campaign_media_timeout'))
    await callbacksB.get('file')({ fileId: 'file', fileUrl: 'offline' })
    gateB.resolve(); await runB
    assert.equal(signal('b-callback'), signal('b-upload'))
    assert.equal(signal('b-deliver'), signal('b-upload'))
    assert.equal(signal('b-upload').aborted, true, 'success closes the completed scope')
    assert.deepEqual(requests.map(item => item.url), ['a-upload', 'b-upload', 'b-callback', 'b-deliver'])
    assert.equal(callbacksB.size, 0)
    assert.equal(timers.size, 0)
    if (mode === 'stop') await assert.rejects(a.run(async () => {}, 20), error => error.code === 'campaign_runtime_unavailable')
  }

  // Nested owners retain the outer scope; nested sends on one owner shadow it.
  requests.length = 0
  const a = make(), b = make(), manual = new AbortController()
  const userContext = new (require('node:async_hooks').AsyncLocalStorage)()
  try {
    await userContext.run('staff-fixture', () => a.run(async () => {
      await a.fetch('outer-a')
      await b.run(async () => {
        await b.fetch('nested-b')
        await a.fetch('nested-outer-a')
        assert.equal(signal('nested-outer-a'), signal('outer-a'))
        await a.run(async () => {
          await a.fetch('inner-a')
          assert.notEqual(signal('inner-a'), signal('outer-a'))
          await b.fetch('inner-b')
          assert.equal(signal('inner-b'), signal('nested-b'))
        }, 100)
        assert.equal(signal('inner-a').aborted, true)
        await a.fetch('restored-a')
        assert.equal(signal('restored-a'), signal('outer-a'))
        assert.equal(signal('outer-a').aborted, false)
        assert.equal(userContext.getStore(), 'staff-fixture')
      }, 100)
      assert.equal(signal('nested-b').aborted, true)
      await b.fetch('manual-b', { signal: manual.signal })
      assert.equal(signal('manual-b'), manual.signal, 'another owner must not capture a manual request')
    }, 200))
  } finally { userContext.disable() }
  assert.equal(manual.signal.aborted, false)
  assert.equal(timers.size, 0)

  // An upload callback restores A, but must use B from invocation, not the old
  // B scope present when the callback was registered (that scope is now closed).
  requests.length = 0
  const callbacks = new Map(), finishA = deferred()
  a.trackUploadCallbacks(callbacks)
  let pendingA
  await b.run(async () => {
    await b.fetch('old-b')
    pendingA = a.run(async () => {
      await a.fetch('callback-owner-a')
      callbacks.set('file', async () => {
        await a.fetch('callback-a')
        await b.fetch('callback-b')
      })
      await finishA.promise
    }, 200)
    await flush()
  }, 100)
  assert.equal(signal('old-b').aborted, true)
  await b.run(async () => {
    await b.fetch('new-b')
    await callbacks.get('file')({ fileId: 'file', fileUrl: 'offline' })
    assert.equal(signal('callback-a'), signal('callback-owner-a'))
    assert.equal(signal('callback-b'), signal('new-b'))
    assert.equal(signal('new-b').aborted, false)
    finishA.resolve(); await pendingA
  }, 200)
  assert.equal(callbacks.size, 0)
  assert.equal(timers.size, 0)
  console.log('PASS media context: concurrent sessions/sends, timeout/stop isolation, late fences, nested restoration, manual transport, staff context and callback invocation context')
}

async function probe(compiled, count) {
  const { CampaignMediaExecution } = require(compiled)
  const stores = () => Object.getOwnPropertySymbols(Promise.resolve()).filter(symbol => symbol.description === 'kResourceStore').length
  const before = stores()
  const owners = Array.from({ length: count }, () => new CampaignMediaExecution())
  for (const owner of owners) await owner.run(async () => {}, 90000)
  const afterActivation = stores() - before
  const measure = async () => {
    const start = performance.now()
    for (let i = 0; i < 15000; i++) await Promise.resolve()
    return performance.now() - start
  }
  await measure() // Warm up; timing is reported, never used as a flaky assertion.
  const samples = []
  for (let i = 0; i < 3; i++) samples.push(await measure())
  for (const owner of owners) owner.stop()
  console.log(JSON.stringify({ node: process.version, sessions: count, afterActivation,
    afterStop: stores() - before, medianMs: Number(samples.sort((a, b) => a - b)[1].toFixed(2)) }))
}

async function main() {
  const [mode, compiled, count] = process.argv.slice(2)
  if (mode === '--semantics') return semantics(compiled)
  if (mode === '--probe') return probe(compiled, Number(count))
  const ts = require('typescript')
  const electron = require('electron')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-media-context-'))
  const compile = (name, source) => {
    const output = path.join(dir, name + '.cjs')
    fs.writeFileSync(output, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText)
    return output
  }
  const run = args => execFileSync(electron, [__filename, ...args], {
    cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000
  }).trim()
  try {
    const fixed = compile('fixed', fs.readFileSync(path.join(root, sourcePath), 'utf8'))
    const semanticsResult = run(['--semantics', fixed])
    assert.ok(semanticsResult.startsWith('PASS media context:'), 'semantic cases must finish, not exit with an unresolved promise')
    console.log(semanticsResult)
    for (const count of [1, 180, 360]) {
      const result = JSON.parse(run(['--probe', fixed, String(count)]))
      assert.equal(result.afterActivation, 1, 'media async context slots must stay constant as sessions increase')
      assert.equal(result.afterStop, 1, 'session rotation must not add async hooks or disable late fences')
      console.log('PASS bounded media context:', JSON.stringify(result))
    }
    const compareIndex = process.argv.indexOf('--compare-base')
    if (compareIndex !== -1) {
      const ref = process.argv[compareIndex + 1]
      assert.ok(ref && !ref.startsWith('-'), '--compare-base requires an explicit git ref')
      const baseline = compile('baseline', execFileSync('git', ['show', `${ref}:${sourcePath}`], { cwd: root, encoding: 'utf8' }))
      for (const count of [1, 180, 360]) console.log('BASELINE:', run(['--probe', baseline, String(count)]))
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
