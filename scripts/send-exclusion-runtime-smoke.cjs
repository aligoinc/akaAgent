const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),contract={}
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
for(const file of ['campaignSendExclusion','zaloAuxiliaryActions'])new Function('exports',compile(fs.readFileSync(path.join(root,`src/shared/${file}.ts`),'utf8')))(contract)
const constants={ZALO_MESSAGE_OPT_OUT_ACTION_IDS:contract.SEND_EXCLUSION_ACTIONS,ZALO_MESSAGE_PHONE_ACTION_ID:'zalo_message_phone'}
function harness(file,name,methods){const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true),klass=source.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text===name);const body=methods.map(m=>klass.members.find(n=>ts.isMethodDeclaration(n)&&n.name.getText(source)===m).getText(source)).join('\n');return new Function(...Object.keys({...contract,...constants}),compile(`class Harness{${body}}`)+';return Harness')(...Object.values({...contract,...constants}))}
const Runtime=harness('src/main/services/zaloRuntimeService.ts','ZaloRuntimeService',['getAccountCacheVersion','createCampaignLabelContext','applyLabelToUser','invalidateAccount','clearQrAccountRuntimeCache'])
const WebRuntime=harness('src/main/services/zaloWebRuntimeService.ts','ZaloWebRuntimeService',['isCurrentApi','captureSessionGuard'])
function runtimeFixture(api,web=false){
 const runtime=new Runtime(),webRuntime=new WebRuntime()
 webRuntime.entries=new Map(web?[[100,{api,verified:true,debuggerReady:true,captureVersion:0,wc:{isDestroyed:()=>false},crashed:false}]]:[])
 webRuntime.invalidateApi=()=>webRuntime.entries.clear()
 Object.assign(runtime,{cacheVersion:0,accountCacheVersions:new Map(),campaignLabelSessions:new WeakMap(),campaignMediaExecutions:new WeakMap(),apiCache:new Map(web?[]:[[100,{api}]]),apiLoginInflight:new Map(),verifyInflight:new Map(),webRuntime,stopZaloListener:()=>{}})
 runtime.ensureApi=async id=>runtime.apiCache.get(id)?.api??webRuntime.entries.get(id)?.api
 return runtime
}
// Lớp lỗi / câu cấp module của bộ lập lịch (V666) lấy nguyên văn từ mã nguồn.
{
 const schedSrc=fs.readFileSync(path.join(root,'src/main/services/campaignScheduler.ts'),'utf8'),ast=ts.createSourceFile('s.ts',schedSrc,ts.ScriptTarget.Latest,true)
 const pick=n=>ast.statements.find(st=>(ts.isClassDeclaration(st)&&st.name?.text===n)||(ts.isVariableStatement(st)&&st.declarationList.declarations.some(d=>d.name.getText(ast)===n))).getText(ast)
 Object.assign(constants,new Function('getErrorMessage',compile(['ZaloSendExclusionError','SendExclusionCheckUnavailableError','SEND_EXCLUSION_RETRY_NOTE'].map(pick).join('\n'))+';return {ZaloSendExclusionError,SendExclusionCheckUnavailableError,SEND_EXCLUSION_RETRY_NOTE}')(e=>e instanceof Error?e.message:String(e)))
}
const Scheduler=harness('src/main/services/campaignScheduler.ts','CampaignScheduler',['gateSendExclusion','getSendExclusionLabels','preflightZaloMessageOptOut','gateResolvedPhoneMessageTarget'])
const page=require('./fixtures/send-exclusion-ui-page.json')
async function main(){
 const gender=page.groups.find(g=>g.name==='Giới tính nữ')
 for(const actionId of contract.SEND_EXCLUSION_ACTIONS){
  const campaign={id:10,actionId,extraSettings:{enableMessage:true}},account={id:100},input={id:11,uid:'u1',phone:'0901234567',status:actionId==='zalo_message_phone'?'đang chạy':'chờ xử lý'},target={uid:'u1',globalId:'global1',raw:{profile:{gender:1,isFr:1}}},pauses=[]
  const scheduler=new Scheduler()
  Object.assign(scheduler,{sendExclusionProfileErrors:new WeakMap(),sendExclusionRuns:new Map([[10,{catalog:page.catalog,group:gender,blocklistUids:[]}]]),sendExclusionLabels:new Map(),zaloRuntime:{},
    supabase:{checkZaloMessageOptOut:async()=>({isOptedOut:false})},
    sendExclusionRpc:async(_a,_c,operation,payload)=>{assert.equal(operation,'pause');pauses.push(payload);return{changed:true}},
    firstNonEmptyString:x=>x,normalizeZaloTargetFromInputData:()=>target,resolveZaloFriendMessageTarget:async()=>target,
    recordZaloMessageOptOutWarnings:async()=>{},throwIfZaloRuntimeStopping:()=>{},logZaloMessageOptOutBlocked:async()=>{},
    prepareZaloMessageOptOutLink:async()=>{throw new Error('Excluded target must not prepare link')}
  })
  let context=await scheduler.preflightZaloMessageOptOut(account,campaign,input)
  if(actionId==='zalo_message_phone'){assert(!context.blocked);context=await scheduler.gateResolvedPhoneMessageTarget(account,campaign,input,target,context)}
  assert(context.blocked,actionId);assert.equal(pauses.length,1);assert.equal(pauses[0].expectedStatus,actionId==='zalo_message_phone'?'đang chạy':'chờ xử lý');assert.equal(input.status,'tạm dừng')
 }
 const tagField=page.catalog.fields.find(field=>field.code==='zalo_tag'),contains=page.catalog.operators.find(operator=>operator.code==='contains')
 for(const actionId of contract.SEND_EXCLUSION_ACTIONS){
  for(const scenario of [
   {name:'all selected tags deleted',labels:[],blocked:false},
   {name:'remaining tag does not match',labels:[{id:7,conversations:[]}],blocked:false},
   {name:'remaining tag matches',labels:[{id:7,conversations:['u1']}],blocked:true},
   {name:'network read fails',error:new Error('offline'),blocked:true,unknown:true},
   {name:'malformed API response',labels:null,blocked:true,unknown:true}
  ]){
   const campaign={id:10,actionId,extraSettings:{enableMessage:true}},account={id:100},input={id:11,uid:'u1',phone:'0901234567',status:actionId==='zalo_message_phone'?'đang chạy':'chờ xử lý'},target={uid:'u1',globalId:'g1',raw:{isFr:1}},pauses=[]
   const group={id:12,accountId:100,name:'Tags',matchMode:'and',revision:1,rules:[{fieldId:tagField.id,operatorId:contains.id,value:['7','deleted'],isEnabled:true,sortOrder:0}]}
   let labelReads=0
   const scheduler=new Scheduler()
   Object.assign(scheduler,{
    sendExclusionProfileErrors:new WeakMap(),sendExclusionRuns:new Map([[10,{catalog:page.catalog,group,blocklistUids:[]}]]),sendExclusionLabels:new Map(),
    zaloRuntime:{createCampaignLabelContext:()=>new contract.CampaignLabelContext(async()=>{labelReads++;if(scenario.error)throw scenario.error;return{version:1,labelData:scenario.labels}})},
    supabase:{checkZaloMessageOptOut:async()=>({isOptedOut:false})},
    sendExclusionRpc:async(_a,_c,operation,payload)=>{assert.equal(operation,'pause');pauses.push(payload);return{changed:true}},
    firstNonEmptyString:x=>x,normalizeZaloTargetFromInputData:()=>target,resolveZaloFriendMessageTarget:async()=>target,
    recordZaloMessageOptOutWarnings:async()=>{},throwIfZaloRuntimeStopping:()=>{},logZaloMessageOptOutBlocked:async()=>{},
    getZaloErrorCode:()=>undefined,getZaloErrorMessage:error=>error.message,getZaloPolicyByErrorCode:async()=>null,applyZaloPolicySideEffects:async()=>({stopAfterTarget:false}),
    prepareZaloMessageOptOutLink:async()=>({})
   })
   let context=await scheduler.preflightZaloMessageOptOut(account,campaign,input)
   if(actionId==='zalo_message_phone') context=await scheduler.gateResolvedPhoneMessageTarget(account,campaign,input,target,context)
   assert.equal(context.blocked,scenario.blocked,`${actionId}: ${scenario.name}`)
   assert.equal(labelReads,1);assert.equal(pauses.length,scenario.blocked?1:0)
   if(scenario.blocked){
    assert.equal(input.status,'tạm dừng')
    assert.equal(pauses[0].expectedStatus,actionId==='zalo_message_phone'?'đang chạy':'chờ xử lý')
    assert.match(pauses[0].note,scenario.unknown?/Chưa đủ dữ liệu/:/Thỏa điều kiện/)
   }
  }
 }
 console.log('PASS deleted tags: 35 real Desktop/Server preflight cases; existing matches still pause, missing/malformed reads stay unknown, one label read per target.')
 // V666: lỗi tạm thời của thao tác 'remote' / 'facts': không tạm dừng data; data chưa nhận thì ném SendExclusionCheckUnavailableError (vòng
 // chạy nhả lượt, lượt sau thử lại), data đã tìm SĐT thì đánh dấu sendExclusionRetry (về hàng đợi, dừng lượt). Đang dừng bộ chạy / mất lượt thì ném như cũ.
 const delivery={id:0,accountId:100,name:'Đã gửi 7 ngày',matchMode:'or',revision:1,rules:[{fieldId:4,operatorId:5,value:7,isEnabled:true,sortOrder:0}]}
 for(const actionId of contract.SEND_EXCLUSION_ACTIONS){
  for(const scenario of [{name:'remote network error',stopping:false,claim:true,retry:true},{name:'facts network error',facts:true,stopping:false,claim:true,retry:true},
   {name:'runtime stopping',stopping:true,claim:true,throws:/dừng/},{name:'claim lost',stopping:false,claim:false,throws:/fetch failed/}]){
   const campaign={id:10,actionId,extraSettings:{enableMessage:true}},account={id:100},input={id:11,uid:'u1',phone:'0901234567',status:actionId==='zalo_message_phone'?'đang chạy':'chờ xử lý'},target={uid:'u1',globalId:'g1',raw:{isFr:1}},pauses=[]
   const scheduler=new Scheduler()
   let remoteCalls=0
   Object.assign(scheduler,{
    sendExclusionProfileErrors:new WeakMap(),sendExclusionLabels:new Map(),zaloRuntime:{},
    sendExclusionRuns:new Map([[10,scenario.facts?{catalog:page.catalog,group:delivery,blocklistUids:[]}:{catalog:page.catalog,group:null,blocklistUids:[],version:2,remote:{groupName:null,blocks:[],blocklistIds:[9],dataGroups:[],campaigns:[]}}]]),
    campaignRunBoundaries:new Map(scenario.claim?[[10,{runtimeClaimToken:'tok'}]]:[]),
    supabase:{checkZaloMessageOptOut:async()=>({isOptedOut:false})},
    sendExclusionRpc:async(_a,_c,operation,payload)=>{if(operation==='remote'||operation==='facts'){remoteCalls++;throw new Error('fetch failed')}assert.equal(operation,'pause');pauses.push(payload);return{changed:true}},
    firstNonEmptyString:x=>x,normalizeZaloTargetFromInputData:()=>target,resolveZaloFriendMessageTarget:async()=>target,
    recordZaloMessageOptOutWarnings:async()=>{},logZaloMessageOptOutBlocked:async()=>{},
    throwIfZaloRuntimeStopping:()=>{if(scenario.stopping&&remoteCalls>0)throw new Error('Bộ chạy đang dừng')},
    getZaloErrorCode:()=>undefined,getZaloErrorMessage:error=>error.message,getZaloPolicyByErrorCode:async()=>null,applyZaloPolicySideEffects:async()=>({stopAfterTarget:false}),
    prepareZaloMessageOptOutLink:async()=>({})
   })
   const run=async()=>{let context=await scheduler.preflightZaloMessageOptOut(account,campaign,input);if(actionId==='zalo_message_phone')context=await scheduler.gateResolvedPhoneMessageTarget(account,campaign,input,target,context);return context}
   const origWarn=console.warn;console.warn=()=>{}
   try{
    // Nhắn theo SĐT: mất lượt thì bọc thành ZaloSendExclusionError (vòng chạy ném sau khi ghi lượt tìm SĐT); đang dừng bộ chạy thì ném ngay.
    if(scenario.throws&&(actionId!=='zalo_message_phone'||scenario.stopping)){await assert.rejects(run(),scenario.throws,`${actionId}: ${scenario.name}`);continue}
    if(scenario.throws){const context=await run();assert.ok(context.sendExclusionError instanceof constants.ZaloSendExclusionError&&/fetch failed/.test(context.sendExclusionError.message),`${actionId}: ${scenario.name}`);assert.equal(context.sendExclusionRetry,undefined);continue}
    if(actionId!=='zalo_message_phone'){
     await assert.rejects(run(),e=>e instanceof constants.SendExclusionCheckUnavailableError&&e.message==='fetch failed',`${actionId}: ${scenario.name}`)
     assert.equal(pauses.length,0,'không tạm dừng data');assert.equal(input.status,'chờ xử lý');continue
    }
    const context=await run()
    assert.equal(context.blocked,true,`${actionId}: ${scenario.name}`);assert.equal(context.sendExclusionRetry,'Không thể kiểm tra loại trừ gửi; chiến dịch sẽ tự thử lại.',`${actionId}: ${scenario.name} ${JSON.stringify({blocked:context.blocked,err:context.sendExclusionError?.message,pauses})}`)
    assert.equal(context.sendExclusionError,undefined);assert.equal(pauses.length,0,'không tạm dừng data')
   }finally{console.warn=origWarn}
  }
 }
 console.log('PASS remote / facts errors (V666): no data paused for all 7 actions; unclaimed data throws SendExclusionCheckUnavailableError (run released), phone path marks retry; stopping runtime / lost claim still throw.')
 let reads=0,writes=0
 const api={getLabels:async()=>{reads++;return{version:1,labelData:[{id:7,text:'VIP',conversations:['u1']},{id:8,text:'Mới',conversations:[]}]}},updateLabels:async payload=>{writes++;return{...payload,version:payload.version+1}}}
 const runtime=runtimeFixture(api)
 const ctx=runtime.createCampaignLabelContext(100)
 assert.deepEqual((await ctx.ids('u1')).ids,['7'])
 await runtime.applyLabelToUser(100,'u1',8,['7'],ctx);assert.equal(writes,0)
 await runtime.applyLabelToUser(100,'u1',8,[],ctx);await runtime.applyLabelToUser(100,'u2',8,[],ctx);await runtime.applyLabelToUser(100,'u2',8,[],ctx)
 assert.equal(reads,1);assert.equal(writes,2);assert.equal((await ctx.current()).version,3);assert.deepEqual((await ctx.ids('u1')).ids,['7'])
 for(const web of [false,true]){
  const runtime=runtimeFixture(api,web),context=runtime.createCampaignLabelContext(100)
  await context.ids('u1');const before=writes,oldReads=reads
  const replacement={...api,getLabels:async()=>{throw new Error('Must not reload labels from another session')}}
  if(web)runtime.webRuntime.entries.get(100).api=replacement
  else runtime.apiCache.set(100,{api:replacement})
  await assert.rejects(context.ids('u1'),/Phiên tag Zalo đã thay đổi/)
  await assert.rejects(runtime.applyLabelToUser(100,'u2',8,[],context),/Phiên tag Zalo đã thay đổi/)
  assert.equal(writes,before);assert.equal(reads,oldReads)
  if(web)runtime.webRuntime.entries.get(100).api=api
  else runtime.apiCache.set(100,{api})
  await assert.rejects(context.current(),/Phiên tag Zalo đã thay đổi/)
 }
 const webRuntime=runtimeFixture(api,true),webContext=webRuntime.createCampaignLabelContext(100)
 await webContext.current();webRuntime.webRuntime.entries.get(100).captureVersion++
 await assert.rejects(webContext.current(),/Phiên tag Zalo đã thay đổi/)
 const beforeRead=runtimeFixture(api),unread=beforeRead.createCampaignLabelContext(100),readCount=reads
 beforeRead.invalidateAccount(100);await assert.rejects(unread.current(),/Phiên tag Zalo đã thay đổi/);assert.equal(reads,readCount)
 for(const invalidate of [runtime=>runtime.invalidateAccount(100),runtime=>runtime.cacheVersion++]){
  const runtime=runtimeFixture(api),context=runtime.createCampaignLabelContext(100)
  await context.current();invalidate(runtime)
  // Even an API object re-used after invalidation must not revive the old context.
  runtime.apiCache.set(100,{api})
  await assert.rejects(context.current(),/Phiên tag Zalo đã thay đổi/)
 }
 const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return{promise,resolve}}
 const read=deferred(),started=deferred(),lateApi={...api,getLabels:()=>{started.resolve();return read.promise}},lateRuntime=runtimeFixture(lateApi)
 const lateContext=lateRuntime.createCampaignLabelContext(100),pending=lateContext.ids('u1')
 await started.promise;lateRuntime.invalidateAccount(100);read.resolve({version:1,labelData:[]})
 await assert.rejects(pending,/Phiên tag Zalo đã thay đổi/)
 const update=deferred(),updateStarted=deferred(),updateApi={...api,updateLabels:()=>{updateStarted.resolve();return update.promise}},updateRuntime=runtimeFixture(updateApi)
 const updateContext=updateRuntime.createCampaignLabelContext(100),writing=updateRuntime.applyLabelToUser(100,'u2',8,[],updateContext)
 await updateStarted.promise;updateRuntime.invalidateAccount(100);update.resolve({version:20,labelData:[]})
 await assert.rejects(writing,/Phiên tag Zalo đã thay đổi/)
 await assert.rejects(updateContext.current(),/Phiên tag Zalo đã thay đổi/)
 console.log('PASS session guards: QR/Web API replacement, account/global invalidation, late getLabels/updateLabels; no stale write or extra label request.')
 console.log('PASS Desktop/Server: real preflight/phone gates for all 7 actions, CAS pause, no auxiliary link creation; same label snapshot for evaluation/skip/write/batch, version update and no-op.')
}
main().catch(e=>{console.error(e);process.exitCode=1})
