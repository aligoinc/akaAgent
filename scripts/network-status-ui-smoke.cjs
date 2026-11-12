// Real Electron UI of the Desktop network status bar (docs/NETWORK_STATUS_BAR_DESKTOP.md, port of Web #212) with a local IPC
// fixture; never connects to any service. Fake clock drives the 60-second countdown. Covers: hidden while online, main
// 'failed' signal → probe → bar under the title bar, countdown + shrinking line, recheck every 60 s, long-offline copy from
// the 3rd failed check, checking state, 'ok' from main, auto-hide, 15 s probe cooldown, browser offline/online events,
// remount while offline (login ↔ app), signal before mount, theme colours, retry hit area inside the bar.
// Run: node scripts/network-status-ui-smoke.cjs (as root in the cloud container: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node ...)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const { _electron } = require('playwright')

const harness = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import NetworkStatusBar from './src/renderer/src/components/NetworkStatusBar/NetworkStatusBar';
import './src/renderer/src/styles/global.css';
const state={probes:0,mode:'down',pending:[],listeners:new Set()};
window.electronAPI={
  probeNetwork:()=>{state.probes++;if(state.mode==='hang')return new Promise(resolve=>state.pending.push(resolve));return Promise.resolve(state.mode==='up')},
  onNetworkRequestSignal:callback=>{state.listeners.add(callback);return ()=>state.listeners.delete(callback)}
};
function App(){
  const [mounted,setMounted]=useState(true);
  const [layout,setLayout]=useState('app-layout app-layout-authenticated platform-win32');
  window.netSmoke={state,setMounted,setLayout,emit:signal=>state.listeners.forEach(callback=>callback(signal)),
    resolvePending:value=>{const list=state.pending;state.pending=[];list.forEach(resolve=>resolve(value))}};
  return <div className={layout}>
    <div className="app-window-drag-frame" aria-hidden="true"/>
    <main id="page" style={{padding:'14px 16px'}}>
      <h1 id="title" style={{margin:0,fontSize:15,textAlign:'center'}}>Chiến dịch</h1>
    </main>
    {mounted&&<NetworkStatusBar/>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
`

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-network-status-ui-'))
  let app
  try {
    await build({
      stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: harness }, outfile: path.join(dir, 'app.js'), bundle: true, platform: 'browser',
      format: 'iife', jsx: 'automatic', target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning',
      loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file' }
    })
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body><div id="root"></div><script src="app.js"></script></body></html>')
    fs.writeFileSync(path.join(dir, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,c)=>c({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir, 'index.html'))})})`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(dir, 'main.cjs')], cwd: process.cwd(), env })
    const page = await app.firstWindow(); page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()) })
    // The fake clock also freezes CSS animations: reduced motion removes the slide-in (and covers that CSS branch).
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.install({ time: new Date('2026-11-12T03:00:00Z') })
    await page.reload()
    await page.locator('#title').waitFor()
    // Freeze time: from here on it only moves with runFor, so countdown checks are exact.
    await page.clock.pauseAt(new Date('2026-11-12T03:01:00Z'))

    let passed = 0
    const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }
    const smoke = (fn, arg) => page.evaluate(fn, arg)
    const probes = () => smoke(() => window.netSmoke.state.probes)
    const setMode = mode => smoke(m => { window.netSmoke.state.mode = m }, mode)
    const emit = signal => smoke(s => window.netSmoke.emit(s), signal)
    const settle = () => page.clock.runFor(50)
    const bar = page.locator('.network-status-bar')
    const status = bar.locator('[role=status]')
    const countdown = bar.locator('.network-status-countdown')
    const retry = page.getByRole('button', { name: 'Kiểm tra ngay' })
    const line = bar.locator('.network-status-progress > span')
    const scale = async () => Number((await line.getAttribute('style')).match(/scaleX\(([\d.]+)\)/)[1])

    // 1. Online: nothing shown, nothing probed, main signals subscribed.
    await settle()
    assert.equal(await bar.count(), 0)
    assert.equal(await probes(), 0)
    assert.equal(await smoke(() => window.netSmoke.state.listeners.size), 1)
    ok('online: hidden, no probe, listening to main signals')

    // 2. Main reports a failed request, probe fails → bar under the title bar with a 60 s countdown.
    await emit('failed'); await settle()
    assert.equal(await probes(), 1)
    assert.equal(await status.innerText(), 'Mất kết nối mạng.')
    assert.equal(await countdown.innerText(), 'Kiểm tra lại sau 60 giây')
    const box = await bar.boundingBox()
    assert.equal(box.y, 72, 'Windows: hangs under the 36 px title area + 36 px tool bar, never over the Cập nhật/Đăng xuất buttons')
    assert.ok(Math.abs(box.height - 28) < 0.5)
    assert.ok(Math.abs(box.x + box.width / 2 - 640) < 1, 'centred in the window')
    const retryBox = await retry.boundingBox()
    assert.ok(retryBox.height >= 24)
    assert.ok(retryBox.y >= box.y - 0.5 && retryBox.y + retryBox.height <= box.y + box.height + 0.5, 'retry hit area stays inside the bar')
    assert.ok(await scale() > 0.999)
    assert.equal(await smoke(() => getComputedStyle(document.querySelector('.network-status-bar')).getPropertyValue('-webkit-app-region').trim()), 'no-drag')
    assert.equal(await smoke(() => getComputedStyle(document.querySelector('.network-status-bar')).animationName), 'none', 'reduced motion: no slide-in')
    await smoke(() => window.netSmoke.setLayout('app-layout app-layout-authenticated platform-darwin')); await settle()
    assert.equal((await bar.boundingBox()).y, 36, 'macOS: tool bar is the 36 px title bar')
    await smoke(() => window.netSmoke.setLayout('app-layout platform-win32')); await settle()
    assert.equal((await bar.boundingBox()).y, 36, 'login screen: only the 36 px title area')
    await smoke(() => window.netSmoke.setLayout('app-layout app-layout-authenticated platform-linux')); await settle()
    assert.equal((await bar.boundingBox()).y, 72)
    ok('main "failed" + failed probe → "Mất kết nối mạng.", 60 s countdown, 28 px bar under the app tool bar (72/36 px), retry inside the bar')

    // 3. Countdown and shrinking line.
    await page.clock.runFor(30_000)
    assert.equal(await countdown.innerText(), 'Kiểm tra lại sau 30 giây')
    assert.ok(Math.abs(await scale() - 0.5) < 0.02)
    ok('after 30 s: "30 giây", line at half length')

    // 4. Countdown ends → recheck → still down → counts again from 60.
    await page.clock.runFor(30_000); await settle()
    assert.equal(await probes(), 2)
    assert.equal(await status.innerText(), 'Mất kết nối mạng.')
    assert.equal(await countdown.innerText(), 'Kiểm tra lại sau 60 giây')
    ok('after 60 s: recheck, still offline, countdown restarts at 60')

    // 5. Third failed check → long-offline copy; a further main failure does not add probes.
    await page.clock.runFor(60_000); await settle()
    assert.equal(await probes(), 3)
    assert.equal(await status.innerText(), 'Vẫn chưa có mạng.\nHãy xem lại wifi hoặc dây mạng.')
    assert.equal(await countdown.innerText(), 'Kiểm tra lại sau 60 giây')
    assert.ok(Math.abs((await bar.boundingBox()).height - 28) < 0.5)
    await emit('failed'); await settle()
    assert.equal(await probes(), 3)
    ok('3rd failed check: "Vẫn chưa có mạng. Hãy xem lại wifi hoặc dây mạng.", still 28 px; extra failures while offline do not probe')

    // 6. Checking state: button and line hidden; a failed check keeps the long copy.
    await setMode('hang')
    await retry.click(); await settle()
    assert.equal(await probes(), 4)
    assert.equal(await countdown.innerText(), 'Đang kiểm tra lại…')
    assert.equal(await retry.count(), 0)
    assert.equal(await line.count(), 0)
    await smoke(() => window.netSmoke.resolvePending(false)); await settle()
    assert.equal(await countdown.innerText(), 'Kiểm tra lại sau 60 giây')
    assert.match(await status.innerText(), /^Vẫn chưa có mạng\./)
    ok('Kiểm tra ngay: "Đang kiểm tra lại…" without button/line; failed check → countdown again')

    // 7. A request answered (main "ok") → restored at once, hidden after 4 s.
    await emit('ok'); await settle()
    assert.equal(await probes(), 4)
    assert.equal(await status.innerText(), 'Đã có mạng trở lại.')
    await page.clock.runFor(3_900)
    assert.equal(await bar.count(), 1)
    await page.clock.runFor(200)
    assert.equal(await bar.count(), 0)
    ok('main "ok" → "Đã có mạng trở lại." without probing, hidden after 4 s')

    // 8. Failure while the server answers: no bar, probes limited to one per 15 s.
    await setMode('up')
    await emit('failed'); await settle()
    assert.equal(await probes(), 4, 'within 15 s of the confirmed restore: no probe')
    await page.clock.runFor(15_000)
    await emit('failed'); await settle()
    assert.equal(await probes(), 5)
    await page.clock.runFor(2_000)
    await emit('failed'); await settle()
    assert.equal(await probes(), 5)
    assert.equal(await bar.count(), 0)
    ok('server reachable: a failed request never shows the bar; at most one probe per 15 s')

    // 9. Browser offline / online events.
    await setMode('down')
    await smoke(() => window.dispatchEvent(new Event('offline'))); await settle()
    assert.equal(await probes(), 6)
    assert.equal(await status.innerText(), 'Mất kết nối mạng.')
    await setMode('up')
    await smoke(() => window.dispatchEvent(new Event('online'))); await settle()
    assert.equal(await probes(), 7)
    assert.equal(await status.innerText(), 'Đã có mạng trở lại.')
    await page.clock.runFor(4_100)
    assert.equal(await bar.count(), 0)
    ok('browser "offline" → probe → bar; "online" → probe right away → restored')

    // 10. Bar unmounted while offline (login ↔ app switch) → the next bar probes at once.
    await setMode('down')
    await page.clock.runFor(15_000)
    await emit('failed'); await settle()
    assert.equal(await probes(), 8)
    await smoke(() => window.netSmoke.setMounted(false)); await settle()
    assert.equal(await bar.count(), 0)
    await smoke(() => window.netSmoke.setMounted(true)); await settle()
    assert.equal(await probes(), 9)
    assert.equal(await status.innerText(), 'Mất kết nối mạng.')
    ok('remount while offline: probes at once and shows the bar again')

    // 11. Signal received while no bar is mounted → probe on mount; listener kept across remounts.
    await setMode('up')
    await smoke(() => window.dispatchEvent(new Event('online'))); await settle()
    await page.clock.runFor(4_100)
    await smoke(() => window.netSmoke.setMounted(false)); await settle()
    assert.equal(await smoke(() => window.netSmoke.state.listeners.size), 1)
    await setMode('down')
    await emit('failed'); await settle()
    const before = await probes()
    await smoke(() => window.netSmoke.setMounted(true)); await settle()
    assert.equal(await probes(), before + 1)
    assert.equal(await status.innerText(), 'Mất kết nối mạng.')
    ok('main failure while unmounted is remembered: probe right after mounting')

    // 12. Theme colours: dark by default, light with body.theme-light.
    const color = () => smoke(() => getComputedStyle(document.querySelector('.network-status-bar')).color)
    assert.equal(await color(), 'rgb(255, 170, 170)')
    await smoke(() => document.body.classList.add('theme-light'))
    assert.equal(await color(), 'rgb(186, 52, 52)')
    ok('colours: #FFAAAA on dark (default), #BA3434 on light')

    assert.deepEqual(errors, [])
    ok('no page errors')
    console.log(`\n${passed} passed`)
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })
