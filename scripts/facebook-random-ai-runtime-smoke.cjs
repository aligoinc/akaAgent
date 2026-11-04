const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript')
const {schedulerClass}=require('./campaign-media-timeout-smoke-test.cjs')
const root=path.resolve(__dirname,'..')
function load(file,imports={}) {
  const exports={}
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  new Function('exports','require',code)(exports,name=>Object.hasOwn(imports,name)?imports[name]:require(name))
  return exports
}
const shared=load('src/shared/facebookRandomRun.ts')
const ids=['facebook_message_uid','facebook_group_post','facebook_newsfeed_interaction','facebook_timeline_post']
const context={date:'2026-11-02',actions:ids.map((id,i)=>({campaignActionId:id,name:id,unit:shared.randomRuleUnit(id),waitingCount:i<2?3:0,pausedCount:i===2?999:0}))}
const rules=[[0,5],[1,3],[1,5],[0,7],[1,2],[2,10],[3,1]].map(([i,quantity])=>({campaignActionId:ids[i],quantity,unit:shared.randomRuleUnit(ids[i])}))
let checks=0
async function main(){
 assert.deepEqual(shared.parseFacebookRandomAiRules(JSON.stringify({rules}),context),rules)
 for(const bad of [rules.slice(0,-1),[...rules,rules.at(-1)],[rules.at(-1),...rules.slice(0,-1)],rules.map((r,i)=>i===0?{...r,quantity:1.1}:r),rules.map((r,i)=>i===0?{...r,campaignActionId:'bad'}:r),rules.map((r,i)=>i===0?{...r,unit:'run'}:r),Array(101).fill(rules[0])]){
  assert.throws(()=>shared.parseFacebookRandomAiRules(JSON.stringify({rules:bad}),context));checks++
 }
 assert.deepEqual(shared.validateFacebookRandomConfig({version:2,mode:'ai',revision:2,rules:[]},ids).rules,[])
 assert.deepEqual(shared.validateFacebookRandomConfig({version:2,mode:'ai',revision:2,rules},ids.slice(1)).rules,rules)
 const manual={version:1,revision:4,rules};assert.deepEqual(shared.validateFacebookRandomConfig(manual,ids),manual)
 let user={staffId:1,organizationId:2,entitlements:{dailySendLimits:{facebookCore:100}}},onSession
 const now='2026-11-02T03:00:00Z',account={id:10,accountGroupSettings:{byActionCode:{send:{dailyLimit:100}}}}
 const rows=Array.from({length:1201},(_,i)=>({id:i+1,account_id:10,staff_id:1,organization_id:2,is_delete:false,provisioning_state:'ready',
  status:'chờ xử lý',action_id:ids[0],schedule:now,recipient:'DO NOT SEND',cookie:'SECRET',limits:{byActionCode:{send:{dailyLimit:30}}}}))
 const base=rows[0]
 rows.push({...base,id:1300,action_id:ids[1],schedule:'2026-11-02T14:00:00Z'},
  {...base,id:1301,action_id:ids[2],status:'tạm dừng'},
  {...base,id:1302,action_id:ids[0],daily_stop_time:'08:00:00'},
  {...base,id:1303,action_id:ids[0],data_target_source_mode:'data_group',schedule_end_date:'2026-11-01T10:00:00Z'},
  {...base,id:1304,action_id:ids[0],schedule:'2026-11-03T10:00:00Z'},
  {...base,id:1305,action_id:ids[0],staff_id:2})
 let pages=0,providerCalls=0,statusCalls=0,commitCalls=0,leaseNo=0,lostResponse=false,blockProvider,dayState=null
 const db={from(table){
  let filters=[],limit=500,after=0
  const q={
   select(){return q},eq(k,v){if(!k.startsWith('random_'))filters.push(r=>r[k]===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},
   lt(k,v){filters.push(r=>r[k]<v);return q},lte(k,v){filters.push(r=>Date.parse(r[k])<=Date.parse(v));return q},like(k){filters.push(r=>r[k].startsWith('facebook_'));return q},
   or(_filter,options){if(!options?.referencedTable)filters.push(r=>!r.daily_stop_time||r.daily_stop_time>'10:00:00');return q},
   gt(k,v){after=v;filters.push(r=>r[k]>v);return q},order(){return q},limit(n,options){if(!options?.referencedTable)limit=n;else assert.equal(n,1);return q},abortSignal(s){s.throwIfAborted();return q},
   then(ok,bad){return Promise.resolve().then(()=>{if(table==='auto_campaigns')pages++;return {data:table==='auto_campaigns'?rows.filter(r=>filters.every(f=>f(r))).slice(0,limit).map(r=>({...r,random_any_input:[],random_due_input:[]})):[],error:null}}).then(ok,bad)}
  };return q
 }}
 const rpc=async(_account,op,input)=>{
  if(op==='ai_status'){statusCalls++;return {date:context.date,ai:dayState,canAttempt:!dayState}}
  if(op==='ai_acquire'){if(dayState)return {owned:false,ai:dayState};dayState={status:'generating',requestId:input.requestId,attempts:++leaseNo,context:input.context};return {date:context.date,ai:dayState,owned:true,leaseToken:'lease'}}
  if(op==='ai_commit'){commitCalls++;dayState={...dayState,status:'ready',rules:input.rules};if(lostResponse){lostResponse=false;throw Error('lost response')}return {date:context.date,ai:dayState}}
  if(op==='ai_fail'){dayState={...dayState,status:'retry_wait'};return {}}
  throw Error(op)
 }
 const service=load('src/main/services/facebookRandomAiService.ts',{
  '../data/supabaseClient':{getSupabaseClient:()=>db},
  '../data/currentUser':{requireCurrentUser:()=>user,onCurrentUserSessionChanged:fn=>{onSession=fn}},
  '../data/repositories/campaignActionRepository':{listCampaignActions:async()=>ids.map(id=>({id,name:id,flatformType:'facebook',limitCheckActionCodes:['send']}))},
  '../data/repositories/facebookRandomRunRepository':{randomRunRpc:rpc},
  '../../shared/facebookRandomRun':shared,
  './requestDeadline':load('src/main/services/requestDeadline.ts'),
  './aiRuntimeService':{callAiUsing:async(code,payload,_meta,options)=>{
    assert.equal(code,'app_facebook_random_run_plan');providerCalls++
    assert(!JSON.stringify(payload).includes('SECRET'));assert(!JSON.stringify(payload).includes('DO NOT SEND'))
    if(blockProvider)await blockProvider
    return {ok:true,content:JSON.stringify({rules})}
  }}
 })
 const summary=await service.buildFacebookRandomAiContext(account,now,new AbortController().signal)
 assert.deepEqual(summary.actions.map(a=>[a.waitingCount,a.pausedCount]),[[1201,0],[1,0],[0,1],[0,0]])
 assert.equal(pages,4);assert.deepEqual(summary.actions[0].limits['send.dailyLimit'],{min:30,max:30})
 assert(!JSON.stringify(summary).includes('SECRET'));assert(!JSON.stringify(summary).includes('DO NOT SEND'))
 // Execute the actual paged candidate reader, independently from summary paging.
 const repoSource=ts.createSourceFile('campaignRepository.ts',fs.readFileSync(path.join(root,'src/main/data/repositories/campaignRepository.ts'),'utf8'),ts.ScriptTarget.Latest,true)
 const reader=repoSource.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='getPendingCampaignsForRandomAi')
 const readerCode=ts.transpileModule(reader.getText(repoSource),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const readerExports={}
 new Function('exports','requireCurrentUser','parseDatabaseNow','formatVietnamTimeForQuery','client','CAMPAIGN_SELECT','mapCampaignFromDB',readerCode)(
  readerExports,()=>user,v=>new Date(v),()=> '10:00:00',()=>db,'fixture',r=>({id:r.id}))
 pages=0
 const fullInventory=await readerExports.getPendingCampaignsForRandomAi(10,now)
 assert.equal(fullInventory.length,1202);assert.equal(pages,4)
 assert(fullInventory.some(c=>c.id===1201));assert(!fullInventory.some(c=>c.id===1301))
 lostResponse=true
 assert.equal(await service.ensureFacebookRandomAiPlan(account,1,now),false)
 assert.equal(await service.ensureFacebookRandomAiPlan(account,1,now),true)
 assert.equal(providerCalls,1);assert.equal(commitCalls,2)
 assert.equal(await service.ensureFacebookRandomAiPlan(account,2,now),true);assert.equal(providerCalls,1)
 // Local single-flight + logout drops a late response before commit, even after login again.
 dayState=null;let release
 blockProvider=new Promise(resolve=>{release=resolve})
 const active=service.ensureFacebookRandomAiPlan(account,3,now)
 while(providerCalls<2)await new Promise(resolve=>setImmediate(resolve))
 assert.equal(await service.ensureFacebookRandomAiPlan(account,3,now),false)
 onSession();user={staffId:99,organizationId:9,entitlements:{dailySendLimits:{}}};release()
 assert.equal(await active,false);assert.equal(commitCalls,2);assert.equal(dayState.status,'generating')
 blockProvider=null
 // Actual scheduler wiring: AI reads all candidates, blocks fallback, returns without spinning.
 const acct={id:10,status:'chờ xử lý',loginStatus:'đã đăng nhập',isActive:true}
 const config={version:2,mode:'ai',revision:1,rules:[]}
 let inventory=[{id:1,actionId:ids[0],status:'chờ xử lý'}],ensures=0,plans=0,execs=0
 let ready=false
 const Scheduler=schedulerClass({},{
  '../../shared/facebookRandomRun':shared,
  '../data/repositories/campaignRepository':{getPendingCampaignsForRandomAi:async()=>inventory},
  './facebookRandomAiService':{ensureFacebookRandomAiPlan:async()=>{ensures++;return ready}},
  '../data/repositories/facebookRandomRunRepository':{
   getRandomSettings:async()=>({enabled:true,config}),
   planAiRandomTurn:async(_id,_rev,candidates)=>{plans++;assert.deepEqual(Array.from(candidates),inventory.map(c=>c.id));return {enabled:true,config,turns:[]}}
  },
  './accountOperationRegistry':{accountOperationRegistry:{has:()=>false}}
 })
 const scheduler=new Scheduler({getAccount:async()=>acct},{},{webContents:{send(){}}})
 Object.assign(scheduler,{running:true,getReadyRuntimeClock:async()=>({dbNow:now}),randomCampaignBlockedReason:async()=>null,
  browseAfterEmptyRandomPlan:async()=>{throw Error('No manual/browsing fallback while waiting AI')},executeCampaign:async()=>{execs++}})
 await scheduler.runFacebookRandomQueue(acct);assert.equal(ensures,1);assert.equal(plans,0)
 ready=true;await scheduler.runFacebookRandomQueue(acct);assert.equal(plans,1)
 inventory=[];await scheduler.runFacebookRandomQueue(acct);assert.equal(ensures,2);assert.equal(plans,2);assert.equal(execs,0)
 console.log(JSON.stringify({checks:checks+29,pagedRows:1201,pagedCandidates:1202,lostCommitReconciled:true,logoutLateResponseDropped:true,externalCalls:0}))
}
main().catch(e=>{console.error(e);process.exitCode=1})
