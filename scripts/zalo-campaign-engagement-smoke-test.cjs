const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const compile=p=>ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function load(p,mocks={},globals={}) { const module={exports:{}};vm.runInNewContext(compile(p),{module,exports:module.exports,require:id=>Object.hasOwn(mocks,id)?mocks[id]:require(id),console,Buffer,AbortSignal,setTimeout,clearTimeout,Date,...globals},{filename:p});return module.exports }
const sharedPath=path.resolve('src/shared/zaloCampaignEngagement.ts'),api=load(sharedPath)
const rows=(revision='2026-10-02T00:00:00Z',enabled='true',window='48')=>api.ENGAGEMENT_KEYS.map((key,i)=>({key,value:[enabled,'1','2',window][i],updated_at:revision,is_active:true,is_secret:false}))
async function main(){
 assert.equal(api.parseEngagementConfig([]).enabled,false)
 assert.equal(api.parseEngagementConfig(rows(undefined,'TRUE')).enabled,false)
 assert.equal(api.parseEngagementConfig(rows(undefined,'true','721')).trackingWindowHours,48)
 assert.equal(api.parseEngagementConfig(rows(undefined,'true','72')).trackingWindowHours,72)
 let reads=0,now=Date.parse('2026-10-02T00:01:00Z'),fail=false
 const cache=new api.EngagementConfigCache(async()=>{reads++;if(fail)throw Error('offline');return rows()},()=>now)
 await Promise.all(Array.from({length:1000},()=>cache.get()));assert.equal(reads,1)
 now+=60001;fail=true;await assert.rejects(cache.get());await assert.rejects(cache.get());assert.equal(reads,2)
 const message={type:0,isSelf:false,data:{uidFrom:'target',idTo:'own',ts:'1790899260000'}}
 const event=api.normalizeEngagementEvent('message',message,'1','own',new Date(now).toISOString())[0]
 assert.equal(event.kind,'message');assert.equal(event.targetZaloUid,'target')
 for(const bad of [{...message,type:1},{...message,isSelf:true},{...message,data:{...message.data,uidFrom:'own'}}]) assert.equal(api.normalizeEngagementEvent('message',bad,'1','own',new Date(now).toISOString()).length,0)
 const reaction={isGroup:false,isSelf:false,data:{uidFrom:'target',msgId:'reaction-id',content:{rIcon:'/-heart',rMsg:[{gMsgID:'campaign-message',cMsgID:'client-id'}]}}}
 assert.equal(api.normalizeEngagementEvent('reaction',reaction,'1','own',new Date(now).toISOString())[0].messageIds[0],'campaign-message')
 assert.equal(api.normalizeEngagementEvent('reaction',{...reaction,data:{...reaction.data,content:{rIcon:'',rMsg:[{gMsgID:'campaign-message'}]}}},'1','own',new Date(now).toISOString()).length,0)
 assert.equal(api.normalizeEngagementEvent('friend_event',{type:0,data:'target',isSelf:false},'1','own',new Date(now).toISOString())[0].kind,'friend')
 assert.equal(api.normalizeEngagementEvent('friend_event',{type:1,data:'target'},'1','own',new Date(now).toISOString()).length,0)
 assert.equal(JSON.stringify(api.engagementMessageIds({mediaResponse:{attachment:[{msgId:'a'}]},contentResponse:{message:{msgId:'b'}},content:{msgId:'ignore'},cliMsgId:'ignore'})),JSON.stringify(['a','b']))
 const seen={type:0,isSelf:false,threadId:'target',data:{idTo:'target',msgId:'campaign-message',realMsgId:'do-not-use'}}
 assert.equal(api.normalizeEngagementEvent('seen_messages',[seen],'1','own',new Date(now).toISOString())[0].messageIds[0],'campaign-message')
 assert.equal(api.normalizeEngagementEvent('seen_messages',[{...seen,type:1}],'1','own',new Date(now).toISOString()).length,0)
 assert.equal(api.normalizeEngagementEvent('delivered_messages',[{...seen,data:{...seen.data,seenUids:[],deliveredUids:['target']}}],'1','own',new Date(now).toISOString()).length,0)
 assert.equal(api.normalizeEngagementEvent('delivered_messages',[{...seen,data:{...seen.data,seenUids:['target']}}],'1','own',new Date(now).toISOString())[0].kind,'seen')
 const watch={campaign_detail_id:1,account_id:1,account_zalo_uid:'own',target_zalo_uid:'target',action_type:'message',message_ids:['campaign-message'],sent_at:'2026-10-02T00:00:00Z',tracking_until:'2026-10-05T00:00:00Z',responded_at:null,reacted_at:null,friended_at:null}
 const lru=new api.EngagementWatchCache(1,10000);lru.put(watch);assert.equal(lru.mayMatch(event),true)
 lru.put({...watch,campaign_detail_id:2,target_zalo_uid:'other'});assert.equal(lru.mayMatch(event),undefined)
 assert.equal(lru.mayMatch({...event,accountZaloUid:'old-session'}),undefined)
 assert.equal(api.engagementDisplay(watch,true),'')
 assert.equal(api.engagementDisplay({...watch,tracking_until:'2000-01-01T00:00:00Z'},true),'')
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'engagement-journal-'))
 try {
  let settings=rows(),calls=[],timers=[],rpcFail=false,configReads=0;const user={staffId:1,organizationId:1},credentials={username:'owner-secret',password:'password-secret'}
  const client={from:()=>({select:()=>({in:()=>({abortSignal:async()=>{configReads++;return{data:settings,error:null}}})})}),rpc:(name,args)=>({abortSignal:async()=>{calls.push({name,args});if(rpcFail)return{error:Error('offline')};return{data:{enabled:settings[0].value==='true',items:name.includes('register')?[watch]:[],pending:[],updated:1}}}})}
  class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
  const coordinator=load(path.resolve('src/main/services/zaloCampaignEngagement.ts'),{
   electron:{app:{getPath:()=>dir}},'../data/currentUser':{getCurrentUser:()=>user,getCurrentUserCredentials:()=>credentials},'../data/supabaseClient':{getSupabaseClient:()=>client},'../../shared/zaloCampaignEngagement':api
  },{Date:Clock,setTimeout:(fn,ms)=>{const timer={fn,at:now+ms,unref(){}};timers.push(timer);return timer},clearTimeout:t=>{timers=timers.filter(v=>v!==t)}})
  const settle=async()=>{for(let i=0;i<15;i++) await new Promise(r=>setTimeout(r,5))}
  const tick=async(ms)=>{now+=ms;const due=timers.filter(t=>t.at<=now);timers=timers.filter(t=>t.at>now);for(const t of due)t.fn();await settle()}
  now=Date.parse('2026-10-02T00:01:00Z')
  for(let i=0;i<10000;i++) coordinator.receiveCampaignEngagement('message',message,1,'own')
  await settle();assert.equal(configReads,0);assert.equal(calls.length,0);assert(!fs.existsSync(path.join(dir,'campaign-engagement')),'cold unknown events never touch disk or DB')
  coordinator.campaignEngagementEnabled();await settle()
  const send=await coordinator.beginCampaignEngagementSend({id:1,zaloUid:'own'},'target')
  assert.ok(send.operationId)
  coordinator.receiveCampaignEngagement('message',{...message,data:{...message.data,ts:now+1000}},1,'own');await settle();await tick(2000)
  assert.equal(calls.filter(c=>c.name.includes('record')).length,0,'no registered watch yet; retain event for its in-flight source')
  const source=api.makeEngagementSource('own','target','message',send.sentAt,{message:{msgId:'m'}},send.revision,send.operationId)
  coordinator.recordCampaignEngagementDetail(1,source);await settle();await tick(2000);await tick(2)
  assert.ok(calls.find(c=>c.name==='aka_agent_register_campaign_engagement'))
  assert.ok(calls.find(c=>c.name==='aka_agent_record_campaign_engagement'))
  const journal=fs.readFileSync(path.join(dir,'campaign-engagement/1-1.json'),'utf8')
  assert.ok(!journal.includes('password-secret')&&!journal.includes('owner-secret')&&!journal.includes('content'))
  const before=calls.length;await tick(10000);assert.equal(calls.length,before,'idle must not call RPC')
  const initialReads=configReads,initialCalls=calls.length,initialStat=fs.statSync(path.join(dir,'campaign-engagement/1-1.json')).mtimeMs
  for(let i=0;i<10000;i++) {
    coordinator.receiveCampaignEngagement('message',message,2,'other-account')
    coordinator.receiveCampaignEngagement('message',{...message,data:{...message.data,uidFrom:'unrelated-'+i}},1,'own')
  }
  await settle();await tick(5000)
  assert.equal(configReads,initialReads);assert.equal(calls.length,initialCalls);assert.equal(fs.statSync(path.join(dir,'campaign-engagement/1-1.json')).mtimeMs,initialStat,'unrelated traffic never writes journal')
  // Captured fallback timestamp survives transport retry.
  rpcFail=true;coordinator.receiveCampaignEngagement('message',{...message,data:{...message.data,ts:undefined}},1,'own');await settle();await tick(2000)
  const attempts=calls.filter(c=>c.name.includes('record'));const firstAt=attempts.at(-1)?.args.p_items[0].occurredAt
  await tick(1000);rpcFail=false;await tick(6000)
  assert.equal(calls.filter(c=>c.name.includes('record')).at(-1).args.p_items[0].occurredAt,firstAt)
  // Execute the production repository boundary: journal before INSERT, classify
  // the raw failure, and leave quota/counters untouched when persistence fails.
  const repository=fs.readFileSync('src/main/data/repositories/campaignRepository.ts','utf8')
  const create=repository.slice(repository.indexOf('export async function createCampaignDetail('),repository.indexOf('export async function deleteCampaignDetail('))
  const compiled=ts.transpileModule(create,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  let insertError,transportError,log=[],counter=0
  const module={exports:{}},sourceFixture={operationId:'test-operation'}
  const query={insert(){log.push('insert');return this},select(){return this},single(){return transportError?Promise.reject(transportError):Promise.resolve({data:{id:1,accountId:1,actionCode:'zalo_message_friend',status:'thành công',data:{zaloEngagementSource:sourceFixture}},error:insertError})}}
  vm.runInNewContext(compiled,{module,exports:module.exports,console,client:()=>({from:()=>query}),
    stageCampaignEngagementSource:()=>{log.push('stage')},
    failCampaignEngagementDetail:(_source,error)=>{log.push(error)},recordCampaignEngagementDetail:()=>log.push('register'),mapCampaignDetailFromDB:x=>x,
    shouldCountDetailByDefault:()=>true,accountActionRepo:{incrementAccountActionCount:async()=>{counter++}},errorPolicyRepo:{resetConsecutiveErrors:async()=>{}}})
  const input={campaignId:1,accountId:1,actionCode:'zalo_message_friend',data:{zaloEngagementSource:sourceFixture}}
  insertError={code:'23503',message:'rejected'}
  await assert.rejects(module.exports.createCampaignDetail(input),/Failed to create campaign detail/)
  assert.deepEqual(log,['stage','insert',insertError]);assert.equal(counter,0)
  log=[];insertError=undefined;transportError=Error('lost response')
  await assert.rejects(module.exports.createCampaignDetail(input),/lost response/)
  assert.deepEqual(log,['stage','insert',transportError]);assert.equal(counter,0)
  log=[];transportError=undefined;await module.exports.createCampaignDetail(input)
  assert.deepEqual(log,['stage','insert','register']);assert.equal(counter,1)
  console.log('PASS: 30000 cold/unrelated events generate zero DB reads/writes or journal writes; settings dedup/fail-closed, event mapping, source IDs, LRU unknown, stored deadlines, early event journal, retry timestamp, no idle writes')
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1})
