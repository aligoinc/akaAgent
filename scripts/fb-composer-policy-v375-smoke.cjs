// Full captured live workflow graphs and unchanged app runtime; offline only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript')
const {harness}=require('./action-status-mixed-output-smoke.cjs')
const v=require('./fb-composer-policy-v375.cjs'),before=v.backup(),changes=v.desired()
const root=path.resolve(__dirname,'..'),clean=x=>JSON.parse(JSON.stringify(x))
const compile=(file,stubs={})=>{const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(k=>stubs[k]??require(k),m,m.exports);return m.exports}
const {BlockExecutor}=compile('src/main/v2/runtime/blockExecutor.ts',{'./blockHelpers':{createBlockHelpers:(log,h,meta)=>({log,...h,visit:()=>h.visit(meta.nodeId)})}})
let blocks=new Map()
const {WorkflowEngineV2}=compile('src/main/v2/runtime/workflowEngine.ts',{'./blockExecutor':{BlockExecutor},'../../data/repositories/blockRepository':{getBlock:async id=>blocks.get(id)},'../../data/repositories/workflowV2Repository':{},'../../data/repositories/runV2Repository':{}})
const {FacebookCampaignPageIdentity,assertPageIdentityWorkflow}=compile('src/main/services/facebookCampaignPageIdentity.ts')
const claim='11111111-1111-1111-1111-111111111111',unit='22222222-2222-2222-2222-222222222222'
let scenarios=0
const forbidden=['sleep1','sleep_after_open','select_group_share_targets','compose_formatted_content','type_content','drop_images','click_post','verify_submit','get_post_link','detect_pending','comment','leave_group','join_group']
function environment(id,options={}){
 const original=before.tables.auto_workflows.rows.find(x=>x.row.id===id).row
 const patch=changes.find(r=>r.table==='auto_workflows'&&r.id===id).fields
 const workflow={...clean(original),...(!options.baseline?clean(patch):{}),defaultVariables:original.default_variables}
 const stats={visited:[],clicks:[],switches:[],activeIdentity:'Profile',waits:[]},abort=new AbortController()
 blocks=new Map(before.tables.auto_blocks.rows.map(({row:b})=>{
  let code='helpers.visit(); return {}'
  if(b.id===27)code=options.baseline?b.code:changes[0].fields.code
  if(b.id===20||b.id===2829)code=b.code
  if(b.id===2670)code="vars.originalIdentityName='Profile'; return {ok:true,identityName:'Profile'}"
  if(b.id===2671)code="return await helpers.identity(input.useOriginalIdentity === true)"
  if(b.id===2624)code='helpers.visit(); vars.groupPostSubmitted=true;return {posted:true}'
  if(b.id===30)code='helpers.visit();return {posted:true}'
  if(b.id===31)code='helpers.visit();vars.groupPostIsPending=false;return {isPending:false,pendingCheckConclusive:true}'
  if(b.id===2794)code='helpers.visit();return {selectedTargets:[]}'
  return [b.id,{...b,code}]
 }))
 const page={isConnected:()=>true,waitForSelector:async selector=>{
  stats.waits.push(selector)
  if(options.stage==='abort'){abort.abort();throw new Error('waitForSelector timeout: '+selector)}
  if(options.stage===selector)throw new Error('waitForSelector timeout: '+selector)
  if(options.stage==='other')throw new Error('Unrelated failure')
 },click:async selector=>{stats.clicks.push(selector);if(options.stage==='click')throw new Error('click failed')}}
 const helpers={visit:id=>stats.visited.push(id),sleep:async()=>{},element:async key=>{
  if(options.stage==='config')throw new Error('element config missing')
  return key==='fb_composer_button'?'button':'dialog'
 },identity:async restore=>{
  stats.switches.push(restore);if(restore&&options.restoreFails)throw new Error('restore failed')
  stats.activeIdentity=restore?'Profile':'Page A';return {ok:true,identityName:stats.activeIdentity}
 }}
 const vars={inputDataId:1,enableComment:true,commentIterations:[{}],autoJoinGroupAfterPost:true,
  runAsPage:options.asPage===true,runAsPageName:'Page A',copyContentFromSource:false,...options.vars}
 const session=options.asPage&&!options.editor?new FacebookCampaignPageIdentity({id:1,accountId:1,extraSettings:{runAsPageUid:'fixture',runAsPageName:'Page A'}},workflow):null
 if(session)session.page=page
 if([1,252].includes(id))assertPageIdentityWorkflow(workflow)
 const engine=new WorkflowEngineV2()
 return {workflow,stats,abort,page,helpers,session,async run(boundary){
  return engine.run(workflow,{...vars,...session?.variables()},page,{persist:false,signal:abort.signal,runtimeHelpers:helpers,
   onStepProgress:s=>{session?.observe(s);boundary?.observe(s)}})
 },async restore(){if(session)await session.restore(engine.run.bind(engine),{persist:false,runtimeHelpers:helpers})}}
}
async function graphTests(){
 for(const id of [1,2,251,252]){
  for(const stage of ['button','dialog']){
   const env=environment(id,{stage}),r=await env.run();assert.equal(r.status,'completed',r.error)
   const output=r.steps.find(s=>s.nodeId==='open_composer').output
   assert.equal(output.opened,false);assert.equal(output.actionResult.inputDataId,1)
   assert.equal(output.actionResult.errorCode,v.errorCode);assert.equal(output.actionResult.message,v.notice)
   assert.equal(output.actionResult.operationState,'not_committed')
   assert.equal(output.actionResult.data.error,'waitForSelector timeout: '+stage)
   for(const name of forbidden)assert(!env.stats.visited.includes(name),`${id}/${stage} must not run ${name}`)
   assert.equal(r.steps.find(s=>s.nodeId==='click_post').status,'skipped');scenarios++
  }
  const original=environment(id,{baseline:true});await original.run()
  const patched=environment(id);await patched.run()
  assert.deepEqual(patched.stats,original.stats,`${id} success keeps existing operations and order`);scenarios++
 }
 for(const id of [1,252])for(const editor of [false,true]){
  const env=environment(id,{stage:'button',asPage:true,editor}),r=await env.run()
  assert.equal(r.status,'completed',r.error)
  assert.equal(r.steps.find(s=>s.nodeId==='page_identity_capture_result').status,'success')
  if(!editor){assert.equal(env.session.targetStarted,true);assert.equal(env.stats.activeIdentity,'Page A');await env.restore()}
  assert.equal(env.stats.activeIdentity,'Profile');assert.deepEqual(env.stats.switches,[false,true])
  for(const name of forbidden)assert(!env.stats.visited.includes(name));scenarios++
 }
 for(const stage of ['click','config','other','abort']){
  const e=environment(1,{stage}),r=await e.run();assert.notEqual(r.status,'completed')
  assert(!r.steps.some(s=>s.output?.actionResult));assert(!e.stats.visited.includes('click_post'));scenarios++
 }
 for(const vars of [{postAsReels:true},{sharePost:true,sourceLink:'fixture'}]){
  const before=environment(2,{baseline:true,vars});await before.run()
  const after=environment(2,{vars});const r=await after.run()
  assert.deepEqual(after.stats,before.stats);assert.equal(r.steps.find(s=>s.nodeId==='open_composer').status,'skipped');scenarios++
 }
 const skipped=environment(1,{vars:{skipGroupPostByKnownApproval:true}}),r=await skipped.run()
 assert.equal(r.steps.find(s=>s.nodeId==='open_composer').status,'skipped');assert(!r.steps.some(s=>s.output?.actionResult));scenarios++
}
async function managed(zca,{id=1,batch=false,asPage=false,stage='button',inputEffect=null,noInput=false}={}){
 const group=[1,252].includes(id),f=await harness(zca,group?'facebook_group_post':'facebook_timeline_post')
 try{
  const p=(await f.db.query("UPDATE auto_error SET detail_mode='inherit',noti_running_process=$1,noti_campaign=$1,input_effect=$2 WHERE error_code=$3 RETURNING *",[v.notice,inputEffect,v.errorCode])).rows[0]
  const policy=Object.fromEntries(Object.entries(p).map(([k,value])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),value]))
  const codes=[],effects=[]
  f.scheduler.supabase.getErrorPolicy=async code=>{codes.push(code);assert.equal(code,v.errorCode);return policy}
  f.scheduler.supabase.getAccount=async()=>f.account
  f.scheduler.updateErrorPolicyAccount=async()=>{throw new Error('unexpected account mutation')}
  const env=environment(id,{stage,asPage,...(noInput?{vars:{inputDataId:undefined}}:{})})
  f.scheduler.updateErrorPolicyCampaign=async(_,patch)=>{await env.restore();effects.push(patch);
   await f.db.query('UPDATE auto_campaigns SET status=$1 WHERE id=1',[patch.status]);Object.assign(f.campaign,patch)}
  await f.db.exec('INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(1,3)')
  await f.runtime.beginActionResultRun({campaignId:1,accountId:1,staffId:1,platform:'facebook',claimToken:claim},[group?'fb_post_group':'fb_post_my_profile'])
  if(noInput)await f.db.exec("UPDATE auto_campaigns SET runtime_unit_input_data_ids='{}'::bigint[] WHERE id=1")
  f.runtime.beginActionResultUnit(1,unit,noInput?[]:batch?[1,2]:[1])
  const boundary=new f.runtime.ActionResultBoundary(1,()=>env.abort.abort()),run=await env.run(boundary)
  assert.equal(boundary.error,undefined);assert.equal(run.status,'completed')
  const finalize=steps=>f.scheduler.logMilestonesV2(f.campaign,noInput?null:f.input,1,steps,true)
  const summary=await finalize(clean(run.steps));if(noInput)await f.runtime.finishActionResultUnit(1);else await f.finish()
  const policyResult=await f.scheduler.finalizeExplicitResultPolicies(f.account,f.campaign,noInput?null:1,summary,{targetCounter:{},campaignDecision:{paused:false}})
  assert.equal(policyResult.triggered,true);assert.equal(f.campaign.status,'chờ xử lý');assert.equal(f.campaign.note,v.notice)
  await finalize(clean(run.steps));await f.scheduler.finalizeExplicitResultPolicies(f.account,f.campaign,noInput?null:1,summary,{targetCounter:{}})
  const rows=await f.details();assert.equal(rows.length,1);assert.equal(rows[0].input_data_id,noInput?null:1)
  assert.equal(rows[0].status,'lỗi');assert.equal(rows[0].report_group,'failure');assert.equal(rows[0].error_code,v.errorCode)
  assert.equal(rows[0].log,v.notice);assert.equal(rows[0].counts_toward_limit,false);assert.equal(await f.quota(),0)
  assert.equal(rows[0].policy_snapshot.badTargetEffect,'ignore');assert.equal(rows[0].data.stage,'composer_'+stage)
  assert.equal(effects.length,1,'error policy must not repeat on finalization/replay')
  assert.equal((await f.db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state')).rows[0].n,3)
  const inputs=(await f.db.query('SELECT id,status FROM auto_campaign_input_data ORDER BY id')).rows
  if(!noInput)assert.equal(inputs[0].status,inputEffect==='requeue'?'chờ xử lý':'hoàn thành')
  if(batch){assert.equal(f.runtime.managedTargetEffects(1,2),null);assert.equal(inputs[1].status,'đang chạy','untouched secondary stays for the existing run-unit settlement')}
  if(asPage){assert.equal(env.stats.activeIdentity,'Profile');assert.deepEqual(env.stats.switches,[false,true])}
  assert(f.logs.every(x=>!x.includes('waitForSelector timeout:')));scenarios++
 }finally{await f.close()}
}
async function main(){
 await graphTests();const zca=await import('zca-js')
 for(const id of [1,2,251,252])await managed(zca,{id})
 for(const stage of ['button','dialog'])await managed(zca,{id:1,batch:true,asPage:true,stage})
 await managed(zca,{id:1,batch:true,inputEffect:'requeue'})
 await managed(zca,{id:2,noInput:true})
 // App files that added thrown-result transport are back at their pre-v374
 // hashes. The scheduler exactly matches the pre-composer approved-status work.
 const crypto=require('crypto'),receipt=v.read('runtime-revert.json')
 for(const [file,hash] of Object.entries(receipt.sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),hash)
 console.log(JSON.stringify({scenarios,live_workflow_graphs:4,runtime_changes_required:0,external_operations:0}))
}
module.exports={main,environment}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
