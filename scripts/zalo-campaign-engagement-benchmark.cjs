// Only called with the private Unix socket created by run-zalo-engagement-sql-smoke.
// A single connection to an isolated test cluster; never accepts a production URL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks')
const {execFileSync}=require('node:child_process')
let backendPid
const dbCpu=()=>{const value=execFileSync('ps',['-p',String(backendPid),'-o','time='],{encoding:'utf8'}).trim().split(':').map(Number);return value.length===3?value[0]*3600+value[1]*60+value[2]:value[0]*60+value[1]}
const {Client}=require(path.resolve('../akaAgentChatApi/node_modules/pg'))
const ts=require('typescript'),vm=require('node:vm')
const mod={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/shared/zaloCampaignEngagement.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:mod,exports:mod.exports,require,Date,Set,Map,JSON})
const {EngagementWatchCache}=mod.exports
const pipelineOnly=process.argv.includes('--pipeline-only');
const host=process.argv[2];assert.ok(host&&path.basename(host).startsWith('engagement-pg-')&&!host.includes('://'))
const db=new Client({host,port:55489,database:'postgres',user:'postgres',application_name:'engagement-isolated-benchmark'})
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
const pct=(a,p)=>[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.floor(a.length*p))]||0
async function runCase(accounts,rate,relevance,scenario){
 const cache=new EngagementWatchCache(scenario==='eviction'?100:100000,64*1024*1024),queue=[],latencies=[],rpcs=[]
 let received=0,updated=0,maxBacklog=0,active=true,working=false,requests=0
 await db.query('UPDATE auto_campaign_detail_zalo_engagement SET responded_at=NULL,reacted_at=NULL WHERE responded_at IS NOT NULL OR reacted_at IS NOT NULL')
 const dbCpuStart=dbCpu()
 const duration=Number(process.env.ENGAGEMENT_BENCH_SECONDS||3),total=rate*duration,start=performance.now(),cpu=process.cpuUsage()
 const consume=async()=>{if(working)return;working=true;try{while(queue.length && (queue.length>=100 || !active || performance.now()-queue[0].at>=5000)){const batch=queue.splice(0,100),unknown=batch.filter(x=>!cache.mayMatch(x.event));let incomplete=false
  if(unknown.length){const at=performance.now();const r=(await db.query('SELECT aka_agent_read_campaign_engagement(1,1,$1,$2::jsonb,\'owner\',\'password\') result',[revision,JSON.stringify(unknown.map(x=>x.event))])).rows[0].result;requests++;rpcs.push(performance.now()-at);incomplete=r.items.length>=1001;for(const row of r.items)cache.put(row)}
  const events=batch.filter(x=>incomplete||cache.mayMatch(x.event));if(events.length){const at=performance.now();const r=(await db.query('SELECT aka_agent_record_campaign_engagement(1,1,$1,$2::jsonb,\'owner\',\'password\') result',[revision,JSON.stringify(events.map(x=>x.event))])).rows[0].result;updated+=r.updated;requests++;rpcs.push(performance.now()-at)}
  for(const item of batch)latencies.push(performance.now()-item.at)
 }}finally{working=false}}
 for(let n=0;n<total;n++){
  const desired=start+n*1000/rate;if(scenario!=='burst'&&performance.now()<desired)await sleep(Math.min(10,desired-performance.now()))
  const hot=scenario==='hot'&&n%5!==0,account=hot?1:(n*7919)%accounts+1,related=n%100<relevance
  const event={accountId:String(account),accountZaloUid:'sender-'+account,targetZaloUid:related?(hot?'hot':'t'+Math.floor(n/accounts)%100):'unrelated-'+n,kind:n%7===0?'reaction':'message',occurredAt:occurredAt,messageIds:['m'+account]}
  queue.push({at:performance.now(),event});received++;maxBacklog=Math.max(maxBacklog,queue.length)
  if(queue.length>=100)void consume()
 }
 active=false;await consume();while(working)await sleep(5);if(queue.length)await consume()
 const elapsed=performance.now()-start,c=process.cpuUsage(cpu)
 const row={accounts,watches:accounts===1000?100000:1000000,rate,relevance,scenario,received,updated,requests,elapsedMs:Math.round(elapsed),maxBacklog,remaining:queue.length,p95Ms:+pct(latencies,.95).toFixed(2),rpcP95Ms:+pct(rpcs,.95).toFixed(2),databaseCpuMs:Math.round((dbCpu()-dbCpuStart)*1000),clientCpuMs:Math.round((c.user+c.system)/1000),rssMiB:Math.round(process.memoryUsage().rss/1048576),cacheEntries:cache.size,cacheMiB:+(cache.bytes/1048576).toFixed(2)}
 console.log(JSON.stringify(row));results.push(row)
 assert.equal(queue.length,0);if(rate===500&&relevance===10&&scenario==='uniform')assert.ok(row.p95Ms<=10000)
}
let revision,occurredAt;const results=[]
async function main(){await db.connect();backendPid=(await db.query('SELECT pg_backend_pid() pid')).rows[0].pid;revision=(await db.query("SELECT updated_at::text FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled'")).rows[0].updated_at
 fs.mkdirSync('.tmp/engagement-audit',{recursive:true})
 for(const [accounts,count] of (pipelineOnly ? [[5000,1000000]] : [[1000,100000],[5000,1000000]])){
  await db.query('TRUNCATE auto_campaign_detail_zalo_engagement,auto_campaign_details RESTART IDENTITY')
  await db.query(`INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,status) SELECT i,1,(i-1)%$1+1,'zalo_message_friend','thành công' FROM generate_series(1,$2::integer) i`,[accounts,count])
  await db.query(`INSERT INTO auto_campaign_detail_zalo_engagement(campaign_detail_id,organization_id,staff_id,account_id,account_zalo_uid,target_zalo_uid,action_type,sent_at,tracking_until,message_ids)
   SELECT id,1,1,account_id,'sender-'||account_id,'t'||(floor((id-1)/$1::numeric)::integer%100),'message',now()-interval '1 hour',now()+interval '47 hours',ARRAY['m'||account_id] FROM auto_campaign_details`,[accounts])
  // A hot recipient with 10,000 eligible send details exercises update fan-out and locks.
  await db.query(`INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,status) SELECT i,1,1,'zalo_message_friend','thành công' FROM generate_series($1::integer+1,$1::integer+10000) i`,[count])
  await db.query(`INSERT INTO auto_campaign_detail_zalo_engagement(campaign_detail_id,organization_id,staff_id,account_id,account_zalo_uid,target_zalo_uid,action_type,sent_at,tracking_until,message_ids)
   SELECT id,1,1,1,'sender-1','hot','message',now()-interval '1 hour',now()+interval '47 hours',ARRAY['m1'] FROM auto_campaign_details WHERE id>$1`,[count])
  await db.query('ANALYZE auto_campaign_details;ANALYZE auto_campaign_detail_zalo_engagement;ANALYZE auto_accounts;ANALYZE zalo_accounts')
  occurredAt=(await db.query('SELECT now()::text at')).rows[0].at
  const plan=(await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT campaign_detail_id FROM auto_campaign_detail_zalo_engagement WHERE organization_id=1 AND staff_id=1 AND account_id=1 AND account_zalo_uid='sender-1' AND target_zalo_uid='t0' AND sent_at<=now() AND tracking_until>=now()`)).rows[0]['QUERY PLAN']
  fs.writeFileSync(`.tmp/engagement-audit/plan-${count}.json`,JSON.stringify(plan,null,2))
  // Recover ambiguous commits against a large details table, with the same
  // scoped predicate used by the read RPC. Seed work is outside pipeline timing.
  await db.query(`UPDATE auto_campaign_details SET data=jsonb_build_object('zaloEngagementSource',jsonb_build_object(
    'version',1,'revision',$1::text,'operationId','operation-'||id,'accountZaloUid','sender-'||account_id,
    'targetZaloUid','t0','actionType','message','sentAt',now()-interval '1 hour','messageIds',jsonb_build_array('m'||account_id))) WHERE id<=1000`,[revision])
  await db.query('ANALYZE auto_campaign_details')
  const operationPlan=(await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id,data->'zaloEngagementSource' FROM auto_campaign_details
    WHERE campaign_id=1 AND account_id=1 AND data#>>'{zaloEngagementSource,operationId}'='operation-1'
      AND data#>>'{zaloEngagementSource,operationId}' IS NOT NULL ORDER BY id LIMIT 1`)).rows[0]['QUERY PLAN']
  assert(JSON.stringify(operationPlan).includes('auto_campaign_engagement_operation'),'operation lookup must use its scoped expression index')
  const operations=Array.from({length:500},(_,n)=>({operation:{operationId:'operation-'+(n+1),campaignId:'1',accountId:String(n+1),accountZaloUid:'sender-'+(n+1),targetZaloUid:'t0'}}))
  const lookupStarted=performance.now()
  const lookup=(await db.query("SELECT aka_agent_read_campaign_engagement(1,1,$1,$2::jsonb,'owner','password') result",[revision,JSON.stringify(operations)])).rows[0].result
  assert.equal(lookup.operations.length,500);assert(lookup.operations.every(item=>item.status==='found'))
  fs.writeFileSync('docs/audits/zalo-engagement/operation-lookup-plan.json',JSON.stringify({details:count+10000,operationSources:1000,batch:500,lookupMs:performance.now()-lookupStarted,plan:operationPlan},null,2)+'\n')
  if(pipelineOnly)continue
  for(const rate of [100,500,2000])for(const relevant of [1,10,100])await runCase(accounts,rate,relevant,'uniform')
  for(const scenario of ['hot','eviction','burst'])await runCase(accounts,500,10,scenario)
 }
 await require('./zalo-campaign-engagement-pipeline-benchmark.cjs')(db)
 if(!pipelineOnly)fs.writeFileSync('docs/audits/zalo-engagement/benchmark.json',JSON.stringify({generatedAt:new Date().toISOString(),scope:'Isolated Postgres RPC + shared positive LRU, one connection; backend CPU via ps. Fixed source timestamp includes duplicate events. Excludes HTTP latency, Chat projection and journal I/O. No competing pool clients; production pool wait/Chat capacity is not inferred.',secondsPerCase:Number(process.env.ENGAGEMENT_BENCH_SECONDS||3),results},null,2)+'\n')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.end())
