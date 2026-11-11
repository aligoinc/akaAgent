// "Gửi lặp lại sau mỗi x phút" trên form Desktop thật (Electron ẩn, IPC giả lập, chặn mọi request http).
// Container cloud chạy bằng root: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-zalo-share-repeat-ui-smoke.cjs
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')
async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-share-repeat-ui-'))
  await build({ entryPoints: [join(__dirname, 'zalo-share-repeat-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="zalo-share-repeat-ui-smoke.css"><body><div id="root"></div><script src="zalo-share-repeat-ui-smoke.js"></script></body></html>')
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
    await page.waitForFunction(() => window.shareRepeatSmoke)
    const open = (actionId, mode, enabled, extra) => page.evaluate(args => window.shareRepeatSmoke.open(...args), [actionId, mode, enabled, extra || {}])
    const panel = page.locator('.schedule-multi-window-panel')
    const share = page.getByRole('checkbox', { name: /Gửi dạng chia sẻ tin nhắn/ })
    const multi = panel.getByRole('checkbox', { name: 'Chạy trong nhiều khung giờ trong 1 ngày' })
    const repeat = panel.getByRole('checkbox', { name: 'Gửi lặp lại sau mỗi' })
    const minutes = panel.getByLabel('Số phút gửi lặp lại')
    const cooldown = page.getByRole('checkbox', { name: /Không gửi tin cho những/ })
    const errors = () => page.evaluate(() => window.shareRepeatSmoke.state.errors)
    for (const actionId of ['zalo_message_friend', 'zalo_message_group']) {
      // 1. Công tắc tắt: tick chia sẻ vẫn không có ô gửi lặp.
      await open(actionId, 'new', false)
      await share.check()
      await panel.getByText('Cài đặt chạy nhiều khung giờ trong 1 ngày').waitFor()
      assert.equal(await panel.getByText('Gửi lặp lại sau mỗi').count(), 0)
      assert.equal(await minutes.count(), 0)
      cases++

      // 2. Công tắc bật: chỉ hiện khi tick chia sẻ; hai ô loại trừ nhau; khoá ô chống gửi lặp.
      await open(actionId, 'new', true)
      await panel.getByText('Cài đặt chạy nhiều khung giờ trong 1 ngày').waitFor()
      assert.equal(await panel.getByText('Gửi lặp lại sau mỗi').count(), 0)
      await share.check()
      await panel.getByText('Cài đặt chạy lặp lại trong 1 ngày').waitFor()
      await panel.getByText('Chọn 1 trong 2 cách').waitFor()
      assert.equal(await minutes.isDisabled(), true)
      await cooldown.check()
      await multi.check()
      await repeat.check()
      assert.equal(await multi.isChecked(), false)
      assert.equal(await minutes.isEnabled(), true)
      assert.equal(await minutes.inputValue(), '60')
      await panel.getByText(/Thời gian chạy lại tính sau khi chiến dịch hoàn thành lượt gửi trước/).waitFor()
      assert.equal(await cooldown.isChecked(), false)
      assert.equal(await cooldown.isDisabled(), true)
      await page.getByText(/Đang bật “Gửi lặp lại sau mỗi x phút” ở phần lịch nên tuỳ chọn này tự tắt/).waitFor()
      await panel.getByRole('button', { name: '30 phút' }).click()
      assert.equal(await minutes.inputValue(), '30')
      await multi.check()
      assert.equal(await repeat.isChecked(), false)
      assert.equal(await minutes.isDisabled(), true)
      assert.equal(await cooldown.isEnabled(), true)
      await repeat.check()
      // Bỏ tick chia sẻ thì khung về như cũ; tick lại thì lựa chọn và số phút vẫn còn.
      await share.uncheck()
      await panel.getByText('Cài đặt chạy nhiều khung giờ trong 1 ngày').waitFor()
      assert.equal(await panel.getByText('Gửi lặp lại sau mỗi').count(), 0)
      await share.check()
      assert.equal(await repeat.isChecked(), true)
      assert.equal(await minutes.inputValue(), '30')
      // Lưu nháp giữ đúng lựa chọn và số phút (form đóng sau khi lưu nháp).
      await page.getByPlaceholder('Nhập tên chiến dịch...').fill('Share repeat fixture')
      await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
      await page.waitForFunction(() => window.shareRepeatSmoke.state.calls.some(call => call.method === 'saveCampaignDraft'))
      const draft = await page.evaluate(() => window.shareRepeatSmoke.state.calls.filter(call => call.method === 'saveCampaignDraft').at(-1).args[0].payload.values.formData)
      assert.equal(draft.zaloShareRepeatEnabled, true)
      assert.equal(draft.zaloShareRepeatAfterMinutes, '30')
      assert.equal(draft.multiDailyTimeSlotsEnabled, false)
      assert.equal(draft.recentDeliveryCooldownEnabled, false)
      assert.deepEqual(await errors(), [])
      cases++
    }

    // 3. Sửa chiến dịch đang bật gửi lặp: đọc lại đúng cài đặt đã lưu, ô chống gửi lặp bị khoá, số phút sai bị chặn khi lưu.
    await open('zalo_message_group', 'edit', true, { zaloShareRepeatEnabled: true, zaloShareRepeatAfterMinutes: 45 })
    await panel.getByText('Cài đặt chạy lặp lại trong 1 ngày').waitFor()
    assert.equal(await repeat.isChecked(), true)
    assert.equal(await minutes.inputValue(), '45')
    assert.equal(await cooldown.isDisabled(), true)
    await minutes.fill('2')
    await page.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).click()
    await page.waitForFunction(() => window.shareRepeatSmoke.state.alerts.some(alert => alert.message === 'Số phút gửi lặp lại phải là số nguyên từ 5 đến 1439.'))
    assert.equal(await page.evaluate(() => window.shareRepeatSmoke.state.calls.some(call => call.method === 'updateCampaign')), false)
    cases++

    // 4. Công tắc tắt: chiến dịch đang bật gửi lặp vẫn mở được, ô gửi lặp ẩn và ô chống gửi lặp không bị khoá.
    await open('zalo_message_group', 'edit', false, { zaloShareRepeatEnabled: true, zaloShareRepeatAfterMinutes: 45 })
    await panel.getByText('Cài đặt chạy nhiều khung giờ trong 1 ngày').waitFor()
    assert.equal(await panel.getByText('Gửi lặp lại sau mỗi').count(), 0)
    assert.equal(await cooldown.isEnabled(), true)
    assert.deepEqual(await errors(), [])
    cases++

    console.log(`PASS ${cases} Desktop share-repeat UI cases: công tắc tắt/bật, friend/group, chọn một trong hai, khoá chống gửi lặp, lưu nháp, đọc lại khi sửa, kiểm số phút`)
  } catch (error) {
    try {
      const page = await app.firstWindow()
      console.error('alerts:', JSON.stringify(await page.evaluate(() => window.shareRepeatSmoke?.state.alerts)))
      console.error('calls:', JSON.stringify(await page.evaluate(() => window.shareRepeatSmoke?.state.calls.map(call => call.method).slice(-25))))
      console.error('buttons:', JSON.stringify(await page.getByRole('button').allInnerTexts()).slice(0, 600))
      console.error('body:', (await page.evaluate(() => document.body.innerText)).slice(0, 600))
      console.error('errors:', JSON.stringify(await page.evaluate(() => window.shareRepeatSmoke?.state.errors)).slice(0, 800))
    } catch {}
    throw error
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
