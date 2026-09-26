const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const root = resolve(__dirname, '..')
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-template-ui-'))
  let app
  try {
    await build({ entryPoints: [join(__dirname, 'content-template-loading-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="content-template-loading-ui-smoke.css"><body><div id="root"></div><script src="content-template-loading-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron');
      app.setPath('userData', ${JSON.stringify(join(directory, 'profile'))});
      app.whenReady().then(() => {
        const win = new BrowserWindow({ show: false, width: 1550, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
        win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
        win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
      });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: root, env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    const reads = () => page.evaluate(() => window.templateUi.state.calls.filter(call => call.method === 'listContentTemplates').length)
    const settled = () => page.waitForFunction(() => !window.templateUi.store.getState().loading)
    await page.waitForFunction(() => window.templateUi?.state.calls.some(call => call.method === 'getAkaBizIntegrations'))
    assert.equal(await reads(), 0, 'basic form and hidden workspace must not preload templates')
    await page.getByTitle('Chọn mẫu nội dung', { exact: true }).first().click()
    await page.waitForFunction(() => window.templateUi.store.getState().templatesLoaded)
    await settled()
    assert.equal(await reads(), 1)
    await page.getByRole('dialog').filter({ has: page.getByLabel('Đóng danh sách mẫu nội dung') }).waitFor()
    console.log('PASS UI: no startup/basic-form reads; picker loads on demand')

    await page.evaluate(() => window.templateUi.show('workspace'))
    await page.getByRole('heading', { name: 'Mẫu nội dung', exact: true }).waitFor()
    await settled()
    await page.getByRole('button', { name: 'Quản lý nhóm', exact: true }).click()
    const dialog = page.locator('.ctw-group-dialog')
    await dialog.getByText('2 mẫu nội dung', { exact: true }).waitFor()
    const beforeSave = await reads()
    await dialog.locator('.ctw-form-field input').first().fill('Nhóm mới')
    await dialog.getByRole('button', { name: 'Thêm nhóm', exact: true }).click()
    await dialog.getByText('Nhóm mới', { exact: true }).waitFor()
    await settled()
    assert.equal(await reads(), beforeSave + 1, 'group mutation refreshes exactly once')
    await dialog.getByText('0 mẫu nội dung', { exact: true }).waitFor()
    await dialog.getByTitle('Đóng', { exact: true }).click()
    await page.evaluate(() => { window.templateUi.state.fail = true })
    await page.getByLabel('Tải lại mẫu nội dung', { exact: true }).click()
    await settled()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.evaluate(() => window.templateUi.store.getState().templates.length), 2)
    assert.equal(await page.evaluate(() => window.templateUi.state.alerts.filter(alert => alert.type === 'error').length), 0)
    await page.evaluate(() => { window.templateUi.state.fail = false })
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click()
    await page.getByRole('alert').waitFor({ state: 'detached' })
    console.log('PASS UI: counts from loaded templates, one reload per save, retained data and inline retry')

    await page.evaluate(() => window.templateUi.show('basic'))
    await page.getByTitle('Chọn mẫu nội dung', { exact: true }).first().waitFor()
    const beforeBoth = await reads()
    await page.evaluate(() => { window.templateUi.state.hold = true; window.templateUi.show('both') })
    await page.waitForFunction(() => window.templateUi.state.releases.length === 1)
    assert.equal(await reads(), beforeBoth + 1, 'workspace and group form share one read')
    await page.evaluate(() => window.templateUi.release())
    await settled()
    assert.equal(await reads(), beforeBoth + 1)
    await page.evaluate(() => window.templateUi.show('basic'))
    await page.getByTitle('Chọn mẫu nội dung', { exact: true }).first().waitFor()
    assert.equal(await reads(), beforeBoth + 1)
    assert.deepEqual(await page.evaluate(() => window.templateUi.state.errors), [])
    console.log('PASS UI: shared in-flight data across screens; basic forms stay lazy after using library')
  } catch (error) {
    if (app) {
      const page = await app.firstWindow()
      await page.screenshot({ path: '/tmp/akaagent-content-template-ui-failure.png' })
      console.error(await page.evaluate(() => ({ errors: window.templateUi?.state.errors, alerts: window.templateUi?.state.alerts })))
    }
    throw error
  } finally {
    if (app) await app.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
