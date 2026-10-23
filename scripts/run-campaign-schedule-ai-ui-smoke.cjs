const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } = require('node:fs')
const { join, resolve } = require('node:path'), { tmpdir } = require('node:os')
const { build } = require('esbuild'), { _electron } = require('playwright')

// Exercise the repository's real recurrence calculation without opening a DB connection.
function loadNextSchedule() {
  const ts = require('typescript'), vm = require('node:vm')
  const source = readFileSync(resolve(__dirname, '../src/main/data/repositories/campaignRepository.ts'), 'utf8')
  const ast = ts.createSourceFile('campaignRepository.ts', source, ts.ScriptTarget.Latest, true)
  const names = new Set(['VIETNAM_TIME_ZONE', 'VIETNAM_UTC_OFFSET', 'vietnamDateTimeFormatter',
    'vietnamWeekdayFormatter', 'pad2', 'parseVietnamParts', 'makeVietnamDate', 'addVietnamDays',
    'withVietnamTime', 'getVietnamWeekdayNumber', 'parseNumberList', 'resolveNextSchedule'])
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node)
    ? names.has(node.name?.text)
    : ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.has(item.name.text)))
    .map(node => node.getText(ast)).join('\n')
  const code = ts.transpileModule(`${declarations}\nglobalThis.nextSchedule = resolveNextSchedule;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText
  const context = vm.createContext({ Date, Intl })
  vm.runInContext(code, context)
  return context.nextSchedule
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'akaagent-schedule-ai-ui-')); let app
  try {
    await build({ entryPoints: [join(__dirname, 'campaign-schedule-ai-ui-smoke.tsx')], outdir: dir, bundle: true,
      platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120', define: { 'process.env.NODE_ENV': '"development"' },
      loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-schedule-ai-ui-smoke.css"><div id="root"></div><script src="campaign-schedule-ai-ui-smoke.js"></script></html>')
    writeFileSync(join(dir, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(dir,'profile'))});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:1350,height:1000,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.webContents.session.webRequest.onBeforeRequest((d,cb)=>cb({cancel:/^https?:/.test(d.url)}));w.loadFile(${JSON.stringify(join(dir,'index.html'))})})`)
    const env = { ...process.env, TZ: 'America/Los_Angeles' }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(dir, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
    const page = await app.firstWindow(); page.setDefaultTimeout(12000)
    if (process.argv.includes('--facebook-only')) {
      await require('./campaign-facebook-ai-ui-checks.cjs')(page)
      assert.deepEqual(await page.evaluate(() => window.scheduleSmoke.state.errors), [])
      return
    }
    if (process.argv.includes('--native-group-share-only')) {
      await require('./facebook-native-group-share-ui-checks.cjs')(page)
      assert.deepEqual(await page.evaluate(() => window.scheduleSmoke.state.errors), [])
      return
    }
    if (process.argv.includes('--exclusions-only')) {
      await require('./campaign-exclusion-ai-ui-checks.cjs')(page)
      assert.deepEqual(await page.evaluate(() => window.scheduleSmoke.state.errors), [])
      return
    }
    if (process.argv.includes('--content-only')) {
      await require('./campaign-content-ai-ui-checks.cjs')(page)
      assert.deepEqual(await page.evaluate(() => window.scheduleSmoke.state.errors), [])
      return
    }
    if (process.argv.includes('--config-only')) {
      const trigger = page.getByRole('button', { name: 'Điền lịch bằng AI', exact: true })
      await trigger.waitFor()
      const reads = () => page.evaluate(() => window.scheduleSmoke.state.calls.filter(x => x.method === 'listCampaignFormAi').length)
      const initialReads = await reads()
      await page.evaluate(() => {
        window.scheduleSmoke.state.formAiRows = [{ sectionId: 'campaign.schedule', campaignScope: 'selected', campaignActionIds: ['sms_send'] }]
        window.scheduleSmoke.open()
      })
      await page.waitForFunction(() => window.scheduleSmoke.state.calls.filter(x => x.method === 'listCampaignFormAi').length >= 2)
      await trigger.waitFor({ state: 'detached' })
      assert.equal(await reads(), initialReads + 1)
      await page.evaluate(() => {
        window.scheduleSmoke.state.formAiRows = [{ sectionId: 'campaign.schedule', campaignScope: 'selected', campaignActionIds: ['facebook_timeline_post'] }]
        window.scheduleSmoke.open()
      })
      await trigger.waitFor()
      await page.evaluate(() => { window.scheduleSmoke.state.deferMetadata = true; window.scheduleSmoke.open() })
      await page.waitForFunction(() => window.scheduleSmoke.state.metadataPending.length === 1)
      await trigger.waitFor({ state: 'detached' })
      await page.evaluate(() => window.scheduleSmoke.open())
      await page.waitForFunction(() => window.scheduleSmoke.state.metadataPending.length === 2)
      await page.evaluate(() => {
        const [old, current] = window.scheduleSmoke.state.metadataPending
        current([])
        old([{ sectionId: 'campaign.schedule', campaignScope: 'all', campaignActionIds: [] }])
      })
      await trigger.waitFor({ state: 'detached' })
      assert.deepEqual(await page.evaluate(() => window.scheduleSmoke.state.errors), [])
      console.log('PASS Electron: selected scopes hide/show AI, one metadata read per form, late response from previous form ignored')
      return
    }
    if (process.argv.includes('--mixed-only')) {
      await page.getByRole('button', { name: 'Điền giới hạn bằng AI', exact: true }).waitFor()
      await require('./campaign-limits-ai-mixed-ui-checks.cjs')(page)
      assert.deepEqual(await page.evaluate(() => window.scheduleSmoke.state.errors), [])
      return
    }
    if (process.argv.includes('--limits-only')) {
      await page.getByRole('button', { name: 'Điền giới hạn bằng AI', exact: true }).waitFor()
      await require('./campaign-limits-ai-ui-checks.cjs')(page)
      assert.deepEqual(await page.evaluate(() => window.scheduleSmoke.state.errors), [])
      return
    }
    const form = page.locator('.campaign-full-modal'), trigger = page.getByRole('button', { name: 'Điền lịch bằng AI', exact: true })
    const panel = page.getByRole('dialog', { name: 'Điền lịch bằng AI', exact: true })
    const schedule = page.locator('.stepper-section').filter({ has: page.locator('.stepper-section-title').filter({ hasText: /^Lịch chạy$/ }) })
    const startTime = schedule.locator('.schedule-time-field input'), startDate = schedule.locator('.schedule-date-field input')
    const save = form.getByRole('button', { name: 'Lưu chiến dịch', exact: true })
    const resolveAi = patch => page.evaluate(patch => window.scheduleSmoke.resolve({ ok: true, patch }), patch)
    const open = async () => { await page.evaluate(() => window.scheduleSmoke.open()); await trigger.waitFor(); await trigger.scrollIntoViewIfNeeded() }
    const generate = async (description, enter = false) => {
      await trigger.click(); await panel.getByLabel('Mô tả lịch muốn chạy').fill(description)
      if (enter) await panel.getByLabel('Mô tả lịch muốn chạy').press('Enter')
      else await panel.getByRole('button', { name: 'Điền lịch', exact: true }).click()
      await page.waitForFunction(() => document.querySelector('.stepper-layout')?.inert)
    }
    await trigger.waitFor(); await trigger.scrollIntoViewIfNeeded(); await trigger.hover(); await panel.waitFor()
    assert.equal(await page.evaluate(() => window.scheduleSmoke.state.requests.length), 0, 'hover must not call AI')
    assert.equal(await startTime.inputValue(), '09:00', 'Vietnam wall time independent of host timezone')
    const descriptionInput = panel.getByLabel('Mô tả lịch muốn chạy')
    await descriptionInput.fill(' '); await descriptionInput.press('Enter')
    assert.equal(await descriptionInput.inputValue(), ' ', 'Enter does not add a newline to an empty description')
    await descriptionInput.fill('chạy lúc 8h'); await descriptionInput.press('End'); await descriptionInput.press('Shift+Enter'); await descriptionInput.press('x')
    assert.equal(await descriptionInput.inputValue(), 'chạy lúc 8h\nx', 'Shift+Enter inserts a newline')
    assert.equal(await page.evaluate(() => window.scheduleSmoke.state.requests.length), 0, 'Shift+Enter must not submit')
    await descriptionInput.fill('gửi vào thứ 2,4,6 hàng tuần lúc 8h')
    await descriptionInput.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
    assert.equal(await page.evaluate(() => window.scheduleSmoke.state.requests.length), 0, 'IME confirmation must not submit')
    await generate('gửi vào thứ 2,4,6 hàng tuần lúc 8h', true)
    await page.keyboard.press('Enter')
    assert(await save.isDisabled()); assert(await panel.getByLabel('Mô tả lịch muốn chạy').isDisabled())
    assert.equal(await form.getByRole('button', { name: 'Đóng', exact: true }).isEnabled(), true)
    assert.equal(await page.evaluate(() => window.scheduleSmoke.state.requests.length), 1)
    assert.equal(await descriptionInput.inputValue(), 'gửi vào thứ 2,4,6 hàng tuần lúc 8h', 'Enter submits without a newline')
    await resolveAi({ scheduleType: 'weekly', scheduleWeekDays: '2,4,6', startTime: '08:00' })
    await panel.waitFor({ state: 'detached' }); assert(await save.isEnabled())
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Điền lịch bằng AI')
    assert(await form.isVisible(), 'only the AI popover closes, not the campaign form')
    assert.equal(await startTime.inputValue(), '08:00'); assert.equal(await startDate.inputValue(), '2026-10-14')
    assert.equal(await schedule.locator('.schedule-end-date-field input').inputValue(), '2026-10-21')
    for (const day of [2, 4, 6]) assert(await schedule.getByRole('checkbox', { name: `Thứ ${day}`, exact: true }).isChecked())
    assert.equal(await page.evaluate(() => window.scheduleSmoke.state.calls.some(call => /^(createCampaign|updateCampaign|saveCampaignDraft)$/.test(call.method))), false)
    await trigger.click(); await panel.waitFor()
    assert.equal(await panel.getByRole('status').count(), 0, 'reopening never shows a preview')
    await descriptionInput.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', repeat: true })
    assert.equal(await page.evaluate(() => window.scheduleSmoke.state.requests.length), 1, 'held Enter must not send another request')
    const screenshots = resolve(__dirname, '../docs/audits/ai-form-configs-v416'); mkdirSync(screenshots, { recursive: true })
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => document.body.classList.toggle('theme-light', theme === 'light'), theme)
      await panel.screenshot({ path: join(screenshots, `${theme}.png`) })
    }
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' })
    await generate('gửi vào thứ 2,4,6 hàng tuần lúc 8h', true); await resolveAi({})
    await panel.waitFor({ state: 'detached' }); assert(await save.isEnabled())
    assert.equal(await startTime.inputValue(), '08:00'); assert.equal(await startDate.inputValue(), '2026-10-14')
    assert.equal(await schedule.locator('.schedule-end-date-field input').inputValue(), '2026-10-21')
    for (const day of [2, 4, 6]) assert(await schedule.getByRole('checkbox', { name: `Thứ ${day}`, exact: true }).isChecked())
    assert.equal(await page.evaluate(() => window.scheduleSmoke.state.calls.some(call => /^(createCampaign|updateCampaign|saveCampaignDraft)$/.test(call.method))), false)
    await generate('chạy 20h, dừng 18h'); await resolveAi({ startTime: '20:00', useDailyStopTime: true, dailyStopTime: '18:00' })
    await panel.waitFor({ state: 'detached' }); assert.equal(await startTime.inputValue(), '20:00')
    await save.click()
    await page.waitForFunction(() => window.scheduleSmoke.state.alerts.some(item => item.message.includes('Giờ dừng chạy trong ngày phải sau')))
    await generate('chạy lúc 23:59'); await resolveAi({ startTime: '23:59', useDailyStopTime: false })
    await panel.waitFor({ state: 'detached' }); await save.click()
    await page.waitForFunction(() => window.scheduleSmoke.state.alerts.some(item => item.message.includes('23:59')))
    await generate('hủy thử'); await panel.getByRole('button', { name: 'Hủy yêu cầu' }).click()
    assert(await save.isEnabled()); await resolveAi({ startTime: '01:00' }); assert.equal(await startTime.inputValue(), '23:59')
    await generate('lỗi thử'); await page.evaluate(() => window.scheduleSmoke.reject()); await panel.getByRole('alert').waitFor()
    assert(await save.isEnabled()); assert(!(await panel.innerText()).includes('raw provider'))
    assert.equal(await descriptionInput.inputValue(), 'lỗi thử', 'errors keep the popover and description available for editing')
    await generate('chạy lúc 8h sáng hoặc 8h tối, chưa chọn giờ nào')
    const clarification = 'Chưa hiểu yêu cầu của bạn. Vui lòng mô tả rõ hơn lịch muốn chạy. Bạn muốn chọn 8h sáng hay 8h tối?'
    await page.evaluate(message => window.scheduleSmoke.resolve({ ok: false, code: 'unclear', message }), clarification)
    await panel.getByRole('alert').waitFor()
    assert.equal(await panel.getByRole('alert').textContent(), clarification)
    assert(await save.isEnabled()); assert(await descriptionInput.isEnabled())
    assert.equal(await startTime.inputValue(), '23:59', 'clarification must not change the schedule')
    assert.equal(await descriptionInput.inputValue(), 'chạy lúc 8h sáng hoặc 8h tối, chưa chọn giờ nào')
    await generate('timeout thử'); await page.evaluate(() => window.scheduleSmoke.expire()); await panel.getByRole('alert').waitFor()
    assert(await save.isEnabled()); await resolveAi({ startTime: '02:00' }); assert.equal(await startTime.inputValue(), '23:59')
    await generate('đóng form'); await form.getByRole('button', { name: 'Đóng', exact: true }).click(); await form.waitFor({ state: 'detached' })
    await resolveAi({ startTime: '03:00' }); await open(); assert.equal(await startTime.inputValue(), '09:00')
    await generate('gửi thứ 2,4,6 lúc 8h'); await resolveAi({ scheduleType: 'weekly', scheduleWeekDays: '2,4,6', startTime: '08:00' })
    await panel.waitFor({ state: 'detached' }); await save.click()
    await page.waitForFunction(() => window.scheduleSmoke.state.calls.some(call => call.method === 'updateCampaign'))
    const saved = await page.evaluate(() => window.scheduleSmoke.state.calls.find(call => call.method === 'updateCampaign').args[1])
    assert.equal(saved.schedule, '2026-10-14T01:00:00.000Z'); assert.equal(saved.originalSchedule, saved.schedule)
    assert.equal(saved.scheduleEndDate, '2026-10-21T16:59:59.000Z'); assert.equal(saved.scheduleWeekDays, '2,4,6')
    await form.waitFor({ state: 'detached' })
    await open()
    await generate('đổi phiên'); await page.evaluate(() => window.scheduleSmoke.switchUser()); await resolveAi({ startTime: '04:00' })
    assert.equal(await startTime.inputValue(), '09:00'); assert(await save.isEnabled())
    await panel.waitFor({ state: 'detached' }) // Auth changes invalidate metadata and unmount the old AI session.
    const cdp = await page.context().newCDPSession(page)
    const requestsBeforeDraftTests = await page.evaluate(() => window.scheduleSmoke.state.requests.length)
    const saveDraft = form.getByRole('button', { name: 'Lưu nháp', exact: true })
    const createFromDraft = form.getByRole('button', { name: 'Tạo chiến dịch', exact: true })
    for (const zone of ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles']) {
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: zone })
      const legacySchedule = '2035-01-01T23:30'
      const expectedIso = await page.evaluate(raw => new Date(raw).toISOString(), legacySchedule)
      const expectedWallTime = new Date(Date.parse(expectedIso) + 7 * 3600000).toISOString().slice(0, 16)
      const legacy = { id: '3b81a9a4-45e7-45b0-9931-8ac71e629a30', revision: 1,
        payload: { version: 1, values: { formData: { name: 'Nháp giờ cũ', actionId: 'facebook_timeline_post',
          accountIds: [11], schedule: legacySchedule, content: 'Nội dung kiểm thử', scheduleType: 'daily' } } } }
      await page.evaluate(draft => window.scheduleSmoke.openDraft(draft), legacy)
      await saveDraft.waitFor(); await startTime.waitFor()
      assert.equal(await startDate.inputValue(), expectedWallTime.slice(0, 10), `${zone}: restored date`)
      assert.equal(await startTime.inputValue(), expectedWallTime.slice(11), `${zone}: restored time`)
      await saveDraft.click(); await form.waitFor({ state: 'detached' })
      const savedDraft = await page.evaluate(() => window.scheduleSmoke.state.lastSavedDraft)
      assert.equal(savedDraft.payload.scheduleTimeZone, 'Asia/Ho_Chi_Minh')
      assert.equal(savedDraft.payload.values.formData.schedule, expectedWallTime)
      assert.equal(legacy.payload.values.formData.schedule, legacySchedule)
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: zone === 'UTC' ? 'Asia/Ho_Chi_Minh' : 'UTC' })
      await page.evaluate(draft => window.scheduleSmoke.openDraft(draft), savedDraft)
      await createFromDraft.waitFor(); await startTime.waitFor()
      assert.equal(await startDate.inputValue(), expectedWallTime.slice(0, 10), 'reopen on another timezone: same date')
      assert.equal(await startTime.inputValue(), expectedWallTime.slice(11), 'reopen on another timezone: no double conversion')
      const createdBefore = await page.evaluate(() => window.scheduleSmoke.state.calls.filter(call => call.method === 'createCampaign').length)
      await createFromDraft.click()
      await page.waitForFunction(count => window.scheduleSmoke.state.calls.filter(call => call.method === 'createCampaign').length > count, createdBefore).catch(async error => {
        console.error(await page.evaluate(() => ({ alerts: window.scheduleSmoke.state.alerts,
          calls: window.scheduleSmoke.state.calls.slice(-15).map(call => call.method) })))
        throw error
      })
      const created = await page.evaluate(() => window.scheduleSmoke.state.calls.filter(call => call.method === 'createCampaign').at(-1).args[0])
      assert.equal(created.schedule, expectedIso, `${zone}: actual Save preserves the old instant`)
      assert.equal(created.originalSchedule, expectedIso)
      await form.waitFor({ state: 'detached' })
    }
    const createCurrentDraft = async () => {
      const count = await page.evaluate(() => window.scheduleSmoke.state.calls.filter(call => call.method === 'createCampaign').length)
      await createFromDraft.click()
      await page.waitForFunction(count => window.scheduleSmoke.state.calls.filter(call => call.method === 'createCampaign').length > count, count)
      const created = await page.evaluate(() => window.scheduleSmoke.state.calls.filter(call => call.method === 'createCampaign').at(-1).args[0])
      await form.waitFor({ state: 'detached' })
      return created
    }
    const legacyDraft = extra => ({ id: 'db9329f4-30eb-4531-af83-a142d3897f2a', revision: 1,
      payload: { version: 1, values: { formData: { name: 'Nháp nhiều giờ và ngày kết thúc', actionId: 'facebook_timeline_post',
        accountIds: [11], schedule: '2035-01-01T23:30', content: 'Nội dung kiểm thử', scheduleType: 'daily', ...extra } } } })
    const cases = [
      { first: '08:00', extra: { multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: '8h,14h' } },
      { first: '20:00', extra: { multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: '20:00,22:00' } },
      { first: '23:30', extra: { scheduleType: 'weekly', scheduleWeekDays: '2,4,6', scheduleEndDate: '2035-01-10' } },
      { first: '23:30', extra: { scheduleType: 'monthly', scheduleDays: '1,15,31', scheduleEndDate: '2035-01-10' } },
      { first: '08:00', extra: { scheduleType: 'weekly', scheduleWeekDays: '2,4,6', scheduleEndDate: '2035-01-10',
        multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: '08:00,14:00' } }
    ]
    for (const zone of ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles']) {
      for (const test of cases) {
        await cdp.send('Emulation.setTimezoneOverride', { timezoneId: zone })
        const expected = await page.evaluate(({ first, extra }) => ({
          start: new Date(`2035-01-01T${first}`).toISOString(),
          end: extra.scheduleEndDate ? new Date(`${extra.scheduleEndDate}T23:59:59`).toISOString() : null
        }), test)
        const wall = new Date(Date.parse(expected.start) + 7 * 3600000).toISOString().slice(0, 16)
        await page.evaluate(draft => window.scheduleSmoke.openDraft(draft), legacyDraft(test.extra))
        await saveDraft.waitFor(); await startTime.waitFor()
        assert.equal(await startTime.inputValue(), wall.slice(11), `${zone}: effective first-run time`)
        assert.equal(await startDate.inputValue(), wall.slice(0, 10), `${zone}: first-run date including rollover`)
        if (expected.end) {
          const endWall = new Date(Date.parse(expected.end) + 7 * 3600000).toISOString().slice(0, 16)
          assert.equal(await schedule.locator('.schedule-end-date-field input').inputValue(), endWall.slice(0, 10))
          if (zone !== 'Asia/Ho_Chi_Minh') assert((await schedule.innerText()).includes('Giữ thời điểm kết thúc:'))
        }
        await saveDraft.click(); await form.waitFor({ state: 'detached' })
        const roundtrip = await page.evaluate(() => window.scheduleSmoke.state.lastSavedDraft)
        await cdp.send('Emulation.setTimezoneOverride', { timezoneId: zone === 'UTC' ? 'Asia/Ho_Chi_Minh' : 'UTC' })
        await page.evaluate(draft => window.scheduleSmoke.openDraft(draft), roundtrip)
        await createFromDraft.waitFor()
        const created = await createCurrentDraft()
        assert.equal(created.schedule, expected.start, `${zone}: preserve first run with ${JSON.stringify(test.extra)}`)
        assert.equal(created.originalSchedule, expected.start)
        assert.equal(created.scheduleEndDate, expected.end, `${zone}: preserve exact cutoff`)
        if (test.extra.multiDailyTimeSlotsEnabled) {
          assert.equal(created.extraSettings.multiDailyTimeSlots, test.first === '08:00' ? '08:00,14:00' : '20:00,22:00')
        }
      }
    }
    // Direct creation, explicit edits, saving those edits back to a draft, and AI preserving an unmentioned cutoff.
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'UTC' })
    const combined = legacyDraft(cases.at(-1).extra)
    await page.evaluate(draft => window.scheduleSmoke.openDraft(draft), combined); await createFromDraft.waitFor()
    const directCreated = await createCurrentDraft()
    assert.equal(directCreated.schedule, '2035-01-01T08:00:00.000Z')
    assert.equal(directCreated.scheduleEndDate, '2035-01-10T23:59:59.000Z')
    await page.evaluate(draft => window.scheduleSmoke.openDraft(draft), combined); await createFromDraft.waitFor()
    await startDate.fill('2035-01-03')
    await schedule.locator('.schedule-multi-window-input').fill('09:00,16:00')
    await schedule.locator('.schedule-end-date-field input').fill('2035-01-12')
    await saveDraft.click(); await form.waitFor({ state: 'detached' })
    const editedDraft = await page.evaluate(() => window.scheduleSmoke.state.lastSavedDraft)
    assert.equal(editedDraft.payload.preservedSchedule, undefined, 'do not carry obsolete instants into the next draft')
    await page.evaluate(draft => window.scheduleSmoke.openDraft(draft), editedDraft); await createFromDraft.waitFor()
    const edited = await createCurrentDraft()
    assert.equal(edited.schedule, '2035-01-03T02:00:00.000Z')
    assert.equal(edited.scheduleEndDate, '2035-01-12T16:59:59.000Z')
    await page.evaluate(draft => window.scheduleSmoke.openDraft(draft), combined); await createFromDraft.waitFor()
    await schedule.locator('.schedule-end-date-field input').fill('')
    await schedule.getByRole('checkbox', { name: 'Chạy trong nhiều khung giờ trong 1 ngày', exact: true }).uncheck()
    await startTime.fill('11:00')
    const cleared = await createCurrentDraft()
    assert.equal(cleared.schedule, '2035-01-01T04:00:00.000Z'); assert.equal(cleared.scheduleEndDate, null)
    // Editing a campaign created from a legacy draft must not truncate its preserved cutoff on the next Save.
    await page.evaluate(value => window.scheduleSmoke.openCampaign({ ...value, id: 97 }), directCreated); await save.waitFor()
    const updatesBefore = await page.evaluate(() => window.scheduleSmoke.state.calls.filter(call => call.method === 'updateCampaign').length)
    await save.click()
    await page.waitForFunction(count => window.scheduleSmoke.state.calls.filter(call => call.method === 'updateCampaign').length > count, updatesBefore)
    const reopenedUpdate = await page.evaluate(() => window.scheduleSmoke.state.calls.filter(call => call.method === 'updateCampaign').at(-1).args[1])
    assert.equal(reopenedUpdate.schedule, directCreated.schedule)
    assert.equal(reopenedUpdate.scheduleEndDate, directCreated.scheduleEndDate)
    await form.waitFor({ state: 'detached' })
    await page.evaluate(() => window.scheduleSmoke.openNew()); await saveDraft.waitFor()
    await saveDraft.click(); await form.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.scheduleSmoke.state.lastSavedDraft.payload.scheduleTimeZone), 'Asia/Ho_Chi_Minh', 'new drafts also carry the timezone marker')
    assert.equal(await page.evaluate(() => window.scheduleSmoke.state.requests.length), requestsBeforeDraftTests, 'restoring/saving drafts never calls AI')
    await page.evaluate(draft => window.scheduleSmoke.openDraft(draft), combined); await createFromDraft.waitFor()
    await generate('bỏ giờ dừng'); await resolveAi({ useDailyStopTime: false }); await panel.waitFor({ state: 'detached' })
    assert.equal(await schedule.locator('.schedule-end-date-field input').inputValue(), '2035-01-11')
    assert((await schedule.locator('.schedule-end-date-field').innerText()).includes('06:59:59'), 'retained cutoff is still visible in the campaign form')
    const afterAi = await createCurrentDraft()
    assert.equal(afterAi.schedule, '2035-01-01T08:00:00.000Z'); assert.equal(afterAi.scheduleEndDate, '2035-01-10T23:59:59.000Z')

    const nextSchedule = loadNextSchedule()
    const saveCurrentCampaign = async () => {
      const count = await page.evaluate(() => window.scheduleSmoke.state.calls.filter(call => call.method === 'updateCampaign').length)
      await save.click()
      await page.waitForFunction(count => window.scheduleSmoke.state.calls.filter(call => call.method === 'updateCampaign').length > count, count)
      const updated = await page.evaluate(() => window.scheduleSmoke.state.calls.filter(call => call.method === 'updateCampaign').at(-1).args[1])
      await form.waitFor({ state: 'detached' })
      return updated
    }
    for (const scheduleType of ['daily', 'weekly', 'monthly']) {
      // The scheduler has advanced from 08:00 to 14:00; opening/saving must retain BOTH instants.
      const advanced = { ...directCreated, id: 98, scheduleType, scheduleWeekDays: '2,4,6', scheduleDays: '1,2,15',
        schedule: '2035-01-01T07:00:00.000Z', originalSchedule: '2035-01-01T01:00:00.000Z',
        continueNextDay: true, refreshData: true }
      await page.evaluate(value => window.scheduleSmoke.openCampaign(value), advanced); await save.waitFor()
      assert.equal(await startTime.inputValue(), '14:00')
      const unchanged = await saveCurrentCampaign()
      assert.equal(unchanged.schedule, advanced.schedule, `${scheduleType}: retain the pending slot`)
      assert.equal(unchanged.originalSchedule, advanced.originalSchedule, `${scheduleType}: retain the first-slot recurrence anchor`)
      assert.equal(unchanged.extraSettings.multiDailyTimeSlots, '08:00,14:00')
      const tomorrow = new Date('2035-01-02T00:00:00+07:00')
      const next = nextSchedule({ ...advanced, ...unchanged }, tomorrow)
      assert.equal(next.toISOString(), nextSchedule(advanced, tomorrow).toISOString())
      assert.equal(next.toISOString().slice(11, 16), '01:00', `${scheduleType}: the next period still starts at 08:00 Vietnam`)

      // Explicit date/slot edits release both saved instants and use the newly configured first slot.
      await page.evaluate(value => window.scheduleSmoke.openCampaign(value), advanced); await save.waitFor()
      await startDate.fill('2035-01-03')
      await schedule.locator('.schedule-multi-window-input').fill('09:00,16:00')
      const edited = await saveCurrentCampaign()
      assert.equal(edited.schedule, '2035-01-03T02:00:00.000Z')
      assert.equal(edited.originalSchedule, edited.schedule, `${scheduleType}: explicit edits replace the recurrence anchor`)

      if (scheduleType === 'daily') {
        await page.evaluate(value => window.scheduleSmoke.openCampaign(value), advanced); await save.waitFor()
        await generate('bỏ giờ dừng'); await resolveAi({ useDailyStopTime: false }); await panel.waitFor({ state: 'detached' })
        const unrelatedAi = await saveCurrentCampaign()
        assert.equal(unrelatedAi.schedule, advanced.schedule)
        assert.equal(unrelatedAi.originalSchedule, advanced.originalSchedule, 'AI leaves the recurrence anchor unchanged when not mentioned')

        await page.evaluate(value => window.scheduleSmoke.openCampaign(value), advanced); await save.waitFor()
        await schedule.getByRole('checkbox', { name: 'Chạy trong nhiều khung giờ trong 1 ngày', exact: true }).uncheck()
        await startTime.fill('10:00')
        const singleSlot = await saveCurrentCampaign()
        assert.equal(singleSlot.schedule, '2035-01-01T03:00:00.000Z')
        assert.equal(singleSlot.originalSchedule, singleSlot.schedule, 'single-hour edit releases the old recurrence anchor')
      }
    }
    await open()
    await schedule.getByRole('radio', { name: 'Theo tháng', exact: true }).check()
    const endBeforeNaturalFill = await schedule.locator('.schedule-end-date-field input').inputValue()
    const savesBeforeNaturalFill = await page.evaluate(() => window.scheduleSmoke.state.calls.filter(call => /^(createCampaign|updateCampaign|saveCampaignDraft)$/.test(call.method)).length)
    await generate('chạy vào buổi trưa đầu và giữa tháng')
    await resolveAi({ scheduleType: 'monthly', startTime: '12:00', scheduleDays: '1,15' })
    await panel.waitFor({ state: 'detached' })
    assert(await schedule.getByRole('radio', { name: 'Theo tháng', exact: true }).isChecked())
    assert.equal(await startTime.inputValue(), '12:00')
    await generate('chỉ đổi giờ chạy thành 7h30 sáng')
    await resolveAi({ startTime: '07:30' }); await panel.waitFor({ state: 'detached' })
    assert(await schedule.getByRole('radio', { name: 'Theo tháng', exact: true }).isChecked())
    assert.equal(await schedule.locator('.schedule-end-date-field input').inputValue(), endBeforeNaturalFill)
    await generate('chạy vào 7h30 sáng hôm nay')
    await resolveAi({ scheduleType: 'daily', startDate: '2026-10-14', startTime: '07:30' })
    await panel.waitFor({ state: 'detached' })
    assert(await schedule.getByRole('radio', { name: 'Hàng ngày', exact: true }).isChecked())
    assert.equal(await startDate.inputValue(), '2026-10-14'); assert.equal(await startTime.inputValue(), '07:30')
    assert.equal(await schedule.locator('.schedule-end-date-field input').count(), 0)
    await schedule.getByRole('radio', { name: 'Theo tháng', exact: true }).check()
    assert.equal(await schedule.locator('.schedule-end-date-field input').inputValue(), endBeforeNaturalFill, 'changing the cycle must not erase the hidden end date')
    assert.equal(await page.evaluate(() => window.scheduleSmoke.state.calls.filter(call => /^(createCampaign|updateCampaign|saveCampaignDraft)$/.test(call.method)).length), savesBeforeNaturalFill)
    assert.deepEqual(await page.evaluate(() => window.scheduleSmoke.state.errors), [])
    console.log('PASS natural schedule patches: monthly noon, partial hour preserves cycle/end, dated schedule changes to daily, hidden end retained, clarification visible without changes or autosave')
    console.log('PASS real campaign form: Enter submit/no newline/IME/repeat guards, success closes only the popover without preview/autosave, hover, full-form lock, Save-only validation, cancel/error/timeout/close/auth, Vietnam time, dark/light')
    console.log('PASS real draft form: legacy restore/save/reopen/create in UTC, Vietnam and Los Angeles, same instant, date rollover, new draft marker, no AI call')
    console.log('PASS multi-slot and weekly/monthly cutoffs: 15 timezone cases, direct creation, explicit edits/clear, obsolete override removal, campaign reopen, AI preservation')
    console.log('PASS advanced runtime slots: preserve originalSchedule and next daily/weekly/monthly run, replace anchor after explicit edits, preserve it after unrelated AI fill')
    await require('./campaign-limits-ai-ui-checks.cjs')(page)
    assert.deepEqual(await page.evaluate(() => window.scheduleSmoke.state.errors), [])
  } finally { if (app) await app.close(); rmSync(dir, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
