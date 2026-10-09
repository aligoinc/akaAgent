// Read-only, sequential production measurements through the existing linked API.
// No write/claim/settle RPC invocation, outbound action, DDL, pool or setting change.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { query } = require('./campaign-status-catalog-migration.cjs')
const dir = path.resolve(__dirname, '../docs/audits/action-status-performance-20261010')
const load = file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
const quote = s => "'" + String(s).replaceAll("'", "''") + "'"
const sources = load('live-definitions-and-stats.json')
const params = load('query-parameters.json')
const allScopes = [...load('scopes.json').scopes, ...load('large-staff-scopes.json').scopes]
const scope = id => allScopes.find(x => x.staff_id === id)
const cases = []
const add = (name, group, sql, metadata = {}) => cases.push({ name, group, sql, ...metadata })
const functionBody = name => sources.functions.find(f => f.signature.startsWith(name + '(')).definition.split('AS $function$')[1].split('$function$')[0].trim().replace(/;$/, '')
const relationFilter = status => `(d.status=${quote(status)} OR EXISTS (SELECT 1 FROM public.auto_status filter_status WHERE filter_status.id IN (d.status_id,d.sub_status_id) AND (filter_status.status_value=${quote(status)} OR lower(filter_status.name)=lower(${quote(status)}))))`
const legacyStatuses = "'thành công','đã xem','đã click','thất bại','lỗi','không tồn tại','đã gửi lời mời','đã là thành viên'"

add('chat_catalog', 'catalog', `SELECT
 (SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM public.auto_status s) statuses,
 (SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.auto_account_action_status_policies p) policies,
 (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) FROM public.auto_error e WHERE e.is_active AND NOT e.is_delete) errors,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('code',a.code,'is_active',a.is_active,'is_delete',a.is_delete)),'[]'::jsonb) FROM public.auto_account_actions a) actions`)
for (const t of ['auto_status', 'auto_account_action_status_policies', 'auto_error', 'auto_account_actions']) add('desktop_catalog_' + t, 'catalog', `SELECT * FROM public.${t} WHERE id>0 ORDER BY id LIMIT 500`)

for (const staff of [385, 521, 603, 659, 1190, 305]) {
  const c = scope(staff).rows.find(x => !x.is_delete)
  const args = `${staff},${c.organization_id},${c.id}`
  add('details_all_' + staff, 'detail_rpc', `SELECT public.aka_agent_list_campaign_details_page_v2(${args},NULL,NULL,NULL,NULL,0,100,'created_desc',NULL,NULL,NULL)`, { staff_id: staff, campaign_id: c.id, rpc: true })
  if ([385, 521, 659].includes(staff)) for (const status of ['thành công', 'chờ duyệt bài']) {
    add(`details_${status === 'thành công' ? 'success' : 'sub'}_${staff}`, 'detail_rpc', `SELECT public.aka_agent_list_campaign_details_page_v2(${args},NULL,${quote(status)},NULL,NULL,0,100,'created_desc',NULL,NULL,NULL)`, { staff_id: staff, campaign_id: c.id, rpc: true })
  }
  if ([385, 1190].includes(staff)) {
    add('automation_options_' + staff, 'automation', `SELECT public.aka_agent_get_automation_options(${staff},${c.organization_id},NULL,NULL)`, { staff_id: staff, rpc: true })
  }
  if ([385, 521].includes(staff)) {
    const ids = scope(staff).rows.filter(x => !x.is_delete).slice(0,5).map(x => x.id)
    for (const fn of ['crm_agent_campaign_results', 'crm_trial_campaign_signal_counts']) {
      add(fn + '_' + staff, 'crm', `SELECT * FROM public.${fn}(ARRAY[${c.organization_id}]::bigint[],ARRAY[${ids}]::bigint[])`, { staff_id: staff, campaign_ids: ids })
    }
  }
}
for (const staff of [385, 659]) {
  const c = scope(staff).rows.find(x => !x.is_delete)
  for (const status of ['thành công', 'chờ duyệt bài']) for (const legacy of [false, true]) {
    add(`count_${staff}_${status === 'thành công' ? 'success' : 'sub'}_${legacy ? 'legacy' : 'current'}`, 'filter_comparison', `SELECT count(*) FROM public.auto_campaign_details d WHERE d.campaign_id=${c.id} AND d.is_delete=false AND ${legacy ? 'd.status=' + quote(status) : relationFilter(status)}`, { staff_id: staff, campaign_id: c.id, legacy_predicate_only: legacy })
  }
}
const biggest = scope(659).rows.find(x => !x.is_delete)
add('details_search_sub_659', 'detail_rpc', `SELECT public.aka_agent_list_campaign_details_page_v2(659,${biggest.organization_id},${biggest.id},'Chờ duyệt bài',NULL,NULL,NULL,0,100,'created_desc',NULL,NULL,NULL)`, { staff_id:659, campaign_id:biggest.id, rpc:true })
add('details_deep_page_659', 'detail_rpc', `SELECT public.aka_agent_list_campaign_details_page_v2(659,${biggest.organization_id},${biggest.id},NULL,NULL,NULL,NULL,30000,100,'created_desc',NULL,NULL,NULL)`, { staff_id:659, campaign_id:biggest.id, rpc:true })

for (const staff of [385, 521]) {
  const c = scope(staff).rows.find(x => !x.is_delete)
  const accounts = params.account_scopes.find(x => x.staff_id === staff).ids
  for (const legacy of [false, true]) {
    const filter = legacy ? `status IN (${legacyStatuses})` : `(report_group IN ('success','failure','skipped','pending') OR (report_group IS NULL AND status IN (${legacyStatuses})))`
    add(`report_page_${staff}_${legacy ? 'legacy' : 'current'}`, 'report_page', `SELECT id,input_data_id,account_id,action_code,status${legacy ? '' : ',report_group'} FROM public.auto_campaign_details WHERE is_delete=false AND account_id=ANY(ARRAY[${accounts}]::bigint[]) AND action_code IN (SELECT code FROM public.auto_account_actions WHERE is_active AND NOT is_delete) AND ${filter} AND created_at>='2026-09-09T17:00:00Z'::timestamptz AND created_at<'2026-10-10T17:00:00Z'::timestamptz AND id>0 ORDER BY id LIMIT 1000`, { staff_id:staff, legacy_predicate_only:legacy })
  }
  const p = params.campaigns.find(x => x.id === c.id)
  // Non-empty historical window, ending at this large campaign's latest result.
  const history = functionBody('aka_agent_internal_send_delivery_history')
    .replaceAll('p_account_id', String(c.account_id))
    .replaceAll('p_action_codes', "ARRAY['zalo_message_friend','zalo_message_stranger','zalo_message_group']::text[]")
    .replaceAll('p_since', `(${quote(p.latest)}::timestamptz-interval '30 days')`)
    .replaceAll('p_now', quote(p.latest) + '::timestamptz')
  add('delivery_history_' + staff, 'delivery_history', history, { staff_id:staff, account_id:c.account_id, window_ends_at:p.latest, exact_inner_sql:true })
}
const m = params.managed_sample
assert(m)
add('result_key_lookup', 'writer_read', `SELECT * FROM public.auto_campaign_details WHERE result_key=${quote(m.result_key)}`)
add('result_key_miss', 'writer_read', "SELECT * FROM public.auto_campaign_details WHERE result_key='__readonly_performance_missing_key__'")
for (const staff of [385,659]) {
  const c = scope(staff).rows.find(x => !x.is_delete), p=params.campaigns.find(x=>x.id===c.id)
  for (const input of [p.input_id,null]) {
    const inputFilter = input == null ? 'input_data_id IS NULL' : `input_data_id=${input}`
    add(`target_guard_${staff}_${input == null ? 'null' : 'input'}`, 'writer_read', `SELECT EXISTS(SELECT 1 FROM public.auto_campaign_details old WHERE old.campaign_id=${c.id} AND old.${inputFilter} AND old.policy_snapshot->>'unitKey'='__readonly_missing_unit__' AND old.policy_snapshot ? 'settlement')`, { staff_id:staff, campaign_id:c.id, input_id:input })
  }
}
add('settlement_detail_ids', 'writer_read', `SELECT count(*) FROM public.auto_campaign_details WHERE id=ANY(ARRAY[${m.id}]::bigint[]) AND campaign_id=${m.campaign_id} AND input_data_id IS NOT DISTINCT FROM ${m.input_data_id ?? 'NULL'} AND policy_snapshot->>'unitKey'=${quote(m.unit_key)}`)

// Attribution checks: these only execute SELECT bodies; no RPC is replaced.
const oldFunctions = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../migrations/snapshots/action-status-policies-v362/before.json'))).functions
const oldBody = name => oldFunctions.find(f=>f.signature.startsWith(name+'(')).definition.split('AS $function$')[1].split('$function$')[0].trim().replace(/;$/,'')
const currentPage = sources.functions.find(f=>f.signature.startsWith('aka_agent_list_campaign_details_page_v2(')).definition.split('EXECUTE format($query$')[1].split('$query$')[0]
for(const legacy of [false,true]) {
  const where=`d.campaign_id=7370 AND d.is_delete=false AND ${legacy ? "d.status='thành công'" : relationFilter('thành công')}`
  add('page_inner_385_'+(legacy?'legacy_filter':'current_warm'),'attribution',currentPage.replace('%1$s',where).replace('%1$s',where).replaceAll('%2$s','DESC').replace('$6','100').replace('$7','0').trim(),{staff_id:385,legacy_predicate_only:legacy})
}
for(const legacy of [true,false]) {
  let body=legacy?oldBody('aka_agent_get_automation_options'):functionBody('aka_agent_get_automation_options')
  // Auth SELECT is not part of this inner-query comparison. Real RPC cases above
  // use SET LOCAL ROLE service_role and retain the exact live identity guard.
  body=body.slice(body.indexOf('SELECT jsonb_build_object'))
    .replaceAll('p_staff_id','385').replaceAll('p_organization_id','365')
  add('automation_inner_385_'+(legacy?'legacy':'current_warm'),'attribution',body,{staff_id:385,legacy_inner_sql:legacy,samples:1})
}
for(const staff of [385,521]) {
  const c=scope(staff).rows.find(x=>!x.is_delete),ids=scope(staff).rows.filter(x=>!x.is_delete).slice(0,5).map(x=>x.id)
  for(const legacy of [true,false]) {
    const body=(legacy?oldBody('crm_agent_campaign_results'):functionBody('crm_agent_campaign_results'))
      .replaceAll('p_organization_ids',`ARRAY[${c.organization_id}]::bigint[]`).replaceAll('p_campaign_ids',`ARRAY[${ids}]::bigint[]`)
    add(`crm_inner_${staff}_${legacy?'legacy':'current'}`,'attribution',body,{staff_id:staff,legacy_inner_sql:legacy,samples:1})
  }
}
for(const staff of [385,659]) for(const status of ['thành công','chờ duyệt bài']) {
  const c=scope(staff).rows.find(x=>!x.is_delete)
  const sql=`WITH matched AS MATERIALIZED (SELECT ARRAY(SELECT id FROM public.auto_status WHERE status_value=${quote(status)} OR lower(name)=lower(${quote(status)})) ids)
SELECT (SELECT count(*) FROM public.auto_campaign_details d WHERE d.campaign_id=${c.id} AND d.is_delete=false AND d.status=${quote(status)})
 +(SELECT count(*) FROM public.auto_campaign_details d CROSS JOIN matched m WHERE d.campaign_id=${c.id} AND d.is_delete=false AND d.status IS DISTINCT FROM ${quote(status)} AND (d.status_id=ANY(m.ids) OR d.sub_status_id=ANY(m.ids))) AS total`
  add(`proposed_count_${staff}_${status==='thành công'?'success':'sub'}`,'read_only_prototype',sql,{staff_id:staff,campaign_id:c.id,status,not_applied:true})
}
add('report_page_385_current_warm','attribution',cases.find(x=>x.name==='report_page_385_current').sql,{staff_id:385})
for(const legacy of [true,false]) {
  const c=scope(521).rows.find(x=>!x.is_delete),ids=scope(521).rows.filter(x=>!x.is_delete).slice(0,5).map(x=>x.id)
  const sql=(legacy?oldBody('crm_trial_campaign_signal_counts'):functionBody('crm_trial_campaign_signal_counts'))
    .replaceAll('p_organization_ids',`ARRAY[${c.organization_id}]::bigint[]`).replaceAll('p_campaign_ids',`ARRAY[${ids}]::bigint[]`)
  add('crm_trial_inner_521_'+(legacy?'legacy':'current'),'attribution',sql,{staff_id:521,legacy_inner_sql:legacy,samples:1})
}
// Report clients pass a literal list, not a subquery: measure that exact filter
// shape too. The earlier semi-join cases are exploratory, not exact client plans.
const actionCodes=load('report-action-codes.json').actions.filter(a=>a.is_active&&!a.is_delete).map(a=>a.code)
for(const staff of [385,521]) for(const legacy of [true,false]) {
  const original=cases.find(x=>x.name===`report_page_${staff}_${legacy?'legacy':'current'}`)
  const sql=original.sql.replace('action_code IN (SELECT code FROM public.auto_account_actions WHERE is_active AND NOT is_delete)',`action_code=ANY(ARRAY[${actionCodes.map(quote).join(',')}]::text[])`)
  add(`report_literal_${staff}_${legacy?'legacy':'current'}`,'report_literal',sql,{staff_id:staff,legacy_predicate_only:legacy,scope:'all enabled action codes, all non-deleted accounts; no platform filter'})
}

fs.writeFileSync(path.join(dir,'cases.json'),JSON.stringify(cases,null,2)+'\n')
function summary(plan) {
  const indexes=new Set(), scans=[]
  function walk(p) {
    if (p['Index Name']) indexes.add(p['Index Name'])
    if (p['Relation Name']) scans.push({type:p['Node Type'],relation:p['Relation Name'],actual_rows:p['Actual Rows'],loops:p['Actual Loops'],removed:p['Rows Removed by Filter']||0})
    for (const x of p.Plans||[]) walk(x)
  }
  walk(plan.Plan)
  return { execution_ms:plan['Execution Time'],planning_ms:plan['Planning Time'],rows:plan.Plan['Actual Rows'],shared_hit:plan.Plan['Shared Hit Blocks'],shared_read:plan.Plan['Shared Read Blocks'],temp_read:plan.Plan['Temp Read Blocks'],temp_written:plan.Plan['Temp Written Blocks'],indexes:[...indexes],scans }
}
const from=Number(process.argv[2]||0),limit=Number(process.argv[3]||cases.length)
fs.mkdirSync(path.join(dir,'measurements'),{recursive:true})
for (const c of cases.slice(from,from+limit)) {
  const file=path.join(dir,'measurements',c.name+'.json')
  assert(!fs.existsSync(file),'Do not overwrite an earlier measurement: '+c.name)
  assert(/^(SELECT|WITH)\b/.test(c.sql.trim()),'Read query required')
  const samples=[]
  for(let attempt=0;attempt<(c.samples||3);attempt++) {
    const statement=`BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; ${c.rpc ? "SET LOCAL ROLE service_role; SET LOCAL request.jwt.claim.role='service_role';" : ''} EXPLAIN (ANALYZE,BUFFERS,TIMING OFF,FORMAT JSON) ${c.sql}; ROLLBACK;`
    const began=Date.now()
    try {
      const rows=query(statement), plan=rows[0]['QUERY PLAN'][0]
      samples.push({attempt:attempt+1,wall_ms:Date.now()-began,...summary(plan),plan})
    } catch(e) {
      samples.push({attempt:attempt+1,wall_ms:Date.now()-began,error:String(e.stderr||e.message).slice(0,1800)})
      break // Do not repeatedly run a timed-out case.
    }
  }
  fs.writeFileSync(file,JSON.stringify({checked_at:new Date().toISOString(),project_ref:sources.project_ref,case:c,samples},null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify({name:c.name,ms:samples.map(x=>x.execution_ms??'ERROR'),reads:samples.map(x=>x.shared_read),rows:samples.map(x=>x.rows),error:samples.find(x=>x.error)?.error}))
}
