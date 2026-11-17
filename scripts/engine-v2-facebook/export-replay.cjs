// Chép (chỉ đọc) một mẫu lượt chạy thật của chiến dịch Facebook từ production để phát lại bằng engine v2 trên máy (replay.cjs).
// Không ghi gì lên DB. Không chép cột bí mật (cookie, phiên, mật khẩu, thiết bị). File kết quả chứa dữ liệu khách: chỉ để trong thư mục
// tạm (scratchpad), KHÔNG đưa vào repo, xoá khi xong.
//
//   node scripts/engine-v2-facebook/export-replay.cjs <thư mục ra> [số ngày=3] [--ids 1,2,3]
//
// Mỗi chiến dịch lấy tối đa RUNS_PER_CAMPAIGN lượt workflow gần nhất của bộ cũ (auto_runs theo idx_runs_campaign) kèm đầu ra từng node
// (auto_run_steps theo idx_run_steps_run), data của các lượt đó (kể cả nhóm chia sẻ kèm mà block đã chọn), lịch sử bộ cũ của các data đó
// trong cửa sổ (chuẩn để so) và đồ thị workflow thật. Chạy bằng supabase CLI đã link akachat (cgjbsmqtfhqvttudyjzq), từng câu một.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../..')
const MAIN = process.env.AKA_MAIN_CHECKOUT || path.resolve(ROOT, '../akaAgent') // checkout chính (có supabase/.temp/project-ref)
const OUT_DIR = process.argv[2]
const IDS_ARG = process.argv.indexOf('--ids')
const ONLY_IDS = IDS_ARG > 0 ? String(process.argv[IDS_ARG + 1] || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0) : null
const DAYS = Math.max(1, Math.min(ONLY_IDS ? 30 : 7, Number(process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 3)))
if (!OUT_DIR) { console.error('Dùng: node export-replay.cjs <thư mục ra> [số ngày] [--ids 1,2,3]'); process.exit(2) }
const ref = fs.readFileSync(path.join(MAIN, 'supabase/.temp/project-ref'), 'utf8').trim()
if (ref !== 'cgjbsmqtfhqvttudyjzq') { console.error(`Sai project ref: ${ref}`); process.exit(2) }

/** Số chiến dịch mỗi loại (đăng nhóm nhiều nhất: 53% lịch sử FB) và số lượt mỗi chiến dịch. */
const CAMPAIGN_CAP = {
  facebook_group_post: 24, 'share:facebook_group_post': 10, facebook_page_to_message: 10, facebook_message_uid: 10,
  facebook_comment_seeding_post: 10, facebook_join_group: 10, facebook_comment_seeding: 10, facebook_find_data_group: 6,
  facebook_newsfeed_interaction: 6, facebook_message_friend: 6, facebook_timeline_post: 8, facebook_find_data_search: 8,
  facebook_page_post: 6, facebook_group_invite: 3
}
const RUNS_PER_CAMPAIGN = 15
const FB_TYPES = Object.keys(CAMPAIGN_CAP).filter(k => !k.includes(':'))

const ACCOUNT_COLUMNS = ['id', 'name', 'flatform_type', 'login_status', 'status', 'is_active', 'is_delete', 'created_at', 'updated_at',
  'staff_id', 'organization_id', 'account_group_id', 'proxy_id', 'is_zalo_show_web', 'is_zalo_server', 'is_aka_agent_enabled']

function query(sql, label) {
  const file = path.join(OUT_DIR, `.q-${label}.sql`)
  // Chỉ đọc, có trần thời gian: một câu một giao dịch read only.
  fs.writeFileSync(file, `begin read only;\nset local statement_timeout = '90s';\n${sql};\nrollback;\n`)
  const started = Date.now()
  const r = spawnSync('supabase', ['db', 'query', '--linked', '--workdir', MAIN, '-f', file, '-o', 'json'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024 })
  fs.rmSync(file, { force: true })
  const raw = r.stdout || ''
  const text = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error(`${label}: không đọc được kết quả (${r.status}): ${(r.stderr || raw).slice(0, 600)}`) }
  if (!Array.isArray(parsed.rows)) throw new Error(`${label}: ${text.slice(0, 600)}`)
  console.log(`${label}: ${parsed.rows.length} dòng (${((Date.now() - started) / 1000).toFixed(1)} s)`)
  return parsed.rows
}
const ids = values => values.length ? [...new Set(values.map(v => Number(v)))].join(',') : 'NULL'
const list = values => values.map(v => `'${String(v).replaceAll("'", "''")}'`).join(', ')

fs.mkdirSync(OUT_DIR, { recursive: true })

// 1. Chọn chiến dịch: FB, có chạy trong DAYS ngày; cố định theo băm id (lần nào chạy cũng ra cùng mẫu). Đăng nhóm bật chia sẻ sang nhóm đã
// tham gia lấy thành nhóm riêng để chắc có mẫu.
const caps = Object.entries(CAMPAIGN_CAP).map(([a, n]) => `('${a}', ${n})`).join(', ')
const picked = ONLY_IDS
  ? query(`select c.id, c.action_id from public.auto_campaigns c where c.id in (${ONLY_IDS.join(', ')}) order by c.id`, 'campaign_pick')
  : query(`
  with caps(bucket, cap) as (values ${caps}),
  c as (
    select c.id, c.action_id,
      case when c.action_id = 'facebook_group_post' and c.extra_settings->>'enableGroupPostShareToJoinedGroups' = 'true'
           then 'share:facebook_group_post' else c.action_id end as bucket
    from public.auto_campaigns c
    where c.action_id in (${list(FB_TYPES)}) and c.is_delete = false and c.last_run_at > now() - interval '${DAYS} days'
  ), r as (select c.*, row_number() over (partition by c.bucket order by md5(c.id::text || ':engine-v2-fb-replay')) rn from c)
  select r.id, r.action_id, r.bucket from r join caps on caps.bucket = r.bucket where r.rn <= caps.cap order by r.bucket, r.id`, 'campaign_pick')
const campaignIds = picked.map(r => r.id)

// 2. Chiến dịch (bỏ log và token runtime).
const campaigns = query(`select c.id, c.name, c.action_id, c.account_id, c.status, c.schedule, c.is_delete, c.created_at, c.updated_at,
    c.content, c.schedule_type, c.schedule_end_date, c.schedule_days, c.schedule_week_days, c.continue_next_day, c.refresh_data,
    c.extra_settings, c.images, c.staff_id, c.organization_id, c.note, c.daily_stop_time, c.original_schedule, c.completed_at,
    c.last_run_at, c.data_target_source_mode, c.data_group_id, c.provisioning_state, c.secondary_account_id, c.content_rotation_indexes
  from public.auto_campaigns c where c.id in (${ids(campaignIds)}) order by c.id`, 'campaigns')

// 3. Lượt workflow gần nhất của mỗi chiến dịch (cả lượt nghỉ / lướt FB: lọc theo workflow khi phát lại).
const runs = query(`select r.id, r.workflow_id, r.campaign_id, r.campaign_input_data_id, r.account_id, r.status, r.error, r.started_at,
    r.completed_at, r.created_at, r.variables->'groupPostShareTargets' as share_targets, r.variables->'groupPostShareMaxCount' as share_max
  from unnest(array[${ids(campaignIds)}]::bigint[]) c(id)
  cross join lateral (select * from public.auto_runs r where r.campaign_id = c.id and r.created_at > now() - interval '${DAYS} days'
                      order by r.id desc limit ${RUNS_PER_CAMPAIGN}) r
  order by r.campaign_id, r.id`, 'runs')
const runIds = runs.map(r => r.id)

// 4. Đầu ra từng node của các lượt đó (id tăng dần = thứ tự node bắt đầu).
const steps = []
for (let i = 0; i < runIds.length; i += 200) {
  steps.push(...query(`select s.id, s.run_id, s.node_id, s.block_id, s.block_name, s.status, s.output, s.error, s.started_at
    from public.auto_run_steps s where s.run_id in (${ids(runIds.slice(i, i + 200))}) order by s.run_id, s.id`, `steps_${i / 200}`))
}

// 5. Data của các lượt + nhóm chia sẻ kèm mà block đã chọn (đầu ra selectedTargets).
const shareIds = steps.filter(s => s.block_name === 'fb_select_group_post_share_targets')
  .flatMap(s => (Array.isArray(s.output?.selectedTargets) ? s.output.selectedTargets : []).map(t => Number(t?.id)).filter(n => n > 0))
const targetIds = [...new Set([...runs.map(r => r.campaign_input_data_id).filter(Boolean).map(Number), ...shareIds])]
const inputData = query(`select i.* from public.auto_campaign_input_data i where i.id in (${ids(targetIds)}) order by i.id`, 'input_data')

// 6. Lịch sử bộ cũ trong cửa sổ: theo data (đọc theo input_data_id) và dòng không có data (trang cá nhân, newsfeed) theo chiến dịch.
const since = runs.reduce((min, r) => (!min || r.started_at < min ? r.started_at : min), null) || new Date(Date.now() - DAYS * 86400000).toISOString()
const details = [
  ...query(`select d.id, d.input_data_id, d.campaign_id, d.account_id, d.action_name, d.status, d.log, d.data, d.created_at, d.action_code,
      d.error_code, d.counts_toward_limit, d.status_id, d.report_group, d.post_url
    from public.auto_campaign_details d
    where d.input_data_id in (${ids(targetIds)}) and d.is_delete = false and d.created_at >= '${since}'::timestamptz - interval '1 minute'
    order by d.input_data_id, d.id`, 'details'),
  ...query(`select d.id, d.input_data_id, d.campaign_id, d.account_id, d.action_name, d.status, d.log, d.data, d.created_at, d.action_code,
      d.error_code, d.counts_toward_limit, d.status_id, d.report_group, d.post_url
    from unnest(array[${ids(campaigns.filter(c => ['facebook_timeline_post', 'facebook_newsfeed_interaction'].includes(c.action_id)).map(c => c.id))}]::bigint[]) c(id)
    cross join lateral (select * from public.auto_campaign_details d where d.campaign_id = c.id and d.input_data_id is null and d.is_delete = false
                        and d.created_at >= '${since}'::timestamptz - interval '1 minute' order by d.id limit 2000) d
    order by d.campaign_id, d.id`, 'details_slot')
]

// 7. Workflow thật của các lượt, danh mục loại chiến dịch FB.
const workflows = query(`select w.id, w.name, w.nodes, w.edges, w.default_variables from public.auto_workflows w
  where w.id in (${ids(runs.map(r => r.workflow_id).filter(Boolean))}) order by w.id`, 'workflows')
const campaignActions = query(`select a.id, a.workflow_id, a.test_workflow_id, a.limit_check_action_codes from public.auto_campaign_actions a
  where a.flatform_type = 'facebook' order by a.id`, 'campaign_actions')

// 8. Tài khoản (không cột bí mật), nhóm tài khoản, gói, khoá / đếm thao tác.
const accountIds = [...new Set(campaigns.flatMap(c => [c.account_id, c.secondary_account_id]).filter(Boolean))]
const accounts = query(`select ${ACCOUNT_COLUMNS.map(c => 'a.' + c).join(', ')},
    coalesce((to_jsonb(a)->>'facebook_random_run_enabled')::boolean, false) as facebook_random_run_enabled
  from public.auto_accounts a where a.id in (${ids(accountIds)}) order by a.id`, 'accounts')
const groupIds = [...new Set(accounts.map(a => a.account_group_id).filter(Boolean))]
const accountGroups = query(`select g.id, g.settings, g.staff_id, g.organization_id, g.is_delete from public.auto_account_groups g
  where g.id in (${ids(groupIds)}) order by g.id`, 'account_groups')
const orgIds = [...new Set(campaigns.map(c => c.organization_id).filter(Boolean))]
const orgProducts = query(`select p.id, p.organization_id, p.product_id, p.package_type, p.expiration_date, p.max_sends_per_day, p.is_deleted
  from public.org_organization_product p where p.organization_id in (${ids(orgIds)}) order by p.id`, 'org_products')
const staffIds = [...new Set(campaigns.map(c => c.staff_id).filter(Boolean))]
const staff = query(`select s.id, s.organization_id, s.max_running_facebook_accounts from public.org_staff s where s.id in (${ids(staffIds)}) order by s.id`, 'staff')

const snapshot = {
  source: { projectRef: ref, exportedAt: new Date().toISOString(), days: DAYS, campaignCaps: CAMPAIGN_CAP, runsPerCampaign: RUNS_PER_CAMPAIGN,
    note: 'Dữ liệu khách thật, chỉ dùng cho môi trường thử trên máy; không đưa vào repo.' },
  campaigns, runs, steps, inputData, details, workflows, campaignActions, accounts, accountGroups, orgProducts, staff
}
const file = path.join(OUT_DIR, `engine-v2-fb-replay-${ONLY_IDS ? 'ids-' : ''}${new Date().toISOString().slice(0, 10)}.json`)
fs.writeFileSync(file, JSON.stringify(snapshot))
const byType = {}
for (const c of campaigns) byType[c.action_id] = (byType[c.action_id] || 0) + 1
console.log(JSON.stringify({ file, bytes: fs.statSync(file).size, campaigns: campaigns.length, byType, runs: runs.length, steps: steps.length,
  targets: inputData.length, details: details.length, workflows: workflows.length, accounts: accounts.length }))
