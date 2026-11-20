#!/usr/bin/env node
// Hộp thư của bộ kiểm lỗi chiến dịch Facebook cho một session Claude Code trên máy (lệnh /hop-thu-loi). CHỈ ĐỌC production.
//   node scripts/engine-v2-facebook/error-watch-inbox.cjs list [--limit 10] [--all]
//       báo cáo gần nhất của phiên cloud (mặc định chỉ báo cáo cần anh làm gì)
//   node scripts/engine-v2-facebook/error-watch-inbox.cjs wait [--interval 3600] [--all] [--from <mã câu>] [--once] [--state <tệp>]
//       chờ báo cáo mới: hỏi database mỗi --interval giây (mặc định 3600 = mỗi giờ, anh chốt 20/11; tối thiểu 30), có báo cáo cần làm thì in ra và THOÁT (mã 0) để session được đánh thức;
//       báo cáo không cần làm gì thì chỉ ghi nhận rồi chờ tiếp. --once: hỏi một lần, không có thì thoát mã 2. Lỗi database 5 lần liền: thoát mã 3.
// Con trỏ (mã câu đã xem tới đâu) lưu ở --state, mặc định ~/.cache/akaagent/error-watch-inbox.json. Lần đầu chưa có con trỏ thì bắt đầu từ câu
// mới nhất (không in lại lịch sử), trừ khi có --from.
// "Cần làm": kết luận loi_app / facebook_doi_giao_dien, có câu cho khách hoặc mã lỗi đề xuất (chờ duyệt), hoặc có câu hỏi cho anh; đúng luật gửi
// thông báo ở docs/FB_ERROR_WATCH_TASK.md.
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

function query(sql) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-error-inbox-'))
  const file = path.join(dir, 'q.sql')
  fs.writeFileSync(file, `begin read only;\nset transaction read only;\nset local statement_timeout = '20s';\n${sql}\nrollback;\n`)
  const r = spawnSync('supabase', ['db', 'query', '--linked', '--workdir', workdir(), '-f', file, '-o', 'json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  fs.rmSync(dir, { recursive: true, force: true })
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'supabase db query lỗi').trim().split('\n').slice(-2).join(' '))
  const text = r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)
  const parsed = JSON.parse(text)
  const rows = parsed.rows || parsed
  return JSON.parse((Array.isArray(rows) ? rows[0] : rows).out)
}

const idOf = value => { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isSafeInteger(n) && n >= 0 ? n : null }
/** Giờ VN dạng "20/11 11:31". */
const vn = iso => {
  if (!iso) return '-'
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000)
  const p = n => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}
const oneLine = (text, max) => { const s = String(text ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max - 1) + '…' : s }

/** Báo cáo cần anh làm gì không, và là việc gì (đúng luật gửi thông báo của tệp việc). */
function action(report) {
  const r = report || {}
  if (r.ket_luan === 'loi_app') return 'Cần sửa app'
  if (r.ket_luan === 'facebook_doi_giao_dien') return 'Facebook đổi giao diện'
  if (r.cau_cho_khach || r.de_xuat_ma_loi) return 'Chờ duyệt câu cho khách'
  if (r.can_anh_quyet) return 'Cần anh quyết'
  return null
}

const SELECT = (where, limit) => `
select json_build_object(
  'max_id', (select max(m.id) from public.ai_message m join public.ai_message_thread t on t.id = m.thread_id join public.ai_project p on p.id = t.project_id
              where p.code = '${AGENT}' and m.status = 'hoàn thành'),
  'rows', (select coalesce(json_agg(x order by x.id), '[]'::json) from (
    select m.id, m.answered_at, m.answer_json as report, t.intake_data ->> 'ma' as ma, t.intake_data ->> 'khoa' as khoa
      from public.ai_message m join public.ai_message_thread t on t.id = m.thread_id join public.ai_project p on p.id = t.project_id
     where p.code = '${AGENT}' and m.status = 'hoàn thành' and ${where}
     order by m.id desc limit ${limit}) x))::text as out;`

function render(row) {
  const r = row.report || {}
  const viec = action(r) || 'Không cần làm gì'
  const lines = [`BAO_CAO cau=${row.id} luc=${vn(row.answered_at)} viec="${viec}" ma=${r.ma || row.ma || '-'} ket_luan=${r.ket_luan || '-'} do_chac=${r.do_chac || '-'}`]
  lines.push(`  tom_tat: ${oneLine(r.tom_tat, 400)}`)
  if (r.can_anh_quyet) lines.push(`  can_anh_quyet: ${oneLine(r.can_anh_quyet, 300)}`)
  const pending = [r.cau_cho_khach ? 'câu cho khách' : null, r.de_xuat_ma_loi ? 'mã lỗi mới' : null].filter(Boolean)
  if (pending.length) lines.push(`  cho_duyet: ${pending.join(', ')} (tab "Lỗi không xác định")`)
  if (row.khoa) lines.push(`  khoa: ${oneLine(row.khoa, 160)}`)
  lines.push(`  xu_ly: /xu-ly-loi ${row.id}`)
  return lines.join('\n')
}

function statePath() {
  return opt('--state', path.join(os.homedir(), '.cache', 'akaagent', 'error-watch-inbox.json'))
}
function readCursor() {
  try { return idOf(JSON.parse(fs.readFileSync(statePath(), 'utf8')).lastId) } catch { return null }
}
function writeCursor(id) {
  const file = statePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ lastId: id, at: new Date().toISOString() }, null, 1))
}

function list() {
  const limit = Math.min(Math.max(Number(opt('--limit', 10)) || 10, 1), 50)
  const all = flag('--all')
  const data = query(SELECT('true', all ? limit : limit * 4))
  const rows = data.rows.filter(row => all || action(row.report)).slice(-limit)
  if (!rows.length) { console.log(all ? 'Chưa có báo cáo nào.' : 'Không có báo cáo nào cần làm trong các báo cáo gần nhất.'); return 0 }
  for (const row of rows) console.log(render(row) + '\n')
  console.log(`(con trỏ hộp thư: ${readCursor() ?? 'chưa có'}; câu mới nhất: ${data.max_id ?? '-'})`)
  return 0
}

async function wait() {
  const interval = Math.max(Number(opt('--interval', 3600)) || 3600, 30) * 1000
  const all = flag('--all')
  let cursor = idOf(opt('--from', null))
  if (cursor !== null) cursor = Math.max(cursor - 1, 0)
  else cursor = readCursor()
  let errors = 0
  for (;;) {
    try {
      if (cursor === null) {
        const head = query(SELECT('false', 1))
        cursor = idOf(head.max_id) ?? 0
        writeCursor(cursor)
        console.log(`HOP_THU_BAT_DAU con_tro=${cursor} (bỏ qua các báo cáo cũ; dùng --from <mã câu> để xem lại)`)
      }
      const data = query(SELECT(`m.id > ${cursor}`, 20))
      errors = 0
      const rows = data.rows
      if (rows.length) {
        cursor = Math.max(cursor, ...rows.map(row => Number(row.id)))
        writeCursor(cursor)
        const hits = rows.filter(row => all || action(row.report))
        if (hits.length) {
          for (const row of hits) console.log(render(row) + '\n')
          console.log(`BAO_CAO_MOI so=${hits.length} con_tro=${cursor}`)
          return 0
        }
        console.log(`(${vn(new Date().toISOString())}) ${rows.length} báo cáo không cần làm gì, con trỏ ${cursor}`)
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
  if (mode === 'wait') return wait()
  console.log('Dùng: error-watch-inbox.cjs list [--limit N] [--all] | wait [--interval 3600] [--all] [--from <mã câu>] [--once] [--state <tệp>]')
  return 1
}

main().then(code => process.exit(code), error => { console.error(error.message); process.exit(1) })
