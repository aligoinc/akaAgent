// Chạy smoke UI tab "Hành động". Mặc định dùng Electron như các smoke UI khác; đặt AKA_UI_SMOKE_CHROMIUM=<đường dẫn
// chrome> để chạy cùng bundle trong Chromium khi máy không có Electron. Ảnh chụp ở AKA_UI_SMOKE_SHOTS (mặc định tmp).
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const { _electron, chromium } = require('playwright')

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-account-actions-ui-'))
  const shots = process.env.AKA_UI_SMOKE_SHOTS || join(tmpdir(), 'akaagent-account-actions-ui')
  mkdirSync(shots, { recursive: true })
  let app, browser, page
  try {
    await build({ entryPoints: [join(__dirname, 'campaign-account-actions-ui-smoke.tsx')], outdir: dir, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
      target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(dir, 'index.html'), '<html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-account-actions-ui-smoke.css"><body><div id="root"></div><script src="campaign-account-actions-ui-smoke.js"></script></body></html>')
    if (process.env.AKA_UI_SMOKE_CHROMIUM) {
      browser = await chromium.launch({ executablePath: process.env.AKA_UI_SMOKE_CHROMIUM })
      page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
      await page.route(/^https?:/, route => route.abort())
      await page.goto(pathToFileURL(join(dir, 'index.html')).href)
    } else {
      writeFileSync(join(dir, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1600,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,c)=>c({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(join(dir, 'index.html'))})})`)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      app = await _electron.launch({ executablePath: require('electron'), args: [join(dir, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
      page = await app.firstWindow()
    }
    page.setDefaultTimeout(12000)
    await page.waitForFunction(() => !!window.actionsSmoke && !!window.pendingSmoke)
    const reads = () => page.evaluate(() => window.actionsSmoke.state.reads.slice())
    const tabs = page.locator('.detail-dock-tab')
    await page.locator('.campaign-table-row').filter({ has: page.getByText('Chiến dịch 91', { exact: true }) }).getByText('Chiến dịch 91', { exact: true }).click()
    await tabs.first().waitFor()
    assert.deepEqual((await tabs.allTextContents()).slice(0, 3), ['Thông tin', 'Tài khoản', 'Hành động'])
    assert.deepEqual(await reads(), [], 'no read before the tab opens')

    await page.evaluate(() => { window.actionsSmoke.state.defer = true })
    await tabs.filter({ hasText: /^Hành động/ }).click()
    await page.getByRole('status').filter({ hasText: 'Đang tải hành động của chiến dịch' }).waitFor()
    await page.evaluate(() => { window.actionsSmoke.state.defer = false; window.actionsSmoke.release() })
    const view = page.locator('.campaign-account-actions')
    const row = name => view.locator('tbody tr').filter({ hasText: name })
    await row('Nhắn tin người lạ').waitFor()
    assert.equal(await tabs.filter({ hasText: /^Hành động/ }).innerText(), 'Hành động (3)')
    assert.deepEqual(await reads(), [91])
    assert.deepEqual(await view.locator('thead th').allTextContents(), ['Hành động', 'Trạng thái', 'Giới hạn trong ngày', 'Giới hạn trong giờ',
      'Đã chạy trong ngày', 'Đã chạy trong giờ', 'Giờ mở lại', 'Thao tác'])
    const locked = await row('Nhắn tin người lạ').innerText()
    for (const text of ['Bị giới hạn', 'Còn 18 phút', 'Facebook tạm hạn chế nhắn tin cho người lạ', '20 tin nhắn', 'Theo nhóm Nhóm CSKH · chiến dịch cài 30',
      '6 tin nhắn / 65 phút', '12/20', '6/6', '10:17 10/11/2026']) assert(locked.includes(text), `locked row shows ${text}`)
    const full = await row('Kết bạn').innerText()
    for (const text of ['Đạt giới hạn ngày', '40 lời mời', 'Theo gói (tối đa 40) · chiến dịch cài 100', '5 lời mời / 60 phút', '40/40', '00:00 11/11/2026', 'Sang ngày mới'])
      assert(full.includes(text), `daily-full row shows ${text}`)
    const unlimited = await row('Like post').innerText()
    assert(unlimited.includes('Không giới hạn lượt') && unlimited.includes('Bình thường'))
    const notes = await view.locator('.campaign-account-actions-notes').innerText()
    for (const text of ['Nhóm CSKH', 'cắt theo gói', 'tiếp tục chạy các hành động còn lượt']) assert(notes.includes(text), `notes show ${text}`)
    assert.equal(await page.locator('.campaign-account-actions-heading span').innerText(), 'Tài khoản Tài khoản kiểm thử · Cập nhật lúc 10:00:00')

    // Kéo khung chi tiết cao lên để ảnh chụp thấy cả bảng (thao tác người dùng thật, không sửa DOM).
    const handle = await page.locator('.detail-dock-resize-handle').boundingBox()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2, Math.max(120, handle.y - 560), { steps: 10 })
    await page.mouse.up()
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.body.classList.toggle('theme-light', theme === 'light'), theme)
      for (const width of [850, 1600]) {
        await page.setViewportSize({ width, height: 1000 })
        assert.equal(await page.locator('.detail-dock-tab-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `dock content fits at ${theme}/${width}`)
        await page.locator('.campaign-detail-dock').screenshot({ path: join(shots, `${theme}-${width}.png`), animations: 'disabled' })
      }
    }

    await row('Nhắn tin người lạ').getByRole('button', { name: 'Chạy lại ngay' }).click()
    await page.waitForFunction(() => window.actionsSmoke.state.reads.length === 2)
    await view.locator('thead').filter({ hasNotText: 'Thao tác' }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.actionsSmoke.state.unlocks), [[41, 'fb_message_stranger']])
    assert((await row('Nhắn tin người lạ').innerText()).includes('Đạt giới hạn trong giờ'))

    await view.getByRole('button', { name: 'Làm mới' }).click()
    await page.waitForFunction(() => window.actionsSmoke.state.reads.length === 3)
    await page.evaluate(() => { window.actionsSmoke.state.fail = true })
    await view.getByRole('button', { name: 'Làm mới' }).click()
    const alert = view.getByRole('alert')
    await alert.waitFor()
    assert.equal((await alert.innerText()).split('\n')[0].trim(), 'Chưa tải được hành động của chiến dịch. Vui lòng thử lại.')
    assert.equal(await row('Kết bạn').count(), 1, 'keeps the last table on a failed refresh')
    await page.evaluate(() => { window.actionsSmoke.state.fail = false })
    await alert.getByRole('button', { name: 'Thử lại' }).click()
    await alert.waitFor({ state: 'detached' })

    await tabs.filter({ hasText: 'Thông tin' }).click()
    await page.locator('.campaign-table-row').getByText('Chiến dịch 92', { exact: true }).click()
    await page.locator('.detail-dock-tab.active').filter({ hasText: 'Thông tin' }).waitFor()
    const before = (await reads()).length
    assert.equal(await tabs.filter({ hasText: /^Hành động/ }).innerText(), 'Hành động', 'count belongs to the previous campaign')
    await tabs.filter({ hasText: /^Hành động/ }).click()
    await row('Like post').waitFor()
    assert.deepEqual((await reads()).slice(before), [92])
    assert.deepEqual(await page.evaluate(() => window.pendingSmoke.state.errors), [])
    console.log(`PASS campaign account actions UI: tab after Tài khoản, lazy single read, columns/sources/reopen, notes, unlock reload, refresh/error/retry, campaign switch, no overflow (${shots})`)
  } finally {
    await app?.close().catch(() => {})
    await browser?.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exit(1) })
