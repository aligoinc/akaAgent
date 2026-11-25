#!/usr/bin/env node
// Bộ kiểm ngẫu nhiên V657 (loại trừ gửi so theo SĐT / Global ID, lọc ở bước nhận data).
// Mỗi vòng dựng một "thế giới" giả (người thật có SĐT / Global ID, nhiều nick Zalo với Zalo ID riêng đổi theo thời gian, hai tài khoản
// akaAgent cùng một nick, danh sách Zalo ID, Nhóm data SĐT / Zalo UID, chiến dịch đã gửi, lịch sử Tìm SĐT, nguồn của tổ chức / nhân viên
// khác làm mồi), rồi so DB với một bản tính độc lập viết bằng JS theo quy tắc ở docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md mục 12:
//   1. bảng đối chiếu SĐT → Global ID sau khi nạp;
//   2. private.aka_agent_send_exclusion_match ở bước A (final=false) và bước B (final=true, Global ID thật);
//   3. bước nhận data của engine v2 (claim): data bị loại tạm dừng đúng lý do, data khác được nhận, theo đúng thứ tự;
//   4. thao tác precheck của bộ chạy cũ; thao tác remote; xem trước (preview) theo chiến dịch và theo danh sách data;
//   5. đối chiếu với "sự thật" (ai là ai): không bao giờ loại nhầm người (0 lần), bước A loại thì bước B cũng loại;
//      số người lẽ ra bị loại mà dữ liệu không đủ để nhận ra (thiếu zalo_users, Global ID trống) chỉ in ra để theo dõi.
//   PG_MODULE_DIR=<thư mục có node_modules/pg> LC_ALL=C node scripts/send-exclusion-v657-fuzz.cjs [--rounds 6] [--seed 1]
'use strict'
const { buildDb } = require('./send-exclusion-v657-fixture.cjs')

const args = process.argv.slice(2)
const arg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }
const ROUNDS = Number(arg('rounds', 6))
const SEED = Number(arg('seed', 1))
const ROWS = Number(arg('rows', 36))

// ---------------------------------------------------------------------------------------------------------- tiện ích
function rng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
/** Bản JS của public.normalize_phone (giữ đúng thứ tự xử lý). */
function normalizePhone(p) {
  if (p == null) return null
  let d = String(p).replace(/[^0-9]/g, '')
  if (d === '') return ''
  if (d.startsWith('0084') && d.length >= 13) d = '0' + d.slice(4)
  else if (d.startsWith('84') && d.length >= 11) d = '0' + d.slice(2)
  if (d.length === 9 && '35789'.includes(d[0])) d = '0' + d
  if (d.length === 11 && d[0] === '0') {
    const map = { '0162': '032', '0163': '033', '0164': '034', '0165': '035', '0166': '036', '0167': '037', '0168': '038', '0169': '039', '0120': '070',
      '0121': '079', '0122': '077', '0126': '076', '0128': '078', '0123': '083', '0124': '084', '0125': '085', '0127': '081', '0129': '082', '0186': '056',
      '0188': '058', '0199': '059' }
    d = (map[d.slice(0, 4)] ?? d.slice(0, 4)) + d.slice(4)
  }
  return d
}
const mobile = p => { const n = normalizePhone(p); return n && /^0[35789][0-9]{8}$/.test(n) ? n : '' }
const vnDate = iso => { const d = new Date(new Date(iso).getTime() + 7 * 3600_000); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
const byNameId = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id)
const SUCCESS_STATUS = ['thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click']
const UNKNOWN_NOTE = 'Chưa xác định được khách để kiểm tra loại trừ.'
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x)

// ---------------------------------------------------------------------------------------------------------- bản tính độc lập
/** Quy tắc mục 12 tính trên bản sao dữ liệu trong JS. */
const cov = {}
const bump = k => { cov[k] = (cov[k] ?? 0) + 1 }
function makeOracle(M) {
  const zu = (account, uid) => M.zaloUsers.find(z => z.account === account && z.uid === uid)
  const uidsOf = (account, gid) => M.zaloUsers.filter(z => z.account === account && z.gid && z.gid === gid).map(z => z.uid)
  const identity = new Map() // phone → {gid, id}
  for (const d of M.details.filter(d => d.action === 'zalo_find_phone_user' && d.status === 'thành công').sort((a, b) => a.id - b.id)) {
    const ph = mobile(d.data?.target?.phone ?? ''); const gid = String(d.data?.target?.globalId ?? '').trim()
    if (ph && gid) identity.set(ph, { gid, id: d.id })
  }
  const orgAccounts = M.accounts.filter(a => a.org === M.org)
  const orgZalo = orgAccounts.filter(a => a.platform === 'zalo')
  const success = d => ['zalo_message_friend', 'zalo_message_stranger'].includes(d.action) && !d.deleted &&
    (d.opState === 'committed' || (d.opState == null && SUCCESS_STATUS.includes(d.status)))

  function rule({ account, selection, phone, gid: gidIn, uid, final, campaignId }) {
    const P = mobile(phone ?? '') || null
    let G = String(gidIn ?? '').trim() || null
    let from = G ? 'target' : null
    if (!G && String(uid ?? '').trim()) { const z = zu(account, String(uid).trim()); if (z && z.gid) { G = z.gid; from = 'uid' } }
    if (!G && P && identity.has(P)) { G = identity.get(P).gid; from = 'phone_history' }
    const phones = P ? [P] : G ? [...identity.entries()].filter(([, v]) => v.gid === G).map(([k]) => k).sort() : []
    let need = false
    let match = null
    // 1. danh sách Zalo ID
    const lists = M.groups.filter(g => (selection.blocklistIds ?? []).includes(g.id) && !g.deleted && g.purpose === 'zalo_friend_blocklist' && g.staff === M.staff && g.org === M.org)
    if (lists.length) {
      if (!G) need = true
      else {
        const hit = lists.filter(bl => M.members.some(m => m.group === bl.id && !m.deleted && M.contacts.some(c => c.id === m.contact && !c.deleted &&
          c.account === bl.account && c.type === 'person' && uidsOf(bl.account, G).includes(c.uid)))).sort(byNameId)[0]
        if (hit) {
          match = { kind: 'blocklist', id: hit.id, name: hit.name, note: `Thuộc danh sách Zalo ID loại trừ “${hit.name}”.` }
          bump(hit.account === account ? 'blocklist:own' : M.accounts.find(a => a.id === hit.account)?.nick === M.accounts.find(a => a.id === account)?.nick ? 'blocklist:shared_nick' : 'blocklist:other_zalo')
          const srcUids = M.members.filter(m => m.group === hit.id && !m.deleted).map(m => M.contacts.find(c => c.id === m.contact)).filter(c => c && !c.deleted).map(c => c.uid)
          if (uid && !srcUids.includes(String(uid).trim())) bump('blocklist:uid_differs')
          if (M.accounts.find(a => a.id === hit.account)?.deleted) bump('blocklist:deleted_account')
        }
      }
    }
    // 2. Nhóm data
    if (!match) {
      const groups = M.groups.filter(g => (selection.dataGroupIds ?? []).includes(g.id) && g.purpose === 'data_group' && !g.deleted && g.org === M.org && ['phone', 'zalo_person'].includes(g.dataType))
      if (groups.length) {
        const hits = []
        for (const g of groups) {
          const ok = M.members.some(m => m.group === g.id && !m.deleted && M.contacts.some(c => c.id === m.contact && !c.deleted && (
            (c.type === 'phone' && phones.includes(c.uid) && ((c.account == null && c.org === M.org) || orgAccounts.some(a => a.id === c.account))) ||
            (c.type === 'person' && G && orgZalo.some(a => a.id === c.account) && uidsOf(c.account, G).includes(c.uid)))))
          if (ok) hits.push(g)
        }
        const hit = hits.sort(byNameId)[0]
        if (hit) {
          match = { kind: 'data_group', id: hit.id, name: hit.name, note: `Có trong Nhóm data “${hit.name}”.` }
          bump('data_group:' + hit.dataType)
          if (hits.some(g => g.dataType === 'phone') && hits.some(g => g.dataType === 'zalo_person')) bump('data_group:both_types')
          if (hit.dataType === 'phone' && !P) bump('data_group:phone_from_identity')
        }
        else {
          if (groups.some(g => g.dataType === 'zalo_person') && !G) need = true
          if (groups.some(g => g.dataType === 'phone') && !P && !G) need = true
        }
      }
    }
    // 3. chiến dịch đã gửi
    if (!match) {
      const camps = M.campaigns.filter(c => (selection.sentCampaignIds ?? []).includes(c.id) && c.staff === M.staff && c.org === M.org && c.id !== campaignId).sort((a, b) => a.id - b.id)
      for (const c of camps) {
        const gidUids = G ? new Set(orgZalo.flatMap(a => uidsOf(a.id, G)).map(u => u.trim().toLowerCase())) : new Set()
        const rows = M.inputs.filter(i => i.campaign === c.id && (
          (i.phone != null && String(i.phone).trim() !== '' && phones.includes(normalizePhone(i.phone))) ||
          (i.uid != null && String(i.uid).trim() !== '' && gidUids.has(String(i.uid).trim().toLowerCase()))))
        const ds = M.details.filter(d => d.campaign === c.id && rows.some(r => r.id === d.input) && success(d))
        if (!G) need = true
        if (ds.length) {
          const at = ds.map(d => d.createdAt).sort().at(-1)
          match = { kind: 'campaign', id: c.id, name: c.name, note: `Đã được gửi ở chiến dịch “${c.name}” ngày ${vnDate(at)}.` }
          bump(rows.some(r => r.phone != null && String(r.phone).trim() !== '' && phones.includes(normalizePhone(r.phone))) ? 'campaign:phone' : 'campaign:global_id')
          if (ds.some(d => d.opState === 'committed' && d.status !== 'thành công')) bump('campaign:committed_partial')
          if (c.deleted) bump('campaign:deleted')
          break
        }
      }
    }
    if (match) bump('gid_from:' + (from ?? 'none'))
    return { match, globalId: G, globalIdFrom: from, phone: P, needGlobalId: !match && need, unknown: !match && need && final ? UNKNOWN_NOTE : null }
  }
  return { rule, identity }
}

// ---------------------------------------------------------------------------------------------------------- thế giới ngẫu nhiên
let seq = 6_000_000
const id = () => ++seq

function makeWorld(R, round) {
  const pick = arr => arr[Math.floor(R() * arr.length)]
  const chance = p => R() < p
  const org = 88000 + round, otherOrg = 89000 + round
  const staff = 8800000 + round * 10, staff2 = staff + 1, otherStaff = staff + 2
  const M = { org, staff, staff2, otherOrg, otherStaff, accounts: [], zaloUsers: [], contacts: [], groups: [], members: [], campaigns: [], inputs: [], details: [], persons: [] }
  // Người thật. SĐT duy nhất theo vòng; Global ID duy nhất.
  const nPersons = 14
  for (let i = 0; i < nPersons; i++) {
    const onZalo = chance(0.85)
    const hasPhone = !onZalo || chance(0.75)
    const phone = hasPhone ? `09${String(round % 100).padStart(2, '0')}${String(i).padStart(2, '0')}${String(Math.floor(R() * 1000)).padStart(3, '0')}${(i * 7 + round) % 10}` : null
    M.persons.push({ i, onZalo, phone: phone && mobile(phone) ? phone : null, gid: onZalo ? `G${round}P${i}x${Math.floor(R() * 1e9).toString(36)}` : null })
  }
  // Nick Zalo: N0 dùng chung cho tài khoản gửi A và A2 (cùng nhân viên); N1 cho B và D (D đã xoá); N2 cho C (nhân viên khác cùng tổ chức);
  // N3 cho X (tổ chức khác).
  const acc = (key, nick, extra) => { const a = { id: id(), key, nick, platform: 'zalo', org, staff, deleted: false, ...extra }; M.accounts.push(a); return a }
  const A = acc('A', 'N0'), A2 = acc('A2', 'N0'), B = acc('B', 'N1'), D = acc('D', 'N1', { deleted: true }), C = acc('C', 'N2', { staff: staff2 })
  const X = acc('X', 'N3', { org: otherOrg, staff: otherStaff })
  const FB = acc('FB', null, { platform: 'facebook' })
  // Zalo ID riêng theo (nick, người, phiên bản); tài khoản cùng nick ghi một phần các phiên bản.
  const versions = {} // nick:i → [uid...]
  const uidOwner = new Map()
  for (const nick of ['N0', 'N1', 'N2', 'N3']) for (const p of M.persons) {
    if (!p.onZalo || !chance(0.65)) continue
    const n = 1 + Math.floor(R() * 3)
    versions[nick + ':' + p.i] = Array.from({ length: n }, (_, v) => { const u = `u${round}${nick}p${p.i}v${v}`; uidOwner.set(u, p.i); return u })
  }
  for (const a of M.accounts.filter(a => a.nick)) for (const p of M.persons) {
    const vs = versions[a.nick + ':' + p.i]
    if (!vs) continue
    for (const u of vs) if (chance(0.75)) M.zaloUsers.push({ id: id(), account: a.id, uid: u, gid: chance(0.06) ? '' : p.gid })
  }
  const known = (a, p) => M.zaloUsers.filter(z => z.account === a.id && uidOwner.get(z.uid) === p.i).map(z => z.uid)
  const fmt = ph => pick([ph, ph, '+84' + ph.slice(1), '84' + ph.slice(1), ph.slice(0, 4) + ' ' + ph.slice(4, 7) + ' ' + ph.slice(7), ph.slice(0, 4) + '.' + ph.slice(4, 7) + '.' + ph.slice(7), '(+84) ' + ph.slice(1, 4) + '-' + ph.slice(4, 7) + '-' + ph.slice(7), ph.slice(1)])
  const camp = (a, extra = {}) => { const c = { id: id(), name: 'c' + Math.floor(R() * 2), staff: a.staff, org: a.org, account: a.id, deleted: false, action: 'zalo_message_friend', ...extra }; M.campaigns.push(c); return c }
  const daysAgo = n => new Date(Date.now() - n * 86400_000 - Math.floor(R() * 86400_000)).toISOString()
  const detail = (c, input, account, action, status, data, extra = {}) => M.details.push({ id: id(), campaign: c.id, input: input?.id ?? null, account, action, status, data,
    opState: null, deleted: false, createdAt: daysAgo(Math.floor(R() * 40)), staff: c.staff, org: c.org, ...extra })

  // Lịch sử Tìm SĐT (bảng đối chiếu). Có lần tra cũ ra Global ID khác (đã đổi), lần mới đúng; tra lỗi / Global ID trống thì bỏ.
  const lookupCamp = camp(B, { name: 'tra-so', action: 'zalo_message_phone' })
  for (const p of M.persons.filter(p => p.phone && p.gid)) {
    if (!chance(0.7)) continue
    const acct = pick([A, B, C, X])
    if (chance(0.15)) detail(lookupCamp, null, acct.id, 'zalo_find_phone_user', 'thành công', { target: { phone: fmt(p.phone), globalId: `GSTALE${round}x${p.i}` } })
    if (chance(0.1)) detail(lookupCamp, null, acct.id, 'zalo_find_phone_user', 'thất bại', { target: { phone: fmt(p.phone), globalId: `GFAIL${round}x${p.i}` } })
    detail(lookupCamp, null, acct.id, 'zalo_find_phone_user', 'thành công', { target: { phone: fmt(p.phone), globalId: chance(0.08) ? '' : p.gid } })
  }

  const contact = (account, type, uid, extra = {}) => { const c = { id: id(), account: account?.id ?? null, org: account?.org ?? org, type, uid, deleted: chance(0.06), ...extra }; M.contacts.push(c); return c }
  const group = extra => { const g = { id: id(), name: 'g' + Math.floor(R() * 2), deleted: false, staff, org, ...extra }; M.groups.push(g); return g }
  const member = (g, c) => M.members.push({ id: id(), group: g.id, contact: c.id, deleted: chance(0.06) })
  const somePersons = n => Array.from({ length: n }, () => pick(M.persons))

  // Danh sách Zalo ID: trên A (chính Zalo gửi), A2, B, D (tài khoản đã xoá), C (nhân viên khác: mồi), X (tổ chức khác: mồi), một danh sách đã xoá.
  const lists = []
  for (const [a, extra] of [[A, {}], [A2, {}], [B, {}], [D, {}], [B, { deleted: true }], [C, { staff: staff2 }], [X, { staff: otherStaff, org: otherOrg }]]) {
    const bl = group({ purpose: 'zalo_friend_blocklist', account: a.id, ...extra })
    for (const p of somePersons(4)) { const us = known(a, p); if (us.length) member(bl, contact(a, 'person', pick(us))) }
    lists.push(bl)
  }
  // Nhóm data SĐT (liên hệ không gắn tài khoản, hoặc gắn tài khoản bất kỳ của tổ chức kể cả Facebook) và Zalo UID.
  const dgs = []
  for (let k = 0; k < 2; k++) {
    const g = group({ purpose: 'data_group', dataType: 'phone' })
    for (const p of somePersons(4)) if (p.phone) member(g, contact(chance(0.5) ? null : pick([A, B, FB, D]), 'phone', p.phone))
    dgs.push(g)
  }
  const inPhoneGroups = M.members.map(m => M.contacts.find(c => c.id === m.contact)).filter(c => c?.type === 'phone').map(c => M.persons.find(p => p.phone === c.uid)).filter(Boolean)
  for (let k = 0; k < 2; k++) {
    const g = group({ purpose: 'data_group', dataType: 'zalo_person' })
    for (const p of [...somePersons(3), ...(inPhoneGroups.length ? [pick(inPhoneGroups)] : [])]) { const a = pick([A, A2, B, C, D]); const us = known(a, p); if (us.length) member(g, contact(a, 'person', pick(us))) }
    dgs.push(g)
  }
  { const g = group({ purpose: 'data_group', dataType: 'phone', deleted: true }); for (const p of somePersons(3)) if (p.phone) member(g, contact(null, 'phone', p.phone)); dgs.push(g) }
  { const g = group({ purpose: 'data_group', dataType: 'phone', org: otherOrg, staff: otherStaff }); for (const p of somePersons(3)) if (p.phone) member(g, contact(X, 'phone', p.phone)); dgs.push(g) }
  // Chiến dịch đã gửi: kết quả nhắn tin thành công / lỗi / đã xoá / chỉ tra số / không có kết quả.
  const sents = []
  for (const [a, extra] of [[B, {}], [A2, {}], [C, { staff: staff2 }], [B, { deleted: true }], [D, {}], [X, { staff: otherStaff, org: otherOrg }]]) {
    const c = camp(a, { action: pick(['zalo_message_phone', 'zalo_message_friend', 'zalo_message_group_member']), ...extra })
    for (const p of somePersons(5)) {
      const us = known(a, p)
      const usePhone = p.phone && (us.length === 0 || chance(0.5))
      const useUid = us.length && (!usePhone || chance(0.5))
      if (!usePhone && !useUid) continue
      const input = { id: id(), campaign: c.id, phone: usePhone ? fmt(p.phone) : null, uid: useUid ? pick(us) : null, deleted: chance(0.05), person: p.i }
      M.inputs.push(input)
      const kind = R()
      const action = pick(['zalo_message_friend', 'zalo_message_stranger'])
      if (kind < 0.45) detail(c, input, a.id, action, 'thành công', { target: { uid: input.uid, globalId: p.gid } })
      else if (kind < 0.55) detail(c, input, a.id, action, 'thất bại', { target: { uid: input.uid } }, { opState: 'committed' })
      else if (kind < 0.65) detail(c, input, a.id, action, 'thất bại', { target: { uid: input.uid } })
      else if (kind < 0.72) detail(c, input, a.id, action, 'thành công', {}, { deleted: true })
      else if (kind < 0.82) detail(c, input, a.id, 'zalo_find_phone_user', 'thành công', { target: { phone: input.phone, globalId: p.gid } })
      else if (kind < 0.88) detail(c, input, a.id, action, 'đã xem', {})
      // còn lại: chưa có kết quả
    }
    sents.push(c)
  }
  // Chiến dịch đang chạy trên A: data theo SĐT / Zalo ID ở A (cũ hoặc mới) / cả hai / Zalo ID lạ / số bàn / rỗng.
  // Lựa chọn chỉ gồm nguồn lưu được (của chính nhân viên / tổ chức); nguồn "đã xoá" được xoá SAU khi lưu chiến dịch (như khách xoá sau).
  const mine = g => g.staff === staff && g.org === org
  const sel = {
    groupId: null,
    blocklistIds: lists.filter(g => mine(g) && chance(0.55)).map(g => g.id),
    dataGroupIds: dgs.filter(g => g.org === org && chance(0.5)).map(g => g.id),
    sentCampaignIds: sents.filter(c => mine(c) && chance(0.55)).map(c => c.id),
  }
  if (!sel.blocklistIds.length && !sel.dataGroupIds.length && !sel.sentCampaignIds.length) sel.blocklistIds.push(lists[0].id)
  const targets = []
  for (let k = 0; k < ROWS; k++) {
    const p = pick(M.persons)
    const us = known(A, p)
    const t = R()
    let phone = null, uid = null
    if (t < 0.35 && p.phone) phone = fmt(p.phone)
    else if (t < 0.6 && us.length) uid = pick(us)
    else if (t < 0.75 && p.phone && us.length) { phone = fmt(p.phone); uid = pick(us) }
    else if (t < 0.82 && p.onZalo) uid = `u${round}N0p${p.i}vX${k}` // Zalo ID mà A chưa ghi
    else if (t < 0.86) phone = '028' + String(3800000 + k)        // số bàn: coi như không có SĐT
    else if (p.phone) phone = fmt(p.phone)
    else if (us.length) uid = pick(us)
    else uid = `u${round}N0p${p.i}vY${k}`
    targets.push({ person: p.i, phone, uid })
  }
  return { M, A, A2, B, C, D, X, FB, sel, targets, uidOwner, lists, dgs, sents }
}

// ---------------------------------------------------------------------------------------------------------- chạy
async function main() {
  const T = await buildDb({ label: 'aka-v657-fuzz-' })
  const { db, q, one } = T
  const cols = {}
  const ins = async (table, rows) => {
    rows = Array.isArray(rows) ? rows : [rows]
    if (!rows.length) return
    cols[table] ??= (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table])).map(r => r.column_name)
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols[table].includes(k))
    const list = keys.map(k => `"${k}"`).join(', ')
    await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`, [JSON.stringify(rows)])
  }
  const problems = []
  const info = { truthMissed: 0, truthMissReasons: {}, excludedA: 0, excludedB: 0, unknownB: 0, rows: 0, claims: 0 }
  const fail = (round, what, detail) => { problems.push({ round, what, detail }); if (problems.length <= 40) console.log(`  ✗ vòng ${round}: ${what} ${JSON.stringify(detail)}`) }
  try {
    await T.applyV657()
    const cat = async code => (await one(`SELECT id FROM public.category_item WHERE code=$1 LIMIT 1`, [code]))?.id
    let catPhone = await cat('phone'); let catPerson = await cat('zalo_person')
    if (!catPhone) { catPhone = 990001; await ins('category_item', { id: catPhone, code: 'phone', name: 'Số điện thoại' }) }
    if (!catPerson) { catPerson = 990002; await ins('category_item', { id: catPerson, code: 'zalo_person', name: 'Zalo User' }) }

    for (let round = 1; round <= ROUNDS; round++) {
      const R = rng(SEED * 1000 + round)
      const W = makeWorld(R, round)
      const { M, A } = W
      // -------------------------------------------------------------- ghi thế giới vào DB
      for (const o of [M.org, M.otherOrg]) await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'Org fuzz') ON CONFLICT DO NOTHING`, [o])
      await ins('org_staff', [M.staff, M.staff2].map(s => ({ id: s, organization_id: M.org, username: 'f' + s, password: 'pw', is_active: true }))
        .concat([{ id: M.otherStaff, organization_id: M.otherOrg, username: 'f' + M.otherStaff, password: 'pw', is_active: true }]))
      await ins('auto_accounts', M.accounts.map(a => ({ id: a.id, name: 'Zalo ' + a.key, flatform_type: a.platform, login_status: 'đã đăng nhập', status: 'chờ xử lý',
        is_active: true, is_delete: false, staff_id: a.staff, organization_id: a.org, is_zalo_server: false, is_zalo_show_web: false })))
      await ins('zalo_users', M.zaloUsers.map(z => { const a = M.accounts.find(x => x.id === z.account); return { id: z.id, account_id: z.account, zalo_uid: z.uid, global_id: z.gid, staff_id: a.staff, organization_id: a.org, is_fr: 0 } }))
      await ins('auto_account_contacts', M.contacts.map(c => { const a = M.accounts.find(x => x.id === c.account); return { id: c.id, account_id: c.account, contact_type: c.type, uid: c.uid,
        is_delete: c.deleted, staff_id: a?.staff ?? M.staff, organization_id: c.org, flatform_type: a?.platform ?? null } }))
      await ins('auto_account_contact_groups', M.groups.map(g => ({ id: g.id, name: g.name, purpose: g.purpose, account_id: g.account ?? null, contact_type: g.purpose === 'zalo_friend_blocklist' ? 'person' : null,
        data_type_category_item_id: g.dataType === 'phone' ? catPhone : g.dataType === 'zalo_person' ? catPerson : null, is_delete: false, staff_id: g.staff, organization_id: g.org })))
      await ins('auto_account_contact_group_members', M.members.map(m => ({ id: m.id, group_id: m.group, contact_id: m.contact, is_delete: m.deleted })))
      const campRow = (c, extra = {}) => ({ id: c.id, name: c.name, action_id: c.action, account_id: c.account, status: 'hoàn thành', is_delete: c.deleted, staff_id: c.staff,
        organization_id: c.org, schedule: new Date(Date.now() - 86400_000).toISOString(), schedule_type: 'daily', extra_settings: {}, ...extra })
      await ins('auto_campaigns', M.campaigns.map(c => campRow(c, { is_delete: false })))
      await ins('auto_campaign_input_data', M.inputs.map(i => ({ id: i.id, campaign_id: i.campaign, phone: i.phone, uid: i.uid, status: 'hoàn thành', is_delete: i.deleted })))
      await ins('auto_campaign_details', M.details.map(d => ({ id: d.id, campaign_id: d.campaign, input_data_id: d.input, account_id: d.account, action_code: d.action, action_name: d.action,
        staff_id: d.staff, organization_id: d.org, status: d.status, is_delete: d.deleted, created_at: d.createdAt, data: d.data,
        policy_snapshot: d.opState ? { operationState: d.opState } : null })))

      // -------------------------------------------------------------- 1. bảng đối chiếu
      for (let k = 0; k < 20; k++) { const r = await one(`SELECT private.aka_agent_zalo_phone_identity_ingest(20000, 200000) r`); if (Number(r.r.lastDetailId) >= Number(r.r.maxDetailId)) break }
      const O = makeOracle(M)
      const phones = M.persons.filter(p => p.phone).map(p => p.phone)
      const idRows = await q(`SELECT phone, global_id FROM private.auto_zalo_phone_identity WHERE phone = ANY($1)`, [phones])
      const gotId = Object.fromEntries(idRows.map(r => [r.phone, r.global_id]))
      for (const ph of phones) { const exp = O.identity.get(ph)?.gid ?? null; if ((gotId[ph] ?? null) !== exp) fail(round, 'bảng đối chiếu', { ph, exp, got: gotId[ph] ?? null }) }

      // -------------------------------------------------------------- chiến dịch đang chạy (3 bản cùng data: match/preview/remote, engine, bộ chạy cũ)
      const runCamp = async extra => {
        const c = { id: id(), name: 'run', staff: M.staff, org: M.org, account: A.id, deleted: false, action: 'zalo_message_phone' }
        await ins('auto_campaigns', campRow(c, { status: 'chờ xử lý', schedule: new Date(Date.now() - 60_000).toISOString(),
          extra_settings: { enableMessage: true, zaloSendExclusionsByAccountId: { [A.id]: W.sel } }, ...extra }))
        const rows = W.targets.map(t => ({ id: id(), ...t }))
        await ins('auto_campaign_input_data', rows.map(r => ({ id: r.id, campaign_id: c.id, phone: r.phone, uid: r.uid, status: 'chờ xử lý', is_delete: false })))
        return { c, rows }
      }
      const main = await runCamp()
      const eng = await runCamp()
      const old = await runCamp()
      // Khách xoá tài khoản / danh sách / Nhóm data / chiến dịch sau khi đã lưu chiến dịch.
      await db.query(`UPDATE public.auto_accounts SET is_delete=true WHERE id = ANY($1)`, [M.accounts.filter(a => a.deleted).map(a => a.id)])
      await db.query(`UPDATE public.auto_account_contact_groups SET is_delete=true WHERE id = ANY($1)`, [M.groups.filter(g => g.deleted).map(g => g.id)])
      await db.query(`UPDATE public.auto_campaigns SET is_delete=true WHERE id = ANY($1)`, [M.campaigns.filter(c => c.deleted).map(c => c.id)])
      const matchSql = `SELECT private.aka_agent_send_exclusion_match(c, $2::bigint, c.extra_settings->'zaloSendExclusionsByAccountId'->($2::bigint::text), $3::text, $4::text, $5::text, $6::boolean) m
        FROM public.auto_campaigns c WHERE c.id=$1`
      const norm = m => m && ({ kind: m.kind, id: Number(m.id), note: m.note })
      const expA = new Map(), expB = new Map()
      for (const r of main.rows) {
        info.rows++
        const p = M.persons[r.person]
        const ea = O.rule({ account: A.id, selection: W.sel, phone: r.phone, gid: null, uid: r.uid, final: false, campaignId: main.c.id })
        const eb = O.rule({ account: A.id, selection: W.sel, phone: r.phone, gid: p.gid, uid: r.uid, final: true, campaignId: main.c.id })
        expA.set(r.id, ea); expB.set(r.id, eb)
        const ga = (await one(matchSql, [main.c.id, A.id, r.phone, null, r.uid, false])).m
        const gb = (await one(matchSql, [main.c.id, A.id, r.phone, p.gid, r.uid, true])).m
        for (const [stage, e, g] of [['A', ea, ga], ['B', eb, gb]]) {
          const got = { match: norm(g.match), globalId: g.globalId ?? null, needGlobalId: !!g.needGlobalId, unknown: g.unknown ?? null }
          const exp = { match: norm(e.match), globalId: e.globalId, needGlobalId: e.needGlobalId, unknown: e.unknown }
          if (JSON.stringify(got) !== JSON.stringify(exp)) fail(round, `match bước ${stage}`, { row: r, exp, got })
        }
        if (ea.match) info.excludedA++
        if (eb.match) info.excludedB++
        if (eb.unknown) info.unknownB++
        // Bước A loại thì bước B cũng loại.
        if (ea.match && !eb.match) fail(round, 'bước A loại mà bước B không loại', { row: r, ea, eb })
        // Sự thật: không loại nhầm người.
        const truth = truthMembers(W, eb.match)
        if (eb.match && !truth.has(p.i)) fail(round, 'loại nhầm người (bước B)', { row: r, person: p, match: eb.match })
        if (ea.match && !truthMembers(W, ea.match).has(p.i)) fail(round, 'loại nhầm người (bước A)', { row: r, person: p, match: ea.match })
        // Người lẽ ra bị loại theo sự thật mà dữ liệu không đủ để nhận ra: chỉ theo dõi.
        if (!eb.match && p.onZalo) {
          const why = truthShouldExclude(W, p, A)
          if (why) { info.truthMissed++; info.truthMissReasons[why] = (info.truthMissReasons[why] ?? 0) + 1 }
        }
        // remote (bước B, bộ chạy): như match bước B.
        const rm = (await one(`SELECT private.aka_agent_send_exclusion_remote(c, $2::bigint, $3::bigint, $4::jsonb) r FROM public.auto_campaigns c WHERE c.id=$1`,
          [main.c.id, A.id, r.id, { globalId: p.gid }])).r
        const rmGot = { match: norm(rm.match), unknown: rm.unknown ?? null }
        const rmExp = { match: norm(eb.match), unknown: eb.unknown }
        if (JSON.stringify(rmGot) !== JSON.stringify(rmExp)) fail(round, 'remote', { row: r, exp: rmExp, got: rmGot })
      }

      // -------------------------------------------------------------- 2. preview theo chiến dịch và theo danh sách data
      const validSel = { groupId: null,
        blocklistIds: W.sel.blocklistIds.filter(i => { const g = M.groups.find(x => x.id === i); return !g.deleted && g.staff === M.staff && g.org === M.org && !M.accounts.find(a => a.id === g.account).deleted }),
        dataGroupIds: W.sel.dataGroupIds.filter(i => { const g = M.groups.find(x => x.id === i); return !g.deleted && g.org === M.org }),
        sentCampaignIds: W.sel.sentCampaignIds.filter(i => { const c = M.campaigns.find(x => x.id === i); return c.staff === M.staff && c.org === M.org && !c.deleted }) }
      const prevExp = { checked: main.rows.length, excluded: 0, pending: 0, sources: {} }
      for (const r of main.rows) {
        const e = O.rule({ account: A.id, selection: validSel, phone: r.phone, gid: null, uid: r.uid, final: false, campaignId: main.c.id })
        if (e.match) { prevExp.excluded++; const k = e.match.kind + ':' + e.match.id; prevExp.sources[k] = (prevExp.sources[k] ?? 0) + 1 } else if (e.needGlobalId) prevExp.pending++
      }
      for (const mode of ['campaign', 'targets']) {
        let acc = { checked: 0, excluded: 0, pending: 0, sources: {} }, after = null
        for (let page = 0; page < 20; page++) {
          const payload = { accountId: A.id, selection: validSel, afterId: after, limit: 17, ...(mode === 'campaign' ? { campaignId: main.c.id } : { targets: W.targets.map(t => ({ phone: t.phone, uid: t.uid })) }) }
          let res
          try { res = (await one(`SELECT public.aka_agent_send_exclusion_v2($1, $2, 'preview', $3, $4, 'pw') r`, [M.staff, M.org, payload, 'f' + M.staff])).r }
          catch (e) { fail(round, 'preview lỗi', { mode, error: e.message, validSel }); break }
          acc.checked += res.checked; acc.excluded += res.excluded; acc.pending += res.pending
          for (const s of res.sources) { const k = s.kind + ':' + s.id; acc.sources[k] = (acc.sources[k] ?? 0) + s.count }
          if (res.nextAfterId == null) break
          after = res.nextAfterId
        }
        if (JSON.stringify(sortObj(acc)) !== JSON.stringify(sortObj(prevExp))) fail(round, 'preview', { mode, exp: prevExp, got: acc })
      }

      // -------------------------------------------------------------- 3. bước nhận data của engine v2
      const asDesktop = async fn => {
        await db.query('BEGIN')
        try { await db.query(`SELECT set_config('test.desktop_staff', $1, true)`, [String(M.staff)]); await db.query('SET LOCAL ROLE aka_agent_desktop'); const o = await fn(); await db.query('COMMIT'); return o }
        catch (e) { await db.query('ROLLBACK'); throw e }
      }
      // Hai bản còn lại để ở trạng thái chờ khi engine chạy (claim chỉ nhận chiến dịch được chỉ định).
      await db.query(`UPDATE public.auto_campaigns SET status='hoàn thành' WHERE id = ANY($1)`, [[main.c.id, old.c.id]])
      const claimedOrder = [], paused = new Map()
      for (let k = 0; k < 200; k++) {
        const res = await asDesktop(async () => (await one('SELECT public.aka_agent_engine_claim_target_v1($1) r',
          [{ staffId: M.staff, accountId: A.id, campaignId: eng.c.id, runnerId: 'desktop:fuzz', runtimeTarget: 'desktop', actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }] }])).r)
        info.claims++
        for (const p of res.cooldownPaused ?? []) paused.set(Number(p.inputDataId), p.note)
        if (res.status === 'claimed') {
          claimedOrder.push(Number(res.target.id))
          await db.query(`UPDATE public.auto_campaign_input_data SET status='hoàn thành' WHERE id=$1`, [res.target.id])
        } else if (res.status !== 'cooldown_scan') {
          if (res.status !== 'no_target') fail(round, 'claim trả trạng thái lạ', { res })
          break
        }
        await db.query(`DELETE FROM public.auto_engine_target_runs WHERE account_id=$1`, [A.id])
        await db.query(`DELETE FROM public.auto_engine_leases WHERE account_id=$1`, [A.id])
        await db.query(`UPDATE public.auto_campaigns SET status='chờ xử lý' WHERE id=$1`, [eng.c.id])
      }
      const expClaimed = [], expPaused = new Map()
      eng.rows.forEach((r, k) => { const e = expA.get(main.rows[k].id); if (e.match) expPaused.set(r.id, e.match.note); else expClaimed.push(r.id) })
      if (JSON.stringify(claimedOrder) !== JSON.stringify(expClaimed)) fail(round, 'claim: data được nhận', { exp: expClaimed, got: claimedOrder })
      if (JSON.stringify([...paused].sort()) !== JSON.stringify([...expPaused].sort())) fail(round, 'claim: data bị loại', { exp: [...expPaused], got: [...paused] })
      const dbPaused = await q(`SELECT id, status, note FROM public.auto_campaign_input_data WHERE campaign_id=$1 AND status='tạm dừng' ORDER BY id`, [eng.c.id])
      if (JSON.stringify(dbPaused.map(r => [Number(r.id), r.note])) !== JSON.stringify([...expPaused].sort((a, b) => a[0] - b[0]))) fail(round, 'claim: dòng tạm dừng trong DB', { dbPaused })

      // -------------------------------------------------------------- 4. bộ chạy cũ: precheck từng data
      const token = '00000000-0000-4000-8000-' + String(round).padStart(12, '0')
      await db.query(`UPDATE public.auto_campaigns SET status='đang chạy', runtime_claim_token=$2 WHERE id=$1`, [old.c.id, token])
      for (const [k, r] of old.rows.entries()) {
        const e = expA.get(main.rows[k].id)
        const res = (await one(`SELECT public.aka_agent_campaign_send_exclusion_runtime($1, $2, $3, $4, 'precheck', $5) r`, [old.c.id, A.id, M.staff, token, { inputId: r.id }])).r
        const exp = e.match ? { excluded: true, note: e.match.note, changed: true } : { excluded: false }
        if (canon(res) !== canon(exp)) fail(round, 'precheck bộ chạy cũ', { row: r, exp, got: res })
      }
      await db.query(`UPDATE public.auto_campaigns SET runtime_claim_token=NULL, status='hoàn thành' WHERE id=$1`, [old.c.id])
      console.log(`vòng ${round}: ${main.rows.length} data, bước A loại ${[...expA.values()].filter(e => e.match).length}, bước B loại ${[...expB.values()].filter(e => e.match).length}, ` +
        `claim ${claimedOrder.length} nhận / ${paused.size} loại, lỗi ${problems.filter(p => p.round === round).length}`)
    }
  } finally { await T.stop() }
  console.log('\nTheo dõi:', JSON.stringify(info))
  console.log('Độ phủ:', JSON.stringify(Object.fromEntries(Object.entries(cov).sort())))
  console.log(problems.length ? `\n${problems.length} LỖI` : '\nSẠCH: 0 lỗi')
  if (problems.length) process.exit(1)
}
function sortObj(o) { return { ...o, sources: Object.fromEntries(Object.entries(o.sources).sort()) } }

/** Người thật thuộc một nguồn (theo sự thật: ai là chủ Zalo ID / SĐT nào). */
function truthMembers(W, match) {
  const { M } = W
  const set = new Set()
  if (!match) return set
  const ownerOfContact = c => c.type === 'phone' ? M.persons.find(p => p.phone === c.uid)?.i : W.uidOwner.get(c.uid)
  if (match.kind === 'blocklist' || match.kind === 'data_group') {
    for (const m of M.members.filter(m => m.group === match.id && !m.deleted)) {
      const c = M.contacts.find(c => c.id === m.contact && !c.deleted)
      if (c) { const o = ownerOfContact(c); if (o != null) set.add(o) }
    }
  } else {
    for (const i of M.inputs.filter(i => i.campaign === match.id)) {
      const ok = M.details.some(d => d.input === i.id && ['zalo_message_friend', 'zalo_message_stranger'].includes(d.action) && !d.deleted &&
        (d.opState === 'committed' || (d.opState == null && SUCCESS_STATUS.includes(d.status))))
      if (ok) set.add(i.person)
    }
  }
  return set
}
/** Lý do (để theo dõi) nếu theo sự thật người p thuộc một nguồn đã chọn mà quy tắc không nhận ra. */
function truthShouldExclude(W, p, A) {
  const { M, sel } = W
  for (const id of sel.blocklistIds) { const g = M.groups.find(g => g.id === id); if (!g.deleted && g.staff === M.staff && g.org === M.org && truthMembers(W, { kind: 'blocklist', id }).has(p.i)) return 'blocklist:zalo_users thiếu hoặc Global ID trống' }
  for (const id of sel.dataGroupIds) { const g = M.groups.find(g => g.id === id); if (!g.deleted && g.org === M.org && truthMembers(W, { kind: 'data_group', id }).has(p.i)) return 'data_group:' + g.dataType + ' thiếu đối chiếu' }
  for (const id of sel.sentCampaignIds) { const c = M.campaigns.find(c => c.id === id); if (c.staff === M.staff && c.org === M.org && truthMembers(W, { kind: 'campaign', id }).has(p.i)) return 'campaign:thiếu đối chiếu UID/SĐT' }
  return null
}

main().catch(e => { console.error(e); process.exit(1) })
