// Thông báo nổi Desktop: component thật trên Chromium của Playwright, IPC giả lập, đồng hồ giả (tua thời gian không phải chờ thật).
// Kiểm: khi nào hiện, hiện gì, bấm mở / để sau / tự ẩn, không hiện lại, không hiện trên trang Thông báo, cửa sổ ẩn thì để dành,
// hỏi số chưa đọc đúng mốc báo cáo và sau khi chiến dịch hoàn thành, không có vòng đọc DB theo nhịp.
//   node scripts/notification-toast-desktop/run-toast-ui-smoke.cjs
//   TOAST_UI_SHOTS=<thư mục> node scripts/notification-toast-desktop/run-toast-ui-smoke.cjs   # kiểm + chụp màn hình
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { chromium } = require('playwright')

const T0 = Date.parse('2026-11-22T05:00:00Z') // 12:00 giờ VN
const MIN = 60_000

function item(id, eventType, createdAt, title, body) {
  return {
    id, eventType, severity: 'info', title, body, occurredAt: new Date(createdAt).toISOString(), createdAt: new Date(createdAt).toISOString(),
    readAt: null, emailState: 'none', pushState: 'none', campaignId: eventType === 'campaign.status_changed' ? 55 : null,
    accountId: null, dataGroupId: null, entityKey: `e${id}`
  }
}

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-toast-ui-'))
  const shots = process.env.TOAST_UI_SHOTS || ''
  if (shots) mkdirSync(shots, { recursive: true })
  await build({ entryPoints: [join(__dirname, 'toast-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'error' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="toast-ui-smoke.css"><body><div id="root"></div><script src="toast-ui-smoke.js"></script></body></html>')
  const chromiumPath = process.env.TOAST_UI_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '')
  const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath, args: ['--no-sandbox'] } : {})
  let cases = 0
  const ok = name => { cases += 1; console.log(`PASS ${name}`) }
  try {
    async function open(initial) {
      const context = await browser.newContext({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: shots ? 2 : 1, timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN', reducedMotion: shots ? 'reduce' : 'no-preference' })
      const page = await context.newPage()
      page.setDefaultTimeout(5000)
      const errors = []
      page.on('pageerror', error => errors.push(String(error.message)))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 300)) })
      await page.clock.install({ time: T0 })
      await page.addInitScript(value => { window.__toastInitial = value }, initial || {})
      await page.goto(`file://${join(directory, 'index.html')}`)
      await page.waitForFunction(() => window.toastSmoke)
      await page.clock.runFor(50)
      return { context, page, errors }
    }
    const S = page => ({
      set: (path, value) => page.evaluate(([p, v]) => { window.toastSmoke.server[p] = v }, [path, value]),
      push: value => page.evaluate(v => { window.toastSmoke.server.items.unshift(v) }, value),
      count: (name, since = 0) => page.evaluate(([n, s]) => window.toastSmoke.count(n, s), [name, since]),
      now: () => page.evaluate(() => Date.now()),
      refresh: () => page.evaluate(() => window.toastSmoke.refresh(true)),
      opened: () => page.evaluate(() => window.toastSmoke.server.opened),
      lastList: () => page.evaluate(() => window.toastSmoke.lastList())
    })
    const toast = page => page.locator('.nc-toast')
    // Render của React chạy ngoài đồng hồ giả: tua từng chút tới khi điều kiện đúng.
    const waitFor = async (page, predicate, arg) => {
      for (let i = 0; i < 100; i += 1) {
        if (await page.evaluate(predicate, arg)) return
        await page.clock.runFor(20)
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      throw new Error('waitFor: hết lượt chờ')
    }
    const shot = async (page, name) => { if (shots) await page.screenshot({ path: join(shots, `toast-${name}.png`) }) }

    // ---------- Trang 1: luồng hiện / ẩn ----------
    const a = await open({ unread: 0 })
    const p = a.page, s = S(p)
    assert.equal(await s.count('unreadCount'), 1, 'mở app: hỏi số chưa đọc một lần')
    assert.equal(await s.count('list'), 0, 'chưa đọc = 0 thì không đọc danh sách')
    assert.equal(await toast(p).count(), 0)
    ok('mở app khi không có thông báo chưa đọc: một lượt hỏi số, không đọc danh sách, không hiện gì')

    // 1. Báo cáo mới: số chưa đọc tăng → đọc 3 dòng chưa đọc → hiện thẻ
    let now = await s.now()
    await s.push(item(101, 'report.scheduled', now - MIN, 'Báo cáo 12:00 · Chủ Nhật 22/11', 'Thành công 120 · Thất bại 3 · Chờ gửi 15'))
    await s.set('unread', 1)
    await s.refresh(); await p.clock.runFor(50)
    await toast(p).waitFor()
    assert.deepEqual(await s.lastList(), { limit: 3, unreadOnly: true })
    const text1 = await toast(p).innerText()
    assert.match(text1, /Báo cáo 12:00 · Chủ Nhật 22\/11/)
    assert.match(text1, /Thành công 120/)
    assert.equal(await toast(p).getByRole('button', { name: 'Xem báo cáo' }).count(), 1)
    assert.equal(await toast(p).getByRole('button', { name: 'Để sau' }).count(), 1)
    assert.equal(await toast(p).getAttribute('role'), 'status')
    await shot(p, 'bao-cao')
    ok('báo cáo mới: đọc đúng 3 dòng chưa đọc, hiện tiêu đề + nội dung + nút "Xem báo cáo"')

    // 2. Tự ẩn sau 12 giây
    await p.clock.runFor(11_000)
    assert.equal(await toast(p).count(), 1, 'chưa tới 12 giây vẫn còn')
    await p.clock.runFor(1_500)
    assert.equal(await toast(p).count(), 0, 'quá 12 giây thì ẩn')
    ok('tự ẩn sau 12 giây')

    // 3. Số chưa đọc không tăng: không đọc lại danh sách, không hiện lại
    const listCalls = await s.count('list')
    await s.refresh(); await p.clock.runFor(50)
    assert.equal(await s.count('list'), listCalls)
    assert.equal(await toast(p).count(), 0)
    ok('số chưa đọc không tăng: không đọc danh sách, không hiện lại')

    // 4. Chiến dịch hoàn thành: nút "Xem chiến dịch"; rê chuột giữ thẻ; bấm mở
    now = await s.now()
    await s.push(item(102, 'campaign.status_changed', now, 'Chiến dịch "Chăm sóc khách cũ" đã hoàn thành', 'Đã gửi 250 tin, 240 thành công'))
    await s.set('unread', 2)
    await s.refresh(); await p.clock.runFor(50)
    await toast(p).waitFor()
    assert.equal(await toast(p).getByRole('button', { name: 'Xem chiến dịch' }).count(), 1)
    await shot(p, 'chien-dich')
    await toast(p).hover()
    await p.clock.runFor(30_000)
    assert.equal(await toast(p).count(), 1, 'rê chuột thì không tự ẩn')
    await toast(p).getByRole('button', { name: 'Xem chiến dịch' }).click()
    assert.equal(await toast(p).count(), 0)
    assert.deepEqual(await s.opened(), [102])
    ok('chiến dịch hoàn thành: nút "Xem chiến dịch", rê chuột giữ thẻ, bấm thì mở đúng thông báo và đóng thẻ')

    // 5. Chào ngày mới (tiêu đề trống thì dùng nhãn loại), "Để sau" đóng thẻ
    await p.mouse.move(5, 5)
    now = await s.now()
    await s.push(item(103, 'report.morning', now, null, 'Hôm nay 3 chiến dịch chạy, dự kiến 1.200 data'))
    await s.set('unread', 3)
    await s.refresh(); await p.clock.runFor(50)
    await toast(p).waitFor()
    assert.match(await toast(p).innerText(), /Chào ngày mới/)
    assert.equal(await toast(p).getByRole('button', { name: 'Xem báo cáo' }).count(), 1)
    await shot(p, 'chao-ngay-moi')
    await toast(p).getByRole('button', { name: 'Để sau' }).click()
    assert.equal(await toast(p).count(), 0)
    assert.deepEqual(await s.opened(), [102], '"Để sau" không mở gì')
    ok('Chào ngày mới: tiêu đề trống thì hiện "Chào ngày mới"; "Để sau" chỉ đóng thẻ')

    // 6. Loại không nổi (hết hạn gói, tài khoản) và thông báo quá 3 giờ: không hiện
    now = await s.now()
    await s.push(item(104, 'account.status_changed', now, 'Tài khoản "Zalo Hà" đã đăng xuất', null))
    await s.push(item(105, 'package.expiring', now, 'Gói sắp hết hạn', null))
    await s.set('unread', 5)
    await s.refresh(); await p.clock.runFor(50)
    assert.equal(await toast(p).count(), 0, 'loại khác không nổi')
    await p.evaluate(() => { window.toastSmoke.server.items = window.toastSmoke.server.items.filter(x => x.id < 104) })
    await s.push(item(106, 'report.scheduled', now - 4 * 60 * MIN, 'Báo cáo 08:00 cũ', null))
    await s.set('unread', 6)
    await s.refresh(); await p.clock.runFor(50)
    assert.equal(await toast(p).count(), 0, 'quá 3 giờ không nổi')
    ok('thông báo tài khoản / hết hạn gói và thông báo cũ hơn 3 giờ: không nổi (vẫn ở chuông)')

    // 7. Đang ở trang Thông báo: không đọc danh sách, không hiện; rời trang không hiện lại cái cũ
    await p.evaluate(() => window.toastSmoke.setSuppressed(true))
    await waitFor(p, () => document.querySelector('[data-smoke-suppressed="true"]') !== null)
    const listBefore = await s.count('list')
    now = await s.now()
    await s.push(item(107, 'report.scheduled', now, 'Báo cáo 18:00 · Chủ Nhật 22/11', null))
    await s.set('unread', 7)
    await s.refresh(); await p.clock.runFor(50)
    assert.equal(await s.count('list'), listBefore, 'trên trang Thông báo không đọc danh sách')
    assert.equal(await toast(p).count(), 0)
    await p.evaluate(() => window.toastSmoke.setSuppressed(false))
    await waitFor(p, () => document.querySelector('[data-smoke-suppressed="false"]') !== null)
    await p.clock.runFor(50)
    assert.equal(await toast(p).count(), 0, 'rời trang Thông báo không hiện lại cái khách đã thấy trong danh sách')
    ok('đang ở trang Thông báo: không đọc danh sách, không hiện; rời trang không hiện bù')

    // 8. Cửa sổ thu nhỏ: để dành, cửa sổ hiện lại thì kiểm và hiện
    await s.set('hidden', true)
    now = await s.now()
    await s.push(item(108, 'campaign.status_changed', now, 'Chiến dịch "Tin cuối tuần" đã hoàn thành', null))
    await s.set('unread', 8)
    const listHidden = await s.count('list')
    await s.refresh(); await p.clock.runFor(50)
    assert.equal(await s.count('list'), listHidden, 'cửa sổ ẩn: chưa đọc danh sách')
    assert.equal(await toast(p).count(), 0)
    await s.set('hidden', false)
    await p.evaluate(() => window.toastSmoke.fireAttention()); await p.clock.runFor(50)
    await toast(p).waitFor()
    assert.match(await toast(p).innerText(), /Tin cuối tuần/)
    await toast(p).locator('.nc-toast-close').click()
    assert.equal(await toast(p).count(), 0)
    ok('cửa sổ ẩn: để dành, hiện lại thì đọc danh sách và nổi thẻ; nút X đóng thẻ')

    // 9. Mở lại app (đổi phiên rồi quay lại): không hiện lại thông báo đã hiện
    const listScope = await s.count('list')
    // Đăng xuất gỡ hẳn thông báo nổi (App trả trang đăng nhập khi chưa có user), đăng nhập gắn lại: mô phỏng bằng gỡ rồi gắn lại.
    await p.evaluate(() => window.toastSmoke.setMounted(false))
    await waitFor(p, () => document.querySelector('[data-smoke-mounted="false"]') !== null)
    const unreadBefore = await s.count('unreadCount')
    await p.evaluate(() => window.toastSmoke.setMounted(true))
    await waitFor(p, n => window.toastSmoke.count('unreadCount') > n, unreadBefore)
    await p.clock.runFor(100)
    assert.ok(await s.count('list') > listScope, 'vào lại: có đọc danh sách (số chưa đọc > 0)')
    assert.equal(await toast(p).count(), 0, 'thông báo 108 đã hiện ở phiên này thì không hiện lại')
    ok('mở lại / đổi phiên rồi quay lại: không hiện lại thông báo đã hiện (nhớ theo nhân viên)')
    assert.deepEqual(a.errors, [], `lỗi trang: ${a.errors.join(' | ')}`)
    await a.context.close()

    // ---------- Trang 2: hẹn giờ theo mốc báo cáo, không poll ----------
    const runAt = new Date(T0 + 2 * MIN).toISOString()
    const b = await open({ unread: 0, upcomingRunAts: [runAt, runAt, new Date(T0 + 30 * 60 * MIN).toISOString()] })
    const q = b.page, t = S(q)
    assert.equal(await t.count('unreadCount'), 1)
    // Ghi nhận cài đặt chỉ đọc khi trung tâm thông báo có (sau lượt hỏi số đầu tiên).
    assert.equal(await t.count('getSettings'), 1, 'đọc cài đặt một lần khi mở')
    // Báo cáo 12:02 được dựng lúc 12:02:30
    await q.clock.runFor(2 * MIN + 30_000)
    await t.push(item(201, 'report.scheduled', T0 + 2 * MIN + 30_000, 'Báo cáo 12:02', 'Thành công 10'))
    await t.set('unread', 1)
    await q.clock.runFor(29_000)
    assert.equal(await t.count('unreadCount'), 1, 'chưa tới mốc + 1 phút thì chưa hỏi')
    await q.clock.runFor(2_000)
    assert.equal(await t.count('unreadCount'), 2, 'mốc + 1 phút: hỏi số chưa đọc')
    await q.clock.runFor(50)
    await toast(q).waitFor()
    assert.match(await toast(q).innerText(), /Báo cáo 12:02/)
    await q.clock.runFor(4 * MIN)
    assert.equal(await t.count('unreadCount'), 3, 'mốc + 5 phút: hỏi lần hai (một lần cho hai mốc trùng)')
    await q.clock.runFor(10_000)
    assert.equal(await t.count('getSettings'), 2, 'sau lần hỏi cuối thì đọc lại cài đặt để hẹn đợt kế tiếp')
    const before = await t.count('unreadCount')
    await q.clock.runFor(20 * MIN)
    assert.equal(await t.count('unreadCount'), before, '20 phút không có mốc nào: không hỏi gì')
    ok('mốc báo cáo: hỏi số chưa đọc đúng + 1 và + 5 phút (mốc trùng gộp), thẻ nổi lên; giữa các mốc không đọc DB')

    // Chiến dịch trên trang chuyển "hoàn thành": 1 phút sau hỏi số chưa đọc
    await q.evaluate(() => window.toastSmoke.setCampaigns([{ id: 1, status: 'đang chạy' }, { id: 2, status: 'chờ xử lý' }]))
    await q.clock.runFor(50)
    await q.evaluate(() => window.toastSmoke.setCampaigns([{ id: 1, status: 'hoàn thành' }, { id: 2, status: 'chờ xử lý' }]))
    const c0 = await t.count('unreadCount')
    await q.clock.runFor(59_000)
    assert.equal(await t.count('unreadCount'), c0)
    await q.clock.runFor(2_000)
    assert.equal(await t.count('unreadCount'), c0 + 1, '1 phút sau khi chiến dịch hoàn thành: hỏi số chưa đọc một lần')
    await q.evaluate(() => window.toastSmoke.setCampaigns([{ id: 1, status: 'hoàn thành' }, { id: 2, status: 'chờ xử lý' }, { id: 3, status: 'hoàn thành' }]))
    await q.clock.runFor(2 * MIN)
    assert.equal(await t.count('unreadCount'), c0 + 1, 'chiến dịch mới xuất hiện đã "hoàn thành" không tính là vừa hoàn thành')
    ok('chiến dịch đang hiện chuyển "hoàn thành": hỏi số chưa đọc đúng 1 phút sau, một lần')

    // Một giờ không có gì: không có lượt đọc DB nào
    const idle = { unreadCount: await t.count('unreadCount'), list: await t.count('list'), getSettings: await t.count('getSettings') }
    await q.clock.runFor(60 * MIN)
    // Mốc thứ ba ở xa (+30 giờ, ngoài khoảng hẹn trước 26 giờ) chưa được hẹn: không có lượt hỏi nào.
    const scheduled = await t.count('unreadCount') - idle.unreadCount
    assert.equal(scheduled, 0, `không có lượt hỏi số nào (${scheduled})`)
    assert.equal(await t.count('list'), idle.list, 'không đọc danh sách khi số chưa đọc không tăng')
    assert.equal(await t.count('getSettings'), idle.getSettings, 'không đọc lại cài đặt')
    ok('một giờ để yên: 0 lượt hỏi số, 0 lượt đọc danh sách, 0 lượt đọc cài đặt (không poll)')
    assert.deepEqual(b.errors, [], `lỗi trang: ${b.errors.join(' | ')}`)
    await b.context.close()
  } finally {
    await browser.close()
    rmSync(directory, { recursive: true, force: true })
  }
  console.log(`OK ${cases} nhóm`)
}

main().catch(error => { console.error(error); process.exit(1) })
