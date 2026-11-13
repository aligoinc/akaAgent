// Dừng listener Zalo phải dứt khoát: zca-js 2.1.2 không huỷ hẹn giờ nối lại khi stop() (kết nối "ma", 13/11/2026).
// Bài này chạy chính lớp Listener của zca-js với một máy chủ WebSocket cục bộ, so bản gọi thẳng start()/stop() (lỗi gốc,
// dùng làm đối chứng) với startZaloListenerGuarded/stopZaloListenerGuarded của src/main/services/zaloListenerStopGuard.ts.
//
//   node scripts/zalo-listener-stop-retry-smoke.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const ts = require('typescript')
const { WebSocketServer } = require('ws')

const root = path.resolve(__dirname, '..')
const guardFile = path.join(root, 'src/main/services/zaloListenerStopGuard.ts')
const guardSource = ts.transpileModule(fs.readFileSync(guardFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const guardModule = { exports: {} }
new Function('module', 'exports', 'require', guardSource)(guardModule, guardModule.exports, require)
const { startZaloListenerGuarded, stopZaloListenerGuarded } = guardModule.exports

const RETRY_MS = 300
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let checks = 0
const pass = name => { checks++; console.log('PASS', name) }
const uncaught = []
process.on('uncaughtException', error => { uncaught.push(error) })

async function waitFor(predicate, label, timeoutMs = 3_000) {
  const until = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > until) throw new Error(`Hết giờ chờ: ${label}`)
    await sleep(10)
  }
}

/** Máy chủ giả: đếm lượt bắt tay và kết nối; tuỳ chọn đá kết nối đầu (3003) hoặc trì hoãn bắt tay đầu. */
async function withServer(behavior, run) {
  const attempts = []
  const connections = []
  const server = new WebSocketServer({
    host: '127.0.0.1',
    port: 0,
    verifyClient: (_info, done) => {
      attempts.push(Date.now())
      if (behavior.handshakeDelayMs && attempts.length === 1) setTimeout(() => done(true), behavior.handshakeDelayMs)
      else done(true)
    }
  })
  await new Promise(resolve => server.once('listening', resolve))
  server.on('connection', socket => {
    connections.push(socket)
    socket.on('error', () => undefined)
    if (behavior.kickFirst && connections.length === 1) setTimeout(() => socket.close(3003, 'KICKOUT_BY_WORKER'), 50)
  })
  const { port } = server.address()
  try {
    return await run({ url: `ws://127.0.0.1:${port}/`, attempts, connections })
  } finally {
    for (const client of server.clients) client.terminate()
    await new Promise(resolve => server.close(resolve))
  }
}

// retryCodes: mã đóng mà zca-js tự nối lại (thật ra do Zalo trả trong settings.features.socket).
function makeListener(Listener, url, retryCodes = [1006, 3000, 3003]) {
  const retry = { max: 3, times: [RETRY_MS] }
  const ctx = {
    cookie: { getCookieStringSync: () => 'zpw_sek=smoke' },
    userAgent: 'aka-agent-listener-smoke',
    options: { selfListen: false, agent: undefined, logging: false },
    API_VERSION: 650,
    API_TYPE: 30,
    settings: { features: { socket: {
      retries: Object.fromEntries(retryCodes.map(code => [code, retry])),
      close_and_retry_codes: retryCodes,
      rotate_error_codes: []
    } } }
  }
  const listener = new Listener(ctx, [url])
  const disconnects = []
  const closes = []
  listener.on('disconnected', code => disconnects.push(code))
  listener.on('closed', code => closes.push(code))
  listener.on('error', () => undefined)
  return { listener, disconnects, closes }
}

const OPEN = 1
const CLOSED = 3
const openCount = connections => connections.filter(socket => socket.readyState === OPEN).length

async function main() {
  const { Listener } = await import(pathToFileURL(path.join(root, 'node_modules/zca-js/dist/apis/listen.js')).href)

  // 1. Lỗi gốc (đối chứng): stop() lúc đang chờ nối lại không làm gì, hẹn giờ vẫn mở kết nối mới.
  await withServer({ kickFirst: true }, async ({ url, connections }) => {
    const { listener, disconnects } = makeListener(Listener, url)
    listener.start({ retryOnClose: true })
    await waitFor(() => disconnects.includes(3003), 'bị đá 3003')
    listener.stop()
    await sleep(RETRY_MS * 3)
    assert.equal(connections.length, 2, 'zca-js gốc phải nối lại sau stop() (lỗi cần sửa)')
    listener.stop()
    pass('đối chứng: zca-js gốc nối lại sau stop() lúc đang chờ nối lại (kết nối ma)')
  })

  // 2. Có bọc: stop() lúc đang chờ nối lại thì không còn kết nối nào.
  await withServer({ kickFirst: true }, async ({ url, connections, attempts }) => {
    const { listener, disconnects } = makeListener(Listener, url)
    startZaloListenerGuarded(listener, { retryOnClose: true })
    await waitFor(() => disconnects.includes(3003), 'bị đá 3003')
    stopZaloListenerGuarded(listener)
    await sleep(RETRY_MS * 3)
    assert.equal(connections.length, 1)
    assert.equal(attempts.length, 1)
    pass('có bọc: stop() lúc đang chờ nối lại không để lại kết nối ma')
  })

  // 3. Có bọc nhưng app chưa dừng: zca-js vẫn tự nối lại sau khi bị đá (giữ hành vi cũ), dừng xong thì thôi.
  await withServer({ kickFirst: true }, async ({ url, connections }) => {
    const { listener, disconnects } = makeListener(Listener, url)
    startZaloListenerGuarded(listener, { retryOnClose: true })
    await waitFor(() => disconnects.includes(3003), 'bị đá 3003')
    await waitFor(() => connections.length === 2, 'tự nối lại')
    stopZaloListenerGuarded(listener)
    await sleep(RETRY_MS * 3)
    assert.equal(connections.length, 2)
    pass('có bọc: chưa dừng thì zca-js vẫn tự nối lại sau 3003; dừng xong không nối thêm')
  })

  // 4. Dừng lúc socket còn CONNECTING (đóng ra 1006): gốc nối lại, có bọc thì không.
  await withServer({ handshakeDelayMs: 500 }, async ({ url, attempts }) => {
    const { listener } = makeListener(Listener, url)
    listener.start({ retryOnClose: true })
    await waitFor(() => attempts.length === 1, 'bắt tay đầu')
    listener.stop()
    await sleep(RETRY_MS * 3)
    assert.ok(attempts.length >= 2, 'zca-js gốc phải nối lại sau stop() lúc CONNECTING')
    listener.stop()
    pass('đối chứng: zca-js gốc nối lại sau stop() lúc socket còn CONNECTING')
  })
  await withServer({ handshakeDelayMs: 500 }, async ({ url, attempts }) => {
    const { listener } = makeListener(Listener, url)
    startZaloListenerGuarded(listener, { retryOnClose: true })
    await waitFor(() => attempts.length === 1, 'bắt tay đầu')
    stopZaloListenerGuarded(listener)
    await sleep(800)
    assert.equal(attempts.length, 1)
    pass('có bọc: stop() lúc socket còn CONNECTING không nối lại')
  })

  // 5. Dừng rồi khởi động lại ngay khi hẹn giờ cũ còn chờ: kết nối mới chạy, hẹn giờ cũ bị bỏ qua, không ném "Already started".
  await withServer({ kickFirst: true }, async ({ url, connections }) => {
    const before = uncaught.length
    const { listener, disconnects } = makeListener(Listener, url)
    startZaloListenerGuarded(listener, { retryOnClose: true })
    await waitFor(() => disconnects.includes(3003), 'bị đá 3003')
    stopZaloListenerGuarded(listener)
    startZaloListenerGuarded(listener, { retryOnClose: true })
    await waitFor(() => connections.length === 2, 'khởi động lại')
    await sleep(RETRY_MS * 3)
    assert.equal(connections.length, 2)
    assert.equal(uncaught.length, before, `lỗi ném trong hẹn giờ: ${uncaught.slice(before).map(String).join('; ')}`)
    stopZaloListenerGuarded(listener)
    pass('có bọc: dừng rồi khởi động lại ngay, hẹn giờ cũ không mở kết nối thứ ba, không ném lỗi')
  })

  // 6. Bọc nhiều lần trên cùng listener không chồng lớp.
  await withServer({}, async ({ url, connections }) => {
    const { listener } = makeListener(Listener, url)
    for (let i = 0; i < 3; i++) {
      startZaloListenerGuarded(listener, { retryOnClose: true })
      await waitFor(() => connections.length === i + 1, `lần khởi động ${i + 1}`)
      stopZaloListenerGuarded(listener)
      await sleep(50)
    }
    await sleep(RETRY_MS * 2)
    assert.equal(connections.length, 3)
    pass('có bọc: khởi động/dừng lặp lại trên cùng listener đúng số kết nối')
  })

  // 7. Dừng rồi khởi động lại ngay trên cùng listener lúc socket đang mở (App Server/Desktop làm mới listener trước khi gửi
  //    tệp): sự kiện đóng của socket cũ tới sau và `reset()` mất dấu socket mới; stop() sau đó không đóng được nó.
  await withServer({}, async ({ url, connections }) => {
    const { listener, disconnects, closes } = makeListener(Listener, url)
    listener.start({ retryOnClose: true })
    await waitFor(() => connections.length === 1 && listener.ws?.readyState === OPEN, 'kết nối đầu')
    listener.stop()
    listener.start({ retryOnClose: true })
    await waitFor(() => connections.length === 2 && connections[0].readyState === CLOSED, 'socket cũ đóng xong')
    await waitFor(() => closes.length === 1, 'sự kiện đóng của socket cũ')
    await sleep(100)
    assert.equal(listener.ws, null, 'zca-js gốc phải mất dấu socket mới (lỗi cần sửa)')
    assert.deepEqual(disconnects, [1000])
    listener.stop()
    await sleep(200)
    assert.equal(openCount(connections), 1, 'socket mới phải còn mở sau stop() (kết nối ma)')
    pass('đối chứng: zca-js gốc stop() rồi start() ngay thì mất dấu socket mới, stop() sau không đóng được')
  })
  await withServer({}, async ({ url, connections }) => {
    const { listener, disconnects, closes } = makeListener(Listener, url)
    startZaloListenerGuarded(listener, { retryOnClose: true })
    await waitFor(() => connections.length === 1 && listener.ws?.readyState === OPEN, 'kết nối đầu')
    stopZaloListenerGuarded(listener)
    startZaloListenerGuarded(listener, { retryOnClose: true })
    await waitFor(() => connections.length === 2 && connections[0].readyState === CLOSED, 'socket cũ đóng xong')
    await waitFor(() => listener.ws?.readyState === OPEN, 'socket mới mở')
    await sleep(100)
    assert.ok(listener.ws, 'listener phải giữ socket mới')
    assert.equal(disconnects.length, 0, 'không báo đóng của socket cũ cho kết nối mới')
    assert.equal(closes.length, 0)
    stopZaloListenerGuarded(listener)
    await waitFor(() => openCount(connections) === 0, 'đóng socket mới')
    await sleep(RETRY_MS * 3)
    assert.equal(connections.length, 2)
    pass('có bọc: stop() rồi start() ngay giữ socket mới, không báo đóng nhầm, stop() sau đóng được')
  })

  // 8. Mã đóng khi tự dừng (1000) nằm trong close_and_retry_codes: zca-js gốc tự nối lại và không báo `closed`;
  //    có bọc thì báo `closed` đúng một lần (runtime Fly dựa vào nó để nối lại), không nối lại.
  await withServer({}, async ({ url, connections }) => {
    const { listener, closes } = makeListener(Listener, url, [1000, 1006, 3000, 3003])
    listener.start({ retryOnClose: true })
    await waitFor(() => listener.ws?.readyState === OPEN, 'kết nối đầu')
    listener.stop()
    await waitFor(() => connections.length === 2, 'zca-js gốc nối lại')
    await sleep(100)
    assert.equal(closes.length, 0, 'zca-js gốc không báo closed khi tự nối lại')
    stopZaloListenerGuarded(listener) // dọn đối chứng: stop() thường lại tự nối lại
    pass('đối chứng: mã 1000 được nối lại thì zca-js gốc mở kết nối ma sau stop() và không báo closed')
  })
  await withServer({}, async ({ url, connections, attempts }) => {
    const { listener, disconnects, closes } = makeListener(Listener, url, [1000, 1006, 3000, 3003])
    startZaloListenerGuarded(listener, { retryOnClose: true })
    await waitFor(() => listener.ws?.readyState === OPEN, 'kết nối đầu')
    stopZaloListenerGuarded(listener)
    await waitFor(() => closes.length === 1, 'báo closed')
    await sleep(RETRY_MS * 3)
    assert.deepEqual(disconnects, [1000])
    assert.deepEqual(closes, [1000])
    assert.equal(attempts.length, 1)
    assert.equal(connections.length, 1)
    assert.equal(Object.prototype.hasOwnProperty.call(listener, 'canRetry'), false, 'không để lại canRetry giả trên listener')
    pass('có bọc: tự dừng với mã được nối lại vẫn báo closed một lần, không nối lại')
  })

  // 9. Dừng lúc CONNECTING rồi khởi động lại ngay: sự kiện đóng (1006) của socket đang bắt tay không gỡ socket mới.
  await withServer({ handshakeDelayMs: 300 }, async ({ url, attempts, connections }) => {
    const { listener, disconnects, closes } = makeListener(Listener, url)
    startZaloListenerGuarded(listener, { retryOnClose: true })
    await waitFor(() => attempts.length === 1, 'bắt tay đầu')
    stopZaloListenerGuarded(listener)
    startZaloListenerGuarded(listener, { retryOnClose: true })
    await waitFor(() => listener.ws?.readyState === OPEN, 'socket mới mở')
    await sleep(RETRY_MS * 3)
    assert.ok(listener.ws, 'listener phải giữ socket mới')
    assert.equal(disconnects.length, 0)
    assert.equal(closes.length, 0)
    assert.equal(openCount(connections), 1)
    stopZaloListenerGuarded(listener)
    await waitFor(() => openCount(connections) === 0, 'đóng socket mới')
    pass('có bọc: dừng lúc CONNECTING rồi khởi động lại không gỡ socket mới, không báo đóng nhầm')
  })

  assert.equal(uncaught.length, 0, `lỗi không bắt: ${uncaught.map(String).join('; ')}`)
  console.log(`\n${checks} kiểm tra đạt`)
}

main().then(() => process.exit(0), error => { console.error('FAIL', error); process.exit(1) })
