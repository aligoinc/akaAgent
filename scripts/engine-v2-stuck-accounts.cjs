#!/usr/bin/env node
// Quét CHỈ ĐỌC tài khoản kẹt "đang chạy" (sự cố 27/11/2026, V681). Dùng trong lần kiểm sức khoẻ engine v2: đếm lượt đã chạy không thấy tài
// khoản ngừng nhận lượt. Một câu SELECT qua `supabase db query --linked` trên akachat (cgjbsmqtfhqvttudyjzq); không ghi gì.
//   (A) Tài khoản "đang chạy" mà không gì giữ, lần ghi cuối quá --grace-minutes phút (mặc định 3). Luật "giữ" viết lại đúng như
//       private.aka_agent_engine_account_holder_v1 của V681 (token thao tác, lease engine, lượt engine mở, dấu giữ lượt bộ cũ chưa quá hạn
//       theo V527, chiến dịch "đang chạy" còn sống) để chạy được cả trước khi apply V681; bài kiểm V681 so hai bên. Có dòng là còn một
//       đường làm lệch trạng thái cần tìm (sau V681 không còn bước tự gỡ định kỳ, anh chốt 27/11).
//   (B) Tài khoản giữ token thao tác (auto_accounts.runtime_operation_claim_token) quá --op-minutes phút (mặc định 30), xếp theo chủ token.
//       Token có hai chủ: lượt chiến dịch bộ cũ (aka_agent_claim_campaign_runtime_v2 gắn đúng auto_campaigns.runtime_claim_token của lượt)
//       và thao tác tài khoản (quét QR, quét data, Kiểm tra SĐT…). Không chủ nào ghi lại dòng tài khoản trong lúc chạy, nên số phút là tuổi
//       của lượt giữ, không phải độ im lặng. Còn sống hay không xét bằng log chiến dịch, presence của app (tài khoản Desktop) và số SĐT đã
//       tra hôm nay:
//       - đang chạy: lượt bộ cũ có log trong --run-idle-minutes phút (mặc định 60, lướt newsfeed cộng thêm thời gian lướt), tài khoản
//         Desktop thì app còn online; Kiểm tra SĐT chưa đủ hạn mức ngày (lượt giữ tài khoản cả lúc nghỉ 60 phút khi Zalo báo giới hạn
//         giờ; lượt chết theo API Web cũng hiện ở đây, phân biệt bằng số đã tra có tăng giữa hai lần quét);
//       - app không online: tài khoản Desktop, app không gửi presence trong 5 phút (tắt, chết hoặc máy ngủ) và chưa mở lại sau lúc giữ:
//         tự gỡ ở lần đăng nhập kế;
//       - cần xem: còn lại (app đang mở mà lượt không chạy, app mở lại mà token còn, tài khoản Server không ai chạy, Kiểm tra SĐT đủ hạn
//         mức mà chưa nhả). Mỗi dòng có lý do và cách gỡ.
//   (C) Tài khoản đã xoá còn token: không bước dọn nào gỡ (đều lọc is_delete = false); chỉ làm private.app_access_held luôn đúng cho nhân
//       viên đó. Chỉ đếm.
//   Mã thoát 2 khi (A) hoặc nhóm "cần xem" của (B) có dòng.
//
//   node scripts/engine-v2-stuck-accounts.cjs [--grace-minutes N] [--op-minutes N] [--run-idle-minutes N] [--all] [--json] [--print-sql]
//                                             [--workdir DIR]
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
const SETTING_PHONE_LIMIT = 'zalo.phone_check.daily_limit'
const NEWSFEED_ACTION = 'facebook_newsfeed_interaction'
const ONLINE_MINUTES = 5 // presence Desktop gửi 30 giây một lần
const HOLDER_LABEL = {
  operation: 'token thao tác tài khoản', lease: 'lease engine', open_run: 'lượt engine còn mở',
  legacy_claim: 'dấu giữ lượt bộ cũ còn hiệu lực', campaign_running: 'chiến dịch "đang chạy" còn sống', none: 'không gì giữ'
}
/** Lý do của nhóm (B) → nhóm hiển thị. Khớp CASE trong câu SQL. */
const HELD_STATE = {
  running: 'running', phone_check: 'running', app_closed: 'app_closed',
  server_run_idle: 'look', reopened_still_held: 'look', app_online_run_idle: 'look', app_online_operation: 'look',
  phone_check_limit_reached: 'look', server_operation: 'look'
}

function parseArgs(argv) {
  const opt = { graceMinutes: 3, opMinutes: 30, runIdleMinutes: 60, all: false, json: false, printSql: false, workdir: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} cần giá trị`); return argv[++i] }
    const minutes = v => { if (!/^\d{1,5}$/.test(v)) throw new Error(`${a} nhận số phút nguyên`); return Number(v) }
    if (a === '--grace-minutes') opt.graceMinutes = minutes(next())
    else if (a === '--op-minutes') opt.opMinutes = minutes(next())
    else if (a === '--run-idle-minutes') opt.runIdleMinutes = minutes(next())
    else if (a === '--all') opt.all = true
    else if (a === '--json') opt.json = true
    else if (a === '--print-sql') opt.printSql = true
    else if (a === '--workdir') opt.workdir = path.resolve(next())
    else if (a === '-h' || a === '--help') {
      const lines = fs.readFileSync(__filename, 'utf8').split('\n').slice(1)
      console.log(lines.slice(0, lines.findIndex(l => !l.startsWith('//'))).join('\n'))
      process.exit(0)
    } else throw new Error(`Không hiểu tham số ${a}`)
  }
  return opt
}

/** Một câu SELECT, cột report (jsonb). Luật giữ tài khoản = private.aka_agent_engine_account_holder_v1 của V681. */
function buildSql({ graceMinutes = 3, opMinutes = 30, runIdleMinutes = 60 } = {}) {
  if (![graceMinutes, opMinutes, runIdleMinutes].every(Number.isInteger)) throw new Error('số phút phải là số nguyên')
  return `WITH k AS (
  SELECT s.now,
         s.now - make_interval(mins => CASE WHEN s.legacy_raw ~ '^[0-9]{1,6}$' THEN greatest(10, s.legacy_raw::integer) ELSE 30 END) AS legacy_before,
         s.now - make_interval(hours => CASE WHEN s.idle_raw ~ '^[0-9]{1,3}$' THEN greatest(1, s.idle_raw::integer) ELSE 6 END) AS alive_after,
         s.now - make_interval(mins => ${opMinutes}) AS op_before,
         s.now - make_interval(mins => ${ONLINE_MINUTES}) AS online_after,
         timezone('Asia/Ho_Chi_Minh', s.now)::date AS vn_today,
         CASE WHEN s.phone_raw ~ '^[1-9][0-9]{0,9}$' AND s.phone_raw::numeric <= 2147483647 THEN s.phone_raw::integer ELSE 600 END AS phone_limit
    FROM (SELECT clock_timestamp() AS now,
                 btrim(coalesce((SELECT value FROM public.auto_system_settings WHERE key = '${SETTING_LEGACY}' AND is_active LIMIT 1), '30')) AS legacy_raw,
                 btrim(coalesce((SELECT value FROM public.auto_system_settings WHERE key = '${SETTING_IDLE}' AND is_active LIMIT 1), '6')) AS idle_raw,
                 btrim(coalesce((SELECT value FROM public.auto_system_settings
                                  WHERE key = '${SETTING_PHONE_LIMIT}' AND is_active AND coalesce(is_secret, false) = false LIMIT 1), '600')) AS phone_raw) s
), running AS MATERIALIZED (
  SELECT a.id, a.organization_id, a.staff_id, a.flatform_type, coalesce(a.is_zalo_server, false) AS is_server,
         coalesce(a.is_zalo_show_web, false) AS is_web, a.updated_at, a.runtime_operation_claim_token IS NOT NULL AS has_op,
         a.runtime_operation_claim_token AS op_token, a.zalo_phone_check_usage AS phone_usage
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
), op_held AS MATERIALIZED (
  SELECT j.* FROM judged j, k WHERE j.holder = 'operation' AND j.updated_at < k.op_before
), claims AS MATERIALIZED (
  -- Lượt bộ cũ gắn token của tài khoản bằng đúng claim token của chiến dịch. Tra theo token: chiến dịch có thể đã đổi tài khoản giữa lượt.
  SELECT x.id, x.runtime_claim_token, x.action_id, x.status, coalesce(x.is_delete, false) AS is_delete, x.runtime_claim_target,
         CASE WHEN x.action_id = '${NEWSFEED_ACTION}'
              THEN coalesce(CASE WHEN (x.extra_settings->>'newsfeedTimeMinutes') ~ '^[0-9]{1,4}$' THEN (x.extra_settings->>'newsfeedTimeMinutes')::integer END, 20)
              ELSE 0 END AS browse_minutes
    FROM public.auto_campaigns x
   WHERE x.runtime_claim_token IS NOT NULL AND x.runtime_claim_token IN (SELECT o.op_token FROM op_held o)
), held AS MATERIALIZED (
  SELECT o.id, o.organization_id, o.staff_id, o.flatform_type, o.is_server, o.is_web, o.updated_at,
         CASE WHEN o.phone_usage->>'date' = k.vn_today::text AND (o.phone_usage->>'count') ~ '^[0-9]{1,9}$'
              THEN (o.phone_usage->>'count')::integer END AS phone_today,
         c.id AS campaign_id, c.action_id AS campaign_action, c.status AS campaign_status, c.is_delete AS campaign_deleted,
         c.runtime_claim_target AS claim_target, coalesce(c.browse_minutes, 0) AS browse_minutes, lg.at AS last_log_at,
         EXISTS (SELECT 1 FROM public.auto_staff_device_presence p
                  WHERE p.staff_id = o.staff_id AND p.ended_at IS NULL AND p.last_seen_at > k.online_after) AS online,
         EXISTS (SELECT 1 FROM public.auto_staff_device_presence p WHERE p.staff_id = o.staff_id AND p.started_at > o.updated_at) AS reopened,
         lp.last_seen_at, lp.ended_at AS last_ended_at, lp.app_version, lp.scheduler_state
    FROM op_held o CROSS JOIN k
    LEFT JOIN LATERAL (SELECT cl.* FROM claims cl WHERE cl.runtime_claim_token = o.op_token ORDER BY cl.id LIMIT 1) c ON true
    LEFT JOIN LATERAL (SELECT l.created_at AS at FROM public.auto_campaign_logs l WHERE l.campaign_id = c.id ORDER BY l.id DESC LIMIT 1) lg ON true
    LEFT JOIN LATERAL (SELECT p.last_seen_at, p.ended_at, p.app_version, p.runtime_state->'scheduler'->>'state' AS scheduler_state
                         FROM public.auto_staff_device_presence p WHERE p.staff_id = o.staff_id ORDER BY p.started_at DESC LIMIT 1) lp ON true
), held_fresh AS (
  SELECT h.*, coalesce(h.last_log_at > k.now - make_interval(mins => greatest(${runIdleMinutes}, h.browse_minutes + 15)), false) AS log_fresh
    FROM held h CROSS JOIN k
), held_judged AS (
  SELECT h.*, CASE WHEN h.campaign_id IS NOT NULL THEN 'campaign' ELSE 'operation' END AS owner,
         CASE
           WHEN h.campaign_id IS NOT NULL THEN CASE
             WHEN h.is_server THEN CASE WHEN h.log_fresh THEN 'running' ELSE 'server_run_idle' END
             WHEN h.reopened THEN 'reopened_still_held'
             WHEN NOT h.online THEN 'app_closed'
             WHEN h.log_fresh THEN 'running'
             ELSE 'app_online_run_idle' END
           WHEN NOT h.is_server AND h.reopened THEN 'reopened_still_held'
           WHEN NOT h.is_server AND NOT h.online THEN 'app_closed'
           WHEN h.phone_today IS NOT NULL AND h.phone_today < k.phone_limit THEN 'phone_check'
           WHEN h.phone_today IS NOT NULL THEN 'phone_check_limit_reached'
           WHEN h.is_server THEN 'server_operation'
           ELSE 'app_online_operation'
         END AS reason
    FROM held_fresh h CROSS JOIN k
), due AS MATERIALIZED (
  SELECT c.account_id, count(*) AS n
    FROM public.auto_campaigns c, k
   WHERE c.staff_id IN (SELECT h.staff_id FROM held h) AND c.account_id IN (SELECT h.id FROM held h)
     AND c.status = 'chờ xử lý' AND coalesce(c.is_delete, false) = false AND c.schedule <= k.now
   GROUP BY c.account_id
)
SELECT jsonb_build_object(
  'now', (SELECT now FROM k),
  'holderFunction', to_regprocedure('${HOLDER_SIG}') IS NOT NULL,
  'graceMinutes', ${graceMinutes},
  'opMinutes', ${opMinutes},
  'runIdleMinutes', ${runIdleMinutes},
  'phoneLimit', (SELECT phone_limit FROM k),
  'running', (SELECT count(*) FROM judged),
  'byHolder', coalesce((SELECT jsonb_object_agg(h, n) FROM (SELECT coalesce(holder, 'none') AS h, count(*) AS n FROM judged GROUP BY 1) q), '{}'::jsonb),
  'stuck', coalesce((SELECT jsonb_agg(jsonb_build_object('id', j.id, 'organizationId', j.organization_id, 'staffId', j.staff_id,
      'platform', j.flatform_type, 'server', j.is_server, 'web', j.is_web, 'updatedAt', j.updated_at,
      'idleMinutes', floor(extract(epoch FROM k.now - j.updated_at) / 60), 'lastActionAt', last.at) ORDER BY j.updated_at)
    FROM judged j CROSS JOIN k
    LEFT JOIN LATERAL (SELECT max(d.created_at) AS at FROM public.auto_campaign_details d WHERE d.account_id = j.id) last ON true
   WHERE j.holder IS NULL AND j.updated_at < k.now - make_interval(mins => ${graceMinutes})), '[]'::jsonb),
  'heldByReason', coalesce((SELECT jsonb_object_agg(reason, n) FROM (SELECT reason, count(*) AS n FROM held_judged GROUP BY 1) q), '{}'::jsonb),
  'operationHeld', coalesce((SELECT jsonb_agg(jsonb_build_object('id', h.id, 'organizationId', h.organization_id, 'staffId', h.staff_id,
      'platform', h.flatform_type, 'server', h.is_server, 'web', h.is_web,
      'heldSince', h.updated_at, 'heldMinutes', floor(extract(epoch FROM k.now - h.updated_at) / 60),
      'owner', h.owner, 'reason', h.reason,
      'state', CASE WHEN h.reason IN ('running', 'phone_check') THEN 'running' WHEN h.reason = 'app_closed' THEN 'app_closed' ELSE 'look' END,
      'campaignId', h.campaign_id, 'campaignAction', h.campaign_action, 'campaignStatus', h.campaign_status,
      'campaignDeleted', h.campaign_deleted, 'claimTarget', h.claim_target, 'lastLogAt', h.last_log_at,
      'appOnline', h.online, 'reopened', h.reopened, 'lastSeenAt', h.last_seen_at, 'sessionEnded', h.last_ended_at IS NOT NULL,
      'appVersion', h.app_version, 'schedulerState', h.scheduler_state, 'phoneToday', h.phone_today,
      'dueCampaigns', coalesce(d.n, 0)) ORDER BY h.updated_at)
    FROM held_judged h CROSS JOIN k LEFT JOIN due d ON d.account_id = h.id), '[]'::jsonb),
  'deletedHeld', (SELECT jsonb_build_object('count', count(*),
      'staffIds', coalesce(jsonb_agg(DISTINCT a.staff_id ORDER BY a.staff_id), '[]'::jsonb), 'oldest', min(a.updated_at), 'newest', max(a.updated_at))
    FROM public.auto_accounts a WHERE a.runtime_operation_claim_token IS NOT NULL AND coalesce(a.is_delete, false))
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

/** Câu giải thích + cách gỡ cho dòng "cần xem" của nhóm (B). */
function lookAdvice(a, report) {
  const advice = {
    server_run_idle: `lượt bộ cũ trên tài khoản Server không ghi log quá ${report.runIdleMinutes} phút: engine v2 trả legacy_busy cho tài khoản; gỡ khi App Server / worker Fly khởi động lại runtime của nhân viên`,
    reopened_still_held: 'app đã mở lại sau lúc giữ token mà token còn: bước dọn lúc đăng nhập (reset_desktop_running_statuses) không gỡ',
    app_online_run_idle: `app đang mở mà lượt chiến dịch không ghi log quá ${report.runIdleMinutes} phút (app treo / máy vừa thức): nhờ khách đăng xuất rồi đăng nhập lại; để qua 00:00 thì cổng bảo trì đóng mọi chiến dịch của nhân viên`,
    app_online_operation: `app đang mở, thao tác tài khoản giữ quá ${report.opMinutes} phút (quét data dài là bình thường): không có thao tác nào đang chạy thì nhờ khách đăng xuất rồi đăng nhập lại`,
    phone_check_limit_reached: `đã tra đủ hạn mức ngày (${a.phoneToday}/${report.phoneLimit} số) mà token còn: lượt Kiểm tra SĐT chưa nhả`,
    server_operation: 'thao tác trên tài khoản Server, hôm nay chưa tra SĐT nào: nghi rò; gỡ khi App Server / worker Fly khởi động lại runtime của nhân viên'
  }
  return advice[a.reason] || a.reason
}

function heldLine(a, report) {
  const owner = a.owner === 'campaign'
    ? `lượt chiến dịch ${a.campaignId} ${a.campaignAction}${a.campaignDeleted ? ' (đã xoá)' : a.campaignStatus !== 'đang chạy' ? ` (${a.campaignStatus})` : ''}, log cuối ${vn(a.lastLogAt)}`
    : 'thao tác tài khoản'
  const app = a.server ? ''
    : a.appOnline ? `, app online${a.appVersion ? ` ${a.appVersion}` : ''}${a.schedulerState ? ` (bộ lập lịch ${a.schedulerState})` : ''}`
      : a.lastSeenAt ? `, app thấy lần cuối ${vn(a.lastSeenAt)}${a.appVersion ? ` (${a.appVersion}${a.sessionEnded ? '' : ', phiên chưa đóng'})` : ''}`
        : ', chưa có presence (bản < 7.1.0)'
  const phone = a.phoneToday == null ? '' : `, Kiểm tra SĐT hôm nay ${a.phoneToday}/${report.phoneLimit} số`
  const due = a.dueCampaigns > 0 ? `, ${a.dueCampaigns} chiến dịch tới lịch trên tài khoản` : ''
  return `  ${a.id}  tổ chức ${a.organizationId}  nhân viên ${a.staffId}  ${kind(a)}  giữ từ ${vn(a.heldSince)} (${a.heldMinutes} phút)  ${owner}${app}${phone}${due}`
}

function printReport(report, { all = false } = {}) {
  const by = Object.entries(report.byHolder || {}).sort((x, y) => y[1] - x[1]).map(([h, n]) => `${HOLDER_LABEL[h] || h} ${n}`).join(', ')
  console.log(`Tài khoản "đang chạy": ${report.running} (${by || 'không có'}). Hàm V681 trên DB: ${report.holderFunction ? 'có' : 'chưa có'}.`)
  const stuck = report.stuck || []
  console.log(`\n(A) Kẹt "đang chạy", không gì giữ, quá ${report.graceMinutes} phút: ${stuck.length}`)
  for (const a of stuck) {
    console.log(`  ${a.id}  tổ chức ${a.organizationId}  nhân viên ${a.staffId}  ${kind(a)}  lần ghi cuối ${vn(a.updatedAt)} (${a.idleMinutes} phút), hành động cuối ${vn(a.lastActionAt)}`)
  }

  const held = report.operationHeld || []
  const group = state => held.filter(a => a.state === state)
  const running = group('running'), closed = group('app_closed'), look = group('look')
  const phone = running.filter(a => a.reason === 'phone_check').length
  console.log(`\n(B) Giữ token thao tác quá ${report.opMinutes} phút: ${held.length} — đang chạy ${running.length} (lượt bộ cũ ${running.length - phone}, `
    + `Kiểm tra SĐT ${phone}), app không online ${closed.length} (tự gỡ ở lần đăng nhập kế), cần xem ${look.length}`)
  if (look.length) {
    console.log('  Cần xem:')
    for (const a of look) console.log(`${heldLine(a, report)}\n      → ${lookAdvice(a, report)}`)
  }
  if (all) {
    for (const [title, rows] of [['Đang chạy', running], ['App không online', closed]]) {
      if (!rows.length) continue
      console.log(`  ${title}:`)
      for (const a of rows) console.log(heldLine(a, report))
    }
  } else if (running.length || closed.length) console.log('  (--all để liệt kê cả dòng đang chạy và app không online)')

  const del = report.deletedHeld || { count: 0 }
  console.log(`\n(C) Tài khoản đã xoá còn token: ${del.count}${del.count ? ` (nhân viên ${del.staffIds.join(', ')}; giữ từ ${vn(del.oldest)} tới ${vn(del.newest)}). `
    + 'Không bước dọn nào gỡ; chỉ làm private.app_access_held luôn đúng cho các nhân viên này.' : ''}`)
}

function main() {
  const opt = parseArgs(process.argv.slice(2))
  const sql = buildSql(opt)
  if (opt.printSql) { console.log(sql); return }
  const report = runQuery(sql, resolveWorkdir(opt))
  if (opt.json) console.log(JSON.stringify(report, null, 2))
  else printReport(report, opt)
  if ((report.stuck || []).length > 0 || (report.operationHeld || []).some(a => a.state === 'look')) process.exitCode = 2
}

if (require.main === module) {
  try { main() } catch (error) { console.error(error.message || error); process.exit(1) }
}
module.exports = { buildSql, HOLDER_LABEL, HELD_STATE }
