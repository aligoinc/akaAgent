// Giờ máy bị kéo lùi liên tục (19/11/2026: một máy khách bị đặt lại giờ lùi 1 giờ sau mỗi giờ) không được làm vòng chờ kéo dài vô hạn:
// hạn chờ của waitForSelector, bộ nhận ra block treo (PageTrace) và hạn chờ dùng chung (src/shared/monotonicNow.ts) đo bằng đồng hồ đơn điệu.
//
// Chạy: node scripts/engine-v2-facebook/clock-rollback-smoke.cjs
// Đối chứng (bản cũ phải treo): node scripts/engine-v2-facebook/clock-rollback-smoke.cjs --legacy-ref <git ref trước bản sửa>
'use strict'
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const ROOT = path.resolve(__dirname, '../..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-clock-rollback-'))
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

const stubElectron = {
  name: 'stub-electron',
  setup(plugin) {
    plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub-electron' }))
    plugin.onLoad({ filter: /.*/, namespace: 'stub-electron' }, () => ({ contents: 'module.exports = {}', loader: 'js' }))
    // blockHelpers đọc XPath theo tên từ DB: bài kiểm không dùng.
    plugin.onResolve({ filter: /repositories\/elementV2Repository$/ }, () => ({ path: 'elementV2Repository', namespace: 'stub-elements' }))
    plugin.onLoad({ filter: /.*/, namespace: 'stub-elements' }, () => ({ contents: 'module.exports = { resolveXpathByName: async () => null }', loader: 'js' }))
  }
}

async function bundle(entry, name) {
  const outfile = path.join(TMP, `${name}.cjs`)
  await build({ entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning', plugins: [stubElectron] })
  return require(outfile)
}

/** Giờ máy lùi 1 giờ sau mỗi 20 ms thật: Date.now() không bao giờ vượt mốc lúc bắt đầu. */
function rollbackClock() {
  const realNow = Date.now
  const startedAt = realNow()
  let steps = 0
  const timer = setInterval(() => { steps++ }, 20)
  Date.now = () => realNow() - steps * 3_600_000
  return {
    restore() { clearInterval(timer); Date.now = realNow },
    elapsed: () => realNow() - startedAt
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const within = (promise, ms) => Promise.race([promise.then(value => ({ done: true, value }), error => ({ done: true, error })),
  sleep(ms).then(() => ({ done: false }))])

/** WebContents giả: trang không bao giờ có phần tử cần chờ. */
const fakeWebContents = () => ({
  isDestroyed: () => false,
  getURL: () => 'https://www.facebook.com/groups/1/',
  executeJavaScript: async () => false
})

async function waitOutcome(PageController, timeout, guardMs) {
  const page = new PageController(fakeWebContents())
  const clock = rollbackClock()
  try {
    const outcome = await within(page.waitForSelector('//div[@data-x="không có"]', { timeout }), guardMs)
    return { ...outcome, elapsed: clock.elapsed() }
  } finally {
    clock.restore()
  }
}

/** Vòng đếm hạn kiểu các block thật trong auto_blocks (fb_collect_*, fb_group_invite, fb_send_page_inbox_message…). */
const BLOCK_WITH_DEADLINE = `
  const deadline = Date.now() + 300
  let rounds = 0
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
    rounds++
  }
  return {
    rounds,
    newDateGap: Math.abs(new Date().getTime() - Date.now()),
    fixed: new Date(86400000).toISOString(),
    parsed: Date.parse('2026-11-19T00:00:00Z'),
    isDate: new Date(0) instanceof Date,
    asFunction: typeof Date()
  }
`

async function blockOutcome(BlockExecutor, guardMs) {
  const clock = rollbackClock()
  try {
    const run = new BlockExecutor().execute({ code: BLOCK_WITH_DEADLINE, blockName: 'deadline_loop' },
      { input: {}, page: null, vars: {}, signal: new AbortController().signal })
    return { ...(await within(run, guardMs)), elapsed: clock.elapsed() }
  } finally {
    clock.restore()
  }
}

async function legacyBundle(ref, file, name) {
  const target = path.join(TMP, 'legacy', file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  for (const item of [file, 'src/main/v2/runtime/pageController.ts', 'src/main/v2/runtime/blockHelpers.ts', 'src/shared/v2Types.ts',
    'src/shared/contentSpin.ts', 'src/shared/types.ts', 'src/shared/campaignContentPreparation.ts']) {
    const to = path.join(TMP, 'legacy', item)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    try { fs.writeFileSync(to, execFileSync('git', ['show', `${ref}:${item}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })) } catch { /* tệp không có ở bản đó */ }
  }
  return bundle(target, name)
}

async function main() {
  const legacyIndex = process.argv.indexOf('--legacy-ref')
  if (legacyIndex >= 0) {
    // Đối chứng: bản trước khi sửa đếm hạn bằng Date.now() nên không bao giờ hết hạn khi giờ máy bị kéo lùi.
    const ref = process.argv[legacyIndex + 1]
    const { PageController } = await legacyBundle(ref, 'src/main/v2/runtime/pageController.ts', 'legacy-page')
    const outcome = await waitOutcome(PageController, 600, 4_000)
    assert.equal(outcome.done, false, `bản ${ref}: waitForSelector phải treo khi giờ máy bị kéo lùi`)
    console.log(`ĐỐI CHỨNG: bản ${ref}, waitForSelector vẫn chờ sau ${outcome.elapsed} ms dù hạn là 600 ms`)
    const { BlockExecutor } = await legacyBundle(ref, 'src/main/v2/runtime/blockExecutor.ts', 'legacy-block')
    const block = await blockOutcome(BlockExecutor, 4_000)
    assert.equal(block.done, false, `bản ${ref}: vòng đếm hạn trong code block phải treo khi giờ máy bị kéo lùi`)
    console.log(`ĐỐI CHỨNG: bản ${ref}, vòng đếm hạn 300 ms trong code block vẫn chạy sau ${block.elapsed} ms`)
    process.exit(0)
  }

  const { monotonicNow, monotonicDeadline } = await bundle(path.join(ROOT, 'src/shared/monotonicNow.ts'), 'monotonic')
  const { PageController } = await bundle(path.join(ROOT, 'src/main/v2/runtime/pageController.ts'), 'page')
  const { PageTrace } = await bundle(path.join(ROOT, 'src/main/engineAdapters/facebook/pageTrace.ts'), 'trace')
  const { BlockExecutor } = await bundle(path.join(ROOT, 'src/main/v2/runtime/blockExecutor.ts'), 'block')

  // 1. Hạn chờ dùng chung: hết hạn theo thời gian thật dù giờ máy lùi; còn lại không âm.
  {
    const clock = rollbackClock()
    try {
      const before = monotonicNow()
      const fakeBefore = Date.now()
      const deadline = monotonicDeadline(300)
      assert.equal(deadline.expired(), false)
      assert.ok(deadline.remaining() > 200 && deadline.remaining() <= 300)
      await sleep(360)
      assert.equal(deadline.expired(), true, 'hết hạn sau 300 ms thật')
      assert.equal(deadline.remaining(), 0)
      assert.ok(monotonicNow() - before >= 340, 'đồng hồ đơn điệu vẫn tiến')
      assert.ok(Date.now() < fakeBefore, 'giờ máy giả đã lùi')
      assert.equal(monotonicDeadline(-5).expired(), true, 'hạn âm là hết hạn ngay')
    } finally { clock.restore() }
    pass('Hạn chờ dùng chung hết hạn theo thời gian thật khi giờ máy bị kéo lùi')
  }

  // 2. waitForSelector: báo hết hạn sau khoảng timeout thật (trước bản sửa: chờ mãi).
  {
    const outcome = await waitOutcome(PageController, 600, 5_000)
    assert.equal(outcome.done, true, 'waitForSelector phải kết thúc')
    assert.match(String(outcome.error && outcome.error.message), /^waitForSelector timeout/)
    assert.ok(outcome.elapsed >= 550 && outcome.elapsed < 2_500, `kết thúc sau ${outcome.elapsed} ms`)
    pass(`waitForSelector hết hạn sau ${outcome.elapsed} ms (hạn 600 ms) dù giờ máy lùi liên tục`)
  }

  // 3. waitForSelector vẫn trả true ngay khi phần tử có mặt, và giờ máy nhảy tới 12 giờ không làm hết hạn sớm.
  {
    const realNow = Date.now
    let calls = 0
    const wc = { ...fakeWebContents(), executeJavaScript: async () => ++calls >= 3 }
    Date.now = () => realNow() + calls * 12 * 3_600_000
    try {
      assert.equal(await new PageController(wc).waitForSelector('//div', { timeout: 5_000 }), true)
      assert.equal(calls, 3, 'dò tới khi phần tử có mặt, không hết hạn sớm vì giờ máy nhảy tới')
    } finally { Date.now = realNow }
    pass('waitForSelector không hết hạn sớm khi giờ máy nhảy tới')
  }

  // 4. Bộ nhận ra block treo (PageTrace mặc định): vẫn thấy treo khi giờ máy bị kéo lùi; thời lượng thao tác không âm.
  {
    const clock = rollbackClock()
    try {
      const trace = new PageTrace()
      trace.beginBlock()
      const startedAt = trace.clock()
      assert.equal(trace.idleFor(250), false)
      await sleep(320)
      assert.equal(trace.idleFor(250), true, 'quá 250 ms thật không thao tác là treo')
      const op = trace.record('click', ['//div'], startedAt, null, '')
      assert.ok(op.ms >= 300 && op.ms < 2_000 && op.t >= 0, `thời lượng thao tác ${op.ms} ms`)
      assert.equal(trace.idleFor(250), false, 'vừa có thao tác')
      trace.sleepStart()
      await sleep(320)
      assert.equal(trace.idleFor(250), false, 'đang nghỉ theo cài đặt')
      trace.sleepEnd()
    } finally { clock.restore() }
    pass('Bộ nhận ra block treo vẫn hoạt động khi giờ máy bị kéo lùi')
  }

  // 5. Code block tự đếm hạn bằng Date.now(): Date của sandbox bám đồng hồ đơn điệu nên vòng kết thúc; phần còn lại của Date như thật.
  {
    const outcome = await blockOutcome(BlockExecutor, 5_000)
    assert.equal(outcome.done, true, 'block phải kết thúc')
    const result = outcome.value
    assert.equal(result.success, true, result.error)
    assert.ok(outcome.elapsed >= 280 && outcome.elapsed < 2_500, `kết thúc sau ${outcome.elapsed} ms`)
    assert.ok(result.output.rounds >= 5 && result.output.rounds <= 20, `số vòng ${result.output.rounds}`)
    assert.ok(result.output.newDateGap <= 5, 'new Date() và Date.now() của sandbox cùng một đồng hồ')
    assert.equal(result.output.fixed, '1970-01-02T00:00:00.000Z')
    assert.equal(result.output.parsed, Date.parse('2026-11-19T00:00:00Z'))
    assert.equal(result.output.isDate, true)
    assert.equal(result.output.asFunction, 'string')
    pass(`Vòng đếm hạn trong code block kết thúc sau ${outcome.elapsed} ms (hạn 300 ms) khi giờ máy lùi liên tục`)
  }

  // 6. Giờ máy đúng: Date.now() của sandbox bằng giờ máy lúc block bắt đầu cộng thời gian thật đã trôi.
  {
    const startedAt = Date.now()
    const result = await new BlockExecutor().execute({ code: 'await new Promise(r => setTimeout(r, 60)); return { now: Date.now(), iso: new Date().toISOString() }',
      blockName: 'now' }, { input: {}, page: null, vars: {}, signal: new AbortController().signal })
    assert.equal(result.success, true, result.error)
    assert.ok(Math.abs(result.output.now - Date.now()) <= 50 && result.output.now >= startedAt + 50)
    assert.ok(Math.abs(Date.parse(result.output.iso) - result.output.now) <= 5)
    pass('Giờ máy đúng thì Date của sandbox trùng giờ máy')
  }

  console.log(`\nOK ${checks} nhóm`)
  process.exit(0)
}

main().catch(error => { console.error(error); process.exit(1) })
