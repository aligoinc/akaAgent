const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), path = require('node:path')
const root = path.resolve(__dirname,'..')
function load(file, imports = {}) {
  const exports = {}, code = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  vm.runInNewContext(code,{exports,require:name=>imports[name]??require(name),console,process,URL,Date,Math,Map,Set,Promise,AbortController,AbortSignal,setTimeout,clearTimeout,setImmediate,queueMicrotask})
  return exports
}
const shared = load('src/shared/facebookWebEnrichment.ts')
const plannerModule = load('src/main/services/webEnrichmentPlanner.ts')
const {WebEnrichmentPlanner} = plannerModule
const browser = load('src/main/services/webEnrichmentBrowser.ts')
const control = load('src/main/services/webEnrichmentControl.ts')
const time = (s,day='2026-10-14') => Date.parse(`${day}T${s}:00+07:00`)
const midnight = time('00:00','2026-10-15')
const config = {...shared.emptyWebEnrichmentConfig(),revision:1,industry:'Dịch vụ',keywords:['one','two','three'],websites:['a','b','c'].map(x=>`https://${x}.example/`),slots:['08:00','08:30','09:00'],minutesPerSession:45,stopDate:null}
const observe = (p,clock,c=config) => p.observe(c,time(clock),'2026-10-14',midnight)
const flush = () => new Promise(resolve=>setImmediate(resolve))
let checks=0
function check(value,message){assert.ok(value,message);checks++}
async function main(){
 check(shared.validateWebEnrichment({enabled:true,config}).enabled)
 assert.throws(()=>shared.validateWebEnrichment({enabled:true,config:{...config,keywords:['A','a','b']}}));checks++
 for(const [now,date] of [['2026-10-14T16:59:59Z','2026-10-21'],['2026-10-14T17:00:00Z','2026-10-22'],['2026-12-28T18:00:00Z','2027-01-05'],['2028-02-22T17:00:00Z','2028-03-01']]){
   const defaults=shared.emptyWebEnrichmentConfig(Date.parse(now))
   assert.equal(defaults.stopDate,date);assert.equal(defaults.slots.length,0);checks+=2
 }
 for(const websites of [config.websites.slice(0,2),[...config.websites,'https://d.example/'],['a.example','https://a.example/','https://c.example/']]){
   assert.throws(()=>shared.validateWebEnrichment({enabled:true,config:{...config,websites}}));checks++
 }
 const legacy={...config,websites:['a','b','c','d','e'].map(x=>`https://${x}.example/`)}
 assert.throws(()=>shared.validateWebEnrichment({enabled:true,config:legacy}));checks++
 assert.equal(shared.validateWebEnrichment({enabled:true,config:legacy},{allowLegacyFiveWebsites:true}).config.websites.length,5);checks++
 assert.equal(shared.validateWebEnrichment({enabled:false,config:legacy}).config.websites.length,5);checks++
 assert.equal(shared.validateWebEnrichment({enabled:true,config}).config.stopDate,null);checks++
 check(!shared.validateWebEnrichment({enabled:false,config:shared.emptyWebEnrichmentConfig()}).enabled)
 check(shared.hasWebEnrichmentOverlap(config.slots,45));check(!shared.hasWebEnrichmentOverlap(['08:00','10:00'],45))
 assert.equal(shared.normalizeWebUrl('Example.com'),'https://example.com/');checks++
 assert.equal(shared.normalizeWebUrl('Example.com:8080'),'https://example.com:8080/');checks++
 for(const [start,end,expected] of [['08:10','08:55','09:00'],['08:25','09:10',undefined]]){
   const p=new WebEnrichmentPlanner();check(observe(p,start));p.started(time(start));p.finished(time(end))
   assert.equal(observe(p,end),undefined);checks++
   assert.equal(observe(p,'09:10')?.key,expected);checks++
 }
 const pending=new WebEnrichmentPlanner();check(observe(pending,'08:10'));assert.equal(observe(pending,'08:30').key,'08:30');checks++
 const late=new WebEnrichmentPlanner();assert.equal(observe(late,'09:31'),undefined);checks++
 const stable=new WebEnrichmentPlanner();assert.equal(observe(stable,'08:00')?.key,'08:00');check(observe(stable,'08:15'));check(observe(stable,'08:20'))
 stable.discardThrough(time('08:31'));assert.equal(observe(stable,'08:31'),undefined);observe(stable,'09:00');check(observe(stable,'09:16'));checks++
 const changed=new WebEnrichmentPlanner();check(observe(changed,'08:10'));assert.equal(observe(changed,'08:11',{...config,revision:2})?.key,'08:00');checks++
 const ended=new WebEnrichmentPlanner();assert.equal(observe(ended,'08:01',{...config,stopDate:'2026-10-13'}),undefined);checks++
 // Native operation hangs; cancellation destroys its page and fences a late callback.
 for(const kind of ['timeout','abort','workflow-error','crash','http']) {
   const ac=new AbortController();let destroyed=0, calls=0, facade, late, closed
   const task=browser.runWebEnrichmentBrowser({signal:ac.signal,budgetMs:1000,operationTimeoutMs:15,
     createPage:()=>({page:{navigate:()=>{calls++;return new Promise(r=>{late=r})},evaluate:async()=>{calls++}},destroy:()=>{destroyed++},onClosed:fn=>{closed=fn;return()=>{}},navigationFailed:()=>kind==='http'}),
     run:async page=>{facade=page;if(kind==='workflow-error')throw Error('workflow');if(kind==='crash')return new Promise(()=>{});await page.navigate('https://example.test');await page.evaluate('late')}
   })
   const rejection=assert.rejects(task)
   await flush()
   if(kind==='abort')ac.abort();if(kind==='crash')closed();if(kind==='http')late()
   await rejection;assert.equal(destroyed,1);checks++
   const before=calls;late?.();await flush();await assert.rejects(facade.evaluate('after release'));assert.equal(calls,before);checks++
 }
 // Real service + real browser fence, with clock/cache/engine adapters only.
 let now=time('08:00'), runCalls=0, destroyed=0, wake=0, lastContext,lastVariables
 const clock=()=>({dbNow:new Date(now).toISOString(),vietnamDateKey:'2026-10-14',nextVietnamMidnight:new Date(midnight).toISOString()})
 const {WebEnrichmentService}=load('src/main/services/webEnrichmentService.ts',{
   '../../shared/facebookWebEnrichment':shared,'./webEnrichmentPlanner':plannerModule,'./webEnrichmentBrowser':browser,'./webEnrichmentControl':control,
   '../data/repositories/runtimeClockRepository':{peekDatabaseRuntimeClock:clock},'../data/repositories/webEnrichmentRepository':{webEnrichmentRpc:async()=>({enabled:true,config})},
   '../data/repositories/workflowV2Repository':{},'../data/repositories/blockRepository':{},'../data/supabaseClient':{},
   './accountLogService':{recordAccountLog:()=>{throw Error('HTTP log unavailable')}},
   '../v2/runtime/workflowEngine':{WorkflowEngineV2:class{run(_wf,_vars,_page,ctx){lastContext=ctx;lastVariables=_vars;runCalls++;return new Promise(()=>{})}}}
 })
 const service=new WebEnrichmentService({ready:()=>true,createPage:()=>({page:{},destroy:()=>{destroyed++}}),wake:()=>{wake++}})
 service.start(); service.package={workflow:{},blocks:new Map(),selectors:{}}
 const a={id:1,flatformType:'facebook',isActive:true,loginStatus:'đã đăng nhập',status:'chờ xử lý',facebookWebEnrichmentEnabled:true,facebookWebEnrichmentRevision:1}
 const b={...a,id:2}
 service.observe([a,b]);await flush()
 for(const c of service.accounts.values()){c.planner=new WebEnrichmentPlanner();c.settings.config.hobbies=['one','music']}
 const running=service.tryRun(a,false);check(running);check(service.isActive(a.id));assert.equal(service.tryRun(b,false),undefined);checks++
 check(lastContext.persist===false && lastContext.preparedBlocks instanceof Map)
 check(lastVariables.webConfig.hobbies.length===1 && lastVariables.webConfig.hobbies[0]==='music','deduplicate runtime query sources without changing saved interests')
 control.preemptWebEnrichment(a.id);assert.equal(destroyed,1);await running;check(!service.isActive(a.id));assert.equal(control.webEnrichmentSnapshot().length,0);checks++
 service.observe([a,b]);check(!service.tryRun(a,false),'resume does not replay current slot')
 now=time('08:30');service.observe([a,b]);check(!service.tryRun(a,true),'campaign gets priority after cancel')
 service.campaignFinished(a.id);const again=service.tryRun(a,true);check(again)
 const old={accountId:1,runId:'old'};control.setWebEnrichmentState(old,false);assert.equal(control.webEnrichmentSnapshot().length,1);checks++
 service.stop();await again;check(wake>=2);check(runCalls===2)
 // Cold profile reads never create a partition; editing a proxy invalidates readiness locally.
 let partitions=0,preempted=0
 const ses={setProxy:async()=>{},closeAllConnections:async()=>{},forceReloadProxyConfig:async()=>{}}
 const {ProxyRuntimeService}=load('src/main/services/proxyRuntimeService.ts',{
   electron:{app:{on(){}},session:{fromPartition:()=>{partitions++;return ses}}},
   './webEnrichmentControl':{...control,preemptWebEnrichment:()=>{preempted++}}
 })
 const proxy=new ProxyRuntimeService(async id=>({id,protocol:'http',host:'proxy.example',port:8080,isActive:true}))
 const withProxy={...a,proxyId:5}
 check(!proxy.isAccountSessionPrepared(withProxy));assert.equal(partitions,0);checks++
 await proxy.prepareAccountSession(withProxy);check(proxy.isAccountSessionPrepared(withProxy))
 proxy.invalidatePreparedProxy(6);check(proxy.isAccountSessionPrepared(withProxy))
 proxy.invalidatePreparedProxy(5);check(!proxy.isAccountSessionPrepared(withProxy));assert.equal(preempted,1);checks++
 let releaseProxy
 const delayedProxy=new ProxyRuntimeService(()=>new Promise(resolve=>{releaseProxy=resolve}))
 const preparing=delayedProxy.prepareAccountSession(withProxy)
 delayedProxy.invalidatePreparedProxy(5)
 releaseProxy({id:5,protocol:'http',host:'old.example',port:8080,isActive:true});await preparing
 check(!delayedProxy.isAccountSessionPrepared(withProxy),'late preparation cannot revive an edited proxy')
 // The real scheduler only offers the browser after executeCampaign returns and cleanup guards pass.
 const {schedulerClass}=require('./campaign-media-timeout-smoke-test.cjs')
 const events=[], Scheduler=schedulerClass({}, {'./accountOperationRegistry':{accountOperationRegistry:{has:()=>false}}})
 const campaign={id:3,status:'chờ xử lý',schedule:'2026-10-01T00:00:00Z',actionId:'facebook_group_post'}
 const s=new Scheduler({getAccount:async()=>a,getCampaign:async()=>campaign},{},{webContents:{send(){}}})
 Object.assign(s,{running:true,getReadyRuntimeClock:async()=>clock(),executeCampaign:async()=>{events.push('execute');await flush();events.push('released')},
   hasFailedAccountRun:()=>false,webEnrichment:{campaignFinished:()=>events.push('fair'),tryRun:()=>{events.push('browse')}}})
 await s.runAccountCampaignQueue(a,[campaign,{...campaign,id:4}]);check(events.indexOf('browse')>events.indexOf('released'))
 let stopped=false
 s.webEnrichment={stop:()=>{stopped=true}};s.cancelFailureCleanups=()=>{}
 s.stopAcceptingNewZaloWork();check(stopped && !s.running,'staff expiry cancels optional browsing before draining campaigns')
 console.log(`PASS ${checks} web enrichment validation/planner/browser/service/scheduler checks`)
}
main().catch(error=>{console.error(error);process.exitCode=1})
