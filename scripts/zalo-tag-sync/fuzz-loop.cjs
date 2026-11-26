#!/usr/bin/env node
/*
 * Bộ kiểm ngẫu nhiên V660 (sổ tag Zalo + tự thêm người được gắn tag), anh yêu cầu 26/11/2026 ("Kiểm thử và cải tiến … ít nhất
 * 3 vòng không còn vấn đề").
 *
 * Mỗi kịch bản dựng một "thế giới" (nhân viên, tài khoản, chiến dịch, tag Zalo) từ dữ liệu tag thật đã ẩn danh (--real) và dữ liệu
 * mẫu sinh ngẫu nhiên, rồi chạy một chuỗi thao tác ngẫu nhiên: gắn / gỡ tag trên "Zalo", nhịp báo của Desktop / App Server / Fly,
 * sửa chiến dịch, bật / tắt công tắc, tua thời gian, đổi cài đặt, và dữ liệu sai lệch cố ý (mã sai kiểu, trùng, rỗng, quá dài,
 * chiến dịch / tài khoản của nhân viên khác, nhân viên hết quyền). Sau mỗi lời gọi, so câu trả lời và trạng thái DB với một mô hình
 * viết lại độc lập theo đặc tả (docs/ZALO_TAG_AUTO_SEND_PLAN.md), kèm các bất biến "sự thật":
 *   T1 mỗi người vào mỗi chiến dịch nhiều nhất một lần;  T2 không bao giờ thêm nhóm (mã "g…");
 *   T3 không thêm người được gắn tag trong lúc mất kết nối / lần đầu / chiến dịch đang dừng;
 *   T4 người được gắn tag khi đang theo dõi liền mạch thì có mặt (trừ đã có sẵn trong chiến dịch);
 *   T5 không thêm vào chiến dịch của nhân viên / tổ chức khác; T6 một chiến dịch lỗi không chặn các chiến dịch khác.
 *
 * Cách chạy: CHAT_REPO=<akaAgentChatApi> node scripts/zalo-tag-sync/fuzz-loop.cjs --seed 1 [--scenarios 40] [--steps 120]
 *   [--real <pool.json ngoài repo>] [--migration <file>]. Mã thoát 1 khi có sai lệch.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

const argv = process.argv.slice(2)
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback }
const SEED = Number(arg('seed', '1'))
const SCENARIOS = Number(arg('scenarios', '40'))
const STEPS = Number(arg('steps', '120'))
const REAL = arg('real', '')
const REPO = path.resolve(__dirname, '../..')
const MIGRATION = path.resolve(arg('migration', path.join(REPO, 'migrations/migration_v660_zalo_tag_sync.sql')))
const CHAT_REPO = process.env.CHAT_REPO || path.resolve(REPO, '../akaagentchatapi')
const { Client, types } = require(path.join(CHAT_REPO, 'node_modules/pg'))
types.setTypeParser(20, v => Number(v))

// ---------- ngẫu nhiên có hạt giống ----------
let rs = SEED >>> 0 || 1
const rnd = () => { rs ^= rs << 13; rs >>>= 0; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296 }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = arr => arr[Math.floor(rnd() * arr.length)]
const chance = p => rnd() < p
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

// ---------- Postgres cục bộ ----------
const PGBIN = process.env.PGBIN || execFileSync('bash', ['-c', 'ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1']).toString().trim()
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v660-fuzz-')); fs.chmodSync(TMP, 0o777)
const AS_PG = process.getuid && process.getuid() === 0 ? ['runuser', '-u', 'postgres', '--'] : []
const PORT = 55000 + (SEED % 900)
const run = (cmd, args) => { const r = spawnSync(AS_PG[0] || cmd, AS_PG.length ? [...AS_PG.slice(1), cmd, ...args] : args, { env: { ...process.env, LC_ALL: 'C' } }); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr}`); return r.stdout.toString() }
function startCluster() {
  run(`${PGBIN}/initdb`, ['-D', `${TMP}/data`, '-U', 'postgres'])
  run(`${PGBIN}/pg_ctl`, ['-D', `${TMP}/data`, '-o', `-k ${TMP} -p ${PORT} -c listen_addresses='' -c fsync=off -c synchronous_commit=off`, '-l', `${TMP}/log`, '-w', 'start'])
}
function stopCluster() { try { run(`${PGBIN}/pg_ctl`, ['-D', `${TMP}/data`, 'stop', '-m', 'immediate']) } catch { /* */ } }

// ---------- ghi sai lệch ----------
const failures = []
const cover = {}
const hit = k => { cover[k] = (cover[k] || 0) + 1 }
let checks = 0
function fail(ctx, msg, detail) {
  failures.push({ ctx, msg, detail })
  if (failures.length <= 25) console.log(`FAIL [${ctx}] ${msg}${detail ? ' ' + JSON.stringify(detail).slice(0, 600) : ''}`)
}
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
function expectEq(ctx, label, got, want) { checks++; if (!same(got, want)) fail(ctx, label, { got, want }) }

// ---------- dữ liệu thật ----------
const POOL = REAL ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : []

// ---------- mô hình (viết theo đặc tả, không chép SQL) ----------
const sqlTrim = s => s.replace(/^ +| +$/g, '')
const isTagId = s => /^[0-9A-Za-z_-]{1,40}$/.test(s)
const isMember = s => /^g?[0-9]{1,40}$/.test(s)
const isPerson = s => /^[0-9]{1,40}$/.test(s)
// jsonb ->> / #>> '{}' trên một giá trị JSON bất kỳ
const asText = v => v === null || v === undefined ? null : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)
const field = (obj, key) => (obj && typeof obj === 'object' && !Array.isArray(obj)) ? asText(obj[key]) : null

class Model {
  constructor(world) {
    this.w = world
    this.acc = new Map() // account -> {baseline, version, age (phút từ lần thấy cuối, null), members: Map tag->Set, reset}
  }
  config() { return this.w.settings }
  orgCovered(org) {
    const s = this.w.settings
    if (!s.enabled || org == null) return false
    if (String(s.orgIds).toLowerCase() === 'all') return true
    return String(s.orgIds).split(',').map(x => x.trim()).includes(String(org))
  }
  // Chiến dịch có dòng trong bảng chiến dịch đang tự thêm, và các tag của nó.
  syncTags(c) {
    if (c.action !== 'zalo_message_friend' || c.deleted) return null
    const e = c.extra
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null
    if (field(e, 'zaloFriendTargetMode') !== 'tagged_friends') return null
    if (e.zaloFriendTagAutoAddEnabled !== true) return null // chỉ boolean true (đặc tả: cùng điều kiện với giao diện)
    if (!Array.isArray(e.zaloFriendSourceTagIds)) return null
    const tags = [...new Set(e.zaloFriendSourceTagIds.filter(v => typeof v === 'string' || typeof v === 'number')
      .map(v => sqlTrim(String(v))).filter(Boolean))].sort()
    if (!tags.length || c.account == null || c.staff == null || c.org == null) return null
    return tags
  }
  syncCampaigns() { return this.w.campaigns.filter(c => this.syncTags(c)) }
  accountHasSync(accountId) { return this.syncCampaigns().some(c => c.account === accountId) }
  // Tài khoản có được hỏi tag ở nơi chạy này không.
  watched(accountId, source, staff) {
    const a = this.w.accounts.find(x => x.id === accountId)
    if (!a || a.deleted || a.platform !== 'zalo' || a.web) return null
    if (source === 'desktop' ? a.server : !a.server) return null
    if (!this.orgCovered(a.org)) return null
    const own = this.syncCampaigns().some(c => c.account === a.id && c.staff === a.staff && c.org === a.org && (staff == null || c.staff === staff))
    return own ? a.org : null
  }
  state(id) {
    if (!this.acc.has(id)) this.acc.set(id, { baseline: false, version: null, age: null, members: new Map(), reset: false })
    return this.acc.get(id)
  }
  // Trước / sau mỗi thay đổi chiến dịch: tài khoản đổi giữa "có" và "không có" chiến dịch tự thêm thì đặt lại mốc.
  noteResets(before) {
    for (const a of this.w.accounts) {
      const now = this.accountHasSync(a.id)
      if (before.get(a.id) !== now && this.acc.has(a.id)) this.acc.get(a.id).reset = true
    }
  }
  snapshotAll() { return new Map(this.w.accounts.map(a => [a.id, this.accountHasSync(a.id)])) }

  parseSnapshot(tags) {
    const out = new Map() // tag -> {name, members:Set}
    for (const t of tags) {
      const idRaw = field(t, 'id')
      const id = idRaw == null ? '' : sqlTrim(idRaw)
      if (!isTagId(id)) continue
      const ms = t && typeof t === 'object' && Array.isArray(t.m) ? t.m : []
      const nameRaw = field(t, 'name')
      const name = nameRaw == null ? null : (sqlTrim(nameRaw) || null)
      for (const m of ms) {
        const mm = asText(m) == null ? '' : sqlTrim(asText(m))
        if (!isMember(mm)) continue
        if (!out.has(id)) out.set(id, { names: new Set(), members: new Set() })
        out.get(id).members.add(mm); out.get(id).names.add(name)
      }
    }
    return out
  }

  // Một lời gọi nhận lô. Trả {response, error, inserted: [...]} theo đặc tả.
  sync(source, staff, items) {
    const s = this.w.settings
    if (!s.enabled) return { response: { enabled: false, pollSeconds: s.poll } }
    if (!Array.isArray(items)) return { error: 'zalo_tag_sync_items_invalid' }
    if (items.length > 200) return { error: 'zalo_tag_sync_too_many_items' }
    if (items.filter(x => x && typeof x === 'object' && Array.isArray(x.tags)).length > 1) return { error: 'zalo_tag_sync_one_snapshot_per_call' }
    const resp = { enabled: true, pollSeconds: s.poll, staleMinutes: s.stale, needTags: [], rejected: [], baselined: [], added: 0, removed: 0, campaignRows: 0 }
    const inserted = []
    for (const item of items) {
      const aRaw = field(item, 'a')
      if (aRaw == null || !/^[0-9]{1,15}$/.test(aRaw)) continue
      const accountId = Number(aRaw)
      const version = (field(item, 'v') ?? '').slice(0, 64)
      const hasTags = !!(item && typeof item === 'object' && Array.isArray(item.tags))
      const org = this.watched(accountId, source, staff)
      if (org == null) { resp.rejected.push(String(accountId)); hit('rejected'); continue }
      const st = this.state(accountId)
      if (st.reset && st.baseline) { st.baseline = false; hit('reset_invalidates') }
      if (!hasTags) {
        if (st.baseline && st.version === version && version !== '') st.age = 0
        else resp.needTags.push(String(accountId))
        continue
      }
      const snap = this.parseSnapshot(item.tags)
      const pairs = new Set(); for (const [t, v] of snap) for (const m of v.members) pairs.add(`${t}\u0001${m}`)
      const flyOk = source !== 'fly' || (field(item, 'c') === 'true' && st.version === (field(item, 'p') == null ? null : field(item, 'p').slice(0, 64)))
      const staleBad = source !== 'fly' && (st.age == null || st.age >= s.stale)
      if (!st.baseline || !flyOk || staleBad) {
        hit(!st.baseline ? (st.reset ? 'baseline:reset' : 'baseline:first') : !flyOk ? 'baseline:fly_discontinuous' : 'baseline:stale')
        st.members = pairs; st.version = version; st.baseline = true; st.reset = false; st.age = 0
        resp.baselined.push(String(accountId))
        continue
      }
      const added = []
      let removed = 0
      for (const p of st.members) if (!pairs.has(p)) removed++
      for (const p of pairs) if (!st.members.has(p)) { const [t, m] = p.split('\u0001'); added.push({ t, m, names: snap.get(t).names }) }
      st.members = pairs; st.version = version; st.age = 0
      resp.added += added.length; resp.removed += removed
      hit(`diff:${source}`); if (added.length) hit('diff_with_adds')
      const rows = this.autoAdd(accountId, added, source === 'desktop' ? staff : null)
      resp.campaignRows += rows.length; inserted.push(...rows)
    }
    return { response: resp, inserted }
  }

  autoAdd(accountId, added, desktopStaff) {
    const out = []
    if (!added.length) return out
    const a = this.w.accounts.find(x => x.id === accountId)
    if (this.syncCampaigns().some(c => c.account === accountId && (c.staff !== a.staff || c.org !== a.org) && this.syncTags(c).some(t => added.some(x => x.t === t)))) hit('skip:cross_staff')
    const camps = this.syncCampaigns().filter(c => c.account === accountId && c.staff === a.staff && c.org === a.org)
      .sort((x, y) => x.id - y.id)
    for (const c of camps) {
      const tags = this.syncTags(c)
      if (!added.some(x => tags.includes(x.t))) continue
      const mat = c.extra && typeof c.extra === 'object' && !Array.isArray(c.extra) && sqlTrim(field(c.extra, 'zaloFriendDataMaterializedAt') ?? '') !== ''
      if (!mat || c.ended || !['chờ xử lý', 'đang chạy', 'hoàn thành', 'tạm dừng'].includes(c.status)) { hit(!mat ? 'skip:not_materialized' : c.ended ? 'skip:ended' : 'skip:status'); continue }
      const byUid = new Map()
      for (const x of added) {
        if (!tags.includes(x.t) || !isPerson(x.m)) continue
        if (!byUid.has(x.m) || x.t < byUid.get(x.m).t) byUid.set(x.m, x)
      }
      if ([...byUid.values()].some(x => c.inputs.some(r => !r.deleted && r.uid === x.m) && !c.adds.has(x.m))) hit('skip:already_in_campaign')
      if ([...byUid.values()].some(x => c.adds.has(x.m))) hit('skip:added_before')
      if (added.some(x => tags.includes(x.t) && !isPerson(x.m))) hit('skip:group')
      const fresh = [...byUid.values()].filter(x => !c.adds.has(x.m) && !c.inputs.some(r => !r.deleted && r.uid === x.m))
        .sort((x, y) => (x.m < y.m ? -1 : x.m > y.m ? 1 : 0))
      if (!fresh.length) continue
      // Mở lại chiến dịch hoàn thành; trigger quyền production chặn thì bỏ qua đúng chiến dịch này (T6).
      if (c.status === 'hoàn thành' && this.w.denied(c)) { hit('skip:denied'); continue }
      if (c.status === 'hoàn thành') hit('reopen'); if (c.status === 'tạm dừng') hit('add_paused')
      if (desktopStaff != null && c.staff !== desktopStaff) continue
      const rows = fresh.map(x => ({ campaign: c.id, uid: x.m, tag: x.t, name: this.w.nameOf(accountId, x.m) }))
      for (const r of rows) { c.adds.add(r.uid); c.inputs.push({ uid: r.uid, deleted: false, key: `zalotag:${c.id}:${r.uid}`, name: r.name }) }
      if (c.status === 'hoàn thành') c.status = 'chờ xử lý'
      c.logs += Math.min(rows.length, 20) + (rows.length > 20 ? 1 : 0)
      out.push(...rows)
    }
    return out
  }
  advance(minutes) { for (const st of this.acc.values()) if (st.age != null) st.age += minutes }
}

// ---------- thế giới ----------
let NEXT_ID = 1000
const nid = () => ++NEXT_ID
function randomUid() { return String(ri(1, 9) * 10 ** 15 + ri(0, 10 ** 9) * 10 ** 6 + ri(0, 999999)) }

function buildWorld(scenario) {
  const w = { staffs: [], accounts: [], campaigns: [], removedCampaigns: [], users: new Map(), deniedSet: new Set(),
    settings: { enabled: true, orgIds: 'all', poll: 60, stale: pick([30, 30, 30, 5, 60]) }, zalo: new Map() }
  w.denied = c => w.deniedSet.has(`staff:${c.staff}`) || w.deniedSet.has(`account:${c.account}`)
  w.nameOf = (acc, uid) => { const u = w.users.get(`${acc}:${uid}`); return u ? (sqlTrim(u.display || '') || sqlTrim(u.zalo || '') || uid) : uid }
  const orgs = [ri(1, 3), ri(4, 6)]
  for (let i = 0; i < ri(2, 4); i++) w.staffs.push({ id: nid(), org: pick(orgs) })
  const realAccounts = POOL.length ? shuffle(POOL).slice(0, ri(1, 3)) : []
  const nAccounts = ri(2, 5)
  for (let i = 0; i < nAccounts; i++) {
    const staff = pick(w.staffs)
    const a = { id: nid(), staff: staff.id, org: staff.org, platform: 'zalo', server: chance(0.5), web: chance(0.05), deleted: chance(0.03),
      name: pick(['zl Kho', 'zl Sale 1', '', null, 'Tài khoản "A"']) }
    a.source = a.server ? (chance(0.5) ? 'fly' : 'server') : 'desktop'
    w.accounts.push(a)
    // Tag trên Zalo
    const tags = new Map()
    const real = realAccounts[i]
    if (real) {
      for (const t of real.tags.slice(0, 15)) tags.set(String(t.id), { name: `T${t.id}`, members: new Set(t.m.slice(0, chance(0.3) ? 4000 : 400)) })
    } else {
      for (let t = 1; t <= ri(1, 6); t++) tags.set(String(t), { name: pick([`Tag ${t}`, 'VIP', 'Khách "mới"', '', 'Chăm sóc\'s']), members: new Set(Array.from({ length: ri(0, 25) }, () => chance(0.1) ? 'g' + randomUid() : randomUid())) })
    }
    w.zalo.set(a.id, { tags, version: ri(1, 50) })
    // Tên trong zalo_users cho một phần người
    for (const t of tags.values()) for (const m of t.members) if (chance(0.3)) w.users.set(`${a.id}:${m}`, { display: pick(['Nguyễn Văn A', '', ' ', null, 'Tên dài '.repeat(5)]), zalo: pick(['B', null, '']) })
    // Chiến dịch
    const realCamps = real ? real.campaigns.slice(0, 5) : []
    const nCamp = realCamps.length || ri(1, 4)
    for (let k = 0; k < nCamp; k++) {
      const rc = realCamps[k]
      const tagIds = rc && Array.isArray(rc.tags) ? rc.tags.map(String) : shuffle([...tags.keys()]).slice(0, ri(1, 3))
      const cross = chance(0.08) // chiến dịch của nhân viên khác trỏ vào tài khoản này (dữ liệu sai lệch)
      const owner = cross ? pick(w.staffs) : w.staffs.find(s => s.id === a.staff)
      const c = { id: nid(), name: pick(['Chăm sóc VIP', '', null, 'Tri ân %s']), action: chance(0.95) ? 'zalo_message_friend' : 'zalo_message_phone',
        account: a.id, staff: owner.id, org: owner.org, status: rc ? rc.status : pick(['hoàn thành', 'chờ xử lý', 'đang chạy', 'tạm dừng', 'lỗi']),
        deleted: false, ended: rc ? rc.end : chance(0.05),
        extra: { zaloFriendTargetMode: chance(0.93) ? 'tagged_friends' : 'all_friends', zaloFriendSourceTagIds: chance(0.05) ? junkTagList() : tagIds,
          zaloFriendTagAutoAddEnabled: chance(0.8) ? true : chance(0.5) ? false : pick(['true', 'TRUE', null]),
          ...((rc ? rc.mat : chance(0.92)) ? { zaloFriendDataMaterializedAt: pick(['2026-11-20T00:00:00Z', ' x ']) } : chance(0.3) ? { zaloFriendDataMaterializedAt: pick(['', '  ']) } : {}) },
        adds: new Set(), inputs: [], logs: 0 }
      // Data lấy lần đầu (người đã có trong tag lúc tạo chiến dịch)
      for (const tid of tagIds) { const t = tags.get(String(tid)); if (t) for (const m of t.members) if (isPerson(m) && chance(0.7)) c.inputs.push({ uid: m, deleted: chance(0.05), key: null, name: 'cũ' }) }
      w.campaigns.push(c)
    }
  }
  // nhân viên hết quyền (trigger production)
  if (chance(0.25)) w.deniedSet.add(`staff:${pick(w.staffs).id}`)
  if (chance(0.15)) w.deniedSet.add(`account:${pick(w.accounts).id}`)
  return w
}
function junkTagList() { return pick([[' 5 ', 5, '', null, { x: 1 }, '5'], 'not-array', [], [7.5, true], ['a b', 'ok_tag-1']]) }

// ---------- DB ----------
async function loadWorld(db, w) {
  await db.query(`TRUNCATE auto_zalo_tag_sync_accounts, auto_zalo_tag_members, auto_zalo_tag_member_events, auto_zalo_tag_sync_campaigns,
    auto_campaign_zalo_tag_adds, auto_zalo_tag_sync_resets, auto_campaigns, auto_campaign_input_data, auto_campaign_logs, zalo_users,
    auto_accounts, org_staff, fuzz_denied RESTART IDENTITY`)
  await setSettings(db, w.settings)
  await db.query(`SELECT set_config('test.staff', '', false)`)
  for (const s of w.staffs) await db.query('INSERT INTO org_staff VALUES ($1,$2)', [s.id, s.org])
  for (const a of w.accounts) await db.query(`INSERT INTO auto_accounts (id, name, staff_id, organization_id, flatform_type, is_zalo_server, is_zalo_show_web, is_delete)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [a.id, a.name, a.staff, a.org, a.platform, a.server, a.web, a.deleted])
  for (const [k, u] of w.users) { const [acc, uid] = k.split(':'); await db.query('INSERT INTO zalo_users VALUES ($1,$2,$3,$4)', [acc, uid, u.display, u.zalo]) }
  for (const c of w.campaigns) {
    await db.query(`INSERT INTO auto_campaigns (id, name, action_id, account_id, staff_id, organization_id, status, schedule_end_date, extra_settings, is_delete)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [c.id, c.name, c.action, c.account, c.staff, c.org, c.status,
      c.ended ? '2020-01-01T00:00:00Z' : (chance(0.5) ? null : '2099-01-01T00:00:00Z'), JSON.stringify(c.extra), c.deleted])
    for (const r of c.inputs) await db.query('INSERT INTO auto_campaign_input_data (campaign_id, name, uid, status, is_delete) VALUES ($1,$2,$3,$4,$5)', [c.id, r.name, r.uid, 'hoàn thành', r.deleted])
  }
  for (const d of w.deniedSet) { const [kind, id] = d.split(':'); await db.query('INSERT INTO fuzz_denied VALUES ($1,$2)', [kind, id]) }
}
async function setSettings(db, s) {
  await db.query(`UPDATE auto_system_settings SET value = CASE key WHEN 'zalo.tag_sync.enabled' THEN $1 WHEN 'zalo.tag_sync.organization_ids' THEN $2
    WHEN 'zalo.tag_sync.stale_minutes' THEN $3 ELSE value END WHERE key LIKE 'zalo.tag_sync.%'`, [String(s.enabled), s.orgIds, String(s.stale)])
}

async function callSync(db, source, staff, items) {
  try {
    if (source === 'desktop') {
      await db.query(`SELECT set_config('test.staff', $1, false)`, [String(staff)])
      const r = await db.query('SELECT aka_agent_desktop_sync_zalo_tags($1::jsonb) AS r', [JSON.stringify(items)])
      return { response: r.rows[0].r }
    }
    const r = await db.query('SELECT aka_agent_sync_zalo_tags($1, $2::jsonb) AS r', [source, JSON.stringify(items)])
    return { response: r.rows[0].r }
  } catch (e) {
    return { error: e.message }
  } finally {
    await db.query(`SELECT set_config('test.staff', '', false)`)
  }
}

// ---------- so trạng thái DB với mô hình ----------
async function compareState(db, w, m, ctx) {
  const members = await db.query('SELECT account_id, tag_id, member_uid FROM auto_zalo_tag_members')
  const dbm = new Map()
  for (const r of members.rows) { if (!dbm.has(r.account_id)) dbm.set(r.account_id, new Set()); dbm.get(r.account_id).add(`${r.tag_id}\u0001${r.member_uid}`) }
  for (const [id, st] of m.acc) {
    const got = dbm.get(id) || new Set()
    checks++
    if (got.size !== st.members.size || [...st.members].some(p => !got.has(p))) fail(ctx, `sổ tag của tài khoản ${id} lệch`, { got: got.size, want: st.members.size })
  }
  for (const id of dbm.keys()) if (!m.acc.has(id)) fail(ctx, `sổ tag có tài khoản ${id} mà mô hình không có`)
  const rows = await db.query(`SELECT campaign_id, uid, name, control_append_idempotency_key k FROM auto_campaign_input_data WHERE control_append_idempotency_key LIKE 'zalotag:%' ORDER BY id`)
  const camps = await db.query('SELECT id, status FROM auto_campaigns')
  const logs = await db.query('SELECT campaign_id, count(*)::int n FROM auto_campaign_logs GROUP BY 1')
  const adds = await db.query('SELECT campaign_id, member_uid FROM auto_campaign_zalo_tag_adds')
  for (const c of w.campaigns) {
    const want = c.inputs.filter(r => r.key).map(r => `${r.uid}|${r.name}`).sort()
    const got = rows.rows.filter(r => r.campaign_id === c.id).map(r => `${r.uid}|${r.name}`).sort()
    expectEq(ctx, `dòng data tự thêm của chiến dịch ${c.id}`, got, want)
    expectEq(ctx, `trạng thái chiến dịch ${c.id}`, camps.rows.find(r => r.id === c.id)?.status, c.status)
    expectEq(ctx, `số dòng tiến trình của chiến dịch ${c.id}`, logs.rows.find(r => r.campaign_id === c.id)?.n ?? 0, c.logs)
    expectEq(ctx, `dấu đã thêm của chiến dịch ${c.id}`, adds.rows.filter(r => r.campaign_id === c.id).map(r => r.member_uid).sort(), [...c.adds].sort())
  }
  // Danh sách tài khoản giao cho nơi chạy đi hỏi tag.
  for (const source of ['server', 'fly']) {
    const r = await db.query('SELECT aka_agent_zalo_tag_sync_accounts($1) r', [source])
    const want = w.settings.enabled ? w.accounts.filter(a => m.watched(a.id, source, null) != null).map(a => a.id).sort((x, y) => x - y) : []
    expectEq(ctx, `danh sách tài khoản (${source})`, { enabled: r.rows[0].r.enabled, ids: r.rows[0].r.accountIds }, { enabled: w.settings.enabled, ids: want })
  }
  for (const st of w.staffs) {
    await db.query(`SELECT set_config('test.staff', $1, false)`, [String(st.id)])
    const r = await db.query('SELECT aka_agent_desktop_zalo_tag_sync_accounts() r')
    await db.query(`SELECT set_config('test.staff', '', false)`)
    const want = w.settings.enabled ? w.accounts.filter(a => m.watched(a.id, 'desktop', st.id) != null).map(a => a.id).sort((x, y) => x - y) : []
    expectEq(ctx, `danh sách tài khoản Desktop của nhân viên ${st.id}`, r.rows[0].r.accountIds, want)
  }
  const sc = await db.query('SELECT campaign_id FROM auto_zalo_tag_sync_campaigns ORDER BY 1')
  expectEq(ctx, 'bảng chiến dịch đang tự thêm', sc.rows.map(r => r.campaign_id), m.syncCampaigns().map(c => c.id).sort((a, b) => a - b))
  // T1 + T2
  const seen = new Set()
  for (const r of rows.rows) {
    const k = `${r.campaign_id}:${r.uid}`
    checks++
    if (seen.has(k)) fail(ctx, 'T1 một người vào chiến dịch 2 lần', k)
    seen.add(k)
    if (!/^[0-9]+$/.test(r.uid)) fail(ctx, 'T2 thêm cả nhóm', r.uid)
    if (r.k !== `zalotag:${r.campaign_id}:${r.uid}`) fail(ctx, 'khoá dòng sai', r.k)
  }
}

// ---------- kịch bản ----------
function zaloSnapshotPayload(z, junk) {
  const tags = []
  for (const [id, t] of z.tags) {
    let mm = [...t.members]
    if (junk && chance(0.3)) mm = mm.concat(pick([[' ' + (mm[0] || '1') + ' ', '', 'abc', null, 12345, { x: 1 }, 'g', 'g12a', '1'.repeat(41)], [mm[0] || '1', mm[0] || '1']]))
    const tag = { id: junk && chance(0.1) ? ` ${id} ` : (chance(0.05) ? (/^[0-9]+$/.test(id) ? Number(id) : id) : id), name: t.name, m: mm }
    tags.push(tag)
  }
  if (junk && chance(0.2)) tags.push(pick([{ id: 'bad id', m: ['1'] }, { id: '', m: ['2'] }, { m: ['3'] }, 'string-tag', { id: 'x'.repeat(41), m: ['4'] }, { id: '99', m: 'not-array' }]))
  return tags
}
function mutateZalo(w) {
  const a = pick(w.accounts); const z = w.zalo.get(a.id)
  const ids = [...z.tags.keys()]
  const r = rnd()
  if (r < 0.45 && ids.length) { // gắn người mới / người cũ vào tag
    const t = z.tags.get(pick(ids))
    const n = chance(0.1) ? ri(20, 60) : ri(1, 3)
    for (let i = 0; i < n; i++) t.members.add(chance(0.08) ? 'g' + randomUid() : chance(0.3) && t.members.size ? pick([...[...z.tags.values()].flatMap(x => [...x.members])]) : randomUid())
  } else if (r < 0.65 && ids.length) { // gỡ
    const t = z.tags.get(pick(ids)); const ms = [...t.members]; for (let i = 0; i < ri(1, 3) && ms.length; i++) t.members.delete(pick(ms))
  } else if (r < 0.72) { z.tags.set(String(ri(1, 60)), { name: 'Tag mới', members: new Set([randomUid()]) }) }
  else if (r < 0.76 && ids.length) { z.tags.delete(pick(ids)) }
  else if (r < 0.8 && ids.length) { z.tags.get(pick(ids)).name = pick(['Đổi tên', '', 'VIP 2']) }
  else return null
  z.version++
  return a
}

async function mutateCampaign(db, w, m, ctx) {
  if (chance(0.15)) { // dừng hết chiến dịch tự thêm của một tài khoản (rồi có lúc bật lại ở lượt khác)
    const a = pick(w.accounts)
    for (const c of w.campaigns.filter(x => x.account === a.id)) await toggle(db, w, m, ctx, c, w.staffs.find(s => s.id === c.staff), false)
    return
  }
  if (!w.campaigns.length) return // mọi chiến dịch đã bị xoá hẳn ở lượt trước
  const c = pick(w.campaigns)
  const r = rnd()
  if (r < 0.25) { // công tắc qua API Web (nhân viên đúng hoặc sai)
    await toggle(db, w, m, ctx, c, chance(0.85) ? w.staffs.find(s => s.id === c.staff) : pick(w.staffs), chance(0.5))
    return
  }
  await editCampaign(db, w, m, ctx, c, r)
}

async function toggle(db, w, m, ctx, c, staff, enable) {
  const before = m.snapshotAll()
  {
    const res = await db.query('SELECT aka_agent_control_set_campaign_zalo_tag_auto_add($1,$2,$3,$4) r', [staff.id, staff.org, c.id, enable])
    let want
    if (staff.id !== c.staff || staff.org !== c.org || c.deleted) want = { ok: false, code: 'campaign_not_found' }
    else if (c.action !== 'zalo_message_friend' || field(c.extra, 'zaloFriendTargetMode') !== 'tagged_friends') want = { ok: false, code: 'campaign_not_tagged_friends' }
    else {
      const cur = c.extra.zaloFriendTagAutoAddEnabled === true
      if (cur === enable) want = { ok: true, enabled: enable, changed: false }
      else { c.extra = { ...c.extra, zaloFriendTagAutoAddEnabled: enable }; c.logs += 1; want = { ok: true, enabled: enable, changed: true } }
    }
    expectEq(ctx, 'công tắc trả', res.rows[0].r, want)
  }
  m.noteResets(before)
}

async function editCampaign(db, w, m, ctx, c, r) {
  const before = m.snapshotAll()
  {
    const ops = []
    if (r < 0.4) { c.extra = { ...c.extra, zaloFriendSourceTagIds: chance(0.85) ? shuffle([...w.zalo.get(c.account)?.tags.keys() ?? ['1']]).slice(0, ri(1, 3)) : junkTagList() }; ops.push('tags') }
    else if (r < 0.48) { c.extra = { ...c.extra, zaloFriendTargetMode: pick(['tagged_friends', 'all_friends', 'selected']) }; ops.push('mode') }
    else if (r < 0.62) { c.status = pick(['hoàn thành', 'chờ xử lý', 'đang chạy', 'tạm dừng', 'lỗi']); ops.push('status') }
    else if (r < 0.66) { c.deleted = !c.deleted; ops.push('delete') }
    else if (r < 0.72) { const e = { ...c.extra }; if (chance(0.5)) delete e.zaloFriendDataMaterializedAt; else e.zaloFriendDataMaterializedAt = '2026-11-26T01:00:00Z'; c.extra = e; ops.push('mat') }
    else if (r < 0.78) { c.extra = { ...c.extra, zaloFriendTagAutoAddEnabled: pick([true, false, 'true', null]) }; ops.push('flag') }
    else if (r < 0.82) { const a = pick(w.accounts); c.account = a.id; ops.push('account') }
    else if (r < 0.86) { c.extra = pick([null, [], { other: 1 }, { ...c.extra, zaloFriendTagAutoAddEnabled: true, zaloFriendTargetMode: 'tagged_friends', zaloFriendSourceTagIds: [] }]); ops.push('extra') }
    else if (r < 0.90) { // khách tự thêm / xoá một dòng data
      const z = w.zalo.get(c.account)
      const all = z ? [...z.tags.values()].flatMap(t => [...t.members]).filter(isPerson) : []
      if (chance(0.6) && all.length) { const uid = pick(all); c.inputs.push({ uid, deleted: false, key: null, name: 'tay' }); await db.query('INSERT INTO auto_campaign_input_data (campaign_id, name, uid, status) VALUES ($1,$2,$3,$4)', [c.id, 'tay', uid, 'chờ xử lý']) }
      else if (c.inputs.length) { const row = pick(c.inputs); if (!row.deleted) { row.deleted = true; if (row.key) { /* dòng tự thêm bị xoá: vẫn còn dấu */ } await db.query('UPDATE auto_campaign_input_data SET is_delete = true WHERE campaign_id = $1 AND uid = $2', [c.id, row.uid]); for (const x of c.inputs) if (x.uid === row.uid) x.deleted = true } }
      return
    } else if (r < 0.95) { c.ended = !c.ended; ops.push('end') }
    else if (r < 0.975) { c.action = c.action === 'zalo_message_friend' ? pick(['zalo_message_phone', 'zalo_message_stranger']) : 'zalo_message_friend'; ops.push('action') }
    else { // xoá hẳn dòng chiến dịch
      await db.query('DELETE FROM auto_campaigns WHERE id = $1', [c.id])
      w.campaigns.splice(w.campaigns.indexOf(c), 1); w.removedCampaigns.push(c)
      m.noteResets(before)
      return
    }
    // Bản ghi khách ở dòng data tự thêm đã xoá: giữ trong c.inputs (deleted) để so dòng còn tồn tại.
    try {
      await db.query(`UPDATE auto_campaigns SET extra_settings = $2, status = $3, is_delete = $4, account_id = $5, schedule_end_date = $6, action_id = $7 WHERE id = $1`,
        [c.id, c.extra === null ? null : JSON.stringify(c.extra), c.status, c.deleted, c.account, c.ended ? '2020-01-01T00:00:00Z' : null, c.action])
    } catch (e) {
      // Trigger quyền production chặn đổi trạng thái của nhân viên hết quyền: trả mô hình về như DB.
      const row = (await db.query('SELECT status, account_id, is_delete, extra_settings, action_id FROM auto_campaigns WHERE id = $1', [c.id])).rows[0]
      c.status = row.status; c.account = row.account_id; c.deleted = row.is_delete; c.extra = row.extra_settings; c.action = row.action_id
      c.ended = c.ended // không đổi
      await db.query('UPDATE auto_campaigns SET schedule_end_date = $2 WHERE id = $1', [c.id, c.ended ? '2020-01-01T00:00:00Z' : null])
    }
  }
  m.noteResets(before)
}

async function report(db, w, m, a, ctx, junk) {
  const z = w.zalo.get(a.id)
  const version = String(z.version)
  const sourcesWrong = chance(0.05)
  const source = sourcesWrong ? pick(['desktop', 'server', 'fly']) : a.source
  const staff = source === 'desktop' ? (chance(0.9) ? a.staff : pick(w.staffs).id) : null
  if (source === 'fly') {
    const st = m.acc.get(a.id)
    const item = { a: String(a.id), v: version, tags: zaloSnapshotPayload(z, junk),
      p: chance(0.9) ? (st ? st.version : null) : pick([null, 'x', String(z.version - 1)]), c: chance(0.85) ? true : pick([false, 'true', null]) }
    await doCall(db, m, source, staff, [item], ctx)
    return
  }
  // Desktop / App Server: nhịp phiên bản (có thể lẫn tài khoản khác, mục sai), rồi danh sách khi được xin.
  const items = [{ a: String(a.id), v: chance(0.03) ? Number(version) : version }]
  if (junk && chance(0.3)) items.push(pick([{ a: 'abc', v: '1' }, { a: '1234567890123456', v: '1' }, { v: '1' }, 'oops', { a: String(pick(w.accounts).id), v: '1' }, { a: '0' + a.id, v: version }]))
  const r = await doCall(db, m, source, staff, items, ctx)
  if (r && r.response && Array.isArray(r.response.needTags) && r.response.needTags.includes(String(a.id))) {
    await doCall(db, m, source, staff, [{ a: String(a.id), v: version, tags: zaloSnapshotPayload(z, junk) }], ctx)
  }
}

async function doCall(db, m, source, staff, items, ctx) {
  const want = m.sync(source, staff, items)
  const got = await callSync(db, source, staff, items)
  checks++
  if (want.error || got.error) {
    if (want.error) hit(`error:${want.error}`)
    if (!want.error || !got.error || !String(got.error).includes(want.error)) fail(ctx, `lỗi khác mô hình (${source})`, { got: got.error ?? got.response, want: want.error ?? want.response, items: JSON.stringify(items).slice(0, 300) })
    return got
  }
  expectEq(ctx, `câu trả lời (${source})`, got.response, want.response)
  return got
}

async function scenario(db, idx) {
  const w = buildWorld(idx)
  const m = new Model(w)
  await loadWorld(db, w)
  const ctx0 = `s${SEED}.${idx}`
  for (let step = 0; step < STEPS; step++) {
    const ctx = `${ctx0}#${step}`
    const r = rnd()
    if (r < 0.35) { mutateZalo(w) }
    else if (r < 0.75) { const a = pick(w.accounts); await report(db, w, m, a, ctx, chance(0.25)) }
    else if (r < 0.87) { await mutateCampaign(db, w, m, ctx) }
    else if (r < 0.93) { // tua thời gian (phút tròn)
      const mins = pick([1, 1, 2, 5, 10, 29, 31, 60, 120])
      await db.query(`UPDATE auto_zalo_tag_sync_accounts SET last_seen_at = last_seen_at - make_interval(mins => $1), baseline_at = baseline_at - make_interval(mins => $1), last_snapshot_at = last_snapshot_at - make_interval(mins => $1)`, [mins])
      await db.query(`UPDATE auto_zalo_tag_sync_resets SET reset_at = reset_at - make_interval(mins => $1)`, [mins])
      m.advance(mins)
    } else if (r < 0.95) { // cài đặt
      const s = w.settings
      if (chance(0.5)) s.enabled = !s.enabled
      else s.orgIds = pick(['all', 'ALL', String(w.accounts[0].org), `${w.accounts[0].org}, 999`, '999', ''])
      await setSettings(db, s)
    } else if (r < 0.97) { // tài khoản đổi
      const a = pick(w.accounts); const before = m.snapshotAll()
      const k = pick(['deleted', 'web', 'server', 'staff'])
      if (k === 'staff') { const s = pick(w.staffs); a.staff = s.id; a.org = s.org } else a[k] = !a[k]
      if (k === 'server') a.source = a.server ? (chance(0.5) ? 'fly' : 'server') : 'desktop'
      await db.query('UPDATE auto_accounts SET is_delete=$2, is_zalo_show_web=$3, is_zalo_server=$4, staff_id=$5, organization_id=$6 WHERE id=$1', [a.id, a.deleted, a.web, a.server, a.staff, a.org])
      m.noteResets(before)
    } else { // lô lớn / sai: nhiều tài khoản một lần, mục rác, quá 200, hai danh sách
      const k = rnd()
      const items = k < 0.15 ? Array.from({ length: 201 }, (_, i) => ({ a: String(i + 1), v: '1' }))
        : k < 0.3 ? [{ a: String(w.accounts[0].id), v: '1', tags: [] }, { a: String(w.accounts[0].id), v: '1', tags: [] }]
          : k < 0.4 ? pick([{ a: '1' }, 'x', null])
            : w.accounts.map(a => ({ a: String(a.id), v: String(w.zalo.get(a.id).version) }))
      const source = pick(['server', 'fly', 'desktop'])
      await doCall(db, m, source, source === 'desktop' ? pick(w.staffs).id : null, items, `${ctx}:batch`)
    }
    if (step % 15 === 14) await compareState(db, w, m, ctx)
  }
  await compareState(db, w, m, `${ctx0}:end`)
  return { accounts: w.accounts.length, campaigns: w.campaigns.length, rows: w.campaigns.reduce((n, c) => n + c.adds.size, 0) }
}

// ---------- chạy đồng thời + đo thời gian (tag thật cỡ lớn) ----------
async function stress(conn) {
  const db = await conn()
  const w = buildWorld(0)
  const big = POOL.length ? [...POOL].sort((x, y) => y.tags.reduce((n, t) => n + t.m.length, 0) - x.tags.reduce((n, t) => n + t.m.length, 0))[0] : null
  const staff = { id: 1, org: 1 }
  w.staffs = [staff]
  const tags = new Map()
  if (big) for (const t of big.tags) tags.set(String(t.id), { name: 'T', members: new Set(t.m) })
  else for (let t = 1; t <= 15; t++) tags.set(String(t), { name: 'T', members: new Set(Array.from({ length: 1500 }, randomUid)) })
  // Đẩy lên cỡ tag đầy của Zalo (~5.800 hội thoại một tài khoản) bằng cách nhân bản người.
  let total = [...tags.values()].reduce((n, t) => n + t.members.size, 0)
  for (const t of tags.values()) while (total < 6000 && t.members.size < 3000) { t.members.add(randomUid()); total++ }
  w.accounts = [{ id: 9001, staff: 1, org: 1, platform: 'zalo', server: true, web: false, deleted: false, name: 'zl Big', source: 'server' }]
  w.zalo = new Map([[9001, { tags, version: 1 }]])
  w.users = new Map(); w.deniedSet = new Set()
  w.campaigns = [...tags.keys()].slice(0, 6).map((tid, i) => ({ id: 9100 + i, name: 'C', action: 'zalo_message_friend', account: 9001, staff: 1, org: 1,
    status: 'hoàn thành', deleted: false, ended: false, extra: { zaloFriendTargetMode: 'tagged_friends', zaloFriendSourceTagIds: [tid, [...tags.keys()][(i + 1) % tags.size]],
      zaloFriendTagAutoAddEnabled: true, zaloFriendDataMaterializedAt: 'x' }, adds: new Set(), inputs: [], logs: 0 }))
  await loadWorld(db, w)
  const payload = () => [...tags].map(([id, t]) => ({ id, name: t.name, m: [...t.members] }))
  const t0 = Date.now()
  let r = await db.query(`SELECT aka_agent_sync_zalo_tags('server', $1::jsonb) r`, [JSON.stringify([{ a: '9001', v: '1', tags: payload() }])])
  const tBase = Date.now() - t0
  const pairs = [...tags.values()].reduce((n, t) => n + t.members.size, 0)
  // 6 người mới / lượt, 2 tiến trình cùng báo một tài khoản + 1 tiến trình sửa chiến dịch + 1 tiến trình giữ khoá như bộ chạy.
  const clients = await Promise.all([conn(), conn(), conn(), conn()])
  let version = 1; const errors = []; const times = []
  const reporter = async (c) => {
    for (let i = 0; i < 40; i++) {
      for (const t of tags.values()) if (chance(0.4)) t.members.add(randomUid())
      const v = String(++version)
      const tt = Date.now()
      try { await c.query(`SELECT aka_agent_sync_zalo_tags($1, $2::jsonb) r`, [pick(['server', 'fly']), JSON.stringify([{ a: '9001', v, p: String(version - 1), c: true, tags: payload() }])]) }
      catch (e) { errors.push(e.code + ' ' + e.message) }
      times.push(Date.now() - tt)
    }
  }
  const editor = async (c) => {
    for (let i = 0; i < 80; i++) {
      const id = 9100 + ri(0, 5)
      try {
        if (chance(0.5)) await c.query(`SELECT aka_agent_control_set_campaign_zalo_tag_auto_add(1, 1, $1, $2)`, [id, chance(0.7)])
        else await c.query(`UPDATE auto_campaigns SET extra_settings = extra_settings || '{"zaloFriendDataMaterializedAt":"y"}', status = $2 WHERE id = $1`, [id, pick(['hoàn thành', 'đang chạy', 'chờ xử lý'])])
      } catch (e) { errors.push(e.code + ' ' + e.message) }
    }
  }
  const engine = async (c) => {
    for (let i = 0; i < 80; i++) {
      const id = 9100 + ri(0, 5)
      try {
        await c.query('BEGIN')
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || $1::text, 0))`, [id])
        await c.query('SELECT 1 FROM auto_campaigns WHERE id = $1 FOR UPDATE', [id])
        await c.query(`UPDATE auto_campaign_input_data SET status = 'hoàn thành' WHERE campaign_id = $1 AND status = 'chờ xử lý'`, [id])
        await c.query('COMMIT')
      } catch (e) { await c.query('ROLLBACK').catch(() => {}); errors.push(e.code + ' ' + e.message) }
    }
  }
  await Promise.all([reporter(clients[0]), reporter(clients[1]), editor(clients[2]), engine(clients[3])])
  const dup = (await db.query(`SELECT count(*)::int n FROM (SELECT campaign_id, uid FROM auto_campaign_input_data WHERE control_append_idempotency_key LIKE 'zalotag:%' GROUP BY 1, 2 HAVING count(*) > 1) x`)).rows[0].n
  const orphan = (await db.query(`SELECT count(*)::int n FROM auto_campaign_zalo_tag_adds a WHERE NOT EXISTS (SELECT 1 FROM auto_campaign_input_data d WHERE d.id = a.input_data_id)`)).rows[0].n
  const rows = (await db.query(`SELECT count(*)::int n FROM auto_campaign_input_data WHERE control_append_idempotency_key LIKE 'zalotag:%'`)).rows[0].n
  checks += 3
  const bad = errors.filter(e => !/^55P03/.test(e))
  if (bad.length) fail('stress', 'lỗi khi chạy đồng thời', bad.slice(0, 5))
  if (dup) fail('stress', 'T1 trùng khi chạy đồng thời', dup)
  if (orphan) fail('stress', 'dấu đã thêm không có dòng data', orphan)
  times.sort((a, b) => a - b)
  console.log(`đồng thời: ${pairs} cặp (tag, người) / lần báo, lấy mốc ${tBase} ms, so ${times.length} lần: trung vị ${times[times.length >> 1]} ms, chậm nhất ${times[times.length - 1]} ms, ${rows} dòng thêm, ${errors.length} lần chờ khoá quá hạn`)
  for (const c of clients) await c.end()
  await db.end()
}

;(async () => {
  startCluster()
  const admin = new Client({ host: TMP, port: PORT, user: 'postgres', database: 'postgres' }); await admin.connect()
  await admin.query('CREATE DATABASE t'); await admin.end()
  const db = new Client({ host: TMP, port: PORT, user: 'postgres', database: 't' }); await db.connect()
  await db.query(fs.readFileSync(path.join(__dirname, 'v660-fixture.sql'), 'utf8'))
  await db.query(fs.readFileSync(path.join(__dirname, 'fuzz-fixture.sql'), 'utf8'))
  await db.query(fs.readFileSync(MIGRATION, 'utf8'))
  let rows = 0; const started = Date.now()
  for (let i = 0; i < SCENARIOS; i++) { const r = await scenario(db, i); rows += r.rows }
  await db.end()
  if (!argv.includes('--no-stress')) await stress(async () => { const c = new Client({ host: TMP, port: PORT, user: 'postgres', database: 't' }); await c.connect(); return c })
  stopCluster()
  const need = ['baseline:first', 'baseline:reset', 'baseline:fly_discontinuous', 'baseline:stale', 'diff:desktop', 'diff:server', 'diff:fly', 'skip:denied', 'skip:cross_staff', 'skip:already_in_campaign', 'skip:added_before', 'skip:group', 'skip:not_materialized', 'skip:ended', 'skip:status', 'reopen', 'add_paused', 'rejected', 'error:zalo_tag_sync_too_many_items', 'error:zalo_tag_sync_one_snapshot_per_call', 'error:zalo_tag_sync_items_invalid']
  const missing = need.filter(k => !cover[k])
  console.log('độ phủ:', JSON.stringify(cover))
  if (missing.length) { console.log('CHƯA PHỦ:', missing.join(', ')); if (!arg('allow-gaps')) failures.push({ ctx: 'coverage', msg: missing.join(',') }) }
  console.log(`seed ${SEED}: ${SCENARIOS} kịch bản × ${STEPS} bước, ${checks} lần so, ${rows} dòng tự thêm, ${failures.length} sai lệch, ${((Date.now() - started) / 1000).toFixed(1)} s`)
  if (arg('dump')) fs.writeFileSync(arg('dump'), JSON.stringify(failures, null, 1))
  process.exit(failures.length ? 1 : 0)
})().catch(e => { console.error(e); stopCluster(); process.exit(2) })
