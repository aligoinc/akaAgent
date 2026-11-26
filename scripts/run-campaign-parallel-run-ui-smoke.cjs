// "Chạy cùng lúc" (V670): ô tích trên form Desktop thật (Electron ẩn, IPC giả lập, chặn mọi request http).
// Chạy: node scripts/run-campaign-parallel-run-ui-smoke.cjs   (container cloud chạy bằng root: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a …)
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')
async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-parallel-run-ui-'))
  await build({ entryPoints: [join(__dirname, 'campaign-parallel-run-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-parallel-run-ui-smoke.css"><body><div id="root"></div><script src="campaign-parallel-run-ui-smoke.js"></script></body></html>')
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
    await page.waitForFunction(() => window.parallelRunSmoke)
    const open = (...args) => page.evaluate(a => window.parallelRunSmoke.open(...a), args)
    const box = page.getByRole('checkbox', { name: 'Chạy cùng lúc với chiến dịch khác của tài khoản' })
    const hint = page.getByText('Không chờ chiến dịch khác chạy xong. Chiến dịch cùng loại vẫn chạy lần lượt.')
    const settle = async () => { await page.getByText('Lịch chạy', { exact: false }).first().waitFor(); await page.waitForTimeout(400) }

    await open('zalo_cancel_sent_friend_request', 'new', true)
    await settle()
    await box.waitFor()
    assert.equal(await box.isChecked(), false)
    assert.equal(await hint.count(), 1)
    await box.check()
    assert.equal(await box.isChecked(), true)
    cases++

    await open('zalo_cancel_sent_friend_request', 'new', false)
    await settle()
    assert.equal(await box.count(), 0, 'tổ chức chưa bật engine v2: không có ô')
    cases++

    await open('zalo_message_friend', 'new', true)
    await settle()
    assert.equal(await box.count(), 0, 'loại chưa được bật: không có ô')
    cases++

    await open('zalo_cancel_sent_friend_request', 'edit', true, true)
    await settle()
    await box.waitFor()
    assert.equal(await box.isChecked(), true, 'sửa chiến dịch đã tích: ô đang tích')
    cases++

    await open('zalo_cancel_sent_friend_request', 'edit', true, true, 'info')
    await page.getByText('Chạy cùng lúc', { exact: true }).waitFor()
    cases++
    await open('zalo_message_friend', 'edit', true, true, 'info')
    await page.waitForTimeout(300)
    assert.equal(await page.getByText('Chạy cùng lúc', { exact: true }).count(), 0, 'chi tiết: loại chưa bật thì không có dòng')
    cases++

    // Lưu chiến dịch mới đã tích: dữ liệu gửi createCampaign có parallelRunEnabled = true; loại chưa bật thì không có khoá này.
    const save = async name => {
      await page.getByPlaceholder('Nhập tên chiến dịch...').fill(name)
      const before = await page.evaluate(() => window.parallelRunSmoke.state.created.length)
      await page.getByRole('button', { name: 'Lưu chiến dịch' }).click()
      await page.waitForFunction(n => window.parallelRunSmoke.state.created.length > n, before, { timeout: 15000 }).catch(() => undefined)
      const created = await page.evaluate(n => window.parallelRunSmoke.state.created[n] ?? null, before)
      if (!created) {
        console.log('alerts', JSON.stringify(await page.evaluate(() => window.parallelRunSmoke.state.alerts)).slice(0, 600))
        throw new Error(`Lưu "${name}" không gọi createCampaign`)
      }
      return created
    }
    await open('zalo_cancel_sent_friend_request', 'new', true)
    await settle()
    await box.check()
    const ticked = await save('Huỷ lời mời cùng lúc')
    assert.equal(ticked.actionId, 'zalo_cancel_sent_friend_request')
    assert.equal(ticked.parallelRunEnabled, true, 'lưu: gửi parallelRunEnabled = true')
    cases++
    await open('zalo_cancel_sent_friend_request', 'new', true)
    await settle()
    const unticked = await save('Huỷ lời mời không tích')
    assert.equal(unticked.parallelRunEnabled, false, 'lưu không tích: gửi parallelRunEnabled = false')
    cases++
    await open('zalo_cancel_sent_friend_request', 'new', false)
    await settle()
    const noEngine = await save('Huỷ lời mời chưa có engine v2')
    assert.equal('parallelRunEnabled' in noEngine, false, 'ô không hiện: không gửi khoá parallelRunEnabled (DB chưa có cột vẫn lưu được)')
    cases++

    const errors = await page.evaluate(() => window.parallelRunSmoke.state.errors)
    assert.deepEqual(errors, [], 'không có lỗi trên trang')
    console.log(`PASS Chạy cùng lúc trên form Desktop: ${cases} ca`)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exit(1) })
