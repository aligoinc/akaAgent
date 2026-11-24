#!/usr/bin/env node
// Một vòng giả lập ba lỗi hẹn giờ (24/11/2026). Mỗi vòng: lấy mẫu ngẫu nhiên production (chỉ GET qua REST, không ghi), sinh ca tổng
// hợp + ca cố tình sai, chạy hàm thật của Desktop / App Server, ChatApi (PGlite) và engine v2 (Postgres cục bộ), so với luật kiểm độc
// lập và so từng cặp nơi chạy. Mã thoát 1 khi có sai lệch.
//
// Chạy (user không phải root vì initdb):
//   SIM_SEED=1 SIM_PROD=1 CHAT_REPO=<thư mục có module pg> PG17_BIN=<bin Postgres> CHATAPI_DIR=<checkout ChatApi> LC_ALL=C \
//     node scripts/schedule-fixes-sim/run.cjs --out <thư mục>
// SIM_PROD=0 bỏ phần production; SIM_ENGINE=0 / SIM_CHATAPI=0 bỏ phần tương ứng. Dữ liệu production chỉ ghi ra thư mục --out (không commit).
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const L = require('./lib.cjs')

const args = process.argv.slice(2)
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(require('node:os').tmpdir(), 'schedule-sim')
fs.mkdirSync(outDir, { recursive: true })
const seed = Number(process.env.SIM_SEED || Date.now() % 1e9)
const r = L.rng(seed)
const N_SYN = Number(process.env.SIM_SYN || 1200), N_BAD = Number(process.env.SIM_BAD || 600), N_PROD = Number(process.env.SIM_PROD_N || 160)
const N_ENGINE = Number(process.env.SIM_ENGINE_N || 500)

// ------------------------------------------------------------------------------------------------ production (chỉ đọc)
const REST = 'https://cgjbsmqtfhqvttudyjzq.supabase.co/rest/v1'
// curl (đi qua proxy của môi trường, proxy gắn khoá); chỉ GET.
async function get(pathAndQuery) {
  const body = execFileSync('curl', ['-sS', '-m', '60', '--fail-with-body', '-H', 'apikey: dummy', '-H', 'Authorization: Bearer dummy', `${REST}/${pathAndQuery}`], { encoding: 'utf8' })
  return JSON.parse(body)
}
async function sampleProduction() {
  const cols = 'id,action_id,name,status,schedule,original_schedule,schedule_type,schedule_week_days,schedule_days,schedule_end_date,daily_stop_time,continue_next_day,refresh_data,data_target_source_mode'
  const buckets = [['weekly', 2000, 0.4], ['monthly', 470, 0.25], ['daily', 24000, 0.35]]
  const rows = []
  for (const [type, approx, share] of buckets) {
    const want = Math.round(N_PROD * share)
    for (let got = 0, guard = 0; got < want && guard < 20; guard++) {
      const offset = r.int(0, Math.max(0, approx - 25))
      const extra = type === 'daily' ? (r.chance(0.6) ? '&daily_stop_time=not.is.null' : '') : ''
      const page = await get(`auto_campaigns?select=${cols}&is_delete=eq.false&schedule_type=eq.${type}${extra}&order=id&offset=${offset}&limit=${Math.min(25, want - got)}`)
      for (const row of page) { if (rows.some(x => x.id === row.id)) continue; rows.push(row); got++ }
      if (page.length === 0) break
    }
  }
  const sample = []
  for (const row of rows) {
    const inputs = await get(`auto_campaign_input_data?select=status,is_delete&campaign_id=eq.${row.id}&order=id&limit=200`)
    sample.push({ ...row, is_post_bump: L.postBump.isPostBumpTargetCampaign({ actionId: row.action_id, name: row.name }), name: undefined, inputs })
  }
  return sample
}

// ------------------------------------------------------------------------------------------------ so sánh
const norm = v => (v == null ? null : new Date(v).toISOString())
function diffMaint(a, b) {
  if (a.error || b.error) return `lỗi: ${a.error || ''} | ${b.error || ''}`
  const out = []
  if (a.status !== b.status) out.push(`status ${a.status} ≠ ${b.status}`)
  if (norm(a.schedule) !== norm(b.schedule)) out.push(`schedule ${norm(a.schedule)} ≠ ${norm(b.schedule)}`)
  if (L.noteKind(a.note) !== L.noteKind(b.note)) out.push(`note ${L.noteKind(a.note)} ≠ ${L.noteKind(b.note)}`)
  const ia = a.inputs.map(i => `${i.status}|${i.note || ''}`).join(','), ib = b.inputs.map(i => `${i.status}|${i.note || ''}`).join(',')
  if (ia !== ib) out.push(`inputs [${ia}] ≠ [${ib}]`)
  if (a.deleted && b.deleted && a.deleted.join() !== b.deleted.join()) out.push(`deleted ${a.deleted} ≠ ${b.deleted}`)
  return out.join('; ')
}
function diffDone(a, b) {
  if (a.error || b.error) return `lỗi: ${a.error || ''} | ${b.error || ''}`
  const ka = a.kind === 'rerun' ? 'rescheduled' : a.kind, kb = b.kind === 'rerun' ? 'rescheduled' : b.kind
  const out = []
  if (ka !== kb) out.push(`kind ${ka} ≠ ${kb}`)
  // Lượt "chạy lại sau N giờ" tính từ đồng hồ của từng nơi chạy: lệch vài mili giây giữa hai lần đo là bình thường.
  else if (ka === 'rescheduled' && Math.abs(Date.parse(a.schedule) - Date.parse(b.schedule)) > (a.kind === 'rerun' || b.kind === 'rerun' ? 5000 : 0)) out.push(`schedule ${norm(a.schedule)} ≠ ${norm(b.schedule)}`)
  if (a.inputs.join() !== b.inputs.join()) out.push(`inputs [${a.inputs}] ≠ [${b.inputs}]`)
  return out.join('; ')
}
/** Nhóm sai lệch theo "dấu" để báo cáo gọn. */
function signature(k, msg) {
  const c = k.c
  return `${msg.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<t>').replace(/\[[^\]]*\]/g, '[..]').slice(0, 120)} | ${c.schedule_type}/${c.action_id.split('_')[0]}/refresh=${c.refresh_data}/cont=${c.continue_next_day}/stop=${c.daily_stop_time ? 1 : 0}`
}

async function main() {
  const now = Date.now()
  const todayKey = L.vnKey(now)
  // Bảo trì: ngày "hôm nay" thay đổi mỗi vòng (cuối tháng, tháng 2, đầu năm…) để thử lịch tháng / tuần.
  const T = L.vnDayStart(r.pick([todayKey, '2026-12-01', '2027-01-01', '2027-02-28', '2027-03-01', '2028-02-29', '2026-12-31', '2027-04-30',
    L.vnKey(now + r.int(-200, 400) * L.DAY)]))
  const cases = []
  let idx = 10_000
  if (process.env.SIM_PROD !== '0') {
    const prod = await sampleProduction()
    fs.writeFileSync(path.join(outDir, `prod-${seed}.json`), JSON.stringify(prod))
    for (const row of prod) cases.push(L.prodCase(row, T, ++idx))
  }
  for (let i = 0; i < N_SYN; i++) cases.push(L.synthCase(r, T, ++idx, false))
  for (let i = 0; i < N_BAD; i++) cases.push(L.synthCase(r, T, ++idx, true))

  const problems = []
  const record = (part, k, msg, detail) => problems.push({ part, key: k.key, sig: `${part}: ${signature(k, msg)}`, msg, detail })

  // ---- Bảo trì đầu ngày: oracle vs Desktop vs ChatApi
  const maintDesktop = await L.desktopMaintenance(cases, T)
  const zaloCases = cases.filter(k => k.c.action_id.startsWith('zalo_') && k.c.data_target_source_mode !== 'data_group')
  let maintChat = {}
  if (process.env.SIM_CHATAPI !== '0') {
    const file = path.join(outDir, `chat-cases-${seed}.json`), outFile = path.join(outDir, `chat-out-${seed}.json`)
    fs.writeFileSync(file, JSON.stringify({ todayStart: new Date(T).toISOString(), cases: zaloCases }))
    execFileSync('npx', ['vitest', 'run', 'packages/database/src/campaignScheduleMaintenanceSim.integration.test.ts'], {
      cwd: process.env.CHATAPI_DIR, env: { ...process.env, SCHEDULE_SIM_CASES: file, SCHEDULE_SIM_OUT: outFile }, stdio: 'ignore' })
    maintChat = JSON.parse(fs.readFileSync(outFile, 'utf8'))
  }
  for (const k of cases) {
    if (k.c.data_target_source_mode === 'data_group') continue // nhóm data có hàm kết thúc riêng, không giả lập
    const o = L.oracleMaintenance(k, T)
    const d = maintDesktop[k.key]
    const m1 = diffMaint(o, d)
    if (m1) record('bảo trì oracle≠Desktop', k, m1, { case: k, oracle: o, desktop: d })
    if (maintChat[k.key]) {
      const m2 = diffMaint(d, maintChat[k.key])
      if (m2) record('bảo trì Desktop≠ChatApi', k, m2, { case: k, desktop: d, chatapi: maintChat[k.key] })
    }
    // Bất biến: không bao giờ đổi data "tạm dừng"; ca 1 không bao giờ để lịch cũ khi có giờ dừng và không tích.
    if (!d.error) {
      k.inputs.forEach((i, n) => {
        if (i.status === 'tạm dừng' && !i.is_delete && d.inputs[n].status !== 'tạm dừng') record('bất biến', k, 'data tạm dừng bị đổi', { case: k, desktop: d })
      })
    }
  }

  // ---- Kết thúc lượt: oracle vs Desktop vs engine v2
  const doneCases = cases.filter(k => k.c.data_target_source_mode !== 'data_group').map(k => {
    const c = { ...k.c }
    if (r.chance(0.15)) c.extra_settings = { findDataRerunEnabled: r.chance(0.8), findDataRerunAfterHours: r.pick([1, 2, 3, 0, '2', 'x', 24, 1.5, -1]) }
    if (r.chance(0.1)) c.action_id = r.pick([...L.RERUN_ACTIONS_DESKTOP])
    // Lúc kết thúc lượt không còn data chờ / đang chạy (chạy xong mới tới bước này).
    return { ...k, c, inputs: k.inputs.map(i => ({ ...i, status: i.status === 'chờ xử lý' || i.status === 'đang chạy' ? 'hoàn thành' : i.status })) }
  })
  const N = Date.now()
  const doneDesktop = await L.desktopCompletion(doneCases, N)
  for (const k of doneCases) {
    const o = L.oracleCompletion(k, N)
    const m = diffDone(o, doneDesktop[k.key])
    if (m) record('kết thúc oracle≠Desktop', k, m, { case: k, oracle: o, desktop: doneDesktop[k.key] })
  }
  let engineStats = null
  if (process.env.SIM_ENGINE !== '0') {
    const { openEngine } = require('./engine.cjs')
    const engine = await openEngine()
    const skips = {}
    let ran = 0
    try {
      for (const k0 of r.shuffle(doneCases).slice(0, N_ENGINE)) {
        // Engine không nhận lượt sau giờ dừng trong ngày (daily_boundary): ca có giờ dừng đã qua thì bỏ giờ dừng (cho cả oracle).
        const nowTod = new Date(Date.now() + L.H7).toISOString().slice(11, 19)
        const k = k0.c.daily_stop_time && String(k0.c.daily_stop_time).slice(0, 8) <= nowTod ? { ...k0, c: { ...k0.c, daily_stop_time: null } } : k0
        const e = await engine.completion(k)
        if (e.skip) { skips[e.skip] = (skips[e.skip] || 0) + 1; continue }
        ran++
        const N2 = Date.now()
        // Lịch lúc nhận lượt của engine (now − 1 phút): giờ của lượt kế lấy từ đây khi chiến dịch không có lịch gốc.
        const o = L.oracleCompletion({ ...k, c: { ...k.c, schedule: e.claimedSchedule } }, N2, { rerunActions: new Set([...L.RERUN_ACTIONS_DESKTOP, 'web_find_data_nhatot', 'web_find_data_batdongsan', 'web_find_data_yellowpages']) })
        const m = diffDone(o, e)
        if (m) record('kết thúc oracle≠engine', k, m, { case: k, oracle: o, engine: e })
      }
    } finally { await engine.close() }
    engineStats = { ran, skips }
  }

  const groups = {}
  for (const p of problems) (groups[p.sig] ||= []).push(p)
  const summary = Object.entries(groups).sort((a, b) => b[1].length - a[1].length).map(([sig, list]) => ({ sig, count: list.length, example: list[0].detail }))
  fs.writeFileSync(path.join(outDir, `report-${seed}.json`), JSON.stringify({ seed, T: new Date(T).toISOString(), cases: cases.length, zalo: zaloCases.length,
    done: doneCases.length, engineStats, problems: problems.length, summary }, null, 1))
  console.log(`seed=${seed} T=${L.vnKey(T + 1)} ca=${cases.length} (prod ${cases.filter(k => k.source === 'prod').length}, sai lệch cố ý ${N_BAD}) ` +
    `ChatApi=${Object.keys(maintChat).length} kết thúc=${doneCases.length} engine=${JSON.stringify(engineStats)}`)
  console.log(`vấn đề: ${problems.length} (${summary.length} nhóm)`)
  for (const s of summary.slice(0, 15)) console.log(`  ${s.count} × ${s.sig}`)
  process.exit(problems.length ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(2) })
