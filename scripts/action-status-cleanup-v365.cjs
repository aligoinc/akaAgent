// Data-only correction. Existing linked Management API; no RPC/DDL/pool changes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const m = require('./action-status-policy-migration.cjs')
const dir = path.join(m.root, 'migrations/snapshots/action-status-cleanup-v365')
const name = 'migration_v365_remove_unsupported_post_visible_status'
const sqlPath = path.join(m.root, 'migrations', name + '.sql')
const rollbackPath = path.join(m.root, 'migrations/tests', name + '_rollback.sql')
const read = n => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'))
const save = (n, value) => fs.writeFileSync(path.join(dir, n), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
const before = read('before.json')
assert.equal(m.hash(fs.readFileSync(path.join(dir, 'before.json'))), read('backup-manifest.json').before_sha256)
m.validateSnapshot(before)
const owned = before.tables.auto_status.rows.find(x => x.row.id === 53)
assert.equal(owned.row.code, 'campaign_detail_post_visible')
const original = JSON.parse(fs.readFileSync(path.join(m.root, 'migrations/snapshots/action-status-policies-v361/inserted-rows.json'))).auto_status.find(x => x.row.id === 53)
assert.equal(owned.md5, original.md5, 'Owned status was edited; reconcile first')
const schema = before.schema.find(s => s.table === 'auto_status')
const exactSchema = read('schema-exact.json')
assert.equal(m.hash(exactSchema.canonical, 'md5'), exactSchema.md5)
assert.deepEqual(JSON.parse(exactSchema.canonical), schema)
const start = "BEGIN;\nSET LOCAL lock_timeout='1s';\nSET LOCAL statement_timeout='2s';\nSET LOCAL enable_seqscan=off;\nSET LOCAL jit=off;\n"
// Compare DB-canonical JSON: sequence max_value exceeds JavaScript safe integers.
// Keep the applied migration's guard immutable. Rollback compares structure,
// excluding only the sequence position, directly in PostgreSQL JSONB so bigint
// metadata is never rounded through JavaScript.
const guardSchema = `IF md5((${m.schemaSQL('auto_status')})::text) IS DISTINCT FROM '${exactSchema.md5}' THEN RAISE EXCEPTION 'auto_status schema drift'; END IF;`
const rollbackSchemaGuard = `IF (${m.schemaSQL('auto_status')} #- '{sequence,last_value}') IS DISTINCT FROM (${m.quote(exactSchema.canonical)}::jsonb #- '{sequence,last_value}') THEN RAISE EXCEPTION 'auto_status schema drift'; END IF;`
const restoreBody = `DO $restore_guard$ BEGIN
 ${rollbackSchemaGuard}
 IF EXISTS(SELECT 1 FROM public.auto_status WHERE id=53 OR code='campaign_detail_post_visible' OR (component_type='campaign_detail' AND status_value='đã hiển thị bài')) THEN RAISE EXCEPTION 'Status identity already exists; do not overwrite'; END IF;
END $restore_guard$;
INSERT INTO public.auto_status SELECT * FROM jsonb_populate_record(NULL::public.auto_status, ${m.jsonSQL(owned.row, 'removed_row')});
DO $restored$ BEGIN IF (SELECT md5(to_jsonb(s)::text) FROM public.auto_status s WHERE id=53) IS DISTINCT FROM '${owned.md5}' THEN RAISE EXCEPTION 'Restore checksum mismatch'; END IF; END $restored$;
`
function build() {
 const sql = `${start}-- Block array-filter edits briefly; FK references serialize on the status row lock.
LOCK TABLE public.auto_automation_trigger_statuses IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$ BEGIN
 ${guardSchema}
 IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='${name}') THEN RAISE EXCEPTION 'Migration already applied'; END IF;
 PERFORM id FROM public.auto_status WHERE id=53 FOR UPDATE;
 IF (SELECT md5(to_jsonb(s)::text) FROM public.auto_status s WHERE id=53) IS DISTINCT FROM '${owned.md5}' THEN RAISE EXCEPTION 'Status identity/checksum changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE status_id=53)
 OR EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE sub_status_id=53)
 OR EXISTS(SELECT 1 FROM public.auto_account_action_status_policies WHERE status_id=53)
 OR EXISTS(SELECT 1 FROM public.auto_error WHERE detail_status_id=53 OR detail_status='đã hiển thị bài')
 OR EXISTS(SELECT 1 FROM public.auto_campaign_action_detail_statuses WHERE status_id=53 OR status_value='đã hiển thị bài')
 OR EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE 53=ANY(sub_status_ids) OR status_value='đã hiển thị bài')
 THEN RAISE EXCEPTION 'Status has references; preserve historical data'; END IF;
 IF EXISTS(SELECT 1 FROM public.auto_blocks b WHERE to_jsonb(b)::text ~ '(campaign_detail_post_visible|postVisible)')
 OR EXISTS(SELECT 1 FROM public.auto_workflows w WHERE to_jsonb(w)::text ~ '(campaign_detail_post_visible|postVisible)')
 THEN RAISE EXCEPTION 'Live producer/config changed; reconcile first'; END IF;
END $preflight$;
DELETE FROM public.auto_status WHERE id=53 AND code='campaign_detail_post_visible' AND md5(to_jsonb(auto_status)::text)='${owned.md5}';
DO $verify$ BEGIN IF EXISTS(SELECT 1 FROM public.auto_status WHERE id=53 OR code='campaign_detail_post_visible') THEN RAISE EXCEPTION 'Status deletion failed'; END IF; END $verify$;
COMMIT;
`
 fs.writeFileSync(sqlPath, sql, { flag: 'wx' })
 fs.writeFileSync(rollbackPath, rollbackSQL(), { flag: 'wx' })
 save('prepared-manifest.json', { project_ref:m.ref, name, before_sha256:read('backup-manifest.json').before_sha256,
   sql_sha256:m.hash(sql), rollback_sha256:m.hash(fs.readFileSync(rollbackPath)), removed:[{id:53,code:owned.row.code,md5:owned.md5}] })
}
function checkedSQL() {
 const sql=fs.readFileSync(sqlPath,'utf8'), manifest=read('prepared-manifest.json')
 assert.equal(m.hash(sql),manifest.sql_sha256)
 if (fs.existsSync(path.join(dir, 'rollback-sequence-repair.json'))) {
  const repair=read('rollback-sequence-repair.json')
  assert.equal(repair.sql_sha256,manifest.sql_sha256)
  assert.equal(repair.previous_rollback_sha256,manifest.rollback_sha256)
  assert.equal(m.hash(fs.readFileSync(path.join(dir,repair.previous_rollback_file))),manifest.rollback_sha256)
  assert.equal(m.hash(fs.readFileSync(rollbackPath)),repair.rollback_sha256)
 } else assert.equal(m.hash(fs.readFileSync(rollbackPath)),manifest.rollback_sha256)
 return sql
}
function rollbackSQL() {
 return '-- Explicit rollback only; restores exactly one deleted catalog row, never sequence/history.\n' + start + restoreBody + 'COMMIT;\n'
}
function repairRollback() {
 const sql=checkedSQL(), next=rollbackSQL()
 assert.equal(read('apply.json').sql_sha256,m.hash(sql), 'Applied migration must stay unchanged')
 if (fs.existsSync(path.join(dir, 'rollback-sequence-repair.json'))) {
  assert.equal(fs.readFileSync(rollbackPath,'utf8'),next, 'Rollback generator drift')
  console.log('Rollback sequence repair already verified')
  return
 }
 const previous=fs.readFileSync(rollbackPath), previousFile='rollback-before-sequence-position-fix.sql'
 fs.writeFileSync(path.join(dir,previousFile),previous,{flag:'wx'})
 const receipt={at:new Date().toISOString(),project_ref:m.ref,sql_sha256:m.hash(sql),
  previous_rollback_file:previousFile,previous_rollback_sha256:m.hash(previous),rollback_sha256:m.hash(next),
  ignored_schema_state:['sequence.last_value'],applied_migration_changed:false,production_write:false}
 // Keep the original manifest and previous SQL as immutable apply-time evidence.
 save('rollback-sequence-repair.json',receipt)
 fs.writeFileSync(rollbackPath,next)
 checkedSQL()
 console.log('Rollback guard repaired; applied migration and original receipts unchanged')
}
function smoke() {
 const sql=checkedSQL().replace(/COMMIT;\s*$/, '')
 const result=m.query(sql + restoreBody + `SELECT clock_timestamp() AS checked_at, md5(coalesce(string_agg(to_jsonb(s)::text,'|' ORDER BY to_jsonb(s)->>'id',to_jsonb(s)->>'code'),'')) AS restored_md5 FROM public.auto_status s; ROLLBACK;`)[0]
 assert.equal(result.restored_md5,before.tables.auto_status.md5)
 save('smoke.json',{...result,delete_and_restore_rolled_back:true,sql_sha256:m.hash(checkedSQL()),external_operations:0})
 console.log('Delete/restore transaction rolled back; complete auto_status checksum matches backup')
}
function apply() {
 const sql=checkedSQL();assert.equal(read('smoke.json').sql_sha256,m.hash(sql))
 const version=new Date().toISOString().replace(/\D/g,'').slice(0,14)
 const insert=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('${version}','${name}',ARRAY[${m.quote(sql)}]);\nSELECT clock_timestamp() AS applied_at;\nCOMMIT;`
 const result=m.query(sql.replace(/COMMIT;\s*$/,insert))[0]
 save('apply.json',{...result,version,name,project_ref:m.ref,sql_sha256:m.hash(sql)})
 console.log({version,name,...result})
}
function verify() {
 const after=m.snapshot();m.validateSnapshot(after)
 assert(!after.tables.auto_status.rows.some(x=>x.row.id===53 || x.row.code===owned.row.code))
 assert.equal(after.tables.auto_status.count,before.tables.auto_status.count-1)
 const kept=structuredClone(before);kept.tables.auto_status.rows=kept.tables.auto_status.rows.filter(x=>x.row.id!==53)
 const independent=m.originalRowsUnchanged(kept,after)
 assert.deepEqual(after.schema.find(s=>s.table==='auto_status'),schema)
 const functions=new Map(after.functions.map(f=>[f.signature,f.md5]));for(const f of before.functions)assert.equal(functions.get(f.signature),f.md5)
 save('after.json',after)
 save('verified.json',{checked_at:after.captured_at,project_ref:m.ref,removed_id:53,status_count:after.tables.auto_status.count,
   other_config_values_unchanged:true,independent_mapping_timestamps:independent,functions_unchanged:true,
   after_sha256:m.hash(fs.readFileSync(path.join(dir,'after.json')))})
 console.log({removed:53,other_config_unchanged:true,functions_unchanged:true,status_count:after.tables.auto_status.count})
}
module.exports={rollbackSQL,checkedSQL,dir}
if (require.main===module) {
 const commands={build,smoke,apply,verify,'repair-rollback':repairRollback}
 assert(commands[process.argv[2]], 'Use build|smoke|apply|verify|repair-rollback')
 commands[process.argv[2]]()
}
