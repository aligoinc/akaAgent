// Explicit opt-in: one Responses request, or seven focused regressions with --schedule (including an older Desktop snapshot).
// Uses synthetic data and the existing configured credential.
// No customer data, campaign mutations or production AI-log inserts. Secret remains in process memory.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript')
const {execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'..')
function load(file,imports={}){
 const module={exports:{}}
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
 new Function('require','module','exports',code)(name=>{if(name in imports)return imports[name];throw Error('Unexpected dependency '+name)},module,module.exports)
 return module.exports
}
async function main(){
 if(process.argv.includes('--verify-schedule-receipt')){
  const receipt=JSON.parse(fs.readFileSync('/tmp/akaagent-diagnostics-focused-ai-smoke.json','utf8'))
  assert.equal(receipt.model,'gpt-6.1-sol');assert.equal(receipt.requests,7);assert.equal(receipt.promptSource,'ai_prompt');assert.equal(receipt.promptId,47);assert.equal(receipt.productionLogWrites,0)
  assert.deepEqual(receipt.receipts.map(row=>row.name),['direct_paused','direct_paused_legacy','direct_pending','data_group_expired','direct_future','healthy_running','quota_exhausted'])
  for(const row of receipt.receipts)assertScheduleResult(row.name,row)
  console.log('PASS all seven saved live Sol 6.1 responses against schedule expectations; no additional network requests')
  return
 }
 assert(process.argv.includes('--live'),'Pass --live for a billable synthetic API smoke')
 assert.equal(fs.readFileSync(path.join(root,'supabase/.temp/project-ref'),'utf8').trim(),'cgjbsmqtfhqvttudyjzq')
 const sql="select jsonb_build_object('model',to_jsonb(m),'prompt',to_jsonb(p),'using',to_jsonb(u)) as config from ai_using u join ai_model m on m.id=u.model_id join ai_prompt p on p.id=u.prompt_id where u.code='app_campaign_diagnostics'"
 const raw=JSON.parse(execFileSync('supabase',['db','query','--linked',sql],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:100000})).rows[0].config
 const camel=row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v]))
 const config=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,camel(v)])),logs=[]
 const runtime=load('src/main/services/aiRuntimeService.ts',{'../data/repositories/aiRepository':{getAiUsingConfigByCode:async()=>config,createAiLog:async log=>{logs.push(log);return null}}})
 const shared=load('src/shared/campaignDiagnostics.ts')
 const scheduleRules=load('src/main/services/campaignDiagnosticsSchedule.ts')
 const imports={'node:crypto':require('node:crypto'),'../../shared/campaignDiagnostics':shared,'../data/currentUser':{requireCurrentUser:()=>({organizationId:1})},'./aiRuntimeService':runtime,'./campaignDiagnosticsSchedule':scheduleRules}
 for(const id of ['../data/repositories/staffManagementRepository','../data/repositories/runtimeClockRepository','../data/repositories/browserRunLimitsRepository','../data/repositories/entitlementRepository','../data/repositories/campaignPendingReasonRepository','../data/repositories/campaignPendingChatLimitRepository','../data/repositories/campaignDiagnosticsRepository','./campaignPendingReasonService'])imports[id]={}
 imports['../../shared/facebookRandomRunDiagnostics']=load('src/shared/facebookRandomRunDiagnostics.ts',{'./facebookRandomRun':load('src/shared/facebookRandomRun.ts')})
 imports['./webEnrichmentControl']=load('src/main/services/webEnrichmentControl.ts')
 const service=load('src/main/services/campaignDiagnosticsService.ts',imports)
 if(process.argv.includes('--schedule'))return scheduleRegression(service,shared,scheduleRules,logs,config)
 const snapshot={id:require('node:crypto').randomUUID(),campaignId:0,accountId:0,version:'synthetic',checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),campaignStatus:'chờ xử lý',headline:'Đã dùng đủ quota trong 65 phút.',complete:false,
  checks:[{id:'limits',title:'Giới hạn',severity:'blocking',problem:'9 / 9 lượt trong 65 phút.',cause:'Quota đầy',explanation:'Khung 65 phút chưa hết.',solution:'Chờ quota hoặc kiểm tra cấu hình',actions:['limits']}],
  quotas:[{code:'facebook_message_uid',name:'Nhắn tin',checked:true,disabled:false,dayUsed:9,dayLimit:30,windowUsed:9,windowLimit:9,windowMinutes:65}],
  facts:{campaign:{content:'Synthetic literal $& content.',password:'diagnostic-fixture-secret'},account:{loginStatus:'đã đăng nhập'},action:{},accountHistory:null,campaignHistory:[],results:[],inputSummary:{'chờ xử lý':2},inputs:[]}}
 const result=await service.analyzeDiagnosticsSnapshot(snapshot,new AbortController().signal)
 assert.equal(result.model,'gpt-6.1-sol');assert(result.issues.length>0);assert.equal(logs.length,1)
 const logged=JSON.stringify(logs)
 assert(!logged.includes('diagnostic-fixture-secret'));assert(logged.includes('Synthetic literal $& content.'))
 assert(logs[0].renderedSystemPrompt.includes('BEGIN_UNTRUSTED_DIAGNOSTIC_SNAPSHOT'))
 assert(!logs[0].renderedSystemPrompt.includes('{{diagnosticContext}}'))
 const request=logs[0].sanitizedRequest.body
 assert.equal(request.reasoning.effort,'medium');assert.equal(request.text.format.type,'json_schema');assert.equal(request.store,false)
 const receipt={at:new Date().toISOString(),ok:true,model:result.model,structuredIssues:result.issues.length,summary:result.summary,systemSnapshot:true,secretsRemoved:true,literalContentPreserved:true,requests:1,productionLogWrites:0}
 fs.writeFileSync(path.join(root,'migrations/snapshots/campaign-diagnostics-v390/ai-structured-smoke.json'),JSON.stringify(receipt,null,2)+'\n')
 console.log(receipt)
}
async function scheduleRegression(service,shared,scheduleRules,logs,config){
 const dbNow='2026-10-14T12:42:25Z',receipts=[]
 const cases=['direct_paused','direct_paused_legacy','direct_pending','data_group_expired','direct_future','healthy_running','quota_exhausted']
 const promptSha256=require('node:crypto').createHash('sha256').update(config.prompt.promptSystem).digest('hex')
 if(process.argv.includes('--resume-schedule')){
  const saved=JSON.parse(fs.readFileSync('/tmp/akaagent-diagnostics-focused-ai-smoke.json','utf8'))
  assert.equal(saved.promptSha256,promptSha256,'Cannot resume results from a different prompt')
  assert.equal(saved.model,shared.DIAGNOSTICS_MODEL);assert.equal(saved.promptId,config.prompt.id);assert.equal(saved.productionLogWrites,0)
  assert.deepEqual(saved.receipts.map(row=>row.name),cases.slice(0,saved.receipts.length))
  for(const row of saved.receipts)assertScheduleResult(row.name,row)
  receipts.push(...saved.receipts)
 }
 const resumed=receipts.length
 const makeIssue=(id,severity,problem,actions=[])=>({id,title:id,severity,problem,cause:problem,explanation:problem,solution:'Đối chiếu thông tin đã ghi nhận.',actions})
 for(const name of cases.slice(resumed)){
  const campaign={id:0,accountId:0,actionId:'facebook_group_post',name:'Synthetic schedule regression',status:name.startsWith('direct_paused')?'tạm dừng':'chờ xử lý',
   schedule:name==='direct_future'?'2026-10-14T15:00:00Z':'2026-10-14T10:37:00Z',originalSchedule:'2026-10-14T10:37:00Z',scheduleType:'weekly',scheduleWeekDays:'4,5',scheduleEndDate:'2026-10-12T16:59:59Z',
   dataTargetSourceMode:name==='data_group_expired'?'data_group':'direct',continueNextDay:true,refreshData:false,dailyStopTime:null,content:'Nội dung thử nghiệm',images:[]}
  const schedule=scheduleRules.describeDiagnosticSchedule(campaign,dbNow)
  const scheduleCheck=makeIssue('schedule',name==='data_group_expired'||name==='direct_future'?'info':'ok',
   name==='data_group_expired'?'Chiến dịch đã hết hạn lúc 23:59 12/10/2026, đang chờ cập nhật trạng thái.':name==='direct_future'?'Chưa đến lịch chạy. Lịch tiếp theo: 22:00 14/10/2026.':'Chưa thấy điều kiện về lịch chặn lượt chạy.', ['schedule'])
  scheduleCheck.explanation=schedule.explanation
  const snapshot={id:require('node:crypto').randomUUID(),campaignId:0,accountId:0,version:'synthetic-schedule-v1',checkedAt:dbNow,expiresAt:'2026-10-14T12:47:25Z',campaignStatus:campaign.status,
   headline:campaign.status==='tạm dừng'?'Chiến dịch đang tạm dừng.':'Chiến dịch đang chờ.',complete:true,
   checks:[makeIssue('account','ok','Tài khoản hoạt động, gói và quyền sử dụng còn hiệu lực.'),makeIssue('login','ok','Đã ghi nhận đăng nhập.'),
    makeIssue('runtime','info',campaign.status==='tạm dừng'?'Chiến dịch đang tạm dừng, không nhận lượt mới.':'Chưa phát hiện điều kiện chặn bộ chạy.',['history']),scheduleCheck,
    makeIssue('limits','ok','1/30 lượt trong ngày, 1/9 lượt trong 65 phút.'),makeIssue('restrictions','ok','Không có hạn chế hành động đã ghi nhận.'),
    makeIssue('content','info','Cấu hình nội dung hợp lệ, đã có chữ; không yêu cầu media.'),makeIssue('data','ok','Có 2 data chờ đã đến giờ chạy.'),makeIssue('history','info','Chưa có kết quả lỗi trong mẫu.')],
   quotas:[{code:'facebook_group_post',name:'Đăng bài nhóm',checked:true,disabled:false,reason:null,enableAt:null,dayUsed:1,dayLimit:30,windowUsed:1,windowLimit:9,windowMinutes:65}],
   facts:{schedule,campaign,account:{id:0,flatformType:'facebook',executionTarget:'facebook',facebookRandomRunEnabled:false,status:'chờ xử lý',isActive:true,loginStatus:'đã đăng nhập'},action:{id:'facebook_group_post',isActive:true},
    accountHistory:[],campaignHistory:name.startsWith('direct_paused')?['19:40:45 14/10/2026 - Chiến dịch đã được tạm dừng','19:40:36 14/10/2026 - Bắt đầu chiến dịch']:[],results:[],inputSummary:{'chờ xử lý':2},inputs:[{status:'chờ xử lý'},{status:'chờ xử lý'}]}}
  if(name==='healthy_running'){
   snapshot.campaignStatus=campaign.status='đang chạy';snapshot.facts.account.status='đang chạy';snapshot.headline='Chiến dịch đang chạy.'
   snapshot.checks.find(issue=>issue.id==='runtime').severity='ok'
   snapshot.checks.find(issue=>issue.id==='runtime').problem='Chiến dịch đang thực thi data, đã ghi nhận kết quả mới.'
   snapshot.facts.results=[{status:'thành công',log:'Đã đăng bài thành công',created_at:'2026-10-14T12:42:00Z'}]
  }
  if(name==='quota_exhausted'){
   snapshot.quotas[0].windowUsed=9
   Object.assign(snapshot.checks.find(issue=>issue.id==='limits'),makeIssue('limits','blocking','Đã dùng đủ 9/9 lượt trong 65 phút.',['limits']))
   snapshot.headline='Chiến dịch đang chờ do đạt giới hạn trong 65 phút.'
  }
  if(name==='direct_paused_legacy'){
   delete snapshot.facts.schedule
   scheduleCheck.problem='Lịch hiện tại cho phép nhận lượt chạy.'
   scheduleCheck.explanation='Lịch được đối chiếu theo giờ hệ thống và múi giờ Việt Nam.'
  }
  const result=await service.analyzeDiagnosticsSnapshot(snapshot,new AbortController().signal)
  assert.equal(result.model,shared.DIAGNOSTICS_MODEL)
  assert.equal(logs.at(-1).renderedSystemPrompt,config.prompt.promptSystem.replace('{{availableActions}}',()=>JSON.stringify(shared.DIAGNOSTICS_ACTIONS)).replace('{{diagnosticContext}}',()=>JSON.stringify(result.snapshot)))
  const receipt={name,summary:result.summary,issues:result.issues}
  receipts.push(receipt)
  fs.writeFileSync('/tmp/akaagent-diagnostics-focused-ai-smoke.json',JSON.stringify({at:new Date().toISOString(),model:result.model,requests:receipts.length,productionLogWrites:0,promptSource:'ai_prompt',promptId:config.prompt.id,promptSha256,receipts},null,2)+'\n')
  assertScheduleResult(name,result)
  console.log(JSON.stringify({name,ok:true,summary:result.summary,issues:result.issues.map(issue=>({title:issue.title,severity:issue.severity,actions:issue.actions}))}))
 }
 assert.equal(logs.length,7-resumed)
 console.log('PASS seven live Sol 6.1 focused cases from the DB prompt; synthetic data only; no production log writes. Receipt: /tmp/akaagent-diagnostics-focused-ai-smoke.json')
}
function assertScheduleResult(name,result){
 assert(!result.issues.some(issue=>issue.severity==='ok'),name+': normal checks must not become AI issues')
 assert(!result.issues.some(issue=>/không (?:tự )?chặn|chưa ghi nhận (?:chặn|trở ngại|vướng mắc)|không phải (?:lỗi|nguyên nhân)/i.test(issue.title)),name+': excluded causes must not become separate issues')
 if(name==='healthy_running'){
  assert.equal(result.issues.length,0,'A running campaign with no abnormality needs no issue cards')
 }else if(name.startsWith('direct_paused')){
  assert.equal(result.issues.length,1,'Pause and unknown pause cause must be one issue without unrelated boxes')
  assert(/tạm dừng/i.test(result.issues[0].title+' '+result.issues[0].problem))
  assert(['info','unknown'].includes(result.issues[0].severity),'Pause is informational; an unverified pause cause may be unknown')
  assert(!result.issues[0].actions.includes('schedule'),'Old direct-data end date does not require editing schedule')
 }else if(name==='direct_pending'){
  assert(result.issues.length<=1,'Only relevant uncertainty may remain when no blocker is known')
  assert(result.issues.every(issue=>issue.severity==='unknown'&&!issue.actions.includes('schedule')))
 }else if(name==='data_group_expired'){
  assert.equal(result.issues.length,1,'Only the confirmed expired source needs an issue')
  assert.equal(result.issues[0].severity,'blocking')
  assert(result.issues[0].actions.includes('schedule'))
 }else if(name==='quota_exhausted'){
  assert.equal(result.issues.length,1,'Only exhausted quota needs an issue')
  assert.equal(result.issues[0].severity,'blocking')
  assert(result.issues[0].actions.includes('limits'))
  assert(/65/.test(JSON.stringify(result.issues[0])))
 }else{
  assert.equal(result.issues.length,1,'Only the upcoming schedule needs an issue')
  assert.equal(result.issues[0].severity,'info')
  assert(/chưa đến lịch|chưa đến giờ|chờ (?:đến )?lịch/i.test(JSON.stringify(result.issues[0]))&&/22:00/.test(JSON.stringify(result.issues[0])))
 }
}

main().catch(error=>{console.error('Live diagnostic smoke failed:',error.message);process.exitCode=1})
