// Quét CHỈ ĐỌC các tài khoản Zalo mà engine v2 (aka_agent_engine_claim_target_v1) sẽ trả legacy_busy: chạy trước khi bật cờ
// org_organization.use_new_zalo_runtime cho tổ chức mới. Một câu SELECT duy nhất qua `supabase db query --linked` trên akachat
// (cgjbsmqtfhqvttudyjzq); không ghi, không gỡ token. So hai luật: V507 (trước V527: mọi chiến dịch giữ token đều chặn) và V527 (bỏ qua
// claim treo trên chiến dịch đã xoá / tạm dừng đủ lâu, không unit lease, không data "đang chạy"). Token thao tác tài khoản luôn chặn.
//
//   node scripts/engine-v2-legacy-busy-scan.cjs                 tài khoản Zalo Server (Fly) của tổ chức CHƯA bật cờ
//   node scripts/engine-v2-legacy-busy-scan.cjs --org 526,557   chỉ các tổ chức này (bật hay chưa)
//   node scripts/engine-v2-legacy-busy-scan.cjs --enabled       tổ chức ĐÃ bật cờ (tài khoản đang bị chặn)
//   node scripts/engine-v2-legacy-busy-scan.cjs --all-orgs      mọi tổ chức
//   --all-zalo     cả tài khoản QR / Web (engine v2 của Desktop cũng gọi hàm này)
//   --minutes N    ngưỡng V527 để thử (mặc định: thiết lập engine.legacy_stale_claim_minutes như hàm; sàn 10)
//   --details      in cả chiến dịch V527 bỏ qua      --json   in JSON      --print-sql   chỉ in câu SQL, không chạy
//   --workdir DIR  thư mục có supabase/.temp/project-ref (mặc định: repo này, rồi checkout chính của repo)
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const REF = 'cgjbsmqtfhqvttudyjzq'
const ROOT = path.resolve(__dirname, '..')
const MD5 = { v507: 'e09100fd2b1fedfd951e22bfd4f8ab8a', v527: 'f8935a5a986f5ac4bcc1bde34284bbd6' }
const SETTING = 'engine.legacy_stale_claim_minutes'
const DEFAULT_MINUTES = 30
const FLOOR_MINUTES = 10
const REASON = {
  op_token: 'bộ cũ giữ tài khoản (token thao tác)',
  unit_lease: 'chiến dịch giữ unit lease',
  active_claim: 'claim trên chiến dịch chưa xoá, không tạm dừng',
  running_data: 'còn data "đang chạy"',
  recent: 'vừa tạm dừng / xoá / claim (chưa đủ ngưỡng)',
  stale: 'claim treo, V527 bỏ qua'
}

function parseArgs(argv) {
  const opt = { scope: 'disabled', orgs: null, allZalo: false, minutes: null, details: false, json: false, printSql: false, workdir: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} cần giá trị`); return argv[++i] }
    if (a === '--org') {
      const v = next()
      if (!/^\d+(,\d+)*$/.test(v)) throw new Error('--org nhận danh sách id số, cách nhau bằng dấu phẩy')
      opt.orgs = v.split(',').map(Number); opt.scope = 'orgs'
    } else if (a === '--enabled') opt.scope = 'enabled'
    else if (a === '--all-orgs') opt.scope = 'all'
    else if (a === '--all-zalo') opt.allZalo = true
    else if (a === '--minutes') {
      const v = next()
      if (!/^\d{1,6}$/.test(v)) throw new Error('--minutes nhận số phút nguyên')
      opt.minutes = Math.max(FLOOR_MINUTES, Number(v))
    } else if (a === '--details') opt.details = true
    else if (a === '--json') opt.json = true
    else if (a === '--print-sql') opt.printSql = true
    else if (a === '--workdir') opt.workdir = path.resolve(next())
    else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 14).join('\n')); process.exit(0) }
    else throw new Error(`Không hiểu tham số ${a}`)
  }
  return opt
}

function buildSql(opt) {
  const orgFilter = opt.scope === 'orgs' ? `acc.org_id = ANY('{${opt.orgs.join(',')}}'::bigint[])`
    : opt.scope === 'enabled' ? 'coalesce(o.use_new_zalo_runtime, false)'
      : opt.scope === 'all' ? 'true' : 'NOT coalesce(o.use_new_zalo_runtime, false)'
  // Cùng cách đọc thiết lập như hàm claim V527 (btrim, chỉ số nguyên, sàn, mặc định).
  const minutes = opt.minutes === null
    ? `CASE WHEN s.raw ~ '^[0-9]{1,6}$' THEN greatest(${FLOOR_MINUTES}, s.raw::integer) ELSE ${DEFAULT_MINUTES} END`
    : String(opt.minutes)
  return `WITH thr AS (
  SELECT s.raw, ${minutes} AS minutes
    FROM (SELECT btrim(coalesce((SELECT st.value FROM public.auto_system_settings st
                                  WHERE st.key = '${SETTING}' AND st.is_active LIMIT 1), '${DEFAULT_MINUTES}')) AS raw,
                 EXISTS (SELECT 1 FROM public.auto_system_settings st WHERE st.key = '${SETTING}' AND st.is_active) AS has_setting) s
), acc AS (
  SELECT a.id, a.staff_id, a.organization_id AS org_id, a.status, a.is_active, a.login_status,
         coalesce(a.is_zalo_server, false) AND NOT coalesce(a.is_zalo_show_web, false) AS server,
         a.runtime_operation_claim_token IS NOT NULL AS op_token
    FROM public.auto_accounts a
   WHERE coalesce(a.is_delete, false) = false AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo'
     ${opt.allZalo ? '' : 'AND coalesce(a.is_zalo_server, false) AND NOT coalesce(a.is_zalo_show_web, false)'}
), scoped AS (
  SELECT acc.*, coalesce(o.use_new_zalo_runtime, false) AS flag
    FROM acc LEFT JOIN public.org_organization o ON o.id = acc.org_id
   WHERE ${orgFilter}
), tok AS (
  SELECT x.id, x.account_id, x.status, coalesce(x.is_delete, false) AS del, x.runtime_claim_target AS target,
         x.runtime_claim_token IS NOT NULL AS claim, x.runtime_unit_token IS NOT NULL AS unit,
         x.runtime_claimed_at AS claimed_at, x.updated_at,
         EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                  WHERE d.campaign_id = x.id AND d.status = 'đang chạy' AND coalesce(d.is_delete, false) = false) AS running_data
    FROM public.auto_campaigns x
   WHERE (x.runtime_claim_token IS NOT NULL OR x.runtime_unit_token IS NOT NULL)
     AND x.account_id IN (SELECT scoped.id FROM scoped)
), cls AS (
  SELECT tok.*, CASE
      WHEN tok.unit THEN 'unit_lease'
      WHEN NOT tok.del AND tok.status IS DISTINCT FROM 'tạm dừng' THEN 'active_claim'
      WHEN tok.running_data THEN 'running_data'
      WHEN coalesce(tok.claimed_at, '-infinity'::timestamptz) >= now() - make_interval(mins => thr.minutes)
        OR coalesce(tok.updated_at, '-infinity'::timestamptz) >= now() - make_interval(mins => thr.minutes) THEN 'recent'
      ELSE 'stale' END AS v527
    FROM tok CROSS JOIN thr
), runnable AS (
  SELECT r.account_id, count(*) AS n
    FROM public.auto_campaigns r
   WHERE coalesce(r.is_delete, false) = false AND r.status IN ('chờ xử lý', 'đang chạy')
     AND r.account_id IN (SELECT cls.account_id FROM cls UNION SELECT scoped.id FROM scoped WHERE scoped.op_token)
   GROUP BY r.account_id
), per_acc AS (
  SELECT s.id, s.org_id, s.flag, s.staff_id, s.server, s.status, s.is_active, s.login_status, s.op_token,
         coalesce(rn.n, 0) AS runnable,
         s.op_token OR EXISTS (SELECT 1 FROM cls WHERE cls.account_id = s.id) AS blocked_v507,
         s.op_token OR EXISTS (SELECT 1 FROM cls WHERE cls.account_id = s.id AND cls.v527 <> 'stale') AS blocked_v527,
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'deleted', c.del, 'target', c.target, 'claim', c.claim,
                     'unit', c.unit, 'claimedAt', c.claimed_at, 'updatedAt', c.updated_at, 'runningData', c.running_data, 'v527', c.v527)
                     ORDER BY c.id) FROM cls c WHERE c.account_id = s.id), '[]'::jsonb) AS campaigns
    FROM scoped s LEFT JOIN runnable rn ON rn.account_id = s.id
   WHERE s.op_token OR EXISTS (SELECT 1 FROM cls WHERE cls.account_id = s.id)
)
SELECT jsonb_build_object(
  'dbNow', now(),
  'claimMd5', (SELECT md5(p.prosrc) FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.aka_agent_engine_claim_target_v1(jsonb)')),
  'thresholdMinutes', (SELECT thr.minutes FROM thr),
  'settingRaw', (SELECT CASE WHEN EXISTS (SELECT 1 FROM public.auto_system_settings st WHERE st.key = '${SETTING}' AND st.is_active)
                             THEN thr.raw END FROM thr),
  'accounts', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.org_id NULLS FIRST, p.id) FROM per_acc p), '[]'::jsonb)
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
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-legacy-busy-scan-'))
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
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso))
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]))
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`
}

function printReport(report, opt) {
  const accounts = report.accounts
  const live = report.claimMd5 === MD5.v527 ? 'V527' : report.claimMd5 === MD5.v507 ? 'V507' : 'không rõ'
  const scope = opt.scope === 'orgs' ? `tổ chức ${opt.orgs.join(', ')}` : opt.scope === 'enabled' ? 'tổ chức ĐÃ bật cờ'
    : opt.scope === 'all' ? 'mọi tổ chức' : 'tổ chức CHƯA bật cờ'
  console.log(`Quét chỉ đọc legacy_busy của engine v2 — akachat ${REF}, ${vn(report.dbNow)} (giờ VN theo đồng hồ DB)`)
  console.log(`Hàm claim đang chạy: ${live} (md5 thân ${String(report.claimMd5).slice(0, 8)}…)`)
  console.log(`Ngưỡng V527: ${report.thresholdMinutes} phút (${opt.minutes !== null ? 'tham số --minutes'
    : report.settingRaw !== null ? `${SETTING} = "${report.settingRaw}"` : `chưa đặt ${SETTING}, mặc định`})`)
  console.log(`Phạm vi: tài khoản Zalo ${opt.allZalo ? '(mọi loại)' : 'Server'} của ${scope}`)
  const sum = key => accounts.filter(a => a[key])
  const b507 = sum('blocked_v507'), b527 = sum('blocked_v527')
  const camps = list => list.reduce((n, a) => n + Number(a.runnable), 0)
  console.log('')
  console.log(`Bị chặn theo V507 (trước V527): ${b507.length} tài khoản, chặn ${camps(b507)} chiến dịch chờ / đang chạy`)
  console.log(`Bị chặn theo V527:             ${b527.length} tài khoản, chặn ${camps(b527)} chiến dịch chờ / đang chạy`)
  console.log(`V527 gỡ chặn:                  ${b507.length - b527.length} tài khoản`)
  const reasons = {}
  for (const a of b527) {
    const why = new Set(a.op_token ? ['op_token'] : [])
    for (const c of a.campaigns) if (c.v527 !== 'stale') why.add(c.v527)
    for (const r of why) reasons[r] = (reasons[r] || 0) + 1
  }
  if (b527.length) console.log(`Lý do còn chặn sau V527 (số tài khoản): ${Object.entries(reasons).map(([k, n]) => `${REASON[k]} ${n}`).join('; ')}`)
  const orgs = new Map()
  for (const a of accounts) {
    const key = a.org_id ?? 'không có'
    const o = orgs.get(key) || { flag: a.flag, a507: 0, a527: 0, c507: 0, c527: 0 }
    if (a.blocked_v507) { o.a507++; o.c507 += Number(a.runnable) }
    if (a.blocked_v527) { o.a527++; o.c527 += Number(a.runnable) }
    orgs.set(key, o)
  }
  if (orgs.size) {
    console.log('\nTheo tổ chức (tài khoản bị chặn V507 → V527; chiến dịch chờ / đang chạy bị chặn V507 → V527):')
    for (const [org, o] of orgs) {
      console.log(`  org ${org} (${o.flag ? 'đã bật cờ' : 'chưa bật cờ'}): ${o.a507} → ${o.a527} tài khoản; ${o.c507} → ${o.c527} chiến dịch`)
    }
  }
  const shown = opt.details ? accounts : b527
  if (shown.length) {
    console.log(opt.details ? '\nMọi tài khoản bị chặn theo V507:' : '\nTài khoản còn bị chặn theo V527:')
    for (const a of shown) {
      console.log(`  org ${a.org_id ?? '—'} · tài khoản ${a.id} (staff ${a.staff_id}, ${a.server ? 'Server' : 'QR/Web'}, ${a.login_status ?? '—'}, `
        + `${a.status}${a.is_active ? '' : ', tắt'}): ${a.runnable} chiến dịch chờ / đang chạy${a.op_token ? `; ${REASON.op_token}` : ''}`)
      for (const c of a.campaigns) {
        if (!opt.details && c.v527 === 'stale') continue
        console.log(`    chiến dịch ${c.id} ${c.deleted ? 'đã xoá, ' : ''}${c.status}; ${c.claim ? `claim ${c.target ?? '?'} ${vn(c.claimedAt)}` : 'không claim'}`
          + `${c.unit ? ', unit lease' : ''}; ghi cuối ${vn(c.updatedAt)}${c.runningData ? '; còn data đang chạy' : ''} → ${REASON[c.v527]}`)
      }
    }
  }
}

function main() {
  const opt = parseArgs(process.argv.slice(2))
  const sql = buildSql(opt)
  if (opt.printSql) { console.log(sql); return }
  const workdir = resolveWorkdir(opt)
  const report = runQuery(sql, workdir)
  if (!report || !Array.isArray(report.accounts)) throw new Error('Kết quả quét không đúng dạng')
  if (opt.json) { console.log(JSON.stringify(report, null, 2)); return }
  printReport(report, opt)
}

try { main() } catch (error) { console.error(`Lỗi: ${error.message}`); process.exit(1) }
