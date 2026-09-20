const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')
async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-rich-share-ui-'))
  await build({ entryPoints: [join(__dirname, 'zalo-rich-share-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="zalo-rich-share-ui-smoke.css"><body><div id="root"></div><script src="zalo-rich-share-ui-smoke.js"></script></body></html>')
  writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
    const win = new BrowserWindow({ show: false, width: 1550, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
    win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
  });`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000)
    await page.waitForFunction(() => window.richShareSmoke)
    for (const actionId of ['zalo_message_friend', 'zalo_message_group']) {
      for (const mode of ['new', 'edit', 'quick']) {
        await page.evaluate(({ actionId, mode }) => window.richShareSmoke.open(actionId, mode), { actionId, mode })
        const rich = page.getByRole('checkbox', { name: /Nội dung có định dạng/ })
        if (mode === 'new') {
          const share = page.getByRole('checkbox', { name: /Gửi dạng chia sẻ tin nhắn/ })
          await share.check(); await rich.check(); assert.equal(await share.isChecked(), true)
          await share.uncheck(); await share.check(); assert.equal(await rich.isChecked(), true)
          await page.locator('.tiptap').fill('Chào bạn')
          await page.getByPlaceholder('Nhập tên chiến dịch...').fill('Rich share fixture')
        } else {
          assert.equal(await rich.isChecked(), true)
          assert.equal(await page.locator('.tiptap strong').innerText(), 'Chào bạn')
        }
        if (mode === 'edit') {
          assert.equal(await page.getByRole('checkbox', { name: /Gửi dạng chia sẻ tin nhắn/ }).isChecked(), true)
          continue
        }
        if (mode === 'quick') {
          await page.getByRole('button', { name: 'Lưu', exact: true }).click()
          await page.waitForFunction(() => window.richShareSmoke.state.calls.some(call => call.method === 'updateCampaign'))
          const saved = await page.evaluate(() => window.richShareSmoke.state.calls.find(call => call.method === 'updateCampaign').args[1])
          assert.equal(saved.extraSettings.zaloMessageSendMode, 'share')
          assert.equal(saved.extraSettings.formattedContentEnabled, true)
        } else {
          await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
          await page.waitForFunction(() => window.richShareSmoke.state.calls.some(call => call.method === 'saveCampaignDraft'))
          const draft = await page.evaluate(() => window.richShareSmoke.state.calls.find(call => call.method === 'saveCampaignDraft').args[0])
          assert.equal(draft.payload.values.formData.zaloMessageSendMode, 'share')
          assert.equal(draft.payload.values.formData.formattedContentEnabled, true)
        }
        assert.deepEqual(await page.evaluate(() => window.richShareSmoke.state.errors), [])
      }
    }
    console.log('PASS: Desktop friend/group rich share toggles, existing campaign, draft saves and quick-edit payloads')
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
