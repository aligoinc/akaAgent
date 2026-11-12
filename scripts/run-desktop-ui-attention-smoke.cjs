// Phần tiến trình chính của "có ai đang nhìn không" (src/main/services/desktopUiAttention.ts) chạy trong Electron
// thật với một cửa sổ đặt backgroundThrottling=false như cửa sổ chính của app (docs/DESKTOP_UI_IDLE_READS.md).
// Kiểm: trang web trong cửa sổ KHÔNG tự biết mình bị ẩn (lý do phải hỏi tiến trình chính), còn lệnh hỏi thì biết;
// ẩn/hiện có tín hiệu báo ngay. Không DB, không mạng.
// Chạy: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-desktop-ui-attention-smoke.cjs
// Thu nhỏ cần trình quản lý cửa sổ; trên Linux/xvfb chạy kèm một cái, ví dụ:
//   ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a sh -c 'openbox & sleep 2; node scripts/run-desktop-ui-attention-smoke.cjs'
// Giới hạn: khóa màn hình và số giây không thao tác thật chỉ thử được trên Windows/macOS có người dùng.
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-ui-attention-'))
  let app
  try {
    await build({ entryPoints: [resolve(__dirname, '../src/main/services/desktopUiAttention.ts')], outfile: join(directory, 'attention.cjs'),
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'warning' })
    await build({ entryPoints: [resolve(__dirname, '../src/shared/desktopUiReads.ts')], outfile: join(directory, 'shared.cjs'),
      bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
    writeFileSync(join(directory, 'preload.cjs'), `const { contextBridge, ipcRenderer } = require('electron')
      const { DESKTOP_UI_IPC } = require(${JSON.stringify(join(directory, 'shared.cjs'))})
      contextBridge.exposeInMainWorld('attention', {
        ask: () => ipcRenderer.invoke(DESKTOP_UI_IPC.attention),
        onChanged: callback => { ipcRenderer.on(DESKTOP_UI_IPC.attentionChanged, () => callback()) }
      })`)
    writeFileSync(join(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><body><script>
      window.signals = 0
      window.attention.onChanged(() => { window.signals += 1 })
    </script></body>`)
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow, ipcMain } = require('electron')
      const { readDesktopUiAttention, watchDesktopUiAttention } = require(${JSON.stringify(join(directory, 'attention.cjs'))})
      const { DESKTOP_UI_IPC } = require(${JSON.stringify(join(directory, 'shared.cjs'))})
      app.whenReady().then(() => {
        const win = new BrowserWindow({ show: true, width: 900, height: 600, webPreferences: {
          preload: ${JSON.stringify(join(directory, 'preload.cjs'))}, sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
        global.smokeWindow = win
        global.readAttention = window => readDesktopUiAttention(window)
        ipcMain.handle(DESKTOP_UI_IPC.attention, () => readDesktopUiAttention(win))
        watchDesktopUiAttention(win)
        win.loadFile(${JSON.stringify(join(directory, 'index.html'))})
      })`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    const ask = () => page.evaluate(() => window.attention.ask())
    const signals = () => page.evaluate(() => window.signals)
    const visibility = () => page.evaluate(() => document.visibilityState)
    const windowCall = method => app.evaluate((_, method) => { global.smokeWindow[method]() }, method)
    const windowState = () => app.evaluate(() => ({ visible: global.smokeWindow.isVisible(), minimized: global.smokeWindow.isMinimized() }))

    let state = await ask()
    assert.equal(state.hidden, false, 'cửa sổ đang hiện')
    assert.ok(Number.isInteger(state.idleSeconds) && state.idleSeconds >= 0, 'số giây không thao tác là số nguyên không âm')
    assert.deepEqual(Object.keys(state).sort(), ['hidden', 'idleSeconds'], 'chỉ trả hai trường, không kèm dữ liệu khác')
    assert.equal(await visibility(), 'visible')
    console.log('PASS cửa sổ đang hiện: lệnh hỏi trả "có người nhìn" và số giây không thao tác hợp lệ')

    const before = await signals()
    await windowCall('hide')
    await page.waitForFunction(count => window.signals > count, before)
    assert.deepEqual(await windowState(), { visible: false, minimized: false })
    assert.equal((await ask()).hidden, true, 'ẩn cửa sổ: lệnh hỏi báo đang ẩn')
    const hiddenVisibility = await visibility()
    console.log(`     trang trong cửa sổ đang ẩn tự thấy visibilityState = "${hiddenVisibility}" (backgroundThrottling=false)`)
    assert.equal(hiddenVisibility, 'visible', 'trang không tự biết mình bị ẩn: đây là lý do phải hỏi tiến trình chính')
    console.log('PASS ẩn cửa sổ: có tín hiệu ngay, lệnh hỏi báo đang ẩn trong khi trang vẫn tưởng mình đang hiện')

    const hiddenSignals = await signals()
    await windowCall('show')
    await page.waitForFunction(count => window.signals > count, hiddenSignals)
    assert.equal((await ask()).hidden, false, 'hiện lại: lệnh hỏi báo đang hiện')
    console.log('PASS hiện lại: có tín hiệu ngay và lệnh hỏi báo đang hiện')

    // Thu nhỏ cần trình quản lý cửa sổ; xvfb thường không có. Thử và chỉ kết luận khi hệ điều hành thật sự thu nhỏ.
    const beforeMinimize = await signals()
    await windowCall('minimize')
    await page.waitForTimeout(500)
    const afterMinimize = await windowState()
    if (afterMinimize.minimized) {
      await page.waitForFunction(count => window.signals > count, beforeMinimize)
      assert.equal((await ask()).hidden, true, 'thu nhỏ: lệnh hỏi báo đang ẩn')
      console.log(`     trang trong cửa sổ đang thu nhỏ tự thấy visibilityState = "${await visibility()}"`)
      const minimizedSignals = await signals()
      await windowCall('restore')
      await page.waitForFunction(count => window.signals > count, minimizedSignals)
      assert.equal((await ask()).hidden, false, 'khôi phục: lệnh hỏi báo đang hiện')
      console.log('PASS thu nhỏ/khôi phục: có tín hiệu ngay và lệnh hỏi báo đúng')
    } else {
      console.log('SKIP thu nhỏ: môi trường này không thu nhỏ được cửa sổ (không có trình quản lý cửa sổ)')
    }

    // Mọi trường hợp không chắc đều rơi về "đang có người nhìn".
    const fallback = await app.evaluate(() => {
      const destroyed = { isDestroyed: () => true }
      const broken = { isDestroyed: () => false, isMinimized: () => { throw new Error('boom') }, isVisible: () => true }
      return [global.readAttention(null), global.readAttention(undefined), global.readAttention(destroyed), global.readAttention(broken)]
    })
    for (const value of fallback) assert.deepEqual(value, { hidden: false, idleSeconds: 0 })
    console.log('PASS không có cửa sổ, cửa sổ đã hủy hoặc lệnh của cửa sổ lỗi: coi như đang có người nhìn')
  } finally {
    if (app) await app.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })
