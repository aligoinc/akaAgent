// "Lặp lại sau khi chạy xong" trên form Desktop thật (Electron ẩn, IPC giả lập, chặn mọi request http).
// Container cloud chạy bằng root: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-campaign-repeat-ui-smoke.cjs
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')
async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-campaign-repeat-ui-'))
  await build({ entryPoints: [join(__dirname, 'campaign-repeat-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-repeat-ui-smoke.css"><body><div id="root"></div><script src="campaign-repeat-ui-smoke.js"></script></body></html>')
  writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
    const win = new BrowserWindow({ show: false, width: 1550, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
    win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
  });`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
  let cases = 0
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000)
    await page.waitForFunction(() => window.campaignRepeatSmoke)
    const open = (actionId, mode, audience, extra, more) => page.evaluate(args => window.campaignRepeatSmoke.open(...args), [actionId, mode, audience, extra || {}, more || {}])
    const panel = page.locator('.schedule-repeat-panel')
    const toggle = panel.getByRole('checkbox', { name: /Chạy hết danh sách thì tự chạy lại/ })
    const every = panel.getByLabel('Khoảng lặp lại')
    const runs = panel.getByLabel('Số lượt tối đa')
    const unit = panel.getByLabel('Đơn vị lặp lại')
    // Ngày kết thúc là ô sẵn có của phần Lịch (cạnh "Ngày chạy"), không nằm trong khung lặp lại.
    const endDate = page.getByLabel('Ngày kết thúc', { exact: true })
    const stopTime = page.getByText('Giờ dừng chạy trong ngày')
    const errors = () => page.evaluate(() => window.campaignRepeatSmoke.state.errors)
    const draft = async () => {
      await page.getByPlaceholder('Nhập tên chiến dịch...').fill('Repeat fixture')
      await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
      await page.waitForFunction(() => window.campaignRepeatSmoke.state.calls.some(call => call.method === 'saveCampaignDraft'))
      return page.evaluate(() => window.campaignRepeatSmoke.state.calls.filter(call => call.method === 'saveCampaignDraft').at(-1).args[0].payload.values.formData)
    }

    // 1. Công tắc tắt, hoặc chỉ mở cho admin akaBiz mà tài khoản không phải admin: không có nhóm lặp.
    for (const [audience, admin] of [['off', true], ['admin_akabiz', false]]) {
      await open('zalo_message_phone', 'new', audience, {}, { admin })
      await stopTime.first().waitFor()
      assert.equal(await panel.count(), 0, `${audience} admin=${admin}`)
      cases++
    }

    // 2. Nhắn tin theo SĐT (admin akaBiz, công tắc admin_akabiz): chỉ lặp theo ngày; bật thì có khoảng lặp, số lượt, ngày kết thúc.
    await open('zalo_message_phone', 'new', 'admin_akabiz', {}, { admin: true })
    await panel.getByText('Lặp lại sau khi chạy xong').waitFor()
    assert.equal(await toggle.isChecked(), false)
    assert.equal(await runs.count(), 0)
    assert.equal(await endDate.count(), 0, 'lịch Hàng ngày chưa bật lặp: không có ô ngày kết thúc')
    await toggle.check()
    assert.equal(await panel.getByLabel('Ngày kết thúc', { exact: true }).count(), 0, 'khung lặp lại không có ô ngày kết thúc riêng')
    assert.equal(await every.inputValue(), '1')
    assert.equal(await runs.inputValue(), '2')
    assert.equal(await unit.count(), 0)
    await every.fill('3'); await runs.fill('5'); await endDate.fill('2035-12-31')
    await panel.getByText(/Dừng khi đủ số lượt tối đa hoặc tới "Ngày kết thúc" của lịch/).waitFor()
    // Lịch tuần không có nhóm này; quay lại Hàng ngày thì cài đặt vừa nhập còn nguyên.
    await page.getByRole('radio', { name: 'Theo tuần' }).check()
    assert.equal(await panel.count(), 0)
    await page.getByRole('radio', { name: 'Hàng ngày' }).check()
    assert.equal(await every.inputValue(), '3')
    let saved = await draft()
    assert.deepEqual([saved.repeatAfterCompletionEnabled, saved.repeatAfterCompletionEvery, saved.repeatAfterCompletionUnit, saved.repeatAfterCompletionMaxRuns, saved.repeatEndDate],
      [true, '3', 'day', '5', '2035-12-31'])
    assert.deepEqual(await errors(), [])
    cases++

    // 3. Nhắn group: chọn giờ hoặc ngày; loại trừ với nhiều khung giờ.
    await open('zalo_message_group', 'new', 'all')
    await panel.getByText('Lặp lại sau khi chạy xong').waitFor()
    const multi = page.getByRole('checkbox', { name: 'Chạy trong nhiều khung giờ trong 1 ngày' })
    await multi.check()
    await toggle.check()
    assert.equal(await multi.isChecked(), false)
    assert.deepEqual(await unit.locator('option').allInnerTexts(), ['giờ', 'ngày'])
    await unit.selectOption('hour')
    await every.fill('6')
    await multi.check()
    assert.equal(await toggle.isChecked(), false)
    assert.equal(await runs.count(), 0)
    await toggle.check()
    saved = await draft()
    assert.deepEqual([saved.repeatAfterCompletionEnabled, saved.repeatAfterCompletionEvery, saved.repeatAfterCompletionUnit, saved.multiDailyTimeSlotsEnabled], [true, '6', 'hour', false])
    assert.deepEqual(await errors(), [])
    cases++

    // 4. Sửa chiến dịch đang lặp: đọc lại đúng cài đặt và ngày kết thúc đã lưu; số lượt sai bị chặn khi lưu.
    const savedRepeat = { repeatAfterCompletionEnabled: true, repeatAfterCompletionEvery: 4, repeatAfterCompletionUnit: 'day', repeatAfterCompletionMaxRuns: 7 }
    await open('zalo_message_phone', 'edit', 'all', savedRepeat, { scheduleEndDate: '2035-06-30T16:59:59.000Z' })
    await panel.getByText('Lặp lại sau khi chạy xong').waitFor()
    assert.equal(await toggle.isChecked(), true)
    assert.deepEqual([await every.inputValue(), await runs.inputValue(), await endDate.inputValue()], ['4', '7', '2035-06-30'])
    await runs.fill('1')
    await page.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).click()
    await page.waitForFunction(() => window.campaignRepeatSmoke.state.alerts.some(alert => alert.message === 'Số lượt tối đa phải là số nguyên từ 2 đến 100 (tính cả lượt đầu).'))
    assert.equal(await page.evaluate(() => window.campaignRepeatSmoke.state.calls.some(call => call.method === 'updateCampaign')), false)
    cases++

    // 5. Công tắc tắt: chiến dịch đang lặp vẫn mở được và nhóm lặp ẩn (chế độ sửa không có nút Lưu nháp; phần giữ cài đặt khi lưu
    // nằm ở usesCampaignRepeat, chưa có ca ghi qua form).
    await open('zalo_message_phone', 'edit', 'off', savedRepeat)
    await stopTime.first().waitFor()
    assert.equal(await panel.count(), 0)
    assert.deepEqual(await errors(), [])
    cases++

    // 6. Tìm data theo group (Facebook): khung mới thay ô "Chạy lại sau mỗi x giờ" khi lịch Hàng ngày; chọn được phút, giờ, ngày.
    await open('facebook_find_data_group', 'new', 'all')
    await panel.getByText('Lặp lại sau khi chạy xong').waitFor()
    await toggle.check()
    assert.deepEqual(await unit.locator('option').allInnerTexts(), ['phút', 'giờ', 'ngày'])
    assert.equal(await page.getByRole('checkbox', { name: /Chạy lại sau mỗi/ }).count(), 0, 'ô kiểu cũ ẩn khi có khung mới')
    assert.deepEqual(await errors(), [])
    cases++

    // 7. Sửa chiến dịch Facebook đang lưu "Chạy lại sau mỗi 3 giờ" kiểu cũ: form đổi sang cài đặt mới (3 giờ, số lượt đề xuất 8).
    await open('facebook_find_data_group', 'edit', 'all', { findDataRerunEnabled: true, findDataRerunAfterHours: 3 })
    await panel.getByText('Lặp lại sau khi chạy xong').waitFor()
    assert.equal(await toggle.isChecked(), true)
    assert.deepEqual([await every.inputValue(), await unit.inputValue(), await runs.inputValue()], ['3', 'hour', '8'])
    // Lịch tuần: khung mới không áp dụng, ô kiểu cũ còn nguyên và đang bật.
    await open('facebook_find_data_group', 'edit', 'all', { findDataRerunEnabled: true, findDataRerunAfterHours: 3 }, { scheduleType: 'weekly' })
    await stopTime.first().waitFor()
    assert.equal(await panel.count(), 0)
    assert.equal(await page.getByRole('checkbox', { name: /Chạy lại sau mỗi/ }).isChecked(), true)
    // Công tắc chưa mở: giữ ô kiểu cũ, không đổi gì.
    await open('facebook_find_data_group', 'edit', 'off', { findDataRerunEnabled: true, findDataRerunAfterHours: 3 })
    await stopTime.first().waitFor()
    assert.equal(await panel.count(), 0)
    assert.equal(await page.getByRole('checkbox', { name: /Chạy lại sau mỗi/ }).isChecked(), true)
    assert.deepEqual(await errors(), [])
    cases++

    console.log(`PASS ${cases} Desktop campaign-repeat UI cases: công tắc tắt / chỉ admin, theo SĐT (ngày), nhắn group (giờ / ngày, loại trừ nhiều khung giờ), lưu nháp, đọc lại khi sửa, kiểm số lượt`)
  } catch (error) {
    try {
      const page = await app.firstWindow()
      console.error('alerts:', JSON.stringify(await page.evaluate(() => window.campaignRepeatSmoke?.state.alerts)))
      console.error('calls:', JSON.stringify(await page.evaluate(() => window.campaignRepeatSmoke?.state.calls.map(call => call.method).slice(-25))))
      console.error('body:', (await page.evaluate(() => document.body.innerText)).slice(0, 900))
      console.error('errors:', JSON.stringify(await page.evaluate(() => window.campaignRepeatSmoke?.state.errors)).slice(0, 800))
    } catch {}
    throw error
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
