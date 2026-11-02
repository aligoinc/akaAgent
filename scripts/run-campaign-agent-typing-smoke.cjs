const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { build } = require('esbuild'), { _electron } = require('playwright')
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-typing-'))
const baseline = process.argv.includes('--baseline')
const production = process.argv.includes('--production')
const baselineRef = process.env.CAMPAIGN_AGENT_BASELINE_REF || '3ccf39da'
const source = file => baseline ? require('node:child_process').execFileSync('git', ['show', `${baselineRef}:${path.relative(root, file)}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(file, 'utf8')
const artifacts = process.env.CAMPAIGN_AGENT_ARTIFACTS_DIR || dir
fs.mkdirSync(artifacts, { recursive: true })
async function main() {
  let app
  try {
    await build({ entryPoints: [path.join(__dirname, 'campaign-agent-ui-smoke.tsx')], outdir: dir, bundle: true,
      platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning',
      plugins: [{ name: 'count-form-renders', setup(b) {
        if (baseline) b.onLoad({ filter: /(?:useCampaignAgent|CampaignAgentChat)\.tsx$/ }, args => ({ loader: 'tsx', contents: source(args.path) }))
        b.onLoad({ filter: /CampaignAgentFormModal\.tsx$/ }, args => ({ loader: 'tsx', contents: source(args.path)
          .replace('  draftValuesRef.current.manualAdvancedContentItems =', '  if (window.typingMetrics) window.typingMetrics.formRenders++;\n  draftValuesRef.current.manualAdvancedContentItems =') }))
      } }] })
    fs.writeFileSync(path.join(dir, 'index.html'), '<html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-agent-ui-smoke.css"><div id="root"></div><script src="campaign-agent-ui-smoke.js"></script></html>')
    fs.writeFileSync(path.join(dir, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(dir, 'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1500,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(path.join(dir, 'index.html'))})})`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [path.join(dir, 'main.cjs')], cwd: root, env })
    const page = await app.firstWindow(); page.setDefaultTimeout(60000)
    const cdp = await page.context().newCDPSession(page)
    const input = page.getByRole('textbox', { name: 'Yêu cầu cho Agent' })
    await input.waitFor()
    await page.evaluate(() => window.agentSmoke.open('zalo_message_phone', 11))
    await input.waitFor(); await page.waitForTimeout(500)
    await page.locator('[data-agent-field="name"]').fill('Kiểm thử tốc độ gõ')
    await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
    await page.getByText('Đã đóng', { exact: true }).waitFor()
    const results = []
    for (const count of [0, 5000]) {
      await page.evaluate(count => {
        const draft = structuredClone(window.agentSmoke.state.saved)
        draft.payload.values.details = Array.from({ length: count }, (_, i) => ({ name: `Khách kiểm thử ${i}`, phone: '09' + String(i).padStart(8, '0'), uid: '', email: '', status: 'chờ chạy', info1: 'Dữ liệu kiểm thử '.repeat(10) }))
        window.agentSmoke.openDraft(draft)
      }, count)
      await input.waitFor(); await page.waitForTimeout(500)
      const content = page.locator('textarea[data-agent-field="content"]')
      if (!await content.count()) await page.locator('.stepper-section').filter({ has: page.locator('.stepper-section-title', { hasText: /^Nội dung$/ }) }).locator('.stepper-section-header').click()
      await content.waitFor()
      await page.evaluate(() => {
        if (window.nativeTypingClone) return
        window.nativeTypingClone = window.structuredClone
        window.nativeTypingStringify = JSON.stringify
        const large = v => Array.isArray(v) ? v.length >= 1000 : v && Array.isArray(v.details) && v.details.length >= 1000
        window.structuredClone = (...args) => { if (window.typingMetrics && large(args[0])) window.typingMetrics.largeClones++; return window.nativeTypingClone(...args) }
        JSON.stringify = (...args) => { if (window.typingMetrics && large(args[0])) window.typingMetrics.largeSerializations++; return window.nativeTypingStringify(...args) }
      })
      for (const [kind, field] of [['chat', input], ['content', content]]) {
        await field.fill('')
        await page.waitForTimeout(200)
        await page.evaluate(() => { window.typingMetrics = { formRenders: 0, largeClones: 0, largeSerializations: 0 } })
        if (process.argv.includes('--profile')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start') }
        const text = 'Noi dung kiem thu go nhanh 1234567890'
        const started = Date.now()
        await field.pressSequentially(text)
        const elapsedMs = Date.now() - started
        if (process.argv.includes('--profile')) {
          const { profile } = await cdp.send('Profiler.stop')
          const byId = new Map(profile.nodes.map(n => [n.id, { name: n.callFrame.functionName, line: n.callFrame.lineNumber, ms: 0 }]))
          profile.samples.forEach((id, i) => { byId.get(id).ms += profile.timeDeltas[i] / 1000 })
          fs.writeFileSync(path.join(artifacts, `profile-${count}-${kind}.json`), JSON.stringify([...byId.values()].sort((a, b) => b.ms - a.ms).slice(0, 40), null, 2))
        }
        const metrics = await page.evaluate(() => ({ ...window.typingMetrics, requests: window.agentSmoke.state.requests.length }))
        assert.equal(await field.inputValue(), text)
        results.push({ rows: count, kind, keystrokes: text.length, elapsedMs, ...metrics })
        console.log(JSON.stringify(results.at(-1)))
        if (!baseline) {
          assert.equal(metrics.largeClones, 0, 'typing must not clone the recipient list')
          assert.equal(metrics.largeSerializations, 0, 'unchanged recipients must not be serialized per key')
          if (kind === 'chat') assert.equal(metrics.formRenders, 0, 'chat typing must not rerender the campaign form')
        }
        assert.equal(metrics.requests, 0, 'typing must not invoke AI')
      }
      if (count) {
        await page.getByRole('textbox', { name: 'Info1 dòng 1', exact: true }).fill('Đã sửa dòng đầu')
        await page.getByTitle('Trang sau', { exact: true }).click()
        await page.getByRole('textbox', { name: 'Info1 dòng 101', exact: true }).fill('Đã sửa trang hai')
      }
      await input.fill('Yêu cầu tiếng Việt vừa gõ phải được giữ nguyên')
      await page.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
      await page.getByText('Đã đóng', { exact: true }).waitFor()
      const saved = await page.evaluate(() => window.agentSmoke.state.saved.payload.values)
      assert.equal(saved.agentChat.composer.text, 'Yêu cầu tiếng Việt vừa gõ phải được giữ nguyên')
      assert.equal(saved.formData.content, 'Noi dung kiem thu go nhanh 1234567890')
      assert.equal(saved.details.length, count)
      if (count) {
        assert.equal(saved.details[0].info1, 'Đã sửa dòng đầu')
        assert.equal(saved.details[100].info1, 'Đã sửa trang hai')
      }
    }
    await page.evaluate(() => window.agentSmoke.openDraft(window.agentSmoke.state.saved))
    await input.waitFor()
    assert.equal(await input.inputValue(), 'Yêu cầu tiếng Việt vừa gõ phải được giữ nguyên')
    await input.fill('Viết nội dung mới để kiểm tra hoàn tác')
    await input.press('Enter')
    await page.waitForFunction(() => window.agentSmoke.state.pending.length === 1)
    const request = await page.evaluate(() => window.agentSmoke.state.requests.at(-1))
    assert.equal(request.description, 'Viết nội dung mới để kiểm tra hoàn tác')
    assert.equal(request.snapshot.data.count, 5000)
    assert.deepEqual(request.snapshot.data.rows, [])
    await page.evaluate(() => window.agentSmoke.resolve({ ok: true, patch: { actionId: null, entries: [
      { section: 'content', patch: { edits: [{ index: 0, content: 'Nội dung từ Agent', emailSubject: null }], additions: [] } }
    ], message: 'Đã điền', extractedText: '' } }))
    await page.waitForFunction(() => !document.querySelector('.stepper-layout').inert)
    const content = page.locator('textarea[data-agent-field="content"]')
    assert.equal(await content.inputValue(), 'Nội dung từ Agent')
    const undo = page.getByRole('button', { name: 'Hoàn tác', exact: true }).last()
    assert(await undo.isEnabled())
    await input.fill('Gõ chat không sửa revision của nội dung')
    assert(await undo.isEnabled())
    await content.fill('Sửa bằng tay')
    await content.fill('Nội dung từ Agent')
    assert(await undo.isDisabled(), 'edit then restore must still invalidate old undo')
    assert.deepEqual(await page.evaluate(() => window.agentSmoke.state.errors), [])
    fs.writeFileSync(path.join(artifacts, `typing-${baseline ? 'before' : 'after'}${production ? '-production' : ''}.json`), JSON.stringify({ fixture: `real Electron renderer, isolated IPC/stores; ${production ? 'production' : 'development'} React`, baselineRef, results }, null, 2))
    console.log(JSON.stringify(results, null, 2))
  } finally { if (app) await app.close(); fs.rmSync(dir, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
