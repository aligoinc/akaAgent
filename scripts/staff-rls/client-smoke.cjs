const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'../..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'staff-client-'))
let checks=0
function load(file,mocks={},globals={}){
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports,Buffer,AbortSignal,console:{warn(){},error(){}},process:{env:{},cwd:()=>root},require:n=>n in mocks?mocks[n]:require(n),...globals},{filename:file});return exports
}
const plain=x=>JSON.parse(JSON.stringify(x)),auth={username:'alice',password:'test-password'},profile={id:1,organization_id:10,username:'alice',is_active:true}
const result=(data,error=null)=>({abortSignal:()=>Promise.resolve({data,error})})
async function main(){
 let reply=profile,error=null,current={staffId:1,organizationId:10},credentials=auth,request
 const repo=load('src/main/data/repositories/staffClientRepository.ts',{'../supabaseClient':{getSupabaseClient:()=>({rpc:(name,args)=>{request={name,args};return result(reply,error)}})},'../currentUser':{requireCurrentUser:()=>current,requireCurrentUserCredentials:()=>credentials,getCurrentUser:()=>current,getCurrentUserCredentials:()=>credentials}})
 assert.equal((await repo.callCurrentStaffClient('read')).id,1);assert.equal(request.args.p_data.staffId,1);checks++
 for(const data of [{...profile,password:'leak'},{...profile,id:2},{...profile,username:'other'},{...profile,organization_id:20},null]){reply=data;await assert.rejects(repo.callCurrentStaffClient('read'));checks++}
 reply=profile;error={message:'raw SQL test-password',code:'XX000'};await assert.rejects(repo.callCurrentStaffClient('read'),e=>!e.message.includes('test-password'));checks++;error=null
 let complete
 const fenced=load('src/main/data/repositories/staffClientRepository.ts',{'../supabaseClient':{getSupabaseClient:()=>({rpc:()=>({abortSignal:()=>new Promise(r=>complete=r)})})},'../currentUser':{requireCurrentUser:()=>current,requireCurrentUserCredentials:()=>credentials,getCurrentUser:()=>current,getCurrentUserCredentials:()=>credentials}})
 const pending=fenced.callCurrentStaffClient('read');credentials={...auth};complete({data:profile,error:null});await assert.rejects(pending);checks++
 let registrations=[],recoverResult=null,recoverError=null,calls=0
 const device=load('src/main/services/staffDeviceRecovery.ts',{'electron':{app:{getPath:()=>tmp}},'../data/supabaseClient':{getSupabaseClient:()=>({rpc:(name,args)=>{calls++;request={name,args};return result(recoverResult,recoverError)}})},'../data/repositories/staffClientRepository':{callStaffClient:async(...args)=>registrations.push(plain(args))}})
 assert.equal(await device.recoverStaffDeviceCredentials('a'.repeat(64)),null);assert.equal(calls,0);checks++
 await device.registerStaffDeviceRecovery(auth,1,'a'.repeat(64));const key=fs.readFileSync(path.join(tmp,'staff-device-recovery-v1.key'),'utf8');assert.match(key,/^[a-f0-9]{64}$/);assert.equal(fs.statSync(path.join(tmp,'staff-device-recovery-v1.key')).mode&0o777,0o600);assert.equal(registrations[0][2].secretHash,crypto.createHash('sha256').update(key).digest('hex'));assert(!JSON.stringify(registrations[0][2]).includes(key));checks++
 await device.registerStaffDeviceRecovery(auth,1,'a'.repeat(64));assert.equal(registrations[1][2].secretHash,registrations[0][2].secretHash);checks++
 recoverResult=auth;assert.deepEqual(plain(await device.recoverStaffDeviceCredentials('a'.repeat(64))),auth);assert.equal(request.args.p_secret,key);checks++
 recoverResult=null;await assert.rejects(device.recoverStaffDeviceCredentials('a'.repeat(64)));checks++
 recoverResult={legacyRecoveryAllowed:false};assert.equal(await device.legacyStaffRecoveryAllowed(),false);recoverResult={legacyRecoveryAllowed:true};assert.equal(await device.legacyStaffRecoveryAllowed(),true);checks++
 recoverError={message:'network'};await assert.rejects(device.legacyStaffRecoveryAllowed());checks++
 // Exercise the real filesystem; fake only the credential-verifying RPC and
 // specific I/O failure points. Each fixture owns its own userData directory.
 const fingerprint='a'.repeat(64),keyName='staff-device-recovery-v1.key'
 function recoveryFixture(name,initial,overrides={}){
   const directory=path.join(tmp,name);fs.mkdirSync(directory)
   const target=path.join(directory,keyName)
   if(initial!==undefined)fs.writeFileSync(target,initial,{mode:0o600})
   const state={registrations:[],reads:0,enrolledHash:null,beforeRegister:null,lostResponse:false}
   const mocks={electron:{app:{getPath:()=>directory}},'node:fs/promises':{...fs.promises,...overrides},
     '../data/repositories/staffClientRepository':{callStaffClient:async(credentials,action,input)=>{
       state.registrations.push(plain(input));assert.equal(action,'register_recovery')
       if(credentials.password!==auth.password||input.fingerprintHash!==fingerprint)throw Error('invalid auth or binding')
       if(state.beforeRegister)await state.beforeRegister()
       state.enrolledHash=input.secretHash
       if(state.lostResponse){state.lostResponse=false;throw Error('response lost')}
       return profile
     }},
     '../data/supabaseClient':{getSupabaseClient:()=>({rpc:(_name,args)=>{
       state.reads++
       const valid=crypto.createHash('sha256').update(args.p_secret).digest('hex')===state.enrolledHash&&args.p_fingerprint_hash===fingerprint
       return result(valid?auth:null,valid?null:{message:'invalid proof'})
     }})}}
   const reload=()=>load('src/main/services/staffDeviceRecovery.ts',mocks)
   return {directory,target,state,reload,device:reload(),read:()=>fs.readFileSync(target,'utf8'),clean:()=>assert.deepEqual(fs.readdirSync(directory),fs.existsSync(target)?[keyName]:[])}
 }
 for(const [name,initial] of [['empty',''],['malformed','partial-key']]){
   const f=recoveryFixture(name,initial)
   await assert.rejects(f.device.recoverStaffDeviceCredentials(fingerprint));assert.equal(f.state.reads,0);assert.equal(f.read(),initial);checks++
   await assert.rejects(f.device.registerStaffDeviceRecovery({...auth,password:'wrong'},1,fingerprint));assert.equal(f.read(),initial);f.clean();checks++
   await assert.rejects(f.device.registerStaffDeviceRecovery(auth,1,'c'.repeat(64)));assert.equal(f.read(),initial);f.clean();checks++
   f.state.beforeRegister=async()=>{
     assert.equal(f.read(),initial)
     const staged=fs.readdirSync(f.directory).find(file=>file.endsWith('.tmp'));assert(staged)
     assert.match(fs.readFileSync(path.join(f.directory,staged),'utf8'),/^[a-f0-9]{64}$/)
     assert.equal(fs.statSync(path.join(f.directory,staged)).mode&0o777,0o600)
   }
   await f.device.registerStaffDeviceRecovery(auth,1,fingerprint);assert.match(f.read(),/^[a-f0-9]{64}$/);f.clean();checks++
   assert.deepEqual(plain(await f.device.recoverStaffDeviceCredentials(fingerprint)),auth);checks++
   assert.deepEqual(plain(await f.reload().recoverStaffDeviceCredentials(fingerprint)),auth);checks++
 }
 const missing=recoveryFixture('missing-rejected')
 await assert.rejects(missing.device.registerStaffDeviceRecovery({...auth,password:'wrong'},1,fingerprint));assert(!fs.existsSync(missing.target));missing.clean();checks++
 const concurrent=recoveryFixture('concurrent','')
 await Promise.all(Array.from({length:10},()=>concurrent.device.registerStaffDeviceRecovery(auth,1,fingerprint)))
 assert.equal(new Set(concurrent.state.registrations.map(x=>x.secretHash)).size,1);concurrent.clean();assert.deepEqual(plain(await concurrent.device.recoverStaffDeviceCredentials(fingerprint)),auth);checks++
 const queued=recoveryFixture('failed-then-valid','')
 const settled=await Promise.allSettled([queued.device.registerStaffDeviceRecovery({...auth,password:'wrong'},1,fingerprint),queued.device.registerStaffDeviceRecovery(auth,1,fingerprint)])
 assert.deepEqual(settled.map(x=>x.status),['rejected','fulfilled']);assert.deepEqual(plain(await queued.device.recoverStaffDeviceCredentials(fingerprint)),auth);queued.clean();checks++
 for(const code of ['EACCES','EIO']){
   const f=recoveryFixture(code,'d'.repeat(64),{readFile:async()=>{throw Object.assign(Error('read failed'),{code})}})
   await assert.rejects(f.device.registerStaffDeviceRecovery(auth,1,fingerprint));assert.equal(f.state.registrations.length,0);assert.equal(f.read(),'d'.repeat(64));f.clean();checks++
 }
 for(const operation of ['open','writeFile','sync','close','rename']){
   let fail=true
   const overrides={open:async(...args)=>{
     if(operation==='open'&&fail){fail=false;throw Error('open failed')}
     const handle=await fs.promises.open(...args)
     return {
       writeFile:async(value)=>{if(operation==='writeFile'&&fail){fail=false;await handle.writeFile(value.slice(0,8));throw Error('partial write')}await handle.writeFile(value)},
       sync:async()=>{if(operation==='sync'&&fail){fail=false;throw Error('sync failed')}await handle.sync()},
       close:async()=>{await handle.close();if(operation==='close'&&fail){fail=false;throw Error('close failed')}}
     }
   },rename:async(...args)=>{if(operation==='rename'&&fail){fail=false;throw Error('rename failed')}await fs.promises.rename(...args)}}
   const f=recoveryFixture('io-'+operation,'broken',overrides)
   await assert.rejects(f.device.registerStaffDeviceRecovery(auth,1,fingerprint));assert.equal(f.read(),'broken');assert.equal(f.state.registrations.length,operation==='rename'?1:0);f.clean();checks++
   await f.device.registerStaffDeviceRecovery(auth,1,fingerprint);assert.deepEqual(plain(await f.device.recoverStaffDeviceCredentials(fingerprint)),auth);f.clean();checks++
 }
 const lost=recoveryFixture('lost-response','broken');lost.state.lostResponse=true
 await assert.rejects(lost.device.registerStaffDeviceRecovery(auth,1,fingerprint));assert.equal(lost.read(),'broken');lost.clean();checks++
 await lost.reload().registerStaffDeviceRecovery(auth,1,fingerprint);assert.deepEqual(plain(await lost.device.recoverStaffDeviceCredentials(fingerprint)),auth);lost.clean();checks++
 const healthy=recoveryFixture('healthy-rejected','d'.repeat(64),{open:async()=>{throw Error('must not rewrite valid key')},rename:async()=>{throw Error('must not replace valid key')}})
 await assert.rejects(healthy.device.registerStaffDeviceRecovery({...auth,password:'wrong'},1,fingerprint));assert.equal(healthy.read(),'d'.repeat(64));checks++
 await healthy.device.registerStaffDeviceRecovery(auth,1,fingerprint);assert.equal(healthy.read(),'d'.repeat(64));assert.deepEqual(plain(await healthy.device.recoverStaffDeviceCredentials(fingerprint)),auth);healthy.clean();checks++
 // No direct-read fallback after cutover, an unknown status, or a token failure.
 for(const scenario of ['cutover','status-error','token-error']){
   let direct=0
   const authRepo=load('src/main/data/repositories/authRepository.ts',{'electron':{app:{getPath:()=>tmp}},'../../services/deviceBindingMigration':{},'../supabaseClient':{getSupabaseClient:()=>({from:()=>{direct++;throw Error('direct')}})},'../currentUser':{},'./staffClientRepository':{},'./staffManagementRepository':{},'./entitlementRepository':{},'../../services/deviceIdentity':{getCurrentDeviceIdentity:async()=>({fingerprintHash:'a'.repeat(64)})},'../../services/staffDeviceRecovery':{recoverStaffDeviceCredentials:async()=>{if(scenario==='token-error')throw Error('proof');return null},legacyStaffRecoveryAllowed:async()=>{if(scenario==='status-error')throw Error('network');return false}},'../../services/deviceChangeService':{},'./zaloRuntimeModeRepository':{}})
   await assert.rejects(authRepo.recoverDeviceCredentials());assert.equal(direct,0);checks++
 }
 // Install-only Server startup, host override/rotation, and fail-closed errors.
 for(const scenario of ['env','file','bundle','dev','missing','invalid','empty','unreadable']){
   let seen
   const directory=path.join(tmp,'server-'+scenario),resources=path.join(directory,'resources')
   fs.mkdirSync(path.join(resources,'server-private'),{recursive:true})
   if(scenario!=='missing')fs.writeFileSync(path.join(resources,'server-private','supabase-server-secret.key'),'sb_secret_bundle\n')
   if(['env','file','invalid','empty'].includes(scenario))fs.writeFileSync(path.join(directory,'supabase-server-secret.key'),scenario==='invalid'?'bad':scenario==='empty'?'':'sb_secret_file\n')
   const loader=load('src/server/main/serverDatabaseAccess.ts',{'node:fs':scenario==='unreadable'?{readFileSync:()=>{throw Object.assign(Error('access'),{code:'EACCES'})}}:fs,'../../main/data/supabaseClient':{configureTrustedServerSupabase:v=>{seen=v;if(v==='bad')throw Error('invalid')}}},{process:{env:scenario==='env'?{AKA_AGENT_SERVER_SUPABASE_SECRET_KEY:'sb_secret_env'}:{}}})
   const start=()=>loader.configureServerDatabaseAccess(directory,scenario==='dev'?undefined:resources)
   if(['dev','missing','invalid','empty','unreadable'].includes(scenario))assert.throws(start)
   else{start();assert.equal(seen,'sb_secret_'+scenario)}checks++
 }
 // Shared client requires explicit Server initialization; merely having an env
 // secret cannot promote Desktop. No browser auth session replaces backend key.
 let created
 const make=()=>load('src/main/data/supabaseClient.ts',{'@supabase/supabase-js':{createClient:(url,key,options)=>(created={url,key,options})},dotenv:{config(){}},ws:class{}},{process:{env:{SUPABASE_ANON_KEY:'public-fixture',AKA_AGENT_SERVER_SUPABASE_SECRET_KEY:'sb_secret_not_for_desktop'},cwd:()=>tmp}})
 const desktop=make();desktop.getSupabaseClient();assert.equal(created.key,'public-fixture');assert.throws(()=>desktop.configureTrustedServerSupabase('sb_secret_late'));checks++
 const server=make();assert.throws(()=>server.configureTrustedServerSupabase('public-fixture'));server.configureTrustedServerSupabase('sb_secret_server');server.getSupabaseClient();assert.equal(created.key,'sb_secret_server');assert.equal(created.options.auth.persistSession,false);checks++
 console.log(`Staff RLS client smoke passed: ${checks} checks`)
}
main().finally(()=>fs.rmSync(tmp,{recursive:true,force:true})).catch(e=>{console.error(e);process.exitCode=1})
