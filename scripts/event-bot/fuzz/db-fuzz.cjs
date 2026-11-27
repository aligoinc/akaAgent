#!/usr/bin/env node
'use strict'
/*
 * Bộ thử ngẫu nhiên V672 (Bot sự kiện) trên Postgres cục bộ: dựng thế giới ngẫu nhiên (tổ chức, nhân viên, tài khoản Zalo đủ loại,
 * danh bạ, tag, danh sách không gửi, nhóm điều kiện), rồi chạy hàng trăm thao tác ngẫu nhiên đúng đường production gọi:
 *   - sổ tag qua aka_agent_sync_zalo_tags / aka_agent_desktop_sync_zalo_tags thật của V660 (trigger V672 tạo việc);
 *   - vào / ra nhóm điều kiện bằng đúng các câu ghi của aka_agent_process_data_group_dynamic_filters_core (production 27/11/2026);
 *   - sinh nhật, hỏi việc, báo kết quả (Desktop theo phiên + App Server), job dọn, lưu / dừng / loại trừ / nhật ký của trang;
 *   - dữ liệu sai cố ý: quy tắc rác ghi thẳng vào bảng, payload sai kiểu, công tắc JSON hỏng, UID nhóm, SĐT lạ, chuỗi khoảng trắng Unicode.
 * Mỗi thao tác so với mô hình độc lập (model.cjs, save-model.cjs) và kiểm bất biến. Thời gian trôi bằng cách lùi mọi mốc giờ.
 *
 * Cách chạy: PG_MODULE_DIR=<thư mục có node_modules/pg> node scripts/event-bot/fuzz/db-fuzz.cjs --seed 1 [--ops 300] [--pool <file>]
 * Mã thoát 1 khi có vi phạm; in tối đa 40 vi phạm đầu, kèm hạt giống để chạy lại.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { startCluster, rng: mkRng, buildTs } = require('./cluster.cjs')
const M = require('./model.cjs')
const { expectSave, sortKeys } = require('./save-model.cjs')

const args = process.argv.slice(2)
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d }
const SEED = Number(arg('--seed', '1'))
const OPS = Number(arg('--ops', '300'))
const POOL_FILE = arg('--pool', process.env.EVENT_BOT_POOL || '')
const VERBOSE = args.includes('--verbose')
const POOL = POOL_FILE && fs.existsSync(POOL_FILE) ? JSON.parse(fs.readFileSync(POOL_FILE, 'utf8')) : null
const TS = buildTs('src/shared/eventBot.ts')

const violations = []
const stats = {}
const bump = (k, n = 1) => { stats[k] = (stats[k] || 0) + n }
function violate(kind, detail) {
  bump('violation:' + kind)
  if (violations.length < 200) violations.push({ kind, ...detail })
}

// ----------------------------------------------------------------------------------------------------------------------
// Sinh dữ liệu
// ----------------------------------------------------------------------------------------------------------------------

const NAMES = ['Nguyễn Văn An', 'Trần Thị Bích', 'Lê Hoàng', 'Phạm Minh Châu 🌸', '', '   ', 'Đỗ  Quang', 'Ánh Dương ✨✨', 'Mai\nLinh', 'Khách',
  'Bé Na 👶🏻', "O'Neil", 'Hồ Thị Thu Hà (chị Hà)', 'Zalo User', 'Ngô Bảo Trâm']
const WEIRD_SPACES = [' ', '　', '\t', '\n', ' ', '﻿', '​', '\r\n']
const TEMPLATES_BASE = [
  'Chúc mừng sinh nhật #{FULL_NAME}! Chúc {anh|chị} luôn vui khỏe 🎂',
  'Chào #{SEX{anh-chị-anh/chị}} #{FULL_NAME}, cảm ơn đã quan tâm.',
  'Hôm nay #{TODAY(DD/MM)} shop có ưu đãi cho bạn.',
  'Xin chào {bạn|anh chị|quý khách}! | Chào bạn, bên mình gửi ưu đãi.',
  'Cảm ơn #{ORIGINAL_NAME} đã tham gia nhóm.',
  '{Chào|Hi} #{FULL_NAME}',
  'Tin ngắn',
  '#{FULL_NAME}',
  'a'.repeat(1999),
  'Nội dung có #{UID} và #{PHONE} không điền được'
]

function makeGen(r) {
  const used = new Set()
  const uid = () => {
    let u
    do {
      u = POOL && r.chance(0.7) ? r.pick(POOL.uids) : String(r.int(1, 9)) + Array.from({ length: r.pick([16, 17, 18]) }, () => r.int(0, 9)).join('')
      if (used.has(u)) u = u.slice(0, -3) + String(r.int(100, 999))
    } while (used.has(u))
    used.add(u)
    return u
  }
  const phone = () => {
    const core = '9' + Array.from({ length: 8 }, () => r.int(0, 9)).join('')
    if (POOL && POOL.phones && POOL.phones.length && r.chance(0.35)) return r.pick(POOL.phones)
    const forms = ['0' + core, '+84' + core, '84' + core, '+84 ' + core.slice(0, 2) + ' ' + core.slice(2, 5) + ' ' + core.slice(5), '0' + core.slice(0, 3) + '.' + core.slice(3, 6) + '.' + core.slice(6),
      '(+84) ' + core, '0' + core + 'x', 'abc', '', null, '00' + core, '+840' + core, '0' + core.slice(0, 8), '0' + core + '12', '84 0' + core]
    return r.pick(forms)
  }
  const template = () => {
    let t = POOL && POOL.templates && r.chance(0.5) ? r.pick(POOL.templates) : r.pick(TEMPLATES_BASE)
    if (r.chance(0.05)) t = r.pick(WEIRD_SPACES).repeat(r.int(1, 3))
    if (r.chance(0.03)) t = t + ' #{INPUT_Fullname}'
    if (r.chance(0.03)) t = 'x'.repeat(2001)
    if (r.chance(0.04)) t = '😀'.repeat(r.int(1001, 1999)) // 2 ký tự UTF-16 mỗi emoji
    if (r.chance(0.04)) t = r.pick(WEIRD_SPACES) + t + r.pick(WEIRD_SPACES)
    return t
  }
  return { uid, phone, template, name: () => (POOL && POOL.names && POOL.names.length && r.chance(0.5) ? r.pick(POOL.names) : r.pick(NAMES)) }
}

async function buildWorld(c, r, G) {
  const W = { orgs: [], staff: [], accounts: [], contacts: new Map(), tags: new Map(), dataGroups: [], blocklists: [], filters: [] }
  const orgN = r.int(3, 4)
  for (let o = 0; o < orgN; o++) {
    const org = 10 + o * 10
    W.orgs.push(org)
    await c.query('INSERT INTO test_org_flags VALUES ($1,$2,$3)', [org, r.chance(0.2), r.chance(0.3)])
    const staffN = r.int(2, 3)
    for (let k = 0; k < staffN; k++) {
      const s = { id: org * 10 + k, org, is_active: !r.chance(0.04), deleted: r.chance(0.03), admin: r.chance(0.3) }
      W.staff.push(s)
      await c.query('INSERT INTO org_staff (id, organization_id, name, is_active, is_admin_akabiz, deleted_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [s.id, org, 'NV ' + s.id, s.is_active, s.admin, s.deleted ? new Date() : null])
      const accN = r.int(2, 4)
      for (let a = 0; a < accN; a++) {
        const id = s.id * 10 + a
        const kind = r.pick(['qr', 'qr', 'server', 'server', 'web'])
        const acc = { id, staff: s.id, org, kind, flat: r.pick(['zalo', 'zalo', 'zalo', 'zalo', 'zalo', 'zalo', ' Zalo ', 'facebook']), del: r.chance(0.05) }
        W.accounts.push(acc)
        await c.query(`INSERT INTO zalo_accounts (id, zalo_uid, display_name) VALUES ($1,$2,$3)`, [id, '9' + id, 'Zalo ' + id])
        await c.query(`INSERT INTO auto_accounts (id, name, staff_id, organization_id, flatform_type, is_zalo_server, is_zalo_show_web, is_delete, zalo_account_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$1)`, [id, 'TK ' + id, s.id, org, acc.flat, kind === 'server', kind === 'web', acc.del])
        if (r.chance(0.12)) await c.query('INSERT INTO chat_zalo_account_organization (organization_id, auto_account_id, is_active) VALUES ($1,$2,$3)', [org, id, r.chance(0.8)])
        // Danh bạ
        const people = []
        const n = r.int(12, 40)
        for (let i = 0; i < n; i++) {
          const u = r.chance(0.05) ? 'g' + G.uid() : G.uid()
          const stored = r.chance(0.03) ? r.pick(['', '   ', null]) : r.chance(0.03) ? ' ' + u + ' ' : u
          const row = (await c.query(`INSERT INTO auto_account_contacts (account_id, contact_type, name, uid, phone, is_delete, staff_id, organization_id, flatform_type)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'zalo') RETURNING id`, [id, u.startsWith('g') ? 'group' : r.chance(0.97) ? 'person' : 'page', G.name(), stored === null ? null : stored === '' || stored === '   ' ? stored + i : stored, G.phone(), r.chance(0.04), s.id, org])).rows[0]
          people.push({ id: Number(row.id), uid: u })
        }
        W.contacts.set(id, people)
        const tagIds = r.sample(POOL ? [...new Set(POOL.tags.map(t => t.id))] : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '14', '15'], r.int(2, 6))
        for (const t of tagIds) {
          await c.query(`INSERT INTO auto_account_contacts (account_id, contact_type, name, uid, staff_id, organization_id) VALUES ($1,'zalo_tag',$2,$3,$4,$5)`, [id, 'Tag ' + t, t, s.id, org])
        }
        W.tags.set(id, { ids: tagIds, members: new Map(tagIds.map(t => [t, new Set()])), version: 0, baselined: false })
      }
    }
    // Nhóm (của nhân viên trong tổ chức)
    for (const s of W.staff.filter(x => x.org === org)) {
      const myAcc = W.accounts.filter(a => a.staff === s.id)
      for (let b = 0; b < r.int(0, 2); b++) {
        const bdel = r.chance(0.1)
        const g = (await c.query(`INSERT INTO auto_account_contact_groups (account_id, contact_type, name, staff_id, organization_id, purpose, is_delete)
          VALUES (NULL,'person',$1,$2,$3,'zalo_friend_blocklist',$4) RETURNING id`, ['DS không gửi ' + b, s.id, org, bdel])).rows[0]
        const gid = Number(g.id)
        W.blocklists.push({ id: gid, staff: s.id, org, del: bdel })
        for (const a of myAcc) for (const p of r.sample(W.contacts.get(a.id), r.int(0, 4))) {
          await c.query('INSERT INTO auto_account_contact_group_members (group_id, contact_id, is_delete) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [gid, p.id, r.chance(0.1)])
        }
      }
      for (let d = 0; d < r.int(1, 3); d++) {
        const bound = r.chance(0.3) && myAcc.length ? r.pick(myAcc).id : null
        const cat = r.chance(0.9) ? 40 : 34; const gdel = r.chance(0.05)
        const g = (await c.query(`INSERT INTO auto_account_contact_groups (contact_type, name, staff_id, organization_id, purpose, data_type_category_item_id, bound_zalo_account_id, is_delete)
          VALUES ('person',$1,$2,$3,'data_group',$4,$5,$6) RETURNING id`, ['Nhóm ' + d, s.id, org, cat, bound, gdel])).rows[0]
        const gid = Number(g.id)
        let filter = null
        if (r.chance(0.85)) {
          const owner = r.chance(0.9) ? s.id : r.pick(W.staff).id
          filter = Number((await c.query('INSERT INTO auto_account_contact_group_dynamic_filters (group_id, staff_id, organization_id, is_enabled) VALUES ($1,$2,$3,$4) RETURNING id', [gid, owner, org, r.chance(0.9)])).rows[0].id)
          W.filters.push({ id: filter, group: gid, owner })
        }
        W.dataGroups.push({ id: gid, staff: s.id, org, filter, bound, ok: cat === 40 && !gdel })
      }
    }
  }
  return W
}

function configValue(r, W) {
  const roll = r.next()
  if (roll < 0.04) return r.pick(['not json', '', '[]', '{"audience":', 'null', '"all"', '{"audience":"ALL"}'])
  const v = { audience: r.chance(0.7) ? 'all' : r.pick(['orgs', 'admin_akabiz', 'off', 'everyone']) }
  if (v.audience === 'orgs' || r.chance(0.2)) v.organizationIds = r.sample(W.orgs, r.int(0, W.orgs.length)).map(o => r.chance(0.3) ? String(o) : r.chance(0.1) ? ' ' + o + ' ' : o)
  if (r.chance(0.1)) v.organizationIds = [null, {}, 'abc', -1, ...(v.organizationIds || [])]
  if (r.chance(0.9)) v.runtimes = { desktop: r.chance(0.92), server: r.chance(0.92), fly: r.chance(0.2) }
  if (r.chance(0.05)) v.runtimes = r.pick([[], 'x', { desktop: 'true' }])
  if (r.chance(0.3)) v.pollSeconds = r.pick([5, 10, 30, 601, '30', 3.5, -1, 1e7])
  return JSON.stringify(v)
}

// ----------------------------------------------------------------------------------------------------------------------
// Đọc trạng thái
// ----------------------------------------------------------------------------------------------------------------------

const ms = v => (v == null ? null : new Date(v).getTime())

async function dump(c) {
  const q = async s => (await c.query(s)).rows
  const S = {}
  const cfgRow = (await q(`SELECT value FROM auto_system_settings WHERE key='event_bot' AND is_active ORDER BY id LIMIT 1`))[0]
  S.cfgRaw = cfgRow ? cfgRow.value : null
  S.cfg = M.parseConfig(S.cfgRaw)
  S.dbCfg = (await q('SELECT private.aka_agent_event_bot_config() c'))[0].c
  S.staff = new Map((await q('SELECT * FROM org_staff')).map(x => [Number(x.id), x]))
  S.accounts = new Map((await q('SELECT * FROM auto_accounts')).map(x => [Number(x.id), x]))
  S.orgFlags = new Map((await q('SELECT * FROM test_org_flags')).map(x => [Number(x.organization_id), x]))
  S.chatBound = new Set((await q('SELECT auto_account_id FROM chat_zalo_account_organization WHERE is_active')).map(x => Number(x.auto_account_id)))
  S.settings = new Map((await q('SELECT * FROM auto_event_bot_settings')).map(x => [Number(x.account_id), { ...x, paused_until: ms(x.paused_until), blocklist_ids: (x.blocklist_ids || []).map(Number) }]))
  const rules = await q('SELECT * FROM auto_event_bot_rules ORDER BY id')
  S.rules = new Map(); S.rulesById = new Map()
  for (const rr of rules) {
    rr.id = Number(rr.id); rr.account_id = Number(rr.account_id)
    if (!S.rules.has(rr.account_id)) S.rules.set(rr.account_id, [])
    S.rules.get(rr.account_id).push(rr); S.rulesById.set(rr.id, rr)
  }
  const contacts = await q('SELECT * FROM auto_account_contacts')
  S.contactsById = new Map(); S.contactByAccUid = new Map()
  for (const x of contacts) {
    x.id = Number(x.id)
    S.contactsById.set(x.id, x)
    if (!x.is_delete) S.contactByAccUid.set(`${x.account_id}|${x.contact_type}|${x.uid}`, x)
  }
  S.exclusions = new Map()
  for (const x of await q('SELECT * FROM auto_event_bot_exclusions')) {
    const k = Number(x.account_id); if (!S.exclusions.has(k)) S.exclusions.set(k, []); S.exclusions.get(k).push(x)
  }
  S.groups = new Map((await q('SELECT * FROM auto_account_contact_groups')).map(x => [Number(x.id), x]))
  S.members = new Map()
  for (const m of await q('SELECT * FROM auto_account_contact_group_members')) {
    const k = Number(m.group_id); if (!S.members.has(k)) S.members.set(k, []); S.members.get(k).push(m)
  }
  S.dynFilterGroups = new Set((await q('SELECT group_id FROM auto_account_contact_group_dynamic_filters')).map(x => Number(x.group_id)))
  S.jobs = (await q('SELECT *, (extract(epoch FROM send_after)*1000000)::bigint AS send_after_us FROM auto_event_bot_jobs ORDER BY id')).map(j => ({ ...j, id: Number(j.id), send_after: ms(j.send_after), send_after_us: Number(j.send_after_us), expires_at: ms(j.expires_at), sent_at: ms(j.sent_at), claimed_at: ms(j.claimed_at) }))
  S.jobsById = new Map(S.jobs.map(j => [j.id, j]))
  S.sentJobs = S.jobs.filter(j => j.status === 'sent')
  S.tagMembers = new Set((await q('SELECT * FROM auto_zalo_tag_members')).map(m => `${m.account_id}|${m.tag_id}|${m.member_uid}`))
  S.origins = new Map((await q('SELECT * FROM auto_account_contact_group_member_origins')).map(o => [Number(o.id), o]))
  S.now = Number((await q('SELECT extract(epoch FROM clock_timestamp())*1000 AS t'))[0].t)
  return S
}

async function campaignFingerprint(c) {
  const r = await c.query(`SELECT md5(string_agg(t, '|' ORDER BY t)) h FROM (
    SELECT 'd'||to_jsonb(x)::text t FROM auto_campaign_details x UNION ALL SELECT 's'||to_jsonb(x)::text FROM auto_account_action_status x
    UNION ALL SELECT 'l'||to_jsonb(x)::text FROM auto_engine_leases x UNION ALL SELECT 'c'||to_jsonb(x)::text FROM auto_campaigns x
    UNION ALL SELECT 'i'||to_jsonb(x)::text FROM auto_campaign_input_data x) q`)
  return r.rows[0].h
}

// ----------------------------------------------------------------------------------------------------------------------
// Gọi RPC theo vai
// ----------------------------------------------------------------------------------------------------------------------

async function asDesktop(c, staff, sql, params) {
  await c.query('BEGIN')
  try {
    await c.query(`SELECT set_config('test.staff', $1, true)`, [String(staff)])
    await c.query('SET LOCAL ROLE aka_agent_desktop')
    const res = await c.query(sql, params)
    await c.query('COMMIT')
    return { rows: res.rows }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    return { error: e }
  }
}

async function call(c, sql, params) {
  try { return { rows: (await c.query(sql, params)).rows } } catch (e) { return { error: e } }
}

async function control(c, staff, org, action, payload) {
  return call(c, 'SELECT public.aka_agent_control_event_bot($1,$2,$3,$4::jsonb) r', [staff, org, action, payload === undefined ? null : JSON.stringify(payload)])
}

// ----------------------------------------------------------------------------------------------------------------------
// Sinh quy tắc (đúng kiểu trang gửi, có biến thể sai cố ý)
// ----------------------------------------------------------------------------------------------------------------------

function genRule(r, G, W, acc, existing, clean = false, forceType = null) {
  const type = forceType || r.pick(['birthday', 'tag_change', 'tag_change', 'condition_group'])
  const tagInfo = W.tags.get(acc.id)
  const myGroups = W.dataGroups.filter(g => g.staff === acc.staff)
  const delay = () => { const a = r.int(0, 60); return { minSeconds: a, maxSeconds: a + r.int(0, 120) } }
  let rule
  if (type === 'birthday') {
    rule = { eventType: type, name: 'Sinh nhật', enabled: r.chance(0.85), minGapMinutes: 0,
      config: { sendTime: r.pick(['08:30', '00:00', '23:59', '07:05', '12:00']), message: G.template() } }
  } else if (type === 'tag_change') {
    rule = { eventType: type, name: 'Tag ' + r.int(1, 99), enabled: r.chance(0.9), minGapMinutes: r.pick([0, 0, 1, 5, 720]),
      config: { direction: r.pick(['added', 'removed']), tagIds: r.sample(tagInfo.ids, r.int(1, tagInfo.ids.length)), tagNames: ['A'], message: G.template(), delay: delay() } }
  } else {
    const g = myGroups.length ? r.pick(myGroups) : { id: 999999 }
    rule = { eventType: type, name: 'Nhóm', enabled: r.chance(0.9), minGapMinutes: r.pick([0, 0, 10]), dataGroupId: g.id,
      config: { onEnter: { enabled: r.chance(0.8), message: G.template() }, onLeave: { enabled: r.chance(0.5), message: G.template() }, delay: delay() } }
  }
  if (existing && r.chance(0.7)) { rule.id = existing.id; rule.eventType = existing.event_type; if (r.chance(0.5)) { rule.config = existing.config; rule.dataGroupId = existing.data_group_id; rule.minGapMinutes = existing.min_gap_minutes } }
  // Biến thể sai
  const roll = clean ? 1 : r.next()
  if (roll < 0.25) {
    const m = r.int(1, 26)
    const c2 = rule.config && typeof rule.config === 'object' ? { ...rule.config } : {}
    switch (m) {
      case 1: rule.eventType = r.pick(['BIRTHDAY', 'tag', 5, null]); break
      case 2: rule.name = 'n'.repeat(81); break
      case 3: rule.name = '  ' + 'n'.repeat(80) + '  '; break
      case 4: rule.minGapMinutes = r.pick([-1, 43201, '30', '3e1', 1.5, null, true, 'abc']); break
      case 5: delete rule.minGapMinutes; break
      case 6: c2.delay = r.pick([{ minSeconds: 10, maxSeconds: 5 }, { minSeconds: -1, maxSeconds: 5 }, { minSeconds: 0, maxSeconds: 601 }, { minSeconds: '10', maxSeconds: '20' }, null, 'x', { minSeconds: 1.5, maxSeconds: 2 }]); break
      case 7: c2.sendTime = r.pick(['8:30', '24:00', '08:60', '', null, ' 08:30']); break
      case 8: c2.direction = r.pick(['add', 'ADDED', null]); break
      case 9: c2.tagIds = r.pick([[], ['bad id'], Array.from({ length: 21 }, (_, i) => String(i + 1)), [' 2 ', '2', 2], [null, {}, '3'], 'x', [''] ]); break
      case 10: c2.message = r.pick(WEIRD_SPACES) + r.pick(WEIRD_SPACES); if (c2.onEnter) c2.onEnter = { enabled: true, message: '\n\t ' }; break
      case 11: if (rule.eventType === 'condition_group') { delete c2.onEnter; delete c2.onLeave } else c2.message = null; break
      case 12: if (rule.eventType === 'condition_group') { c2.onEnter = { enabled: 'true', message: 'x' }; c2.onLeave = { enabled: 1, message: 'y' } } break
      case 13: rule.dataGroupId = r.pick([0, -5, 'abc', null, '12x', W.dataGroups.length ? r.pick(W.dataGroups).id : 1]); break
      case 14: rule.config = r.pick([null, [], 'x', 5]); break
      case 15: rule.id = r.pick([-1, 0, 99999999, 'x', '1']); break
      case 16: rule.enabled = r.pick([null, 'false', 0, 'no']); break
      case 17: rule.position = r.pick([-3, '7', 'x', 1e12]); break
      case 18: c2.message = 'Xin chào #{ input_name }'; break
      case 19: c2.message = '😀'.repeat(1500); break
      case 20: rule.name = 42; break
      case 21: c2.tagNames = [1, null, 'n'.repeat(100)]; break
      case 22: c2.message = 5; break
      case 23: if (rule.eventType === 'condition_group') c2.onEnter = { enabled: true, message: null }; break
      case 24: rule = r.pick([null, 'x', [], 5]); break
      case 25: c2.extra = { a: 1 }; break
      case 26: c2.delay = { minSeconds: 600, maxSeconds: 600 }; break
    }
    if (rule && typeof rule === 'object' && !Array.isArray(rule) && rule.config && typeof rule.config === 'object' && m !== 14) rule.config = c2
    bump('rule:mutated')
  }
  return rule
}

// ----------------------------------------------------------------------------------------------------------------------
// Thao tác + kiểm
// ----------------------------------------------------------------------------------------------------------------------

function sameJson(a, b) { return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b)) }

async function opSave(c, r, G, W, ctx, forceAcc = null) {
  const acc = forceAcc || r.pick(W.accounts)
  const staff = forceAcc || r.chance(0.93) ? acc.staff : r.pick(W.staff).id
  const org = W.staff.find(s => s.id === staff).org
  const S = await dump(c)
  const st = S.settings.get(acc.id)
  const existing = (S.rules.get(acc.id) || []).filter(x => !x.is_delete)
  let rules
  if (forceAcc) {
    rules = [genRule(r, G, W, acc, null, true, 'tag_change'), genRule(r, G, W, acc, null, true, 'tag_change'), genRule(r, G, W, acc, null, true, 'birthday')]
    for (const g of W.dataGroups.filter(g => g.ok && g.staff === acc.staff && g.filter && (g.bound == null || g.bound === acc.id))) {
      const gr = genRule(r, G, W, acc, null, true, 'condition_group'); gr.dataGroupId = g.id; rules.push(gr)
    }
    rules = rules.map(x => ({ ...x, enabled: true, config: x.eventType === 'condition_group' ? { ...x.config, onEnter: { enabled: true, message: 'Chào #{FULL_NAME}' }, onLeave: { enabled: r.chance(0.7), message: 'Tạm biệt #{FULL_NAME}' } } : { ...x.config, message: 'Chào #{FULL_NAME} ' + x.eventType } }))
  }
  else if (r.chance(0.15)) rules = existing.map(e => ({ id: e.id, eventType: e.event_type, name: e.name, enabled: e.enabled, position: e.position, config: e.config, dataGroupId: e.data_group_id, minGapMinutes: e.min_gap_minutes }))
  else {
    rules = []
    for (const e of existing) if (r.chance(0.7)) rules.push(genRule(r, G, W, acc, e))
    for (let i = 0; i < r.int(0, 3); i++) rules.push(genRule(r, G, W, acc, null))
  }
  const blocks = W.blocklists.filter(b => b.staff === acc.staff)
  const payload = {
    accountId: forceAcc || r.chance(0.97) ? acc.id : r.pick([String(acc.id), -1, 'x', null]),
    revision: forceAcc || r.chance(0.92) ? (st ? Number(st.revision) : 0) : r.pick([999, -1, '0', null, 'x']),
    enabled: forceAcc ? true : r.chance(0.95) ? r.chance(0.85) : r.pick(['true', 1, null]),
    blocklistIds: forceAcc ? r.sample(blocks.filter(b => !b.del), r.int(0, 2)).map(b => b.id) : r.chance(0.9) ? r.sample(blocks, r.int(0, blocks.length)).map(b => b.id) : r.pick([[999999], ['x'], [null], 'x', [blocks[0]?.id, blocks[0]?.id]]),
    rules: forceAcc || r.chance(0.97) ? rules : r.pick([null, {}, 'x'])
  }
  const res = await control(c, staff, org, 'save', payload)
  bump('op:save')
  if (res.error) { violate('save_exception', { message: res.error.message, payload }); return }
  const out = res.rows[0].r
  // Tài khoản không thuộc nhân viên / accountId sai: account_not_found.
  const owned = S.accounts.get(Number(payload.accountId))
  const accIdOk = (typeof payload.accountId === 'number' || (typeof payload.accountId === 'string' && /^\d+$/.test(payload.accountId)))
  const accessOk = M.access(S, org, staff)
  if (!accessOk) { bump('save:no_access'); if (out.ok !== false || out.code !== 'not_enabled') violate('save_access', { out, staff, org }); return }
  if (!accIdOk || !owned || Number(owned.staff_id) !== staff || Number(owned.organization_id) !== org || String(owned.flatform_type).trim().toLowerCase() !== 'zalo' || owned.is_delete) {
    bump('save:not_owned')
    if (out.ok !== false || out.code !== 'account_not_found') violate('save_account', { out, accountId: payload.accountId })
    return
  }
  const exp = expectSave(S, staff, org, acc.id, payload)
  // So với luật TS (validateEventBotRules): trang chặn trước khi gọi API, DB phải chặn ít nhất những gì TS chặn trên dữ liệu đúng kiểu.
  if (Array.isArray(payload.rules)) {
    let tsIssues = null
    try { tsIssues = TS.validateEventBotRules(payload.rules) } catch (e) { tsIssues = [{ crash: e.message }] }
    if (tsIssues.some(i => i.crash)) violate('ts_validate_crash', { message: tsIssues[0].crash })
    ctx.tsCompare.push({ ts: tsIssues.length === 0, db: out.ok === true || (out.code !== 'rule_invalid' && out.code !== 'invalid_request') })
  }
  if (exp.ok !== out.ok || (!exp.ok && (exp.code !== out.code || (exp.index !== undefined && exp.index !== out.index) || (exp.field !== undefined && exp.field !== out.field)))) {
    violate('save_mismatch', { expect: { ok: exp.ok, code: exp.code, index: exp.index, field: exp.field }, got: { ok: out.ok, code: out.code, index: out.index, field: out.field, message: out.message }, rules: payload.rules && JSON.stringify(payload.rules).slice(0, 1500) })
    return
  }
  if (!exp.ok) { bump('save:rejected:' + exp.code); if (forceAcc && VERBOSE) console.log('bootstrap save rejected', acc.id, exp); return }
  bump('save:ok')
  const S2 = await dump(c)
  const live = (S2.rules.get(acc.id) || []).filter(x => !x.is_delete).sort((a, b) => a.id - b.id)
  if (live.length !== exp.rules.length) violate('save_rule_count', { expect: exp.rules.length, got: live.length })
  for (const er of exp.rules) {
    const dr = er.id != null ? S2.rulesById.get(er.id) : live.find(x => !S.rulesById.has(x.id) && x.event_type === er.eventType && sameJson(x.config, er.config) && x.position === er.position)
    if (!dr) { violate('save_rule_missing', { er }); continue }
    if (!sameJson(dr.config, er.config) || dr.enabled !== er.enabled || dr.name !== er.name || dr.min_gap_minutes !== er.minGapMinutes || (dr.data_group_id == null ? null : Number(dr.data_group_id)) !== er.dataGroupId || dr.position !== er.position) {
      violate('save_rule_values', { expect: er, got: { config: dr.config, enabled: dr.enabled, name: dr.name, gap: dr.min_gap_minutes, group: dr.data_group_id, position: dr.position } })
    }
    if (er.id != null) {
      const old = S.rulesById.get(er.id)
      const want = old.revision + (exp.changed.includes(er.id) ? 1 : 0)
      if (dr.revision !== want) violate('save_rule_revision', { id: er.id, want, got: dr.revision })
    }
  }
  for (const id of exp.deleted) if (!S2.rulesById.get(id).is_delete) violate('save_not_deleted', { id })
  const st2 = S2.settings.get(acc.id)
  if (Number(st2.revision) !== exp.revision + 1 || st2.enabled !== payload.enabled || JSON.stringify(st2.blocklist_ids) !== JSON.stringify(exp.block)) {
    violate('save_settings', { want: { revision: exp.revision + 1, enabled: payload.enabled, block: exp.block }, got: { revision: st2.revision, enabled: st2.enabled, block: st2.blocklist_ids } })
  }
  // Việc chờ bị đóng đúng lý do.
  const before = S.jobs.filter(j => Number(j.account_id) === acc.id && j.status === 'pending')
  let closed = 0
  for (const j of before) {
    const after = S2.jobsById.get(j.id)
    let want = null
    if (!payload.enabled) want = 'bot_off'
    else if (exp.off.includes(Number(j.rule_id))) want = 'rule_off'
    else if (exp.changed.includes(Number(j.rule_id))) want = 'rule_changed'
    if (want) { closed++; if (after.status !== 'skipped' || after.reason_code !== want) violate('save_close', { job: j.id, want, got: [after.status, after.reason_code] }) } else if (after.status !== 'pending') violate('save_closed_extra', { job: j.id, got: [after.status, after.reason_code] })
  }
  if (out.data.closedJobs !== closed) violate('save_closed_count', { want: closed, got: out.data.closedJobs })
  // get trả đúng khuôn trang đọc.
  checkDetailShape(out.data, acc.id)
}

const junkRules = new Set()
function checkDetailShape(d, accId) {
  const bad = []
  if (!d || typeof d !== 'object') bad.push('data')
  else {
    if (!d.account || Number(d.account.accountId) !== accId) bad.push('account')
    if (!d.settings || typeof d.settings.enabled !== 'boolean' || typeof d.settings.revision !== 'number') bad.push('settings')
    if (!Array.isArray(d.rules)) bad.push('rules')
    for (const rr of d.rules || []) {
      if (junkRules.has(Number(rr.id))) continue
      if (rr.eventType === 'condition_group') for (const k of ['onEnter', 'onLeave']) if (typeof rr.config?.[k]?.enabled !== 'boolean' || typeof rr.config?.[k]?.message !== 'string') bad.push('rule.' + k)
      if (rr.eventType === 'tag_change' && (!Array.isArray(rr.config?.tagIds) || typeof rr.config?.message !== 'string')) bad.push('rule.tag')
      if (rr.eventType === 'birthday' && (typeof rr.config?.sendTime !== 'string' || typeof rr.config?.message !== 'string')) bad.push('rule.birthday')
      if (rr.eventType !== 'birthday' && (typeof rr.config?.delay?.minSeconds !== 'number' || typeof rr.config?.delay?.maxSeconds !== 'number')) bad.push('rule.delay')
    }
    for (const k of ['exclusions', 'blocklists', 'tags', 'dataGroups']) if (!Array.isArray(d[k])) bad.push(k)
    if (!d.conflicts || !Array.isArray(d.conflicts.birthdayCampaigns)) bad.push('conflicts')
  }
  if (bad.length) violate('detail_shape', { bad: [...new Set(bad)] })
}

/** Ảnh chụp tag mới của một tài khoản rồi báo qua V660 thật. */
async function opTagSnapshot(c, r, G, W, ctx, forceAcc = null, mutate = null) {
  const live = (await c.query(`SELECT DISTINCT r.account_id FROM auto_event_bot_rules r JOIN auto_event_bot_settings s ON s.account_id=r.account_id AND s.enabled WHERE r.event_type='tag_change' AND r.enabled AND NOT r.is_delete`)).rows.map(x => Number(x.account_id))
  const pool = r.chance(0.8) && live.length ? W.accounts.filter(a => live.includes(a.id) && a.kind !== 'web') : W.accounts.filter(a => a.kind !== 'web')
  const acc = forceAcc || r.pick(pool.length ? pool : W.accounts)
  const info = W.tags.get(acc.id)
  const people = W.contacts.get(acc.id)
  const mode = mutate ? 2 : r.next()
  if (mutate) mutate(info)
  for (const t of mutate ? [] : info.ids) {
    const set = info.members.get(t)
    if (mode < 0.05 && set.size >= 2) { set.clear(); continue } // tag bị gỡ hết người
    if (mode < 0.1 && r.chance(0.5)) { const swap = r.sample(people, set.size || 1).map(p => p.uid); set.clear(); swap.forEach(u => set.add(u)); continue } // đổi hết người
    if (mode < 0.18) { r.sample(people, Math.min(people.length, r.int(15, 40))).forEach(p => set.add(p.uid)); continue } // gắn hàng loạt
    if (mode > 0.6 && info.flap && info.flap.length) {
      // Lật lại người vừa được gửi tin: gắn / gỡ lặp lại để chạm khoảng cách tối thiểu.
      for (const u of r.sample(info.flap, Math.min(3, info.flap.length))) { if (set.has(u)) set.delete(u); else set.add(u) }
      continue
    }
    for (let i = 0; i < r.int(0, 3); i++) set.add(r.pick(people).uid)
    for (const u of [...set]) if (r.chance(0.15)) set.delete(u)
    if (r.chance(0.02)) set.add('  ' + r.pick(people).uid + '  ')
  }
  const deletedTag = mode > 0.97 && mode < 1 && info.ids.length > 1 ? r.pick(info.ids) : null
  info.version += 1
  const tags = info.ids.filter(t => t !== deletedTag).map(t => ({ id: t, name: 'Tag ' + t, m: [...info.members.get(t)] }))
  if (deletedTag) { info.members.get(deletedTag).clear() }
  const items = [{ a: String(acc.id), v: 'v' + info.version, tags }]
  const sql = acc.kind === 'server' ? `SELECT public.aka_agent_sync_zalo_tags('server', $1::jsonb) r` : `SELECT public.aka_agent_desktop_sync_zalo_tags($1::jsonb) r`
  const before = await dump(c)
  const lastEvent = Number((await c.query('SELECT COALESCE(max(id),0) m FROM auto_zalo_tag_member_events')).rows[0].m)
  const t0 = Number((await c.query('SELECT extract(epoch FROM clock_timestamp())*1000 t')).rows[0].t)
  const res = acc.kind === 'server' ? await call(c, sql, [JSON.stringify(items)]) : await asDesktop(c, acc.staff, sql, [JSON.stringify(items)])
  const t1 = Number((await c.query('SELECT extract(epoch FROM clock_timestamp())*1000 t')).rows[0].t)
  bump('op:tag')
  if (res.error) { bump('tag:rpc_error:' + res.error.message.slice(0, 40)); return }
  const tr = res.rows[0].r || {}
  for (const k of ['rejected', 'baselined', 'needTags']) if (Array.isArray(tr[k]) && tr[k].length) bump('tag:' + k)
  if (tr.enabled === false) bump('tag:sync_off')
  const events = (await c.query('SELECT * FROM auto_zalo_tag_member_events WHERE id > $1 ORDER BY id', [lastEvent])).rows.map(e => ({ ...e, id: Number(e.id), account_id: Number(e.account_id) }))
  if (events.length === 0) { bump('tag:no_events'); return }
  bump('tag:events', events.length)
  const after = new Set((await c.query('SELECT tag_id, member_uid FROM auto_zalo_tag_members WHERE account_id = $1', [acc.id])).rows.map(m => `${m.tag_id}|${m.member_uid}`))
  info.flap = (await c.query(`SELECT DISTINCT recipient_uid FROM auto_event_bot_jobs WHERE account_id=$1 AND event_type='tag_change' AND status IN ('sent','pending','sending') LIMIT 20`, [acc.id])).rows.map(x => x.recipient_uid)
  const added = new Set(events.filter(e => e.kind === 'add').map(e => `${e.tag_id}|${e.member_uid}`))
  const mid = new Set([...after].filter(k => !added.has(k)))
  const removes = events.filter(e => e.kind === 'remove'); const adds = events.filter(e => e.kind === 'add')
  // Ý định: "tag bị xoá" = tag không còn ai sau cả lần đọc (không phải sau riêng câu xoá).
  void mid
  const expected = [...M.expectTagJobs(before, acc.id, removes, after, t0), ...M.expectTagJobs(before, acc.id, adds, after, t0)]
  const got = (await c.query(`SELECT * FROM auto_event_bot_jobs WHERE event_type='tag_change' AND source_ref = ANY($1::text[])`, [events.map(e => String(e.id))])).rows
  compareJobs('tag', expected, got, t0, t1)
}

function compareJobs(kind, expected, got, t0, t1) {
  const byKey = new Map(got.map(j => [j.dedupe_key, j]))
  for (const e of expected) {
    const j = byKey.get(e.dedupe_key)
    if (!j) { violate(kind + '_job_missing', { e }); continue }
    byKey.delete(e.dedupe_key)
    if (e.status === '*') { bump(kind + ':ambiguous'); continue }
    const diffs = []
    for (const k of ['status', 'reason_code', 'rule_revision', 'direction', 'recipient_uid', 'recipient_name', 'tag_id', 'source_ref', 'message_template']) {
      if ((j[k] ?? null) !== (e[k] ?? null) && String(j[k] ?? null) !== String(e[k] ?? null)) diffs.push(k)
    }
    for (const k of ['account_id', 'staff_id', 'organization_id', 'rule_id', 'contact_id']) if (Number(j[k] ?? -1) !== Number(e[k] ?? -1)) diffs.push(k)
    const sa = ms(j.send_after)
    if (sa < t0 + e.delay.min * 1000 - 50 || sa > t1 + (e.delay.max + 1) * 1000 + 50) diffs.push('send_after')
    const ex = ms(j.expires_at)
    if (ex < t0 + 29.9 * 60000 || ex > t1 + 30.1 * 60000) diffs.push('expires_at')
    if (diffs.length) violate(kind + '_job_diff', { diffs, expect: e, got: Object.fromEntries(diffs.map(k => [k, j[k]])) })
    else bump(kind + ':job_ok:' + e.status + ':' + (e.reason_code || '-'))
  }
  for (const j of byKey.values()) violate(kind + '_job_extra', { job: { dedupe: j.dedupe_key, status: j.status, reason: j.reason_code } })
}

/** Vào / ra nhóm như aka_agent_process_data_group_dynamic_filters_core. */
async function opGroup(c, r, G, W, ctx, force = null) {
  const live = (await c.query(`SELECT r.data_group_id, r.account_id FROM auto_event_bot_rules r WHERE r.event_type='condition_group' AND r.enabled AND NOT r.is_delete`)).rows
  let dg; let acc
  if (force) { dg = force.dg; acc = force.acc } else if (live.length && r.chance(0.75)) {
    const pick = r.pick(live)
    dg = W.dataGroups.find(g => g.id === Number(pick.data_group_id)); acc = W.accounts.find(a => a.id === Number(pick.account_id))
  }
  if (!dg || !dg.filter) dg = r.pick(W.dataGroups.filter(g => g.filter))
  if (!dg) return
  const f = W.filters.find(x => x.id === dg.filter)
  const accs = W.accounts.filter(a => a.staff === dg.staff)
  if (!accs.length) return
  if (!acc) acc = dg.bound ? W.accounts.find(a => a.id === dg.bound) : r.pick(accs)
  const people = W.contacts.get(acc.id)
  const enter = force ? force.enter : r.chance(0.55)
  const cur = (await c.query(`SELECT m.contact_id, o.is_current FROM auto_account_contact_group_members m JOIN auto_account_contact_group_member_origins o ON o.membership_id=m.id AND o.dynamic_filter_id=$2 WHERE m.group_id=$1`, [dg.id, f.id])).rows
  const inNow = cur.filter(x => x.is_current).map(x => Number(x.contact_id)); const outNow = cur.filter(x => !x.is_current).map(x => Number(x.contact_id))
  let p = r.pick(people)
  if (!enter && inNow.length && r.chance(0.85)) { const k = r.pick(inNow); p = people.find(x => x.id === k) || p }
  if (enter && outNow.length && r.chance(0.5)) { const k = r.pick(outNow); p = people.find(x => x.id === k) || p }
  if (force && force.p) p = force.p
  const withLock = force ? true : r.chance(0.88)
  const lockStaff = force || r.chance(0.95) ? f.owner : r.pick(W.staff).id
  const before = await dump(c)
  const lastOrigin = Number((await c.query('SELECT COALESCE(max(updated_at), now()-interval \'1 day\') m FROM auto_account_contact_group_member_origins')).rows[0].m ? 0 : 0)
  await c.query('BEGIN')
  let originRows = []
  try {
    if (withLock) await c.query(`SELECT pg_try_advisory_xact_lock(hashtextextended('data-group-dynamic-filter:' || $1::text, 0))`, [lockStaff])
    const mem = (await c.query(`SELECT id, is_delete FROM auto_account_contact_group_members WHERE group_id=$1 AND contact_id=$2`, [dg.id, p.id])).rows[0]
    const cur = mem ? (await c.query(`SELECT is_current FROM auto_account_contact_group_member_origins WHERE membership_id=$1 AND dynamic_filter_id=$2`, [mem.id, f.id])).rows[0] : null
    if (enter) {
      const mid = (await c.query(`INSERT INTO auto_account_contact_group_members (group_id, contact_id, is_delete, change_revision, updated_at) VALUES ($1,$2,false,1,clock_timestamp())
        ON CONFLICT (group_id, contact_id) DO UPDATE SET is_delete=false, change_revision=1, updated_at=clock_timestamp() RETURNING id`, [dg.id, p.id])).rows[0].id
      originRows = (await c.query(`INSERT INTO auto_account_contact_group_member_origins (membership_id, kind, dynamic_filter_id, source_account_id, source_name_snapshot, is_current, data_type_category_item_id, updated_at)
        SELECT $1, 'dynamic_filter', $2, contact.account_id::bigint, 'Bộ lọc động', true, 40, clock_timestamp() FROM auto_account_contacts contact WHERE contact.id = $3
        ON CONFLICT (membership_id, dynamic_filter_id) WHERE dynamic_filter_id IS NOT NULL DO UPDATE SET source_account_id = EXCLUDED.source_account_id,
          source_name_snapshot = EXCLUDED.source_name_snapshot, is_current = true, data_type_category_item_id = EXCLUDED.data_type_category_item_id, updated_at = clock_timestamp()
        RETURNING *, (xmax = 0) AS inserted`, [mid, f.id, p.id])).rows
      originRows = originRows.map(o => ({ ...o, fired: o.inserted || !(cur && cur.is_current) }))
    } else if (cur && cur.is_current) {
      originRows = (await c.query(`UPDATE auto_account_contact_group_member_origins SET is_current=false, updated_at=clock_timestamp() WHERE membership_id=$1 AND dynamic_filter_id=$2 AND is_current=true RETURNING *`, [mem.id, f.id])).rows.map(o => ({ ...o, fired: true }))
      if (!r.chance(0.1)) await c.query(`UPDATE auto_account_contact_group_members SET is_delete=true, primary_origin_id=NULL, updated_at=clock_timestamp() WHERE id=$1`, [mem.id])
    }
    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    violate('group_statement_failed', { message: e.message })
    return
  }
  bump('op:group')
  const t1 = Number((await c.query('SELECT extract(epoch FROM clock_timestamp())*1000 t')).rows[0].t)
  const t0 = before.now
  for (const o of originRows) {
    const contact = before.contactsById.get(p.id)
    const fires = o.fired && withLock && lockStaff === f.owner
    const expected = fires ? M.expectGroupJobs(before, { id: Number(o.id), is_current: o.is_current }, dg.id, contact, t0, Math.floor(new Date(o.updated_at).getTime())) : []
    const got = (await c.query(`SELECT * FROM auto_event_bot_jobs WHERE event_type='condition_group' AND source_ref = $1 AND created_at > to_timestamp($2/1000.0) - interval '1 second'`, [String(o.id), t0])).rows
      .filter(j => j.direction === (o.is_current ? 'enter' : 'leave') && Math.abs(Number(String(j.dedupe_key).split(':').pop()) - new Date(o.updated_at).getTime()) <= 1)
    if (!fires) bump('group:no_fire')
    bump(`group:fired:${o.is_current ? 'enter' : 'leave'}:${fires}:${expected.length}`)
    compareJobs('group', expected, got, t0, t1)
  }
}

/** Kịch bản có chủ đích cho nhóm: vào → gửi → ra → vào lại (khoảng cách tối thiểu, đã ra nhóm, đã vào lại). */
async function opGroupScenario(c, r, G, W, ctx) {
  const rule = (await c.query(`SELECT r.* FROM auto_event_bot_rules r JOIN auto_event_bot_settings s ON s.account_id=r.account_id AND s.enabled
    WHERE r.event_type='condition_group' AND r.enabled AND NOT r.is_delete ORDER BY random() LIMIT 1`)).rows[0]
  if (!rule) return
  const acc = W.accounts.find(a => a.id === Number(rule.account_id)); const dg = W.dataGroups.find(g => g.id === Number(rule.data_group_id))
  if (!acc || !dg || !dg.filter) return
  const p = r.pick(W.contacts.get(acc.id))
  bump('scenario:group')
  for (let k = 0; k < 4; k++) {
    await opGroup(c, r, G, W, ctx, { dg, acc, p, enter: k % 2 === 0 })
    if (r.chance(0.7)) {
      await c.query(`UPDATE auto_event_bot_jobs SET send_after = clock_timestamp() - interval '1 second' WHERE account_id=$1 AND status='pending' AND rule_id=$2`, [acc.id, rule.id])
      const saved = ctx.claimed; ctx.claimed = []
      await opClaim(c, r, G, W, ctx, { src: acc.kind === 'server' ? 'server' : 'desktop', staff: acc.staff, ids: [acc.id] })
      const mine = ctx.claimed; ctx.claimed = saved
      for (const cl of mine) await opReport(c, r, G, W, { ...ctx, claimed: [cl], forceSent: true })
    }
    if (r.chance(0.3)) await opAge(c, r, G, W, ctx, true)
  }
}

/** Kịch bản có chủ đích: gắn tag → gửi → gỡ → gắn lại (khoảng cách tối thiểu, gắn lại, không còn tag). */
async function opGapScenario(c, r, G, W, ctx) {
  const rule = (await c.query(`SELECT r.* FROM auto_event_bot_rules r JOIN auto_event_bot_settings s ON s.account_id=r.account_id AND s.enabled
    JOIN auto_accounts a ON a.id=r.account_id AND NOT a.is_zalo_show_web WHERE r.event_type='tag_change' AND r.enabled AND NOT r.is_delete ORDER BY random() LIMIT 1`)).rows[0]
  if (!rule) return
  const acc = W.accounts.find(a => a.id === Number(rule.account_id)); if (!acc) return
  const tag = Array.isArray(rule.config?.tagIds) ? String(rule.config.tagIds[0] ?? '').trim() : ''
  if (!W.tags.get(acc.id).members.has(tag)) return
  const p = r.pick(W.contacts.get(acc.id).filter(x => !x.uid.startsWith('g')))
  if (!p) return
  const dir = rule.config?.direction
  const put = on => info => { const set = info.members.get(tag); if (on) set.add(p.uid); else set.delete(p.uid) }
  // Đưa về trạng thái đầu (không có trong tag nếu quy tắc là "được gắn", có nếu "bị gỡ"), rồi tạo sự kiện.
  await opTagSnapshot(c, r, G, W, ctx, acc, put(dir !== 'added'))
  await opTagSnapshot(c, r, G, W, ctx, acc, put(dir === 'added'))
  bump('scenario:tag')
  for (let k = 0; k < 3; k++) {
    await c.query(`UPDATE auto_event_bot_jobs SET send_after = clock_timestamp() - interval '1 second' WHERE account_id=$1 AND status='pending' AND rule_id=$2`, [acc.id, rule.id])
    const saved = ctx.claimed; ctx.claimed = []
    await opClaim(c, r, G, W, ctx, { src: acc.kind === 'server' ? 'server' : 'desktop', staff: acc.staff, ids: [acc.id] })
    const mine = ctx.claimed; ctx.claimed = saved
    for (const cl of mine) await opReport(c, r, G, W, { ...ctx, claimed: [cl], forceSent: true })
    if (r.chance(0.5)) await opAge(c, r, G, W, ctx, true)
    // Lật lại: gỡ rồi gắn lại (hoặc ngược lại), có lúc gắn lại trước khi bot gửi.
    await opTagSnapshot(c, r, G, W, ctx, acc, put(dir !== 'added'))
    if (r.chance(0.5)) await opTagSnapshot(c, r, G, W, ctx, acc, put(dir === 'added'))
  }
}

async function opBirthdays(c, r, G, W) {
  const live = (await c.query(`SELECT account_id FROM auto_event_bot_rules WHERE event_type='birthday' AND enabled AND NOT is_delete`)).rows.map(x => Number(x.account_id))
  const pickId = live.length && r.chance(0.7) ? r.pick(live) : null
  const acc = (pickId && W.accounts.find(a => a.id === pickId)) || r.pick(W.accounts)
  const people = W.contacts.get(acc.id)
  const list = []
  const n = r.pick([0, 1, 3, 10, 40])
  for (let i = 0; i < n; i++) {
    const p = r.pick(people)
    const roll = r.next()
    if (roll < 0.06) list.push(r.pick([null, 'x', 5, [], { uid: 'abc' }, { uid: '' }, { name: 'x' }, { uid: 123 }]))
    else list.push({ uid: roll < 0.1 ? ' ' + p.uid + ' ' : p.uid, name: r.chance(0.3) ? '' : G.name() })
  }
  const garbage = r.chance(0.04) ? r.pick(['null', '{}', '"x"', '[1,2]', '5']) : null
  const payload = garbage !== null ? (garbage === 'null' ? null : garbage) : JSON.stringify(list)
  const before = await dump(c)
  const lastJob = Number((await c.query('SELECT COALESCE(max(id),0) m FROM auto_event_bot_jobs')).rows[0].m)
  let res
  const src = acc.kind === 'server' ? 'server' : 'desktop'
  if (src === 'server') res = await call(c, `SELECT public.aka_agent_event_bot_birthdays_v1('server', $1, $2::jsonb) r`, [acc.id, payload])
  else res = await asDesktop(c, acc.staff, `SELECT public.aka_agent_desktop_event_bot_birthdays_v1($1, $2::jsonb) r`, [acc.id, payload])
  bump('op:birthday')
  if (res.error) { violate('birthday_exception', { message: res.error.message, payload: String(payload).slice(0, 200) }); return }
  const out = res.rows[0].r
  const staff = src === 'desktop' ? acc.staff : null
  // Mô hình
  let want
  let parsed = null; try { parsed = payload == null ? null : JSON.parse(payload) } catch { parsed = undefined }
  const st = M.runnerAccount(before, src, staff, acc.id)
  const brule = (before.rules.get(acc.id) || []).filter(x => x.event_type === 'birthday' && x.enabled && !x.is_delete).sort((a, b) => a.position - b.position || a.id - b.id)[0]
  if (!M.runtimeOn(before, src) || before.cfg.audience === 'off') want = 'not_enabled'
  else if (!Array.isArray(parsed)) want = 'invalid_request'
  else if (parsed.length > 2000) want = 'too_many_people'
  else if (!st) want = 'account_not_eligible'
  else if (!brule) want = 'rule_off'
  else want = 'ok'
  if ((want === 'ok') !== (out.ok === true) || (want !== 'ok' && out.code !== want)) { violate('birthday_mismatch', { want, got: out }); return }
  if (want !== 'ok') { bump('birthday:' + want); return }
  const valid = new Map()
  for (const x of parsed) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue
    const u = M.btrim(M.jsonText(x.uid))
    if (!/^g?[0-9]{1,40}$/.test(u)) continue
    if (!valid.has(u)) valid.set(u, [])
    valid.get(u).push(x.name)
  }
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric' }).format(new Date(before.now)))
  const newJobs = (await c.query('SELECT * FROM auto_event_bot_jobs WHERE id > $1 AND event_type = $2 AND account_id = $3', [lastJob, 'birthday', acc.id])).rows
  let created = 0; let skipped = 0
  for (const [u, names] of valid) {
    const key = `birthday:${acc.id}:${u}:${year}`
    const prior = before.jobs.find(j => j.dedupe_key === key)
    const j = newJobs.find(x => x.dedupe_key === key)
    if (prior) { if (j) violate('birthday_dup', { key }); continue }
    if (!j) { violate('birthday_missing', { key }); continue }
    const ct = before.contactByAccUid.get(`${acc.id}|person|${u}`)
    let reason = null
    if (u.startsWith('g')) reason = 'not_person'
    else if (M.excluded(before, acc.id, st.blocklist_ids, u, ct ? ct.phone : null)) reason = 'excluded'
    const nm = names.map(n => (n == null ? null : String(M.jsonText(n)).replace(/^ +| +$/g, '') || null)).map(n => n == null ? null : [...n].slice(0, 200).join(''))
    const okName = nm.some(n => (n ?? (ct ? ct.name : null)) === j.recipient_name)
    if (j.status !== (reason ? 'skipped' : 'pending') || (j.reason_code ?? null) !== reason || !okName || Number(j.rule_id) !== brule.id || j.message_template !== (M.jsonText(brule.config?.message) ?? null)) {
      violate('birthday_job_diff', { key, got: { status: j.status, reason: j.reason_code, name: j.recipient_name }, want: { reason, names: nm, contact: ct ? ct.name : null } })
    }
    if (reason) skipped++; else created++
  }
  if (newJobs.length !== created + skipped) violate('birthday_extra', { got: newJobs.length, want: created + skipped })
  if (out.created !== created || out.skipped !== skipped) violate('birthday_counts', { got: [out.created, out.skipped], want: [created, skipped] })
  bump('birthday:ok')
}

async function opClaim(c, r, G, W, ctx, force = null) {
  const src = force ? force.src : r.pick(['server', 'server', 'desktop', 'desktop', 'fly'])
  let staffObj = force && force.staff ? W.staff.find(x => x.id === force.staff) : r.pick(W.staff)
  if (src === 'desktop' && r.chance(0.7)) {
    const s0 = (await c.query(`SELECT a.staff_id FROM auto_event_bot_jobs j JOIN auto_accounts a ON a.id=j.account_id WHERE j.status='pending' AND NOT a.is_zalo_server ORDER BY random() LIMIT 1`)).rows[0]
    if (s0) staffObj = W.staff.find(x => x.id === Number(s0.staff_id)) || staffObj
  }
  const pool = src === 'desktop' && r.chance(0.8) ? W.accounts.filter(a => a.staff === staffObj.id) : W.accounts
  let ids = r.sample(pool, r.int(0, Math.min(6, pool.length))).map(a => a.id)
  if (r.chance(0.6)) {
    const due = (await c.query(`SELECT DISTINCT j.account_id FROM auto_event_bot_jobs j JOIN auto_accounts a ON a.id = j.account_id WHERE j.status='pending' AND j.send_after <= clock_timestamp() AND a.is_zalo_server = ${src === 'desktop' ? 'false' : 'true'}` + (src === 'desktop' ? ' AND a.staff_id = $1' : ''), src === 'desktop' ? [staffObj.id] : [])).rows.map(x => Number(x.account_id))
    if (due.length) ids = [...new Set([...ids, ...r.sample(due, r.int(1, Math.min(4, due.length)))])]
  }
  if (force) ids = force.ids
  else if (r.chance(0.05)) ids = [...ids, null, ids[0], 99999]
  if (r.chance(0.01)) ids = Array.from({ length: 501 }, (_, i) => i + 1)
  const limit = force ? 20 : r.pick([null, 1, 5, 20, 0, -3, 50])
  const before = await dump(c)
  const t0 = before.now
  let res
  if (src === 'desktop') res = await asDesktop(c, staffObj.id, 'SELECT public.aka_agent_desktop_event_bot_claim_v1($1, $2::bigint[], $3) r', ['desk-' + staffObj.id, ids, limit])
  else res = await call(c, 'SELECT public.aka_agent_event_bot_claim_v1($1, $2, $3::bigint[], $4) r', [src, src + '-runner', ids, limit])
  bump('op:claim:' + src)
  if (res.error) { violate('claim_exception', { message: res.error.message, src }); return }
  const out = res.rows[0].r
  const exp = M.expectClaim(before, src, src === 'desktop' ? staffObj.id : null, ids, limit, t0)
  if (exp.error) { if (out.code !== exp.error) violate('claim_mismatch', { exp, out }); return }
  if (!exp.enabled) bump('claim:disabled')
  if (exp.enabled !== out.enabled) { violate('claim_enabled', { exp: exp.enabled, out: out.enabled, src, cfg: before.cfgRaw }); return }
  const S2 = await dump(c)
  const gotJobs = (out.jobs || []).map(j => Number(j.jobId))
  if (exp.ambiguous) bump('claim:ambiguous')
  else {
    if (JSON.stringify(gotJobs) !== JSON.stringify(exp.jobs)) violate('claim_jobs', { exp: exp.jobs, got: gotJobs, src, ids })
    for (const [id, u] of exp.updates) {
      const j = S2.jobsById.get(id)
      if (j.status !== u.status || (j.reason_code ?? null) !== u.reason) violate('claim_update', { id, want: u, got: [j.status, j.reason_code] })
    }
    // Không việc nào khác đổi trạng thái.
    for (const j of before.jobs) if (!exp.updates.has(j.id) && S2.jobsById.get(j.id).status !== j.status) violate('claim_side_effect', { id: j.id, from: j.status, to: S2.jobsById.get(j.id).status })
  }
  for (const j of out.jobs || []) {
    const row = S2.jobsById.get(Number(j.jobId))
    if (row.status !== 'sending' || row.claim_token !== j.claimToken) violate('claim_row', { id: j.jobId })
    if (j.message !== row.message_template || j.recipientUid !== row.recipient_uid) violate('claim_payload', { id: j.jobId })
    if (!String(j.recipientUid || '').trim() || String(j.recipientUid).startsWith('g')) violate('claim_bad_recipient', { id: j.jobId, uid: j.recipientUid })
    ctx.claimed.push({ jobId: Number(j.jobId), token: j.claimToken, src, staff: staffObj.id, accountId: Number(j.accountId), at: t0 })
  }
  bump('claim:jobs', gotJobs.length)
  for (const w of exp.skipWhy || []) bump('claim:skip:' + w)
  if (!exp.enabled) bump('claim:disabled')
}

async function opReport(c, r, G, W, ctx) {
  if (!ctx.claimed.length) return
  const i = r.int(0, ctx.claimed.length - 1)
  const cl = ctx.claimed[i]
  if (r.chance(0.8)) ctx.claimed.splice(i, 1)
  const resultRoll = ctx.forceSent && r.chance(0.8) ? 0 : r.next() * (ctx.draining ? 0.9 : 1)
  const result = resultRoll < 0.45 ? { status: 'sent', msgId: 'm' + r.int(1, 1e9) }
    : resultRoll < 0.52 ? { status: 'sent', msgId: r.pick([null, '', '   ']) }
      : resultRoll < 0.8 ? { status: 'failed', zaloCode: ctx.draining && r.chance(0.8) ? r.pick(['122', '114', null]) : r.pick(['120', '802', '221', '122', null, ' 120 ', '114']), errorMessage: r.pick(['x', 'y'.repeat(400), null]) }
        : resultRoll < 0.9 ? { status: 'unknown', errorMessage: 'timeout' }
          : r.pick([null, {}, { status: 'SENT' }, { status: 5 }, 'x', []])
  const token = ctx.forceSent || r.chance(0.92) ? cl.token : r.pick([crypto.randomUUID(), null])
  let src = cl.src; let staff = cl.staff
  if (!ctx.forceSent && r.chance(0.05)) { src = r.pick(['server', 'desktop', 'fly']); staff = r.pick(W.staff).id }
  const before = await dump(c)
  const job = before.jobsById.get(cl.jobId)
  let res
  const rj = result === null ? null : JSON.stringify(result)
  if (src === 'desktop') res = await asDesktop(c, staff, 'SELECT public.aka_agent_desktop_event_bot_report_v1($1, $2::uuid, $3::jsonb) r', [cl.jobId, token, rj])
  else res = await call(c, 'SELECT public.aka_agent_event_bot_report_v1($1, $2, $3::uuid, $4::jsonb) r', [src, cl.jobId, token, rj])
  bump('op:report')
  if (res.error) { violate('report_exception', { message: res.error.message, result }); return }
  const out = res.rows[0].r
  const exp = M.expectReport(job, src, src === 'desktop' ? staff : null, token, result)
  const S2 = await dump(c)
  const after = S2.jobsById.get(cl.jobId)
  if (exp.ok !== out.ok || (!exp.ok && exp.code !== out.code) || (exp.ok && !exp.replay && out.status !== exp.status)) { violate('report_mismatch', { exp, out, job: { status: job.status, reason: job.reason_code } }); return }
  if (!exp.ok || exp.replay) {
    if (after.status !== job.status || after.updated_at?.getTime?.() !== job.updated_at?.getTime?.()) violate('report_changed_on_reject', { exp, before: [job.status, job.reason_code, job.claimed_by], after: [after.status, after.reason_code], src, staff, token: token === cl.token, result })
    bump('report:' + (exp.code || 'replay'))
    return
  }
  if (after.status !== exp.status || (after.reason_code ?? null) !== (exp.status === 'unknown' ? null : exp.reason) || (exp.status === 'sent') !== (after.sent_at != null)) violate('report_row', { exp, got: [after.status, after.reason_code] })
  if (after.error_message && [...after.error_message].length > 300) violate('report_error_len', {})
  const st = S2.settings.get(Number(job.account_id)); const st0 = before.settings.get(Number(job.account_id))
  if (exp.pause) {
    const minUntil = before.now + exp.pause * 60000 - 2000
    if (!st.paused_until || st.paused_until < minUntil || st.paused_until < (st0.paused_until || 0)) violate('report_pause', { exp: exp.pause, got: st.paused_until && (st.paused_until - before.now) / 60000 })
  } else if ((st.paused_until || 0) !== (st0.paused_until || 0)) violate('report_pause_changed', {})
  bump('report:' + exp.status + ':' + (exp.reason || '-'))
}

async function opMisc(c, r, G, W) {
  const acc = r.pick(W.accounts)
  const staff = acc.staff
  const org = acc.org
  const action = r.pick(['get', 'accounts', 'log', 'report', 'log_detail', 'stop', 'exclusion_add', 'exclusion_add', 'exclusion_remove', 'access', 'nope', 'get'])
  let payload = { accountId: acc.id }
  if (action === 'log') payload = { accountId: acc.id, days: r.pick([1, 7, 90, 0, 1000, 'x']), limit: r.pick([1, 50, 0, 500]), before: r.pick([null, 5, 'x']), status: r.pick([undefined, 'sent', 'skipped', 'bad']), eventType: r.pick([undefined, 'birthday', 'x']) }
  if (action === 'log_detail') payload = { accountId: acc.id, jobId: r.pick([1, 2, 3, 'x', -1, 1e15]) }
  if (action === 'report') payload = { accountId: acc.id, days: r.pick([7, 30, 0]) }
  let rawText = null
  if (action === 'exclusion_add') {
    const people = W.contacts.get(acc.id)
    const lines = []
    for (let i = 0; i < r.int(0, 8); i++) {
      const p = r.pick(people)
      lines.push(r.pick([p.uid, ' ' + p.uid, G.phone() || '', '123', 'abc', p.uid + 'x', '+84 9' + r.int(10000000, 99999999)]))
    }
    rawText = lines.join(r.pick(['\n', ',', ';', '\r\n']))
    const items = TS.parseEventBotExclusionInput(rawText).map(x => ({ ...x, name: r.chance(0.2) ? 'n'.repeat(100) : null }))
    payload = { accountId: acc.id, items: r.chance(0.92) ? items : r.pick([null, 'x', [{ kind: 'uid', value: 'abc' }], [{ kind: 'phone', value: '123' }], [1, 2], Array.from({ length: 5001 }, () => ({ kind: 'uid', value: '12345678' })),
      Array.from({ length: r.int(501, 1500) }, (_, i) => ({ kind: 'uid', value: String(10000000 + r.int(0, 9e7) + i) }))]) }
  }
  if (action === 'exclusion_remove') {
    const ids = (await c.query('SELECT id FROM auto_event_bot_exclusions WHERE account_id=$1', [acc.id])).rows.map(x => Number(x.id))
    payload = { accountId: acc.id, ids: r.chance(0.9) ? r.sample(ids, r.int(0, ids.length)) : r.pick([null, 'x', ['x'], [-1]]) }
  }
  const before = await dump(c)
  const callStaff = r.chance(0.95) ? staff : r.pick([0, null, -1]); const callOrg = r.chance(0.97) ? org : 999
  const sentPayload = r.chance(0.98) ? payload : r.pick([null, 'x', [], 5])
  const res = await control(c, callStaff, callOrg, action, sentPayload)
  const honest = callStaff === staff && callOrg === org && sentPayload === payload
  bump('op:misc:' + action)
  if (res.error) {
    // Nhân viên / tổ chức sai = lỗi invalid_request trả về, không ném.
    violate('control_exception', { action, message: res.error.message })
    return
  }
  const out = res.rows[0].r
  if (typeof out?.ok !== 'boolean') violate('control_shape', { action, out })
  if (out.ok && action === 'get') checkDetailShape(out.data, acc.id)
  if (honest && action === 'exclusion_add' && out.ok && Array.isArray(payload.items)) {
    // Mọi mục TS nhận phải được DB nhận (cùng chuẩn hoá SĐT).
    const S2 = await dump(c)
    const have = new Set((S2.exclusions.get(acc.id) || []).map(x => x.kind + ':' + x.value))
    for (const it of payload.items) if (!have.has(it.kind + ':' + it.value)) violate('exclusion_missing', { it })
  }
  if (honest && action === 'exclusion_add' && !out.ok && Array.isArray(payload.items) && payload.items.every(x => x && typeof x === 'object') && payload.items.length > 0 && payload.items.length <= 500 && out.code === 'exclusion_invalid') {
    if (payload.items.every(x => (x.kind === 'uid' && /^\d{8,25}$/.test(x.value)) || (x.kind === 'phone' && TS.normalizeEventBotPhone(x.value)))) violate('exclusion_rejected_valid', { items: payload.items.slice(0, 5), raw: rawText })
  }
  if (honest && action === 'exclusion_add' && Array.isArray(payload.items) && payload.items.length > 0 && payload.items.length <= 5000
      && payload.items.every(x => x && (x.kind === 'uid' || x.kind === 'phone') && typeof x.value === 'string' && x.value.trim() && x.value.length <= 40)
      && out.ok === false && out.code === 'invalid_request') violate('exclusion_api_passes_db_rejects', { n: payload.items.length })
  if (honest && action === 'log' && out.ok) {
    const { intOf } = require('./save-model.cjs')
    const days = Math.min(90, Math.max(1, intOf(payload.days) ?? 7)); const limit = Math.min(100, Math.max(1, intOf(payload.limit) ?? 50))
    const base = { accountId: acc.id, days: payload.days, limit: payload.limit, status: payload.status, eventType: payload.eventType }
    const ids = []; let before = null
    for (let pg = 0; pg < 30; pg++) {
      const page = (await control(c, staff, org, 'log', { ...base, before })).rows[0].r
      ids.push(...page.data.items.map(x => Number(x.id)))
      if (page.data.items.some(x => typeof x.status !== 'string' || typeof x.eventType !== 'string')) violate('log_shape', {})
      before = page.data.nextBefore
      if (before == null) break
    }
    const want = (await c.query(`SELECT id FROM auto_event_bot_jobs WHERE account_id=$1 AND created_at > clock_timestamp() - make_interval(days => $2)
      AND ($3::text IS NULL OR status = $3) AND ($4::text IS NULL OR event_type = $4) ORDER BY id DESC LIMIT $5`, [acc.id, days, payload.status ?? null, payload.eventType ?? null, 30 * limit])).rows.map(x => Number(x.id))
    if (JSON.stringify(ids) !== JSON.stringify(want)) violate('log_pagination', { got: ids.length, want: want.length, limit })
    else bump('log:pages_ok')
  }
  if (honest && action === 'stop' && out.ok) {
    const S2 = await dump(c)
    if (S2.jobs.some(j => Number(j.account_id) === acc.id && j.status === 'pending')) violate('stop_left_pending', {})
    if (S2.settings.get(acc.id)?.enabled) violate('stop_still_enabled', {})
  }
  void before
}

async function opMaintenance(c) {
  const res = await call(c, 'SELECT private.aka_agent_event_bot_maintenance() r')
  bump('op:maintenance')
  if (res.error) { violate('maintenance_exception', { message: res.error.message }); return }
  const bad = (await c.query(`SELECT count(*) n FROM auto_event_bot_jobs WHERE (status='pending' AND expires_at < clock_timestamp() - interval '1 second') OR (status='sending' AND claimed_at < clock_timestamp() - interval '5 minutes 1 second')`)).rows[0].n
  if (Number(bad) > 0) violate('maintenance_left', { n: bad })
}

async function opAge(c, r, G, W, ctx, small = false) {
  const secs = small || r.chance(0.7) ? r.pick([30, 61, 90, 150, 301]) : r.pick([20, 45, 61, 90, 120, 200, 300, 301, 1800, 3600, 4 * 3600, 25 * 3600])
  await c.query(`DO $$ DECLARE t record; BEGIN
    FOR t IN SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND data_type LIKE 'timestamp%'
      AND table_name IN ('auto_event_bot_jobs','auto_event_bot_settings','auto_zalo_tag_sync_accounts','auto_zalo_tag_sync_resets','auto_zalo_tag_members','auto_zalo_tag_member_events') LOOP
      EXECUTE format('UPDATE public.%I SET %I = %I - interval ''${secs} seconds'' WHERE %I IS NOT NULL', t.table_name, t.column_name, t.column_name, t.column_name);
    END LOOP; END $$`)
  bump('op:age')
}

async function opWorldChange(c, r, G, W) {
  const roll = r.next()
  if (roll < 0.3) {
    await c.query(`UPDATE auto_system_settings SET value = $1 WHERE key = 'event_bot'`, [configValue(r, W)])
    bump('world:config')
  } else if (roll < 0.45) {
    const o = r.pick(W.orgs); await c.query('UPDATE test_org_flags SET chat_runtime=$2, fly_route=$3 WHERE organization_id=$1', [o, r.chance(0.2), r.chance(0.3)]); bump('world:org')
  } else if (roll < 0.6) {
    const a = r.pick(W.accounts); await c.query('UPDATE auto_accounts SET is_delete=$2, is_zalo_server=$3 WHERE id=$1', [a.id, r.chance(0.08), r.chance(0.5)]); bump('world:account')
  } else if (roll < 0.7) {
    const a = r.pick(W.accounts); const s = r.pick(W.staff); await c.query('UPDATE auto_accounts SET staff_id=$2 WHERE id=$1', [a.id, r.chance(0.2) ? s.id : a.staff]); bump('world:move')
  } else if (roll < 0.8) {
    const s = r.pick(W.staff); await c.query('UPDATE org_staff SET is_active=$2, is_admin_akabiz=$3 WHERE id=$1', [s.id, !r.chance(0.1), r.chance(0.3)]); bump('world:staff')
  } else if (roll < 0.9) {
    // Quy tắc rác ghi thẳng vào bảng (trigger phải chịu được).
    const rr = (await c.query('SELECT id FROM auto_event_bot_rules WHERE NOT is_delete ORDER BY random() LIMIT 1')).rows[0]
    if (rr) {
      const junk = r.pick([{}, { direction: 'added', tagIds: 'x' }, { direction: 'added', tagIds: [{ a: 1 }, 3, '  3 '], delay: { minSeconds: 'x', maxSeconds: 99999 } }, { onEnter: { enabled: 'yes' } }, { onEnter: { enabled: true } }, { message: null, delay: [] }])
      await c.query('UPDATE auto_event_bot_rules SET config = config || $2::jsonb WHERE id=$1', [rr.id, JSON.stringify(junk)])
      junkRules.add(Number(rr.id))
      bump('world:junk_rule')
    }
  } else {
    // Mở / tắt chat binding
    const a = r.pick(W.accounts); await c.query('UPDATE chat_zalo_account_organization SET is_active = NOT is_active WHERE auto_account_id=$1', [a.id]); bump('world:chat')
  }
}

/** Nhiều nơi cùng lúc: hỏi việc chồng nhau, báo kết quả, job dọn, lưu cài đặt. Kiểm không giao trùng việc, không lỗi. */
async function opConcurrent(c, r, G, W, ctx) {
  const conns = ctx.extra
  const due = (await c.query(`SELECT j.account_id, a.staff_id, a.is_zalo_server FROM auto_event_bot_jobs j JOIN auto_accounts a ON a.id=j.account_id WHERE j.status='pending' AND j.send_after <= clock_timestamp() GROUP BY 1,2,3`)).rows
  const srvIds = due.filter(d => d.is_zalo_server).map(d => Number(d.account_id))
  const tasks = []
  const results = []
  conns.forEach((cn, i) => {
    const roll = r.next()
    if (roll < 0.45 && srvIds.length) tasks.push(call(cn, `SELECT public.aka_agent_event_bot_claim_v1('server', $1, $2::bigint[], 20) r`, ['srv' + i, r.shuffle(srvIds)]).then(x => results.push(['claim', x])))
    else if (roll < 0.7) {
      const d = r.pick(due.filter(x => !x.is_zalo_server)) || null
      if (d) tasks.push(asDesktop(cn, Number(d.staff_id), 'SELECT public.aka_agent_desktop_event_bot_claim_v1($1, $2::bigint[], 20) r', ['dk' + i, due.filter(x => Number(x.staff_id) === Number(d.staff_id) && !x.is_zalo_server).map(x => Number(x.account_id))]).then(x => results.push(['claim', x])))
    } else if (roll < 0.8) tasks.push(call(cn, 'SELECT private.aka_agent_event_bot_maintenance() r').then(x => results.push(['maint', x])))
    else if (roll < 0.9 && ctx.claimed.length) {
      const cl = r.pick(ctx.claimed)
      const sql = cl.src === 'desktop' ? null : 'SELECT public.aka_agent_event_bot_report_v1($1, $2, $3::uuid, $4::jsonb) r'
      if (sql) tasks.push(call(cn, sql, [cl.src, cl.jobId, cl.token, JSON.stringify({ status: 'sent', msgId: 'c' + i })]).then(x => results.push(['report', x])))
      else tasks.push(asDesktop(cn, cl.staff, 'SELECT public.aka_agent_desktop_event_bot_report_v1($1, $2::uuid, $3::jsonb) r', [cl.jobId, cl.token, JSON.stringify({ status: 'failed', zaloCode: '122' })]).then(x => results.push(['report', x])))
    } else {
      const a = r.pick(W.accounts)
      tasks.push(control(cn, a.staff, a.org, 'stop', { accountId: a.id }).then(x => results.push(['stop', x])))
    }
  })
  await Promise.all(tasks)
  bump('op:concurrent')
  const seen = new Map()
  for (const [kind, x] of results) {
    if (x.error) { if (!/lock timeout|could not obtain lock|deadlock/i.test(x.error.message)) violate('concurrent_exception', { kind, message: x.error.message }); else bump('concurrent:lock_wait'); continue }
    if (kind === 'claim') for (const j of x.rows[0].r.jobs || []) {
      if (seen.has(j.jobId)) violate('concurrent_double_claim', { jobId: j.jobId })
      seen.set(j.jobId, true)
      ctx.claimed.push({ jobId: Number(j.jobId), token: j.claimToken, src: 'server', staff: null, accountId: Number(j.accountId) })
    }
  }
  // Giao việc ở chế độ desktop lưu nhầm src server ở trên: sửa theo claimed_by thật.
  for (const cl of ctx.claimed) if (cl.staff == null) {
    const row = (await c.query('SELECT claimed_by, staff_id FROM auto_event_bot_jobs WHERE id=$1', [cl.jobId])).rows[0]
    if (row && String(row.claimed_by).startsWith('desktop:')) { cl.src = 'desktop'; cl.staff = Number(row.staff_id) }
  }
  await checkGlobal(c, ctx)
}

async function checkGlobal(c, ctx) {
  const rows = (await c.query(`SELECT
    (SELECT count(*) FROM (SELECT account_id FROM auto_event_bot_jobs WHERE status='sending' GROUP BY 1 HAVING count(*) > 1) q) two_sending,
    (SELECT count(*) FROM auto_event_bot_jobs WHERE status='sending' AND (claim_token IS NULL OR claimed_at IS NULL)) bad_sending,
    (SELECT count(*) FROM auto_event_bot_jobs WHERE status='sent' AND (sent_at IS NULL OR zalo_msg_id IS NULL)) bad_sent,
    (SELECT count(*) FROM auto_event_bot_jobs WHERE status='pending' AND claim_token IS NOT NULL) bad_pending,
    (SELECT count(*) FROM auto_event_bot_jobs WHERE status IN ('sending','sent') AND (recipient_uid IS NULL OR btrim(recipient_uid)='' OR recipient_uid LIKE 'g%')) bad_recipient,
    (SELECT count(*) FROM auto_event_bot_jobs WHERE status IN ('pending','sending','sent') AND reason_code IS NOT NULL AND status <> 'pending') bad_reason,
    (SELECT count(*) FROM auto_event_bot_jobs WHERE status = 'skipped' AND reason_code IS NULL) skipped_no_reason`)).rows[0]
  for (const [k, v] of Object.entries(rows)) if (Number(v) > 0) violate('global_' + k, { n: v })
  const fp = await campaignFingerprint(c)
  if (fp !== ctx.campaignFp) violate('global_campaign_tables_touched', {})
}

// ----------------------------------------------------------------------------------------------------------------------
// So luật TS ↔ DB: SĐT, nhập danh sách loại trừ
// ----------------------------------------------------------------------------------------------------------------------

async function contractPhones(c, r, G) {
  const inputs = []
  for (let i = 0; i < 600; i++) inputs.push(G.phone() ?? '')
  for (const p of (POOL?.phones || [])) inputs.push(p)
  inputs.push('+84912345678', '٠٩١٢٣٤٥٦٧٨', '０９１２３４５６７８', '09123456789', '849123456789', '+', '84', '0', '0'.repeat(11), '+84+84912345678', '84912345678\n')
  const res = (await c.query('SELECT x, private.aka_agent_event_bot_norm_phone(x) n FROM unnest($1::text[]) x', [inputs])).rows
  for (const row of res) {
    const ts = TS.normalizeEventBotPhone(row.x)
    if ((ts ?? null) !== (row.n ?? null)) violate('contract_phone', { input: row.x, ts, db: row.n })
  }
  bump('contract:phones', inputs.length)
}

// ----------------------------------------------------------------------------------------------------------------------

async function main() {
  const cluster = await startCluster()
  const db = await cluster.fresh()
  const c = await db.connect()
  const pg = require(require.resolve('pg', { paths: [process.env.PG_MODULE_DIR || '.', path.join(process.env.PG_MODULE_DIR || '.', 'node_modules')] }))
  pg.types.setTypeParser(20, v => Number(v))
  const r = mkRng(SEED)
  const G = makeGen(r)
  await c.query(`UPDATE auto_system_settings SET value='true' WHERE key='zalo.tag_sync.enabled'`)
  await c.query(`UPDATE auto_system_settings SET value='5' WHERE key='zalo.tag_sync.stale_minutes'`)
  const W = await buildWorld(c, r, G)
  await c.query(`UPDATE auto_system_settings SET value = $1 WHERE key = 'event_bot'`, [JSON.stringify({ audience: 'all', runtimes: { desktop: true, server: true, fly: false } })])
  const ctx = { claimed: [], tsCompare: [], campaignFp: await campaignFingerprint(c), extra: [] }
  for (let k = 0; k < 4; k++) ctx.extra.push(await db.connect())
  await contractPhones(c, r, G)
  // Bật bot cho phần lớn tài khoản để có việc.
  for (const a of W.accounts) await opSave(c, r, G, W, ctx, a)
  // Lấy mốc tag cho mọi tài khoản trước.
  for (const a of W.accounts) if (a.kind !== 'web') { for (let k = 0; k < 2; k++) await opTagSnapshot(c, r, G, W) }
  const ops = [
    [opTagSnapshot, 18], [opGapScenario, 4], [opGroupScenario, 3], [opGroup, 16], [opBirthdays, 8], [opClaim, 22], [opReport, 18], [opSave, 8], [opMisc, 8], [opMaintenance, 3], [opAge, 10], [opWorldChange, 2], [opConcurrent, 6]
  ]
  const total = ops.reduce((s, [, w]) => s + w, 0)
  for (let i = 0; i < OPS; i++) {
    let x = r.next() * total; let fn = ops[0][0]
    for (const [f, w] of ops) { if ((x -= w) < 0) { fn = f; break } }
    try { await fn(c, r, G, W, ctx) } catch (e) { violate('harness_error', { op: fn.name, message: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') }) }
    if (i % 10 === 9) await checkGlobal(c, ctx)
  }
  // Xả việc: trôi thời gian, nhận và báo liên tục.
  ctx.draining = true
  await c.query(`UPDATE auto_system_settings SET value = $1 WHERE key = 'event_bot'`, [JSON.stringify({ audience: 'all', runtimes: { desktop: true, server: true, fly: false } })])
  for (let k = 0; k < Number(arg('--drain', '120')); k++) {
    if (k % 6 === 0) await opAge(c, r, G, W, ctx, true)
    const due = (await c.query(`SELECT j.account_id, a.staff_id, a.is_zalo_server FROM auto_event_bot_jobs j JOIN auto_accounts a ON a.id=j.account_id WHERE j.status='pending' AND j.send_after <= clock_timestamp() GROUP BY 1,2,3`)).rows
    const srv = due.filter(d => d.is_zalo_server).map(d => Number(d.account_id))
    if (srv.length) await opClaim(c, r, G, W, ctx, { src: 'server', ids: srv })
    for (const st of [...new Set(due.filter(d => !d.is_zalo_server).map(d => Number(d.staff_id)))]) await opClaim(c, r, G, W, ctx, { src: 'desktop', staff: st, ids: due.filter(d => Number(d.staff_id) === st && !d.is_zalo_server).map(d => Number(d.account_id)) })
    if (!due.length) await opClaim(c, r, G, W, ctx)
    while (ctx.claimed.length && r.chance(0.85)) await opReport(c, r, G, W, ctx)
    if (k % 10 === 9) { await opMaintenance(c); await checkGlobal(c, ctx) }
  }
  await checkGlobal(c, ctx)
  for (const row of (await c.query(`SELECT event_type || ':' || direction AS event_type, status, COALESCE(reason_code,'-') reason, count(*) n FROM auto_event_bot_jobs GROUP BY 1,2,3 ORDER BY 1,2,3`)).rows) stats[`jobs:${row.event_type}:${row.status}:${row.reason}`] = Number(row.n)
  const tsStrict = ctx.tsCompare.filter(x => x.ts && !x.db).length
  const dbLoose = ctx.tsCompare.filter(x => !x.ts && x.db).length
  stats['contract:ts_ok_db_rejected'] = tsStrict
  stats['contract:ts_rejected_db_ok'] = dbLoose
  for (const x of ctx.extra) await x.end()
  await c.end(); await cluster.drop(db.name); await cluster.end()
  const vio = Object.entries(stats).filter(([k]) => k.startsWith('violation:'))
  console.log(JSON.stringify({ seed: SEED, ops: OPS, violations: violations.length, kinds: Object.fromEntries(vio) }, null, 0))
  if (VERBOSE) console.log(JSON.stringify(Object.fromEntries(Object.entries(stats).filter(([k]) => !k.startsWith('violation:')).sort()), null, 1))
  for (const v of violations.slice(0, Number(arg('--show', '40')))) console.log('VIOLATION', JSON.stringify(v).slice(0, 1600))
  process.exit(violations.length ? 1 : 0)
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(2) })
module.exports = { makeGen, buildWorld, dump, asDesktop, call, control, opSave, opTagSnapshot, opGroup, opAge, campaignFingerprint, violations, stats, bump, violate }
