const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const m=require('./action-status-policy-migration.cjs')
const directory=path.join(m.root,'migrations/snapshots/action-status-policies-v362')
const before=JSON.parse(fs.readFileSync(path.join(directory,'before.json'),'utf8'))
const fixture=JSON.parse(fs.readFileSync(path.join(directory,'automation-fixture-source.json'),'utf8'))
const changes=JSON.parse(fs.readFileSync(path.join(directory,'changes.json'),'utf8'))
const source=fs.readFileSync(path.join(m.root,'migrations/migration_v362_action_status_readers.sql'),'utf8')
const q=(value,type)=>value==null?`NULL::${type}`:`${m.quote(value)}::${type}`
function saveCall(a,statuses) {
  const fields={staff_id:'bigint',organization_id:'bigint',automation_id:'bigint',name:'text',source_campaign_id:'bigint',target_campaign_id:'bigint',data_type_code:'text',target_contact_group_id:'bigint',target_data_group_id:'bigint',schedule_mode:'text',delay_days:'integer',delay_hours:'integer',fixed_at:'timestamptz',note:'text',is_active:'boolean',data_type_category_item_id:'bigint',delay_value:'integer',delay_unit:'text',daily_time:'time',delay_exact_time:'time'}
  const args=Object.entries(fields).map(([key,type])=>`p_${key}=>${q(key==='automation_id'?a.id:key==='is_active'?false:a[key],type)}`)
  args.push(`p_trigger_statuses=>${m.jsonSQL(statuses,'test_statuses')}`,"p_auth_username=>NULL::text","p_auth_password=>NULL::text","p_delay_exact_time_present=>true")
  return `public.aka_agent_save_automation(${args.join(',')})`
}
const scenarios=[]
for(const grouped of [false,true]) {
  const a=fixture.automations.find(a=>!a.is_delete&&(a.target_campaign_id==null)===grouped)
  assert(a,'Missing automation smoke fixture')
  const old=before.tables.auto_automation_trigger_statuses.rows.filter(x=>x.row.automation_id===a.id).map(x=>({statusMappingId:x.row.status_mapping_id,actionCode:x.row.action_code,statusValue:x.row.status_value}))
  assert(old.length)
  const explicit=old.map((x,i)=>i===0?{...x,subStatusIds:[52]}:x)
  const clear=old.map((x,i)=>i===0?{...x,subStatusIds:null}:x)
  const invalid=old.map((x,i)=>i===0?{...x,subStatusIds:[]}:x)
  const invalidId=old.map((x,i)=>i===0?{...x,subStatusIds:[1]}:x)
  const guard=`automation_id=${a.id} AND status_mapping_id=${old[0].statusMappingId}`
  scenarios.push(`DO $test$ DECLARE rejected boolean; saved jsonb; BEGIN
  saved:=${saveCall(a,explicit)};
  IF NOT EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE ${guard} AND sub_status_ids=ARRAY[52::bigint]) THEN RAISE EXCEPTION 'reader smoke: explicit filter lost'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(saved->'trigger_statuses') t WHERE (t->>'status_mapping_id')::bigint=${old[0].statusMappingId} AND t->'sub_status_ids'='[52]'::jsonb) THEN RAISE EXCEPTION 'reader smoke: filter missing in response'; END IF;
  PERFORM ${saveCall(a,old)};
  IF NOT EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE ${guard} AND sub_status_ids=ARRAY[52::bigint]) THEN RAISE EXCEPTION 'reader smoke: legacy save cleared filter'; END IF;
  rejected:=false; BEGIN PERFORM ${saveCall(a,invalid)}; EXCEPTION WHEN OTHERS THEN IF SQLERRM='invalid_automation_sub_status_ids' THEN rejected:=true; ELSE RAISE; END IF; END;
  IF NOT rejected THEN RAISE EXCEPTION 'reader smoke: empty filter accepted'; END IF;
  rejected:=false; BEGIN PERFORM ${saveCall(a,invalidId)}; EXCEPTION WHEN OTHERS THEN IF SQLERRM='result_status_component_invalid' THEN rejected:=true; ELSE RAISE; END IF; END;
  IF NOT rejected THEN RAISE EXCEPTION 'reader smoke: invalid status component accepted'; END IF;
  PERFORM ${saveCall(a,clear)};
  IF NOT EXISTS(SELECT 1 FROM public.auto_automation_trigger_statuses WHERE ${guard} AND sub_status_ids IS NULL) THEN RAISE EXCEPTION 'reader smoke: explicit clear failed'; END IF;
  END $test$;`)
}
const functionReceipt=`SELECT clock_timestamp()-transaction_timestamp() AS database_duration,
  (SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'md5',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'settings',p.proconfig,'acl',p.proacl)) FROM pg_proc p WHERE p.oid IN (${changes.map(f=>'to_regprocedure('+m.quote('public.'+f.signature)+')').join(',')})) AS functions;`
const mode=process.argv[2]||'definition'
assert(['definition','behavior','events'].includes(mode))
const testBody=mode==='behavior'?scenarios.join('\n'):mode==='events'?require('./action-status-event-smoke-sql.cjs')(m,before,fixture,directory):''
const checks=mode==='behavior'?12:mode==='events'?30:changes.length
const tests=testBody?`SAVEPOINT behavior_tests;SET LOCAL ROLE service_role;SELECT set_config('request.jwt.claim.role','service_role',true);${testBody}RESET ROLE;ROLLBACK TO behavior_tests;`:''
const executedSource=process.argv.includes('--applied') ? "BEGIN;SET LOCAL lock_timeout='3s';SET LOCAL statement_timeout='30s';COMMIT;" : source
const result=m.query(executedSource.replace(/COMMIT;\s*$/,()=>`${tests}\n${functionReceipt}\nROLLBACK;`))[0]
assert.equal(result.functions.length,changes.length)
for(const f of result.functions) {
  const old=changes.find(c=>c.signature===f.signature)
  for(const key of ['owner','security_definer','volatility','settings','acl']) assert.deepEqual(f[key],old[key],`${f.signature}/${key}`)
}
fs.writeFileSync(path.join(directory,mode+(process.argv.includes('--applied')?'-post-apply':'')+'-smoke.json'),JSON.stringify({at:new Date().toISOString(),project_ref:m.ref,migration_sha256:m.hash(source),mode,checks,...result},null,2)+'\n')
console.log(JSON.stringify({functions:result.functions.length,mode,checks,duration:result.database_duration,rolled_back:true}))
