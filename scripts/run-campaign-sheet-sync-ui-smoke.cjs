// Đồng bộ Google Sheet vào data chiến dịch (V662): kiểm giao diện Desktop thật với IPC giả lập trên Chromium của Playwright.
//   node scripts/run-campaign-sheet-sync-ui-smoke.cjs
//   SHEET_SYNC_UI_SHOTS=<thư mục> node scripts/run-campaign-sheet-sync-ui-smoke.cjs   # kiểm + chụp màn hình
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, mkdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { chromium } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-sheet-sync-ui-'))
  const shots = process.env.SHEET_SYNC_UI_SHOTS || ''
  if (shots) mkdirSync(shots, { recursive: true })
  await build({ entryPoints: [join(__dirname, 'campaign-sheet-sync-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"file:///akaagent/smoke/x.tsx"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-sheet-sync-ui-smoke.css"><body><div id="root"></div><script src="campaign-sheet-sync-ui-smoke.js"></script></body></html>')
  const chromiumPath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : ''
  const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath, args: ['--no-sandbox'] } : {})
  let cases = 0
  const ok = name => { cases += 1; console.log(`PASS ${name}`) }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' })).newPage()
    page.setDefaultTimeout(10000)
    await page.goto(`file://${join(directory, 'index.html')}`)
    await page.waitForFunction(() => window.sheetSmoke)
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.sheetSmoke.state)))
    const set = values => page.evaluate(next => Object.assign(window.sheetSmoke.state, next), values)
    const shot = async name => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }) }
    const closeAlerts = async () => {
      const overlay = page.locator('#root .modal-overlay')
      while (await overlay.count()) { await overlay.first().locator('.btn-icon').first().click(); await page.waitForTimeout(50) }
    }
    const ipc = async action => (await state()).calls.filter(c => c.method === 'campaignSheetSyncCall' && c.args[0].action === action).map(c => c.args[0])

    // 1. Cửa sổ Upload: khối chỉ hiện ở tab Link sheet với link Google Sheet.
    await page.locator('#campaign-import-tab-sheet').click()
    const link = page.locator('#campaign-import-sheet-link')
    await link.fill('https://example.com/data.csv')
    assert.equal(await page.locator('.campaign-sheet-sync-block').count(), 0)
    await link.fill('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQr/edit?usp=sharing#gid=77')
    await page.locator('.campaign-sheet-sync-block').waitFor()
    assert.equal(await page.locator('.campaign-sheet-sync-fields').count(), 0, 'chưa tích thì chưa hiện chu kỳ')
    ok('khối "Đồng bộ định kỳ" chỉ hiện với link Google Sheet')

    await page.getByRole('button', { name: 'Đọc dữ liệu' }).click()
    await page.waitForFunction(() => window.sheetSmoke.state.calls.some(c => c.method === 'loadCampaignDataFromSheet'))
    await page.getByLabel('Đồng bộ liên tục từ link Google Sheet này').check()
    const select = page.locator('.campaign-sheet-sync-field select')
    assert.equal(await select.inputValue(), '6')
    const date = page.locator('.campaign-sheet-sync-field input[type="date"]')
    const expectedDefault = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + 30 * 86400000)))
    assert.equal(await date.inputValue(), expectedDefault)
    await date.fill('2099-01-01')
    await page.locator('.campaign-sheet-sync-error').waitFor()
    assert.match(await page.locator('.campaign-sheet-sync-error').innerText(), /365 ngày/)
    await date.fill(expectedDefault)
    await select.selectOption('12')
    assert.match(await page.locator('.campaign-sheet-sync-help').innerText(), /Cứ 12 giờ/)
    await shot('upload-link-sheet')
    ok('bật đồng bộ: mặc định 6 giờ, ngày dừng hôm nay + 30, báo lỗi khi quá 365 ngày')

    await page.getByRole('button', { name: 'Kiểm tra dữ liệu' }).click()
    await page.locator('.campaign-import-results').waitFor()
    // Thông báo "Đã kiểm tra…" của cửa sổ: đóng như khách.
    const notice = page.locator('#root .modal-overlay')
    if (await notice.count()) { await notice.locator('.btn-icon').first().click(); await notice.waitFor({ state: 'detached' }) }
    await page.getByRole('button', { name: /Chèn xuống chi tiết/ }).click()
    await page.waitForFunction(() => window.sheetSmoke.state.submission)
    const submission = (await state()).submission
    assert.equal(submission.rows.length, 2)
    const draft = submission.sheetSync
    assert.ok(draft, 'có lựa chọn đồng bộ')
    assert.equal(draft.config.url, 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQr/edit#gid=77')
    assert.equal(draft.config.hasHeader, true)
    assert.equal(draft.config.mapping.phone, 0)
    assert.deepEqual(draft.config.expectedHeaders, ['SĐT', 'Tên'])
    assert.equal(draft.config.targetField, 'phone')
    assert.equal(draft.everyHours, 12)
    assert.deepEqual(draft.sheetValues.sort(), ['0912345678', '0912345679'])
    assert.match(draft.requestId, /^sheet-[a-z0-9-]+$/)
    ok('chèn data gửi kèm cấu hình nguồn, chu kỳ và mốc ban đầu cho form')

    // 2. Công tắc tắt: không hiện khối.
    await set({ settingsAvailable: false })
    await page.evaluate(() => window.sheetSmoke.view('note'))
    await page.evaluate(() => window.sheetSmoke.view('upload'))
    await page.locator('#campaign-import-tab-sheet').click()
    await page.locator('#campaign-import-sheet-link').fill('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQr/edit')
    await page.waitForTimeout(200)
    assert.equal(await page.locator('.campaign-sheet-sync-block').count(), 0)
    ok('công tắc tắt thì không hiện khối')

    // 3. Dòng tóm tắt trong form.
    await page.evaluate(() => window.sheetSmoke.view('note'))
    const note = page.locator('.campaign-sheet-sync-note')
    await note.waitFor()
    assert.match(await note.innerText(), /Đồng bộ Google Sheet · mỗi 6 giờ · đến \d{2}\/\d{2}\/\d{4}/)
    await note.getByRole('button', { name: 'Sửa' }).click()
    await note.locator('select').selectOption('24')
    await note.getByRole('button', { name: 'Xong' }).click()
    assert.match(await note.innerText(), /mỗi 24 giờ/)
    await shot('form-note')
    await note.getByRole('button', { name: 'Bỏ' }).click()
    await page.locator('#note-removed').waitFor()
    ok('dòng tóm tắt: Sửa chu kỳ, Bỏ đồng bộ')

    // 4. Thẻ trong chiến dịch.
    const base = {
      id: 5, revision: 3, actionId: 'zalo_message_phone',
      config: { url: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQr/edit', hasHeader: true, mapping: { phone: 0 }, columnCount: 2, phonePolicy: 'first', targetField: 'phone', platform: 'zalo' },
      everyHours: 6, endDate: expectedDefault, splitMode: 'all', campaignIds: [1],
      campaigns: [{ campaignId: 1, position: 0, state: 'active', added: 49 }], isEnabled: true, status: 'success',
      nextRunAt: '2026-11-26T13:00:00Z', lastRunAt: '2026-11-26T07:00:00Z', lastSuccessAt: '2026-11-26T07:00:02Z', lastAdded: 37, totalAdded: 49,
      retryCount: 0, lastErrorCode: null, lastErrorMessage: null, stoppedReason: null, stoppedAt: null, createdAt: '2026-11-25T13:00:00Z', updatedAt: '2026-11-26T07:00:02Z'
    }
    await set({ sync: base, active: true })
    await page.evaluate(() => window.sheetSmoke.view('card'))
    const card = page.locator('.campaign-sheet-sync-card')
    await card.waitFor()
    assert.equal(await card.locator('.campaign-sheet-sync-pill').innerText(), 'Đang bật')
    assert.match(await card.innerText(), /Mỗi 6 giờ/)
    assert.match(await card.innerText(), /\d{2}:\d{2} \d{2}\/\d{2} · thêm 37 data/)
    assert.match(await card.innerText(), /49 data/)
    await card.getByRole('button', { name: 'Lịch sử' }).click()
    await card.locator('.campaign-sheet-sync-runs').waitFor()
    assert.equal(await card.locator('.campaign-sheet-sync-run').count(), 4)
    assert.match(await card.locator('.campaign-sheet-sync-runs').innerText(), /Thành công · 37 dòng mới, 2 trùng đã bỏ/)
    await shot('card-on')
    ok('thẻ đang bật: trạng thái, chu kỳ, số data, lịch sử')

    await card.getByRole('button', { name: 'Tắt đồng bộ' }).click()
    const confirm = page.locator('.modal-overlay, .confirm-modal, [role="dialog"]').filter({ hasText: 'Tắt đồng bộ Google Sheet?' }).last()
    await confirm.waitFor()
    await confirm.getByRole('button', { name: 'Tắt đồng bộ' }).click()
    await page.waitForFunction(() => window.sheetSmoke.state.calls.some(c => c.args[0] && c.args[0].action === 'stop'))
    assert.deepEqual((await ipc('stop'))[0], { action: 'stop', syncId: 5, campaignId: 1 })
    await card.locator('.campaign-sheet-sync-pill', { hasText: 'Đã tắt' }).waitFor()
    assert.match(await card.innerText(), /Đã tắt đồng bộ\. Data đã thêm vẫn được giữ\./)
    await closeAlerts()
    await card.getByRole('button', { name: 'Bật lại' }).click()
    await card.locator('.campaign-sheet-sync-pill', { hasText: 'Đang chờ đồng bộ' }).waitFor()
    await closeAlerts()
    assert.deepEqual((await ipc('resume'))[0], { action: 'resume', syncId: 5, campaignId: 1 })
    ok('Tắt đồng bộ hỏi lại rồi gọi stop; Bật lại gọi resume')

    await set({ sync: { ...base, status: 'error', isEnabled: false, stoppedReason: 'sheet_columns_changed', lastErrorCode: 'sheet_columns_changed' }, active: true })
    await page.evaluate(() => window.sheetSmoke.remountCard())
    await card.locator('.campaign-sheet-sync-pill', { hasText: 'Đã dừng' }).waitFor()
    assert.match(await card.innerText(), /Cột của Sheet đã thay đổi/)
    assert.equal(await card.getByRole('button', { name: 'Bật lại' }).count(), 0)
    await shot('card-columns-changed')
    await card.getByRole('button', { name: 'Kết nối lại' }).click()
    const reconnect = page.locator('.modal-overlay, .confirm-modal, [role="dialog"]').filter({ hasText: 'Kết nối lại Google Sheet' }).last()
    await reconnect.waitFor()
    assert.match(await reconnect.innerText(), /Đã đọc 4 dòng/)
    await reconnect.getByRole('button', { name: 'Kết nối lại' }).click()
    await page.waitForFunction(() => window.sheetSmoke.state.calls.some(c => c.args[0] && c.args[0].action === 'save'))
    await closeAlerts()
    const save = (await ipc('save'))[0]
    assert.equal(save.syncId, 5); assert.equal(save.expectedRevision, 3)
    assert.equal(save.config.mapping.phone, 0); assert.equal(save.config.hasHeader, true)
    assert.deepEqual(save.sheetValues.sort(), ['0912345678', '0912345679'])
    ok('cột đổi: Kết nối lại đọc Sheet, tự nhận cột, dòng hiện có làm mốc')

    await set({ sync: { ...base, status: 'expired', isEnabled: false, stoppedReason: 'expired', endDate: '2026-01-01' }, active: true })
    await closeAlerts()
    await page.evaluate(() => window.sheetSmoke.remountCard())
    await card.getByRole('button', { name: 'Gia hạn đồng bộ' }).click()
    await card.locator('input[type="date"]').fill(expectedDefault)
    await card.getByRole('button', { name: 'Bật lại' }).click()
    await page.waitForFunction(() => window.sheetSmoke.state.calls.filter(c => c.args[0] && c.args[0].action === 'resume').length >= 2)
    await closeAlerts()
    assert.equal((await ipc('resume'))[1].endDate, expectedDefault)
    ok('hết hạn: Gia hạn đồng bộ chọn ngày mới rồi bật lại')

    await set({ sync: null })
    await page.evaluate(() => window.sheetSmoke.remountCard())
    await page.waitForTimeout(150)
    assert.equal(await page.locator('.campaign-sheet-sync-card').count(), 0)
    ok('chiến dịch không có nguồn thì không có thẻ')

    assert.deepEqual((await state()).errors, [])
  } finally {
    await browser.close()
  }
  console.log(`\n${cases} PASS`)
}

main().catch(error => { console.error(error); process.exit(1) })
