const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'aka-staff-cooldown-ui-'))
  let app, page
  try {
    await build({ entryPoints: [join(__dirname, 'zalo-auxiliary-skip-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="zalo-auxiliary-skip-ui-smoke.css"><body class="theme-light"><div id="root"></div><script src="zalo-auxiliary-skip-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{
      const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
      win.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)}));
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))});});`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
    page = await app.firstWindow(); page.setDefaultTimeout(12000)
    await page.waitForFunction(() => !!window.settingsSmoke)
    const form = page.locator('.campaign-full-modal')
    const option = form.getByLabel('Kiểm tra trên toàn bộ tài khoản', { exact: true })
    const main = form.getByRole('checkbox', { name: 'Không gửi tin cho những người có tin gửi trước đó cách số ngày là:', exact: true })
    const reveal = async () => {
      const section = form.locator('.stepper-section').filter({ has: page.locator('.stepper-section-title', { hasText: 'Kiểm tra trùng lặp' }) })
      await section.waitFor()
      if (!await main.count()) await section.locator('.stepper-section-header').click()
      await main.waitFor()
    }
    const open = async (mode, extraSettings, show = true, action = 'zalo_message_phone') => {
      await page.evaluate(({ mode, extraSettings, show, action }) => {
        window.settingsSmoke.setStaffDeliveryCooldown(show)
        window.settingsSmoke.open(mode, action, extraSettings ? { campaign: { extraSettings } } : {})
      }, { mode, extraSettings, show, action })
      await form.waitFor()
    }
    await open('new', null, false); await reveal()
    assert.equal(await option.count(), 0)
    await open('new'); await reveal()
    assert(!await option.isChecked()); assert(await option.isDisabled())
    await main.check(); await option.check()
    await form.getByPlaceholder('Nhập tên chiến dịch...').fill('Kiểm tra phạm vi lịch sử')
    await option.scrollIntoViewIfNeeded()
    await page.screenshot({ path: '/tmp/aka-staff-delivery-cooldown.png' })
    await form.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
    await page.waitForFunction(() => window.settingsSmoke.state.calls.some(c => c.method === 'saveCampaignDraft'))
    const draft = await page.evaluate(() => window.settingsSmoke.state.calls.find(c => c.method === 'saveCampaignDraft').args[0])
    assert.equal(draft.payload.values.formData.recentDeliveryCooldownAllAccounts, true)
    await page.evaluate(draft => window.settingsSmoke.open('draft', 'zalo_message_phone', { savedDraft: draft }), draft)
    await reveal(); assert(await option.isChecked())
    console.log('PASS default, catalog visibility, parent toggle and draft reopen')
    const saved = { enableMessage: true, recentDeliveryCooldownEnabled: true, recentDeliveryCooldownDays: 7, recentDeliveryCooldownAllAccounts: true }
    await open('edit', saved); await reveal(); assert(await option.isChecked())
    await option.uncheck()
    await form.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).click()
    await page.waitForFunction(() => window.settingsSmoke.state.calls.some(c => c.method === 'updateCampaign'))
    assert.equal(await page.evaluate(() => window.settingsSmoke.state.calls.find(c => c.method === 'updateCampaign').args[1].extraSettings.recentDeliveryCooldownAllAccounts), false)
    await form.waitFor({ state: 'detached' })
    await open('edit', saved, false); await reveal()
    assert.equal(await option.count(), 0)
    await form.getByText('Phạm vi đã lưu: tất cả tài khoản của nhân viên này.', { exact: true }).waitFor()
    await form.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).click()
    await page.waitForFunction(() => window.settingsSmoke.state.calls.some(c => c.method === 'updateCampaign'))
    assert.equal(await page.evaluate(() => window.settingsSmoke.state.calls.find(c => c.method === 'updateCampaign').args[1].extraSettings.recentDeliveryCooldownAllAccounts), true)
    await form.waitFor({ state: 'detached' })
    console.log('PASS explicit false save and hidden saved scope retained')
    await open('clone', saved); await reveal(); assert(await option.isChecked())
    await open('edit', { ...saved, enableMessage: false, enableAddFriend: true })
    assert.equal(await option.count(), 0)
    await open('edit', saved, true, 'zalo_message_friend'); await reveal()
    assert.equal(await option.count(), 0)
    console.log('PASS clone, friend-only and other campaign types')
    assert.deepEqual(await page.evaluate(() => window.settingsSmoke.state.errors), [])
    console.log('PASS Desktop full form; screenshot /tmp/aka-staff-delivery-cooldown.png')
  } catch (error) {
    if (page) console.error(await page.evaluate(() => ({ alerts: window.settingsSmoke?.state.alerts, errors: window.settingsSmoke?.state.errors })))
    throw error
  } finally { await app?.close(); rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
