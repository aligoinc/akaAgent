// Real Electron renderer; fixtures replace IPC/stores and block all HTTP.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { execFileSync } = require('node:child_process')
const { build } = require('esbuild'), { _electron } = require('playwright')
const root = path.resolve(__dirname, '..')
const production = process.argv.includes('--production'), baseline = process.argv.includes('--baseline')
const baselineRef = '5df2678f'
const artifacts = process.env.CAMPAIGN_CONTENT_ARTIFACTS_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-content-results-'))
fs.mkdirSync(artifacts, { recursive: true })
const results = []

async function check(form) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-content-'))
  let app
  try {
    await build({ entryPoints: [path.join(__dirname, 'campaign-agent-ui-smoke.tsx')], outdir: dir,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', jsxDev: !production, target: 'chrome120',
      define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
      loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning',
      plugins: [{ name: 'content-typing-fixture', setup(b) {
        b.onLoad({ filter: /campaign-agent-ui-smoke\.tsx$/ }, args => {
          let contents = fs.readFileSync(args.path, 'utf8').replace('.render(<App/> )', '.render(<React.StrictMode><App/></React.StrictMode>)')
          if (form === 'regular') contents = contents.replace("from '../src/renderer/src/components/CampaignPanels/CampaignAgentFormModal'", "from '../src/renderer/src/components/CampaignPanels/CampaignFormModal'")
          return { contents, loader: 'tsx' }
        })
        b.onLoad({ filter: /(?:Campaign(?:Agent)?FormModal|useCampaignAgent|useAgentDraftField)\.tsx?$/ }, args => {
          let contents = baseline ? execFileSync('git', ['show', `${baselineRef}:${path.relative(root, args.path)}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(args.path, 'utf8')
          contents = contents.replace('  const renderCampaignContentTextarea =', '  if (window.contentTypingMetrics) window.contentTypingMetrics.formRenders++;\n  const renderCampaignContentTextarea =')
          return { contents, loader: 'tsx' }
        })
      } }] })
    fs.writeFileSync(path.join(dir, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="campaign-agent-ui-smoke.css"><div id="root"></div><script src="campaign-agent-ui-smoke.js"></script>')
    fs.writeFileSync(path.join(dir, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1500,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir, 'index.html'))})})`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(dir, 'main.cjs')], cwd: root, env })
    const page = await app.firstWindow(); page.setDefaultTimeout(30000)
    const name = page.getByPlaceholder('Nhập tên chiến dịch...', { exact: true })
    const content = page.locator('textarea.message-content-textarea')
    const contentSection = page.locator('.stepper-section').filter({ has: page.locator('.stepper-section-title', { hasText: /^Nội dung/ }) })
    const revealContent = async () => {
      await name.waitFor()
      if (!await content.isVisible()) await contentSection.locator('.stepper-section-header').click()
      await content.waitFor()
    }
    const saveDraft = async () => {
      await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
      await page.getByText('Đã đóng', { exact: true }).waitFor()
      return page.evaluate(() => window.agentSmoke.state.saved)
    }
    await page.waitForFunction(() => !!window.agentSmoke)
    await page.evaluate(() => window.agentSmoke.open('zalo_message_phone', 11))
    await name.fill('Kiểm tra nội dung đồng bộ')
    await saveDraft()
    for (const rows of process.argv.includes('--small') ? [0] : [0, 5000]) {
      await page.evaluate(rows => {
        const draft = structuredClone(window.agentSmoke.state.saved)
        draft.payload.values.details = Array.from({ length: rows }, (_, i) => ({ name: `Khách ${i}`, phone: '09' + String(i).padStart(8, '0'), uid: '', email: '', info1: 'Dữ liệu kiểm thử '.repeat(10) }))
        window.agentSmoke.openDraft(draft)
      }, rows)
      await revealContent()
      // Completion is already true; further typing should render only content.
      await content.fill('Nội dung '); await page.waitForTimeout(200)
      await page.evaluate(() => { window.contentTypingMetrics = { formRenders: 0 }; window.agentSmoke.state.calls = [] })
      const text = 'Noi dung kiem thu go nhanh 1234567890', started = Date.now()
      await content.pressSequentially(text, { timeout: baseline ? 120000 : 30000 })
      const elapsedMs = Date.now() - started
      const metrics = await page.evaluate(() => ({ ...window.contentTypingMetrics, ipcCalls: window.agentSmoke.state.calls.length }))
      const result = { form, rows, mode: production ? 'production' : 'development', strictMode: true, keystrokes: text.length, elapsedMs, ...metrics }
      results.push(result); console.log(JSON.stringify(result))
      if (!baseline) assert.equal(metrics.formRenders, 0, 'nonempty typing must not rerender the complete form')
      assert.equal(metrics.ipcCalls, 0, 'typing must not invoke IPC or AI')
      assert.equal(await content.inputValue(), 'Nội dung ' + text)
      await content.fill('Ký tự cuối tiếng Việt — lưu ngay')
      if (rows && !baseline) {
        await page.getByRole('textbox', { name: 'Info1 dòng 1', exact: true }).fill('Đã sửa trang một')
        await page.getByTitle('Trang sau', { exact: true }).click()
        await page.getByRole('textbox', { name: 'Info1 dòng 101', exact: true }).fill('Đã sửa trang hai')
      }
      const draft = await saveDraft()
      assert.equal(draft.payload.values.formData.content, 'Ký tự cuối tiếng Việt — lưu ngay')
      assert.equal(draft.payload.values.details.length, rows)
      if (rows && !baseline) {
        assert.equal(draft.payload.values.details[0].info1, 'Đã sửa trang một')
        assert.equal(draft.payload.values.details[100].info1, 'Đã sửa trang hai')
      }
    }
    if (baseline) return
    await page.evaluate(() => {
      const draft = structuredClone(window.agentSmoke.state.saved)
      // The small typing run has no recipients; campaign-save validation still
      // needs one. Keep the measured typing/draft scenario above unchanged.
      if (!draft.payload.values.details.length) {
        draft.payload.values.details = [{ name: 'Khách kiểm thử', phone: '0900000000', uid: '', email: '' }]
      }
      window.agentSmoke.openDraft(draft)
    })
    await revealContent()
    assert.equal(await content.inputValue(), 'Ký tự cuối tiếng Việt — lưu ngay')
    await content.fill('Xin chào khách mới')
    await content.evaluate(el => { el.focus(); el.setSelectionRange(9, 18) })
    await contentSection.locator('.message-personalization-button').hover()
    await contentSection.getByRole('button', { name: '#{PHONE}', exact: true }).click()
    assert.equal(await content.inputValue(), 'Xin chào #{PHONE}', 'token inserts into current text/selection, not the last form render')
    await content.fill('Nội dung mới nhất để xem trước')
    await contentSection.getByRole('button', { name: /Xem trước/ }).first().click()
    assert(await page.getByText('Nội dung mới nhất để xem trước', { exact: true }).count() > 0)
    await page.getByRole('button', { name: 'Đóng xem trước nội dung', exact: true }).click()
    // Latest content must be used by the section AI even without a parent render.
    await page.evaluate(() => { window.electronAPI.generateCampaignContentAi = async request => { window.agentSmoke.state.contentRequest = request; return { ok: true, patch: { edits: [{ index: 0, content: 'Đã sửa bởi AI', emailSubject: null }], additions: [] } } } })
    await content.fill('Nội dung mới nhất cho AI')
    if (form === 'regular') {
      await contentSection.getByRole('button', { name: 'Viết nội dung bằng AI', exact: true }).click()
      await page.getByPlaceholder('Ví dụ: viết ngắn gọn hơn và thêm 3 biến thể với giọng thân thiện').fill('Viết lại')
      await page.getByRole('button', { name: 'Điền nội dung', exact: true }).click()
      await page.waitForFunction(() => !!window.agentSmoke.state.contentRequest)
      assert.equal(await page.evaluate(() => window.agentSmoke.state.contentRequest.items[0].content), 'Nội dung mới nhất cho AI')
    } else {
      await contentSection.getByRole('button', { name: 'Hỏi Agent', exact: true }).click()
      await page.getByRole('textbox', { name: 'Yêu cầu cho Agent' }).fill('Viết lại nội dung')
      await page.getByRole('textbox', { name: 'Yêu cầu cho Agent' }).press('Enter')
      await page.waitForFunction(() => window.agentSmoke.state.pending.length === 1)
      assert.equal(await page.evaluate(() => window.agentSmoke.state.requests.at(-1).snapshot.content.items[0].content), 'Nội dung mới nhất cho AI')
      await page.evaluate(() => window.agentSmoke.resolve({ ok: true, patch: { actionId: null, entries: [{ section: 'content', patch: { edits: [{ index: 0, content: 'Đã sửa bởi AI', emailSubject: null }], additions: [] } }], message: 'Đã điền', extractedText: '' } }))
      await page.waitForFunction(() => !document.querySelector('.stepper-layout')?.inert)
    }
    await page.waitForFunction(() => document.querySelector('textarea.message-content-textarea')?.value === 'Đã sửa bởi AI')
    await content.fill('Nội dung mới nhất khi lưu chiến dịch')
    await page.getByRole('button', { name: /^(Lưu|Tạo) chiến dịch$/ }).click()
    await page.waitForFunction(() => window.agentSmoke.state.calls.some(call => call.method === 'createCampaign'))
    assert.equal(await page.evaluate(() => window.agentSmoke.state.calls.find(call => call.method === 'createCampaign').args[0].content), 'Nội dung mới nhất khi lưu chiến dịch')
    await page.getByText('Đã đóng', { exact: true }).waitFor()
    await page.evaluate(() => window.agentSmoke.open('sms_send', 31))
    await name.fill('SMS kiểm tra bộ đếm')
    let field = contentSection.locator('textarea.stepper-textarea').first()
    if (!await field.isVisible()) await contentSection.locator('.stepper-section-header').click()
    await field.fill('ABC')
    const firstCount = await contentSection.locator('.sms-content-counts').innerText()
    await field.fill('ABCDEFGHIJKLMNOP')
    assert.notEqual(await contentSection.locator('.sms-content-counts').innerText(), firstCount, 'SMS counter must observe each new value')
    assert.equal((await saveDraft()).payload.values.formData.content, 'ABCDEFGHIJKLMNOP')
    await page.evaluate(() => window.agentSmoke.open('email_send', 21))
    await name.fill('Email HTML kiểm tra')
    field = contentSection.locator('textarea.stepper-textarea').first()
    if (!await field.isVisible()) await contentSection.locator('.stepper-section-header').click()
    await contentSection.getByRole('checkbox', { name: /HTML/ }).check()
    const rich = contentSection.locator('[contenteditable="true"]')
    await rich.fill('Nội dung HTML mới nhất')
    const richDraft = await saveDraft()
    assert(richDraft.payload.values.formData.content.includes('Nội dung HTML mới nhất'))
    assert.equal(richDraft.payload.values.formData.emailBodyIsHtml, true)
    assert.deepEqual(await page.evaluate(() => window.agentSmoke.state.errors), [])
    console.log(`PASS ${form}: immediate draft/save, token selection, preview, latest AI context and patch`)
  } finally { if (app) await app.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}
(async () => {
  for (const form of ['regular', 'agent'].filter(form => !process.argv.includes('--agent-only') || form === 'agent')) await check(form)
  fs.writeFileSync(path.join(artifacts, `typing-${baseline ? 'before' : 'after'}-${production ? 'production' : 'development'}.json`), JSON.stringify({ baselineRef, fixture: 'Electron, StrictMode, isolated IPC, same source and fixture; includes automation overhead', results }, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })
