// Quét QR Zalo qua proxy từ chối CONNECT: zca-js chỉ báo "Cannot get API login version" vì https-proxy-agent phát lại
// trang lỗi của proxy như trả lời của id.zalo.me (18/11/2026). Bài này chạy zca-js loginQR thật với ProxyAgent + node-fetch
// như createZaloClient, qua một proxy giả cục bộ (không ra mạng), và kiểm observeProxyConnectRejections của
// src/main/services/zaloProxyConnectObserver.ts bắt đúng mã proxy trả.
//
//   node scripts/zalo-qr-proxy-reject-smoke.cjs
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const observerFile = path.join(root, 'src/main/services/zaloProxyConnectObserver.ts')
const observerSource = ts.transpileModule(fs.readFileSync(observerFile, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const observerModule = { exports: {} }
new Function('module', 'exports', 'require', observerSource)(observerModule, observerModule.exports, require)
const { observeProxyConnectRejections, zaloQrProxyRejectedMessage } = observerModule.exports

let checks = 0
const pass = name => { checks++; console.log('PASS', name) }

/** Proxy giả: trả `reply` cho lệnh CONNECT đầu tiên rồi đóng; ghi lại dòng lệnh để chắc không có gì ra mạng thật. */
async function withProxy(reply, run) {
  const requests = []
  const server = net.createServer(socket => {
    socket.on('error', () => {})
    socket.once('data', buffer => {
      requests.push(buffer.toString('latin1').split('\r\n')[0])
      if (reply === 200) {
        socket.write('HTTP/1.1 200 Connection established\r\n\r\n')
        socket.destroy()
        return
      }
      const body = '<html><body>Proxy says no</body></html>'
      socket.end(`HTTP/1.1 ${reply}\r\nContent-Type: text/html\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    return await run(server.address().port, requests)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

async function runQr(port, { observe }) {
  const { Zalo } = await import('zca-js')
  const { ProxyAgent } = await import('proxy-agent')
  const nodeFetch = (await import('node-fetch')).default
  const agent = new ProxyAgent({ getProxyForUrl: () => `http://user:p%40ss@127.0.0.1:${port}` })
  const rejected = []
  if (observe) observeProxyConnectRejections(agent, statusCode => rejected.push(statusCode))
  const zalo = new Zalo({ agent, polyfill: (url, init) => nodeFetch(url, init), logging: false, checkUpdate: false })
  let error = null
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('loginQR không kết thúc sau 15 giây')), 15_000).unref())
  try {
    await Promise.race([zalo.loginQR({ userAgent: 'Mozilla/5.0', language: 'vi' }, () => {}), timeout])
  } catch (err) {
    error = err
  }
  return { error, rejected }
}

async function main() {
  // Đối chứng: không bọc thì khách chỉ thấy câu của zca-js.
  await withProxy('407 Proxy Authentication Required', async (port, requests) => {
    const { error, rejected } = await runQr(port, { observe: false })
    assert.equal(error?.message, 'Cannot get API login version')
    assert.deepEqual(rejected, [])
    assert.deepEqual(requests, ['CONNECT id.zalo.me:443 HTTP/1.1'])
    pass('đối chứng: 407 không bọc ra "Cannot get API login version"')
  })

  for (const [reply, code] of [['407 Proxy Authentication Required', 407], ['403 Forbidden', 403], ['502 Bad Gateway', 502]]) {
    await withProxy(reply, async (port, requests) => {
      const { error, rejected } = await runQr(port, { observe: true })
      assert.equal(error?.message, 'Cannot get API login version')
      assert.deepEqual(rejected, [code])
      assert.deepEqual(requests, ['CONNECT id.zalo.me:443 HTTP/1.1'])
      assert.equal(zaloQrProxyRejectedMessage(rejected[0]),
        `Proxy của tài khoản từ chối kết nối tới Zalo (mã ${code}). Vui lòng kiểm tra lại proxy.`)
      pass(`proxy trả ${code}: bắt được mã ${code}`)
    })
  }

  // Proxy nhận CONNECT (200) mà lỗi sau đó: không phải proxy từ chối, giữ câu lỗi gốc.
  await withProxy(200, async (port) => {
    const { error, rejected } = await runQr(port, { observe: true })
    assert.ok(error, 'phải có lỗi khi đường hầm bị đóng')
    assert.deepEqual(rejected, [])
    pass(`proxy nhận CONNECT rồi đóng: không ghi mã (lỗi gốc: ${error.message.slice(0, 60)})`)
  })

  // Agent không có connect(): không làm gì, không ném lỗi.
  observeProxyConnectRejections(null, () => { throw new Error('không được gọi') })
  observeProxyConnectRejections({}, () => { throw new Error('không được gọi') })
  pass('agent không có connect(): bỏ qua')

  console.log(`\n${checks} PASS`)
}

main().catch(error => {
  console.error('FAIL', error)
  process.exit(1)
})
