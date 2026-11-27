'use strict'
/*
 * Mô hình độc lập của thao tác `save` (docs/EVENT_BOT_TECH.md mục 6.2): luật kiểm từng quy tắc theo validateEventBotRule
 * (src/shared/eventBot.ts) + các kiểm chỉ DB làm được (nhóm điều kiện, danh sách không gửi, mã quy tắc, nơi chạy).
 * Chỗ hợp đồng nói "giống TS" thì mô hình dùng đúng luật TS (khoảng trắng theo String.prototype.trim, độ dài theo ký tự).
 */
const { jsonText, runsOn, runtimeOn } = require('./model.cjs')

const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v)
const chars = s => [...String(s ?? '')].length
const isBlank = s => String(s ?? '').trim() === ''

function intOf(v) {
  if (typeof v !== 'number' && typeof v !== 'string') return null
  const t = String(jsonText(v)).trim()
  return /^-?[0-9]{1,15}$/.test(t) ? Number(t) : null
}

class Fail extends Error { constructor(code, extra = {}) { super(code); this.code = code; this.extra = extra } }
const fail = (code, extra) => { throw new Fail(code, extra) }

function checkMessage(index, field, msg) {
  let issue = null
  if (msg == null || isBlank(msg)) issue = 'Nhập nội dung tin'
  else if (chars(msg) > 2000) issue = 'Nội dung tối đa 2000 ký tự'
  else if (/#\{\s*INPUT_/i.test(msg)) issue = 'Bot không điền được biến cột file (#{INPUT_…})'
  if (issue) fail('rule_invalid', { index, field, message: issue })
}

function normalize(S, rule, index, staff, org, acc) {
  const type = isObj(rule) ? jsonText(rule.eventType) : null
  if (!isObj(rule) || !['birthday', 'tag_change', 'condition_group'].includes(type)) fail('rule_invalid', { index, field: 'eventType' })
  const c = isObj(rule.config) ? rule.config : {}
  const name = (jsonText(rule.name) ?? '').replace(/^ +| +$/g, '') // DB btrim: chỉ cắt dấu cách (tên chỉ để hiển thị)
  if (chars(name) > 80) fail('rule_invalid', { index, field: 'name' })
  const gap = 'minGapMinutes' in rule && rule.minGapMinutes !== null ? intOf(rule.minGapMinutes) : (type === 'tag_change' ? 720 : 0)
  if (gap == null || gap < 0 || gap > 43200) fail('rule_invalid', { index, field: 'minGapMinutes' })
  let min = null; let max = null
  if (type !== 'birthday') {
    const d = isObj(c.delay) ? c.delay : {}
    min = intOf(d.minSeconds); max = intOf(d.maxSeconds)
    if (min == null || max == null || min < 0 || max < min || max > 600) fail('rule_invalid', { index, field: 'delay' })
  }
  let cfg; let group = null
  if (type === 'birthday') {
    if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(jsonText(c.sendTime) ?? '')) fail('rule_invalid', { index, field: 'sendTime' })
    checkMessage(index, 'message', jsonText(c.message))
    cfg = { sendTime: jsonText(c.sendTime), message: jsonText(c.message) }
  } else if (type === 'tag_change') {
    const dir = jsonText(c.direction)
    if (!['added', 'removed'].includes(dir)) fail('rule_invalid', { index, field: 'direction' })
    const tags = [...new Set((Array.isArray(c.tagIds) ? c.tagIds : []).filter(t => typeof t === 'string' || typeof t === 'number')
      .map(t => String(jsonText(t)).trim()).filter(t => t !== ''))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    if (tags.length === 0) fail('rule_invalid', { index, field: 'tagIds' })
    if (tags.length > 20) fail('rule_invalid', { index, field: 'tagIds' })
    if (tags.some(t => !/^[0-9A-Za-z_-]{1,40}$/.test(t))) fail('rule_invalid', { index, field: 'tagIds' })
    const names = (Array.isArray(c.tagNames) ? c.tagNames : []).filter(t => typeof t === 'string').map(t => [...t].slice(0, 80).join(''))
    checkMessage(index, 'message', jsonText(c.message))
    cfg = { direction: dir, tagIds: tags, tagNames: names, message: jsonText(c.message), delay: { minSeconds: min, maxSeconds: max } }
  } else {
    group = intOf(rule.dataGroupId)
    if (group == null || group <= 0) fail('rule_invalid', { index, field: 'dataGroupId' })
    const g = S.groups.get(group)
    if (!g || Number(g.staff_id) !== Number(staff) || Number(g.organization_id) !== Number(org) || g.is_delete || g.purpose !== 'data_group'
      || Number(g.data_type_category_item_id) !== 40 || !(g.bound_zalo_account_id == null || Number(g.bound_zalo_account_id) === Number(acc))) {
      fail('data_group_not_found', { index, field: 'dataGroupId' })
    }
    if (!S.dynFilterGroups.has(group)) fail('data_group_no_filter', { index, field: 'dataGroupId' })
    const side = k => ({ enabled: isObj(c[k]) && c[k].enabled === true, message: (isObj(c[k]) ? jsonText(c[k].message) : null) ?? '' })
    const enter = side('onEnter'); const leave = side('onLeave')
    if (!enter.enabled && !leave.enabled) fail('rule_invalid', { index, field: 'onEnter' })
    if (enter.enabled) checkMessage(index, 'onEnter', enter.message)
    if (leave.enabled) checkMessage(index, 'onLeave', leave.message)
    cfg = { onEnter: enter, onLeave: leave, delay: { minSeconds: min, maxSeconds: max } }
  }
  return {
    id: intOf(rule.id), eventType: type, name, enabled: rule.enabled !== false, position: (p => (p != null && p >= -1e6 && p <= 1e6 ? p : index))(intOf(rule.position)),
    config: cfg, dataGroupId: group, minGapMinutes: gap
  }
}

/** Kết quả DB phải cho cho `save`. Trả { ok:false, code, index?, field?, ruleId? } | { ok:true, rules:[norm], changed, off, deleted } | { conflict }. */
function expectSave(S, staff, org, acc, payload) {
  try {
    if (!Array.isArray(payload.rules) || intOf(payload.revision) == null || typeof payload.enabled !== 'boolean') fail('invalid_request')
    if (payload.rules.length > 81) fail('rule_invalid', { index: -1, field: 'rules' })
    const st = S.settings.get(Number(acc))
    const revision = st ? Number(st.revision) : 0
    if (revision !== intOf(payload.revision)) return { ok: false, code: 'revision_conflict', revision }
    if (payload.enabled) {
      const r = runsOn(S, acc)
      if (r === 'akachat') fail('account_on_akachat')
      if (!r || !runtimeOn(S, r)) fail('runtime_not_supported')
    }
    const raw = Array.isArray(payload.blocklistIds) ? payload.blocklistIds.map(intOf) : []
    const block = [...new Set(raw)]
    if (block.length > 50 || block.some(b => b == null) || block.some(b => {
      const g = S.groups.get(b)
      return !g || Number(g.staff_id) !== Number(staff) || Number(g.organization_id) !== Number(org) || g.is_delete || g.purpose !== 'zalo_friend_blocklist' || g.contact_type !== 'person'
    })) fail('blocklist_not_found')
    const rules = payload.rules.map((r, i) => normalize(S, r, i, staff, org, acc))
    if (rules.filter(r => r.eventType === 'birthday').length > 1) fail('rule_invalid', { index: -1, field: 'rules' })
    if (rules.filter(r => r.eventType === 'tag_change').length > 50) fail('rule_invalid', { index: -1, field: 'rules' })
    if (rules.filter(r => r.eventType === 'condition_group').length > 30) fail('rule_invalid', { index: -1, field: 'rules' })
    const groups = rules.filter(r => r.eventType === 'condition_group').map(r => r.dataGroupId)
    if (new Set(groups).size !== groups.length) fail('duplicate_group')
    const ids = rules.filter(r => r.id != null).map(r => r.id)
    if (new Set(ids).size !== ids.length) fail('invalid_request')
    const changed = []; const off = []
    for (const r of rules) {
      if (r.id == null) continue
      const old = S.rulesById.get(r.id)
      if (!old || Number(old.account_id) !== Number(acc) || old.is_delete || old.event_type !== r.eventType) fail('rule_not_found', { ruleId: r.id })
      if (JSON.stringify(sortKeys(old.config)) !== JSON.stringify(sortKeys(r.config)) || (old.data_group_id == null ? null : Number(old.data_group_id)) !== r.dataGroupId
        || Number(old.min_gap_minutes) !== r.minGapMinutes) changed.push(r.id)
      if (!r.enabled && old.enabled) off.push(r.id)
    }
    const keep = new Set(ids)
    const deleted = (S.rules.get(Number(acc)) || []).filter(r => !r.is_delete && !keep.has(Number(r.id))).map(r => Number(r.id))
    return { ok: true, rules, changed, off: [...off, ...deleted], deleted, block: block.sort((a, b) => a - b), revision }
  } catch (e) {
    if (e instanceof Fail) return { ok: false, code: e.code, ...e.extra }
    throw e
  }
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]))
  return v
}

module.exports = { expectSave, normalize, sortKeys, intOf }
