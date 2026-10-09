// Actual scheduler + managed writer/settlement + Email repository, offline SQL.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createFixture}=require('./action-status-fixes-fixture.cjs');
const {loader}=require('./action-status-runtime-smoke.cjs');
const {schedulerClass,fixture}=require('./campaign-media-timeout-smoke-test.cjs');
const root=path.resolve(__dirname,'..');
const claim='11111111-1111-1111-1111-111111111111',unit='22222222-2222-2222-2222-222222222222';
let checks=0;
async function desktop(db){
 // Supabase-shaped HTTP adapter executing only against PGlite.
 const client={rpc:async(name,args)=>{
  const types=name.includes('write_')?['bigint','bigint','bigint','uuid','uuid','text','jsonb']:['bigint','bigint','bigint','uuid','uuid','bigint','bigint[]','jsonb','text'];
  const names=name.includes('write_')?['p_staff_id','p_campaign_id','p_account_id','p_claim_token','p_unit_token','p_result_key','p_detail']:['p_staff_id','p_campaign_id','p_account_id','p_claim_token','p_unit_token','p_input_data_id','p_detail_ids','p_input_patch','p_reason'];
  try{return {data:(await db.query(`SELECT ${name}(${types.map((t,i)=>'$'+(i+1)+'::'+t).join(',')}) result`,names.map((n,i)=>types[i]==='jsonb'&&args[n]!=null?JSON.stringify(args[n]):args[n]))).rows[0].result,error:null};}catch(e){return {error:{message:e.message}}}
 },from:table=>{
  const values=[],where=[];let patch,columns='*';
  const q={update:p=>(patch=p,q),eq:(k,v)=>(where.push(`${k}=$${values.push(v)}`),q),is:(k,v)=>(assert.equal(v,null),where.push(`${k} IS NULL`),q),
   in:(k,vs)=>(where.push(`${k}=ANY($${values.push(vs)}::text[])`),q),select:s=>(columns=s,q),maybeSingle:()=>q.then(x=>({...x,data:x.data?.[0]??null})),
   then:async(resolve,reject)=>{try{const sets=Object.entries(patch).map(([k,v])=>`${k}=$${values.push(v)}`);const result=await db.query(`UPDATE ${table} SET ${sets.join(',')} WHERE ${where.join(' AND ')} RETURNING ${columns}`,values);return resolve({data:result.rows,error:null});}catch(e){return resolve({data:null,error:{message:e.message}})}}};return q;
 }};
 const load=loader({'/supabaseClient':{getSupabaseClient:()=>client},'/mappers':{
  mapCampaignDetailFromDB:r=>({...r,id:Number(r.id),policySnapshot:r.policy_snapshot,actionName:r.action_name}),mapCampaignInputDataFromDB:r=>r},
  '/zaloCampaignEngagement':{stageCampaignEngagementSource:()=>{},failCampaignEngagementDetail:()=>{}},
  '/actionStatusPolicyRepository':{loadRunResultCatalog:async()=>{
   const {ActionStatusCatalog}=load(path.join(root,'src/shared/actionStatusPolicy.ts'));
   const statuses=(await db.query('SELECT * FROM auto_status')).rows.map(s=>({id:Number(s.id),code:s.code,name:s.name,statusValue:s.status_value,color:s.color,componentType:s.component_type,platform:s.flatform_type,isActive:s.is_active,isDelete:s.is_delete}));
   const policies=(await db.query('SELECT * FROM auto_account_action_status_policies')).rows.map(p=>({id:Number(p.id),statusId:Number(p.status_id),actionCode:p.action_code,reportGroup:p.report_group,countsTowardLimit:p.counts_toward_limit,badTargetEffect:p.bad_target_effect,resetErrorStreak:p.reset_error_streak,inputEffect:p.input_effect,isActive:p.is_active,isDelete:p.is_delete}));
   const errors=(await db.query('SELECT * FROM auto_error WHERE is_active AND NOT is_delete')).rows.map(e=>[e.error_code,{errorCode:e.error_code,errorType:e.error_type,zaloActionCodes:e.zalo_action_codes,detailMode:e.detail_mode,detailStatusId:e.detail_status_id,inputEffect:e.input_effect,countsTowardLimit:e.counts_toward_limit,countsTowardBadTarget:e.counts_toward_bad_target}]);
   return {actionCodes:new Set((await db.query('SELECT code FROM auto_account_actions')).rows.map(a=>a.code)),statuses,catalog:new ActionStatusCatalog(statuses,policies),errors:new Map(errors)};
  }}});
 const runtime=load(path.join(root,'src/main/services/actionResultRuntime.ts'));
 return {runtime,load,client,write:action=>runtime.writeManagedActionResult(action,{input_data_id:action.inputDataId,action_code:action.actionCode,action_name:action.actionName,status:action.status,error_code:action.errorCode,log:action.log,data:action.data||{}})};
}
async function batchCases(zca){
 for(const scenario of [
  {outcomes:'STTTTS',initial:3,sent:5,count:4},{outcomes:'STT',initial:0,sent:3,count:2},
  {outcomes:'TTSS',initial:0,sent:4,count:0},{outcomes:'TSTTTTSS',initial:0,sent:6,count:4},
  {outcomes:'TTS',initial:0,sent:3,count:0},{outcomes:'FFFFF',initial:0,sent:0,count:3},
  {outcomes:'ST',initial:3,sent:2,count:4,successIgnore:true},
  {outcomes:'STT',initial:3,sent:3,count:0,suppressTimeout:true}
 ])for(const target of ['desktop','server']){
  const db=await createFixture();try{
   const n=scenario.outcomes.length;
   await db.exec(`UPDATE auto_accounts SET id=20 WHERE id=1; UPDATE auto_campaigns SET id=10,account_id=20,status='đang chạy',runtime_unit_input_data_ids=ARRAY[${Array.from({length:n},(_,i)=>100+i)}];
    INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(10,${scenario.initial});`);
   for(let i=0;i<n;i++)await db.exec(`INSERT INTO auto_campaign_input_data(id,campaign_id,name,status) VALUES(${100+i},10,'test','đang chạy')`);
   if(scenario.successIgnore)await db.exec("UPDATE auto_account_action_status_policies SET bad_target_effect='ignore' WHERE status_id=20 AND action_code IS NULL");
   const {runtime,write}=await desktop(db),Scheduler=schedulerClass(zca,{'./actionResultRuntime':runtime});
   const f=fixture(Scheduler,{initial:scenario.initial,threshold:scenario.outcomes[0]==='F'?3:4,target,
    explicit:scenario.suppressTimeout?{errorCode:'campaign_media_timeout',detailStatus:null,countsTowardLimit:false,countsTowardBadTarget:false,disableActionCodes:[]}:null});
   await runtime.beginActionResultRun({campaignId:10,accountId:20,staffId:1,platform:'zalo',claimToken:claim},['zalo_message_group']);runtime.beginActionResultUnit(10,unit,f.rows(n).map(x=>x.detail.id));
   f.db.createCampaignDetail=write;
   f.db.updateCampaignInputData=(id,patch)=>runtime.settleManagedActionInput(id,patch);
   f.db.incrementCampaignBadTargetCount=async(_id,id,reason)=>({countConsecutiveBadTargets:await runtime.settleManagedBadTarget(10,id,reason)});
   f.db.resetCampaignBadTargetCount=async()=>{assert.equal(runtime.defersManagedBadTargetReset(10),true)};
   if(scenario.outcomes[0]==='F'){
    f.scheduler.zaloRuntime.forwardMessageToGroups=async(_id,ids)=>({results:ids.map(threadId=>({threadId,ok:false,errorCode:'114',errorMessage:'failed'}))});
    await f.scheduler.processZaloShareMessageBatch(f.account,f.campaign,f.rows(n),[],{code:'zalo_message_group',name:'Nhắn tin'},'message',[],new Map());
   }else await f.run(scenario.outcomes);
   await runtime.finishActionResultUnit(10);await runtime.finishActionResultUnit(10);
   assert.equal(f.attempts.length,scenario.sent,`${target}/${scenario.outcomes}: sends`);
   const count=(await db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state WHERE campaign_id=10')).rows[0].n;
   assert.equal(count,scenario.count,`${target}/${scenario.outcomes}: count`);
   const first=(await db.query('SELECT id,input_data_id FROM auto_campaign_details ORDER BY id LIMIT 1')).rows[0];
   await db.query('SELECT aka_agent_settle_action_results_v1(1,10,20,$1::uuid,$2::uuid,$3,$4::bigint[],NULL,NULL)',[claim,unit,first.input_data_id,[first.id]]);
   assert.equal((await db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state WHERE campaign_id=10')).rows[0].n,count,'DB receipt replay cannot reset or increment again');checks++;

   assert.equal(Number((await db.query('SELECT count(*) n FROM auto_campaign_details')).rows[0].n),scenario.suppressTimeout?1:scenario.sent||n,'all non-suppressed results persist');checks+=3;
   if(scenario.suppressTimeout)assert.notEqual((await db.query('SELECT status FROM auto_campaign_input_data WHERE id=101')).rows[0].status,'chờ xử lý');
  }finally{await db.close()}
 }
}
async function emailCases(zca){
 const db=await createFixture();try{
  const {runtime,load,write}=await desktop(db),Scheduler=schedulerClass(zca,{'./actionResultRuntime':runtime});
  const f=fixture(Scheduler);f.campaign.id=1;f.campaign.actionId='email_send';f.account.id=1;f.account.flatformType='email';
  const link=load(path.join(root,'src/main/data/repositories/emailTrackingRepository.ts')).linkEmailMessageTrackingToDetail;
  let sends=0;f.scheduler.emailRuntime={checkRecipientExists:async()=>({status:'unknown'}),sendEmail:async()=>{sends++;return {messageId:'fixture'}}};
  f.scheduler.getTemplateBusinessNow=async()=>new Date();f.scheduler.renderZaloTemplate=x=>x;f.scheduler.rewriteEmailPlainTextBodyForRun=async(_a,_c,_o,x)=>x;
  f.db.createCampaignDetail=write;f.db.linkEmailMessageTrackingToDetail=link;
  await runtime.beginActionResultRun({campaignId:1,accountId:1,staffId:1,platform:'email',claimToken:claim},['email_send']);runtime.beginActionResultUnit(1,unit,[1,2]);
  await db.exec('INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(1,3)');
  for(const [id,to] of [[1,'recipient@fixture.invalid'],[2,'']]){
   const result=await f.scheduler.emailSendMessage(f.account,f.campaign,{to,body:'body',subject:'subject'});
   await f.scheduler.logEmailSendMilestones(f.campaign,{id},1,[{id,nodeId:String(id),blockName:'email_send',startedAt:String(id),output:result}]);
   await runtime.settleManagedActionInput(id,{status:'hoàn thành'});
   if(id===1)assert.equal((await db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state')).rows[0].n,0);
  }
  assert.equal(sends,1);const details=(await db.query('SELECT * FROM auto_campaign_details ORDER BY input_data_id')).rows;
  assert.equal(details[0].counts_toward_limit,true);assert.equal(details[1].counts_toward_limit,false);
  assert.equal(Number((await db.query('SELECT count_action_in_day n FROM auto_account_action_status')).rows[0].n),1);checks+=5;
  // Observe before link, then replay link/callback. Main result and decisions stay byte-for-byte.
  await db.exec("CREATE TABLE observed_sub_status(id bigint, sub_id bigint); CREATE FUNCTION observe_sub_status() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO observed_sub_status VALUES(NEW.id,NEW.sub_status_id); RETURN NEW; END $$; CREATE TRIGGER observed_sub AFTER UPDATE OF sub_status_id ON auto_campaign_details FOR EACH ROW WHEN(OLD.sub_status_id IS DISTINCT FROM NEW.sub_status_id) EXECUTE FUNCTION observe_sub_status();");
  const opened=(await db.query("INSERT INTO auto_email_message_trackings(campaign_id,account_id,input_data_id,recipient_email) VALUES(1,1,1,'fixture') RETURNING *")).rows[0];
  await db.query('SELECT * FROM aka_agent_mark_email_open($1)',[opened.open_token]);
  await link(opened.id,details[0].id);await link(opened.id,details[0].id);
  const viewed=(await db.query("SELECT id FROM auto_status WHERE code='campaign_detail_viewed'")).rows[0].id;
  let row=(await db.query('SELECT * FROM auto_campaign_details WHERE id=$1',[details[0].id])).rows[0];assert.equal(row.sub_status_id,viewed);
  const click=(await db.query("INSERT INTO auto_email_link_trackings(message_tracking_id,original_url,link_index) VALUES($1,'https://fixture.invalid',0) RETURNING *",[opened.id])).rows[0];
  await db.query('SELECT * FROM aka_agent_mark_email_click($1)',[click.click_token]);
  await db.query('SELECT * FROM aka_agent_mark_email_open($1)',[opened.open_token]);await link(opened.id,details[0].id);
  row=(await db.query('SELECT * FROM auto_campaign_details WHERE id=$1',[details[0].id])).rows[0];
  assert.deepEqual({...row,sub_status_id:null},details[0]);
  const clicked=(await db.query("SELECT id FROM auto_status WHERE code='campaign_detail_clicked'")).rows[0].id;assert.equal(row.sub_status_id,clicked);
  assert.equal(Number((await db.query('SELECT count(*) n FROM observed_sub_status')).rows[0].n),2);checks+=4;
  // Click before link, including retry, cannot rewrite status or double-fire.
  await db.query('UPDATE auto_email_message_trackings SET campaign_detail_id=NULL WHERE id=$1',[opened.id]);
  await db.query('UPDATE auto_campaign_details SET sub_status_id=NULL WHERE id=$1',[details[0].id]);
  await db.query('SELECT * FROM aka_agent_mark_email_click($1)',[click.click_token]);await link(opened.id,details[0].id);
  row=(await db.query('SELECT * FROM auto_campaign_details WHERE id=$1',[details[0].id])).rows[0];assert.equal(row.sub_status_id,clicked);assert.deepEqual({...row,sub_status_id:null},details[0]);checks+=2;
  // Old details still use the original textual Email transitions.
  const legacy=(await db.query("INSERT INTO auto_campaign_details(campaign_id,account_id,input_data_id,action_code,action_name,status,log) VALUES(1,1,1,'email_send','Email','thành công','unchanged') RETURNING id")).rows[0];
  await link(opened.id,legacy.id);const old=(await db.query('SELECT status,sub_status_id,log FROM auto_campaign_details WHERE id=$1',[legacy.id])).rows[0];assert.equal(old.status,'đã click');assert.equal(old.sub_status_id,null);assert.equal(old.log,'unchanged');checks+=3;
 }finally{await db.close()}
}
async function main(){const zca=await import('zca-js');await batchCases(zca);await emailCases(zca);console.log(JSON.stringify({checks,external_operations:0}));}
module.exports={desktop};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
