const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const {EventEmitter} = require('node:events')
const {createHash} = require('node:crypto')
const {keyResponse,decryptPassword,createPasswordKeyFixture} = require('./fixtures/facebook-password-crypto.cjs')
function load(file, stubs = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText, {exports,require:name=>stubs[name]??require(name),Buffer,URLSearchParams,AbortSignal,AbortController,Error,Set,
    setTimeout,clearTimeout,Date,...globals},{filename:file})
  return exports
}
const shared=load('src/shared/facebookLogin.ts')
const totp=load('src/main/services/facebookTotp.ts',{'../../shared/facebookLogin':shared})
const uid='100000000001111', seed='JBSWY3DPEHPK3PXP'
const secret={uid,password:'fixture password +&=|',twoFactorSecret:seed,cookies:[]}
const success=()=>({uid,access_token:'must-not-return-token',session_cookies:[
  {name:'c_user',value:uid,domain:'.facebook.com',path:'/'},
  {name:'xs',value:'fixture-session',domain:'.facebook.com',path:'/',httponly:true}
]})
const challenge=(data={uid,login_first_factor:'factor'})=>({error:{code:401,error_subcode:1348162,error_data:data}})
function fixture(replies, options={}) {
  let now=60000
  const calls=[],keyCalls=[],diagnostics=[],progress=[],timers=new Map(),session={fixture:true}
  class Clock extends Date {static now(){return now}}
  const net={request(options){
    const request=new EventEmitter()
    request.abort=()=>{request.aborted=true;request.emit('abort')}
    request.end=body=>{
      const call={options,request,form:new URLSearchParams(body),at:now}
      const isKey=options.url.endsWith('/pwd_key_fetch')
      ;(isKey?keyCalls:calls).push(call)
      const reply=isKey?keyReply:replies[calls.length-1]
      assert(reply,'Unexpected extra login request')
      queueMicrotask(()=>{
        request.emit('close') // Electron 33's writable can close before the response arrives.
        if(typeof reply==='function'){reply(call);return}
        const response=new EventEmitter();response.statusCode=reply.status||200
        request.emit('response',response)
        response.emit('data',Buffer.from(reply.raw??JSON.stringify(reply.payload??reply)))
        response.emit('end');request.emit('close')
      })
    }
    return request
  }}
  const keyReply=options.keyReply??keyResponse
  const encryption=load('src/main/services/facebookPasswordEncryption.ts',{}, {Date:Clock})
  const mod=load('src/main/services/facebookLoginRequest.ts',{
    electron:{net},'../../shared/facebookLogin':shared,'./facebookTotp':totp,
    './facebookPasswordEncryption':encryption,
    'node:timers/promises':{setTimeout:async(ms,_value,{signal})=>{signal.throwIfAborted();now+=ms;await options.onDelay?.(signal)}}
  },{Date:Clock,console:{info:(...args)=>diagnostics.push(args)},setTimeout:(cb,ms)=>{const key={};timers.set(key,{cb,ms});return key},clearTimeout:key=>timers.delete(key)})
  return {calls,keyCalls,diagnostics,progress,timers,session,run:(input=secret,signal=new AbortController().signal,proxy,nameSignal)=>mod.loginFacebookWithRequests(session,input,signal,proxy,nameSignal,message=>{progress.push(message);options.onProgress?.(message)})}
}
async function run(){
  const direct=fixture([success()]),{cookies}=await direct.run()
  assert.equal(cookies.length,2);assert.equal(cookies[1].httpOnly,true)
  assert(!JSON.stringify(cookies).includes('must-not-return-token'))
  assert.equal(direct.calls[0].options.session,direct.session)
  assert.equal(direct.calls[0].options.url,'https://b-graph.facebook.com/auth/login')
  assert.equal(direct.calls[0].options.redirect,'error')
  assert.equal(direct.calls[0].options.useSessionCookies,false)
  assert.equal(decryptPassword(direct.calls[0].form.get('password')),secret.password)
  assert(!direct.calls[0].form.toString().includes(secret.password))
  assert.equal(direct.keyCalls.length,1);assert.equal(direct.keyCalls[0].options.session,direct.session)
  assert.equal(direct.keyCalls[0].form.get('device_id'),direct.calls[0].form.get('device_id'))
  assert.equal(direct.keyCalls[0].form.get('email'),null);assert.equal(direct.keyCalls[0].form.get('password'),null)
  assert.equal(direct.calls[0].form.get('api_key'),'256002347743983')
  assert.equal(direct.calls[0].form.get('machine_id'),null,'server must generate machine ID')
  const signed=new URLSearchParams(direct.calls[0].form),sig=signed.get('sig')
  signed.delete('sig');signed.delete('access_token');signed.sort()
  assert.equal(sig,createHash('md5').update([...signed].map(([k,v])=>k+'='+v).join('')+'374e60f8b9bb6b8cbb30f78030438895').digest('hex'))
  assert.equal(signed.get('jazoest'),'2'+[...signed.get('device_id')].reduce((n,c)=>n+c.charCodeAt(0),0))
  assert(!direct.calls[0].form.toString().includes(seed));assert.equal(direct.timers.size,0)

  const replacement=createPasswordKeyFixture(43)
  const refreshData={pwd_enc_key_pkg:{...replacement.keyResponse,seconds_to_live:3600},machine_id:'replacement-machine'}
  const refreshError=data=>({error:{code:418,error_subcode:2779001,error_data:data}})
  for(const encoded of [false,true]){
    const data=encoded?JSON.stringify({...refreshData,pwd_enc_key_pkg:JSON.stringify(refreshData.pwd_enc_key_pkg)}):refreshData
    const f=fixture([refreshError(data),challenge({uid,login_first_factor:'factor',machine_id:'replacement-machine'}),success()])
    assert.equal((await f.run()).cookies.length,2)
    assert.equal(f.calls.length,3);assert.equal(f.keyCalls.length,1)
    assert.equal(decryptPassword(f.calls[0].form.get('password')),secret.password)
    assert.equal(replacement.decryptPassword(f.calls[1].form.get('password')),secret.password)
    assert.equal(f.calls[1].form.get('credentials_type'),'password')
    assert.equal(f.calls[2].form.get('credentials_type'),'two_factor')
    assert.equal(f.calls[1].form.get('machine_id'),'replacement-machine')
    assert(f.calls.every(c=>c.form.get('device_id')===f.calls[0].form.get('device_id')))
    assert(f.calls.every(c=>c.form.get('email')===uid))
    assert.notEqual(f.calls[0].form.get('sig'),f.calls[1].form.get('sig'))
    assert.equal(f.timers.size,0)
    const publicOutput=JSON.stringify([f.diagnostics,f.progress])
    for(const value of [uid,secret.password,seed,'replacement-machine',replacement.keyResponse.public_key])assert(!publicOutput.includes(value))
  }
  for(const data of [undefined,{},'invalid-json',{pwd_enc_key_pkg:'invalid-json'},
    {...refreshData,pwd_enc_key_pkg:keyResponse},
    {...refreshData,pwd_enc_key_pkg:{...replacement.keyResponse,key_id:256}},
    {...refreshData,pwd_enc_key_pkg:{...replacement.keyResponse,public_key:'private-invalid-key'}},
    {...refreshData,pwd_enc_key_pkg:{...replacement.keyResponse,seconds_to_live:0}},
    {...refreshData,uid:'100000000002222'},{...refreshData,machine_id:'invalid\n'}]){
    const f=fixture([refreshError(data)]);await assert.rejects(f.run());assert.equal(f.calls.length,1);assert.equal(f.timers.size,0)
  }
  for(const firstReply of [refreshError(refreshData),challenge()]){
    const f=fixture([firstReply,refreshError(refreshData)])
    await assert.rejects(f.run(),/code=418, subcode=2779001/)
    assert.equal(f.calls.length,2,'refresh must not loop or restart password after entering OTP')
  }
  const unrelated=fixture([{error:{code:401,error_subcode:1348131,error_data:refreshData}}])
  await assert.rejects(unrelated.run());assert.equal(unrelated.calls.length,1)
  const refreshAbort=new AbortController()
  const cancelledRefresh=fixture([refreshError(refreshData)],{onProgress:message=>{if(message.includes('cập nhật khóa'))refreshAbort.abort()}})
  await assert.rejects(cancelledRefresh.run(secret,refreshAbort.signal));assert.equal(cancelledRefresh.calls.length,1)
  const hungRefresh=fixture([refreshError(refreshData),()=>{}]),hungWork=hungRefresh.run()
  const hungRejected=assert.rejects(hungWork,/quá thời gian/)
  await new Promise(setImmediate)
  const refreshTimer=[...hungRefresh.timers.values()][0];assert.equal(refreshTimer.ms,45000);refreshTimer.cb()
  await hungRejected;assert.equal(hungRefresh.calls.length,2);assert(hungRefresh.calls[1].request.aborted);assert.equal(hungRefresh.timers.size,0)

  const otp=fixture([{status:400,payload:challenge(JSON.stringify({uid,login_first_factor:'factor',machine_id:'server-machine'}))},challenge({}),success()])
  await otp.run()
  assert.equal(otp.calls.length,3)
  const [password,first,second]=otp.calls
  assert.equal(first.form.get('first_factor'),'factor')
  assert.equal(first.form.get('userid'),uid)
  assert.equal(first.form.get('password'),totp.facebookTotp(seed,first.at))
  assert.equal(first.form.get('twofactor_code'),first.form.get('password'))
  assert.notEqual(Math.floor(first.at/30000),Math.floor(second.at/30000))
  assert.equal(first.form.get('device_id'),password.form.get('device_id'))
  assert.equal(first.form.get('machine_id'),second.form.get('machine_id'))
  assert.equal(first.form.get('machine_id'),'server-machine')
  assert.equal(first.form.get('jazoest'),password.form.get('jazoest'))
  assert.equal(second.form.get('first_factor'),'factor')
  assert(otp.calls.slice(1).every(c=>!c.form.toString().includes(seed)&&c.form.get('password')!==secret.password))

  const exhausted=fixture([challenge(),challenge(),challenge()])
  await assert.rejects(exhausted.run(),/chưa chấp nhận mã 2FA/);assert.equal(exhausted.calls.length,3)
  const noSeed=fixture([challenge()])
  await assert.rejects(noSeed.run({...secret,twoFactorSecret:''}),/chưa có khóa/);assert.equal(noSeed.calls.length,1)
  // A rejection must identify the request stage and numeric server codes without
  // exposing Facebook's free-form payload or retrying the credentials.
  for(const twoFactor of [false,true]){
    const rejection={error:{code:'190',error_subcode:12345,message:secret.password,
      error_user_msg:seed,error_user_title:'must-not-return-token',error_data:{uid,login_first_factor:'must-not-return-factor'},
      fbtrace_id:'must-not-return-trace'}}
    const f=fixture([...(twoFactor?[challenge()]:[]),rejection])
    await assert.rejects(f.run(),error=>{
      assert(error.message.includes(twoFactor?'bước 2FA':'bước mật khẩu'))
      assert(error.message.includes('code=190, subcode=12345'))
      for(const sensitive of [secret.password,seed,uid,'must-not-return-token','must-not-return-factor','must-not-return-trace'])
        assert(!error.message.includes(sensitive))
      return true
    })
    assert.equal(f.calls.length,twoFactor?2:1);assert.equal(f.timers.size,0)
  }
  for(const value of [secret.password,seed,{},[],true,null,-1,1.5,2147483648,'99999999999','190 token']){
    const f=fixture([{error:{code:value,error_subcode:value,error_user_msg:secret.password}}])
    await assert.rejects(f.run(),error=>{
      assert(error.message.includes('không có mã lỗi hợp lệ'))
      assert(!error.message.includes(secret.password));assert(!error.message.includes(seed))
      return true
    })
    assert.equal(f.calls.length,1)
  }
  const legacyError=fixture([{error_code:401,error_subcode:'999',error_msg:secret.password}])
  await assert.rejects(legacyError.run(),/bước mật khẩu \(code=401, subcode=999\)/)
  assert.equal(legacyError.calls.length,1)
  // A push notification does not turn a password rejection into a supported
  // challenge. Diagnose metadata presence without leaking it or guessing retries.
  for(const encoded of [false,true]){
    const metadata={uid,login_first_factor:'private-first-factor',machine_id:'private-machine',auth_token:'private-approval-token',
      unexpected:'private-extra',password:secret.password,twoFactorSecret:seed}
    const f=fixture([{error:{code:401,error_subcode:1348131,error_data:encoded?JSON.stringify(metadata):metadata,
      message:secret.password,error_user_msg:'private-message',fbtrace_id:'private-trace'}}])
    await assert.rejects(f.run(),/bước mật khẩu \(code=401, subcode=1348131\)/)
    assert.equal(f.calls.length,1,'do not submit an OTP or wait for approval on an unrecognized rejection')
    assert.equal(f.timers.size,0);assert.equal(f.diagnostics.length,1)
    assert.deepEqual(JSON.parse(JSON.stringify(f.diagnostics[0][1])),{
      phase:'password',code:401,subcode:1348131,hasErrorData:true,uid:'match',
      hasFirstFactor:true,hasMachineId:true,hasApprovalToken:true,hasSessionCookies:false
    })
    const diagnostic=JSON.stringify(f.diagnostics)
    for(const sensitive of [uid,secret.password,seed,'private-'])assert(!diagnostic.includes(sensitive))
  }
  for(const data of [undefined,'not-json',[],{uid:'private-uid',login_first_factor:{value:'private-factor'},machine_id:[],auth_token:true}]){
    const f=fixture([{error:{code:401,error_subcode:1348131,error_data:data}}]);await assert.rejects(f.run())
    const diagnostic=f.diagnostics[0][1]
    assert.equal(diagnostic.hasFirstFactor,false);assert.equal(diagnostic.hasMachineId,false);assert.equal(diagnostic.hasApprovalToken,false)
    assert(!JSON.stringify(diagnostic).includes('private-'))
  }
  for(const data of [{uid:'100000000002222',login_first_factor:'factor'},{uid},{uid,login_first_factor:{bad:true}}]){
    const f=fixture([challenge(data)]);await assert.rejects(f.run());assert.equal(f.calls.length,1)
  }
  for(const reply of [
    {error:{code:401,error_subcode:999,error_user_msg:secret.password+' '+seed}},
    {status:429,payload:success()},{status:503,payload:success()},{status:302,payload:success()},
    {status:403,payload:success()},{raw:'<html>'+secret.password+'</html>'},
    {access_token:'token-only'},{error_code:401},{error:'bad'}, {session_cookies:[]},
    {...success(),uid:'100000000002222'},
    {...success(),session_cookies:[{name:'c_user',value:uid,domain:'.facebook.com'}]},
    {...success(),session_cookies:success().session_cookies.concat({name:'xs',value:'duplicate'})},
    {...success(),session_cookies:[{name:'xs',value:'x',domain:'.facebook.com.evil.test'},{name:'c_user',value:uid}]},
    {...success(),session_cookies:[{name:'xs',value:'x',domain:'.facebook.com',path:'/elsewhere'},{name:'c_user',value:uid}]},
    {...success(),session_cookies:[{name:'xs',value:'x',domain:'.facebook.com',expirationDate:1},{name:'c_user',value:uid}]},
    {raw:'x'.repeat(1024*1024+1)}
  ]){
    const f=fixture([reply])
    await assert.rejects(f.run(),error=>!error.message.includes(secret.password)&&!error.message.includes(seed))
    assert.equal(f.calls.length,1);assert.equal(f.timers.size,0)
  }
  const abort=new AbortController(),pending=fixture([()=>{}]),work=pending.run(secret,abort.signal)
  const rejected=assert.rejects(work,/hủy/)
  await new Promise(setImmediate)
  abort.abort();await rejected
  assert(pending.calls[0].request.aborted);assert.equal(pending.timers.size,0)
  // A late transport response must not start 2FA or return cookies after cancellation.
  const late=new EventEmitter();late.statusCode=200
  pending.calls[0].request.emit('response',late);late.emit('data',Buffer.from(JSON.stringify(challenge())));late.emit('end')
  assert.equal(pending.calls.length,1)
  const preAbort=fixture([]);await assert.rejects(preAbort.run(secret,AbortSignal.abort()));assert.equal(preAbort.calls.length,0)
  const timeout=fixture([()=>{}]),timedWork=timeout.run(),timedReject=assert.rejects(timedWork,/quá thời gian/)
  await new Promise(setImmediate)
  const timer=[...timeout.timers.values()][0];assert.equal(timer.ms,45000);timer.cb();await timedReject
  assert(timeout.calls[0].request.aborted);assert.equal(timeout.timers.size,0)
  const broken=fixture([({request})=>request.emit('error',new Error(secret.password))])
  await assert.rejects(broken.run(),/Kiểm tra mạng/)

  for(const authInfo of [{isProxy:true,host:'proxy.test',port:8080},{isProxy:false,host:'proxy.test',port:8080},{isProxy:true,host:'wrong.test',port:8080}]){
    const auth=fixture([({request})=>{
      let supplied
      request.emit('login',authInfo,(...args)=>{supplied=args})
      assert.equal(supplied.length,authInfo.isProxy&&authInfo.host==='proxy.test'?2:0)
      if(supplied.length)assert.deepEqual(supplied,['account-A','secret-A'])
      request.emit('login',authInfo,(...args)=>assert.equal(args.length,0,'never repeat rejected proxy credentials'))
      request.emit('error',new Error('fixture'))
    }])
    await assert.rejects(auth.run(secret,new AbortController().signal,{host:'proxy.test',port:8080,username:'account-A',password:'secret-A'}))
  }

  // Name lookup is opt-in, uses only the final login user token, and never leaks it.
  const withName=fixture([challenge(),success(),{id:'app-scoped-id',name:'  Nguyễn Văn A  '}])
  const named=await withName.run(secret,new AbortController().signal,null,new AbortController().signal)
  assert.equal(await named.name,'Nguyễn Văn A');assert.equal(named.cookies.length,2)
  assert(!JSON.stringify(named).includes('must-not-return-token'))
  const graph=withName.calls[2]
  assert.equal(graph.options.url,'https://graph.facebook.com/me?fields=id,name')
  assert.equal(graph.options.method,'GET');assert.equal(graph.form.toString(),'')
  assert.equal(graph.options.headers.Authorization,'Bearer must-not-return-token')
  assert.equal(graph.options.session,withName.session);assert.equal(graph.options.useSessionCookies,false)
  assert.equal(graph.options.redirect,'error');assert.equal(withName.timers.size,0)
  for(const token of [undefined,'',123,'bad\r\ntoken','x'.repeat(8193)]){
    const missing=fixture([{...success(),access_token:token}])
    const result=await missing.run(secret,new AbortController().signal,null,new AbortController().signal)
    assert.equal(await result.name,undefined);assert.equal(result.cookies.length,2);assert.equal(missing.calls.length,1)
  }
  for(const reply of [
    {name:''},{name:123},{name:'\n\u0000bad'},{id:uid},
    {status:401,payload:{error:{message:secret.password},name:'Must not use'}},
    {status:429,payload:{name:'Must not use'}},{status:503,payload:{name:'Must not use'}},
    {status:302,payload:{name:'Must not use'}},{raw:'<html>bad</html>'},{raw:'x'.repeat(65537)},
    ({request})=>request.emit('error',new Error('must-not-return-token'))
  ]){
    const fallback=fixture([success(),reply])
    const result=await fallback.run(secret,new AbortController().signal,null,new AbortController().signal)
    assert.equal(await result.name,undefined);assert.equal(result.cookies.length,2)
    assert.equal(fallback.calls.length,2);assert.equal(fallback.timers.size,0)
  }
  const slowName=fixture([success(),()=>{}])
  const slowResult=await slowName.run(secret,new AbortController().signal,null,new AbortController().signal)
  const nameTimer=[...slowName.timers.values()][0];assert.equal(nameTimer.ms,10000);nameTimer.cb()
  assert.equal(await slowResult.name,undefined);assert.equal(slowResult.cookies.length,2)
  assert(slowName.calls[1].request.aborted);assert.equal(slowName.timers.size,0)
  for(const cancelWholeAttempt of [false,true]){
    const main=new AbortController(),name=new AbortController(),pendingName=fixture([success(),()=>{}])
    const result=await pendingName.run(secret,main.signal,null,name.signal)
    ;(cancelWholeAttempt?main:name).abort()
    assert.equal(await result.name,undefined);assert(pendingName.calls[1].request.aborted)
    assert.equal(main.signal.aborted,cancelWholeAttempt);assert.equal(pendingName.timers.size,0)
    const late=new EventEmitter();late.statusCode=200
    pendingName.calls[1].request.emit('response',late);late.emit('data',Buffer.from('{"name":"Late Name"}'));late.emit('end')
    assert.equal(await result.name,undefined);assert.equal(pendingName.calls.length,2)
  }
  const noLookup=fixture([success()]),noLookupResult=await noLookup.run(secret,new AbortController().signal,null,AbortSignal.abort())
  assert.equal(await noLookupResult.name,undefined);assert.equal(noLookup.calls.length,1)
  const wrongCookies=fixture([{...success(),uid:'222222'}])
  await assert.rejects(wrongCookies.run(secret,new AbortController().signal,null,new AbortController().signal))
  assert.equal(wrongCookies.calls.length,1,'never use a token from rejected cookie identity')
  const graphProxy=fixture([success(),({request})=>{
    request.emit('login',{isProxy:true,host:'proxy.test',port:8080},(...args)=>assert.deepEqual(args,['account-A','secret-A']))
    request.emit('login',{isProxy:true,host:'proxy.test',port:8080},(...args)=>assert.equal(args.length,0))
    request.emit('error',new Error('fixture'))
  }])
  const proxyResult=await graphProxy.run(secret,new AbortController().signal,{host:'proxy.test',port:8080,username:'account-A',password:'secret-A'},new AbortController().signal)
  assert.equal(await proxyResult.name,undefined)
  // Key preparation is a separate, bounded request. A bad key must never fall
  // back to sending a raw password (nor trigger an authentication request).
  for(const keyReply of [{}, {...keyResponse,key_id:256}, {...keyResponse,key_id:true},
    {...keyResponse,key_id:'1 token'}, {...keyResponse,public_key:secret.password},
    {error:{message:secret.password}}, {raw:'<html>'+secret.password}, {status:503}, {raw:'x'.repeat(1024*1024+1)}]) {
    const bad=fixture([],{keyReply})
    await assert.rejects(bad.run(),error=>!error.message.includes(secret.password))
    assert.equal(bad.calls.length,0);assert.equal(bad.keyCalls.length,1);assert.equal(bad.timers.size,0)
  }
  const keyAbort=new AbortController(),keyPending=fixture([],{keyReply:()=>{}})
  const keyWork=keyPending.run(secret,keyAbort.signal),keyRejected=assert.rejects(keyWork,/hủy/)
  keyAbort.abort();await keyRejected
  assert(keyPending.keyCalls[0].request.aborted);assert.equal(keyPending.calls.length,0);assert.equal(keyPending.timers.size,0)
  const encryption=load('src/main/services/facebookPasswordEncryption.ts')
  const encrypted=encryption.encryptFacebookPassword('  +&=%#é thử 測試 |  ',keyResponse.key_id,keyResponse.public_key)
  assert.equal(decryptPassword(encrypted),'  +&=%#é thử 測試 |  ')
  const changedTimestamp=encrypted.split(':');changedTimestamp[2]=String(Number(changedTimestamp[2])+1)
  assert.throws(()=>decryptPassword(changedTimestamp.join(':')),'timestamp must authenticate the ciphertext')

  const pushChallenge=(data={})=>({error:{code:406,error_data:{uid,login_first_factor:'factor',machine_id:'push-machine',auth_token:'push-token',...data}}})
  const approved=value=>({data:[{approved:value}]})
  const noOtp={...secret,twoFactorSecret:''}
  const push=fixture([pushChallenge(),approved(false),approved(true),success()])
  const pushResult=await push.run(noOtp)
  assert.equal(pushResult.cookies.length,2);assert.equal(push.calls.length,4);assert.equal(push.keyCalls.length,1)
  const [initial,check1,check2,exchange]=push.calls
  assert.equal(check1.options.url,'https://graph.facebook.com/check_approved_machine')
  assert.equal(check1.options.session,push.session);assert.equal(check1.options.useSessionCookies,false)
  assert.equal(check1.form.get('u'),uid);assert.equal(check1.form.get('m'),'push-machine')
  assert.equal(check1.form.get('password'),null);assert.equal(check1.form.get('auth_token'),null)
  assert.equal(check2.at-check1.at,5000)
  assert.equal(exchange.form.get('credentials_type'),'transient_token');assert.equal(exchange.form.get('password'),'push-token')
  assert.equal(exchange.form.get('machine_id'),'push-machine');assert.equal(exchange.form.get('device_id'),initial.form.get('device_id'))
  assert.equal(exchange.form.get('twofactor_code'),null);assert.equal(exchange.form.get('first_factor'),null)
  assert(push.progress.some(message=>message.includes('chờ bạn phê duyệt')))
  assert(!JSON.stringify(push.progress).includes('push-token'));assert.equal(push.timers.size,0)

  const afterOtp=fixture([pushChallenge(),challenge({}),challenge({}),approved(true),success()])
  await afterOtp.run();assert.equal(afterOtp.calls.length,5)
  assert.equal(afterOtp.calls.filter(call=>call.form.get('credentials_type')==='password').length,1)
  assert.equal(afterOtp.calls.filter(call=>call.form.get('credentials_type')==='two_factor').length,2)
  assert.equal(afterOtp.calls.at(-1).form.get('first_factor'),null)
  assert.equal(afterOtp.calls.at(-1).form.get('twofactor_code'),null)
  const pushOnly=fixture([pushChallenge({login_first_factor:null}),approved(true),success()])
  await pushOnly.run();assert.equal(pushOnly.calls.length,3,'challenge without OTP metadata can use a complete approval challenge')
  const rotated=fixture([pushChallenge(),challenge({machine_id:'new-machine'}),challenge({})])
  await assert.rejects(rotated.run(),/chưa chấp nhận mã 2FA/);assert.equal(rotated.calls.length,3,'do not reuse approval token after machine rotation')
  for(const data of [{uid:'222222'},{machine_id:''},{auth_token:[]},{login_first_factor:null,auth_token:null}]){
    const bad=fixture([pushChallenge(data)])
    await assert.rejects(bad.run(noOtp));assert.equal(bad.calls.length,1)
  }
  for(const response of [approved('true'),{data:[]},approved(null),{status:429},
    {error:{code:190,message:'push-token'}},{raw:'<html>push-token'}]){
    const bad=fixture([pushChallenge(),response])
    await assert.rejects(bad.run(noOtp),error=>!error.message.includes('push-token'))
    assert.equal(bad.calls.length,2);assert.equal(bad.timers.size,0)
  }
  const never=fixture([pushChallenge(),...Array.from({length:12},()=>approved(false))])
  await assert.rejects(never.run(noOtp),/Chưa nhận được phê duyệt/)
  assert.equal(never.calls.length,13);assert.equal(never.timers.size,0)
  const pushTimeout=fixture([pushChallenge(),()=>{}]),pushTimeoutWork=pushTimeout.run(noOtp)
  const pushTimeoutRejected=assert.rejects(pushTimeoutWork,/Chưa nhận được phê duyệt/)
  await new Promise(setImmediate)
  const waitTimer=[...pushTimeout.timers.values()].find(t=>t.ms===60000);assert(waitTimer);waitTimer.cb()
  await pushTimeoutRejected;assert(pushTimeout.calls[1].request.aborted);assert.equal(pushTimeout.timers.size,0)
  const cancelPush=new AbortController(),cancelWaiting=fixture([pushChallenge(),approved(false)],{onDelay:()=>cancelPush.abort()})
  await assert.rejects(cancelWaiting.run(noOtp,cancelPush.signal),/hủy/)
  assert.equal(cancelWaiting.calls.length,2);assert.equal(cancelWaiting.timers.size,0)
  const exchangeFailure=fixture([pushChallenge(),approved(true),{error:{code:401,error_subcode:1348131}}])
  await assert.rejects(exchangeFailure.run(noOtp),/bước phê duyệt/);assert.equal(exchangeFailure.calls.length,3)
  const tokenOnly=fixture([pushChallenge(),approved(true),{access_token:'token-only'}])
  await assert.rejects(tokenOnly.run(noOtp));assert.equal(tokenOnly.calls.length,3)
  console.log('PASS Facebook Android encrypted login: key preparation, signature, TOTP/machine identity, bounded approval/exchange/cancel, no raw password fallback, proxy, cookie validation and optional Graph name')
}
run().catch(error=>{console.error(error);process.exitCode=1})
