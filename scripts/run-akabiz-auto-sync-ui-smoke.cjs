// Hộp thoại đồng bộ akaBiz Auto → akaAgent (phương án 2): giao diện thật với IPC giả, trên Chromium của Playwright.
//   node scripts/run-akabiz-auto-sync-ui-smoke.cjs
//   AKABIZ_AUTO_SYNC_UI_SHOTS=<thư mục> node scripts/run-akabiz-auto-sync-ui-smoke.cjs   # kiểm + chụp màn hình
'use strict'
const assert = require('node:assert/strict')
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { build } = require('esbuild')
const { chromium } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-akabiz-auto-sync-ui-'))
  const shots = process.env.AKABIZ_AUTO_SYNC_UI_SHOTS || ''
  if (shots) mkdirSync(shots, { recursive: true })
  let cases = 0
  const ok = name => { cases += 1; console.log(`PASS ${name}`) }
  try {
    await build({ entryPoints: [join(__dirname, 'akabiz-auto-sync-ui-smoke.tsx')], outdir: directory, bundle: true, platform: 'browser', format: 'iife',
      jsx: 'automatic', target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"' },
      loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="akabiz-auto-sync-ui-smoke.css"><body><div id="root"></div><script src="akabiz-auto-sync-ui-smoke.js"></script></body></html>')
    const chromiumPath = process.env.AKABIZ_AUTO_SYNC_UI_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
    const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath, args: ['--no-sandbox'] } : {})
    try {
      const context = await browser.newContext({ viewport: { width: 1180, height: 860 }, deviceScaleFactor: shots ? 2 : 1, timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' })
      await context.route(/^https?:/, route => route.abort())
      const page = await context.newPage()
      page.setDefaultTimeout(8000)
      const errors = []
      page.on('pageerror', error => errors.push(String(error.message)))
      page.on('console', message => { if (message.type() === 'error' && !/net::ERR_FAILED/.test(message.text())) errors.push(message.text().slice(0, 300)) })
      await page.goto(`file://${join(directory, 'index.html')}`)
      const server = () => page.evaluate(() => JSON.parse(JSON.stringify(window.akaBizAutoSyncSmoke.server)))
      const shot = async name => { if (shots) await page.screenshot({ path: join(shots, `akabiz-auto-sync-${name}.png`) }) }
      const modal = page.locator('.aas-modal')
      await page.click('#open')
      await modal.waitFor()

      // 1. Kết nối
      await assert.doesNotReject(modal.getByText('admin.shopmau · Shop Mẫu').waitFor())
      await modal.getByText('C:\\akaBiz Auto\\Resources2\\akabiz_auto_local.db').waitFor()
      await modal.getByRole('button', { name: /Xác minh và tiếp tục/ }).click()
      await modal.getByText('Vui lòng nhập mật khẩu akaBiz.').waitFor()
      await modal.getByPlaceholder('Nhập mật khẩu akaBiz').fill('sai')
      await modal.getByRole('button', { name: /Xác minh và tiếp tục/ }).click()
      await modal.getByText('Tên đăng nhập hoặc mật khẩu akaBiz không đúng.').waitFor()
      await shot('1-ket-noi')
      await modal.getByPlaceholder('Nhập mật khẩu akaBiz').fill('dung-mat-khau')
      await modal.getByPlaceholder('Nhập mật khẩu akaBiz').press('Enter')
      await modal.getByRole('heading', { name: 'Cài đặt đồng bộ' }).waitFor()
      ok('Kết nối: hiện đích từ phiên + file dữ liệu, báo thiếu / sai mật khẩu, Enter để xác minh')

      // 2. Cài đặt
      const radio = name => modal.locator('label.aas-choice', { hasText: name }).locator('input')
      assert.equal(await radio('Zalo Server').isChecked(), true)
      assert.equal(await radio('Zalo Browser').isDisabled(), true)
      await modal.getByText('Chưa có gói').waitFor()
      await modal.getByText('Còn trống 7/10').waitFor()
      // Mặc định: tài khoản đang bật được chọn (55, 56, 70), giới hạn 90 ngày; phạm vi Dừng/Chờ xử lý trên các Shop đó: 1,2,3,4,6 = 5; trong 90 ngày: 1,2,6 = 3.
      const banner = modal.locator('.aas-banner.info')
      await assert.doesNotReject(banner.filter({ hasText: '3 / 5 chiến dịch sẽ được đồng bộ' }).waitFor())
      await banner.filter({ hasText: 'Bỏ 2 chiến dịch không cập nhật trong 90 ngày qua.' }).waitFor()
      await modal.getByRole('button', { name: '7 ngày' }).click()
      await banner.filter({ hasText: '2 / 5' }).waitFor()
      const days = modal.locator('input.aas-days')
      await days.fill('400')
      assert.equal(await days.inputValue(), '400')
      await banner.filter({ hasText: 'Nhập số ngày từ 1 đến 365.' }).waitFor()
      assert.equal(await modal.getByRole('button', { name: /^Xem trước/ }).isDisabled(), true)
      await days.fill('365')
      await banner.filter({ hasText: '4 / 5' }).waitFor()
      await modal.locator('label', { hasText: 'Chỉ đồng bộ chiến dịch mới cập nhật gần đây' }).locator('input').uncheck()
      await banner.filter({ hasText: '5 / 5 chiến dịch sẽ được đồng bộ. Không giới hạn theo ngày cập nhật.' }).waitFor()
      await modal.locator('label.aas-choice', { hasText: 'Tất cả chiến dịch' }).locator('input').check()
      await banner.filter({ hasText: '6 / 6' }).waitFor()
      await modal.locator('label.aas-choice', { hasText: 'Chỉ chiến dịch Dừng và Chờ xử lý' }).locator('input').check()
      await modal.locator('label', { hasText: 'Chỉ đồng bộ chiến dịch mới cập nhật gần đây' }).locator('input').check()
      await modal.getByRole('button', { name: '90 ngày' }).click()
      ok('Cài đặt: chỉ bật loại Zalo có gói, đếm theo trạng thái / ngày, chặn số ngày ngoài 1–365')

      await radio('Zalo QR').check()
      await modal.getByText('Cần thêm 1 tài khoản Zalo QR nhưng gói chỉ còn trống 0.').waitFor()
      assert.equal(await modal.getByRole('button', { name: /^Xem trước/ }).isDisabled(), true)
      await radio('Zalo Server').check()
      assert.equal(await modal.getByRole('button', { name: /^Xem trước/ }).isDisabled(), false)
      await modal.getByText('Đã có · Zalo Server, dùng lại').waitFor()
      await shot('2-cai-dat')
      ok('Cài đặt: chặn khi loại Zalo đã hết chỗ cho tài khoản mới; tài khoản đã chép ghi "dùng lại"')

      // 3. Xem trước
      await modal.getByRole('button', { name: /^Xem trước/ }).click()
      await modal.getByText('Zalo - Nhắn tin, kết bạn đến SĐT').waitFor()
      let s = await server()
      const preview = s.calls.find(call => call.action === 'run')
      assert.deepEqual(preview.args, [{ platforms: ['zalo', 'facebook'], zaloAccountType: 'zalo_server', shopIds: [55, 56, 70],
        campaignScope: 'paused_pending', updatedWithinDays: 90 }, true])
      await modal.getByText('Chiến dịch có ảnh được chép không kèm ảnh.').waitFor()
      await modal.getByText('14 dòng thiếu UID Zalo').waitFor()
      await modal.getByText('akaAgent chưa có loại này').waitFor()
      const saved = JSON.parse(await page.evaluate(() => window.akaBizAutoSyncSmoke.saved()))
      assert.deepEqual(saved, preview.args[0])
      assert.equal(JSON.stringify(saved).includes('dung-mat-khau'), false)
      await shot('3-xem-truoc')
      ok('Xem trước: gửi đúng cài đặt, chạy thử, hiện chiến dịch / thay đổi / bỏ qua / cần xử lý; lưu cài đặt, không lưu mật khẩu')

      // 4. Đồng bộ: không đóng được khi đang chạy, click không lan lên hộp Cài đặt.
      await page.evaluate(() => { window.akaBizAutoSyncSmoke.server.holdSync = true })
      await modal.getByRole('button', { name: /Bắt đầu đồng bộ/ }).click()
      await modal.getByRole('heading', { name: 'Đang đồng bộ…' }).waitFor()
      assert.equal(await modal.locator('.aas-header button').isDisabled(), true)
      await page.mouse.click(10, 10)
      await page.keyboard.press('Escape')
      assert.equal(await modal.isVisible(), true)
      await modal.getByText('Cửa sổ đóng được khi đồng bộ xong').waitFor()
      await shot('4-dong-bo')
      await page.evaluate(() => window.akaBizAutoSyncSmoke.release())
      await modal.getByRole('heading', { name: 'Đã đồng bộ xong' }).waitFor()
      await modal.getByText('Dừng chiến dịch bên akaBiz Desktop trước khi bật bên akaAgent').waitFor()
      await modal.getByText('Thêm lại ảnh cho 2 chiến dịch').waitFor()
      await modal.getByText('Đăng nhập lại 2 tài khoản mới').waitFor()
      s = await server()
      assert.equal(s.calls.filter(call => call.action === 'run' && call.args[1] === false).length, 1)
      assert.equal(s.parentClicks, 0)
      await shot('5-hoan-tat')
      ok('Đồng bộ: không đóng / Esc / click ngoài khi đang chạy; Hoàn tất hiện việc cần làm tiếp; click không lan ra hộp Cài đặt')

      await modal.locator('.aas-footer').getByRole('button', { name: 'Đóng', exact: true }).click()
      await modal.waitFor({ state: 'detached' })
      s = await server()
      assert.ok(s.calls.some(call => call.action === 'close'))
      ok('Đóng hộp thoại xoá phiên đồng bộ ở tiến trình chính')
      assert.deepEqual(errors, [])
    } finally {
      await browser.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  console.log(`\n${cases} PASS`)
}

main().catch(error => {
  console.error('FAIL', error && error.message ? error.message : error)
  process.exit(1)
})
