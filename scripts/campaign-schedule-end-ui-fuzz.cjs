// Kiểm thử lặp ngày kết thúc trên form Desktop thật (Chromium của Playwright, IPC giả, chặn mọi request http).
// Ca sinh bằng bộ sinh chung của WebApp (scripts/campaign-schedule-end-fuzz/oracle.mjs) và so với cùng lời giải độc lập.
// Chạy: WEBAPP_REPO=<checkout akaAgentWebApp> [SCHEDULE_END_POOL=<json dữ liệu thật ngoài repo>] [SCHEDULE_END_UI_CHROMIUM=/opt/pw-browsers/chromium]
//   node scripts/campaign-schedule-end-ui-fuzz.cjs <hạt giống> [<số ca mỗi múi giờ>]
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')
const { build } = require('esbuild')
const { chromium } = require('playwright')

async function main() {
  const seed = Number(process.argv[2] || 1), perZone = Number(process.argv[3] || 40)
  if (!process.env.WEBAPP_REPO) throw new Error('Thiếu WEBAPP_REPO')
  const O = await import(pathToFileURL(join(process.env.WEBAPP_REPO, 'scripts/campaign-schedule-end-fuzz/oracle.mjs')).href)
  const r = O.rng(seed * 7919 + 13)
  const pool = O.loadPool(process.env.SCHEDULE_END_POOL)
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-schedule-end-fuzz-'))
  await build({ entryPoints: [join(__dirname, 'campaign-schedule-end-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.url': '"file:///smoke"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-schedule-end-ui-smoke.css"><body><div id="root"></div><script src="campaign-schedule-end-ui-smoke.js"></script></body></html>')
  const browser = await chromium.launch({ executablePath: process.env.SCHEDULE_END_UI_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const failures = [], stats = {}
  const bump = k => { stats[k] = (stats[k] || 0) + 1 }
  // Máy khách có thể không đặt giờ Việt Nam: form phải tính theo giờ Việt Nam ở mọi múi giờ máy.
  const zones = ['Asia/Ho_Chi_Minh', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Tokyo']
  const picked = [zones[0], zones[1 + (seed % (zones.length - 1))]]
  try {
    for (const timezoneId of picked) {
      const context = await browser.newContext({ viewport: { width: 1550, height: 1100 }, timezoneId })
      await context.route(/^https?:/, route => route.abort())
      const page = await context.newPage(); page.setDefaultTimeout(15000)
      let c = O.genFormCase(r, pool)
      await page.clock.setFixedTime(c.now)
      await page.goto(pathToFileURL(join(directory, 'index.html')).href)
      await page.waitForFunction(() => window.scheduleEndSmoke)
      const endInput = page.getByLabel('Ngày kết thúc', { exact: true })
      for (let i = 0; i < perZone; i++) {
        if (i > 0) c = O.genFormCase(r, pool)
        // Fixture chỉ mở được chiến dịch để sửa (nhân bản kiểm ở WebApp): coi nhân bản là sửa.
        if (c.mode === 'clone') c = { ...c, mode: 'edit' }
        // Form Desktop đọc ngày đã lưu từ DB (timestamptz): bỏ bản lưu hỏng, đó là phần kiểm không văng lỗi ở WebApp.
        if (c.saved && (c.saved.scheduleEndDate && (/^\d{4}-\d{2}-\d{2}$/.test(c.saved.scheduleEndDate) || O.vnDate(Date.parse(c.saved.scheduleEndDate)) === null)
          || !c.saved.schedule || O.vnDate(Date.parse(c.saved.schedule)) === null)) { i--; continue }
        await page.clock.setFixedTime(c.now)
        const today = O.vnDate(c.now)
        const savedType = c.saved ? (c.saved.scheduleType || 'daily') : 'daily'
        await page.evaluate(a => window.scheduleEndSmoke.open(...a), c.saved ? ['edit', savedType, c.saved.scheduleEndDate, c.saved.schedule] : ['new'])
        await page.getByText('Lịch chạy', { exact: false }).first().waitFor(); await page.waitForTimeout(250)
        if (c.type !== savedType || c.mode === 'new') {
          await page.getByRole('radio', { name: { daily: 'Hàng ngày', weekly: 'Theo tuần', monthly: 'Theo tháng' }[c.type] }).check()
          if (c.type === 'weekly' && c.mode === 'new') await page.getByRole('checkbox', { name: 'Thứ 2', exact: true }).check()
          if (c.type === 'monthly') { const days = page.getByPlaceholder('Ví dụ: 5,10,19,25'); if (!(await days.inputValue())) await days.fill('5,15') }
        }
        const recurring = c.type === 'weekly' || c.type === 'monthly'
        const savedEndKey = c.saved?.scheduleEndDate ? O.vnDate(Date.parse(c.saved.scheduleEndDate)) : ''
        const initWant = c.mode === 'new' || !savedEndKey ? O.addDays(today, 7) : savedEndKey
        if (recurring) {
          const init = await endInput.inputValue()
          if (init !== initWant) failures.push({ kind: 'desktop-ui-init', timezoneId, c, init, initWant })
        } else if (await endInput.count()) failures.push({ kind: 'desktop-ui-daily-has-end', timezoneId, c })
        if (c.run.kind === 'set') await page.locator('.schedule-date-field input').fill(O.vnDate(c.run.ms))
        const runKey = c.run.kind === 'set' ? O.vnDate(c.run.ms) : c.saved ? O.vnDate(Date.parse(c.saved.schedule)) : today
        const shownRun = await page.locator('.schedule-date-field input').inputValue()
        if (shownRun !== runKey) failures.push({ kind: 'desktop-ui-run', timezoneId, c, shownRun, runKey })
        // Ô date của trình duyệt chỉ nhận ngày có thật: dán chuỗi hỏng thì ô thành trống (như khách xoá ngày).
        let endValue = initWant
        if (recurring && c.typed.kind === 'set') { await endInput.fill(O.isCalendarDate(c.typed.value) ? c.typed.value : ''); endValue = await endInput.inputValue() }
        const want = O.expectedVerdict({ type: c.type, endKey: endValue, runKey, todayKey: today })
        await page.getByPlaceholder('Nhập tên chiến dịch...').fill(`Fuzz ${i}`)
        const before = await page.evaluate(() => ({ c: window.scheduleEndSmoke.state.created.length, u: window.scheduleEndSmoke.state.updated.length, a: window.scheduleEndSmoke.state.alerts.length }))
        await page.getByRole('button', { name: c.mode === 'new' ? 'Lưu chiến dịch' : /Lưu/ }).first().click()
        await page.waitForFunction(b => { const s = window.scheduleEndSmoke.state; return s.created.length > b.c || s.updated.length > b.u || s.alerts.length > b.a }, before, { timeout: 15000 }).catch(() => {})
        const after = await page.evaluate(b => { const s = window.scheduleEndSmoke.state; return { created: s.created[b.c] ?? null, updated: s.updated[b.u]?.data ?? null, alerts: s.alerts.slice(b.a).map(x => x.message) } }, before)
        const saved = after.created || after.updated
        const alert = after.alerts.join(' | ')
        // Luật giờ chạy khác (23:59 dừng nhận lượt mới): không thuộc phần này.
        if (alert.startsWith('23:59 là thời gian')) { bump('skip:2359'); continue }
        bump(`${c.mode}:${want ?? 'ok'}`)
        if (want) {
          if (saved || alert !== want) failures.push({ kind: 'desktop-ui-verdict', timezoneId, c, endValue, runKey, want, alert, saved: Boolean(saved) })
        } else if (!saved) failures.push({ kind: 'desktop-ui-blocked', timezoneId, c, endValue, runKey, alert })
        else {
          // Gõ lại đúng ngày đang có cũng là giữ nguyên: Desktop giữ mốc kết thúc cũ khi mốc đó không phải cuối ngày (có dòng báo dưới ô).
          const keptIso = c.mode === 'edit' && endValue === savedEndKey && c.type !== 'daily' && c.saved.scheduleEndDate
            && O.endOfVnDay(savedEndKey) !== new Date(c.saved.scheduleEndDate).toISOString() ? new Date(c.saved.scheduleEndDate).toISOString() : null
          const endWant = !recurring ? null : keptIso ?? O.endOfVnDay(endValue)
          const gotEnd = saved.scheduleEndDate === undefined ? '(không gửi)' : saved.scheduleEndDate
          // Sửa chiến dịch: Desktop chỉ gửi các ô đổi; ngày kết thúc không đổi thì có thể không gửi.
          const unchanged = c.mode === 'edit' && gotEnd === '(không gửi)' && endWant === (c.saved.scheduleEndDate ? new Date(c.saved.scheduleEndDate).toISOString() : null)
          if (gotEnd !== endWant && !unchanged && !(endWant === null && gotEnd === '(không gửi)'))
            failures.push({ kind: 'desktop-ui-stored', timezoneId, c, endValue, endWant, gotEnd })
        }
      }
      const errors = await page.evaluate(() => window.scheduleEndSmoke.state.errors)
      if (errors.length) failures.push({ kind: 'desktop-ui-page-error', timezoneId, errors: errors.slice(0, 5) })
      await context.close()
    }
  } finally {
    await browser.close()
    rmSync(directory, { recursive: true, force: true })
  }
  if (process.env.SCHEDULE_END_UI_OUT) writeFileSync(process.env.SCHEDULE_END_UI_OUT, JSON.stringify({ seed, stats, failures }, null, 1))
  console.log(`desktop-ui seed ${seed}: ${perZone} ca × ${picked.join(', ')}; ${JSON.stringify(stats)}; lỗi ${failures.length}`)
  for (const f of failures.slice(0, 6)) console.log('  ', JSON.stringify(f).slice(0, 700))
  if (failures.length) process.exit(1)
}
main().catch(error => { console.error(error); process.exit(1) })
