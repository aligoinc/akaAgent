const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-page-ui-'))
  let app, page
  try {
    await build({ entryPoints: [join(__dirname, 'facebook-page-identity-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="facebook-page-identity-ui-smoke.css"><body><div id="root"></div><script src="facebook-page-identity-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 1550, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
    page = await app.firstWindow(); page.setDefaultTimeout(10000)
    await page.waitForFunction(() => !!window.pageSmoke)
    const form = page.locator('.campaign-full-modal')
    const card = page.locator('.facebook-page-identity')
    const toggle = card.getByRole('switch', { name: 'Chạy bằng Page' })
    const select = card.getByRole('button', { name: 'Chọn Page' })
    const open = async (mode, actionId = 'facebook_join_group', accountIds = [11]) => {
      await page.evaluate(({ mode, actionId, accountIds }) => window.pageSmoke.open(mode, actionId, accountIds), { mode, actionId, accountIds })
      await toggle.waitFor()
    }
    for (const action of await page.evaluate(() => window.pageSmoke.actions)) {
      await open('new', action)
      assert.equal(await toggle.getAttribute('aria-checked'), 'false')
      await toggle.click(); await select.waitFor()
      await page.waitForFunction(() => !document.querySelector('.facebook-page-identity-select').disabled)
      await select.press('ArrowDown')
      await page.getByRole('option', { name: /akaBiz/ }).press('Enter')
      assert.match(await select.textContent(), /11001/)
    }
    console.log('PASS all six forms: off by default, select managed Page by keyboard')
    await open('new', 'facebook_join_group', [11, 12])
    assert(await toggle.isDisabled())
    await card.getByText('Chọn đúng 1 tài khoản chính để chạy bằng Page.').waitFor()
    await open('new')
    // Set a secondary account first; turning on Page must clear it.
    const secondary = form.locator('select').filter({ has: page.locator('option', { hasText: '-- Không sử dụng tài khoản phụ --' }) })
    await secondary.selectOption('12')
    await toggle.click()
    assert.equal(await secondary.count(), 0)
    await page.waitForFunction(() => !document.querySelector('.facebook-page-identity-select').disabled)
    await form.getByPlaceholder('Nhập tên chiến dịch...').fill('Tham gia group bằng Page')
    await form.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).click()
    await page.waitForFunction(() => window.pageSmoke.state.alerts.some(item => /Vui lòng chọn Page/.test(item.message)))
    await select.click(); await page.getByRole('option', { name: /akaBiz/ }).click()
    await form.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
    await page.waitForFunction(() => window.pageSmoke.state.calls.some(call => call.method === 'saveCampaignDraft'))
    const draft = await page.evaluate(() => window.pageSmoke.state.calls.find(call => call.method === 'saveCampaignDraft').args[0].payload.values.formData)
    assert.equal(draft.runAsPage, true); assert.equal(draft.runAsPageUid, '11001'); assert.equal(draft.secondaryAccountId, null)
    console.log('PASS one main account, secondary cleared, missing Page validation and saved draft fields')

    for (const mode of ['edit', 'clone', 'draft']) {
      await open(mode)
      assert.equal(await toggle.getAttribute('aria-checked'), 'true')
      assert.match(await select.textContent(), /11001/)
      await page.waitForFunction(() => !document.querySelector('.facebook-page-identity-select').disabled)
      if (mode === 'draft') {
        for (const theme of ['dark', 'light']) {
          await page.evaluate(theme => document.body.classList.toggle('theme-light', theme === 'light'), theme)
          for (const [size, width, height] of [['wide', 1550, 1100], ['narrow', 780, 900]]) {
            await app.evaluate(({ BrowserWindow }, { width, height }) => BrowserWindow.getAllWindows()[0].setSize(width, height), { width, height })
            await card.screenshot({ path: `/tmp/akaagent-page-card-${theme}-${size}.png` })
            await page.screenshot({ path: `/tmp/akaagent-page-form-${theme}-${size}.png` })
            assert(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
            await select.click()
            await page.screenshot({ path: `/tmp/akaagent-page-menu-${theme}-${size}.png` })
            await page.getByRole('option').first().press('Escape')
            await card.locator('strong').click()
          }
        }
        await page.evaluate(() => document.body.classList.remove('theme-light'))
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1550, 1100))
      }
      const method = mode === 'edit' ? 'updateCampaign' : 'createCampaign'
      await form.getByRole('button', { name: mode === 'draft' ? 'Tạo chiến dịch' : 'Lưu chiến dịch', exact: true }).click()
      await page.waitForFunction(method => window.pageSmoke.state.calls.some(call => call.method === method), method)
      const payload = await page.evaluate(method => { const call = window.pageSmoke.state.calls.find(call => call.method === method); return call.args[method === 'updateCampaign' ? 1 : 0] }, method)
      assert.equal(payload.extraSettings.runAsPage, true); assert.equal(payload.extraSettings.runAsPageUid, '11001')
      assert.equal(payload.extraSettings.runAsPageName, 'akaBiz — Phần mềm marketing 11')
      await form.waitFor({ state: 'detached' })
    }
    console.log('PASS edit, clone and create from saved draft persist the selected identity; dark/light wide/narrow screenshots')

    await open('draft')
    await page.waitForFunction(() => !document.querySelector('.facebook-page-identity-select').disabled)
    await page.evaluate(() => {
      const first = window.pageSmoke.state.pages[0]
      window.pageSmoke.state.pages = Array.from({ length: 10 }, (_, index) => ({ ...first,
        id: index + 1, uid: `110${String(index + 1).padStart(2, '0')}`, name: `Page thử nghiệm ${index + 1}` }))
    })
    await card.getByRole('button', { name: 'Load Page' }).click()
    await page.waitForFunction(() => !document.querySelector('.facebook-page-identity-select').disabled)
    await select.click()
    const menu = page.getByRole('listbox', { name: 'Chọn Page' })
    const assertMenuVisible = async () => {
      assert(await menu.evaluate(element => {
        const rect = element.getBoundingClientRect()
        return rect.top >= 0 && rect.bottom <= window.innerHeight
          && element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.bottom - 8))
      }), 'Dropdown must be visible and clickable all the way to its bottom')
    }
    await assertMenuVisible()
    assert(await menu.evaluate(element => element.getBoundingClientRect().bottom > document.querySelector('.facebook-page-identity').closest('.stepper-section').getBoundingClientRect().bottom))
    await page.screenshot({ path: '/tmp/akaagent-page-menu-over-section.png' })
    await page.keyboard.press('End')
    await page.getByRole('option', { name: /Page thử nghiệm 10 / }).waitFor()
    assert(await menu.evaluate(element => element.scrollTop > 0))
    await page.getByRole('option', { name: /Page thử nghiệm 10 / }).click()
    assert.match(await select.textContent(), /11010/)
    assert.equal(await menu.count(), 0)

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(780, 650))
    await select.scrollIntoViewIfNeeded()
    await select.evaluate(element => {
      const scroller = element.closest('.stepper-content')
      scroller.scrollTop += element.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom + 20
    })
    await select.click()
    await assertMenuVisible()
    assert(await menu.evaluate(element => element.getBoundingClientRect().bottom < document.querySelector('.facebook-page-identity-select').getBoundingClientRect().top), 'Open upward when the bottom of the window has insufficient space')
    await page.screenshot({ path: '/tmp/akaagent-page-menu-upward.png' })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1550, 1100))
    await form.locator('.stepper-content').evaluate(element => { element.scrollTop += 20 })
    await page.waitForFunction(() => {
      const menu = document.querySelector('.facebook-page-identity-menu')?.getBoundingClientRect()
      const anchor = document.querySelector('.facebook-page-identity-select').getBoundingClientRect()
      return menu && Math.abs(menu.left - anchor.left) < 1 && Math.abs(menu.width - anchor.width) < 1
        && Math.min(Math.abs(menu.top - anchor.bottom - 4), Math.abs(anchor.top - menu.bottom - 4)) < 1
    })
    await assertMenuVisible()
    await page.keyboard.press('Escape')
    assert.equal(await menu.count(), 0)
    assert(await select.evaluate(element => element === document.activeElement))
    await select.click()
    await page.keyboard.press('Tab')
    assert.equal(await menu.count(), 0)
    assert(await card.getByRole('button', { name: 'Load Page' }).evaluate(element => element === document.activeElement))
    await select.click()
    await form.getByPlaceholder('Nhập tên chiến dịch...').click()
    assert.equal(await menu.count(), 0)
    console.log('PASS 10-Page dropdown escapes section clipping; last item, upward placement, scroll/resize, Escape, Tab and outside click')

    await open('draft')
    await page.waitForFunction(() => !document.querySelector('.facebook-page-identity-select').disabled)
    await page.evaluate(() => { window.pageSmoke.state.fail = true })
    await card.getByRole('button', { name: 'Load Page' }).click()
    await card.getByRole('alert').waitFor()
    assert.match(await select.textContent(), /11001/)
    await page.evaluate(() => { window.pageSmoke.state.fail = false; window.pageSmoke.state.pages = [] })
    await card.getByRole('button', { name: 'Load Page' }).click()
    await page.waitForFunction(() => !document.querySelector('.facebook-page-identity-select').disabled)
    assert.match(await select.textContent(), /-- Chọn Page --/)
    await select.click(); await page.getByText(/Chưa có Page nào/).waitFor()
    await select.click()
    console.log('PASS Load Page error, retry and empty list clear a removed selection')

    await open('draft')
    await page.waitForFunction(() => !document.querySelector('.facebook-page-identity-select').disabled)
    await page.evaluate(() => { window.pageSmoke.state.hold = true })
    await card.getByRole('button', { name: 'Load Page' }).click()
    await page.waitForFunction(() => window.pageSmoke.state.pending.length === 1)
    await form.getByText('Facebook 11', { exact: true }).first().click()
    await page.evaluate(() => { window.pageSmoke.state.hold = false })
    await form.locator('.account-select-account-row').filter({ hasText: 'Facebook 12' }).locator('input').click()
    await toggle.focus()
    await page.waitForFunction(() => window.pageSmoke.state.calls.some(call => call.method === 'listContacts' && call.args[0] === 12))
    await page.evaluate(() => window.pageSmoke.release())
    await page.waitForFunction(() => !document.querySelector('.facebook-page-identity-select').disabled)
    assert.match(await select.textContent(), /-- Chọn Page --/)
    await select.click()
    assert.equal(await page.getByRole('option', { name: /11001/ }).count(), 0)
    await page.getByRole('option', { name: /12001/ }).click()
    await page.evaluate(() => { window.pageSmoke.state.pages = [] })
    await form.getByRole('button', { name: 'Tạo chiến dịch', exact: true }).click()
    await page.waitForFunction(() => window.pageSmoke.state.alerts.some(item => /không còn trong danh sách/.test(item.message)))
    assert.equal(await page.evaluate(() => window.pageSmoke.state.calls.filter(call => call.method === 'createCampaign').length), 0)
    assert.deepEqual(await page.evaluate(() => window.pageSmoke.state.errors), [])
    console.log('PASS changing account rejects stale loading response; ownership revalidated on save; no renderer errors')
  } catch (error) {
    if (page) {
      await page.screenshot({ path: '/tmp/akaagent-page-ui-failure.png' })
      console.error(await page.evaluate(() => ({ alerts: window.pageSmoke?.state.alerts, errors: window.pageSmoke?.state.errors, calls: window.pageSmoke?.state.calls.slice(-10) })))
    }
    throw error
  } finally { await app?.close(); rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
