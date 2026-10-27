// Real managed Auth engine + SDK + Desktop transport. All credentials/data are
// random local fixtures; no production project or email delivery is contacted.
// Prerequisite: official Supabase Auth v2.197.0 darwin-arm64 release, verified
// SHA256 3fb7998e7061e2c14f3f9555b1d94d447358c965395728e0d81eac82e0e5868b.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),http=require('node:http'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process'),ts=require('typescript')
const {createClient}=require('@supabase/supabase-js'),{createFixture}=require('./full-fixture.cjs')
const authDir=process.env.DESKTOP_TEST_AUTH_DIR||'/tmp/aka-agent-session-auth-20261027'
assert(fs.existsSync(path.join(authDir,'auth')),'Set DESKTOP_TEST_AUTH_DIR to the verified official Auth distribution')
const f=createFixture(),{sql,quote:q}=f,root=f.root,port=55519,authUrl=`http://127.0.0.1:${port}`
const secret=crypto.randomBytes(48).toString('hex'),key=(()=>{const head=Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),body=Buffer.from(JSON.stringify({role:'service_role',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');return head+'.'+body+'.'+crypto.createHmac('sha256',secret).update(head+'.'+body).digest('base64url')})()
function load(relative,modules={}){const exports={};const compiled=ts.transpileModule(fs.readFileSync(path.join(root,relative),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(compiled,{exports,require:n=>modules[n]||require(n),Buffer,fetch,Request,Response,Headers,AbortSignal,AbortController,TextDecoder,crypto:globalThis.crypto,atob,setTimeout,clearTimeout,Date,Error,Promise,Number,JSON});return exports}
const sessionModule=load('src/main/data/desktopSession.ts')
const {createDesktopSessionTransport}=load('src/main/data/desktopSessionTransport.ts',{'./desktopSession':sessionModule})
const {createSessionHandler}=load('supabase/functions/aka-agent-desktop-session/handler.ts')
let auth,server,log='',checks=0,tokenRequests=0
const pass=s=>{checks++;console.log('PASS',s)}
const read=async req=>{const chunks=[];for await(const c of req)chunks.push(c);return Buffer.concat(chunks)}
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Local fault barrier timed out')),10000)})])}finally{clearTimeout(timer)}}
async function main(){
 sql('DROP SCHEMA auth CASCADE; CREATE SCHEMA auth; GRANT ALL ON SCHEMA auth TO supabase_auth_admin;')
 const authEnv={...process.env,
   GOTRUE_JWT_SECRET:secret,GOTRUE_JWT_EXP:'3600',GOTRUE_JWT_AUD:'authenticated',GOTRUE_JWT_ADMIN_ROLES:'service_role',
   GOTRUE_DB_DRIVER:'postgres',DATABASE_URL:`postgres://postgres@localhost/postgres?host=${encodeURIComponent(f.tmp)}&port=55494&sslmode=disable&search_path=auth%2Cpublic`,DB_NAMESPACE:'auth',
   GOTRUE_API_HOST:'127.0.0.1',PORT:String(port),API_EXTERNAL_URL:authUrl,GOTRUE_SITE_URL:'http://127.0.0.1',
   GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'true',GOTRUE_DISABLE_SIGNUP:'true',
   GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED:'true',GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL:'10',GOTRUE_LOG_LEVEL:'error'
 }
 const migrated=spawnSync(path.join(authDir,'auth'),['migrate'],{cwd:authDir,env:authEnv,encoding:'utf8'})
 if(migrated.status!==0)throw Error('Local Auth migration: '+migrated.stderr+' '+migrated.stdout)
 auth=spawn(path.join(authDir,'auth'),['serve'],{cwd:authDir,env:authEnv,stdio:['ignore','pipe','pipe']})
 auth.stdout.on('data',x=>{log=(log+x).slice(-10000)});auth.stderr.on('data',x=>{log=(log+x).slice(-10000)})
 let ready=false
 for(let i=0;i<100;i++){try{ready=(await fetch(authUrl+'/health')).ok}catch{}if(ready)break;if(auth.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,100))}
 if(!ready)throw Error('Local Auth did not start: '+log)
 sql(f.localActivation(fs.readFileSync(path.join(root,'supabase/migrations/20261027095004_desktop_session_identity.sql'),'utf8')))
 const fingerprintHash='a'.repeat(64),credentials={username:'fixture-user',password:'local-only-password',fingerprintHash}
 sql(`INSERT INTO org_organization(id,name,use_staff_expiration) VALUES(10,'Local fixture',false);
 INSERT INTO org_staff(id,organization_id,username,password,is_active,is_policy_accepted,aka_agent_device_identity_version,aka_agent_device_fingerprint_hash,aka_agent_device_binding_revision)
 VALUES(1,10,'fixture-user','local-only-password',true,true,3,'${fingerprintHash}',1);`)
 let base,bindFailure,prepareRace
 const deletedUsers=[]
 server=http.createServer(async(req,res)=>{try{
   const body=await read(req),pathname=new URL(req.url,'http://127.0.0.1').pathname
   let response,injectedFailure=false
   if(pathname==='/functions/v1/aka-agent-desktop-session'){
     let input;try{input=JSON.parse(body)}catch{}
     const tracked=bindFailure&&!bindFailure.edgeStarted&&input?.action==='login'&&input.username===bindFailure.username?bindFailure:null
     if(tracked)tracked.edgeStarted=true
     const admin=createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
     response=await createSessionHandler(admin)(new Request(base+req.url,{method:req.method,body,headers:req.headers}))
     if(tracked){injectedFailure=true;tracked.finished.resolve(response.status)}
   }else if(pathname==='/rest/v1/rpc/aka_agent_desktop_session_admin'){
     assert.equal(req.headers.authorization,'Bearer '+key,'issuer RPC must keep service identity')
     const args=JSON.parse(body)
     const fault=bindFailure&&!bindFailure.used&&args.p_operation==='bind_user'&&args.p_data.username===bindFailure.username?bindFailure:null
     if(fault)fault.used=true
     try{
       const data=fault?.beforeCommit?null:sql(`SET ROLE service_role; SELECT public.aka_agent_desktop_session_admin(${q(args.p_operation)},${q(JSON.stringify(args.p_data))}::jsonb);`)
       if(fault){
         fault.authUserId=args.p_data.authUserId;fault.reached.resolve()
         await bounded(fault.release.promise)
         injectedFailure=true;response=new Response('{}',{status:503,headers:{'Content-Type':'application/json'}})
       }else{
         if(prepareRace&&args.p_operation==='prepare'&&args.p_data.username===prepareRace.username){
           assert.equal(JSON.parse(data).authUserId,null,'both first logins must observe an unbound staff')
           if(++prepareRace.prepared===2)prepareRace.release.resolve()
           await bounded(prepareRace.release.promise)
         }
         response=new Response(data,{headers:{'Content-Type':'application/json'}})
       }
     }
     catch(error){response=new Response(JSON.stringify({code:'P0001',message:error.message.match(/desktop_[a-z_]+/)?.[0]||'fixture_sql_failed'}),{status:400,headers:{'Content-Type':'application/json'}})}
   }else if(pathname.startsWith('/auth/v1/')){
     if(pathname.endsWith('/token'))tokenRequests++
     if(req.method==='DELETE'&&pathname.startsWith('/auth/v1/admin/users/'))deletedUsers.push(pathname.split('/').pop())
     response=await fetch(authUrl+req.url.slice('/auth/v1'.length),{method:req.method,headers:{Authorization:req.headers.authorization||'','Content-Type':'application/json'},...(body.length?{body}:{})})
   }else response=new Response('{}',{status:404})
   if(response.status>=500&&!injectedFailure)console.error('Local upstream failure',pathname,await response.clone().text());
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
 }catch(error){console.error('Local HTTP fixture error:',error.message);res.writeHead(500);res.end('{}')}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`
 const transport=createDesktopSessionTransport(base,'local-publishable-identifier')
 await assert.rejects(transport.login({...credentials,password:'wrong'},AbortSignal.timeout(5000)),/không còn hợp lệ/);pass('bad credentials cannot create a managed identity')
 const session=await transport.login(credentials,AbortSignal.timeout(15000))
 const claims=JSON.parse(Buffer.from(session.accessToken.split('.')[1],'base64url'))
 assert.equal(claims.role,'aka_agent_desktop');assert.equal(session.staffId,1);assert.equal(session.organizationId,10)
 assert.equal(sql(`SELECT staff_id FROM private.aka_agent_desktop_users WHERE auth_user_id='${claims.sub}';`),'1')
 pass('real Auth custom role, server-generated magic link, direct verification and SQL binding')
 const renewed=await transport.refresh(session,AbortSignal.timeout(5000));assert.equal(renewed.sessionId,session.sessionId);assert.equal(JSON.parse(Buffer.from(renewed.accessToken.split('.')[1],'base64url')).role,'aka_agent_desktop');pass('managed refresh preserves custom role and immutable session ID')
 let rejected=0;const revocations=[];const manager=new sessionModule.DesktopSessionManager(transport.refresh,()=>renewed.expiresAt*1000-2000,(...args)=>{const p=transport.revoke(...args);revocations.push(p);return p})
 manager.onRejected(()=>rejected++);manager.install(renewed,0);const before=tokenRequests
 await Promise.all(Array.from({length:20},()=>manager.token()))
 assert.equal(tokenRequests-before,1);pass('twenty concurrent requests produce one real Auth refresh')
 await transport.revoke(renewed.accessToken,AbortSignal.timeout(5000))
 assert.equal(sql(`SELECT NOT EXISTS(SELECT 1 FROM auth.sessions WHERE id='${claims.session_id}');`),'t')
 await assert.rejects(manager.token(),/không còn hợp lệ/);assert.equal(rejected,1);manager.clear();pass('logout revokes managed refresh; permanent rejection notifies cleanup once')
 for(const [status,permanent] of [[429,false],[503,false],[401,true]]){
  const stub=createDesktopSessionTransport(base,'local',async()=>new Response('{}',{status}))
  let error;try{await stub.refresh(session,AbortSignal.timeout(1000))}catch(e){error=e}
  assert.equal(error instanceof sessionModule.DesktopSessionRejected,permanent)
 }
 pass('rate limits and outages remain transient; unauthorized sessions are permanent')
 const malformed=await fetch(base+'/functions/v1/aka-agent-desktop-session',{method:'POST',body:'not json'});assert.equal(malformed.status,400)
 const oversized=await fetch(base+'/functions/v1/aka-agent-desktop-session',{method:'POST',body:'x'.repeat(17000)});assert.equal(oversized.status,413);pass('malformed and oversized input rejected before authentication');await Promise.allSettled(revocations)

 const addStaff=(id,username,hash)=>{
   sql(`INSERT INTO org_staff(id,organization_id,username,password,is_active,is_policy_accepted,aka_agent_device_identity_version,aka_agent_device_fingerprint_hash,aka_agent_device_binding_revision)
     VALUES(${id},10,${q(username)},'local-only-password',true,true,3,${q(hash.repeat(64))},1);`)
   return {username,password:'local-only-password',fingerprintHash:hash.repeat(64)}
 }
 const startFailure=(username,beforeCommit=false)=>bindFailure={username,beforeCommit,reached:deferred(),release:deferred(),finished:deferred()}
 const userId=s=>JSON.parse(Buffer.from(s.accessToken.split('.')[1],'base64url')).sub
 const ambiguous=addStaff(2,'fixture-lost-bind','b'),fault=startFailure(ambiguous.username)
 const abort=new AbortController(),oldLogin=transport.login(ambiguous,abort.signal)
 const aborted=assert.rejects(oldLogin,error=>error.name==='AbortError')
 await bounded(fault.reached.promise)
 abort.abort();await aborted
 const retry=await transport.login(ambiguous,AbortSignal.timeout(15000))
 assert.equal(userId(retry),fault.authUserId,'retry reuses the identity bound before the lost response')
 fault.release.resolve();assert.equal(await bounded(fault.finished.promise),503)
 assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id=${q(fault.authUserId)};`),'1')
 assert.equal(sql(`SELECT count(*) FROM private.aka_agent_desktop_users WHERE staff_id=2 AND auth_user_id=${q(fault.authUserId)};`),'1')
 assert.equal(sql(`SELECT count(*) FROM auth.sessions WHERE id=${q(retry.sessionId)};`),'1')
 assert.equal(deletedUsers.includes(fault.authUserId),false)
 assert.equal((await transport.refresh(retry,AbortSignal.timeout(5000))).sessionId,retry.sessionId)
 bindFailure=null
 pass('lost bind response and aborted login cannot delete a successful retry identity or refresh session')

 const uncommitted=addStaff(3,'fixture-uncommitted-bind','c'),beforeCommit=startFailure(uncommitted.username,true)
 const failed=assert.rejects(transport.login(uncommitted,AbortSignal.timeout(15000)),/Chưa kết nối/)
 await bounded(beforeCommit.reached.promise);beforeCommit.release.resolve();await failed
 assert.equal(await bounded(beforeCommit.finished.promise),503)
 assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id=${q(beforeCommit.authUserId)};`),'1')
 assert.equal(sql(`SELECT count(*) FROM private.aka_agent_desktop_users WHERE staff_id=3;`),'0')
 assert.equal(sql(`SELECT count(*) FROM auth.sessions WHERE user_id=${q(beforeCommit.authUserId)};`),'0')
 assert.equal(deletedUsers.includes(beforeCommit.authUserId),false)
 bindFailure=null
 const recovered=await transport.login(uncommitted,AbortSignal.timeout(15000))
 assert.notEqual(userId(recovered),beforeCommit.authUserId)
 assert.equal((await transport.refresh(recovered,AbortSignal.timeout(5000))).sessionId,recovered.sessionId)
 pass('uncommitted bind failure issues no session; a later login succeeds without unsafe identity cleanup')

 const concurrent=addStaff(4,'fixture-concurrent-bind','d'),deleteCount=deletedUsers.length
 prepareRace={username:concurrent.username,prepared:0,release:deferred()}
 const challenges=await Promise.all(Array.from({length:2},()=>transport.endpoint({action:'login',...concurrent},AbortSignal.timeout(15000))))
 assert(challenges.every(c=>typeof c.tokenHash==='string'&&c.tokenHash.length>0))
 assert.equal(prepareRace.prepared,2);prepareRace=null
 const canonical=sql('SELECT auth_user_id FROM private.aka_agent_desktop_users WHERE staff_id=4;')
 assert.equal(deletedUsers.length-deleteCount,1,'only the confirmed unused sibling is deleted')
 assert.notEqual(deletedUsers.at(-1),canonical)
 assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id=${q(deletedUsers.at(-1))};`),'0')
 assert.equal(sql(`SELECT count(*) FROM auth.users WHERE id=${q(canonical)};`),'1')
 const surviving=await transport.login(concurrent,AbortSignal.timeout(15000))
 assert.equal(userId(surviving),canonical)
 assert.equal((await transport.refresh(surviving,AbortSignal.timeout(5000))).sessionId,surviving.sessionId)
 pass('concurrent first logins delete only the confirmed unused sibling and preserve the canonical identity')
 console.log(JSON.stringify({checks,authVersion:'v2.197.0',status:'passed'}))
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}if(auth&&auth.exitCode===null){auth.kill('SIGTERM');await new Promise(r=>auth.once('exit',r))}f.close()})
