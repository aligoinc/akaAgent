const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const ts=require(path.join(root,'node_modules/typescript'));
const transpile=text=>ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const settle=async()=>{for(let i=0;i<30;i++)await new Promise(resolve=>setImmediate(resolve));};
function load(file,mocks,globals={}){const module={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(root,file),'utf8')),{module,exports:module.exports,require:name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),console,Buffer,AbortSignal,Date,setTimeout,clearTimeout,setInterval,clearInterval,URL,URLSearchParams,...globals});return module.exports;}
function methods(file,klass,names,globals){
 const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);
 const decl=source.statements.find(x=>ts.isClassDeclaration(x)&&x.name.text===klass);
 const body=names.map(name=>{const m=decl.members.find(x=>ts.isMethodDeclaration(x)&&x.name.getText(source)===name);assert(m,name);return m.getText(source);}).join('\n');
 return new Function(...Object.keys(globals),transpile('class Harness {'+body+'}')+';return Harness;')(...Object.values(globals));
}
function harness(enabled=true){
 let now=Date.parse('2026-10-02T00:01:00Z'),mode='ok',settingsRead,readGate,timers=[],gates=[],writes=0,sends=0,stop=false,snapshot=[];
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const globals={Date:Clock,setTimeout:(fn,ms)=>{const t={fn,at:now+ms,unref(){}};timers.push(t);return t;},clearTimeout:t=>{timers=timers.filter(x=>x!==t);}};
 const shared=load('src/shared/zaloCampaignEngagement.ts',{},globals);
 const settings=shared.ENGAGEMENT_KEYS.map((key,i)=>({key,value:[String(enabled),'5','100','48'][i],updated_at:'2026-10-02T00:00:00Z',is_active:true,is_secret:false}));
 const user={staffId:1,organizationId:1},credentials={username:'fixture',password:'fixture'};
 const io={mkdir:async()=>{},readdir:async()=>[],stat:async()=>{if(readGate)await readGate;throw Object.assign(Error('missing'),{code:'ENOENT'});},readFile:async()=>'[]',rename:async()=>{},writeFile:async(_file,contents)=>{
  writes++;if(mode==='reject')throw Object.assign(Error('disk full'),{code:'ENOSPC'});if(mode==='stall')await new Promise(resolve=>gates.push(resolve));snapshot=JSON.parse(contents);
 }};
 const client={from:()=>({select:()=>({in:()=>({abortSignal:async()=>settingsRead?settingsRead():({data:settings})})})}),rpc:()=>({abortSignal:async()=>({data:{enabled:true,items:[],pending:[],recoveryDone:true}})})};
 const coordinator=load('src/main/services/zaloCampaignEngagement.ts',{'node:fs/promises':io,electron:{app:{getPath:()=>'/fixture'}},'../data/currentUser':{getCurrentUser:()=>user,getCurrentUserCredentials:()=>credentials},'../data/supabaseClient':{getSupabaseClient:()=>client},'../data/repositories/runtimeClockRepository':{peekDatabaseRuntimeClock:()=>({dbNow:new Date(now).toISOString()})},'../../shared/zaloCampaignEngagement':shared},globals);
 const Scheduler=methods('src/main/services/campaignScheduler.ts','CampaignScheduler',['zaloSendPhoneMessage','runZaloCampaignHelper'],{...coordinator,...shared,ZaloPartialSendError:class extends Error{},buildMessageOptOutSource:()=>undefined});
 const scheduler=Object.assign(new Scheduler(),{zaloRuntime:{getCachedOwnUid:()=>'own'},prepareZaloOutgoingContent:async()=> ({content:'test',media:[]}),getZaloTargetLabel:()=> 'fixture target',createZaloErrorDetail:async(_a,_c,e)=>{throw e;},dispatchZaloMessage:async()=>{sends++;if(h.stallAfterSend)mode='stall';if(h.stopAfterSend)stop=true;return{message:{msgId:'m1'}};},throwIfZaloRuntimeStopping:()=>{if(stop)throw Error('stop requested');},createZaloSuccessDetail:x=>x});
 const h={coordinator,shared,read:fn=>{settingsRead=fn},blockRestore:gate=>{readGate=gate},warm:async()=>{coordinator.campaignEngagementEnabled();await settle()},mode:v=>{mode=v;},writes:()=>writes,snapshot:()=>snapshot,sends:()=>sends,gates:()=>gates.length,stop:()=>{stop=true;},release:()=>{mode='ok';for(const resolve of gates.splice(0))resolve();},advance:async ms=>{now+=ms;const due=timers.filter(t=>t.at<=now);timers=timers.filter(t=>t.at>now);for(const t of due)t.fn();await settle();},run:()=>scheduler.runZaloCampaignHelper(1,()=>scheduler.zaloSendPhoneMessage({id:1,zaloUid:'own'},{id:1},{enabled:true,target:{uid:'target'}}))};
 return h;
}
async function checkListener(){
 let now=0,timers=[],sends=0,starts=0;
 const makeTimer=(fn,delay,repeat=false)=>{const t={fn,at:now+delay,delay,repeat};timers.push(t);return t;};
 const clear=t=>{timers=timers.filter(x=>x!==t);};
 class Clock extends Date{static now(){return now;}}
 const Runtime=methods('src/main/services/zaloRuntimeService.ts','ZaloRuntimeService',['sendFriendRequestToUser','warmCampaignEngagementListener','ensureZaloListenerReady','waitForZaloListenerReady'],{
  Date:Clock,campaignEngagementEnabled:()=>true,ZALO_LISTENER_READY_TIMEOUT_MS:20000,
  setTimeout:(fn,ms)=>makeTimer(fn,ms),clearTimeout:clear,setInterval:(fn,ms)=>makeTimer(fn,ms,true),clearInterval:clear
 });
 const api={listener:{start(){starts++;}},sendFriendRequest:async()=>{sends++;return{};}};
 const state={accountId:1,api,status:'starting',ready:false,handlersAttached:true};
 const runtime=Object.assign(new Runtime(),{engagementListenerAttempts:new WeakMap(),apiCache:new Map([[1,{api}]]),listenerStates:new Map([[1,state]]),ensureApi:async()=>api,attachZaloListenerHandlers:()=>{},emitZaloListenerStatus:()=>{}});
 const advance=async ms=>{now+=ms;for(const t of [...timers].filter(t=>t.at<=now)){if(t.repeat)t.at=now+t.delay;else clear(t);t.fn();}await settle();};
 await runtime.sendFriendRequestToUser(1,'target','test');await runtime.sendFriendRequestToUser(1,'target','test');await settle();
 assert.equal(sends,2,'both sends finish without advancing the listener clock');assert.equal(starts,1,'one background attempt per SDK instance');
 await advance(20000);await runtime.sendFriendRequestToUser(1,'target','test');assert.equal(starts,1,'listener failure has a cooldown');
 await advance(60000);await runtime.sendFriendRequestToUser(1,'target','test');await settle();assert.equal(starts,2);
 runtime.apiCache.clear();await advance(20000);
}
async function main(){
 for(const after of [false,true]){
  const h=harness();await h.warm();if(after)h.stallAfterSend=true;else h.mode('stall');
  const result=await h.run();assert.equal(result.ok,true);assert.ok(result.detail.data.zaloEngagementSource);await settle();
  assert.equal(h.sends(),1);assert.equal(h.gates(),1);
  // Exercise the real repository too: INSERT and business counters cannot wait for journal.
  const repo=fs.readFileSync(path.join(root,'src/main/data/repositories/campaignRepository.ts'),'utf8');
  const source=repo.slice(repo.indexOf('export async function createCampaignDetail('),repo.indexOf('export async function deleteCampaignDetail('));
  const module={exports:{}};let inserts=0,counters=0;
  const detail={id:1,accountId:1,actionCode:'zalo_message_friend',status:'thành công',data:result.detail.data};
  const query={insert(){inserts++;return this;},select(){return this;},single:async()=>({data:detail,error:null})};
  vm.runInNewContext(transpile(source),{module,exports:module.exports,console,client:()=>({from:()=>query}),...h.coordinator,mapCampaignDetailFromDB:x=>x,shouldCountDetailByDefault:()=>true,accountActionRepo:{incrementAccountActionCount:async()=>{counters++;}},errorPolicyRepo:{resetConsecutiveErrors:async()=>{}}});
  await module.exports.createCampaignDetail({campaignId:1,accountId:1,actionCode:'zalo_message_friend',data:detail.data});
  assert.equal(inserts,1);assert.equal(counters,1);assert.equal(h.sends(),1);assert.equal(h.gates(),1,'journal writers do not overlap');
  const detach=h.coordinator.attachServerCampaignEngagementOwner(1,1);assert.equal(typeof detach,'function','admission does not wait for the stalled file');detach();
  h.release();await settle();assert.equal(h.sends(),1,'late IO cannot resend');
 }
 const cold=harness();let finishConfig;cold.read(()=>new Promise(resolve=>{finishConfig=resolve;}));
 assert.equal((await cold.run()).ok,true);assert.equal(cold.sends(),1);assert.equal(cold.writes(),0);
 await settle();finishConfig({data:[]});await settle();assert.equal(cold.sends(),1,'late config never starts an action');
 const restore=harness();await restore.warm();let finishRestore;restore.blockRestore(new Promise(resolve=>{finishRestore=resolve;}));
 assert.equal((await restore.run()).ok,true);assert.equal(restore.sends(),1);finishRestore();await settle();
 const full=harness();await full.warm();full.mode('reject');assert.equal((await full.run()).ok,true);await settle();assert.equal(full.sends(),1);
 const off=harness(false);await off.warm();off.mode('stall');assert.equal((await off.run()).ok,true);assert.equal(off.writes(),0);
 const stopped=harness();await stopped.warm();stopped.stopAfterSend=true;
 await assert.rejects(stopped.run(),/stop requested/);await settle();
 assert.equal(stopped.sends(),1);assert.deepEqual(stopped.snapshot(),[],'stop after send and before detail INSERT discards its recovery source');
 await checkListener();
 console.log('PASS: stalled restore/write/config and rejected disk IO cannot hold sends, detail INSERT/counters or owner admission; stop before detail INSERT discards recovery; listener runs once in background with cooldown; no resend after late completion');
}
const watchdog=setTimeout(()=>{console.error('FAIL: campaign stalled behind optional engagement');process.exit(1);},5000);
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>clearTimeout(watchdog));
