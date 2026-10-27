// Disposable PostgreSQL: production metadata plus synthetic data only.
// Unrelated legacy functions absent from the old fixture are non-callable
// raising stubs; their ACLs are tested, never their business implementations.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {createFixture}=require('./full-fixture.cjs')
const {readCatalog}=require('./embedded-join-regression.cjs')
const f=createFixture(),{sql,quote:q,root}=f
const dir=path.join(root,'migrations/snapshots/desktop-session-rls')
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name)))
const live=read('least-privilege-preflight.json'),plan=read('least-privilege-plan.json'),usage=read('least-privilege-dependencies.json')
const id=s=>'"'+s.replaceAll('"','""')+'"'
const runAs=(role,query)=>sql(`BEGIN; SET LOCAL ROLE ${id(role)}; ${query}; ROLLBACK;`)
const pass=s=>{checks++;console.log('PASS',s)}
let checks=0,stubbed=0
const metadata=()=>JSON.parse(sql(`SELECT jsonb_build_object(
 'rls',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p),
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid)),p.proconfig,p.proowner,p.prosecdef) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f'))`))
function permissionHashes(){return JSON.parse(sql(`SELECT jsonb_object_agg(r.rolname,jsonb_build_object(
 'tables',(SELECT md5(string_agg(c.oid||':'||p||':'||has_table_privilege(r.oid,c.oid,p),',' ORDER BY c.oid,p)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v')),
 'columns',(SELECT md5(string_agg(a.attrelid||':'||a.attnum||':'||p||':'||has_column_privilege(r.oid,a.attrelid,a.attnum,p),',' ORDER BY a.attrelid,a.attnum,p)) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v') AND a.attnum>0 AND NOT a.attisdropped),
 'functions',(SELECT md5(string_agg(p.oid||':'||has_function_privilege(r.oid,p.oid,'EXECUTE'),',' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')),
 'sequences',(SELECT md5(string_agg(c.oid||':'||p||':'||has_sequence_privilege(r.oid,c.oid,p),',' ORDER BY c.oid,p)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','UPDATE','USAGE']) p WHERE n.nspname IN ('public','private') AND c.relkind='S')
 )) FROM pg_roles r WHERE r.rolname<> 'aka_agent_desktop'`))}
async function main(){try{
 sql(f.localActivation(fs.readFileSync(path.join(root,'supabase/migrations/20261027095004_desktop_session_identity.sql'),'utf8')))
 const hook=read('pre-request-preflight.json').function
 sql(hook.definition+'; GRANT EXECUTE ON FUNCTION public.aka_agent_block_denied_ip_request() TO aka_agent_desktop;')
 const existing=new Set(JSON.parse(sql('SELECT jsonb_agg(rolname) FROM pg_roles')))
 for(const r of live.roles)if(!existing.has(r.name))sql(`CREATE ROLE ${id(r.name)};`)
 sql('CREATE DOMAIN public.vector AS text;')
 for(const f of plan.functionState){
  if(sql(`SELECT to_regprocedure(${q(f.signature)}) IS NOT NULL`)==='t')continue
  const meta=live.functions.find(x=>x.signature===f.signature)
  sql(`CREATE FUNCTION ${f.signature} RETURNS ${meta.result} LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'out-of-scope fixture stub'; END;$$;`)
  sql(`REVOKE ALL ON FUNCTION ${f.signature} FROM PUBLIC;`)
  const acl=meta.acl===null?['=X/postgres']:meta.acl.slice(1,-1).split(',')
  for(const entry of acl){const who=entry.split('=')[0];if(entry.includes('X'))sql(`GRANT EXECUTE ON FUNCTION ${f.signature} TO ${who?id(who):'PUBLIC'};`)}
  stubbed++
 }
 let migration=fs.readFileSync(path.join(root,'supabase/migrations/20261027141754_desktop_token_least_privilege.sql'),'utf8')
 // Normalize local-only function stubs and reconstructed ACL ordering, never
 // the production candidate. Production preflight uses its original checksums.
 const actualFunctions=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('signature',x.signature,'checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl::text) ORDER BY x.signature COLLATE "C") FROM jsonb_to_recordset(${q(JSON.stringify(plan.functionState))}::jsonb) x(signature text) JOIN pg_proc p ON p.oid=to_regprocedure(x.signature)`))
 const actualRelations=JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object('schema',x.schema,'name',x.name,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'acl',a.attacl::text,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY x.schema COLLATE "C",x.name COLLATE "C") FROM jsonb_to_recordset(${q(JSON.stringify(plan.relationState))}::jsonb) x(schema text,name text) JOIN pg_class c ON c.oid=to_regclass(format('%I.%I',x.schema,x.name))`))
 migration=migration.replaceAll(q(JSON.stringify(plan.functionState)),q(JSON.stringify(actualFunctions))).replaceAll(q(JSON.stringify(plan.relationState)),q(JSON.stringify(actualRelations)))
 const roles=JSON.parse(sql('SELECT jsonb_agg(rolname ORDER BY rolname::text COLLATE "C") FROM pg_roles'))
 migration=migration.replace(q(JSON.stringify(plan.roles)),q(JSON.stringify(roles)))
 f.installTriggers()
 const actualDependencies=JSON.parse(sql(plan.dependencyQuery))
 assert.equal(actualDependencies.triggers.length,plan.dependencyState.triggers.length,'all live trigger attachments are present in the fixture')
 migration=migration.replace(q(JSON.stringify(plan.dependencyState)),q(JSON.stringify(actualDependencies)))
 const before=metadata(),otherRoles=permissionHashes()
 sql(`INSERT INTO org_organization(id,name,use_staff_expiration) VALUES(10,'Fixture org',false);
 INSERT INTO org_staff(id,organization_id,username,password,is_active,is_policy_accepted,is_admin) VALUES(1,10,'alice','fixture-only',true,true,false);
 INSERT INTO auto_accounts(id,staff_id,organization_id,name) VALUES(1,1,10,'Fixture account');
 INSERT INTO auto_campaigns(id,staff_id,organization_id,account_id,name,status) VALUES(1,1,10,1,'Fixture campaign','chờ xử lý');
 INSERT INTO ai_model(id,api_key) VALUES(1,'fixture-not-a-real-key');
 CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
 INSERT INTO vault.decrypted_secrets VALUES('fixture-secret','fixture-only-secret');`)
 sql(`INSERT INTO category_type(id,namespace,code,name,managed_by,is_active) VALUES
 (100,'common','data_type','Data type','system',true),(101,'other','data_type','Other','system',true);
 INSERT INTO category_item(id,category_type_id,code,name,sort_order,is_active,managed_by) VALUES
 (2001,100,'phone','Số điện thoại',1,true,'system'),(2002,100,'zalo_person','Zalo UID',2,true,'system'),
 (2003,100,'hidden','Inactive',3,false,'system'),(2004,101,'other','Other namespace',1,true,'system');`)
 const expectedCatalog=[{id:2001,code:'phone',name:'Số điện thoại',sortOrder:1,isActive:true},{id:2002,code:'zalo_person',name:'Zalo UID',sortOrder:2,isActive:true}]
 assert.deepEqual(await readCatalog(runAs),expectedCatalog)
 const sourceQueries=[
  "SELECT name FROM auto_accounts WHERE id=1",
  "UPDATE auto_accounts SET name='changed' WHERE id=1 RETURNING name",
  "INSERT INTO auto_accounts(name,staff_id,organization_id,flatform_type,is_active,is_zalo_server,is_zalo_show_web,login_status,status) VALUES('created',1,10,'facebook',true,false,false,'chưa đăng nhập','chờ xử lý') RETURNING name",
  "UPDATE auto_campaigns SET status='tạm dừng' WHERE id=1 RETURNING status",
  "SELECT id,organization_id FROM aka_agent_staff_runtime_profile WHERE id=1",
  "SELECT api_key FROM ai_model WHERE id=1",
  "SELECT aka_agent_block_denied_ip_request()"
 ]
 sql("SELECT setval('auto_accounts_id_seq',100,false);")
 const old=sourceQueries.map(query=>runAs('aka_agent_desktop',query))
 const staffRead=runAs('anon',"SELECT aka_agent_staff_client('alice','fixture-only','read','{}')")
 assert.equal(runAs('aka_agent_desktop',"SELECT aka_agent_get_vault_secret('fixture-secret')"),'fixture-only-secret')
 const withoutTransaction=migration.replace(/^BEGIN;\n/m,'').replace(/^COMMIT;\n/m,'')
 for(const change of ["GRANT DELETE ON public.org_organization TO aka_agent_desktop", "ALTER FUNCTION public.aka_agent_get_vault_secret(text) SET statement_timeout='1s'"]){
  assert.throws(()=>sql(`BEGIN; ${change}; ${withoutTransaction} ROLLBACK;`),/metadata drift/)
 }
 pass('ACL/function drift rejects the candidate before mutations')
 sql(migration)
 const proxyGuard=read('proxy-payload-preflight.json')
 const proxyActual=JSON.parse(sql(proxyGuard.query))
 let proxyMigration=fs.readFileSync(path.join(root,'supabase/migrations/20261027143747_desktop_proxy_payload_permissions.sql'),'utf8')
 proxyMigration=proxyMigration.replace(q(JSON.stringify(proxyGuard.expected)),q(JSON.stringify(proxyActual)))
 sql(proxyMigration)
 await assert.rejects(()=>readCatalog(runAs),/permission denied for table category_type/)
 assert.deepEqual(await readCatalog(runAs,'anon'),expectedCatalog)
 const joinGuard=read('embedded-join-preflight.json')
 let joinMigration=fs.readFileSync(path.join(root,'supabase/migrations/20261027144727_desktop_embedded_join_permissions.sql'),'utf8')
 const joinActual=JSON.parse(sql(joinGuard.query))
 joinMigration=joinMigration.replace(q(JSON.stringify(joinGuard.expected)),q(JSON.stringify(joinActual)))
 const joinBody=joinMigration.replace(/^BEGIN;\n/m,'').replace(/^COMMIT;\n/m,'')
 assert.throws(()=>sql(`BEGIN; GRANT UPDATE ON category_type TO aka_agent_desktop; ${joinBody} ROLLBACK;`),/ACL\/policy drift/)
 sql(joinMigration)
 assert.deepEqual(await readCatalog(runAs),expectedCatalog)
 assert.throws(()=>runAs('aka_agent_desktop',"UPDATE category_type SET name='not allowed' WHERE id=100"),/permission denied/)
 pass('real catalog repository/SDK reproduces missing join permission, restores ordered results, and remains read-only')
 assert.equal(runAs('aka_agent_desktop',"INSERT INTO auto_proxies(name,host,port,protocol,username,password,is_active,staff_id,organization_id) VALUES('fixture','127.0.0.1',8080,'http','test','fixture-only',true,1,10) RETURNING name"),'fixture')
 sql("INSERT INTO auto_proxies(id,name,host,port,protocol,staff_id,organization_id) VALUES(100,'fixture','127.0.0.1',8080,'http',1,10)")
 assert.equal(runAs('aka_agent_desktop',"UPDATE auto_proxies SET name='edited',host='127.0.0.2',port=8888,protocol='http',username='test',password='fixture-only',is_active=true,updated_at=now() WHERE id=100 RETURNING name"),'edited')
 pass('complete Proxy builder payload works for create and update')
 assert.deepEqual(sourceQueries.map(query=>runAs('aka_agent_desktop',query)),old)
 assert.equal(runAs('anon',"SELECT aka_agent_staff_client('alice','fixture-only','read','{}')"),staffRead)
 pass('account/campaign writes, runtime profile, AI model read, staff RPC and gateway hook remain compatible')
 for(const query of ["SELECT password FROM org_staff", "UPDATE org_staff SET organization_id=11 WHERE id=1", "UPDATE org_staff SET is_admin=true WHERE id=1", "DELETE FROM org_staff WHERE id=1", "SELECT aka_agent_get_vault_secret('fixture-secret')", "DELETE FROM auto_accounts WHERE id=1", "DELETE FROM auto_campaigns WHERE id=1", "TRUNCATE auto_campaigns", "UPDATE auto_account_actions SET is_active=false", "UPDATE auto_accounts SET organization_id=11 WHERE id=1", "UPDATE auto_campaigns SET organization_id=11 WHERE id=1"]){
  assert.throws(()=>runAs('aka_agent_desktop',query),/permission denied/)
 }
 pass('Desktop cannot read/write staff, read Vault, hard-delete accounts/campaigns, truncate, or edit unused catalog columns')
 assert.equal(runAs('anon',"SELECT aka_agent_get_vault_secret('fixture-secret')"),'fixture-only-secret')
 assert.equal(runAs('anon','SELECT password FROM org_staff WHERE id=1'),'fixture-only')
 pass('legacy anon reads and old Vault access remain unchanged as explicitly requested')
 // The fixture-only Vault table was added after the first hash. Compare all
 // pre-existing rows/functions by taking its baseline out of both snapshots.
 sql('DROP TABLE vault.decrypted_secrets; DROP SCHEMA vault;')
 assert.deepEqual(permissionHashes(),otherRoles)
 pass('effective table/column/function/sequence rights of every other role remain identical')
 assert.deepEqual(metadata(),before)
 pass('all function bodies/config/owners and all RLS/policies remain unchanged')
 const matrix=[]
 for(const t of read('least-privilege-plan-corrected.json').tables)for(const g of t.grants){
  if(g.columns)for(const col of g.columns)matrix.push(`has_column_privilege('aka_agent_desktop',${q(t.name)},${q(col)},${q(g.privilege)})`)
  else matrix.push(`has_table_privilege('aka_agent_desktop',${q(t.name)},${q(g.privilege)})`)
 }
 assert.equal(sql(`SELECT ${matrix.join(' AND ')}`),'t')
 pass(`${matrix.length} required table/column privileges are available`)
 const deniedFunctions=plan.functions.map(f=>`NOT has_function_privilege('aka_agent_desktop',${q(f.signature)},'EXECUTE')`)
 assert.equal(sql(`SELECT ${deniedFunctions.join(' AND ')}`),'t')
 pass(`${plan.functions.length} unused application functions are not callable by Desktop, including PUBLIC paths`)
 for(const file of ['supabase/migrations/20261027100931_desktop_data_rls_activation.sql','migrations/rollback_desktop_data_rls_activation.sql']) {
  assert.throws(()=>sql("SET aka_agent.desktop_rls_cutover='approved-after-client-update'; SET aka_agent.desktop_rls_rollback='approved-legacy-access-reopens'; "+fs.readFileSync(path.join(root,file),'utf8')),/STOP: obsolete/)
 }
 pass('legacy cutover and rollback cannot restore excess Desktop grants, even with their old approval flags')
 console.log(JSON.stringify({checks,stubbedUnrelatedFunctions:stubbed,status:'passed'}))
}finally{f.close()}}
main().catch(error=>{console.error(error);process.exitCode=1})
