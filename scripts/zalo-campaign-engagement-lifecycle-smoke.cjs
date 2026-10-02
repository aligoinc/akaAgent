const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const load=(file,mocks={},globals={})=>{const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8')+(file.includes('services/zaloCampaignEngagement')?'\nexport const testIdle=()=>!writing && staging===0 && [...scopes.values()].every(s=>!s.saving);export const testAdmittedEvent=(target,watch)=>{const owner=captureOwner();void config.get().then(()=>{if(!owner())return;getScope();watches.put({...watch,campaign_detail_id:"resident-"+target,target_zalo_uid:target});receiveCampaignEngagement("message",{type:0,isSelf:false,data:{uidFrom:target,idTo:"own"}},1,"own")}).catch(()=>undefined)};':''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:key=>Object.hasOwn(mocks,key)?mocks[key]:require(key),console,Buffer,AbortSignal,Date,setTimeout,clearTimeout,...globals},{filename:file});return module.exports}
const shared=load('src/shared/zaloCampaignEngagement.ts'),revision='2026-10-02T00:00:00Z'
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setTimeout(resolve,3))}
function harness(directory){
 let rpcData,ownerRead;let now=Date.parse('2026-10-02T00:01:00Z'),timers=[],timerRuns=0,fail=false,settingsRead,settings=shared.ENGAGEMENT_KEYS.map((key,i)=>({key,value:['true','5','100','48'][i],updated_at:revision,is_active:true,is_secret:false}))
 let user={staffId:1,organizationId:1},credentials={username:'owner',password:'secret'},serverPassword='secret',ownerReads=0;const calls=[]
 const watch={campaign_detail_id:1,account_id:'1',account_zalo_uid:'own',target_zalo_uid:'target',action_type:'message',message_ids:['m'],sent_at:revision,tracking_until:'2026-10-05T00:00:00Z'}
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 class Cache extends shared.EngagementConfigCache{constructor(read){super(read,()=>now)}}
 const ownerQuery={eq(){return this},abortSignal(){return this},async maybeSingle(){ownerReads++;return ownerRead?ownerRead():{data:{username:'owner',password:serverPassword}}}}
 const client={from:table=>({select:()=>table==='org_staff'?ownerQuery:{in:()=>({abortSignal:async()=>settingsRead?settingsRead():{data:settings}})}}),rpc:(name,args)=>({abortSignal:async()=>{calls.push({name,args});if(fail)return{error:Error('offline')};if(args.p_auth_password!==serverPassword)return{error:Error('automation_auth_invalid')};if(rpcData)return rpcData(name,args);return{data:{enabled:Date.parse(args.p_revision)===Date.parse(settings[0].updated_at)&&settings[0].value==='true',items:name.includes('read')&&args.p_items.length?[watch]:[],pending:[],updated:1}}}})}
 const api=load('src/main/services/zaloCampaignEngagement.ts',{electron:{app:{getPath:()=>directory}},'../data/currentUser':{getCurrentUser:()=>user,getCurrentUserCredentials:()=>credentials},'../data/supabaseClient':{getSupabaseClient:()=>client},'../../shared/zaloCampaignEngagement':{...shared,EngagementConfigCache:Cache}},{Date:Clock,setTimeout:(fn,ms)=>{const t={fn,at:now+ms,unref(){}};timers.push(t);return t},clearTimeout:t=>{timers=timers.filter(v=>v!==t)}})
 return {api,calls,settings,watch,warm:async()=>{api.campaignEngagementEnabled();await settle()},rpc:fn=>{rpcData=fn},now:()=>now,jump:ms=>{now+=ms},ownerReads:()=>ownerReads,timers:()=>timers.length,timerRuns:()=>timerRuns,nextDelay:()=>timers.length?Math.min(...timers.map(t=>t.at-now)):null,login:(staffId,organizationId)=>{user={staffId,organizationId};credentials={username:'owner',password:serverPassword}},ownerRead:fn=>{ownerRead=fn},rotatePassword:()=>{serverPassword='rotated-secret'},resume:()=>api.resumeDesktopCampaignEngagement(),fail:value=>{fail=value},read:value=>{settingsRead=value},logout:()=>{user={staffId:2,organizationId:2};credentials={username:'new-owner',password:'new-secret'}},event:(target='target')=>api.testAdmittedEvent(target,watch),tick:async ms=>{now+=ms;const due=timers.filter(t=>t.at<=now);timers=timers.filter(t=>t.at>now);for(const t of due){timerRuns++;t.fn()};await settle();for(let i=0;!api.testIdle()&&i<1000;i++)await new Promise(r=>setTimeout(r,3));assert(api.testIdle(),'coordinator should finish one bounded tick')},journal:(key='1-1')=>JSON.parse(fs.readFileSync(path.join(directory,'campaign-engagement',key+'.json'),'utf8'))}
}
async function inactiveOwnerRetry(root,backlog){
 const h=harness(path.join(root,'inactive-owner-'+backlog))
 // Recovery succeeds, but event lookup fails so both owners have retry work.
 h.rpc((name,args)=>name.includes('read')&&(!args.p_items.length || args.p_items[0]?.catalog)
  ? {data:{enabled:true,items:[],pending:[],recoveryDone:true}}
  : {error:Error('temporary lookup outage')})
 for(let i=0;i<backlog;i++) h.event('old-'+i)
 await settle();await h.tick(5000)
 assert.equal(h.journal().length,backlog)
 const originalJournal=h.journal(),oldCalls=h.calls.length
 h.login(2,2);h.resume();h.event();await settle();await h.tick(5000)
 await h.tick(1000);await h.tick(1000)
 const activeRetryAt=h.journal('2-2')[0].next
 assert.equal(h.nextDelay(),activeRetryAt-h.now(),'inactive owner cannot shorten the active retry deadline (backlog='+backlog+')')
 assert.equal(h.nextDelay(),4000)
 const runs=h.timerRuns(),calls=h.calls.length
 for(let i=0;i<5;i++) await h.tick(1)
 assert.equal(h.timerRuns(),runs,'no empty 1ms ticks while the active owner waits for retry')
 assert.equal(h.calls.length,calls)
 assert(h.calls.slice(oldCalls).every(call=>call.args.p_staff_id===2&&call.args.p_organization_id===2),'only the logged-in owner may issue RPCs')
 assert.deepEqual(h.journal(),originalJournal,'inactive owner journal remains unchanged')
 h.rpc(undefined);await h.tick(h.nextDelay())
 assert.equal(h.journal('2-2').length,0,'active owner resumes at its deadline and drains')
 assert.equal(h.timers(),0,'inactive backlog alone must not keep the timer alive')
 h.login(1,1);h.resume();await settle();await h.tick(1)
 assert.equal(h.journal().length,0,'the original owner can resume its preserved journal on login')
 assert.equal(h.timers(),0)
}
async function recoveryBudget(root){
 const sourceFor=context=>({version:1,revision:context.revision,operationId:context.operationId,accountZaloUid:'own',targetZaloUid:'target',actionType:'message',sentAt:context.sentAt,messageIds:['m']});
 const incoming=h=>h.api.receiveCampaignEngagement('message',{type:0,isSelf:false,data:{uidFrom:'target',idTo:'own'}},1,'own');
 const missing=(_name,args)=>({data:{enabled:true,items:[],pending:[],catalogDone:true,recoveryDone:true,updated:0,
  operations:args.p_items.filter(i=>i.operation).map(i=>({operationId:i.operation.operationId,status:'missing'}))}});

 const cancelled=harness(path.join(root,'cancelled-before-insert'));await cancelled.warm();cancelled.rpc(missing);
 const cancelledSend=cancelled.api.beginCampaignEngagementSend({id:1,zaloUid:'own'},'target');
 cancelled.api.stageCampaignEngagementSource(sourceFor(cancelledSend),1);incoming(cancelled);
 cancelled.api.abandonCampaignEngagementSend(cancelledSend.operationId);await settle();await cancelled.tick(5000);
 assert.equal(cancelled.journal().length,0,'cancel before INSERT discards the source and events admitted only for it');
 const cancelledReads=cancelled.calls.length;incoming(cancelled);await cancelled.tick(60000);
 assert.equal(cancelled.calls.length,cancelledReads,'cancelled sources cannot admit future messages or retry');

 const shared=harness(path.join(root,'recovery-independent-sends'));await shared.warm();shared.rpc(missing);
 const older=shared.api.beginCampaignEngagementSend({id:1,zaloUid:'own'},'target');shared.api.stageCampaignEngagementSource(sourceFor(older),1,true);
 await settle();await shared.tick(240000);await shared.warm();
 const newer=shared.api.beginCampaignEngagementSend({id:1,zaloUid:'own'},'target');shared.api.stageCampaignEngagementSource(sourceFor(newer),1,true);
 incoming(shared);await settle();await shared.tick(5000);await shared.tick(55000);
 const retained=shared.journal();assert(!retained.some(i=>i.id===older.operationId));assert(retained.some(i=>i.id===newer.operationId));
 assert(retained.some(i=>i.mode==='record'&&i.waitingFor.includes(newer.operationId)&&!i.waitingFor.includes(older.operationId)),'expiring one operation preserves the other operation and its replay');

 const directory=path.join(root,'recovery-budget'),h=harness(directory);await h.warm();h.rpc(missing);
 const context=h.api.beginCampaignEngagementSend({id:1,zaloUid:'own'},'target'),source=sourceFor(context);
 h.api.stageCampaignEngagementSource(source,1,true);h.api.abandonCampaignEngagementSend(context.operationId);
 incoming(h);await settle();await h.tick(5000);await h.tick(5000);
 assert(h.journal().some(i=>i.mode==='recover'),'cleanup after an uncertain INSERT must retain bounded recovery');
 const snapshot=h.journal(),deadline=snapshot.find(i=>i.mode==='recover').recoveryExpiresAt;
 h.jump(120000);h.api.stageCampaignEngagementSource(source,1,true);await settle();
 assert.equal(h.journal().find(i=>i.mode==='recover').recoveryExpiresAt,deadline,'repeated staging cannot renew recovery');
 h.jump(deadline-h.now());
 const beforeEvents=h.api.engagementMetrics.received,beforeCalls=h.calls.length,beforeQueue=h.api.engagementMetrics.backlog;
 for(let i=0;i<1000;i++)incoming(h);
 assert.equal(h.api.engagementMetrics.received-beforeEvents,1000);assert.equal(h.api.engagementMetrics.backlog,beforeQueue,'expired recovery cannot admit events before writer cleanup');
 h.read(async()=>{throw Error('configuration unavailable')});await h.tick(0);
 assert.equal(h.journal().length,0,'expiry drops the orphan and dependent replay even with unavailable config');
 assert.equal(h.calls.length,beforeCalls);assert.equal(h.timers(),0,'expired recovery requires no final DB lookup or config retry');
 await h.tick(31*24*60*60*1000);incoming(h);await h.tick(60000);
 assert.equal(h.calls.length,beforeCalls);assert.equal(h.timers(),0,'no recovery or event RPC after 31 days');

 for(const legacy of [false,true]){
  const restartDirectory=path.join(root,'expired-restart-'+legacy);fs.mkdirSync(path.join(restartDirectory,'campaign-engagement'),{recursive:true});
  const restored=snapshot.map(item=>{const copy=JSON.parse(JSON.stringify(item));if(legacy){delete copy.recoveryExpiresAt;delete copy.waitingFor;}return copy;});
  fs.writeFileSync(path.join(restartDirectory,'campaign-engagement/1-1.json'),JSON.stringify(restored));
  const restarted=harness(restartDirectory);restarted.rpc(missing);restarted.jump(31*24*60*60*1000);restarted.resume();await settle();await restarted.tick(1);
  assert.equal(restarted.journal().length,0,'restart prunes expired source/replay without resetting its age');
  assert(!restarted.calls.some(call=>call.name.includes('record')||call.args.p_items.some(i=>i.operation||i.kind)),'startup may warm catalog but never probes the expired operation/event');
  const count=restarted.calls.length;incoming(restarted);await restarted.tick(60000);assert.equal(restarted.calls.length,count);assert.equal(restarted.timers(),0);
 }

 const late=harness(path.join(root,'late-recovery-result'));await late.warm();
 const lateSend=late.api.beginCampaignEngagementSend({id:1,zaloUid:'own'},'target'),lateSource=sourceFor(lateSend);
 late.api.stageCampaignEngagementSource(lateSource,1,true);await settle();let finish;
 late.rpc((name,args)=>args.p_items[0]?.operation?new Promise(resolve=>{finish=resolve}):missing(name,args));
 const running=late.tick(5000);await settle();assert.equal(typeof finish,'function');late.jump(300000);
 finish({data:{enabled:true,items:[],operations:[{operationId:lateSend.operationId,status:'found',detailId:'9',source:lateSource}]}});await running;
 assert.equal(late.journal().length,0);assert(!late.calls.some(call=>call.name.includes('register')),'late lookup completion cannot revive expired recovery');
 assert.equal(late.timers(),0);
 console.log('PASS: pre-INSERT cancellation, fixed 5-minute recovery budget, no admission after expiry, cleanup without config, legacy/restart age, 31-day idle and late-RPC fencing');
}
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'engagement-lifecycle-'))
 try{
  await recoveryBudget(root)
  for(const backlog of [1,100]) await inactiveOwnerRetry(root,backlog)
  console.log('PASS: inactive owner backlog cannot affect retry deadline/batch fullness; no 1ms spin; journal preserved and resumed on owner login')
  const a=harness(path.join(root,'restart'));a.fail(true);a.event();await settle();await a.tick(5000);const timestamp=a.journal()[0].payload.occurredAt
  const b=harness(path.join(root,'restart'));b.resume();await settle();await b.tick(5000);await b.tick(5000)
  assert(b.calls.some(call=>call.name.includes('record')&&call.args.p_items.some(item=>item.occurredAt===timestamp&&item.targetZaloUid==='target')),'restart replays metadata with original timestamp')
  assert(b.calls.every(call=>/^aka_agent_(read|record|register)_campaign_engagement$/.test(call.name)))
  assert.equal(b.journal().length,0);const drainedCalls=b.calls.length;await b.tick(120000)
  assert.equal(b.calls.length,drainedCalls);assert.equal(b.timers(),0,'no empty polling after journal drains')
  const serverDir=path.join(root,'server-restart');fs.mkdirSync(path.join(serverDir,'campaign-engagement'),{recursive:true})
  // Recreate the interrupted producer's snapshot (the Desktop consumer drained its copy).
  fs.writeFileSync(path.join(serverDir,'campaign-engagement/1-1.json'),JSON.stringify([{id:'server-pending',revision,at:Date.parse(timestamp),retry:0,next:0,mode:'record',payload:{accountId:'1',accountZaloUid:'own',targetZaloUid:'target',kind:'message',occurredAt:timestamp,messageIds:[]}}]))
  const serverResume=harness(serverDir);await serverResume.api.attachServerCampaignEngagementOwner(1,1);await settle();await serverResume.tick(5000)
  assert.equal(serverResume.ownerReads(),1);assert(serverResume.calls.some(c=>c.name.includes('record')),'Server attach alone resumes persisted work')
  assert.equal(serverResume.journal().length,0);await serverResume.tick(120000);assert.equal(serverResume.timers(),0)
  const startupCfg=harness(path.join(root,'startup-config-retry'));startupCfg.read(async()=>{throw Error('config unavailable')});startupCfg.resume();await settle();await startupCfg.tick(5000)
  assert.equal(startupCfg.calls.length,0);startupCfg.read(undefined);await startupCfg.tick(60001)
  assert(startupCfg.calls.some(c=>c.name.includes('read')),'login recovery retries configuration without new traffic');await startupCfg.tick(60000);assert.equal(startupCfg.timers(),0)
  const startupAuth=harness(path.join(root,'startup-owner-auth-retry'));startupAuth.ownerRead(async()=>{throw Error('auth unavailable')})
  await startupAuth.api.attachServerCampaignEngagementOwner(1,1);await settle();await startupAuth.tick(5000);assert.equal(startupAuth.calls.length,0);assert.equal(startupAuth.ownerReads(),1)
  await startupAuth.tick(5000);assert.equal(startupAuth.ownerReads(),1,'credential retry honors its backoff')
  startupAuth.ownerRead(undefined);await startupAuth.tick(60000)
  assert.equal(startupAuth.ownerReads(),2);assert(startupAuth.calls.some(c=>c.name.includes('read')));await startupAuth.tick(60000);assert.equal(startupAuth.timers(),0)
  const startupOff=harness(path.join(root,'startup-disabled'));startupOff.settings[0].value='false'
  await startupOff.api.attachServerCampaignEngagementOwner(1,1);await settle();await startupOff.tick(5000)
  assert.equal(startupOff.ownerReads(),0);assert.equal(startupOff.calls.length,0);assert.equal(startupOff.timers(),0,'disabled startup performs no auth/RPC polling')
  const startupLogout=harness(path.join(root,'startup-logout'));let finishStartupRead
  startupLogout.read(()=>new Promise(resolve=>{finishStartupRead=resolve}));startupLogout.resume();await settle()
  const startupTick=startupLogout.tick(5000);await settle();startupLogout.logout();finishStartupRead({data:startupLogout.settings});await startupTick
  assert.equal(startupLogout.calls.length,0);assert.equal(startupLogout.timers(),0,'logout during startup config cannot revive old owner')
  const serverDetach=harness(path.join(root,'startup-detach'));let finishOwnerRead
  serverDetach.ownerRead(()=>new Promise(resolve=>{finishOwnerRead=resolve}));const detachStartup=await serverDetach.api.attachServerCampaignEngagementOwner(1,1);await settle()
  const detachTick=serverDetach.tick(5000);await settle();detachStartup();finishOwnerRead({data:{username:'owner',password:'secret'}});await detachTick
  assert.equal(serverDetach.calls.length,0);assert.equal(serverDetach.timers(),0,'detach fences pending credential read')
  const serverReplace=harness(path.join(root,'startup-replace'));const detachOld=await serverReplace.api.attachServerCampaignEngagementOwner(1,1)
  const detachNew=await serverReplace.api.attachServerCampaignEngagementOwner(1,1);detachOld();await settle();await serverReplace.tick(5000)
  assert.equal(serverReplace.ownerReads(),1);assert(serverReplace.calls.some(c=>c.name.includes('read')),'old detach cannot erase new owner');detachNew();await settle()
  const multi=harness(path.join(root,'multi-owner-startup'));multi.logout()
  await multi.api.attachServerCampaignEngagementOwner(1,1);await multi.api.attachServerCampaignEngagementOwner(3,4);await settle();await multi.tick(5000);await multi.tick(5000)
  assert.deepEqual([...new Set(multi.calls.map(c=>JSON.stringify([c.args.p_staff_id,c.args.p_organization_id])))].map(JSON.parse).sort(),[[1,1],[3,4]],'startup writes use explicit Server owner, never timer or Desktop auth context');await multi.tick(60000);assert.equal(multi.timers(),0)
  const pendingDir=path.join(root,'replacement-in-flight'),pending=harness(pendingDir)
  const detachPending=await pending.api.attachServerCampaignEngagementOwner(1,1);await settle();let finishPending
  pending.rpc(()=>new Promise(resolve=>{finishPending=resolve}));const pendingTick=pending.tick(5000);await settle()
  const detachReplacement=await pending.api.attachServerCampaignEngagementOwner(1,1);detachPending();pending.rpc(undefined)
  pending.event();await settle();assert.equal(pending.journal().length,1)
  finishPending({data:{enabled:true,items:[],pending:[],recoveryDone:true}});await pendingTick
  assert.equal(pending.journal().length,1,'a completed old request cannot overwrite the new owner journal')
  await pending.tick(5000);assert.equal(pending.journal().length,0);detachReplacement();await settle()
  const c=harness(path.join(root,'toggle'));c.fail(true);c.event();await settle();await c.tick(5000)
  c.settings[0].value='false';c.settings[0].updated_at='2026-10-02T00:01:30Z';c.fail(false);await c.tick(60001)
  assert.equal(c.journal().length,0,'disabled drops pending work')
  c.settings[0].value='true';c.settings[0].updated_at='2026-10-02T00:02:00Z';await c.tick(60001);const before=c.calls.length;c.event();await settle();await c.tick(5000)
  assert(c.calls.slice(before).every(call=>Date.parse(call.args.p_revision)===Date.parse(c.settings[0].updated_at)))
  const micro=harness(path.join(root,'micro-revision'));micro.settings[0].updated_at='2026-10-02T00:00:00.000001Z'
  micro.fail(true);micro.event();await settle();await micro.tick(5000)
  micro.settings[0].updated_at='2026-10-02T00:00:00.000002Z';micro.fail(false);const beforeMicro=micro.calls.length;await micro.tick(60001)
  assert.equal(micro.journal().length,0,'revision comparisons must preserve database microseconds')
  assert(!micro.calls.slice(beforeMicro).some(call=>call.name.includes('record')),'same-millisecond toggle cannot replay old events')
  const d=harness(path.join(root,'ownership'));let resolveRead;d.read(()=>new Promise(resolve=>{resolveRead=resolve}));d.event();await settle();d.logout();resolveRead({data:d.settings});await settle();await d.tick(5000)
  assert.equal(d.calls.length,0,'a callback awaiting config cannot switch tenant')
  assert(!fs.existsSync(path.join(root,'ownership','campaign-engagement','2-2.json')))
  const server=harness(path.join(root,'server-auth'));const detach=await server.api.attachServerCampaignEngagementOwner(1,1)
  server.event();await settle();await server.tick(5000);assert.equal(server.ownerReads(),1)
  server.rotatePassword();server.event();await settle();await server.tick(5000);await server.tick(5000)
  assert.equal(server.ownerReads(),2,'server refreshes credentials only after auth rejection')
  assert.equal(server.calls.at(-1).args.p_auth_password,'rotated-secret')
  assert(!JSON.stringify(server.journal()).includes('secret'),'journal never stores credentials');detach();await settle()
  // New events during a cold/config outage are intentionally dropped. Persisted
  // waiting_config rows from older runtimes still replay with their first time.
  const cfgDir=path.join(root,'config-outage'),cfg=harness(cfgDir)
  cfg.read(async()=>{throw Error('settings unavailable')});cfg.event();await settle();await cfg.tick(5000)
  assert.equal(cfg.calls.length,0);assert(!fs.existsSync(path.join(cfgDir,'campaign-engagement/1-1.json')))
  const firstTime='2026-10-02T00:01:00Z'
  fs.mkdirSync(path.join(cfgDir,'campaign-engagement'),{recursive:true})
  fs.writeFileSync(path.join(cfgDir,'campaign-engagement/1-1.json'),JSON.stringify([{id:'legacy-config-event',mode:'waiting_config',revision:'',at:Date.parse(firstTime),retry:0,next:0,payload:{accountId:'1',accountZaloUid:'own',targetZaloUid:'target',kind:'message',occurredAt:firstTime,messageIds:[]}}]))
  const cfgRestart=harness(cfgDir);cfgRestart.resume();await settle();await cfgRestart.tick(5000);await cfgRestart.tick(5000)
  assert(cfgRestart.calls.some(c=>c.name.includes('record')&&c.args.p_items.some(e=>e.occurredAt===firstTime&&e.targetZaloUid==='target')),'legacy deferred event preserves timestamp')

  // A restarted journal has 701 sends but RPC recovery only returns 500 at once.
  const recoveryDir=path.join(root,'paged-recovery');fs.mkdirSync(path.join(recoveryDir,'campaign-engagement'),{recursive:true})
  const sources=Array.from({length:701},(_,index)=>({detailId:String(index+1),source:{version:1,revision,operationId:'send-'+(index+1),accountZaloUid:'own',targetZaloUid:'target-'+(index+1),actionType:'message',sentAt:revision,messageIds:['m-'+(index+1)]}}))
  const holds=sources.map(s=>({id:s.source.operationId,revision,at:Date.parse(revision),retry:0,next:0,mode:'hold',payload:{accountId:'1',accountZaloUid:'own',targetZaloUid:s.source.targetZaloUid}}))
  const early={id:'early-701',revision,at:Date.parse(revision)+30000,retry:0,next:0,mode:'record',payload:{accountId:'1',accountZaloUid:'own',targetZaloUid:'target-701',kind:'seen',occurredAt:'2026-10-02T00:00:30Z',messageIds:['m-701']}}
  fs.writeFileSync(path.join(recoveryDir,'campaign-engagement/1-1.json'),JSON.stringify([...holds,early]))
  const recovered=harness(recoveryDir),registered=new Set();let pageFailure=true,recorded701=false,pages=0
  recovered.rpc((name,args)=>{
   if(name.includes('read')&&(!args.p_items.length||args.p_items[0].recovery)){
    const cursor=args.p_items[0]?.recovery,after=Number(cursor?.afterId||0),through=Number(cursor?.throughId||701)
    if(after===500&&pageFailure){pageFailure=false;return{error:Error('page temporarily unavailable')}}
    const pending=sources.filter(s=>Number(s.detailId)>after&&Number(s.detailId)<=through&&!registered.has(s.detailId)).slice(0,500);pages++
    return{data:{enabled:true,items:[],pending,recoveryCursor:{afterId:pending.at(-1)?.detailId||String(through),throughId:String(through)},recoveryDone:pending.length<500||pending.at(-1)?.detailId===String(through),updated:0}}
   }
   if(name.includes('register'))for(const i of args.p_items)registered.add(i.detailId)
   const items=sources.filter(s=>registered.has(s.detailId)).map(s=>({...recovered.watch,campaign_detail_id:s.detailId,target_zalo_uid:s.source.targetZaloUid,message_ids:s.source.messageIds}))
   if(name.includes('record'))recorded701 ||= args.p_items.some(e=>e.targetZaloUid==='target-701')
   return{data:{enabled:true,items,pending:[],updated:0}}
  })
  recovered.resume();await settle();await recovered.tick(5000)
  assert(recovered.journal().some(i=>i.id==='send-701'&&i.mode==='hold'),'first page cannot release a later source hold')
  await recovered.tick(5000)
  assert(recovered.journal().some(i=>i.id==='early-701'),'failed recovery page retains early event')
  for(let i=0;i<30&&recovered.journal().length;i++)await recovered.tick(5000)
  assert(registered.has('701')&&recorded701,'last recovered source records its early seen event')
  assert.equal(recovered.journal().length,0);assert.equal(pages,2,'bounded sweep does not reread earlier pages')
  const directory=path.join(root,'overflow');fs.mkdirSync(path.join(directory,'campaign-engagement'),{recursive:true})
  const item={revision,at:Date.parse(revision),retry:0,next:0,mode:'record',payload:{accountId:'1',accountZaloUid:'own',targetZaloUid:'target',kind:'message',occurredAt:'2026-10-02T00:00:30Z',messageIds:[]}}
  fs.writeFileSync(path.join(directory,'campaign-engagement','1-1.json'),JSON.stringify(Array.from({length:10001},(_,i)=>(i===0?{...item,id:'send-full',mode:'hold',payload:{accountId:'1',accountZaloUid:'own',targetZaloUid:'target'}}:{...item,id:String(i)}))))
  const e=harness(directory);await e.warm();e.api.beginCampaignEngagementSend({id:1,zaloUid:'own'},'target');await settle()
  assert(e.api.engagementMetrics.overflow>0);assert(e.api.engagementMetrics.backlog<=10000,'restoration obeys process RAM queue cap')
  e.api.recordCampaignEngagementDetail(1,{version:1,revision,operationId:'send-full',accountZaloUid:'own',targetZaloUid:'target',actionType:'message',sentAt:revision,messageIds:['m']});await settle()
  assert(e.journal().some(i=>i.mode==='register'),'a full queue can replace its existing hold without an extra slot')
  // Distinct operations for one recipient must each survive through registration.
  const concurrent=harness(path.join(root,'concurrent-sends'))
  await concurrent.warm();const one=await concurrent.api.beginCampaignEngagementSend({id:1,zaloUid:'own'},'target')
  const two=concurrent.api.beginCampaignEngagementSend({id:1,zaloUid:'own'},'target');await settle()
  assert.notEqual(one.operationId,two.operationId);assert.equal(concurrent.journal().filter(i=>i.mode==='hold').length,2)
  const sourceFor=(context,actionType='message')=>({version:1,revision:context.revision,operationId:context.operationId,accountZaloUid:'own',targetZaloUid:'target',actionType,sentAt:context.sentAt,messageIds:actionType==='message'?['m']:[]})
  concurrent.api.recordCampaignEngagementDetail(1,sourceFor(one))
  concurrent.api.recordCampaignEngagementDetail(2,sourceFor(two,'friend_request'))
  await settle();await concurrent.tick(5000)
  assert.deepEqual(concurrent.calls.filter(c=>c.name.includes('register')).flatMap(c=>c.args.p_items.map(i=>i.detailId)).sort(),['1','2'])
  assert.equal(concurrent.journal().length,0)

  // An ambiguous INSERT is durably looked up by operation; it cannot starve old watches.
  const ambiguousDir=path.join(root,'ambiguous-insert'),ambiguous=harness(ambiguousDir)
  await ambiguous.warm();const operation=await ambiguous.api.beginCampaignEngagementSend({id:1,zaloUid:'own'},'target'),source=sourceFor(operation)
  ambiguous.api.stageCampaignEngagementSource(source,1);await settle()
  assert.equal(ambiguous.journal()[0].mode,'recover');assert.deepEqual(ambiguous.journal()[0].payload.source,source)
  ambiguous.api.failCampaignEngagementDetail(source,{message:'response lost'})
  ambiguous.api.failCampaignEngagementDetail(source,{code:'40003',message:'statement completion unknown'})
  await settle();assert(ambiguous.journal().some(i=>i.mode==='recover'),'SQLSTATE 40003 is ambiguous, not a rollback confirmation')
  ambiguous.event();await settle()
  ambiguous.rpc((name,args)=>({data:{enabled:true,updated:0,items:name.includes('read')&&!args.p_items[0]?.operation?[ambiguous.watch]:[],pending:[],operations:args.p_items[0]?.operation?[{operationId:operation.operationId,status:'missing'}]:[]}}))
  for(let i=0;i<4;i++)await ambiguous.tick(5000)
  const passes=ambiguous.calls.filter(c=>c.name.includes('record'))
  assert.equal(passes.length,1,'existing watches get one immediate pass while the unknown commit waits')
  assert(ambiguous.journal().some(i=>i.mode==='recover'),'missing is not proof of rollback')
  assert(ambiguous.journal().some(i=>i.mode==='record'&&i.delivered),'early event remains available for the new watch')
  const originalTime=passes[0].args.p_items[0].occurredAt
  const restarted=harness(ambiguousDir);let found=false
  restarted.rpc((name,args)=>{
    if(args.p_items[0]?.operation){found=true;return{data:{enabled:true,items:[],operations:[{operationId:operation.operationId,status:'found',detailId:'9',source}]}}}
    return{data:{enabled:true,updated:0,items:[{...restarted.watch,campaign_detail_id:9}],pending:[],recoveryDone:true}}
  })
  restarted.resume();await settle()
  for(let i=0;i<15&&(!found||restarted.journal().length);i++)await restarted.tick(10000)
  assert(found,'restart retains ambiguous source even when ordinary source recovery is empty')
  assert(restarted.calls.some(c=>c.name.includes('register')&&c.args.p_items.some(i=>i.detailId==='9')))
  assert(restarted.calls.some(c=>c.name.includes('record')&&c.args.p_items.some(i=>i.targetZaloUid==='target'&&i.occurredAt===originalTime)),'resolved commit replays the retained event with its first timestamp')
  assert.equal(restarted.journal().length,0)

  // A definitive SQL rejection releases only its operation and already-delivered replay metadata.
  const rejected=harness(path.join(root,'rejected-insert'))
  await rejected.warm();const rejectedSend=await rejected.api.beginCampaignEngagementSend({id:1,zaloUid:'own'},'target'),rejectedSource=sourceFor(rejectedSend)
  await rejected.api.stageCampaignEngagementSource(rejectedSource,1);rejected.event();await settle()
  for(let i=0;i<3;i++)await rejected.tick(5000)
  rejected.api.failCampaignEngagementDetail(rejectedSource,{code:'23503',message:'foreign key rejected'});await settle()
  assert.equal(rejected.journal().length,0)
  const countBefore=rejected.calls.length;await rejected.tick(60000)
  assert.equal(rejected.calls.length,countBefore,'rejected detail requires neither a new INSERT nor a Zalo retry')
  console.log('PASS: Desktop login/Server attach recovery without traffic, startup config/auth retry, disabled/idle stop, logout/detach/replacement fencing')
  console.log('PASS: independent operations, ambiguous commit journal/lookup/restart, old-watch progress, operation replay, SQL rejection cleanup')
  console.log('PASS: paged recovery, config-outage journal, full-queue hold replacement, restart replay, stable timestamp, on/off revision fencing, auth change while config awaits, Server credential rotation, bounded restoration, RPC-only fixture')
 }finally{fs.rmSync(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1})
