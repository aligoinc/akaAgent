// Two connections only to the private test cluster, to verify the registration /
// retained inbox metadata lock under both commit orders and nonblocking ACK. No application pool.
const assert=require('node:assert/strict'),path=require('node:path'),{Client}=require(path.resolve('../akaAgentChatApi/node_modules/pg'))
const host=process.argv[2];assert(host&&path.basename(host).startsWith('engagement-pg-')&&!host.includes('://'))
const options={host,port:55489,user:'postgres',database:'postgres'},a=new Client(options),b=new Client(options)
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function main(){
 await a.connect();await b.connect()
 await a.query(`INSERT INTO org_staff VALUES(1,1,true,'owner','password');INSERT INTO auto_campaigns VALUES(1,1,1);
 INSERT INTO auto_accounts(id,staff_id,organization_id) VALUES(1,1,1);INSERT INTO chat_zalo_account VALUES(1,'sender');INSERT INTO chat_zalo_account_organization VALUES(1,1,1,1,true);
 UPDATE auto_system_settings SET value='true' WHERE key='zalo.campaign_engagement.enabled'`)
 const revision=(await a.query("SELECT updated_at::text r FROM auto_system_settings WHERE key='zalo.campaign_engagement.enabled'")).rows[0].r
 const insertSource=async id=>a.query(`INSERT INTO auto_campaign_details(id,campaign_id,account_id,status,action_code,data) VALUES($1,1,1,'thành công','zalo_message_friend',$2)`,[id,{zaloEngagementSource:{version:1,revision,accountZaloUid:'sender',targetZaloUid:'target',actionType:'message',messageIds:['m'],sentAt:new Date(Date.now()-10000).toISOString()}}])
 const register=id=>a.query("SELECT aka_agent_register_campaign_engagement(1,1,$1,$2,'owner','password')",[revision,JSON.stringify([{detailId:String(id)}])])
 // Simulate metadata already being persisted by an older producer.
 const stage=id=>b.query(`WITH lock AS MATERIALIZED(SELECT pg_advisory_xact_lock(hashtextextended('campaign-engagement:1:1:sender:target',0)))
 INSERT INTO chat_zalo_runtime_event(id,organization_id,chat_zalo_account_organization_id,processed_at,engagement_state,engagement_revision,engagement_payload,engagement_occurred_at,engagement_target_uid,engagement_account_uid)
 SELECT $1,1,1,now(),'done',$2,'{"staffId":"1","events":[{"kind":"seen","messageIds":["m"]}]}',now(),'target','sender' FROM lock`,[id,revision])
 await insertSource(1);await a.query('BEGIN');await register(1)
 let committed=false;const pending=stage(1).then(()=>{committed=true});await sleep(80);assert.equal(committed,false,'stage must wait for source commit')
 await a.query('COMMIT');await pending
 await b.query("SELECT aka_agent_record_campaign_engagement(1,1,$1,$2,'owner','password')",[revision,JSON.stringify([{accountId:'1',accountZaloUid:'sender',targetZaloUid:'target',kind:'seen',messageIds:['m'],occurredAt:new Date().toISOString()}])])
 assert((await a.query('SELECT seen_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=1')).rows[0].seen_at)
 await insertSource(2);await b.query('BEGIN');await stage(2)
 let registered=false;const otherOrder=register(2).then(()=>{registered=true});await sleep(80);assert.equal(registered,false,'registration must wait for staged inbox commit')
 await b.query('COMMIT');await otherOrder
 assert((await a.query('SELECT seen_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=2')).rows[0].seen_at,'registration reconciles committed inbox')
 await a.query('UPDATE auto_campaign_details SET is_delete=true WHERE id=2;UPDATE auto_campaign_detail_zalo_engagement SET seen_at=NULL WHERE campaign_detail_id=2')
 await register(2);assert.equal((await a.query('SELECT seen_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=2')).rows[0].seen_at,null,'soft-deleted detail cannot be changed during registration replay')
 // Exercise the real worker's waiting_config promotion against registration.
 await a.query(`TRUNCATE chat_zalo_runtime_event;
 ALTER TABLE chat_zalo_account_organization ADD COLUMN runtime_generation bigint DEFAULT 1;
 ALTER TABLE chat_zalo_runtime_event ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN occurred_at timestamptz DEFAULT clock_timestamp(),ADD COLUMN claim_token uuid,ADD COLUMN claimed_at timestamptz,ADD COLUMN claim_expires_at timestamptz,ADD COLUMN failed_at timestamptz`)
 const {pathToFileURL}=require('node:url'),chatRoot=path.resolve('../akaAgentChatApi')
 const {Kysely,PostgresDialect}=await import(pathToFileURL(path.join(chatRoot,'node_modules/kysely/dist/index.js')).href)
 const {RuntimeEventInboxRepository}=await import(pathToFileURL(path.join(chatRoot,'packages/database/dist/runtimeEventInboxRepository.js')).href)
 const {CampaignEngagementRepository}=await import(pathToFileURL(path.join(chatRoot,'packages/database/dist/campaignEngagementRepository.js')).href)
 b.release=()=>{}
 const database=new Kysely({dialect:new PostgresDialect({pool:{connect:async()=>b,end:async()=>{}}})})
 const worker=new CampaignEngagementRepository(database,async()=>(await b.query("SELECT key,value,updated_at::text,is_active,is_secret FROM auto_system_settings WHERE key LIKE 'zalo.campaign_engagement.%'")).rows),cfg=await worker.config.get();await worker.warmCatalog(cfg)
 const waiting=async id=>b.query(`INSERT INTO chat_zalo_runtime_event(id,organization_id,chat_zalo_account_organization_id,processed_at,engagement_state,engagement_revision,engagement_payload,engagement_occurred_at,engagement_target_uid,engagement_account_uid,engagement_next_attempt_at)
 VALUES($1,1,1,now(),'waiting_config',$2,$3,now(),'target','sender',now())`,[id,revision,{staffId:'1',runtimeGeneration:'1',events:[{accountId:'1',accountZaloUid:'sender',targetZaloUid:'target',kind:'seen',messageIds:['m'],occurredAt:new Date().toISOString()}]}])
 try{
  const inbox=new RuntimeEventInboxRepository(database,{engagement:worker}),token='00000000-0000-4000-8000-000000000001'
  const event=id=>({id,claimToken:token,eventType:'message',occurredAt:new Date().toISOString(),payload:{type:0,isSelf:false,data:{uidFrom:'target',idTo:'sender',ts:Date.now()}},binding:{autoAccountId:'1',chatZaloAccountOrganizationId:'1',zaloAccountZaloId:'sender',organizationId:'1',ownerStaffId:'1',runtimeGeneration:'1'}})
  const insertEvent=id=>b.query('INSERT INTO chat_zalo_runtime_event(id,organization_id,chat_zalo_account_organization_id,claim_token) VALUES($1,1,1,$2)',[id,token])
  await insertEvent('90');await a.query('BEGIN')
  await a.query("SELECT pg_advisory_xact_lock(hashtextextended('campaign-engagement:1:1:sender:target',0))")
  // A blocked ACK would time out here while A keeps its tracking lock.
  await b.query("SET statement_timeout='2s'")
  try {
   assert.equal(await inbox.markRuntimeEventProcessed('90',token,event('90')),true)
   const skipped=(await b.query('SELECT processed_at,engagement_state,engagement_payload FROM chat_zalo_runtime_event WHERE id=90')).rows[0]
   assert(skipped.processed_at);assert.equal(skipped.engagement_state,null);assert.equal(skipped.engagement_payload,null)
  } finally {await a.query('ROLLBACK');await b.query('RESET statement_timeout')}
  await insertEvent('91');assert.equal(await inbox.markRuntimeEventProcessed('91',token,event('91')),true)
  assert.equal((await b.query('SELECT engagement_state FROM chat_zalo_runtime_event WHERE id=91')).rows[0].engagement_state,'pending','tracking resumes when recipient lock is free')
  await b.query('TRUNCATE chat_zalo_runtime_event')
  await insertSource(3);await waiting(3);await a.query('BEGIN');await register(3)
  assert.equal((await a.query('SELECT seen_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=3')).rows[0].seen_at,null,'registration excludes unresolved config')
  let promoted=false;const promote=worker.reconcileConfigWork(cfg).then(()=>{promoted=true})
  await sleep(80);assert.equal(promoted,false,'config promotion waits for registration commit')
  await a.query('COMMIT');await promote;await worker.recordEvents(cfg)
  assert((await a.query('SELECT seen_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=3')).rows[0].seen_at,'promoted event finds the committed watch')
  await b.query('TRUNCATE chat_zalo_runtime_event');await insertSource(4);await waiting(4)
  await b.query('BEGIN');await worker.reconcileConfigWork(cfg)
  let lateRegistered=false;const registerAfter=register(4).then(()=>{lateRegistered=true})
  await sleep(80);assert.equal(lateRegistered,false,'registration waits for config promotion commit')
  await b.query('COMMIT');await registerAfter
  assert((await a.query('SELECT seen_at FROM auto_campaign_detail_zalo_engagement WHERE campaign_detail_id=4')).rows[0].seen_at,'registration reconciles promoted metadata')
 }finally{await worker.stop();await database.destroy()}
 await a.query('ALTER TABLE chat_zalo_account_organization DROP COLUMN runtime_generation;ALTER TABLE chat_zalo_runtime_event DROP COLUMN created_at,DROP COLUMN occurred_at,DROP COLUMN claim_token,DROP COLUMN claimed_at,DROP COLUMN claim_expires_at,DROP COLUMN failed_at')
 console.log('PASS real concurrent transactions: busy tracking lock never blocks projection ACK; retained metadata/config promotion in both commit orders; soft-delete replay guard')
 // Measure catalog startup access on isolated history, without disabling seq scans.
 await a.query('BEGIN')
 try {
  await a.query(`INSERT INTO auto_campaign_details(id,campaign_id,account_id,action_code,status) SELECT n,1,1,'zalo_message_friend','thành công' FROM generate_series(1000,21600) n;
   INSERT INTO auto_campaign_detail_zalo_engagement(campaign_detail_id,organization_id,staff_id,account_id,account_zalo_uid,target_zalo_uid,action_type,sent_at,tracking_until,message_ids)
   SELECT n,1,1,1,'sender','catalog-'||n,'message',now()-interval '48 hours',CASE WHEN n<21000 THEN now()-interval '1 hour' ELSE now()+interval '48 hours' END,ARRAY['m'] FROM generate_series(1000,21600) n;
   ANALYZE auto_campaign_details;ANALYZE auto_campaign_detail_zalo_engagement;ANALYZE auto_accounts;ANALYZE auto_campaigns;ANALYZE chat_zalo_account_organization;ANALYZE chat_zalo_account;`)
  const fs=require('node:fs'),migration=fs.readFileSync('migrations/migration_v339_zalo_campaign_engagement.sql','utf8')
  const start=migration.indexOf('     SELECT e.* FROM public.auto_campaign_detail_zalo_engagement e',migration.indexOf("p_items->0 ? 'catalog'"))
  const stop=migration.indexOf('LIMIT 500',start)+'LIMIT 500'.length
  const query=migration.slice(start,stop).replaceAll('p_staff_id','1').replaceAll('p_organization_id','1').replaceAll('v_catalog_from','now()').replaceAll('v_catalog_until','now()').replaceAll('v_catalog_id','0')
  const plan=(await a.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+query)).rows[0]['QUERY PLAN']
  assert(JSON.stringify(plan).includes('auto_campaign_engagement_catalog'),'catalog warm-up should use scoped deadline index')
  fs.writeFileSync('docs/audits/zalo-engagement/catalog-plan.json',JSON.stringify({rows:20605,expiredSeedRows:20000,plan},null,2)+'\n')
  console.log('PASS catalog EXPLAIN uses scoped deadline index across 20000 expired rows')
 } finally {await a.query('ROLLBACK')}
 await a.query('TRUNCATE auto_campaign_detail_zalo_engagement,auto_campaign_details,chat_zalo_runtime_event,chat_zalo_account_organization,chat_zalo_account,auto_accounts,zalo_accounts,auto_campaigns,org_staff CASCADE')
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await a.end();await b.end()})
