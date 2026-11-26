// V663 (câu 605 / 2843 / 637 / 632 / 609 / 610 / 3186): chạy TRONG tiến trình chính của Electron thật (bởi v663-electron-smoke.cjs). Code block
// 2879 / 2880 (bản production và bản V663) chạy bằng BlockExecutor + PageController thật trên cửa sổ chạy ngầm ẩn cấu hình như app
// (BackgroundPageManager), helpers.sleep thật. Mỗi ca một phiên riêng: mọi yêu cầu https của phiên (block mở https://facebook.com) trả trang
// chủ giả của ca (v663-fake-home.cjs), không chạm Facebook. Cùng danh sách ca và kỳ vọng với v663-smoke.cjs (Playwright).
import { app, BrowserWindow, session } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PageController } from '../../src/main/v2/runtime/pageController'
import { BlockExecutor } from '../../src/main/v2/runtime/blockExecutor'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { homePage, STATE_SCRIPT, CASES } = require('./v663-fake-home.cjs') as {
  homePage: (cfg: unknown) => string
  STATE_SCRIPT: string
  CASES: Array<{ key: string; why: string; block: 'get' | 'switch'; cfg: unknown; opts?: { vars?: Record<string, unknown>; input?: Record<string, unknown>; abortAfterMs?: number }
    old: ((r: RunOutcome) => void) | null; new: ((r: RunOutcome) => void) | null }>
}

interface RunOutcome { out: Record<string, unknown>; ops: Array<{ op: string }>; vars: Record<string, unknown>; state: Record<string, unknown> }
type Label = 'production' | 'V663'
const codes = JSON.parse(fs.readFileSync(String(process.env.V663_ELECTRON_CODES), 'utf8')) as Record<'get' | 'switch', Record<Label, string>>
const BLOCK_NAMES = { get: 'fb_get_current_identity_name', switch: 'fb_switch_identity_by_name' }
const EXPECT_NEW_ON_OLD = process.env.V663_EXPECT_NEW_ON_OLD === '1'
const CONCURRENCY = Number(process.env.V663_ELECTRON_CONCURRENCY || 8)

let passed = 0
let failed = 0

/** Cửa sổ chạy ngầm cấu hình y như BackgroundPageManager.getOrCreate (ẩn, offscreen, không giảm tốc khi ẩn), mỗi ca một phiên. */
function backgroundWindow(partition: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1920, height: 1080, show: false, skipTaskbar: true, frame: false, paintWhenInitiallyHidden: true,
    webPreferences: { partition, sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true }
  })
  win.webContents.setBackgroundThrottling(false)
  return win
}

async function runCase(label: Label, c: (typeof CASES)[number], index: number): Promise<RunOutcome> {
  const partition = `persist:v663_${label}_${index}`
  const html = homePage(c.cfg)
  session.fromPartition(partition).protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
  const win = backgroundWindow(partition)
  try {
    const real = new PageController(win.webContents)
    const ops: Array<{ op: string }> = []
    const page = new Proxy(real, {
      get(target, key, receiver) {
        const value = Reflect.get(target, key, receiver)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          if (key === 'navigate' || key === 'type') ops.push({ op: String(key) })
          return value.apply(target, args)
        }
      }
    })
    const vars: Record<string, unknown> = { facebookStepMs: 1000, ...(c.opts?.vars ?? {}) }
    const controller = new AbortController()
    if (c.opts?.abortAfterMs != null) setTimeout(() => controller.abort(), c.opts.abortAfterMs)
    const result = await new BlockExecutor().execute({ code: codes[c.block][label], blockName: BLOCK_NAMES[c.block], timeoutMs: 180_000 },
      { input: { ...(c.opts?.input ?? {}) }, page, vars, signal: controller.signal })
    const out = result.success ? JSON.parse(JSON.stringify(result.output ?? null)) : { thrown: String(result.error ?? '') }
    const state = await real.evaluate<Record<string, unknown>>(STATE_SCRIPT).catch(() => ({}))
    return { out, ops, vars: JSON.parse(JSON.stringify(vars)), state }
  } finally {
    win.destroy()
  }
}

async function main(): Promise<void> {
  const runs: Array<[Label, 'old' | 'new']> = EXPECT_NEW_ON_OLD ? [['production', 'new']] : [['production', 'old'], ['V663', 'new']]
  const jobs: Array<{ label: Label; c: (typeof CASES)[number]; expect: (r: RunOutcome) => void; index: number }> = []
  for (const [label, key] of runs) {
    CASES.forEach((c, index) => { const expect = c[key]; if (expect) jobs.push({ label, c, expect, index }) })
  }
  const results: Array<{ job: (typeof jobs)[number]; res: RunOutcome | null; error: unknown }> = []
  let next = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      try { results.push({ job, res: await runCase(job.label, job.c, job.index), error: null }) } catch (error) { results.push({ job, res: null, error }) }
    }
  }))
  results.sort((a, b) => jobs.indexOf(a.job) - jobs.indexOf(b.job))
  for (const { job, res, error } of results) {
    const name = `Electron · ${job.label} · ${job.c.block} · ${job.c.key}: ${job.c.why}`
    try {
      if (!res) throw error
      job.expect(res)
      passed++
      console.log(`PASS ${name}`)
    } catch (e) {
      failed++
      console.log(`FAIL ${name}: ${(e as Error)?.stack ?? e}`)
    }
  }
  console.log(`\n${passed} kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  app.exit(failed ? 1 : 0)
}

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-v663-electron-')))
app.dock?.hide()
app.on('window-all-closed', () => { /* chạy tiếp tới khi main gọi app.exit */ })
app.whenReady().then(main).catch(error => { console.log(`FAIL khởi chạy: ${error?.stack ?? error}`); app.exit(1) })
