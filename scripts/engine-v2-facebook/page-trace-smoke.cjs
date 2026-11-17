// Vết thao tác của block Facebook (src/main/engineAdapters/facebook/pageTrace.ts): bọc PageController, tên phần tử, trần 200 thao tác /
// 64 KB, cú bấm gửi đã chạy chưa, tín hiệu khi block lỗi, nhận ra block treo. Chạy: node scripts/engine-v2-facebook/page-trace-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const ROOT = path.resolve(__dirname, '../..')
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function load() {
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-trace-')), 'trace.cjs')
  await build({ entryPoints: [path.join(ROOT, 'src/main/engineAdapters/facebook/pageTrace.ts')], outfile, bundle: true, platform: 'node',
    format: 'cjs', logLevel: 'warning' })
  return require(outfile)
}

function fakePage(url = 'https://www.facebook.com/groups/123/?ref=bookmarks&token=SECRET') {
  const page = {
    url,
    getURL() { return this.url },
    isConnected() { return true },
    async click(selector) { if (selector.includes('missing')) throw new Error('Element not found: ' + selector) },
    async waitForSelector(selector) { throw new Error('waitForSelector timeout: ' + selector) },
    async type() {},
    async paste() {},
    async press() {},
    async evaluate(code) { if (code === 'boom') throw new Error('Script failed to execute'); return 1 },
    async apiCall() { return { status: 200, data: {}, headers: {} } },
    async navigate(next) { this.url = next }
  }
  return page
}

async function main() {
  const { PageTrace, tracePage, isNotDispatchedError, matchesSendOp, tracePageUrl, PAGE_TRACE_MAX_OPS, PAGE_TRACE_MAX_BYTES } = await load()
  const POST = '//div[@aria-label="Đăng" and @role="button"]'

  // 1. Ghi thao tác: tên phần tử thay XPath, phím, API bỏ chuỗi truy vấn, không ghi chữ khách gõ; getURL đi thẳng.
  {
    const trace = new PageTrace()
    trace.beginBlock()
    trace.noteElement('fb_post_button', POST)
    const page = tracePage(fakePage(), trace)
    await page.click(POST)
    await page.type('//textarea', 'Nội dung bí mật của khách')
    await page.press('Enter')
    await page.apiCall({ url: 'https://graph.facebook.com/v19.0/me/feed?access_token=SECRET', method: 'post' })
    assert.equal(page.getURL(), 'https://www.facebook.com/groups/123/?ref=bookmarks&token=SECRET')
    const { ops } = trace.snapshot()
    assert.deepEqual(ops.map(o => [o.op, o.el || o.sel]), [['click', 'fb_post_button'], ['type', '//textarea'], ['press', 'Enter'],
      ['api', 'POST graph.facebook.com/v19.0/me/feed']])
    assert.equal(ops[0].url, 'www.facebook.com/groups/123/')
    assert.equal(ops[1].url, undefined, 'URL chỉ ghi khi đổi')
    const text = JSON.stringify(ops)
    assert.ok(!text.includes('bí mật') && !text.includes('SECRET') && !text.includes('aria-label'))
    pass('Ghi thao tác: tên phần tử, phím, API không chuỗi truy vấn; không ghi chữ khách gõ, không token')
  }

  // 2. Trần 200 thao tác: giữ 40 đầu + phần cuối, đếm số bỏ; trần 64 KB với câu lỗi dài.
  {
    const trace = new PageTrace()
    trace.beginBlock()
    const page = tracePage(fakePage(), trace)
    for (let i = 0; i < 250; i++) await page.evaluate('x' + i)
    let snap = trace.snapshot()
    assert.equal(snap.ops.length, PAGE_TRACE_MAX_OPS); assert.equal(snap.dropped, 50)
    assert.equal(snap.ops[39].t <= snap.ops[40].t, true)
    const big = new PageTrace()
    big.beginBlock()
    const bp = tracePage(fakePage(), big)
    for (let i = 0; i < 199; i++) { await bp.waitForSelector(('//div[@class="' + 'x'.repeat(400) + '"]') + i).catch(() => {}) }
    snap = big.snapshot()
    assert.ok(JSON.stringify(snap.ops).length <= PAGE_TRACE_MAX_BYTES + 400, 'vết không quá 64 KB')
    assert.ok(snap.dropped > 0)
    pass('Trần vết: 200 thao tác / 64 KB, giữ phần đầu và phần cuối, đếm số bị bỏ')
  }

  // 3. Cú bấm gửi: không tìm thấy phần tử thì chưa gửi; bấm được hoặc lỗi giữa chừng thì đã gửi (không rõ kết quả).
  {
    assert.equal(isNotDispatchedError('Element not found: //x'), true)
    assert.equal(isNotDispatchedError('waitForSelector timeout: //x'), true)
    assert.equal(isNotDispatchedError('Script failed to execute'), false)
    assert.equal(matchesSendOp({ op: 'click', el: 'fb_post_button' }, 'click:fb_post_button'), true)
    assert.equal(matchesSendOp({ op: 'click', el: 'other' }, 'click:fb_post_button'), false)
    assert.equal(matchesSendOp({ op: 'press', el: 'Enter' }, 'press:Enter'), true)
    assert.equal(matchesSendOp({ op: 'evaluate' }, 'evaluate'), true)
    const trace = new PageTrace()
    trace.beginBlock(['click:fb_post_button'])
    trace.noteElement('fb_post_button', '//missing-post')
    const page = tracePage(fakePage(), trace)
    await page.click('//missing-post').catch(() => {})
    assert.equal(trace.sendAttempted, false, 'không tìm thấy nút đăng: chưa gửi')
    trace.noteElement('fb_post_button', POST)
    await page.click(POST)
    assert.equal(trace.sendAttempted, true)
    const viaEval = new PageTrace()
    viaEval.beginBlock(['evaluate'])
    await tracePage(fakePage(), viaEval).evaluate('boom').catch(() => {})
    assert.equal(viaEval.sendAttempted, true, 'script lỗi giữa chừng: không rõ kết quả')
    pass('Cú bấm gửi: phân biệt chắc chắn chưa gửi với đã bấm / không rõ kết quả')
  }

  // 4. Tín hiệu khi block lỗi: thao tác bị ném lại → wait:fb_post_button; block tự ném lỗi khác → throw; thử phần tử trong try không tính.
  {
    const trace = new PageTrace()
    trace.beginBlock()
    trace.noteElement('fb_post_button', POST)
    const page = tracePage(fakePage(), trace)
    let blockError = null
    try { await page.waitForSelector(POST) } catch (err) { blockError = err }
    let signal = trace.failureSignal(blockError)
    assert.equal(signal.code, 'wait:fb_post_button')
    assert.equal(signal.message, 'waitForSelector timeout: {fb_post_button}')
    assert.equal(signal.trace.ops.length, 1)
    const own = new PageTrace()
    own.beginBlock()
    const op = tracePage(fakePage(), own)
    await op.waitForSelector('//probe').catch(() => {})
    await op.click('//ok')
    signal = own.failureSignal(new Error('Không tìm thấy bài viết'))
    assert.equal(signal.code, 'throw')
    const wrapped = new PageTrace()
    wrapped.beginBlock()
    wrapped.noteElement('fb_comment_box', '//missing-comment-box-xyz')
    const wp = tracePage(fakePage(), wrapped)
    let err2 = null
    try { await wp.click('//missing-comment-box-xyz') } catch (err) { err2 = new Error('Không bấm được ô bình luận: ' + err.message) }
    assert.equal(wrapped.failureSignal(err2).code, 'click:fb_comment_box')
    assert.equal(tracePageUrl('https://m.facebook.com/story.php?id=1#x'), 'm.facebook.com/story.php')
    pass('Tín hiệu block lỗi: thao tác bị ném lại / lỗi riêng của block / thử phần tử không tính')
  }

  // 5. Block treo (Q20): quá giới hạn không thao tác là treo; đang nghỉ theo cài đặt thì không tính.
  {
    let now = 1_000_000
    const trace = new PageTrace(() => now)
    trace.beginBlock()
    now += 9 * 60_000
    assert.equal(trace.idleFor(10 * 60_000), false)
    now += 2 * 60_000
    assert.equal(trace.idleFor(10 * 60_000), true)
    trace.touch()
    trace.sleepStart()
    now += 30 * 60_000
    assert.equal(trace.idleFor(10 * 60_000), false, 'đang nghỉ theo cài đặt')
    trace.sleepEnd()
    now += 60_000
    assert.equal(trace.idleFor(10 * 60_000), false)
    now += 10 * 60_000
    assert.equal(trace.idleFor(10 * 60_000), true)
    pass('Block treo: 10 phút không thao tác, không tính lúc nghỉ theo cài đặt')
  }

  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

main().catch(err => { console.error(err); process.exit(1) })
