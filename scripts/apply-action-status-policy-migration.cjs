const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const m = require('./action-status-policy-migration.cjs')
const seed = require('./action-status-policy-seed.cjs')
const sqlPath = path.join(m.root,'migrations',m.name+'.sql')
const rollbackPath = path.join(m.root,'migrations/tests',m.name+'_rollback.sql')
const indexStatements = [
  'CREATE UNIQUE INDEX CONCURRENTLY auto_detail_result_key_uq ON public.auto_campaign_details(result_key) WHERE result_key IS NOT NULL',
  ...['status_id','sub_status_id','action_status_policy_id'].map(c=>`CREATE INDEX CONCURRENTLY auto_detail_${c}_idx ON public.auto_campaign_details(${c}) WHERE ${c} IS NOT NULL`)
]
const validationStatements = ['auto_detail_status_fk','auto_detail_sub_status_fk','auto_detail_policy_fk','auto_detail_report_group_check','auto_detail_snapshot_check','auto_detail_result_key_check']
  .map(c=>`ALTER TABLE public.auto_campaign_details VALIDATE CONSTRAINT ${c}`)
function sql() { m.checkedBackup(); return fs.readFileSync(sqlPath,'utf8') }
function historySQL(body, historyVersion) {
  return `INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (${m.quote(historyVersion)},${m.quote(m.name)},ARRAY[${m.quote(body)}]);`
}
function checksSQL() {
  return `DO $check$ BEGIN
    IF (SELECT count(*) FROM public.${m.newTable})<>${seed.rows.length} THEN RAISE EXCEPTION 'v361 seed count'; END IF;
    IF EXISTS (SELECT 1 FROM public.auto_error WHERE detail_status_id IS NOT NULL OR detail_mode IS NOT NULL OR input_effect IS NOT NULL) THEN RAISE EXCEPTION 'v361 old error metadata'; END IF;
    IF EXISTS (SELECT 1 FROM public.${m.newTable} WHERE NOT is_active OR is_delete) THEN RAISE EXCEPTION 'v361 inactive seed'; END IF;
    IF EXISTS (SELECT 1 FROM public.${m.newTable} p JOIN public.auto_status s ON s.id=p.status_id WHERE s.component_type<>'campaign_detail') THEN RAISE EXCEPTION 'v361 wrong status component'; END IF;
    IF has_table_privilege('anon','public.${m.newTable}','INSERT') OR has_table_privilege('authenticated','public.${m.newTable}','UPDATE') THEN RAISE EXCEPTION 'v361 client mutation grant'; END IF;
  END $check$;`
}
function originalGuard(before) {
  return Object.entries(before.tables).map(([t,d])=>{
    if(t==='auto_campaign_action_detail_statuses') return `IF EXISTS (SELECT 1 FROM jsonb_array_elements(${m.jsonSQL(d.rows.map(x=>x.row),'old_mapping')}) h LEFT JOIN public.${t} t ON t.id=(h->>'id')::bigint WHERE t.id IS NULL OR (to_jsonb(t)-'updated_at') IS DISTINCT FROM (h-'updated_at')) THEN RAISE EXCEPTION 'v361 untouched mapping content changed'; END IF;`
    const keys=Object.keys(d.rows[0]?.row||{})
    const projected = `jsonb_build_object(${keys.map(k=>`${m.quote(k)},t.${k}`).join(',')})`
    return `IF EXISTS (SELECT 1 FROM jsonb_each_text(${m.jsonSQL(Object.fromEntries(d.rows.map(x=>[x.row.id,x.md5])),'old_'+t)}) h LEFT JOIN public.${t} t ON t.id=h.key::bigint WHERE t.id IS NULL OR md5((${projected})::text)<>h.value) THEN RAISE EXCEPTION 'v361 original changed: ${t}'; END IF;`
  }).join('\n')
}
function buildRollback(after, persist=true, before=m.checkedBackup()) {
  // An existing ownership receipt is immutable. A later snapshot cannot adopt
  // operator-created rows or bless edits to rows inserted by this migration.
  const receiptPath=path.join(m.directory,'inserted-rows.json')
  const receipt=fs.existsSync(receiptPath) ? m.read('inserted-rows.json') : null
  const objects=m.read('objects.json')
  const inserted=Object.fromEntries(Object.entries(after.tables).map(([t,d])=>[t,d.rows.filter(x=>!before.tables[t]?.rows.some(old=>old.row.id===x.row.id))]).filter(([,r])=>r.length))
  if(receipt && before.project_ref===m.ref) assert.deepEqual(inserted,receipt,'Migration ownership changed; inspect instead of regenerating rollback')
  const guardRows=Object.entries(after.tables).filter(([t])=>t!=='auto_campaign_action_detail_statuses').map(([t,d])=>`IF (SELECT count(*) FROM public.${t})<>${d.count} OR EXISTS (SELECT 1 FROM jsonb_each_text(${m.jsonSQL(Object.fromEntries(d.rows.map(x=>[x.row.id,x.md5])),'after_'+t)}) h LEFT JOIN public.${t} t ON t.id=h.key::bigint WHERE t.id IS NULL OR md5(to_jsonb(t)::text)<>h.value) THEN RAISE EXCEPTION 'v361 rollback: catalog modified: ${t}'; END IF;`).join('\n')
  const schemaGuards=(after.schema||[]).filter(s=>s.exists && (s.table===m.newTable || objects.columns[s.table])).map(s=>{
    const expected=Object.fromEntries(Object.entries(s).filter(([k])=>k!=='sequence'))
    return `IF (${m.schemaSQL(s.table)} - 'sequence') IS DISTINCT FROM ${m.jsonSQL(expected,'rollback_schema_'+s.table)} THEN RAISE EXCEPTION 'v361 rollback: schema/reference drift: ${s.table}'; END IF;`
  }).join('\n')
  const guards=objects.new_functions.map(signature=>{
    const f=after.functions.find(f=>f.signature.replace(/^public\./,'')===signature)
    assert(f,`Missing after function: ${signature}`)
    return `IF to_regprocedure('public.${signature}') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.${signature}')))<>${m.quote(f.md5)} THEN RAISE EXCEPTION 'v361 rollback: guard modified'; END IF;`
  }).join('\n')
  const rollback=`-- Generated from after.json. Do not remove drift/reference guards or use CASCADE.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.${m.newTable},public.auto_status,public.auto_error,public.auto_automation_trigger_statuses,public.auto_campaign_action_detail_statuses IN SHARE ROW EXCLUSIVE MODE;
-- Readers remain available during the bounded usage check. Never scan the
-- detail heap while holding ACCESS EXCLUSIVE. Fail/retry rather than wait.
LOCK TABLE public.auto_campaign_details IN SHARE ROW EXCLUSIVE MODE NOWAIT;
SET LOCAL statement_timeout='2s';
DO $guard$ BEGIN
${schemaGuards}
${guardRows}
${guards}
IF EXISTS (SELECT 1 FROM public.auto_campaign_details WHERE status_id IS NOT NULL OR sub_status_id IS NOT NULL OR action_status_policy_id IS NOT NULL OR report_group IS NOT NULL OR policy_snapshot IS NOT NULL OR result_key IS NOT NULL) THEN RAISE EXCEPTION 'v361 rollback: result metadata already used'; END IF;
END $guard$;
LOCK TABLE public.auto_campaign_details IN ACCESS EXCLUSIVE MODE NOWAIT;
SET LOCAL statement_timeout='30s';
DROP TRIGGER auto_detail_result_guard ON public.auto_campaign_details;
DROP TRIGGER auto_aasp_component_guard ON public.${m.newTable};
DROP TRIGGER auto_error_result_component_guard ON public.auto_error;
DROP TRIGGER auto_automation_sub_status_guard ON public.auto_automation_trigger_statuses;
DROP TRIGGER auto_status_result_component_guard ON public.auto_status;
${objects.new_functions.map(f=>`DROP FUNCTION public.${f};`).join('\n')}
ALTER TABLE public.auto_campaign_details ${objects.columns.auto_campaign_details.map(c=>'DROP COLUMN '+c).join(',')};
ALTER TABLE public.auto_error ${objects.columns.auto_error.map(c=>'DROP COLUMN '+c).join(',')};
ALTER TABLE public.auto_automation_trigger_statuses DROP COLUMN sub_status_ids;
DELETE FROM public.${m.newTable} WHERE id IN (${inserted[m.newTable].map(x=>x.row.id).join(',')});
DROP TABLE public.${m.newTable};
DELETE FROM public.auto_status WHERE id IN (${inserted.auto_status.map(x=>x.row.id).join(',')});
ALTER TABLE public.auto_status DROP COLUMN status_value,DROP COLUMN color;
DO $verify$ BEGIN ${originalGuard(before)} END $verify$;
-- Keep migration history and all snapshot/apply/rollback receipts. Never reset sequences.
COMMIT;
`
  if(persist) {
    fs.writeFileSync(rollbackPath,rollback)
    if(!receipt) m.write('inserted-rows.json',inserted)
  }
  return rollback
}
function smoke() {
  const before=m.checkedBackup()
  const legacyProbe=`SAVEPOINT legacy_probe;
SET LOCAL ROLE anon;
DO $legacy$ DECLARE probe public.auto_campaign_details; BEGIN
INSERT INTO public.auto_campaign_details(input_data_id,campaign_id,account_id,action_code,action_name,status)
SELECT input_data_id,campaign_id,account_id,action_code,action_name,'__v361_legacy_probe__' FROM public.auto_campaign_details ORDER BY id DESC LIMIT 1 RETURNING * INTO probe;
IF probe.id IS NULL OR probe.status_id IS NOT NULL OR probe.sub_status_id IS NOT NULL OR probe.action_status_policy_id IS NOT NULL OR probe.report_group IS NOT NULL OR probe.policy_snapshot IS NOT NULL OR probe.result_key IS NOT NULL THEN RAISE EXCEPTION 'v361 legacy insert failed'; END IF;
END $legacy$;
RESET ROLE;
ROLLBACK TO legacy_probe;`
  const body=sql()
  const out=m.query(body.replace(/COMMIT;\s*$/,()=>`${checksSQL()}\nDO $old$ BEGIN ${originalGuard(before)} END $old$;\n${legacyProbe}\n${historySQL(body,'00000000000361')}\nSELECT true AS verified;\nROLLBACK;`))
  assert.equal(out[0]?.verified,true)
  const after=m.snapshot();m.validateSnapshot(after);const independent=m.originalRowsUnchanged(before,after)
  m.write('independent-mapping-timestamps.json',independent,false)
  assert(!after.schema.find(s=>s.table===m.newTable).exists)
  m.write('prepare-smoke.json',{at:new Date().toISOString(),project_ref:m.ref,migration_sha256:m.hash(sql()),rolled_back:true,old_rows_unchanged:true},false)
  // It is deliberately unusable until the real INSERT IDs/checksums are captured.
  fs.writeFileSync(rollbackPath,"-- Replaced with exact ID/checksum guarded SQL immediately after apply.\nDO $$ BEGIN RAISE EXCEPTION 'v361 rollback requires verified after.json receipt'; END $$;\n")
  console.log('Live preparation smoke rolled back; all original rows unchanged')
}
function apply() {
  const before=m.checkedBackup(), smoke=m.read('prepare-smoke.json'), body=sql()
  assert.equal(smoke.migration_sha256,m.hash(body),'Smoke is stale')
  assert(!fs.existsSync(path.join(m.directory,'apply.json')),'Apply receipt exists; inspect instead of reapplying')
  assert(fs.existsSync(rollbackPath),'Rollback template required')
  const historyVersion = new Date().toISOString().replace(/\D/g,'').slice(0,14)
  const applied=m.query(body.replace(/COMMIT;\s*$/,()=>`${checksSQL()}\nDO $old$ BEGIN ${originalGuard(before)} END $old$;
${historySQL(body,historyVersion)}
SELECT true AS applied; COMMIT;`))
  assert.equal(applied[0]?.applied,true)
  m.write('apply.json',{at:new Date().toISOString(),project_ref:m.ref,history_version:historyVersion,name:m.name,migration_sha256:m.hash(body)})
  captureAfter(before)
  console.log('Preparation applied; indexes and API verification still required')
}
function captureAfter(before=m.checkedBackup()) {
  const after=m.snapshot();m.validateSnapshot(after);const independent=m.originalRowsUnchanged(before,after)
  m.write('independent-mapping-timestamps.json',independent,false)
  // Validate ownership before touching the previous verified receipt.
  const rollback=buildRollback(after,false,before)
  const ownedFile=path.join(m.directory,'ownership-after.json')
  if(!fs.existsSync(ownedFile)) {
    const original=fs.existsSync(path.join(m.directory,'after.json')) ? m.read('after.json') : after
    m.validateSnapshot(original)
    m.write('ownership-after.json',original)
    m.write('ownership-manifest.json',{project_ref:m.ref,sha256:m.hash(fs.readFileSync(ownedFile))})
  }
  m.write('after.json',after,false)
  fs.writeFileSync(rollbackPath,rollback)
  if(!fs.existsSync(path.join(m.directory,'inserted-rows.json'))) buildRollback(after)
  m.write('after-manifest.json',{project_ref:m.ref,captured_at:after.captured_at,sha256:m.hash(fs.readFileSync(path.join(m.directory,'after.json'))),rollback_sha256:m.hash(fs.readFileSync(rollbackPath)),old_rows_unchanged:true},false)
}
function indexes() {
  // Each CONCURRENTLY statement is its own Management API call, outside BEGIN.
  const completed=[]
  for (const statement of indexStatements) {
    const name=statement.match(/INDEX CONCURRENTLY (\w+)/)[1]
    const present=m.query(`SELECT i.indisvalid,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i WHERE i.indexrelid=to_regclass('public.${name}')`)
    if (present.length) {
      assert.equal(present[0].indisvalid,true,`Invalid index ${name}: inspect before continuing`)
      assert.equal(present[0].definition.replace(' USING btree','').replaceAll(' (','(').replace(/ WHERE \((.*)\)$/,' WHERE $1'),statement.replace(' CONCURRENTLY','').replaceAll(' (','('),`Unexpected index ${name}`)
    } else m.query(statement+';')
    completed.push(name)
    m.write('index-progress.json',{at:new Date().toISOString(),completed},false)
  }
  m.query(`BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='60s';${validationStatements.join(';')};COMMIT;`)
  captureAfter()
  console.log('Concurrent indexes and constraint validation complete')
}
const commands={smoke,apply,indexes,'capture-after':captureAfter}
if(require.main===module){assert(commands[process.argv[2]],'Usage: smoke|apply|indexes|capture-after');commands[process.argv[2]]()}
module.exports={buildRollback,indexStatements,validationStatements,originalGuard,checksSQL}
