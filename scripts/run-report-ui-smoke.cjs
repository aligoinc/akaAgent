const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')
const xlsx = require('xlsx')

async function main() {
  const root = resolve(__dirname, '..'), directory = mkdtempSync(join(tmpdir(), 'aka-report-ui-'))
  const screenshots = process.env.REPORT_SCREENSHOTS || '/tmp/aka-report-ui-review'
  mkdirSync(screenshots, { recursive: true })
  let app
  try {
    await build({ entryPoints: [join(__dirname, 'report-ui-smoke.tsx')], outdir: directory, bundle: true,
      platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"' },
      loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="report-ui-smoke.css"><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style><body><div id="root"></div><script src="report-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); global.downloads=[]; app.whenReady().then(() => {
      const win = new BrowserWindow({show:false,width:1440,height:950,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      win.webContents.session.webRequest.onBeforeRequest((details, cb) => cb({cancel:/^https?:/.test(details.url)}));
      win.webContents.session.on('will-download', (_event, item) => { const path=require('node:path').join(${JSON.stringify(directory)},item.getFilename()); item.setSavePath(path); item.once('done',(_e,state)=>global.downloads.push({path,state})); });
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))}); });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: root, env })
    const page = await app.firstWindow(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(15000)
    await page.getByRole('button', { name: 'Facebook', exact: true }).click()
    await page.getByRole('button', { name: 'Zalo', exact: true }).click()
    await page.getByRole('columnheader', { name: 'Bỏ qua', exact: true }).first().waitFor()
    assert.equal(await page.evaluate(() => window.reportSmoke.state.calls.filter(c => c.method === 'status').length), 0)
    await page.getByRole('tab', { name: 'Trạng thái hành động', exact: true }).click()
    await page.getByRole('columnheader', { name: 'Đã là bạn bè', exact: true }).first().waitFor()
    assert.equal(await page.getByRole('columnheader', { name: 'Chờ xử lý', exact: true }).count(), 2)
    assert.equal(await page.getByRole('columnheader', { name: 'Đã xem', exact: true }).count(), 0)
    assert.equal(await page.locator('.report-grid tbody tr td').nth(4).textContent(), '0')
    await page.screenshot({ path: join(screenshots, 'desktop-1440.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 850))
    await page.waitForFunction(() => window.innerWidth === 850)
    assert.equal(await page.locator('.report-filter-content').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2)
    const countColor = await page.getByTitle('Xem chi tiết thành công của Nhắn tin bạn bè', { exact: true }).evaluate(element => getComputedStyle(element).color)
    assert.notEqual(countColor, 'rgb(0, 0, 0)')
    await page.screenshot({ path: join(screenshots, 'desktop-850.png') })
    assert(await page.getByRole('tab', { name: 'Trạng thái hành động', exact: true }).isVisible())
    await page.getByRole('button', { name: 'Xuất Excel', exact: true }).click()
    const waitDownload = async count => {
      for (let i = 0; i < 100; i++) {
        const downloads = await app.evaluate(() => global.downloads)
        if (downloads.length >= count) return downloads[count - 1]
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Excel download did not finish')
    }
    const matrix = await waitDownload(1)
    assert.equal(matrix.state, 'completed')
    const workbook = xlsx.readFile(matrix.path), sheet = workbook.Sheets[workbook.SheetNames[0]]
    assert.deepEqual(xlsx.utils.sheet_to_json(sheet, { header: 1 })[1], ['Trạng thái', 'Chờ xử lý', 'Thành công', 'Lỗi', 'Đã là bạn bè', 'Chờ xử lý', 'Thành công', 'Lỗi', 'Đã là bạn bè'])
    await page.getByTitle('Xem chi tiết thành công của Nhắn tin bạn bè', { exact: true }).click()
    await page.getByText('Khách hàng 1', { exact: true }).waitFor()
    assert.equal(await page.locator('.report-detail-status small').first().textContent(), 'Đã xem')
    await page.screenshot({ path: join(screenshots, 'desktop-detail-850.png') })
    await page.locator('.report-detail-modal').getByRole('button', { name: /Xuất Excel/ }).click()
    const exported = await waitDownload(2), book = xlsx.readFile(exported.path)
    const rows = xlsx.utils.sheet_to_json(book.Sheets[book.SheetNames[0]])
    assert.equal(rows.length, 2); assert.equal(rows[0]['Trạng thái phụ'], 'Đã xem')
    await page.keyboard.press('Escape')
    await page.getByTitle('Xem chi tiết chờ xử lý của Nhắn tin bạn bè', { exact: true }).click()
    await page.getByText('Khách hàng 1', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.reportSmoke.state.calls.filter(c => c.method === 'status-detail').at(-1).query.selector.kind), 'pending')
    await page.keyboard.press('Escape')
    // A hidden page must retire reads and preserve the current filter/mode on return.
    await page.evaluate(() => window.reportSmoke.setActive(false))
    await page.evaluate(() => window.reportSmoke.setActive(true))
    await page.getByRole('columnheader', { name: 'Đã là bạn bè', exact: true }).first().waitFor()
    await page.getByRole('tab', { name: 'Trạng thái chung', exact: true }).click()
    await page.getByRole('columnheader', { name: 'Bỏ qua', exact: true }).first().waitFor()
    await page.evaluate(() => { window.reportSmoke.state.holdSummary = true })
    await page.getByRole('tab', { name: 'Trạng thái hành động', exact: true }).click()
    await page.waitForFunction(() => !!window.reportSmoke.state.resolveSummary)
    await page.getByRole('tab', { name: 'Trạng thái chung', exact: true }).click()
    await page.getByRole('columnheader', { name: 'Bỏ qua', exact: true }).first().waitFor()
    await page.evaluate(() => window.reportSmoke.state.resolveSummary())
    assert.equal(await page.getByRole('columnheader', { name: 'Đã là bạn bè', exact: true }).count(), 0)
    assert.deepEqual(errors, [])
    console.log(`PASS Electron report UI: two tabs, 1440/850 layout, main-only columns, pending drilldown, real Excel matrix/detail downloads and late responses. Screenshots: ${screenshots}`)
  } finally { if (app) await app.close(); rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
