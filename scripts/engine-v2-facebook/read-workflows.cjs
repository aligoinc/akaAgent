#!/usr/bin/env node
// Đọc CHỈ ĐỌC đồ thị workflow Facebook trên production (akachat) làm nguồn cho công cụ chép bản "[engine]" (scripts/build-v560-sql.cjs, Q7).
// Không đọc dữ liệu khách, không chép code block (chỉ md5): 13 workflow của 13 loại chiến dịch FB + fb_campaign_rest_browse, node (id, block,
// tên block, khoá cấu hình), block (id, tên, md5 code), cột của auto_blocks / auto_workflows.
//   node scripts/engine-v2-facebook/read-workflows.cjs [tệp ra]  (mặc định scripts/fixtures/engine-v2-facebook/workflows-live.json)
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const PRODUCTION_REF = 'cgjbsmqtfhqvttudyjzq'
const ROOT = path.resolve(__dirname, '../..')
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/workflows-live.json'))

/** Câu đọc (dùng chung cho production và DB thử). */
function workflowsSql() {
  return `with src as (
  select c.id as purpose, c.workflow_id from public.auto_campaign_actions c
   where c.flatform_type = 'facebook' and c.is_active and not c.is_delete and c.workflow_id is not null
  union all
  select 'rest_browse', w.id from public.auto_workflows w where w.name = 'fb_campaign_rest_browse'
), wf as (
  select s.purpose, w.id, w.name, md5(w.nodes::text || w.edges::text) as md5, w.nodes from src s join public.auto_workflows w on w.id = s.workflow_id
), nodes as (
  select wf.id as workflow_id, n.ordinality, n.value as node from wf cross join lateral jsonb_array_elements(wf.nodes) with ordinality n
), blocks as (
  select distinct nullif(nodes.node->>'blockId', '')::bigint as id from nodes where (nodes.node->>'blockId') ~ '^[0-9]+$' and (nodes.node->>'blockId')::bigint > 0
)
select json_build_object(
  'readAt', clock_timestamp(),
  'workflows', (select coalesce(json_agg(json_build_object('purpose', wf.purpose, 'id', wf.id, 'name', wf.name, 'md5', wf.md5,
      'nodes', (select coalesce(json_agg(json_build_object('id', x.node->>'id', 'blockId', nullif(x.node->>'blockId', ''), 'blockName', x.node->>'blockName',
                 'systemType', x.node->>'systemType', 'configKeys', (select coalesce(json_agg(k order by k), '[]') from jsonb_object_keys(coalesce(x.node->'config', '{}'::jsonb)) k))
                 order by x.ordinality), '[]') from nodes x where x.workflow_id = wf.id)) order by wf.purpose), '[]') from wf),
  'blocks', (select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name, 'category', b.category, 'kind', b.kind, 'systemType', b.system_type,
      'isBuiltin', b.is_builtin, 'md5', md5(b.code)) order by b.id), '[]') from public.auto_blocks b where b.id in (select id from blocks)),
  'missingBlocks', (select coalesce(json_agg(x.id order by x.id), '[]') from blocks x where not exists (select 1 from public.auto_blocks b where b.id = x.id)),
  'columns', json_build_object(
    'auto_blocks', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'auto_blocks'),
    'auto_workflows', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'auto_workflows')),
  'engineBlocks', (select count(*) from public.auto_blocks where name like '[engine] %'),
  'engineWorkflows', (select count(*) from public.auto_workflows where name like '[engine] %')
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-workflows-'))
  const file = path.join(tmp, 'q.sql')
  fs.writeFileSync(file, `begin read only;\nset transaction read only;\nset local statement_timeout = '20s';\n${workflowsSql()};\nrollback;\n`)
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
  console.log(`Đã ghi ${OUT}: ${out.workflows.length} workflow, ${out.blocks.length} block (thiếu ${out.missingBlocks.length}); `
    + `đã có ${out.engineBlocks} block / ${out.engineWorkflows} workflow "[engine]"`)
}

module.exports = { workflowsSql }
if (require.main === module) {
  try { main() } catch (error) { console.error(error.message); process.exit(1) }
}
