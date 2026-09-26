const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')
const { EventEmitter } = require('node:events')
const root = path.resolve(__dirname, '..')
function load(file, stubs = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText, { exports, require: name => stubs[name] ?? require(name), AbortController, AbortSignal,
    Buffer, URL, Date, console, setTimeout, clearTimeout, structuredClone, Error, ...globals }, { filename:file })
  return exports
}
const shared = load('src/shared/facebookLogin.ts')
const deadline = load('src/main/services/requestDeadline.ts')
const {trustedFacebookUrl} = load('src/main/services/facebookSessionRequest.ts', {'./requestDeadline':deadline})
const startupBrowser = load('src/main/services/facebookStartupBrowser.ts', {
  './facebookSessionRequest':{trustedFacebookUrl},'./requestDeadline':deadline
})
const retry = load('src/main/services/runtimeCleanupRetry.ts')
const {AccountOperationRegistry} = load('src/main/services/accountOperationRegistry.ts', {'./runtimeCleanupRetry':retry,'./requestDeadline':deadline})
const {facebookTotp} = load('src/main/services/facebookTotp.ts', {'../../shared/facebookLogin':shared})
assert.equal(facebookTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',59000,8),'94287082')
assert.equal(facebookTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',1111111109000,8),'07081804')
assert.equal(shared.parseFacebookText('100000000001111|pass|JBSWY3DPEHPK3PXP   100000000002222|pass2|JBSWY3DPEHPK3PXP').length,2)
assert.equal(shared.parseFacebookText('100000000001111|pass words|JBSWY3DPEHPK3PXP')[0].password,'pass words')
assert.equal(shared.parseFacebookText('100000000001111|c_user=100000000001111; xs=x y;')[0].cookie,'c_user=100000000001111; xs=x y;')
assert.throws(()=>shared.validateFacebookInput({uid:'100000000001111',password:'x',twoFactorSecret:'123456'}),/Khóa 2FA/)
assert.throws(()=>shared.validateFacebookInput({uid:'100000000001111',cookie:'c_user=100000000002222; xs=x'}),/không khớp/)
assert.equal(shared.isFacebookHost('facebook.com.evil.test'),false)
const directory = fs.mkdtempSync(path.join(os.tmpdir(),'aka-facebook-smoke-'))
const journalModule = load('src/main/services/facebookLoginJournal.ts', {electron:{app:{getPath:()=>directory}}})
const journal = new journalModule.FacebookLoginJournal()
journal.mark(1,9,true)
assert.equal(new journalModule.FacebookLoginJournal().dirty(1,9),true)
journal.put({staffId:1,requestId:'fixture',accountId:9})
assert(!fs.readFileSync(path.join(directory,'facebook-login-journal.json'),'utf8').includes('password'))
journal.remove('fixture');journal.mark(1,9,false)

function fixture({loginFail=false,loginName='Fixture',promotionFail=false,finishLost=false,limit=10,duplicates=[],localState='authenticated',initialUid='100000000001111',manualSwitch=false,isActive=true,managed=true,journalType,visibleState=null,startupAccounts=[],operationRegistry=new AccountOperationRegistry(),readDeadline=deadline,serviceGlobals={},hooks={}}={}) {
  const calls=[], rpcCalls=[], events=[], sessions=new Map(), logs=new Map(), reservations=new Map(), secrets=new Map(), dirty=new Set()
  let account=null, next=20, currentUid=initialUid, revision=managed?1:0, visible=null
  const user={staffId:1,organizationId:1}, credentials={}
  const accountFor=id=>({id,staffId:1,flatformType:'facebook',facebookLoginManaged:managed,facebookLoginClaimGeneration:0,isActive,status:'tạm dừng',loginStatus:'chưa đăng nhập'})
  const ses = part => { if(!sessions.has(part)) sessions.set(part,{ cookies:new EventEmitter(), clearStorageData:async()=>calls.push('clear:'+part),clearCache:async()=>{},closeAllConnections:async()=>{},cookiesData:part.startsWith('persist:')&&localState==='authenticated'?[{name:'c_user',value:currentUid,domain:'.facebook.com'}]:[],storagePath:null }); return sessions.get(part) }
  const cookieChanged=(id,uid)=>{
    const target=ses('persist:account_'+id)
    target.cookiesData=[{name:'c_user',value:uid,domain:'.facebook.com'}]
    target.cookies.emit('changed',{},target.cookiesData[0],'explicit',false)
  }
  const inspect=async ses=>{
    calls.push('verify')
    const uid=ses.cookiesData.find(c=>c.name==='c_user')?.value
    return uid?{state:'authenticated',uid}:{state:localState}
  }
  const makeVisible=state=>Object.assign(new EventEmitter(),{
    session:ses('persist:account_40'),documentState:state,isDestroyed:()=>false,isLoadingMainFrame:()=>false,getURL:()=> 'https://www.facebook.com/',
    async loadURL(url){calls.push('visible.load');this.emit('did-start-navigation',{},url,false,true);await hooks.visibleLoad?.(context);this.documentState=this.session.cookiesData.some(c=>c.name==='c_user')?'authenticated':'logged_out';this.emit('did-stop-loading')}
  })
  if(visibleState)visible=makeVisible(visibleState)
  const context={calls,rpcCalls,events,loginSecrets:[],ses,cookieChanged,accountFor,get visible(){return visible},mountVisible(state){visible=makeVisible(state)}}
  class FakeSession {
    constructor(signal,partition) {signal.throwIfAborted();this.signal=signal;this.partition=partition||'temp:'+next++;this.ses=ses(this.partition);calls.push('browser:'+this.partition)}
    async login(secret,_proxy,lookupName=false,onProgress) {this.signal.throwIfAborted();calls.push('login');context.loginSecrets.push(structuredClone(secret));if(lookupName)calls.push('nameLookup');onProgress?.('Fixture: đang chờ phê duyệt');if(loginFail)throw new Error('Fixture login failed');this.ses.cookiesData=[{name:'xs',value:'restored',domain:'.facebook.com',httpOnly:true},{name:'c_user',value:secret.uid,domain:'.facebook.com',httpOnly:true}];if(manualSwitch)cookieChanged(40,'100000000002222');await hooks.login?.(context);return{state:'authenticated',uid:secret.uid,name:lookupName?loginName:undefined}}
    async observe(){this.signal.throwIfAborted();await hooks.load?.(this,context);if(promotionFail) return {state:'unknown'};return inspect(this.ses)}
    async dispose(){calls.push('dispose:'+this.partition)}
  }
  class FakeJournal {
    put(e){logs.set(e.requestId,{...logs.get(e.requestId),...e})} pending(id){return [...logs.values()].filter(e=>e.staffId===id)}remove(id){logs.delete(id)}
    mark(s,id,value){if(value)dirty.add(id);else dirty.delete(id)}dirty(s,id){return dirty.has(id)}
  }
  const rpc=async(action,payload={})=> {
    calls.push(action);rpcCalls.push({action,payload})
    await hooks.rpc?.(action,payload,context)
    if(action==='preview')return{limit,duplicates}
    if(action==='pending')return[]
    if(action==='reserve'){reservations.set(payload.requestId,40);return{accountId:40,state:'initializing'}}
    if(action==='request_status')return account ? {accountId:40,state:'ready'} : reservations.has(payload.requestId)?{accountId:reservations.get(payload.requestId),state:'initializing'}:null
    if(action==='abort'){reservations.delete(payload.requestId);return{removed:true}}
    if(action==='finish'){account={id:40};secrets.set(40,payload.secret);if(finishLost)throw new Error('Lost response');return{accountId:40,state:'ready'}}
    if(action==='metadata')return{uid:currentUid,revision,hasPassword:true,hasCookie:true}
    if(action==='get')return{revision,secret:{uid:'100000000001111',password:'fixture',twoFactorSecret:'JBSWY3DPEHPK3PXP',cookies:[{name:'c_user',value:'100000000001111',domain:'.facebook.com'},{name:'xs',value:'old-session',domain:'.facebook.com'}]}}
    if(action==='observe')return{revision:payload.state==='authenticated'?++revision:revision}
    if(action==='save')return{revision:++revision}
    if(action==='login'){secrets.set(payload.accountId,payload.secret);managed=true;return{revision:++revision}}
    throw new Error('unexpected '+action)
  }
  const {FacebookLoginService}=load('src/main/services/facebookLoginService.ts',{
    electron:{session:{fromPartition:ses},webContents:{fromId:()=>visible}},
    '../../shared/facebookLogin':shared,'../../shared/types':{IPC_EVENTS:{ACCOUNT_STATUS_UPDATED:'changed'}},
    '../data/currentUser':{getCurrentUser:()=>user,requireCurrentUser:()=>user,getCurrentUserCredentials:()=>credentials},
    '../data/repositories/facebookLoginRepository':{facebookRpc:rpc,FacebookDataError:class extends Error{}},
    './accountOperationRegistry':{accountOperationRegistry:operationRegistry},'./requestDeadline':readDeadline,
    './facebookStartupBrowser':hooks.startupBrowserModule||startupBrowser,
    '../data/repositories/accountRepository':{getAccount:async(id,signal)=>{await hooks.getAccount?.(id,signal,context);return hooks.account?.(id,context)||accountFor(id)},listAccounts:async()=>{calls.push('listAccounts');await hooks.listAccounts?.();return startupAccounts.map(accountFor)},
      claimNonZaloAccountRuntimeOperation:async(...args)=>{assert.equal(args[3],false);assert.equal(args[4],'facebook.login');assert(args[5] instanceof AbortSignal);calls.push('claim');return hooks.claim?hooks.claim(args,context):{claimed:true,claimToken:'token',staffId:1,previousStatus:'tạm dừng'}},
      releaseNonZaloAccountRuntimeOperation:async(...args)=>{assert.equal(args[2],'tạm dừng');assert.equal(args[3],'token');calls.push('release');return hooks.release?hooks.release(args,context):true}},
    '../data/repositories/proxyRepository':{getProxy:async(id,signal)=>hooks.getProxy?hooks.getProxy(id,signal,context):null},'./facebookLoginJournal':{FacebookLoginJournal:journalType||FakeJournal},
    './facebookLoginSession':{FacebookLoginSession:FakeSession,trustedFacebookUrl,inspectFacebookSession:inspect,loadFacebookHome:async wc=>wc.loadURL('https://www.facebook.com/'),readFacebookCookies:async s=>s.cookiesData,
      facebookCookieScope:c=>JSON.stringify([c.name,(c.domain||'').replace(/^\./,''),c.path||'/',!!c.hostOnly]),
      authFingerprint:c=>JSON.stringify(c.filter(x=>['c_user','xs'].includes(x.name))),writeFacebookCookies:async(s,c,signal,beforeWrite)=>{
        calls.push('copy')
        for(const source of c){
          const cookie=['c_user','xs'].includes(source.name)?{...source,secure:true,httpOnly:source.name==='xs',sameSite:'no_restriction'}:source
          signal.throwIfAborted();beforeWrite?.(cookie)
          const old=s.cookiesData.find(item=>item.name===cookie.name)
          if(old)s.cookies.emit('changed',{},old,'overwrite',true)
          s.cookiesData=s.cookiesData.filter(item=>item.name!==cookie.name).concat(cookie)
          s.cookies.emit('changed',{},cookie,'explicit',false)
          await hooks.cookieWritten?.(cookie,context)
        }
        await hooks.copy?.(context);signal.throwIfAborted()
      }}
  },serviceGlobals)
  const service=new FacebookLoginService({isDestroyed:()=>false,webContents:{send(...args){events.push(structuredClone(args))}}},{getWebContentsId:()=>visible?1:null,listRegistered:()=>[]},hooks.proxyRuntime||{getSessionProxyAuthentication:()=>null,applyProxyToPartition:async(partition,proxy)=>{await hooks.applyProxy?.(partition,proxy,context)}})
  context.service=service
  service.startSession(false)
  return{...context,service,logs,secrets,dirty,get account(){return account},setUid(value){currentUid=value}}
}
async function run() {
  const input={text:'100000000001111|pass|JBSWY3DPEHPK3PXP'}
  for(const options of [{},{loginName:null},{loginFail:true},{promotionFail:true},{finishLost:true}]){
    const f=fixture(options),preview=await f.service.preview(input)
    await f.service.start(preview.id);await f.service.batchWork
    assert(f.events.some(([event,state])=>event===shared.FACEBOOK_LOGIN_IPC.progress&&state?.rows.some(row=>row.message==='Fixture: đang chờ phê duyệt')))
    assert(!JSON.stringify(f.events).includes('JBSWY3DPEHPK3PXP'))
    const status=f.service.state().rows[0].status
    if(options.loginFail){assert.equal(status,'failed');assert(!f.calls.includes('reserve'));assert(!f.calls.some(c=>c.startsWith('browser:persist:')))}
    else if(options.promotionFail){assert.equal(status,'failed');assert.equal(f.account,null);assert(f.calls.includes('abort'));assert.equal(f.secrets.size,0)}
    else{assert.equal(status,'success');assert(f.account);assert(f.calls.indexOf('copy')<f.calls.indexOf('finish'));assert(!f.calls.includes('abort'))}
    if(!options.loginFail&&!options.promotionFail){
      const expected=options.loginName===null?'100000000001111':'Fixture'
      assert(f.calls.includes('nameLookup'))
      assert.equal(f.rpcCalls.find(c=>c.action==='finish').payload.name,expected)
      if(!options.finishLost)assert.equal(f.service.state().rows[0].name,expected)
    }
    await f.service.stop()
  }
  const limited=fixture({limit:1}),p=await limited.service.preview({text:input.text+'\n100000000002222|pass|JBSWY3DPEHPK3PXP'})
  await assert.rejects(limited.service.start(p.id),/tối đa 1/);assert(!limited.calls.some(c=>c.startsWith('browser:')))
  const duplicate=fixture({duplicates:['100000000001111']}),d=await duplicate.service.preview({text:input.text+'\n'+input.text})
  assert(d.rows.every(row=>row.status==='skipped'))
  const manual=fixture()
  await assert.rejects(manual.service.save(40,{uid:'100000000002222',revision:1,password:'secret'}),/khác UID/)
  assert(!manual.calls.includes('save'))
  await manual.service.save(40,{uid:'100000000001111',revision:1,password:'same UID allowed'})
  assert(manual.calls.includes('save'));assert(!manual.calls.includes('preview'))
  const loginInput={uid:'100000000001111',revision:0,password:'explicit-password',twoFactorSecret:'JBSWY3DPEHPK3PXP'}
  for(const managed of [false,true]) {
    const f=fixture({managed,localState:'authenticated'})
    await f.service.login(40,managed?{uid:loginInput.uid,revision:1}:loginInput)
    assert.equal(f.loginSecrets.length,1,'already logged in must still authenticate')
    assert.equal(f.loginSecrets[0].cookies.length,0,'explicit login must not reuse stored cookies')
    assert(f.rpcCalls.some(c=>c.action==='login'))
    assert(!f.calls.includes('reserve'));assert(!f.calls.includes('finish'));assert(!f.calls.includes('preview'))
    assert.equal(f.ses('persist:account_40').cookiesData.find(c=>c.name==='xs').value,'restored')
    assert(f.calls.includes('release'));assert(!f.service.isLoggingIn(40));assert(!f.dirty.has(40))
    assert(!f.calls.includes('nameLookup'))
    await f.service.stop()
  }
  for(const managed of [false,true]) {
    const f=fixture({managed,localState:'authenticated',loginFail:true})
    const before=structuredClone(f.ses('persist:account_40').cookiesData)
    await assert.rejects(f.service.login(40,{...loginInput,revision:managed?1:0}),/Fixture login failed/)
    assert.deepEqual(f.ses('persist:account_40').cookiesData,before,'failed login preserves old session')
    assert(!f.calls.includes('copy'));assert(!f.rpcCalls.some(c=>c.action==='login'||c.action==='save'||c.action==='observe'))
    assert(f.calls.includes('release'));assert(!f.service.isLoggingIn(40))
    await f.service.stop()
  }
  // A newly authenticated identity is verified and preserved during read/claim/proxy waits.
  for(const phase of ['read','claim','proxy']) {
    const hooks={}
    if(phase==='read')hooks.getAccount=async(id,signal,c)=>c.cookieChanged(40,'100000000002222')
    if(phase==='claim')hooks.claim=async(args,c)=>{c.cookieChanged(40,'100000000002222');return{claimed:true,claimToken:'token',staffId:1,previousStatus:'tạm dừng'}}
    if(phase==='proxy')hooks.applyProxy=async(partition,proxy,c)=>{if(partition==='persist:account_40')c.cookieChanged(40,'100000000002222')}
    const f=fixture({managed:false,hooks})
    await assert.rejects(f.service.login(40,loginInput),/Đã giữ phiên/)
    assert.equal(f.ses('persist:account_40').cookiesData.find(c=>c.name==='c_user').value,'100000000002222',phase)
    assert.equal(f.loginSecrets.length,0,phase);assert(!f.calls.includes('copy'),phase)
    assert(f.calls.includes('release'),phase)
    assert(!f.service.isLoggingIn(40),phase)
    await f.service.stop();assert.equal(f.ses('persist:account_40').cookies.listenerCount('changed'),0,phase)
  }
  for(const change of [c=>c.visible.emit('before-input-event',{},{}),c=>c.visible.emit('did-start-navigation',{},'https://www.facebook.com/',false,true),c=>c.mountVisible('authenticated')]) {
    const f=fixture({managed:false,visibleState:'authenticated',hooks:{claim:async(args,c)=>{change(c);return{claimed:true,claimToken:'token',staffId:1,previousStatus:'tạm dừng'}}}})
    await f.service.login(40,loginInput)
    assert.equal(f.loginSecrets.length,1);assert(f.calls.includes('release'));assert(!f.service.isLoggingIn(40))
    await f.service.stop()
  }
  const refreshed=fixture({managed:false,hooks:{login:async c=>{
    const target=c.ses('persist:account_40'),cookie={name:'xs',value:'refreshed',domain:'.facebook.com'}
    target.cookiesData.push(cookie);target.cookies.emit('changed',{},cookie,'explicit',false)
  }}})
  await refreshed.service.login(40,loginInput)
  assert(refreshed.calls.includes('copy'),'refreshing the original UID does not cancel explicit login')
  assert.equal(refreshed.secrets.get(40).uid,loginInput.uid)
  await refreshed.service.stop()
  const changedDuringCopy=fixture({localState:'logged_out',hooks:{cookieWritten:async(cookie,c)=>{
    if(cookie.name==='xs')c.cookieChanged(40,'100000000002222')
  }}})
  await assert.rejects(changedDuringCopy.service.restore(40),/Phiên đã thay đổi/)
  assert.equal(changedDuringCopy.ses('persist:account_40').cookiesData.find(c=>c.name==='c_user').value,'100000000002222')
  assert(changedDuringCopy.calls.includes('release'),'a conflicting write must release the restore claim')
  await changedDuringCopy.service.stop()
  const failedEnrollment=fixture({managed:false,hooks:{rpc:async action=>{if(action==='login')throw Error('Fixture database offline')}}})
  await assert.rejects(failedEnrollment.service.login(40,loginInput),/Đã đăng nhập Facebook, nhưng chưa xác nhận lưu/)
  assert.equal(failedEnrollment.ses('persist:account_40').cookiesData.find(c=>c.name==='c_user').httpOnly,false)
  assert.equal(failedEnrollment.ses('persist:account_40').cookiesData.find(c=>c.name==='xs').httpOnly,true)
  assert.equal(failedEnrollment.secrets.size,0);assert(failedEnrollment.calls.includes('release'))
  assert(!failedEnrollment.service.isLoggingIn(40));await failedEnrollment.service.stop()
  const explicitSwitch=fixture({managed:true})
  await explicitSwitch.service.login(40,{...loginInput,uid:'100000000002222',revision:1})
  assert.equal(explicitSwitch.secrets.get(40).uid,'100000000002222')
  assert.equal(explicitSwitch.secrets.get(40).password,'explicit-password')
  assert(!explicitSwitch.calls.includes('preview'))
  const missingNewCredentials=fixture({managed:true})
  await assert.rejects(missingNewCredentials.service.login(40,{uid:'100000000002222',revision:1}),/Nhập mật khẩu/)
  assert.equal(missingNewCredentials.loginSecrets.length,0,'never inherit credentials across UID')
  const changedDuringExplicit=fixture({managed:false,manualSwitch:true})
  await assert.rejects(changedDuringExplicit.service.login(40,loginInput),/Đã giữ phiên/)
  assert(!changedDuringExplicit.calls.includes('copy'));assert(!changedDuringExplicit.rpcCalls.some(c=>c.action==='login'))
  const staleExplicit=fixture({managed:true})
  await assert.rejects(staleExplicit.service.login(40,loginInput),/vừa thay đổi/)
  assert.equal(staleExplicit.loginSecrets.length,0)
  await Promise.all([explicitSwitch,missingNewCredentials,changedDuringExplicit,staleExplicit].map(f=>f.service.stop()))
  const valid=fixture({initialUid:'100000000002222'})
  await valid.service.restore(40)
  assert(!valid.calls.includes('get'));assert(!valid.calls.includes('login'));assert(valid.calls.includes('release'))
  const missing=fixture({localState:'logged_out'})
  await missing.service.restore(40)
  assert(missing.calls.includes('get'));assert(missing.calls.includes('copy'));assert(missing.calls.includes('release'))
  const unsynced=fixture({localState:'logged_out'});unsynced.dirty.add(40)
  await assert.rejects(unsynced.service.restore(40),/chưa đồng bộ/);assert(!unsynced.calls.includes('get'))
  const switched=fixture({localState:'logged_out',manualSwitch:true})
  await switched.service.restore(40);assert(!switched.calls.includes('copy'));assert(switched.calls.includes('release'))
  const unknown=fixture({localState:'unknown'})
  await assert.rejects(unknown.service.restore(40));assert(!unknown.calls.includes('get'))
  const disabled=fixture({isActive:false})
  await assert.rejects(disabled.service.restore(40));assert(!disabled.calls.includes('claim'))

  // A real pending RPC boundary: cookie change happens after logout verification,
  // before cloud credentials return. Never take the new UID as the restore baseline.
  const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}}
  const reloading=deferred()
  const reloadDuringLogin=fixture({localState:'logged_out',visibleState:'logged_out',hooks:{login:async c=>{
    c.visible.isLoadingMainFrame=()=>true
    c.visible.emit('did-start-navigation',{},'https://www.facebook.com/',false,true)
    reloading.resolve()
  }}})
  const reloadWork=reloadDuringLogin.service.restore(40)
  await reloading.promise;await new Promise(resolve=>setImmediate(resolve))
  assert(!reloadDuringLogin.calls.includes('copy'),'wait for an in-flight page load before promoting cookies')
  reloadDuringLogin.visible.isLoadingMainFrame=()=>false;reloadDuringLogin.visible.emit('did-stop-loading')
  await reloadWork
  assert(reloadDuringLogin.calls.includes('copy'));assert(reloadDuringLogin.calls.includes('release'))
  await reloadDuringLogin.service.stop()
  const getEntered=deferred(),getResponse=deferred()
  const duringGet=fixture({localState:'logged_out',hooks:{rpc:async action=>{if(action==='get'){getEntered.resolve();await getResponse.promise}}}})
  const restorePreserved=duringGet.service.restore(40)
  await getEntered.promise
  duringGet.cookieChanged(40,'100000000002222');getResponse.resolve()
  await restorePreserved
  assert(!duringGet.calls.includes('login'));assert(!duringGet.calls.includes('copy'))
  assert.equal(duringGet.ses('persist:account_40').cookiesData[0].value,'100000000002222')
  assert(duringGet.calls.includes('release'))
  await duringGet.service.stop()
  assert.equal(duringGet.ses('persist:account_40').cookies.listenerCount('changed'),0)

  for(const change of [
    context=>context.visible.emit('before-input-event',{},{}),
    context=>context.visible.emit('did-start-navigation',{},'https://www.facebook.com/login/',false,true),
    context=>context.mountVisible('logged_out')
  ]){
    const f=fixture({localState:'logged_out',visibleState:'logged_out',hooks:{rpc:async(action,_payload,context)=>{if(action==='get')change(context)}}})
    await f.service.restore(40)
    assert(f.calls.includes('copy'));assert(f.calls.includes('visible.load'));assert(f.calls.includes('release'))
    await f.service.stop()
  }
  const duringObservation=fixture({localState:'logged_out',hooks:{rpc:async(action,payload,context)=>{
    if(action==='observe'&&payload.state==='logged_out')context.cookieChanged(40,'100000000002222')
  }}})
  await duringObservation.service.restore(40)
  assert(!duringObservation.calls.includes('get'));assert(!duringObservation.calls.includes('copy'))
  await duringObservation.service.stop()

  // Visible page is only refreshed after restore. Session checks use the cookie jar
  // via HTTP; poller observations during promotion must remain excluded.
  const visible=fixture({localState:'logged_out',visibleState:'logged_out',hooks:{copy:async context=>{
    const before=context.rpcCalls.length
    assert.equal(await context.service.observe(context.accountFor(40),context.visible),false)
    assert.equal(context.rpcCalls.length,before)
  }}})
  visible.ses('persist:account_40').cookiesData=[{name:'xs',value:'expired',domain:'.facebook.com'}]
  await visible.service.restore(40)
  assert.equal(visible.calls.filter(call=>call==='visible.load').length,1)
  assert.equal((await visible.service.checkAccount(40,visible.visible)).loggedIn,true)
  assert.equal(visible.rpcCalls.filter(call=>call.action==='observe').at(-1).payload.state,'authenticated')
  assert.equal(visible.visible.listenerCount('did-start-navigation'),1,'keep one local cache invalidation listener until stop')
  assert.equal(visible.visible.listenerCount('before-input-event'),0)
  await visible.service.stop()

  let changedBeforeRefresh=false
  const beforeRefresh=fixture({localState:'logged_out',visibleState:'logged_out',hooks:{load:async(browser,context)=>{
    if(!changedBeforeRefresh&&browser.partition.startsWith('persist:')&&context.calls.includes('copy')){
      changedBeforeRefresh=true
      context.visible.emit('before-input-event',{},{});context.cookieChanged(40,'100000000002222')
    }
  }}})
  await beforeRefresh.service.restore(40)
  assert(!beforeRefresh.calls.includes('visible.load'))
  assert.equal(beforeRefresh.ses('persist:account_40').cookiesData[0].value,'100000000002222')
  await beforeRefresh.service.stop()

  const alreadyVisible=fixture({visibleState:'authenticated',initialUid:'100000000002222'})
  await alreadyVisible.service.restore(40)
  assert(!alreadyVisible.calls.includes('visible.load'));assert(!alreadyVisible.calls.includes('get'))
  await alreadyVisible.service.stop()

  // The existing 30-second observer reuses HTTP evidence while cookies and the
  // document stay unchanged. Explicit checks and authentication changes reverify.
  const cached=fixture({visibleState:'authenticated'})
  await cached.service.observe(cached.accountFor(40),cached.visible)
  const verifyCount=cached.calls.filter(c=>c==='verify').length,rpcCount=cached.rpcCalls.length
  for(let i=0;i<5;i++)await cached.service.observe(cached.accountFor(40),cached.visible)
  assert.equal(cached.calls.filter(c=>c==='verify').length,verifyCount)
  assert.equal(cached.rpcCalls.length,rpcCount)
  cached.visible.emit('did-start-navigation',{},'https://www.facebook.com/groups/',true,true)
  await cached.service.observe(cached.accountFor(40),cached.visible)
  assert.equal(cached.calls.filter(c=>c==='verify').length,verifyCount,'ordinary SPA navigation needs no HTTP check')
  cached.visible.emit('did-start-navigation',{},'https://m.facebook.com/checkpoint/',true,true)
  await cached.service.observe(cached.accountFor(40),cached.visible)
  assert.equal(cached.calls.filter(c=>c==='verify').length,verifyCount+1)
  cached.cookieChanged(40,'100000000002222')
  await cached.service.observe(cached.accountFor(40),cached.visible)
  assert.equal(cached.calls.filter(c=>c==='verify').length,verifyCount+2)
  await cached.service.checkAccount(40,cached.visible)
  assert.equal(cached.calls.filter(c=>c==='verify').length,verifyCount+3,'manual check uses exactly one HTTP verification')
  cached.visible.emit('did-start-navigation',{},'https://www.facebook.com/groups/',false,true)
  await cached.service.observe(cached.accountFor(40),cached.visible)
  assert.equal(cached.calls.filter(c=>c==='verify').length,verifyCount+4,'a new document invalidates HTTP evidence even when auth cookies stay the same')
  await cached.service.stop();assert.equal(cached.visible.listenerCount('did-start-navigation'),0)
  const noTab=fixture({managed:false})
  assert.equal((await noTab.service.checkAccount(40)).loggedIn,true)
  assert(!noTab.calls.some(c=>c.startsWith('browser:')),'manual check uses session storage directly, with no window')
  await noTab.service.stop()

  // Locked profile stays pending, later cleanup still runs, and healthy accounts restore.
  const cleanup=fixture({localState:'logged_out',startupAccounts:[88,40]})
  cleanup.service.log.put({staffId:1,requestId:'locked',accountId:88})
  cleanup.service.log.put({staffId:1,requestId:'removable',accountId:89})
  cleanup.service.promotedSessions.set(88,{clearStorageData:async()=>{throw Error('Profile locked')}})
  cleanup.service.startSession();await cleanup.service.startupWork
  assert(cleanup.logs.has('locked'));assert(!cleanup.logs.has('removable'))
  assert(cleanup.calls.includes('listAccounts'));assert(cleanup.calls.includes('copy'))
  assert(!cleanup.calls.includes('browser:persist:account_88'))
  await cleanup.service.stop()

  const cancelledCleanup=fixture({localState:'logged_out',startupAccounts:[40]})
  cancelledCleanup.service.log.put({staffId:1,requestId:'cancelled',accountId:88})
  cancelledCleanup.service.promotedSessions.set(88,{clearStorageData:async()=>{cancelledCleanup.service.lifecycle.abort();throw Error('Cancelled')}})
  cancelledCleanup.service.startSession();await cancelledCleanup.service.startupWork
  assert(!cancelledCleanup.calls.includes('listAccounts'));assert(cancelledCleanup.logs.has('cancelled'))
  await cancelledCleanup.service.stop()

  const discoveryFailed=fixture({startupAccounts:[88,40],hooks:{rpc:async action=>{
    if(action==='pending')throw Error('Pending-import discovery unavailable')
  }}})
  discoveryFailed.service.log.put({staffId:1,requestId:'local-locked',accountId:88})
  discoveryFailed.service.promotedSessions.set(88,{clearStorageData:async()=>{throw Error('Profile locked')}})
  discoveryFailed.service.startSession();await discoveryFailed.service.startupWork
  assert(discoveryFailed.logs.has('local-locked'))
  assert(discoveryFailed.calls.includes('browser:persist:account_40'))
  assert(!discoveryFailed.calls.includes('browser:persist:account_88'))
  await discoveryFailed.service.stop()
  const discoveryCancelled=fixture({startupAccounts:[40],hooks:{rpc:async(action,_payload,context)=>{
    if(action==='pending'){context.service.lifecycle.abort();throw Error('Cancelled')}
  }}})
  discoveryCancelled.service.startSession();await discoveryCancelled.service.startupWork
  assert(!discoveryCancelled.calls.includes('listAccounts'));await discoveryCancelled.service.stop()

  // Real retry/registry code: one account's transient claim or release error must
  // obey the FB attempt signal, and stopping FB must not stop another platform.
  const flush=()=>new Promise(resolve=>setImmediate(resolve))
  for(const phase of ['claim','cleanup'])for(const stopSession of [false,true]){
    const registry=new AccountOperationRegistry(), claims=[], cleanups=[]
    const f=fixture({localState:'logged_out',startupAccounts:[40,41],operationRegistry:registry,hooks:{
      claim:async args=>{
        const id=args[0],context={accountId:id,staffId:1,platform:'facebook',runtimeTarget:'desktop',previousStatus:args[2],claimToken:'token',operationName:args[4]}
        return registry.claim(context,async()=>{
          claims.push(id)
          if(id===40&&phase==='claim')throw Object.assign(Error('Claim response lost'),{code:'55P03'})
          return{claimed:true,...context}
        },async()=>{
          cleanups.push(id)
          if(id===40)throw Object.assign(Error('Cleanup unavailable'),{code:'55P03'})
          return{ok:true,reason:'cleaned'}
        },args[5])
      },
      release:async args=>['cleaned','not_owner'].includes(await registry.release(args[0],args[3],args[4]))
    }})
    f.service.startSession();await flush()
    assert.deepEqual(claims,[40]);assert(f.service.active.has(40))
    assert(f.calls.includes('browser:persist:account_41'),'another session is checked while account 40 restores')
    if(stopSession){
      await f.service.stop()
      assert.deepEqual(claims,[40]);assert(!f.service.active.size)
      // No registry.stop(staff) was needed (the password-change lifecycle).
      const other=await registry.claim({accountId:90,staffId:1,platform:'email',runtimeTarget:'desktop',previousStatus:'chờ xử lý',claimToken:'other',operationName:'contacts.scan'},async()=>({claimed:true,claimToken:'other',previousStatus:'chờ xử lý'}),async()=>({ok:true,reason:'cleaned'}))
      assert(other.claimed);await registry.release(90,'other',1)
    }else{
      f.service.active.get(40).abort.abort();await f.service.startupWork
      assert.deepEqual(claims,[40,41]);assert(!f.service.active.size)
      assert(f.calls.includes('browser:persist:account_41'));assert(!registry.has(41))
      await f.service.stop()
    }
    assert(registry.has(40),'uncertain cleanup retains only the affected account')
    assert.equal(claims.filter(id=>id===40).length,1)
    assert.equal(cleanups.filter(id=>id===40).length,1)
  }
  const cleanupRefused=fixture({hooks:{release:async()=>false}})
  await assert.rejects(cleanupRefused.service.restore(40),/Chưa giải phóng/)
  await cleanupRefused.service.stop()

  // Bound real reads even when the fake transport ignores abort. Late responses
  // cannot revive cancelled work, and a fresh attempt can use the same account.
  for(const operation of ['restore','save'])for(const cancel of ['timeout','stop']){
    const timers=new Map()
    const readDeadline=load('src/main/services/requestDeadline.ts',{}, {
      setTimeout(fn,ms){const id={};timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)}
    })
    const pending=deferred(),entered=deferred();let block=true,readSignal
    const f=fixture({readDeadline,hooks:{getAccount:async(_id,signal)=>{if(block){readSignal=signal;entered.resolve();await pending.promise}}}})
    const work=operation==='restore'?f.service.restore(40):f.service.save(40,{uid:'100000000001111',revision:1,password:'fixture'})
    const rejected=assert.rejects(work)
    await entered.promise
    if(cancel==='timeout'){
      assert.equal(timers.size,1)
      const timer=[...timers.values()][0];assert.equal(timer.ms,18000);timer.fn()
    }else await f.service.stop()
    await rejected
    assert.equal(readSignal.aborted,true);assert.equal(f.service.active.size,0);assert.equal(timers.size,0)
    assert(!f.calls.includes('claim'));assert(!f.calls.includes('save'));assert(!f.calls.some(call=>call.startsWith('browser:')))
    block=false
    if(cancel==='stop')f.service.startSession(false)
    if(operation==='restore')await f.service.restore(40)
    else await f.service.save(40,{uid:'100000000001111',revision:1,password:'fixture'})
    const count=f.calls.length
    pending.resolve();await flush()
    assert.equal(f.calls.length,count,'late read must not start a browser, claim or credential write')
    await f.service.stop()
  }
  const listRead=deferred(),startupRead=fixture({hooks:{listAccounts:()=>listRead.promise}})
  startupRead.service.startSession();await flush();await startupRead.service.stop()
  listRead.resolve();await flush();assert(!startupRead.calls.includes('claim'))

  // Cover each proxy lookup, including after claim/promotion. The transport
  // deliberately ignores abort; no late result may reconfigure a partition.
  for(const stage of ['import','promotion','restore-local','restore-temporary','save'])for(const cancel of ['timeout','stop']){
    const timers=new Map(),registry=new AccountOperationRegistry(),pending=deferred(),entered=deferred(),applied=[]
    const readDeadline=load('src/main/services/requestDeadline.ts',{}, {
      setTimeout(fn,ms){const id={};timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)}
    })
    const isImport=stage==='import'||stage==='promotion',isRestore=stage.startsWith('restore-')
    const blockAt=stage==='promotion'||stage==='restore-temporary'?2:1
    let reads=0,block=true,proxySignal
    const f=fixture({operationRegistry:registry,readDeadline,localState:stage==='restore-temporary'?'logged_out':'authenticated',hooks:{
      account:(id,c)=>({...c.accountFor(id),proxyId:9}),
      getProxy:async(id,signal)=>{
        assert.equal(id,9);assert(signal instanceof AbortSignal)
        if(block&&++reads===blockAt){proxySignal=signal;entered.resolve();await pending.promise}
        return{id:9}
      },
      applyProxy:async(partition)=>{applied.push(partition)},
      claim:async(args)=>{
        const context={accountId:args[0],staffId:1,platform:'facebook',runtimeTarget:'desktop',previousStatus:'tạm dừng',claimToken:'token',operationName:'facebook.login'}
        return registry.claim(context,async()=>({claimed:true,...context}),async()=>({ok:true,reason:'cleaned'}),args[5])
      },
      release:async(args)=>['cleaned','not_owner'].includes(await registry.release(args[0],args[3],1))
    }})
    const begin=async()=>{
      if(isImport){const p=await f.service.preview({...input,proxyId:9});await f.service.start(p.id);return f.service.batchWork}
      return isRestore?f.service.restore(40):f.service.save(40,{uid:'100000000001111',revision:1,password:'fixture'})
    }
    const work=begin(),finished=isImport?work:assert.rejects(work)
    await entered.promise
    if(isRestore)assert(registry.has(40),'restore already owns its token before proxy lookup')
    const applyCount=applied.length
    if(cancel==='timeout'){
      assert.equal(timers.size,1);const timer=[...timers.values()][0]
      assert.equal(timer.ms,18000);timer.fn()
    }else if(isImport)await f.service.stopBatch()
    else await f.service.stop()
    await finished
    assert(proxySignal.aborted);assert.equal(timers.size,0)
    assert.equal(f.service.active.size,0);assert(!registry.has(40));assert.equal(applied.length,applyCount)
    if(isRestore)assert(f.calls.includes('release'))
    if(isImport){assert.equal(f.service.batch.running,false);assert.equal(f.account,null);assert.equal(f.logs.size,0)}
    else assert(!f.calls.includes('save'))
    // A fresh attempt may finish before the old transport responds.
    block=false
    if(f.service.lifecycle.signal.aborted)f.service.startSession(false)
    await begin()
    const newApplyCount=applied.length,newCallCount=f.calls.length
    pending.resolve();await flush()
    assert.equal(applied.length,newApplyCount,'late proxy must not change the old or new browser')
    assert.equal(f.calls.length,newCallCount,'late proxy must not resume login/commit/save')
    await f.service.stop()
  }

  const seedHeld=async(registry,id,cleanup,staffId=1,operationName='facebook.login')=>{
    const attempt=new AbortController(),context={accountId:id,staffId,platform:'facebook',runtimeTarget:'desktop',previousStatus:'tạm dừng',claimToken:'held-'+id,operationName}
    await registry.claim(context,async()=>({claimed:true,...context}),cleanup,attempt.signal)
    attempt.abort();await registry.release(id,context.claimToken,staffId)
    return context
  }
  // Recovery runs with no visible browser, has backoff, isolates a failed account,
  // and never retries the login producer or touches another staff/operation.
  const recoveryRegistry=new AccountOperationRegistry(),available=new Set(),cleanupCalls=[]
  for(const id of [40,41,42,43])await seedHeld(recoveryRegistry,id,async()=>{
    cleanupCalls.push(id)
    if(!available.has(id))throw Object.assign(Error('Temporary cleanup failure'),{code:'55P03'})
    return{ok:true,reason:'cleaned'}
  },id===42?2:1,id===43?'contacts.scan':'facebook.login')
  const recovery=fixture({operationRegistry:recoveryRegistry})
  cleanupCalls.length=0;available.add(41)
  recovery.service.recoverPending();await recovery.service.recoveryWork
  assert.deepEqual(cleanupCalls,[40]);assert(recoveryRegistry.has(40))
  assert(recovery.service.recoveryBackoff.get(40).nextAt>Date.now())
  recovery.service.recoverPending();await recovery.service.recoveryWork
  assert.deepEqual(cleanupCalls,[40,41]);assert(!recoveryRegistry.has(41))
  recovery.service.recoverPending();assert.equal(recovery.service.recoveryWork,null)
  assert.deepEqual(cleanupCalls,[40,41]);assert(!recovery.calls.length)
  available.add(40)
  // An explicit retry bypasses background backoff and reconciles before reading
  // the account status (which may still say running until cleanup commits).
  await recovery.service.restore(40)
  assert(!recoveryRegistry.has(40));assert.deepEqual(cleanupCalls,[40,41,40])
  assert(recovery.calls.includes('claim'));assert(recoveryRegistry.has(42));assert(recoveryRegistry.has(43))
  await recovery.service.stop()

  // The poller stops sending cleanup after five attempts per token/session.
  // Manual retries, another account, a new session and a new token remain usable.
  const cappedRegistry=new AccountOperationRegistry(),cappedCalls=[],allowed=new Set()
  let recoveryNow=Date.now()
  class RecoveryDate extends Date { static now(){return recoveryNow} }
  const cappedCleanup=id=>async()=>{
    cappedCalls.push(id)
    if(!allowed.has(id))throw Error('Fixture offline')
    return{ok:true,reason:'cleaned'}
  }
  await seedHeld(cappedRegistry,60,cappedCleanup(60));cappedCalls.length=0
  const capped=fixture({operationRegistry:cappedRegistry,serviceGlobals:{Date:RecoveryDate}})
  const runRecovery=async()=>{capped.service.recoverPending();await capped.service.recoveryWork}
  for(let attempt=1;attempt<=5;attempt++){
    await runRecovery();assert.equal(cappedCalls.length,attempt)
    assert.equal(capped.service.recoveryBackoff.get(60).backgroundAttempts,attempt)
    await runRecovery();assert.equal(cappedCalls.length,attempt,'backoff prevents an immediate repeat')
    recoveryNow+=300000
  }
  for(let tick=0;tick<10;tick++){recoveryNow+=300000;await runRecovery()}
  assert.equal(cappedCalls.length,5);assert(cappedRegistry.has(60));assert.equal(capped.calls.length,0)
  await seedHeld(cappedRegistry,61,cappedCleanup(61));allowed.add(61)
  await runRecovery();assert(!cappedRegistry.has(61));assert(cappedRegistry.has(60))
  await assert.rejects(capped.service.restore(60),/Chưa giải phóng/)
  assert.equal(cappedCalls.filter(id=>id===60).length,6,'manual cleanup may bypass the cap')
  assert.equal(capped.service.recoveryBackoff.get(60).backgroundAttempts,5)
  recoveryNow+=300000;await runRecovery()
  assert.equal(cappedCalls.filter(id=>id===60).length,6,'manual failure must not restart polling')
  await capped.service.stop();capped.service.startSession(false)
  await runRecovery()
  assert.equal(cappedCalls.filter(id=>id===60).length,7,'a new session gets a fresh budget')
  assert.equal(capped.service.recoveryBackoff.get(60).backgroundAttempts,1)
  for(let attempt=2;attempt<=5;attempt++){recoveryNow+=300000;await runRecovery()}
  // External/lifecycle recovery can clear a token without touching service backoff.
  allowed.add(60)
  const [oldHeld]=cappedRegistry.listRecoverable(1,'facebook.login')
  assert.equal(await cappedRegistry.recoverOperation(oldHeld,new AbortController().signal),true)
  const nextHeld={...oldHeld,claimToken:'replacement-60'},nextAttempt=new AbortController()
  allowed.delete(60)
  await cappedRegistry.claim(nextHeld,async()=>({claimed:true,...nextHeld}),cappedCleanup(60),nextAttempt.signal)
  nextAttempt.abort();await cappedRegistry.release(60,nextHeld.claimToken,1)
  const beforeNewToken=cappedCalls.length
  await runRecovery();assert.equal(cappedCalls.length,beforeNewToken+1)
  assert.equal(capped.service.recoveryBackoff.get(60).backgroundAttempts,1,'a different token must not inherit the old cap')
  allowed.add(60);await capped.service.restore(60)
  assert(!cappedRegistry.has(60));assert(!capped.service.recoveryBackoff.has(60))
  await capped.service.stop()

  const stopRegistry=new AccountOperationRegistry(),gate=deferred();let hold=false
  await seedHeld(stopRegistry,40,async()=>{if(hold){await gate.promise;return{ok:true,reason:'cleaned'}}throw Error('Fixture failure')})
  hold=true
  const duringRecovery=fixture({operationRegistry:stopRegistry})
  duringRecovery.service.recoverPending();await flush();await duringRecovery.service.stop()
  assert(stopRegistry.has(40));assert.equal(duringRecovery.service.recoveryWork,null)
  gate.resolve();await flush();assert(stopRegistry.has(40),'late response from cancelled recovery cannot silently unlock')

  // The real 30-second poller must kick recovery without a visible tab, including
  // while its previous account-list request is still pending.
  const pollRegistry=new AccountOperationRegistry(),pollList=deferred();let tick,listCalls=0,canClean=false
  const cleanupForPoll=async()=>{if(!canClean)throw Error('Offline');return{ok:true,reason:'cleaned'}}
  await seedHeld(pollRegistry,50,cleanupForPoll);canClean=true
  const polling=fixture({operationRegistry:pollRegistry})
  const {startAccountPoller}=load('src/main/domain/accounts/accountPoller.ts',{
    electron:{webContents:{fromId:()=>null}},
    '../../../shared/types':{IPC_EVENTS:{ACCOUNT_STATUS_UPDATED:'changed'}},
    '../../data/currentUser':{getCurrentUser:()=>({staffId:1})},
    '../../services/accountOperationRegistry':{accountOperationRegistry:pollRegistry},
    '../../data/repositories/accountRepository':{listAccounts:async()=>{listCalls++;return pollList.promise}},
    '../../data/repositories/zaloRuntimeModeRepository':{getZaloRuntimeRestartRequired:()=>false,isZaloLocalStartupHandoffBlocked:()=>false}
  },{setInterval(callback,ms){assert.equal(ms,30000);tick=callback}})
  startAccountPoller({listRegistered:()=>[]},{webContents:{send(){}}},undefined,polling.service)
  const firstTick=tick();await flush();assert(!pollRegistry.has(50));assert.equal(listCalls,1)
  canClean=false;await seedHeld(pollRegistry,51,cleanupForPoll);canClean=true
  await tick();await flush();assert(!pollRegistry.has(51));assert.equal(listCalls,1)
  pollList.resolve([]);await firstTick;await polling.service.stop()

  // Corrupt or unreadable restore metadata must not own ordinary manual login
  // checks. Keep managed accounts fail-closed and never reset the safety journal.
  const journalPath=path.join(directory,'facebook-login-journal.json')
  for(const unreadable of [false,true]){
    fs.rmSync(journalPath,{recursive:true,force:true})
    if(unreadable)fs.mkdirSync(journalPath)
    else fs.writeFileSync(journalPath,'{bad-json')
    const manualOnly=fixture({managed:false,journalType:journalModule.FacebookLoginJournal})
    for(const id of [70,71]){
      const wc=Object.assign(new EventEmitter(),{session:manualOnly.ses('persist:account_'+id),isDestroyed:()=>false,isLoadingMainFrame:()=>false})
      assert.equal((await manualOnly.service.checkAccount(id,wc)).loggedIn,true)
      assert.equal((await manualOnly.service.checkAccount(id,wc)).loggedIn,true)
      manualOnly.cookieChanged(id,'100000000002222')
      assert.equal((await manualOnly.service.checkAccount(id,wc)).loggedIn,true)
    }
    assert.equal(manualOnly.rpcCalls.filter(call=>call.action==='observe').length,4)
    assert(!manualOnly.calls.includes('metadata'));assert(!manualOnly.calls.includes('get'))
    assert.equal(manualOnly.service.journal,null)
    const managedOnly=fixture({journalType:journalModule.FacebookLoginJournal})
    await assert.rejects(managedOnly.service.checkAccount(40,Object.assign(new EventEmitter(),{session:managedOnly.ses('persist:account_40'),isDestroyed:()=>false,isLoadingMainFrame:()=>false})),/Không đọc được/)
    assert(!managedOnly.calls.includes('observe'))
    if(!unreadable)assert.equal(fs.readFileSync(journalPath,'utf8'),'{bad-json')
    await manualOnly.service.stop();await managedOnly.service.stop()
  }
  await Promise.all([valid,missing,unsynced,switched,unknown,disabled].map(f=>f.service.stop()))
  await Promise.all([limited.service.stop(),duplicate.service.stop(),manual.service.stop()])
  console.log('PASS Facebook parser, RFC TOTP, import/cleanup, credential scope, restore claim/release, new UID preservation, UI/reload continuity, cookie refresh and promotion conflicts, visible session refresh + poller exclusion, isolated startup cleanup/discovery, bounded claim/cleanup retries + standalone stop, read timeout/cancellation + late-response fences, in-session recovery/backoff/isolation/manual retry, and manual login with a corrupt/unreadable journal')
}
run().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(directory,{recursive:true,force:true}))
