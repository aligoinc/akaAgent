// Cảnh báo nghỉ 300 giây khi nhắn người lạ từ 3 ảnh (V647) trên form Desktop thật (Electron ẩn, IPC giả lập, chặn mọi request http).
// Container cloud chạy bằng root: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-zalo-stranger-media-pacing-ui-smoke.cjs
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')
const WARNING = 'Gửi từ 3 ảnh trở lên cho người lạ mà nghỉ dưới 300 giây thì Zalo hay chặn phần chữ gửi sau ảnh. Nên đặt từ 300 giây.'
async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-pacing-ui-'))
  const name = 'zalo-stranger-media-pacing-ui-smoke'
  await build({ entryPoints: [join(__dirname, `${name}.tsx`)], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"file:///fixture.js"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'error' })
  writeFileSync(join(directory, 'index.html'), `<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="${name}.css"><body><div id="root"></div><script src="${name}.js"></script></body></html>`)
  writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
    const win = new BrowserWindow({ show: ${Boolean(process.env.PACING_UI_SHOT)}, width: 1550, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
    win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
  });`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
  let cases = 0
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(15000)
    await page.waitForFunction(() => window.pacingSmoke)
    const open = async (form, actionId, images, extra) => {
      await page.evaluate(args => window.pacingSmoke.open(...args), [form, actionId, images, extra || {}])
      await page.getByText('Thời gian nghỉ giữa 2 lần gửi').first().waitFor()
    }
    const sleep = () => page.locator('.stepper-form-group').filter({ hasText: 'Thời gian nghỉ giữa 2 lần gửi' }).locator('input[type="number"]').first()
    const warning = () => page.getByText(WARNING, { exact: false })
    for (const form of ['normal', 'agent']) {
      await open(form, 'zalo_message_phone', 3)
      assert.equal(await sleep().inputValue(), '30', form)
      await warning().waitFor(); cases++
      await sleep().fill('299'); await warning().waitFor(); cases++
      await sleep().fill('300'); await page.waitForTimeout(200); assert.equal(await warning().count(), 0, form + ' 300s'); cases++
      await sleep().fill('60'); await warning().waitFor(); cases++
      await open(form, 'zalo_message_phone', 2); await page.waitForTimeout(300); assert.equal(await warning().count(), 0, form + ' 2 ảnh'); cases++
      await open(form, 'zalo_message_friend', 5); await page.waitForTimeout(300); assert.equal(await warning().count(), 0, form + ' bạn bè'); cases++
      await open(form, 'zalo_message_group_member', 5); await warning().waitFor(); cases++
      await open(form, 'zalo_message_phone', 6, { imageOption: 'random', randomImageCount: 2 }); await page.waitForTimeout(300)
      assert.equal(await warning().count(), 0, form + ' ngẫu nhiên 2'); cases++
      await open(form, 'zalo_message_phone', 3, { imageOption: 'none' }); await page.waitForTimeout(300)
      assert.equal(await warning().count(), 0, form + ' không ảnh'); cases++
    }
    assert.deepEqual(await page.evaluate(() => window.pacingSmoke.state.errors), [])
    if (process.env.PACING_UI_SHOT) {
      await open('normal', 'zalo_message_phone', 4)
      const group = page.locator('.stepper-form-group').filter({ hasText: 'Thời gian nghỉ giữa 2 lần gửi' }).first()
      await group.scrollIntoViewIfNeeded(); await page.waitForTimeout(300)
      const box = await group.boundingBox()
      // page.screenshot chờ font (request http bị chặn) nên chụp bằng capturePage của Electron.
      const clip = { x: Math.max(0, Math.round(box.x - 20)), y: Math.max(0, Math.round(box.y - 20)), width: 760, height: 160 }
      const png = await app.evaluate(async ({ BrowserWindow }, rect) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage(rect)).toPNG().toString('base64'), clip)
      writeFileSync(process.env.PACING_UI_SHOT, Buffer.from(png, 'base64'))
    }
    console.log(`PASS ${cases} ca: form thường + Agent; 3 ảnh / 299 / 300 / 60 giây, 2 ảnh, bạn bè, thành viên nhóm, ngẫu nhiên 2, không ảnh`)
  } catch (error) {
    try {
      const page = await app.firstWindow()
      console.error('body:', (await page.evaluate(() => document.body.innerText)).slice(0, 800))
      console.error('errors:', JSON.stringify(await page.evaluate(() => window.pacingSmoke?.state.errors)).slice(0, 800))
    } catch {}
    throw error
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
