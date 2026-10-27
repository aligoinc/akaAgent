// Real, isolated PostgreSQL only. No production connection, customer data or API calls.
const {spawnSync,spawn} = require('node:child_process')
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'../..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'staff-rls-'))
const files=['20261027044346_staff_rls_client_api.sql','20261027044627_staff_rls_runtime_compatibility.sql','20261027044628_staff_rls_activation.sql'].map(f=>path.join(root,'supabase/migrations',f))
const source=JSON.parse(fs.readFileSync(path.join(root,'migrations/snapshots/staff-rls/source.json')))
const patches=JSON.parse(fs.readFileSync(path.join(root,'migrations/snapshots/staff-rls/runtime-patches.json')))
const cols=JSON.parse(fs.readFileSync(path.join(root,'migrations/snapshots/staff-rls/columns.json')))
const quote=x=>"'"+String(x).replaceAll("'","''")+"'"
let started=false,checks=0
const run=(cmd,args,input)=>{const r=spawnSync(cmd,args,{encoding:'utf8',input,maxBuffer:20*1024*1024});if(r.status!==0)throw Error((r.stderr||r.stdout).slice(-7000));return r.stdout}
const args=['-X','-h',tmp,'-p','55478','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq']
const sql=s=>run('psql',args,s)
const pass=label=>{checks++;console.log('PASS',label)}
const json=s=>JSON.parse(sql(s).trim())
function acl(f){const sig='public.'+f.signature;let s=`REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,postgres,anon,authenticated,service_role,aka_agent_chat_api;\n`;for(const entry of f.proacl.slice(1,-1).split(',')){const role=entry.split('=')[0]||'PUBLIC';s+=`GRANT EXECUTE ON FUNCTION ${sig} TO ${role};\n`}return s}
function denies(s,role='anon',message){const body=`SET ROLE ${role}; DO $test$ BEGIN BEGIN ${s}; EXCEPTION WHEN OTHERS THEN IF ${message ? `position(${quote(message)} in SQLERRM)>0` : "SQLSTATE IN ('42501','P0001','22023','22P02')"} THEN RETURN; END IF; RAISE; END; RAISE EXCEPTION 'expected rejection'; END $test$; RESET ROLE;`;sql(body);checks++}
const call=(action,data={},user='alice',pw='test-alice')=>`public.aka_agent_staff_client(${quote(user)},${quote(pw)},${quote(action)},${quote(JSON.stringify(data))}::jsonb)`
const hash='a'.repeat(64),token='b'.repeat(64),other='c'.repeat(64)
const reg=(pw='test-alice')=>sql(`SET ROLE anon; SELECT ${call('register_recovery',{staffId:1,fingerprintHash:hash,secretHash:require('node:crypto').createHash('sha256').update(token).digest('hex')},'alice',pw)};`)
async function main(){
try {
 run('initdb',['-D',path.join(tmp,'db'),'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
 run('pg_ctl',['-D',path.join(tmp,'db'),'-l',path.join(tmp,'pg.log'),'-o',`-h '' -k ${tmp} -p 55478 -c max_connections=15`,'-w','start']);started=true
 const serverVersion=sql('SHOW server_version;').trim(),serverVersionNum=Number(sql('SHOW server_version_num;').trim())
 const definitions=cols.map(c=>`"${c.name}" ${c.type}${c.not_null?' NOT NULL':''}${c.default_expression?' DEFAULT '+c.default_expression:''}`).join(',\n')
 sql(`CREATE SCHEMA private; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE aka_agent_chat_api BYPASSRLS; CREATE ROLE crm_interest_worker BYPASSRLS;
 GRANT USAGE ON SCHEMA public,extensions TO anon,authenticated,service_role,aka_agent_chat_api,crm_interest_worker;
 CREATE TABLE public.org_staff(${definitions},PRIMARY KEY(id),UNIQUE(username));
 CREATE TABLE public.org_organization(id bigint PRIMARY KEY,name text,use_staff_expiration boolean NOT NULL DEFAULT false);
 GRANT ALL ON org_staff TO anon,authenticated,service_role; GRANT SELECT,INSERT,UPDATE ON org_staff TO aka_agent_chat_api;GRANT SELECT ON org_staff TO crm_interest_worker; GRANT UPDATE(id) ON org_staff TO crm_interest_worker;
 GRANT ALL ON org_organization TO service_role;GRANT SELECT ON org_organization TO anon,authenticated;
 ALTER TABLE org_organization ENABLE ROW LEVEL SECURITY;CREATE POLICY org_organization_compat_read_all ON org_organization FOR SELECT TO anon,authenticated USING(true);
 INSERT INTO org_organization VALUES(10,'test org',false),(20,'other org',false);
 INSERT INTO org_staff(id,organization_id,name,phone,username,password,is_active,is_admin_akabiz) VALUES(1,10,'Alice','1','alice','test-alice',true,false),(2,20,'Bob','2','bob','test-bob',true,true),(3,10,'Disabled','3','disabled','test-disabled',false,false);
 SET check_function_bodies=off;`+source.filter(f=>['aka_agent_staff_access','aka_agent_staff_time_allowed','get_managed_staff'].includes(f.signature.split('(')[0])).map(f=>f.definition+';\n'+acl(f)).join('\n')+patches.map(f=>f.definition+';\n'+acl(f)).join('\n'))
 const runtimeColumns=JSON.parse(fs.readFileSync(path.join(root,'migrations/snapshots/staff-rls/runtime-columns.json')))
 for(const table of [...new Set(runtimeColumns.map(c=>c.table_name))])sql(`CREATE TABLE public.${table}(${runtimeColumns.filter(c=>c.table_name===table).map(c=>`"${c.name}" ${c.type}`).join(',')});`)
 sql("GRANT SELECT ON auto_accounts,auto_campaigns TO anon,authenticated; INSERT INTO auto_accounts(id,staff_id,organization_id,status,is_delete,is_active,login_status,flatform_type,is_zalo_server,is_zalo_show_web) VALUES(100,1,10,'đang chạy',false,true,'đã đăng nhập','facebook',false,false); INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,status,is_delete,daily_stop_time) VALUES(200,100,1,10,'đang chạy',false,'23:59:00');")
 function runtimeSnapshot(){
  const cases=[['valid','',1],['wrong-staff','',2],['inactive','UPDATE org_staff SET is_active=false WHERE id=1;',1],['wrong-org','UPDATE auto_campaigns SET organization_id=20 WHERE id=200;',1],['deleted','UPDATE auto_accounts SET is_delete=true WHERE id=100;',1],['paused',"UPDATE auto_campaigns SET status='tạm dừng' WHERE id=200;",1],['held-expired',"UPDATE org_organization SET use_staff_expiration=true WHERE id=10; UPDATE org_staff SET expiration_date=now()-interval '1 day' WHERE id=1; UPDATE auto_campaigns SET runtime_unit_token='11111111-1111-1111-1111-111111111111' WHERE id=200;",1]]
  return cases.map(([name,setup,staff])=>({name,result:json(`BEGIN; ${setup} SET LOCAL ROLE anon; SELECT json_build_object('allow',allow_new_unit,'reason',reason,'campaign',campaign_status,'account',account_status,'dayChanged',day_changed) FROM public.aka_agent_check_campaign_daily_boundary(200,100,${staff},'desktop',timezone('Asia/Ho_Chi_Minh',now())::date); ROLLBACK;`)}))
 }
 const runtimeBefore=runtimeSnapshot()
 // Reproduce production's public-schema default grants; phase A/B must remove
 // inherited client rights, including MAINTAIN on PostgreSQL 17+.
 sql('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role; CREATE ROLE unexpected_reader;')
 sql(fs.readFileSync(files[0],'utf8'));pass('phase A preserves legacy direct reads and writes')
 assert.equal(sql("SELECT relrowsecurity FROM pg_class WHERE oid='org_staff'::regclass;").trim(),'f')
 assert.equal(sql("SELECT has_table_privilege('anon','org_staff','UPDATE');").trim(),'t')
 const profile=json(`SET ROLE anon; SELECT ${call('read')};`);assert.equal(profile.id,1);assert(!('password' in profile));pass('verified profile excludes password')
 denies(`PERFORM ${call('read',{},'alice','wrong')}`)
 denies(`PERFORM ${call('read',{staffId:2})}`)
 denies(`PERFORM ${call('read',{},'disabled','test-disabled')}`)
 for(const field of ['organization_id','is_admin','is_super_admin','is_active','password'])denies(`PERFORM ${call('read',{[field]:true})}`)
 denies(`PERFORM ${call('set_test_workflow',{staffId:1,enabled:true})}`)
 denies(`PERFORM ${call('bind_device',{staffId:1,fingerprintHash:'bad'})}`)
 sql(`SET ROLE anon; SELECT ${call('bind_device',{staffId:1,fingerprintHash:hash})};`)
 denies(`PERFORM ${call('bind_device',{staffId:1,fingerprintHash:other})}`)
 reg();assert.equal(json(`SET ROLE anon; SELECT public.aka_agent_recover_staff_credentials('${token}','${hash}');`).username,'alice');pass('machine proof recovers; fingerprint alone cannot')
 denies(`PERFORM public.aka_agent_recover_staff_credentials('${other}','${hash}')`)
 denies(`PERFORM public.aka_agent_recover_staff_credentials('${token}','${other}')`)
 sql(`SET ROLE anon; SELECT ${call('save_integration',{staffId:1,kind:'sms',integration:{staffId:99,username:'sms'}})};`)
 sql(`SET ROLE anon; SELECT ${call('save_integration',{staffId:1,kind:'zaloWeb',integration:{staffId:98,username:'zalo'}})};`)
 assert.equal(json(`SET ROLE anon; SELECT ${call('read')};`).akabiz_integrations.sms.staffId,99);pass('integration patch preserves other kinds')
 for(const action of ['set_test_workflow','bind_device','change_password','register_recovery'])denies(`PERFORM ${call(action,{staffId:1,organization_id:1})}`)
 sql(`SET ROLE anon; SELECT ${call('change_password',{staffId:1,newPassword:'new-password'})};`)
 denies(`PERFORM public.aka_agent_recover_staff_credentials('${token}','${hash}')`)
 denies(`PERFORM ${call('read')}`)
 reg('new-password');sql("UPDATE org_staff SET aka_agent_device_fingerprint_hash=NULL WHERE id=1;")
 sql(`UPDATE org_staff SET aka_agent_device_fingerprint_hash='${hash}' WHERE id=1;`)
 denies(`PERFORM public.aka_agent_recover_staff_credentials('${token}','${hash}')`);pass('password change and reset/rebind revoke recovery')
 sql("UPDATE org_staff SET password='test-alice' WHERE id=1;");reg()
 sql(fs.readFileSync(files[1],'utf8'));pass('all exact-source runtime patches pass live-definition/ACL preflight')
 for(const f of patches){const current=json(`SELECT json_build_object('def',pg_get_functiondef(oid),'acl',proacl::text,'definer',prosecdef,'owner',pg_get_userbyid(proowner),'config',proconfig,'volatility',provolatile) FROM pg_proc WHERE oid='public.${f.signature}'::regprocedure;`);assert.equal(current.acl,f.proacl);assert.equal(current.definer,false);assert.equal(current.owner,f.owner);assert.deepEqual(current.config,f.proconfig);assert.equal(current.volatility,f.provolatile);checks++}
 const viewName='public.aka_agent_staff_runtime_profile'
 const drift=[
  `GRANT UPDATE ON ${viewName} TO anon`,
  `GRANT UPDATE ON ${viewName} TO authenticated`,
  `GRANT INSERT ON ${viewName} TO service_role`,
  `GRANT SELECT ON ${viewName} TO PUBLIC`,
  `GRANT SELECT ON ${viewName} TO unexpected_reader`,
  `GRANT SELECT ON ${viewName} TO anon WITH GRANT OPTION`,
  `REVOKE SELECT ON ${viewName} FROM authenticated`,
  `REVOKE DELETE ON ${viewName} FROM postgres`,
  `GRANT SELECT(id) ON ${viewName} TO anon`,
  `GRANT UPDATE(organization_id) ON ${viewName} TO authenticated`,
  `ALTER VIEW ${viewName} SET (security_barrier=false)`
 ]
 if(serverVersionNum>=170000)for(const role of ['anon','authenticated','service_role'])drift.push(`GRANT MAINTAIN ON ${viewName} TO ${role}`)
 for(const guardFile of [files[2],path.join(root,'migrations/snapshots/staff-rls/rollback-activation.sql')]){
  const gate=fs.readFileSync(guardFile,'utf8').match(/DO \$view\$[\s\S]*?END; \$view\$;/)[0]
  sql(`BEGIN; REVOKE SELECT ON ${viewName} FROM anon; GRANT SELECT ON ${viewName} TO anon; ${gate} ROLLBACK;`);checks++
  for(const mutation of drift){
   let rejected=false
   try{sql(`BEGIN; ${mutation}; ${gate} ROLLBACK;`)}catch(e){rejected=e.message.includes('staff recovery/view protection changed')}
   assert(rejected,`guard must reject ${mutation}`);checks++
  }
 }
 pass(`cutover/rollback view guards accept reordered owner defaults and reject privilege drift on PostgreSQL ${serverVersion}`)
 let blocked=false;try{sql(fs.readFileSync(files[2],'utf8'))}catch(e){blocked=e.message.includes('STOP: staff RLS activation')};assert(blocked);pass('cutover refuses accidental application')
 sql("SET aka_agent.staff_rls_cutover='approved-after-client-update';\n"+fs.readFileSync(files[2],'utf8'));pass('explicit local cutover succeeds')
 assert.deepEqual(runtimeSnapshot(),runtimeBefore);checks+=runtimeBefore.length;pass('runtime boundary/ownership/deletion/held-expiry parity before and after RLS')
 for(const role of ['anon','authenticated']){
 for(const op of ['SELECT * FROM org_staff','UPDATE org_staff SET organization_id=1 WHERE id=1','UPDATE org_staff SET password=\'x\' WHERE id=1','DELETE FROM org_staff WHERE id=1','TRUNCATE org_staff','INSERT INTO org_staff(id,organization_id,name,phone,username) VALUES(9,1,\'x\',\'9\',\'x\')'])denies(op,role)
 denies('PERFORM * FROM get_managed_staff(1)',role)
 denies("UPDATE aka_agent_staff_runtime_profile SET organization_id=1 WHERE id=1",role)
 denies("DELETE FROM aka_agent_staff_runtime_profile WHERE id=1",role)
 denies("PERFORM * FROM private.aka_agent_staff_recovery",role)
 sql(`SET ROLE ${role}; SELECT ${call('read')}; SELECT ${call('accept_policy',{staffId:1})}; SELECT * FROM aka_agent_staff_runtime_scope(1,'share'); SELECT * FROM aka_agent_staff_runtime_profile WHERE id=1;`)
 }
 pass('RLS blocks direct mutation/secret reads; verified client RPC still works')
 for(const role of ['service_role','aka_agent_chat_api'])sql(`SET ROLE ${role}; UPDATE org_staff SET name='CRM edit' WHERE id=1; SELECT id FROM org_staff WHERE id=1;`)
 pass('trusted CRM and Chat roles keep existing access')
 assert.equal(json(`SELECT public.aka_agent_staff_security_status();`).legacyRecoveryAllowed,false)
 assert.equal(json(`SET ROLE anon; SELECT public.aka_agent_recover_staff_credentials('${token}','${hash}');`).username,'alice');pass('recovery survives cutover without public reads')
 const targets=json("SELECT json_agg(json_build_object('signature',oid::regprocedure::text,'checksum',md5(pg_get_functiondef(oid)),'owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,'volatility',provolatile,'config',proconfig,'acl',proacl::text) ORDER BY proname) FROM pg_proc WHERE (pronamespace='public'::regnamespace AND (proname LIKE 'aka_agent_staff_%' OR proname='aka_agent_recover_staff_credentials' OR oid=ANY(ARRAY["+patches.map(f=>quote('public.'+f.signature)+'::regprocedure').join(',')+"])) OR oid=to_regprocedure('private.aka_agent_invalidate_staff_recovery()'));")
 fs.writeFileSync(path.join(root,'migrations/snapshots/staff-rls/local-target.json'),JSON.stringify(targets,null,2)+'\n')
 const view=json("SELECT json_build_object('checksum',md5(pg_get_viewdef(oid,true)),'owner',pg_get_userbyid(relowner),'options',reloptions,'acl',relacl::text) FROM pg_class WHERE oid='public.aka_agent_staff_runtime_profile'::regclass;")
 fs.writeFileSync(path.join(root,'migrations/snapshots/staff-rls/local-view.json'),JSON.stringify(view,null,2)+'\n')
 for(const mode of ['share','update']){
  const child=spawn('psql',args,{stdio:['pipe','pipe','pipe']});let output='',errors=''
  child.stderr.on('data',x=>errors+=x);const done=new Promise((resolve,reject)=>{child.on('close',code=>code===0?resolve():reject(Error(errors)));child.on('error',reject)})
  const ready=new Promise((resolve,reject)=>{child.stdout.on('data',x=>{output+=x;if(output.includes('LOCKED'))resolve()});child.on('close',()=>{if(!output.includes('LOCKED'))reject(Error(errors))})})
  child.stdin.end(`BEGIN; SET ROLE anon; SELECT id FROM aka_agent_staff_runtime_scope(1,'${mode}'); SELECT 'LOCKED'; SELECT pg_sleep(1); COMMIT;`)
  await ready
  let timedOut=false;try{sql("SET lock_timeout='100ms'; UPDATE org_staff SET name='blocked' WHERE id=1;")}catch(e){timedOut=e.message.includes('lock timeout')}
  assert(timedOut,mode+' scope must retain row lock until transaction ends');await done;checks++
 }
 pass('shared/exclusive staff locks still serialize CRM mutation')
 const rollback=fs.readFileSync(path.join(root,'migrations/snapshots/staff-rls/rollback-activation.sql'),'utf8')
 let rollbackBlocked=false;try{sql(rollback)}catch(e){rollbackBlocked=e.message.includes('explicit rollback approval')};assert(rollbackBlocked)
 sql("SET aka_agent.staff_rls_rollback='approved-restore-legacy-access';\n"+rollback)
 assert.equal(sql("SELECT relrowsecurity FROM pg_class WHERE oid='org_staff'::regclass;").trim(),'f');assert.equal(sql("SELECT has_table_privilege('anon','org_staff','UPDATE');").trim(),'t');pass('guarded rollback restores legacy access')
 sql(fs.readFileSync(path.join(root,'migrations/snapshots/staff-rls/rollback-runtime.sql'),'utf8'))
 for(const f of patches)assert.equal(sql(`SELECT md5(pg_get_functiondef('public.${f.signature}'::regprocedure));`).trim(),f.checksum)
 pass('runtime rollback restores all 34 source definitions')
 const receipt={serverVersion,checks,productionChanged:false,productionDefaultAclFixture:true,viewAcl:view.acl,viewGuardDriftCases:drift.length,checkedViewGuards:2}
 fs.writeFileSync(path.join(root,`migrations/snapshots/staff-rls/sql-verification-pg${Math.floor(serverVersionNum/10000)}.json`),JSON.stringify(receipt,null,2)+'\n')
 console.log(JSON.stringify(receipt))
}finally{if(started)run('pg_ctl',['-D',path.join(tmp,'db'),'-m','immediate','stop']);fs.rmSync(tmp,{recursive:true,force:true})}

}
main().catch(e=>{console.error(e);process.exitCode=1})
