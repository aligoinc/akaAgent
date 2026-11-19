// Tab "Lỗi không xác định" (V588, admin akaBiz): hộp thoại thật của Desktop với IPC giả lập.
// Dựng renderer bằng esbuild rồi mở bằng Chromium của Playwright, không cần binary Electron và không kết nối mạng.
//   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node scripts/run-engine-error-review-ui-smoke.cjs
//   ENGINE_ERROR_UI_SHOTS=<thư mục> ... để chụp màn hình
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { chromium } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-engine-error-review-ui-'))
  const shots = process.env.ENGINE_ERROR_UI_SHOTS || ''
  if (shots) mkdirSync(shots, { recursive: true })
  await build({ entryPoints: [join(__dirname, 'engine-error-review-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="engine-error-review-ui-smoke.css"><body><div id="root"></div><script src="engine-error-review-ui-smoke.js"></script></body></html>')
  const chromiumPath = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
  const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath, args: ['--no-sandbox'] } : {})
  let passed = 0
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' })
    await context.route(/^https?:/, route => route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(String(error.message)))
    page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text().slice(0, 400)) })
    await page.goto(`file://${join(directory, 'index.html')}`)
    await page.waitForFunction(() => window.engineErrorSmoke)

    const reset = options => page.evaluate(value => window.engineErrorSmoke.reset(value), options || {})
    const calls = () => page.evaluate(() => window.engineErrorSmoke.state.calls)
    const ui = () => page.evaluate(() => window.engineErrorSmoke.ui())
    const confirm = () => page.evaluate(() => window.engineErrorSmoke.confirm())
    const fakeCases = () => page.evaluate(() => window.engineErrorSmoke.cases())
    const shot = async name => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`) }) }
    const ok = name => { passed += 1; console.log(`PASS ${name}`) }
    const modal = page.locator('.engine-error-modal')
    const rows = page.locator('.engine-error-case')
    const detail = page.locator('.engine-error-detail')
    const note = page.locator('.engine-error-note')

    // 1. Mở tab: một lượt đọc danh sách, ca chờ duyệt đứng đầu, chưa đọc chi tiết ca nào.
    await reset()
    await rows.first().waitFor()
    assert.equal(await rows.count(), 3)
    assert.match(await rows.first().innerText(), /SYS99/)
    assert.match(await rows.first().innerText(), /Chờ duyệt/)
    assert.match(await modal.locator('.engine-error-title').innerText(), /1 ca chờ duyệt/)
    assert.match(await modal.locator('.engine-error-summary').innerText(), /Đọc lỗi: bật/)
    assert.match(await page.locator('.engine-error-detail-pane').innerText(), /Chọn một ca lỗi/)
    assert.deepEqual((await calls()).map(item => item.action), ['list'])
    await shot('1-danh-sach')
    ok('mở tab: danh sách ca, ca chờ duyệt đứng đầu, một lượt đọc')

    // 2. Chọn ca: kết luận, câu đề xuất, đề xuất mã lỗi, 50 lượt đầu và nút tải thêm.
    await rows.first().click()
    await detail.waitFor()
    const text = await detail.innerText()
    assert.match(text, /Facebook đổi giao diện/)
    assert.match(text, /Độ chắc: cao/)
    assert.match(text, /Nhóm mua bán không có ô đăng bài/)
    assert.match(text, /Dừng 3 chiến dịch/)
    assert.equal(await note.inputValue(), 'Nhóm này chỉ cho đăng bài bán hàng nên chưa đăng được')
    assert.match(text, /Khách sẽ thấy: Nhóm này chỉ cho đăng bài bán hàng nên chưa đăng được \(SYS99\)/)
    assert.equal(await detail.locator('.engine-error-table tbody tr').count(), 50)
    assert.match(text, /Tải thêm \(còn 22 lượt\)/)
    await detail.getByRole('button', { name: 'Xem báo cáo đầy đủ' }).click()
    assert.match(await detail.locator('.engine-error-answer').innerText(), /72 lượt ở 9 tổ chức/)
    await shot('2-chi-tiet')
    await detail.getByRole('button', { name: /Tải thêm/ }).click()
    await page.waitForFunction(() => document.querySelectorAll('.engine-error-table tbody tr').length === 72)
    ok('chi tiết ca: kết luận, hai đề xuất chờ duyệt, các lượt lỗi, tải thêm')

    // 3. Duyệt câu: phải qua hộp xác nhận có đúng câu khách sẽ thấy; chưa xác nhận thì chưa ghi gì.
    await note.fill('Nhóm này chỉ nhận bài bán hàng,   chưa đăng được bài thường')
    await detail.getByRole('button', { name: 'Duyệt và ghi' }).click()
    const asked = await ui()
    assert.match(asked.confirm, /72 lượt lỗi/)
    assert.match(asked.confirm, /"Nhóm này chỉ nhận bài bán hàng, chưa đăng được bài thường \(SYS99\)"/)
    assert.equal((await calls()).filter(item => item.action === 'note').length, 0, 'chưa xác nhận thì chưa gọi')
    await confirm()
    await page.waitForFunction(() => /Đã duyệt/.test(document.querySelector('.engine-error-detail')?.textContent || ''))
    const noteCall = (await calls()).filter(item => item.action === 'note').pop()
    assert.deepEqual(noteCall.payload, { caseKey: (await fakeCases())[0].caseKey, decision: 'approve', note: 'Nhóm này chỉ nhận bài bán hàng, chưa đăng được bài thường' })
    assert.equal((await fakeCases())[0].customerNoteStatus, 'approved')
    assert.equal((await ui()).alert.type, 'success')
    assert.equal(await detail.getByRole('button', { name: 'Duyệt câu đã sửa' }).isDisabled(), true, 'câu chưa đổi thì không duyệt lại')
    assert.match(await rows.first().innerText(), /Chờ duyệt/, 'đề xuất mã lỗi vẫn chờ duyệt')
    await shot('3-da-duyet-cau')
    ok('duyệt câu cho khách: xác nhận trước, gửi đúng câu đã gọn khoảng trắng')

    // 4. Câu quá ngắn / quá dài: nút duyệt khoá, không gọi DB.
    await note.fill('abc')
    assert.equal(await detail.getByRole('button', { name: 'Duyệt câu đã sửa' }).isDisabled(), true)
    await note.fill('x'.repeat(201))
    assert.equal(await detail.getByRole('button', { name: 'Duyệt câu đã sửa' }).isDisabled(), true)
    assert.match(await detail.locator('.engine-error-over').innerText(), /201\/200/)
    ok('câu ngoài 5–200 ký tự: không duyệt được')

    // 5. Bỏ duyệt: hỏi lại, rồi trạng thái thành "Đã bỏ".
    await detail.getByRole('button', { name: 'Bỏ duyệt' }).click()
    assert.match((await ui()).confirm, /trả về câu cũ/)
    await confirm()
    await page.waitForFunction(() => /Đã bỏ/.test(document.querySelector('.engine-error-detail')?.textContent || ''))
    assert.equal((await fakeCases())[0].customerNoteStatus, 'rejected')
    ok('bỏ duyệt câu: hỏi lại rồi ghi quyết định')

    // 6. Đề xuất mã lỗi: duyệt chỉ ghi quyết định, ca hết "Chờ duyệt".
    await detail.getByRole('button', { name: 'Duyệt đề xuất' }).click()
    await page.waitForFunction(() => window.engineErrorSmoke.cases()[0].codeProposalStatus === 'approved')
    assert.match(await detail.innerText(), /chỉ ghi lại quyết định/)
    await page.waitForFunction(() => !/Chờ duyệt/.test(document.querySelector('.engine-error-case')?.textContent || ''))
    assert.deepEqual((await calls()).filter(item => item.action === 'code').pop().payload.decision, 'approve')
    ok('duyệt đề xuất mã lỗi: chỉ ghi quyết định')

    // 7. Đánh dấu đã biết / mở lại; ca đang chờ Claude thì nút bị khoá.
    await detail.getByRole('button', { name: 'Đánh dấu đã biết' }).click()
    await detail.getByRole('button', { name: 'Mở lại ca' }).waitFor()
    assert.equal((await fakeCases())[0].status, 'known')
    await detail.getByRole('button', { name: 'Mở lại ca' }).click()
    await detail.getByRole('button', { name: 'Đánh dấu đã biết' }).waitFor()
    await rows.filter({ hasText: 'Đang chờ Claude' }).click()
    await page.waitForFunction(() => /đang chờ Claude kiểm/.test(document.querySelector('.engine-error-detail')?.textContent || ''))
    assert.equal(await detail.getByRole('button', { name: 'Đánh dấu đã biết' }).isDisabled(), true)
    assert.match(await detail.innerText(), /Không mã/)
    assert.equal(await detail.getByText('Đề xuất mã lỗi mới').count(), 0)
    ok('đánh dấu đã biết / mở lại; ca đang chờ thì khoá')

    // 8. Bộ lọc: mỗi lần đổi là một lượt đọc danh sách với đúng tham số.
    await reset()
    await rows.first().waitFor()
    await modal.getByLabel('Chỉ ca chờ duyệt').check()
    await page.waitForFunction(() => document.querySelectorAll('.engine-error-case').length === 1)
    await modal.getByLabel('Chỉ ca chờ duyệt').uncheck()
    await modal.getByLabel('Trạng thái').selectOption('new')
    await page.waitForFunction(() => document.querySelectorAll('.engine-error-case').length === 1 && /FB41/.test(document.querySelector('.engine-error-case').textContent))
    await modal.getByLabel('Trạng thái').selectOption('')
    await modal.getByLabel('Tìm ca lỗi').fill('ô đăng bài')
    await modal.getByLabel('Tìm ca lỗi').press('Enter')
    await page.waitForFunction(() => document.querySelectorAll('.engine-error-case').length === 1 && /SYS99/.test(document.querySelector('.engine-error-case').textContent))
    const lists = (await calls()).filter(item => item.action === 'list')
    // mở, bật chờ duyệt, tắt chờ duyệt, chọn trạng thái, bỏ trạng thái, tìm
    assert.equal(lists.length, 6)
    assert.equal(lists[1].payload.needsReview, true)
    assert.equal(lists[3].payload.status, 'new')
    assert.equal(lists[5].payload.q, 'ô đăng bài')
    ok('bộ lọc: chờ duyệt, trạng thái, tìm theo câu lỗi')

    // 9. DB chưa có V588 / không phải admin: hiện câu rõ ràng, có nút thử lại, không vỡ.
    await reset({ fail: 'not_ready' })
    await page.waitForFunction(() => /đang được cập nhật/.test(document.querySelector('.engine-error-cases')?.textContent || ''))
    await page.evaluate(() => window.engineErrorSmoke.setFail(''))
    await modal.locator('.engine-error-cases').getByRole('button', { name: 'Thử lại' }).click()
    await rows.first().waitFor()
    await reset({ fail: 'forbidden' })
    await page.waitForFunction(() => /chỉ dành cho quản trị viên akaBiz/.test(document.querySelector('.engine-error-cases')?.textContent || ''))
    ok('chưa có hàm DB / không đủ quyền: báo rõ, thử lại được')

    // 10. Đóng bằng Escape và nút X.
    await reset()
    await rows.first().waitFor()
    await page.keyboard.press('Escape')
    await modal.getByTitle('Đóng').click()
    assert.equal(await page.evaluate(() => window.engineErrorSmoke.state.closed), 2)
    ok('đóng bằng Escape và nút X')

    assert.deepEqual(await page.evaluate(() => window.engineErrorSmoke.state.errors), [])
    assert.deepEqual(pageErrors, [])
  } finally {
    await browser.close()
    rmSync(directory, { recursive: true, force: true })
  }
  console.log(`\n${passed} nhóm đạt`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
