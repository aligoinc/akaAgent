#!/usr/bin/env node
// Một vòng kiểm thử ngẫu nhiên V679 (chặn danh sách quét bằng tài khoản khác) + V680 (thông báo tạm dừng bật sẵn).
// Dựng cụm PG cục bộ, nạp fixture.sql (bảng + hàm thật production 27/11/2026) rồi V679, V680; sinh dữ liệu ngẫu nhiên có chủ ý
// sai lệch (khoảng trắng Unicode, đuôi _0, UID trùng chuỗi giữa tài khoản, tài khoản cùng nick, payload sai kiểu…) và so kết quả
// của hàm DB với mô hình viết độc lập bằng JS dưới đây.
// Chạy: PG_MODULE_DIR=<thư mục có node_modules/pg> node scripts/zalo-uid-account-guard/fuzz-round.cjs --seed 1 [--checks 600]
// Tuỳ chọn --pool <file JSON>: mẫu UID / ghi chú thật đã che (không nằm trong repo), trộn vào dữ liệu sinh.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { startCluster, ROOT } = require('./pgcluster.cjs')

const args = process.argv.slice(2)
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const SEED = Number(argOf('--seed', '1'))
const CHECKS = Number(argOf('--checks', '600'))
const POOL = argOf('--pool', null) ? JSON.parse(fs.readFileSync(argOf('--pool'), 'utf8')) : null

// ---------- ngẫu nhiên có hạt giống ----------
function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const rnd = mulberry32(SEED * 7919 + 13)
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = arr => arr[Math.floor(rnd() * arr.length)]
const chance = p => rnd() < p
const shuffle = arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[a[i], a[j]] = [a[j], a[i]] } return a }
const digits = n => { let s = String(ri(1, 9)); while (s.length < n) s += String(ri(0, 9)); return s }

// ---------- mô hình (ý định, viết độc lập với SQL) ----------
const WS = /[\s\u200b]+/g // khoảng trắng Unicode (như \s của JS) + zero-width space
const normUid = v => { const s = String(v ?? '').replace(WS, '').replace(/_0$/, ''); return s === '' ? null : s }
const trimAllWs = s => String(s).replace(/^[\s]+|[\s]+$/g, '')
const userPauseNote = note => {
  if (note === null || note === undefined) return true
  const t = trimAllWs(note)
  return t === '' || t === 'Chờ data phù hợp' || t === 'Chờ data mới' || t.startsWith('Đang chờ tạm dừng')
}
const UID_ACTIONS = new Set(['zalo_message_group_member', 'zalo_message_friend', 'zalo_message_remarketing_customer', 'zalo_cancel_sent_friend_request'])

const failures = []
let checks = 0
const cov = {}
const hit = (k, n = 1) => { cov[k] = (cov[k] || 0) + n }
function fail(kind, detail) { failures.push({ kind, ...detail }); if (failures.length <= 15) console.log('  ✗', kind, JSON.stringify(detail).slice(0, 900)) }

// ---------- thế giới ----------
function buildWorld() {
  const W = { orgs: [], staff: [], accounts: [], zaloAccounts: [], chatAccounts: [], chatLinks: [], users: [], campaigns: [], rows: [] }
  let accId = 100, staffId = 10, zaId = 1, chatId = 1, userId = 1, campId = 1000, rowId = 1
  const nOrg = ri(2, 4)
  const nickPool = Array.from({ length: 6 }, () => digits(18))
  for (let o = 1; o <= nOrg; o++) {
    W.orgs.push({ id: o })
    for (let s = 0; s < ri(1, 3); s++) {
      const st = { id: staffId++, organization_id: o, is_active: !chance(0.05), deleted_at: chance(0.04) ? new Date().toISOString() : null }
      W.staff.push(st)
      for (let a = 0; a < ri(1, 5); a++) {
        const acc = { id: accId++, name: `acc ${accId}` + (chance(0.2) ? ' "Ngọc"\'s' : ''), staff_id: chance(0.95) ? st.id : pick(W.staff).id,
          organization_id: o, flatform_type: chance(0.9) ? (chance(0.1) ? ' Zalo ' : 'zalo') : 'facebook', is_delete: chance(0.08), zalo_account_id: null }
        // nick: một số tài khoản dùng chung nick (Desktop QR + Server, hoặc bản Fly qua chat_zalo_account)
        if (acc.flatform_type.trim().toLowerCase() === 'zalo') {
          if (chance(0.7)) {
            const nick = chance(0.35) ? pick(nickPool) : digits(18)
            let za = W.zaloAccounts.find(z => z.zalo_uid === nick)
            if (!za) { za = { id: zaId++, zalo_uid: chance(0.05) ? ` ${nick} ` : nick }; W.zaloAccounts.push(za) }
            acc.zalo_account_id = za.id
          }
          if (chance(0.25)) {
            const nick = chance(0.5) ? pick(nickPool) : digits(18)
            let ca = W.chatAccounts.find(c => c.zalo_id === nick)
            if (!ca) { ca = { id: chatId++, zalo_id: nick }; W.chatAccounts.push(ca) }
            if (!W.chatLinks.some(l => l.auto_account_id === acc.id)) W.chatLinks.push({ id: W.chatLinks.length + 1, chat_zalo_account_id: ca.id, organization_id: chance(0.9) ? o : ri(1, nOrg), auto_account_id: acc.id })
          }
        }
        W.accounts.push(acc)
      }
    }
  }
  // zalo_users: UID riêng theo tài khoản; một ít UID trùng chuỗi giữa tài khoản; một ít lưu kèm đuôi _0
  const realUids = POOL?.uids || []
  const allUids = []
  for (const acc of W.accounts) {
    for (let k = 0; k < ri(0, 40); k++) {
      let uid = chance(0.08) && allUids.length ? pick(allUids) : (chance(0.3) && realUids.length ? pick(realUids) : digits(ri(15, 19)))
      if (chance(0.06)) uid = uid + '_0'
      if (W.users.some(u => u.account_id === acc.id && u.zalo_uid === uid)) continue
      W.users.push({ id: userId++, account_id: acc.id, zalo_uid: uid, organization_id: chance(0.9) ? acc.organization_id : null })
      allUids.push(uid.replace(/_0$/, ''))
    }
  }
  W.allUids = allUids
  // chiến dịch + data
  const actions = [...UID_ACTIONS, 'zalo_message_phone', 'zalo_message_group']
  for (let c = 0; c < ri(12, 25); c++) {
    const st = pick(W.staff)
    const accs = W.accounts.filter(a => a.staff_id === st.id)
    const acc = accs.length ? pick(accs) : pick(W.accounts)
    const cp = { id: campId++, name: `Chiến dịch ${campId}`, action_id: chance(0.85) ? pick([...UID_ACTIONS]) : pick(actions), account_id: acc.id,
      status: pick(['chờ xử lý', 'tạm dừng', 'tạm dừng', 'hoàn thành', 'đang chạy']), staff_id: chance(0.95) ? st.id : pick(W.staff).id,
      organization_id: chance(0.9) ? st.organization_id : (chance(0.5) ? null : ri(1, nOrg)), is_delete: chance(0.05),
      data_target_source_mode: chance(0.9) ? 'direct' : 'data_group', note: null }
    W.campaigns.push(cp)
    const big = chance(0.08)
    const n = big ? ri(4200, 14000) : ri(0, 50)
    const ownerPool = W.users.filter(u => chance(0.5)).map(u => u.zalo_uid)
    for (let r = 0; r < n; r++) {
      let uid = chance(0.85) && ownerPool.length ? pick(ownerPool) : (chance(0.5) ? digits(ri(15, 19)) : pick(['', null, '0912345678', ' ', 'abc']))
      if (uid && chance(0.1)) uid = mutateUid(uid)
      const status = pick(['chờ xử lý', 'chờ xử lý', 'chờ xử lý', 'tạm dừng', 'hoàn thành', 'đang chạy'])
      const note = status === 'tạm dừng' ? pick([null, 'Người nhận nằm trong … (DAT04)', 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được (DAT04)', 'Chưa đọc được hồ sơ (EXC06)', 'DAT04', '(DAT04) ', 'x (DAT04)']) : null
      W.rows.push({ id: rowId++, campaign_id: cp.id, uid, status, note, is_delete: chance(0.04) })
    }
  }
  return W
}

function mutateUid(uid) {
  const s = String(uid)
  return pick([
    ' ' + s, s + ' ', s + '\u00a0', '\u200b' + s, s.slice(0, 5) + ' ' + s.slice(5), s + '\u2003', '\ufeff' + s, s + '\t', s + '\n',
    s.replace(/_0$/, '') + '_0', s + '_0_0', s + '\u3000', s.slice(0, 3) + '\u2009' + s.slice(3)
  ])
}

async function load(db, W) {
  const ins = async (table, rows, cols) => {
    if (!rows.length) return
    for (let i = 0; i < rows.length; i += 5000) {
      const chunk = rows.slice(i, i + 5000).map(r => Object.fromEntries(cols.map(c => [c, r[c] ?? null])))
      await db.query(`INSERT INTO public.${table} (${cols.join(',')}) OVERRIDING SYSTEM VALUE SELECT ${cols.join(',')} FROM jsonb_populate_recordset(null::public.${table}, $1::jsonb)`, [JSON.stringify(chunk)])
    }
  }
  await ins('org_organization', W.orgs, ['id'])
  await ins('org_staff', W.staff, ['id', 'organization_id', 'is_active', 'deleted_at'])
  await ins('zalo_accounts', W.zaloAccounts, ['id', 'zalo_uid'])
  await ins('chat_zalo_account', W.chatAccounts, ['id', 'zalo_id'])
  await ins('chat_zalo_account_organization', W.chatLinks, ['id', 'chat_zalo_account_id', 'organization_id', 'auto_account_id'])
  await ins('auto_accounts', W.accounts, ['id', 'name', 'staff_id', 'organization_id', 'flatform_type', 'is_delete', 'zalo_account_id'])
  await ins('zalo_users', W.users, ['id', 'account_id', 'zalo_uid', 'organization_id'])
  await ins('auto_campaigns', W.campaigns, ['id', 'name', 'action_id', 'account_id', 'status', 'staff_id', 'organization_id', 'is_delete', 'data_target_source_mode', 'note'])
  await ins('auto_campaign_input_data', W.rows, ['id', 'campaign_id', 'uid', 'status', 'note', 'is_delete'])
}

// ---------- mô hình kiểm UID ----------
function sameNick(W, accountId) {
  const a = W.accounts.find(x => x.id === accountId)
  if (!a) return [accountId]
  const za = W.zaloAccounts.find(z => z.id === a.zalo_account_id)
  const link = W.chatLinks.find(l => l.auto_account_id === a.id)
  const ca = link ? W.chatAccounts.find(c => c.id === link.chat_zalo_account_id) : null
  const keys = [za?.zalo_uid, ca?.zalo_id].map(k => (k ?? '').trim()).filter(Boolean)
  const out = new Set([accountId])
  for (const other of W.accounts) {
    if (other.organization_id !== a.organization_id) continue
    const oza = W.zaloAccounts.find(z => z.id === other.zalo_account_id)
    if (oza && keys.includes(oza.zalo_uid)) out.add(other.id)
  }
  for (const l of W.chatLinks) {
    if (l.organization_id !== a.organization_id) continue
    const c = W.chatAccounts.find(x => x.id === l.chat_zalo_account_id)
    if (c && keys.includes(c.zalo_id)) out.add(l.auto_account_id)
  }
  return [...out]
}
const isZalo = a => (a.flatform_type || '').trim().toLowerCase() === 'zalo'

class GuardError extends Error { constructor(code) { super(code); this.code = code } }

function modelCheck(W, org, staff, accountIds, uids, { unlimited = false } = {}) {
  if (!accountIds || accountIds.length === 0 || accountIds.length > 50) throw new GuardError('uid_guard_invalid_accounts')
  if (!unlimited && uids && uids.length > 2000) throw new GuardError('uid_guard_too_many')
  const set = [...new Set((uids || []).map(normUid).filter(Boolean))]
  const out = []
  for (const id of [...new Set(accountIds)].sort((a, b) => a - b)) {
    const acc = W.accounts.find(a => a.id === id)
    if (!acc || acc.organization_id !== org || acc.staff_id !== staff || !isZalo(acc) || acc.is_delete) throw new GuardError('uid_guard_account_not_found')
    const nick = sameNick(W, id)
    let own = 0, blocked = 0, unknown = 0; const blockedUids = []; const owners = new Map()
    for (const u of set) {
      const has = acct => W.users.some(z => z.account_id === acct && (z.zalo_uid === u || z.zalo_uid === u + '_0'))
      if (nick.some(has)) { own++; continue }
      const ow = [...new Set(W.users.filter(z => (z.zalo_uid === u || z.zalo_uid === u + '_0') && !nick.includes(z.account_id)
        && W.accounts.find(a => a.id === z.account_id)?.organization_id === org).map(z => z.account_id))]
      if (ow.length) { blocked++; blockedUids.push(u); for (const o of ow) owners.set(o, (owners.get(o) || 0) + 1) } else unknown++
    }
    out.push({ accountId: id, total: set.length, own, blocked, unknown, blockedUids: blockedUids.sort(),
      owners: [...owners].map(([k, c]) => { const a = W.accounts.find(x => x.id === k); return { accountId: k, count: c, usable: a.staff_id === staff && !a.is_delete && isZalo(a) } }) })
  }
  return { ok: true, checked: set.length, accounts: out }
}

function modelCampaign(W, org, staff, campaignId, accountId) {
  const c = W.campaigns.find(x => x.id === campaignId)
  if (!c || c.staff_id !== staff || (c.organization_id !== null && c.organization_id !== org) || c.is_delete) throw new GuardError('uid_guard_campaign_not_found')
  if (!UID_ACTIONS.has(c.action_id) || c.data_target_source_mode !== 'direct') return { ok: true, applies: false }
  const acct = accountId ?? c.account_id
  const cand = W.rows.filter(r => r.campaign_id === c.id && !r.is_delete && (r.status === 'chờ xử lý' || (r.status === 'tạm dừng' && /\(DAT04\)$/.test(r.note || ''))) && normUid(r.uid))
    .sort((a, b) => a.id - b.id).slice(0, 5000)
  const res = modelCheck(W, org, staff, [acct], cand.map(r => r.uid), { unlimited: true }).accounts[0]
  const blockedSet = new Set(res.blockedUids)
  const ids = W.rows.filter(r => r.campaign_id === c.id && !r.is_delete && r.status === 'chờ xử lý' && blockedSet.has(normUid(r.uid))).map(r => r.id).sort((a, b) => a - b).slice(0, 5000)
  return { ok: true, applies: true, campaignId: c.id, currentAccountId: c.account_id, checkedRows: cand.length, truncated: cand.length >= 5000,
    account: res, blockedRows: ids.length, blockedInputIds: ids }
}

const canon = x => JSON.stringify(x, (k, v) => Array.isArray(v) && v.every(e => typeof e === 'string') ? [...v].sort() : v)
function compareCheck(label, got, exp) {
  checks++
  const pickAcc = a => ({ accountId: Number(a.accountId), total: a.total, own: a.own, blocked: a.blocked, unknown: a.unknown,
    blockedUids: a.blockedUids ? [...a.blockedUids].sort() : undefined,
    owners: (a.owners || []).map(o => ({ accountId: Number(o.accountId), count: Number(o.count), usable: o.usable })).sort((x, y) => x.accountId - y.accountId) })
  const norm = r => r.applies === false ? { applies: false } : r.accounts
    ? { checked: r.checked, accounts: r.accounts.map(pickAcc).sort((x, y) => x.accountId - y.accountId) }
    : { checkedRows: r.checkedRows, truncated: r.truncated, blockedRows: r.blockedRows, blockedInputIds: (r.blockedInputIds || []).map(Number).sort((a, b) => a - b),
        account: (({ blockedUids, ...rest }) => rest)(pickAcc(r.account)) }
  const g = canon(norm(got)), e = canon(norm(exp))
  if (g !== e) fail(label, { got: norm(got), exp: norm(exp) })
}

async function callControl(db, staff, org, payloadText) {
  try {
    const { rows } = await db.query('SELECT public.aka_agent_control_campaign_uid_account_check($1, $2, $3::jsonb) r', [staff, org, payloadText])
    return { ok: rows[0].r }
  } catch (e) { return { err: e.message } }
}

// ---------- phần A: kiểm UID ----------
async function partCampaignSweep(db, W) {
  // Mọi chiến dịch: kiểm với tài khoản hiện tại và một tài khoản khác của nhân viên (đổi tài khoản).
  for (const c of W.campaigns) {
    const st = W.staff.find(s => s.id === c.staff_id)
    if (!st || !st.is_active || st.deleted_at) continue
    const org = st.organization_id
    const others = W.accounts.filter(a => a.staff_id === st.id && a.id !== c.account_id)
    for (const acct of [undefined, others.length ? pick(others).id : undefined]) {
      if (acct === undefined && cov['sweep_' + c.id]) continue
      cov['sweep_' + c.id] = 1
      const p = { mode: 'campaign', campaignId: c.id }; if (acct !== undefined) p.accountId = acct
      let exp; try { exp = modelCampaign(W, org, st.id, c.id, acct) } catch (e) { if (e instanceof GuardError) exp = e; else throw e }
      const got = await callControl(db, st.id, org, JSON.stringify(p))
      if (exp instanceof GuardError) { checks++; hit('sweep_error'); if (!got.err || !got.err.includes(exp.code)) fail('sweep_error', { c: c.id, exp: exp.code, got: got.err || 'ok' }); continue }
      if (got.err) { checks++; fail('sweep_unexpected_error', { c: c.id, err: got.err }); continue }
      if (exp.applies === false) hit('sweep_not_applies'); else { hit('sweep_applies'); if (exp.checkedRows > 2000) hit('sweep_chunked'); if (exp.truncated) hit('sweep_truncated'); if (exp.blockedRows > 0) hit('sweep_blocked') }
      compareCheck('sweep', got.ok, exp)
    }
  }
}

async function partA(db, W) {
  const activeStaff = W.staff.filter(s => s.is_active && !s.deleted_at)
  for (let i = 0; i < CHECKS; i++) {
    const st = pick(W.staff)
    const org = chance(0.95) ? st.organization_id : ri(1, 9)
    const myAccs = W.accounts.filter(a => a.staff_id === st.id)
    const scenario = rnd()
    let payload, exp
    try {
      if (scenario < 0.55) {
        // uids
        let accountIds = myAccs.length && chance(0.85) ? shuffle(myAccs).slice(0, ri(1, Math.min(3, myAccs.length))).map(a => a.id) : [pick(W.accounts).id]
        if (chance(0.05)) accountIds = accountIds.concat(accountIds)
        if (chance(0.02)) accountIds = Array.from({ length: 51 }, () => accountIds[0])
        if (chance(0.02)) accountIds = []
        const n = chance(0.03) ? 2001 : ri(0, 120)
        const uids = Array.from({ length: n }, () => {
          const r = rnd()
          if (r < 0.6 && W.allUids.length) { const u = pick(W.allUids); return chance(0.15) ? mutateUid(u) : u }
          if (r < 0.75) return digits(ri(10, 19))
          if (r < 0.8 && POOL?.uids?.length) return pick(POOL.uids)
          return pick(['', ' ', '\u200b', '_0', '0_0', '\u00a0\u00a0', 'ab c', 'x'.repeat(300), "1'; drop table x;--", '１２３', '😀123'])
        })
        payload = JSON.stringify({ mode: 'uids', accountIds, uids })
        if (!activeStaff.includes(st) || st.organization_id !== org) exp = new GuardError('uid_guard_no_session')
        else exp = modelCheck(W, org, st.id, accountIds, uids)
      } else if (scenario < 0.85) {
        const c = chance(0.85) ? pick(W.campaigns.filter(x => x.staff_id === st.id).concat(W.campaigns.slice(0, 1))) : pick(W.campaigns)
        const acctChoice = chance(0.5) ? undefined : (chance(0.8) && myAccs.length ? pick(myAccs).id : pick(W.accounts).id)
        const p = { mode: 'campaign', campaignId: c.id }
        if (acctChoice !== undefined) p.accountId = acctChoice
        if (chance(0.05)) p.accountId = null
        payload = JSON.stringify(p)
        if (!activeStaff.includes(st) || st.organization_id !== org) exp = new GuardError('uid_guard_no_session')
        else exp = modelCampaign(W, org, st.id, c.id, p.accountId ?? undefined)
      } else {
        // payload sai kiểu
        const bad = pick([
          'null', '[]', '"x"', '{}', '{"mode":"zzz"}', '{"mode":"uids"}', '{"mode":"uids","accountIds":"1","uids":[]}',
          '{"mode":"uids","accountIds":[1.5],"uids":[]}', '{"mode":"uids","accountIds":[-1],"uids":[]}', '{"mode":"uids","accountIds":[12345678901234567890],"uids":[]}',
          '{"mode":"uids","accountIds":["101"],"uids":[]}', '{"mode":"uids","accountIds":[101],"uids":[null]}', '{"mode":"uids","accountIds":[101],"uids":[true]}',
          '{"mode":"uids","accountIds":[101],"uids":[{"a":1}]}', '{"mode":"uids","accountIds":[101],"uids":"123"}', '{"mode":"campaign"}',
          '{"mode":"campaign","campaignId":"1000"}', '{"mode":"campaign","campaignId":null}', '{"mode":"campaign","campaignId":1.0}',
          '{"mode":"campaign","campaignId":1000,"accountId":"101"}', '{"mode":"campaign","campaignId":1000,"accountId":-5}', '{"mode":"hold"}',
          '{"mode":"hold","campaignId":"1000"}', '{"mode":"uids","accountIds":[],"uids":[]}'
        ])
        payload = bad
        if (!activeStaff.includes(st) || st.organization_id !== org) exp = new GuardError('uid_guard_no_session')
        else exp = modelBad(W, org, st.id, bad)
      }
    } catch (e) { if (e instanceof GuardError) exp = e; else throw e }
    const got = await callControl(db, st.id, org, payload)
    if (exp instanceof GuardError) {
      checks++
      if (!got.err || !got.err.includes(exp.code)) fail('expected_error', { payload: payload.slice(0, 300), exp: exp.code, got: got.err || 'ok' })
    } else if (got.err) { checks++; fail('unexpected_error', { payload: payload.slice(0, 300), err: got.err }) }
    else {
      const before = failures.length
      compareCheck('uid_check', got.ok, exp)
      if (failures.length > before && process.env.DEBUG_UIDS && JSON.parse(payload).mode === 'uids') await debugUids(db, W, st, org, JSON.parse(payload))
      checks++
      if (got.ok.enabled !== true) fail('enabled_flag', { got: got.ok.enabled })
    }
  }
}

async function debugUids(db, W, st, org, p) {
  let shown = 0
  for (const acc of [...new Set(p.accountIds)]) for (const u of p.uids) {
    if (shown >= 4) return
    let m; try { m = modelCheck(W, org, st.id, [acc], [u]).accounts[0] } catch { continue }
    const g = await callControl(db, st.id, org, JSON.stringify({ mode: 'uids', accountIds: [acc], uids: [u] }))
    const ga = g.ok?.accounts?.[0]
    const key = a => a && `${a.total}/${a.own}/${a.blocked}/${a.unknown}`
    if (key(m) !== key(ga)) {
      shown++
      const n = normUid(u)
      console.log('    uid', JSON.stringify(u), 'norm', JSON.stringify(n), 'acc', acc, 'nick', JSON.stringify(sameNick(W, acc)), 'model', key(m), 'sql', key(ga),
        'rows', JSON.stringify(W.users.filter(z => n && z.zalo_uid.replace(/_0$/, '') === n).map(z => [z.account_id, z.zalo_uid, W.accounts.find(a => a.id === z.account_id)?.organization_id])))
    }
  }
}

function modelBad(W, org, staff, text) {
  const p = JSON.parse(text)
  if (p === null || typeof p !== 'object' || Array.isArray(p)) throw new GuardError('uid_guard_invalid_payload')
  const isIdNum = v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && String(v).length <= 18 && !/\./.test(JSON.stringify(v))
  if (p.mode === 'campaign' || p.mode === 'hold') {
    // jsonb lưu 1.0 dạng "1.0" nên không phải số nguyên hợp lệ
    if (!(typeof p.campaignId === 'number') || !/^[0-9]{1,18}$/.test(rawNumText(text, 'campaignId'))) throw new GuardError('uid_guard_invalid_payload')
  }
  if (p.mode === 'uids') {
    if (!Array.isArray(p.accountIds) || !Array.isArray(p.uids)) throw new GuardError('uid_guard_invalid_payload')
    if (p.accountIds.some(v => typeof v !== 'number' || !/^[0-9]{1,18}$/.test(String(v)) || !isIdNum(v))) throw new GuardError('uid_guard_invalid_payload')
    if (p.uids.some(v => typeof v !== 'string' && typeof v !== 'number')) throw new GuardError('uid_guard_invalid_payload')
    return modelCheck(W, org, staff, p.accountIds, p.uids)
  }
  if (p.mode === 'campaign') {
    if ('accountId' in p && p.accountId !== null && (typeof p.accountId !== 'number' || !/^[0-9]{1,18}$/.test(rawNumText(text, 'accountId')))) throw new GuardError('uid_guard_invalid_payload')
    return modelCampaign(W, org, staff, p.campaignId, p.accountId ?? undefined)
  }
  if (p.mode === 'hold') return { holdOnly: true }
  throw new GuardError('uid_guard_invalid_payload')
}
const rawNumText = (text, key) => { const m = new RegExp('"' + key + '":\\s*(-?[0-9.eE+]+)').exec(text); return m ? m[1] : '' }

// ---------- phần A2: giữ người nhận (hold) + trigger đổi tài khoản ----------
async function partHoldAndRelease(db, W) {
  const cands = W.campaigns.filter(c => UID_ACTIONS.has(c.action_id) && c.data_target_source_mode === 'direct' && !c.is_delete)
  for (const c of shuffle(cands).slice(0, 8)) {
    const st = W.staff.find(s => s.id === c.staff_id)
    if (!st || !st.is_active || st.deleted_at) continue
    const org = st.organization_id
    // hold
    let exp
    try {
      if (c.status === 'đang chạy') throw new GuardError('uid_guard_campaign_running')
      if (c.organization_id !== null && c.organization_id !== org) throw new GuardError('uid_guard_campaign_not_found')
      const acc = W.accounts.find(a => a.id === c.account_id)
      if (!acc || acc.organization_id !== org || acc.staff_id !== st.id || !isZalo(acc) || acc.is_delete) throw new GuardError('uid_guard_account_not_found')
      exp = modelCampaign(W, org, st.id, c.id)
    } catch (e) { if (e instanceof GuardError) exp = e; else throw e }
    const got = await callControl(db, st.id, org, JSON.stringify({ mode: 'hold', campaignId: c.id }))
    checks++
    if (exp instanceof GuardError) { if (!got.err || !got.err.includes(exp.code)) fail('hold_error', { campaign: c.id, exp: exp.code, got: got.err || got.ok }) ; continue }
    if (got.err) { fail('hold_unexpected_error', { campaign: c.id, err: got.err }); continue }
    const heldIds = new Set(exp.blockedInputIds || [])
    for (const r of W.rows) if (heldIds.has(r.id)) { r.status = 'tạm dừng'; r.note = 'Người nhận nằm trong danh sách quét bằng tài khoản Zalo khác nên tài khoản này không gửi được (DAT04)' }
    hit('hold_ok'); if (heldIds.size) hit('hold_rows', heldIds.size)
    if (Number(got.ok.held) !== heldIds.size) fail('hold_count', { campaign: c.id, got: got.ok.held, exp: heldIds.size })
    // sau khi giữ, kiểm lại chiến dịch: không còn người chờ bị chặn
    const again = await callControl(db, st.id, org, JSON.stringify({ mode: 'campaign', campaignId: c.id }))
    checks++
    if (again.err || again.ok.blockedRows !== 0) fail('hold_then_check', { campaign: c.id, got: again.err || again.ok.blockedRows })
    // đổi tài khoản sang tài khoản khác của nhân viên → trigger trả người giữ vì DAT04 mà tài khoản mới gửi được
    const others = W.accounts.filter(a => a.staff_id === st.id && a.id !== c.account_id)
    if (!others.length) continue
    const target = pick(others)
    const nick = sameNick(W, target.id)
    const released = []
    if (!c.is_delete) {
      for (const r of W.rows) {
        if (r.campaign_id !== c.id || r.is_delete || r.status !== 'tạm dừng' || !/\(DAT04\)$/.test(r.note || '')) continue
        // LIKE '%(DAT04)' trên note: kết thúc đúng bằng "(DAT04)"
        const u = normUid(r.uid)
        if (u && W.users.some(z => nick.includes(z.account_id) && (z.zalo_uid === u || z.zalo_uid === u + '_0'))) released.push(r)
      }
    }
    const beforeStatus = c.status
    await db.query('UPDATE public.auto_campaigns SET account_id = $1 WHERE id = $2', [target.id, c.id])
    c.account_id = target.id
    for (const r of released) { r.status = 'chờ xử lý'; r.note = null }
    hit('release_change'); if (released.length) hit('release_rows', released.length); if (released.length && beforeStatus === 'hoàn thành') hit('release_reopen')
    if (released.length && beforeStatus === 'hoàn thành') c.status = 'chờ xử lý'
    const { rows: dbRows } = await db.query('SELECT id, status, note FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id', [c.id])
    const { rows: [dbc] } = await db.query('SELECT status FROM public.auto_campaigns WHERE id = $1', [c.id])
    checks++
    const model = W.rows.filter(r => r.campaign_id === c.id).sort((a, b) => a.id - b.id)
    const diff = model.filter((r, i) => dbRows[i]?.status !== r.status || (dbRows[i]?.note ?? null) !== (r.note ?? null))
    if (diff.length) fail('release_rows', { campaign: c.id, n: diff.length, sample: diff.slice(0, 3).map(r => ({ id: r.id, exp: [r.status, r.note], got: dbRows.find(x => Number(x.id) === r.id) })) })
    checks++
    if (dbc.status !== c.status) fail('release_reopen', { campaign: c.id, exp: c.status, got: dbc.status })
  }
}

// ---------- phần A3: Desktop theo phiên + quyền ----------
async function partSession(db, W) {
  const st = W.staff.find(s => s.is_active && !s.deleted_at && W.accounts.some(a => a.staff_id === s.id && isZalo(a) && !a.is_delete && a.organization_id === s.organization_id))
  if (!st) return
  const acc = W.accounts.find(a => a.staff_id === st.id && isZalo(a) && !a.is_delete && a.organization_id === st.organization_id)
  const uid = '11111111-2222-3333-4444-' + String(st.id).padStart(12, '0')
  await db.query('INSERT INTO private.aka_agent_desktop_users VALUES ($1, $2) ON CONFLICT DO NOTHING', [uid, st.id])
  const payload = JSON.stringify({ mode: 'uids', accountIds: [acc.id], uids: W.allUids.slice(0, 5) })
  const run = async (role, claims, fn) => {
    await db.query('BEGIN')
    try {
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims])
      await db.query(`SET LOCAL ROLE ${role}`)
      const { rows } = await db.query(`SELECT ${fn} r`, fn.includes('$1') ? [payload] : [])
      return { ok: rows[0].r }
    } catch (e) { return { err: e.message } } finally { await db.query('ROLLBACK') }
  }
  const okDesk = await run('aka_agent_desktop', JSON.stringify({ role: 'aka_agent_desktop', sub: uid }), 'public.aka_agent_campaign_uid_account_check_v1($1::jsonb)')
  checks++; if (!okDesk.ok) fail('session_desktop', { got: okDesk.err })
  else compareCheck('session_desktop_result', okDesk.ok, modelCheck(W, st.organization_id, st.id, [acc.id], W.allUids.slice(0, 5)))
  const noSub = await run('aka_agent_desktop', JSON.stringify({ role: 'aka_agent_desktop', sub: '00000000-0000-0000-0000-000000000000' }), 'public.aka_agent_campaign_uid_account_check_v1($1::jsonb)')
  checks++; if (!noSub.err || !noSub.err.includes('uid_guard_no_session')) fail('session_unknown_user', { got: noSub })
  for (const role of ['anon', 'authenticated', 'aka_agent_chat_api']) {
    const r = await run(role, '{}', 'public.aka_agent_campaign_uid_account_check_v1($1::jsonb)')
    checks++; if (!r.err || !/permission denied/.test(r.err)) fail('perm_v1_' + role, { got: r })
  }
  for (const role of ['anon', 'authenticated', 'aka_agent_desktop']) {
    const r = await run(role, '{}', `public.aka_agent_control_campaign_uid_account_check(${st.id}, ${st.organization_id}, $1::jsonb)`)
    checks++; if (!r.err || !/permission denied/.test(r.err)) fail('perm_control_' + role, { got: r })
  }
  const svc = await run('service_role', '{}', `public.aka_agent_control_campaign_uid_account_check(${st.id}, ${st.organization_id}, $1::jsonb)`)
  checks++; if (!svc.ok) fail('perm_control_service', { got: svc.err })
  for (const fn of ['private.aka_agent_campaign_uid_account_hold(1,1,1)', `private.aka_agent_campaign_uid_account_check(1,1,'{1}','{}')`]) {
    const r = await run('aka_agent_desktop', '{}', fn.replace('$1', 'null'))
    checks++; if (!r.err || !/permission denied/.test(r.err)) fail('perm_private', { fn, got: r })
  }
}

// ---------- phần B: thông báo tạm dừng ----------
async function partB(db, W) {
  await db.query(`UPDATE public.auto_system_settings SET value = '0' WHERE key IN ('notifications.cooldown_minutes.campaign', 'notifications.digest_minutes.campaign')`)
  const base = 5000
  const staff = []
  for (let i = 0; i < ri(15, 40); i++) {
    const s = { id: base + i, organization_id: ri(1, 3), is_active: !chance(0.06), deleted_at: chance(0.05) ? new Date().toISOString() : null,
      is_admin_akabiz: chance(0.2), test_access_allowed: !chance(0.08), org_null: chance(0.03) }
    if (s.org_null) s.organization_id = null
    staff.push(s)
  }
  const newStaff = staff.slice()
  // nhân viên của phần A cũng nằm trong org_staff: đưa vào mô hình (không admin, được dùng app)
  for (const s of W.staff) staff.push({ id: s.id, organization_id: s.organization_id, is_active: s.is_active, deleted_at: s.deleted_at, is_admin_akabiz: false, test_access_allowed: true })
  for (const s of newStaff) await db.query('INSERT INTO public.org_staff (id, organization_id, is_active, deleted_at, is_admin_akabiz, test_access_allowed) OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6)', [s.id, s.organization_id, s.is_active, s.deleted_at, s.is_admin_akabiz, s.test_access_allowed])
  // cài đặt sẵn
  const settings = new Map(), subs = new Map()
  for (const s of newStaff) {
    if (chance(0.7)) {
      const e = { staff_id: s.id, organization_id: s.organization_id, is_enabled: chance(0.4), recipient_emails: chance(0.5) ? ['a' + s.id + '@x.vn'] : [], is_delete: chance(0.06) }
      settings.set(s.id, e)
      await db.query('INSERT INTO public.auto_email_notification_settings (staff_id, organization_id, is_enabled, recipient_emails, is_delete) VALUES ($1,$2,$3,$4,$5)', [s.id, s.organization_id, e.is_enabled, e.recipient_emails, e.is_delete])
    }
    if (chance(0.25)) {
      const f = pick([{ toStatuses: ['hoàn thành'] }, { toStatuses: ['hoàn thành', 'tạm dừng'] }, {}, { toStatuses: ['tạm dừng'], campaignIds: [9999] }, { toStatuses: 'tạm dừng' }, { toStatuses: null }, { toStatuses: ['đang chạy', 'chờ xử lý', 'tạm dừng'] }])
      const sub = { staff_id: s.id, event_type: 'campaign.status_changed', is_enabled: chance(0.85), email_enabled: false, push_enabled: chance(0.5), filters: f, cooldown_minutes: chance(0.1) ? 5 : null }
      subs.set(s.id + ':campaign', sub)
      await db.query('INSERT INTO public.auto_notification_subscriptions (staff_id, organization_id, event_type, is_enabled, email_enabled, push_enabled, filters, cooldown_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [s.id, s.organization_id, sub.event_type, sub.is_enabled, sub.email_enabled, sub.push_enabled, JSON.stringify(f), sub.cooldown_minutes])
    }
    if (chance(0.3)) { subs.set(s.id + ':morning', { staff_id: s.id, event_type: 'report.morning' }); await db.query(`INSERT INTO public.auto_notification_subscriptions (staff_id, organization_id, event_type, is_enabled, push_enabled) VALUES ($1,$2,'report.morning',true,true)`, [s.id, s.organization_id]) }
  }
  const candEmails = []
  for (const s of newStaff) if (chance(0.15)) { candEmails.push({ staff_id: s.id, email: 'c' + s.id + '@y.vn', source: pick(['profile', 'crm']) }); await db.query('INSERT INTO public.test_email_candidates VALUES ($1,$2,$3)', [s.id, 'c' + s.id + '@y.vn', candEmails.at(-1).source]) }

  // công tắc ngẫu nhiên
  const pauseCfg = pick(['{"audience":"all","batch":1000}', '{"audience":"all","batch":3}', '{"audience":"admin_akabiz"}', '{"audience":"orgs","organizationIds":[1,2]}', '{"audience":"off"}', 'not json', '{"audience":"all","batch":"x"}', null])
  const reportCfg = pick(['{"audience":"all","batch":1000,"emailMax":100000,"emailSources":["profile","crm"]}', '{"audience":"off"}', '{"audience":"all","batch":2,"emailMax":5}'])
  await db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = 'notifications.default_reports'`, [reportCfg])
  if (pauseCfg === null) await db.query(`DELETE FROM public.auto_system_settings WHERE key = 'notifications.default_campaign_pause'`)
  else await db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = 'notifications.default_campaign_pause'`, [pauseCfg])
  const calls = ri(1, 4)
  // mô hình seed
  const rep = safeJson(reportCfg), pz = pauseCfg === null ? { audience: 'off' } : safeJson(pauseCfg)
  const audOk = (cfg, s) => cfg && (cfg.audience === 'all' || (cfg.audience === 'admin_akabiz' && s.is_admin_akabiz) || (cfg.audience === 'orgs' && Array.isArray(cfg.organizationIds) && cfg.organizationIds.includes(s.organization_id)))
  const repBatch = rep && Number.isInteger(rep.batch) ? Math.min(Math.max(rep.batch, 1), 1000) : 200
  let pzBatch = 1000
  let pzValid = pz !== null && typeof pz === 'object' && !Array.isArray(pz)
  if (pzValid && pz.batch !== undefined) { if (typeof pz.batch === 'number' && Number.isInteger(pz.batch)) pzBatch = Math.min(Math.max(pz.batch, 1), 1000); else pzValid = false }
  const eligible = s => s.is_active && !s.deleted_at && s.organization_id !== null && s.test_access_allowed
  const emailMax = rep && /^[0-9]{1,6}$/.test(String(rep.emailMax ?? '')) ? Number(rep.emailMax) : 0
  const sources = rep && Array.isArray(rep.emailSources) ? rep.emailSources : ['profile', 'crm']
  for (let k = 0; k < calls; k++) {
    if (rep && ['admin_akabiz', 'orgs', 'all'].includes(rep.audience)) {
      let n = 0
      for (const s of [...staff].sort((a, b) => a.id - b.id)) {
        if (n >= repBatch) break
        if (!eligible(s) || !audOk(rep, s) || settings.has(s.id)) continue
        settings.set(s.id, { staff_id: s.id, organization_id: s.organization_id, is_enabled: false, recipient_emails: [], is_delete: false })
        if (!subs.has(s.id + ':morning')) subs.set(s.id + ':morning', { staff_id: s.id, event_type: 'report.morning', email_enabled: false })
        n++
      }
      n = 0
      for (const s of [...staff].sort((a, b) => a.id - b.id)) {
        if (n >= repBatch) break
        const e = settings.get(s.id)
        if (!e || e.is_delete || !eligible(s) || !audOk(rep, s) || subs.has(s.id + ':morning')) continue
        subs.set(s.id + ':morning', { staff_id: s.id, event_type: 'report.morning', email_enabled: e.is_enabled && e.recipient_emails.length > 0 })
        n++
      }
      if (emailMax > 0 && sources.length) {
        let room = emailMax - [...settings.values()].filter(e => e.auto_filled && !e.is_delete && e.recipient_emails.length > 0).length
        if (room > 0) {
          const rows = []
          for (const e of [...settings.values()].sort((a, b) => a.staff_id - b.staff_id)) {
            const s = staff.find(x => x.id === e.staff_id)
            if (e.is_delete || e.auto_filled || e.recipient_emails.length || !eligible(s) || !audOk(rep, s)) continue
            for (const c of candEmails.filter(c => c.staff_id === e.staff_id && sources.includes(c.source))) {
              if (c.source !== 'profile' && [...settings.values()].some(o => o.staff_id !== e.staff_id && !o.is_delete && o.recipient_emails.includes(c.email))) continue
              rows.push({ e, c })
            }
          }
          rows.sort((a, b) => (a.c.source !== 'profile') - (b.c.source !== 'profile') || a.e.staff_id - b.e.staff_id)
          let filled = 0
          for (const { e, c } of rows.slice(0, Math.min(repBatch, room))) {
            if (e.auto_filled || e.recipient_emails.length) continue
            e.is_enabled = true; e.recipient_emails = [c.email]; e.auto_filled = true; filled++
            const m = subs.get(e.staff_id + ':morning'); if (m && m.is_enabled !== false) m.email_enabled = true
            const cs = subs.get(e.staff_id + ':campaign'); if (cs && cs.is_enabled && cs.filters?.seededBy === 'v680') cs.email_enabled = true
          }
        }
      }
    }
    if (pzValid && ['admin_akabiz', 'orgs', 'all'].includes(pz.audience)) {
      let n = 0
      for (const e of [...settings.values()].sort((a, b) => a.staff_id - b.staff_id)) {
        if (n >= pzBatch) break
        const s = staff.find(x => x.id === e.staff_id)
        if (e.is_delete || !eligible(s) || !audOk(pz, s) || subs.has(s.id + ':campaign')) continue
        subs.set(s.id + ':campaign', { staff_id: s.id, event_type: 'campaign.status_changed', is_enabled: true, email_enabled: e.is_enabled && e.recipient_emails.length > 0, push_enabled: true, filters: { toStatuses: ['tạm dừng'], campaignIds: null, seededBy: 'v680' }, cooldown_minutes: null })
        n++
      }
    }
    const { rows: [r] } = await db.query('SELECT private.aka_agent_notification_seed_defaults(now()) r')
    checks++
    if (!r.r.campaignPause) fail('seed_return', { got: r.r })
    if (pauseCfg === 'not json' && r.r.campaignPause?.error !== 'invalid_setting') fail('seed_invalid_setting', { got: r.r })
  }
  // so bảng đăng ký "Chiến dịch"
  const { rows: dbSubs } = await db.query(`SELECT staff_id, is_enabled, email_enabled, push_enabled, filters FROM public.auto_notification_subscriptions WHERE event_type = 'campaign.status_changed' ORDER BY staff_id`)
  hit('seed_campaign_rows', [...subs.values()].filter(x => x.filters?.seededBy === 'v680').length)
  const expSubs = [...subs.values()].filter(s => s.event_type === 'campaign.status_changed').sort((a, b) => a.staff_id - b.staff_id)
  checks++
  const sortKeys = o => o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map(k => [k, sortKeys(o[k])])) : o
  const sig = s => `${s.staff_id}|${s.is_enabled}|${s.email_enabled}|${s.push_enabled}|${JSON.stringify(s.filters && s.filters.seededBy ? sortKeys(s.filters) : null)}`
  const gotSig = dbSubs.map(s => sig({ ...s, staff_id: Number(s.staff_id) })), expSig = expSubs.map(sig)
  if (JSON.stringify(gotSig) !== JSON.stringify(expSig)) fail('seed_subscriptions', { pauseCfg, reportCfg, calls, got: gotSig.filter(x => !expSig.includes(x)), exp: expSig.filter(x => !gotSig.includes(x)) })

  // chuyển trạng thái chiến dịch với ghi chú ngẫu nhiên
  const systemNotes = POOL?.systemNotes?.length ? POOL.systemNotes : ['Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): Zalo hạn chế nhắn người lạ (Z122)', 'Có lỗi xảy ra', 'Chiến dịch tạm dừng vì danh sách yêu cầu kết bạn đã đầy (50).']
  const userNotes = [null, '', '   ', '\u00a0', '\u3000', '\u2003\n', 'Chờ data mới', ' Chờ data phù hợp ', 'Đang chờ tạm dừng', 'Đang chờ tạm dừng\n⚠️ Link từ chối nhận tin chưa tạo được', '\tĐang chờ tạm dừng']
  const trickyNotes = ['Chờ data mới nhé', 'Đang chờ', 'chờ data mới', 'Tạm dừng', '-', '⏸']
  let campId = 90000
  const notifModel = []
  const lastNotif = new Map()
  for (let k = 0; k < ri(30, 80); k++) {
    const s = pick(staff)
    const cid = campId++
    const status0 = pick(['chờ xử lý', 'đang chạy'])
    await db.query('INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, staff_id, organization_id, is_delete) OVERRIDING SYSTEM VALUE VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [cid, 'C' + cid, 'zalo_message_phone', 1, status0, s.id, s.organization_id, false])
    let cur = status0
    for (let t = 0; t < ri(1, 4); t++) {
      const to = pick(['tạm dừng', 'tạm dừng', 'hoàn thành', 'chờ xử lý', 'đang chạy'])
      if (to === cur) continue
      const note = to === 'tạm dừng' ? pick([...systemNotes, ...userNotes, ...trickyNotes]) : pick([null, 'x'])
      await db.query('UPDATE public.auto_campaigns SET status = $1, note = $2 WHERE id = $3', [to, note, cid])
      // mô hình capture
      const sub = subs.get(s.id + ':campaign')
      let notify = false
      if (sub && sub.is_enabled !== false && sub.is_enabled) {
        const f = sub.filters || {}
        const tos = 'toStatuses' in f ? f.toStatuses : ['hoàn thành', 'tạm dừng']
        const matches = Array.isArray(tos) ? tos.includes(to) : typeof tos === 'string' ? tos === to : false
        const idsOk = !Array.isArray(f.campaignIds) || f.campaignIds.includes(cid)
        if (matches && idsOk && !(to === 'tạm dừng' && userPauseNote(note))) {
          const cooldown = (to === 'đang chạy' || to === 'chờ xử lý') ? (sub.cooldown_minutes ?? 15) : (sub.cooldown_minutes ?? 0)
          const key = cid + '|' + to
          if (cooldown > 0 && lastNotif.has(key)) notify = false
          else { notify = true; lastNotif.set(key, true) }
        }
      }
      if (notify) { notifModel.push({ campaign_id: cid, to, note }); hit('notify_' + (to === 'tạm dừng' ? 'pause' : 'other')) } else if (to === 'tạm dừng' && sub?.is_enabled) hit('skip_pause_user_or_filter')
      cur = to
    }
  }
  const { rows: dbN } = await db.query(`SELECT campaign_id, payload->>'toStatus' "to", payload->>'note' note FROM public.auto_notifications WHERE event_type = 'campaign.status_changed' ORDER BY id`)
  checks++
  const a = dbN.map(n => `${n.campaign_id}|${n.to}|${n.note}`), b = notifModel.map(n => `${n.campaign_id}|${n.to}|${n.note ?? null}`)
  if (JSON.stringify(a) !== JSON.stringify(b)) fail('capture', { got: a.filter(x => !b.includes(x)).slice(0, 8), exp: b.filter(x => !a.includes(x)).slice(0, 8), gotN: a.length, expN: b.length })
}
const safeJson = s => { try { return JSON.parse(s) } catch { return null } }

// ---------- đồng thời: đổi tài khoản (trigger) và "Bỏ N người" (hold) trên cùng chiến dịch ----------
async function partConcurrent(db, W, cl) {
  const cands = W.campaigns.filter(c => UID_ACTIONS.has(c.action_id) && c.data_target_source_mode === 'direct' && !c.is_delete && c.status !== 'đang chạy')
  for (const c of shuffle(cands).slice(0, 3)) {
    const st = W.staff.find(s => s.id === c.staff_id)
    if (!st || !st.is_active || st.deleted_at || (c.organization_id !== null && c.organization_id !== st.organization_id)) continue
    const others = W.accounts.filter(a => a.staff_id === st.id && a.id !== c.account_id && isZalo(a) && !a.is_delete && a.organization_id === st.organization_id)
    if (!others.length) continue
    const target = pick(others)
    const a = await cl.connect(), b = await cl.connect()
    try {
      await a.query('BEGIN')
      await a.query('UPDATE public.auto_campaigns SET account_id = $1 WHERE id = $2', [target.id, c.id])
      const pending = b.query('SELECT public.aka_agent_control_campaign_uid_account_check($1, $2, $3::jsonb) r', [st.id, st.organization_id, JSON.stringify({ mode: 'hold', campaignId: c.id })])
        .then(r => ({ ok: r.rows[0].r }), e => ({ err: e.message }))
      await new Promise(r => setTimeout(r, 150))
      await a.query('COMMIT')
      const got = await pending
      checks++
      if (got.err) { fail('concurrent_hold_error', { c: c.id, err: got.err }); continue }
      // sau cả hai: không còn người đang chờ mà tài khoản mới không gửi được
      const after = await callControl(db, st.id, st.organization_id, JSON.stringify({ mode: 'campaign', campaignId: c.id }))
      checks++
      if (after.err || after.ok.blockedRows !== 0 || Number(after.ok.currentAccountId) !== target.id) fail('concurrent_final', { c: c.id, got: after.err || { blocked: after.ok.blockedRows, acc: after.ok.currentAccountId } })
      hit('concurrent_ok')
      // đồng bộ mô hình theo DB để các phần sau dùng đúng trạng thái
      c.account_id = target.id
      const { rows } = await db.query('SELECT id, status, note FROM public.auto_campaign_input_data WHERE campaign_id = $1', [c.id])
      const byId = new Map(rows.map(r => [Number(r.id), r]))
      for (const r of W.rows) if (r.campaign_id === c.id && byId.has(r.id)) { r.status = byId.get(r.id).status; r.note = byId.get(r.id).note }
      c.status = (await db.query('SELECT status FROM public.auto_campaigns WHERE id = $1', [c.id])).rows[0].status
    } finally { await a.end(); await b.end() }
  }
}

// ---------- gỡ rồi apply lại ----------
async function partRollback(db) {
  const md5Of = async sig => (await db.query(`SELECT md5(prosrc) m FROM pg_proc WHERE oid = '${sig}'::regprocedure`)).rows[0].m
  const policy = async () => (await db.query('SELECT target_effect, log_template FROM public.auto_outcome_policies WHERE id = 426')).rows[0]
  await db.query(fs.readFileSync(path.join(ROOT, 'migrations/rollback_v680_notification_campaign_pause_default.sql'), 'utf8'))
  await db.query(fs.readFileSync(path.join(ROOT, 'migrations/rollback_v679_zalo_uid_account_guard.sql'), 'utf8'))
  checks++
  const cap = await md5Of('private.aka_agent_notification_capture_campaign()'), seed = await md5Of('private.aka_agent_notification_seed_defaults(timestamp with time zone)')
  if (cap !== '28c58b148172224c2f88885b55dcb3b9' || seed !== '1af8d8da6de9002bd10d55ca3e65a025') fail('rollback_bodies', { cap, seed })
  const p = await policy(); checks++
  if (p.target_effect !== 'complete' || p.log_template !== 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được') fail('rollback_policy', p)
  const left = (await db.query(`SELECT count(*)::int n FROM pg_proc WHERE proname LIKE 'aka_agent_campaign_uid_account%' OR proname LIKE 'aka_agent_uid_guard%' OR proname IN ('aka_agent_uid_account_release','aka_agent_notification_seed_campaign_pause','aka_agent_notification_user_pause_note')`)).rows[0].n
  checks++; if (left) fail('rollback_leftover_functions', { left })
  const seeded = (await db.query(`SELECT count(*)::int n FROM public.auto_notification_subscriptions WHERE filters ->> 'seededBy' = 'v680'`)).rows[0].n
  checks++; if (seeded) fail('rollback_seeded_rows', { seeded })
  // apply lại sau khi gỡ
  try {
    await db.query(fs.readFileSync(path.join(ROOT, 'migrations/migration_v679_zalo_uid_account_guard.sql'), 'utf8'))
    await db.query(fs.readFileSync(path.join(ROOT, 'migrations/migration_v680_notification_campaign_pause_default.sql'), 'utf8'))
    checks++
  } catch (e) { checks++; fail('reapply', { err: e.message }) }
  // migration đã có trong sổ thì từ chối chạy lại
  await db.query(`INSERT INTO supabase_migrations.schema_migrations VALUES ('1','migration_v679_zalo_uid_account_guard','{}',null), ('2','migration_v680_notification_campaign_pause_default','{}',null)`)
  for (const f of ['migration_v679_zalo_uid_account_guard.sql', 'migration_v680_notification_campaign_pause_default.sql']) {
    checks++
    try { await db.query(fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8')); fail('ledger_guard', { f }) } catch (e) { await db.query('ROLLBACK'); if (!/không chạy lại/.test(e.message)) fail('ledger_guard_msg', { f, err: e.message }) }
  }
}

// ---------- chạy ----------
;(async () => {
  const t0 = Date.now()
  const cl = await startCluster()
  const db = await cl.connect()
  try {
    await db.query(fs.readFileSync(path.join(__dirname, 'fixture.sql'), 'utf8'))
    await db.query(fs.readFileSync(path.join(ROOT, 'migrations/migration_v679_zalo_uid_account_guard.sql'), 'utf8'))
    await db.query(fs.readFileSync(path.join(ROOT, 'migrations/migration_v680_notification_campaign_pause_default.sql'), 'utf8'))
    const W = buildWorld()
    await load(db, W)
    console.log(`seed ${SEED}: ${W.accounts.length} tài khoản, ${W.users.length} dòng zalo_users, ${W.campaigns.length} chiến dịch, ${W.rows.length} data`)
    await partA(db, W)
    await partCampaignSweep(db, W)
    await partSession(db, W)
    await partHoldAndRelease(db, W)
    await partB(db, W)
    await partConcurrent(db, W, cl)
    await partRollback(db)
  } finally { await db.end(); cl.stop() }
  console.log('  độ phủ:', JSON.stringify(Object.fromEntries(Object.entries(cov).filter(([k]) => !k.startsWith('sweep_') || !/^sweep_\d+$/.test(k)))))
  console.log(`seed ${SEED}: ${checks} phép kiểm, ${failures.length} lỗi, ${((Date.now() - t0) / 1000).toFixed(1)} giây`)
  const byKind = {}; for (const f of failures) byKind[f.kind] = (byKind[f.kind] || 0) + 1
  if (failures.length) console.log('  theo loại:', JSON.stringify(byKind))
  process.exit(failures.length ? 1 : 0)
})().catch(e => { console.error(e); process.exit(2) })
