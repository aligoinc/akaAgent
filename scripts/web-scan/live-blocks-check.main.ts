// Chạy code block quét web (đúng code V618 sẽ chèn vào DB) bằng PageController + BlockExecutor thật trong cửa sổ ẩn Electron, trên trang thật.
// Chỉ đọc, trừ nhatot bấm "Hiện SĐT" đúng LIVE_REVEALS lần (mặc định 1) và batdongsan bấm "Hiện số" một lần khi chưa đăng nhập (để thấy hộp
// đăng nhập). Số điện thoại in ra đã che. Dựng bằng scripts/web-scan/live-blocks-check.cjs.
import { app, BrowserWindow } from 'electron'
import * as fs from 'node:fs'
import { PageController } from '../../src/main/v2/runtime/pageController'
import { BlockExecutor } from '../../src/main/v2/runtime/blockExecutor'

declare const __BLOCKS__: Record<string, string>
const OUT = process.env.LIVE_OUT || 'live-blocks.json'
const REVEALS = Number(process.env.LIVE_REVEALS || 1)
app.on('window-all-closed', () => {})
if (process.env.LIVE_USERDATA) app.setPath('userData', process.env.LIVE_USERDATA)

const mask = (text: unknown): unknown => JSON.parse(JSON.stringify(text ?? null).replace(/0\d{5}(\d{3,5})/g, (_m, tail) => '0xxxxx' + tail))

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { partition: 'persist:web-scan-live-check', offscreen: true, backgroundThrottling: false } })
  const page = new PageController(win.webContents, { immediateScripts: true })
  const exec = new BlockExecutor()
  const raw: Record<string, unknown> = { startedAt: new Date().toISOString(), ua: win.webContents.getUserAgent() }
  // Ghi file sau mỗi lần gán kết quả: block treo thì vẫn còn kết quả các bước trước.
  const out = new Proxy(raw, { set(target, key, value) { target[key as string] = value; fs.writeFileSync(OUT, JSON.stringify(target, null, 1)); return true } })
  const run = async (name: string, input: Record<string, unknown>) => {
    const started = Date.now()
    console.log(new Date().toISOString(), 'start', name, JSON.stringify(input))
    const limitMs = Number(process.env.LIVE_BLOCK_TIMEOUT_MS || 120000)
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<{ success: false; error: string; output?: undefined }>(resolve => { timer = setTimeout(() => resolve({ success: false, error: `quá ${limitMs} ms (treo)` }), limitMs) })
    const r = await Promise.race([exec.execute({ code: __BLOCKS__[name], blockName: name, timeoutMs: limitMs }, { input, page, vars: {}, signal: new AbortController().signal,
      onLog: line => console.log(new Date().toISOString(), '  log', name, line) }), timeout])
    if (timer) clearTimeout(timer)
    console.log(new Date().toISOString(), 'done', name, Date.now() - started, 'ms', r.success ? 'ok' : 'error ' + r.error)
    return { ms: Date.now() - started, success: r.success, error: r.error, output: r.output }
  }
  const summary = (r: any) => ({ ms: r.ms, success: r.success, error: r.error, ...Object.fromEntries(Object.entries(r.output || {}).filter(([k]) => k !== 'items')),
    itemCount: Array.isArray(r.output?.items) ? r.output.items.length : undefined, sample: Array.isArray(r.output?.items) ? mask(r.output.items.slice(0, 2)) : undefined })
  try {
    if (process.env.LIVE_ONLY === 'nhatot') {
      const nt = await run('[engine] web_nhatot_list', { keyword: 'nhà quận 7', section: 'sale', page: 1 })
      const brokers = ((nt.output as any)?.items || []).filter((x: any) => x.isBroker).slice(0, REVEALS)
      const reveals: unknown[] = []
      for (const item of brokers) { reveals.push(mask(await run('[engine] web_nhatot_reveal', { link: item.link }))); out.nhatotReveal = reveals }
      out.finishedAt = new Date().toISOString()
      app.exit(0)
      return
    }
    // Trang Vàng
    const tvUrl = 'https://www.yellowpages.vn/srch/' + encodeURIComponent('tp._hồ_chí_minh_(tphcm)') + '/bao_bi_nhua.html'
    const tv = await run('[engine] web_yellowpages_list', { url: tvUrl, page: 1 })
    out.yellowpagesList = summary(tv)
    const tv2 = await run('[engine] web_yellowpages_list', { url: tvUrl, page: 2 })
    out.yellowpagesList2 = summary(tv2)
    const firstTv = (tv.output as any)?.items?.[0]
    if (firstTv) out.yellowpagesDetail = mask((await run('[engine] web_yellowpages_detail', { link: firstTv.link })))
    // nhatot
    const nt = await run('[engine] web_nhatot_list', { keyword: 'nhà quận 7', section: 'sale', page: 1 })
    out.nhatotList = summary(nt)
    out.nhatotRent = summary(await run('[engine] web_nhatot_list', { keyword: 'nhà quận 7', section: 'rent', page: 2 }))
    const items = ((nt.output as any)?.items || []).filter((x: any) => x.isBroker)
    out.nhatotReveal = []
    const reveals: unknown[] = []
    for (const item of items.slice(0, REVEALS)) { reveals.push(mask(await run('[engine] web_nhatot_reveal', { link: item.link }))); out.nhatotReveal = reveals }
    // batdongsan
    const search = await run('[engine] web_batdongsan_search', { keyword: 'quận 7', section: 'sale' })
    out.batdongsanSearch = mask(search)
    const url = (search.output as any)?.url
    if (url) {
      const list = await run('[engine] web_batdongsan_list', { url, page: 2 })
      out.batdongsanList = summary(list)
      const first = (list.output as any)?.items?.[0]
      if (first && process.env.LIVE_BDS_REVEAL !== '0') out.batdongsanReveal = mask(await run('[engine] web_batdongsan_reveal', { listingKey: first.listingKey }))
      if (first) out.batdongsanDetail = mask(await run('[engine] web_batdongsan_detail', { link: first.link }))
    }
    out.batdongsanSearchRent = mask(await run('[engine] web_batdongsan_search', { keyword: 'Vinhomes Grand Park', section: 'rent' }))
  } catch (error: any) {
    out.fatal = String(error?.stack || error)
  }
  out.finishedAt = new Date().toISOString()
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
  app.exit(0)
})
