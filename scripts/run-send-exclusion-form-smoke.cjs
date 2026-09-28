const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const root = resolve(__dirname, '..')
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-auxiliary-skip-ui-'))
  const output = mkdtempSync(join(tmpdir(), 'akaagent-exclusions-form-artifacts-'))
  let app
  try {
    await build({ entryPoints: [join(__dirname, 'zalo-auxiliary-skip-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="zalo-auxiliary-skip-ui-smoke.css"><body><div id="root"></div><script src="zalo-auxiliary-skip-ui-smoke.js"></script></body></html>')
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
    // Render the four production definitions; the fifth-field extension is covered by the component smoke.
    await page.evaluate(async ()=>{
      const data=await window.electronAPI.listSendExclusionGroups(11)
      window.electronAPI.listSendExclusionGroups=async accountId=>{
        return {...data,catalog:{...data.catalog,fields:data.catalog.fields.filter(f=>f.code!=='fixture_gender')},groups:data.groups.filter(g=>g.rules.every(r=>r.fieldId!==5))}
      }
    })
    const form = page.locator('.campaign-full-modal')
    await page.evaluate(() => window.settingsSmoke.open('edit', 'zalo_message_friend', {campaign:{extraSettings:{enableMessage:true,zaloFriendTargetMode:'all_friends',zaloFriendBlocklistEnabled:true,zaloFriendBlocklistId:31}}}))
    const card=form.getByRole('region',{name:'Loại trừ gửi cho khách hàng'})
    await card.locator('summary').getByText('Không chăm sóc',{exact:true}).waitFor()
    await page.evaluate(()=>document.body.classList.add('theme-light'))
    await card.getByRole('button',{name:'Nhóm điều kiện loại trừ',exact:true}).click()
    await page.getByRole('option').filter({hasText:'Đã sửa'}).click()
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({path:join(output,'form-wide.png')})
    await card.getByRole('button',{name:'Sửa nhóm',exact:true}).click()
    await page.getByRole('dialog',{name:'Sửa nhóm loại trừ'}).waitFor()
    const editor=page.getByRole('dialog',{name:'Sửa nhóm loại trừ'})
    await editor.getByLabel('Tag Zalo',{exact:true}).check()
    await editor.getByRole('button',{name:'VIP',exact:true}).click()
    await page.screenshot({path:join(output,'form-modal-wide.png')})
    await page.keyboard.press('Escape')
    await form.getByRole('button',{name:'Lưu chiến dịch',exact:true}).click()
    await page.waitForFunction(()=>window.settingsSmoke.state.calls.some(c=>c.method==='updateCampaign'))
    const saved=await page.evaluate(()=>window.settingsSmoke.state.calls.find(c=>c.method==='updateCampaign').args[1])
    assert.deepEqual(saved.extraSettings.zaloSendExclusionsByAccountId,{'11':{groupId:1101,blocklistIds:[31]}})
    assert.equal(saved.extraSettings.zaloFriendBlocklistEnabled,false)
    await form.waitFor({state:'detached'})
    await page.evaluate(campaign=>window.settingsSmoke.open('clone','zalo_message_friend',{campaign}),saved)
    await card.locator('summary').getByText('Không chăm sóc',{exact:true}).waitFor()
    assert.match(await card.getByRole('button',{name:'Nhóm điều kiện loại trừ',exact:true}).innerText(),/Đã sửa/)
    await form.getByRole('button',{name:'Lưu nháp',exact:true}).click()
    await page.waitForFunction(()=>window.settingsSmoke.state.calls.some(c=>c.method==='saveCampaignDraft'))
    const draft=await page.evaluate(()=>window.settingsSmoke.state.calls.find(c=>c.method==='saveCampaignDraft').args[0])
    assert.deepEqual(draft.payload.values.zaloSendExclusionsByAccountId,{'11':{groupId:1101,blocklistIds:[31]}})
    await page.evaluate(savedDraft=>window.settingsSmoke.open('draft','zalo_message_friend',{savedDraft}),draft)
    await card.locator('summary').getByText('Không chăm sóc',{exact:true}).waitFor()
    assert.match(await card.getByRole('button',{name:'Nhóm điều kiện loại trừ',exact:true}).innerText(),/Đã sửa/)
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(760,900))
    await card.scrollIntoViewIfNeeded()
    await page.screenshot({path:join(output,'form-narrow.png')})
    await card.getByRole('button',{name:'Sửa nhóm',exact:true}).click()
    await page.screenshot({path:join(output,'form-modal-narrow.png')})
    assert(await page.locator('.exclusion-modal').evaluate(el=>el.scrollWidth<=el.clientWidth))
    assert.deepEqual(await page.evaluate(()=>window.settingsSmoke.state.errors),[])
    console.log('Screenshots: '+output)
    console.log('PASS real campaign form: legacy single blocklist mapped on open, selected group/list saved, edit/clone/draft preserve selection without backfill.')

  } finally {
    await app?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
