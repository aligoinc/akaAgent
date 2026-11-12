// Chạy smoke UI tab "Hành động" (dạng thẻ) và cột "Giới hạn lượt" của danh sách chiến dịch (12/11/2026). Mặc định dùng
// Electron như các smoke UI khác; đặt AKA_UI_SMOKE_CHROMIUM=<đường dẫn chrome> để chạy cùng bundle trong Chromium khi máy
// không có Electron. Ảnh chụp ở AKA_UI_SMOKE_SHOTS (mặc định tmp).
// Container cloud: AKA_UI_SMOKE_SHOW=1 ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-campaign-account-actions-ui-smoke.cjs
// (cửa sổ ẩn không vẽ khung hình nên ảnh chụp treo; AKA_UI_SMOKE_SHOW=1 hiện cửa sổ trong màn hình ảo của xvfb).
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
      writeFileSync(join(dir, 'main.cjs'), `const{app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({show:${process.env.AKA_UI_SMOKE_SHOW === '1'},width:1600,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,c)=>c({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(join(dir, 'index.html'))})})`)
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      app = await _electron.launch({ executablePath: require('electron'), args: [join(dir, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
      page = await app.firstWindow()
    }
    page.setDefaultTimeout(12000)
    await page.waitForFunction(() => !!window.actionsSmoke && !!window.pendingSmoke)
    const reads = () => page.evaluate(() => window.actionsSmoke.state.reads.slice())
    const progressReads = () => page.evaluate(() => window.actionsSmoke.state.progressReads.map(ids => ids.slice().sort((a, b) => a - b).join(',')))
    // Ảnh chụp theo vùng của trang: locator.screenshot treo ở cửa sổ ẩn trong container (CLAUDE.md).
    const shot = async (selector, name) => {
      const box = await page.locator(selector).first().boundingBox()
      await page.screenshot({ path: join(shots, name), clip: box, animations: 'disabled' })
    }
    await page.evaluate(() => window.pendingSmoke.patch(91, { inputDataTotalCount: 100, inputDataCompletedCount: 20 }))

    // --- Danh sách: cột "Giới hạn lượt" sau Trạng thái, bỏ cột "Ngày update" (thành dòng trong cột Trạng thái) ---
    const header = page.locator('.campaign-table-header .campaign-col')
    await header.first().waitFor()
    // textContent (không theo text-transform): tiêu đề và dòng chú thích nhỏ dính liền.
    const headers = (await header.allTextContents()).map(text => text.replace(/\s+/g, ' ').trim())
    assert.deepEqual(headers, ['Chiến dịch', 'Dừng/Chạy', 'Trạng thái', 'Giới hạn lượthôm nay · trong giờ', 'Hành động', 'Tài khoản', 'Nhóm data', 'Ngày gửi'])
    const listRow = id => page.locator('.campaign-table-row').filter({ has: page.getByText(`Chiến dịch ${id}`, { exact: true }) })
    await listRow(91).locator('.campaign-limit-row').first().waitFor()
    assert.deepEqual(await progressReads(), ['91,92,93,94'], 'one read for the visible page')
    assert.match(await listRow(91).locator('.col-progress').innerText(), /Cập nhật \d{2}:\d{2}/)
    const cell91 = await listRow(91).locator('.col-limits').innerText()
    for (const text of ['Nhắn tin', '12/20', 'Tạm khóa · mở lại 10:18', 'Kết bạn', '40/40', 'Đủ lượt hôm nay · lượt mới từ 00:00 11/11'])
      assert(cell91.includes(text), `list cell shows ${text}`)
    const cell92 = await listRow(92).locator('.col-limits').innerText()
    assert(cell92.includes('6/6') && cell92.includes('Nghỉ theo giờ · chạy tiếp khoảng 10:05'), `hour-full cell: ${cell92}`)
    assert.equal(await listRow(94).locator('.campaign-limit-cell.is-muted').count(), 1, 'paused campaign is muted')
    assert((await listRow(94).locator('.col-limits').innerText()).includes('Tạm khóa'), 'locks stay visible on paused campaigns')
    assert.match(await listRow(91).locator('.campaign-limit-row').first().getAttribute('title'), /Lượt tính theo tài khoản: hôm nay tài khoản này còn chạy 1 chiến dịch khác/)
    for (const width of [1600, 1280]) {
      await page.setViewportSize({ width, height: 1000 })
      await shot('.campaign-table', `list-${width}.png`)
    }
    await page.setViewportSize({ width: 1600, height: 1000 })

    // --- Bấm ô mở tab "Hành động" của đúng chiến dịch; không có lượt đọc danh sách mới ---
    const tabs = page.locator('.detail-dock-tab')
    await page.evaluate(() => { window.actionsSmoke.state.defer = true })
    await listRow(91).locator('.campaign-limit-cell').click()
    await page.getByRole('status').filter({ hasText: 'Đang tải hành động của chiến dịch' }).waitFor()
    assert.equal(await page.locator('.detail-dock-tab.active').innerText(), 'Hành động')
    await page.evaluate(() => { window.actionsSmoke.state.defer = false; window.actionsSmoke.release() })
    const view = page.locator('.campaign-actions-view')
    const card = name => view.locator('.campaign-actions-card').filter({ has: page.locator('.campaign-actions-name', { hasText: name }) })
    await card('Nhắn tin người lạ').waitFor()
    assert.equal(await tabs.filter({ hasText: /^Hành động/ }).innerText(), 'Hành động (3)')
    assert.deepEqual(await reads(), [91])
    assert.deepEqual(await progressReads(), ['91,92,93,94'], 'selecting a row on the page does not reread the list')

    const banner = await view.locator('.campaign-actions-banner').innerText()
    assert(banner.includes('Chạy tiếp sớm nhất khoảng 10:18'), banner)
    assert(banner.includes('Nhắn tin người lạ đang bị khóa: Facebook tạm hạn chế nhắn tin cho người lạ'), banner)
    assert(banner.includes('các hành động đó cũng đang bị chặn'), banner)
    assert.equal(await view.locator('.campaign-actions-banner.is-lock').count(), 1)
    const locked = await card('Nhắn tin người lạ').innerText()
    for (const text of ['Bị giới hạn', 'Mở lại 10:18', 'Facebook tạm hạn chế nhắn tin cho người lạ', 'Khóa từ 09:51', 'Lượt gần nhất 09:50', 'Chạy lại ngay',
      '12/20 tin nhắn', 'Còn 8 tin nhắn · Theo nhóm Nhóm CSKH · chiến dịch cài 30', 'TRONG GIỜ (65 PHÚT)', '6/6 tin nhắn', 'Giờ từng lượt rời khung:',
      'Thành công 9', 'Thất bại 3', 'Lỗi 2', '2 lượt không tính vào giới hạn', 'Lượt tính giới hạn: chiến dịch này 8 · “Chiến dịch tháng 11” 4'])
      assert(locked.includes(text), `locked card shows ${text}`)
    assert.deepEqual(await card('Nhắn tin người lạ').locator('.campaign-actions-slots i').allInnerTexts(), ['10:05', '10:15', '10:25', '10:35', '10:45', '10:55'])
    assert.equal(await card('Nhắn tin người lạ').locator('.campaign-actions-slots i.is-next').innerText(), '10:05')
    const full = await card('Kết bạn').innerText()
    for (const text of ['Đủ lượt hôm nay', 'Lượt mới từ 00:00 11/11', '40/40 lời mời', 'Đã đủ lượt hôm nay · Theo gói (tối đa 40) · chiến dịch cài 100',
      '1/5 lời mời', 'Còn 4 lời mời · lượt cũ nhất rời khung 10:30', 'Chưa có kết quả hôm nay'])
      assert(full.includes(text), `daily-full card shows ${text}`)
    const unlimited = await card('Like post').innerText()
    for (const text of ['Bình thường', '7 like', 'Không giới hạn lượt', 'Không giới hạn theo giờ', '7 lượt không tính vào giới hạn'])
      assert(unlimited.includes(text), `unlimited card shows ${text}`)
    const notes = await view.locator('.campaign-actions-notes').innerText()
    for (const text of ['Nhóm CSKH', 'tối đa 40 lượt/ngày', 'tiếp tục chạy các hành động còn lượt']) assert(notes.includes(text), `notes show ${text}`)
    const management = await view.locator('.campaign-actions-management').innerText()
    for (const text of ['Nghỉ giữa 2 lần', '120 giây', '11:30 · hằng ngày', '18:00', 'Tiếp tục hành động còn lượt', 'Dự kiến', 'Data còn chờ', '80',
      'tối đa 0 tin nhắn', 'khoảng 4 ngày gửi, theo 20 tin nhắn/ngày của Nhắn tin người lạ · xong khoảng 14/11',
      'Nhóm Nhóm CSKH · gói tối đa 40 lượt/ngày', 'Hôm nay dùng chung lượt với “Chiến dịch tháng 11” (4)'])
      assert(management.includes(text), `management shows ${text}`)
    assert.equal(await page.locator('.campaign-actions-heading span').innerText(), 'Tài khoản Tài khoản kiểm thử · Cập nhật lúc 10:00')
    assert.equal(await view.getByRole('button', { name: 'Sửa giới hạn' }).count(), 1, 'quick edit of limits for editable campaigns')

    // Kéo khung chi tiết cao lên để ảnh chụp thấy cả thẻ (thao tác người dùng thật, không sửa DOM).
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
        await shot('.campaign-detail-dock', `tab-${theme}-${width}.png`)
      }
    }
    await page.setViewportSize({ width: 1600, height: 1000 })

    // --- Chạy lại ngay: mở khóa, tab đọc lại, cột danh sách đọc lại ngay (không chờ 60 giây) ---
    await card('Nhắn tin người lạ').getByRole('button', { name: 'Chạy lại ngay' }).click()
    await page.waitForFunction(() => window.actionsSmoke.state.reads.length === 2)
    await page.waitForFunction(() => window.actionsSmoke.state.progressReads.length === 2)
    assert.deepEqual(await page.evaluate(() => window.actionsSmoke.state.unlocks), [[41, 'fb_message_stranger']])
    await card('Nhắn tin người lạ').locator('.campaign-actions-status.is-window').waitFor()
    const waiting = await card('Nhắn tin người lạ').innerText()
    assert(waiting.includes('Nghỉ theo giờ') && waiting.includes('Chạy tiếp khoảng 10:05') && !waiting.includes('Chạy lại ngay'), waiting)
    assert((await view.locator('.campaign-actions-banner').innerText()).includes('Chạy tiếp sớm nhất khoảng 10:05'))
    await page.waitForFunction(() => !document.querySelector('.campaign-table-row .col-limits')?.innerText.includes('Tạm khóa'))
    assert((await listRow(91).locator('.col-limits').innerText()).includes('Nghỉ theo giờ · chạy tiếp khoảng 10:05'))

    // --- Làm mới tab / lỗi / thử lại: giữ thẻ cũ khi lỗi ---
    await view.getByRole('button', { name: 'Làm mới' }).click()
    await page.waitForFunction(() => window.actionsSmoke.state.reads.length === 3)
    await page.evaluate(() => { window.actionsSmoke.state.fail = true })
    await view.getByRole('button', { name: 'Làm mới' }).click()
    const alert = view.getByRole('alert')
    await alert.waitFor()
    assert.equal((await alert.innerText()).split('\n')[0].trim(), 'Chưa tải được hành động của chiến dịch. Vui lòng thử lại.')
    assert.equal(await card('Kết bạn').count(), 1, 'keeps the last cards on a failed refresh')
    await page.evaluate(() => { window.actionsSmoke.state.fail = false })
    await alert.getByRole('button', { name: 'Thử lại' }).click()
    await alert.waitFor({ state: 'detached' })
    assert.equal((await progressReads()).length, 2, 'tab refresh does not reread the list column')

    // --- Đổi chiến dịch: số hành động thuộc chiến dịch trước; tab tải lại đúng chiến dịch mới ---
    await tabs.filter({ hasText: 'Thông tin' }).click()
    await page.locator('.campaign-table-row').getByText('Chiến dịch 92', { exact: true }).click()
    await page.locator('.detail-dock-tab.active').filter({ hasText: 'Thông tin' }).waitFor()
    const before = (await reads()).length
    assert.equal(await tabs.filter({ hasText: /^Hành động/ }).innerText(), 'Hành động', 'count belongs to the previous campaign')
    await tabs.filter({ hasText: /^Hành động/ }).click()
    await card('Like post').waitFor()
    assert.deepEqual((await reads()).slice(before), [92])

    // --- DB chưa có V502: cột trống, không lỗi; nút Làm mới danh sách đọc lại ngay ---
    await page.evaluate(() => { window.actionsSmoke.state.progressReady = false })
    await page.locator('button[title="Làm mới"]').first().click()
    await page.waitForFunction(() => window.actionsSmoke.state.progressReads.length === 3)
    await page.waitForFunction(() => document.querySelectorAll('.campaign-table-row .campaign-limit-row').length === 0)
    assert.equal(await listRow(91).locator('.col-limits.is-empty').count(), 1)
    assert.deepEqual(await page.evaluate(() => window.pendingSmoke.state.errors), [])
    console.log(`PASS campaign limit column + actions cards UI: column order, list cell states (lock/day/hour/paused), one read per page, cell opens tab, banner/resume, cards (today/hour/results/slots), management/estimate, unlock rereads both, refresh/error/retry, campaign switch, no-V502 empty column, no overflow (${shots})`)
  } finally {
    await app?.close().catch(() => {})
    await browser?.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exit(1) })
