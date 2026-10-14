// Actual Postgres functions/trigger with isolated PGlite; no external effects.
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{fixture}=require('./facebook-random-run-fixture.cjs')
let checks=0
async function main(){
 const db=await fixture({lifecycle:true,restoredLifecycle:process.argv.includes('--restored-v392'),boundaries:process.argv.includes('--boundaries-v393')})
 const scalar=async(sql,args=[]) =>(await db.query(sql,args)).rows[0].result
 const rpc=(op,input={})=>scalar("SELECT aka_agent_facebook_random_run(1,1,'fixture','fixture',1,$1,$2::jsonb) result",[op,JSON.stringify(input)])
 const asAnon=async(run)=>{await db.exec('SET ROLE anon');try{return await run()}finally{await db.exec('RESET ROLE')}}
 const recover=()=>asAnon(()=>scalar("SELECT to_jsonb(r) result FROM aka_agent_recover_campaign_runtime_unit_leases(1,'desktop','all') r"))
 const day=await scalar("SELECT timezone('Asia/Ho_Chi_Minh',now())::date::text result")
 const cfg={version:1,revision:0,rules:[{campaignActionId:'facebook_group_post',quantity:1,unit:'data'},{campaignActionId:'facebook_timeline_post',quantity:1,unit:'run'}]}
 const check=(value)=>{assert.equal(value,true);checks++}
 let turn,token,unit
 const start=async()=>{
  await db.exec("UPDATE auto_campaigns SET status='chờ xử lý',note=NULL,runtime_claim_token=NULL,runtime_unit_token=NULL WHERE id=1; UPDATE auto_accounts SET status='chờ xử lý',is_delete=false,runtime_operation_claim_token=NULL WHERE id=1; UPDATE auto_campaign_input_data SET status='chờ xử lý' WHERE id=1")
  const plan=await rpc('plan',{revision:1,choices:[{ruleIndex:0,campaignId:1}]});turn=plan.turns[0];assert.ok(turn)
  token=randomUUID();const c=await rpc('claim',{turnId:turn.id,campaignId:1,claimToken:token});check(c.ok)
  unit=randomUUID();const u=await scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,$2::date,$3::uuid,ARRAY[1::bigint]) r",[token,day,unit]);check(u.ok)
 }
 const settle=async()=>check((await scalar("SELECT to_jsonb(r) result FROM aka_agent_settle_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,false) r",[unit])).ok)
 const progress=()=>rpc('progress',{turnId:turn.id,claimToken:token})
 const cleanup=async(note='',claim=token)=>asAnon(()=>scalar("SELECT to_jsonb(r) result FROM aka_agent_cleanup_failed_campaign_runtime(1,1,1,'desktop',$1::uuid,NULL,ARRAY[]::bigint[],$2,false,'chờ xử lý','chờ xử lý') r",[claim,note]))
 try{
  await rpc('save',{config:cfg});await rpc('toggle',{enabled:true,revision:1})
  // Pause wins after the final target settles, before budget cleanup.
  await start();await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1");await settle()
  await db.exec("UPDATE auto_campaigns SET status='tạm dừng',note='User pause' WHERE id=1")
  check((await cleanup()).ok);assert.equal(await scalar('SELECT status result FROM auto_campaigns WHERE id=1'),'tạm dừng');checks++
  assert.equal((await progress()).reason,'User pause');checks++
  // A pause hint that arrives while cleanup waits also wins the conditional write.
  await start();await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1");await settle()
  await db.exec("UPDATE auto_campaigns SET note='Đang chờ tạm dừng' WHERE id=1")
  check((await cleanup()).ok);assert.equal(await scalar('SELECT status result FROM auto_campaigns WHERE id=1'),'tạm dừng');checks++
  // Normal release finalizes inside its transaction, before the next machine plans.
  await start();await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1");await settle();check((await cleanup()).ok)
  assert.equal((await progress()).status,'completed');checks++
  await rpc('plan',{revision:1,choices:[]})
  assert.equal((await rpc('finish',{turnId:turn.id,claimToken:token})).status,'completed');checks++
  check((await cleanup()).ok);assert.equal((await progress()).processed,1);checks++
  // A stale owner cannot finish/release another parent's work.
  await start();const rejected=await cleanup('',randomUUID());assert.equal(rejected.ok,false);checks++
  assert.equal(await scalar('SELECT runtime_claim_token::text result FROM auto_campaigns WHERE id=1'),token);checks++
  // Stop + crash: recovery closes history independently of the enabled flag.
  await rpc('toggle',{enabled:false,revision:1});await recover()
  const recovered=await progress();assert.equal(recovered.status,'stopped');assert.ok(recovered.endedAt);checks+=2
  assert.equal(await scalar('SELECT runtime_unit_token IS NULL result FROM auto_campaigns WHERE id=1'),true);checks++
  assert.equal((await rpc('get')).enabled,false);checks++
  // Proven recovery also handles pre-V389 orphan turns without a unit, mode off.
  await db.exec("UPDATE auto_campaigns SET status='chờ xử lý',runtime_claim_token=NULL WHERE id=1; UPDATE auto_account_random_run_days SET state=jsonb_set(state,ARRAY['turns',((jsonb_array_length(state->'turns'))-1)::text,'status'],'\"running\"')")
  await rpc('plan',{revision:1,choices:[]});assert.equal((await progress()).status,'running');checks++ // plan must not invent recovery
  await recover()
  assert.equal((await progress()).status,'stopped');checks++
  // Parent release during an active unit defers finalization until that unit settles.
  await rpc('toggle',{enabled:true,revision:1});await start()
  await db.exec("UPDATE auto_campaigns SET status='tạm dừng',note='Pause mid-unit' WHERE id=1")
  assert.equal((await progress()).status,'running');checks++
  await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1");await settle()
  assert.equal((await progress()).status,'stopped');assert.equal((await progress()).processed,1);checks+=2
  // Last old-day unit: terminal output stays readable/retryable after closing the day.
  await start();await db.exec("UPDATE auto_account_random_run_days SET run_date=run_date-1; UPDATE auto_campaigns SET runtime_unit_vietnam_date=runtime_unit_vietnam_date-1 WHERE id=1; UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1")
  await settle();check((await cleanup()).ok);assert.equal(await scalar('SELECT status result FROM auto_account_random_run_days'),'closed');checks++
  assert.equal((await progress()).status,'completed');assert.equal((await rpc('finish',{turnId:turn.id,claimToken:token})).status,'completed');checks+=2
  // Account deletion does not prevent token-scoped settle/cleanup/finalization.
  await start();await db.exec("UPDATE auto_accounts SET is_delete=true WHERE id=1; UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1");await settle()
  await assert.rejects(progress,/random_account_not_found/);checks++;check((await cleanup('Account removed')).ok)
  assert.equal(await scalar("SELECT state->'turns'->-1->>'status' result FROM auto_account_random_run_days WHERE run_date=timezone('Asia/Ho_Chi_Minh',now())::date"),'stopped');checks++
  console.log(JSON.stringify({checks,externalOperations:0}))
 }finally{await db.close()}
}
main().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exitCode=1})
