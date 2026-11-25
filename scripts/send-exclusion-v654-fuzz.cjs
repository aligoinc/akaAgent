#!/usr/bin/env node
// Kiểm thử ngẫu nhiên V654 (loại trừ gửi theo nhiều Zalo, Nhóm data, chiến dịch đã gửi) trên PostgreSQL cục bộ.
// Chạy: PG_MODULE_DIR=<thư mục có node_modules/pg> node scripts/send-exclusion-v654-fuzz.cjs --seed 1 [--real <file xuất>] [--cases 400]
//
// Phần 1 (--real): cấu hình thật xuất ẩn danh từ production (nhóm, điều kiện, lựa chọn của chiến dịch, Zalo, tag, danh sách).
//   Nạp vào DB ở trạng thái trước V654, ghi lại mọi kết quả của hàm cũ, apply V654, so lại: phải giống hệt; bộ chạy mới
//   (clientVersion 2) thấy cùng điều kiện, không có phần tra DB; trang v2 thấy mỗi nhóm đúng một khối.
// Phần 2: thế giới sinh ngẫu nhiên (nhiều nhân viên / tổ chức, Zalo đã xoá, khách có mặt ở nhiều Zalo với Zalo ID chung,
//   SĐT nhiều cách viết, Nhóm data đủ loại / chia sẻ / đã xoá, danh sách Zalo ID, chiến dịch đã gửi với đủ trạng thái kết quả)
//   và dữ liệu cố tình sai (id lạ, kiểu sai, quá giới hạn, của người khác, trùng). Mỗi ca so với bộ dự đoán viết độc lập
//   trong tệp này (không đọc code hàm DB): lưu nhóm, kiểm cấu hình chiến dịch, snapshot cũ / mới, 'remote' (lý do khớp và dữ
//   kiện khối Zalo khác), và quyết định cuối của bộ chạy (evaluateSendExclusionWithRemote thật, dịch bằng esbuild).
// Lỗi không mang mã send_exclusion_* (lỗi ép kiểu, lỗi Postgres) luôn tính là vấn đề.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { buildDb, ROOT } = require('./send-exclusion-v654-fixture.cjs')

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : acc), []))
const SEED = Number(args.seed || 1)
const CASES = Number(args.cases || 400)
const TOKEN = '11111111-1111-1111-1111-111111111111'
const DBG = {}

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const rnd = mulberry32(SEED)
const chance = p => rnd() < p
const pick = arr => arr[Math.floor(rnd() * arr.length)]
const sample = (arr, n) => { const a = [...arr]; const out = []; while (a.length && out.length < n) out.push(a.splice(Math.floor(rnd() * a.length), 1)[0]); return out }
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))

const problems = []
let checks = 0
function problem(kind, detail) { problems.push({ kind, ...detail }); if (problems.length <= 25) console.log(`  ✗ ${kind}: ${JSON.stringify(detail).slice(0, 600)}`) }
function canon(v) { return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x) }
const errCode = e => { const m = String(e?.message || e).match(/send_exclusion_[a-z_]+/); return m ? m[0] : null }

async function main() {
  const { db, q, one, stop, applyV654 } = await buildDb()
  const call = async (sql, params = []) => {
    await db.query('BEGIN')
    try { const r = await db.query(sql, params); await db.query('ROLLBACK'); return { ok: true, value: r.rows[0] ? Object.values(r.rows[0])[0] : null } } catch (e) { await db.query('ROLLBACK'); return { ok: false, code: errCode(e), message: e.message } }
  }
  const ids = Object.fromEntries((await q('SELECT code,id FROM auto_filter_fields')).map(r => [r.code, Number(r.id)]))
  const op = Object.fromEntries((await q('SELECT code,id FROM auto_filter_operators')).map(r => [r.code, Number(r.id)]))
  try {
    await db.query(`INSERT INTO category_type(id,namespace,code) VALUES(1,'common','zalo_friend_status'),(2,'common','data_type');
      INSERT INTO category_item(id,category_type_id,code,name,is_active) VALUES(1,1,'friend','Bạn bè',true),(2,1,'request_sent','Gửi lời mời kết bạn',true),
        (3,1,'request_received','Nhận kết bạn',true),(4,1,'stranger','Người lạ',true),(50,2,'phone','Số điện thoại',true),(51,2,'zalo_person','Zalo User theo UID',true),(52,2,'facebook_uid','FB',true);`)
    let real = null
    if (args.real) real = await loadReal(JSON.parse(fs.readFileSync(args.real, 'utf8')))
    await applyV654()
    if (args.v655) { await db.query(fs.readFileSync(path.join(ROOT, 'migrations/migration_v655_send_exclusion_input_guards.sql'), 'utf8')); await db.query(`SET request.jwt.claims='{"role":"service_role"}'`); console.log('Đã apply V655') }
    if (args.plant) {
      // Kiểm chính bộ kiểm: cài lỗi giả vào hàm remote, bộ kiểm phải bắt được.
      const def = (await one(`SELECT pg_get_functiondef('private.aka_agent_send_exclusion_remote(public.auto_campaigns,bigint,bigint,jsonb)'::regprocedure) d`)).d
      const planted = args.plant === 'status' ? def.replace("'đã xem','đã click'", "'đã click'")
        : args.plant === 'member' ? def.replace("m.group_id=ANY(v_dg_phone) AND NOT m.is_delete", "m.group_id=ANY(v_dg_phone)")
        : def.replace("WHERE zu.account_id=bl.account_id AND zu.global_id=v_gid ORDER BY zu.id", "WHERE zu.account_id=bl.account_id AND zu.global_id=v_gid ORDER BY zu.id DESC")
      if (planted === def) throw new Error('không cài được lỗi giả')
      await db.query(planted)
      console.log(`Đã cài lỗi giả: ${args.plant}`)
    }
    if (real) await verifyReal(real)
    await fuzzWorld()
  } finally { await stop() }
  console.log(`\nHạt giống ${SEED}: ${checks} phép kiểm, ${problems.length} vấn đề`)
  const kinds = {}
  for (const p of problems) kinds[p.kind] = (kinds[p.kind] || 0) + 1
  if (problems.length) console.log(JSON.stringify(kinds, null, 1))
  if (args.dump && problems.length) fs.writeFileSync(args.dump, JSON.stringify(problems, null, 1))
  process.exit(problems.length ? 1 : 0)

  // ======================================================================================== Phần 1: dữ liệu thật
  async function loadReal(x) {
    console.log(`Dữ liệu thật: ${x.groups.length} nhóm, ${x.rules.length} điều kiện, ${x.selections.length} chiến dịch`)
    const orgs = new Set(), staff = new Map()
    for (const r of [...x.groups, ...x.accounts, ...x.selections, ...x.blocklists, ...(x.akabiz_tags || [])]) { if (r.organization_id) orgs.add(r.organization_id); if (r.staff_id) staff.set(r.staff_id, r.organization_id) }
    await db.query(`SET session_replication_role = replica`)
    for (const o of orgs) await db.query('INSERT INTO org_organization VALUES($1) ON CONFLICT DO NOTHING', [o])
    for (const [s, o] of staff) await db.query(`INSERT INTO org_staff(id,organization_id,name,username,password,is_active) VALUES($1,$2,$3,$4,'p',true)`, [s, o, 'S' + s, 'u' + s])
    for (const a of x.accounts) await db.query(`INSERT INTO auto_accounts(id,name,staff_id,organization_id,flatform_type,is_delete) VALUES($1,$2,$3,$4,$5,$6)`, [a.id, 'A' + a.id, a.staff_id, a.organization_id, a.flatform_type, a.is_delete])
    let cid = 1_000_000
    for (const t of x.zalo_tags || []) await db.query(`INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,uid,name,is_delete,extra_data) VALUES($1,$2,$3,$4,'zalo_tag',$5,'T',$6,'{"conversations":[]}')`, [cid++, t.account_id, t.staff_id, t.organization_id, t.uid, t.is_delete])
    for (const t of x.akabiz_tags || []) await db.query(`INSERT INTO auto_contact_tags(id,name,is_delete,staff_id,organization_id,auto_account_id) VALUES($1,'K',$2,$3,$4,$5)`, [t.id, t.is_delete, t.staff_id, t.organization_id, t.auto_account_id])
    let mid = 1_000_000
    for (const b of x.blocklists) {
      await db.query(`INSERT INTO auto_account_contact_groups(id,account_id,staff_id,organization_id,name,purpose,contact_type,is_delete) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [b.id, b.account_id, b.staff_id, b.organization_id, 'BL' + b.id, b.purpose, b.contact_type, b.is_delete])
      for (let k = 0; k < Math.min(Number(b.members), 3); k++) {
        await db.query(`INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,uid,name,is_delete) VALUES($1,$2,$3,$4,'person',$5,'P',false)`, [cid, b.account_id, b.staff_id, b.organization_id, `b${b.id}_${k}`])
        await db.query(`INSERT INTO auto_account_contact_group_members(id,group_id,contact_id,is_delete) VALUES($1,$2,$3,false)`, [mid++, b.id, cid++])
      }
    }
    for (const g of x.groups) await db.query(`INSERT INTO auto_campaign_send_exclusion_groups(id,staff_id,organization_id,account_id,name,match_mode,revision,is_delete,create_request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,gen_random_uuid())`,
      [g.id, g.staff_id, g.organization_id, g.account_id, 'G' + g.id, g.match_mode, g.revision, g.is_delete])
    for (const r of x.rules) await db.query(`INSERT INTO auto_campaign_send_exclusion_rules(group_id,field_id,operator_id,value,is_enabled,sort_order) VALUES($1,$2,$3,$4,$5,$6)`,
      [r.group_id, ids[r.field], op[r.op], JSON.stringify(r.value), r.is_enabled, r.sort_order])
    for (const c of x.selections) await db.query(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,runtime_claim_token,is_delete) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.campaign_id, 'C' + c.campaign_id, c.action_id, c.account_id, c.staff_id, c.organization_id, c.status, JSON.stringify({ zaloSendExclusionsByAccountId: c.sel }), TOKEN, c.is_delete])
    await db.query(`SET session_replication_role = origin`)
    await db.query(`SELECT setval(pg_get_serial_sequence('auto_campaign_send_exclusion_groups','id'), 10000000)`)
    const before = await observeReal(x)
    return { x, before }
  }
  async function observeReal(x) {
    const out = { groups: {}, lists: {}, validate: {}, snapshot: {} }
    for (const g of x.groups) out.groups[g.id] = await call('SELECT aka_agent_internal_send_exclusion_group($1)', [g.id])
    for (const a of x.accounts) out.lists[a.id] = await call(`SELECT aka_agent_send_exclusion_groups($1,$2,$3,'list','{}',NULL,NULL)`, [a.staff_id, a.organization_id, a.id])
    for (const c of x.selections) {
      out.validate[c.campaign_id] = await call('SELECT aka_agent_internal_validate_send_exclusion_selection($1,$2,$3,$4)::text', [JSON.stringify(c.sel), c.staff_id, c.organization_id, c.account_id])
      out.snapshot[c.campaign_id] = await call(`SELECT aka_agent_campaign_send_exclusion_runtime($1,$2,$3,$4,'snapshot','{}')`, [c.campaign_id, c.account_id, c.staff_id, TOKEN])
    }
    return out
  }
  async function verifyReal({ x, before }) {
    const after = await observeReal(x)
    for (const part of Object.keys(before)) for (const key of Object.keys(before[part])) {
      checks++
      const b = before[part][key], a = after[part][key]
      const strip = r => r.ok ? { ok: true, value: r.value } : { ok: false, code: r.code || r.message }
      if (canon(strip(b)) !== canon(strip(a))) problem('real_parity', { part, key, before: strip(b), after: strip(a) })
    }
    for (const c of x.selections) {
      if (!before.snapshot[c.campaign_id].ok) continue
      checks++
      const v2 = await call(`SELECT aka_agent_campaign_send_exclusion_runtime($1,$2,$3,$4,'snapshot','{"clientVersion":2}')`, [c.campaign_id, c.account_id, c.staff_id, TOKEN])
      const old = before.snapshot[c.campaign_id].value
      if (!v2.ok || v2.value.remote !== null || canon(v2.value.group?.rules ?? null) !== canon(old.group?.rules ?? null) || (v2.value.group?.matchMode ?? null) !== (old.group?.matchMode ?? null)
        || canon([...v2.value.blocklistUids].sort()) !== canon([...old.blocklistUids].sort()))
        problem('real_v2_snapshot', { campaign: c.campaign_id, v2: v2.ok ? { group: v2.value.group, remote: v2.value.remote } : v2.message, old: old.group })
    }
    const staffOrg = new Map(x.groups.map(g => [g.staff_id, g.organization_id]))
    for (const [s, o] of staffOrg) {
      checks++
      const page = await call(`SELECT aka_agent_send_exclusion_v2($1,$2,'page','{}',NULL,NULL)`, [s, o])
      if (!page.ok) { problem('real_v2_page', { staff: s, error: page.message }); continue }
      for (const g of x.groups.filter(gg => gg.staff_id === s && !gg.is_delete)) {
        checks++
        const pg = page.value.groups.find(z => Number(z.id) === g.id)
        const oldRead = before.groups[g.id].value
        if (!pg) { problem('real_v2_page_missing', { staff: s, group: g.id }); continue }
        if (pg.blocks.length !== 1 || Number(pg.blocks[0].accountId) !== g.account_id || pg.blocks[0].matchMode !== g.match_mode || canon(pg.blocks[0].rules) !== canon(oldRead.rules))
          problem('real_v2_page_block', { group: g.id, blocks: pg.blocks })
      }
    }
    console.log(`  Dữ liệu thật: ${checks} phép kiểm xong`)
  }

  // ======================================================================================== Phần 2: thế giới sinh ngẫu nhiên
  async function fuzzWorld() {
    const base = 5_000_000 + SEED * 10_000
    let seq = base
    const nid = () => ++seq
    const W = { orgs: [base + 1, base + 2], staff: [], accounts: [], persons: [], zu: [], contacts: [], tags: [], dataGroups: [], members: [], recipients: [], blocklists: [], campaigns: [], inputs: [], details: [], engagement: [] }
    const [O1, O2] = W.orgs
    W.staff = [{ id: nid(), org: O1 }, { id: nid(), org: O1 }, { id: nid(), org: O2 }]
    const S1 = W.staff[0]
    for (const s of W.staff) {
      const n = s === S1 ? int(3, 6) : int(1, 3)
      for (let i = 0; i < n; i++) W.accounts.push({ id: nid(), staff: s.id, org: s.org, deleted: i > 0 && chance(0.15), platform: i > 1 && chance(0.1) ? 'facebook' : 'zalo', zaloUid: 'acc' + seq })
    }
    const zaloAccounts = W.accounts.filter(a => a.platform === 'zalo')
    const phoneVariants = d => [`0${d}`, `+84${d}`, `84${d}`, `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`, `0${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`, ` 0${d} `]
    const nPersons = int(25, 60)
    for (let i = 0; i < nPersons; i++) {
      const digits = String(int(30, 99)) + String(int(1000000, 9999999))
      W.persons.push({ i, gid: chance(0.9) ? `g${SEED}_${i}` : null, digits, phones: phoneVariants(digits) })
    }
    for (const a of zaloAccounts) {
      const synced = chance(0.85)
      a.synced = synced
      if (!synced) continue
      for (const p of W.persons) {
        if (!chance(0.45)) continue
        const uid = `u${a.id}_${p.i}`
        const gidValue = p.gid === null ? (chance(0.5) ? null : '') : (chance(0.04) ? '' : p.gid)
        W.zu.push({ id: nid(), account: a.id, uid, gid: gidValue, isFr: chance(0.3) ? 1 : 0, person: p.i })
        if (chance(0.04) && p.gid) W.zu.push({ id: nid(), account: a.id, uid: uid + 'dup', gid: p.gid, isFr: 0, person: p.i })
        if (chance(0.6)) W.contacts.push({ id: nid(), account: a.id, staff: a.staff, org: a.org, type: 'person', uid, isFriend: chance(0.3), deleted: chance(0.08), person: p.i })
      }
      for (let k = 0; k < 2; k++) {
        const conv = W.zu.filter(z => z.account === a.id && chance(0.3)).map(z => z.uid)
        W.tags.push({ id: nid(), account: a.id, staff: a.staff, org: a.org, uid: `T${a.id}_${k}`, conv, deleted: chance(0.1) })
      }
    }
    // Liên hệ SĐT (hàm nạp lưu uid = SĐT chuẩn hoá); account_id NULL hoặc của một Zalo.
    const norm = {}
    for (const p of W.persons) for (const v of p.phones) norm[v] = (await one('SELECT aka_agent_internal_normalize_phone($1) n, normalize_phone($1) m', [v]))
    for (const p of W.persons) {
      checks++
      const ns = new Set(p.phones.map(v => norm[v].n)), ms = new Set(p.phones.map(v => norm[v].m))
      if (ns.size !== 1 || ms.size !== 1 || [...ns][0] == null) problem('phone_normalize', { phones: p.phones, n: [...ns], m: [...ms] })
    }
    for (const p of W.persons) if (chance(0.7)) {
      const owner = chance(0.7) ? pick(W.staff.slice(0, 2)) : pick(W.staff)
      const acc = chance(0.5) ? pick(zaloAccounts.filter(a => a.staff === owner.id) || []) : null
      W.contacts.push({ id: nid(), account: acc?.id ?? null, staff: owner.id, org: owner.org, type: 'phone', uid: norm[p.phones[0]].n, phone: p.phones[0], person: p.i, deleted: false })
    }
    const types = { phone: 50, zalo_person: 51, facebook_uid: 52 }
    const nGroups = int(4, 8) + 4
    for (let g = 0; g < nGroups; g++) {
      const core = g < 4 // 4 nhóm đầu luôn dùng được cho S1: 2 SĐT, 2 UID, có thành viên.
      const owner = core ? (g % 2 ? S1 : W.staff[1]) : chance(0.75) ? pick(W.staff.filter(s => s.org === O1)) : pick(W.staff)
      const type = core ? (g < 2 ? 'phone' : 'zalo_person') : pick(['phone', 'phone', 'zalo_person', 'zalo_person', 'facebook_uid'])
      const grp = { id: nid(), staff: owner.id, org: owner.org, type, scope: core ? (owner === S1 ? 'private' : 'organization') : pick(['private', 'private', 'organization', 'selected']), deleted: core ? false : chance(0.15), name: `DG${g}`,
        account: chance(0.2) ? pick(zaloAccounts.filter(a => a.staff === owner.id))?.id ?? null : null }
      W.dataGroups.push(grp)
      if (grp.scope === 'selected') for (const s of W.staff) if (chance(0.5)) W.recipients.push({ group: grp.id, staff: s.id })
      const pool = W.contacts.filter(c => (type === 'phone' ? c.type === 'phone' : c.type === 'person'))
      for (const c of sample(pool, core ? int(6, 15) : int(0, 12))) W.members.push({ id: nid(), group: grp.id, contact: c.id, deleted: chance(core ? 0.35 : 0.12) })
    }
    const s1Alive = zaloAccounts.filter(a => a.staff === S1.id && !a.deleted)
    const coreBl = new Set(sample(s1Alive, 2).map(a => a.id))
    for (const a of zaloAccounts) if (coreBl.has(a.id) || chance(0.6)) {
      const bl = { id: nid(), account: a.id, staff: a.staff, org: a.org, name: `BL${a.id}`, deleted: coreBl.has(a.id) ? false : chance(0.1) }
      W.blocklists.push(bl)
      for (const c of sample(W.contacts.filter(c => c.account === a.id && c.type === 'person'), coreBl.has(a.id) ? int(4, 10) : int(0, 6))) W.members.push({ id: nid(), group: bl.id, contact: c.id, deleted: chance(0.1) })
    }
    const MSG = ['zalo_message_phone', 'zalo_message_friend', 'zalo_message_birthday', 'zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation']
    const STATUSES = ['thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click', 'thất bại', 'lỗi', 'hoàn thành', 'không tồn tại']
    for (let c = 0; c < int(5, 10); c++) {
      const owner = chance(0.8) ? S1 : pick(W.staff)
      const acc = pick(zaloAccounts.filter(a => a.staff === owner.id))
      const camp = { id: nid(), staff: owner.id, org: owner.org, account: acc?.id ?? null, action: chance(0.85) ? pick(MSG) : pick(['facebook_group_post', 'zalo_add_friend']), deleted: chance(0.15), name: `SC${c}` }
      W.campaigns.push(camp)
      for (const p of sample(W.persons, int(0, 15))) {
        const zu = W.zu.find(z => z.account === camp.account && z.person === p.i)
        const byUid = zu && chance(0.6)
        const input = { id: nid(), campaign: camp.id, uid: byUid ? (chance(0.1) ? ` ${zu.uid.toUpperCase()} ` : zu.uid) : null, phone: byUid ? null : pick(p.phones), person: p.i }
        W.inputs.push(input)
        for (let d = 0; d < int(0, 2); d++) W.details.push({ id: nid(), input: input.id, campaign: camp.id, account: camp.account, action: pick(['zalo_message_friend', 'zalo_message_stranger', 'zalo_find_user', 'zalo_add_friend']),
          status: pick(STATUSES), committed: chance(0.2) ? 'committed' : chance(0.1) ? 'unknown' : null, deleted: chance(0.08), at: new Date(Date.now() - int(1, 400) * 86400000).toISOString() })
      }
    }
    for (const z of W.zu) if (chance(0.06)) W.engagement.push({ id: nid(), account: z.account, uid: z.uid, friended: chance(0.3), rejected: chance(0.2), daysAgo: int(0, 90) })
    await persist(W)
    console.log(`Thế giới: ${W.accounts.length} Zalo, ${W.persons.length} khách, ${W.zu.length} người dùng Zalo, ${W.dataGroups.length} Nhóm data, ${W.blocklists.length} danh sách, ${W.campaigns.length} chiến dịch`)
    await fuzzSurface(W)
    const groups = await fuzzSaves(W)
    await fuzzCampaigns(W, groups, norm)
  }

  async function persist(W) {
    for (const o of W.orgs) await db.query('INSERT INTO org_organization VALUES($1)', [o])
    for (const s of W.staff) await db.query(`INSERT INTO org_staff(id,organization_id,name,username,password,is_active) VALUES($1,$2,'S',$3,'p',true)`, [s.id, s.org, 'u' + s.id])
    for (const a of W.accounts) {
      await db.query('INSERT INTO zalo_accounts VALUES($1,$2)', [a.id, a.zaloUid])
      await db.query(`INSERT INTO auto_accounts(id,name,staff_id,organization_id,flatform_type,is_delete,zalo_account_id) VALUES($1,$2,$3,$4,$5,$6,$1)`, [a.id, 'Zalo ' + a.id, a.staff, a.org, a.platform, a.deleted])
    }
    for (const z of W.zu) await db.query('INSERT INTO zalo_users(id,account_id,zalo_uid,global_id,is_fr,updated_at) VALUES($1,$2,$3,$4,$5,now())', [z.id, z.account, z.uid, z.gid, z.isFr])
    for (const c of W.contacts) await db.query(`INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,uid,name,is_delete,is_friend,phone) VALUES($1,$2,$3,$4,$5,$6,'C',$7,$8,$9)`,
      [c.id, c.account, c.staff, c.org, c.type, c.uid, c.deleted, c.isFriend ?? false, c.phone ?? null])
    for (const t of W.tags) await db.query(`INSERT INTO auto_account_contacts(id,account_id,staff_id,organization_id,contact_type,uid,name,is_delete,extra_data) VALUES($1,$2,$3,$4,'zalo_tag',$5,'Tag',$6,$7)`,
      [t.id, t.account, t.staff, t.org, t.uid, t.deleted, JSON.stringify({ conversations: t.conv })])
    const typeId = { phone: 50, zalo_person: 51, facebook_uid: 52 }
    for (const g of W.dataGroups) await db.query(`INSERT INTO auto_account_contact_groups(id,account_id,staff_id,organization_id,name,purpose,contact_type,data_type_category_item_id,sharing_scope,is_delete) VALUES($1,$2,$3,$4,$5,'data_group',$6,$7,$8,$9)`,
      [g.id, g.account, g.staff, g.org, g.name, g.type === 'phone' ? 'phone' : 'person', typeId[g.type], g.scope, g.deleted])
    for (const r of W.recipients) await db.query('INSERT INTO auto_data_group_recipients VALUES($1,$2)', [r.group, r.staff])
    for (const b of W.blocklists) await db.query(`INSERT INTO auto_account_contact_groups(id,account_id,staff_id,organization_id,name,purpose,contact_type,is_delete) VALUES($1,$2,$3,$4,$5,'zalo_friend_blocklist','person',$6)`,
      [b.id, b.account, b.staff, b.org, b.name, b.deleted])
    for (const m of W.members) await db.query('INSERT INTO auto_account_contact_group_members(id,group_id,contact_id,is_delete) VALUES($1,$2,$3,$4)', [m.id, m.group, m.contact, m.deleted])
    for (const c of W.campaigns) await db.query(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,is_delete) VALUES($1,$2,$3,$4,$5,$6,'hoàn thành','{}',$7)`,
      [c.id, c.name, c.action, c.account, c.staff, c.org, c.deleted])
    for (const i of W.inputs) await db.query(`INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,status,is_delete) VALUES($1,$2,$3,$4,'hoàn thành',false)`, [i.id, i.campaign, i.uid, i.phone])
    for (const d of W.details) await db.query(`INSERT INTO auto_campaign_details(id,input_data_id,campaign_id,account_id,action_name,action_code,status,is_delete,created_at,policy_snapshot) VALUES($1,$2,$3,$4,'x',$5,$6,$7,$8,$9)`,
      [d.id, d.input, d.campaign, d.account, d.action, d.status, d.deleted, d.at, d.committed ? JSON.stringify({ operationState: d.committed }) : null])
    for (const e of W.engagement) {
      const a = W.accounts.find(x => x.id === e.account)
      await db.query(`INSERT INTO auto_campaign_detail_zalo_engagement VALUES($1,$2,$3,$4,$5,$6,'friend_request',now()-($7||' days')::interval,now()+interval '1 day',$8,$9)`,
        [e.id, a.org, a.staff, a.id, a.zaloUid, e.uid, e.daysAgo, e.friended ? new Date().toISOString() : null, e.rejected ? new Date().toISOString() : null])
    }
  }

  // ----------------------------------------------------------------------------------- tham số sai ở mọi thao tác: chỉ được trả mã send_exclusion_*
  async function fuzzSurface(W) {
    const S1 = W.staff[0]
    const acc = W.accounts.find(a => a.staff === S1.id && a.platform === 'zalo' && !a.deleted)
    const junk = () => pick([1.5, -1, 0, 'abc', '12', null, true, [], {}, 1e30, '99999999999999999999', 'bb'.repeat(3)])
    const v2 = (opName, payload) => call(`SELECT aka_agent_send_exclusion_v2($1,$2,$3,$4,NULL,NULL)`, [S1.id, S1.org, opName, JSON.stringify(payload)])
    const cases = []
    for (let i = 0; i < 40; i++) {
      cases.push(['options', () => v2('options', { accountId: junk() })])
      cases.push(['lists', () => v2('lists', { kind: pick(['all', 'campaigns', 'dataGroups', 'x', 3]), excludeCampaignId: junk(), dataGroupIds: pick([[junk()], junk()]), sentCampaignIds: pick([[junk()], junk()]), query: pick(['%', '_', '\\', "'; select 1", 'x'.repeat(300), 5]) })])
      cases.push(['save_ids', () => v2('save', { id: junk(), name: 'x', revision: junk(), blocks: [{ accountId: acc.id, matchMode: 'or', rules: [{ fieldId: ids.zalo_friend_status, operatorId: op.equals, value: 'friend', isEnabled: true, sortOrder: 0 }] }] })])
      cases.push(['save_rule', () => v2('save', { requestId: crypto.randomUUID(), name: 'x', revision: 0, blocks: [{ accountId: acc.id, matchMode: 'or', rules: [{ fieldId: pick([ids.zalo_friend_status, junk()]), operatorId: pick([op.equals, junk()]), value: pick(['friend', junk()]), isEnabled: pick([true, junk()]), sortOrder: pick([0, junk()]) }] }] })])
      cases.push(['operation', () => v2(pick(['', 'PAGE', 'delete', 'list']), {})])
      cases.push(['validate', () => call(`SELECT aka_agent_internal_validate_send_exclusion_selection($1,$2,$3,$4)::text`, [JSON.stringify({ [pick([String(acc.id), 'abc', '1.5', ''])]: { groupId: junk(), blocklistIds: pick([[], [junk()], junk()]), dataGroupIds: pick([undefined, [junk()], junk()]) } }), S1.id, S1.org, acc.id])])
    }
    for (const [name, run] of cases) {
      checks++
      const r = await run()
      if (!r.ok && !r.code) problem('surface_raw_error', { name, error: r.message })
    }
  }

  // ----------------------------------------------------------------------------------- lưu nhóm (v2) + dự đoán
  function randomRules(W, accountId, { allowBad }) {
    const rules = []
    if (chance(0.7)) rules.push({ fieldId: ids.zalo_friend_status, operatorId: op[pick(['equals', 'equals', 'not_equals'])], value: pick(['friend', 'stranger', 'request_sent']), isEnabled: chance(0.85), sortOrder: 10 })
    const ownTags = W.tags.filter(t => t.account === accountId && !t.deleted).map(t => t.uid)
    if (chance(0.6) && ownTags.length) rules.push({ fieldId: ids.zalo_tag, operatorId: op[pick(['contains', 'not_contains'])], value: sample(ownTags, int(1, ownTags.length)), isEnabled: chance(0.9), sortOrder: 20 })
    let bad = null
    if (allowBad && chance(0.12)) {
      const other = W.tags.find(t => t.account !== accountId && !t.deleted)
      if (other) { rules.push({ fieldId: ids.zalo_tag, operatorId: op.contains, value: [other.uid], isEnabled: true, sortOrder: 30 }); rules.splice(rules.findIndex(r => r.fieldId === ids.zalo_tag), rules.filter(r => r.fieldId === ids.zalo_tag).length > 1 ? 1 : 0); bad = 'option' }
    }
    if (!rules.length) rules.push({ fieldId: ids.zalo_friend_status, operatorId: op.equals, value: 'friend', isEnabled: true, sortOrder: 10 })
    if (!rules.some(r => r.isEnabled)) rules[0].isEnabled = true
    return { rules, bad }
  }
  async function fuzzSaves(W) {
    const S1 = W.staff[0]
    const usable = W.accounts.filter(a => a.staff === S1.id && a.platform === 'zalo' && !a.deleted)
    const saved = []
    const apiCases = []
    for (let n = 0; n < Math.max(30, CASES / 4); n++) {
      const blockAccounts = sample(usable, int(1, usable.length))
      let expected = null
      const blocks = blockAccounts.map(a => { const { rules, bad } = randomRules(W, a.id, { allowBad: true }); if (bad && !expected) expected = 'send_exclusion_option_unavailable'; return { accountId: a.id, matchMode: pick(['and', 'or']), rules } })
      const payload = { requestId: crypto.randomUUID(), name: `Nhóm ${n}`, revision: 0, blocks }
      // Cố tình sai (thứ tự kiểm như mô tả hợp đồng: tên → khối → Zalo → điều kiện → requestId).
      const mut = chance(0.35) ? pick(['name_empty', 'name_long', 'name_type', 'no_blocks', 'many_blocks', 'dup_account', 'account_other_staff', 'account_deleted', 'account_facebook', 'account_string', 'account_float', 'match_bad',
        'request_missing', 'request_bad_uuid', 'rules_not_array', 'sort_float', 'value_missing', 'field_unknown', 'all_disabled', 'enabled_string', 'field_string']) : null
      let e = null
      const others = W.accounts.filter(a => a.staff !== S1.id && a.platform === 'zalo')
      switch (mut) {
        case 'name_empty': payload.name = '   '; e = 'name_invalid'; break
        case 'name_long': payload.name = 'x'.repeat(201); e = 'name_invalid'; break
        case 'name_type': payload.name = 12; e = 'name_invalid'; break
        case 'no_blocks': payload.blocks = []; e = 'blocks_invalid'; break
        case 'many_blocks': payload.blocks = Array.from({ length: 21 }, (_, i) => ({ accountId: 9_000_000 + i, matchMode: 'and', rules: [] })); e = 'blocks_invalid'; break
        case 'dup_account': payload.blocks = [...blocks, { ...blocks[0] }]; e = 'blocks_invalid'; break
        case 'account_other_staff': if (others.length) { payload.blocks = [...blocks, { accountId: pick(others).id, matchMode: 'or', rules: [] }]; e = 'account_not_found' } break
        case 'account_deleted': { const d = W.accounts.find(a => a.staff === S1.id && a.deleted); if (d) { payload.blocks = [...blocks, { accountId: d.id, matchMode: 'or', rules: [] }]; e = 'account_not_found' } break }
        case 'account_facebook': { const d = W.accounts.find(a => a.staff === S1.id && a.platform !== 'zalo'); if (d) { payload.blocks = [...blocks, { accountId: d.id, matchMode: 'or', rules: [] }]; e = 'account_not_found' } break }
        case 'account_string': payload.blocks = [{ ...blocks[0], accountId: String(blocks[0].accountId) }, ...blocks.slice(1)]; e = 'blocks_invalid'; break
        case 'account_float': payload.blocks = [{ ...blocks[0], accountId: blocks[0].accountId + 0.5 }, ...blocks.slice(1)]; e = 'blocks_invalid'; break
        case 'match_bad': payload.blocks = [{ ...blocks[0], matchMode: 'xor' }, ...blocks.slice(1)]; e = 'blocks_invalid'; break
        case 'request_missing': delete payload.requestId; e = 'request_id_required'; break
        case 'request_bad_uuid': payload.requestId = 'abc'; e = 'request_id_required'; break
        case 'rules_not_array': payload.blocks = [{ ...blocks[0], rules: 'x' }, ...blocks.slice(1)]; e = 'rules_required'; break
        case 'all_disabled': payload.blocks = [{ ...blocks[0], rules: blocks[0].rules.map(r => ({ ...r, isEnabled: false })) }, ...blocks.slice(1)]; e = 'rules_required'; break
        case 'enabled_string': payload.blocks = [{ ...blocks[0], rules: blocks[0].rules.map(r => ({ ...r, isEnabled: 'yes' })) }, ...blocks.slice(1)]; e = 'rules_invalid|rules_required'; break
        case 'field_string': payload.blocks = [{ ...blocks[0], rules: blocks[0].rules.map(r => ({ ...r, fieldId: 'abc' })) }, ...blocks.slice(1)]; e = 'rules_invalid'; break
        case 'sort_float': payload.blocks = [{ ...blocks[0], rules: blocks[0].rules.map(r => ({ ...r, sortOrder: 1.5 })) }, ...blocks.slice(1)]; e = 'rules_invalid'; break
        case 'value_missing': payload.blocks = [{ ...blocks[0], rules: blocks[0].rules.map(({ value, ...r }) => r) }, ...blocks.slice(1)]; e = 'any'; break
        case 'field_unknown': payload.blocks = [{ ...blocks[0], rules: [{ fieldId: 99999, operatorId: op.equals, value: 'x', isEnabled: true, sortOrder: 0 }] }, ...blocks.slice(1)]; e = 'any'; break
      }
      const before = ['name_empty', 'name_long', 'name_type', 'no_blocks', 'many_blocks', 'dup_account', 'account_string', 'match_bad']
      if (expected && !(mut && before.includes(mut))) e = e || 'option_unavailable'
      if (expected && mut && !before.includes(mut) && e !== 'any') e = `${e}|option_unavailable`
      const r = await call(`SELECT aka_agent_send_exclusion_v2($1,$2,'save',$3,NULL,NULL)`, [S1.id, S1.org, JSON.stringify(payload)])
      apiCases.push({ payload, ok: r.ok, code: r.code, mut })
      checks++
      if (!r.ok && !r.code) { problem('save_raw_error', { mut, error: r.message }); continue }
      if (e === null) {
        if (!r.ok) { problem('save_rejected_valid', { error: r.code, blocks: payload.blocks.map(b => b.accountId) }); continue }
        // Lưu thật (ngoài giao dịch huỷ) để dùng cho chiến dịch.
        const g = (await one(`SELECT aka_agent_send_exclusion_v2($1,$2,'save',$3,NULL,NULL) d`, [S1.id, S1.org, JSON.stringify(payload)])).d
        checks++
        const want = payload.blocks.map(b => ({ accountId: b.accountId, matchMode: b.matchMode, rules: b.rules.map(x => ({ fieldId: x.fieldId, operatorId: x.operatorId, value: x.value, isEnabled: x.isEnabled, sortOrder: x.sortOrder })).sort((p, q2) => p.sortOrder - q2.sortOrder) }))
        const got = g.blocks.map(b => ({ accountId: Number(b.accountId), matchMode: b.matchMode, rules: b.rules.map(x => ({ fieldId: Number(x.fieldId), operatorId: Number(x.operatorId), value: x.value, isEnabled: x.isEnabled, sortOrder: x.sortOrder })) }))
        if (canon(want) !== canon(got) || g.version !== (payload.blocks.length > 1 ? 2 : 1) || Number(g.accountId) !== payload.blocks[0].accountId) problem('save_roundtrip', { want, got, version: g.version })
        // Gửi lại cùng requestId: trả đúng nhóm. Cùng requestId khác nội dung: revision_conflict.
        checks++
        const again = await call(`SELECT aka_agent_send_exclusion_v2($1,$2,'save',$3,NULL,NULL)`, [S1.id, S1.org, JSON.stringify(payload)])
        if (!again.ok || Number(again.value.id) !== Number(g.id)) problem('save_retry', { again: again.code || again.message })
        // Form cũ: chỉ thấy nhóm một khối của đúng Zalo, không sửa được nhóm nhiều khối.
        checks++
        const oldList = await call(`SELECT aka_agent_send_exclusion_groups($1,$2,$3,'list','{}',NULL,NULL)`, [S1.id, S1.org, payload.blocks[0].accountId])
        const seen = oldList.ok && oldList.value.groups.some(x => Number(x.id) === Number(g.id))
        if (seen !== (payload.blocks.length === 1)) problem('old_list_visibility', { blocks: payload.blocks.length, seen })
        saved.push(g)
      } else {
        const accepted = e.split('|')
        if (r.ok) { if (e !== 'any') problem('save_accepted_invalid', { mut, expected: e }) } else if (e !== 'any' && !accepted.some(x => r.code === 'send_exclusion_' + x)) problem('save_wrong_error', { mut, expected: e, got: r.code })
      }
    }
    // Sửa nhóm: revision cũ bị từ chối, revision đúng thì đổi khối.
    for (const g of sample(saved, Math.min(5, saved.length))) {
      checks++
      const blocks = g.blocks.map(b => ({ accountId: Number(b.accountId), matchMode: b.matchMode === 'and' ? 'or' : 'and', rules: b.rules }))
      const stale = await call(`SELECT aka_agent_send_exclusion_v2($1,$2,'save',$3,NULL,NULL)`, [S1.id, S1.org, JSON.stringify({ id: Number(g.id), name: g.name, revision: Number(g.revision) - 1, blocks })])
      if (stale.ok || stale.code !== 'send_exclusion_revision_conflict') problem('update_stale', { got: stale.code || 'ok' })
    }
    console.log(`  Lưu nhóm: ${saved.length} nhóm hợp lệ`)
    await compareWebApi(apiCases)
    return saved
  }

  // ----------------------------------------------------------------------------------- chiến dịch, snapshot, remote
  async function fuzzCampaigns(W, saved, norm) {
    const S1 = W.staff[0]
    const accById = new Map(W.accounts.map(a => [a.id, a]))
    const alive = a => a && a.platform === 'zalo' && !a.deleted && a.staff === S1.id && a.org === S1.org
    const senders = W.accounts.filter(alive)
    const msgActions = new Set(['zalo_message_phone', 'zalo_message_friend', 'zalo_message_birthday', 'zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation'])
    const usableDg = g => g.org === S1.org && (g.staff === S1.id || g.scope === 'organization' || (g.scope === 'selected' && W.recipients.some(r => r.group === g.id && r.staff === S1.id)))
    let campCount = 0, remoteCount = 0, decisions = 0
    const coverage = {}
    const evaluator = loadEvaluator()
    for (let n = 0; n < CASES; n++) {
      const A = pick(senders)
      const sel = { groupId: null, blocklistIds: [] }
      let expected = null
      const g = saved.length && chance(0.75) ? pick(saved) : null
      if (g) sel.groupId = Number(g.id)
      const clean = chance(0.75)
      const okBl = W.blocklists.filter(b => !b.deleted && b.staff === S1.id && alive(accById.get(b.account)))
      const okDg = W.dataGroups.filter(d => d.org === S1.org && (d.deleted || (d.type !== 'facebook_uid' && usableDg(d))))
      const okSc = W.campaigns.filter(c => c.staff === S1.id && c.org === S1.org && msgActions.has(c.action))
      sel.blocklistIds = sample(clean ? okBl : W.blocklists, int(0, 3)).map(b => b.id)
      if (chance(0.8)) sel.dataGroupIds = sample(clean ? okDg : W.dataGroups, int(0, 4)).map(x => x.id)
      if (chance(0.8)) sel.sentCampaignIds = sample(clean ? okSc : W.campaigns, int(0, 4)).map(x => x.id)
      // Dự đoán theo thứ tự kiểm: danh sách Zalo ID → mảng → Nhóm data → chiến dịch → chính nó.
      const blOk = sel.blocklistIds.every(id => { const b = W.blocklists.find(x => x.id === id); return b && !b.deleted && b.staff === S1.id && alive(accById.get(b.account)) })
      if (!blOk) expected = 'blocklist_not_found'
      const dgOk = (sel.dataGroupIds || []).every(id => { const d = W.dataGroups.find(x => x.id === id); return d && d.org === S1.org && (d.deleted || (d.type !== 'facebook_uid' && usableDg(d))) })
      if (!expected && !dgOk) expected = 'data_group_not_found'
      const scOk = (sel.sentCampaignIds || []).every(id => { const c = W.campaigns.find(x => x.id === id); return c && c.staff === S1.id && c.org === S1.org && msgActions.has(c.action) })
      if (!expected && !scOk) expected = 'campaign_not_found'
      const mut = chance(0.2) ? pick(['blocklist_string', 'blocklist_negative', 'dg_too_many', 'dg_not_array', 'sc_string', 'group_string', 'self', 'missing_sender', 'group_other_staff', 'group_deleted']) : null
      const campId = 6_000_000 + SEED * 10_000 + n
      let map = { [A.id]: sel }
      switch (mut) {
        case 'blocklist_string': sel.blocklistIds = ['1']; expected = 'blocklists_invalid'; break
        case 'blocklist_negative': sel.blocklistIds = [-3]; expected = 'blocklists_invalid'; break
        case 'dg_too_many': sel.dataGroupIds = Array.from({ length: 21 }, (_, i) => i + 1); if (blOk) expected = 'lists_invalid'; break
        case 'dg_not_array': sel.dataGroupIds = 5; if (blOk) expected = 'lists_invalid'; break
        case 'sc_string': sel.sentCampaignIds = ['7']; if (blOk) expected = 'lists_invalid'; break
        case 'group_string': sel.groupId = 'x'; expected = 'group_reference_invalid'; break
        case 'self': sel.sentCampaignIds = [campId]; if (!expected || expected === 'campaign_not_found') expected = 'campaign_not_found'; break
        case 'missing_sender': map = { [pick(senders.filter(s => s.id !== A.id).concat([{ id: 1 }])).id]: sel }; expected = 'account_configuration_missing'; break
        case 'group_other_staff': { const og = await one(`SELECT id FROM auto_campaign_send_exclusion_groups WHERE staff_id<>$1 AND NOT is_delete LIMIT 1`, [S1.id]); if (og) { sel.groupId = Number(og.id); expected = 'group_not_found' } break }
        case 'group_deleted': if (g) { await db.query('UPDATE auto_campaign_send_exclusion_groups SET is_delete=true WHERE id=$1', [g.id]); expected = 'group_not_found' } break
      }
      const extra = { zaloSendExclusionsByAccountId: map }
      const ins = await call(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,runtime_claim_token,is_delete)
        VALUES($1,'Thử','zalo_message_phone',$2,$3,$4,'chờ xử lý',$5,$6,false) RETURNING id`, [campId, A.id, S1.id, S1.org, JSON.stringify(extra), TOKEN])
      if (mut === 'group_deleted' && g) await db.query('UPDATE auto_campaign_send_exclusion_groups SET is_delete=false WHERE id=$1', [g.id])
      checks++
      if (!ins.ok && !ins.code) { problem('campaign_raw_error', { mut, error: ins.message }); continue }
      if (expected) {
        if (ins.ok) problem('campaign_accepted_invalid', { mut, expected, sel })
        else if (ins.code !== 'send_exclusion_' + expected) problem('campaign_wrong_error', { mut, expected, got: ins.code, sel })
        continue
      }
      if (!ins.ok) { problem('campaign_rejected_valid', { got: ins.code, sel }); continue }
      await db.query(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,extra_settings,runtime_claim_token,is_delete)
        VALUES($1,'Thử','zalo_message_phone',$2,$3,$4,'chờ xử lý',$5,$6,false)`, [campId, A.id, S1.id, S1.org, JSON.stringify(extra), TOKEN])
      campCount++
      // ---- dữ liệu đổi sau khi lưu chiến dịch (xoá danh sách / Nhóm data / chiến dịch đã gửi / Zalo của khối / thành viên); trả lại cuối vòng.
      const reverts = []
      let snapshotError = null
      const post = chance(0.3) ? pick(['dg_delete', 'sc_delete', 'block_account_delete', 'bl_delete', 'member_delete']) : null
      const setFlag = async (table, id, obj, field, col = 'is_delete') => {
        const old = obj[field]; obj[field] = true
        await db.query(`UPDATE ${table} SET ${col}=true WHERE id=$1`, [id])
        reverts.push(async () => { obj[field] = old; await db.query(`UPDATE ${table} SET ${col}=$2 WHERE id=$1`, [id, old]) })
      }
      if (post === 'dg_delete' && sel.dataGroupIds?.length) { const pk = pick(sel.dataGroupIds); const d = W.dataGroups.find(x => x.id === pk); await setFlag('auto_account_contact_groups', d.id, d, 'deleted') }
      if (post === 'sc_delete' && sel.sentCampaignIds?.length) { const pickedSc = pick(sel.sentCampaignIds); const c = W.campaigns.find(x => x.id === pickedSc); await setFlag('auto_campaigns', c.id, c, 'deleted') }
      if (post === 'block_account_delete' && g) { const others = g.blocks.map(b => Number(b.accountId)).filter(id => id !== A.id); if (others.length) { const a = accById.get(pick(others)); await setFlag('auto_accounts', a.id, a, 'deleted')
        // Danh sách Zalo ID của Zalo vừa xoá: lượt chạy dừng như danh sách đã xoá (an toàn: không gửi nhầm khách cần loại trừ).
        if (sel.blocklistIds.some(id => W.blocklists.find(x => x.id === id)?.account === a.id)) snapshotError = 'send_exclusion_blocklist_not_found' } }
      if (post === 'bl_delete' && sel.blocklistIds.length) { const pk = pick(sel.blocklistIds); const b = W.blocklists.find(x => x.id === pk); await setFlag('auto_account_contact_groups', b.id, b, 'deleted'); snapshotError = 'send_exclusion_blocklist_not_found' }
      if (post === 'member_delete' && W.members.length) { const m = pick(W.members); await setFlag('auto_account_contact_group_members', m.id, m, 'deleted') }
      try {
      // ---- snapshot: bản cũ / bản mới
      const group = g ? (await one('SELECT private.aka_agent_send_exclusion_group_v2($1) d', [g.id])).d : null
      const ownBlock = group?.blocks.find(b => Number(b.accountId) === A.id) || null
      const otherBlocks = (group?.blocks || []).filter(b => Number(b.accountId) !== A.id && alive(accById.get(Number(b.accountId))) && b.rules.some(r => r.isEnabled))
      const otherBl = sel.blocklistIds.filter(id => { const b = W.blocklists.find(x => x.id === id); return b.account !== A.id && !b.deleted })
      const liveDg = (sel.dataGroupIds || []).filter(id => { const d = W.dataGroups.find(x => x.id === id); return !d.deleted && d.org === S1.org })
      const liveSc = (sel.sentCampaignIds || []).filter(id => { const c = W.campaigns.find(x => x.id === id); return c.staff === S1.id && c.org === S1.org })
      const needsV2 = (sel.dataGroupIds || []).length > 0 || (sel.sentCampaignIds || []).length > 0 || (group && (group.version > 1 || Number(group.accountId) !== A.id)) ||
        sel.blocklistIds.some(id => W.blocklists.find(x => x.id === id).account !== A.id)
      if (snapshotError) {
        checks++
        const ex = await call(`SELECT aka_agent_campaign_send_exclusion_runtime($1,$2,$3,$4,'snapshot','{"clientVersion":2}')`, [campId, A.id, S1.id, TOKEN])
        if (ex.ok || ex.code !== snapshotError) problem('snapshot_after_delete', { post, want: snapshotError, got: ex.ok ? 'ok' : ex.code })
        continue
      }
      checks++
      const old = await call(`SELECT aka_agent_campaign_send_exclusion_runtime($1,$2,$3,$4,'snapshot','{}')`, [campId, A.id, S1.id, TOKEN])
      if (needsV2 ? (old.ok || old.code !== 'send_exclusion_client_outdated') : !old.ok) problem('snapshot_old', { needsV2, got: old.ok ? 'ok' : old.code, sel, groupVersion: group?.version })
      checks++
      const snap = await call(`SELECT aka_agent_campaign_send_exclusion_runtime($1,$2,$3,$4,'snapshot','{"clientVersion":2}')`, [campId, A.id, S1.id, TOKEN])
      if (!snap.ok) { problem('snapshot_v2_error', { error: snap.message }); continue }
      const s = snap.value
      await db.query(`INSERT INTO auto_engine_leases VALUES ($1,'22222222-2222-2222-2222-222222222222','r','desktop',$2,now(),now(),now()+interval '5 min',now())
        ON CONFLICT (account_id) DO UPDATE SET campaign_id=EXCLUDED.campaign_id`, [A.id, campId])
      const wantRemote = (otherBlocks.length || otherBl.length || liveDg.length || liveSc.length) ? {
        blocks: otherBlocks.map(b => Number(b.accountId)), blocklistIds: [...otherBl].sort((a, b) => a - b), dataGroups: [...liveDg].sort((a, b) => a - b), campaigns: [...liveSc].sort((a, b) => a - b) } : null
      const gotRemote = s.remote ? { blocks: s.remote.blocks.map(b => Number(b.accountId)), blocklistIds: s.remote.blocklistIds.map(Number), dataGroups: s.remote.dataGroups.map(x => Number(x.id)), campaigns: s.remote.campaigns.map(x => Number(x.id)) } : null
      if (canon(wantRemote) !== canon(gotRemote)) problem('snapshot_remote_plan', { want: wantRemote, got: gotRemote })
      if ((ownBlock ? ownBlock.matchMode : null) !== (s.group?.matchMode ?? null) || canon(ownBlock?.rules ?? null) !== canon(s.group?.rules ?? null)) problem('snapshot_own_block', { own: ownBlock, got: s.group })
      const wantUids = new Set()
      for (const id of sel.blocklistIds) for (const m of W.members.filter(x => x.group === id && !x.deleted)) { const c = W.contacts.find(x => x.id === m.contact); if (c && !c.deleted && c.account === A.id && c.type === 'person') wantUids.add(c.uid) }
      if (canon([...wantUids].sort()) !== canon([...s.blocklistUids].sort())) problem('snapshot_blocklist_uids', { want: [...wantUids], got: s.blocklistUids })
      // ---- remote cho từng khách
      // Nửa số khách lấy từ người có trong các danh sách đã chọn (Nhóm data, danh sách Zalo ID, chiến dịch đã gửi) để phủ nhánh khớp.
      const hot = new Set()
      const listIds = new Set([...(sel.dataGroupIds || []), ...sel.blocklistIds])
      for (const m of W.members) if (listIds.has(m.group)) { const c = W.contacts.find(x => x.id === m.contact); if (c?.person !== undefined) hot.add(c.person); else if (c) { const z = W.zu.find(x => x.account === c.account && x.uid === c.uid); if (z) hot.add(z.person) } }
      for (const i of W.inputs) if ((sel.sentCampaignIds || []).includes(i.campaign)) hot.add(i.person)
      const hotPersons = W.persons.filter(p => hot.has(p.i))
      const targets = [...sample(hotPersons, int(1, 4)), ...sample(W.persons, int(1, 3))]
      for (const p of targets) {
        const zuA = W.zu.find(z => z.account === A.id && z.person === p.i && !z.uid.endsWith('dup'))
        const byUid = zuA && chance(0.6)
        const giveGid = chance(0.3)
        const input = { id: nid2(), uid: byUid ? zuA.uid : null, phone: byUid ? (chance(0.2) ? pick(p.phones) : null) : (chance(0.85) ? pick(p.phones) : null) }
        await db.query(`INSERT INTO auto_campaign_input_data(id,campaign_id,uid,phone,status,is_delete) VALUES($1,$2,$3,$4,'chờ xử lý',false)`, [input.id, campId, input.uid, input.phone])
        const payload = { inputId: input.id }
        if (giveGid && p.gid) payload.globalId = p.gid
        checks++
        const r = await call(`SELECT aka_agent_campaign_send_exclusion_runtime($1,$2,$3,$4,'remote',$5)`, [campId, A.id, S1.id, TOKEN, JSON.stringify(payload)])
        remoteCount++
        if (!r.ok) { problem('remote_error', { error: r.message }); continue }
        {
          const runId = nid2()
          await db.query(`INSERT INTO auto_engine_target_runs(id,input_data_id,campaign_id,account_id,staff_id,organization_id,lease_token,started_at) VALUES ($1,$2,$3,$4,$5,$6,'22222222-2222-2222-2222-222222222222',now())`,
            [runId, input.id, campId, A.id, S1.id, S1.org])
          const engPayload = payload.globalId ? { globalId: payload.globalId } : {}
          const es = await call(`SELECT aka_agent_engine_send_exclusion_v1($1,'22222222-2222-2222-2222-222222222222','snapshot','{"clientVersion":2}')`, [runId])
          const er = await call(`SELECT aka_agent_engine_send_exclusion_v1($1,'22222222-2222-2222-2222-222222222222','remote',$2)`, [runId, JSON.stringify(engPayload)])
          checks += 2
          if (!es.ok || !es.value.ok || canon(es.value.snapshot) !== canon(s)) problem('engine_snapshot_parity', { got: es.ok ? es.value : es.message })
          if (!er.ok || !er.value.ok || canon(er.value.remote) !== canon(r.value)) problem('engine_remote_parity', { engine: er.ok ? er.value : er.message, runtime: r.value })
        }
        const want = oracleRemote({ W, A, sel, group, input, payload, norm, accById, alive, usableDg, msgActions, campId })
        const covKey = want.match ? `${want.match.kind}${want.why === 'dg_phone' ? ':phone' : want.why === 'dg_uid' ? ':uid' : ''}` : 'blocks:' + (want.blocks.map(b => b.state).sort().join(',') || 'none')
        coverage[covKey] = (coverage[covKey] || 0) + 1
        const gotMatch = r.value.match ? { kind: r.value.match.kind, id: Number(r.value.match.id) } : null
        if (canon(want.match) !== canon(gotMatch)) problem('remote_match', { want: want.match, got: gotMatch, why: want.why, input, payload, sel: { ...sel, groupId: undefined } })
        if (!want.match) {
          const gotBlocks = r.value.blocks.map(b => ({ accountId: Number(b.accountId), state: b.state, facts: b.facts ?? null }))
          if (canon(want.blocks) !== canon(gotBlocks)) problem('remote_blocks', { want: want.blocks, got: gotBlocks, input, payload })
        }
        // ---- quyết định cuối: bộ chạy thật với snapshot + remote của DB và dữ kiện Zalo của Zalo đang gửi từ thế giới.
        if (evaluator && input.uid) {
          decisions++; checks++
          const own = ownFacts(W, A, zuA)
          const dec = await evaluator.evaluateSendExclusionWithRemote(s, input.uid, async source => own[source] ?? null, async () => r.value)
          const verdicts = []
          if (s.blocklistUids.includes(input.uid.trim())) verdicts.push(true)
          if (want.match) verdicts.push(true)
          for (const b of want.blocks || []) {
            if (b.state === 'unknown') verdicts.push(null)
            else if (b.state === 'ok') verdicts.push(blockTruth(group.blocks.find(x => Number(x.accountId) === b.accountId), b.facts))
          }
          if (s.group) verdicts.push(blockTruth(s.group, own))
          const wantDecision = verdicts.includes(true) ? 'excluded' : verdicts.includes(null) ? 'unknown' : 'allowed'
          if (dec.decision !== wantDecision) problem('decision', { want: wantDecision, got: dec.decision, note: dec.note, blocks: want.blocks })
        }
      }
      } finally { for (const undo of reverts.reverse()) await undo() }
    }
    console.log(`  Chiến dịch hợp lệ: ${campCount}, remote: ${remoteCount}, quyết định: ${decisions}`)
    console.log(`  Phủ: ${JSON.stringify(coverage)} ${JSON.stringify(DBG)}`)
  }

  async function compareWebApi(apiCases) {
    const repo = args.webapp
    if (!repo) return
    const { spawnSync } = require('node:child_process')
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'v654-api-'))
    fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify(apiCases.map(c => c.payload)))
    fs.writeFileSync(path.join(dir, 'run.mts'), `import { validateSaveExclusionV2 } from ${JSON.stringify(path.join(repo, 'apps/api/src/modules/aka-agent-control/campaignSendExclusions.ts'))}
import fs from 'node:fs'
const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
process.stdout.write(JSON.stringify(list.map((p: unknown) => { try { validateSaveExclusionV2(p); return true } catch { return false } })))`)
    const r = spawnSync(path.join(repo, 'node_modules/.bin/tsx'), [path.join(dir, 'run.mts'), path.join(dir, 'cases.json')], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 })
    if (r.status !== 0) { problem('webapi_run', { error: r.stderr.slice(0, 400) }); return }
    const verdicts = JSON.parse(r.stdout)
    apiCases.forEach((c, i) => {
      checks++
      if (verdicts[i] && !c.ok && !c.code) problem('webapi_accepts_db_crash', { mut: c.mut })
      if (!verdicts[i] && c.ok) problem('webapi_rejects_db_valid', { mut: c.mut, payload: c.payload })
    })
    console.log(`  API Web: ${verdicts.filter(Boolean).length}/${verdicts.length} payload được nhận`)
  }

  function nid2() { nid2.n = (nid2.n || 7_000_000 + SEED * 100_000) + 1; return nid2.n }

  // ----------------------------------------------------------------------------------- bộ dự đoán độc lập
  function zuFirst(W, account, gid) {
    if (!gid) return null
    return W.zu.filter(z => z.account === account && z.gid === gid).sort((a, b) => a.id - b.id)[0] || null
  }
  function oracleRemote({ W, A, sel, group, input, payload, norm, accById, alive, usableDg, msgActions, campId }) {
    const S1 = W.staff[0]
    const uid = input.uid
    let gid = payload.globalId || null
    if (!gid && uid) { const z = W.zu.find(x => x.account === A.id && x.uid === uid); gid = z && z.gid ? z.gid : null }
    const phoneRaw = input.phone ? input.phone.trim() || null : null
    const phoneN = phoneRaw ? (norm[input.phone]?.n ?? null) : null
    const phoneM = phoneRaw ? (norm[input.phone]?.m ?? null) : null
    // 1. danh sách Zalo ID của Zalo khác
    DBG.blSel = (DBG.blSel || 0) + (sel.blocklistIds.length ? 1 : 0); DBG.gid = (DBG.gid || 0) + (gid ? 1 : 0)
    if (gid) {
      const hits = []
      for (const id of sel.blocklistIds) {
        const b = W.blocklists.find(x => x.id === id)
        if (!b || b.account === A.id || b.deleted || b.staff !== S1.id) continue
        const z = zuFirst(W, b.account, gid)
        if (!z) continue
        const cs = W.contacts.filter(c => c.account === b.account && c.type === 'person' && c.uid === z.uid && !c.deleted)
        if (cs.some(c => W.members.some(m => m.group === b.id && m.contact === c.id && !m.deleted))) hits.push(b)
      }
      hits.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
      if (hits.length) return { match: { kind: 'blocklist', id: hits[0].id }, why: 'blocklist' }
    }
    // 2. Nhóm data
    const dgs = (sel.dataGroupIds || []).map(id => W.dataGroups.find(x => x.id === id)).filter(d => d && !d.deleted && d.org === S1.org && d.type !== 'facebook_uid')
    const phoneGroups = dgs.filter(d => d.type === 'phone'), uidGroups = dgs.filter(d => d.type === 'zalo_person')
    const accountsOf = new Set([A.id])
    for (const d of dgs) { for (const a of W.accounts) if (a.staff === d.staff && a.org === S1.org && a.platform === 'zalo') accountsOf.add(a.id); if (d.account) accountsOf.add(d.account) }
    const order = arr => arr.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
    DBG.phoneSel = (DBG.phoneSel || 0) + (phoneGroups.length ? 1 : 0); DBG.phoneN = (DBG.phoneN || 0) + (phoneN && phoneGroups.length ? 1 : 0)
    if (phoneN && phoneGroups.length) {
      DBG.cand = (DBG.cand || 0) + (W.contacts.some(c => c.type === 'phone' && c.uid === phoneN) ? 1 : 0)
      DBG.memb = (DBG.memb || 0) + (W.contacts.some(c => c.type === 'phone' && c.uid === phoneN && W.members.some(m => m.contact === c.id && phoneGroups.some(d => d.id === m.group))) ? 1 : 0)
      const cands = W.contacts.filter(c => c.type === 'phone' && c.uid === phoneN && ((c.account === null && c.org === S1.org) || (c.account !== null && accountsOf.has(c.account))))
      const hit = order(phoneGroups.filter(d => cands.some(c => W.members.some(m => m.group === d.id && m.contact === c.id && !m.deleted))))
      if (hit.length) return { match: { kind: 'data_group', id: hit[0].id }, why: 'dg_phone' }
    }
    if (uidGroups.length && (gid || uid)) {
      const cands = []
      for (const a of accountsOf) { const z = zuFirst(W, a, gid); if (z) cands.push(...W.contacts.filter(c => c.account === a && c.type === 'person' && c.uid === z.uid)) }
      if (uid) cands.push(...W.contacts.filter(c => c.account === A.id && c.type === 'person' && c.uid === uid))
      const hit = order(uidGroups.filter(d => cands.some(c => W.members.some(m => m.group === d.id && m.contact === c.id && !m.deleted))))
      if (hit.length) return { match: { kind: 'data_group', id: hit[0].id }, why: 'dg_uid' }
    }
    // 3. chiến dịch đã gửi
    const OK = new Set(['thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click'])
    for (const id of [...(sel.sentCampaignIds || [])].sort((a, b) => a - b)) {
      const c = W.campaigns.find(x => x.id === id)
      if (!c || c.staff !== S1.id || c.org !== S1.org || c.id === campId) continue
      let scUid = c.account === A.id ? uid : null
      if (!scUid && gid && c.account) { const z = zuFirst(W, c.account, gid); scUid = z ? z.uid : null }
      const inputs = W.inputs.filter(i => i.campaign === c.id && ((scUid && i.uid && i.uid.trim() && i.uid.trim().toLowerCase() === scUid.trim().toLowerCase()) || (phoneM && i.phone && i.phone.trim() && norm[i.phone]?.m === phoneM)))
      const sent = W.details.some(d => inputs.some(i => i.id === d.input) && d.campaign === c.id && ['zalo_message_friend', 'zalo_message_stranger'].includes(d.action) && !d.deleted &&
        (d.committed === 'committed' || (d.committed === null && OK.has(d.status))))
      if (sent) return { match: { kind: 'campaign', id: c.id }, why: 'campaign' }
    }
    // 4. khối Zalo khác
    const blocks = []
    if (group) for (const b of group.blocks) {
      const B = Number(b.accountId)
      if (B === A.id || !alive(accById.get(B))) continue
      const enabled = b.rules.filter(r => r.isEnabled)
      const sources = new Set(enabled.map(r => Number(r.fieldId) === ids.zalo_friend_status ? 'zalo_friendship' : 'zalo_labels'))
      if (!sources.size) { blocks.push({ accountId: B, state: 'empty', facts: null }); continue }
      if (!gid) { blocks.push({ accountId: B, state: 'unknown', facts: null }); continue }
      const acc = accById.get(B)
      const synced = W.zu.some(z => z.account === B) || W.contacts.some(c => c.account === B && c.type === 'person')
      if (!synced) { blocks.push({ accountId: B, state: 'not_synced', facts: null }); continue }
      const z = zuFirst(W, B, gid)
      const facts = {}
      if (sources.has('zalo_friendship')) {
        let status = 'stranger'
        if (z) {
          if (z.isFr === 1 || W.contacts.some(c => c.account === B && c.type === 'person' && c.uid === z.uid && !c.deleted && c.isFriend)) status = 'friend'
          else if (W.engagement.some(e => e.account === B && e.uid === z.uid && e.daysAgo < 60 && !e.friended && !e.rejected)) status = 'request_sent'
        }
        facts.zalo_friendship = { status }
      }
      if (sources.has('zalo_labels')) {
        const tags = W.tags.filter(t => t.account === B && !t.deleted && t.staff === acc.staff)
        facts.zalo_labels = { ids: tags.filter(t => z && t.conv.includes(z.uid)).map(t => t.uid).sort(), availableValues: tags.map(t => t.uid).sort() }
      }
      blocks.push({ accountId: B, state: 'ok', facts })
    }
    return { match: null, blocks: blocks.map(b => b.state === 'ok' ? b : { accountId: b.accountId, state: b.state, facts: null }), why: 'blocks' }
  }
  function ownFacts(W, A, zuA) {
    const facts = {}
    if (zuA) {
      const friend = zuA.isFr === 1 || W.contacts.some(c => c.account === A.id && c.uid === zuA.uid && c.type === 'person' && !c.deleted && c.isFriend)
      facts.zalo_friendship = { status: friend ? 'friend' : 'stranger' }
      facts.zalo_labels = { ids: W.tags.filter(t => t.account === A.id && !t.deleted && t.conv.includes(zuA.uid)).map(t => t.uid), availableValues: W.tags.filter(t => t.account === A.id && !t.deleted).map(t => t.uid) }
    }
    return facts
  }
  function ruleTrue(rule, facts) {
    const f = Number(rule.fieldId)
    if (f === ids.zalo_friend_status) {
      const s = facts.zalo_friendship?.status
      if (s == null) return null
      return Number(rule.operatorId) === op.equals ? s === rule.value : s !== rule.value
    }
    if (f === ids.zalo_tag) {
      const have = facts.zalo_labels?.ids
      if (have == null) return null
      const any = (rule.value || []).some(v => have.includes(v))
      return Number(rule.operatorId) === op.contains ? any : !any
    }
    return null
  }
  /** Ba giá trị: true = khối khớp (không gửi), false = không khớp, null = chưa đủ dữ liệu. */
  function blockTruth(block, facts) {
    if (!block) return false
    const rs = block.rules.filter(r => r.isEnabled).map(r => ruleTrue(r, facts || {}))
    if (!rs.length) return false
    if (block.matchMode === 'and') return rs.includes(false) ? false : rs.includes(null) ? null : true
    return rs.includes(true) ? true : rs.includes(null) ? null : false
  }
  function loadEvaluator() {
    try {
      const esbuild = require(require.resolve('esbuild', { paths: [ROOT] }))
      const out = esbuild.buildSync({ entryPoints: [path.join(ROOT, 'src/shared/campaignSendExclusion.ts')], bundle: true, platform: 'node', format: 'cjs', write: false })
      const m = { exports: {} }
      new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require)
      return m.exports
    } catch (e) { console.log(`  (bỏ qua phần quyết định: ${e.message})`); return null }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
