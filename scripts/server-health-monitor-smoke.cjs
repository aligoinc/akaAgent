#!/usr/bin/env node
// Bộ đo sức khoẻ App Server (src/server/main/serverHealthMonitor.ts): dòng [ServerHealth] mỗi phút, dòng stall khi luồng chính
// đứng, thời gian ghi server.log (serverFileLogger.ts) và nhật ký engine SQLite (desktopEngineJournal.ts), và chi phí đo thêm.
//   node_modules/.bin/electron scripts/server-health-monitor-smoke.cjs                         (tiến trình chính Electron, như App Server)
//   ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron scripts/server-health-monitor-smoke.cjs   (Node của Electron)
// Phải chạy bằng Electron: better-sqlite3 của repo dựng cho Electron, và trong tiến trình chính Electron một số số đo của Node
// (monitorEventLoopDelay, eventLoopUtilization) không thấy lúc luồng chính bị chặn, nên bộ đo tự đo độ trễ hẹn giờ.
'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const Module = require('node:module'), ts = require('typescript')
if (process.type === 'browser') require('electron').app?.dock?.hide?.()

const root = path.resolve(__dirname, '..')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'server-health-smoke-'))
const say = (...args) => process.stdout.write(args.join(' ') + '\n')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// better-sqlite3 (require lười trong nhật ký engine) lấy từ node_modules của repo; 'electron' thay bằng bản giả có app.getPath.
process.env.NODE_PATH = path.join(root, 'node_modules')
Module._initPaths()
const electronStub = path.join(work, 'electron-stub.cjs')
fs.writeFileSync(electronStub, `module.exports = { app: { getPath: () => ${JSON.stringify(work)} } }\n`)
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  return request === 'electron' ? electronStub : originalResolve.call(this, request, ...rest)
}

function load(relative) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  }).outputText
  const file = path.join(work, relative.replace(/[\\/]/g, '__').replace(/\.ts$/, '.cjs'))
  fs.writeFileSync(file, output)
  return require(file)
}

function parse(line) {
  const values = {}
  for (const part of line.split(' ').slice(1)) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index), raw = part.slice(index + 1)
    values[key] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw
  }
  return values
}

function startServer(delayMs) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => setTimeout(() => res.end('ok'), delayMs))
    server.keepAliveTimeout = 5_000
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function fetchMany(port, count, concurrency = count) {
  let next = 0
  const worker = async () => {
    while (next < count) {
      next += 1
      await fetch(`http://127.0.0.1:${port}/r${next}`).then(response => response.text())
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker))
}

const results = []
async function check(name, run) {
  try {
    const detail = await run()
    results.push({ name, ok: true })
    say('PASS', name, detail ? `— ${detail}` : '')
  } catch (error) {
    results.push({ name, ok: false })
    say('FAIL', name, '—', error && error.stack ? error.stack : String(error))
  }
}

async function main() {
  say(`node ${process.version} (electron ${process.versions.electron || '-'}, ${process.type === 'browser' ? 'tiến trình chính Electron' : 'ELECTRON_RUN_AS_NODE'})`)
  const logger = load('src/server/main/serverFileLogger.ts')
  const journalModule = load('src/main/engineAdapters/desktopEngineJournal.ts')
  const monitorModule = load('src/server/main/serverHealthMonitor.ts')

  // Bản thật của logger bọc console; trong bài kiểm không in ra màn hình.
  console.log = () => {}
  console.warn = () => {}
  console.error = () => {}
  const logFile = path.join(work, 'logs', 'server.log')
  logger.installServerFileLogger(logFile)

  await check('1. ghi log: đếm lệnh, thời gian và cỡ file; đọc xong đặt lại', async () => {
    for (let i = 0; i < 40; i += 1) console.warn('[smoke] dòng', i, { nested: { value: i } })
    const stats = logger.takeServerFileLogStats()
    assert.equal(stats.count, 40)
    assert.ok(stats.totalMs > 0 && stats.maxMs > 0 && stats.maxMs <= stats.totalMs)
    // Cỡ file đọc ngay trước lần ghi cuối: nhỏ hơn cỡ hiện tại đúng bằng dòng cuối.
    const lastLine = Buffer.byteLength(fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).pop() + '\n')
    assert.equal(stats.fileBytes, fs.statSync(logFile).size - lastLine)
    const again = logger.takeServerFileLogStats()
    assert.equal(again.count, 0)
    assert.equal(again.totalMs, 0)
    return `40 lệnh, ${stats.totalMs.toFixed(2)} ms, file ${stats.fileBytes} byte trước lần ghi cuối`
  })

  await check('2. nhật ký engine: đếm append / update / pending / remove', async () => {
    journalModule.takeEngineJournalStats()
    const journal = new journalModule.SqliteEngineJournal('smoke:1:main')
    for (let i = 0; i < 5; i += 1) {
      await journal.append({ id: `e${i}`, targetRunId: i, leaseToken: 'lease', outcomes: [], final: false, createdAt: Date.now() + i, attempts: 0 })
    }
    await journal.update({ id: 'e1', targetRunId: 1, leaseToken: 'lease', outcomes: [], final: false, createdAt: Date.now(), attempts: 1 })
    assert.equal((await journal.pending()).length, 5)
    for (const id of ['e0', 'e1', 'e2']) await journal.remove(id)
    assert.equal((await journal.pending()).length, 2)
    const stats = journalModule.takeEngineJournalStats()
    assert.equal(stats.count, 5 + 1 + 1 + 3 + 1)
    assert.ok(stats.totalMs > 0 && stats.maxMs > 0)
    assert.equal(journalModule.takeEngineJournalStats().count, 0)
    journalModule.closeEngineJournal()
    return `${stats.count} lệnh, ${stats.totalMs.toFixed(2)} ms, lâu nhất ${stats.maxMs.toFixed(2)} ms`
  })

  const slow = await startServer(100)
  const fast = await startServer(20)
  const instant = await startServer(0)

  await check('3. dòng mỗi phút: HTTP tách DB / nơi khác, luồng chính đứng, GC, log, nhật ký, CPU từng tiến trình', async () => {
    const lines = []
    const monitor = monitorModule.startServerHealthMonitor({
      intervalMs: 60_000,
      stallThresholdMs: 400,
      stallCheckMs: 50,
      log: line => lines.push(line),
      classifyOrigin: origin => (origin.includes(`:${slow.port}`) ? 'db' : 'other'),
      sources: {
        logWrites: logger.takeServerFileLogStats,
        journalWrites: journalModule.takeEngineJournalStats,
        appMetrics: () => [{ type: 'Browser', cpu: { percentCPUUsage: 12.4 } }, { type: 'GPU', cpu: { percentCPUUsage: 1.2 } }, { type: 'Browser', cpu: { percentCPUUsage: 0.3 } }]
      }
    })
    try {
      monitor.reportNow()
      await fetchMany(slow.port, 30)
      await fetchMany(fast.port, 20)
      // Cổng vừa đóng: undici tạo request rồi báo lỗi kết nối (không dùng cổng 1: fetch chặn trước khi tạo request).
      const closed = await startServer(0)
      await new Promise(resolve => closed.server.close(resolve))
      await fetch(`http://127.0.0.1:${closed.port}/`).catch(() => undefined)
      console.log('[smoke] một dòng log')
      const blockedAt = Date.now()
      while (Date.now() - blockedAt < 900) { /* chặn luồng chính 0,9 giây */ }
      await sleep(150)
      let total = 0
      for (let i = 0; i < 60; i += 1) total += new Array(200_000).fill(i).length
      assert.ok(total > 0)
      await sleep(50)
      const line = monitor.reportNow()
      const values = parse(line)
      assert.ok(line.startsWith('[ServerHealth] '))
      assert.equal(values.dbReq, 30)
      assert.equal(values.otherReq, 20)
      assert.ok(values.dbP50Ms >= 95, `dbP50Ms=${values.dbP50Ms}`)
      assert.ok(values.otherP50Ms >= 18 && values.otherP50Ms < values.dbP50Ms, `otherP50Ms=${values.otherP50Ms}`)
      assert.ok(values.httpErr >= 1, `httpErr=${values.httpErr}`)
      assert.ok(values.connErr >= 1, `connErr=${values.connErr}`)
      assert.equal(values.inflight, 0)
      assert.ok(values.stalls >= 1 && values.stallMaxMs >= 800, `stalls=${values.stalls} stallMaxMs=${values.stallMaxMs}`)
      assert.ok(values.lagMaxMs >= 800, `lagMaxMs=${values.lagMaxMs}`)
      assert.ok(values.lagP50Ms >= 0 && values.lagP99Ms >= values.lagP50Ms && !('elu' in values))
      assert.ok(values.gc >= 1, `gc=${values.gc}`)
      assert.ok(values.log >= 1 && typeof values.logFileMb === 'number')
      assert.equal(values.journal, 0)
      assert.equal(values.procCpu, 'Browser:13,GPU:1')
      for (const key of ['cpuPct', 'hostCpuPct', 'cores', 'rssMb', 'heapLimitMb', 'extMb', 'abMb', 'gcMs', 'gcMajor']) assert.equal(typeof values[key], 'number', key)
      assert.match(values.heapMb, /^\d+\/\d+$/)
      assert.match(values.hostFreeMb, /^\d+\/\d+$/)
      const stallLines = lines.filter(item => item.startsWith('[ServerHealth] stall '))
      assert.equal(stallLines.length, values.stalls)
      assert.ok(parse(stallLines[0]).ms >= 800)
      const reset = parse(monitor.reportNow())
      assert.equal(reset.dbReq, 0)
      assert.equal(reset.stalls, 0)
      assert.equal(reset.log, 0)
      assert.equal(reset.connErr, 0)
      return line
    } finally {
      monitor.stop()
    }
  })

  await check('4. dòng stall có trần mỗi giờ, số lần đứng vẫn đếm đủ', async () => {
    const lines = []
    const monitor = monitorModule.startServerHealthMonitor({ intervalMs: 60_000, stallThresholdMs: 200, stallCheckMs: 20, maxStallLinesPerHour: 1, log: line => lines.push(line) })
    try {
      for (let round = 0; round < 3; round += 1) {
        const blockedAt = Date.now()
        while (Date.now() - blockedAt < 350) { /* chặn */ }
        await sleep(80)
      }
      const values = parse(monitor.reportNow())
      assert.equal(lines.filter(item => item.startsWith('[ServerHealth] stall ')).length, 1)
      assert.ok(values.stalls >= 3, `stalls=${values.stalls}`)
      return `3 lần đứng, 1 dòng stall`
    } finally {
      monitor.stop()
    }
  })

  await check('5. nguồn số liệu lỗi không làm hỏng dòng', async () => {
    const monitor = monitorModule.startServerHealthMonitor({
      intervalMs: 60_000,
      log: () => { throw new Error('ghi log hỏng') },
      sources: { logWrites: () => { throw new Error('x') }, journalWrites: () => { throw new Error('y') }, appMetrics: () => { throw new Error('z') } }
    })
    try {
      const line = monitor.reportNow()
      assert.ok(!line.includes(' log=') && !line.includes(' journal=') && !line.includes('procCpu='))
      assert.ok(line.includes(' lagMaxMs=') && line.includes(' dbReq='))
      return 'bỏ phần lỗi, vẫn ra dòng'
    } finally {
      monitor.stop()
    }
  })

  await check('6. hẹn giờ mỗi phút chạy, dừng thì thôi ghi', async () => {
    const lines = []
    const monitor = monitorModule.startServerHealthMonitor({ intervalMs: 1_000, log: line => lines.push(line) })
    await sleep(1_250)
    const before = lines.length
    monitor.stop()
    await sleep(1_250)
    assert.ok(before >= 1, `before=${before}`)
    assert.equal(lines.length, before)
    return `${before} dòng trong 1,25 giây, 0 dòng sau khi dừng`
  })

  await check('7. chi phí: CPU mỗi request có / không có bộ đo, thời gian dựng một dòng', async () => {
    const perRequestUs = async () => {
      const startedCpu = process.cpuUsage()
      await fetchMany(instant.port, 1_500, 30)
      const used = process.cpuUsage(startedCpu)
      return (used.user + used.system) / 1_500
    }
    await perRequestUs()
    const without = []
    const withMonitor = []
    let buildMs = 0
    for (let round = 0; round < 5; round += 1) {
      without.push(await perRequestUs())
      const monitor = monitorModule.startServerHealthMonitor({ intervalMs: 60_000, log: () => {} })
      withMonitor.push(await perRequestUs())
      const startedAt = performance.now()
      monitor.reportNow()
      buildMs = Math.max(buildMs, performance.now() - startedAt)
      monitor.stop()
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
    assert.ok(buildMs < 50, `buildMs=${buildMs}`)
    return `CPU mỗi request trung vị ${median(without).toFixed(0)} µs không đo / ${median(withMonitor).toFixed(0)} µs có đo; dựng một dòng ≤ ${buildMs.toFixed(2)} ms`
  })

  for (const item of [slow, fast, instant]) item.server.close()
  const failed = results.filter(item => !item.ok).length
  say(`\n${results.length - failed}/${results.length} PASS`)
  fs.rmSync(work, { recursive: true, force: true })
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  say('FAIL', error && error.stack ? error.stack : String(error))
  process.exit(1)
})
