// UI smoke of the Desktop campaign detail "Báo cáo" tab: real CampaignPanel in Electron, isolated IPC, blocked HTTP.
// Run: node scripts/run-campaign-run-report-ui-smoke.cjs   (Linux without display: xvfb-run -a node ...)
// Screenshots go to $REPORT_SMOKE_SCREENSHOT_DIR (default: the OS temp dir).
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-run-report-ui-'))
  const shots = process.env.REPORT_SMOKE_SCREENSHOT_DIR || tmpdir()
  mkdirSync(shots, { recursive: true })
  let app
  let passed = 0
  const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }
  try {
    await build({ entryPoints: [join(__dirname, 'campaign-run-report-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning',
      plugins: [{ name: 'capture-excel', setup(build) {
        build.onResolve({ filter: /^xlsx$/ }, () => ({ path: 'xlsx', namespace: 'smoke' }))
        build.onLoad({ filter: /.*/, namespace: 'smoke' }, () => ({ contents: `
          export const read = () => ({});
          export const utils = { aoa_to_sheet: rows => rows, json_to_sheet: rows => rows,
            book_new: () => ({ sheets: [] }), book_append_sheet: (book, rows, name) => { book.sheets.push({ name, rows }) } };
          export const writeFile = (book, fileName) => window.reportSmoke.state.exports.push({ fileName, sheets: book.sheets });` }))
      } }] })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-run-report-ui-smoke.css"><body><div id="root"></div><script src="campaign-run-report-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 1600, height: 1300, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const args = [...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []), join(directory, 'main.cjs')]
    app = await _electron.launch({ executablePath: require('electron'), args, cwd: resolve(__dirname, '..'), env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    await page.waitForFunction(() => !!window.reportSmoke)
    const reportCalls = () => page.evaluate(() => window.reportSmoke.state.calls.filter(call => call.method === 'campaignRunReport').map(call => call.args[0].campaignId))
    const tab = name => page.locator('.detail-dock-tab').filter({ hasText: name })
    const view = page.locator('.campaign-report-view')
    const kpi = label => view.locator('.rpt-kpi').filter({ has: page.locator('.rpt-kpi-label', { hasText: label }) }).locator('.rpt-kpi-value')
    // Whole report in one image: let the detail dock grow for the capture only, then restore the layout.
    const shot = async name => {
      const style = await page.addStyleTag({ content: '.campaign-detail-dock{height:auto!important;flex-basis:auto!important;max-height:none!important}'
        + '.detail-dock-body,.detail-dock-tab-content{overflow:visible!important}' })
      const viewport = page.viewportSize()
      await page.waitForTimeout(150)
      let box = await view.boundingBox()
      // Hidden Electron windows cannot capture beyond the viewport: grow the window to fit the report, then restore.
      if (box.y + box.height > viewport.height) {
        await page.setViewportSize({ width: viewport.width, height: Math.ceil(box.y + box.height + 16) })
        await page.waitForTimeout(200)
        box = await view.boundingBox()
      }
      await page.screenshot({ path: join(shots, name), clip: box, animations: 'disabled' })
      await style.evaluate(element => element.remove())
      await page.setViewportSize(viewport)
      await page.waitForTimeout(100)
    }

    // Open the Zalo campaign, then the report tab: one IPC read, KPI equal to the V487 numbers.
    await page.getByText('Mời khách hội thảo', { exact: true }).first().click()
    await page.setViewportSize({ width: 1600, height: 1300 })
    assert.deepEqual(await reportCalls(), [], 'no report read before the tab opens')
    await tab('Báo cáo').click()
    await view.locator('.rpt-kpis .rpt-kpi').first().waitFor()
    assert.equal(await kpi('Tổng data').innerText(), '1.086')
    assert.equal((await kpi('Hoàn thành').innerText()).replace(/\s+/g, ' '), '393 / 1.086')
    assert.equal((await kpi('Lượt hành động').innerText()).replace(/\s+/g, ' '), '1.115 lượt')
    assert.deepEqual(await reportCalls(), [102])
    ok('Mở tab Báo cáo: một lượt IPC, KPI khớp số V487 (1.086 data, 393 hoàn thành, 1.115 lượt)')
    for (const title of ['Data theo trạng thái', 'Trạng thái theo hành động', 'Kết quả theo thời gian']) {
      await view.getByRole('heading', { name: title }).waitFor()
    }
    for (const action of ['Tìm SĐT', 'Nhắn tin người lạ', 'Kết bạn', 'Gắn tag Zalo', 'Đổi tên Zalo']) {
      assert.ok(await view.locator('.rpt-action-name strong', { hasText: action }).count() >= 1, action)
    }
    ok('Đủ khối: data theo trạng thái, theo hành động (Tìm SĐT/Nhắn tin/Kết bạn/Gắn tag/Đổi tên), theo thời gian')
    await shot('desktop-report-dark-1600.png')

    // Leaving and returning to the tab keeps the numbers (no second read); Làm mới reads again.
    await tab('Thông tin').click()
    assert.equal(await view.isHidden(), true, 'the kept report is hidden behind other tabs')
    await tab('Báo cáo').click()
    await view.locator('.rpt-kpis').waitFor()
    assert.deepEqual(await reportCalls(), [102])
    await view.getByRole('button', { name: 'Làm mới' }).first().click()
    await page.waitForFunction(() => window.reportSmoke.state.calls.filter(call => call.method === 'campaignRunReport').length === 2)
    await view.locator('.rpt-kpis').waitFor()
    ok('Chuyển tab rồi quay lại không đọc lại; Làm mới đọc thêm đúng một lượt')

    // Table views and Excel (4 sheets) from the data on screen.
    await view.locator('.rpt-actions').getByRole('button', { name: 'Xem dạng bảng' }).click()
    await view.locator('.rpt-action-table').waitFor()
    assert.ok(await view.locator('.rpt-action-table tbody tr').count() >= 6)
    await view.getByRole('button', { name: 'Xuất Excel' }).click()
    await page.waitForFunction(() => window.reportSmoke.state.exports.length === 1)
    const exported = await page.evaluate(() => window.reportSmoke.state.exports[0])
    assert.equal(exported.fileName, 'bao-cao-chien-dich-102.xlsx')
    assert.deepEqual(exported.sheets.map(sheet => sheet.name), ['Tổng quan', 'Data theo trạng thái', 'Theo hành động', 'Theo thời gian'])
    ok('Dạng bảng theo hành động và Xuất Excel 4 sheet')
    await view.locator('.rpt-actions').getByRole('button', { name: 'Xem biểu đồ' }).click()

    // Drill-down: a data status opens Data ban đầu filtered; a status chip opens Kết quả chạy filtered.
    await view.getByRole('button', { name: /^Chờ xử lý: 692 data/ }).click()
    await page.waitForFunction(() => window.reportSmoke.state.calls.some(call => call.method === 'listCampaignInputDataPage' && call.args[0]?.status === 'chờ xử lý'))
    assert.equal(await tab('Data ban đầu').evaluate(element => element.classList.contains('active')), true)
    await tab('Báo cáo').click()
    await view.locator('.rpt-chip', { hasText: 'Không tồn tại' }).first().click()
    await page.waitForFunction(() => window.reportSmoke.state.calls.some(call => call.method === 'listCampaignDetailsPage' && call.args[0]?.status === 'không tồn tại'))
    assert.equal(await tab('Kết quả chạy').evaluate(element => element.classList.contains('active')), true)
    assert.deepEqual(await reportCalls(), [102, 102], 'drill-down does not read the report again')
    ok('Bấm số mở Data ban đầu lọc "chờ xử lý" và Kết quả chạy lọc "không tồn tại"')

    // Light theme and a narrow detail panel.
    await tab('Báo cáo').click()
    await page.evaluate(() => document.body.classList.add('theme-light'))
    await shot('desktop-report-light-1600.png')
    await page.setViewportSize({ width: 980, height: 1300 })
    await page.waitForTimeout(200)
    const overflow = await view.evaluate(element => element.scrollWidth - element.clientWidth)
    assert.ok(overflow <= 1, `report must not scroll horizontally (overflow ${overflow})`)
    await shot('desktop-report-light-980.png')
    await page.evaluate(() => document.body.classList.remove('theme-light'))
    await page.setViewportSize({ width: 1600, height: 1300 })
    ok('Giao diện sáng/tối và khung hẹp 980 px không tràn ngang')

    // Another campaign: Facebook group post reads its own report; a DB without V487/V489 shows the update notice.
    // Desktop opens "Thông tin" when another campaign row is clicked; the report tab is reopened explicitly.
    await page.getByText('Đăng bài nhóm bất động sản', { exact: true }).first().click()
    await tab('Báo cáo').click()
    await view.locator('.rpt-kpis').waitFor()
    await page.waitForFunction(() => window.reportSmoke.state.calls.filter(call => call.method === 'campaignRunReport').map(call => call.args[0].campaignId).includes(101))
    assert.equal(await kpi('Tổng data').innerText(), '435')
    await page.getByText('Chiến dịch chờ cập nhật DB', { exact: true }).first().click()
    await tab('Báo cáo').click()
    await view.getByRole('alert').filter({ hasText: 'Báo cáo đang được cập nhật' }).waitFor()
    await view.getByRole('button', { name: 'Thử lại' }).waitFor()
    ok('Đổi chiến dịch đọc báo cáo của chiến dịch đó; DB chưa sẵn sàng hiện "đang được cập nhật" kèm Thử lại')

    // A slow read shows the loading hint; a late answer of the previous campaign is dropped.
    await page.evaluate(() => { window.reportSmoke.state.hold = 102 })
    await page.getByText('Mời khách hội thảo', { exact: true }).first().click()
    await tab('Báo cáo').click()
    await view.getByText(/Đang tổng hợp số liệu/).waitFor()
    await page.getByText('Đăng bài nhóm bất động sản', { exact: true }).first().click()
    await tab('Báo cáo').click()
    await view.locator('.rpt-kpis').waitFor()
    await page.evaluate(() => { window.reportSmoke.state.hold = null; window.reportSmoke.state.release() })
    await page.waitForTimeout(200)
    assert.equal(await kpi('Tổng data').innerText(), '435', 'late Zalo answer must not replace the Facebook report')
    ok('Đang tải hiện gợi ý; kết quả muộn của chiến dịch trước bị bỏ')

    // Row menu "Xem báo cáo chi tiết" opens the report tab (as on Web) and reads fresh numbers.
    const readsBefore = (await reportCalls()).length
    await page.getByTitle('Mở hành động').first().click()
    await page.getByRole('menuitem', { name: 'Xem báo cáo chi tiết' }).click()
    await page.waitForFunction(count => window.reportSmoke.state.calls.filter(call => call.method === 'campaignRunReport').length === count + 1, readsBefore)
    await view.locator('.rpt-kpis').waitFor()
    assert.equal(await tab('Báo cáo').evaluate(element => element.classList.contains('active')), true)
    assert.equal((await reportCalls()).at(-1), 102)
    assert.equal(await kpi('Tổng data').innerText(), '1.086')
    ok('Menu dòng "Xem báo cáo chi tiết" mở tab Báo cáo và đọc số mới')

    const errors = await page.evaluate(() => window.reportSmoke.state.errors)
    assert.deepEqual(errors, [])
    ok('Không lỗi renderer')
    console.log(`campaign run report UI smoke: ${passed}/${passed} passed; screenshots in ${shots}`)
  } finally {
    if (app) await app.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
