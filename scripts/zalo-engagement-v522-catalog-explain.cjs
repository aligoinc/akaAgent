// Read-only catalog measurement for one owner, on production or any copy (used 13/11/2026 for V522).
// Prints SQL: BEGIN READ ONLY; PREPARE q522 (+ q510) = the catalog SELECT of each migration with the
// PL/pgSQL variables as parameters; a DO block that walks every page from cursor {} (from = now())
// with EXPLAIN (ANALYZE, BUFFERS) in force_custom_plan and force_generic_plan, and with "v510" also
// EXPLAINs the V510 SELECT (generic plan) at the same cursors. A read-only transaction cannot keep a
// temp table, so the summary comes back as the error text "CATALOG_EXPLAIN {...}"; ROLLBACK.
// Usage: node scripts/zalo-engagement-v522-catalog-explain.cjs <staff_id> <organization_id> [v510] > file.sql
//        supabase db query --linked -f file.sql      (akachat; nothing is written)
'use strict'
const fs = require('node:fs'), path = require('node:path')
const [staff, org, compare] = process.argv.slice(2)
if (!/^\d+$/.test(staff || '') || !/^\d+$/.test(org || '') || (compare && compare !== 'v510')) {
  console.error('usage: node scripts/zalo-engagement-v522-catalog-explain.cjs <staff_id> <organization_id> [v510]'); process.exit(2)
}
const root = path.resolve(__dirname, '..')
const prepare = (file, name) => {
  const text = fs.readFileSync(path.join(root, file), 'utf8'), branch = text.indexOf("p_items->0 ? 'catalog' THEN")
  const start = text.indexOf('   SELECT COALESCE(jsonb_agg(to_jsonb(w)', branch), end = text.indexOf('   ) w;', start) + '   ) w'.length
  if (branch < 0 || start < branch || end < start) throw new Error(`catalog SELECT not found in ${file}`)
  return `PREPARE ${name}(bigint,bigint,timestamptz,timestamptz,bigint) AS\n` + text.slice(start, end).replace(' INTO v_result', '')
    .replaceAll('p_staff_id', '$1').replaceAll('p_organization_id', '$2').replaceAll('v_catalog_from', '$3')
    .replaceAll('v_catalog_until', '$4').replaceAll('v_catalog_id', '$5') + ';\n'
}
const watchNodes = `jsonb_path_query(plan,'strict $.**?(@."Relation Name"=="auto_campaign_detail_zalo_engagement")')`
const explain = (q, mode) => `
  PERFORM set_config('plan_cache_mode','${mode}',true);
  EXECUTE format('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) EXECUTE ${q}(${staff},${org},%L,%L,%s)',v_from,cur_until,cur_id) INTO plan;
  pages := jsonb_set(pages,'{${q} ${mode}}',COALESCE(pages->'${q} ${mode}','[]')||jsonb_build_array(jsonb_build_object(
    'buffers',(plan->0->'Plan'->>'Shared Hit Blocks')::bigint+(plan->0->'Plan'->>'Shared Read Blocks')::bigint,
    'read',(plan->0->'Plan'->>'Shared Read Blocks')::bigint,'ms',round((plan->0->>'Execution Time')::numeric,1),
    'sort',jsonb_path_exists(plan,'strict $.**?(@."Node Type"=="Sort")'),
    'index',(SELECT string_agg(DISTINCT x->>'Index Name',',') FROM ${watchNodes} x),
    'watchRows',(SELECT sum((x->>'Actual Rows')::bigint*(x->>'Actual Loops')::bigint) FROM ${watchNodes} x))));`
process.stdout.write(`BEGIN READ ONLY;
${prepare('migrations/migration_v522_zalo_engagement_catalog_ordered_walk.sql', 'q522')}${compare ? prepare('migrations/migration_v510_zalo_engagement_id_driven_lookups.sql', 'q510') : ''}
DO $catalog_explain$
DECLARE v_from timestamptz := now(); cur_until timestamptz := now(); cur_id bigint := 0; res jsonb; plan jsonb;
 n int := 0; items int := 0; pages jsonb := '{}'; k text; out jsonb := '{}';
BEGIN
 LOOP
  n := n+1;${explain('q522', 'force_custom_plan')}${explain('q522', 'force_generic_plan')}${compare ? explain('q510', 'force_generic_plan') : ''}
  EXECUTE format('EXECUTE q522(${staff},${org},%L,%L,%s)',v_from,cur_until,cur_id) INTO res;
  items := items+jsonb_array_length(res);
  EXIT WHEN jsonb_array_length(res)<500 OR n>=200;
  cur_until := (res->-1->>'tracking_until')::timestamptz; cur_id := (res->-1->>'campaign_detail_id')::bigint;
 END LOOP;
 FOR k IN SELECT jsonb_object_keys(pages) LOOP
  out := out||jsonb_build_object(k,(SELECT jsonb_build_object('buffers',sum((p->>'buffers')::bigint),'read',sum((p->>'read')::bigint),
    'ms',round(sum((p->>'ms')::numeric),1),'watchRows',sum((p->>'watchRows')::bigint),'sortedPages',count(*) FILTER (WHERE (p->>'sort')::boolean),
    'indexes',jsonb_agg(DISTINCT p->'index'),'page1',pages->k->0,'maxPageBuffers',max((p->>'buffers')::bigint),'maxPageMs',max((p->>'ms')::numeric))
    FROM jsonb_array_elements(pages->k) p));
 END LOOP;
 RAISE EXCEPTION 'CATALOG_EXPLAIN %',jsonb_build_object('staff',${staff},'organization',${org},'at',now(),'pages',n,'returned',items,
   'live',(SELECT count(*) FROM public.auto_campaign_detail_zalo_engagement WHERE organization_id=${org} AND staff_id=${staff} AND tracking_until>=v_from),
   'plans',out)::text;
END
$catalog_explain$;
ROLLBACK;
`)
