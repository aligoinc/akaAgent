// V658 (câu 639 / 3300 / 6279): phát lại luật nhận trang xác minh / đăng nhập trên đường dẫn thật ở bước mở nhóm (node `nav`, block 2841) của
// mọi lượt workflow 316 (comment seeding), chỉ đọc production. Chạy đúng đoạn chèn của block 2859 (v658-checkpoint.fragment.js) trong sandbox
// và đúng hàm facebookPageStateSignal của bộ lập lịch (mục 6a), so với kết quả thật của lượt (auto_engine_target_runs.final_error_code).
//
// Lấy dữ liệu (chỉ đọc; dùng chỉ mục idx_runs_workflow + idx_run_steps_node, không quét auto_run_steps theo thời gian), lưu NGOÀI repo:
//   with a as (select id, nullif(variables->>'engineTargetRunId', '')::bigint tr, campaign_id, account_id, created_at, status
//              from public.auto_runs where workflow_id = 316 and created_at >= now() - interval '8 days')
//   select json_agg(json_build_object('run', a.id, 'tr', a.tr, 'camp', a.campaign_id, 'acct', a.account_id, 'at', a.created_at,
//     'url', nav.output->>'currentUrl', 'scanned', prep.output->>'scannedCount', 'final', t.final_error_code,
//     'finalStatus', t.final_target_status, 'org', t.organization_id))
//   from a
//   left join lateral (select s.output from public.auto_run_steps s where s.run_id = a.id and s.node_id = 'nav' order by s.id limit 1) nav on true
//   left join lateral (select s.output from public.auto_run_steps s where s.run_id = a.id and s.node_id = 'prepare_iters' order by s.id desc limit 1) prep on true
//   left join public.auto_engine_target_runs t on t.id = a.tr;
//   supabase db query --linked --workdir <repo chính> -f <file sql> -o json > <ngoài repo>/rows.json
// Chạy: node scripts/engine-v2-facebook/v658-replay.cjs <ngoài repo>/rows.json
// In bảng tổng hợp (đường dẫn đã che mã nhóm / mã số); không in đường dẫn thật.
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const [rowsFile] = process.argv.slice(2)
if (!rowsFile) { console.error('Dùng: node scripts/engine-v2-facebook/v658-replay.cjs <rows.json>'); process.exit(2) }
const raw = JSON.parse(fs.readFileSync(rowsFile, 'utf8'))
let rows = Object.values((raw.rows || raw)[0])[0]
if (typeof rows === 'string') rows = JSON.parse(rows)
const FRAGMENT = fs.readFileSync(path.join(ROOT, 'scripts/engine-v2-facebook/v658-checkpoint.fragment.js'), 'utf8')
const hostOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'v658-replay-')), 'milestoneOutcomes.cjs')
require('esbuild').buildSync({ entryPoints: [path.join(ROOT, 'src/main/engineAdapters/facebook/milestoneOutcomes.ts')], bundle: false, format: 'cjs',
  platform: 'node', outfile: hostOut, logLevel: 'error' })
const { facebookPageStateSignal } = require(hostOut)

async function blockCode(url) {
  const page = { async evaluate(code) { if (!code.includes('location.href')) throw new Error('evaluate lạ'); return url } }
  const ctx = vm.createContext({ page, helpers: { log() {} }, vars: { inputDataId: 1 }, console })
  const out = await vm.runInContext(`(async () => { const MAX_SCANNED_POSTS = 0, MAX_SCROLL_CYCLES = 0, MAX_NO_GROWTH_CYCLES = 0;\n${FRAGMENT}\nreturn null })()`, ctx)
  return out && out.actionResult ? out.actionResult.errorCode : null
}
const HOST_CODE = { fb_checkpoint: 'err_fb_checkpoint', fb_logged_out: 'err_engine_fb_logged_out' }
const mask = url => {
  try {
    const u = new URL(url)
    return u.hostname + u.pathname.replace(/\/groups\/[^/]+/, '/groups/<g>').replace(/\/\d+/g, '/<n>').replace(/\/[A-Za-z0-9_.-]{20,}/g, '/<id>')
  } catch { return url ? '<không phải URL>' : '<trống>' }
}

;(async () => {
  const out = { rows: rows.length, noNav: 0, disagree: 0, byOutcome: {}, flaggedSuccess: 0, flaggedPaths: {}, fb45ZeroScannedNotFlagged: {},
    flaggedFb45: { runs: 0, accounts: new Set(), campaigns: new Set(), orgs: new Set(), byDay: {} } }
  for (const row of rows) {
    if (!row.url) { out.noNav++; continue }
    const code = await blockCode(row.url)
    const host = facebookPageStateSignal(row.url)
    if ((host ? HOST_CODE[host.code] : null) !== code) out.disagree++
    const outcome = row.final == null ? (row.finalStatus || 'không có lượt engine') : row.final
    const key = `${outcome} | V658=${code || '-'}`
    out.byOutcome[key] = (out.byOutcome[key] || 0) + 1
    if (code && row.final == null && row.tr) out.flaggedSuccess++
    if (code) out.flaggedPaths[mask(row.url)] = (out.flaggedPaths[mask(row.url)] || 0) + 1
    if (!code && row.final === 'err_engine_fb_no_history' && Number(row.scanned) === 0) {
      out.fb45ZeroScannedNotFlagged[mask(row.url)] = (out.fb45ZeroScannedNotFlagged[mask(row.url)] || 0) + 1
    }
    if (code && row.final === 'err_engine_fb_no_history') {
      const f = out.flaggedFb45
      f.runs++; f.accounts.add(row.acct); f.campaigns.add(row.camp); f.orgs.add(row.org)
      const day = new Date(new Date(row.at).getTime() + 7 * 3600e3).toISOString().slice(0, 10)
      f.byDay[day] = (f.byDay[day] || 0) + 1
    }
  }
  const f = out.flaggedFb45
  out.flaggedFb45 = { runs: f.runs, accounts: f.accounts.size, campaigns: f.campaigns.size, orgs: f.orgs.size,
    byDay: Object.fromEntries(Object.entries(f.byDay).sort()) }
  console.log(JSON.stringify(out, null, 1))
})().catch(error => { console.error(error); process.exit(1) })
