#!/usr/bin/env node
// Đọc CHỈ ĐỌC danh mục engine của production (akachat) thành bản sao cho bài kiểm migration dữ liệu (cùng khuôn với
// scripts/fixtures/engine-v2-facebook/v575-catalog-20261118.json): định nghĩa cột / chỉ mục / ràng buộc / trigger của các bảng danh mục, dòng
// của các bảng đó (bỏ cột chữ dài không ảnh hưởng quyết định), thân các hàm engine đọc danh mục. Không đọc dữ liệu khách.
//   node scripts/engine-v2-facebook/export-engine-catalog.cjs <tệp ra>
//   Thư mục link Supabase: AKA_SUPABASE_WORKDIR (mặc định repo chính có supabase/.temp/project-ref của akachat).
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const PRODUCTION_REF = 'cgjbsmqtfhqvttudyjzq'
const ROOT = path.resolve(__dirname, '../..')
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : null

/** Bảng có định nghĩa trong bản sao; bảng trong ROW_TABLES thì kèm dòng. */
const TABLES = ['auto_status', 'auto_error', 'auto_outcome_policies', 'auto_outcome_signal_rules', 'auto_system_settings',
  'auto_outcome_policy_history', 'auto_account_actions']
const ROW_TABLES = {
  auto_status: { drop: ['created_at', 'updated_at', 'description', 'note'] },
  auto_error: { drop: ['created_at', 'updated_at', 'description', 'error_desc', 'note'] },
  auto_outcome_policies: { drop: ['created_at', 'updated_at', 'description', 'note'] },
  auto_outcome_signal_rules: { drop: ['created_at', 'updated_at'] },
  auto_system_settings: { drop: ['created_at', 'updated_at', 'description'], where: `key IN ('facebook.error_signs', 'engine.bad_target_guard_error_code')` },
  auto_account_actions: { drop: ['created_at', 'updated_at', 'description', 'note'] }
}
/** Hàm engine đọc danh mục (thân đầy đủ). aka_agent_engine_report_v1 chỉ để kiểm md5 / phần vá (bản sao không có bảng lượt chạy). */
const FUNCTIONS = ['aka_agent_engine_classify_signal', 'aka_agent_engine_format_vn', 'aka_agent_engine_number', 'aka_agent_engine_policy_history_v495',
  'aka_agent_engine_policy_revision_v495', 'aka_agent_engine_render', 'aka_agent_engine_resolve_policy', 'aka_agent_engine_wait_note',
  'aka_agent_guard_result_catalog_v361', 'aka_agent_status_semantics', 'aka_agent_engine_lock_until', 'aka_agent_engine_setting',
  'aka_agent_engine_report_v1']

function catalogSql() {
  const list = arr => arr.map(t => `'${t}'`).join(', ')
  const rows = Object.entries(ROW_TABLES).map(([t, o]) => `'${t}', (select json_build_object(
      'columns', (select json_agg(c.column_name order by c.ordinal_position) from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = '${t}' and c.column_name not in (${list(o.drop)})),
      'rows', coalesce((select json_agg((select json_agg(to_jsonb(t0) -> c.column_name order by c.ordinal_position) from information_schema.columns c
          where c.table_schema = 'public' and c.table_name = '${t}' and c.column_name not in (${list(o.drop)})) order by t0.id)
        from public.${t} t0 ${o.where ? `where ${o.where}` : ''}), '[]')))`).join(',\n    ')
  return `select json_build_object(
  '_readAt', clock_timestamp(),
  '_how', 'Đọc chỉ đọc production akachat (supabase db query --linked, scripts/engine-v2-facebook/export-engine-catalog.cjs): định nghĩa cột / chỉ mục / ràng buộc / trigger của ${TABLES.length} bảng danh mục engine, dòng của ${Object.keys(ROW_TABLES).length} bảng (bỏ cột chữ dài), thân ${FUNCTIONS.length} hàm engine.',
  'columns', (select json_object_agg(t.table_name, (select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
        'notnull', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid), 'identity', a.attidentity) order by a.attnum)
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = ('public.' || t.table_name)::regclass and a.attnum > 0 and not a.attisdropped))
    from (select unnest(array[${list(TABLES)}]) table_name) t),
  'indexes', (select json_agg(i.indexdef order by i.tablename, i.indexname) from pg_indexes i where i.schemaname = 'public' and i.tablename in (${list(TABLES)})),
  'checks', (select coalesce(json_agg(json_build_object('table', 'public.' || cl.relname, 'name', co.conname, 'def', pg_get_constraintdef(co.oid))
        order by cl.relname, co.conname), '[]')
    from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and cl.relname in (${list(TABLES)}) and co.contype = 'c'),
  'triggers', (select coalesce(json_agg(json_build_object('table', cl.relname, 'def', pg_get_triggerdef(tg.oid)) order by cl.relname, tg.tgname), '[]')
    from pg_trigger tg join pg_class cl on cl.oid = tg.tgrelid join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and cl.relname in (${list(TABLES)}) and not tg.tgisinternal),
  'functions', (select json_agg(json_build_object('name', p.proname, 'signature', p.oid::regprocedure::text, 'def', pg_get_functiondef(p.oid),
        'md5', md5(pg_get_functiondef(p.oid))) order by p.proname, p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (${list(FUNCTIONS)})),
  'tables', json_build_object(
    ${rows}),
  'ledgerHead', (select json_agg(x order by x.version desc) from (select version, name from supabase_migrations.schema_migrations order by version desc limit 8) x)
) as out`
}

function workdir() {
  for (const dir of [process.env.AKA_SUPABASE_WORKDIR, path.resolve(ROOT, '../akaAgent'), path.resolve(ROOT, '../../..'), ROOT].filter(Boolean)) {
    const refFile = path.join(dir, 'supabase/.temp/project-ref')
    if (!fs.existsSync(refFile)) continue
    const ref = fs.readFileSync(refFile, 'utf8').trim()
    if (ref !== PRODUCTION_REF) throw new Error(`Thư mục ${dir} link project ${ref}, không phải akachat (${PRODUCTION_REF})`)
    return dir
  }
  throw new Error('Không tìm thấy thư mục link Supabase; đặt AKA_SUPABASE_WORKDIR')
}

function main() {
  if (!OUT) throw new Error('Cần đường dẫn tệp ra')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-engine-catalog-'))
  const file = path.join(tmp, 'q.sql')
  fs.writeFileSync(file, `begin read only;\nset transaction read only;\nset local statement_timeout = '30s';\n${catalogSql()};\nrollback;\n`)
  const r = spawnSync('supabase', ['db', 'query', '--linked', '--workdir', workdir(), '-f', file, '-o', 'json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  fs.rmSync(tmp, { recursive: true, force: true })
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'supabase db query lỗi').trim())
  const text = r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)
  const parsed = JSON.parse(text)
  const rows = parsed.rows || parsed
  const raw = (Array.isArray(rows) ? rows[0] : rows).out
  const out = typeof raw === 'string' ? JSON.parse(raw) : raw
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`)
  const counts = Object.fromEntries(Object.entries(out.tables).map(([t, v]) => [t, v.rows.length]))
  console.log(`Đã ghi ${OUT}: ${JSON.stringify(counts)}, ${out.functions.length} hàm; sổ migration mới nhất ${out.ledgerHead[0]?.name}`)
}

module.exports = { catalogSql, TABLES, ROW_TABLES, FUNCTIONS }
if (require.main === module) {
  try { main() } catch (error) { console.error(error.message); process.exit(1) }
}
