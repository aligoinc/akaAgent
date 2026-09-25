// Exercise the actual login/dispose methods inside the actual login service, with only
// native storage and external services deferred. Never reads real credentials.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const harness = path.join(__dirname,'facebook-login-smoke-test.cjs')
let prefix = fs.readFileSync(harness,'utf8').split('async function run() {')[0]
prefix = prefix.replace("async dispose(){calls.push('dispose:'+this.partition)}", "async dispose(){calls.push('dispose:'+this.partition);await RealSession.prototype.dispose.call(this)}")
prefix = prefix.replace("async login(secret,_proxy,lookupName=false,onProgress) {", "async login(secret,_proxy,lookupName=false,onProgress) {if(hooks.sessionLogin)return hooks.sessionLogin(this,secret,context);")
const tests = `
const shortDeadline=load('src/main/services/requestDeadline.ts',{}, {setTimeout:(fn,ms)=>setTimeout(fn,ms===18000?25:ms)})
let passwordRequests=0
const {FacebookLoginSession:RealSession}=load('src/main/services/facebookLoginSession.ts',{
  electron:{},'../../shared/facebookLogin':shared,'./facebookLoginRequest':{loginFacebookWithRequests:async(_ses,secret)=>{
    passwordRequests++
    return{cookies:[{name:'c_user',value:secret.uid,domain:'.facebook.com',path:'/',secure:true,httpOnly:true},
      {name:'xs',value:'fixture-session',domain:'.facebook.com',path:'/',secure:true,httpOnly:true}],name:Promise.resolve(null)}
  }},'./facebookSessionRequest':{},'./requestDeadline':shortDeadline
})
const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject}}
const pause=ms=>new Promise(r=>setTimeout(r,ms))
const bounded=async work=>{
  let timer
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('test operation did not finish')),1000)})])}
  finally{clearTimeout(timer)}
}
const input={uid:'100000000001111',revision:0,password:'fixture-only',twoFactorSecret:'JBSWY3DPEHPK3PXP'}
async function runDispose(){
  for(const failure of [null,'rpc','release']){
    const gate=deferred(),entered=deferred();let clears=0
    const f=fixture({managed:false,hooks:{
      login:async c=>{c.ses('temp:20').clearStorageData=async()=>{clears++;entered.resolve();await gate.promise;c.ses('temp:20').cookiesData=[]}},
      rpc:async action=>{if(failure==='rpc'&&action==='login')throw Error('Fixture database offline')},
      release:async()=>failure!=='release'
    }})
    let finished=false
    const work=f.service.login(40,input).then(()=>{assert.equal(failure,null)},error=>{
      assert(failure);assert.match(error.message,failure==='rpc'?/chưa xác nhận lưu/:/Chưa giải phóng/)
    }).finally(()=>finished=true)
    await entered.promise
    assert(f.calls.indexOf('release')<f.calls.indexOf('dispose:temp:20'),'DB release happens before native disposal')
    assert.equal(finished,false);assert.equal(clears,1)
    const stop=f.service.stop()
    await Promise.race([Promise.all([work,stop]),pause(500).then(()=>{if(!finished)throw Error('native disposal blocked stop')})])
    assert.equal(f.service.isLoggingIn(40),false)
    f.cookieChanged(40,'100000000002222');gate.resolve();await pause(5)
    assert.equal(f.ses('persist:account_40').cookiesData[0].value,'100000000002222','late temp disposal cannot touch the account')
  }
  console.log('PASS release before bounded native disposal: success/DB failure/release failure, stop completes, late disposal cannot touch persistent session')
}
async function runExpiredCookieClear(){
  for(const mode of ['timeout','abort','stop','error','success']){
    const gate=deferred(),entered=deferred(),registry=new AccountOperationRegistry()
    let heldInDB=false
    const f=fixture({localState:'logged_out',operationRegistry:registry,hooks:{
      claim:async args=>registry.claim({accountId:40,staffId:1,platform:'facebook',runtimeTarget:'desktop',
        previousStatus:'tạm dừng',claimToken:'token',operationName:'facebook.login',facebookClaimGeneration:0},
        async()=>{heldInDB=true;return{claimed:true,claimToken:'token',staffId:1,previousStatus:'tạm dừng'}},
        async()=>{heldInDB=false;return{ok:true,reason:'cleaned'}},args[5]),
      release:async()=>['cleaned','not_owner'].includes(await registry.release(40,'token',1)),
      sessionLogin:async(browser,secret)=>{
        const ses=browser.ses
        ses.cookies.get=async()=>ses.cookiesData
        ses.cookies.set=async cookie=>{ses.cookiesData=ses.cookiesData.filter(c=>c.name!==cookie.name).concat(cookie)}
        ses.cookies.flushStore=async()=>{}
        ses.clearStorageData=async()=>{
          entered.resolve()
          if(browser.partition==='temp:20'){
            if(mode==='error')throw Error('Fixture native clear failed')
            if(mode!=='success')await gate.promise
          }
          ses.cookiesData=[]
        }
        let observed=false
        browser.observe=async()=>{
          if(secret.cookies.length&&!observed){observed=true;return{state:'logged_out'}}
          return{state:'authenticated',uid:secret.uid}
        }
        return RealSession.prototype.login.call(browser,{...secret,cookies:secret.cookies.map(c=>({...c,path:'/',secure:true,httpOnly:true}))})
      }
    }})
    const beforeRequests=passwordRequests
    const work=f.service.restore(40).then(()=>null,error=>error)
    await bounded(entered.promise)
    let stopped
    if(mode==='abort')f.service.active.get(40).abort.abort(Error('Fixture cancelled'))
    if(mode==='stop')stopped=f.service.stop()
    const error=await bounded(work)
    if(mode==='success')assert.equal(error,null)
    else{
      assert(error,mode)
      if(mode==='timeout')assert.match(error.message,/quá thời gian/)
      if(mode==='error')assert.match(error.message,/native clear failed/)
    }
    await bounded(stopped||f.service.stop())
    assert.equal(passwordRequests-beforeRequests,mode==='success'?1:0,'failed clear must not send password')
    assert.equal(f.service.isLoggingIn(40),false);assert.equal(registry.has(40),false);assert.equal(heldInDB,false)
    assert.equal(f.calls.filter(c=>c==='release').length,1)
    assert(f.calls.indexOf('release')<f.calls.indexOf('dispose:temp:20'))
    if(mode!=='success')assert(!f.calls.includes('copy'),'failed clear must preserve the persistent session')
    if(['timeout','abort','stop'].includes(mode)){
      // A new attempt finishes before the old native clear settles.
      f.service.startSession(false)
      await bounded(f.service.login(40,{...input,uid:'100000000002222',revision:1}))
      const current=JSON.stringify(f.ses('persist:account_40').cookiesData),requests=passwordRequests
      if(mode==='abort')gate.reject(Error('Fixture late native failure'))
      else gate.resolve()
      await pause(5)
      assert.equal(JSON.stringify(f.ses('persist:account_40').cookiesData),current,'late clear cannot erase the newer session')
      assert.equal(passwordRequests,requests,'late clear cannot resume the old password login')
      assert.equal(f.secrets.get(40).uid,'100000000002222')
      assert.equal(registry.has(40),false)
      await bounded(f.service.stop())
    }
  }
  console.log('PASS expired-cookie clear: timeout/abort/stop/error release the claim, late completion/rejection cannot resume login or erase newer session, normal password fallback succeeds')
}
runDispose().then(runExpiredCookieClear).catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(directory,{recursive:true,force:true}))
`
vm.runInThisContext('(function(require,__dirname){'+prefix+tests+'\n})',{filename:harness})(require,__dirname)
