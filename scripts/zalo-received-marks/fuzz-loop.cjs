#!/usr/bin/env node
// Bộ thử lặp cho mốc "Đã nhận" (V525 bảng auto_zalo_message_status + V653 bốn hàm đọc + phần ghép của Desktop và Web).
//
// Mỗi vòng: sinh một bộ dữ liệu (mẫu thật đã lấy chỉ đọc từ production, dữ liệu ngẫu nhiên, và dữ liệu cố tình sai lệch),
// nạp vào Postgres 16 cục bộ có nguyên văn bốn hàm đọc của production + V653 thật, gọi mọi bộ lọc của ba hàm danh sách và
// hàm báo cáo, rồi so với:
//   1. bộ đáp án viết độc lập ở đây (không dùng code app);
//   2. phần ghép thật của Desktop (src/shared/zaloMessageStatusMarks.ts) và Web (control-api messageStatusToEngagement);
//   3. hàm dựng báo cáo thật của Desktop và Web.
// Cuối cùng chạy bản gỡ V653 và kiểm thân bốn hàm trở về đúng bản production.
//
// node scripts/zalo-received-marks/fuzz-loop.cjs [--rounds 3] [--seed 1] [--real <file json ngoài repo>] [--webapp <checkout>]
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '../..')
const args = process.argv.slice(2)
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
const ROUNDS = Number(arg('--rounds', '3'))
const SEED0 = Number(arg('--seed', '1'))
const REAL = arg('--real', null)
const WEBAPP = path.resolve(arg('--webapp', path.join(root, '../akaAgentWebApp')))
const PGBIN = arg('--pgbin', '/usr/lib/postgresql/16/bin')
const KEEP = args.includes('--keep')
// Đối chứng: chạy với bản ghép khác của Desktop (vd. bản trước khi sửa) để chắc bộ thử bắt được lỗi.
const DESKTOP_MARKS = path.resolve(arg('--desktop-marks', path.join(root, 'src/shared/zaloMessageStatusMarks.ts')))
const MIGRATION = path.resolve(arg('--migration', path.join(root, 'migrations/migration_v653_zalo_received_marks_readers.sql')))

// ---------------------------------------------------------------------------- random
function rng(seed) {
  let s = seed >>> 0 || 1
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
  return {
    next, chance: p => next() < p, int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: list => list[Math.floor(next() * list.length)],
    shuffle: list => { const out = list.slice(); for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] } return out }
  }
}

// ---------------------------------------------------------------------------- postgres
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-received-fuzz-'))
const pgdata = path.join(tmp, 'data')
const port = 26000 + Math.floor(Math.random() * 2000)
const env = { ...process.env, LC_ALL: 'C', PGHOST: tmp, PGPORT: String(port), PGUSER: 'postgres', PGDATABASE: 'postgres' }
const asPostgres = process.getuid && process.getuid() === 0
function pgExec(bin, binArgs, opts = {}) {
  const full = path.join(PGBIN, bin)
  if (asPostgres) return execFileSync('runuser', ['-u', 'postgres', '--', full, ...binArgs], { env, stdio: opts.stdio || 'pipe', maxBuffer: 1 << 30, input: opts.input })
  return execFileSync(full, binArgs, { env, stdio: opts.stdio || 'pipe', maxBuffer: 1 << 30, input: opts.input })
}
function startCluster() {
  if (asPostgres) execFileSync('chown', ['-R', 'postgres', tmp])
  pgExec('initdb', ['-D', pgdata, '-U', 'postgres', '--no-locale', '-E', 'UTF8', '-A', 'trust'])
  pgExec('pg_ctl', ['-D', pgdata, '-l', path.join(tmp, 'log'), '-o', `-k ${tmp} -p ${port} -c listen_addresses='' -c timezone=UTC -c fsync=off`, '-w', 'start'])
}
function stopCluster() { try { pgExec('pg_ctl', ['-D', pgdata, '-m', 'immediate', 'stop']) } catch { /* đã dừng */ } }
function psql(sql, { json = false } = {}) {
  const file = path.join(tmp, `q${Math.random().toString(36).slice(2)}.sql`)
  fs.writeFileSync(file, sql)
  if (asPostgres) execFileSync('chown', ['postgres', file])
  const res = spawnSync(asPostgres ? 'runuser' : path.join(PGBIN, 'psql'),
    [...(asPostgres ? ['-u', 'postgres', '--', path.join(PGBIN, 'psql')] : []), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-f', file],
    { env, maxBuffer: 1 << 30, encoding: 'utf8' })
  fs.rmSync(file, { force: true })
  if (res.status !== 0) throw new Error(`psql failed: ${res.stderr.slice(0, 4000)}`)
  if (!json) return res.stdout
  const line = res.stdout.trim().split('\n').filter(Boolean).pop()
  return JSON.parse(line)
}
const migrationBody = file => {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const b = lines.findIndex(l => l.trim() === 'BEGIN;')
  const c = lines.map(l => l.trim()).lastIndexOf('COMMIT;')
  return 'BEGIN;\n' + lines.slice(b + 1, c).join('\n') + '\nCOMMIT;'
}

const SCHEMA = `
CREATE SCHEMA private;
DO $$ BEGIN
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_desktop; CREATE ROLE aka_agent_chat_api;
END $$;
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint, is_active boolean DEFAULT true);
CREATE TABLE public.auto_campaigns (id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, status text, created_at timestamptz DEFAULT now(), is_delete boolean DEFAULT false);
CREATE TABLE public.auto_status (id bigint PRIMARY KEY, code text, name text, status_value text, color text);
CREATE TABLE public.auto_accounts (id bigint PRIMARY KEY, flatform_type text, is_zalo_show_web boolean);
CREATE TABLE public.auto_campaign_input_data (id bigint PRIMARY KEY, campaign_id bigint, name text, phone text, uid text, email text,
  info1 text, info2 text, info3 text, info4 text, info5 text, status text, note text, created_at timestamptz, date_action timestamptz, is_delete boolean);
CREATE TABLE public.auto_campaign_details (id bigint PRIMARY KEY, campaign_id bigint, input_data_id bigint, account_id bigint, action_code text,
  action_name text, status text, status_id bigint, sub_status_id bigint, report_group text, error_code text, log text, post_url text,
  data jsonb DEFAULT '{}', created_at timestamptz NOT NULL, is_delete boolean NOT NULL DEFAULT false);
CREATE INDEX ON public.auto_campaign_details (campaign_id, created_at);
CREATE INDEX ON public.auto_campaign_details (input_data_id);
CREATE TABLE public.auto_campaign_detail_zalo_engagement (campaign_detail_id bigint PRIMARY KEY, organization_id bigint, staff_id bigint,
  account_id bigint, account_zalo_uid text, target_zalo_uid text, action_type text, sent_at timestamptz, tracking_until timestamptz,
  message_ids text[], seen_at timestamptz, responded_at timestamptz, reacted_at timestamptz, friended_at timestamptz, updated_at timestamptz,
  rejected_at timestamptz);
CREATE FUNCTION private.aka_agent_assert_request_ownership(bigint, bigint, bigint) RETURNS void LANGUAGE sql AS 'SELECT';
CREATE FUNCTION public.auto_assert_automation_identity(bigint, bigint, text, text) RETURNS void LANGUAGE sql AS 'SELECT';
${(() => { // Bảng kết quả của V525, chép nguyên văn khối CREATE TABLE + chỉ mục.
    const v525 = fs.readFileSync(path.join(root, 'migrations/migration_v525_zalo_message_status_sync.sql'), 'utf8')
    const start = v525.indexOf('CREATE TABLE public.auto_zalo_message_status (')
    const end = v525.indexOf('ALTER TABLE public.auto_zalo_message_status ENABLE ROW LEVEL SECURITY;')
    return v525.slice(start, end).replace(/COMMENT ON TABLE[^;]*;/s, '')
  })()}
`

const READERS = ['aka_agent_list_campaign_details_page_v2', 'aka_agent_list_campaign_details_page_v3',
  'aka_agent_read_campaign_result_recipients', 'aka_agent_read_campaign_run_report']
const MD5_SQL = `SELECT jsonb_object_agg(p.proname, md5(p.prosrc)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN (${READERS.map(r => `'${r}'`).join(',')});`

// ---------------------------------------------------------------------------- app code (bundled from the real sources)
async function loadApp() {
  const entry = path.join(tmp, 'app.ts')
  fs.writeFileSync(entry, `
    export { mergeZaloMessageStatus } from ${JSON.stringify(DESKTOP_MARKS)}
    export { engagementDisplay } from ${JSON.stringify(path.join(root, 'src/shared/zaloCampaignEngagement.ts'))}
    export { parseCampaignResultRecipientsRpc } from ${JSON.stringify(path.join(root, 'src/shared/campaignResultActions.ts'))}
    export * as desktopReport from ${JSON.stringify(path.join(root, 'src/shared/campaignRunReport.ts'))}
    export { messageStatusToEngagement, messageStatusDisplay } from ${JSON.stringify(path.join(WEBAPP, 'packages/control-api/src/zaloMessageStatusView.ts'))}
    export { engagementApplicable } from ${JSON.stringify(path.join(WEBAPP, 'packages/control-api/src/zaloCampaignEngagement.ts'))}
    export * as webReport from ${JSON.stringify(path.join(WEBAPP, 'packages/control-api/src/campaignRunReport.ts'))}
  `)
  const out = path.join(tmp, 'app.cjs')
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'silent',
    nodePaths: [path.join(root, 'node_modules'), path.join(WEBAPP, 'node_modules')] })
  return require(out)
}
// Bản sao đúng hàm statusRow của API Web (apps/api/.../zaloMessageStatusRead.ts): dòng đọc thẳng từ bảng.
const webTimestamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null
function webStatusRow(row) {
  if (!row || typeof row !== 'object') return null
  const id = Number(row.campaign_detail_id); const sentAt = webTimestamp(row.sent_at); const replyUntil = webTimestamp(row.reply_until)
  if (!Number.isSafeInteger(id) || !sentAt || !replyUntil) return null
  return { campaign_detail_id: id, action_type: row.action_type === 'friend_request' ? 'friend_request' : 'message', sent_at: sentAt,
    reply_until: replyUntil, delivered_at: webTimestamp(row.delivered_at), seen_at: webTimestamp(row.seen_at), reacted_at: webTimestamp(row.reacted_at),
    responded_at: webTimestamp(row.responded_at), friended_at: webTimestamp(row.friended_at) }
}

// ---------------------------------------------------------------------------- data generation
const MESSAGE = ['zalo_message_friend', 'zalo_message_stranger']
const FRIEND = 'zalo_add_friend'
const ENGAGED = [...MESSAGE, FRIEND]
const OTHER = ['zalo_find_phone_user', 'zalo_change_alias', 'zalo_tag_contact', 'zalo_message_group', null]
const LEGACY = { success: ['thành công', 'đã là bạn bè'], failure: ['thất bại', 'lỗi', 'không tồn tại'], skipped: ['bỏ qua'] }
const STATUSES = ['thành công', 'thành công', 'thành công', 'thất bại', 'lỗi', 'không tồn tại', 'đã là bạn bè', 'bỏ qua', 'đang chờ']
const iso = ms => new Date(ms).toISOString()
const WEIRD_TS = ['infinity', '-infinity', '0044-03-15 00:00:00+00 BC', '9999-12-31 23:59:59.999999+00', '1970-01-01 00:00:00+00']

function generate(seed, real) {
  const r = rng(Math.imul(seed, 2654435761) ^ 0x9e3779b9)
  // Chia đều ba kiểu theo seed: mẫu thật, dữ liệu sinh ngẫu nhiên, dữ liệu sinh ngẫu nhiên sai lệch nặng.
  const kind = seed % 3
  const mode = real && kind === 0 ? 'real' : 'synth'
  const corrupt = kind === 2 ? r.pick([0.4, 0.7]) : r.chance(0.6) ? r.pick([0.05, 0.15, 0.4]) : 0
  const db = { campaigns: [], accounts: [], inputs: [], details: [], engagement: [], status: [], staff: [{ id: 11, organization_id: 21 }], notes: [] }
  const now = Date.parse('2026-11-25T03:00:00Z')

  if (mode === 'real') {
    const camps = r.shuffle(real.campaigns).slice(0, r.int(4, 12))
    const keep = new Set(camps.map(c => c.id))
    for (const c of camps) db.campaigns.push({ id: c.id, status: c.status, created_at: c.created_at })
    db.details = real.details.filter(d => keep.has(d.campaign_id)).map(d => ({ ...d, data: d.partial ? { partialSend: { stage: 'x' } } : {} }))
    const detailIds = new Set(db.details.map(d => d.id))
    db.engagement = real.engagement.filter(e => detailIds.has(e.campaign_detail_id))
    const inputIds = new Set(db.details.map(d => d.input_data_id).filter(Boolean))
    db.inputs = real.inputs.filter(i => inputIds.has(i.id))
    const accIds = new Set(db.details.map(d => d.account_id))
    db.accounts = real.accounts.filter(a => accIds.has(a.id))
    for (const id of accIds) if (!db.accounts.some(a => a.id === id)) db.accounts.push({ id, flatform_type: 'zalo', is_zalo_show_web: false })
    db.statuses = real.statuses
  } else {
    db.statuses = [{ id: 31, code: 'success', name: 'Thành công', status_value: 'thành công' }, { id: 32, code: 'received', name: 'Đã nhận', status_value: 'đã nhận' },
      { id: 34, code: 'seen', name: 'Đã xem', status_value: 'đã xem' }, { id: 40, code: 'failed', name: 'Thất bại', status_value: 'thất bại' }]
    const nAcc = r.int(2, 8)
    for (let a = 1; a <= nAcc; a++) db.accounts.push({ id: 900 + a, flatform_type: r.pick(['zalo', 'zalo', 'zalo', 'facebook']), is_zalo_show_web: r.chance(0.2) })
    const nCamp = r.int(2, 10)
    let detailId = 1_000_000 + seed * 10_000, inputId = 2_000_000 + seed * 10_000
    for (let c = 0; c < nCamp; c++) {
      const cid = 70_000 + seed * 100 + c
      db.campaigns.push({ id: cid, status: 'đang chạy', created_at: iso(now - 9 * 86400e3) })
      const nIn = r.int(1, 160)
      const actions = r.shuffle([...ENGAGED, ...OTHER]).slice(0, r.int(1, 5))
      for (let i = 0; i < nIn; i++) {
        const iid = ++inputId
        db.inputs.push({ id: iid, campaign_id: cid, status: r.pick(['hoàn thành', 'chờ xử lý', 'tạm dừng']), is_delete: r.chance(0.04) ? true : r.chance(0.1) ? null : false,
          created_at: iso(now - r.int(1, 8) * 86400e3), date_action: r.chance(0.8) ? iso(now - r.int(1, 7 * 86400) * 1e3) : null })
        const nDet = r.chance(0.15) ? 0 : r.int(1, 3)
        for (let k = 0; k < nDet; k++) {
          const status = r.pick(STATUSES)
          db.details.push({ id: ++detailId, campaign_id: cid, input_data_id: r.chance(0.03) ? null : iid, account_id: r.pick(db.accounts).id,
            action_code: r.pick(actions), action_name: 'x', status, status_id: r.chance(0.3) ? r.pick(db.statuses).id : null,
            sub_status_id: r.chance(0.1) ? 32 : null,
            report_group: r.chance(0.5) ? null : r.pick(['success', 'success', 'failure', 'skipped', 'pending', 'weird']),
            created_at: iso(now - r.int(60, 8 * 86400) * 1e3 - k * 1000), is_delete: r.chance(0.05), data: r.chance(0.04) ? { partialSend: { stage: 'content_after_media' } } : {} })
        }
      }
    }
    // Hệ cũ (V339): một phần lượt gửi thành công có dòng tương tác.
    for (const d of db.details) {
      if (!ENGAGED.includes(d.action_code) || !r.chance(0.5)) continue
      const sent = Date.parse(d.created_at)
      const isFriend = d.action_code === FRIEND
      db.engagement.push({ campaign_detail_id: d.id, action_type: isFriend ? 'friend_request' : 'message', sent_at: iso(sent), tracking_until: iso(sent + 168 * 3600e3),
        seen_at: !isFriend && r.chance(0.35) ? iso(sent + r.int(5, 86400) * 1e3) : null,
        responded_at: !isFriend && r.chance(0.06) ? iso(sent + r.int(60, 86400) * 1e3) : null,
        reacted_at: !isFriend && r.chance(0.04) ? iso(sent + r.int(60, 86400) * 1e3) : null,
        friended_at: isFriend && r.chance(0.2) ? iso(sent + r.int(60, 86400) * 1e3) : null,
        rejected_at: isFriend && r.chance(0.05) ? iso(sent + r.int(60, 86400) * 1e3) : null, account_id: d.account_id })
    }
  }

  // Hệ mới (V525): mô phỏng dòng trạng thái cho tài khoản bật đồng bộ (tài khoản không có akaChat).
  const statusAccounts = new Set(db.accounts.filter(() => r.chance(0.6)).map(a => a.id))
  const engagementById = new Map(db.engagement.map(e => [e.campaign_detail_id, e]))
  for (const d of db.details) {
    const regular = ENGAGED.includes(d.action_code) && d.status === 'thành công' && statusAccounts.has(d.account_id)
    if (!regular && !(corrupt && r.chance(corrupt / 3))) continue
    const sent = Date.parse(d.created_at) + r.int(0, 3000)
    const isFriend = d.action_code === FRIEND
    const e = engagementById.get(d.id)
    const near = (base, max) => iso(base + r.int(1, max) * 1000)
    const s = { campaign_detail_id: d.id, campaign_id: d.campaign_id, account_id: d.account_id || 1, account_zalo_uid: 'a', target_zalo_uid: 't',
      action_type: isFriend ? 'friend_request' : 'message', message_ids: isFriend ? [] : ['m1'], sent_at: iso(sent), reply_until: iso(sent + 168 * 3600e3),
      delivered_at: null, seen_at: null, reacted_at: null, responded_at: null, friended_at: null }
    if (!isFriend) {
      if (r.chance(0.85)) s.delivered_at = near(sent, 7200)
      if (s.delivered_at && r.chance(0.45)) s.seen_at = near(Date.parse(s.delivered_at), 86400)
      if (s.seen_at && r.chance(0.12)) s.reacted_at = near(Date.parse(s.seen_at), 3600)
      if (s.seen_at && r.chance(0.12)) s.responded_at = near(Date.parse(s.seen_at), 3600)
      if (e && r.chance(0.5)) { // cả hai hệ cùng ghi: cùng giờ, sớm hơn hoặc muộn hơn
        if (e.seen_at && r.chance(0.5)) s.seen_at = r.chance(0.5) ? e.seen_at : iso(Date.parse(e.seen_at) + r.int(-600, 600) * 1000)
        if (e.responded_at && r.chance(0.5)) s.responded_at = e.responded_at
      }
    } else if (r.chance(0.25)) s.friended_at = near(sent, 86400)
    if (corrupt && r.chance(corrupt)) {
      const kind = r.int(1, 10)
      s.corrupt = kind
      if (kind === 1 && s.seen_at) s.delivered_at = iso(Date.parse(s.seen_at) + r.int(1, 3600) * 1000) // nhận sau khi xem
      if (kind === 1 && !s.seen_at) { s.seen_at = near(sent, 600); s.delivered_at = iso(Date.parse(s.seen_at) + 60_000) }
      if (kind === 2) { s.delivered_at = iso(sent - r.int(1, 86400) * 1000); s.seen_at = iso(sent - 1000) } // mốc trước giờ gửi
      if (kind === 3) s.campaign_id = d.campaign_id + 1 // lệch chiến dịch
      if (kind === 4) s.action_type = isFriend ? 'message' : 'friend_request'
      if (kind === 5) s[r.pick(['delivered_at', 'seen_at', 'reacted_at', 'responded_at', 'friended_at'])] = r.pick(WEIRD_TS)
      if (kind === 6) s.reply_until = iso(sent - 3600e3)
      if (kind === 7) { s.delivered_at = null; s.seen_at = null; s.reacted_at = near(sent, 600) } // tương tác mà chưa xem
      if (kind === 8) { s.responded_at = near(sent, 60); s.delivered_at = null } // phản hồi không có biên nhận
      if (kind === 9) { s.sent_at = r.pick(WEIRD_TS.slice(2)); s.reply_until = r.pick(WEIRD_TS) } // giờ gửi / hạn cực trị
      if (kind === 10) { s.delivered_at = s.seen_at = s.reacted_at = s.responded_at = s.friended_at = iso(sent) } // mọi mốc trùng giờ gửi
    }
    db.status.push(s)
  }
  if (corrupt) { // dòng trạng thái mồ côi (không có kết quả) và kết quả đã xoá có dòng trạng thái
    for (let k = 0; k < r.int(0, 5); k++) db.status.push({ campaign_detail_id: 99_000_000 + seed * 100 + k, campaign_id: db.campaigns[0].id, account_id: 1,
      account_zalo_uid: 'a', target_zalo_uid: 't', action_type: 'message', message_ids: [], sent_at: iso(now), reply_until: iso(now + 1e9),
      delivered_at: iso(now), seen_at: null, reacted_at: null, responded_at: null, friended_at: null, corrupt: 11 })
    if (corrupt >= 0.15) for (const e of db.engagement) if (r.chance(corrupt / 4)) { // dòng cũ hỏng
      const k = r.int(1, 3)
      if (k === 1) { e.seen_at = r.pick(WEIRD_TS); e.corrupt = 1 }
      if (k === 2) { e.seen_at = e.responded_at = e.reacted_at = e.friended_at = null; e.rejected_at = iso(now); e.corrupt = 2 }
      if (k === 3) { e.sent_at = null; e.tracking_until = null; e.corrupt = 3 }
    }
  }
  db.mode = mode; db.corrupt = corrupt
  return db
}

const lit = v => v === null || v === undefined ? 'NULL' : typeof v === 'boolean' ? String(v) : typeof v === 'number' ? String(v)
  : Array.isArray(v) ? `ARRAY[${v.map(lit).join(',')}]::text[]` : typeof v === 'object' ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`
function insertSql(table, rows, cols) {
  if (!rows.length) return ''
  const out = []
  for (let i = 0; i < rows.length; i += 500) out.push(`INSERT INTO ${table} (${cols.join(',')}) VALUES\n${rows.slice(i, i + 500).map(row => `(${cols.map(c => lit(row[c])).join(',')})`).join(',\n')};`)
  return out.join('\n')
}
function loadSql(db) {
  return `TRUNCATE public.auto_campaigns, public.auto_status, public.auto_accounts, public.auto_campaign_input_data, public.auto_campaign_details,
    public.auto_campaign_detail_zalo_engagement, public.auto_zalo_message_status, public.org_staff;
  INSERT INTO public.org_staff VALUES (11, 21, true);
  ${insertSql('public.auto_campaigns', db.campaigns.map(c => ({ ...c, staff_id: 11, organization_id: 21, is_delete: false })), ['id', 'staff_id', 'organization_id', 'status', 'created_at', 'is_delete'])}
  ${insertSql('public.auto_status', db.statuses, ['id', 'code', 'name', 'status_value', 'color'])}
  ${insertSql('public.auto_accounts', db.accounts, ['id', 'flatform_type', 'is_zalo_show_web'])}
  ${insertSql('public.auto_campaign_input_data', db.inputs, ['id', 'campaign_id', 'status', 'created_at', 'date_action', 'is_delete'])}
  ${insertSql('public.auto_campaign_details', db.details, ['id', 'campaign_id', 'input_data_id', 'account_id', 'action_code', 'action_name', 'status', 'status_id', 'sub_status_id', 'report_group', 'created_at', 'is_delete', 'data'])}
  ${insertSql('public.auto_campaign_detail_zalo_engagement', db.engagement, ['campaign_detail_id', 'action_type', 'sent_at', 'tracking_until', 'seen_at', 'responded_at', 'reacted_at', 'friended_at', 'rejected_at', 'account_id'])}
  ${insertSql('public.auto_zalo_message_status', db.status, ['campaign_detail_id', 'campaign_id', 'account_id', 'account_zalo_uid', 'target_zalo_uid', 'action_type', 'message_ids', 'sent_at', 'reply_until', 'delivered_at', 'seen_at', 'reacted_at', 'responded_at', 'friended_at'])}
  ANALYZE;`
}

const FILTERS = ['all', 'received', 'seen', 'responded', 'reacted', 'friended', 'none']
function callsSql(db, r) {
  const calls = []
  const q = (key, sql) => calls.push(`SELECT ${lit(key)} AS k, (${sql}) AS v`)
  for (const c of db.campaigns) {
    const codes = [...new Set(db.details.filter(d => d.campaign_id === c.id).map(d => d.action_code === null ? '' : d.action_code))]
    const pickCodes = r.shuffle(codes).slice(0, 2)
    for (const f of FILTERS) {
      q(`v2|${c.id}|${f}`, `public.aka_agent_list_campaign_details_page_v2(11,21,${c.id},NULL,NULL,NULL,NULL,0,500,'created_desc','u','p',${lit(f === 'all' ? null : f)})`)
      for (const code of pickCodes) q(`v3|${c.id}|${f}|${code}`, `public.aka_agent_list_campaign_details_page_v3(11,21,${c.id},NULL,NULL,NULL,NULL,0,500,'created_desc','u','p',${lit(f)},${lit(code)})`)
      q(`keys|${c.id}|${f}`, `public.aka_agent_read_campaign_result_recipients(11,21,'u','p',${c.id},${lit({ mode: 'keys', engagementFilter: f })})`)
    }
    q(`page|${c.id}|${r.pick(FILTERS)}`, `public.aka_agent_read_campaign_result_recipients(11,21,'u','p',${c.id},${lit({ mode: 'page', limit: 100, engagementFilter: r.pick(FILTERS) })})`)
    q(`report|${c.id}`, `public.aka_agent_read_campaign_run_report(11,21,'u','p',${c.id},${lit({ legacy: LEGACY })})`)
  }
  return `SELECT jsonb_object_agg(k, v) FROM (${calls.join('\nUNION ALL\n')}) x;`
}

// ---------------------------------------------------------------------------- oracle (independent of app code)
const toMs = v => {
  if (v === null || v === undefined) return null
  if (v === 'infinity') return Infinity
  if (v === '-infinity') return -Infinity
  if (/ BC$/.test(v)) return -1e15
  const t = Date.parse(v.replace(' ', 'T').replace(/\+00$/, 'Z'))
  return Number.isNaN(t) ? null : t
}
const least = (a, b) => { const x = toMs(a), y = toMs(b); if (x === null) return y; if (y === null) return x; return Math.min(x, y) }
function oracle(db) {
  const E = new Map(db.engagement.map(e => [e.campaign_detail_id, e]))
  const rawS = new Map(db.status.map(s => [s.campaign_detail_id, s]))
  const detailOf = new Map(db.details.map(d => [d.id, d]))
  // V653: dòng trạng thái chỉ thuộc kết quả nhắn tin / kết bạn của đúng chiến dịch (như lượt đọc của API Web).
  const S = new Map([...rawS].filter(([id, s]) => { const d = detailOf.get(id); return d && ENGAGED.includes(d.action_code) && s.campaign_id === d.campaign_id }))
  const acc = new Map(db.accounts.map(a => [a.id, a]))
  const marks = d => {
    const e = E.get(d.id), s = S.get(d.id)
    return { e, s, delivered: s ? toMs(s.delivered_at) : null, seen: least(e?.seen_at, s?.seen_at), reacted: least(e?.reacted_at, s?.reacted_at),
      responded: least(e?.responded_at, s?.responded_at), friended: least(e?.friended_at, s?.friended_at) }
  }
  const has = v => v !== null && v !== undefined
  const match = (d, f) => {
    const m = marks(d)
    if (f === 'all') return true
    if (f === 'received') return (m.s && (has(m.s.delivered_at) || has(m.s.seen_at) || has(m.s.reacted_at) || has(m.s.responded_at)))
      || (m.e && (has(m.e.seen_at) || has(m.e.reacted_at) || has(m.e.responded_at)))
    if (f === 'none') return (!!m.e || !!m.s) && !(m.e && (has(m.e.seen_at) || has(m.e.responded_at) || has(m.e.reacted_at) || has(m.e.friended_at)))
      && !(m.s && (has(m.s.delivered_at) || has(m.s.seen_at) || has(m.s.responded_at) || has(m.s.reacted_at) || has(m.s.friended_at)))
    const col = { seen: 'seen_at', responded: 'responded_at', reacted: 'reacted_at', friended: 'friended_at' }[f]
    return has(m.e?.[col]) || has(m.s?.[col])
  }
  const applicable = d => {
    const a = acc.get(d.account_id)
    return E.has(d.id) || S.has(d.id) || (!!a && a.flatform_type === 'zalo' && !a.is_zalo_show_web && d.status === 'thành công'
      && ENGAGED.includes(d.action_code) && !(d.data && d.data.partialSend))
  }
  const grp = d => ['success', 'failure', 'skipped', 'pending'].includes(d.report_group) ? d.report_group
    : d.report_group == null && LEGACY.success.includes(d.status) ? 'success' : d.report_group == null && LEGACY.skipped.includes(d.status) ? 'skipped'
      : d.report_group == null && LEGACY.failure.includes(d.status) ? 'failure' : 'other'
  const live = cid => db.details.filter(d => d.campaign_id === cid && !d.is_delete)
  const report = cid => {
    const rows = live(cid).filter(d => grp(d) === 'success' && ENGAGED.includes(d.action_code))
    const out = { messageSent: 0, messageTracked: 0, responded: 0, reacted: 0, seen: 0, received: 0, deliveryTracked: 0, friendRequested: 0, friendTracked: 0, friended: 0 }
    for (const d of rows) {
      const m = marks(d)
      if (MESSAGE.includes(d.action_code)) {
        out.messageSent++
        if (m.e || m.s) out.messageTracked++
        if (m.s) out.deliveryTracked++
        if (m.responded !== null) out.responded++
        else if (m.reacted !== null) out.reacted++
        else if (m.seen !== null) out.seen++
        else if (m.delivered !== null) out.received++
      } else {
        out.friendRequested++
        if (m.e || m.s) out.friendTracked++
        if (m.friended !== null) out.friended++
      }
    }
    return out
  }
  const recipients = (cid, f) => {
    const ids = new Set()
    for (const i of db.inputs) if (i.campaign_id === cid && !i.is_delete) {
      if (f === 'all' || live(cid).some(d => d.input_data_id === i.id && match(d, f))) ids.add(i.id)
    }
    return ids
  }
  return { E, S, rawS, marks, match, applicable, live, report, recipients }
}

// ---------------------------------------------------------------------------- checks
const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x))
const MARK_KEYS = ['delivered_at', 'seen_at', 'responded_at', 'reacted_at', 'friended_at', 'rejected_at']
const markMs = v => v ? (Number.isFinite(Date.parse(v)) ? Date.parse(v) : `invalid:${v}`) : null

const IMPOSSIBLE_TS = v => v === 'infinity' || v === '-infinity' || / BC$/.test(String(v)) || /^1970-/.test(String(v))
function impossible(s, e) {
  if (s && (s.corrupt === 2 || s.corrupt === 9 || ['delivered_at', 'seen_at', 'reacted_at', 'responded_at', 'friended_at'].some(k => IMPOSSIBLE_TS(s[k])))) return true
  return !!(e && e.corrupt === 1)
}
function check(db, res, app, issues) {
  const o = oracle(db)
  const issue = (kind, detail) => { if (issues.filter(i => i.kind === kind).length < 6) issues.push({ kind, ...detail }); issues.count = (issues.count || 0) + 1 }
  const detailById = new Map(db.details.map(d => [d.id, d]))
  for (const c of db.campaigns) {
    // 1. Danh sách kết quả: v2 / v3 theo từng bộ lọc.
    for (const f of FILTERS) {
      const page = res[`v2|${c.id}|${f}`]
      const got = new Set((page.items || []).map(it => Number(it.id)))
      const want = new Set(o.live(c.id).filter(d => o.match(d, f)).map(d => d.id))
      if (Number(page.total) !== want.size || !sameSet(got, want)) issue('v2_filter', { campaign: c.id, filter: f, total: page.total, want: want.size })
      for (const key of Object.keys(res).filter(k => k.startsWith(`v3|${c.id}|${f}|`))) {
        const code = key.split('|')[3]
        const v3 = res[key]
        const w3 = new Set(o.live(c.id).filter(d => (code === '' ? d.action_code === null : d.action_code === code) && o.match(d, f)).map(d => d.id))
        const g3 = new Set((v3.items || []).map(it => Number(it.id)))
        if (Number(v3.total) !== w3.size || !sameSet(g3, w3)) issue('v3_filter', { campaign: c.id, filter: f, code, total: v3.total, want: w3.size })
      }
      const keys = res[`keys|${c.id}|${f}`]
      const wantR = o.recipients(c.id, f)
      const gotR = new Set((keys.ids || []).map(Number))
      if (Number(keys.total) !== wantR.size || !sameSet(gotR, wantR)) issue('recipients_filter', { campaign: c.id, filter: f, total: keys.total, want: wantR.size })
    }
    // 2. Nội dung từng dòng v2 (bộ lọc "all") + phần ghép của Desktop và Web.
    for (const item of res[`v2|${c.id}|all`].items || []) {
      const d = detailById.get(Number(item.id))
      const s = o.S.get(d.id)
      const payloadS = item.zalo_message_status
      const bad = impossible(s, o.E.get(d.id))
      if (!!s !== !!payloadS) issue('payload_status_presence', { detail: d.id })
      if (s && payloadS && MARK_KEYS.slice(0, 5).some(k => (toMs(s[k]) ?? null) !== (toMs(payloadS[k]) ?? null))) issue('payload_status_value', { detail: d.id })
      if (Boolean(item.zalo_engagement_applicable) !== o.applicable(d)) issue('applicable', { detail: d.id, got: item.zalo_engagement_applicable })
      let desktop
      try { desktop = app.mergeZaloMessageStatus(item.zalo_engagement, payloadS) } catch (error) { issue('desktop_merge_throw', { detail: d.id, error: String(error) }); continue }
      // Web: hàm RPC trả zalo_engagement; API đọc bảng trạng thái riêng (lọc campaign_id) rồi ghép khi lượt gửi thuộc diện.
      let web = item.zalo_engagement || null
      let webApplicable = Boolean(item.zalo_engagement_applicable)
      const webRow = s && s.campaign_id === d.campaign_id && app.engagementApplicable(d.action_code) ? webStatusRow(payloadS) : null
      try { if (webRow) { web = app.messageStatusToEngagement(webRow, web); webApplicable = true } } catch (error) { issue('web_merge_throw', { detail: d.id, error: String(error) }); continue }
      const dm = MARK_KEYS.map(k => markMs(desktop?.[k])), wm = MARK_KEYS.map(k => markMs(web?.[k]))
      if (JSON.stringify(dm) !== JSON.stringify(wm)) issue('desktop_web_marks', { detail: d.id, desktop: dm, web: wm, corrupt: s?.corrupt })
      if (s && [markMs(desktop?.sent_at), markMs(desktop?.tracking_until)].join() !== [markMs(web?.sent_at), markMs(web?.tracking_until)].join()) issue('desktop_web_window', { detail: d.id, corrupt: s?.corrupt })
      if (webApplicable !== Boolean(item.zalo_engagement_applicable)) issue('desktop_web_applicable', { detail: d.id })
      let text = ''
      try { text = app.engagementDisplay(desktop, Boolean(item.zalo_engagement_applicable)) } catch (error) { issue('display_throw', { detail: d.id, error: String(error) }) }
      if (/Invalid Date|NaN/.test(text)) issue('display_invalid_date', { detail: d.id, text })
      const webText = app.messageStatusDisplay(web, webApplicable)
      if (/Invalid Date|NaN/.test(webText)) issue('web_display_invalid_date', { detail: d.id, text: webText })
      // Cột hiển thị phải khớp bộ lọc: lượt nằm trong bộ lọc X thì cột có mốc tương ứng, và ngược lại.
      const show = k => !!desktop?.[k] && Number.isFinite(Date.parse(desktop[k]))
      const shown = { received: show('delivered_at') || show('seen_at') || show('reacted_at') || show('responded_at'), seen: show('seen_at'),
        responded: show('responded_at'), reacted: show('reacted_at'), friended: show('friended_at') }
      if (!bad) for (const f of ['received', 'seen', 'responded', 'reacted', 'friended']) {
        const inFilter = (res[`v2|${c.id}|${f}`].items || []).some(it => Number(it.id) === d.id)
        if (inFilter !== shown[f]) issue('display_vs_filter', { detail: d.id, filter: f, inFilter, shown: shown[f], corrupt: s?.corrupt ?? o.E.get(d.id)?.corrupt })
      }
      const anyMark = Object.values(shown).some(Boolean)
      const inNone = (res[`v2|${c.id}|none`].items || []).some(it => Number(it.id) === d.id)
      if (!bad && inNone && anyMark) issue('display_vs_none', { detail: d.id })
      // "Đã nhận" không được muộn hơn mốc chứng tỏ người nhận đã có tin (xem / thả cảm xúc / phản hồi).
      const later = ['seen_at', 'reacted_at', 'responded_at'].map(k => show(k) ? Date.parse(desktop[k]) : null).filter(v => v !== null)
      if (show('delivered_at') && later.length && Date.parse(desktop.delivered_at) > Math.min(...later)) issue('delivered_after_seen', { detail: d.id, corrupt: s?.corrupt })
    }
    // 3. Chế độ gộp theo người nhận: dòng trạng thái đi kèm từng kết quả và được ghép.
    for (const key of Object.keys(res).filter(k => k.startsWith(`page|${c.id}|`))) {
      let parsed
      try { parsed = app.parseCampaignResultRecipientsRpc(res[key], 'page') } catch (error) { issue('recipients_parse_throw', { error: String(error) }); continue }
      for (const item of parsed.items || []) for (const result of item.results || []) {
        const s = o.S.get(result.id)
        if (s && !impossible(s, o.E.get(result.id)) && s.delivered_at && !result.zaloEngagement?.delivered_at) issue('recipients_missing_delivered', { detail: result.id, s, got: result.zaloEngagement })
      }
    }
    // 4. Báo cáo: số của hàm DB, phễu của Desktop và Web.
    const rpc = res[`report|${c.id}`]
    const want = o.report(c.id)
    for (const [k, v] of Object.entries(want)) if (Number(rpc.engagement?.[k]) !== v) issue('report_count', { campaign: c.id, key: k, got: rpc.engagement?.[k], want: v })
    try {
      const input = parse => ({ rpc: parse(rpc), catalog: null, platform: 'zalo', usesInputData: true, configuredActionCodes: ENGAGED })
      const dr = app.desktopReport.buildCampaignRunReport(input(app.desktopReport.parseCampaignRunReportRpc))
      const wr = app.webReport.buildCampaignRunReport(input(app.webReport.parseCampaignRunReportRpc))
      if (JSON.stringify(dr.engagement) !== JSON.stringify(wr.engagement)) issue('report_desktop_web', { campaign: c.id })
      const m = dr.engagement?.message
      if (m) {
        if (!(m.tracked >= m.received && m.received >= m.seen && m.seen >= m.interacted && m.interacted === m.responded + m.reacted)) issue('report_funnel_order', { campaign: c.id, m })
        if (m.receivedIsMinimum !== (want.deliveryTracked < want.messageTracked)) issue('report_minimum_flag', { campaign: c.id })
        // Phễu khớp với chính các dòng danh sách (cùng luật "đã nhận" = có mốc nhận/xem/tương tác/phản hồi).
        const listed = o.live(c.id).filter(d => MESSAGE.includes(d.action_code) && d.report_group !== 'failure')
        void listed
      }
    } catch (error) { issue('report_build_throw', { campaign: c.id, error: String(error) }) }
  }
}

// ---------------------------------------------------------------------------- main
async function main() {
  const real = REAL ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null
  startCluster()
  try {
    psql(SCHEMA)
    psql(fs.readFileSync(path.join(root, 'scripts/fixtures/zalo-received-marks/prod-readers-20261125.sql'), 'utf8'))
    const before = psql(MD5_SQL, { json: true })
    const expectBefore = { aka_agent_list_campaign_details_page_v2: '28c26d1e0bd580eb77fef7f4b8352a67', aka_agent_list_campaign_details_page_v3: '4e5c300305409908295c49d5d1941224',
      aka_agent_read_campaign_result_recipients: '3fe7e5982398b42cc73fcc0433109b05', aka_agent_read_campaign_run_report: '4bd734ca25612bfdade631c779373d42' }
    if (JSON.stringify(before) !== JSON.stringify(Object.fromEntries(Object.keys(before).map(k => [k, expectBefore[k]])))) throw new Error(`fixture md5 lệch production: ${JSON.stringify(before)}`)
    psql(migrationBody(MIGRATION))
    const after = psql(MD5_SQL, { json: true })
    const app = await loadApp()
    let clean = 0, totalIssues = 0
    for (let round = 0; round < ROUNDS; round++) {
      const seed = SEED0 + round
      const db = generate(seed, real)
      psql(loadSql(db))
      const res = psql(callsSql(db, rng(seed * 7 + 3)), { json: true })
      const issues = []
      check(db, res, app, issues)
      totalIssues += issues.count || 0
      clean = (issues.count || 0) === 0 ? clean + 1 : 0
      console.log(`vòng ${round + 1} seed ${seed} [${db.mode}, sai lệch ${db.corrupt}] ${db.campaigns.length} chiến dịch, ${db.details.length} kết quả, ${db.engagement.length} dòng cũ, ${db.status.length} dòng trạng thái, ${Object.keys(res).length} lời gọi: ${issues.count ? `${issues.count} vấn đề` : 'sạch'}`)
      for (const i of issues) console.log('   ', JSON.stringify(i))
    }
    // Bản gỡ V653 phải trả bốn hàm về đúng thân production.
    psql(migrationBody(path.join(root, 'migrations/rollback_v653_zalo_received_marks_readers.sql')))
    const rolled = psql(MD5_SQL, { json: true })
    const helperLeft = psql(`SELECT count(*) FROM pg_proc WHERE proname = 'aka_agent_zalo_marks_filter_sql';`).trim()
    const rollbackOk = JSON.stringify(rolled) === JSON.stringify(before) && helperLeft === '0'
    console.log(`md5 sau V653 ${JSON.stringify(after)}`)
    console.log(`gỡ V653: ${rollbackOk ? 'đúng thân production' : `LỆCH ${JSON.stringify(rolled)} helper=${helperLeft}`}`)
    console.log(`tổng ${totalIssues} vấn đề; vòng sạch liên tiếp cuối: ${clean}`)
    process.exitCode = totalIssues || !rollbackOk ? 1 : 0
  } finally {
    stopCluster()
    if (!KEEP) fs.rmSync(tmp, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); stopCluster(); process.exitCode = 2 })
