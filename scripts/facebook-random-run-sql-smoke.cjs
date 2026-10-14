const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { fixture } = require('./facebook-random-run-fixture.cjs')
let checks = 0
async function main() {
  const db = await fixture()
  const scalar = async (sql, args=[]) => (await db.query(sql,args)).rows[0].result
  const rpc = (op,input={},staff=1,org=1) => scalar('SELECT aka_agent_facebook_random_run($1,$2,$3,$4,1,$5,$6::jsonb) result',[staff,org,staff===1?'fixture':'other','fixture',op,JSON.stringify(input)])
  const rule=(id,quantity,unit)=>({campaignActionId:id,quantity,unit})
  const config={version:1,revision:0,rules:[rule('facebook_group_post',2,'data'),rule('facebook_timeline_post',1,'run'),rule('facebook_newsfeed_interaction',5,'minute')]}
  const day=(await scalar("SELECT timezone('Asia/Ho_Chi_Minh',now())::date::text result"))
  const assertOk=(r)=>{assert.equal(r.ok,true,JSON.stringify(r));checks++;return r}
  const claim=async(turn,token=randomUUID())=>({r:await rpc('claim',{campaignId:turn.campaignId,turnId:turn.id,claimToken:token}),token})
  const unit=(campaign,token,ids=[],unitToken=randomUUID())=>scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_run_unit_v2($1,1,1,'desktop',$2::uuid,$3::date,$4::uuid,$5::bigint[]) r",[campaign,token,day,unitToken,ids])
  const settle=(campaign,token,cancelled=false)=>scalar("SELECT to_jsonb(r) result FROM aka_agent_settle_campaign_run_unit_v2($1,1,1,'desktop',$2::uuid,$3) r",[campaign,token,cancelled])
  const progress=(turn,token)=>rpc('progress',{turnId:turn.id,claimToken:token})
  const release=async(id)=>db.query("UPDATE auto_campaigns SET status='chờ xử lý',runtime_claim_token=NULL,runtime_claim_vietnam_date=NULL,runtime_claimed_at=NULL,runtime_claim_target=NULL WHERE id=$1;",[id]).then(()=>db.exec("UPDATE auto_accounts SET status='chờ xử lý',runtime_operation_claim_token=NULL WHERE id=1"))
  try {
    assert.equal((await rpc('get')).enabled,false);checks++
    assert.equal((await rpc('save',{config})).config.revision,1);checks++
    await assert.rejects(()=>rpc('save',{config}),/random_config_conflict/);checks++
    await assert.rejects(()=>rpc('get',{},2),/random_account_not_found/);checks++
    await assert.rejects(()=>rpc('get',{},1,2),/automation_auth_invalid/);checks++
    for(const invalid of [rule('bad',1,'data'),rule('facebook_timeline_post',2,'run'),rule('facebook_group_post',0,'data'),rule('facebook_newsfeed_interaction',1.5,'minute'),rule('facebook_group_post',2,'minute')]) {
      await assert.rejects(()=>rpc('save',{config:{...config,revision:1,rules:[invalid]}}),/random_invalid_rule/);checks++
    }
    await rpc('toggle',{enabled:true,revision:1})
    const plan=await rpc('plan',{revision:1,choices:[{ruleIndex:2,campaignId:3},{ruleIndex:0,campaignId:1},{ruleIndex:1,campaignId:2}]})
    assert.deepEqual(plan.turns.map(t=>t.campaignId),[1,2,3]);checks++
    const retryPlan=await rpc('plan',{revision:1,choices:[]});assert.deepEqual(retryPlan.turns,plan.turns);checks++
    const legacy=await scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_runtime_checked(1,1,1,'desktop') r")
    assert.equal(legacy.reason,'random_context_required');checks++
    const outOfOrder=await claim(plan.turns[1]);assert.equal(outOfOrder.r.ok,false);checks++
    const first=await claim(plan.turns[0]);assertOk(first.r)
    assertOk((await claim(plan.turns[0],first.token)).r)
    const loser=await claim(plan.turns[0]);assert.equal(loser.r.ok,false);checks++
    const batch=assertOk(await unit(1,first.token,[1,2]));assertOk(await unit(1,first.token,[1,2],batch.runtime_unit_token))
    await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1")
    assertOk(await settle(1,batch.runtime_unit_token,true))
    let p=await progress(plan.turns[0],first.token);assert.equal(p.processed,1);checks++
    assertOk(await settle(1,batch.runtime_unit_token,true));assert.equal((await progress(plan.turns[0],first.token)).processed,1);checks++
    assert.equal((await unit(1,first.token,[2,3])).reason,'random_budget_exhausted');checks++
    // Stop during a unit: exact retry/settlement still work; new units cannot start.
    const b2=assertOk(await unit(1,first.token,[2]))
    await rpc('toggle',{enabled:false,revision:1});assertOk(await unit(1,first.token,[2],b2.runtime_unit_token))
    await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=2")
    assertOk(await settle(1,b2.runtime_unit_token));assert.equal((await unit(1,first.token,[3])).reason,'random_mode_changed');checks++
    await release(1)
    await rpc('finish',{turnId:plan.turns[0].id,claimToken:first.token})
    const output=await rpc('day',{date:day});assert.equal(output.turns[0].processed,2);assert.equal(output.turns[1].status,'skipped');assert.equal('claimToken' in output.turns[0],false);checks+=3
    assert.equal((await rpc('day',{date:day,campaignId:1})).total,1);checks++
    assert.deepEqual(await rpc('dates'),[day]);checks++
    // An empty round creates neither new turns nor a synthetic day.
    await rpc('toggle',{enabled:true,revision:1})
    assert.equal((await rpc('plan',{revision:1,choices:[]})).turns.length,0);checks++
    // Config replacement resets at rule 0, snapshots of old turns remain immutable.
    const revised={...config,revision:1,rules:[rule('facebook_newsfeed_interaction',7,'minute'),rule('facebook_timeline_post',1,'run')]}
    await rpc('save',{config:revised})
    const next=await rpc('plan',{revision:2,choices:[{ruleIndex:0,campaignId:3},{ruleIndex:1,campaignId:2}]})
    const nf=await claim(next.turns[0]);assertOk(nf.r)
    const nfUnit=assertOk(await unit(3,nf.token))
    await db.exec("UPDATE auto_campaigns SET runtime_unit_claimed_at=now()-interval '2 minutes' WHERE id=3")
    assertOk(await settle(3,nfUnit.runtime_unit_token))
    p=await progress(next.turns[0],nf.token);assert.equal(p.processed,1);assert(p.elapsedSeconds>=120);checks+=2
    assert.equal(await scalar("SELECT extra_settings->>'newsfeedTimeMinutes' result FROM auto_campaigns WHERE id=3"),'20');checks++
    assert.equal((await unit(3,nf.token)).reason,'random_budget_exhausted');checks++
    await release(3);await rpc('finish',{turnId:next.turns[0].id,claimToken:nf.token})
    const tl=await claim(next.turns[1]);assertOk(tl.r)
    const tlUnit=assertOk(await unit(2,tl.token));assertOk(await settle(2,tlUnit.runtime_unit_token))
    assert.equal((await progress(next.turns[1],tl.token)).processed,1);checks++
    await release(2);await rpc('finish',{turnId:next.turns[1].id,claimToken:tl.token})
    // Crash recovery retains settled work and fences uncertain external effects.
    await rpc('save',{config:{...config,revision:2,rules:[rule('facebook_group_post',2,'data')]}})
    const recovering=await rpc('plan',{revision:3,choices:[{ruleIndex:0,campaignId:1}]})
    const rc=await claim(recovering.turns[0]);assertOk(rc.r)
    assertOk(await unit(1,rc.token,[3,4]))
    await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=3")
    assertOk(await scalar("SELECT to_jsonb(r) result FROM aka_agent_recover_campaign_runtime_unit_leases(1,'desktop','all') r"))
    assert.equal((await progress(recovering.turns[0],rc.token)).processed,1);checks++
    assert.equal(await scalar("SELECT status result FROM auto_campaign_input_data WHERE id=4"),'hoàn thành');checks++
    await release(1);await rpc('plan',{revision:3,choices:[]})
    assert.equal((await rpc('day',{date:day})).turns.at(-1).status,'stopped');checks++
    await rpc('save',{config:{...config,revision:3,rules:[rule('facebook_newsfeed_interaction',7,'minute')]}})
    const unknown=await rpc('plan',{revision:4,choices:[{ruleIndex:0,campaignId:3}]})
    const uc=await claim(unknown.turns[0]);assertOk(uc.r);assertOk(await unit(3,uc.token))
    assertOk(await scalar("SELECT to_jsonb(r) result FROM aka_agent_recover_campaign_runtime_unit_leases(1,'desktop','all') r"))
    assert.equal(await scalar("SELECT status result FROM auto_campaigns WHERE id=3"),'tạm dừng');checks++
    assert.equal((await progress(unknown.turns[0],uc.token)).processed,0);checks++
    await release(3);await rpc('plan',{revision:4,choices:[]})
    // Simulate next day with no active unit; old plan ends without replay.
    const pending=await rpc('plan',{revision:4,choices:[{ruleIndex:0,campaignId:3}]})
    assert(pending.turns.length)
    await db.exec("UPDATE auto_account_random_run_days SET run_date=run_date-1")
    assert.equal((await rpc('plan',{revision:4,choices:[]})).turns.length,0);checks++
    assert.equal(await scalar("SELECT status result FROM auto_account_random_run_days"),'closed');checks++
    assert.equal(await scalar("SELECT state->'turns'->-1->>'status' result FROM auto_account_random_run_days"),'expired');checks++
    assert.equal(await scalar("SELECT count(*)::int result FROM auto_account_random_run_days"),1);checks++
    // RLS blocks direct history writes for an actual API role.
    await db.exec('SET ROLE anon')
    await assert.rejects(()=>db.exec("SELECT * FROM auto_account_random_run_days"),/permission denied/);checks++
    console.log(JSON.stringify({checks,externalOperations:0}))
  } finally { await db.close() }
}
main().catch(e=>{console.error(e.message,e.where||'');process.exitCode=1})
