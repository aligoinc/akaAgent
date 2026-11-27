'use strict'
/*
 * Mô hình độc lập của V672 (docs/EVENT_BOT_TECH.md mục 4–6), viết lại bằng JS từ hợp đồng, không chép SQL.
 * Mỗi hàm nhận ảnh chụp trạng thái DB (đọc ngay trước thao tác) và trả kết quả DB phải cho ra.
 */


/** jsonb ->> của một giá trị JSON (đủ cho dữ liệu bộ thử sinh ra). */
function jsonText(v) {
  if (v === undefined || v === null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return JSON.stringify(v)
}

function parseConfig(raw) {
  let v = null
  try { v = raw == null ? null : JSON.parse(raw) } catch { v = null }
  if (!v || typeof v !== 'object' || Array.isArray(v)) v = {}
  const rt = v.runtimes && typeof v.runtimes === 'object' && !Array.isArray(v.runtimes) ? v.runtimes : {}
  const ids = Array.isArray(v.organizationIds) ? [...new Set(v.organizationIds
    .filter(x => typeof x === 'number' || typeof x === 'string').map(x => String(jsonText(x)).trim()).filter(x => /^[0-9]{1,18}$/.test(x)))] : []
  const poll = typeof v.pollSeconds === 'number' && /^[0-9]{1,6}$/.test(String(v.pollSeconds)) ? v.pollSeconds : 30
  return {
    audience: ['off', 'admin_akabiz', 'orgs', 'all'].includes(v.audience) ? v.audience : 'off',
    organizationIds: ids,
    runtimes: { desktop: 'desktop' in rt ? rt.desktop === true : true, server: 'server' in rt ? rt.server === true : true, fly: rt.fly === true },
    pollSeconds: Math.min(600, Math.max(10, poll))
  }
}

function access(S, org, staff) {
  if (org == null || staff == null || S.cfg.audience === 'off') return false
  const s = S.staff.get(Number(staff))
  if (!s || Number(s.organization_id) !== Number(org) || s.is_active === false || s.deleted_at) return false
  if (S.cfg.audience === 'all') return true
  if (S.cfg.audience === 'orgs') return S.cfg.organizationIds.includes(String(org))
  if (S.cfg.audience === 'admin_akabiz') return s.is_admin_akabiz === true
  return false
}

function runsOn(S, accountId) {
  const a = S.accounts.get(Number(accountId))
  if (!a || String(a.flatform_type ?? '').trim().toLowerCase() !== 'zalo' || a.is_delete || a.organization_id == null) return null
  const f = S.orgFlags.get(Number(a.organization_id)) || {}
  if (S.chatBound.has(Number(a.id)) && f.chat_runtime) return 'akachat'
  if (a.is_zalo_server) return f.fly_route ? 'fly' : 'server'
  return 'desktop'
}

const runtimeOn = (S, r) => ['desktop', 'server', 'fly'].includes(r) && S.cfg.runtimes[r] === true

function createCtx(S, accountId) {
  const st = S.settings.get(Number(accountId))
  const a = S.accounts.get(Number(accountId))
  if (!st || !st.enabled || !a || Number(a.staff_id) !== Number(st.staff_id) || Number(a.organization_id) !== Number(st.organization_id)) return null
  if (!access(S, st.organization_id, st.staff_id)) return null
  const r = runsOn(S, accountId)
  if (!r || r === 'akachat' || !runtimeOn(S, r)) return null
  return { staff_id: st.staff_id, organization_id: st.organization_id, blocklist_ids: st.blocklist_ids || [], runs_on: r }
}

function normPhone(value) {
  let d = String(value ?? '').replace(/[^0-9+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  if (d.startsWith('84')) d = '0' + d.slice(2)
  return /^0[0-9]{9,10}$/.test(d) ? d : null
}

const btrim = s => String(s ?? '').replace(/^ +| +$/g, '')

function excluded(S, acc, blocklistIds, uid, phone) {
  const u = btrim(uid)
  const ex = S.exclusions.get(Number(acc)) || []
  if (u && ex.some(x => x.kind === 'uid' && x.value === u)) return true
  const p = normPhone(phone)
  if (p && ex.some(x => x.kind === 'phone' && x.value === p)) return true
  if ((blocklistIds || []).length > 0 && u) {
    for (const g of blocklistIds) {
      const grp = S.groups.get(Number(g))
      if (!grp || grp.purpose !== 'zalo_friend_blocklist' || grp.is_delete) continue
      for (const m of S.members.get(Number(g)) || []) {
        if (m.is_delete) continue
        const c = S.contactsById.get(Number(m.contact_id))
        if (c && c.contact_type === 'person' && !c.is_delete && btrim(c.uid) === u) return true
      }
    }
  }
  return false
}

/** Có tin sent cùng quy tắc + người (+ chiều với nhóm) trong `minutes` phút tính tới `now` (ms). ambiguous khi sát mép. */
function gapHit(S, ruleId, uid, direction, minutes, now) {
  if (!(Number(minutes) > 0)) return false
  let hit = false; let edge = false
  for (const j of S.sentJobs) {
    if (Number(j.rule_id) !== Number(ruleId) || j.recipient_uid !== uid) continue
    if (['enter', 'leave'].includes(direction) && j.direction !== direction) continue
    const age = now - j.sent_at
    if (age < minutes * 60000) hit = true
    if (Math.abs(age - minutes * 60000) < 5000) edge = true
  }
  return edge ? 'edge' : hit
}

function delayOf(config) {
  const d = config && typeof config === 'object' && !Array.isArray(config) ? config.delay : undefined
  const get = k => {
    const t = d && typeof d === 'object' && !Array.isArray(d) ? jsonText(d[k]) : null
    return t != null && /^[0-9]{1,4}$/.test(t) ? Number(t) : null
  }
  const min = Math.max(0, Math.min(600, get('minSeconds') ?? 20))
  const max0 = Math.max(0, Math.min(600, get('maxSeconds') ?? 60))
  return { min, max: Math.max(min, max0) }
}

function contactOf(S, acc, uid) {
  return S.contactByAccUid.get(`${acc}|person|${uid}`) || null
}

/**
 * Việc DB phải tạo cho một câu lệnh ghi sổ tag (các dòng cùng account, cùng kind). `membersAfter`: Set `tag|uid` ngay sau câu lệnh.
 * Trả mảng { event_id, rule_id, status, reason, ... } hoặc [] khi không tạo gì.
 */
function expectTagJobs(S, acc, rows, membersAfter, now) {
  const rules = (S.rules.get(Number(acc)) || []).filter(r => r.event_type === 'tag_change' && r.enabled && !r.is_delete)
  if (rules.length === 0) return []
  const ctx = createCtx(S, acc)
  if (!ctx) return []
  const groupCount = new Map()
  for (const e of rows) groupCount.set(`${e.tag_id}|${e.kind}`, (groupCount.get(`${e.tag_id}|${e.kind}`) || 0) + 1)
  const sorted = [...rules].sort((a, b) => (a.position - b.position) || (Number(a.id) - Number(b.id)))
  const out = []
  for (const e of rows) {
    const dir = e.kind === 'add' ? 'added' : 'removed'
    const rule = sorted.find(r => {
      const c = r.config && typeof r.config === 'object' && !Array.isArray(r.config) ? r.config : {}
      if (jsonText(c.direction) !== dir) return false
      const ids = Array.isArray(c.tagIds) ? c.tagIds : []
      return ids.some(t => btrim(jsonText(t)) === e.tag_id)
    })
    if (!rule) continue
    const c = rule.config && typeof rule.config === 'object' ? rule.config : {}
    const n = groupCount.get(`${e.tag_id}|${e.kind}`)
    const ct = contactOf(S, acc, e.member_uid)
    let reason = null
    if (e.member_uid.startsWith('g')) reason = 'not_person'
    else if (e.kind === 'remove' && n >= 2 && ![...membersAfter].some(k => k.startsWith(e.tag_id + '|'))) reason = 'tag_deleted'
    else if (n > 20) reason = 'bulk_tag'
    else if (excluded(S, acc, ctx.blocklist_ids, e.member_uid, ct?.phone)) reason = 'excluded'
    else {
      const g = gapHit(S, rule.id, e.member_uid, dir, rule.min_gap_minutes, now)
      if (g === 'edge') reason = '*'
      else if (g) reason = 'min_gap'
    }
    out.push({
      dedupe_key: `tag:${rule.id}:${e.member_uid}:${e.tag_id}:${dir}:${e.id}`, account_id: acc, staff_id: ctx.staff_id, organization_id: ctx.organization_id,
      rule_id: rule.id, rule_revision: rule.revision, event_type: 'tag_change', direction: dir, recipient_uid: e.member_uid,
      recipient_name: ct ? ct.name : null, contact_id: ct ? ct.id : null, tag_id: e.tag_id, source_ref: String(e.id),
      status: reason == null ? 'pending' : reason === '*' ? '*' : 'skipped', reason_code: reason, message_template: jsonText(c.message),
      delay: delayOf(c)
    })
  }
  return out
}

/** Việc cho một thay đổi nguồn thành viên của bộ lọc động (khi giao dịch giữ khoá của nhân viên sở hữu bộ lọc). */
function expectGroupJobs(S, origin, groupId, contact, now, dedupeMs) {
  const dir = origin.is_current ? 'enter' : 'leave'
  const all = [...S.rules.values()].flat().filter(r => Number(r.data_group_id) === Number(groupId) && r.event_type === 'condition_group' && r.enabled && !r.is_delete)
  if (all.length === 0 || !contact) return []
  // Liên hệ bị xoá trong app nên rời nhóm: không gửi tin rời.
  if (dir === 'leave' && contact.is_delete) return []
  const rules = all.filter(r => Number(r.account_id) === Number(contact.account_id)).sort((a, b) => (a.position - b.position) || (Number(a.id) - Number(b.id)))
  const out = []
  for (const r of rules) {
    const c = r.config && typeof r.config === 'object' && !Array.isArray(r.config) ? r.config : {}
    const side = c[dir === 'enter' ? 'onEnter' : 'onLeave']
    if (!(side && typeof side === 'object' && side.enabled === true)) continue
    const ctx = createCtx(S, r.account_id)
    if (!ctx) continue
    const uid = btrim(contact.uid) || null
    let reason = null
    if (uid == null) reason = 'no_uid'
    else if (uid.startsWith('g') || contact.contact_type !== 'person') reason = 'not_person'
    else if (excluded(S, r.account_id, ctx.blocklist_ids, uid, contact.phone)) reason = 'excluded'
    else {
      const g = gapHit(S, r.id, uid, dir, r.min_gap_minutes, now)
      if (g === 'edge') reason = '*'
      else if (g) reason = 'min_gap'
    }
    out.push({
      dedupe_key: `group:${r.id}:${contact.id}:${dir}:${dedupeMs}`, account_id: r.account_id, staff_id: ctx.staff_id, organization_id: ctx.organization_id,
      rule_id: r.id, rule_revision: r.revision, event_type: 'condition_group', direction: dir, recipient_uid: uid, recipient_name: contact.name,
      contact_id: contact.id, tag_id: null, source_ref: String(origin.id), status: reason == null ? 'pending' : reason === '*' ? '*' : 'skipped',
      reason_code: reason, message_template: jsonText(side.message), delay: delayOf(c)
    })
  }
  return out
}

function runnerAccount(S, source, staff, acc) {
  const st = S.settings.get(Number(acc))
  const a = S.accounts.get(Number(acc))
  if (!st || !st.enabled || !a || Number(a.staff_id) !== Number(st.staff_id) || Number(a.organization_id) !== Number(st.organization_id)) return null
  if (staff != null && Number(st.staff_id) !== Number(staff)) return null
  if (!access(S, st.organization_id, st.staff_id)) return null
  if (runsOn(S, acc) !== source) return null
  return st
}

/** Lượt hỏi việc tuần tự. Trả { enabled, jobs:[jobId], updates: Map jobId → {status, reason}, paused:[acc] , error? }. */
function expectClaim(S, source, staff, accountIds, limit, now) {
  const lim = Math.min(20, Math.max(1, limit == null ? 5 : limit))
  const staffRow = staff != null ? S.staff.get(Number(staff)) : null
  if (!runtimeOn(S, source) || S.cfg.audience === 'off' || (staff != null && !access(S, staffRow ? staffRow.organization_id : null, staff))) {
    return { enabled: false, jobs: [], updates: new Map(), paused: [] }
  }
  if (accountIds && accountIds.length > 500) return { error: 'too_many_accounts' }
  const ids = [...new Set((accountIds || []).filter(x => x != null).map(Number))].sort((a, b) => a - b)
  const jobs = []; const updates = new Map(); const paused = []; let ambiguous = false; const skipWhy = []
  for (const acc of ids) {
    if (jobs.length >= lim) break
    const st = runnerAccount(S, source, staff, acc)
    if (!st) { skipWhy.push('not_runner'); continue }
    if (st.paused_until && st.paused_until > now) { paused.push(acc); skipWhy.push('paused'); continue }
    const pend = S.jobs.filter(j => Number(j.account_id) === acc)
    if (pend.some(j => j.status === 'sending')) { skipWhy.push('sending'); continue }
    const queue = pend.filter(j => j.status === 'pending' && j.send_after <= now).sort((a, b) => ((a.send_after_us ?? a.send_after * 1000) - (b.send_after_us ?? b.send_after * 1000)) || (Number(a.id) - Number(b.id)))
    if (queue.some(j => Math.abs(j.send_after - now) < 3000 || (j.expires_at && Math.abs(j.expires_at - now) < 3000))) ambiguous = true
    let tries = 0
    for (const j of queue) {
      tries += 1
      if (tries > 50) break
      let st2 = null; let rs = null
      if (j.expires_at && j.expires_at <= now) { st2 = 'expired'; rs = 'expired' } else {
        const r = S.rulesById.get(Number(j.rule_id))
        if (!r || r.is_delete || !r.enabled || Number(r.account_id) !== acc) { st2 = 'skipped'; rs = 'rule_off' } else if (Number(r.revision) !== Number(j.rule_revision)) { st2 = 'skipped'; rs = 'rule_changed' } else {
          const ct = j.contact_id != null ? S.contactsById.get(Number(j.contact_id)) : contactOf(S, acc, j.recipient_uid)
          const g = j.event_type !== 'birthday' ? gapHit(S, r.id, j.recipient_uid, j.direction, r.min_gap_minutes, now) : false
          if (g === 'edge') ambiguous = true
          const member = S.tagMembers.has(`${acc}|${j.tag_id}|${j.recipient_uid}`)
          const ref = /^[0-9]{1,18}$/.test(String(j.source_ref ?? '')) ? S.origins.get(Number(j.source_ref)) : null
          if (excluded(S, acc, st.blocklist_ids, j.recipient_uid, ct ? ct.phone : null)) { st2 = 'skipped'; rs = 'excluded' } else if (g) { st2 = 'skipped'; rs = 'min_gap' } else if (j.direction === 'added' && !member) { st2 = 'skipped'; rs = 'no_longer_tagged' } else if (j.direction === 'removed' && member) { st2 = 'skipped'; rs = 'tagged_again' } else if (j.direction === 'enter' && !(ref && ref.is_current === true)) { st2 = 'skipped'; rs = 'left_group' } else if (j.direction === 'leave' && ref && ref.is_current === true) { st2 = 'skipped'; rs = 'back_in_group' } else if (!btrim(j.message_template) || !btrim(j.recipient_uid)) { st2 = 'skipped'; rs = 'rule_changed' }
        }
      }
      if (st2) { updates.set(Number(j.id), { status: st2, reason: rs }); continue }
      updates.set(Number(j.id), { status: 'sending', reason: null })
      jobs.push(Number(j.id))
      break
    }
  }
  return { enabled: true, jobs, updates, paused, ambiguous, skipWhy }
}

function expectReport(job, source, staff, token, result) {
  const by = source === 'desktop' ? `desktop:${staff}` : source
  const s = result && typeof result === 'object' && !Array.isArray(result) ? jsonText(result.status) : null
  if (!job && false) return null
  if (token == null || !result || typeof result !== 'object' || Array.isArray(result) || s == null || !['sent', 'failed', 'unknown'].includes(s)) return { ok: false, code: 'invalid_result' }
  if (!job || (staff != null && Number(job.staff_id) !== Number(staff))) return { ok: false, code: 'job_not_found' }
  if (job.claim_token !== token || job.claimed_by !== by) return { ok: false, code: 'claim_lost' }
  if (!(job.status === 'sending' || (job.status === 'unknown' && job.reason_code === 'runner_lost'))) return { ok: true, replay: true, status: job.status }
  const msgId = btrim(jsonText(result.msgId)).slice(0, 100) || null
  const code = btrim(jsonText(result.zaloCode)).slice(0, 20) || null
  let status; let reason = null; let pause = null
  if (s === 'sent' && msgId) status = 'sent'
  else if (s === 'sent') { status = 'failed'; reason = 'no_msg_id'; pause = 30 } else if (s === 'failed') {
    status = 'failed'
    if (code === '120' || code === '802') { reason = 'account_restricted'; pause = 1440 } else if (code === '221') { reason = 'rate_limited'; pause = 60 } else reason = code ? 'recipient_error' : 'send_error'
  } else status = 'unknown'
  return { ok: true, status, reason, pause, code, msgId: status === 'sent' ? msgId : null }
}

module.exports = { parseConfig, access, runsOn, runtimeOn, createCtx, normPhone, excluded, gapHit, delayOf, expectTagJobs, expectGroupJobs, expectClaim, expectReport, runnerAccount, jsonText, btrim }
