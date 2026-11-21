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

    // Chiến dịch bật "Lấy thông tin quản trị viên của group": cột Quản trị viên ở bảng, sheet "Admin group" trong file.
    await state(() => { window.sortSmoke.state.adminDetails = true })
    await page.getByText('Sort campaign 91', { exact: true }).first().click()
    await dataTab.click()
    await page.locator('.find-data-result-grid tbody tr .find-data-admin-cell').first().waitFor()
    const adminHead = await tableHead()
    assert.equal(adminHead[adminHead.indexOf('Bạn bè trong nhóm') + 1], 'Quản trị viên')
    const adminColumn = adminHead.indexOf('Quản trị viên')
    assert.equal((await tableRow('https://www.facebook.com/groups/admins-listed/'))[adminColumn],
      'Căn hộ cho thuê0903221229, canhodn43@gmail.comTrần Mỹ Trinh')
    assert.equal((await tableRow('https://www.facebook.com/groups/admins-hidden/'))[adminColumn], 'Facebook không hiện')
    assert.deepEqual(await page.locator('.find-data-admin-cell a').evaluateAll(links => links.map(link => link.getAttribute('href'))),
      ['https://www.facebook.com/canhodichvu43', 'https://www.facebook.com/profile.php?id=100044882776478'])
    await options.getByLabel('Link group Facebook', { exact: true }).check()
    const callsBeforeAdmins = await cardCalls()
    book = await exportBook()
    assert.deepEqual(book.SheetNames, ['Sheet1', 'Admin group'])
    assert.equal(rows(book, 'Sheet1')[0][14], 'Quản trị viên')
    assert.deepEqual(rows(book, 'Sheet1').slice(1).map(row => row[14]), [2, 'Facebook không hiện'])
    assert.deepEqual(rows(book, 'Admin group'), [
      ['Tên group', 'Link group', 'Tên quản trị viên', 'Link trang cá nhân', 'UID', 'Số điện thoại', 'Email', 'Từ khóa'],
      ['Có quản trị viên', 'https://www.facebook.com/groups/admins-listed/', 'Căn hộ cho thuê', 'https://www.facebook.com/canhodichvu43', '100072022092879', '0903221229', 'canhodn43@gmail.com', 'đà nẵng'],
      ['Có quản trị viên', 'https://www.facebook.com/groups/admins-listed/', 'Trần Mỹ Trinh', 'https://www.facebook.com/profile.php?id=100044882776478', '100044882776478', '', '', 'đà nẵng']])
    assert.equal(await cardCalls(), callsBeforeAdmins, 'kết quả đã lưu đủ thì không đọc log thẻ')
    assert.deepEqual(await state(() => window.sortSmoke.state.errors), [])
    console.log('PASS quản trị viên của group: cột ở bảng (tên mở trang cá nhân, SĐT, email, lý do khi Facebook không hiện), sheet "Admin group" trong file')

    // Cách xem "Danh sách quản trị viên" (docs/FIND_DATA_GROUP_ADMIN_VIEW.md).
    const groupsRadio = page.getByRole('radio', { name: 'Danh sách group' })
    const adminsRadio = page.getByRole('radio', { name: 'Danh sách quản trị viên' })
    assert.equal(await groupsRadio.isChecked(), true, 'mặc định xem theo group')
    assert.equal(await adminsRadio.isDisabled(), false)
    await state(() => { window.sortSmoke.state.adminDetails = 'multi' })
    await page.getByText('Sort campaign 92', { exact: true }).first().click()
    await page.getByText('Sort campaign 91', { exact: true }).first().click()
    await dataTab.click()
    await page.locator('.find-data-result-grid tbody tr .find-data-admin-cell').first().waitFor()
    await adminsRadio.check()
    await page.locator('.find-data-admin-grid tbody tr').first().waitFor()
    assert.equal(await page.locator('.find-data-export-options').count(), 0, 'xem theo quản trị viên thì ẩn ô chọn loại data')
    assert.deepEqual(await tableHead(), ['Quản trị viên', 'UID', 'Số điện thoại', 'Email', 'Trang cá nhân', 'Group', 'Thành viên', 'Bài/ngày',
      'Riêng tư', 'Tham gia', 'Từ khóa', 'Tài khoản', 'Thời gian'])
    const adminRows = await state(() => [...document.querySelectorAll('.find-data-admin-grid tbody tr')]
      .map(tr => [...tr.querySelectorAll('td')].slice(0, 11).map(td => td.innerText.trim())))
    assert.deepEqual(adminRows, [
      ['Căn hộ cho thuê', '100072022092879', '0903221229', 'canhodn43@gmail.com', 'Đã đọc', 'Có quản trị viên\nhttps://www.facebook.com/groups/admins-listed/', '137.000', '90+', 'Công khai', 'Chưa tham gia', 'đà nẵng, hội an'],
      ['Trần Mỹ Trinh', '100044882776478', '-', '-', 'Đã đọc', 'Có quản trị viên\nhttps://www.facebook.com/groups/admins-listed/', '137.000', '90+', 'Công khai', 'Chưa tham gia', 'đà nẵng, hội an'],
      ['Trần Mỹ Trinh', '100044882776478', '0912000111\n0912000222', '-', 'Đã đọc', 'Nhóm thứ hai\nhttps://www.facebook.com/groups/admins-second/', '4.200', '3', 'Riêng tư', 'Đã tham gia', 'hội an'],
      ['Người chưa đọc', '100099900000001', '-', '-', 'Chưa đọc được', 'Nhóm thứ hai\nhttps://www.facebook.com/groups/admins-second/', '4.200', '3', 'Riêng tư', 'Đã tham gia', 'hội an']])
    const summary = (await page.locator('.find-data-admin-summary').innerText()).replace(/\s+/g, ' ').trim()
    assert.equal(summary, '4 dòng 3 quản trị viên 2 người có SĐT 1 người có email từ 2/4 group')
    assert.equal((await note.innerText()).trim(),
      'Không có trong danh sách: 1 group Facebook không hiện quản trị viên (group riêng tư mà tài khoản chưa tham gia); 1 group chưa đọc được trang quản trị viên.')
    const adminExportButton = page.getByRole('button', { name: 'Xuất Excel danh sách quản trị viên', exact: true })
    const exportsBefore = await state(() => window.sortSmoke.state.exports.length)
    await adminExportButton.click()
    await page.waitForFunction(count => window.sortSmoke.state.exports.length > count, exportsBefore)
    const adminExport = await state(() => window.sortSmoke.state.exports.at(-1))
    assert.match(adminExport.filename, /^found-group-admins-91-/)
    const adminBook = XLSX.read(adminExport.bytes, { type: 'base64' })
    assert.deepEqual(adminBook.SheetNames, ['Quản trị viên'])
    const adminSheet = rows(adminBook, 'Quản trị viên')
    assert.deepEqual(adminSheet[0], ['Tên quản trị viên', 'UID', 'Link trang cá nhân', 'Số điện thoại', 'Email', 'Đã đọc trang cá nhân',
      'Tên group', 'Link group', 'Số thành viên', 'Số bài/ngày', 'Privacy', 'Trạng thái tham gia', 'Từ khóa', 'Tài khoản tìm', 'Thời gian tìm'])
    assert.deepEqual(adminSheet.slice(1).map(row => row.slice(0, 13)), [
      ['Căn hộ cho thuê', '100072022092879', 'https://www.facebook.com/canhodichvu43', '0903221229', 'canhodn43@gmail.com', 'Có', 'Có quản trị viên', 'https://www.facebook.com/groups/admins-listed/', 137000, 90, 'Công khai', 'Chưa tham gia', 'đà nẵng, hội an'],
      ['Trần Mỹ Trinh', '100044882776478', 'https://www.facebook.com/profile.php?id=100044882776478', '', '', 'Có', 'Có quản trị viên', 'https://www.facebook.com/groups/admins-listed/', 137000, 90, 'Công khai', 'Chưa tham gia', 'đà nẵng, hội an'],
      ['Trần Mỹ Trinh', '100044882776478', 'https://www.facebook.com/profile.php?id=100044882776478', '0912000111, 0912000222', '', 'Có', 'Nhóm thứ hai', 'https://www.facebook.com/groups/admins-second/', 4200, 3, 'Riêng tư', 'Đã tham gia', 'hội an'],
      ['Người chưa đọc', '100099900000001', 'https://www.facebook.com/profile.php?id=100099900000001', '', '', 'Không', 'Nhóm thứ hai', 'https://www.facebook.com/groups/admins-second/', 4200, 3, 'Riêng tư', 'Đã tham gia', 'hội an']])
    assert.ok(adminSheet.slice(1).every(row => row[13] === 'Sort account' && row[14]), 'tài khoản tìm, thời gian tìm')
    // Quay lại cách xem group thì bảng cũ.
    await groupsRadio.check()
    await page.locator('.find-data-export-options').waitFor()
    assert.equal(await page.locator('.find-data-admin-grid').count(), 0)
    await adminsRadio.check()
    await page.getByText('Sort campaign 92', { exact: true }).first().click()
    await page.getByText('Sort campaign 91', { exact: true }).first().click()
    await dataTab.click()
    await page.locator('.find-data-result-grid tbody tr').first().waitFor()
    assert.equal(await groupsRadio.isChecked(), true, 'đổi chiến dịch thì về xem theo group')
    // 3.500 quản trị viên: bảng vẽ 1.000 dòng đầu và báo, file Excel đủ.
    await state(() => { window.sortSmoke.state.adminDetails = 'huge' })
    await page.getByText('Sort campaign 92', { exact: true }).first().click()
    await page.getByText('Sort campaign 91', { exact: true }).first().click()
    await dataTab.click()
    await page.locator('.find-data-result-grid tbody tr').first().waitFor()
    const hugeStart = Date.now()
    await adminsRadio.check()
    await page.locator('.find-data-admin-grid tbody tr').first().waitFor()
    const hugeMs = Date.now() - hugeStart
    assert.equal(await page.locator('.find-data-admin-grid tbody tr').count(), 1000)
    assert.match(await note.innerText(), /Bảng hiện 1\.000 dòng đầu trong 3\.500 dòng; file Excel có đủ\./)
    const hugeBefore = await state(() => window.sortSmoke.state.exports.length)
    await adminExportButton.click()
    await page.waitForFunction(count => window.sortSmoke.state.exports.length > count, hugeBefore)
    const hugeBook = XLSX.read((await state(() => window.sortSmoke.state.exports.at(-1))).bytes, { type: 'base64' })
    assert.equal(rows(hugeBook, 'Quản trị viên').length, 3501)
    console.log(`PASS 3.500 quản trị viên: bảng 1.000 dòng (${hugeMs} ms từ lúc chọn), có câu báo, Excel đủ 3.500 dòng`)
    await groupsRadio.check()
    // Chiến dịch tìm bằng search không lấy quản trị viên: nút chọn thứ hai bị khoá.
    await state(() => { window.sortSmoke.state.adminDetails = false })
    await page.getByText('Sort campaign 92', { exact: true }).first().click()
    await page.getByText('Sort campaign 91', { exact: true }).first().click()
    await dataTab.click()
    await page.locator('.find-data-result-grid tbody tr').first().waitFor()
    assert.equal(await adminsRadio.isDisabled(), true)
    assert.match(await page.locator('.find-data-view-picker').innerText(), /không bật "Lấy thông tin quản trị viên của group"/)
    // Chiến dịch tìm trong group: không có nút chọn.
    await page.getByText('Sort campaign 92', { exact: true }).first().click()
    await dataTab.click()
    await page.locator('.find-data-result-grid tbody tr').first().waitFor()
    assert.equal(await page.locator('.find-data-view-picker').count(), 0)
    assert.deepEqual(await state(() => window.sortSmoke.state.errors), [])
    console.log('PASS xem theo quản trị viên: radio mặc định group, bảng quản trị viên nối group, gộp group trùng giữa lượt, đếm người, ghi chú group thiếu, Excel một sheet đủ cột, đổi chiến dịch về group, khoá khi không lấy quản trị viên')
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
