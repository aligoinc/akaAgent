#!/usr/bin/env node
// Hộp thư lỗi của bộ kiểm lỗi chiến dịch Facebook (lệnh /hop-thu-loi trong Claude Code trên máy). Phiên cloud nghiên cứu từng ca và nộp báo cáo
// vào database (chạy cả khi máy tắt); hộp thư là chỗ người vận hành xem các ca đã nghiên cứu xong và quyết: sửa (mở session con), hay bỏ qua.
//   list [--all] [--limit 20]     ca đã có báo cáo, chờ quyết (mới nhất trước); --all hiện cả ca đang sửa
//   skipped                        ca đã bỏ qua, số lượt 24 giờ so với ngưỡng mở lại
//   skip <câu> | unskip <câu>      bỏ qua ca của câu (GHI production qua hàm private.aka_agent_engine_error_case_skip_v1 của V594) / trả lại
//   fixing <câu> | unfixing <câu>  đánh dấu ca đang có session con sửa (chỉ ghi trên máy, ẩn khỏi list tới khi ca có báo cáo mới)
//   wait [--interval 3600] [--from <câu>] [--once]
//                                  hỏi database mỗi --interval giây (mặc định mỗi giờ), có báo cáo mới thì in ra rồi THOÁT mã 0 để session được
//                                  đánh thức; --once: hỏi một lần, không có thì thoát mã 2; lỗi database 5 lần liền: thoát mã 3
// Trạng thái trên máy (con trỏ của wait, ca đang sửa) ở --state, mặc định ~/.cache/akaagent/error-watch-inbox.json.
// Mọi lệnh trừ skip / unskip chỉ đọc production.
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const PRODUCTION_REF = 'cgjbsmqtfhqvttudyjzq'
const ROOT = path.resolve(__dirname, '../..')
const AGENT = 'kiem-loi-chien-dich-facebook'
const args = process.argv.slice(2)
const mode = args[0]
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def }
const flag = name => args.includes(name)

function workdir() {
  const candidates = [process.env.AKA_SUPABASE_WORKDIR, ROOT]
  const main = spawnSync('git', ['-C', ROOT, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' })
  const first = /^worktree (.+)$/m.exec(main.stdout || '')
  if (first) candidates.push(first[1])
  for (const dir of candidates.filter(Boolean)) {
    const refFile = path.join(dir, 'supabase/.temp/project-ref')
    if (fs.existsSync(refFile)) {
      const ref = fs.readFileSync(refFile, 'utf8').trim()
      if (ref !== PRODUCTION_REF) throw new Error(`Thư mục ${dir} link project ${ref}, không phải akachat (${PRODUCTION_REF})`)
      return dir
    }
  }
  throw new Error('Không tìm thấy thư mục link Supabase; đặt AKA_SUPABASE_WORKDIR')
}

/** Một câu SELECT trả cột `out` (json dạng chữ). write = true thì chạy trong giao dịch ghi, còn lại giao dịch chỉ đọc. */
function query(sql, { write = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-error-inbox-'))
  const file = path.join(dir, 'q.sql')
  const wrapped = write
    ? `begin;\nset local statement_timeout = '15s';\n${sql}\ncommit;\n`
    : `begin read only;\nset transaction read only;\nset local statement_timeout = '20s';\n${sql}\nrollback;\n`
  fs.writeFileSync(file, wrapped)
  const r = spawnSync('supabase', ['db', 'query', '--linked', '--workdir', workdir(), '-f', file, '-o', 'json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  fs.rmSync(dir, { recursive: true, force: true })
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'supabase db query lỗi').trim().split('\n').slice(-2).join(' '))
  const text = r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)
  const parsed = JSON.parse(text)
  const rows = parsed.rows || parsed
  return JSON.parse((Array.isArray(rows) ? rows[0] : rows).out)
}

const idOf = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null }
/** Giờ VN dạng "20/11 11:31". */
const vn = iso => {
  if (!iso) return '-'
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}
const oneLine = (text, max) => { const s = String(text ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1) + '…' : s }

const VIEC = {
  loi_app: 'Cần sửa app',
  facebook_doi_giao_dien: 'Facebook đổi giao diện',
  do_cau_hinh_cua_khach: 'Do cấu hình của khách',
  do_may_khach: 'Do máy khách',
  chua_du_du_lieu: 'Chưa đủ dữ liệu'
}

function statePath() { return opt('--state', path.join(os.homedir(), '.cache', 'akaagent', 'error-watch-inbox.json')) }
function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    return { lastId: idOf(s.lastId), fixing: s.fixing && typeof s.fixing === 'object' ? s.fixing : {} }
  } catch { return { lastId: null, fixing: {} } }
}
function writeState(state) {
  const file = statePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ ...state, at: new Date().toISOString() }, null, 1))
}

const CASE_COLUMNS = `k.case_key as khoa, k.status, k.kind, k.public_code as ma, k.error_code, k.action_code, k.hits, k.pauses,
  k.report_message_id as cau, k.report_at, k.report, k.customer_note_status, k.code_proposal_status, k.note,
  (select count(*) from private.auto_engine_error_items i where i.case_key = k.case_key and i.occurred_at > now() - interval '24 hours') as hits24h`

function render(c, { fixing } = {}) {
  const r = c.report || {}
  const viec = VIEC[r.ket_luan] || 'Xem báo cáo'
  const lines = [`Câu ${c.cau} · ${viec} · ${c.ma || r.ma || '-'} · ${oneLine(r.tom_tat, 220)}`]
  const meta = [`báo cáo ${vn(c.report_at)}`, `độ chắc ${r.do_chac || '-'}`, `${c.hits} lượt (24 giờ: ${c.hits24h})`]
  if (Number(c.pauses) > 0) meta.push(`${c.pauses} lần dừng chiến dịch`)
  lines.push(`  ${meta.join(' · ')}`)
  if (r.can_anh_quyet) lines.push(`  cần anh quyết: ${oneLine(r.can_anh_quyet, 300)}`)
  const pending = [c.customer_note_status === 'proposed' ? 'câu cho khách' : null, c.code_proposal_status === 'proposed' ? 'mã lỗi mới' : null].filter(Boolean)
  if (pending.length) lines.push(`  chờ duyệt: ${pending.join(', ')} (tab "Lỗi không xác định" của app Desktop)`)
  if (c.note && /^Mở lại sau khi bỏ qua/.test(c.note)) lines.push(`  ${c.note}`)
  if (fixing) lines.push(`  đang sửa: session con mở lúc ${vn(fixing.at)} (câu ${fixing.cau})`)
  lines.push(`  khoa: ${oneLine(c.khoa, 160)}`)
  return lines.join('\n')
}

function list() {
  const limit = Math.min(Math.max(Number(opt('--limit', 20)) || 20, 1), 100)
  const data = query(`select json_build_object(
  'pending', (select coalesce(json_agg(x order by x.report_at desc), '[]'::json) from (
      select ${CASE_COLUMNS} from private.auto_engine_error_cases k
       where k.platform = 'facebook' and k.status = 'reported' and k.report_message_id is not null) x),
  'working', (select coalesce(json_object_agg(s.status, s.n), '{}'::json) from (
      select k.status, count(*) as n from private.auto_engine_error_cases k where k.platform = 'facebook' and k.status in ('new', 'queued', 'failed') group by k.status) s),
  'skipped', (select count(*) from private.auto_engine_error_cases k where k.platform = 'facebook' and k.status = 'muted'),
  'cfg', (select value from public.auto_system_settings where key = 'engine.error_watch'))::text as out;`)
  const state = readState()
  const shown = []
  const hidden = []
  for (const c of data.pending) {
    const fx = state.fixing[c.khoa]
    // Ca đang sửa thì ẩn, trừ khi ca đã có báo cáo mới sau lúc mở session sửa.
    if (fx && !flag('--all') && Number(c.cau) <= Number(fx.cau)) hidden.push(c)
    else shown.push({ c, fx })
  }
  if (!shown.length) console.log('Hộp thư trống: không có ca nào đang chờ anh quyết.')
  for (const { c, fx } of shown.slice(0, limit)) console.log(render(c, { fixing: fx }) + '\n')
  if (shown.length > limit) console.log(`(còn ${shown.length - limit} ca cũ hơn; thêm --limit để xem)`)
  const w = data.working || {}
  let cfg = {}
  try { cfg = JSON.parse(data.cfg || '{}') } catch { /* thiết lập sai định dạng: bỏ qua phần trần */ }
  console.log(`Chờ quyết: ${shown.length} · đang sửa: ${hidden.length} · đã bỏ qua: ${data.skipped} · đang chờ / đang nghiên cứu: ${(w.new || 0) + (w.failed || 0)} / ${w.queued || 0}`
    + ` · trần: ${cfg.maxPerHour || 'không giới hạn'} ca mỗi giờ, ${cfg.maxPerDay ?? 10} ca mỗi ngày`)
  return 0
}

function skipped() {
  const data = query(`select json_build_object(
  'rows', (select coalesce(json_agg(x order by x.hits24h desc), '[]'::json) from (
      select ${CASE_COLUMNS} from private.auto_engine_error_cases k where k.platform = 'facebook' and k.status = 'muted') x),
  'cfg', (select value from public.auto_system_settings where key = 'engine.error_watch'))::text as out;`)
  let cfg = {}
  try { cfg = JSON.parse(data.cfg || '{}') } catch { /* bỏ qua */ }
  const threshold = Number(cfg.skipReopenHits24h) || 30
  if (!data.rows.length) { console.log('Chưa bỏ qua ca nào.'); return 0 }
  for (const c of data.rows) {
    console.log(`Câu ${c.cau || '-'} · ${c.ma || '-'} · ${c.hits24h}/${threshold} lượt trong 24 giờ · ${oneLine((c.report || {}).tom_tat, 160)}`)
    console.log(`  ${oneLine(c.note, 160)}`)
  }
  console.log(`\nCa bỏ qua tự mở lại để nghiên cứu lại khi đủ ${threshold} lượt trong 24 giờ trên toàn hệ thống.`)
  return 0
}

function setSkip(on) {
  const cau = idOf(args[1])
  if (!cau) { console.log(`Dùng: ${on ? 'skip' : 'unskip'} <mã câu>`); return 1 }
  const res = query(`select private.aka_agent_engine_error_case_skip_v1(${cau}, ${on ? 'true' : 'false'})::text as out;`, { write: true })
  if (!res.ok) {
    const why = { case_not_found: 'câu này không thuộc ca lỗi nào', status_queued: 'ca đang được nghiên cứu, chờ báo cáo về rồi bỏ qua',
      status_known: 'ca đã đánh dấu có kết luận', status_muted: 'ca đã bỏ qua từ trước', not_muted: 'ca không ở trạng thái bỏ qua' }[res.code] || res.code
    console.log(`KHONG_DOI câu ${cau}: ${why}`)
    return 4
  }
  if (on) {
    const state = readState()
    if (state.fixing[res.khoa]) { delete state.fixing[res.khoa]; writeState(state) }
    console.log(`DA_BO_QUA câu ${cau} · ${res.ma || '-'} · hiện ${res.hits24h} lượt trong 24 giờ; tự mở lại khi đủ ${res.reopenHits24h} lượt trong 24 giờ`)
  } else {
    console.log(`DA_TRA_LAI câu ${cau} · ${res.ma || '-'} · trạng thái ${res.status === 'reported' ? 'chờ quyết' : 'chờ nghiên cứu'}`)
  }
  return 0
}

function setFixing(on) {
  const cau = idOf(args[1])
  if (!cau) { console.log(`Dùng: ${on ? 'fixing' : 'unfixing'} <mã câu>`); return 1 }
  const res = query(`select json_build_object('khoa', (select t.intake_data ->> 'khoa' from public.ai_message m join public.ai_message_thread t on t.id = m.thread_id
      join public.ai_project p on p.id = t.project_id where m.id = ${cau} and p.code = '${AGENT}'))::text as out;`)
  if (!res.khoa) { console.log(`KHONG_DOI câu ${cau}: câu này không thuộc ca lỗi nào`); return 4 }
  const state = readState()
  if (on) state.fixing[res.khoa] = { cau, at: new Date().toISOString() }
  else delete state.fixing[res.khoa]
  writeState(state)
  console.log(`${on ? 'DANG_SUA' : 'BO_DANG_SUA'} câu ${cau}`)
  return 0
}

const NEW_REPORTS = cursor => `select json_build_object(
  'max_id', (select max(m.id) from public.ai_message m join public.ai_message_thread t on t.id = m.thread_id join public.ai_project p on p.id = t.project_id
              where p.code = '${AGENT}' and m.status = 'hoàn thành'),
  'rows', (select coalesce(json_agg(x order by x.cau), '[]'::json) from (
    select ${CASE_COLUMNS} from private.auto_engine_error_cases k
     where k.platform = 'facebook' and k.report_message_id > ${cursor} and k.status in ('reported', 'muted')) x))::text as out;`

async function wait() {
  const interval = Math.max(Number(opt('--interval', 3600)) || 3600, 30) * 1000
  const state = readState()
  let cursor = idOf(opt('--from', null))
  cursor = cursor !== null ? cursor - 1 : state.lastId
  let errors = 0
  for (;;) {
    try {
      if (cursor === null) {
        const head = query(NEW_REPORTS(2 ** 53 - 1))
        cursor = idOf(head.max_id) ?? 0
        writeState({ ...readState(), lastId: cursor })
        console.log(`HOP_THU_BAT_DAU con_tro=${cursor} (báo cáo cũ xem bằng lệnh list)`)
      }
      const data = query(NEW_REPORTS(cursor))
      errors = 0
      if (data.rows.length) {
        cursor = Math.max(cursor, ...data.rows.map(c => Number(c.cau)))
        writeState({ ...readState(), lastId: cursor })
        for (const c of data.rows) console.log(render(c) + '\n')
        console.log(`BAO_CAO_MOI so=${data.rows.length} con_tro=${cursor}`)
        return 0
      }
      if (flag('--once')) { console.log('KHONG_CO_BAO_CAO_MOI'); return 2 }
    } catch (error) {
      errors++
      console.log(`LOI_DOC_DATABASE lan=${errors}: ${oneLine(error.message, 300)}`)
      if (errors >= 5) return 3
    }
    await new Promise(resolve => setTimeout(resolve, errors ? Math.min(interval * errors, 15 * 60_000) : interval))
  }
}

async function main() {
  if (mode === 'list') return list()
  if (mode === 'skipped') return skipped()
  if (mode === 'skip') return setSkip(true)
  if (mode === 'unskip') return setSkip(false)
  if (mode === 'fixing') return setFixing(true)
  if (mode === 'unfixing') return setFixing(false)
  if (mode === 'wait') return wait()
  console.log('Dùng: error-watch-inbox.cjs list [--all] [--limit N] | skipped | skip <câu> | unskip <câu> | fixing <câu> | unfixing <câu> | wait [--interval 3600] [--from <câu>] [--once]')
  return 1
}

main().then(code => process.exit(code), error => { console.error(error.message); process.exit(1) })
