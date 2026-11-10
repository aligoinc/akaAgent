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
    const state = (fn, arg) => page.evaluate(fn, arg)
    const cardCalls = () => state(() => window.sortSmoke.state.cardCalls.length)
    const dataTab = page.locator('.detail-dock-tab').filter({ hasText: 'Data tìm được' })
    const note = page.locator('.find-data-cards-note')
    const tableHead = () => state(() => [...document.querySelectorAll('.find-data-result-grid thead th')].map(th => th.textContent.trim()))
    const tableRow = value => state(value => {
      const row = [...document.querySelectorAll('.find-data-result-grid tbody tr')]
        .find(tr => tr.querySelectorAll('td')[1]?.textContent.trim() === value)
      return row ? [...row.querySelectorAll('td')].map(td => td.textContent.trim()) : null
    }, value)
    const exportButton = page.getByRole('button', { name: 'Xuất Excel', exact: true })
    const busyButton = page.locator('.find-data-export-bar').getByRole('button', { name: 'Đang xuất...', exact: true })
    const exportBook = async () => {
      const count = await state(() => window.sortSmoke.state.exports.length)
      await exportButton.click()
      await page.waitForFunction(count => window.sortSmoke.state.exports.length > count, count)
      const result = await state(() => window.sortSmoke.state.exports.at(-1))
      assert.match(result.filename, /^found-data-/)
      return XLSX.read(result.bytes, { type: 'base64' })
    }
    const rows = (book, name) => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: '' })
    const groupHeader = ['Tên', 'UID', 'Số thành viên', 'Số bài', 'Đơn vị bài', 'Privacy',
      'Số bài Facebook hiển thị', 'Bài chưa đọc', 'Trạng thái tham gia', 'Tham gia từ', 'Bạn bè trong nhóm',
      'Từ khóa', 'Tài khoản tìm', 'Thời gian tìm']
    const legacyHeader = ['Tên', 'Uid', 'Sđt', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5']
    const firstRun = await state(() => new Date('2026-09-27T12:40:57.000Z').toLocaleString('vi-VN'))
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
    // Không đọc được log: vẫn có phần đã lưu (tên sạch, kết quả đã lưu đủ giữ nguyên), cột thêm của kết quả cũ để trống.
    const withoutCards = expectedGroups.map((row, index) => {
      if (index === 0) return row
      const [name, url, members, posts, unit, privacy] = row
      if (url.endsWith('/stored')) return row
      if (url.endsWith('/english')) return [name, url, members, '', '', privacy, '', '', '', '', '', ...row.slice(11)]
      if (url.endsWith('12345678901234567890/')) return [name, url, members, posts, unit, privacy, '', '', '', '', '', ...row.slice(11)]
      return row
    })

    // Mở tab khi log lỗi: bảng có cột nhóm, số liệu đã lưu hiện ngay, báo rõ và có Thử lại; không tự đọc lại liên tục.
    await page.getByText('Sort campaign 91', { exact: true }).first().click()
    await state(() => { window.sortSmoke.state.cardResult = 'fail' })
    await dataTab.click()
    await note.filter({ hasText: 'Chưa đọc được log chạy' }).waitFor()
    assert.deepEqual(await tableHead(), ['Loại data', 'Giá trị', 'Tên', 'Thành viên', 'Bài/ngày', 'Riêng tư', 'Tham gia',
      'Bài chưa đọc', 'Tham gia từ', 'Bạn bè trong nhóm', 'Tài khoản', 'Từ khóa', 'Thời gian'])
    const englishUrl = 'https://www.facebook.com/groups/english'
    const englishTime = (await tableRow(englishUrl)).at(-1)
    assert.deepEqual(await tableRow(englishUrl), ['Link group Facebook', englishUrl, 'Nhóm tiếng Anh', '7.500', '-', 'Công khai',
      '-', '-', '-', '-', 'Sort account', 'hải hậu', englishTime])
    assert.deepEqual((await tableRow('https://www.facebook.com/groups/stored')).slice(2, 10),
      ['Đã lưu đủ', '500', '4', 'Công khai', 'Chưa tham gia', '-', '-', '3'])
    assert.equal(await cardCalls(), 1)
    await page.waitForTimeout(300)
    assert.equal(await cardCalls(), 1, 'lỗi không tự đọc lại')
    await note.getByRole('button', { name: 'Thử lại', exact: true }).click()
    await page.waitForFunction(() => window.sortSmoke.state.cardCalls.length === 2)
    await note.filter({ hasText: 'Chưa đọc được log chạy' }).waitFor()
    // Rời tab rồi mở lại thì đọc lại.
    await page.locator('.detail-dock-tab').filter({ hasText: 'Thông tin' }).first().click()
    await dataTab.click()
    await page.waitForFunction(() => window.sortSmoke.state.cardCalls.length === 3)
    await note.filter({ hasText: 'Chưa đọc được log chạy' }).waitFor()

    // Xuất khi log lỗi (lỗi hoặc IPC hỏng): đọc lại lúc xuất, vẫn xuất phần đã có và báo rõ.
    let book
    for (const [failure, calls] of [['fail', 4], ['throw', 5]]) {
      await state(value => { window.sortSmoke.state.cardResult = value }, failure)
      book = await exportBook()
      assert.deepEqual(rows(book, 'Group Facebook'), withoutCards, failure)
      const alert = await state(() => window.sortSmoke.state.alerts.at(-1))
      assert.equal(alert.type, 'info')
      assert.match(alert.message, /Chưa đọc được log chạy/)
      assert.equal(await cardCalls(), calls)
    }
    console.log('PASS bảng có cột nhóm, log lỗi: số đã lưu vẫn hiện, báo + Thử lại, không tự đọc lại, mở lại tab/xuất thì đọc lại')

    // Xuất trong lúc đang đọc log: nút "Đang xuất...", khoá; đọc xong thì bảng và file đủ số liệu.
    await state(() => { window.sortSmoke.state.cardResult = 'ok'; window.sortSmoke.state.holdCards = true })
    let count = await state(() => window.sortSmoke.state.exports.length)
    await exportButton.click()
    await busyButton.waitFor()
    assert.equal(await busyButton.isDisabled(), true)
    await note.filter({ hasText: 'Đang đọc thêm số liệu nhóm' }).waitFor()
    await state(() => { window.sortSmoke.state.holdCards = false; window.sortSmoke.state.releaseCards() })
    await page.waitForFunction(count => window.sortSmoke.state.exports.length > count, count)
    await exportButton.waitFor()
    book = XLSX.read(await state(() => window.sortSmoke.state.exports.at(-1).bytes), { type: 'base64' })
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
    assert.equal(await state(() => window.sortSmoke.state.alerts.at(-1).type), 'success')
    assert.equal(await cardCalls(), 6)
    await note.waitFor({ state: 'detached' })
    assert.deepEqual(await tableRow(englishUrl), ['Link group Facebook', englishUrl, 'Nhóm tiếng Anh', '7.500', '90+', 'Công khai',
      'Chưa tham gia', '-', '-', '2', 'Sort account', 'hải hậu', englishTime])
    assert.deepEqual((await tableRow('https://www.facebook.com/groups/12345678901234567890')).slice(2, 10),
      ['-', '651', '2', 'Riêng tư', 'Đã tham gia', '3', '02/2026', '1'])
    assert.deepEqual((await tableRow('https://www.facebook.com/groups/stored')).slice(2, 10),
      ['Đã lưu đủ', '500', '4', 'Công khai', 'Chưa tham gia', '-', '-', '3'], 'đã lưu đủ thì không trộn thẻ log')
    assert.deepEqual((await tableRow('0901234567')).slice(0, 3), ['Số điện thoại', '0901234567', '-'])

    // Đã đọc: xuất lại dùng số liệu đã đọc, không đọc log thêm.
    book = await exportBook()
    assert.deepEqual(rows(book, 'Group Facebook'), expectedGroups)
    assert.equal(await cardCalls(), 6)
    assert.deepEqual(await state(() => window.sortSmoke.state.cardCalls.at(-1)), { campaignId: 91 })
    console.log('PASS đang đọc log thì nút khoá, bảng + file đủ số liệu (số bài tiếng Anh, tham gia, bạn bè), đã lưu đủ giữ nguyên, xuất lại không đọc log thêm')

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
    const callsBeforePhones = await cardCalls()
    book = await exportBook()
    assert.deepEqual(book.SheetNames, ['Sheet1'])
    assert.deepEqual(rows(book, 'Sheet1'), [legacyHeader, ['', '', '0901234567', '', '', '', '', '', '']])
    assert.equal(await cardCalls(), callsBeforePhones, 'không chọn nhóm thì không đọc log')

    // Chiến dịch tìm trong group: cột Link Facebook + Nguồn cho SĐT/UID, không có cột nhóm, không đọc log thẻ.
    await page.getByText('Sort campaign 92', { exact: true }).first().click()
    await dataTab.click()
    await page.locator('.find-data-result-grid tbody tr').first().waitFor()
    assert.deepEqual(await tableHead(), ['Loại data', 'Giá trị', 'Tên', 'Link Facebook', 'Nguồn', 'Tài khoản', 'Group', 'Thời gian'])
    assert.deepEqual((await tableRow('0901234567')).slice(0, 6), ['Số điện thoại', '0901234567', 'Người đăng',
      'https://www.facebook.com/profile.php?id=100000000000001', 'Bài post', 'Sort account'])
    assert.deepEqual((await tableRow('100000000000009')).slice(2, 5), ['Thành viên mới', 'https://www.facebook.com/100000000000009', 'Thành viên group'])
    assert.deepEqual((await tableRow('12345678901234567890')).slice(2, 5), ['-', '-', '-'], 'nguồn lạ không hiện mã')
    await options.getByLabel('UID', { exact: true }).check()
    book = await exportBook()
    assert.deepEqual(rows(book, 'Sheet1'), [legacyHeader,
      ['Người đăng', '', '0901234567', '', '', '', '', '', ''],
      ['Thành viên mới', '100000000000009', '', '', '', '', '', '', ''],
      ['', '12345678901234567890', '', '', '', '', '', '', '']])
    assert.equal(await cardCalls(), callsBeforePhones, 'chiến dịch tìm trong group không đọc log thẻ')
    assert.deepEqual(await state(() => window.sortSmoke.state.errors), [])
    console.log('PASS chỉ nhóm thì một sheet, chọn loại xuất, tắt hết thì khoá nút; tìm trong group: cột Link Facebook/Nguồn, mẫu Excel cũ giữ nguyên, không đọc log')
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({ errors: window.sortSmoke?.state.errors, text: document.body.innerText.slice(-1600) })))
    throw error
  } finally {
    if (app) await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
