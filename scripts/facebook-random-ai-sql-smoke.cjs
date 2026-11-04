// Local PostgreSQL fixture, captured live RPCs/ACLs and real admission helpers.
// No production writes or Facebook/AI calls.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { fixture, root } = require('./facebook-random-run-fixture.cjs')
const dir = path.join(root, 'migrations/snapshots/facebook-random-ai')
const source = JSON.parse(fs.readFileSync(path.join(dir, 'source.json')))
const migration = fs.readFileSync(path.join(root, 'migrations/migration_v444_facebook_random_ai.sql'), 'utf8')
const types = ['facebook_group_post','facebook_timeline_post','facebook_newsfeed_interaction']
const rule = (id,quantity) => ({campaignActionId:id,quantity,unit:id===types[1]?'run':id===types[2]?'minute':'data'})
async function createFixture() {
  const db = await fixture({boundaries:true})
  await db.exec(`CREATE ROLE aka_agent_desktop;
    CREATE TABLE private.aka_agent_desktop_users(auth_user_id uuid PRIMARY KEY,staff_id bigint);
    INSERT INTO private.aka_agent_desktop_users VALUES('11111111-1111-4111-8111-111111111111',1);
    CREATE TABLE ai_model(id bigint PRIMARY KEY,code text,is_active boolean);
    CREATE TABLE ai_prompt(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,code text UNIQUE,name text,prompt_system text,prompt_user text,is_reasoning boolean,is_system boolean,is_active boolean);
    CREATE TABLE ai_using(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,code text UNIQUE,name text,description text,prompt_id bigint,model_id bigint,is_system boolean,is_active boolean,timeout_ms integer,response_parser text,request_options jsonb);
    INSERT INTO ai_model VALUES(21,'openai_campaign_diagnostics_sol61',true);
    GRANT USAGE ON SCHEMA private TO aka_agent_desktop;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO aka_agent_desktop;
  `)
  for (const file of ['scope.json','dependencies.json']) for (const f of JSON.parse(fs.readFileSync(path.join(dir,file)))) await db.exec(f.definition)
  for (const f of source) {
    await db.exec(f.definition)
    await db.exec('REVOKE ALL ON FUNCTION '+f.signature+' FROM PUBLIC,anon,authenticated,service_role,aka_agent_chat_api,aka_agent_desktop')
    for(const role of [...f.proacl.matchAll(/(?:\{|,)([a-z_]+)=/g)].map(m=>m[1])) await db.exec('GRANT EXECUTE ON FUNCTION '+f.signature+' TO '+role)
  }
  // Local PG formatting is checked independently from the production MD5.
  for(const f of source) assert.equal((await db.query('SELECT md5(pg_get_functiondef($1::regprocedure)) checksum',[f.signature])).rows[0].checksum,f.md5)
  return db
}
async function main() {
 const db = await createFixture()
 const scalar = async(sql,args=[]) => (await db.query(sql,args)).rows[0].result
 const rpc = (op,input={},staff=1) => scalar("SELECT aka_agent_facebook_random_run($3,1,'fixture','fixture',1,$1,$2::jsonb) result",[op,JSON.stringify(input),staff])
 const state = () => scalar('SELECT state result FROM auto_account_random_run_days WHERE account_id=1 ORDER BY run_date DESC LIMIT 1')
 let checks=0
 try {
  // Real fail-closed preflight and complete candidate compile inside ROLLBACK.
  await db.exec(migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
  assert.equal(await scalar("SELECT to_regprocedure('private.facebook_random_ai_rules_valid(jsonb,jsonb)') IS NULL result"),true)
  await db.exec(migration)
  const target = (await db.query("SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,md5(pg_get_functiondef(p.oid)) md5,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text FROM pg_proc p WHERE p.oid IN ('aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)'::regprocedure,'private.facebook_random_unit_started(bigint,bigint,uuid)'::regprocedure,'private.facebook_random_ai_rules_valid(jsonb,jsonb)'::regprocedure) ORDER BY 1")).rows
  if(process.env.WRITE_RANDOM_AI_CAPTURE==='1') fs.writeFileSync(path.join(dir,'target.json'),JSON.stringify(target,null,2)+'\n')
  const seedChecksums=(await db.query(`SELECT 'ai_prompt' kind,md5(jsonb_build_array(code,name,prompt_system,prompt_user,is_reasoning,is_system,is_active)::text) md5 FROM ai_prompt WHERE code='app_facebook_random_run_plan'
    UNION ALL SELECT 'ai_using',md5(jsonb_build_array(u.code,u.name,u.description,p.code,u.model_id,u.is_system,u.is_active,u.timeout_ms,u.response_parser,u.request_options)::text) FROM ai_using u JOIN ai_prompt p ON p.id=u.prompt_id WHERE u.code='app_facebook_random_run_plan'`)).rows
  if(process.env.WRITE_RANDOM_AI_CAPTURE==='1') fs.writeFileSync(path.join(dir,'seed-target.json'),JSON.stringify(seedChecksums,null,2)+'\n')
  for(const f of target.filter(f=>!f.signature.includes('rules_valid'))) {
    const before=source.find(s=>s.signature===f.signature)
    for(const key of ['owner','prosecdef','provolatile','proconfig','proacl']) assert.deepEqual(f[key],before[key],f.signature+':'+key)
  }
  // Reapply rejects before any mutation.
  await assert.rejects(db.exec(migration),/source drift/)
  await db.exec('ROLLBACK')
  const date=await scalar("SELECT timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date::text result")
  const context={date,actions:types.map((id,i)=>({...rule(id,1),name:id,waitingCount:i===0?5:0,pausedCount:i===2?99:0}))}
  const config={version:2,mode:'ai',revision:0,rules:[]}
  await rpc('save',{config});await rpc('toggle',{enabled:true,revision:1})
  const acquire=()=>rpc('ai_acquire',{revision:1,requestId:crypto.randomUUID(),context})
  const lease=await acquire()
  assert.equal(lease.owned,true);assert.equal(lease.ai.attempts,1)
  assert.equal((await acquire()).owned,false)
  // Pause/resume before provider finishes invalidates the old lease without losing empty history.
  await rpc('toggle',{enabled:false,revision:1});await rpc('toggle',{enabled:true,revision:1})
  assert.deepEqual((await state()).turns,[])
  assert.equal((await rpc('ai_commit',{...lease,requestId:lease.ai.requestId,revision:1,rules:types.map(id=>rule(id,1))})).ai,null)
  await db.exec("UPDATE auto_account_random_run_days SET state=jsonb_set(state,'{ai,nextAttemptAt}',to_jsonb(now()-interval '1 second'))")
  const lease2=await acquire()
  const rules=[rule(types[0],3),rule(types[0],5),rule(types[0],2),rule(types[2],10),rule(types[1],1)]
  const commit={requestId:lease2.ai.requestId,leaseToken:lease2.leaseToken,revision:1,date,rules}
  for(const bad of [rules.slice(0,-1),[rule('facebook_invalid',3),...rules.slice(1)],rules.map((r,i)=>i===0?{...r,unit:'minute'}:r),rules.map((r,i)=>i===0?{...r,quantity:0}:r),[rules[3],...rules.slice(0,3),rules[4]]]) {
    await assert.rejects(rpc('ai_commit',{...commit,rules:bad}),/random_invalid_ai_rules/);checks++
  }
  assert.equal((await rpc('ai_commit',commit)).ai.status,'ready')
  assert.deepEqual((await rpc('ai_commit',commit)).ai.rules,rules)
  assert.equal((await acquire()).owned,false)
  // Legacy plan never gets AI turns, including already planned rows.
  const plan=(candidateIds=[1])=>rpc('plan',{revision:1,protocol:2,candidateIds})
  assert.deepEqual((await rpc('plan',{revision:1,choices:[{ruleIndex:0,campaignId:1}]})).turns,[])
  assert.equal((await rpc('plan',{revision:1,choices:[]})).enabled,false)
  await db.exec(`INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,schedule,schedule_type,is_delete,extra_settings)
    SELECT i,'Group '||i,'facebook_group_post',1,1,1,'chờ xử lý',now()-interval '1 minute','daily',false,'{}' FROM generate_series(4,7) i;`)
  const ids=[1,4,5,6,7]
  async function consume(turn) {
    const claim=crypto.randomUUID(),unit=crypto.randomUUID()
    // Set a real runtime unit boundary, then invoke the captured admission hook.
    await db.query("UPDATE auto_campaigns SET runtime_claim_token=$2,runtime_unit_token=$3,runtime_unit_claimed_at=now(),runtime_unit_vietnam_date=$4 WHERE id=$1",[turn.campaignId,claim,unit,date])
    await db.query("UPDATE auto_account_random_run_days SET state=jsonb_set(state,ARRAY['turns',$1],(state->'turns'->$1::int)||jsonb_build_object('status','running','claimToken',$2::text)) WHERE account_id=1",[(turn.order-1).toString(),claim])
    await db.query('SELECT private.facebook_random_unit_started($1,1,$2)',[turn.campaignId,unit])
    await db.query('SELECT private.facebook_random_unit_started($1,1,$2)',[turn.campaignId,unit])
    await db.query('UPDATE auto_campaigns SET runtime_unit_token=NULL,runtime_claim_token=NULL WHERE id=$1',[turn.campaignId])
    await rpc('finish',{turnId:turn.id,claimToken:claim})
  }
  // Run an AI turn through public claim -> unit admission -> settle -> release,
  // not just the admission hook. Retry does not mark/charge an extra turn.
  await db.exec('BEGIN')
  const admittedTurn=(await plan([1])).turns[0],claimToken=crypto.randomUUID(),unitToken=crypto.randomUUID()
  assert.deepEqual((await state()).allocation.served,[])
  assert.equal((await rpc('claim',{turnId:admittedTurn.id,campaignId:1,claimToken})).ok,true)
  assert.deepEqual((await state()).allocation.served,[],'parent claim alone does not count as a turn')
  const claimUnit=()=>scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,$2::date,$3::uuid,ARRAY[1::bigint]) r",[claimToken,date,unitToken])
  assert.equal((await claimUnit()).ok,true)
  assert.equal((await claimUnit()).ok,true)
  assert.deepEqual((await state()).allocation.served,[1])
  assert.equal((await plan([1])).turns.length,0,'planner must wait for the active unit')
  await assert.rejects(rpc('finish',{turnId:admittedTurn.id,claimToken}),/random_runtime_still_owned/)
  await db.exec('ROLLBACK')
  // The failed ownership assertion above aborted only the local test transaction.
  // Exercise a complete release in a separate transaction with the same AI plan.
  await db.exec('BEGIN')
  const settledTurn=(await plan([1])).turns[0],settledClaim=crypto.randomUUID(),settledUnit=crypto.randomUUID()
  assert.equal((await rpc('claim',{turnId:settledTurn.id,campaignId:1,claimToken:settledClaim})).ok,true)
  assert.equal((await scalar("SELECT to_jsonb(r) result FROM aka_agent_claim_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,$2::date,$3::uuid,ARRAY[1::bigint]) r",[settledClaim,date,settledUnit])).ok,true)
  await db.exec("UPDATE auto_campaign_input_data SET status='hoàn thành' WHERE id=1")
  assert.equal((await scalar("SELECT to_jsonb(r) result FROM aka_agent_settle_campaign_run_unit_v2(1,1,1,'desktop',$1::uuid,false) r",[settledUnit])).ok,true)
  assert.equal((await scalar("SELECT to_jsonb(r) result FROM aka_agent_cleanup_failed_campaign_runtime(1,1,1,'desktop',$1::uuid,NULL,ARRAY[]::bigint[],'',false,'chờ xử lý','chờ xử lý') r",[settledClaim])).ok,true)
  const settled=await rpc('progress',{turnId:settledTurn.id,claimToken:settledClaim})
  assert.equal(settled.processed,1);assert.deepEqual((await state()).allocation.served,[1])
  assert(!['running','planned'].includes(settled.status))
  assert.equal((await plan([1])).turns[0].coverageRound,2)
  await db.exec('ROLLBACK')
  checks+=16
  // Pre-admission stops must not monopolize a shuffled queue. Exercise both a
  // planned skip and a runtime turn already closed by the real release helper.
  await db.exec('BEGIN')
  await db.query("UPDATE auto_account_random_run_days SET state=jsonb_set(state,'{allocation,queues}',jsonb_build_object($1::text,'[1,4,5]'::jsonb))",[types[0]])
  const skipped=(await plan([1,4,5])).turns[0]
  assert.equal(skipped.campaignId,1)
  await rpc('finish',{turnId:skipped.id,claimToken:null,reason:'Nội dung chưa sẵn sàng'})
  const yielded=(await plan([1,4,5])).turns[0]
  assert.equal(yielded.campaignId,4);assert.equal(yielded.coverageRound,skipped.coverageRound)
  assert.equal(yielded.ruleIndex,1);assert.equal(yielded.quantity,5)
  assert.deepEqual((await state()).allocation.served,[])
  assert.deepEqual((await state()).allocation.queues[types[0]],[4,5,1])
  assert.equal((await plan([1,4,5])).turns[0].id,yielded.id,'another Desktop/retry retains the same planned turn')
  const stoppedClaim=crypto.randomUUID()
  await db.query("UPDATE auto_account_random_run_days SET state=jsonb_set(state,ARRAY['turns',$1],(state->'turns'->$1::int)||jsonb_build_object('status','running','claimToken',$2::text)) WHERE account_id=1",[(yielded.order-1).toString(),stoppedClaim])
  await db.query('SELECT private.facebook_random_finalize_turn($1,1,$2,NULL,false)',[yielded.campaignId,stoppedClaim])
  assert.equal((await rpc('finish',{turnId:yielded.id,claimToken:stoppedClaim})).status,'stopped')
  const afterRelease=(await plan([1,4,5])).turns[0]
  assert.equal(afterRelease.campaignId,5);assert.equal(afterRelease.quantity,2)
  assert.deepEqual((await state()).allocation.served,[])
  assert.deepEqual((await state()).allocation.queues[types[0]],[5,1,4])
  await consume(afterRelease)
  const retrySkipped=(await plan([1,4,5])).turns[0]
  assert.equal(retrySkipped.campaignId,1);assert.equal(retrySkipped.coverageRound,1)
  assert.deepEqual((await state()).allocation.served,[5])
  await db.exec('ROLLBACK')
  checks+=15
  const turns=[]
  for(let i=0;i<5;i++){
    const turn=(await plan(ids)).turns[0];assert.ok(turn)
    assert.equal(turn.coverageRound,1);turns.push(turn)
    assert.equal((await state()).allocation.served.length,i)
    await consume(turn)
  }
  assert.equal(new Set(turns.map(t=>t.campaignId)).size,5)
  assert.deepEqual(turns.map(t=>t.quantity),[3,5,2,3,5])
  assert.equal((await state()).allocation.cursor,2)
  const next=(await plan(ids)).turns[0]
  assert.equal(next.coverageRound,2);assert.equal(next.quantity,2);assert.equal(next.ruleIndex,2)
  assert.deepEqual((await rpc('plan',{revision:1,choices:[]})).turns,[])
  await consume(next)
  // New/resumed reserve campaign uses the saved AI sequence, no new AI call.
  const before=(await state()).allocation.served.slice()
  const reserve=(await plan([3,...ids])).turns[0]
  assert.equal(reserve.campaignId,3);assert.equal(reserve.quantity,10);assert.equal(reserve.ruleIndex,3)
  await consume(reserve)
  assert.deepEqual((await state()).allocation.served,[...before,3])
  assert.equal((await rpc('ai_status')).ai.attempts,2)
  const day=await rpc('day',{date})
  assert.equal(day.ai.leaseToken,undefined);assert.equal(day.allocation.queues,undefined);assert.equal(day.allocation.servedCount,2)
  // Paused entries leave the queue, resume at its tail, and never erase served markers.
  await db.exec('BEGIN')
  const groupQueue=(await state()).allocation.queues[types[0]],paused=groupQueue.find(id=>!before.includes(id))
  await db.query("UPDATE auto_campaigns SET status='tạm dừng' WHERE id=$1",[paused])
  const duringPause=(await plan(ids)).turns[0]
  assert.notEqual(duringPause.campaignId,paused);await consume(duringPause)
  assert(!(await state()).allocation.queues[types[0]].includes(paused))
  await db.query("UPDATE auto_campaigns SET status='chờ xử lý' WHERE id=$1",[paused])
  const afterResume=(await plan(ids)).turns[0]
  assert.equal((await state()).allocation.queues[types[0]].at(-1),paused)
  assert((await state()).allocation.served.includes(next.campaignId))
  // Skipped before admission does not count as served; delete/future/cutoff are DB rechecked.
  const servedBefore=(await state()).allocation.served
  await rpc('finish',{turnId:afterResume.id,claimToken:null,reason:'Chưa đến giờ'})
  assert.deepEqual((await state()).allocation.served,servedBefore)
  await db.query("UPDATE auto_campaigns SET schedule=now()+interval '1 day' WHERE id=$1",[afterResume.campaignId])
  const noFuture=await plan([afterResume.campaignId]);assert.equal(noFuture.turns.length,0)
  await db.exec('ROLLBACK')
  // Exact mixed sequence and uneven groups: duplicates keep distinct 5/7 and 3/5/2.
  await db.exec('BEGIN')
  await db.exec(`INSERT INTO auto_campaign_actions(id,name,flatform_type,is_active,is_delete) VALUES('facebook_message_uid','Message','facebook',true,false);
    INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,schedule,schedule_type,is_delete,extra_settings)
    SELECT i,'Message '||i,'facebook_message_uid',1,1,1,'chờ xử lý',now()-interval '1 minute','daily',false,'{}' FROM generate_series(20,21) i;
    UPDATE auto_account_random_run_days SET state=state-'ai'-'allocation';`)
  const mixContext={date,actions:[...context.actions.map(a=>({...a,waitingCount:a.campaignActionId===types[1]?0:1})),{campaignActionId:'facebook_message_uid',name:'Message',unit:'data',waitingCount:2,pausedCount:0}]}
  const mixRules=[rule('facebook_message_uid',5),rule(types[0],3),rule(types[2],10),rule(types[0],5),rule('facebook_message_uid',7),rule(types[0],2),rule(types[1],1)]
  const mixLease=await rpc('ai_acquire',{revision:1,requestId:crypto.randomUUID(),context:mixContext})
  await rpc('ai_commit',{requestId:mixLease.ai.requestId,leaseToken:mixLease.leaseToken,revision:1,date,rules:mixRules})
  const mixTurns=[]
  for(let i=0;i<8;i++){const t=(await plan([20,21,3,...ids])).turns[0];mixTurns.push(t);await consume(t)}
  assert.deepEqual(mixTurns.slice(0,6).map(t=>[t.campaignActionId,t.quantity]),mixRules.slice(0,6).map(r=>[r.campaignActionId,r.quantity]))
  assert.equal(new Set(mixTurns.map(t=>t.campaignId)).size,8)
  assert(mixTurns.every(t=>t.coverageRound===1))
  // New action after plan is not admitted. Current catalog revocation is immediate.
  await db.exec("INSERT INTO auto_campaign_actions(id,name,flatform_type,is_active,is_delete) VALUES('facebook_new','New','facebook',true,false); UPDATE auto_campaigns SET action_id='facebook_new' WHERE id=7")
  assert.equal((await plan([7])).turns.length,0)
  await db.exec("UPDATE auto_campaign_actions SET is_active=false WHERE id='facebook_group_post'")
  assert.equal((await plan([1])).turns.length,0)
  await db.exec('ROLLBACK')
  // Day rollover closes history and does not reuse yesterday's AI plan.
  await db.exec('BEGIN')
  await db.exec("UPDATE auto_account_random_run_days SET run_date=run_date-1")
  assert.equal((await rpc('ai_status')).canAttempt,true)
  assert.equal((await plan(ids)).turns.length,0)
  assert.equal(await scalar("SELECT status result FROM auto_account_random_run_days LIMIT 1"),'closed')
  await db.exec('ROLLBACK')
  // Manual mode preserves the successful daily plan and progress.
  await rpc('save',{config:{version:2,mode:'manual',revision:1,rules:[rule(types[0],4)]}})
  await rpc('plan',{revision:2,choices:[{ruleIndex:0,campaignId:1}]})
  assert.deepEqual((await state()).ai.rules,rules)
  await rpc('save',{config:{...config,revision:2}})
  assert.equal((await rpc('ai_status')).ai.status,'ready')
  // Role ACLs remain closed and request ownership rejects cross-staff calls.
  for(const role of ['anon','authenticated','aka_agent_chat_api']){
    await db.exec('SET ROLE '+role)
    await assert.rejects(rpc('get'),/permission denied/)
    await db.exec('RESET ROLE');checks++
  }
  await db.exec(`SET ROLE aka_agent_desktop; SET request.jwt.claims='{"role":"aka_agent_desktop","sub":"11111111-1111-4111-8111-111111111111"}'`)
  assert.equal((await rpc('get')).config.mode,'ai')
  await assert.rejects(rpc('ai_status',{},2),/desktop_staff_scope_denied/)
  await db.exec('RESET ROLE')
  // Persisted retry deadlines: initial call + two retries; manual reset only after failure.
  await db.exec("UPDATE auto_account_random_run_days SET state=state-'ai'-'allocation'; UPDATE auto_accounts SET facebook_random_run_config=jsonb_set(facebook_random_run_config,'{revision}','1')")
  for(let attempt=1;attempt<=3;attempt++){
    const l=await acquire();assert.equal(l.ai.attempts,attempt)
    await rpc('ai_fail',{requestId:l.ai.requestId,leaseToken:l.leaseToken,date})
    const status=await rpc('ai_status');assert.equal(status.canAttempt,false)
    if(attempt<3){
      const seconds=await scalar("SELECT extract(epoch FROM (state->'ai'->>'nextAttemptAt')::timestamptz-clock_timestamp()) result FROM auto_account_random_run_days")
      assert(seconds>(attempt===1?55:295))
      await db.exec("UPDATE auto_account_random_run_days SET state=jsonb_set(state,'{ai,nextAttemptAt}',to_jsonb(now()-interval '1 second'))")
    }else assert.equal(status.ai.status,'failed')
  }
  assert.equal((await acquire()).owned,false)
  await rpc('ai_retry');assert.equal((await acquire()).ai.attempts,1)
  // No eligible campaigns means the scheduler may not call ai_status. The read
  // endpoint must still report an expired lease, without writing or retrying AI.
  await db.exec('BEGIN')
  assert.equal((await rpc('day',{date})).ai.status,'generating')
  await db.exec("UPDATE auto_campaigns SET status='tạm dừng'")
  const expiredAt=await scalar("SELECT (clock_timestamp()-interval '10 seconds')::text result")
  for(let attempt=1;attempt<=3;attempt++){
    await db.query("UPDATE auto_account_random_run_days SET state=jsonb_set(state,'{ai}',(state->'ai')||jsonb_build_object('attempts',$1::int,'leaseUntil',$2::text))",[attempt,expiredAt])
    const stored=await state(),view=await rpc('day',{date})
    assert.equal(view.ai.status,attempt===3?'failed':'retry_wait','expired AI lease must not stay generating in progress')
    assert.equal(view.canRetryAi,attempt===3)
    assert.equal(view.ai.leaseToken,undefined);assert.equal(view.ai.leaseUntil,undefined)
    if(attempt<3)assert.equal(Date.parse(view.ai.nextAttemptAt)-Date.parse(expiredAt),attempt===1?60_000:300_000)
    assert.deepEqual(await state(),stored,'Refresh must not write state or consume retry attempts')
    checks+=5
  }
  assert.equal((await rpc('ai_retry')).ai.attempts,0)
  const yesterday=await scalar("SELECT (timezone('Asia/Ho_Chi_Minh',clock_timestamp())::date-1)::text result")
  await db.exec("UPDATE auto_account_random_run_days SET run_date=run_date-1")
  const historicalState=await state(),historical=await rpc('day',{date:yesterday})
  assert.equal(historical.ai.status,'failed');assert.equal(historical.canRetryAi,false)
  assert.deepEqual(await state(),historicalState)
  await db.exec('ROLLBACK')
  checks+=4
  const postcheck=fs.readFileSync(path.join(root,'migrations/tests/migration_v444_facebook_random_ai_postcheck.sql'),'utf8')
  await db.exec(postcheck)
  const rollback=fs.readFileSync(path.join(root,'migrations/tests/migration_v444_facebook_random_ai_rollback.sql'),'utf8')
  await assert.rejects(db.exec(rollback),/v2 configurations still exist/);await db.exec('ROLLBACK')
  await rpc('toggle',{enabled:false,revision:1})
  await rpc('save',{config:{version:1,revision:1,rules:[rule(types[0],3)]}})
  await db.exec(rollback)
  for(const f of source) assert.equal((await db.query('SELECT md5(pg_get_functiondef($1::regprocedure)) checksum',[f.signature])).rows[0].checksum,f.md5)
  assert.equal(await scalar("SELECT count(*)::integer result FROM ai_using WHERE code='app_facebook_random_run_plan'"),0)
  console.log(JSON.stringify({checks:checks+52,sourceChecksums:source.length,aclPreserved:true,rollbackTrial:true,productionWrites:0}))
 }finally{await db.close()}
}
module.exports={createFixture}
if(require.main===module)main().catch(e=>{console.error({message:e.message,position:e.position,internalQuery:e.internalQuery,where:e.where,stack:e.stack});process.exitCode=1})
