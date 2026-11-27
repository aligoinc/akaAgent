// Ngày kết thúc bắt buộc của lịch tuần / tháng: ô ngày trên form Desktop thật, chạy trong Chromium của Playwright với IPC giả lập, chặn mọi request http.
// Chạy: node scripts/run-campaign-schedule-end-ui-smoke.cjs   (SCHEDULE_END_UI_CHROMIUM=<đường dẫn Chrome> nếu Playwright chưa có Chromium;
// SCHEDULE_END_UI_SHOTS=<thư mục> để chụp màn hình phần Lịch chạy)
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const { chromium } = require('playwright')
const TEXT = require('./campaign-schedule-end-texts.cjs')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-schedule-end-ui-'))
  await build({ entryPoints: [join(__dirname, 'campaign-schedule-end-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"file:///smoke"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-schedule-end-ui-smoke.css"><body><div id="root"></div><script src="campaign-schedule-end-ui-smoke.js"></script></body></html>')
  const browser = await chromium.launch({ ...(process.env.SCHEDULE_END_UI_CHROMIUM ? { executablePath: process.env.SCHEDULE_END_UI_CHROMIUM } : {}), args: ['--no-sandbox'] })
  const shots = process.env.SCHEDULE_END_UI_SHOTS
  if (shots) mkdirSync(shots, { recursive: true })
  let cases = 0
  try {
    const context = await browser.newContext({ viewport: { width: 1550, height: 1100 }, timezoneId: 'Asia/Ho_Chi_Minh' })
    await context.route(/^https?:/, route => route.abort())
    const page = await context.newPage(); page.setDefaultTimeout(15000)
    await page.goto(pathToFileURL(join(directory, 'index.html')).href)
    await page.waitForFunction(() => window.scheduleEndSmoke)
    const open = (...args) => page.evaluate(a => window.scheduleEndSmoke.open(...a), args)
    const settle = async () => { await page.getByText('Lịch chạy', { exact: false }).first().waitFor(); await page.waitForTimeout(400) }
    const endInput = page.getByLabel('Ngày kết thúc', { exact: true })
    const alerts = () => page.evaluate(() => window.scheduleEndSmoke.state.alerts.map(a => a.message))
    // Chụp hàng Giờ chạy / Ngày chạy / Ngày kết thúc khi có; không thì chụp cả trang.
    const shot = async name => {
      if (!shots) return
      const row = page.locator('.schedule-run-row')
      if (await row.count()) { await row.first().scrollIntoViewIfNeeded(); await row.first().screenshot({ path: join(shots, `${name}.png`) }) }
      else await page.screenshot({ path: join(shots, `${name}.png`) })
    }
    const dateKey = offsetDays => new Date(Date.now() + 7 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10)
    const save = async name => {
      await page.getByPlaceholder('Nhập tên chiến dịch...').fill(name)
      const before = await page.evaluate(() => window.scheduleEndSmoke.state.created.length)
      const alertsBefore = (await alerts()).length
      await page.getByRole('button', { name: 'Lưu chiến dịch' }).click()
      await page.waitForFunction(([n, a]) => window.scheduleEndSmoke.state.created.length > n || window.scheduleEndSmoke.state.alerts.length > a,
        [before, alertsBefore], { timeout: 15000 })
      const created = await page.evaluate(n => window.scheduleEndSmoke.state.created[n] ?? null, before)
      return { created, alert: created ? null : (await alerts()).slice(alertsBefore).join(' | ') }
    }
    const weekly = async () => {
      await page.getByRole('radio', { name: 'Theo tuần' }).check()
      await page.getByRole('checkbox', { name: 'Thứ 2', exact: true }).check()
    }

    // 1. Chiến dịch mới, lịch tuần: ô ngày luôn hiện, đặt sẵn hôm nay + 7 ngày, không có ô tích; lưu là dừng đúng ngày.
    await open('new')
    await settle()
    await weekly()
    await endInput.waitFor()
    assert.equal(await endInput.inputValue(), dateKey(7), 'chiến dịch mới: đặt sẵn hôm nay + 7 ngày')
    assert.equal(await page.getByRole('checkbox', { name: 'Đặt ngày kết thúc' }).count(), 0, 'không còn ô tích')
    await page.getByText(TEXT.SCHEDULE_END_STRICT_HINT).waitFor()
    await shot('01-moi-mac-dinh')
    const preset = await save('Tuần mặc định')
    assert.ok(preset.created, `lưu với ngày đặt sẵn phải tạo được chiến dịch (${preset.alert})`)
    assert.equal(preset.created.scheduleEndDate, new Date(`${dateKey(7)}T23:59:59+07:00`).toISOString(), 'ngày kết thúc = cuối ngày giờ Việt Nam')
    assert.equal(preset.created.scheduleEndStrict, true, 'chiến dịch mới: dừng đúng ngày')
    cases++

    // 2. Xoá ngày → báo lỗi bắt buộc; ngày trước ngày chạy → báo lỗi; ngày hợp lệ → lưu dừng đúng ngày.
    await open('new')
    await settle()
    await weekly()
    await endInput.fill('')
    const missing = await save('Tuần thiếu ngày')
    assert.equal(missing.created, null, 'thiếu ngày kết thúc: không lưu')
    assert.equal(missing.alert, TEXT.SCHEDULE_END_REQUIRED_ERROR)
    await endInput.fill(dateKey(-1))
    const before = await save('Tuần ngày trước ngày chạy')
    assert.equal(before.created, null)
    assert.equal(before.alert, TEXT.SCHEDULE_END_BEFORE_RUN_ERROR)
    const end = dateKey(10)
    await endInput.fill(end)
    await shot('02-moi-doi-ngay')
    const strict = await save('Tuần dừng đúng ngày')
    assert.ok(strict.created, `lưu có ngày kết thúc phải tạo được (${strict.alert})`)
    assert.equal(strict.created.scheduleEndDate, new Date(`${end}T23:59:59+07:00`).toISOString())
    assert.equal(strict.created.scheduleEndStrict, true)
    cases++

    // 3. Lịch Hàng ngày: không có ô ngày kết thúc, lưu không có ngày kết thúc.
    await open('new')
    await settle()
    await page.getByRole('radio', { name: 'Hàng ngày' }).check()
    assert.equal(await endInput.count(), 0, 'lịch Hàng ngày: không có ô Ngày kết thúc')
    const daily = await save('Hàng ngày')
    assert.ok(daily.created, `lịch Hàng ngày phải lưu được (${daily.alert})`)
    assert.equal(daily.created.scheduleEndDate, null)
    assert.equal(daily.created.scheduleEndStrict, false)
    cases++

    // 4. Sửa chiến dịch cũ (có ngày kết thúc, chưa dừng đúng ngày): dòng giải thích kiểu cũ; đổi ngày thì thành dừng đúng ngày.
    await open('edit', 'weekly', '2035-02-10T16:59:59.000Z', false)
    await settle()
    await endInput.waitFor()
    assert.equal(await endInput.inputValue(), '2035-02-10')
    await page.getByText(TEXT.SCHEDULE_END_LEGACY_HINT).waitFor()
    await shot('03-sua-chien-dich-cu')
    await endInput.fill('2035-02-20')
    await page.getByText(TEXT.SCHEDULE_END_STRICT_HINT).waitFor()
    assert.equal(await page.getByText(TEXT.SCHEDULE_END_LEGACY_HINT).count(), 0)
    await endInput.fill('2035-02-10')
    await page.getByText(TEXT.SCHEDULE_END_LEGACY_HINT).waitFor()
    cases++

    // 5. Sửa chiến dịch đã dừng đúng ngày: dòng giải thích dừng đúng ngày.
    await open('edit', 'weekly', '2035-02-10T16:59:59.000Z', true)
    await settle()
    assert.equal(await endInput.inputValue(), '2035-02-10')
    await page.getByText(TEXT.SCHEDULE_END_STRICT_HINT).waitFor()
    cases++

    // 6. Sửa chiến dịch tuần chưa có ngày kết thúc: ô trống (không tự điền), form vẫn mở được.
    await open('edit', 'weekly', null, false)
    await settle()
    await endInput.waitFor()
    assert.equal(await endInput.inputValue(), '', 'chiến dịch đang sửa chưa có ngày kết thúc: ô trống, lúc lưu phải chọn')
    cases++

    // 7. Chi tiết chiến dịch: ghi rõ kiểu dừng.
    await open('info', 'weekly', '2035-02-10T16:59:59.000Z', true)
    await page.getByText(`(${TEXT.SCHEDULE_END_DETAIL_STRICT})`, { exact: false }).waitFor()
    await open('info', 'weekly', '2035-02-10T16:59:59.000Z', false)
    await page.getByText(`(${TEXT.SCHEDULE_END_DETAIL_LEGACY})`, { exact: false }).waitFor()
    await shot('04-chi-tiet')
    await open('info', 'weekly', null, false)
    await page.getByText('Không giới hạn').first().waitFor()
    cases++

    const errors = await page.evaluate(() => window.scheduleEndSmoke.state.errors)
    assert.deepEqual(errors, [], 'không có lỗi trên trang')
    console.log(`PASS Ngày kết thúc trên form Desktop: ${cases} ca`)
  } finally {
    await browser.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exit(1) })
