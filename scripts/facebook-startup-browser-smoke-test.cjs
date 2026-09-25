// Actual startup service + Electron-event coordinator; no DB, credentials or Facebook requests.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=path.join(__dirname,'facebook-login-smoke-test.cjs')
const prefix=fs.readFileSync(harness,'utf8').split('async function run() {')[0]
const tests=`
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
const tick=()=>new Promise(r=>setTimeout(r,0))
async function bounded(work){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('startup test hung')),1000)})])}finally{clearTimeout(timer)}}
function initialPage(f){
  f.mountVisible('logged_out')
  const page=f.service.visible(40)
  let url='about:blank',loading=false
  page.getURL=()=>url;page.isLoadingMainFrame=()=>loading
  f.service.startupBrowserRegistered(40,page)
  return{page,start(){url='https://www.facebook.com/';loading=true;page.emit('did-start-navigation',{},url,false,true)},
    finish(){loading=false;page.emit('did-stop-loading')},blankStop(){page.emit('did-stop-loading')}}
}
async function runStartup(){
  // Renderer preparation first: do not claim/read credentials until Facebook load finishes.
  for(const action of ['loaded','typing','navigation','reload','closed','replaced','stop','timeout']){
    const list=deferred(),shortDeadline=load('src/main/services/requestDeadline.ts',{},
      {setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?25:ms)})
    const shortBrowser=load('src/main/services/facebookStartupBrowser.ts',{
      './facebookSessionRequest':{trustedFacebookUrl},'./requestDeadline':shortDeadline})
    const f=fixture({localState:'logged_out',startupAccounts:[40],hooks:{listAccounts:()=>list.promise,
      ...(action==='timeout'?{startupBrowserModule:shortBrowser}:{})}})
    f.service.startSession();const work=f.service.startupWork
    await f.service.prepareStartupBrowser(40)
    const tab=initialPage(f);tab.blankStop();list.resolve();await tick()
    assert(!f.calls.includes('claim'),'about:blank must not release startup')
    tab.start();await tick();assert(!f.calls.includes('claim'),'initial navigation must finish first')
    if(action==='loaded')tab.finish()
    if(action==='typing')tab.page.emit('before-input-event',{}, {})
    if(action==='navigation')tab.page.emit('will-navigate',{},'https://www.facebook.com/login/')
    if(action==='reload')await f.service.prepareStartupBrowser(40)
    if(action==='closed')f.service.cancelStartupBrowser(40)
    if(action==='replaced'){f.mountVisible('logged_out');f.service.startupBrowserRegistered(40,f.service.visible(40))}
    const stopping=action==='stop'?f.service.stop():null
    await bounded(work);if(stopping)await bounded(stopping)
    assert.equal(f.loginSecrets.length,action==='loaded'?1:0,action)
    assert.equal(f.calls.filter(c=>c==='claim').length,action==='loaded'?1:0,action)
    if(action==='loaded')assert(f.calls.includes('release'))
    for(const event of ['did-stop-loading','before-input-event','will-navigate','destroyed'])assert.equal(tab.page.listenerCount(event),0,event)
    tab.finish();await tick();assert.equal(f.loginSecrets.length,action==='loaded'?1:0,'no late retry')
    assert.equal(f.service.startupBrowsers.size,0)
    await f.service.stop()
  }
  // Startup already owns restore: preparation waits, so mounting cannot cancel it.
  const claimed=deferred(),claimGate=deferred()
  const f=fixture({localState:'logged_out',startupAccounts:[40],hooks:{claim:async()=>{
    claimed.resolve();await claimGate.promise;return{claimed:true,claimToken:'token',staffId:1,previousStatus:'tạm dừng'}
  }}})
  f.service.startSession();const work=f.service.startupWork;await bounded(claimed.promise)
  let prepared=false
  const preparation=f.service.prepareStartupBrowser(40).then(()=>{prepared=true})
  await tick();assert.equal(prepared,false)
  claimGate.resolve();await bounded(Promise.all([work,preparation]))
  assert.equal(f.loginSecrets.length,1);assert(f.calls.includes('release'))
  assert.equal(f.service.startupBrowsers.size,0);await f.service.stop()
  // A tab already loading at startup follows the same bounded event wait.
  const existing=fixture({localState:'logged_out',visibleState:'logged_out',startupAccounts:[40]})
  let loading=true;existing.visible.isLoadingMainFrame=()=>loading
  existing.service.startSession();const existingWork=existing.service.startupWork
  await tick();assert(!existing.calls.includes('claim'))
  loading=false;existing.visible.emit('did-stop-loading');await bounded(existingWork)
  assert.equal(existing.loginSecrets.length,1);await existing.service.stop()
  // A stalled tab cannot prevent another account from being restored.
  const list=deferred(),shortDeadline=load('src/main/services/requestDeadline.ts',{}, {setTimeout:(fn,ms)=>setTimeout(fn,ms===30000?25:ms)})
  const isolated=fixture({localState:'logged_out',startupAccounts:[40,41],hooks:{listAccounts:()=>list.promise,
    startupBrowserModule:load('src/main/services/facebookStartupBrowser.ts',{'./facebookSessionRequest':{trustedFacebookUrl},'./requestDeadline':shortDeadline})}})
  isolated.service.startSession();const isolatedWork=isolated.service.startupWork
  await isolated.service.prepareStartupBrowser(40);list.resolve();await bounded(isolatedWork)
  assert.equal(isolated.loginSecrets.length,1);assert.equal(isolated.calls.filter(c=>c==='claim').length,1)
  await isolated.service.stop()
  // Existing session takes precedence: no password sent after manual login during first load.
  const loadedList=deferred(),manual=fixture({localState:'logged_out',startupAccounts:[40],hooks:{listAccounts:()=>loadedList.promise}})
  manual.service.startSession();const manualWork=manual.service.startupWork
  await manual.service.prepareStartupBrowser(40);const tab=initialPage(manual);tab.start()
  manual.cookieChanged(40,'100000000002222');loadedList.resolve();tab.finish();await bounded(manualWork)
  assert.equal(manual.loginSecrets.length,0);assert.equal(manual.ses('persist:account_40').cookiesData[0].value,'100000000002222')
  await manual.service.stop()
  console.log('PASS Facebook startup: both preparation orders, blank/initial loading, user input/navigation/close/replacement, timeout/stop, late events, next-account isolation and manual identity preservation')
}
runStartup().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(directory,{recursive:true,force:true}))
`
vm.runInThisContext('(function(require,__dirname){'+prefix+tests+'\n})',{filename:harness})(require,__dirname)
