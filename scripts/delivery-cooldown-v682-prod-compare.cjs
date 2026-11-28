#!/usr/bin/env node
// Đo CHỈ ĐỌC trên production phần tra lịch sử người nhận của bước chống gửi lặp
// (CTE requested → recipient_history của public.aka_agent_apply_campaign_delivery_cooldown), bản trước V682 và bản V682
// (account_id + 0), cho data đầu đang chờ của N chiến dịch đang bật chống gửi lặp (luôn gồm 53573), ở cả custom lẫn generic plan.
// Mọi câu chạy trong BEGIN READ ONLY ... ROLLBACK, statement_timeout 30 giây; không gọi hàm thật (hàm có bước UPDATE tạm dừng data).
// Chỉ chép phần khác nhau giữa hai bản; các CTE sau (history, latest, decisions, paused) giống nhau nên không đo.
// Chạy: SUPABASE_WORKDIR=<checkout đã link project cgjbsmqtfhqvttudyjzq> node scripts/delivery-cooldown-v682-prod-compare.cjs [số chiến dịch] [--out file.json]
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const PROJECT_REF = 'cgjbsmqtfhqvttudyjzq'
const WORKDIR = process.env.SUPABASE_WORKDIR || path.resolve(__dirname, '..')
const refFile = path.join(WORKDIR, 'supabase/.temp/project-ref')
const linkedRef = fs.existsSync(refFile) ? fs.readFileSync(refFile, 'utf8').trim() : ''
if (linkedRef !== PROJECT_REF) {
  console.error(`${WORKDIR} chưa link project ${PROJECT_REF} (đang: ${linkedRef || 'không có'}); đặt SUPABASE_WORKDIR`)
  process.exit(2)
}
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const OUT = outIndex >= 0 ? args[outIndex + 1] : null
const LIMIT = Math.max(1, Math.min(50, Number(args.find(a => /^\d+$/.test(a)) || 12)))
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'v682-compare-'))

function run(sql) {
  const file = path.join(TMP, 'q.sql')
  fs.writeFileSync(file, sql)
  const r = spawnSync('supabase', ['db', 'query', '--linked', '--workdir', WORKDIR, '-o', 'json', '-f', file],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = r.stdout || ''
  const i = out.indexOf('{'), j = out.lastIndexOf('}')
  if (i < 0) throw new Error((r.stderr || '') + out)
  return JSON.parse(out.slice(i, j + 1)).rows
}

// $1 data, $2 nhân viên, $3 tổ chức, $4 đầu khoảng ngày, $5 cuối, $6 loại người nhận, $7 tài khoản, $8 mọi tài khoản, $9 mã thao tác
const chain = plus0 => {
  const account = plus0 ? '(hd.account_id + 0)' : 'hd.account_id'
  return `
WITH requested AS MATERIALIZED (
  SELECT i.id, public.aka_agent_internal_delivery_cooldown_target_keys($6, i.uid, i.phone, i.email) AS target_keys
  FROM pg_catalog.unnest($1::bigint[]) AS u(id)
  JOIN public.auto_campaign_input_data AS i ON i.id = u.id
),
requested_keys AS MATERIALIZED (
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT target.key), ARRAY[]::text[]) AS keys
  FROM requested AS r CROSS JOIN LATERAL pg_catalog.unnest(r.target_keys) AS target(key)
),
history_accounts AS MATERIALIZED (
  SELECT $7::bigint AS id WHERE NOT $8::boolean
  UNION ALL
  SELECT a.id FROM public.auto_accounts AS a WHERE $8::boolean AND a.staff_id = $2 AND a.organization_id = $3
),
lookup_keys AS MATERIALIZED (
  SELECT DISTINCT pg_catalog.split_part(k.key, ':', 1) AS kind, pg_catalog.substr(k.key, pg_catalog.strpos(k.key, ':') + 1) AS value
  FROM requested_keys AS batch CROSS JOIN LATERAL pg_catalog.unnest(batch.keys) AS k(key)
  WHERE $6 IN ('zalo_person', 'zalo_group', 'phone')
),
matching_input_ids AS MATERIALIZED (
  SELECT i.id FROM lookup_keys AS k
  JOIN public.auto_campaign_input_data AS i
    ON pg_catalog.md5(lower(pg_catalog.btrim(i.uid))) = pg_catalog.md5(k.value) AND lower(pg_catalog.btrim(i.uid)) = k.value
  WHERE k.kind IN ('zalo_person_uid', 'zalo_group') AND i.uid IS NOT NULL AND pg_catalog.btrim(i.uid) <> ''
  UNION
  SELECT i.id FROM lookup_keys AS k
  JOIN public.auto_campaign_input_data AS i
    ON pg_catalog.md5(public.normalize_phone(i.phone)) = pg_catalog.md5(k.value) AND public.normalize_phone(i.phone) = k.value
  WHERE k.kind IN ('zalo_person_phone', 'phone') AND i.phone IS NOT NULL AND pg_catalog.btrim(i.phone) <> ''
),
recipient_history AS MATERIALIZED (
  SELECT d.id AS detail_id, d.created_at
  FROM matching_input_ids AS matched
  JOIN public.auto_campaign_input_data AS source_input ON source_input.id = matched.id
  CROSS JOIN LATERAL (
    SELECT hd.id, hd.created_at FROM public.auto_campaign_details AS hd
    WHERE hd.input_data_id = matched.id AND ${account} IN (SELECT account.id FROM history_accounts AS account)
      AND hd.action_code = ANY($9::text[]) AND hd.created_at >= $4 AND hd.created_at <= $5
      AND hd.policy_snapshot->>'operationState' = 'committed'
    UNION ALL
    SELECT hd.id, hd.created_at FROM public.auto_campaign_details AS hd
    WHERE hd.input_data_id = matched.id AND ${account} IN (SELECT account.id FROM history_accounts AS account)
      AND hd.action_code = ANY($9::text[]) AND hd.created_at >= $4 AND hd.created_at <= $5
      AND hd.policy_snapshot->>'operationState' IS NULL
      AND hd.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click')
    OFFSET 0
  ) AS d
)
SELECT (SELECT count(*) FROM matching_input_ids) AS matched, (SELECT count(*) FROM recipient_history) AS hist,
       (SELECT max(created_at) FROM recipient_history) AS last_sent, (SELECT max(detail_id) FROM recipient_history) AS last_detail`
}

const KIND = {
  zalo_message_phone: 'zalo_person', zalo_message_group_member: 'zalo_person', zalo_message_friend: 'zalo_person',
  zalo_message_remarketing_customer: 'zalo_person', zalo_message_group: 'zalo_group', sms_send: 'phone'
}
const CODES = { zalo_person: ['zalo_message_friend', 'zalo_message_stranger'], zalo_group: ['zalo_message_group'], phone: ['sms_send'] }

function params(s) {
  const kind = KIND[s.action_id]
  return [`ARRAY[${Number(s.input_id)}]::bigint[]`, Number(s.staff_id), Number(s.organization_id),
    `(((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - ${Number(s.days) - 1})::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`, 'now()',
    `'${kind}'`, Number(s.account_id), s.all_accounts ? 'true' : 'false', `ARRAY[${CODES[kind].map(c => `'${c}'`).join(',')}]::text[]`].join(', ')
}
const PREPARE = plus0 => `prepare q(bigint[], bigint, bigint, timestamptz, timestamptz, text, bigint, boolean, text[]) as ${chain(plus0)};`

function measure(s, plus0, mode) {
  const rows = run(`begin read only;
set local statement_timeout = '30s';
set local plan_cache_mode = ${mode};
${PREPARE(plus0)}
explain (analyze, buffers, timing off, summary on, format json) execute q(${params(s)});
rollback;
`)
  const plan = rows[0]['QUERY PLAN'][0]
  return { ms: plan['Execution Time'], blocks: plan.Plan['Shared Hit Blocks'] + plan.Plan['Shared Read Blocks'] }
}
function result(s, plus0) {
  return run(`begin read only;
set local statement_timeout = '30s';
${PREPARE(plus0)}
execute q(${params(s)});
rollback;
`)[0]
}

const samples = run(`begin read only;
set local statement_timeout = '30s';
with c as materialized (
  select c.id, c.account_id, c.staff_id, c.organization_id, c.action_id,
         coalesce(nullif(btrim(c.extra_settings->>'recentDeliveryCooldownDays'), ''), '3')::int as days,
         (c.action_id = 'zalo_message_phone' and c.extra_settings->'recentDeliveryCooldownAllAccounts' = 'true'::jsonb) as all_accounts
  from auto_campaigns c
  where c.is_delete = false and c.status in ('chờ xử lý', 'đang chạy')
    and c.extra_settings->>'recentDeliveryCooldownEnabled' = 'true'
    and c.action_id in (${Object.keys(KIND).map(a => `'${a}'`).join(',')})
    and (c.action_id in ('zalo_message_friend', 'zalo_message_group', 'sms_send') or coalesce((c.extra_settings->>'enableMessage')::boolean, false))
)
select c.*, d.id as input_id from c
cross join lateral (select d.id from auto_campaign_input_data d
                    where d.campaign_id = c.id and d.is_delete = false and d.status = 'chờ xử lý' order by d.id limit 1) d
order by (c.id = 53573) desc, md5(c.id::text) limit ${LIMIT};
rollback;
`)
console.log(`${samples.length} chiến dịch`)
const out = []
for (const s of samples) {
  const before = result(s, false), after = result(s, true)
  const row = { campaign: s.id, action: s.action_id, staff: s.staff_id, allAccounts: s.all_accounts, days: s.days,
    matched: before.matched, history: before.hist, sameResult: JSON.stringify(before) === JSON.stringify(after) }
  for (const mode of ['force_custom_plan', 'force_generic_plan']) {
    const o = measure(s, false, mode), n = measure(s, true, mode)
    row[mode === 'force_custom_plan' ? 'custom' : 'generic'] =
      `${o.ms.toFixed(1)} ms / ${o.blocks} -> ${n.ms.toFixed(1)} ms / ${n.blocks}`
  }
  out.push(row)
  console.log(JSON.stringify(row))
}
fs.rmSync(TMP, { recursive: true, force: true })
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1))
const bad = out.filter(r => !r.sameResult)
if (bad.length) { console.error(`khác kết quả: ${bad.map(r => r.campaign).join(', ')}`); process.exit(1) }
