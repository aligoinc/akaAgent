// Real isolated PostgreSQL. No production writes, customer credentials or new runtime connection pool.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict')
const {spawnSync,spawn}=require('node:child_process'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aka-device-v3-'))
const read=p=>fs.readFileSync(path.join(root,p),'utf8'), source=JSON.parse(read('migrations/snapshots/device-identity-v3/source.json'))
const migration=read('supabase/migrations/20261027071650_device_identity_v3.sql')
let started=false,checks=0
const run=(cmd,args,input)=>{const r=spawnSync(cmd,args,{encoding:'utf8',input,maxBuffer:32*1024*1024});if(r.status!==0)throw Error((r.stderr||r.stdout).slice(-6000));return r.stdout}
const args=['-X','-h',tmp,'-p','55479','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq']
const sql=s=>run('psql',args,s),q=s=>"'"+String(s).replaceAll("'","''")+"'",json=s=>JSON.parse(sql(s).trim())
const pass=s=>{checks++;console.log('PASS',s)}
const hash=n=>n.toString(16).padStart(64,'0'), uuid=()=>crypto.randomUUID()
const input=(id,newHash,oldHash,source='automatic')=>({staffId:id,fingerprintHash:newHash,legacyHash:oldHash,source})
const call=(id,action,data,pw=`pw-${id}`)=>`public.aka_agent_staff_client('u${id}',${q(pw)},${q(action)},${q(JSON.stringify(data))}::jsonb)`
const invoke=(id,action,data)=>json(`SET ROLE anon; SELECT ${call(id,action,data)};`)
const prep=(id,h,old,src)=>invoke(id,'prepare_device_v3',input(id,h,old,src))
const bind=(id,h,old,src,p,requestId=uuid())=>invoke(id,'bind_device_v3',{...input(id,h,old,src),requestId,expected:p.deviceV3.binding})
const rejects=(s,message)=>{let failed=false;try{sql(s)}catch(e){failed=!message||e.message.includes(message)}assert(failed,`expected rejection: ${message}`);checks++}
const concurrent=commands=>Promise.all(commands.map(s=>new Promise((resolve,reject)=>{const p=spawn('psql',args);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('close',code=>code?reject(Error(err)):resolve(out.trim()));p.stdin.end(s)})))
async function main(){try{
 run('initdb',['-D',path.join(tmp,'db'),'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
 run('pg_ctl',['-D',path.join(tmp,'db'),'-l',path.join(tmp,'pg.log'),'-o',`-h '' -k ${tmp} -p 55479 -c max_connections=10`,'-w','start']);started=true
 const cols=JSON.parse(read('migrations/snapshots/staff-rls/columns.json'))
 const defs=cols.map(c=>`"${c.name}" ${c.type}${c.not_null?' NOT NULL':''}${c.default_expression?' DEFAULT '+c.default_expression:''}`).join(',')
 sql(`CREATE SCHEMA private; CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public,extensions TO anon,authenticated,service_role;
 CREATE TABLE org_staff(${defs},PRIMARY KEY(id),UNIQUE(username)); CREATE TABLE org_organization(id bigint PRIMARY KEY,name text,use_staff_expiration boolean DEFAULT false);
 GRANT ALL ON org_staff TO anon,authenticated,service_role; GRANT SELECT ON org_organization TO anon,authenticated;
 ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
 INSERT INTO org_organization VALUES(1,'fixture',false),(2,'other',false);
 INSERT INTO org_staff(id,organization_id,name,phone,username,password,is_active,is_policy_accepted) SELECT n,CASE WHEN n%2=0 THEN 2 ELSE 1 END,'test','0','u'||n,'pw-'||n,true,true FROM generate_series(1,20)n;`)
 const time=source.find(r=>r.signature==='aka_agent_staff_time_allowed(bigint)')
 sql(time.definition+';')
 sql(read('supabase/migrations/20261027044346_staff_rls_client_api.sql'))
 const deviceCols=JSON.parse(read('migrations/snapshots/device-identity-v3/device-columns.json'))
 for(const table of [...new Set(deviceCols.map(c=>c.table_name))]){
  sql(`CREATE TABLE public.${table}(${deviceCols.filter(c=>c.table_name===table).map(c=>`"${c.name}" ${c.type}${c.not_null?' NOT NULL':''}${c.default_expression&&!c.default_expression.includes('nextval')?' DEFAULT '+c.default_expression:''}`).join(',')});`)
 }
 sql('ALTER TABLE auto_staff_device_presence ADD PRIMARY KEY(instance_id); ALTER TABLE auto_staff_device_change_history ADD PRIMARY KEY(request_id);')
 for(const r of source){const sig=r.signature.startsWith('private.')?r.signature:'public.'+r.signature;sql(r.definition+`; REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,anon,authenticated,service_role;`+(r.acl.slice(1,-1).split(',').filter(Boolean).map(x=>`GRANT EXECUTE ON FUNCTION ${sig} TO ${x.split('=')[0]||'PUBLIC'};`).join('\n')))}
 sql(`UPDATE org_staff SET aka_agent_device_fingerprint_hash='${hash(1)}' WHERE id=1; UPDATE org_staff SET aka_agent_device_fingerprint_hash='${hash(2)}' WHERE id IN (2,3); UPDATE org_staff SET is_active=false,deleted_at=now() WHERE id=3;`)
 // Fail closed on definition drift before changing any table.
 rejects(`BEGIN; ALTER FUNCTION public.aka_agent_staff_client(text,text,text,jsonb) SET lock_timeout='4s'; ${migration.replace(/^BEGIN;|^COMMIT;/gm,'')} ROLLBACK;`,'device v3 source drift')
 // Migration rehearsed inside rollback before installing only in this disposable database.
 sql(migration.replace(/^COMMIT;/m,'ROLLBACK;'));assert.equal(sql("SELECT to_regclass('private.aka_agent_device_collisions') IS NULL;").trim(),'t');pass('migration rollback leaves no schema or business changes')
 sql(migration)
 assert.equal(sql("SELECT count(*) FROM private.aka_agent_device_collisions WHERE version=2;").trim(),'1');pass('v2 collision snapshot includes inactive/deleted cross-organization staff')
 const old=hash(1),new1=hash(101),p=prep(1,new1,old);assert.equal(p.deviceV3.decision,'allowed');const id=uuid()
 const result=bind(1,new1,old,'automatic',p,id);assert.equal(result.deviceV3.binding.version,3);assert.equal(result.deviceV3.automaticAllowed,true)
 assert.equal(bind(1,new1,old,'automatic',p,id).deviceV3.decision,'allowed');assert.equal(sql(`SELECT count(*) FROM private.aka_agent_device_migrations WHERE staff_id=1;`).trim(),'1');pass('clean update/replay migrates same staff once and preserves quota')
 assert.equal(sql('SELECT device_changes_remaining FROM org_staff WHERE id=1;').trim(),'5')
 assert.equal(prep(2,hash(102),hash(2)).deviceV3.decision,'manual_login_required');sql('UPDATE org_staff SET aka_agent_device_fingerprint_hash=NULL WHERE id=3;');assert.equal(prep(2,hash(102),hash(2)).deviceV3.decision,'manual_login_required');pass('collision mark survives the group shrinking to one')
 const manual=prep(2,hash(102),hash(2),'manual');assert.equal(bind(2,hash(102),hash(2),'manual',manual).deviceV3.automaticAllowed,true);assert.equal(prep(2,hash(102),hash(2)).deviceV3.decision,'allowed');pass('manual confirmation migrates a duplicate v2 account to clean v3')
 const a=prep(4,hash(104),null,'manual');bind(4,hash(104),null,'manual',a)
 assert.equal(prep(5,hash(104),null).deviceV3.decision,'manual_login_required');const b=prep(5,hash(104),null,'manual');assert.equal(bind(5,hash(104),null,'manual',b).deviceV3.automaticAllowed,false);assert.equal(prep(4,hash(104),null).deviceV3.decision,'manual_login_required');pass('v3 collision allows manual credentials only for both accounts')
 const token='e'.repeat(64),secretHash=crypto.createHash('sha256').update(token).digest('hex')
 invoke(1,'register_recovery',{staffId:1,fingerprintHash:new1,secretHash});const recovery=()=>json(`SET ROLE anon; SELECT public.aka_agent_recover_staff_credentials('${token}','${new1}');`)
 assert.equal(recovery().username,'u1');sql(`INSERT INTO private.aka_agent_device_collisions(version,fingerprint_hash) VALUES(3,'${new1}');`);assert.equal(recovery().status,'manual_login_required');pass('proof recovery refuses a sticky collision without returning credentials')
 // A local proof enrolled before v3 is valid only against the old binding until
 // credential-authenticated migration commits. The client may retry that proof,
 // never a fingerprint-only lookup, and must retain source=recovery throughout.
 const oldProofHash=hash(119),upgradedProofHash=hash(219),oldProof='d'.repeat(64)
 const oldSecretHash=crypto.createHash('sha256').update(oldProof).digest('hex')
 sql(`UPDATE org_staff SET aka_agent_device_fingerprint_hash='${oldProofHash}' WHERE id=19;`)
 invoke(19,'register_recovery',{staffId:19,fingerprintHash:oldProofHash,secretHash:oldSecretHash})
 const recoverProof=(token,h)=>json(`SET ROLE anon; SELECT public.aka_agent_recover_staff_credentials('${token}','${h}');`)
 rejects(`SET ROLE anon; SELECT public.aka_agent_recover_staff_credentials('${oldProof}','${upgradedProofHash}');`,'staff_recovery_invalid')
 assert.equal(recoverProof(oldProof,oldProofHash).username,'u19')
 const fromProof=prep(19,upgradedProofHash,oldProofHash,'recovery')
 assert.equal(bind(19,upgradedProofHash,oldProofHash,'recovery',fromProof).deviceV3.automaticAllowed,true)
 invoke(19,'register_recovery',{staffId:19,fingerprintHash:upgradedProofHash,secretHash:oldSecretHash})
 assert.equal(recoverProof(oldProof,upgradedProofHash).username,'u19')
 assert.equal(sql('SELECT device_changes_remaining FROM org_staff WHERE id=19;').trim(),'5')
 rejects(`SET ROLE anon; SELECT public.aka_agent_recover_staff_credentials('${oldProof}','${oldProofHash}');`,'staff_recovery_invalid')
 pass('v2 proof upgrades correct account to v3, reenrolls same secret and preserves quota')
 const sharedOldHash=hash(120),sharedProof='c'.repeat(64)
 sql(`UPDATE org_staff SET aka_agent_device_fingerprint_hash='${sharedOldHash}' WHERE id=20;`)
 invoke(20,'register_recovery',{staffId:20,fingerprintHash:sharedOldHash,secretHash:crypto.createHash('sha256').update(sharedProof).digest('hex')})
 sql(`UPDATE org_staff SET aka_agent_device_fingerprint_hash='${sharedOldHash}' WHERE id=18;`)
 assert.equal(recoverProof(sharedProof,sharedOldHash).status,'manual_login_required')
 sql('UPDATE org_staff SET aka_agent_device_fingerprint_hash=NULL WHERE id=18;')
 assert.equal(recoverProof(sharedProof,sharedOldHash).status,'manual_login_required')
 pass('v2 proof collision remains silent/manual after the group shrinks')
 for(const action of ['prepare_device_v3','bind_device_v3'])rejects(`SET ROLE anon; SELECT ${call(1,action,input(2,new1,old),'wrong')};`,'staff_client_auth_invalid')
 rejects(`SET ROLE anon; SELECT ${call(1,'bind_device',{staffId:1,fingerprintHash:old})};`,'staff_client_device_locked')
 rejects(`UPDATE org_staff SET aka_agent_device_identity_version=2 WHERE id=1;`,'staff_client_device_locked')
 assert.equal(prep(2,hash(999),hash(102),'manual').deviceV3.decision,'device_locked');pass('credentials/staff guard, downgrade guard and v3 cannot use migration to change machines')
 const stale=prep(6,hash(106),null,'manual');sql(`UPDATE org_staff SET aka_agent_device_fingerprint_hash='${hash(60)}' WHERE id=6;`);assert.equal(bind(6,hash(106),null,'manual',stale).deviceV3.decision,'device_locked')
 const pw=prep(7,hash(107),null,'manual');sql("UPDATE org_staff SET password='changed' WHERE id=7;");rejects(`SET ROLE anon; SELECT ${call(7,'bind_device_v3',{...input(7,hash(107),null,'manual'),requestId:uuid(),expected:pw.deviceV3.binding})};`,'staff_client_auth_invalid');pass('reset/rebind and password races reject stale writes')
 // No two parallel enrollments can miss each other. Test actual different SQL sessions.
 const c1=prep(8,hash(108),null,'manual'),c2=prep(9,hash(108),null,'manual')
 await concurrent([8,9].map((n,i)=>`BEGIN; SET LOCAL ROLE anon; SELECT ${call(n,'bind_device_v3',{...input(n,hash(108),null,'manual'),requestId:uuid(),expected:[c1,c2][i].deviceV3.binding})}; SELECT pg_sleep(0.15); COMMIT;`))
 assert.equal(prep(8,hash(108),null).deviceV3.decision,'manual_login_required');assert.equal(prep(9,hash(108),null).deviceV3.decision,'manual_login_required');pass('simultaneous registrations serialize by fingerprint and mark collision')
 // Existing reset/presence contracts still operate on the v3 hash (protocol bindingVersion remains 2).
 const resetHash=hash(110),resetInput=prep(10,resetHash,null,'manual'),resetMigrationId=uuid();bind(10,resetHash,null,'manual',resetInput,resetMigrationId)
 const device={fingerprintHash:resetHash,label:'test-device',platform:'win',appVersion:'fixture'}
 const instance=uuid(),presence=ended=>`public.aka_agent_device_presence('u10','pw-10','${instance}',${q(JSON.stringify(device))}::jsonb,${ended})`
 sql(`SET ROLE anon; SELECT ${presence(false)};`)
 const prepareReset=()=>json("SET ROLE anon; SELECT public.aka_agent_prepare_device_change_v2('u10');").binding
 const reset=(source,requestId,binding,pw=null)=>json(`SET ROLE anon; SELECT public.aka_agent_reset_device_binding_v2('u10',${pw===null?'NULL':q(pw)},${q(source)},'${requestId}',${q(JSON.stringify(binding))}::jsonb,${q(JSON.stringify(device))}::jsonb);`)
 let resetBinding=prepareReset();assert.equal(reset('login',uuid(),resetBinding).code,'device_online')
 sql(`SET ROLE anon; SELECT ${presence(true)};`);resetBinding=prepareReset();const resetId=uuid()
 assert.equal(reset('login',resetId,resetBinding).remainingChanges,4);assert.equal(reset('login',resetId,resetBinding).remainingChanges,4)
 assert.equal(sql('SELECT aka_agent_device_identity_version FROM org_staff WHERE id=10;').trim(),'3')
 const rebound=prep(10,resetHash,null,'manual');bind(10,resetHash,null,'manual',rebound)
 assert.equal(bind(10,resetHash,null,'manual',resetInput,resetMigrationId).deviceV3.decision,'device_locked','old receipt cannot cross a reset/rebind epoch')
 resetBinding=prepareReset();assert.equal(reset('account_menu',uuid(),resetBinding,'wrong').code,'not_authorized');assert.equal(reset('account_menu',uuid(),resetBinding,'pw-10').remainingChanges,4)
 pass('v3 preserves online guard, menu auth, reset quota/idempotency and rejects pre-reset migration replay')
 // Exercise the real reset client against PostgreSQL, losing the response AFTER
 // commit, then restarting while hardware now reports a different hash.
 const resetClientFile=path.join(tmp,'reset-client.cjs')
 require('esbuild').buildSync({entryPoints:[path.join(root,'src/main/services/deviceChangeRequest.ts')],outfile:resetClientFile,bundle:true,platform:'node',format:'cjs',target:'node20',logLevel:'warning'})
 const {DeviceChangeRequestClient}=require(resetClientFile)
 const reviewHash=hash(117),auditHash=hash(917),reviewPrepared=prep(17,reviewHash,null,'manual');bind(17,reviewHash,null,'manual',reviewPrepared)
 const reviewAttempts=[];let reviewDeviceReads=0,reviewPrepares=0,reviewLost=true
 const reviewDevice={fingerprintHash:auditHash,label:'reset-audit',platform:'win',appVersion:'fixture'}
 const reviewOptions={directory:path.join(tmp,'review-reset'),bindingVersion:2,getDevice:async()=>{reviewDeviceReads++;return reviewDevice},rpc:async(name,args)=>{
  if(name==='aka_agent_prepare_device_change_v2'){reviewPrepares++;return json("SET ROLE anon; SELECT public.aka_agent_prepare_device_change_v2('u17');")}
  assert.equal(name,'aka_agent_reset_device_binding_v2');reviewAttempts.push(args)
  const response=json(`SET ROLE anon; SELECT public.aka_agent_reset_device_binding_v2('u17',NULL,'login','${args.p_request_id}',${q(JSON.stringify(args.p_expected_binding))}::jsonb,${q(JSON.stringify(args.p_device))}::jsonb);`)
  if(reviewLost)throw Error('response lost after DB commit')
  return response
 }}
 await assert.rejects(new DeviceChangeRequestClient(reviewOptions).reset('u17','login'))
 assert.equal(sql('SELECT device_changes_remaining FROM org_staff WHERE id=17;').trim(),'4')
 reviewLost=false
 const reviewed=await new DeviceChangeRequestClient({...reviewOptions,getDevice:async()=>{throw Error('hardware must not be read on replay')}}).reset('u17','login')
 assert.equal(reviewed.code,'changed');assert.equal(reviewed.remainingChanges,4)
 assert.equal(reviewDeviceReads,1);assert.equal(reviewPrepares,1)
 assert.deepEqual(reviewAttempts[1],reviewAttempts[0]);assert.equal(fs.readdirSync(reviewOptions.directory).length,0)
 assert.equal(sql('SELECT count(*) FROM auto_staff_device_change_history WHERE staff_id=17;').trim(),'1')
 pass('real reset client replays identical audit payload after lost DB commit/restart with one quota charge')
 const reviewAgain=prep(17,reviewHash,null,'manual');bind(17,reviewHash,null,'manual',reviewAgain)
 const reviewBinding=json("SET ROLE anon; SELECT public.aka_agent_prepare_device_change_v2('u17');").binding
 const menuAudit=json(`SET ROLE anon; SELECT public.aka_agent_reset_device_binding_v2('u17','pw-17','account_menu','${uuid()}',${q(JSON.stringify(reviewBinding))}::jsonb,${q(JSON.stringify(reviewDevice))}::jsonb);`)
 assert.equal(menuAudit.code,'not_authorized');assert.equal(sql('SELECT device_changes_remaining FROM org_staff WHERE id=17;').trim(),'4')
 pass('reset audit cannot bypass the account-menu bound-machine guard')
 sql("UPDATE org_organization SET use_staff_expiration=true WHERE id=1; UPDATE org_staff SET expiration_date=now()-interval '1 day' WHERE id=11;")
 rejects(`SET ROLE anon; SELECT ${call(11,'prepare_device_v3',input(11,hash(111),null,'manual'))};`,'staff_client_expired')
 sql('UPDATE org_staff SET is_active=false WHERE id=12;');rejects(`SET ROLE anon; SELECT ${call(12,'prepare_device_v3',input(12,hash(112),null,'manual'))};`,'staff_client_inactive')
 sql('UPDATE org_staff SET is_policy_accepted=false WHERE id=14;');const policy=prep(14,hash(114),null,'manual')
 rejects(`SET ROLE anon; SELECT ${call(14,'bind_device_v3',{...input(14,hash(114),null,'manual'),requestId:uuid(),expected:policy.deviceV3.binding})};`,'staff_client_policy_required')
 const valid=prep(16,hash(116),null,'manual')
 for(const expected of [{...valid.deviceV3.binding,version:null},{...valid.deviceV3.binding,hash:'invalid'},{...valid.deviceV3.binding,revision:'bad'}])rejects(`SET ROLE anon; SELECT ${call(16,'bind_device_v3',{...input(16,hash(116),null,'manual'),requestId:uuid(),expected})};`,'staff_client_invalid_input')
 pass('inactive, expiry, policy and malformed CAS guards remain fail closed')
 for(const role of ['anon','authenticated'])for(const table of ['aka_agent_device_collisions','aka_agent_device_migrations'])rejects(`SET ROLE ${role}; SELECT * FROM private.${table};`,'permission denied')
 for(const r of source){const sig=r.signature.startsWith('private.')?r.signature:'public.'+r.signature;const actual=json(`SELECT json_build_object('acl',proacl::text,'owner',pg_get_userbyid(proowner),'security_definer',prosecdef,'volatility',provolatile,'config',proconfig,'checksum',md5(pg_get_functiondef(oid))) FROM pg_proc WHERE oid='${sig}'::regprocedure;`);for(const k of ['acl','owner','security_definer','volatility','config'])assert.deepEqual(actual[k],r[k]);if(!['aka_agent_staff_client(text,text,text,jsonb)','aka_agent_recover_staff_credentials(text,text)'].includes(r.signature))assert.equal(actual.checksum,r.checksum)}pass('all existing function ACL/owner/config preserved; reset/presence/time guards unchanged')
 const target=json("SELECT coalesce(json_agg(json_build_object('signature',p.oid::regprocedure::text,'checksum',md5(pg_get_functiondef(p.oid)),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl::text) ORDER BY p.oid::regprocedure::text),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid IN ('public.aka_agent_staff_client(text,text,text,jsonb)'::regprocedure,'public.aka_agent_recover_staff_credentials(text,text)'::regprocedure,'private.aka_agent_device_v3(bigint,text,jsonb)'::regprocedure,'private.aka_agent_device_ambiguous(smallint,text,bigint,boolean)'::regprocedure,'private.aka_agent_track_device_binding()'::regprocedure);")
 fs.writeFileSync(path.join(root,'migrations/snapshots/device-identity-v3/local-target.json'),JSON.stringify(target,null,2)+'\n')
 console.log(`${checks} SQL checks passed (isolated PostgreSQL ${sql('SHOW server_version').trim()})`)
}finally{if(started)run('pg_ctl',['-D',path.join(tmp,'db'),'-m','immediate','-w','stop']);fs.rmSync(tmp,{recursive:true,force:true})}}
main().catch(e=>{console.error(e.message);process.exitCode=1})
