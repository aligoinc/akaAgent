// Local SQL + real runtime adapters. No external actions or production writes.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict'),ts=require('typescript');
const {createFixture,config}=require('./action-status-writer-smoke.cjs');
const root=path.resolve(__dirname,'..'),chat=path.resolve(root,'../akaAgentChatApi');
const {Kysely,PGliteDialect}=require(path.join(chat,'node_modules/kysely'));
const claim='11111111-1111-1111-1111-111111111111',unit='22222222-2222-2222-2222-222222222222';
function loader(stubs={}) {
 const cache=new Map();
 return function load(file){
  file=path.resolve(file); if(cache.has(file))return cache.get(file).exports;
  const mod={exports:{}};cache.set(file,mod);
  const req=name=>{
   for(const [suffix,value]of Object.entries(stubs))if(name.endsWith(suffix))return value;
   if(!name.startsWith('.'))return require(name==='kysely'?path.join(chat,'node_modules/kysely'):name);
   let p=path.resolve(path.dirname(file),name);if(p.endsWith('.js'))p=p.slice(0,-3)+'.ts';else if(!path.extname(p))p+='.ts';return load(p);
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
   {exports:mod.exports,module:mod,require:req,console,Map,Set,Array,Number,Object,JSON,Error,Date,Promise,SetTimeout:setTimeout},{filename:file});return mod.exports;
 };
}
async function main(){let checks=0;
 for(const platform of ['desktop','chat']) {
  const db=await createFixture(); const database=new Kysely({dialect:new PGliteDialect({pglite:db})});
  await db.exec("INSERT INTO auto_campaign_input_data(id,campaign_id,name,status) VALUES(3,1,'suppressed','đang chạy'),(4,1,'mixed','đang chạy'),(5,1,'no input effect','đang chạy'); UPDATE auto_campaigns SET runtime_unit_input_data_ids=ARRAY[1,2,3,4,5] WHERE id=1; UPDATE auto_error SET is_active=true,is_delete=false,detail_mode='suppress',input_effect='requeue' WHERE error_code='err_undefined'; UPDATE auto_account_action_status_policies SET input_effect='none' WHERE status_id=20 AND action_code IS NULL;");
  let calls=0;let runtime,begin,write,effects,input,finish;
  if(platform==='chat') {
   const {CampaignActionResults}=loader()(path.join(chat,'packages/database/src/campaignActionResults.ts'));
   runtime=new CampaignActionResults(database);
   const campaign={campaignId:'1',accountId:'1',staffId:'1',organizationId:'1'};
   await runtime.begin(campaign,claim,['zalo_add_friend']);
   begin=()=>runtime.withUnit(campaign,unit,['1','2','3','4','5'],()=>undefined);
   write=(status,data={},id='1',errorCode)=>runtime.write({campaign,inputDataId:id,actionCode:'zalo_add_friend',actionName:'Kết bạn',status,log:'existing log',data,errorCode});
   effects=id=>runtime.effects('1',id); input=(id,patch)=>runtime.input(id,patch);finish=()=>runtime.finish('1');
  } else {
   const load=loader({'/supabaseClient':{getSupabaseClient:()=>({rpc:async(name,args)=>{
    calls++;try {const values=Object.values(args);const types=name.includes('write_')?['bigint','bigint','bigint','uuid','uuid','text','jsonb']:['bigint','bigint','bigint','uuid','uuid','bigint','bigint[]','jsonb','text'];
     // Scope object inserts account last when overridden, but keeps key order.
     const names=name.includes('write_')?['p_staff_id','p_campaign_id','p_account_id','p_claim_token','p_unit_token','p_result_key','p_detail']:['p_staff_id','p_campaign_id','p_account_id','p_claim_token','p_unit_token','p_input_data_id','p_detail_ids','p_input_patch','p_reason'];
     const result=await db.query(`SELECT ${name}(${types.map((t,i)=>'$'+(i+1)+'::'+t).join(',')}) result`,names.map((n,i)=>types[i]==='jsonb'&&args[n]!=null?JSON.stringify(args[n]):args[n]));return {data:result.rows[0].result,error:null};
    }catch(error){return {data:null,error:{message:error.message}}}
   }})},'/mappers':{mapCampaignDetailFromDB:r=>({id:r.id,policySnapshot:r.policy_snapshot}),mapCampaignInputDataFromDB:r=>r},
   '/zaloCampaignEngagement':{stageCampaignEngagementSource:()=>{},failCampaignEngagementDetail:()=>{}},
   '/actionStatusPolicyRepository':{loadRunResultCatalog:async()=>{
    const {ActionStatusCatalog}=load(path.join(root,'src/shared/actionStatusPolicy.ts'));
    const statuses=(await db.query('SELECT * FROM auto_status')).rows.map(s=>({id:Number(s.id),code:s.code,name:s.name,statusValue:s.status_value,color:s.color,componentType:s.component_type,platform:s.flatform_type,isActive:s.is_active,isDelete:s.is_delete}));
    const policies=(await db.query('SELECT * FROM auto_account_action_status_policies')).rows.map(p=>({id:Number(p.id),statusId:Number(p.status_id),actionCode:p.action_code,reportGroup:p.report_group,countsTowardLimit:p.counts_toward_limit,badTargetEffect:p.bad_target_effect,resetErrorStreak:p.reset_error_streak,inputEffect:p.input_effect,isActive:p.is_active,isDelete:p.is_delete}));
    return {actionCodes:new Set(config.tables.auto_account_actions.rows.map(x=>x.row.code)),statuses,catalog:new ActionStatusCatalog(statuses,policies),errors:new Map([['err_undefined',{errorCode:'err_undefined',errorType:'system',zaloActionCodes:[],detailMode:'suppress',inputEffect:'requeue',countsTowardLimit:false,countsTowardBadTarget:false}]])};
   }}});
   runtime=load(path.join(root,'src/main/services/actionResultRuntime.ts'));
   await runtime.beginActionResultRun({campaignId:1,accountId:1,staffId:1,platform:'facebook',claimToken:claim},['fb_add_friend']);
   runtime.validateActionResultStep(1,{statusCode:'legacy_raw_code'});
   assert.throws(()=>runtime.validateActionResultStep(1,{actionResult:{actionCode:'fb_add_friend',statusCode:'missing',operationState:'committed'}}),/status_unknown/);checks++;
   begin=()=>runtime.beginActionResultUnit(1,unit,[1,2,3,4,5]);
   write=(status,data={},id='1',errorCode)=>runtime.writeManagedActionResult({campaignId:1,accountId:1,inputDataId:Number(id),actionCode:'fb_add_friend',data,errorCode,resultGuards:{operationState:data.deliveryUncertain?'unknown':undefined}}, {input_data_id:Number(id),action_code:'fb_add_friend',action_name:'Kết bạn',status,log:'existing log',data});
   effects=id=>runtime.managedTargetEffects(1,Number(id));input=(id,patch)=>runtime.settleManagedActionInput(Number(id),patch);finish=()=>runtime.finishActionResultUnit(1);
  }
  begin();
  await db.exec('INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(1,5)');
  await write('đã là bạn bè');assert.equal(effects('1').badTargetEffect,'ignore');checks++;
  await input('1',{status:'hoàn thành',note:'existing note'});
  assert.equal((await db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state')).rows[0].n,5);checks++;
  await assert.rejects(()=>write('thành công'),/target_settled/);checks++;
  await write('thành công',{},'2');await write('thất bại',{},'2');
  assert.equal(effects('2').badTargetEffect,'increment');checks++;
  await input('2',{status:'hoàn thành',note:'existing failure'});await finish();await finish();
  assert.equal((await db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state')).rows[0].n,6);checks++;
  assert.equal((await db.query('SELECT count(*) n FROM auto_campaign_details')).rows[0].n,3);checks++;
  await write('lỗi',{deliveryUncertain:true},'3','err_undefined');
  await input('3',{status:'hoàn thành',note:'unchanged observation'});
  assert.equal((await db.query('SELECT status FROM auto_campaign_input_data WHERE id=3')).rows[0].status,'tạm dừng');checks++;
  await write('thành công',{},'4');await write('lỗi',{},'4','err_undefined');
  await input('4',{status:'hoàn thành'});await finish();
  assert.equal((await db.query('SELECT status FROM auto_campaign_input_data WHERE id=4')).rows[0].status,'tạm dừng');checks++;
  assert.equal((await db.query('SELECT count(*) n FROM auto_campaign_details')).rows[0].n,4);checks++;
  await write('thành công',{},'5');await input('5',{status:'hoàn thành'});await finish();
  assert.equal((await db.query('SELECT status FROM auto_campaign_input_data WHERE id=5')).rows[0].status,'tạm dừng');checks++;
  await database.destroy();
 }
 const load=loader();const {ActionStatusCatalog}=load(path.join(root,'src/shared/actionStatusPolicy.ts'));
 const {ActionResultSession}=load(path.join(root,'src/shared/actionResultSession.ts'));
 const session=new ActionResultSession(new ActionStatusCatalog([{id:1,code:'ok',name:'OK',statusValue:'ok',color:null,componentType:'campaign_detail',platform:'all',isActive:true,isDelete:false}],
 [{id:1,statusId:1,actionCode:null,reportGroup:'success',countsTowardLimit:true,badTargetEffect:'reset',resetErrorStreak:true,inputEffect:'complete',isActive:true,isDelete:false}]),'test');
 const output={actionCode:'new_action',statusCode:'ok',operationState:'committed'};
 const first=session.prepare('1',output,null),retry=session.prepare('1',output,null);
 assert.equal(first.key,retry.key);session.record('1',retry.key,'1',retry.effective);
 assert.notEqual(session.prepare('1',output,null).key,first.key);checks++;
 console.log(JSON.stringify({checks,runtimes:['desktop','chat'],external_operations:0}));
}
module.exports={loader};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
