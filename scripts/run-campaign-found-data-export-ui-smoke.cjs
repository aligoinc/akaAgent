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
    const groupHeader = ['Tên', 'UID', 'Số thành viên', 'Số bài', 'Đơn vị bài', 'Privacy',
      'Số bài Facebook hiển thị', 'Bài chưa đọc', 'Trạng thái tham gia', 'Tham gia từ', 'Bạn bè trong nhóm',
      'Từ khóa', 'Tài khoản tìm', 'Thời gian tìm']
    const legacyHeader = ['Tên', 'Uid', 'Sđt', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5']
    const firstRun = await page.evaluate(() => new Date('2026-09-27T12:40:57.000Z').toLocaleString('vi-VN'))
    assert.match(firstRun, /2026/)
    const tail = (keywords) => [keywords, 'Sort account', firstRun]
    const expectedGroups = [groupHeader,
      ['Hải Minh - Hải Hậu', 'https://www.facebook.com/groups/12345678901234567890/', 651, 2, 'ngày', 'Riêng tư',
        '', 3, 'Đã tham gia', '02/2026', 1, ...tail('hải hậu, ninh cường')],
      ['=Tên nhóm', 'https://www.facebook.com/groups/missing', '', '', '', '', '', '', '', '', '', ...tail('hải hậu')],
      ['Số không', 'https://www.facebook.com/groups/zero', 0, '', '', 'Riêng tư', '', '', '', '', '', ...tail('hải hậu')],
      ['Số không dạng chuỗi', 'https://www.facebook.com/groups/zero-string', '', '', '', '', '', '', '', '', '', ...tail('hải hậu')],
      ['Bổ sung số liệu', 'https://www.facebook.com/groups/filled', 1200, 5, 'ngày', 'Công khai', '', '', '', '', '', ...tail('hải hậu, ninh cường')],
      ['Nhóm tiếng Anh', 'https://www.facebook.com/groups/english', 7500, 90, 'ngày', 'Công khai', '90+', '', 'Chưa tham gia', '', 2, ...tail('hải hậu')],
      ['Đã lưu đủ', 'https://www.facebook.com/groups/stored', 500, 4, 'ngày', 'Công khai', '4', '', 'Chưa tham gia', '', 3, ...tail('hải hậu')]]
    let book = await exportBook()
    assert.deepEqual(book.SheetNames, ['Sheet1', 'Group Facebook'])
    assert.deepEqual(rows(book, 'Sheet1'), [legacyHeader,
      ['', '', '0901234567', '', '', '', '', '', ''],
      ['', '12345678901234567890', '', '', '', '', '', '', '']])
    const groupRows = rows(book, 'Group Facebook')
    assert.deepEqual(groupRows, expectedGroups)
    const groupSheet = book.Sheets['Group Facebook']
    assert.equal(groupSheet.A3.t, 's')
    assert.equal(groupSheet.A3.f, undefined)
    assert.equal(groupSheet.C2.t, 'n')
    assert.equal(groupSheet.D7.t, 'n')
    assert.equal(groupSheet.G7.t, 's')
    assert.equal(groupSheet.K7.t, 'n')
    assert.equal(groupSheet['!autofilter'].ref, 'A1:N8')
    assert.deepEqual(await page.evaluate(() => window.sortSmoke.state.cardCalls), [{ campaignId: 91 }])
    assert.equal(await page.evaluate(() => window.sortSmoke.state.alerts.at(-1).type), 'success')
    console.log('PASS real panel export + XLSX round trip: 6 cột mẫu + 8 cột thêm, thẻ log điền số bài tiếng Anh/trạng thái/bạn bè, tên sạch, dữ liệu đã lưu đủ giữ nguyên, gộp từ khóa/tài khoản/thời gian, số là số')

    // Đang đọc log: nút báo "Đang xuất..." và bị khoá; xong thì xuất đúng file.
    const busyButton = page.locator('.find-data-export-bar').getByRole('button', { name: 'Đang xuất...', exact: true })
    await page.evaluate(() => { window.sortSmoke.state.holdCards = true })
    let count = await page.evaluate(() => window.sortSmoke.state.exports.length)
    await exportButton.click()
    await busyButton.waitFor()
    assert.equal(await busyButton.isDisabled(), true)
    await page.evaluate(() => { window.sortSmoke.state.holdCards = false; window.sortSmoke.state.releaseCards() })
    await page.waitForFunction(count => window.sortSmoke.state.exports.length > count, count)
    await exportButton.waitFor()
    book = XLSX.read(await page.evaluate(() => window.sortSmoke.state.exports.at(-1).bytes), { type: 'base64' })
    assert.deepEqual(rows(book, 'Group Facebook'), expectedGroups)

    // Không đọc được log (lỗi hoặc IPC hỏng): vẫn xuất phần đã có, tên vẫn sạch, báo rõ.
    const withoutCards = expectedGroups.map((row, index) => {
      if (index === 0) return row
      const [name, url, members, posts, unit, privacy] = row
      if (url.endsWith('/stored')) return row
      if (url.endsWith('/english')) return [name, url, members, '', '', privacy, '', '', '', '', '', ...row.slice(11)]
      if (url.endsWith('12345678901234567890/')) return [name, url, members, posts, unit, privacy, '', '', '', '', '', ...row.slice(11)]
      return row
    })
    for (const failure of ['fail', 'throw']) {
      await page.evaluate(value => { window.sortSmoke.state.cardResult = value }, failure)
      book = await exportBook()
      assert.deepEqual(rows(book, 'Group Facebook'), withoutCards, failure)
      const alert = await page.evaluate(() => window.sortSmoke.state.alerts.at(-1))
      assert.equal(alert.type, 'info')
      assert.match(alert.message, /Chưa đọc được log chạy/)
    }
    await page.evaluate(() => { window.sortSmoke.state.cardResult = 'ok' })
    console.log('PASS đang xuất khoá nút, log lỗi/IPC hỏng vẫn xuất phần đã có và báo rõ')

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
    const callsBeforePhones = await page.evaluate(() => window.sortSmoke.state.cardCalls.length)
    book = await exportBook()
    assert.deepEqual(book.SheetNames, ['Sheet1'])
    assert.deepEqual(rows(book, 'Sheet1'), [legacyHeader, ['', '', '0901234567', '', '', '', '', '', '']])
    assert.equal(await page.evaluate(() => window.sortSmoke.state.cardCalls.length), callsBeforePhones, 'không chọn nhóm thì không đọc log')
    await page.getByText('Sort campaign 92', { exact: true }).first().click()
    await page.locator('.detail-dock-tab').filter({ hasText: 'Data tìm được' }).click()
    await options.getByLabel('UID', { exact: true }).check()
    book = await exportBook()
    assert.deepEqual(rows(book, 'Sheet1'), [legacyHeader,
      ['', '', '0901234567', '', '', '', '', '', ''],
      ['', '12345678901234567890', '', '', '', '', '', '', '']])
    assert.equal(await page.evaluate(() => window.sortSmoke.state.cardCalls.length), callsBeforePhones, 'chiến dịch tìm trong group không đọc log thẻ')
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
