const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const root = resolve(__dirname, '..')
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-settings-ui-'))
  let app
  try {
    await build({ entryPoints: [join(__dirname, 'campaign-settings-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-settings-ui-smoke.css"><body><div id="root"></div><script src="campaign-settings-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 1550, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: root, env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    await page.waitForFunction(() => !!window.settingsSmoke)
    const form = page.locator('.campaign-full-modal')
    const picker = form.locator('.zalo-friend-blocklist-select')
    const dialog = page.getByRole('dialog', { name: 'Cài đặt chung' })
    const openManager = async (accountId = 11) => {
      await form.getByTitle('Quản lý danh sách không gửi tin', { exact: true }).click()
      try {
        await dialog.waitFor()
      } catch (error) {
        await page.screenshot({ path: '/tmp/desktop-settings-open-failure.png' })
        console.error(await page.evaluate(() => ({ errors: window.settingsSmoke.state.errors,
          inert: document.querySelector('.campaign-full-modal')?.inert,
          dialogs: document.querySelectorAll('[role="dialog"]').length, active: document.activeElement?.outerHTML,
          calls: window.settingsSmoke.state.calls.slice(-12) })))
        throw error
      }
      await page.waitForFunction(id => document.querySelector('.zalo-account-select')?.value === String(id), accountId)
    }
    const closeManager = async () => {
      await dialog.getByRole('button', { name: 'Đóng', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
    }
    const exclusion = form.getByLabel('Không gửi tin cho những người trong danh sách', { exact: true })
    for (const mode of ['new', 'draft']) {
      await page.evaluate(mode => window.settingsSmoke.open(mode, []), mode)
      await form.getByText('-- Chọn tài khoản --', { exact: true }).waitFor()
      await exclusion.setChecked(false)
      assert(await exclusion.isEnabled(), 'checkbox must remain interactive without an account')
      await exclusion.click()
      assert(!(await exclusion.isChecked()), 'exclusion cannot be enabled without an account')
      assert.deepEqual(await page.evaluate(() => window.settingsSmoke.state.alerts), [{ message: 'Vui lòng chọn tài khoản trước.', type: undefined }])
      assert.equal(await picker.count(), 0)
      await form.getByLabel('Kiêm gắn tag akaBiz', { exact: true }).setChecked(true)
      await form.getByTitle('Quản lý tag akaBiz', { exact: true }).click()
      await closeManager()
      assert(!(await exclusion.isChecked()), 'closing settings must not enable exclusion')
      assert.equal(await page.evaluate(() => window.settingsSmoke.state.calls.filter(call => call.method === 'listZaloFriendBlocklists').length), 0)
      await form.getByText('-- Chọn tài khoản --', { exact: true }).click()
      await form.locator('.account-select-account-row').filter({ hasText: 'Zalo 11' }).locator('input').check()
      await page.waitForFunction(() => window.settingsSmoke.state.calls.some(call => call.method === 'listZaloFriendBlocklists' && call.args[0] === 11))
      await exclusion.setChecked(true)
      await page.waitForFunction(() => document.querySelector('.zalo-friend-blocklist-select option[value="31"]'))
      assert(await exclusion.isChecked())
      assert.equal(await picker.inputValue(), '', 'enabling exclusion requires an explicit list choice')
      if (mode === 'draft') {
        await form.getByRole('button', { name: 'Tạo chiến dịch', exact: true }).click()
        await page.waitForFunction(() => window.settingsSmoke.state.alerts.some(alert => alert.message === 'Vui lòng chọn danh sách không gửi tin Zalo.'))
        assert.equal(await page.evaluate(() => window.settingsSmoke.state.calls.filter(call => call.method === 'createCampaign').length), 0)
      }
      await picker.selectOption('31')
      await exclusion.setChecked(false)
      await exclusion.setChecked(true)
      assert.equal(await picker.inputValue(), '', 're-enabling exclusion also requires an explicit choice')
      await picker.selectOption('31')
      await form.getByTitle('Quản lý danh sách không gửi tin', { exact: true }).press('Enter')
      await dialog.waitFor()
      await page.waitForFunction(() => document.querySelector('.zalo-account-select')?.value === '11')
      await closeManager()
      assert(await exclusion.isChecked())
      assert.equal(await picker.inputValue(), '31')
      console.log(`PASS ${mode}: account and explicit list choice are required; toggling never auto-selects`)
    }
    for (const mode of ['new', 'edit', 'clone', 'draft']) {
      await page.evaluate(mode => window.settingsSmoke.open(mode), mode)
      const name = form.getByPlaceholder('Nhập tên chiến dịch...')
      await name.fill('Nội dung giữ nguyên')
      await form.getByLabel('Không gửi tin cho những người trong danh sách', { exact: true }).setChecked(true)
      await page.waitForFunction(() => document.querySelector('.zalo-friend-blocklist-select option[value="31"]'))
      if (mode === 'new') {
        assert.equal(await picker.inputValue(), '')
        await picker.selectOption('31')
      }
      await page.waitForFunction(() => document.querySelector('.zalo-friend-blocklist-select')?.value === '31')
      await page.evaluate(() => { window.settingsSmoke.state.nameNode = document.querySelector('input[placeholder="Nhập tên chiến dịch..."]') })
      await openManager()
      assert.equal(await form.getAttribute('inert'), '')
      await dialog.getByTitle('Đổi tên').first().click()
      await dialog.locator('.zalo-blocklist-row-main input').fill('Đã đổi tên')
      await dialog.getByTitle('Lưu', { exact: true }).click()
      await page.waitForFunction(() => window.settingsSmoke.state.groups[0].name === 'Đã đổi tên')
      if (mode === 'draft') await page.screenshot({ path: '/tmp/desktop-campaign-settings-modal.png' })
      await closeManager()
      await page.waitForFunction(() => document.querySelector('.zalo-friend-blocklist-select option[value="31"]')?.textContent === 'Đã đổi tên')
      assert.equal(await picker.inputValue(), '31')
      assert.equal(await name.inputValue(), 'Nội dung giữ nguyên')
      assert(await page.evaluate(() => window.settingsSmoke.state.nameNode === document.querySelector('input[placeholder="Nhập tên chiến dịch..."]')))
      assert.equal(await form.getAttribute('inert'), null)
      console.log(`PASS ${mode}: account context, rename refresh, same mounted form`)
    }
    // A pending write must block both close button and backdrop until its refresh finishes.
    await openManager()
    await page.evaluate(() => { window.settingsSmoke.state.holdWrite = true })
    await dialog.getByPlaceholder('Nhập tên danh sách').fill('Danh sách mới')
    await dialog.getByRole('button', { name: 'Tạo', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.general-settings-header button').disabled)
    await page.locator('.general-settings-modal-overlay').click({ position: { x: 2, y: 2 } })
    assert.equal(await dialog.count(), 1)
    await page.evaluate(() => window.settingsSmoke.releaseWrite())
    await closeManager()
    await picker.selectOption('32')
    console.log('PASS create: close waits for write; new list is available')

    await openManager()
    await page.evaluate(() => { window.settingsSmoke.state.failGroups = true })
    await closeManager()
    await form.getByRole('button', { name: 'Tải lại danh sách' }).waitFor()
    assert.equal(await picker.inputValue(), '32')
    assert(await picker.isDisabled())
    await page.evaluate(() => { window.settingsSmoke.state.failGroups = false; window.settingsSmoke.state.groups = window.settingsSmoke.state.groups.filter(group => group.id !== 32) })
    await form.getByRole('button', { name: 'Tải lại danh sách' }).click()
    await page.waitForFunction(() => document.querySelector('.zalo-friend-blocklist-select')?.value === '')
    assert(await form.getByLabel('Không gửi tin cho những người trong danh sách', { exact: true }).isChecked())
    await form.getByRole('button', { name: 'Tạo chiến dịch', exact: true }).click()
    await page.waitForFunction(() => window.settingsSmoke.state.alerts.some(alert => alert.message === 'Vui lòng chọn danh sách không gửi tin Zalo.'))
    assert.equal(await page.evaluate(() => window.settingsSmoke.state.calls.filter(call => call.method === 'createCampaign').length), 0)
    console.log('PASS error/delete: retry preserves form and deleted list requires a replacement')

    await picker.selectOption('31')
    await form.getByLabel('Kiêm gắn tag akaBiz', { exact: true }).setChecked(true)
    const tagManage = form.getByTitle('Quản lý tag akaBiz', { exact: true })
    await tagManage.click()
    await dialog.getByTitle('Sửa tag', { exact: true }).click()
    await dialog.getByPlaceholder('Ví dụ: Khách quan tâm').fill('Khách đổi tên')
    await dialog.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click()
    await page.waitForFunction(() => window.settingsSmoke.state.tags[0].name === 'Khách đổi tên')
    await closeManager()
    await form.getByLabel('Khách đổi tên', { exact: true }).waitFor()
    assert(await form.getByLabel('Khách đổi tên', { exact: true }).isChecked())
    await tagManage.click()
    await page.evaluate(() => { window.settingsSmoke.state.failTags = true })
    await closeManager()
    await form.getByRole('button', { name: 'Tải lại tag' }).waitFor()
    await page.evaluate(() => { window.settingsSmoke.state.failTags = false })
    await form.getByRole('button', { name: 'Tải lại tag' }).click()
    await form.getByLabel('Khách đổi tên', { exact: true }).waitFor()
    assert(await form.getByLabel('Khách đổi tên', { exact: true }).isChecked())
    await form.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
    await page.waitForFunction(() => window.settingsSmoke.state.calls.some(call => call.method === 'saveCampaignDraft'))
    assert.deepEqual(await page.evaluate(() => window.settingsSmoke.state.calls.find(call => call.method === 'saveCampaignDraft').args[0].payload.values.formData.akaBizTagNames), ['Khách đổi tên'])
    assert.deepEqual(await page.evaluate(() => window.settingsSmoke.state.errors), [])
    await page.screenshot({ path: '/tmp/desktop-campaign-settings-smoke.png' })
    console.log('PASS tag: same ID retains selection and saves the renamed label; no renderer errors')
    await page.evaluate(() => window.settingsSmoke.open('new'))
    await form.getByLabel('Không gửi tin cho những người trong danh sách', { exact: true }).setChecked(true)
    await openManager()
    await page.evaluate(() => window.settingsSmoke.closeForm())
    await form.waitFor({ state: 'detached' })
    const reads = await page.evaluate(() => window.settingsSmoke.state.calls.filter(call => call.method === 'listZaloFriendBlocklists').length)
    await closeManager()
    assert.equal(await page.evaluate(() => window.settingsSmoke.state.calls.filter(call => call.method === 'listZaloFriendBlocklists').length), reads)
    console.log('PASS close: an unmounted campaign does not refresh or receive stale callbacks')
  } finally {
    await app?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
