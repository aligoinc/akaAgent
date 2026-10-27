// Disposable PostgreSQL17 with captured definitions/ACLs and synthetic rows.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {createFixture}=require('../full-fixture.cjs')
const f=createFixture(),{sql,quote:q,root}=f
const dir=path.join(root,'migrations/snapshots/desktop-cutover-v435')
const read=n=>JSON.parse(fs.readFileSync(path.join(['before.json','guard.json'].includes(n)?(process.env.V435_EVIDENCE_DIR||dir):dir,n)))
const m=read('before.json'),plan=read('plan.json'),id=s=>'"'+s.replaceAll('"','""')+'"'
const obj=r=>id(r.schema)+'.'+id(r.name)
const sig=f=>f.signature.startsWith('private.')||f.signature.startsWith('aka_agent_desktop_internal.')?f.signature:'public.'+f.signature
const runAs=(role,query)=>sql(`BEGIN; SET LOCAL ROLE ${id(role)}; ${query}; ROLLBACK;`)
let checks=0
const pass=s=>{checks++;console.log('PASS',s)}
const perms={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',U:'USAGE',X:'EXECUTE'}
try{
 const existing=new Set(JSON.parse(sql('SELECT jsonb_agg(rolname) FROM pg_roles')))
 for(const r of m.roles)if(!existing.has(r.name))sql(`CREATE ROLE ${id(r.name)} ${r.bypassrls?'BYPASSRLS':''} ${r.inherit?'INHERIT':'NOINHERIT'};`)
 sql('CREATE SCHEMA aka_agent_desktop_internal; CREATE DOMAIN public.vector AS text; CREATE DOMAIN extensions.vector AS text;')
 // Add current identity tables/rowtypes missing in the historical schema fixture.
 for(const r of m.relations.filter(r=>['r','p'].includes(r.kind))){
  if(sql(`SELECT to_regclass(${q(r.schema+'.'+r.name)}) IS NOT NULL`)==='t')continue
  sql(`CREATE TABLE ${obj(r)} (${r.columns.map(c=>id(c.name)+' '+c.type).join(',')});`)
 }
 for(const r of m.relations.filter(r=>r.kind==='S'))if(sql(`SELECT to_regclass(${q(r.schema+'.'+r.name)}) IS NOT NULL`)!=='t')sql(`CREATE SEQUENCE ${obj(r)};`)
 const definitions=m.functions.filter(x=>!x.extension)
 sql('SET check_function_bodies=off;\n'+definitions.map(x=>x.definition+';').join('\n'))
 for(const r of m.relations.filter(r=>r.kind==='v'))sql(`CREATE OR REPLACE VIEW ${obj(r)}${r.options?.length?' WITH ('+r.options.join(',')+')':''} AS ${r.view}`)
 const allRoles=['PUBLIC',...m.roles.map(r=>id(r.name))].join(',')
 const acl=[]
 function restore(kind,object,value,owner,column){
  acl.push(`REVOKE ALL PRIVILEGES${column?' ('+id(column)+')':''} ON ${kind} ${object} FROM ${allRoles};`)
  const entries=value===null?(kind==='FUNCTION'?['=X/'+owner,owner+'=X/'+owner]:[]):value.slice(1,-1).split(',').filter(Boolean)
  for(const e of entries){const [who,rest]=e.split('='),pv=rest.split('/')[0];
   const plain=[...pv].filter(c=>c!=='*').map(c=>perms[c]+(column?' ('+id(column)+')':''))
   if(plain.length)acl.push(`GRANT ${plain.join(',')} ON ${kind} ${object} TO ${who?id(who):'PUBLIC'}${pv.includes('*')?' WITH GRANT OPTION':''};`)
  }
 }
 for(const r of m.relations){
  if(!['r','p','v','S'].includes(r.kind))continue
  restore(r.kind==='S'?'SEQUENCE':'TABLE',obj(r),r.acl,r.owner)
  if(['r','p'].includes(r.kind))acl.push(`ALTER TABLE ${obj(r)} ${r.rls?'ENABLE':'DISABLE'} ROW LEVEL SECURITY;`)
  for(const c of r.columns)if(c.acl)restore('TABLE',obj(r),c.acl,r.owner,c.name)
 }
 for(const fn of definitions)restore('FUNCTION',sig(fn),fn.acl,fn.owner)
 sql(acl.join('\n'))
 sql(`GRANT USAGE ON SCHEMA public,private,aka_agent_desktop_internal TO ${m.roles.map(r=>id(r.name)).join(',')};`)
 const existingPolicies=JSON.parse(sql('SELECT coalesce(jsonb_agg(to_jsonb(p)),\'[]\') FROM pg_policies p'))
 sql(existingPolicies.map(p=>`DROP POLICY ${id(p.policyname)} ON ${id(p.schemaname)}.${id(p.tablename)};`).join('\n'))
 sql(m.policies.map(p=>`CREATE POLICY ${id(p.policyname)} ON ${id(p.schemaname)}.${id(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(x=>x==='public'?'PUBLIC':id(x)).join(',')}${p.qual?' USING ('+p.qual+')':''}${p.with_check?' WITH CHECK ('+p.with_check+')':''};`).join('\n'))
 // Required current defaults; no production rows are copied.
 sql(`INSERT INTO org_organization(id,name,use_staff_expiration) VALUES(10,'Fixture org',false);
 INSERT INTO org_staff(id,organization_id,username,password,is_active,is_policy_accepted,is_admin) VALUES(1,10,'alice','fixture-only',true,true,false);
 INSERT INTO auto_accounts(id,staff_id,organization_id,name) VALUES(1,1,10,'Fixture account');
 INSERT INTO auto_campaigns(id,staff_id,organization_id,account_id,name,status) VALUES(1,1,10,1,'Fixture campaign','chờ xử lý');
 INSERT INTO ai_model(id,code,model,api_key,is_active) VALUES(1,'fixture','fixture-model','fixture-not-a-key',true);
 INSERT INTO auto_system_settings(id,key,value,is_active,is_secret) VALUES(990001,'desktop.updates.startup_prompt_max_version',NULL,true,false),(990002,'fixture.other','hidden',true,false),(990003,'fixture.secret','hidden',true,true);
 INSERT INTO category_type(id,namespace,code,name,managed_by,is_active) VALUES(100,'common','data_type','Data type','system',true);
 INSERT INTO category_item(id,category_type_id,code,name,sort_order,is_active,managed_by) VALUES(2001,100,'phone','Số điện thoại',1,true,'system');`)
 const sourceQueries=[
 "SELECT name FROM auto_accounts WHERE id=1",
 "UPDATE auto_accounts SET name='changed' WHERE id=1 RETURNING name",
 "UPDATE auto_campaigns SET status='tạm dừng' WHERE id=1 RETURNING status",
 "SELECT id,organization_id FROM aka_agent_staff_runtime_profile WHERE id=1",
 "SELECT id,code,model FROM ai_model WHERE id=1",
 "SELECT aka_agent_block_denied_ip_request()",
 "SELECT i.name FROM category_item i JOIN category_type t ON t.id=i.category_type_id WHERE t.namespace='common'"
 ]
 const before=sourceQueries.map(x=>runAs('aka_agent_desktop',x))
 const oldUpdate="SELECT value FROM auto_system_settings WHERE key='desktop.updates.startup_prompt_max_version' AND is_active=true AND is_secret=false"
 const updaterBefore=runAs('anon',oldUpdate)
 const startupBefore=runAs('anon','SELECT aka_agent_desktop_startup_policy()')
 const staffBefore=runAs('anon',"SELECT aka_agent_staff_client('alice','fixture-only','read','{}')")
 const guardQuery=fs.readFileSync(path.join(__dirname,'guard.sql'),'utf8')
 const localGuard=JSON.parse(sql(guardQuery)),guard=read('guard.json')
 let migration=fs.readFileSync(path.join(root,'migrations/migration_v435_desktop_permission_cutover.sql'),'utf8')
 const liveDigest=read('guard-digest.json').digest
 const localDigest=sql(`SELECT md5((${guardQuery.trim().replace(/;$/,'')})::text)`)
 migration=migration.replace(q(liveDigest),q(localDigest))
 const body=migration.replace(/^BEGIN;\n/m,'').replace(/^COMMIT;\n/m,'')
 assert.throws(()=>sql(`BEGIN; GRANT UPDATE ON org_staff TO aka_agent_desktop; ${body} ROLLBACK;`),/metadata drift/)
 pass('fresh metadata guard rejects ACL drift')
 sql(migration)
 assert.deepEqual(sourceQueries.map(x=>runAs('aka_agent_desktop',x)),before)
 assert.equal(runAs('anon',oldUpdate),updaterBefore)
 assert.equal(runAs('anon','SELECT aka_agent_desktop_startup_policy()'),startupBefore)
 assert.equal(runAs('anon',"SELECT aka_agent_staff_client('alice','fixture-only','read','{}')"),staffBefore)
 assert.equal(runAs('anon','SELECT count(*) FROM auto_system_settings'),'1')
 assert.equal(runAs('anon',"SELECT count(*) FROM auto_system_settings WHERE key='fixture.other'"),'0')
 pass('old updater sees exactly one public setting; bootstrap staff RPC unchanged')
 pass('Desktop account/campaign write, runtime profile, category join, AI metadata and hook are unchanged')
 for(const role of ['anon','authenticated'])for(const query of ['SELECT * FROM org_staff','SELECT * FROM auto_accounts','SELECT api_key FROM ai_model',"UPDATE org_staff SET organization_id=1 WHERE id=1","UPDATE auto_campaigns SET status='đang chạy' WHERE id=1",'SELECT aka_agent_get_vault_secret(\'fixture\')',"SELECT nextval('auto_accounts_id_seq')"]){assert.throws(()=>runAs(role,query),/permission denied/)}
 pass('legacy roles cannot read/write protected data, call Vault helper, or advance ID sequences')
 for(const query of ['SELECT api_key FROM ai_model','SELECT * FROM ai_model','SELECT password FROM org_staff','UPDATE org_staff SET organization_id=11 WHERE id=1','UPDATE org_organization SET name=\'bad\' WHERE id=10'])assert.throws(()=>runAs('aka_agent_desktop',query),/permission denied/)
 pass('Desktop cannot read AI key, read staff password, or edit organization/staff directly')
 for(const role of ['service_role','aka_agent_chat_api','crm_interest_worker'])assert.equal(runAs(role,"SELECT api_key FROM ai_model WHERE id=1"),'fixture-not-a-key')
 pass('trusted backend reads remain available; atomic migration asserts all other effective grants unchanged')
 const after=JSON.parse(sql(fs.readFileSync(path.join(__dirname,'capture.sql'),'utf8')))
 const fnStable=x=>x.functions.map(f=>[f.signature,f.checksum,f.owner,f.security_definer,f.volatility,f.config])
 assert.deepEqual(fnStable(after),fnStable(localGuard))
 for(const r of after.relations.filter(r=>plan.new_rls.includes(r.schema+'.'+r.name)))assert.equal(r.rls,true)
 pass('all RPC bodies/owners/config preserved and all 47 target tables now have RLS')
 const rollbackDigest=sql(`SELECT md5((${guardQuery.trim().replace(/;$/,'')})::text)`)
 let rollback=fs.readFileSync(path.join(root,'migrations/rollback_v435_desktop_permission_cutover.sql'),'utf8').replace('_V435_APPLIED_METADATA_DIGEST_',rollbackDigest).replace(read('verification.json').post_apply_catalog_digest,rollbackDigest)
 assert.throws(()=>sql(rollback),/separate explicit authorization/)
 sql("SET aka_agent.v435_rollback='approved-reopen-legacy-access';\n"+rollback)
 assert.equal(runAs('anon',"SELECT password FROM org_staff WHERE id=1"),'fixture-only')
 assert.equal(runAs('aka_agent_desktop',"SELECT api_key FROM ai_model WHERE id=1"),'fixture-not-a-key')
 assert.deepEqual(sourceQueries.map(x=>runAs('aka_agent_desktop',x)),before)
 const rolledBack=JSON.parse(sql(fs.readFileSync(path.join(__dirname,'capture.sql'),'utf8')))
 assert.deepEqual(fnStable(rolledBack),fnStable(localGuard))
 for(const r of rolledBack.relations.filter(r=>plan.new_rls.includes(r.schema+'.'+r.name)))assert.equal(r.rls,false)
 pass('recovery requires explicit gate and restores legacy ACL/RLS without changing functions')
 fs.writeFileSync(path.join(dir,'local-test.json'),JSON.stringify({checks,status:'passed',fixture:'captured definitions + synthetic rows; no production data',at:new Date().toISOString()},null,2)+'\n')
 console.log(JSON.stringify({checks,status:'passed'}))
}finally{f.close()}
