// "Agent chọn bạn bè" on the REAL campaign forms (CampaignFormModal and CampaignAgentFormModal) in Electron, using the shared
// fixture scripts/campaign-agent-ui-smoke.tsx plus a local `dataGroupAgent` IPC fixture; never connects to any service.
// Covers: button next to "Chọn bạn bè Zalo" only for zalo_message_friend ("Chọn bạn bè để gửi"), no switch read for other
// types, purpose campaign_recipients, recipients appended to the form's data list (counter), source note, no group created.
// Run: node scripts/data-group-agent-form-smoke.cjs (as root in the cloud container: ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node ...)
// Contract: docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { build } = require('esbuild'), { _electron } = require('playwright')
const root = path.resolve(__dirname, '..')

const injected = `
  dataGroupAgent: (request: any) => {
    const s = (window as any).__dga
    if (request.kind === 'setting') { s.settingCalls++; return { ok: true, data: { audience: 'all', campaignForm: true } } }
    s.calls.push(JSON.parse(JSON.stringify(request)))
    const accountId = request.request?.accountId ?? request.request?.filter?.accountId ?? 11
    const filter = { version: 1, source: 'zalo_friends', accountId, match: 'all', excludeOptedOut: true, excludeBlocked: true, sort: null, limit: null,
      groups: [{ match: 'all', conditions: [{ field: 'zalo_tag', op: 'has_any', tagIds: ['7'] }] }] }
    if (request.kind === 'accounts') return { ok: true, data: { accounts: [
      { id: 11, name: 'zalo 0', kind: 'desktop', available: true, friendCount: 120, friendsUpdatedAt: new Date().toISOString() },
      { id: 13, name: 'zalo 2', kind: 'server', available: true, friendCount: 80, friendsUpdatedAt: new Date().toISOString() }] } }
    if (request.kind === 'turn') return { ok: true, data: { ok: true, reply: { status: 'confirm', message: 'Mình sẽ lấy bạn bè có tag VIP.', questions: [],
      assumptions: [], filter, groupName: null, summary: ['Bạn bè của zalo 0', 'Tag Zalo: có VIP'],
      summaryLines: [{ text: 'Bạn bè của zalo 0', level: 0 }, { text: 'Tag Zalo: có VIP', level: 0 }], notes: [] } } }
    if (request.kind === 'filter') return { ok: true, data: { version: 1, mode: 'page', accountId, totalFriends: 120, matched: 2, notes: [], rows: [],
      evaluatedAt: new Date().toISOString(), coverage: { messagesSince: null, trackingSince: null, factsFrom: null, deliveredAvailable: false } } }
    if (request.kind === 'recipients') return { ok: true, data: { version: 1, accountId, totalFriends: 120, matched: 2, missing: 0, notes: [],
      evaluatedAt: new Date().toISOString(), recipients: [{ contactId: 1, uid: '880001', name: 'Lan' }, { contactId: 2, uid: '880002', name: 'Minh' }] } }
    return { ok: false, code: 'unavailable', message: 'không dùng' }
  },
  cancelDataGroupAgent: () => undefined,
`

async function check(form) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'friend-agent-form-'))
  let app
  try {
    await build({ entryPoints: [path.join(__dirname, 'campaign-agent-ui-smoke.tsx')], outdir: dir,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning',
      plugins: [{ name: 'friend-agent-fixture', setup(b) {
        b.onLoad({ filter: /campaign-agent-ui-smoke\.tsx$/ }, args => {
          let contents = fs.readFileSync(args.path, 'utf8')
          assert.equal(contents.split('const handlers: any = {').length, 2)
          contents = contents.replace('const handlers: any = {', `;(window as any).__dga = { settingCalls: 0, calls: [] }\nconst handlers: any = {${injected}`)
          if (form === 'regular') contents = contents.replace("from '../src/renderer/src/components/CampaignPanels/CampaignAgentFormModal'", "from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'")
          return { contents, loader: 'tsx' }
        })
      } }] })
    fs.writeFileSync(path.join(dir, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="campaign-agent-ui-smoke.css"><div id="root"></div><script src="campaign-agent-ui-smoke.js"></script>')
    fs.writeFileSync(path.join(dir, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1500,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir, 'index.html'))})})`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(dir, 'main.cjs')], cwd: root, env })
    const page = await app.firstWindow(); page.setDefaultTimeout(30000)
    const name = page.getByPlaceholder('Nhập tên chiến dịch...', { exact: true })
    const dga = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__dga)))
    const dataSection = page.locator('.stepper-section').filter({ has: page.locator('.stepper-section-title', { hasText: /Danh sách bạn bè Zalo/ }) })
    const agentButton = page.getByRole('button', { name: 'Agent chọn bạn bè' })
    await page.waitForFunction(() => !!window.agentSmoke)

    // Loại khác (nhắn tin theo SĐT): không có nút, không đọc công tắc.
    await page.evaluate(() => window.agentSmoke.open('zalo_message_phone', 11))
    await name.waitFor()
    await page.waitForTimeout(400)
    assert.equal(await agentButton.count(), 0)
    assert.equal((await dga()).settingCalls, 0, `${form}: no switch read for other campaign types`)

    // Nhắn tin bạn bè Zalo, chế độ mặc định "Chọn bạn bè để gửi": nút cạnh "Chọn bạn bè Zalo".
    await page.evaluate(() => window.agentSmoke.open('zalo_message_friend', 11))
    await name.waitFor()
    await dataSection.waitFor()
    if (!await agentButton.isVisible().catch(() => false)) await dataSection.locator('.stepper-section-header').click()
    await agentButton.waitFor()
    const toolbar = page.locator('.stepper-grid-toolbar').filter({ has: agentButton })
    assert.deepEqual((await toolbar.locator('button').allInnerTexts()).map(text => text.trim()).filter(text => /bạn bè/.test(text)),
      ['Chọn bạn bè Zalo', 'Agent chọn bạn bè'], `${form}: button sits right after "Chọn bạn bè Zalo"`)
    assert.equal((await dga()).settingCalls, 1, `${form}: one switch read`)
    assert.match(await dataSection.innerText(), /tả bằng lời để Agent lọc giúp/)

    await agentButton.click()
    const dialog = page.getByRole('dialog', { name: 'Agent chọn bạn bè' })
    await dialog.waitFor()
    const account = dialog.getByRole('combobox', { name: 'Tài khoản Zalo' })
    await page.waitForFunction(() => window.__dga.calls.some(c => c.kind === 'accounts'))
    assert.equal(await account.inputValue(), '11')
    assert.equal(await account.isDisabled(), true, `${form}: single form account is locked`)
    const input = dialog.getByRole('textbox', { name: 'Mô tả bạn bè muốn gửi' })
    await input.fill('Bạn bè có tag VIP')
    await input.press('Enter')
    await dialog.getByRole('button', { name: 'Thêm 2 bạn bè vào danh sách' }).click()
    await dialog.waitFor({ state: 'detached' })
    const calls = (await dga()).calls
    assert.equal(calls.find(c => c.kind === 'turn').request.purpose, 'campaign_recipients')
    assert.equal(calls.filter(c => c.kind === 'recipients').length, 1)
    assert.equal(calls.filter(c => c.kind === 'create').length, 0)
    await page.waitForFunction(() => /Agent đã thêm 2 bạn bè/.test(document.body.innerText))
    assert.match(await dataSection.innerText(), /Agent đã thêm 2 bạn bè lúc \d\d:\d\d từ tài khoản zalo 0: tag Zalo: có VIP\./)
    assert.equal(await dataSection.locator('.stepper-section-badge').first().innerText(), '2', `${form}: two rows in the data list`)
    const alerts = await page.evaluate(() => window.agentSmoke.state.calls.filter(c => c.method === 'alert').map(c => c.args))
    assert.deepEqual(alerts.at(-1), ['Đã thêm 2 bạn bè vào danh sách.', 'success'])
    const errors = await page.evaluate(() => window.agentSmoke.state.errors)
    assert.deepEqual(errors, [])
    console.log(`PASS ${form}: button only for zalo_message_friend, one switch read, campaign_recipients turn, 2 rows appended + note, no group created`)
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

;(async () => {
  for (const form of ['regular', 'agent']) await check(form)
})().catch(error => { console.error(error); process.exit(1) })
