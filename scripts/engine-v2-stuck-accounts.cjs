#!/usr/bin/env node
// Quét CHỈ ĐỌC tài khoản kẹt "đang chạy" (sự cố 27/11/2026, V681). Dùng trong lần kiểm sức khoẻ engine v2: đếm lượt đã chạy không thấy tài
// khoản ngừng nhận lượt. Một câu SELECT qua `supabase db query --linked` trên akachat (cgjbsmqtfhqvttudyjzq); không ghi gì.
//   (A) Tài khoản "đang chạy" mà không gì giữ, lần ghi cuối quá --grace-minutes phút (mặc định 3). Luật "giữ" viết lại đúng như
//       private.aka_agent_engine_account_holder_v1 của V681 (token thao tác, lease engine, lượt engine mở, dấu giữ lượt bộ cũ chưa quá hạn
//       theo V527, chiến dịch "đang chạy" còn sống) để chạy được cả trước khi apply V681; bài kiểm V681 so hai bên. Có dòng là còn một
//       đường làm lệch trạng thái cần tìm (sau V681 không còn bước tự gỡ định kỳ, anh chốt 27/11).
//   (B) Tài khoản bị token thao tác tài khoản giữ, lần ghi cuối quá --op-minutes phút (mặc định 30). Thao tác tài khoản (quét QR, quét data,
//       kiểm SĐT…) không có nhịp gia hạn: token treo là tài khoản đứng tới khi ai đó gỡ. 27/11 17:0x VN: 74 tài khoản, nhiều cái từ tháng
//       9–10 (Facebook, Zalo QR của Desktop), 4 tài khoản Fly mới tạo 115–155 phút.
//
//   node scripts/engine-v2-stuck-accounts.cjs [--grace-minutes N] [--op-minutes N] [--json] [--print-sql] [--workdir DIR]
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const REF = 'cgjbsmqtfhqvttudyjzq'
const ROOT = path.resolve(__dirname, '..')
const HOLDER_SIG = 'private.aka_agent_engine_account_holder_v1(bigint,timestamp with time zone)'
const SETTING_LEGACY = 'engine.legacy_stale_claim_minutes'
const SETTING_IDLE = 'engine.account_hold_campaign_idle_hours'
const HOLDER_LABEL = {
  operation: 'token thao tác tài khoản', lease: 'lease engine', open_run: 'lượt engine còn mở',
  legacy_claim: 'dấu giữ lượt bộ cũ còn hiệu lực', campaign_running: 'chiến dịch "đang chạy" còn sống', none: 'không gì giữ'
}

function parseArgs(argv) {
  const opt = { graceMinutes: 3, opMinutes: 30, json: false, printSql: false, workdir: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} cần giá trị`); return argv[++i] }
    const minutes = v => { if (!/^\d{1,5}$/.test(v)) throw new Error(`${a} nhận số phút nguyên`); return Number(v) }
    if (a === '--grace-minutes') opt.graceMinutes = minutes(next())
    else if (a === '--op-minutes') opt.opMinutes = minutes(next())
    else if (a === '--json') opt.json = true
    else if (a === '--print-sql') opt.printSql = true
    else if (a === '--workdir') opt.workdir = path.resolve(next())
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 12).join('\n')); process.exit(0) }
    else throw new Error(`Không hiểu tham số ${a}`)
  }
  return opt
}

/** Một câu SELECT, cột report (jsonb). Luật giữ tài khoản = private.aka_agent_engine_account_holder_v1 của V681. */
function buildSql({ graceMinutes = 3, opMinutes = 30 } = {}) {
  if (!Number.isInteger(graceMinutes) || !Number.isInteger(opMinutes)) throw new Error('số phút phải là số nguyên')
  return `WITH k AS (
  SELECT s.now,
         s.now - make_interval(mins => CASE WHEN s.legacy_raw ~ '^[0-9]{1,6}$' THEN greatest(10, s.legacy_raw::integer) ELSE 30 END) AS legacy_before,
         s.now - make_interval(hours => CASE WHEN s.idle_raw ~ '^[0-9]{1,3}$' THEN greatest(1, s.idle_raw::integer) ELSE 6 END) AS alive_after
    FROM (SELECT clock_timestamp() AS now,
                 btrim(coalesce((SELECT value FROM public.auto_system_settings WHERE key = '${SETTING_LEGACY}' AND is_active LIMIT 1), '30')) AS legacy_raw,
                 btrim(coalesce((SELECT value FROM public.auto_system_settings WHERE key = '${SETTING_IDLE}' AND is_active LIMIT 1), '6')) AS idle_raw) s
), running AS MATERIALIZED (
  SELECT a.id, a.organization_id, a.staff_id, a.flatform_type, coalesce(a.is_zalo_server, false) AS is_server,
         coalesce(a.is_zalo_show_web, false) AS is_web, a.updated_at, a.runtime_operation_claim_token IS NOT NULL AS has_op
    FROM public.auto_accounts a
   WHERE a.status = 'đang chạy' AND coalesce(a.is_delete, false) = false
), judged AS (
  SELECT r.*, CASE
      WHEN r.has_op THEN 'operation'
      WHEN EXISTS (SELECT 1 FROM public.auto_engine_leases l WHERE l.account_id = r.id) THEN 'lease'
      WHEN EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.account_id = r.id AND tr.completed_at IS NULL) THEN 'open_run'
      WHEN EXISTS (SELECT 1 FROM public.auto_campaigns x, k
                    WHERE x.account_id = r.id AND (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
                      AND NOT (x.runtime_unit_token IS NULL
                               AND (coalesce(x.is_delete, false) OR x.status = 'tạm dừng')
                               AND coalesce(x.runtime_claimed_at, '-infinity'::timestamptz) < k.legacy_before
                               AND coalesce(x.updated_at, '-infinity'::timestamptz) < k.legacy_before
                               AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                                WHERE d.campaign_id = x.id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false))) THEN 'legacy_claim'
      WHEN EXISTS (SELECT 1 FROM public.auto_campaigns x, k
                    WHERE x.account_id = r.id AND x.status = 'đang chạy' AND coalesce(x.is_delete, false) = false
                      AND (greatest(coalesce(x.updated_at, '-infinity'::timestamptz), coalesce(x.last_run_at, '-infinity'::timestamptz)) >= k.alive_after
                           OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                                       WHERE d.campaign_id = x.id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false))) THEN 'campaign_running'
    END AS holder
    FROM running r
)
SELECT jsonb_build_object(
  'now', (SELECT now FROM k),
  'holderFunction', to_regprocedure('${HOLDER_SIG}') IS NOT NULL,
  'graceMinutes', ${graceMinutes},
  'opMinutes', ${opMinutes},
  'running', (SELECT count(*) FROM judged),
  'byHolder', coalesce((SELECT jsonb_object_agg(h, n) FROM (SELECT coalesce(holder, 'none') AS h, count(*) AS n FROM judged GROUP BY 1) q), '{}'::jsonb),
  'stuck', coalesce((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'organizationId', j.organization_id, 'staffId', j.staff_id,
      'platform', j.flatform_type, 'server', j.is_server, 'web', j.is_web, 'updatedAt', j.updated_at,
      'idleMinutes', floor(extract(epoch FROM k.now - j.updated_at) / 60), 'lastActionAt', last.at) ORDER BY j.updated_at)
    FROM judged j CROSS JOIN k
    LEFT JOIN LATERAL (SELECT max(d.created_at) AS at FROM public.auto_campaign_details d WHERE d.account_id = j.id) last ON true
   WHERE j.holder IS NULL AND j.updated_at < k.now - make_interval(mins => ${graceMinutes})), '[]'::jsonb),
  'operationHeld', coalesce((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'organizationId', j.organization_id, 'staffId', j.staff_id,
      'platform', j.flatform_type, 'server', j.is_server, 'web', j.is_web, 'updatedAt', j.updated_at,
      'idleMinutes', floor(extract(epoch FROM k.now - j.updated_at) / 60)) ORDER BY j.updated_at)
    FROM judged j, k WHERE j.holder = 'operation' AND j.updated_at < k.now - make_interval(mins => ${opMinutes})), '[]'::jsonb)
) AS report`
}

function resolveWorkdir(opt) {
  const candidates = []
  if (opt.workdir) candidates.push(opt.workdir)
  candidates.push(ROOT)
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim()
    candidates.push(path.dirname(common))
  } catch { /* không phải git checkout */ }
  for (const dir of candidates) {
    const file = path.join(dir, 'supabase/.temp/project-ref')
    if (!fs.existsSync(file)) { if (dir === opt.workdir) throw new Error(`${dir} chưa link Supabase (thiếu supabase/.temp/project-ref)`); continue }
    const ref = fs.readFileSync(file, 'utf8').trim()
    if (ref !== REF) throw new Error(`${dir} đang link project ${ref}, không phải akachat ${REF}; dừng`)
    return dir
  }
  throw new Error('Không thấy thư mục đã link akachat; chạy `supabase link --project-ref cgjbsmqtfhqvttudyjzq` hoặc truyền --workdir')
}

function runQuery(sql, workdir) {
  if (sql.includes(';')) throw new Error('Câu quét phải là một câu SELECT duy nhất')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-stuck-accounts-'))
  try {
    const file = path.join(temp, 'scan.sql')
    fs.writeFileSync(file, sql, { mode: 0o600 })
    const out = execFileSync('supabase', ['db', 'query', '--linked', '--workdir', workdir, '--agent=no', '-o', 'json', '-f', file],
      { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
    const parsed = JSON.parse(out)
    const rows = Array.isArray(parsed) ? parsed : parsed.rows
    const report = rows?.[0]?.report
    return typeof report === 'string' ? JSON.parse(report) : report
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
}

const vn = iso => {
  if (!iso) return '—'
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`
}
const kind = a => a.platform === 'zalo' ? (a.server ? 'Zalo Server' : a.web ? 'Zalo trình duyệt' : 'Zalo QR') : a.platform === 'facebook' ? 'Facebook' : String(a.platform)

function printReport(report) {
  const by = Object.entries(report.byHolder || {}).sort((x, y) => y[1] - x[1]).map(([h, n]) => `${HOLDER_LABEL[h] || h} ${n}`).join(', ')
  console.log(`Tài khoản "đang chạy": ${report.running} (${by || 'không có'}). Hàm V681 trên DB: ${report.holderFunction ? 'có' : 'chưa có'}.`)
  const list = (title, rows) => {
    console.log(`\n${title}: ${rows.length}`)
    for (const a of rows) {
      const last = 'lastActionAt' in a ? `, hành động cuối ${vn(a.lastActionAt)}` : ''
      console.log(`  ${a.id}  tổ chức ${a.organizationId}  nhân viên ${a.staffId}  ${kind(a)}  lần ghi cuối ${vn(a.updatedAt)} (${a.idleMinutes} phút)${last}`)
    }
  }
  list(`(A) Kẹt "đang chạy", không gì giữ, quá ${report.graceMinutes} phút`, report.stuck || [])
  list(`(B) Bị token thao tác tài khoản giữ quá ${report.opMinutes} phút`, report.operationHeld || [])
}

function main() {
  const opt = parseArgs(process.argv.slice(2))
  const sql = buildSql(opt)
  if (opt.printSql) { console.log(sql); return }
  const report = runQuery(sql, resolveWorkdir(opt))
  if (opt.json) console.log(JSON.stringify(report, null, 2))
  else printReport(report)
  if ((report.stuck || []).length > 0) process.exitCode = 2
}

if (require.main === module) {
  try { main() } catch (error) { console.error(error.message || error); process.exit(1) }
}
module.exports = { buildSql, HOLDER_LABEL }
