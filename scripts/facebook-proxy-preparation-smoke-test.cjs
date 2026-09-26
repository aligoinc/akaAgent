// Real proxy runtime, login service and IPC handlers; native/DB adapters stay local.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const harness = path.join(__dirname, 'facebook-login-smoke-test.cjs')
const prefix = fs.readFileSync(harness, 'utf8').split('async function run() {')[0]
const tests = `
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return {promise,resolve,reject} }
const proxyA = {id:3,protocol:'http',host:'old.fixture.test',port:8080,username:'fixture',password:'old',isActive:true}
const proxyB = {...proxyA,id:9,host:'new.fixture.test',password:'new'}
function runtimeFixture({getSession,lookup,onSet,onClose,onReload} = {}) {
  const sessions = new Map(), writes = [], closes = [], handlers = []
  const nativeSession = partition => {
    let ses = sessions.get(partition)
    if (!ses) {
      ses = getSession ? getSession(partition) : {}
      ses.setProxy = async config => { writes.push({partition,config}); await onSet?.(partition,config); ses.applied = config }
      ses.closeAllConnections = async () => { closes.push(partition); await onClose?.(partition) }
      ses.forceReloadProxyConfig = async () => { await onReload?.(partition) }
      sessions.set(partition,ses)
    }
    return ses
  }
  const {ProxyRuntimeService} = load('src/main/services/proxyRuntimeService.ts', {
    electron:{app:{on:(event,fn)=>handlers.push({event,fn})},session:{fromPartition:nativeSession}}
  })
  return {runtime:new ProxyRuntimeService(lookup || (async()=>proxyB)),nativeSession,writes,closes,handlers}
}
async function run() {
  for (const endpoint of ['ACCOUNT_PREPARE_BROWSER_SESSION','ACCOUNT_RELOAD_PAGE']) {
    for (const change of ['account-proxy','same-id-host','same-id-password','unchanged','unknown']) {
      const entered=deferred(),gate=deferred(),handlers=new Map()
      const IPC_EVENTS=new Proxy({}, {get:(_,key)=>key})
      const desired=change==='account-proxy'?proxyB:change==='same-id-host'?{...proxyA,host:proxyB.host}
        :change==='same-id-password'?{...proxyA,password:'changed'}:proxyA
      let f
      const r=runtimeFixture({getSession:partition=>f.ses(partition),lookup:async()=>desired})
      f=fixture({localState:'logged_out',visibleState:'logged_out',hooks:{
        proxyRuntime:r.runtime,getProxy:async()=>desired,
        account:(id,c)=>({...c.accountFor(id),proxyId:desired.id}),
        rpc:async action=>{if(action==='get'){entered.resolve();await gate.promise}}
      }})
      const account={...f.accountFor(40),proxyId:desired.id}
      if(change!=='unknown')await r.runtime.applyProxyToPartition('persist:account_40',proxyA)
      const before=r.writes.length
      const {registerAccountHandlers}=load('src/main/ipc/handlers/accountHandlers.ts',{
        electron:{ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},webContents:{fromId:()=>f.visible}},
        '../../../shared/types':{IPC_EVENTS},
        '../../data/repositories/entitlementRepository':{ensureCurrentUserCanUseAccountPlatform:async()=>{}}
      })
      registerAccountHandlers({getAccount:async()=>account},{getWebContentsId:()=>1},r.runtime,
        undefined,undefined,undefined,undefined,undefined,undefined,undefined,f.service)
      const work=f.service.restore(40)
      await entered.promise
      const result=await handlers.get(endpoint)({},40,'facebook')
      assert.equal(result.success,true,endpoint+' '+change)
      assert.equal(r.writes.length-before,change==='unchanged'?0:1,endpoint+' '+change)
      assert.equal(r.nativeSession('persist:account_40').applied.proxyRules,'http://'+desired.host+':8080')
      assert.equal(r.runtime.getSessionProxyAuthentication(f.ses('persist:account_40')).password,desired.password)
      if(endpoint==='ACCOUNT_RELOAD_PAGE')assert(f.calls.includes('visible.load'))
      gate.resolve();await work;await f.service.stop()
    }
  }

  // A changed active flag also changes the effective configuration; inactive uses system.
  const r=runtimeFixture(),partition='persist:account_50'
  await r.runtime.applyProxyToPartition(partition,proxyA)
  await r.runtime.applyProxyToPartition(partition,{...proxyA,isActive:false},{reuseApplied:true})
  assert.equal(r.nativeSession(partition).applied.mode,'system')
  assert.equal(r.runtime.getSessionProxyAuthentication(r.nativeSession(partition)),null)
  await r.runtime.applyProxyToPartition(partition,null,{reuseApplied:true})
  assert.equal(r.writes.length,2,'identical effective system config can be reused')
  await r.runtime.applyProxyToPartition(partition,null)
  assert.equal(r.writes.length,3,'ordinary callers still force preparation by default')

  // Neither a failed write nor a failed flush/reload can claim a successful applied snapshot.
  for(const phase of ['set','close','reload']) {
    let fail=false
    const maybeFail=async()=>{if(fail){fail=false;throw Error('fixture native failure')}}
    const f=runtimeFixture({onSet:phase==='set'?maybeFail:undefined,onClose:phase==='close'?maybeFail:undefined,
      onReload:phase==='reload'?maybeFail:undefined})
    await f.runtime.applyProxyToPartition(partition,proxyA)
    fail=true
    const failed=f.runtime.applyProxyToPartition(partition,proxyB,{reuseApplied:true})
    if(phase==='reload')await failed;else await assert.rejects(failed,/fixture native failure/)
    await f.runtime.applyProxyToPartition(partition,proxyB,{reuseApplied:true})
    assert.equal(f.writes.length,3,phase+' must retry rather than trust failed preparation')
    await f.runtime.applyProxyToPartition(partition,proxyB,{reuseApplied:true})
    assert.equal(f.writes.length,3,phase+' successful snapshot can be reused')
  }

  // A slow native apply must not lock subsequent prepares. Overlap invalidates the snapshot.
  for(const fail of [false,true]) {
    const started=deferred(),gate=deferred()
    let first=true
    const f=runtimeFixture({onSet:async part=>{if(part===partition&&first){first=false;started.resolve();await gate.promise}}})
    const a=f.runtime.applyProxyToPartition(partition,proxyA)
    const settled=a.then(()=>null,error=>error)
    await started.promise
    await f.runtime.applyProxyToPartition(partition,proxyB,{reuseApplied:true})
    assert.equal(f.writes.length,2,'a pending native producer does not block another prepare')
    await f.runtime.applyProxyToPartition('persist:account_51',proxyA)
    assert.equal(f.writes.length,3,'other accounts do not wait')
    if(fail)gate.reject(Error('fixture native failure'));else gate.resolve()
    assert.equal(!!(await settled),fail)
    assert.equal(f.runtime.proxyStateBySession.get(f.nativeSession(partition)).pending,0)
    await f.runtime.applyProxyToPartition(partition,proxyB,{reuseApplied:true})
    assert.equal(f.writes.length,4,'overlap must never claim a reliable applied configuration')
    assert.equal(f.nativeSession(partition).applied.proxyRules,'http://new.fixture.test:8080')
    await f.runtime.applyProxyToPartition(partition,proxyB,{reuseApplied:true})
    assert.equal(f.writes.length,4,'uncontested successful preparation can be reused')
  }
  console.log('PASS Facebook proxy preparation: real login + both IPC paths, changed ID/host/password, unchanged and unknown proxy, disabled/system, native failure retries, overlapping writes never cached and no waiting lock')
}
run().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(directory,{recursive:true,force:true}))
`
vm.runInThisContext('(function(require,__dirname){'+prefix+tests+'\n})',{filename:harness})(require,__dirname)
