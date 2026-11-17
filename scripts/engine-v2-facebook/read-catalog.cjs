#!/usr/bin/env node
// Đọc CHỈ ĐỌC danh mục lỗi / chính sách / luật phân loại liên quan Facebook từ production (akachat) để sinh V559 và bảng duyệt FB
// (scripts/build-v559-sql.cjs). Không đọc dữ liệu khách. Một câu duy nhất trong giao dịch read only.
//   node scripts/engine-v2-facebook/read-catalog.cjs [tệp ra]   (mặc định scripts/fixtures/engine-v2-facebook/catalog-live.json)
//   Thư mục link Supabase: AKA_SUPABASE_WORKDIR (mặc định repo chính có supabase/.temp/project-ref của akachat).
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const PRODUCTION_REF = 'cgjbsmqtfhqvttudyjzq'
const ROOT = path.resolve(__dirname, '../..')
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/catalog-live.json'))

/** Câu đọc danh mục: dùng chung cho production và DB thử (catalogSql()). */
function catalogSql() {
  return `select json_build_object(
  'readAt', clock_timestamp(),
  'fbErrors', (select coalesce(json_agg(x order by x.public_code, x.error_code), '[]') from (
     select e.id, e.error_type, e.error_code, e.public_code, e.error_class, e.error_name, e.customer_title, e.customer_help,
            e.noti_running_process, e.noti_campaign, e.detail_mode, e.detail_status, e.detail_status_id, e.input_effect,
            e.counts_toward_limit, e.counts_toward_bad_target, e.count_consecutive_errors, e.update_status_campaign,
            e.update_status_account, e.update_login_status, e.disable_action_codes, e.disable_action_mode, e.time_disable_actions,
            e.disable_action_days, e.disable_action_time, e.is_active, e.is_delete
       from public.auto_error e
      where e.error_type = 'external facebook' or e.public_code like 'FB%'
         or e.error_code in ('err_undefined', 'err_engine_unknown_delivery', 'err_runtime_browser', 'err_system_block_load',
           'err_engine_no_outcome', 'err_engine_cancelled', 'err_engine_interrupted_while_sending', 'err_engine_interrupted_before_send',
           'err_media_file_missing', 'err_campaign_config_invalid', 'err_network_offline', 'err_server_unreachable')) x),
  'statuses', (select coalesce(json_agg(json_build_object('id', s.id, 'code', s.code, 'statusValue', s.status_value,
                'reportGroup', s.report_group, 'systemStatusCode', s.system_status_code) order by s.id), '[]')
                 from public.auto_status s where s.component_type = 'campaign_detail' and s.is_active and not s.is_delete),
  'policies', (select coalesce(json_agg(to_jsonb(p) - 'created_at' - 'updated_at' - 'updated_by' order by p.id), '[]')
                 from public.auto_outcome_policies p
                where p.is_active and not p.is_delete and (
                  p.status_id is not null or p.error_class is not null
                  or (p.error_code is null and p.status_id is null and p.error_class is null)
                  or p.error_code in (select e.error_code from public.auto_error e where e.error_type = 'external facebook' or e.public_code like 'FB%')
                  or p.error_code in ('err_undefined', 'err_engine_unknown_delivery', 'err_runtime_browser', 'err_system_block_load',
                    'err_engine_no_outcome', 'err_engine_cancelled', 'err_engine_interrupted_while_sending'))),
  'rules', (select coalesce(json_agg(to_jsonb(r) - 'created_at' - 'updated_at' order by r.platform, r.priority, r.id), '[]')
              from public.auto_outcome_signal_rules r where r.is_active and r.platform in ('facebook', 'system')),
  'fbActions', (select coalesce(json_agg(json_build_object('code', a.code, 'name', a.name, 'operationClass', a.operation_class) order by a.code), '[]')
                  from public.auto_account_actions a where a.flatform_type = 'facebook' and a.is_active and not a.is_delete),
  'fbCampaignActions', (select coalesce(json_agg(json_build_object('id', c.id, 'name', c.name, 'limitCheckActionCodes', c.limit_check_action_codes) order by c.id), '[]')
                          from public.auto_campaign_actions c where c.flatform_type = 'facebook' and c.is_active and not c.is_delete),
  'ledgerHead', (select coalesce(json_agg(x order by x.version desc), '[]') from (
     select version, name from supabase_migrations.schema_migrations order by version desc limit 8) x)
) as out`
}

function workdir() {
  for (const dir of [process.env.AKA_SUPABASE_WORKDIR, path.resolve(ROOT, '../akaAgent'), ROOT].filter(Boolean)) {
    const refFile = path.join(dir, 'supabase/.temp/project-ref')
    if (!fs.existsSync(refFile)) continue
    const ref = fs.readFileSync(refFile, 'utf8').trim()
    if (ref !== PRODUCTION_REF) throw new Error(`Thư mục ${dir} link project ${ref}, không phải akachat (${PRODUCTION_REF})`)
    return dir
  }
  throw new Error('Không tìm thấy thư mục link Supabase; đặt AKA_SUPABASE_WORKDIR')
}

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-catalog-'))
  const file = path.join(tmp, 'q.sql')
  fs.writeFileSync(file, `begin read only;\nset transaction read only;\nset local statement_timeout = '20s';\n${catalogSql()};\nrollback;\n`)
  const r = spawnSync('supabase', ['db', 'query', '--linked', '--workdir', workdir(), '-f', file, '-o', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  fs.rmSync(tmp, { recursive: true, force: true })
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'supabase db query lỗi').trim())
  const text = r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)
  const parsed = JSON.parse(text)
  const rows = parsed.rows || parsed
  const raw = (Array.isArray(rows) ? rows[0] : rows).out
  const out = typeof raw === 'string' ? JSON.parse(raw) : raw
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify({ source: `production ${PRODUCTION_REF} (chỉ đọc)`, ...out }, null, 1)}\n`)
  console.log(`Đã ghi ${OUT}: ${out.fbErrors.length} mã, ${out.policies.length} chính sách, ${out.rules.length} luật; sổ migration mới nhất ${out.ledgerHead[0]?.name}`)
}

module.exports = { catalogSql }
if (require.main === module) {
  try { main() } catch (error) { console.error(error.message); process.exit(1) }
}
