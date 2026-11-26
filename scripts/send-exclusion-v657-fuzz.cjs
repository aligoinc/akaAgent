#!/usr/bin/env node
// Bộ kiểm ngẫu nhiên V657 (loại trừ gửi so theo SĐT / Global ID, lọc ở bước nhận data), có dữ liệu sai lệch cố ý theo những gì đo được
// trên production 25/11/2026 (chỉ đọc):
//   - zalo_users mang Global ID của CHÍNH nick đang đăng nhập cho thành viên nhóm (~19% dòng, 701 tài khoản); Global ID của nick ghi ở
//     zalo_accounts.metadata (Desktop) hoặc chat_zalo_account (Fly), hai nơi có khi khác nhau; có tài khoản không ghi ở đâu cả;
//   - tài khoản đổi nick: dòng cũ mang Global ID của nick trước; người đổi Zalo ID thật có 2–3 dòng cùng tên;
//   - Zalo ID riêng trùng nhau giữa các nick (người khác nhau);
//   - SĐT nhiều cách viết (+84, 84, 0084, dấu cách / chấm / gạch, số 11 số kiểu cũ, chữ O thay số 0, ký tự lạ), số bàn, rỗng;
//     Zalo ID có khoảng trắng, là SĐT, là link; Global ID trống; lần tra số cũ ra Global ID khác; lần tra số trả Global ID của chính nick;
//     Global ID người nhận gửi về là của chính nick; kết quả gửi không ghi / ghi sai Global ID.
// So DB với một bản tính độc lập viết bằng JS (docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md mục 12) ở: bảng đối chiếu, hàm so khớp
// bước A / B, remote, bước nhận data của engine v2 (claim), precheck của bộ chạy cũ, xem trước (theo chiến dịch / theo danh sách data);
// và với "sự thật" (ai là ai): không bao giờ loại nhầm người, bước A loại thì bước B cũng loại.
//   PG_MODULE_DIR=<thư mục có node_modules/pg> LC_ALL=C node scripts/send-exclusion-v657-fuzz.cjs [--rounds 8] [--seed 1] [--rows 120] [--persons 30]
//   [--recycle 1]  thêm SĐT đổi chủ mà chưa ai tra lại (giới hạn đã biết, xem mục 12.5): lỗi loại nhầm do SĐT đổi chủ đếm riêng.
'use strict'
const { buildDb } = require('./send-exclusion-v657-fixture.cjs')

const args = process.argv.slice(2)
const arg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }
const ROUNDS = Number(arg('rounds', 8))
const SEED = Number(arg('seed', 1))
const ROWS = Number(arg('rows', 120))
const PERSONS = Number(arg('persons', 30))
const RECYCLE = Number(arg('recycle', 0)) > 0

// ---------------------------------------------------------------------------------------------------------- tiện ích
function rng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
/** Bản JS của public.normalize_phone. */
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
const OLD_PREFIX = { '032': '0162', '033': '0163', '034': '0164', '035': '0165', '036': '0166', '037': '0167', '038': '0168', '039': '0169', '070': '0120',
  '079': '0121', '077': '0122', '076': '0126', '078': '0128', '083': '0123', '084': '0124', '085': '0125', '081': '0127', '082': '0129', '056': '0186', '058': '0188', '059': '0199' }
const vnDate = iso => { const d = new Date(new Date(iso).getTime() + 7 * 3600_000); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
const byNameId = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id)
const SUCCESS_STATUS = ['thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click']
const UNKNOWN_NOTE = 'Chưa xác định được khách để kiểm tra loại trừ.'
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x)
const trim = v => (v == null ? '' : String(v).replace(/^[\s]+|[\s]+$/g, ''))
// btrim của Postgres chỉ bỏ dấu cách; data sinh ra chỉ dùng dấu cách để đệm.
const btrim = v => (v == null ? '' : String(v).replace(/^ +| +$/g, ''))

function ownGidsOf(M, a) {
  if (!a || !a.nick) return []
  const n = M.nicks[a.nick]
  return [...new Set([...(a.za ? [n.recorded[0]] : []), ...(a.chatLinked ? [n.recorded.at(-1)] : [])])]
}
const knownNick = (M, a) => !!a && !!a.nick && (a.za || a.chatLinked)

// ---------------------------------------------------------------------------------------------------------- bản tính độc lập
const cov = {}
const bump = k => { cov[k] = (cov[k] ?? 0) + 1 }
function makeOracle(M) {
  const acct = id => M.accounts.find(a => a.id === id)
  const nickOf = id => M.nicks[acct(id)?.nick] ?? null
  // Global ID của chính nick mà DB biết: zalo_accounts (tài khoản gắn zalo_account_id) và / hoặc chat_zalo_account (tài khoản có liên kết Fly).
  const ownGids = id => ownGidsOf(M, acct(id))
  const rows = (account, gid) => M.zaloUsers.filter(z => z.account === account && z.gid === gid)
  const nameKey = z => { const n = btrim(z.zaloName) || btrim(z.displayName); return n ? n.toLowerCase() : null }
  function gidOk(account, gid) {
    if (!btrim(gid ?? '')) return false
    if (ownGids(account).includes(btrim(gid))) return false
    const rs = rows(account, btrim(gid)).slice(0, 4)
    const names = new Set(rs.map(nameKey).filter(x => x != null))
    return rs.length <= 3 && !(rs.length >= 2 && names.size === rs.length)
  }
  const uidsOf = (account, gid) => (gid && gidOk(account, gid) ? rows(account, gid).map(z => z.uid) : [])
  const sameNick = id => {
    const me = acct(id); const n = nickOf(id)
    const out = new Set([id])
    if (me && n && knownNick(M, me)) for (const a of M.accounts) if (a.org === me.org && a.nick === me.nick && knownNick(M, a)) out.add(a.id)
    return [...out]
  }
  const identity = new Map()
  for (const d of M.details.filter(d => d.action === 'zalo_find_phone_user' && d.status === 'thành công').sort((a, b) => a.id - b.id)) {
    const ph = mobile(d.data?.target?.phone ?? ''); const gid = btrim(d.data?.target?.globalId ?? '')
    if (ph && gid && !ownGids(d.account).includes(gid)) identity.set(ph, { gid, id: d.id })
  }
  const orgAccounts = M.accounts.filter(a => a.org === M.org)
  const orgZalo = orgAccounts.filter(a => a.platform === 'zalo')
  const success = d => ['zalo_message_friend', 'zalo_message_stranger'].includes(d.action) && !d.deleted &&
    (d.opState === 'committed' || (d.opState == null && SUCCESS_STATUS.includes(d.status)))

  // noIdentity (V666): xem trước data tự nhập không dùng bảng đối chiếu SĐT ↔ Global ID.
  function rule({ account, selection, phone, gid: gidIn, uid, final, campaignId, noIdentity = false }) {
    const P = mobile(phone ?? '') || null
    const U = btrim(uid ?? '') || null
    let G = btrim(gidIn ?? '') || null
    if (G && ownGids(account).includes(G)) { G = null; bump('target_gid:own_nick_ignored') }
    let from = G ? 'target' : null
    if (!G && U) {
      const z = M.zaloUsers.find(z => z.account === account && z.uid === U)
      const g = btrim(z?.gid ?? '') || null
      if (g && gidOk(account, g)) { G = g; from = 'uid' } else if (g) bump('uid_gid:rejected')
    }
    if (!G && P && !noIdentity && identity.has(P)) {
      const g = identity.get(P).gid
      if (!ownGids(account).includes(g)) { G = g; from = 'phone_history' }
    }
    const phones = P ? [P] : G && !noIdentity ? [...identity.entries()].filter(([, v]) => v.gid === G).map(([k]) => k).sort() : []
    const nick = U ? sameNick(account) : []
    let need = false
    let match = null
    // 1. danh sách Zalo ID
    const lists = M.groups.filter(g => (selection.blocklistIds ?? []).includes(g.id) && !g.deleted && g.purpose === 'zalo_friend_blocklist' && g.staff === M.staff && g.org === M.org)
    if (lists.length) {
      const memberUids = bl => M.members.filter(m => m.group === bl.id && !m.deleted).map(m => M.contacts.find(c => c.id === m.contact))
        .filter(c => c && !c.deleted && c.account === bl.account && c.type === 'person').map(c => c.uid)
      const hits = lists.filter(bl => {
        const mu = memberUids(bl)
        const byGid = G && gidOk(bl.account, G) && uidsOf(bl.account, G).some(u => mu.includes(u))
        const byUid = U && nick.includes(bl.account) && mu.includes(U)
        if (byUid && !byGid) bump('blocklist:same_nick_uid_only')
        return byGid || byUid
      }).sort(byNameId)
      const hit = hits[0]
      if (hit) {
        match = { kind: 'blocklist', id: hit.id, name: hit.name, note: `Thuộc danh sách Zalo ID loại trừ “${hit.name}”.` }
        bump(hit.account === account ? 'blocklist:own' : sameNick(account).includes(hit.account) ? 'blocklist:shared_nick' : 'blocklist:other_zalo')
      } else if (!G) need = true
    }
    // 2. Nhóm data
    if (!match) {
      const groups = M.groups.filter(g => (selection.dataGroupIds ?? []).includes(g.id) && g.purpose === 'data_group' && !g.deleted && g.org === M.org && ['phone', 'zalo_person'].includes(g.dataType))
      if (groups.length) {
        const hasPerson = groups.some(g => g.dataType === 'zalo_person')
        const hits = []
        for (const g of groups) {
          const ok = M.members.some(m => m.group === g.id && !m.deleted && M.contacts.some(c => c.id === m.contact && !c.deleted && (
            (c.type === 'phone' && phones.includes(c.uid) && ((c.account == null && c.org === M.org) || orgAccounts.some(a => a.id === c.account))) ||
            (c.type === 'person' && hasPerson && G && orgZalo.some(a => a.id === c.account) && gidOk(c.account, G) && uidsOf(c.account, G).includes(c.uid)) ||
            (c.type === 'person' && hasPerson && U && nick.includes(c.account) && c.uid === U && c.org === M.org))))
          if (ok) hits.push(g)
        }
        const hit = hits.sort(byNameId)[0]
        if (hit) {
          match = { kind: 'data_group', id: hit.id, name: hit.name, note: `Có trong Nhóm data “${hit.name}”.` }
          bump('data_group:' + hit.dataType)
          if (hit.dataType === 'phone' && !P) bump('data_group:phone_from_identity')
        } else {
          if (hasPerson && !G) need = true
          if (groups.some(g => g.dataType === 'phone') && !P && !G) need = true
        }
      }
    }
    // 3. chiến dịch đã gửi
    if (!match) {
      const camps = M.campaigns.filter(c => (selection.sentCampaignIds ?? []).includes(c.id) && c.staff === M.staff && c.org === M.org && c.id !== campaignId).sort((a, b) => a.id - b.id)
      const gidUids = G ? orgZalo.flatMap(a => uidsOf(a.id, G)).map(u => btrim(u).toLowerCase()).filter(Boolean) : []
      const cand = new Set([...gidUids, ...(U ? [U.toLowerCase()] : [])])
      for (const c of camps) {
        const inputs = M.inputs.filter(i => i.campaign === c.id)
        const ds = []
        for (const i of inputs) {
          const byPhone = i.phone != null && btrim(i.phone) !== '' && phones.includes(normalizePhone(i.phone))
          const iu = btrim(i.uid ?? '')
          const byUidRow = iu !== '' && cand.has(iu.toLowerCase())
          for (const d of M.details.filter(d => d.campaign === c.id && d.input === i.id && success(d))) {
            if (byPhone) { ds.push([d, 'phone']); continue }
            if (!byUidRow) continue
            const direct = U && nick.includes(d.account) && iu.toLowerCase() === U.toLowerCase()
            const viaGid = G && gidOk(d.account, G) && (btrim(d.data?.target?.globalId ?? '') === G ||
              M.zaloUsers.some(z => z.account === d.account && z.uid === iu && z.gid === G))
            if (direct || viaGid) ds.push([d, direct && !viaGid ? 'uid_same_nick' : 'global_id'])
            else bump('campaign:uid_candidate_rejected')
          }
        }
        if (!G) need = true
        if (ds.length) {
          const at = ds.map(([d]) => d.createdAt).sort().at(-1)
          match = { kind: 'campaign', id: c.id, name: c.name, note: `Đã được gửi ở chiến dịch “${c.name}” ngày ${vnDate(at)}.` }
          bump('campaign:' + ds[0][1])
          break
        }
      }
    }
    if (match) bump('gid_from:' + (from ?? 'none'))
    return { match, globalId: G, globalIdFrom: from, phone: P, needGlobalId: !match && need, unknown: !match && need && final ? UNKNOWN_NOTE : null }
  }
  return { rule, identity, gidOk }
}

// ---------------------------------------------------------------------------------------------------------- thế giới ngẫu nhiên
let seq = 6_000_000
const id = () => ++seq

function makeWorld(R, round) {
  const pick = arr => arr[Math.floor(R() * arr.length)]
  const chance = p => R() < p
  const digits = n => { let s = String(1 + Math.floor(R() * 9)); while (s.length < n) s += Math.floor(R() * 10); return s }
  const gid32 = () => { const al = 'abcdefghijklmnopqrstuvwxyz0123456789'; let s = ''; for (let i = 0; i < 32; i++) s += al[Math.floor(R() * al.length)]; return s }
  const usedUids = new Set()
  const freshUid = () => { let u; do u = digits(pick([19, 19, 19, 18, 17])); while (usedUids.has(u)); usedUids.add(u); return u }
  const org = 88000 + round, otherOrg = 89000 + round
  const staff = 8800000 + round * 10, staff2 = staff + 1, otherStaff = staff + 2
  const M = { org, staff, staff2, otherOrg, otherStaff, accounts: [], zaloUsers: [], contacts: [], groups: [], members: [], campaigns: [], inputs: [], details: [], persons: [], nicks: {} }
  // Người thật. SĐT duy nhất theo vòng (một phần đầu số mới có dạng 11 số cũ); Global ID duy nhất; tên riêng.
  const usedPhones = new Set()
  for (let i = 0; i < PERSONS; i++) {
    const onZalo = chance(0.9)
    let phone = null
    if (!onZalo || chance(0.75)) {
      do phone = (chance(0.3) ? pick(Object.keys(OLD_PREFIX)) + digits(7) : '09' + digits(8)); while (usedPhones.has(phone) || !mobile(phone))
      usedPhones.add(phone)
    }
    M.persons.push({ i, onZalo, phone, gid: onZalo ? gid32() : null, name: `Người ${round}-${i} ${digits(3)}` })
  }
  // Nick Zalo: N0 dùng chung cho A và A2 (cùng nhân viên), N1 cho B và D (D đã xoá), N2 cho C (nhân viên khác), N3 cho X (tổ chức khác),
  // N4 cho E (đổi từ nick N5 sang, còn dòng zalo_users cũ của N5). Global ID của nick ghi ở zalo_accounts / chat_zalo_account / cả hai
  // (có thể khác nhau) / không ở đâu ('none').
  const mkNick = (key, storage) => {
    const own = gid32()
    const recorded = storage === 'both' ? [own, gid32()] : storage === 'none' ? [] : [own]
    M.nicks[key] = { key, uid: digits(19), own, recorded, storage, zaId: id(), chatId: id() }
    return M.nicks[key]
  }
  mkNick('N0', pick(['za', 'za', 'both'])); mkNick('N1', pick(['za', 'none'])); mkNick('N2', pick(['za', 'chat', 'both', 'none']))
  mkNick('N3', pick(['za', 'chat'])); mkNick('N4', pick(['za', 'chat'])); mkNick('N5', 'none')
  // Người là chủ nick N2 (có thể là người nhận ở nick khác).
  if (chance(0.5)) M.persons[0].gid = M.nicks.N2.own
  const acc = (key, nick, extra) => {
    const n = M.nicks[nick]
    const a = { id: id(), key, nick, za: !!n && ['za', 'both'].includes(n.storage), chatLinked: false, platform: 'zalo', org, staff, deleted: false, ...extra }
    // Fly: mỗi nick mỗi tổ chức một liên kết chat (tài khoản đầu tiên của nick).
    if (n && ['chat', 'both'].includes(n.storage) && !M.accounts.some(b => b.nick === nick && b.org === a.org && b.chatLinked)) a.chatLinked = true
    M.accounts.push(a); return a
  }
  const A = acc('A', 'N0'), A2 = acc('A2', 'N0'), B = acc('B', 'N1'), D = acc('D', 'N1', { deleted: true }), C = acc('C', 'N2', { staff: staff2 })
  const X = acc('X', 'N3', { org: otherOrg, staff: otherStaff })
  const E = acc('E', 'N4')
  const FB = acc('FB', null, { platform: 'facebook' })
  // Zalo ID riêng theo (nick, người, phiên bản). Trùng chuỗi Zalo ID giữa các nick (người khác nhau) có thật trên production.
  const versions = {} // nick:i → [uid...]
  const owner = new Map() // nick|uid → người
  const allUids = []
  for (const nick of ['N0', 'N1', 'N2', 'N3', 'N4', 'N5']) {
    const inNick = new Set()
    for (const p of M.persons) {
      if (!p.onZalo || !chance(0.7)) continue
      const n = chance(0.25) ? 1 + Math.floor(R() * 3) : 1
      versions[nick + ':' + p.i] = Array.from({ length: n }, () => {
        let u
        const reuse = allUids.filter(x => !inNick.has(x.uid) && x.nick !== nick)
        if (reuse.length && chance(0.08)) { u = pick(reuse).uid; bump('world:uid_collision') } else u = freshUid()
        inNick.add(u); allUids.push({ uid: u, nick }); owner.set(nick + '|' + u, p.i); return u
      })
    }
  }
  const ownerOf = (account, uid) => owner.get(account.nick + '|' + btrim(uid))
  if (M.persons[0].gid === M.nicks.N2.own) delete versions['N2:0']
  // zalo_users: dòng đúng (Global ID của người; đôi khi trống; đổi tên giữa các phiên bản), dòng ghi sai (Global ID của chính nick, ghi
  // khi quét thành viên nhóm), dòng cũ của nick trước (E).
  const junkAccounts = new Set([A, A2, B, C, E].filter(() => chance(0.6)).map(a => a.id))
  for (const a of M.accounts.filter(a => a.platform === 'zalo')) {
    const nick = M.nicks[a.nick]
    // Global ID người xem mà Zalo ghi vào: Global ID của nick mà DB biết cho tài khoản này; không biết thì Global ID thật của nick.
    const known = ownGidsOf(M, a)
    const viewerGids = known.length ? known : [nick.own]
    const pending = []
    for (const p of M.persons) {
      const vs = versions[a.nick + ':' + p.i]
      if (!vs) continue
      vs.forEach((u, v) => {
        if (!chance(0.8)) return
        const junk = junkAccounts.has(a.id) && chance(0.3)
        const row = { id: id(), account: a.id, uid: u, gid: junk ? pick(viewerGids) : chance(0.05) ? '' : p.gid, zaloName: v > 0 && chance(0.1) ? p.name + ' mới' : p.name, junk }
        pending.push(row)
      })
    }
    // Nick không ghi Global ID ở đâu: dòng ghi sai chỉ nhận ra được khi có từ 2 dòng (mỗi dòng một tên); 1 dòng thì đổi thành dòng đúng.
    const junkRows = pending.filter(r => r.junk)
    if (!known.length && junkRows.length === 1) { const r = junkRows[0]; r.gid = M.persons[owner.get(a.nick + '|' + r.uid)].gid; r.junk = false }
    M.zaloUsers.push(...pending)
    if (pending.some(r => r.junk)) bump('world:junk_own_gid:' + (known.length ? 'known' : 'unknown'))
  }
  // E: còn 4–7 dòng của nick cũ N5 (Global ID của N5, người khác nhau), Zalo ID theo không gian N5.
  { const ps = M.persons.filter(p => versions['N5:' + p.i]).slice(0, 4 + Math.floor(R() * 4))
    for (const p of ps) { const u = versions['N5:' + p.i][0]; if (!M.zaloUsers.some(z => z.account === E.id && z.uid === u)) M.zaloUsers.push({ id: id(), account: E.id, uid: u, gid: M.nicks.N5.own, zaloName: p.name, junk: true, oldNick: 'N5' }) }
    if (ps.length) bump('world:old_nick_rows') }
  const known = (a, p) => M.zaloUsers.filter(z => z.account === a.id && !z.oldNick && owner.get(a.nick + '|' + z.uid) === p.i).map(z => z.uid)
  const anyVersion = (a, p) => versions[a.nick + ':' + p.i] ?? []
  const fmt = ph => {
    const old = OLD_PREFIX[ph.slice(0, 3)] && ph.length === 10 ? OLD_PREFIX[ph.slice(0, 3)] + ph.slice(3) : null
    return pick([ph, ph, ph, '+84' + ph.slice(1), '84' + ph.slice(1), '0084' + ph.slice(1), ph.slice(0, 4) + ' ' + ph.slice(4, 7) + ' ' + ph.slice(7),
      ph.slice(0, 4) + '.' + ph.slice(4, 7) + '.' + ph.slice(7), '(+84) ' + ph.slice(1, 4) + '-' + ph.slice(4, 7) + '-' + ph.slice(7), ph.slice(1),
      ' ' + ph + ' ', 'O' + ph.slice(1), ph + ' (Zalo)', 'SĐT: ' + ph, ...(old ? [old, old, '+84' + old.slice(1)] : [])])
  }
  const camp = (a, extra = {}) => { const c = { id: id(), name: 'c' + Math.floor(R() * 2), staff: a.staff, org: a.org, account: a.id, deleted: false, action: 'zalo_message_friend', ...extra }; M.campaigns.push(c); return c }
  const daysAgo = n => new Date(Date.now() - n * 86400_000 - Math.floor(R() * 86400_000)).toISOString()
  const detail = (c, input, account, action, status, data, extra = {}) => M.details.push({ id: id(), campaign: c.id, input: input?.id ?? null, account, action, status, data,
    opState: null, deleted: false, createdAt: daysAgo(Math.floor(R() * 40)), staff: c.staff, org: c.org, ...extra })

  // Lịch sử Tìm SĐT: có lần cũ ra Global ID khác, lần lỗi, Global ID trống, lần trả Global ID của chính nick tra số.
  const lookupCamp = camp(B, { name: 'tra-so', action: 'zalo_message_phone' })
  for (const p of M.persons.filter(p => p.phone && p.gid)) {
    if (!chance(0.75)) continue
    const acct = pick([A, B, C, X, E])
    if (chance(0.15)) detail(lookupCamp, null, acct.id, 'zalo_find_phone_user', 'thành công', { target: { phone: fmt(p.phone), globalId: gid32() } })
    if (chance(0.1)) detail(lookupCamp, null, acct.id, 'zalo_find_phone_user', 'thất bại', { target: { phone: fmt(p.phone), globalId: gid32() } })
    detail(lookupCamp, null, acct.id, 'zalo_find_phone_user', 'thành công', { target: { phone: fmt(p.phone), globalId: chance(0.06) ? '' : p.gid } })
    const lastAcct = M.accounts.find(a => a.id === acct.id)
    if (chance(0.08) && ownGidsOf(M, lastAcct).length) {
      detail(lookupCamp, null, acct.id, 'zalo_find_phone_user', 'thành công', { target: { phone: fmt(p.phone), globalId: ownGidsOf(M, lastAcct)[0] } })
      bump('world:lookup_own_gid')
    }
  }
  // SĐT đổi chủ (--recycle): lần tra cuối ra Global ID của chủ cũ, chủ mới chưa ai tra.
  if (RECYCLE) for (const p of M.persons.filter(p => p.phone && p.gid && chance(0.08))) {
    const prev = pick(M.persons.filter(q => q.gid && q.i !== p.i))
    p.recycledFrom = prev.i
    detail(lookupCamp, null, B.id, 'zalo_find_phone_user', 'thành công', { target: { phone: fmt(p.phone), globalId: prev.gid } })
    bump('world:recycled_phone')
  }

  const contact = (account, type, uid, extra = {}) => { const c = { id: id(), account: account?.id ?? null, org: account?.org ?? org, type, uid, deleted: chance(0.05), ...extra }; M.contacts.push(c); return c }
  const group = extra => { const g = { id: id(), name: 'g' + Math.floor(R() * 3), deleted: false, staff, org, ...extra }; M.groups.push(g); return g }
  const member = (g, c) => M.members.push({ id: id(), group: g.id, contact: c.id, deleted: chance(0.05) })
  const somePersons = n => Array.from({ length: n }, () => pick(M.persons))

  // Danh sách Zalo ID (liên hệ của tài khoản; Zalo ID có thể là dòng ghi sai ở zalo_users, hoặc không có dòng).
  const lists = []
  for (const [a, extra] of [[A, {}], [A2, {}], [B, {}], [D, {}], [E, {}], [B, { deleted: true }], [C, { staff: staff2 }], [X, { staff: otherStaff, org: otherOrg }]]) {
    const bl = group({ purpose: 'zalo_friend_blocklist', account: a.id, ...extra })
    for (const p of somePersons(5)) { const us = chance(0.85) ? known(a, p) : anyVersion(a, p); if (us.length) member(bl, contact(a, 'person', pick(us))) }
    lists.push(bl)
  }
  // Nhóm data SĐT (liên hệ không gắn tài khoản, hoặc gắn tài khoản bất kỳ của tổ chức kể cả Facebook) và Zalo UID.
  const dgs = []
  for (let k = 0; k < 2; k++) {
    const g = group({ purpose: 'data_group', dataType: 'phone' })
    for (const p of somePersons(6)) if (p.phone) member(g, contact(chance(0.5) ? null : pick([A, B, FB, D, E]), 'phone', p.phone))
    dgs.push(g)
  }
  for (let k = 0; k < 3; k++) {
    const g = group({ purpose: 'data_group', dataType: 'zalo_person' })
    for (const p of somePersons(6)) { const a = pick([A, A2, B, C, D, E]); const us = chance(0.85) ? known(a, p) : anyVersion(a, p); if (us.length) member(g, contact(a, 'person', pick(us))) }
    dgs.push(g)
  }
  { const g = group({ purpose: 'data_group', dataType: 'phone', deleted: true }); for (const p of somePersons(3)) if (p.phone) member(g, contact(null, 'phone', p.phone)); dgs.push(g) }
  { const g = group({ purpose: 'data_group', dataType: 'phone', org: otherOrg, staff: otherStaff }); for (const p of somePersons(3)) if (p.phone) member(g, contact(X, 'phone', p.phone)); dgs.push(g) }
  // Chiến dịch đã gửi: kết quả nhắn tin thành công / lỗi / đã xoá / chỉ tra số / không có kết quả; Global ID trong kết quả có khi thiếu
  // hoặc là của chính nick đã gửi.
  const sents = []
  for (const [a, extra] of [[B, {}], [A2, {}], [A, {}], [C, { staff: staff2 }], [B, { deleted: true }], [D, {}], [E, {}], [X, { staff: otherStaff, org: otherOrg }]]) {
    const c = camp(a, { action: pick(['zalo_message_phone', 'zalo_message_friend', 'zalo_message_group_member']), ...extra })
    for (const p of somePersons(7)) {
      const us = chance(0.85) ? known(a, p) : anyVersion(a, p)
      const usePhone = p.phone && (us.length === 0 || chance(0.5))
      const useUid = us.length && (!usePhone || chance(0.5))
      if (!usePhone && !useUid) continue
      const u = useUid ? pick(us) : null
      const input = { id: id(), campaign: c.id, phone: usePhone ? fmt(p.phone) : null, uid: u == null ? null : chance(0.1) ? ' ' + u + ' ' : u, deleted: chance(0.05), person: p.i }
      M.inputs.push(input)
      const kind = R()
      const action = pick(['zalo_message_friend', 'zalo_message_stranger'])
      const nickRec = ownGidsOf(M, a)
      const tg = chance(0.2) ? undefined : chance(0.06) && nickRec.length ? nickRec[0] : p.gid
      if (kind < 0.45) detail(c, input, a.id, action, 'thành công', { target: { uid: u, globalId: tg } })
      else if (kind < 0.55) detail(c, input, a.id, action, 'thất bại', { target: { uid: u } }, { opState: 'committed' })
      else if (kind < 0.62) detail(c, input, a.id, action, 'thất bại', { target: { uid: u } })
      else if (kind < 0.68) detail(c, input, a.id, action, 'thành công', {}, { deleted: true })
      else if (kind < 0.76) detail(c, input, a.id, 'zalo_find_phone_user', 'thành công', { target: { phone: input.phone, globalId: p.gid } })
      else if (kind < 0.84) detail(c, input, a.id, action, 'đã xem', {})
      else if (kind < 0.9) detail(c, input, a.id, action, 'thành công', { target: { uid: u, globalId: p.gid } }, { opState: 'unknown' })
      // còn lại: chưa có kết quả
    }
    sents.push(c)
  }
  // Chiến dịch đang chạy trên A: data theo SĐT (nhiều cách viết) / Zalo ID ở A (dòng đúng, dòng ghi sai, chưa có dòng) / cả hai / Zalo
  // ID có khoảng trắng / là SĐT / là link / rỗng / số bàn / SĐT rác. Lựa chọn chỉ gồm nguồn lưu được; nguồn "đã xoá" xoá SAU khi lưu.
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
    const us = anyVersion(A, p)
    const t = R()
    let phone = null, uid = null
    if (t < 0.3 && p.phone) phone = fmt(p.phone)
    else if (t < 0.55 && us.length) uid = pick(us)
    else if (t < 0.68 && p.phone && us.length) { phone = fmt(p.phone); uid = pick(us) }
    else if (t < 0.72 && us.length) uid = pick([' ', '  ']) + pick(us) + ' '
    else if (t < 0.76 && p.onZalo) uid = freshUid()                                   // Zalo ID mà A chưa ghi
    else if (t < 0.79) phone = pick(['028' + digits(8), '1900' + digits(4), '', '   ', 'abc', '0', 'null', '09' + digits(20), '０９１２３４５６７８'])
    else if (t < 0.81) uid = pick(['', '   ', p.phone ?? digits(10), 'https://www.facebook.com/groups/' + digits(15) + '/'])
    else if (t < 0.83 && p.phone) { phone = fmt(p.phone); uid = pick([' ', '']) }
    else if (p.phone) phone = fmt(p.phone)
    else if (us.length) uid = pick(us)
    else uid = freshUid()
    targets.push({ person: p.i, phone, uid })
  }
  return { M, A, A2, B, C, D, E, X, FB, sel, targets, owner, ownerOf, lists, dgs, sents }
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
  const info = { truthMissed: 0, truthMissReasons: {}, recycledFalse: 0, excludedA: 0, excludedB: 0, unknownB: 0, rows: 0, claims: 0 }
  const fail = (round, what, detail) => { problems.push({ round, what, detail }); if (problems.length <= 30) console.log(`  ✗ vòng ${round}: ${what} ${JSON.stringify(detail).slice(0, 1500)}`) }
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
      const nicksUsed = Object.values(M.nicks)
      await ins('zalo_accounts', nicksUsed.filter(n => ['za', 'both'].includes(n.storage)).map(n => ({ id: n.zaId, zalo_uid: n.uid, metadata: { globalId: n.recorded[0] } })))
      await ins('chat_zalo_account', nicksUsed.filter(n => ['chat', 'both'].includes(n.storage)).map(n => ({ id: n.chatId, zalo_id: n.uid, global_id: n.recorded.at(-1) })))
      await ins('auto_accounts', M.accounts.map(a => ({ id: a.id, name: 'Zalo ' + a.key, flatform_type: a.platform, login_status: 'đã đăng nhập', status: 'chờ xử lý',
        is_active: true, is_delete: false, staff_id: a.staff, organization_id: a.org, is_zalo_server: false, is_zalo_show_web: false,
        zalo_account_id: a.za ? M.nicks[a.nick].zaId : null })))
      await ins('chat_zalo_account_organization', M.accounts.filter(a => a.chatLinked).map(a => ({ id: id(), chat_zalo_account_id: M.nicks[a.nick].chatId,
        organization_id: a.org, auto_account_id: a.id, is_active: true })))
      await ins('zalo_users', M.zaloUsers.map(z => { const a = M.accounts.find(x => x.id === z.account); return { id: z.id, account_id: z.account, zalo_uid: z.uid, global_id: z.gid,
        zalo_name: z.zaloName, staff_id: a.staff, organization_id: a.org, is_fr: 0 } }))
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
      // Hàm Global ID dùng được: so với bản tính cho mọi cặp (tài khoản, Global ID) có trong zalo_users + Global ID của người.
      const pairs = new Map()
      for (const z of M.zaloUsers) if (z.gid) pairs.set(z.account + '|' + z.gid, [z.account, z.gid])
      for (const p of M.persons.filter(p => p.gid)) for (const a of M.accounts) pairs.set(a.id + '|' + p.gid, [a.id, p.gid])
      // Bản V657 cũ (chạy để đối chứng) chưa có hàm này.
      const hasGidOk = (await one(`SELECT to_regprocedure('private.aka_agent_zalo_gid_ok(bigint,text)') IS NOT NULL r`)).r
      const okRows = !hasGidOk ? [] : await q(`SELECT x.a, x.g, private.aka_agent_zalo_gid_ok(x.a, x.g) ok FROM jsonb_to_recordset($1::jsonb) x(a bigint, g text)`, [JSON.stringify([...pairs.values()].map(([a, g]) => ({ a, g })))])
      for (const r of okRows) {
        const exp = O.gidOk(Number(r.a), r.g)
        if (r.ok !== exp) fail(round, 'gid_ok', { account: M.accounts.find(a => a.id === Number(r.a))?.key, exp, got: r.ok, rows: M.zaloUsers.filter(z => z.account === Number(r.a) && z.gid === r.g).length })
        // Sự thật: Global ID dùng được thì mọi dòng của nó ở tài khoản đó là cùng một người, và là người có Global ID đó.
        if (r.ok) {
          const a = M.accounts.find(x => x.id === Number(r.a))
          const owners = new Set(M.zaloUsers.filter(z => z.account === a.id && z.gid === r.g).map(z => z.oldNick ? 'old:' + z.uid : W.owner.get(a.nick + '|' + z.uid)))
          const real = M.persons.find(p => p.gid === r.g)
          if (owners.size > 1 || (owners.size === 1 && (!real || ![...owners].every(o => o === real.i)))) fail(round, 'gid_ok nhận Global ID ghi sai', { account: a.key, owners: [...owners], real: real?.i })
        }
      }

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
      await db.query(`UPDATE public.auto_accounts SET is_delete=true WHERE id = ANY($1)`, [M.accounts.filter(a => a.deleted).map(a => a.id)])
      await db.query(`UPDATE public.auto_account_contact_groups SET is_delete=true WHERE id = ANY($1)`, [M.groups.filter(g => g.deleted).map(g => g.id)])
      await db.query(`UPDATE public.auto_campaigns SET is_delete=true WHERE id = ANY($1)`, [M.campaigns.filter(c => c.deleted).map(c => c.id)])
      const matchSql = `SELECT private.aka_agent_send_exclusion_match(c, $2::bigint, c.extra_settings->'zaloSendExclusionsByAccountId'->($2::bigint::text), $3::text, $4::text, $5::text, $6::boolean) m
        FROM public.auto_campaigns c WHERE c.id=$1`
      const norm = m => m && ({ kind: m.kind, id: Number(m.id), note: m.note })
      const expA = new Map(), expB = new Map()
      const ownA = ownGidsOf(M, A)
      for (const r of main.rows) {
        info.rows++
        const p = M.persons[r.person]
        // Global ID người nhận gửi về sau tra số / đọc hồ sơ: của người, đôi khi là của chính nick đang gửi (Zalo trả nhầm).
        const remoteGid = p.gid && ownA.length && (r.id % 17 === 0) ? ownA[0] : p.gid
        const ea = O.rule({ account: A.id, selection: W.sel, phone: r.phone, gid: null, uid: r.uid, final: false, campaignId: main.c.id })
        const eb = O.rule({ account: A.id, selection: W.sel, phone: r.phone, gid: remoteGid, uid: r.uid, final: true, campaignId: main.c.id })
        expA.set(r.id, ea); expB.set(r.id, eb)
        const ga = (await one(matchSql, [main.c.id, A.id, r.phone, null, r.uid, false])).m
        const gb = (await one(matchSql, [main.c.id, A.id, r.phone, remoteGid, r.uid, true])).m
        for (const [stage, e, g] of [['A', ea, ga], ['B', eb, gb]]) {
          const got = { match: norm(g.match), globalId: g.globalId ?? null, needGlobalId: !!g.needGlobalId, unknown: g.unknown ?? null }
          const exp = { match: norm(e.match), globalId: e.globalId, needGlobalId: e.needGlobalId, unknown: e.unknown }
          if (JSON.stringify(got) !== JSON.stringify(exp)) fail(round, `match bước ${stage}`, { row: r, person: p.i, exp, got })
        }
        if (ea.match) info.excludedA++
        if (eb.match) info.excludedB++
        if (eb.unknown) info.unknownB++
        const recycled = p.recycledFrom != null && r.phone && mobile(r.phone) === p.phone
        if (ga.match && !gb.match) {
          if (recycled) info.recycledFalse++
          else fail(round, 'bước A loại mà bước B không loại', { row: r, person: p.i, a: ga.match, b: gb })
        }
        // Chấm "sự thật" trên kết quả của DB (không phải bản tính).
        for (const [stage, e] of [['A', { match: norm(ga.match), globalIdFrom: ga.globalIdFrom }], ['B', { match: norm(gb.match), globalIdFrom: gb.globalIdFrom }]]) {
          if (!e.match) continue
          const t = truthOf(W, e.match)
          const ok = t.persons.has(p.i) || (mobile(r.phone ?? '') && t.phones.has(mobile(r.phone))) || (btrim(r.uid) && W.ownerOf(A, r.uid) != null && t.persons.has(W.ownerOf(A, r.uid)))
          if (!ok) { if (recycled) info.recycledFalse++; else fail(round, `loại nhầm người (bước ${stage})`, { row: r, person: p.i, match: e.match, from: e.globalIdFrom }) }
        }
        if (!eb.match && p.onZalo) {
          const why = truthShouldExclude(W, p)
          if (why) {
            info.truthMissed++; info.truthMissReasons[why] = (info.truthMissReasons[why] ?? 0) + 1
            // Vẫn gửi (không unknown): ghi lại để xem dữ liệu thiếu gì.
            if (!eb.unknown) { info.truthMissedSent = (info.truthMissedSent ?? 0) + 1; if ((info.missSamples ??= []).length < 6) info.missSamples.push({ why, person: p.i, phone: r.phone, uid: r.uid, round }) }
          }
        }
        const rm = (await one(`SELECT private.aka_agent_send_exclusion_remote(c, $2::bigint, $3::bigint, $4::jsonb) r FROM public.auto_campaigns c WHERE c.id=$1`,
          [main.c.id, A.id, r.id, { globalId: remoteGid }])).r
        const rmGot = { match: norm(rm.match), unknown: rm.unknown ?? null }
        const rmExp = { match: norm(eb.match), unknown: eb.unknown }
        if (JSON.stringify(rmGot) !== JSON.stringify(rmExp)) fail(round, 'remote', { row: r, exp: rmExp, got: rmGot })
      }

      // -------------------------------------------------------------- 2. preview theo chiến dịch và theo danh sách data
      const validSel = { groupId: null,
        blocklistIds: W.sel.blocklistIds.filter(i => { const g = M.groups.find(x => x.id === i); return !g.deleted && g.staff === M.staff && g.org === M.org && !M.accounts.find(a => a.id === g.account).deleted }),
        dataGroupIds: W.sel.dataGroupIds.filter(i => { const g = M.groups.find(x => x.id === i); return !g.deleted && g.org === M.org }),
        sentCampaignIds: W.sel.sentCampaignIds.filter(i => { const c = M.campaigns.find(x => x.id === i); return c.staff === M.staff && c.org === M.org && !c.deleted }) }
      const previewExp = (rows, trunc) => {
        const e = { checked: rows.length, excluded: 0, pending: 0, sources: {} }
        for (const r of rows) {
          const x = O.rule({ account: A.id, selection: validSel, phone: trunc ? r.phone?.slice(0, 40) : r.phone, gid: null, uid: trunc ? r.uid?.slice(0, 64) : r.uid, final: false, campaignId: main.c.id,
            noIdentity: trunc && process.env.SX_WITH_V666 === '1' })
          if (x.match) { e.excluded++; const k = x.match.kind + ':' + x.match.id; e.sources[k] = (e.sources[k] ?? 0) + 1 } else if (x.needGlobalId) e.pending++
        }
        return e
      }
      for (const mode of ['campaign', 'targets']) {
        const exp = previewExp(main.rows, mode === 'targets')
        let acc = { checked: 0, excluded: 0, pending: 0, sources: {} }, after = null
        for (let page = 0; page < 40; page++) {
          const payload = { accountId: A.id, selection: validSel, afterId: after, limit: 37, ...(mode === 'campaign' ? { campaignId: main.c.id } : { targets: W.targets.map(t => ({ phone: t.phone, uid: t.uid })) }) }
          let res
          try { res = (await one(`SELECT public.aka_agent_send_exclusion_v2($1, $2, 'preview', $3, $4, 'pw') r`, [M.staff, M.org, payload, 'f' + M.staff])).r }
          catch (e) { fail(round, 'preview lỗi', { mode, error: e.message, validSel }); break }
          acc.checked += res.checked; acc.excluded += res.excluded; acc.pending += res.pending
          for (const s of res.sources) { const k = s.kind + ':' + s.id; acc.sources[k] = (acc.sources[k] ?? 0) + s.count }
          if (res.nextAfterId == null) break
          after = res.nextAfterId
        }
        if (JSON.stringify(sortObj(acc)) !== JSON.stringify(sortObj(exp))) fail(round, 'preview', { mode, exp, got: acc })
      }

      // -------------------------------------------------------------- 3. bước nhận data của engine v2
      const asDesktop = async fn => {
        await db.query('BEGIN')
        try { await db.query(`SELECT set_config('test.desktop_staff', $1, true)`, [String(M.staff)]); await db.query('SET LOCAL ROLE aka_agent_desktop'); const o = await fn(); await db.query('COMMIT'); return o }
        catch (e) { await db.query('ROLLBACK'); throw e }
      }
      await db.query(`UPDATE public.auto_campaigns SET status='hoàn thành' WHERE id = ANY($1)`, [[main.c.id, old.c.id]])
      const claimedOrder = [], paused = new Map()
      for (let k = 0; k < ROWS * 2 + 20; k++) {
        const res = await asDesktop(async () => (await one('SELECT public.aka_agent_engine_claim_target_v1($1) r',
          [{ staffId: M.staff, accountId: A.id, campaignId: eng.c.id, runnerId: 'desktop:fuzz', runtimeTarget: 'desktop', sendExclusionRunner: 1, actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }] }])).r)
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
      if (JSON.stringify(claimedOrder) !== JSON.stringify(expClaimed)) fail(round, 'claim: data được nhận', { exp: expClaimed.length, got: claimedOrder.length })
      if (JSON.stringify([...paused].sort()) !== JSON.stringify([...expPaused].sort())) fail(round, 'claim: data bị loại', { exp: expPaused.size, got: paused.size })
      const dbPaused = await q(`SELECT id, status, note FROM public.auto_campaign_input_data WHERE campaign_id=$1 AND status='tạm dừng' ORDER BY id`, [eng.c.id])
      if (JSON.stringify(dbPaused.map(r => [Number(r.id), r.note])) !== JSON.stringify([...expPaused].sort((a, b) => a[0] - b[0]))) fail(round, 'claim: dòng tạm dừng trong DB', { n: dbPaused.length })

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
        `B unknown ${[...expB.values()].filter(e => e.unknown).length}, claim ${claimedOrder.length} nhận / ${paused.size} loại, gid_ok ${okRows.length} cặp, lỗi ${problems.filter(p => p.round === round).length}`)
    }
  } finally { await T.stop() }
  console.log('\nTheo dõi:', JSON.stringify(info))
  console.log('Độ phủ:', JSON.stringify(Object.fromEntries(Object.entries(cov).sort())))
  const byType = {}
  for (const p of problems) byType[p.what] = (byType[p.what] ?? 0) + 1
  if (problems.length) console.log('Lỗi theo loại:', JSON.stringify(byType))
  console.log(problems.length ? `\n${problems.length} LỖI` : '\nSẠCH: 0 lỗi')
  if (problems.length) process.exit(1)
}
function sortObj(o) { return { ...o, sources: Object.fromEntries(Object.entries(o.sources).sort()) } }

/** Sự thật của một nguồn: người (theo ai là chủ Zalo ID / SĐT) và SĐT (theo quy tắc "cùng SĐT là cùng người"). */
function truthOf(W, match) {
  const { M } = W
  const persons = new Set(), phones = new Set()
  if (!match) return { persons, phones }
  if (match.kind === 'blocklist' || match.kind === 'data_group') {
    for (const m of M.members.filter(m => m.group === match.id && !m.deleted)) {
      const c = M.contacts.find(c => c.id === m.contact && !c.deleted)
      if (!c) continue
      if (c.type === 'phone') { phones.add(c.uid); const o = M.persons.find(p => p.phone === c.uid); if (o) persons.add(o.i) }
      else { const a = M.accounts.find(a => a.id === c.account); const o = a && W.ownerOf(a, c.uid); if (o != null) persons.add(o) }
    }
  } else {
    const success = d => ['zalo_message_friend', 'zalo_message_stranger'].includes(d.action) && !d.deleted &&
      (d.opState === 'committed' || (d.opState == null && SUCCESS_STATUS.includes(d.status)))
    for (const i of M.inputs.filter(i => i.campaign === match.id)) {
      if (!M.details.some(d => d.input === i.id && success(d))) continue
      persons.add(i.person)
      const ph = mobile(i.phone ?? ''); if (ph) phones.add(ph)
    }
  }
  return { persons, phones }
}
/** Lý do (để theo dõi) nếu theo sự thật người p thuộc một nguồn đã chọn mà quy tắc không nhận ra. */
function truthShouldExclude(W, p) {
  const { M, sel } = W
  for (const id of sel.blocklistIds) { const g = M.groups.find(g => g.id === id); if (!g.deleted && g.staff === M.staff && g.org === M.org && truthOf(W, { kind: 'blocklist', id }).persons.has(p.i)) return 'blocklist' }
  for (const id of sel.dataGroupIds) { const g = M.groups.find(g => g.id === id); if (!g.deleted && g.org === M.org && truthOf(W, { kind: 'data_group', id }).persons.has(p.i)) return 'data_group:' + g.dataType }
  for (const id of sel.sentCampaignIds) { const c = M.campaigns.find(c => c.id === id); if (c.staff === M.staff && c.org === M.org && truthOf(W, { kind: 'campaign', id }).persons.has(p.i)) return 'campaign' }
  return null
}

main().catch(e => { console.error(e); process.exit(1) })
