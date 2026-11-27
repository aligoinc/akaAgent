// Tự động hóa › Quy trình trên Electron thật: mã thật của JourneyWebService (đăng nhập native, cookie trong phân vùng, chặn điều
// hướng ra ngoài, đăng nhập lại khi trang báo hết phiên, chặn đăng nhập từ trang, dọn cookie) với một máy chủ cục bộ đóng vai API
// + trang Web nhúng. Không chạm mạng ngoài.
//   node scripts/journey-web-embed-electron-smoke.cjs          (Linux không màn hình: tự chạy dưới xvfb-run nếu có)
'use strict'
const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

const ROOT = resolve(__dirname, '..')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-journey-web-'))
  try {
    const fakeUser = join(dir, 'fakeCurrentUser.js')
    writeFileSync(fakeUser, `
      exports.getCurrentUser = () => globalThis.__journeyUser || null
      exports.requireCurrentUserCredentials = () => ({ username: 'staff7', password: 'pw-7' })
    `)
    await build({
      entryPoints: [join(ROOT, 'src/main/services/journeyWebService.ts')], bundle: true, platform: 'node', format: 'cjs',
      outfile: join(dir, 'journeyWebService.cjs'), external: ['electron'], logLevel: 'silent',
      plugins: [{ name: 'fake-user', setup(b) { b.onResolve({ filter: /data\/currentUser$/ }, () => ({ path: fakeUser })) } }]
    })
    writeFileSync(join(dir, 'main.cjs'), MAIN)
    const electron = require(join(ROOT, 'node_modules/electron'))
    const args = [electron, '--no-sandbox', join(dir, 'main.cjs')]
    const useXvfb = process.platform === 'linux' && !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
    const result = spawnSync(useXvfb ? 'xvfb-run' : args[0], useXvfb ? ['-a', ...args] : args.slice(1), {
      stdio: 'inherit', timeout: 120_000, env: { ...process.env, JOURNEY_SMOKE_DIR: dir, ELECTRON_DISABLE_SANDBOX: '1' }
    })
    if (result.status !== 0) process.exit(result.status || 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const MAIN = String.raw`
const { app, BrowserWindow, ipcMain, session } = require('electron')
const http = require('node:http')
const { join } = require('node:path')
const assert = require('node:assert/strict')

let guest = null
const state = { logins: 0, token: null, valid: true, loginBodies: [], logouts: [] }
const EXPIRED = 'akaAgent: cần đăng nhập lại'
const PAGE = '<!doctype html><meta charset="utf-8"><title>Tự động hóa</title><body><div id="out">...</div>'
  + '<a id="outside" href="/campaigns/77/edit">sửa</a> <a id="inside" href="/automation/5?embed=desktop">quy trình 5</a>'
  + '<script>fetch("/api/aka-agent/control/v1/me",{credentials:"same-origin"}).then(r=>{if(r.status===401){document.title=' + JSON.stringify(EXPIRED) + ';document.getElementById("out").textContent="expired"}else return r.json().then(b=>{document.getElementById("out").textContent="ok:"+b.data.id})})</script>'

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://x')
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    if (url.pathname === '/api/aka-agent/control/v1/auth/native/login' && request.method === 'POST') {
      state.logins += 1
      state.loginBodies.push({ body: JSON.parse(body), headers: { da: request.headers['x-aka-desktop-accounts'], fb: request.headers['x-aka-facebook-campaigns'], cookie: request.headers.cookie || null } })
      state.token = 'tok_' + 'a'.repeat(20) + state.logins
      state.valid = true
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ status: 1, errorCode: 0, message: 'ok', data: { status: 'active', token: state.token, me: { id: 7, organization: { id: 9 } } } }))
      return
    }
    if (url.pathname === '/api/aka-agent/control/v1/auth/logout') {
      state.logouts.push(request.headers.authorization || null)
      response.end('{"status":1}')
      return
    }
    if (url.pathname === '/api/aka-agent/control/v1/me') {
      const cookie = (request.headers.cookie || '').match(/aka_agent_control_session=([^;]+)/)
      response.setHeader('content-type', 'application/json')
      if (!cookie || cookie[1] !== state.token || !state.valid) { response.statusCode = 401; response.end('{"status":-1,"errorCode":401,"message":"het han"}'); return }
      response.end(JSON.stringify({ status: 1, errorCode: 0, message: 'ok', data: { id: 7, organization: { id: 9 } } }))
      return
    }
    if (url.pathname.startsWith('/automation') || url.pathname.startsWith('/campaigns')) {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(PAGE)
      return
    }
    response.statusCode = 404
    response.end('nope')
  })
})

const wait = (check, label, ms = 8000) => new Promise((resolve, reject) => {
  const started = Date.now()
  const tick = async () => {
    try { if (await check()) return resolve() } catch {}
    if (Date.now() - started > ms) return reject(new Error('Hết giờ chờ: ' + label))
    setTimeout(tick, 50)
  }
  tick()
})
let passed = 0
const ok = label => { passed += 1; console.log('PASS ' + label) }

app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  process.env.AKA_AGENT_WEB_APP_URL = origin
  globalThis.__journeyUser = { staffId: 7, organizationId: 9 }
  const { JourneyWebService, JOURNEY_WEB_ORIGIN } = require(join(process.env.JOURNEY_SMOKE_DIR, 'journeyWebService.cjs'))
  try {
    assert.equal(JOURNEY_WEB_ORIGIN, origin)
    const win = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { webviewTag: true, nodeIntegration: true, contextIsolation: false } })
    await win.loadURL('data:text/html,<body><script>window.navOut=[];require("electron").ipcRenderer.on("journey-web:navigate-out",(e,t)=>window.navOut.push(t))</script></body>')
    const service = new JourneyWebService(win, 7, 9)
    win.webContents.on('did-attach-webview', (_e, contents) => { guest = contents })

    // 1. Mở thẻ: đăng nhập native một lần, cookie httpOnly trong phân vùng riêng, mật khẩu chỉ đi trong thân yêu cầu.
    const ready = await service.prepare('dark', null)
    assert.equal(ready.status, 'ready')
    assert.equal(ready.partition, 'persist:akaagent_web_9_7')
    assert.equal(ready.url, origin + '/automation?embed=desktop&theme=dark')
    assert.equal(state.logins, 1)
    assert.deepEqual(state.loginBodies[0].body, { username: 'staff7', password: 'pw-7' })
    assert.equal(state.loginBodies[0].headers.da, '1')
    assert.equal(state.loginBodies[0].headers.fb, '1')
    const cookies = await session.fromPartition(ready.partition).cookies.get({ name: 'aka_agent_control_session' })
    assert.equal(cookies.length, 1)
    assert.equal(cookies[0].httpOnly, true)
    assert.equal(cookies[0].path, '/api/aka-agent/control/v1')
    ok('mở thẻ: đăng nhập native, cookie httpOnly đúng đường trong phân vùng riêng')

    // 2. Webview chỉ gắn được với đúng origin + /automation + embed; trang đọc /me bằng cookie.
    await win.webContents.executeJavaScript('(()=>{const w=document.createElement("webview");w.setAttribute("partition",' + JSON.stringify(ready.partition) + ');w.setAttribute("src",' + JSON.stringify(ready.url) + ');w.style.width="800px";w.style.height="600px";document.body.appendChild(w)})()')
    await wait(() => guest && !guest.isDestroyed(), 'webview gắn')
    await wait(async () => (await guest.executeJavaScript('document.getElementById("out").textContent')) === 'ok:7', 'trang đọc /me')
    ok('webview nạp trang nhúng, trang đọc /me bằng cookie phiên')

    // 3. Link ra ngoài Tự động hóa: không rời trang, main báo renderer mở màn Desktop.
    const before = guest.getURL()
    await guest.executeJavaScript('document.getElementById("outside").click()')
    await wait(async () => (await win.webContents.executeJavaScript('window.navOut.length')) === 1, 'navigate-out')
    assert.deepEqual(await win.webContents.executeJavaScript('window.navOut[0]'), { kind: 'campaign', campaignId: 77, edit: true })
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(guest.getURL(), before)
    ok('link ra ngoài: không rời trang, renderer nhận { kind: campaign, campaignId: 77, edit: true }')

    // 4. Link trong Tự động hóa: đi bình thường.
    await guest.executeJavaScript('document.getElementById("inside").click()')
    await wait(() => guest.getURL().includes('/automation/5'), 'đi tới /automation/5')
    await wait(async () => (await guest.executeJavaScript('document.getElementById("out").textContent')) === 'ok:7', 'trang 5 đọc /me')
    ok('link trong Tự động hóa đi bình thường')

    // 5. Trang không tự đăng nhập được (chặn ở phân vùng).
    const blocked = await guest.executeJavaScript('fetch("/api/aka-agent/control/v1/auth/native/login",{method:"POST",body:"{}"}).then(()=>"sent",()=>"blocked")')
    assert.equal(blocked, 'blocked')
    assert.equal(state.logins, 1)
    ok('trang nhúng không gọi được đăng nhập (chỉ main đăng nhập)')

    // 5b. Bot sự kiện: trang thứ hai cùng phiên (không đăng nhập lại), webview riêng, trang Quy trình vẫn sống.
    const automationGuest = guest
    const bot = await service.prepare('dark', null, 'eventBot')
    assert.equal(bot.status, 'ready')
    assert.equal(bot.view, 'eventBot')
    assert.equal(bot.partition, ready.partition)
    assert.equal(bot.url, origin + '/automation/event-bot?embed=desktop&theme=dark')
    assert.equal(state.logins, 1, 'dùng chung phiên')
    await win.webContents.executeJavaScript('(()=>{const w=document.createElement("webview");w.setAttribute("partition",' + JSON.stringify(bot.partition) + ');w.setAttribute("src",' + JSON.stringify(bot.url) + ');w.style.width="800px";w.style.height="600px";document.body.appendChild(w)})()')
    await wait(() => guest !== automationGuest && guest && !guest.isDestroyed(), 'webview bot gắn')
    const botGuest = guest
    await wait(async () => (await botGuest.executeJavaScript('document.getElementById("out").textContent')) === 'ok:7', 'trang bot đọc /me')
    assert.ok(!automationGuest.isDestroyed(), 'webview Quy trình không bị đóng')
    assert.equal((await service.prepare('dark', null)).view, 'automation')
    assert.equal(state.logins, 1)
    guest = automationGuest
    ok('Bot sự kiện: trang thứ hai cùng phiên, webview riêng, Quy trình vẫn sống')

    // 6. Phiên hết hạn: trang đổi tiêu đề, main đăng nhập lại một lần rồi nạp lại.
    state.valid = false
    guest.reload()
    await wait(() => state.logins === 2, 'đăng nhập lại')
    await wait(async () => (await guest.executeJavaScript('document.getElementById("out").textContent')) === 'ok:7', 'trang nạp lại có phiên')
    ok('phiên hết hạn: đăng nhập lại một lần, trang nạp lại')

    // 7. Hết hạn lần nữa ngay sau đó (đăng nhập lại không cứu được): không lặp, báo lỗi để khách bấm Thử lại.
    const states = []
    ipcMain.removeAllListeners('x')
    win.webContents.on('ipc-message', () => {})
    const originalSend = win.webContents.send.bind(win.webContents)
    win.webContents.send = (channel, payload) => { if (channel === 'journey-web:state') states.push(payload); return originalSend(channel, payload) }
    server.removeAllListeners('request')
    server.on('request', (request, response) => {
      const url = new URL(request.url, 'http://x')
      if (url.pathname.endsWith('/auth/native/login')) { state.logins += 1; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ status: 1, errorCode: 0, message: 'ok', data: { status: 'active', token: 'tok_' + 'b'.repeat(24), me: { id: 7, organization: { id: 9 } } } })); return }
      if (url.pathname.endsWith('/auth/logout')) { state.logouts.push(request.headers.authorization || null); response.end('{}'); return }
      if (url.pathname.endsWith('/me')) { response.statusCode = 401; response.end('{}'); return }
      response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(PAGE)
    })
    guest.reload()
    await wait(() => states.some(item => item.status === 'error'), 'báo lỗi sau lần thứ hai')
    const loginsAfter = state.logins
    await new Promise(resolve => setTimeout(resolve, 600))
    assert.equal(state.logins, loginsAfter, 'không đăng nhập lặp')
    assert.ok(loginsAfter <= 4)
    ok('hết hạn liên tiếp: không đăng nhập lặp, báo lỗi để thử lại')

    // 8. Đổi nhân viên: dịch vụ cũ thôi nhận; dispose xoá cookie của phân vùng.
    await service.dispose()
    const left = await session.fromPartition(ready.partition).cookies.get({ name: 'aka_agent_control_session' })
    assert.equal(left.length, 0)
    // Mỗi lần thay phiên thu hồi phiên cũ; đăng xuất thu hồi phiên đang dùng.
    assert.ok(state.logouts.length >= 2, JSON.stringify(state.logouts))
    assert.ok(state.logouts.every(value => /^Bearer tok_/.test(value)))
    ok('đăng xuất: xoá cookie phiên của phân vùng, thu hồi phiên native trên máy chủ')
    console.log('\n' + passed + ' PASS')
    server.close()
    app.exit(0)
  } catch (error) {
    console.error('FAIL', error && error.stack || error)
    server.close()
    app.exit(1)
  }
})
`

main().catch(error => { console.error(error); process.exit(1) })
