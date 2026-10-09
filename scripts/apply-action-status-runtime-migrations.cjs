const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const m=require('./action-status-policy-migration.cjs');
const version=Number(process.argv[2]),mode=process.argv[3];assert([362,363].includes(version));assert(['prepare','apply','verify','rollback-sql'].includes(mode));
const dir=path.join(m.root,`migrations/snapshots/action-status-policies-v${version}`);
const name=`migration_v${version}_action_status_${version===362?'readers':'writer'}`;
const file=path.join(m.root,'migrations',name+'.sql'),sql=fs.readFileSync(file,'utf8');
const read=f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
const write=(f,v)=>fs.writeFileSync(path.join(dir,f),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const smoke=read(version===362?'definition-smoke.json':'live-writer-smoke.json');
assert.equal(smoke.migration_sha256,m.hash(sql),'Definition smoke must match exact SQL');
for(const f of version===362?['behavior-smoke.json','events-smoke.json']:['local-writer-smoke.json'])assert.equal(read(f).migration_sha256,m.hash(sql),`Stale ${f}`);
const targets=smoke.functions;
const rollbackFile=path.join(m.root,'migrations/tests',name+'_rollback.sql');
function functionGuards() {return targets.map(f=>`IF to_regprocedure(${m.quote('public.'+f.signature)}) IS NULL OR md5(pg_get_functiondef(to_regprocedure(${m.quote('public.'+f.signature)})))<>${m.quote(f.md5)} THEN RAISE EXCEPTION '${name} target drift: ${f.signature}'; END IF;`).join('\n');}
function makeRollback(after) {
 let restore='';
 if(version===362) {
  const changes=read('changes.json');restore=changes.map(f=>{assert(f.source && m.hash(f.source,'md5')===f.md5);return f.source+';'}).join('\n');
  const before=read('before.json');
  if (!before.schema.find(s=>s.table==='auto_status').grants.some(g=>g.grantee==='aka_agent_chat_api' && g.privilege_type==='SELECT')) restore+='\nREVOKE SELECT ON public.auto_status FROM aka_agent_chat_api;';
  restore+='\n'+before.schema.find(s=>s.table==='auto_campaign_details').triggers.filter(t=>/aka_agent_enqueue_campaign_detail_automations\(\)|aka_agent_enqueue_group_only_automations\(\)/.test(t.definition)).map(t=>t.definition.replace(/^CREATE TRIGGER/,'CREATE OR REPLACE TRIGGER')+';').join('\n');
 } else {
  if(!after)return "DO $$ BEGIN RAISE EXCEPTION 'v363 rollback requires verified after.json ownership'; END $$;\n";
  const before=read('before-apply.json').tables.auto_account_action_status_policies.rows;
  const changed=after.tables.auto_account_action_status_policies.rows.filter(r=>!before.some(b=>b.row.id===r.row.id&&b.md5===r.md5));
  assert.equal(changed.length,3);
  restore='DO $rows$ BEGIN\n'+changed.map(r=>`IF NOT EXISTS(SELECT 1 FROM public.auto_account_action_status_policies p WHERE p.id=${r.row.id} AND md5(to_jsonb(p)::text)=${m.quote(r.md5)}) THEN RAISE EXCEPTION 'v363 owned row edited: ${r.row.id}'; END IF;`).join('\n')+'\nEND $rows$;\n';
  restore+='DROP TRIGGER auto_aasp_identity_guard ON public.auto_account_action_status_policies;\nDROP TRIGGER auto_detail_action_identity_guard ON public.auto_campaign_details;\n';
  restore+=targets.map(f=>`DROP FUNCTION public.${f.signature};`).join('\n')+'\n';
  for(const r of changed) {
   const old=before.find(b=>b.row.id===r.row.id);
   if(old)restore+=`UPDATE public.auto_account_action_status_policies p SET ${Object.keys(old.row).filter(k=>k!=='id').map(k=>`${k}=original.${k}`).join(',')} FROM jsonb_populate_record(NULL::public.auto_account_action_status_policies,${m.jsonSQL(old.row,'original_policy')}) original WHERE p.id=${r.row.id};\n`;
   else restore+=`DELETE FROM public.auto_account_action_status_policies WHERE id=${r.row.id};\n`;
  }
  if(!fs.existsSync(path.join(dir,'owned-rows.json')))write('owned-rows.json',changed.map(r=>({before:before.find(b=>b.row.id===r.row.id)??null,after:r})));
 }
 const changedTriggers=(after??read('before-apply.json')).schema.flatMap(s=>(s.triggers??[]).filter(t=>version===362?/aka_agent_enqueue_campaign_detail_automations\(\)|aka_agent_enqueue_group_only_automations\(\)/.test(t.definition):['auto_aasp_identity_guard','auto_detail_action_identity_guard'].includes(t.name)).map(t=>({table:s.table,...t})));
 const guardTriggers=after?changedTriggers.map(t=>`IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.${t.table}'::regclass AND tgname=${m.quote(t.name)}) IS DISTINCT FROM ${m.quote(t.definition)} THEN RAISE EXCEPTION 'rollback trigger drift: ${t.name}'; END IF;`).join('\n'):'';
 return `-- Retain this file and the apply/rollback history. No historical recalculation.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='2s';
-- An empty new-column partial index must not fall back to a historical heap scan.
SET LOCAL enable_seqscan=off;
LOCK TABLE public.auto_account_action_status_policies IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.auto_campaign_details IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $guard$ BEGIN
${functionGuards()}
${guardTriggers}
IF EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE status_id IS NOT NULL) OR EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE result_key IS NOT NULL) THEN RAISE EXCEPTION 'result catalog already used; retain readers/schema and rollback future runtime only'; END IF;
END $guard$;
${restore}
COMMIT;\n`;
}
function verify(after) {
 for(const f of targets){const live=after.functions.find(x=>x.signature===f.signature);assert(live,f.signature);for(const k of ['md5','owner','security_definer','volatility','settings','acl'])assert.deepEqual(live[k],f[k],`${f.signature}/${k}`);}
 const before=read('before-apply.json');
 for(const table of ['auto_error','auto_status','auto_account_actions'])assert.equal(after.tables[table].md5,before.tables[table].md5,`${table} changed`);
 const changedNames=new Set(targets.map(f=>f.signature));
 for(const f of before.functions.filter(f=>!changedNames.has(f.signature)))assert.equal(after.functions.find(x=>x.signature===f.signature)?.md5,f.md5,`Unrelated function changed: ${f.signature}`);
}
if(mode==='prepare') {
 assert(!fs.existsSync(path.join(dir,'apply.json')),'Already applied');
 if(!fs.existsSync(path.join(dir,'before-apply.json'))){const before=m.snapshot();m.validateSnapshot(before);write('before-apply.json',before);write('before-apply-manifest.json',{project_ref:m.ref,sha256:m.hash(fs.readFileSync(path.join(dir,'before-apply.json'))),migration_sha256:m.hash(sql)});}
 const before=read('before-apply.json');m.validateSnapshot(before);assert.equal(m.hash(fs.readFileSync(path.join(dir,'before-apply.json'))),read('before-apply-manifest.json').sha256);
 fs.writeFileSync(rollbackFile,makeRollback(null));console.log(JSON.stringify({version,backup_verified:true,apply:false}));
} else if(mode==='apply') {
 assert(!fs.existsSync(path.join(dir,'apply.json')),'Apply receipt exists; never repeat');
 const manifest=read('before-apply-manifest.json');assert.equal(manifest.migration_sha256,m.hash(sql));assert.equal(manifest.sha256,m.hash(fs.readFileSync(path.join(dir,'before-apply.json'))));m.validateSnapshot(read('before-apply.json'));assert(fs.existsSync(rollbackFile));
 const history=new Date().toISOString().replace(/\D/g,'').slice(0,14);
 const result=m.query(sql.replace(/COMMIT;\s*$/,()=>`DO $$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE name=${m.quote(name)}) THEN RAISE EXCEPTION 'migration already recorded'; END IF; END $$;
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${m.quote(history)},${m.quote(name)},ARRAY[${m.quote(sql)}]); SELECT true applied; COMMIT;`));assert.equal(result[0].applied,true);
 write('apply.json',{at:new Date().toISOString(),project_ref:m.ref,name,history_version:history,migration_sha256:m.hash(sql)});
 const after=m.snapshot();m.validateSnapshot(after);write('after.json',after);verify(after);
 fs.writeFileSync(rollbackFile,makeRollback(after));write('after-manifest.json',{at:new Date().toISOString(),sha256:m.hash(fs.readFileSync(path.join(dir,'after.json'))),rollback_sha256:m.hash(fs.readFileSync(rollbackFile)),verified:true});
 console.log(JSON.stringify({version,applied:true,history,functions:targets.length,verified:true}));
} else if(mode==='rollback-sql') {
 const manifest=read('after-manifest.json');assert.equal(manifest.sha256,m.hash(fs.readFileSync(path.join(dir,'after.json'))));
 const previous=fs.readFileSync(rollbackFile,'utf8');fs.writeFileSync(path.join(dir,'rollback-before-repair-'+Date.now()+'.sql'),previous,{flag:'wx'});write('after-manifest-before-repair-'+Date.now()+'.json',manifest);
 fs.writeFileSync(rollbackFile,makeRollback(read('after.json')));fs.writeFileSync(path.join(dir,'after-manifest.json'),JSON.stringify({...manifest,rollback_sha256:m.hash(fs.readFileSync(rollbackFile)),rollback_repaired_at:new Date().toISOString()},null,2)+'\n');
 console.log(JSON.stringify({version,rollback_sql_updated:true}));
} else {
 const after=m.snapshot();m.validateSnapshot(after);verify(after);console.log(JSON.stringify({version,verified:true,functions:targets.length}));
}
