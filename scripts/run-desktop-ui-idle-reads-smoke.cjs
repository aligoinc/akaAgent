// Bộ điều phối đọc của giao diện Desktop khi không ai nhìn (docs/DESKTOP_UI_IDLE_READS.md).
// Store/panel/bộ điều phối thật, IPC giả, chặn mọi HTTP, đồng hồ giả. Không DB, không chạy chiến dịch.
// Chạy: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-desktop-ui-idle-reads-smoke.cjs
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

const PAGE = 'getDesktopCampaignPage'
const ACCOUNT = 'getDesktopAccountSnapshot'
const ATTENTION = 'getDesktopUiAttention'

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-desktop-ui-idle-'))
  let app
  try {
    await build({ entryPoints: [join(__dirname, 'desktop-ui-reads-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning',
    })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="desktop-ui-reads-smoke.css"><body><div id="root"></div><script src="desktop-ui-reads-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 1600, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    await page.waitForFunction(() => window.desktopSmoke?.store.getState().campaignPage?.total === 1205)

    const evaluate = (fn, arg) => page.evaluate(fn, arg)
    const count = method => evaluate(method => window.desktopSmoke.state.calls.filter(call => call.method === method).length, method)
    const counts = async () => ({ page: await count(PAGE), account: await count(ACCOUNT), attention: await count(ATTENTION) })
    const lastPageArgs = () => evaluate(method => {
      const calls = window.desktopSmoke.state.calls.filter(call => call.method === method)
      const args = calls[calls.length - 1].args
      return { length: args.length, options: args[1] ?? null }
    }, PAGE)
    const settings = extra => evaluate(extra => window.desktopSmoke.polling.setState({ settings: { accounts: 30, campaigns: 30, ...extra } }), extra)
    const attention = value => evaluate(value => { Object.assign(window.desktopSmoke.state, value) }, value)
    const settled = () => page.waitForFunction(() => {
      const s = window.desktopSmoke.store.getState()
      return !s.campaignPageDirty && s.campaignPageResultKey === JSON.stringify(s.campaignPageQuery)
    })
    const delta = async (before, key) => (await count(key === 'page' ? PAGE : key === 'account' ? ACCOUNT : ATTENTION)) - before[key]
    // Một thay đổi trạng thái thật của chiến dịch đang ở trang hiện tại (bộ chạy báo qua IPC).
    let stamp = 0
    const stateEvent = () => evaluate(stamp => {
      const row = window.desktopSmoke.store.getState().campaigns[0]
      window.desktopSmoke.store.getState().upsertCampaign({ id: row.id, note: `ghi chú ${stamp}`, updatedAt: `2099-01-01T00:00:${String(stamp).padStart(2, '0')}Z` })
      window.desktopSmoke.accountEvent()
    }, ++stamp)

    await settled()
    await page.clock.install()
    await page.clock.pauseAt(new Date())
    await evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.clock.runFor(30050)
    await settled()

    // ── 1. Mặc định (không có dòng cài đặt nào): đúng như trước ─────────────────────
    let before = await counts()
    await page.clock.runFor(90000)
    assert.equal(await delta(before, 'page'), 3)
    assert.equal(await delta(before, 'account'), 3)
    assert.equal(await count(ATTENTION), 0, 'khóa tắt thì không hỏi trạng thái cửa sổ')
    assert.deepEqual(await lastPageArgs(), { length: 1, options: null }, 'khóa tắt thì lượt đọc trang gọi đúng một tham số như trước')
    await attention({ attention: { hidden: true, idleSeconds: 9999 } })
    await evaluate(() => window.desktopSmoke.emit('attention'))
    before = await counts()
    await page.clock.runFor(90000)
    assert.equal(await delta(before, 'page'), 3, 'khóa tắt: cửa sổ ẩn + máy không có thao tác vẫn đọc 30 giây/lượt')
    assert.equal(await delta(before, 'account'), 3)
    assert.equal(await count(ATTENTION), 0)
    await attention({ attention: { hidden: false, idleSeconds: 0 } })
    console.log('PASS mặc định: 30 giây/lượt, không hỏi trạng thái cửa sổ, lượt đọc trang không đổi tham số')

    // ── 2. Ngừng khi cửa sổ thu nhỏ/ẩn/khóa màn hình ────────────────────────────────
    await settings({ hiddenPauseEnabled: true })
    before = await counts()
    await page.clock.runFor(60000)
    assert.equal(await delta(before, 'page'), 2, 'bật khóa nhưng cửa sổ đang hiện: vẫn 30 giây/lượt')
    assert.equal(await delta(before, 'account'), 2)
    assert.ok(await delta(before, 'attention') >= 2, 'mỗi lượt hẹn giờ hỏi trạng thái cửa sổ trước khi đọc')

    await attention({ attention: { hidden: true, idleSeconds: 5 } })
    await evaluate(() => window.desktopSmoke.emit('attention'))
    await page.clock.runFor(10)
    before = await counts()
    await page.clock.runFor(300000)
    assert.equal(await delta(before, 'page'), 0, 'cửa sổ ẩn 5 phút: không đọc trang')
    assert.equal(await delta(before, 'account'), 0, 'cửa sổ ẩn 5 phút: không đọc tài khoản')
    const asked = await delta(before, 'attention')
    assert.ok(asked >= 9 && asked <= 11, `khi ẩn chỉ hỏi lại trạng thái cửa sổ khoảng 30 giây/lượt (lệnh nội bộ), thực tế ${asked}`)
    for (let i = 0; i < 5; i++) await stateEvent()
    await page.clock.runFor(2000)
    assert.equal(await delta(before, 'page'), 0, 'sự kiện trạng thái khi đang ẩn không gây đọc')
    assert.equal(await delta(before, 'account'), 0)
    assert.equal(await evaluate(() => window.desktopSmoke.store.getState().campaigns[0].note), 'ghi chú 5', 'trạng thái từ bộ chạy vẫn cập nhật trong bộ nhớ khi đang ẩn')

    await attention({ attention: { hidden: false, idleSeconds: 0 } })
    await evaluate(() => window.desktopSmoke.emit('attention'))
    await page.clock.runFor(10)
    await settled()
    assert.equal(await delta(before, 'page'), 1, 'quay lại: đọc ngay đúng một lượt, không đọc bù')
    assert.equal(await delta(before, 'account'), 1)
    before = await counts()
    await page.clock.runFor(60000)
    assert.equal(await delta(before, 'page'), 2, 'sau khi quay lại: về nhịp 30 giây')
    console.log('PASS ẩn: không đọc DB kể cả khi có sự kiện, trạng thái vẫn cập nhật trong bộ nhớ; hiện lại đọc ngay một lượt')

    // Lỡ tín hiệu "hiện lại": lượt hỏi định kỳ tự bắt kịp trong một chu kỳ.
    await attention({ attention: { hidden: true, idleSeconds: 5 } })
    await page.clock.runFor(30050)
    before = await counts()
    await page.clock.runFor(60000)
    assert.equal(await delta(before, 'page'), 0)
    await attention({ attention: { hidden: false, idleSeconds: 0 } })
    await page.clock.runFor(30050)
    assert.ok(await delta(before, 'page') >= 1, 'không có tín hiệu hiện lại vẫn đọc tiếp sau lượt hỏi định kỳ')
    await settled()

    // Tiến trình chính báo sai là đang ẩn trong khi người dùng đang thao tác ngay trong cửa sổ.
    await attention({ attention: { hidden: true, idleSeconds: 5 } })
    await page.clock.runFor(60100)
    before = await counts()
    await page.clock.runFor(60000)
    assert.equal(await delta(before, 'page'), 0)
    await evaluate(() => window.dispatchEvent(new Event('pointerdown')))
    await page.clock.runFor(10)
    await settled()
    assert.equal(await delta(before, 'page'), 1, 'thao tác trong cửa sổ: đọc ngay dù tiến trình chính vẫn báo ẩn')
    assert.equal(await delta(before, 'account'), 1)
    for (let second = 0; second < 90; second += 10) {
      await evaluate(() => window.dispatchEvent(new Event('pointermove')))
      await page.clock.runFor(10000)
    }
    assert.ok(await delta(before, 'page') >= 3, 'còn thao tác trong cửa sổ thì đọc theo nhịp thường')
    console.log('PASS lỡ tín hiệu hiện lại và báo sai "đang ẩn" đều không làm màn hình đứng số')

    // Lệnh hỏi trạng thái lỗi hoặc treo: coi như đang có người nhìn.
    await attention({ attentionFail: true, attention: { hidden: true, idleSeconds: 9999 } })
    await page.clock.runFor(60100)
    before = await counts()
    await page.clock.runFor(90000)
    assert.equal(await delta(before, 'page'), 3, 'lệnh hỏi lỗi: đọc 30 giây/lượt như trước')
    assert.equal(await delta(before, 'account'), 3)
    await attention({ attentionFail: false, attentionHang: true })
    before = await counts()
    await page.clock.runFor(120000)
    assert.ok(await delta(before, 'page') >= 3, 'lệnh hỏi treo: sau hạn chờ 5 giây vẫn đọc')
    assert.ok(await delta(before, 'account') >= 3)
    await attention({ attentionHang: false, attention: { hidden: false, idleSeconds: 0 } })
    await page.clock.runFor(40000)
    await settled()
    console.log('PASS lệnh hỏi trạng thái lỗi hoặc treo: giao diện đọc như trước, không kẹt')

    // ── 3. Giãn khi cả máy không có thao tác ────────────────────────────────────────
    await settings({ idleAfterSeconds: 600, idlePollSeconds: 120 })
    await attention({ attention: { hidden: false, idleSeconds: 599 } })
    await page.clock.runFor(30050)
    before = await counts()
    await page.clock.runFor(90000)
    assert.equal(await delta(before, 'page'), 3, 'chưa tới ngưỡng không thao tác: 30 giây/lượt')
    await attention({ attention: { hidden: false, idleSeconds: 700 } })
    await page.clock.runFor(120000)
    before = await counts()
    await page.clock.runFor(600000)
    const idlePages = await delta(before, 'page')
    const idleAccounts = await delta(before, 'account')
    assert.ok(idlePages >= 4 && idlePages <= 6, `không thao tác: khoảng 120 giây/lượt (10 phút ≈ 5 lượt thay vì 20), thực tế ${idlePages}`)
    assert.ok(idleAccounts >= 4 && idleAccounts <= 6, `tài khoản cũng giãn, thực tế ${idleAccounts}`)
    assert.equal(await delta(before, 'page') + 0, idlePages)
    // Cửa sổ ẩn nhưng chỉ bật khóa giãn: không ngừng hẳn.
    await attention({ attention: { hidden: true, idleSeconds: 700 } })
    before = await counts()
    await page.clock.runFor(300000)
    assert.ok(await delta(before, 'page') >= 2, 'chỉ bật giãn: cửa sổ ẩn vẫn đọc theo chu kỳ giãn, không ngừng')
    await attention({ attention: { hidden: false, idleSeconds: 700 } })
    await page.clock.runFor(30050)
    await settled()
    before = await counts()
    await stateEvent()
    await page.clock.runFor(400)
    await settled()
    assert.equal(await delta(before, 'page'), 1, 'đang giãn: sự kiện trạng thái vẫn đọc sau 300 ms')
    assert.equal(await delta(before, 'account'), 1)
    // Có người dùng máy trở lại nhưng chưa chạm vào cửa sổ app: lượt hỏi định kỳ đưa về nhịp thường.
    await attention({ attention: { hidden: false, idleSeconds: 2 } })
    await page.clock.runFor(30050)
    before = await counts()
    await page.clock.runFor(90000)
    assert.equal(await delta(before, 'page'), 3, 'máy có thao tác trở lại: về 30 giây/lượt')
    // Đang giãn mà chạm vào cửa sổ: đọc ngay nếu số đã cũ hơn chu kỳ thường.
    await attention({ attention: { hidden: false, idleSeconds: 700 } })
    await page.clock.runFor(30050)
    await page.clock.runFor(35000)
    before = await counts()
    await evaluate(() => window.dispatchEvent(new Event('keydown')))
    await page.clock.runFor(10)
    await settled()
    assert.equal(await delta(before, 'page'), 1, 'đang giãn: chạm vào cửa sổ là đọc ngay')
    await attention({ attention: { hidden: false, idleSeconds: 0 } })
    await page.clock.runFor(60000)
    await settled()
    console.log('PASS giãn khi không thao tác: ~120 giây/lượt, sự kiện vẫn đọc ngay, có thao tác là về nhịp thường')

    // ── 4. Cách đếm tiến độ gửi kèm lượt đọc trang ──────────────────────────────────
    await settings({ progressRecountSeconds: 300 })
    await page.clock.runFor(30050)
    await settled()
    assert.deepEqual(await lastPageArgs(), { length: 2, options: { progress: 'reuse', recountSeconds: 300 } }, 'lượt hẹn giờ dùng lại số tiến độ')
    await stateEvent()
    await page.clock.runFor(400)
    await settled()
    assert.deepEqual(await lastPageArgs(), { length: 2, options: { progress: 'reuse', recountSeconds: 300 } }, 'lượt theo sự kiện cũng là lượt nền')
    await evaluate(() => window.desktopSmoke.store.getState().loadCampaigns({ silent: true }))
    await settled()
    assert.deepEqual(await lastPageArgs(), { length: 2, options: { progress: 'full', recountSeconds: 300 } }, 'lượt đọc sau thao tác đếm tất cả')
    await page.getByTitle('Làm mới', { exact: true }).click()
    await settled()
    assert.deepEqual(await lastPageArgs(), { length: 2, options: { progress: 'full', recountSeconds: 300 } }, 'nút Làm mới đếm tất cả')
    // Lượt nền đang chạy thì có thao tác: lượt đọc nối tiếp phải đếm tất cả.
    await evaluate(() => { window.desktopSmoke.state.hold = 'campaign' })
    before = await counts()
    await page.clock.runFor(30050)
    await page.waitForFunction(() => !!window.desktopSmoke.state.release)
    assert.deepEqual((await lastPageArgs()).options, { progress: 'reuse', recountSeconds: 300 })
    await evaluate(() => {
      void window.desktopSmoke.store.getState().loadCampaigns({ silent: true })
      const release = window.desktopSmoke.state.release
      window.desktopSmoke.state.hold = null
      window.desktopSmoke.state.release = null
      release()
    })
    await page.waitForFunction(({ method, expected }) => window.desktopSmoke.state.calls.filter(call => call.method === method).length >= expected, { method: PAGE, expected: before.page + 2 })
    await settled()
    assert.deepEqual((await lastPageArgs()).options, { progress: 'full', recountSeconds: 300 }, 'lượt nối tiếp sau thao tác đếm tất cả')
    await settings({})
    await page.clock.runFor(30050)
    await settled()
    assert.deepEqual(await lastPageArgs(), { length: 1, options: null }, 'tắt khóa: về đúng lời gọi một tham số')
    console.log('PASS cách đếm tiến độ: lượt nền dùng lại, lượt do người dùng và lượt nối tiếp đếm tất cả, tắt khóa là như trước')

    const errors = await evaluate(() => window.desktopSmoke.state.errors)
    assert.deepEqual(errors, [], 'không có lỗi giao diện trong suốt lượt thử')
    console.log('PASS không có lỗi giao diện')
  } finally {
    if (app) await app.close().catch(() => {})
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })
