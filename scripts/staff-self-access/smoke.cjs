// Disposable PostgreSQL17 with captured definitions/ACLs and synthetic rows.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {createFixture}=require('../desktop-session-rls/full-fixture.cjs')
const {privateSecurityAsset}=require('../desktop-session-rls/private-security-assets.cjs')
const m=JSON.parse(fs.readFileSync(privateSecurityAsset('migrations/snapshots/staff-self-access/full-before.json')))
const f=createFixture(),{sql,quote:q,root}=f
const dir=path.join(root,'migrations/snapshots/staff-self-access')
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n)))
const plan=read('plan.json'),id=s=>'"'+s.replaceAll('"','""')+'"'
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
 sql(`CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
 INSERT INTO org_organization(id,name,use_staff_expiration) VALUES(10,'Fixture org',false),(20,'Other org',false);
 INSERT INTO org_staff(id,organization_id,name,phone,username,password,is_active,is_policy_accepted,is_admin,is_admin_akabiz)
 VALUES(1,10,'Alice Private','001','alice','fixture-only',true,true,true,true),(2,10,'Bob Private','002','bob','fixture-only',true,true,false,false),(3,20,'Other Org Private','003','outsider','fixture-only',true,true,false,false);
 INSERT INTO auth.users(id) VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
 INSERT INTO private.aka_agent_desktop_users(staff_id,auth_user_id) VALUES(1,'11111111-1111-4111-8111-111111111111'),(2,'22222222-2222-4222-8222-222222222222');
 INSERT INTO auto_accounts(id,staff_id,organization_id,name,is_active,is_delete,flatform_type) VALUES(1,1,10,'Fixture account',true,false,'facebook');
 INSERT INTO auto_campaigns(id,staff_id,organization_id,account_id,name,status,is_delete) VALUES(1,1,10,1,'Fixture campaign','chờ xử lý',false);
 INSERT INTO auto_content_groups(id,name,staff_id,organization_id,is_active,is_delete,sharing_scope,sharing_revision) VALUES(1,'Shared group',2,10,true,false,'selected',0),(2,'Own group',1,10,true,false,'private',0);
 INSERT INTO auto_content_group_recipients(group_id,staff_id) VALUES(1,1);
 INSERT INTO auto_content_templates(id,name,content,staff_id,organization_id,group_id,is_delete) VALUES(1,'Shared content','Fixture shared content',2,10,1,false);
 INSERT INTO auto_account_contact_groups(id,name,staff_id,organization_id,is_delete,purpose,sharing_scope,sharing_revision,revision) VALUES(1,'Shared data',2,10,false,'data_group','selected',0,0);
 INSERT INTO auto_data_group_recipients(group_id,staff_id) VALUES(1,1);
 INSERT INTO auto_system_settings(id,key,value,is_active,is_secret) VALUES(990001,'desktop.updates.startup_prompt_max_version',NULL,true,false);`)
 const claims={role:'aka_agent_desktop',sub:'11111111-1111-4111-8111-111111111111'}
 const desktop=(query,c=claims)=>runAs('aka_agent_desktop',`SET LOCAL request.jwt.claims=${q(typeof c==='string'?c:JSON.stringify(c))}; ${query}`)
 const sharing=(action,data={})=>`SELECT aka_agent_group_sharing(1,10,'alice','fixture-only',${q(action)},${q(JSON.stringify(data))})`
 const json=s=>JSON.parse(s)
 const ownQueries=[
  'SELECT row_to_json(s) FROM aka_agent_staff_runtime_profile s WHERE id=1',
  "SELECT row_to_json(s) FROM aka_agent_staff_runtime_scope(1,'share') s",
  "SELECT row_to_json(s) FROM aka_agent_staff_runtime_scope(1,'update') s",
  'SELECT aka_agent_staff_time_allowed(1)',
  'SELECT get_staff_zalo_runtime_mode(1)',
  'SELECT get_staff_zalo_account_capabilities(1)',
  'SELECT inspect_staff_zalo_running_state(1)',
  'SELECT name FROM auto_accounts WHERE id=1',
  "UPDATE auto_accounts SET name='edit' WHERE id=1 RETURNING name",
  "UPDATE auto_campaigns SET status='tạm dừng' WHERE id=1 RETURNING status",
  sharing('get',{kind:'content',groupId:2}),
  sharing('validate_content_selection',{kind:'content',groupId:1}),
 ]
 const ownBefore=ownQueries.map(x=>desktop(x))
 const boot="SELECT aka_agent_staff_client('alice','fixture-only','read','{}')"
 const bootBefore=runAs('anon',boot),startupBefore=runAs('anon','SELECT aka_agent_desktop_startup_policy()')
 const groupsBefore=json(desktop(sharing('content_groups'))),templatesBefore=json(desktop(sharing('content_templates')))
 const dataBefore=json(desktop(sharing('data_panel',{kind:'data',groupId:1})))
 const backendQueries=['SELECT count(*) FROM aka_agent_staff_runtime_profile',"SELECT row_to_json(s) FROM aka_agent_staff_runtime_scope(2,'share') s",'SELECT aka_agent_staff_time_allowed(2)',sharing('staff'),sharing('content_groups')]
 const backendBefore=backendQueries.map(x=>runAs('service_role',x))
 const chatBefore=runAs('aka_agent_chat_api',"SELECT row_to_json(s) FROM aka_agent_staff_runtime_scope(2,'share') s")
 const capture=()=>json(sql(fs.readFileSync(path.join(root,'scripts/desktop-session-rls/cutover-v435/capture.sql'),'utf8')))
 const before=capture()
 const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261027175514_desktop_staff_self_access.sql'),'utf8')
 assert.throws(()=>sql(`BEGIN; ALTER FUNCTION aka_agent_staff_runtime_scope(bigint,text) SET lock_timeout='9s'; ${migration} ROLLBACK;`),/source drift/)
 pass('source checksum guard rejects a later runtime patch')
 sql('BEGIN;'+migration+'COMMIT;')
 assert.deepEqual(ownQueries.map(x=>desktop(x)),ownBefore)
 assert.equal(runAs('anon',boot),bootBefore); assert.equal(runAs('anon','SELECT aka_agent_desktop_startup_policy()'),startupBefore)
 pass('12 own-user runtime/account/campaign/sharing calls and bootstrap login remain byte-for-byte compatible')
 assert.equal(desktop('SELECT count(*) FROM aka_agent_staff_runtime_profile'),'1')
 for(const sid of [2,3]){
  assert.equal(desktop(`SELECT count(*) FROM aka_agent_staff_runtime_profile WHERE id=${sid}`),'0')
  for(const lock of ['share','update'])assert.equal(desktop(`SELECT count(*) FROM aka_agent_staff_runtime_scope(${sid},'${lock}')`),'0')
  assert.equal(desktop(`SELECT aka_agent_staff_time_allowed(${sid})`),'f')
  for(const fn of ['get_staff_zalo_runtime_mode','get_staff_zalo_account_capabilities','inspect_staff_zalo_running_state'])assert.throws(()=>desktop(`SELECT ${fn}(${sid})`),/Active staff .* was not found/)
 }
 pass('admin Desktop cannot enumerate same-org or cross-org profiles or call runtime with another staff ID')
 for(const c of ['',{},'{invalid', {role:'service_role',sub:claims.sub},{role:'aka_agent_desktop',sub:'invalid-uuid'},{role:'aka_agent_desktop',sub:'99999999-9999-4999-8999-999999999999'}]){
  assert.equal(desktop('SELECT count(*) FROM aka_agent_staff_runtime_profile',c),'0')
  assert.equal(desktop("SELECT count(*) FROM aka_agent_staff_runtime_scope(1,'share')",c),'0')
 }
 assert.equal(desktop('SELECT id FROM aka_agent_staff_runtime_profile',{...claims,sub:'22222222-2222-4222-8222-222222222222'}),'2')
 pass('missing/malformed/unmapped claims fail closed; staff identity comes from Auth mapping')
 for(const f of plan.revoked){
  assert.equal(sql(`SELECT has_function_privilege('aka_agent_desktop',${q(sig(f))},'EXECUTE')`),'f')
  assert.throws(()=>desktop(`SELECT public.${f.name}(1,'alice','fixture-only','list','{}')`),/permission denied/)
 }
 for(const query of ['SELECT password FROM org_staff','SELECT api_key FROM ai_model'])assert.throws(()=>desktop(query),/permission denied/)
 pass('all 6 admin RPCs denied even with valid admin credentials; direct staff passwords and AI keys remain denied')
 assert.equal(desktop(sharing('staff')),'[]')
 assert.throws(()=>desktop("SELECT aka_agent_group_sharing(2,10,'bob','fixture-only','staff','{}')"),/group_sharing_access_denied/)
 const anonymize=x=>JSON.parse(JSON.stringify(x).replaceAll('Bob Private','Nhân viên #2'))
 assert.deepEqual(json(desktop(sharing('content_groups'))),anonymize(groupsBefore))
 assert.deepEqual(json(desktop(sharing('content_templates'))),anonymize(templatesBefore))
 assert.deepEqual(json(desktop(sharing('data_panel',{kind:'data',groupId:1}))),anonymize(dataBefore))
 pass('recipient picker empty; existing shared content/data still readable with other-owner names hidden')
 assert.deepEqual(backendQueries.map(x=>runAs('service_role',x)),backendBefore)
 assert.equal(runAs('aka_agent_chat_api',"SELECT row_to_json(s) FROM aka_agent_staff_runtime_scope(2,'share') s"),chatBefore)
 pass('service-role and Chat worker retain cross-staff runtime and sharing behavior')
 assert.throws(()=>desktop("SELECT * FROM aka_agent_staff_runtime_scope(1,'invalid')"),/staff_runtime_scope_invalid/)
 assert.equal(desktop("SET LOCAL lock_timeout='791ms'; SELECT current_setting('lock_timeout') FROM aka_agent_staff_runtime_scope(1,'share')"),'791ms')
 pass('runtime lock input validation and caller lock-timeout inheritance preserved')
 const after=capture(),patched=new Set(plan.functions.map(x=>x.signature)),revoked=new Set(plan.revoked.map(x=>x.signature))
 const clean=f=>({...f,definition:undefined,checksum:undefined})
 for(const b of before.functions){
  const a=after.functions.find(x=>x.signature===b.signature);assert.ok(a)
  if(patched.has(b.signature)){assert.deepEqual(clean(a),clean(b));assert.notEqual(a.checksum,b.checksum)}
  else if(revoked.has(b.signature)){assert.equal(a.checksum,b.checksum);assert.deepEqual({...a,acl:b.acl,desktop_execute:b.desktop_execute},b)}
  else assert.deepEqual(a,b)
 }
 for(const b of before.relations){const a=after.relations.find(x=>x.schema===b.schema&&x.name===b.name);assert.deepEqual(b.name==='aka_agent_staff_runtime_profile'?{...a,view:b.view}:a,b)}
 assert.deepEqual(after.policies,before.policies);assert.deepEqual(after.triggers,before.triggers)
 pass('all unrelated function definitions/ACLs, table grants/RLS, policies and triggers preserved')
 const helper=after.functions.find(x=>x.name==='aka_agent_staff_scope_for_request')
 assert.equal(helper.anon_execute,false);assert.equal(helper.authenticated_execute,false);assert.equal(helper.security_definer,true)
 fs.writeFileSync(path.join(dir,'target.json'),JSON.stringify({functions:after.functions.filter(x=>patched.has(x.signature)||revoked.has(x.signature)||x.name==='aka_agent_staff_scope_for_request'),view:after.relations.find(x=>x.name==='aka_agent_staff_runtime_profile')},null,2)+'\n')
 // A guarded rollback generated from the exact candidate metadata restores only this change.
 const targets=after.functions.filter(x=>patched.has(x.signature)||revoked.has(x.signature)||x.name==='aka_agent_staff_scope_for_request')
 const targetView=after.relations.find(x=>x.name==='aka_agent_staff_runtime_profile')
 const viewGuard=` IF NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.aka_agent_staff_runtime_profile') AND c.relkind='v' AND pg_get_viewdef(c.oid,true)=${q(targetView.view)} AND c.relacl::text IS NOT DISTINCT FROM ${q(targetView.acl)} AND pg_get_userbyid(c.relowner)=${q(targetView.owner)} AND c.reloptions IS NOT DISTINCT FROM ARRAY[${targetView.options.map(q).join(',')}]::text[]) THEN RAISE EXCEPTION 'staff rollback runtime view drift'; END IF;`
 const rollback=`SET LOCAL lock_timeout='8s';\nDO $guard$ BEGIN\n IF current_setting('aka_agent.staff_self_access_rollback',true) IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'staff privacy rollback requires explicit approval'; END IF;\n`+targets.map(x=>` IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure(${q(sig(x))}) AND md5(pg_get_functiondef(oid))=${q(x.checksum)} AND proacl::text=${q(x.acl)}) THEN RAISE EXCEPTION 'staff rollback source drift'; END IF;`).join('\n')+'\n'+viewGuard+`\nEND $guard$;\nCREATE OR REPLACE VIEW public.aka_agent_staff_runtime_profile WITH (security_barrier=true) AS ${plan.view.view}\n`+plan.functions.map(x=>x.definition+';').join('\n')+'\n'+plan.revoked.map(x=>`GRANT EXECUTE ON FUNCTION ${sig(x)} TO aka_agent_desktop;`).join('\n')+'\nDROP FUNCTION private.aka_agent_staff_scope_for_request();\nNOTIFY pgrst,\'reload schema\';\n'
 fs.writeFileSync(path.join(root,'migrations/rollback_desktop_staff_self_access.sql'),rollback)
 assert.throws(()=>sql('BEGIN;'+rollback+'ROLLBACK;'),/requires explicit approval/)
 for(const change of [
  `CREATE OR REPLACE VIEW public.aka_agent_staff_runtime_profile AS ${plan.view.view}`,
  'GRANT SELECT ON public.aka_agent_staff_runtime_profile TO anon;',
  'ALTER VIEW public.aka_agent_staff_runtime_profile OWNER TO service_role;',
  'ALTER VIEW public.aka_agent_staff_runtime_profile SET (security_barrier=false);'
 ])assert.throws(()=>sql("BEGIN; SET LOCAL aka_agent.staff_self_access_rollback='approved';"+change+rollback+'ROLLBACK;'),/staff rollback runtime view drift/,change)
 assert.deepEqual(capture().relations,after.relations)
 assert.deepEqual(capture().functions,after.functions)
 pass('rollback rejects changed runtime view definition, grants, owner and security options before replacing it')
 sql("BEGIN; SET LOCAL aka_agent.staff_self_access_rollback='approved';"+rollback+'COMMIT;')
 const rolled=capture();assert.deepEqual(rolled.functions,before.functions);assert.deepEqual(rolled.relations,before.relations)
 pass('guarded rollback restores exact source definitions/ACLs/view and removes only the new helper')
 sql('BEGIN;'+migration+'ROLLBACK;')
 assert.deepEqual(capture().functions,before.functions)
 pass('complete migration also validates inside a rolled-back transaction')
 fs.writeFileSync(path.join(dir,'local-test.json'),JSON.stringify({checks,status:'passed',fixture:'PostgreSQL 17; current metadata; synthetic identities and shared groups only',at:new Date().toISOString()},null,2)+'\n')
 console.log(JSON.stringify({checks,status:'passed'}))
}finally{f.close()}
