// Nhắc gia hạn: giao diện Desktop (nhãn, dải, hộp thoại, bảng dùng thử, Thông tin tài khoản) với IPC giả lập.
// Dựng renderer bằng esbuild rồi mở bằng Chromium của Playwright (cùng nhân với Electron), không cần binary Electron và
// không kết nối mạng. Cửa sổ "Gia hạn gói" dùng <webview> nên chỉ kiểm phần khung, không kiểm trang CRM bên trong.
//   node scripts/run-renewal-reminder-ui-smoke.cjs            # kiểm
//   RENEWAL_UI_SHOTS=<thư mục> node scripts/run-renewal-reminder-ui-smoke.cjs   # kiểm + chụp màn hình
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { chromium } = require('playwright')

const HABIT_WORDS = /đăng nhập|thói quen|lần mở|chu kỳ|thường mở/i

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-renewal-reminder-ui-'))
  const shots = process.env.RENEWAL_UI_SHOTS || ''
  if (shots) mkdirSync(shots, { recursive: true })
  await build({ entryPoints: [join(__dirname, 'renewal-reminder-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="renewal-reminder-ui-smoke.css"><body><div id="root"></div><script src="renewal-reminder-ui-smoke.js"></script></body></html>')
  // Playwright của repo có thể khác bản trình duyệt cài sẵn trên máy: chỉ đường dẫn bằng RENEWAL_UI_CHROMIUM, hoặc dùng
  // /opt/pw-browsers/chromium (container cloud) khi có.
  const chromiumPath = process.env.RENEWAL_UI_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
  const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath, args: ['--no-sandbox'] } : {})
  let cases = 0
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 760 }, timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' })
    await context.route(/^https?:/, route => route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(String(error.message)))
    page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text().slice(0, 400)) })
    await page.goto(`file://${join(directory, 'index.html')}`)
    await page.waitForFunction(() => window.renewalSmoke)
    const set = (scenario, options) => page.evaluate(args => window.renewalSmoke.set(...args), [scenario, options || {}])
    const shot = async name => { if (shots) await page.screenshot({ path: join(shots, `desktop-${name}.png`) }) }
    const chip = page.locator('.renewal-reminder-chip')
    const banner = page.locator('.renewal-reminder-banner')
    const dialog = page.locator('.renewal-reminder-dialog')
    const noHabitWords = async () => assert.doesNotMatch(await page.locator('body').innerText(), HABIT_WORDS)
    const ok = name => { cases += 1; console.log(`PASS ${name}`) }

    // 1. Không có gì để nhắc: không nhãn, không dải, không hộp thoại.
    await set('')
    assert.equal(await chip.count(), 0)
    assert.equal(await banner.count(), 0)
    assert.equal(await dialog.count(), 0)
    ok('không có gì để nhắc: không hiện gì')

    // 2. Mức nhẹ (14 ngày): nhãn + dải tắt được tới giai đoạn sau, không hộp thoại.
    await set('d14')
    await banner.waitFor()
    assert.match(await chip.innerText(), /Còn 14 ngày/)
    assert.match(await banner.innerText(), /còn 14 ngày/)
    assert.equal(await dialog.count(), 0)
    await noHabitWords()
    await shot('d14-nhe')
    await banner.getByRole('button', { name: 'Đóng thông báo' }).click()
    assert.equal(await banner.count(), 0)
    assert.equal(await chip.count(), 1, 'tắt dải thì nhãn vẫn còn')
    ok('mức nhẹ: nhãn + dải, tắt dải thì nhãn còn')

    // 3. Mức vừa (7 ngày): hộp thoại một lần mỗi giai đoạn, dải ẩn trong ngày.
    await set('d7')
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /còn 7 ngày/)
    assert.match(await dialog.innerText(), /Đã dùng 359\/366 ngày/)
    await shot('d7-vua-hop-thoai')
    await dialog.getByRole('button', { name: 'Để sau' }).click()
    assert.equal(await dialog.count(), 0)
    await banner.waitFor()
    await shot('d7-vua-dai')
    await set('d7', { fresh: false })
    assert.equal(await dialog.count(), 0, 'cùng giai đoạn không hiện lại hộp thoại')
    ok('mức vừa: hộp thoại một lần, sau đó chỉ còn dải')

    // 4. Mức mạnh (3 ngày): dải chỉ thu gọn được.
    await set('d3')
    await dialog.waitFor()
    await shot('d3-manh-hop-thoai')
    await dialog.getByRole('button', { name: 'Để sau' }).click()
    assert.match(await banner.innerText(), /Gia hạn ngay/)
    await banner.getByRole('button', { name: 'Thu gọn' }).click()
    assert.equal(await banner.count(), 0)
    assert.match(await chip.innerText(), /Còn 3 ngày/)
    await shot('d3-manh-thu-gon')
    ok('mức mạnh: dải thu gọn, nhãn vẫn còn')

    // 5. Ngày hết hạn: dải khoá, có đồng hồ, hộp thoại có nút Đóng.
    await set('d0')
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /Ngày cuối cùng/)
    assert.equal(await dialog.locator('.renewal-reminder-countdown-cell').count(), 3)
    await shot('d0-ngay-cuoi-hop-thoai')
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).last().click()
    await banner.waitFor()
    assert.equal(await banner.getByRole('button', { name: /Thu gọn|Đóng thông báo|Ẩn thông báo/ }).count(), 0, 'ngày cuối không ẩn được dải')
    assert.match(await chip.innerText(), /\d{2}:\d{2}:\d{2}/)
    await shot('d0-ngay-cuoi-dai')
    ok('ngày hết hạn: dải khoá + đồng hồ')

    // 6. Dùng thử: nhãn đếm ngược, bấm mở bảng nhỏ; không có dải.
    await set('t2')
    assert.match(await chip.innerText(), /Dùng thử/)
    assert.equal(await banner.count(), 0)
    await chip.locator('.renewal-reminder-chip-label').click()
    await page.locator('.renewal-reminder-popover').waitFor()
    assert.equal(await page.locator('.renewal-reminder-popover .renewal-reminder-countdown-cell').count(), 3)
    await shot('t2-dung-thu')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.renewal-reminder-popover').count(), 0)
    ok('dùng thử: nhãn đếm ngược + bảng nhỏ')

    // 7. Ưu đãi gia hạn sớm hiện ở dải và hộp thoại.
    await set('d7+')
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /tặng thêm 15 ngày/)
    await shot('d7-uu-dai')
    await dialog.getByRole('button', { name: 'Để sau' }).click()
    assert.match(await banner.innerText(), /tặng thêm 15 ngày/)
    ok('ưu đãi gia hạn sớm')

    // 8. Thông tin tài khoản: số ngày còn lại + nút cho đúng gói.
    await page.evaluate(() => window.renewalSmokeOpenProfile())
    const profile = page.locator('.account-profile-renewal-days')
    await profile.waitFor()
    assert.match(await profile.innerText(), /Còn 7 ngày/)
    await shot('thong-tin-tai-khoan')
    await page.locator('.account-profile-modal, .modal-overlay').last().getByRole('button', { name: 'Đóng', exact: true }).last().click()
    await profile.waitFor({ state: 'detached' })
    ok('Thông tin tài khoản có số ngày và nút')

    // 9. Bấm Gia hạn mở cửa sổ trong app và gọi main đúng một lần với khóa của thông báo.
    await set('d7')
    await dialog.waitFor()
    await dialog.getByRole('button', { name: 'Gia hạn', exact: true }).click()
    await page.locator('.renewal-reminder-window').waitFor()
    const opens = await page.evaluate(() => window.renewalSmoke.state.calls.filter(call => call.method === 'openRenewalReminderWindow'))
    assert.equal(opens.length, 1)
    assert.match(String(opens[0].args[0]), /^501:\d{4}-\d{2}-\d{2}$/)
    await shot('cua-so-gia-han')
    await page.locator('.renewal-reminder-window').getByRole('button', { name: 'Đóng cửa sổ gia hạn' }).click()
    await page.waitForFunction(() => window.renewalSmoke.state.calls.some(call => call.method === 'closeRenewalReminderWindow'))
    ok('bấm Gia hạn mở cửa sổ trong app')

    // 10. Giao diện tối.
    await set('d7', { theme: 'dark' })
    await dialog.waitFor()
    await shot('toi-d7-hop-thoai')
    await dialog.getByRole('button', { name: 'Để sau' }).click()
    await set('d0', { theme: 'dark', fresh: false })
    await shot('toi-d0-dai')
    ok('giao diện tối')

    const errors = await page.evaluate(() => window.renewalSmoke.state.errors)
    assert.deepEqual(errors, [])
    assert.deepEqual(pageErrors, [], 'không có lỗi console/trang trong suốt bài kiểm')
    console.log(`\n${cases} nhóm đạt.`)
  } finally {
    await browser.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })
