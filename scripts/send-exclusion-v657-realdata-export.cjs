#!/usr/bin/env node
// Xuất CHỈ ĐỌC dữ liệu thật của một số tổ chức để phát lại V657 (send-exclusion-v657-realdata-replay.cjs): tài khoản, nick (zalo_accounts /
// chat_zalo_account), zalo_users, danh sách Zalo ID / Nhóm data + thành viên + liên hệ, chiến dịch Zalo gần đây + data + kết quả gửi / tra số.
// Đọc qua REST của project akachat (cgjbsmqtfhqvttudyjzq); không ghi gì. File ra chứa SĐT / Zalo ID thật: chỉ để ở thư mục ngoài repo.
//   node scripts/send-exclusion-v657-realdata-export.cjs <thư mục ngoài repo> --org 617,1106 [--camps 20] [--rows 3000] [--members 3000]
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const args = process.argv.slice(2)
const outDir = args[0]
const arg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }
if (!outDir || outDir.startsWith('--')) { console.error('cần thư mục ra'); process.exit(2) }
if (path.resolve(outDir).startsWith(path.resolve(__dirname, '..'))) { console.error('thư mục ra phải ở ngoài repo (dữ liệu thật)'); process.exit(2) }
const ORGS = String(arg('org', '')).split(',').map(Number).filter(Boolean)
const CAMPS = Number(arg('camps', 20)), ROWS = Number(arg('rows', 3000)), MEMBERS = Number(arg('members', 3000))
const BASE = process.env.SUPABASE_URL || 'https://cgjbsmqtfhqvttudyjzq.supabase.co'
if (!BASE.includes('cgjbsmqtfhqvttudyjzq')) { console.error('chỉ đọc project akachat'); process.exit(2) }

let requests = 0
function get(pathQuery) {
  requests++
  for (let attempt = 1; ; attempt++) {
    try {
      const out = execFileSync('curl', ['-sS', '--fail-with-body', '--max-time', '60', `${BASE}/rest/v1/${pathQuery}`], { maxBuffer: 256 * 1024 * 1024 }).toString()
      return JSON.parse(out)
    } catch (e) {
      if (attempt >= 4) throw new Error(`REST lỗi ${pathQuery.slice(0, 160)}: ${String(e.stdout || e.message).slice(0, 400)}`)
      execFileSync('sleep', [String(attempt * 2)])
    }
  }
}
/** Đọc theo id tăng dần (1.000 dòng mỗi lần), tối đa cap dòng. */
function keyset(table, filter, select, cap = Infinity) {
  const rows = []
  let last = 0
  while (rows.length < cap) {
    const page = get(`${table}?${filter}${filter ? '&' : ''}id=gt.${last}&select=${select}&order=id.asc&limit=${Math.min(1000, cap - rows.length)}`)
    rows.push(...page)
    if (page.length < 1000) break
    last = page.at(-1).id
  }
  return rows
}
const inList = ids => `in.(${[...new Set(ids)].join(',')})`
function chunked(ids, size, fn) { const out = []; const u = [...new Set(ids)]; for (let i = 0; i < u.length; i += size) out.push(...fn(u.slice(i, i + size))); return out }

fs.mkdirSync(outDir, { recursive: true })
const cats = get(`category_item?code=in.(phone,zalo_person)&select=id,code`)
for (const org of ORGS) {
  const t0 = Date.now()
  const staff = get(`org_staff?organization_id=eq.${org}&select=id,organization_id,is_active,username`)
  const accounts = get(`auto_accounts?organization_id=eq.${org}&select=id,name,flatform_type,staff_id,organization_id,is_delete,zalo_account_id,is_zalo_server,is_zalo_show_web,is_active,login_status,status`)
  const zaIds = accounts.map(a => a.zalo_account_id).filter(Boolean)
  const zaloAccounts = zaIds.length ? get(`zalo_accounts?id=${inList(zaIds)}&select=id,zalo_uid,globalId:metadata->>globalId`) : []
  const chatLinks = get(`chat_zalo_account_organization?auto_account_id=${inList(accounts.map(a => a.id))}&select=id,chat_zalo_account_id,organization_id,auto_account_id,is_active`)
  const chatAccounts = chatLinks.length ? get(`chat_zalo_account?id=${inList(chatLinks.map(l => l.chat_zalo_account_id))}&select=id,zalo_id,global_id`) : []
  const zaloUsers = []
  for (const a of accounts.filter(a => a.flatform_type === 'zalo')) zaloUsers.push(...keyset('zalo_users', `account_id=eq.${a.id}`, 'id,account_id,zalo_uid,global_id,zalo_name,display_name,is_fr', 60000))
  const groups = get(`auto_account_contact_groups?organization_id=eq.${org}&is_delete=eq.false&purpose=in.(zalo_friend_blocklist,data_group)&select=id,name,purpose,account_id,contact_type,data_type_category_item_id,staff_id,organization_id,is_delete`)
  const useGroups = groups.filter(g => g.purpose === 'zalo_friend_blocklist' || cats.some(c => c.id === g.data_type_category_item_id))
  const members = []
  for (const g of useGroups) members.push(...keyset('auto_account_contact_group_members', `group_id=eq.${g.id}&is_delete=eq.false`, 'id,group_id,contact_id,is_delete', MEMBERS))
  const contacts = chunked(members.map(m => m.contact_id), 150, ids => get(`auto_account_contacts?id=${inList(ids)}&select=id,account_id,contact_type,uid,is_delete,staff_id,organization_id,flatform_type`))
  const campaigns = get(`auto_campaigns?organization_id=eq.${org}&action_id=like.zalo_message*&order=id.desc&limit=${CAMPS}&select=id,name,action_id,account_id,staff_id,organization_id,is_delete,status`)
  const inputs = [], details = []
  for (const c of campaigns) {
    inputs.push(...keyset('auto_campaign_input_data', `campaign_id=eq.${c.id}`, 'id,campaign_id,phone,uid,status,is_delete', ROWS))
    details.push(...keyset('auto_campaign_details', `campaign_id=eq.${c.id}&action_code=in.(zalo_message_friend,zalo_message_stranger,zalo_find_phone_user)`,
      'id,campaign_id,input_data_id,account_id,action_code,status,is_delete,created_at,target:data->target,op:policy_snapshot->>operationState', ROWS * 3))
  }
  const snap = { org, cats, staff, accounts, zaloAccounts, chatLinks, chatAccounts, zaloUsers, groups: useGroups, members, contacts, campaigns, inputs, details }
  fs.writeFileSync(path.join(outDir, `org-${org}.json`), JSON.stringify(snap))
  console.log(`tổ chức ${org}: ${accounts.length} tài khoản, ${zaloUsers.length} zalo_users, ${useGroups.length} nhóm / ${members.length} thành viên, ${campaigns.length} chiến dịch / ${inputs.length} data / ${details.length} kết quả, ${requests} lượt đọc, ${Math.round((Date.now() - t0) / 1000)} giây`)
}
