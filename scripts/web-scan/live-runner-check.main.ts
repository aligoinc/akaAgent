// Chạy trọn vòng một từ khoá (runWebScanTarget) với block thật trên trang thật trong cửa sổ ẩn Electron; API lõi giả (không ghi DB). Số điện
// thoại in ra đã che. nhatot bấm hiện số đúng LIVE_REVEALS lần (mặc định 2), batdongsan bấm tới khi gặp hộp đăng nhập (không đăng nhập thì 1 lần).
// Dựng bằng scripts/web-scan/live-runner-check.cjs.
import { app, BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import { PageController } from '../../src/main/v2/runtime/pageController'
import { BlockExecutor } from '../../src/main/v2/runtime/blockExecutor'
import { runWebScanTarget } from '../../src/main/engineAdapters/web/webScanTarget'
import { defaultWebScanCampaignSettings, WEB_SCAN_ACTION_CODES, type WebScanSite } from '../../src/shared/webScan'

declare const __BLOCKS__: Record<string, string>
const OUT = process.env.LIVE_OUT || 'live-runner.json'
const REVEALS = Number(process.env.LIVE_REVEALS || 2)
app.on('window-all-closed', () => {})
if (process.env.LIVE_USERDATA) app.setPath('userData', process.env.LIVE_USERDATA)
const mask = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null).replace(/0\d{5}(\d{3,5})/g, (_m, tail) => '0xxxxx' + tail))
const t0 = Date.now()
const log = (...args: unknown[]) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(7), ...args.map(a => typeof a === 'string' ? mask(a) : JSON.stringify(mask(a))))

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: 'persist:web-scan-live-runner', offscreen: true, backgroundThrottling: false } })
  const page = new PageController(win.webContents, { immediateScripts: true })
  const exec = new BlockExecutor()
  const out: Record<string, unknown> = {}
  const save = () => fs.writeFileSync(OUT, JSON.stringify(mask(out), null, 1))
  const runSite = async (site: WebScanSite, keyword: string, settingsPatch: Record<string, unknown>, remaining: number) => {
    const reports: unknown[] = []
    const success = { ok: true, dryRun: false, next: 'continue', pace: null, outcomes: [], target: { done: false, status: 'đang chạy', note: null, schedule: null },
      campaign: { effect: 'none', note: null }, account: { effect: 'none', loginEffect: 'none' }, safety: [] }
    const api: any = {
      targetRunId: 1, leaseToken: 'x', target: { id: 1, campaign_id: 1, name: keyword, phone: null, uid: keyword, email: null },
      actions: { [WEB_SCAN_ACTION_CODES[site]]: { decision: 'allow', required: true, remainingDaily: remaining, remainingWindow: remaining } },
      gateSettings: {}, signal: new AbortController().signal,
      reportMilestone: async (step: any, raw: any) => { reports.push({ key: step.key, actionCode: step.actionCode, ok: raw.ok, log: raw.customerLog, error: raw.signal?.errorCode, records: raw.data?.webRecords?.length }); log('report', step.key, raw.ok ? raw.customerLog : raw.signal?.errorCode); return success },
      reportMilestones: async (entries: any[]) => { for (const e of entries) await api.reportMilestone(e.step, e.raw); return success },
      shouldStop: () => false,
      progress: (text: string) => log('progress', text)
    }
    const pushed: unknown[] = []
    const end = await runWebScanTarget({
      api, site, settings: { ...defaultWebScanCampaignSettings(site), ...settingsPatch } as any, sleepSeconds: 10,
      runBlock: async (name, input) => {
        const started = Date.now()
        const r = await exec.execute({ code: __BLOCKS__[name], blockName: name, timeoutMs: 120000 }, { input: { waitMs: 30000, ...input }, page, vars: {}, signal: new AbortController().signal,
          onLog: line => log('  block log', name, line) })
        log('block', name, Date.now() - started, 'ms', r.success ? 'ok' : r.error)
        return r.success ? { ok: true, output: r.output as Record<string, unknown> } : { ok: false, error: r.error || 'lỗi' }
      },
      loadSeen: async () => ({ seen: new Set(), cached: new Map() }),
      recordSeen: async () => undefined,
      pushRecords: async records => { pushed.push(...records) },
      sleep: async ms => { await new Promise(r => setTimeout(r, ms)); return true }
    })
    out[site] = { end, reports, pushed: pushed.slice(0, 5), pushedCount: pushed.length }
    save()
  }
  try {
    await runSite('yellowpages', 'bao bì nhựa', { provinces: ['TP. Hồ Chí Minh (TPHCM)'], pagesPerSearch: 2, maxDataPerRun: 60 }, 10)
    await runSite('nhatot', 'nhà quận 7', { pagesPerSearch: 1 }, REVEALS)
    await runSite('batdongsan', 'quận 7', { pagesPerSearch: 1 }, 5)
  } catch (error: any) {
    out.fatal = String(error?.stack || error)
    save()
  }
  app.exit(0)
})
