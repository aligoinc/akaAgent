#!/usr/bin/env node
// Tra lỗi engine v2 Facebook (R1, anh chốt Q16 16/11/2026: hàm chỉ đọc + script trước, màn Web admin làm sau). CHỈ ĐỌC.
//   node scripts/engine-v2-facebook/trace.cjs --data <mã data>        các lượt của một data (mới nhất trước)
//   node scripts/engine-v2-facebook/trace.cjs --run <mã lượt data>    một lượt data của engine
//   node scripts/engine-v2-facebook/trace.cjs --health [--minutes 60] chiến dịch FB chạy bằng engine đến lịch mà đứng, lượt còn mở (R18)
//   node scripts/engine-v2-facebook/trace.cjs --drift                cặp block / workflow bản cũ ↔ "[engine]" có một bên sửa sau lần chép (Q7)
//   Thêm --json để in nguyên JSON. Gọi aka_agent_engine_trace_v1 / health_v1 (V556) bằng `supabase db query --linked` trong giao dịch chỉ đọc.
//   Thư mục link Supabase: AKA_SUPABASE_WORKDIR (mặc định thư mục repo nếu có supabase/.temp/project-ref). Chỉ chạy với project akachat.
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const PRODUCTION_REF = 'cgjbsmqtfhqvttudyjzq'
const ROOT = path.resolve(__dirname, '../..')

function args() {
  const out = { json: false }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--json') out.json = true
    else if (a === '--data') out.data = Number(argv[++i])
    else if (a === '--run') out.run = Number(argv[++i])
    else if (a === '--health') out.health = true
    else if (a === '--drift') out.drift = true
    else if (a === '--minutes') out.minutes = Number(argv[++i])
    else if (a === '--limit') out.limit = Number(argv[++i])
  }
  return out
}

function workdir() {
  const candidates = [process.env.AKA_SUPABASE_WORKDIR, ROOT, path.resolve(ROOT, '../akaAgent')].filter(Boolean)
  for (const dir of candidates) {
    const refFile = path.join(dir, 'supabase/.temp/project-ref')
    if (fs.existsSync(refFile)) {
      const ref = fs.readFileSync(refFile, 'utf8').trim()
      if (ref !== PRODUCTION_REF) throw new Error(`Thư mục ${dir} link project ${ref}, không phải akachat (${PRODUCTION_REF})`)
      return dir
    }
  }
  throw new Error('Không tìm thấy thư mục link Supabase; đặt AKA_SUPABASE_WORKDIR')
}

function query(sql) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aka-trace-')), 'q.sql')
  fs.writeFileSync(file, `begin read only;\nset transaction read only;\nset local statement_timeout = '30s';\n${sql}\nrollback;\n`)
  const r = spawnSync('supabase', ['db', 'query', '--linked', '--workdir', workdir(), '-f', file, '-o', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'supabase db query lỗi').split('\n').filter(line => !/Supabase CLI|recommend updating|claude-code-hint/.test(line)).join('\n'))
  const text = r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)
  const parsed = JSON.parse(text)
  const rows = parsed.rows || parsed
  return JSON.parse((Array.isArray(rows) ? rows[0] : rows).out)
}

const vn = iso => iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : '-'

function printTrace(result) {
  if (!result.ok) { console.log('Không tra được:', result.reason); return }
  if (result.runs.length === 0) { console.log('Không có lượt engine nào cho data / lượt này.'); return }
  for (const item of result.runs) {
    const run = item.run
    console.log(`\n=== Lượt data #${run.id} · chiến dịch ${run.campaign_id} · data ${run.input_data_id ?? `(mốc lịch ${vn(run.slot_at)})`} · tài khoản ${run.account_id}`)
    console.log(`    bắt đầu ${vn(run.started_at)} · đóng ${vn(run.completed_at)} (${run.close_reason ?? 'chưa đóng'}) · nơi chạy ${run.runner_id}`)
    for (const mark of run.marks || []) console.log(`    dấu gửi ${mark.stepKey} (${mark.actionCode}) ${vn(mark.markedAt)} → ${mark.state}`)
    for (const o of item.outcomes) {
      const d = o.decision?.result || {}
      console.log(`  • ${o.actionCode} [${o.resultKey.split(':').slice(2).join(':')}] ${o.ok ? 'OK' : 'LỖI'} · pha ${o.phase} · giao ${o.deliveryState}`
        + `${o.errorCode ? ` · ${o.errorCode}${d.publicCode ? ` (${d.publicCode})` : ''}` : ''}${o.detailId ? ` · lịch sử #${o.detailId}` : ''}`)
      if (d.log) console.log(`      câu cho khách: ${d.log}`)
      const s = o.signal || {}
      if (!o.ok) console.log(`      tín hiệu: ${s.kind}${s.code ? ` ${s.code}` : ''}${s.message ? ` · ${String(s.message).slice(0, 160)}` : ''}`)
      const c = o.decision?.contrib || {}
      if (!o.ok && (c.campaignEffect || c.streak)) console.log(`      hiệu ứng: chiến dịch ${c.campaignEffect ?? '-'} · chuỗi ${c.streak ?? '-'}${c.streakThreshold ? `/${c.streakThreshold}` : ''}`)
      if (s.screenshotId) console.log(`      ảnh lỗi trên máy khách: ${s.screenshotId} (lấy về bằng aka_agent_desktop_diagnostic_request_v1)`)
      const ops = s.trace?.ops || []
      if (ops.length) {
        console.log(`      vết thao tác (${ops.length}${s.trace.dropped ? `, bỏ ${s.trace.dropped} ở giữa` : ''}${s.trace.sendAttempted === false ? ', cú bấm gửi CHƯA chạy' : ''}):`)
        for (const op of ops.slice(-12)) console.log(`        ${op.ok ? '✓' : '✗'} ${op.op} ${op.el || op.sel || ''} ${op.ms}ms${op.err ? ` · ${op.err}` : ''}${op.url ? ` @ ${op.url}` : ''}`)
      }
    }
    for (const d of item.details || []) console.log(`  ✎ lịch sử #${d.id} ${d.actionCode} ${d.status}: ${String(d.log ?? '').slice(0, 200)}`)
    for (const e of item.events) console.log(`  ~ sự kiện ${e.kind}${e.errorCode ? ` ${e.errorCode}` : ''}${e.message ? ` · ${e.message}` : ''} (${vn(e.createdAt)})`)
    for (const wf of item.workflowRuns) {
      console.log(`  ⚙ lượt workflow #${wf.id} (workflow ${wf.workflowId}) ${wf.status}${wf.error ? ` · ${wf.error}` : ''}`)
      for (const step of wf.steps.filter(x => x.status === 'error')) console.log(`      bước lỗi ${step.nodeId} ${step.blockName}: ${step.error}`)
    }
  }
}

function printHealth(result) {
  if (!result.ok) { console.log('Không kiểm được:', result.reason); return }
  const stuck = result.stuckCampaigns || []
  console.log(`Chiến dịch FB chạy bằng engine đến lịch mà không có lượt data nào trong ${result.minutes} phút: ${stuck.length}`)
  for (const c of stuck) {
    console.log(`  • #${c.campaignId} ${c.name} (tổ chức ${c.organizationId}, ${c.actionId}) · ${c.status} · lịch ${vn(c.schedule)} · lượt cuối ${vn(c.lastRunAt)}`
      + ` · ${c.dueTargets} data đến hạn · tài khoản ${c.accountId} ${c.accountStatus}/${c.accountLoginStatus}`
      + `${c.lease ? ` · lease ${c.lease.runnerId} (chiến dịch ${c.lease.campaignId}) tới ${vn(c.lease.expiresAt)}` : ''}${c.note ? ` · ghi chú: ${c.note}` : ''}`)
  }
  const open = result.openRuns || []
  console.log(`Lượt data FB còn mở quá ${result.minutes} phút: ${open.length}`)
  for (const r of open) {
    const marks = (r.marks || []).map(m => `${m.stepKey}:${m.state}`).join(', ')
    console.log(`  • lượt #${r.targetRunId} chiến dịch ${r.campaignId} tài khoản ${r.accountId} data ${r.inputDataId ?? '(theo lịch)'} từ ${vn(r.startedAt)}`
      + ` · ${r.outcomeCount} kết quả${marks ? ` · dấu ${marks}` : ''}`)
  }
  const unmatched = result.unmatched || []
  console.log(`Mẫu lỗi FB chưa có luật: ${unmatched.length}`)
  for (const u of unmatched) console.log(`  • ${u.actionCode} ${u.phase} ${u.signalKind} ${u.patternKey} → ${u.fallbackErrorCode} · ${u.hitCount} lần, gần nhất ${vn(u.lastSeenAt)}`)
  const codes = Object.entries(result.outcomesByCode || {}).sort((a, b) => b[1] - a[1])
  console.log(`Kết quả FB theo mã: ${codes.map(([code, n]) => `${code} ${n}`).join(', ') || 'không có'}`)
}

function printDrift(rows) {
  if (!rows.length) { console.log('Không có cặp nào lệch: bản cũ và bản "[engine]" khớp lần chép.'); return }
  for (const r of rows) {
    console.log(`• ${r.kind} ${r.source_name} (#${r.source_id}) ↔ ${r.engine_name} (#${r.engine_id}): `
      + `${r.source_changed ? 'bản cũ đã sửa' : ''}${r.source_changed && r.engine_changed ? ', ' : ''}${r.engine_changed ? 'bản engine đã sửa' : ''} sau lần chép ${vn(r.copied_at)}`)
  }
}

function main() {
  const a = args()
  let sql
  if (a.drift) sql = `select coalesce(json_agg(d order by d.kind, d.source_id), '[]')::text as out from public.aka_agent_engine_block_copy_drift d;`
  else if (a.health) sql = `select public.aka_agent_engine_health_v1(${Number.isFinite(a.minutes) ? a.minutes : 60})::text as out;`
  else if (Number.isSafeInteger(a.run)) sql = `select public.aka_agent_engine_trace_v1(null, ${a.run}, ${Number.isFinite(a.limit) ? a.limit : 20})::text as out;`
  else if (Number.isSafeInteger(a.data)) sql = `select public.aka_agent_engine_trace_v1(${a.data}, null, ${Number.isFinite(a.limit) ? a.limit : 20})::text as out;`
  else {
    console.log('Dùng: --data <mã data> | --run <mã lượt data> | --health [--minutes 60] | --drift  [--json]')
    process.exit(2)
  }
  const result = query(sql)
  if (a.json) { console.log(JSON.stringify(result, null, 2)); return }
  if (a.drift) printDrift(result)
  else if (a.health) printHealth(result)
  else printTrace(result)
}

if (require.main === module) {
  try { main() } catch (error) { console.error(error.message); process.exit(1) }
}
module.exports = { printTrace, printHealth, printDrift }
