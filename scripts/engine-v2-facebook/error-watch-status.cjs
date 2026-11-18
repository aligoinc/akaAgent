#!/usr/bin/env node
// Xem bộ tạo việc kiểm lỗi chiến dịch Facebook (V574, số tạm) trên production. CHỈ ĐỌC.
//   node scripts/engine-v2-facebook/error-watch-status.cjs           công tắc, lượt tick gần nhất, sổ ca theo trạng thái, ca chờ báo, câu gần đây
//   node scripts/engine-v2-facebook/error-watch-status.cjs --json    in nguyên JSON
// Gọi `supabase db query --linked` trong giao dịch chỉ đọc. Thư mục link Supabase: AKA_SUPABASE_WORKDIR (mặc định thư mục repo, rồi ../akaAgent,
// rồi checkout chính khi đang ở worktree). Chỉ chạy với project akachat.
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const PRODUCTION_REF = 'cgjbsmqtfhqvttudyjzq'
const ROOT = path.resolve(__dirname, '../..')
const AGENT = 'kiem-loi-chien-dich-facebook'

function workdir() {
  const candidates = [process.env.AKA_SUPABASE_WORKDIR, ROOT, path.resolve(ROOT, '../akaAgent'), path.resolve(ROOT, '../../..')].filter(Boolean)
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
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aka-error-watch-')), 'q.sql')
  fs.writeFileSync(file, `begin read only;\nset transaction read only;\nset local statement_timeout = '20s';\n${sql}\nrollback;\n`)
  const r = spawnSync('supabase', ['db', 'query', '--linked', '--workdir', workdir(), '-f', file, '-o', 'json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'supabase db query lỗi').trim())
  const text = r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)
  const parsed = JSON.parse(text)
  const rows = parsed.rows || parsed
  return JSON.parse((Array.isArray(rows) ? rows[0] : rows).out)
}

const vn = iso => iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : '-'

function main() {
  const json = process.argv.includes('--json')
  const applied = query(`select json_build_object('applied', to_regclass('private.auto_engine_error_cases') is not null)::text as out;`)
  if (!applied.applied) {
    console.log('Bộ tạo việc chưa được apply trên production (chưa có bảng private.auto_engine_error_cases).')
    return
  }
  const data = query(`
select json_build_object(
  'setting', (select s.value from public.auto_system_settings s where s.key = 'engine.error_watch'),
  'agent', (select json_build_object('is_active', p.is_active, 'audience', p.audience, 'version', p.version) from public.ai_project p where p.code = '${AGENT}'),
  'job', (select json_build_object('active', j.active, 'schedule', j.schedule) from cron.job j where j.jobname = 'aka-agent-engine-error-watch'),
  'state', (select json_build_object('cursor_at', cursor_at, 'last_tick_at', last_tick_at, 'tasks_today', tasks_today, 'last_error', last_error,
              'last_result', last_result - 'inserted' - 'skipped') from private.auto_engine_error_watch_state),
  'by_status', (select json_agg(x) from (select status, kind, count(*) n, sum(hits) hits from private.auto_engine_error_cases group by 1, 2 order by 1, 2) x),
  'waiting', (select json_agg(x) from (select public_code ma, kind, action_code, step, hits, pauses, status, left(pattern, 110) mau, last_seen_at
                from private.auto_engine_error_cases where status in ('new', 'failed', 'queued') order by (status = 'queued') desc, pauses desc, hits desc limit 15) x),
  'messages', (select json_agg(x) from (select m.id, m.seq, m.status, m.worker_id, m.asked_at, m.completed_at, left(m.question, 90) cau,
                 left(m.answer_json ->> 'tom_tat', 160) tom_tat, m.answer_json ->> 'ket_luan' ket_luan
                 from public.ai_message m join public.ai_message_thread t on t.id = m.thread_id join public.ai_project p on p.id = t.project_id
                where p.code = '${AGENT}' order by m.id desc limit 12) x),
  'image_requests', (select json_agg(x) from (select q.id, q.staff_id, q.status, q.created_at,
                 (select count(*) from public.auto_desktop_diagnostic_files f where f.request_id = q.id) files
                 from public.auto_desktop_diagnostic_requests q where q.requested_by = 'error-watch' order by q.id desc limit 8) x)
)::text as out;`)
  if (json) { console.log(JSON.stringify(data, null, 2)); return }
  let cfg = {}
  try { cfg = JSON.parse(data.setting || '{}') } catch { cfg = { loi: 'thiết lập không phải JSON' } }
  const sw = k => cfg[k] === true ? 'BẬT' : 'tắt'
  console.log(`Công tắc: đọc lỗi ${sw('enabled')} · chèn việc ${sw('enqueue')} · xin ảnh ${sw('imageRequests')} · đánh thức ${sw('fire')} · trần ${cfg.maxPerDay ?? '-'} việc/ngày`)
  console.log(`Agent: ${data.agent ? (data.agent.is_active ? 'BẬT' : 'chưa bật') + `, audience ${data.agent.audience}` : 'không có'} · Job: ${data.job ? (data.job.active ? 'đang chạy' : 'tắt') + ` (${data.job.schedule})` : 'không có'}`)
  const st = data.state
  console.log(st ? `Lượt gần nhất: ${vn(st.last_tick_at)} · đã đọc tới ${vn(st.cursor_at)} · việc hôm nay ${st.tasks_today}${st.last_error ? ` · LỖI: ${st.last_error}` : ''}` : 'Chưa có lượt tick nào.')
  console.log('\nSổ ca theo trạng thái:')
  for (const r of data.by_status || []) console.log(`  ${r.status.padEnd(9)} ${r.kind.padEnd(17)} ${String(r.n).padStart(4)} ca  ${String(r.hits).padStart(6)} lượt`)
  console.log('\nCa đang chờ báo hoặc đang chờ trả lời:')
  for (const c of data.waiting || []) console.log(`  [${c.status}] ${c.ma || '-'} ${c.action_code || ''}/${c.step || ''} · ${c.hits} lượt, ${c.pauses} lần dừng · ${c.mau}`)
  console.log('\nCâu gần đây của agent:')
  for (const m of data.messages || []) console.log(`  #${m.id} ${m.status} ${vn(m.asked_at)} ${m.ket_luan ? `[${m.ket_luan}] ` : ''}${m.tom_tat || m.cau}`)
  if ((data.image_requests || []).length) {
    console.log('\nYêu cầu ảnh:')
    for (const q of data.image_requests) console.log(`  #${q.id} nhân viên ${q.staff_id} ${q.status} ${q.files} ảnh ${vn(q.created_at)}`)
  }
}

try { main() } catch (error) { console.error(error.message); process.exit(1) }
