// Menu Báo cáo 2 trên Electron thật: mã thật của Reports2WebService (khung nhúng dùng chung với Tự động hóa) với một máy chủ
// cục bộ đóng vai API + trang Web nhúng. Chạy cùng lúc với JourneyWebService để kiểm hai khung không lẫn nhau (phân vùng,
// webview, kênh link ra ngoài, dọn phiên). Không chạm mạng ngoài.
//   node scripts/reports2-web-embed-electron-smoke.cjs          (Linux không màn hình: tự chạy dưới xvfb-run nếu có)
'use strict'
const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

const ROOT = resolve(__dirname, '..')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-reports2-web-'))
  try {
    const fakeUser = join(dir, 'fakeCurrentUser.js')
    writeFileSync(fakeUser, `
      exports.getCurrentUser = () => globalThis.__embedUser || null
      exports.requireCurrentUserCredentials = () => ({ username: 'staff7', password: 'pw-7' })
    `)
    const plugins = [{ name: 'fake-user', setup(b) { b.onResolve({ filter: /data\/currentUser$/ }, () => ({ path: fakeUser })) } }]
    for (const name of ['reports2WebService', 'journeyWebService']) {
      await build({
        entryPoints: [join(ROOT, `src/main/services/${name}.ts`)], bundle: true, platform: 'node', format: 'cjs',
        outfile: join(dir, `${name}.cjs`), external: ['electron'], logLevel: 'silent', plugins
      })
    }
    writeFileSync(join(dir, 'main.cjs'), MAIN)
    const electron = require(join(ROOT, 'node_modules/electron'))
    const args = [electron, '--no-sandbox', join(dir, 'main.cjs')]
    const useXvfb = process.platform === 'linux' && !process.env.DISPLAY && existsSync('/usr/bin/xvfb-run')
    const result = spawnSync(useXvfb ? 'xvfb-run' : args[0], useXvfb ? ['-a', ...args] : args.slice(1), {
      stdio: 'inherit', timeout: 120_000, env: { ...process.env, REPORTS2_SMOKE_DIR: dir, ELECTRON_DISABLE_SANDBOX: '1' }
    })
    if (result.status !== 0) process.exit(result.status || 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const MAIN = String.raw`
const { app, BrowserWindow, session } = require('electron')
const http = require('node:http')
const { join } = require('node:path')
const assert = require('node:assert/strict')

const state = { logins: [], tokens: new Set(), logouts: [] }
const LINKS = '<a id="campaign" href="/campaigns?campaign=12">cd</a> <a id="reports" href="/reports?tab=accounts">bc</a>'
  + ' <a id="data" href="/data">sdt</a> <a id="new" href="/campaigns/new?account=3">moi</a>'
  + ' <a id="inside" href="/reports-2?channel=sms">sms</a>'
const page = title => '<!doctype html><meta charset="utf-8"><title>' + title + '</title><body><div id="out">...</div>' + LINKS
  + '<script>fetch("/api/aka-agent/control/v1/me",{credentials:"same-origin"}).then(r=>r.status===401?(document.getElementById("out").textContent="expired"):r.json().then(b=>{document.getElementById("out").textContent="ok:"+b.data.id}))</script>'

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://x')
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    if (url.pathname === '/api/aka-agent/control/v1/auth/native/login' && request.method === 'POST') {
      const token = 'tok_' + 'c'.repeat(20) + (state.logins.length + 1)
      state.logins.push({ body: JSON.parse(body), agent: request.headers['user-agent'], desktop: request.headers['x-aka-desktop-accounts'] })
      state.tokens.add(token)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ status: 1, errorCode: 0, message: 'ok', data: { status: 'active', token, me: { id: 7, organization: { id: 9 } } } }))
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
      if (!cookie || !state.tokens.has(cookie[1])) { response.statusCode = 401; response.end('{"status":-1,"errorCode":401}'); return }
      response.end(JSON.stringify({ status: 1, errorCode: 0, message: 'ok', data: { id: 7, organization: { id: 9 } } }))
      return
    }
    if (url.pathname.startsWith('/reports-2') || url.pathname.startsWith('/automation')) {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(page(url.pathname))
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
const addWebview = (win, partition, src) => win.webContents.executeJavaScript('(()=>{const w=document.createElement("webview");w.setAttribute("partition",'
  + JSON.stringify(partition) + ');w.setAttribute("src",' + JSON.stringify(src) + ');w.style.width="600px";w.style.height="400px";document.body.appendChild(w)})()')

app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  process.env.AKA_AGENT_WEB_APP_URL = origin
  globalThis.__embedUser = { staffId: 7, organizationId: 9 }
  const { Reports2WebService } = require(join(process.env.REPORTS2_SMOKE_DIR, 'reports2WebService.cjs'))
  const { JourneyWebService } = require(join(process.env.REPORTS2_SMOKE_DIR, 'journeyWebService.cjs'))
  try {
    const win = new BrowserWindow({ show: false, width: 1300, height: 900, webPreferences: { webviewTag: true, nodeIntegration: true, contextIsolation: false } })
    await win.loadURL('data:text/html,<body><script>window.out={reports:[],journey:[]};const r=require("electron").ipcRenderer;'
      + 'r.on("reports2-web:navigate-out",(e,t)=>window.out.reports.push(t));r.on("journey-web:navigate-out",(e,t)=>window.out.journey.push(t))</script></body>')
    const reports = new Reports2WebService(win, 7, 9)
    const journey = new JourneyWebService(win, 7, 9)
    const guests = []
    win.webContents.on('did-attach-webview', (_e, contents) => guests.push(contents))
    const navOut = key => win.webContents.executeJavaScript('window.out.' + key)

    // 1. Mở menu Báo cáo 2: đăng nhập native riêng, phân vùng riêng, đúng địa chỉ trang Báo cáo 2 nhúng.
    const ready = await reports.prepare('light', null)
    assert.equal(ready.status, 'ready')
    assert.equal(ready.partition, 'persist:akaagent_web_reports2_9_7')
    assert.equal(ready.url, origin + '/reports-2?embed=desktop&theme=light')
    assert.equal(state.logins.length, 1)
    assert.deepEqual(state.logins[0].body, { username: 'staff7', password: 'pw-7' })
    assert.equal(state.logins[0].agent, 'akaAgent-Desktop/reports-2')
    assert.equal(state.logins[0].desktop, '1')
    const cookies = await session.fromPartition(ready.partition).cookies.get({ name: 'aka_agent_control_session' })
    assert.equal(cookies.length, 1)
    assert.equal(cookies[0].httpOnly, true)
    ok('mở Báo cáo 2: đăng nhập native, cookie httpOnly trong phân vùng riêng của Báo cáo 2')

    // 2. Chỉ webview /reports-2 + embed được gắn vào phân vùng Báo cáo 2; trang đọc /me bằng cookie.
    await addWebview(win, ready.partition, origin + '/automation?embed=desktop')
    await new Promise(resolve => setTimeout(resolve, 600))
    assert.equal(guests.length, 0, 'webview /automation trong phân vùng Báo cáo 2 phải bị chặn')
    await addWebview(win, ready.partition, ready.url)
    await wait(() => guests.length === 1, 'webview Báo cáo 2 gắn')
    const guest = guests[0]
    await wait(async () => (await guest.executeJavaScript('document.getElementById("out").textContent')) === 'ok:7', 'trang đọc /me')
    ok('chỉ gắn webview đúng trang Báo cáo 2; trang đọc /me bằng cookie phiên')

    // 3. Link ra ngoài: không rời trang, renderer nhận màn Desktop cần mở (kênh của Báo cáo 2, không phải Tự động hóa).
    const before = guest.getURL()
    for (const id of ['campaign', 'reports', 'data', 'new']) await guest.executeJavaScript('document.getElementById("' + id + '").click()')
    await wait(async () => (await navOut('reports')).length === 4, 'navigate-out Báo cáo 2')
    assert.deepEqual(await navOut('reports'), [
      { kind: 'campaign', campaignId: 12, edit: false }, { kind: 'reports', tab: 'accounts' }, { kind: 'dataScan' }, { kind: 'newCampaign' }
    ])
    assert.deepEqual(await navOut('journey'), [])
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(guest.getURL(), before)
    ok('link ra ngoài: chiến dịch, Báo cáo (đúng thẻ), Quét data, Thêm chiến dịch mở màn Desktop; trang không rời Báo cáo 2')

    // 4. Đường trong Báo cáo 2 đi bình thường (đổi kênh trên địa chỉ).
    await guest.executeJavaScript('document.getElementById("inside").click()')
    await wait(() => guest.getURL().includes('channel=sms'), 'đi tới /reports-2?channel=sms')
    ok('đường trong Báo cáo 2 đi bình thường')

    // 5. Tự động hóa mở cùng lúc: phiên, phân vùng, webview riêng; hai trang không lẫn link ra ngoài.
    const journeyReady = await journey.prepare('light', null)
    assert.equal(journeyReady.partition, 'persist:akaagent_web_9_7')
    assert.equal(state.logins.length, 2)
    assert.equal(state.logins[1].agent, 'akaAgent-Desktop/automation')
    await addWebview(win, journeyReady.partition, journeyReady.url)
    await wait(() => guests.length === 2, 'webview Tự động hóa gắn')
    const journeyGuest = guests[1]
    await wait(async () => (await journeyGuest.executeJavaScript('document.getElementById("out").textContent')) === 'ok:7', 'Tự động hóa đọc /me')
    await journeyGuest.executeJavaScript('document.getElementById("campaign").click()')
    await wait(async () => (await navOut('journey')).length === 1, 'navigate-out Tự động hóa')
    assert.deepEqual(await navOut('journey'), [{ kind: 'campaign', campaignId: 12, edit: false }])
    assert.equal((await navOut('reports')).length, 4)
    assert.ok(!guest.isDestroyed(), 'webview Báo cáo 2 vẫn còn khi Tự động hóa mở')
    ok('Tự động hóa và Báo cáo 2 cùng mở: phân vùng, phiên và kênh link ra ngoài riêng')

    // 6. Trang không tự đăng nhập được.
    const blocked = await guest.executeJavaScript('fetch("/api/aka-agent/control/v1/auth/native/login",{method:"POST",body:"{}"}).then(()=>"sent",()=>"blocked")')
    assert.equal(blocked, 'blocked')
    assert.equal(state.logins.length, 2)
    ok('trang Báo cáo 2 nhúng không gọi được đăng nhập (chỉ main đăng nhập)')

    // 7. Bản Web chưa có trang Báo cáo 2 tự chuyển (trong trang) sang trang khác: khung báo lỗi, không hiện nhầm trang.
    //    Chuyển tạm ra ngoài rồi quay về ngay (router đưa về trang đầu) thì không báo gì.
    const states = []
    const journeyStates = []
    const originalSend = win.webContents.send.bind(win.webContents)
    win.webContents.send = (channel, payload) => {
      if (channel === 'reports2-web:state') states.push(payload)
      if (channel === 'journey-web:state') journeyStates.push(payload)
      return originalSend(channel, payload)
    }
    await guest.executeJavaScript('history.pushState(null,"","/campaigns?campaign=1");history.replaceState(null,"","/reports-2")')
    await new Promise(resolve => setTimeout(resolve, 900))
    assert.equal(states.filter(item => item.status === 'error').length, 0)
    await journeyGuest.executeJavaScript('history.pushState(null,"","/automation/9")')
    await guest.executeJavaScript('history.pushState(null,"","/automation")')
    await wait(() => states.some(item => item.status === 'error'), 'báo lỗi khi trang dừng ngoài Báo cáo 2')
    assert.match(states.find(item => item.status === 'error').message, /Báo cáo 2 chưa có trên máy chủ/)
    await new Promise(resolve => setTimeout(resolve, 600))
    assert.equal(journeyStates.filter(item => item.status === 'error').length, 0, 'Tự động hóa không báo lỗi khi đi trong trang')
    win.webContents.send = originalSend
    ok('trang dừng ở đường ngoài Báo cáo 2: báo lỗi để thử lại; chuyển tạm rồi quay về thì không báo; Tự động hóa đi trong trang bình thường')

    // 8. Đăng xuất: dọn từng khung; dọn Báo cáo 2 không đụng cookie của Tự động hóa.
    await reports.dispose()
    assert.equal((await session.fromPartition(ready.partition).cookies.get({ name: 'aka_agent_control_session' })).length, 0)
    assert.equal((await session.fromPartition(journeyReady.partition).cookies.get({ name: 'aka_agent_control_session' })).length, 1)
    await journey.dispose()
    assert.equal((await session.fromPartition(journeyReady.partition).cookies.get({ name: 'aka_agent_control_session' })).length, 0)
    assert.equal(state.logouts.length, 2)
    assert.ok(state.logouts.every(value => /^Bearer tok_/.test(value)))
    ok('đăng xuất: mỗi khung xoá cookie phân vùng của mình và thu hồi phiên native của mình')
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
