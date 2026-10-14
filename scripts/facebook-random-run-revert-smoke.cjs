// V389 -> V391 with populated history/config in isolated Postgres. No Facebook actions.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto'),{fixture,root}=require('./facebook-random-run-fixture.cjs')
async function main(){
 const db=await fixture({lifecycle:true});let checks=0
 const scalar=async(sql,args=[]) =>(await db.query(sql,args)).rows[0].result
 const rpc=(op,input={})=>scalar("SELECT aka_agent_facebook_random_run(1,1,'fixture','fixture',1,$1,$2::jsonb) result",[op,JSON.stringify(input)])
 try{
  await rpc('save',{config:{version:1,revision:0,rules:[{campaignActionId:'facebook_group_post',quantity:1,unit:'data'}]}})
  await rpc('toggle',{enabled:true,revision:1})
  const plan=await rpc('plan',{revision:1,choices:[{ruleIndex:0,campaignId:1}]}),turn=plan.turns[0],parent=randomUUID(),unit=randomUUID()
  assert((await rpc('claim',{turnId:turn.id,campaignId:1,claimToken:parent})).ok)
  await scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,$2::date,$3::uuid,ARRAY[1::bigint]) r",[parent,plan.date,unit])
  await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1")
  await scalar("SELECT to_jsonb(r) result FROM aka_agent_settle_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,false) r",[unit])
  await scalar("SELECT to_jsonb(r) result FROM aka_agent_cleanup_failed_campaign_runtime(1,1,1,'desktop',$1::uuid,NULL,ARRAY[]::bigint[],'',false,'chờ xử lý','chờ xử lý') r",[parent])
  await rpc('toggle',{enabled:false,revision:1})
  const history=await scalar('SELECT to_jsonb(d) result FROM auto_account_random_run_days d'),settings=await rpc('get')
  assert.equal(history.state.turns[0].status,'completed');checks++
  // PG version normalization differs from live; exact metadata preflight is tested live in ROLLBACK.
  const migration=fs.readFileSync(path.join(root,'migrations/migration_v391_revert_facebook_random_run_lifecycle.sql'),'utf8')
  await db.exec(migration.replace(/DO \$preflight\$[\s\S]*?END \$preflight\$;/,''))
  assert.deepEqual(await scalar('SELECT to_jsonb(d) result FROM auto_account_random_run_days d'),history);checks++
  assert.deepEqual(await rpc('get'),settings);checks++
  for(const sig of ['private.facebook_random_finalize_on_release()','private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)','private.facebook_random_orphan_turns(bigint,bigint)','private.facebook_random_pause_requested(bigint,bigint,uuid)']){assert.equal(await scalar('SELECT to_regprocedure($1)::text result',[sig]),null);checks++}
  assert.equal(await scalar("SELECT count(*)::int result FROM pg_trigger WHERE tgname='facebook_random_finalize_on_release'"),0);checks++
  await rpc('toggle',{enabled:true,revision:1})
  const next=await rpc('plan',{revision:1,choices:[{ruleIndex:0,campaignId:1}]})
  assert.equal(next.turns.length,1);checks++
  assert((await rpc('claim',{turnId:next.turns[0].id,campaignId:1,claimToken:randomUUID()})).ok);checks++
  console.log({checks,configPreserved:true,historyPreserved:true,v387StillUsable:true,externalOperations:0})
 }finally{await db.close()}
}
main().catch(error=>{console.error(error.message,error.where||'');process.exitCode=1})
