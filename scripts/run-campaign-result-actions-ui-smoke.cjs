// UI smoke of the Desktop "Kết quả chạy" action filter and merged view: real CampaignPanel in Electron, isolated IPC,
// blocked HTTP. Run: node scripts/run-campaign-result-actions-ui-smoke.cjs   (Linux without display: xvfb-run -a node ...)
// Screenshots go to $RESULT_ACTIONS_SMOKE_SCREENSHOT_DIR (default: the OS temp dir).
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-result-actions-ui-'))
  const shots = process.env.RESULT_ACTIONS_SMOKE_SCREENSHOT_DIR || tmpdir()
  mkdirSync(shots, { recursive: true })
  let app
  let passed = 0
  const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }
  try {
    await build({ entryPoints: [join(__dirname, 'campaign-result-actions-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'error',
      plugins: [{ name: 'capture-excel', setup(build) {
        build.onResolve({ filter: /^xlsx$/ }, () => ({ path: 'xlsx', namespace: 'smoke' }))
        build.onLoad({ filter: /.*/, namespace: 'smoke' }, () => ({ contents: `
          export const read = () => ({});
          export const utils = { aoa_to_sheet: rows => rows, json_to_sheet: rows => rows,
            book_new: () => ({ sheets: [] }), book_append_sheet: (book, rows, name) => { book.sheets.push({ name, rows }) } };
          export const writeFile = (book, fileName) => window.resultSmoke.state.exports.push({ fileName, sheets: book.sheets });` }))
      } }] })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-result-actions-ui-smoke.css"><body><div id="root"></div><script src="campaign-result-actions-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: !!process.env.DISPLAY, width: 1600, height: 1300, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    const args = [...(process.getuid && process.getuid() === 0 ? ['--no-sandbox'] : []), join(directory, 'main.cjs')]
    app = await _electron.launch({ executablePath: require('electron'), args, cwd: resolve(__dirname, '..'), env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    await page.waitForFunction(() => !!window.resultSmoke)
    const calls = method => page.evaluate(name => window.resultSmoke.state.calls.filter(call => call.method === name).map(call => call.args[0]), method)
    const tab = name => page.locator('.detail-dock-tab').filter({ hasText: name })
    const filterButton = page.locator('.result-action-button')
    const option = name => page.locator('.result-action-option').filter({ hasText: name })
    // The whole detail dock in one image: let it grow for the capture only (like the report smoke), then restore the layout.
    // The window is shown when a display exists (xvfb): a hidden Electron window stops painting and captures time out.
    const shot = async name => {
      const style = await page.addStyleTag({ content: '.campaign-detail-dock{height:auto!important;flex-basis:auto!important;max-height:none!important}'
        + '.detail-dock-body,.detail-dock-tab-content{overflow:visible!important}' })
      const viewport = page.viewportSize()
      await page.waitForTimeout(150)
      let box = await page.locator('.campaign-detail-dock').boundingBox()
      if (box.y + box.height > viewport.height) {
        await page.setViewportSize({ width: viewport.width, height: Math.ceil(box.y + box.height + 16) })
        await page.waitForTimeout(200)
        box = await page.locator('.campaign-detail-dock').boundingBox()
      }
      await page.screenshot({ path: join(shots, name), clip: box, animations: 'disabled' })
      await style.evaluate(element => element.remove())
      await page.setViewportSize(viewport)
      await page.waitForTimeout(100)
    }

    // "Tất cả": exactly the old request (no actionCode key), no action list read.
    await page.getByText('Mời khách hội thảo', { exact: true }).first().click()
    await page.setViewportSize({ width: 1600, height: 1300 })
    await tab('Kết quả chạy').click()
    await page.waitForFunction(() => window.resultSmoke.state.calls.some(call => call.method === 'listCampaignDetailsPage'))
    const firstRead = (await calls('listCampaignDetailsPage')).at(-1)
    assert.equal('actionCode' in firstRead, false, 'Tất cả keeps the v2 request')
    assert.equal((await filterButton.innerText()).trim(), 'Tất cả')
    assert.deepEqual(await calls('campaignResultActions'), [], 'no action list read while on "Tất cả"')
    ok('Mở Kết quả chạy: bộ lọc Hành động đứng đầu, mặc định Tất cả, request cũ (không actionCode), không đọc danh sách hành động')

    // Opening the filter reads the action list once: Tất cả + total, actions with counts, "Chưa rõ hành động" last, Gộp.
    await filterButton.click()
    await page.locator('.result-action-list').waitFor()
    await option('Nhắn tin người lạ').waitFor()
    assert.deepEqual((await calls('campaignResultActions')).map(request => request.kind), ['actions'])
    const names = await page.locator('.result-action-option .result-action-title').allInnerTexts()
    assert.equal(names.at(-1).trim(), 'Gộp hành động vào một dòng')
    assert.equal(names.at(-2).trim(), 'Chưa rõ hành động')
    assert.equal((await option('Tất cả').locator('.result-action-count').innerText()).trim(), '67')
    assert.equal((await option('Nhắn tin người lạ').locator('.result-action-count').innerText()).trim(), '60')
    const popoverBox = await page.locator('.result-action-popover').boundingBox()
    await page.screenshot({ path: join(shots, 'desktop-result-action-filter-open.png'), animations: 'disabled',
      clip: { x: Math.max(0, popoverBox.x - 8), y: Math.max(0, popoverBox.y - 8), width: popoverBox.width + 16, height: popoverBox.height + 80 } })
    await page.keyboard.press('Escape')
    await filterButton.click()
    await page.locator('.result-action-list').waitFor()
    assert.equal((await calls('campaignResultActions')).length, 1, 'reopening does not read again')
    ok('Mở bảng chọn đọc danh sách hành động một lần: Tất cả 67 lượt, từng hành động kèm số lượt, "Chưa rõ hành động" cuối, mục Gộp')

    // One action: v3 request with actionCode, label, Excel name of the action.
    await option('Kết bạn').click()
    await page.waitForFunction(() => window.resultSmoke.state.calls.some(call => call.method === 'listCampaignDetailsPage' && call.args[0].actionCode === 'zalo_add_friend'))
    const actionRead = (await calls('listCampaignDetailsPage')).at(-1)
    assert.equal(actionRead.actionCode, 'zalo_add_friend')
    assert.equal(actionRead.offset, 0)
    assert.equal((await filterButton.innerText()).trim(), 'Kết bạn')
    await page.locator('.result-action-field.is-filtered').waitFor()
    ok('Chọn "Kết bạn": đọc trang kết quả với actionCode zalo_add_friend, nhãn bộ lọc đổi, ô lọc nổi bật')

    // v3 not ready (V540 not applied): the tab says so and offers "Xem tất cả".
    await page.evaluate(() => { window.resultSmoke.state.v3NotReady = true })
    await page.getByRole('button', { name: 'Tải lại' }).click()
    const alert = page.locator('.result-action-error[role="alert"]')
    await alert.filter({ hasText: 'Bộ lọc theo hành động đang được cập nhật' }).waitFor()
    await alert.getByRole('button', { name: 'Xem tất cả' }).click()
    await page.waitForFunction(() => !('actionCode' in window.resultSmoke.state.calls.filter(call => call.method === 'listCampaignDetailsPage').at(-1).args[0]))
    assert.equal((await filterButton.innerText()).trim(), 'Tất cả')
    await page.evaluate(() => { window.resultSmoke.state.v3NotReady = false })
    ok('DB/quyền chưa sẵn sàng: báo "đang được cập nhật" kèm nút Xem tất cả về đúng request cũ')

    // Merged view: one page read with the recipient sort, columns per action, truncated history, older results inline.
    const detailsBefore = (await calls('listCampaignDetailsPage')).length
    await filterButton.click()
    await option('Gộp hành động vào một dòng').click()
    await page.locator('.crm-table').waitFor()
    const pageRead = (await calls('campaignResultActions')).filter(request => request.kind === 'page').at(-1)
    assert.deepEqual(pageRead, { kind: 'page', campaignId: 102, query: { sort: 'processed_desc' }, page: 1, pageSize: 100 })
    assert.equal((await calls('listCampaignDetailsPage')).length, detailsBefore, 'merged mode does not read the per-result page')
    assert.equal((await filterButton.innerText()).trim(), 'Gộp hành động')
    await page.locator('.result-merge-hint').waitFor()
    const headers = await page.locator('.crm-table thead th .crm-col-name').allInnerTexts()
    assert.ok(headers.some(text => text.includes('Nhắn tin người lạ')) && headers.some(text => text.includes('Kết bạn')), headers.join('|'))
    assert.ok(headers.at(-1).includes('Chưa rõ hành động'), 'unknown action is the last column')
    assert.equal(await page.locator('.crm-table tbody tr').count(), 3)
    await page.locator('.crm-truncated', { hasText: '55 lượt · hiện 50 lượt mới nhất' }).waitFor()
    await shot('desktop-result-merged-table-dark.png')
    await page.evaluate(() => document.body.classList.add('theme-light'))
    await shot('desktop-result-merged-table-light.png')
    await page.evaluate(() => document.body.classList.remove('theme-light'))
    const toggle = page.locator('.crm-older-toggle').first()
    await toggle.click()
    await page.locator('.crm-older li').first().waitFor()
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
    await page.locator('.campaign-input-data-pager', { hasText: 'Hiển thị 1–3 / 6 data' }).waitFor()
    await shot('desktop-result-merged-older-open.png')
    ok('Gộp: một lượt đọc trang (processed_desc, 100/trang), không đọc trang kết quả; mỗi hành động một cột, "Chưa rõ" cuối, 55 lượt hiện 50, mở lượt trước tại chỗ')

    // Merged sort uses the four data sorts.
    // The tab content is scrolled down after expanding older results; scroll first: a scroll event closes open dropdowns.
    await page.locator('.campaign-data-sort > button').scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    await page.locator('.campaign-data-sort > button').click()
    await page.getByRole('menuitemradio', { name: 'Tạo cũ nhất' }).click()
    await page.waitForFunction(() => window.resultSmoke.state.calls.some(call => call.method === 'campaignResultActions' && call.args[0].kind === 'page' && call.args[0].query.sort === 'created_asc'))
    ok('Sắp xếp ở chế độ gộp theo data (Tạo cũ nhất → created_asc)')

    // Merged Excel: keys once, byKeys batches, two sheets, one row per recipient, file ket-qua-chay-102-gop.xlsx.
    await page.getByRole('button', { name: /Xuất Excel/ }).click()
    await page.waitForFunction(() => window.resultSmoke.state.exports.length === 1)
    const merged = await page.evaluate(() => window.resultSmoke.state.exports[0])
    assert.equal(merged.fileName, 'ket-qua-chay-102-gop.xlsx')
    assert.deepEqual(merged.sheets.map(sheet => sheet.name), ['Theo người nhận', 'Tất cả lượt'])
    assert.equal(merged.sheets[0].rows.length, 4, 'ids without a recipient (deleted meanwhile) are skipped')
    assert.deepEqual(merged.sheets[0].rows.map(row => row['Tên']), ['Em', 'Chi', 'Bình', 'An'])
    assert.ok(Object.keys(merged.sheets[0].rows[0]).some(key => key === 'Kết bạn - Trạng thái'))
    const exportReads = (await calls('campaignResultActions')).filter(request => request.kind === 'keys' || request.kind === 'byKeys')
    assert.deepEqual(exportReads.map(request => request.kind), ['keys', 'byKeys'])
    assert.deepEqual(exportReads[0].query, { sort: 'created_asc' })
    assert.deepEqual(exportReads[1].ids, [5, 3, 2, 1, 7, 4])
    ok('Xuất Excel gộp: một lượt lấy mã + lô byKeys, file ket-qua-chay-102-gop.xlsx hai sheet, mỗi data một hàng theo đúng thứ tự')

    // Narrow detail panel: cards instead of a table.
    // Desktop's detail dock spans the window width; cards only show on a very narrow window.
    await page.setViewportSize({ width: 600, height: 1300 })
    await page.locator('.crm-cards').waitFor()
    assert.equal(await page.locator('.crm-table').count(), 0)
    await shot('desktop-result-merged-cards-600.png')
    await page.setViewportSize({ width: 1600, height: 1300 })
    await page.locator('.crm-table').waitFor()
    ok('Khung hẹp dưới 640 px hiện thẻ, rộng lại hiện bảng')

    // Report chip: opens Kết quả chạy filtered on that action and status.
    await tab('Báo cáo').click()
    const chip = page.locator('.campaign-report-view .rpt-chip', { hasText: 'Không tồn tại' }).first()
    await chip.waitFor()
    const title = await chip.getAttribute('title')
    const actionName = /lọc hành động (.+?), trạng thái/.exec(title)[1]
    await chip.click()
    await page.waitForFunction(() => {
      const last = window.resultSmoke.state.calls.filter(call => call.method === 'listCampaignDetailsPage').at(-1)?.args[0]
      return last && last.status === 'không tồn tại' && typeof last.actionCode === 'string'
    })
    const chipRead = (await calls('listCampaignDetailsPage')).at(-1)
    assert.equal(chipRead.actionCode, 'zalo_find_phone_user')
    assert.equal(await tab('Kết quả chạy').evaluate(element => element.classList.contains('active')), true)
    assert.equal((await filterButton.innerText()).trim(), actionName)
    ok(`Chip "Không tồn tại" của ${actionName} ở tab Báo cáo mở Kết quả chạy lọc đúng hành động và trạng thái`)

    // Another campaign resets the filter; a DB without the readers keeps only "Tất cả" with a notice.
    await page.evaluate(() => { window.resultSmoke.state.notReady[103] = true })
    await page.getByText('Chiến dịch chờ cập nhật DB', { exact: true }).first().click()
    await tab('Kết quả chạy').click()
    assert.equal((await filterButton.innerText()).trim(), 'Tất cả')
    await filterButton.scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    await filterButton.click()
    await page.locator('.result-action-message', { hasText: 'Bộ lọc theo hành động đang được cập nhật' }).waitFor()
    assert.equal(await option('Gộp hành động vào một dòng').count(), 0)
    await page.keyboard.press('Escape')
    ok('Đổi chiến dịch về Tất cả; DB chưa có hàm thì bảng chọn chỉ còn Tất cả kèm dòng báo, không có mục Gộp')

    const errors = await page.evaluate(() => window.resultSmoke.state.errors)
    assert.deepEqual(errors, [])
    ok('Không lỗi renderer')
    console.log(`campaign result actions UI smoke: ${passed}/${passed} passed; screenshots in ${shots}`)
  } finally {
    if (app) await app.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
