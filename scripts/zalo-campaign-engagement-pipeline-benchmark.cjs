// Real Desktop coordinator/journal and real Chat inbox acknowledgement/consumer,
// sharing the caller's single isolated PostgreSQL connection. Never production.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),{performance}=require('node:perf_hooks'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process')
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const percentile=values=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*.95))]||0
const load=(file,mocks={})=>{const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:key=>Object.hasOwn(mocks,key)?mocks[key]:require(key),console,Buffer,AbortSignal,Date,setTimeout,clearTimeout},{filename:file});return module.exports}
module.exports=async function pipelineBenchmark(client){
 const pid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid
 const cpu=()=>{const parts=execFileSync('ps',['-p',String(pid),'-o','time='],{encoding:'utf8'}).trim().split(':').map(Number);return parts.reduce((sum,n)=>sum*60+n,0)*1000}
 const shared=load('src/shared/zaloCampaignEngagement.ts'),rate=500,total=5000,results=[]
 const clear=async()=>client.query('UPDATE auto_campaign_detail_zalo_engagement SET responded_at=NULL,reacted_at=NULL WHERE responded_at IS NOT NULL OR reacted_at IS NOT NULL')
 const recorded=async()=>Number((await client.query('SELECT count(*) n FROM auto_campaign_detail_zalo_engagement WHERE responded_at IS NOT NULL')).rows[0].n)
 const lateness=async()=>Number((await client.query(`SELECT COALESCE(percentile_cont(.95) WITHIN GROUP(ORDER BY extract(epoch FROM (updated_at-responded_at))*1000),0) value FROM auto_campaign_detail_zalo_engagement WHERE responded_at IS NOT NULL`)).rows[0].value)
 const event=i=>{const account=i*7919%5000+1;return {account,target:i%100<10?'t0':'unrelated-'+i,payload:{type:0,isSelf:false,data:{uidFrom:i%100<10?'t0':'unrelated-'+i,idTo:'sender-'+account,ts:Date.now()}}}}
 const pace=async(start,i)=>{const delay=start+i*1000/rate-performance.now();if(delay>0)await sleep(delay)}
 // Desktop: actual atomic snapshots, grouping, recovery lookup, cache and RPCs.
 await clear();const directory=fs.mkdtempSync(path.join(os.tmpdir(),'engagement-bench-journal-'));let active=true,requests=0
 const credentials={username:'owner',password:'password'},user={staffId:1,organizationId:1}
 const transport={from:()=>({select:()=>({in:()=>({abortSignal:async()=>({data:(await client.query("SELECT key,value,updated_at::text,is_active,is_secret FROM auto_system_settings WHERE key LIKE 'zalo.campaign_engagement.%'")).rows})})})}),rpc:(name,args)=>({abortSignal:async()=>{requests++;return{data:(await client.query(`SELECT ${name}($1,$2,$3,$4::jsonb,$5,$6) result`,[args.p_staff_id,args.p_organization_id,args.p_revision,JSON.stringify(args.p_items),args.p_auth_username,args.p_auth_password])).rows[0].result}}})}
 const desktop=load('src/main/services/zaloCampaignEngagement.ts',{electron:{app:{getPath:()=>directory}},'../data/currentUser':{getCurrentUser:()=>active?user:null,getCurrentUserCredentials:()=>active?credentials:null},'../data/supabaseClient':{getSupabaseClient:()=>transport},'../data/repositories/runtimeClockRepository':{peekDatabaseRuntimeClock:()=>({dbNow:new Date(Date.now()).toISOString()})},'../../shared/zaloCampaignEngagement':shared})
 desktop.resumeDesktopCampaignEngagement() // Production login warms metadata independently of messages.
 let start=performance.now(),dbStart=cpu(),maxBacklog=0
 try{
  for(let i=0;i<total;i++){await pace(start,i);const e=event(i);desktop.receiveCampaignEngagement('message',e.payload,e.account,'sender-'+e.account);maxBacklog=Math.max(maxBacklog,desktop.engagementMetrics.backlog)}
  const deadline=Date.now()+60000;do{await sleep(100)}while(desktop.engagementMetrics.backlog>0&&Date.now()<deadline)
  await sleep(100)
  results.push({pipeline:'desktop-coordinator-and-atomic-journal',events:total,rate,relevance:10,accounts:5000,watches:1000000,elapsedMs:Math.round(performance.now()-start),databaseCpuMs:Math.round(cpu()-dbStart),requests,recordedRows:await recorded(),cachePhase:'cold-start-bounded-warm',maxBacklog,remaining:desktop.engagementMetrics.backlog,p95UpdateMs:+(await lateness()).toFixed(2),metrics:{...desktop.engagementMetrics},rssMiB:Math.round(process.memoryUsage().rss/1048576)})
 }finally{active=false;await sleep(100);fs.rmSync(directory,{recursive:true,force:true})}
 // Chat: existing inbox projection acknowledgement baseline versus the added stage.
 const chatRoot=path.resolve('../akaAgentChatApi')
 const {Kysely,PostgresDialect}=await import(pathToFileURL(path.join(chatRoot,'node_modules/kysely/dist/index.js')).href)
 const {CampaignEngagementRepository}=await import(pathToFileURL(path.join(chatRoot,'packages/database/dist/campaignEngagementRepository.js')).href)
 const {RuntimeEventInboxRepository}=await import(pathToFileURL(path.join(chatRoot,'packages/database/dist/runtimeEventInboxRepository.js')).href)
 await client.query(`ALTER TABLE chat_zalo_account_organization ADD COLUMN runtime_generation bigint DEFAULT 1;
 ALTER TABLE chat_zalo_runtime_event ADD COLUMN claim_token uuid,ADD COLUMN claimed_at timestamptz,ADD COLUMN claim_expires_at timestamptz,ADD COLUMN failed_at timestamptz,ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN occurred_at timestamptz DEFAULT clock_timestamp();
 INSERT INTO chat_zalo_account SELECT id,zalo_uid FROM zalo_accounts;
 INSERT INTO chat_zalo_account_organization(id,auto_account_id,organization_id,chat_zalo_account_id) SELECT id,id,1,id FROM auto_accounts;
 SELECT set_config('request.jwt.claims','{}',false)`)
 for(const enabled of [false,true]){
  await clear();await client.query('TRUNCATE chat_zalo_runtime_event')
  await client.query("INSERT INTO chat_zalo_runtime_event(id,organization_id,chat_zalo_account_organization_id,claim_token) SELECT i,1,((i-1)*7919)%5000+1,'00000000-0000-4000-8000-000000000001' FROM generate_series(1,$1::integer) i",[total])
  let busy=false;const waiting=[],poolWait=[];let leaseStarted=0
  const pool={connect:()=>new Promise(resolve=>{const at=performance.now();const grant=()=>{busy=true;poolWait.push(performance.now()-at);leaseStarted=performance.now();resolve(client)};if(busy)waiting.push(grant);else grant()}),end:async()=>{}}
  client.release=()=>{busy=false;const next=waiting.shift();if(next)next()}
  const database=new Kysely({dialect:new PostgresDialect({pool})}),worker=new CampaignEngagementRepository(database,async()=>(await client.query("SELECT key,value,updated_at::text,is_active,is_secret FROM auto_system_settings WHERE key LIKE 'zalo.campaign_engagement.%'")).rows),inbox=new RuntimeEventInboxRepository(database,enabled?{engagement:worker}:{})
  if(enabled) worker.wake() // Same startup hook as production; unknown targets may be dropped while warming.
  start=performance.now();dbStart=cpu();const projectionLatency=[];maxBacklog=0
  try{
   for(let i=0;i<total;i++){
    await pace(start,i);const e=event(i),occurredAt=new Date(e.payload.data.ts).toISOString(),at=performance.now()
    await inbox.markRuntimeEventProcessed(String(i+1),'00000000-0000-4000-8000-000000000001',{id:String(i+1),eventType:'message',payload:e.payload,occurredAt,binding:{autoAccountId:String(e.account),chatZaloAccountOrganizationId:String(e.account),organizationId:'1',ownerStaffId:'1',zaloAccountZaloId:'sender-'+e.account,runtimeGeneration:'1'}})
    projectionLatency.push(performance.now()-at)
    if(i%500===0){const count=Number((await client.query("SELECT count(*) count FROM chat_zalo_runtime_event WHERE engagement_state='pending'")).rows[0].count);maxBacklog=Math.max(maxBacklog,count)}
   }
   let remaining=0;const deadline=Date.now()+60000
   do{await sleep(100);remaining=Number((await client.query("SELECT count(*) count FROM chat_zalo_runtime_event WHERE engagement_state='pending'")).rows[0].count)}while(remaining&&Date.now()<deadline)
   await worker.stop()
   results.push({pipeline:enabled?'chat-inbox-with-engagement':'chat-inbox-acknowledgement-baseline',events:total,rate,relevance:10,accounts:5000,watches:1000000,elapsedMs:Math.round(performance.now()-start),databaseCpuMs:Math.round(cpu()-dbStart),recordedRows:enabled?await recorded():null,cachePhase:'cold-start-bounded-warm',maxBacklog,remaining,p95ProjectionAckMs:+percentile(projectionLatency).toFixed(2),p95PoolWaitMs:+percentile(poolWait).toFixed(2),p95UpdateMs:enabled?+(await lateness()).toFixed(2):null,metrics:{...worker.metrics},rssMiB:Math.round(process.memoryUsage().rss/1048576)})
  }finally{await worker.stop();await database.destroy()}
 }
 for(const row of results)console.log(JSON.stringify(row))
 fs.writeFileSync('docs/audits/zalo-engagement/pipeline-benchmark.json',JSON.stringify({generatedAt:new Date().toISOString(),scope:'One isolated PostgreSQL connection. Desktop uses real coordinator/journal and in-process HTTP-shaped adapter; Chat uses real inbox acknowledgement plus engagement worker. Excludes network latency and the rest of Chat projection/UI; pool wait is this isolated single-slot harness, not production. Same 5000 events/500 eps/10% relevance. Cold bounded metadata cache: recordedRows must be reported with latency, which only measures retained marks and is not a delivery/completeness guarantee. Seed inserts are outside timing.',results},null,2)+'\n')
}
