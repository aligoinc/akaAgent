const assert=require('node:assert/strict')
const {fixture,loadShared}=require('./facebook-page-content-rotation-smoke-test.cjs')
const {schedulerClass}=require('./campaign-media-timeout-smoke-test.cjs')
const shared=loadShared('src/shared/facebookRandomRun.ts')
const rules=[{campaignActionId:'facebook_group_post',quantity:2,unit:'data'},{campaignActionId:'facebook_timeline_post',quantity:1,unit:'run'},{campaignActionId:'facebook_group_post',quantity:3,unit:'data'}]
let checks=0
async function main(){
 assert.deepEqual(shared.chooseRandomRound(rules,[{id:1,actionId:'facebook_group_post'},{id:2,actionId:'facebook_group_post'},{id:3,actionId:'facebook_timeline_post'}],()=>.99).map(r=>r.campaignId),[2,3,2]);checks++
 assert.deepEqual(shared.chooseRandomRound(rules,[],()=>0),[]);checks++
 for(const count of [1,2,5]){
  const f=fixture({simple:true}), turn={...rules[0],processed:0}
  f.scheduler.facebookRandomTurns.set(1,turn)
  let active=null, completed=0
  f.scheduler.beginCampaignRunUnit=async(_a,_c,ids)=>{active=ids;f.stats.claimed=true;return true}
  f.scheduler.settleActiveCampaignRunUnit=async()=>{if(active){turn.processed+=active.length;active=null}f.stats.claimed=false;return true}
  f.scheduler.handleCampaignCompletion=async()=>{completed++}
  await f.run(Array(count).fill('chờ xử lý'))
  assert.deepEqual(f.stats.errors,[])
  assert.equal(f.stats.variables.length,Math.min(count,2));assert.equal(turn.processed,Math.min(count,2));checks+=2
  assert.equal(completed,count<=2?1:0);checks++
  if(count>2)assert.equal(f.saved().status,'chờ xử lý')
 }
 // Real variable builder uses a temporary newsfeed budget, retaining original settings.
 const nf=fixture({simple:true,actionId:'facebook_newsfeed_interaction',extra:{newsfeedTimeMinutes:20}})
 nf.scheduler.facebookRandomTurns.set(1,{unit:'minute',quantity:5,processed:0})
 const v=await nf.scheduler.buildVariablesV2(nf.saved(),null,2,'',0,{},[],new Set())
 assert.equal(v.newsfeedTimeMinutes,5);assert.equal(nf.saved().extraSettings.newsfeedTimeMinutes,20);checks+=2
 // Actual queue with fake execution adapter: locked planned row skipped, later rule still runs.
 const config={version:1,revision:1,rules};let enabled=true,round=0,finished=[],executed=[]
 const candidates=[{id:1,actionId:rules[0].campaignActionId,name:'A',status:'chờ xử lý'},{id:3,actionId:rules[1].campaignActionId,name:'B',status:'chờ xử lý'}]
 const account={id:8,flatformType:'facebook',status:'chờ xử lý',loginStatus:'đã đăng nhập',isActive:true}
 let planned=false
 const rpc={
  getRandomSettings:async()=>({enabled,config}),
  planRandomRound:async(_id,_cfg,choices)=>{round++;planned=true;return {enabled,config,turns:round===1?choices.map((r,i)=>({...rules[r.ruleIndex],...r,id:String(i),order:i+1,processed:0,revision:1})):[]}},
  finishRandomTurn:async(_id,turn,reason)=>{finished.push({id:turn.campaignId,reason});return {...turn,status:reason?'stopped':'completed'}}
 }
 const Scheduler=schedulerClass({}, {'../../shared/facebookRandomRun':shared,'../data/repositories/facebookRandomRunRepository':rpc,'./accountOperationRegistry':{accountOperationRegistry:{has:()=>false}}})
 const db={getAccount:async()=>account,getPendingCampaigns:async()=>candidates,getCampaign:async id=>candidates.find(c=>c.id===id)}
 const s=new Scheduler(db,{}, {webContents:{send(){}}})
 Object.assign(s,{running:true,getReadyRuntimeClock:async()=>({dbNow:new Date().toISOString()}),hasFailedAccountRun:()=>false,
  randomCampaignBlockedReason:async(_a,c)=>planned&&c.id===1?'Action bị khóa':null,logCampaignProgress:async()=>{},
  executeCampaign:async(_a,c)=>{executed.push(c.id);s.facebookRandomTurns.get(c.id).processed=1}
 })
 await s.runFacebookRandomQueue(account)
 assert.deepEqual(executed,[3]);assert.equal(finished.filter(x=>x.reason==='Action bị khóa').length,2);assert.equal(round,2);checks+=3
 // All blocked before planning: return to the existing tick without executing or spinning.
 planned=false;round=0;finished=[];executed=[];s.randomCampaignBlockedReason=async()=> 'Action bị khóa'
 await s.runFacebookRandomQueue(account);assert.equal(round,1);assert.equal(executed.length,0);checks+=2
 // Stop at a boundary: next planned rule remains untouched by executor.
 planned=false;round=0;enabled=true;s.randomCampaignBlockedReason=async()=>null
 s.executeCampaign=async(_a,c)=>{executed.push(c.id);s.facebookRandomTurns.get(c.id).processed=1;enabled=false}
 await s.runFacebookRandomQueue(account);assert.equal(executed.length,1);checks++
 // Recheck action availability immediately before the next unit, after the prior unit settles.
 for(const blocked of [false,true]){
  let claims=0,released=''
  const unitScheduler=new Scheduler({getCampaignAction:async()=>({isActive:blocked,isDelete:false}),claimCampaignRunUnitV2:async()=>{claims++;throw Error('must not claim')}},{},{webContents:{send(){}}})
  unitScheduler.facebookRandomTurns.set(1,{unit:'data',quantity:3,processed:1})
  unitScheduler.campaignRunBoundaries.set(1,{runtimeClaimToken:'parent'})
  Object.assign(unitScheduler,{running:true,settleActiveCampaignRunUnit:async()=>true,isServerZaloCampaign:()=>false,
   getCampaignPreclaimLimitStatus:async()=>blocked?{}:null,buildLimitPreflightNote:()=> 'Hành động bị khóa',
   releaseClaimedCampaignPreflight:async(_a,_c,reason)=>{released=reason}})
  assert.equal(await unitScheduler.beginCampaignRunUnit(account,candidates[0],[10]),false)
  assert.equal(claims,0);assert.ok(released);checks++
 }
 // The fb LD incident: a direct campaign retains an old end date, while
 // normal dispatch only treats Data Group subscriptions as hard-ended.
 const scheduleAccount={...account,facebookRandomRunEnabled:false}
 const oldEndCampaign={id:31005,accountId:8,actionId:'facebook_group_post',name:'Posting',status:'chờ xử lý',isDelete:false,
  schedule:'2026-10-14T10:37:00Z',scheduleType:'daily',scheduleEndDate:'2026-10-12T16:59:59Z',dataTargetSourceMode:'direct'}
 let dbNow='2026-10-14T10:53:40Z',ordinaryRuns=0
 const scheduleScheduler=new Scheduler({getAccount:async()=>scheduleAccount,getCampaign:async()=>oldEndCampaign,
  getCampaignAction:async()=>({isActive:true,isDelete:false}),listCampaignInputData:async()=>[{status:'chờ xử lý',isDelete:false}]},{},{webContents:{send(){}}})
 Object.assign(scheduleScheduler,{running:true,getReadyRuntimeClock:async()=>({dbNow}),resolveCampaignWorkflow:()=>({workflowId:1}),
  getCampaignPreclaimLimitStatus:async()=>null,executeCampaign:async()=>{ordinaryRuns++}})
 await scheduleScheduler.runAccountCampaignQueue(scheduleAccount,[oldEndCampaign])
 assert.equal(ordinaryRuns,1)
 assert.equal(await scheduleScheduler.randomCampaignBlockedReason(scheduleAccount,oldEndCampaign),null)
 assert.equal(await scheduleScheduler.randomCampaignBlockedReason(scheduleAccount,{...oldEndCampaign,dataTargetSourceMode:'data_group'}),'Chiến dịch đã hết hạn')
 assert.equal(await scheduleScheduler.randomCampaignBlockedReason(scheduleAccount,{...oldEndCampaign,schedule:'2026-10-15T10:37:00Z'}),'Ngoài lịch chạy')
 assert.equal(await scheduleScheduler.randomCampaignBlockedReason(scheduleAccount,{...oldEndCampaign,dailyStopTime:'17:00:00'}),'Ngoài lịch chạy')
 dbNow='2026-10-14T16:59:00Z'
 assert.equal(await scheduleScheduler.randomCampaignBlockedReason(scheduleAccount,oldEndCampaign),'Ngoài lịch chạy')
 checks+=6

 // A confirmed end-of-turn message must appear after sleep/finish and before
 // the next campaign, exactly once; skipped/stopped/unconfirmed turns get none.
 const incidentRules=[{campaignActionId:'facebook_message_uid',quantity:1,unit:'data'},
  {campaignActionId:'facebook_join_group',quantity:1,unit:'data'},
  {campaignActionId:'facebook_group_post',quantity:1,unit:'data'}]
 const incidentCampaigns=[{...oldEndCampaign,id:31006,actionId:'facebook_message_uid',scheduleEndDate:null},oldEndCampaign]
 for(const outcome of ['completed','stopped','finish-error']){
  const events=[],logs=[];let rounds=0
  const incidentRpc={
   getRandomSettings:async()=>({enabled:true,config:{version:1,revision:1,rules:incidentRules}}),
   planRandomRound:async(_id,_config,choices)=>({enabled:true,turns:++rounds===1?choices.map((choice,i)=>({
    ...incidentRules[choice.ruleIndex],...choice,id:String(i),order:i+1,revision:1,processed:0})):[]}),
   finishRandomTurn:async(_id,turn)=>{if(outcome==='finish-error')throw Error('unconfirmed finish');events.push(`confirmed:${turn.campaignId}`);return {...turn,status:outcome,processed:1}}
  }
  const IncidentScheduler=schedulerClass({}, {'../../shared/facebookRandomRun':shared,'../data/repositories/facebookRandomRunRepository':incidentRpc,
   './accountOperationRegistry':{accountOperationRegistry:{has:()=>false}}})
  const incidentScheduler=new IncidentScheduler({getAccount:async()=>account,getPendingCampaigns:async()=>incidentCampaigns,
   getCampaign:async id=>incidentCampaigns.find(c=>c.id===id),getCampaignAction:async()=>({isActive:true,isDelete:false}),
   listCampaignInputData:async()=>[{status:'chờ xử lý',isDelete:false}]},{},{webContents:{send(){}}})
  Object.assign(incidentScheduler,{running:true,getReadyRuntimeClock:async()=>({dbNow:'2026-10-14T10:53:40Z'}),resolveCampaignWorkflow:()=>({workflowId:1}),
   getCampaignPreclaimLimitStatus:async()=>null,logCampaignProgress:async(c,message)=>{logs.push(message);events.push(`log:${c.id}`)},
   executeCampaign:async(_a,c)=>{events.push(`start:${c.id}`);incidentScheduler.facebookRandomTurns.get(c.id).processed=1;events.push(`slept:${c.id}`)}})
  if(outcome==='finish-error')await assert.rejects(incidentScheduler.runFacebookRandomQueue(account),/unconfirmed finish/)
  else await incidentScheduler.runFacebookRandomQueue(account)
  if(outcome==='completed'){
   assert.deepEqual(events,['start:31006','slept:31006','confirmed:31006','log:31006','start:31005','slept:31005','confirmed:31005','log:31005'])
   assert.deepEqual(logs,Array(2).fill('✅ Hoàn tất đợt chạy ngẫu nhiên: đã xử lý 1/1 data.'))
  }else assert.deepEqual(logs,[])
  checks++
 }
 console.log(JSON.stringify({checks,externalOperations:0}))
}
main().catch(e=>{console.error(e);process.exitCode=1})
