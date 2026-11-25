// Form xin email (V652): giao diện Desktop (hộp thoại, nhãn "Thêm email", dòng Email trong Thông tin tài khoản) với IPC
// giả lập. Dựng renderer bằng esbuild rồi mở bằng Chromium của Playwright, không cần binary Electron, không kết nối mạng.
//   node scripts/staff-email-prompt/run-email-prompt-ui-smoke.cjs
//   EMAIL_PROMPT_UI_SHOTS=<thư mục> node scripts/staff-email-prompt/run-email-prompt-ui-smoke.cjs   # kiểm + chụp màn hình
'use strict'
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { chromium } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-email-prompt-ui-'))
  const shots = process.env.EMAIL_PROMPT_UI_SHOTS || ''
  if (shots) mkdirSync(shots, { recursive: true })
  await build({ entryPoints: [join(__dirname, 'email-prompt-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"file:///smoke/"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="email-prompt-ui-smoke.css"><body><div id="root"></div><script src="email-prompt-ui-smoke.js"></script></body></html>')
  const chromiumPath = process.env.EMAIL_PROMPT_UI_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
  const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath, args: ['--no-sandbox'] } : {})
  let cases = 0
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' })
    await context.route(/^https?:/, route => route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(String(error.message)))
    await page.goto(`file://${join(directory, 'index.html')}`)
    await page.waitForFunction(() => window.emailSmoke && window.emailSmoke.start)
    const start = (scenario, options) => page.evaluate(args => window.emailSmoke.start(...args), [scenario, options || {}])
    const calls = () => page.evaluate(() => JSON.parse(JSON.stringify(window.emailSmoke.calls)))
    const actions = async () => (await calls()).map(call => call.action)
    const shot = async name => { if (shots) await page.screenshot({ path: join(shots, `email-${name}.png`) }) }
    const dialog = page.getByRole('dialog', { name: /Giữ tài khoản|Bạn vẫn dùng|Đã lưu email|Đổi email/ })
    const chip = page.locator('.email-prompt-chip')
    const input = page.locator('#email-prompt-input')
    const ok = name => { cases += 1; console.log(`PASS ${name}`) }
    const enterState = { show: 'enter', reason: 'no_email', chip: true, username: 'hoangmai', isAdmin: true }

    // 1. Không có email: form tự hiện sau ~1,5 giây, đúng một lượt state.
    await start({ state: enterState })
    assert.equal(await dialog.count(), 0, 'không hiện ngay lúc vào app')
    await dialog.waitFor()
    assert.match(await dialog.innerText(), /Giữ tài khoản luôn trong tầm tay/)
    assert.match(await dialog.innerText(), /Tài khoản hoangmai chưa có email/)
    assert.equal(await dialog.locator('.email-prompt-benefits li').count(), 4)
    assert.match(await dialog.innerText(), /Báo cáo chiến dịch mỗi sáng/)
    assert.deepEqual(await actions(), ['state'])
    assert.equal(await chip.count(), 0, 'form đang mở thì không có nhãn')
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'email-prompt-input', 'ô email được focus')
    await shot('01-form')
    ok('form tự hiện, một lượt state, ô email được focus')

    // 2. Esc và bấm ra ngoài không đóng.
    await page.keyboard.press('Escape')
    await page.mouse.click(20, 400)
    await page.waitForTimeout(200)
    assert.equal(await dialog.count(), 1)
    assert.deepEqual(await actions(), ['state'])
    ok('Esc và bấm ra ngoài không đóng, không gọi dismiss')

    // 3. Chip chọn nhanh tên miền.
    await input.fill('an')
    const completions = page.locator('.email-prompt-completion')
    assert.deepEqual(await completions.allInnerTexts(), ['@gmail.com', '@yahoo.com', '@outlook.com', '@icloud.com'])
    await completions.nth(1).click()
    assert.equal(await input.inputValue(), 'an@yahoo.com')
    assert.equal(await completions.count(), 0)
    ok('chip chọn nhanh @gmail.com… điền đủ email')

    // 4. Gõ "an@gmial" (chưa đủ tên miền) thì chưa gợi ý; gõ "an@gmial.com" thì gợi ý, Lưu chờ khách chọn.
    await input.fill('an@gmial')
    assert.equal(await page.locator('.email-prompt-typo').count(), 0)
    await input.fill('an@gmial.com')
    const typo = page.locator('.email-prompt-typo')
    await typo.waitFor()
    assert.match(await typo.innerText(), /Có phải bạn muốn nhập an@gmail\.com\?/)
    await shot('02-goi-y-ten-mien')
    await page.getByRole('button', { name: 'Lưu email' }).click()
    await input.press('Enter')
    await page.waitForTimeout(150)
    assert.deepEqual(await actions(), ['state'], 'đang có gợi ý thì Lưu không gửi')
    await typo.getByRole('button', { name: 'Sửa giúp' }).click()
    assert.equal(await input.inputValue(), 'an@gmail.com')
    assert.equal(await typo.count(), 0)
    ok('gợi ý sửa tên miền: Lưu chờ, Sửa giúp điền đúng')

    // 5. Email sai dạng: báo lỗi, không gọi DB.
    await input.fill('an@')
    await input.press('Enter')
    assert.match(await page.locator('.email-prompt-error').innerText(), /Email chưa đúng/)
    assert.deepEqual(await actions(), ['state'])
    ok('email sai dạng: báo lỗi, không gọi DB')

    // 6. Bấm × gọi dismiss, đóng form, hiện nhãn "Thêm email"; bấm nhãn mở lại, không gọi dismiss.
    const close = dialog.getByRole('button', { name: 'Đóng', exact: true })
    const box = await close.boundingBox()
    assert.ok(box && Math.round(box.width) === 22 && Math.round(box.height) === 22, `nút × 22px (${box && box.width}x${box && box.height})`)
    await close.focus()
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'detached' })
    await page.waitForTimeout(50)
    assert.deepEqual(await calls(), [{ action: 'state', payload: null }, { action: 'dismiss', payload: null }])
    await chip.waitFor()
    assert.match(await chip.innerText(), /Thêm email/)
    await shot('03-nhan-them-email')
    await chip.click()
    await dialog.waitFor()
    assert.deepEqual(await actions(), ['state', 'dismiss'])
    ok('× (bàn phím) gọi dismiss, hiện nhãn; bấm nhãn mở lại không gọi dismiss')

    // 7. DB báo tên miền nhầm (email_typo): hiện gợi ý của DB; Giữ nguyên thì lưu kèm allowTypo.
    await start({ state: enterState, saveReplies: { 'an@gmaiil.com': { ok: false, code: 'email_typo', message: 'x', suggestion: 'an@gmail.com' } } })
    await dialog.waitFor()
    await input.fill('an@gmaiil.com')
    await input.press('Enter')
    await typo.waitFor()
    assert.match(await typo.innerText(), /an@gmail\.com/)
    await typo.getByRole('button', { name: 'Giữ nguyên' }).click()
    await page.getByRole('button', { name: 'Lưu email' }).click()
    await page.getByRole('dialog', { name: 'Đã lưu email' }).waitFor()
    const saves = (await calls()).filter(call => call.action === 'save').map(call => call.payload)
    assert.deepEqual(saves, [{ email: 'an@gmaiil.com' }, { email: 'an@gmaiil.com', allowTypo: true }])
    ok('email_typo từ DB hiện như gợi ý, Giữ nguyên gửi allowTypo')

    // 8. Màn Đã lưu: email, thư xác nhận, "Trong thư có"; Vào làm việc đóng, không dismiss, không còn nhãn.
    const savedDialog = page.getByRole('dialog', { name: 'Đã lưu email' })
    assert.match(await savedDialog.innerText(), /an@gmaiil\.com/)
    assert.match(await savedDialog.innerText(), /thư xác nhận/)
    assert.match(await savedDialog.innerText(), /TRONG THƯ CÓ/)
    await shot('04-da-luu')
    await savedDialog.getByRole('button', { name: 'Vào làm việc' }).click()
    await savedDialog.waitFor({ state: 'detached' })
    assert.equal(await chip.count(), 0)
    assert.ok(!(await actions()).includes('dismiss'))
    ok('màn Đã lưu, Vào làm việc đóng, không còn nhãn')

    // 9. Không chồng hộp thoại: có hộp thoại khác đang mở thì chờ đóng rồi mới hiện.
    await start({ state: enterState }, { blocker: true })
    await page.waitForTimeout(3500)
    assert.deepEqual(await actions(), ['state'])
    assert.equal(await dialog.count(), 0, 'đang có hộp thoại khác thì chưa hiện')
    assert.equal(await chip.count(), 1, 'trong lúc chờ vẫn có nhãn')
    await page.getByRole('button', { name: 'Đóng hộp thoại khác' }).click()
    await dialog.waitFor()
    ok('chờ hộp thoại khác đóng rồi mới hiện')

    // 10. Có email / công tắc tắt: không hiện gì.
    await start({ state: { show: 'none', reason: 'has_email', chip: false } })
    await page.waitForTimeout(3300)
    assert.equal(await dialog.count(), 0)
    assert.equal(await chip.count(), 0)
    await start({ state: { enabled: false, show: 'none', reason: 'disabled' } })
    await page.waitForTimeout(3300)
    assert.equal(await dialog.count(), 0)
    assert.equal(await chip.count(), 0)
    ok('có email / công tắc tắt: không form, không nhãn')

    // 11. Hôm nay đã tắt: không form nhưng có nhãn.
    await start({ state: { show: 'none', reason: 'dismissed', chip: true, username: 'hoangmai' } })
    await chip.waitFor()
    await page.waitForTimeout(2000)
    assert.equal(await dialog.count(), 0)
    ok('hôm nay đã tắt: chỉ có nhãn')

    // 12. Màn xác nhận: hiện nguyên email, Đúng gửi confirm.
    await start({ state: { show: 'confirm', reason: 'no_email', chip: true, username: 'hoangmai', email: 'hoangmai.store@gmail.com' } })
    const confirmDialog = page.getByRole('dialog', { name: 'Bạn vẫn dùng email này chứ?' })
    await confirmDialog.waitFor()
    assert.match(await confirmDialog.innerText(), /hoangmai\.store@gmail\.com/)
    await shot('05-xac-nhan')
    await confirmDialog.getByRole('button', { name: 'Đúng, tôi đang dùng email này' }).click()
    await page.getByRole('dialog', { name: 'Đã lưu email' }).waitFor()
    assert.deepEqual((await calls()).filter(call => call.action === 'save').map(call => call.payload), [{ confirm: true }])
    ok('màn xác nhận: hiện nguyên email, gửi confirm')

    // 13. Thông tin tài khoản: dòng Email + nút Đổi mở form; × ở đây không gọi dismiss; lưu xong đọc lại email.
    await start({ state: { show: 'none', reason: 'has_email', chip: false }, profileEmail: 'cu@yahoo.com' })
    await page.waitForTimeout(1800)
    await page.evaluate(() => window.emailSmoke.openProfile())
    const emailRow = page.locator('.account-profile-email')
    await emailRow.waitFor()
    assert.match(await emailRow.innerText(), /cu@yahoo\.com/)
    await shot('06-thong-tin-tai-khoan')
    await emailRow.getByRole('button', { name: 'Đổi' }).click()
    const changeDialog = page.getByRole('dialog', { name: 'Đổi email tài khoản' })
    await changeDialog.waitFor()
    assert.match(await changeDialog.innerText(), /cu@yahoo\.com/)
    await changeDialog.getByRole('button', { name: 'Đóng', exact: true }).click()
    await changeDialog.waitFor({ state: 'detached' })
    assert.ok(!(await actions()).includes('dismiss'), 'Đổi email: × không gọi dismiss')
    await emailRow.getByRole('button', { name: 'Đổi' }).click()
    await changeDialog.waitFor()
    await input.fill('moi@gmail.com')
    await input.press('Enter')
    await page.getByRole('dialog', { name: 'Đã lưu email' }).getByRole('button', { name: 'Vào làm việc' }).click()
    await page.waitForFunction(() => /moi@gmail\.com/.test(document.querySelector('.account-profile-email')?.textContent || ''))
    assert.equal((await actions()).filter(action => action === 'profile').length, 2, 'profile đọc lại một lần sau khi lưu')
    ok('Thông tin tài khoản: dòng Email, nút Đổi, đọc lại sau khi lưu')

    // 14. Theme sáng: form dùng token của app.
    await page.evaluate(() => window.emailSmokeTheme(true))
    await start({ state: enterState })
    await dialog.waitFor()
    const background = await dialog.evaluate(node => getComputedStyle(node).backgroundColor)
    assert.equal(background, 'rgb(245, 248, 252)', 'nền hộp thoại theo --bg-secondary của theme sáng')
    await shot('07-theme-sang')
    await page.evaluate(() => window.emailSmokeTheme(false))
    ok('theme sáng dùng token của app')

    // 15. Đăng xuất (scope null): form đóng, store xoá.
    await page.evaluate(() => window.emailSmoke.stop())
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await chip.count(), 0)
    ok('đăng xuất: form và nhãn biến mất')

    const errors = await page.evaluate(() => window.emailSmoke.errors)
    assert.deepEqual([...pageErrors, ...errors], [])
  } finally {
    await browser.close()
    rmSync(directory, { recursive: true, force: true })
  }
  console.log(`\n${cases} PASS`)
}

main().catch(error => { console.error('FAIL', error && error.message ? error.message : error); process.exit(1) })
