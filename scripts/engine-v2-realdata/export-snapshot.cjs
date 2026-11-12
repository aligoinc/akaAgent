// Chép (chỉ đọc) một mẫu dữ liệu thật của chiến dịch Zalo từ production để chạy môi trường thử engine v2 trên máy.
// Không ghi gì lên DB. Cột bí mật (phiên Zalo/email, tài khoản, mật khẩu, thiết bị) không được chép.
// File kết quả chứa dữ liệu khách: chỉ để trong thư mục tạm, KHÔNG đưa vào repo, xoá khi xong.
//
//   node scripts/engine-v2-realdata/export-snapshot.cjs <thư mục ra> [số ngày=3] [--focus] [--ids 1,2,3]
//
// --ids: chỉ các chiến dịch này (bỏ chọn mẫu), cửa sổ tối đa 30 ngày; dùng để phát lại đúng ca cần soi (ví dụ chiến dịch gặp 112).
//
// --focus: chỉ các tính năng phủ sau (gửi dạng chia sẻ, huỷ lời mời, sinh nhật, đề xuất, group thời gian thực, bạn bè "toàn bộ / theo
// tag", kiêm SMS), cửa sổ tối đa 30 ngày vì có loại chỉ vài chiến dịch một tháng; data lấy từ 400 dòng lịch sử mới nhất mỗi chiến dịch.
//
// Chạy bằng supabase CLI đã link akachat (cgjbsmqtfhqvttudyjzq); mỗi câu là một lệnh riêng, tuần tự.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../..')
const MAIN = path.resolve(ROOT, '../../..') // checkout akaAgent chính (có supabase/.temp/project-ref)
const OUT_DIR = process.argv[2]
const FOCUS = process.argv.includes('--focus')
const IDS_ARG = process.argv.indexOf('--ids')
const ONLY_IDS = IDS_ARG > 0 ? String(process.argv[IDS_ARG + 1] || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0) : null
if (ONLY_IDS && ONLY_IDS.length === 0) { console.error('--ids cần danh sách id chiến dịch'); process.exit(2) }
const DAYS = Math.max(1, Math.min(FOCUS || ONLY_IDS ? 30 : 7, Number(process.argv[3] || 3)))
if (!OUT_DIR) { console.error('Dùng: node export-snapshot.cjs <thư mục ra> [số ngày]'); process.exit(2) }
const ref = fs.readFileSync(path.join(MAIN, 'supabase/.temp/project-ref'), 'utf8').trim()
if (ref !== 'cgjbsmqtfhqvttudyjzq') { console.error(`Sai project ref: ${ref}`); process.exit(2) }

/** Số chiến dịch tối đa mỗi loại và số data tối đa mỗi chiến dịch. */
const CAMPAIGN_CAP = { zalo_message_phone: 40, zalo_message_group_member: 20, zalo_message_friend: 12, zalo_message_group: 12 }
const DEFAULT_CAP = 8
const TARGETS_PER_CAMPAIGN = 60

const ACCOUNT_COLUMNS = ['id', 'name', 'flatform_type', 'login_status', 'status', 'is_active', 'is_delete', 'created_at', 'updated_at',
  'sleep_between_actions', 'daily_limit', 'rate_limit_count', 'rate_limit_minutes', 'staff_id', 'organization_id', 'account_group_id',
  'proxy_id', 'zalo_account_id', 'zalo_session_last_verified_at', 'is_zalo_show_web', 'is_zalo_server', 'is_aka_agent_enabled',
  'is_akachat_enabled', 'zalo_phone_check_usage']

function query(sql, label) {
  const file = path.join(OUT_DIR, `.q-${label}.sql`)
  fs.writeFileSync(file, sql)
  const started = Date.now()
  const r = spawnSync('supabase', ['db', 'query', '--linked', '--workdir', MAIN, '-f', file, '-o', 'json'],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
  fs.rmSync(file, { force: true })
  // Lấy đúng khối JSON (từ '{' đầu tiên tới '}' cuối cùng); không lọc theo dòng vì dữ liệu cũng có thể chứa chữ của dòng thông báo
  // CLI (bản trước lọc /recommend/ nên làm mất action_id 'zalo_message_friend_recommendation' và mọi khoá chứa chữ đó).
  const raw = r.stdout || ''
  const text = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error(`${label}: không đọc được kết quả (${r.status}): ${(r.stderr || raw).slice(0, 600)}`) }
  if (!Array.isArray(parsed.rows)) throw new Error(`${label}: ${text.slice(0, 600)}`)
  console.log(`${label}: ${parsed.rows.length} dòng (${((Date.now() - started) / 1000).toFixed(1)} s)`)
  return parsed.rows
}
const ids = values => values.length ? values.map(v => String(Number(v))).join(',') : 'NULL'

fs.mkdirSync(OUT_DIR, { recursive: true })
const caps = Object.entries(CAMPAIGN_CAP).map(([a, n]) => `('${a}', ${n})`).join(', ')

// 1. Chọn chiến dịch: Zalo, có chạy trong DAYS ngày; chọn cố định theo băm id để lần nào chạy cũng ra cùng mẫu.
const FOCUS_CAPS = { 'share:zalo_message_friend': 10, 'share:zalo_message_group': 10, zalo_cancel_sent_friend_request: 8,
  zalo_message_birthday: 4, zalo_message_friend_recommendation: 4, zalo_message_group_realtime: 4, 'friendsrc:all_friends': 4,
  'friendsrc:tagged_friends': 4, sms: 6 }
const focusCaps = Object.entries(FOCUS_CAPS).map(([b, n]) => `('${b}', ${n})`).join(', ')
const picked = ONLY_IDS ? query(`select c.id, c.action_id from public.auto_campaigns c where c.id in (${ONLY_IDS.join(', ')}) order by c.id`, 'campaign_pick')
: FOCUS ? query(`
  with caps(bucket, cap) as (values ${focusCaps}),
  c as (
    select c.id, c.action_id,
      case
        when c.action_id in ('zalo_cancel_sent_friend_request', 'zalo_message_birthday', 'zalo_message_friend_recommendation',
          'zalo_message_group_realtime') then c.action_id
        when c.action_id in ('zalo_message_friend', 'zalo_message_group') and c.extra_settings->>'zaloMessageSendMode' = 'share'
          then 'share:' || c.action_id
        when c.action_id = 'zalo_message_friend' and c.extra_settings->>'zaloFriendTargetMode' in ('all_friends', 'tagged_friends')
          then 'friendsrc:' || (c.extra_settings->>'zaloFriendTargetMode')
        when c.action_id in ('zalo_message_phone', 'zalo_message_group_member')
          and (c.extra_settings->>'internalSmsEnabled' = 'true' or c.extra_settings->>'externalSmsEnabled' = 'true') then 'sms'
      end as bucket
    from public.auto_campaigns c
    where c.is_delete = false and c.last_run_at > now() - interval '${DAYS} days'
      and c.action_id in ('zalo_cancel_sent_friend_request', 'zalo_message_birthday', 'zalo_message_friend_recommendation',
        'zalo_message_group_realtime', 'zalo_message_friend', 'zalo_message_group', 'zalo_message_phone', 'zalo_message_group_member')
  ), r as (select c.*, row_number() over (partition by c.bucket order by md5(c.id::text || ':engine-v2-focus')) rn from c where c.bucket is not null)
  select r.id, r.action_id, r.bucket from r join caps on caps.bucket = r.bucket where r.rn <= caps.cap order by r.bucket, r.id`, 'campaign_pick')
: query(`
  with caps(action_id, cap) as (values ${caps}),
  c as (
    select c.id, c.action_id, row_number() over (partition by c.action_id order by md5(c.id::text || ':engine-v2-sample')) rn
    from public.auto_campaigns c join public.auto_campaign_actions a on a.id = c.action_id
    where a.flatform_type = 'zalo' and c.is_delete = false and c.last_run_at > now() - interval '${DAYS} days'
  )
  select c.id, c.action_id from c left join caps on caps.action_id = c.action_id
  where c.rn <= coalesce(caps.cap, ${DEFAULT_CAP}) order by c.action_id, c.id`, 'campaign_pick')
const campaignIds = picked.map(r => r.id)

// 2. Chiến dịch (bỏ log, token runtime để trống khi nạp).
const campaigns = query(`select c.id, c.name, c.action_id, c.account_id, c.status, c.schedule, c.is_delete, c.created_at, c.updated_at,
    c.content, c.schedule_type, c.schedule_end_date, c.schedule_days, c.schedule_week_days, c.continue_next_day, c.refresh_data,
    c.extra_settings, c.images, c.staff_id, c.organization_id, c.note, c.daily_stop_time, c.original_schedule, c.completed_at,
    c.last_run_at, c.time_sleep_between_2, c.data_target_source_mode, c.data_group_id, c.provisioning_state, c.secondary_account_id,
    c.content_rotation_indexes
  from public.auto_campaigns c where c.id in (${ids(campaignIds)}) order by c.id`, 'campaigns')

// 3. Data có lịch sử trong cửa sổ: tối đa TARGETS_PER_CAMPAIGN mỗi chiến dịch, mới nhất trước (đọc theo index (campaign_id, created_at, id)).
// --focus: chỉ đọc 400 dòng lịch sử mới nhất mỗi chiến dịch (cửa sổ 30 ngày của chiến dịch chia sẻ có thể tới hàng chục nghìn dòng).
const targetRows = FOCUS ? query(`
  with d as (
    select c.id as campaign_id, x.input_data_id, max(x.created_at) last_at
    from unnest(array[${ids(campaignIds)}]::bigint[]) c(id)
    cross join lateral (
      select d.input_data_id, d.created_at from public.auto_campaign_details d
      where d.campaign_id = c.id and d.is_delete = false and d.created_at > now() - interval '${DAYS} days' and d.input_data_id is not null
      order by d.created_at desc limit 400) x
    group by 1, 2
  ), r as (select d.*, row_number() over (partition by d.campaign_id order by d.last_at desc, d.input_data_id) rn from d)
  select campaign_id, input_data_id from r where rn <= ${TARGETS_PER_CAMPAIGN} order by campaign_id, input_data_id`, 'target_pick')
: query(`
  with d as (
    select d.campaign_id, d.input_data_id, max(d.created_at) last_at
    from public.auto_campaign_details d
    where d.campaign_id in (${ids(campaignIds)}) and d.is_delete = false and d.created_at > now() - interval '${DAYS} days'
      and d.input_data_id is not null
    group by 1, 2
  ), r as (select d.*, row_number() over (partition by d.campaign_id order by d.last_at desc, d.input_data_id) rn from d)
  select campaign_id, input_data_id from r where rn <= ${TARGETS_PER_CAMPAIGN} order by campaign_id, input_data_id`, 'target_pick')
const targetIds = targetRows.map(r => r.input_data_id)

const inputData = query(`select i.* from public.auto_campaign_input_data i where i.id in (${ids(targetIds)}) order by i.id`, 'input_data')

// 4. Lịch sử của các data đó trong cửa sổ (kết quả bộ cũ = chuẩn so sánh, cũng là kịch bản Zalo để phát lại).
// --focus: chỉ dòng mới nhất của mỗi thao tác của mỗi data (lượt gần nhất; chiến dịch chia sẻ gửi lại nhiều lần mỗi ngày), bỏ
// data.forwardResponse (cả lô, rất lớn; mỗi dòng đã có forwardTargetResult của chính nó).
const details = FOCUS ? query(`select x.* from (
    select distinct on (d.input_data_id, d.action_code) d.id, d.input_data_id, d.campaign_id, d.account_id, d.action_name, d.status, d.log,
      d.data - 'forwardResponse' as data, d.created_at, d.action_code, d.error_code, d.counts_toward_limit, d.status_id, d.sub_status_id,
      d.report_group, d.policy_snapshot, d.result_key
    from unnest(array[${ids(campaignIds)}]::bigint[]) c(id)
    cross join lateral (select * from public.auto_campaign_details d where d.campaign_id = c.id and d.is_delete = false
      and d.created_at > now() - interval '${DAYS} days' and d.input_data_id is not null order by d.created_at desc limit 400) d
    where d.input_data_id = any(array[${ids(targetIds)}]::bigint[])
    order by d.input_data_id, d.action_code, d.created_at desc) x
  order by x.input_data_id, x.created_at, x.id`, 'details')
: query(`select d.id, d.input_data_id, d.campaign_id, d.account_id, d.action_name, d.status, d.log, d.data, d.created_at,
    d.action_code, d.error_code, d.counts_toward_limit, d.status_id, d.sub_status_id, d.report_group, d.policy_snapshot, d.result_key
  from public.auto_campaign_details d
  where d.input_data_id in (${ids(targetIds)}) and d.is_delete = false and d.created_at > now() - interval '${DAYS} days'
  order by d.input_data_id, d.created_at, d.id`, 'details')

// 5. Tài khoản (không cột bí mật), khoá thao tác, nhóm tài khoản, gói và cờ tổ chức.
const accountIds = [...new Set(campaigns.flatMap(c => [c.account_id, c.secondary_account_id]).filter(Boolean))]
const accounts = query(`select ${ACCOUNT_COLUMNS.map(c => 'a.' + c).join(', ')} from public.auto_accounts a where a.id in (${ids(accountIds)}) order by a.id`, 'accounts')
const actionStatus = query(`select s.* from public.auto_account_action_status s where s.account_id in (${ids(accountIds)}) order by s.id`, 'account_action_status')
const groupIds = [...new Set(accounts.map(a => a.account_group_id).filter(Boolean))]
const accountGroups = query(`select g.id, g.settings, g.staff_id, g.organization_id, g.is_delete from public.auto_account_groups g where g.id in (${ids(groupIds)}) order by g.id`, 'account_groups')
const orgIds = [...new Set(campaigns.map(c => c.organization_id).filter(Boolean))]
const orgProducts = query(`select p.id, p.organization_id, p.product_id, p.expiration_date, p.is_deleted from public.org_organization_product p
  where p.organization_id in (${ids(orgIds)}) order by p.id`, 'org_products')
const orgs = query(`select o.id, o.use_new_zalo_runtime from public.org_organization o where o.id in (${ids(orgIds)}) order by o.id`, 'orgs')

// 6. Kiêm SMS nội bộ: tài khoản SMS đã chọn và chiến dịch SMS con của bộ cũ (kết quả bộ cũ để so), data con tạo trong cửa sổ.
const smsAccountIds = [...new Set(campaigns.flatMap(c => (c.extra_settings?.internalSmsEnabled === true && Array.isArray(c.extra_settings.internalSmsAccountIds)
  ? c.extra_settings.internalSmsAccountIds : []).map(Number).filter(n => Number.isFinite(n) && n > 0)))]
const smsAccounts = smsAccountIds.length ? query(`select ${ACCOUNT_COLUMNS.map(c => 'a.' + c).join(', ')} from public.auto_accounts a
  where a.id in (${ids(smsAccountIds)}) order by a.id`, 'sms_accounts') : []
const childIds = [...new Set(campaigns.flatMap(c => Object.values(c.extra_settings?.internalSmsCreatedCampaignIdsByAccount || {}))
  .map(Number).filter(n => Number.isFinite(n) && n > 0))]
const smsChildCampaigns = childIds.length ? query(`select c.id, c.name, c.action_id, c.account_id, c.status, c.content, c.extra_settings, c.staff_id,
  c.organization_id, c.schedule_type, c.continue_next_day, c.refresh_data, c.is_delete, c.created_at from public.auto_campaigns c
  where c.id in (${ids(childIds)}) order by c.id`, 'sms_child_campaigns') : []
const smsChildInputs = childIds.length ? query(`select i.id, i.campaign_id, i.name, i.phone, i.uid, i.content, i.status, i.created_at
  from public.auto_campaign_input_data i where i.campaign_id in (${ids(childIds)}) and i.created_at > now() - interval '${DAYS} days'
  order by i.id limit 3000`, 'sms_child_inputs') : []

const snapshot = {
  source: { projectRef: ref, exportedAt: new Date().toISOString(), days: DAYS, focus: FOCUS, campaignCaps: FOCUS ? FOCUS_CAPS : CAMPAIGN_CAP,
    defaultCap: DEFAULT_CAP, targetsPerCampaign: TARGETS_PER_CAMPAIGN,
    note: 'Dữ liệu khách thật, chỉ dùng cho môi trường thử trên máy; không đưa vào repo.' },
  campaigns, inputData, details, accounts, actionStatus, accountGroups, orgProducts, orgs, smsAccounts, smsChildCampaigns, smsChildInputs
}
const file = path.join(OUT_DIR, `engine-v2-realdata-${ONLY_IDS ? 'ids-' : FOCUS ? 'focus-' : ''}${new Date().toISOString().slice(0, 10)}.json`)
fs.writeFileSync(file, JSON.stringify(snapshot))
const byType = {}
for (const c of campaigns) byType[c.action_id] = (byType[c.action_id] || 0) + 1
console.log(JSON.stringify({ file, bytes: fs.statSync(file).size, campaigns: campaigns.length, byType, targets: inputData.length,
  details: details.length, accounts: accounts.length, orgs: orgs.length }))
