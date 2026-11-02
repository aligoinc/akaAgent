const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve, dirname } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')
const XLSX = require('xlsx')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-found-export-'))
  let app
  let page
  try {
    const xlsxModule = join(dirname(require.resolve('xlsx')), 'xlsx.mjs')
    await build({ entryPoints: [join(__dirname, 'campaign-found-data-export-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.BASE_URL': '"/"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning',
      plugins: [{ name: 'capture-real-excel', setup(build) {
        build.onResolve({ filter: /^xlsx$/ }, () => ({ path: 'xlsx', namespace: 'smoke' }))
        build.onLoad({ filter: /.*/, namespace: 'smoke' }, () => ({ resolveDir: resolve(__dirname, '..'), contents: `
          export * from ${JSON.stringify(xlsxModule)};
          import { write } from ${JSON.stringify(xlsxModule)};
          export const writeFile = (book, filename) => window.sortSmoke.state.exports.push({
            filename, bytes: write(book, { type: 'base64', bookType: 'xlsx' })
          });` }))
      } }] })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-found-data-export-ui-smoke.css"><body><div id="root"></div><script src="campaign-found-data-export-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 1600, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
    page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    await page.getByText('Sort campaign 91', { exact: true }).first().click()
    await page.locator('.detail-dock-tab').filter({ hasText: 'Data tìm được' }).click()
    const exportButton = page.getByRole('button', { name: 'Xuất Excel', exact: true })
    const exportBook = async () => {
      const count = await page.evaluate(() => window.sortSmoke.state.exports.length)
      await exportButton.click()
      await page.waitForFunction(count => window.sortSmoke.state.exports.length > count, count)
      const result = await page.evaluate(() => window.sortSmoke.state.exports.at(-1))
      assert.match(result.filename, /^found-data-/)
      return XLSX.read(result.bytes, { type: 'base64' })
    }
    const rows = (book, name) => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '' })
    const groupHeader = ['Tên', 'UID', 'Số thành viên', 'Số bài', 'Đơn vị bài', 'Privacy', 'Loại nhóm AI']
    const legacyHeader = ['Tên', 'Uid', 'Sđt', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5']
    let book = await exportBook()
    assert.deepEqual(book.SheetNames, ['Sheet1', 'Group Facebook'])
    assert.deepEqual(rows(book, 'Sheet1'), [legacyHeader,
      ['', '', '0901234567', '', '', '', '', '', ''],
      ['', '12345678901234567890', '', '', '', '', '', '', '']])
    const groupRows = rows(book, 'Group Facebook')
    assert.deepEqual(groupRows, [groupHeader,
      ['Hải Minh - Hải Hậu', 'https://www.facebook.com/groups/12345678901234567890/', 651, 2, 'ngày', 'Riêng tư', 'Không biết'],
      ['=Tên nhóm', 'https://www.facebook.com/groups/missing', '', '', '', '', 'Không biết'],
      ['Số không', 'https://www.facebook.com/groups/zero', 0, '', '', 'Riêng tư', 'Không biết'],
      ['Số không dạng chuỗi', 'https://www.facebook.com/groups/zero-string', '', '', '', '', 'Không biết'],
      ['Bổ sung số liệu', 'https://www.facebook.com/groups/filled', 1200, 5, 'ngày', 'Công khai', 'Không biết']])
    assert.equal(book.Sheets['Group Facebook'].A3.t, 's')
    assert.equal(book.Sheets['Group Facebook'].A3.f, undefined)
    assert.equal(book.Sheets['Group Facebook'].C2.t, 'n')
    assert.equal(book.Sheets['Group Facebook']['!autofilter'].ref, 'A1:G6')
    console.log('PASS real panel export + XLSX round trip: 7 columns, preserve metadata when filling names, fill missing metrics, unknown activity blank, Unicode, text IDs')
    const options = page.locator('.find-data-export-options')
    for (const label of ['SĐT', 'Link group Zalo', 'UID', 'Link bài post']) {
      await options.getByLabel(label, { exact: true }).uncheck()
    }
    book = await exportBook()
    assert.deepEqual(book.SheetNames, ['Sheet1'])
    assert.deepEqual(rows(book, 'Sheet1'), groupRows)
    await options.getByLabel('Link group Facebook', { exact: true }).uncheck()
    assert.equal(await exportButton.isDisabled(), true)
    await options.getByLabel('SĐT', { exact: true }).check()
    book = await exportBook()
    assert.deepEqual(book.SheetNames, ['Sheet1'])
    assert.deepEqual(rows(book, 'Sheet1'), [legacyHeader, ['', '', '0901234567', '', '', '', '', '', '']])
    await page.getByText('Sort campaign 92', { exact: true }).first().click()
    await page.locator('.detail-dock-tab').filter({ hasText: 'Data tìm được' }).click()
    await options.getByLabel('UID', { exact: true }).check()
    book = await exportBook()
    assert.deepEqual(rows(book, 'Sheet1'), [legacyHeader,
      ['', '', '0901234567', '', '', '', '', '', ''],
      ['', '12345678901234567890', '', '', '', '', '', '', '']])
    assert.deepEqual(await page.evaluate(() => window.sortSmoke.state.errors), [])
    console.log('PASS group-only sheet, selected kinds, disabled empty export, legacy find-data-group template unchanged')
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({ errors: window.sortSmoke?.state.errors, text: document.body.innerText.slice(-1600) })))
    throw error
  } finally {
    if (app) await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
