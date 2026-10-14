const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ts = require('typescript')
const crypto = require('node:crypto')
function load(file, imports = {}) {
  const mod = { exports: {} }, code = ts.transpileModule(readFileSync(resolve(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  new Function('require', 'module', 'exports', code)(id => { if (id in imports) return imports[id]; throw new Error(`Unexpected dependency ${id}`) }, mod, mod.exports)
  return mod.exports
}
const shared = load('src/shared/campaignDiagnostics.ts')
const randomChecks = load('src/shared/facebookRandomRunDiagnostics.ts', { './facebookRandomRun': load('src/shared/facebookRandomRun.ts') })
const scheduleRules = load('src/main/services/campaignDiagnosticsSchedule.ts')
const diagnosticPrompt = JSON.parse(readFileSync(resolve(__dirname, '../migrations/snapshots/campaign-diagnostics-prompt-v395/target.json'), 'utf8')).prompt.prompt_system
const auth = load('src/main/data/currentUser.ts', { 'node:async_hooks': require('node:async_hooks') })
const deadline = load('src/main/services/requestDeadline.ts')
const login = () => { auth.setCurrentUser({ staffId: 9, organizationId: 1 }); auth.setCurrentUserCredentials({ username: 'fixture', password: 'fixture' }) }
const nextTick = () => new Promise(resolve => setImmediate(resolve))
const sample = id => ({ id: crypto.randomUUID(), campaignId: id, accountId: 4, version: 'v1', expiresAt: new Date(Date.now()+300000).toISOString(), checks: [], facts: {}, quotas: [] })
const credentialText = 'Cookie: c_user=fixture-user; xs=fixture-xs; fr=fixture-fr\npass=fixture-pass'
const basicCredential = Buffer.from('diagnostic-test:synthetic-password').toString('base64')
const authorizationValues = [
  'Basic '+basicCredential, 'Bearer fixture-bearer',
  'Digest username="fixture-user", nonce="fixture-nonce", response="fixture-response"'
]
const authorizationText = 'Authorization: '+authorizationValues[0]
const assertNoCredentials = (value, message = 'Basic credentials must be masked') => {
  const serialized = JSON.stringify(value)
  for (const secret of ['fixture-', basicCredential, 'diagnostic-test:synthetic-password']) {
    assert(!serialized.includes(secret), message)
  }
}
// Match v390's order/limits; simple masking never reconstructs or discards events.
const rpcHistory = log => log.split('\n').filter(line => line.trim()).slice(-30).reverse().map(line => [...line].slice(0, 8000).join(''))
const normalHistoryLine = '10:01:00 14/10/2026 - Đạt giới hạn 9/9 trong 65 phút.'
const historyLogs = [
  '10:00:00 14/10/2026 - '+credentialText+'\n'+normalHistoryLine,
  ...authorizationValues.map(value => '10:00:00 14/10/2026 - Request failed\nAuthorization: '+value+'\n'+normalHistoryLine)
]
function historyRedactionRegression() {
  for (const log of historyLogs) {
    const lines = rpcHistory(log), original = [...lines]
    const clean = shared.sanitizeCampaignDiagnosticsSnapshot({facts:{campaignHistory:lines}})
    assertNoCredentials(clean)
    assert.equal(clean.facts.campaignHistory.length, lines.length)
    assert.equal(clean.facts.campaignHistory[0], normalHistoryLine)
    assert.deepEqual(lines, original)
    assert.deepEqual(shared.sanitizeCampaignDiagnosticsSnapshot(clean), clean)
  }
  const normal = rpcHistory('Log cũ không có mốc thời gian\n  Bộ chạy đang chờ\n'+normalHistoryLine)
  assert.deepEqual(shared.sanitizeCampaignDiagnosticsSnapshot({facts:{campaignHistory:normal}}).facts.campaignHistory, normal)
  const boundary = rpcHistory('Nội dung lịch sử: '+'x'.repeat(9000))
  assert.deepEqual(shared.sanitizeCampaignDiagnosticsSnapshot({facts:{campaignHistory:boundary}}).facts.campaignHistory, boundary)
  const thirty = Array.from({length:35},(_,i)=>'Log '+i)
  assert.deepEqual(shared.sanitizeCampaignDiagnosticsSnapshot({facts:{campaignHistory:thirty}}).facts.campaignHistory, thirty.slice(0,30))
  for (const missing of [null, []]) assert.deepEqual(shared.sanitizeCampaignDiagnosticsSnapshot({facts:{campaignHistory:missing}}).facts.campaignHistory, missing)
  console.log('PASS simple history masking, unchanged ordinary/undated/clipped logs and 30-line order')
}
function sanitizationRegression() {
  for (const newline of ['\n','\r\n','\r']) {
    for (const input of [
      credentialText, 'SET-COOKIE: custom=fixture-custom; Path=/; HttpOnly',
      'cookie="c_user=fixture-user; xs=fixture-xs"', "PASS='fixture pass with spaces'",
      'password=fixture-password', ...authorizationValues.map(value=>'Authorization: '+value)
    ]) {
      const output = shared.sanitizeDiagnosticText(input+newline+'HTTP 401')
      assertNoCredentials(output)
      assert(output.includes('HTTP 401'), 'Keep the following business log line')
      assert.equal(shared.sanitizeDiagnosticText(output), output)
    }
  }
  const clean = shared.sanitizeDiagnosticValue({
    password:'fixture-password',pass:'fixture-pass',cookie:'fixture-cookie',
    details:{access_token:'fixture-token',session:{value:'fixture-session'},Authorization:authorizationValues[0]},
    status:'HTTP 401',loginStatus:'chưa đăng nhập'
  })
  assert.deepEqual(clean,{details:{},status:'HTTP 401',loginStatus:'chưa đăng nhập'})
  const ordinary = 'Nội dung bình thường; {{name}}; 9/30 lượt trong 65 phút.'
  assert.equal(shared.sanitizeDiagnosticText(ordinary),ordinary)
  // Explicitly limited scope: no JSON decoding, header-pair inference or whole-event hiding.
  const unsupported = {pairs:[['Authorization','opaque-value']],text:'{"cookie":\n  "opaque-value"}'}
  const output = shared.sanitizeDiagnosticValue(unsupported)
  assert.deepEqual(output.pairs,unsupported.pairs)
  assert(output.text.includes('opaque-value'))
  const started = performance.now()
  for (const character of ['-','.']) for (const size of [30000,100000]) {
    assert.equal(shared.sanitizeDiagnosticText(character.repeat(size)),character.repeat(8000))
  }
  const elapsed = performance.now()-started
  assert(elapsed<1000,'Long plain text must not block the main process: '+elapsed+'ms')
  console.log('PASS basic fields/headers, retained business text and bounded long-text processing ('+elapsed.toFixed(1)+'ms)')
}
async function campaignReadRegression() {
  const mappers = load('src/main/data/mappers.ts', { './currentUser': auth })
  let selected = []
  const stored = { id: 1, name: 'fixture', account_id: 2, action_id: 'email_send', status: 'chờ xử lý',
    staff_id: 9, organization_id: 1, is_delete: false, schedule_type: 'weekly', refresh_data: true }
  const query = {
    select(fields) { selected = fields.split(','); return this }, eq() { return this }, or() { return this }, abortSignal() { return this },
    async maybeSingle() { return { data: Object.fromEntries(Object.entries(stored).filter(([key]) => selected.includes(key))), error: null } }
  }
  const repo = load('src/main/data/repositories/campaignDiagnosticsRepository.ts', {
    '../../../shared/accountActionLimits': {}, '../supabaseClient': { getSupabaseClient: () => ({ from: () => query }) },
    '../currentUser': auth, '../mappers': mappers, '../../domain/campaigns/campaignActionDescriptors': {}, './entitlementRepository': {}
  })
  for (const refresh of [true, false]) {
    stored.refresh_data = refresh
    const campaign = await repo.readDiagnosticsCampaign(1, new AbortController().signal)
    assert.equal(campaign.refreshData, refresh, 'Read projection must preserve the stored refresh_data setting')
  }
  console.log('PASS campaign read preserves refresh_data through the real mapper')
  const accountRow = { id:2, staff_id:9, organization_id:1, flatform_type:'facebook',
    facebook_random_run_enabled:true, facebook_random_run_config:{version:1,revision:7,rules:[{campaignActionId:'facebook_group_post',quantity:3,unit:'data'}]} }
  const filters=[]
  const accountQuery={
    select(fields){selected=fields.split(',');return this},eq(...args){filters.push(args);return this},or(value){filters.push(value);return this},
    abortSignal(signal){signal.throwIfAborted();return this},async maybeSingle(){return {data:Object.fromEntries(Object.entries(accountRow).filter(([key])=>selected.includes(key))),error:null}}
  }
  const accountRepo=load('src/main/data/repositories/campaignPendingReasonRepository.ts',{
    '../currentUser':auth,'../mappers':mappers,'../supabaseClient':{getSupabaseClient:()=>({from:table=>{assert.equal(table,'auto_accounts');return accountQuery}})}
  })
  login()
  const result=await accountRepo.readPendingReasonAccount(2,new AbortController().signal)
  assert.equal(result.account.facebookRandomRunEnabled,true);assert.equal(result.account.facebookRandomRunRevision,7)
  assert.deepEqual(result.randomRun,{enabled:true,config:accountRow.facebook_random_run_config})
  assert(filters.some(f=>Array.isArray(f)&&f[0]==='staff_id'&&f[1]===9));assert(filters.includes('organization_id.is.null,organization_id.eq.1'))
  assert.equal(randomChecks.checkFacebookRandomConfiguration(result.randomRun,{id:'facebook_message_uid',name:'Nhắn tin UID'}).state,'excluded')
  await assert.rejects(accountRepo.readPendingReasonAccount(2,AbortSignal.abort()))
  console.log('PASS random settings in the same scoped account read, actual mapper revision and cancellation')
}
async function boundary() {
  const handlers = {}, pending = []
  let reads = 0, analyses = 0, timeout = 1000, changed = false, live = true, randomRevision = 1, changeDuringAi = false
  const win = { webContents: { mainFrame: {} } }, event = { sender: win.webContents, senderFrame: win.webContents.mainFrame }
  const module = load('src/main/ipc/handlers/campaignDiagnosticsHandlers.ts', {
    electron: { ipcMain: { handle: (key, fn) => handlers[key] = fn } },
    '../../../shared/campaignDiagnostics': shared, '../../data/currentUser': auth,
    '../../services/requestDeadline': { withRequestDeadline: (signal, run) => deadline.withRequestDeadline(signal, run, timeout) },
    '../../data/repositories/staffManagementRepository': { readStaffAccess: async () => ({ isActive: live }) },
    '../../data/repositories/campaignDiagnosticsRepository': { readDiagnosticsCampaign: async () => ({ version: changed ? 'v2' : 'v1' }) },
    '../../services/campaignDiagnosticsService': {
      readDiagnosticVersion: async c => `${c.version}:${randomRevision}`,
      collectCampaignDiagnostics: async id => { reads++; return new Promise(resolve => pending.push(() => resolve({...sample(id),version:`${changed?'v2':'v1'}:${randomRevision}`}))) },
      analyzeDiagnosticsSnapshot: async (snapshot) => { analyses++; if(changeDuringAi)randomRevision++; return { snapshot, summary: 'fixture' } }
    }
  })
  const service = module.registerCampaignDiagnosticsHandlers(win, { getDiagnosticRuntime: () => ({}) })
  const read = (id, requestId = crypto.randomUUID()) => Promise.resolve().then(() => handlers[shared.CAMPAIGN_DIAGNOSTICS_IPC.read](event, { campaignId: id, requestId }))
  const ai = snapshot => handlers[shared.CAMPAIGN_DIAGNOSTICS_IPC.ai](event, { campaignId: snapshot.campaignId, snapshotId: snapshot.id, requestId: crypto.randomUUID() })
  login()
  assert.throws(() => handlers[shared.CAMPAIGN_DIAGNOSTICS_IPC.read]({ ...event, senderFrame: {} }, { campaignId: 1, requestId: crypto.randomUUID() }))
  await assert.rejects(read(-1)); await assert.rejects(read(1, 'bad'))
  const id = crypto.randomUUID(), first = read(1,id), duplicate = read(1)
  await nextTick(); assert.equal(reads,1); assert.equal(analyses,0)
  handlers[shared.CAMPAIGN_DIAGNOSTICS_IPC.cancel](event,id)
  pending.shift()(); await assert.rejects(first); const snapshot = await duplicate
  await ai(snapshot); assert.equal(analyses,1)
  live=false; await assert.rejects(ai(snapshot)); assert.equal(analyses,1); live=true
  const wrongOwner = { ...snapshot, campaignId: 2 }; await assert.rejects(ai(wrongOwner))
  randomRevision++
  const refreshedAi=ai(snapshot);await nextTick();assert.equal(reads,2,'Changed account settings must refresh a still-live snapshot')
  pending.shift()();const refreshed=await refreshedAi;assert.equal(refreshed.snapshot.version,'v1:2')
  changeDuringAi=true;await assert.rejects(ai(refreshed.snapshot));changeDuringAi=false
  console.log('PASS AI refreshes changed account configuration and rejects a change during analysis')
  const burst = [1,2,3,4].map(id => read(id)); await nextTick(); await assert.rejects(read(5))
  while(pending.length) pending.shift()(); await Promise.all(burst)
  timeout=10; await assert.rejects(read(1)); pending.shift()(); timeout=1000
  const obsolete = read(1); await nextTick(); auth.setCurrentUser(null); login(); pending.shift()(); await assert.rejects(obsolete)
  const cancelledId=crypto.randomUUID(), cancelled=read(1,cancelledId); await nextTick()
  handlers[shared.CAMPAIGN_DIAGNOSTICS_IPC.cancel](event,cancelledId); await assert.rejects(cancelled); pending.shift()()
  // Cache miss/TTL expiry refreshes server-owned evidence before AI, never trusts renderer payload.
  const expired=ai({ ...snapshot,id: crypto.randomUUID() }); await nextTick(); pending.shift()(); await expired
  const closing=read(1); await nextTick();service.stop(); await assert.rejects(closing);pending.shift()()
  service.stop()
  console.log('PASS IPC owner/frame/ID validation, dedup leases, cap, timeout, cancellation, relogin, expiry refresh, no implicit AI')
}
async function rules() {
  let platform='facebook', quotaFail=false, logsFail=false, configChange=null, historyLog=historyLogs[0], dbNow='2026-10-14T03:00:00Z'
  const campaign = { id:1,accountId:2,actionId:'facebook_message_uid',status:'chờ xử lý',extraSettings:{headers:{Authorization:authorizationValues[0]}},schedule:'2026-10-14T02:00:00Z',scheduleType:'weekly',scheduleWeekDays:'4,5',dataTargetSourceMode:'direct',refreshData:true,content:credentialText+'\n'+authorizationText }
  let campaignReads=0, aiCalls=0
  let randomRun = { enabled: false, config: null }, accountReads = 0, randomChange = null
  const aiLogs=[]
  const aiRuntime=load('src/main/services/aiRuntimeService.ts', {
    '../data/repositories/aiRepository': {
      getAiUsingConfigByCode:async()=>({
        using:{id:1,timeoutMs:1000,requestOptions:{}},
        model:{id:1,model:shared.DIAGNOSTICS_MODEL,provider:'openai',endpoint:'https://diagnostics.invalid/v1/responses',apiKey:'synthetic-key',defaultBody:{}},
        prompt:{id:1,promptSystem:diagnosticPrompt,promptUser:'Analyze the snapshot.'}
      }),
      createAiLog:async log=>{aiLogs.push(log);return 1}
    }
  })
  const imports={
    '../../shared/facebookRandomRunDiagnostics':randomChecks,
    'node:crypto':crypto, '../../shared/campaignDiagnostics':shared,
    '../data/currentUser':auth,
    '../data/repositories/staffManagementRepository':{readStaffAccess:async()=>({isActive:true,timeAllowed:true})},
    '../data/repositories/runtimeClockRepository':{getDatabaseRuntimeClock:async()=>{if(dbNow===null)throw Error('Clock unavailable');return {dbNow}}},
    '../data/repositories/browserRunLimitsRepository':{getBrowserRunLimits:async()=>({})},
    '../data/repositories/entitlementRepository':{canUseCampaignActionWithEntitlements:()=>true,canUseAccountWithEntitlementsAndCapabilities:()=>true,getUserZaloAccountCapabilities:()=>({})},
    '../data/repositories/campaignPendingReasonRepository':{
      readPendingReasonAccount:async()=>({account:{id:2,flatformType:platform,isZaloServer:platform==='zalo',isActive:true,status:'chờ xử lý',loginStatus:'đã đăng nhập'},randomRun: ++accountReads % 2 === 0 && randomChange ? randomChange : randomRun}),
      readPendingReasonAction:async()=>({id:campaign.actionId,name:'Nhắn tin UID',workflowId:3}),readBusyCampaign:async()=>null,countBusyBrowserAccounts:async()=>0,
      hasPendingReasonWorkflow:async()=>true,readPendingInputAvailability:async()=>({state:'due'}),hasPendingFindDataSource:async()=>false
    },
    '../data/repositories/campaignPendingChatLimitRepository':{readChatPendingLimitReason:async()=>null},
    '../data/repositories/campaignDiagnosticsRepository':{
      readDiagnosticsCampaign:async()=>{campaignReads++;return {...campaign,note:configChange==='note'&&campaignReads%2===0?'changed':null,refreshData:!(configChange==='refreshData'&&campaignReads%2===0)}},
      readDiagnosticsEvidence:async()=>{if(logsFail)throw Error('private');return {accountHistory:[{password:'never',details:{cookie:'never'},message:credentialText+'\n'+authorizationText}],campaignHistory:rpcHistory(historyLog),results:[{status:'lỗi',log:authorizationText}],inputSummary:{},inputs:[{content:authorizationText,headers:{Authorization:authorizationValues[0]}}]}},
      readDiagnosticsQuotas:async()=>{if(quotaFail)throw Error('private');return[{code:'fixture',name:'fixture',checked:true,dayUsed:1,dayLimit:30,windowUsed:1,windowLimit:9,windowMinutes:65}]}
    },
    './campaignDiagnosticsSchedule':scheduleRules,
    './aiRuntimeService':{callAiUsing:async(code,payload,meta,options)=>{aiCalls++;assert.equal(code,'app_campaign_diagnostics');assert.equal(options.expectedModel,'gpt-6.1-sol');assert(!Object.hasOwn(options,'systemInstructions'));assert(!Object.hasOwn(payload,'systemPromptOverride'));assert.equal(payload.bodyOverrides.reasoning.effort,'medium');assertNoCredentials(payload);assert.equal(JSON.parse(payload.diagnosticContext).facts.campaign.refreshData,true);return aiRuntime.callAiUsing(code,payload,meta,options)}}
  }
  // Exercise the same schedule/input functions used by the pending-reason path, not a passing stub.
  imports['./campaignPendingReasonService']=load('src/main/services/campaignPendingReasonService.ts',{
    ...imports,'../../shared/campaignPendingReason':load('src/shared/campaignPendingReason.ts')
  })
  const service=load('src/main/services/campaignDiagnosticsService.ts',imports)
  assert.notEqual(service.diagnosticCampaignVersion(campaign), service.diagnosticCampaignVersion({...campaign,refreshData:false}), 'Changing refreshData must invalidate the snapshot')
  const runtime={busyReason:()=>null,readinessReason:()=>null,configurationReason:()=>null,limitReason:async()=>null}
  const configured = { version:1, revision:1, rules:[{ campaignActionId:campaign.actionId, quantity:3, unit:'data' }] }
  for (const [settings, expected] of [
    [{ enabled:true, config:null },'missing'],
    [{ enabled:true, config:{ ...configured, rules:[] } },'invalid'],
    [{ enabled:true, config:{ ...configured, rules:[{ campaignActionId:'facebook_group_post', quantity:1, unit:'data' }] } },'excluded'],
    [{ enabled:true, config:configured },'included'],
    [{ enabled:false, config:null },'off']
  ]) {
    randomRun=settings; accountReads=0
    const snapshot=await service.collectCampaignDiagnostics(1,runtime,new AbortController().signal)
    assert.equal(snapshot.facts.facebookRandomRun.state,expected)
    const issue=snapshot.checks.find(x=>x.id==='randomRun')
    assert.equal(!!issue,['missing','invalid','excluded'].includes(expected))
    if(issue){ assert.equal(issue.problem,randomChecks.checkFacebookRandomConfiguration(settings,{id:campaign.actionId,name:'Nhắn tin UID'}).reason);assert.equal(issue.severity,'blocking');assert.deepEqual(issue.actions,['randomSettings']) }
    assert.equal(aiCalls,0)
  }
  randomRun={ enabled:true, config:null }; randomChange={ enabled:false, config:null }; accountReads=0
  await assert.rejects(service.collectCampaignDiagnostics(1,runtime,new AbortController().signal),/vừa thay đổi/)
  randomChange=null; randomRun=null; accountReads=0
  const unavailable=await service.collectCampaignDiagnostics(1,runtime,new AbortController().signal)
  assert.equal(unavailable.checks.find(x=>x.id==='randomRun').severity,'unknown');assert.equal(unavailable.complete,false)
  assert.notEqual(service.diagnosticCampaignVersion(campaign,{enabled:true,config:configured}),service.diagnosticCampaignVersion(campaign,{enabled:false,config:configured}))
  assert.notEqual(service.diagnosticCampaignVersion(campaign,{enabled:true,config:configured}),service.diagnosticCampaignVersion(campaign,{enabled:true,config:{...configured,revision:2}}))
  randomRun={enabled:false,config:null};accountReads=0
  console.log('PASS diagnostic/pending note parity, snapshot configuration, missing evidence, config races and no automatic AI')
  for(platform of ['facebook','zalo','email']) {
    const snapshot=await service.collectCampaignDiagnostics(1,runtime,new AbortController().signal)
    assert.equal(snapshot.quotas[0].windowMinutes,65);assert.equal(snapshot.version.length,64)
    assert(!JSON.stringify(snapshot).includes('never'));assert.equal(aiCalls,0)
    assertNoCredentials(snapshot);assert.equal(snapshot.facts.campaign.refreshData,true)
    assert.equal(snapshot.facts.schedule.evaluatedAt,dbNow)
    assert.equal(snapshot.facts.schedule.endDateState,'not_set')
    if(platform==='zalo')assert.equal(snapshot.checks.find(x=>x.id==='runtime').severity,'unknown')
  }
  // Reported case: weekly direct data, an older end date, two pending inputs and a paused campaign.
  const originalCampaign={...campaign}
  Object.assign(campaign,{schedule:'2026-10-14T10:37:00Z',originalSchedule:'2026-10-14T10:37:00Z',scheduleEndDate:'2026-10-12T16:59:59Z',status:'tạm dừng'})
  dbNow='2026-10-14T12:42:25Z'
  for(platform of ['facebook','zalo','email']) for(const source of ['direct','data_group']) {
    campaign.dataTargetSourceMode=source
    const snapshot=await service.collectCampaignDiagnostics(1,runtime,new AbortController().signal)
    const schedule=snapshot.checks.find(x=>x.id==='schedule')
    assert.equal(snapshot.facts.schedule.endDateState,'reached')
    assert.equal(snapshot.facts.schedule.endDatePolicy,source==='direct'?'completion_and_recurrence':'hard_end')
    assert.equal(snapshot.checks.find(x=>x.id==='runtime').severity,'info')
    assert.equal(schedule.severity,source==='direct'?'ok':'info')
    assert.equal(schedule.problem.includes('hết hạn'),source==='data_group')
    if(source==='direct')assert(schedule.explanation.includes('không tự chặn data còn chờ'))
  }
  campaign.dataTargetSourceMode='direct'
  campaign.schedule='2026-10-14T14:00:00Z'
  let snapshot=await service.collectCampaignDiagnostics(1,runtime,new AbortController().signal)
  assert(snapshot.checks.find(x=>x.id==='schedule').problem.includes('Chưa đến lịch chạy'))
  campaign.schedule='2026-10-14T10:37:00Z';campaign.dailyStopTime='19:00'
  snapshot=await service.collectCampaignDiagnostics(1,runtime,new AbortController().signal)
  assert(snapshot.checks.find(x=>x.id==='schedule').problem.includes('giờ dừng'))
  delete campaign.dailyStopTime
  campaign.dataTargetSourceMode='data_group';campaign.scheduleEndDate=dbNow
  snapshot=await service.collectCampaignDiagnostics(1,runtime,new AbortController().signal)
  assert.equal(snapshot.facts.schedule.endDateState,'reached')
  assert(snapshot.checks.find(x=>x.id==='schedule').problem.includes('hết hạn'))
  campaign.scheduleEndDate='2026-10-15T16:59:59Z'
  snapshot=await service.collectCampaignDiagnostics(1,runtime,new AbortController().signal)
  assert.equal(snapshot.facts.schedule.endDateState,'future')
  assert.equal(snapshot.checks.find(x=>x.id==='schedule').severity,'ok')
  for(const missing of ['clock','source','end']) {
    const saved={dbNow,source:campaign.dataTargetSourceMode,end:campaign.scheduleEndDate}
    if(missing==='clock')dbNow=null
    if(missing==='source')delete campaign.dataTargetSourceMode
    if(missing==='end')campaign.scheduleEndDate='invalid date'
    snapshot=await service.collectCampaignDiagnostics(1,runtime,new AbortController().signal)
    assert.equal(snapshot.checks.find(x=>x.id==='schedule').severity,'unknown')
    assert.equal(snapshot.complete,false)
    dbNow=saved.dbNow;campaign.dataTargetSourceMode=saved.source;campaign.scheduleEndDate=saved.end
  }
  for(const key of Object.keys(campaign))delete campaign[key]
  Object.assign(campaign,originalCampaign);dbNow='2026-10-14T03:00:00Z'
  console.log('PASS real schedule rules: direct vs Data Group expiry on three channels, pause, future time, cutoff, exact boundary and unknown evidence')
  logsFail=quotaFail=true
  const incomplete=await service.collectCampaignDiagnostics(1,runtime,new AbortController().signal)
  for(const id of ['limits','restrictions','history'])assert.equal(incomplete.checks.find(x=>x.id===id).severity,'unknown')
  assert.equal(incomplete.complete,false)
  const originalFetch=global.fetch
  let transportCalls=0
  global.fetch=async(_url,options)=>{
    transportCalls++
    assertNoCredentials(options.body)
    const instructions=JSON.parse(options.body).instructions
    assert(instructions.includes('"refreshData":true'))
    assert(instructions.startsWith(diagnosticPrompt.split('{{availableActions}}')[0]))
    const context=JSON.parse(instructions.split('BEGIN_UNTRUSTED_DIAGNOSTIC_SNAPSHOT\n')[1].split('\nEND_UNTRUSTED_DIAGNOSTIC_SNAPSHOT')[0])
    assert.equal(context.facts.schedule.endDatePolicy,'completion_and_recurrence')
    return {ok:true,status:200,text:async()=>JSON.stringify({output_text:JSON.stringify({summary:'Đã kiểm tra',issues:[]})})}
  }
  try {
    await service.analyzeDiagnosticsSnapshot(incomplete,new AbortController().signal)
    logsFail=quotaFail=false
    for (historyLog of historyLogs) {
      const snapshot = await service.collectCampaignDiagnostics(1,runtime,new AbortController().signal)
      assertNoCredentials(snapshot, 'Main IPC snapshot must be sanitized')
      assert.equal(snapshot.facts.campaignHistory.length,rpcHistory(historyLog).length)
      await service.analyzeDiagnosticsSnapshot(snapshot,new AbortController().signal)
      // Defense at the AI boundary also handles an older, unsanitized cached snapshot.
      const result = await service.analyzeDiagnosticsSnapshot({...snapshot,facts:{...snapshot.facts,campaignHistory:rpcHistory(historyLog)}},new AbortController().signal)
      assertNoCredentials(result, 'AI IPC result must not echo unsanitized history')
    }
  }
  finally { global.fetch=originalFetch }
  const expectedCalls=1+historyLogs.length*2
  assert.equal(aiCalls,expectedCalls);assert.equal(transportCalls,expectedCalls);assert.equal(aiLogs.length,expectedCalls)
  assertNoCredentials(aiLogs)
  assert(aiLogs[0].renderedSystemPrompt.includes('"refreshData":true'))
  assert(aiLogs[0].renderedSystemPrompt.startsWith(diagnosticPrompt.split('{{availableActions}}')[0]))
  console.log('PASS sanitized system prompt, outgoing AI request and AI log with refreshData retained (no network)')
  for (configChange of ['note','refreshData']) await assert.rejects(service.collectCampaignDiagnostics(1,runtime,new AbortController().signal),/thay đổi/)
  const controller=new AbortController();controller.abort();await assert.rejects(service.collectCampaignDiagnostics(1,runtime,controller.signal))
  console.log('PASS three channels, remote uncertainty, 65-minute quota, incomplete evidence, configuration races and explicit AI contract')
}
async function promptCompositionRegression() {
  let endpoint='https://diagnostics.invalid/v1/responses', systemTemplate=''
  const runtime=load('src/main/services/aiRuntimeService.ts',{'../data/repositories/aiRepository':{
    getAiUsingConfigByCode:async()=>({using:{id:1,timeoutMs:1000,requestOptions:{}},model:{id:1,model:'fixture',provider:'openai',endpoint,apiKey:'synthetic-key',defaultBody:{}},prompt:{id:1,promptSystem:systemTemplate,promptUser:'{{question}}'}}),
    createAiLog:async()=>1
  }})
  const originalFetch=global.fetch
  try {
    for(const path of ['responses','chat/completions'])for(const revision of ['v1', 'v2']) {
      endpoint='https://diagnostics.invalid/v1/'+path
      systemTemplate='DB rules '+revision+': {{question}}'
      global.fetch=async(_url,options)=>{
        const body=JSON.parse(options.body)
        const actual=path==='responses'?body.instructions:body.messages[0].content
        assert.equal(actual,'DB rules '+revision+': business data')
        return {ok:true,status:200,text:async()=>JSON.stringify({output_text:'ok'})}
      }
      await runtime.callAiUsing('existing-assistant',{question:'business data'}, {})
    }
  } finally {global.fetch=originalFetch}
  console.log('PASS Responses/Chat use the current DB prompt on each call, with no code prefix')
}
async function main(){
  sanitizationRegression();historyRedactionRegression();login();await campaignReadRegression()
  const clean=JSON.stringify(shared.sanitizeDiagnosticValue({password:'secret1',emailSession:{pass:'secret2'},details:{api_key:'secret3',zpw_sek:'secret4'},log:'Bearer abc123 cookie="private" https://user:pass@host/path?token=q sk-123456789',content:'Nội dung bình thường'}))
  for(const secret of ['secret1','secret2','secret3','secret4','abc123','private','user:pass','token=q','sk-123456789'])assert(!clean.includes(secret),secret)
  const good={summary:'Kiểm tra',issues:[{title:'Lịch',severity:'info',problem:'Chờ',cause:'Lịch',explanation:'Giờ',solution:'Sửa',actions:['schedule']}]}
  assert.equal(shared.parseDiagnosticAiResponse(JSON.stringify(good)).issues.length,1)
  assert.throws(()=>shared.parseDiagnosticAiResponse(JSON.stringify({...good,issues:[{...good.issues[0],actions:['execute_sql']}]})))
  assert.throws(()=>shared.parseDiagnosticAiResponse(JSON.stringify({...good,issues:[{...good.issues[0],cause:''}]})))
  console.log('PASS secret sanitization, structured five-part output and action allowlist')
  await boundary();login();await rules();await promptCompositionRegression()
}
main().catch(error=>{console.error(error);process.exitCode=1})
