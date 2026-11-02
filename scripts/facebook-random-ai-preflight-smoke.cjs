// Actual scheduler/repository code; local HTTP adapter, no DB/provider/Facebook writes.
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')
const { schedulerClass } = require('./campaign-media-timeout-smoke-test.cjs')
const { loadShared, fixture: executionFixture } = require('./facebook-page-content-rotation-smoke-test.cjs')
const shared = loadShared('src/shared/facebookRandomRun.ts')
const now = '2026-11-02T03:00:00Z'

async function inventoryContract() {
  const source = ts.createSourceFile('campaignRepository.ts', fs.readFileSync('src/main/data/repositories/campaignRepository.ts', 'utf8'), ts.ScriptTarget.Latest, true)
  const reader = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'getPendingCampaignsForRandomAi')
  const code = ts.transpileModule(reader.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  let requests = 0
  const parents = [1, 2, 3, 4].map(id => ({ id }))
  // A due item after 10,000 completed rows must not disappear behind a page limit.
  const inputs = Array.from({ length: 10000 }, (_,i) => ({ id:i+1, campaign_id:1, status:'hoàn thành', is_delete:false }))
  inputs.push({ id:10001, campaign_id:1, status:'chờ xử lý', is_delete:false },
    { id:10002, campaign_id:2, status:'chờ xử lý', is_delete:false, schedule:'2026-11-03T01:00:00Z' },
    { id:10003, campaign_id:4, status:'chờ xử lý', is_delete:true })
  const client = createClient('https://fixture.invalid', 'fixture', { auth:{ persistSession:false, autoRefreshToken:false }, global:{ fetch: async url => {
    requests++
    const q = new URL(url).searchParams
    assert.equal(q.get('limit'), '500')
    assert.equal(q.get('account_id'), 'eq.8'); assert.equal(q.get('staff_id'), 'eq.1'); assert.equal(q.get('organization_id'), 'eq.2')
    assert.equal(q.get('status'), 'eq.chờ xử lý'); assert.equal(q.get('provisioning_state'), 'eq.ready')
    assert.equal(q.get('schedule'), 'lte.' + now.replace('Z', '.000Z'))
    assert(!q.get('select').includes('*')); assert(!q.get('select').includes('!inner'))
    for (const alias of ['random_any_input', 'random_due_input']) {
      assert(q.get('select').includes(alias+':auto_campaign_input_data!auto_campaign_input_data_campaign_id_fkey(id)'))
      assert.equal(q.get(alias+'.limit'), '1'); assert.equal(q.get(alias+'.is_delete'), 'eq.false')
    }
    assert.equal(q.get('random_due_input.status'), 'eq.chờ xử lý')
    assert.equal(q.get('random_due_input.or'), '(schedule.is.null,schedule.lte.'+now.replace('Z','.000Z')+')')
    const after = Number(q.get('id').slice(3))
    const data = parents.filter(c => c.id > after).map(c => {
      const own = inputs.filter(i => i.campaign_id === c.id && !i.is_delete)
      return { ...c, random_any_input:own.slice(0,1).map(i=>({id:i.id})),
        random_due_input:own.filter(i=>i.status==='chờ xử lý' && (!i.schedule || i.schedule<=now)).slice(0,1).map(i=>({id:i.id})) }
    })
    return new Response(JSON.stringify(data), { status:200, headers:{'content-type':'application/json'} })
  } } })
  const exports = {}
  new Function('exports','requireCurrentUser','parseDatabaseNow','formatVietnamTimeForQuery','client','mapCampaignFromDB',code)(
    exports,()=>({staffId:1,organizationId:2}),v=>new Date(v),()=> '10:00:00',()=>client,r=>({id:r.id}))
  const result = await exports.getPendingCampaignsForRandomAi(8, now)
  assert.deepEqual(result.map(c=>c.randomRunInput), [{any:true,due:true},{any:true,due:false},{any:false,due:false},{any:false,due:false}])
  assert.equal(requests,2)
}

function schedulerFixture(count, { lateQuota = false, lateCatalog = false } = {}) {
  const account = {id:8, flatformType:'facebook', status:'chờ xử lý', loginStatus:'đã đăng nhập', isActive:true}
  const config = { version:2, mode:'ai', revision:1, rules:[] }
  const campaigns = Array.from({length:count}, (_,i)=>({id:i+1,accountId:8,actionId:'facebook_group_post',name:'C'+i,
    status:'chờ xử lý',isDelete:false,schedule:'2026-11-02T01:00:00Z',extraSettings:{},randomRunInput:{any:true,due:true}}))
  const bad = {...campaigns[0],id:10000,extraSettings:{advancedContentEnabled:true,advancedContentItems:[]}}
  let blocked = false
  let actionActive = true
  const stats = { inventory:0, action:0, data:0, disabled:0, quota:0, execute:0, plans:0, finishes:0 }
  const Scheduler = schedulerClass({}, {
    '../../shared/facebookRandomRun':shared,
    '../../shared/advancedContent':loadShared('src/shared/advancedContent.ts'),
    '../../shared/facebookGroupPostShare':loadShared('src/shared/facebookGroupPostShare.ts'),
    '../data/repositories/entitlementRepository':{ensureCurrentUserCanUseCampaignAction:async()=>{},loadCurrentUserEffectiveEntitlements:async()=>({})},
    '../data/repositories/campaignRepository':{getPendingCampaignsForRandomAi:async()=>{stats.inventory++;return [bad,...campaigns]}},
    './facebookRandomAiService':{ensureFacebookRandomAiPlan:async()=>true},
    './accountOperationRegistry':{accountOperationRegistry:{has:()=>false}},
    '../data/repositories/facebookRandomRunRepository':{
      getRandomSettings:async()=>({enabled:true,config}),
      planAiRandomTurn:async(_id,_rev,ids)=>{
        assert(!ids.includes(bad.id),'invalid content never enters allocation')
        if (!ids.length) return {enabled:true,config,turns:[]}
        stats.plans++
        if(lateQuota) blocked=true
        if(lateCatalog) actionActive=false
        return {enabled:true,config,turns:[{id:String(stats.plans),campaignId:stats.plans,revision:1,unit:'data',quantity:1,processed:0}]}
      },
      finishRandomTurn:async(_id,turn,reason)=>{stats.finishes++;return {...turn,status:reason?'stopped':'completed'}}
    }
  })
  const s = new Scheduler({
    getAccount:async()=>account,getCampaign:async id=>campaigns.find(c=>c.id===id),
    getCampaignAction:async()=>{stats.action++;return {isActive:actionActive,isDelete:false}},
    listCampaignInputData:async()=>{stats.data++;return [{status:'chờ xử lý',isDelete:false}]},
    peekAccountActionDisabledStatus:async()=>{stats.disabled++;return {ok:true}},
    peekAccountRateLimitStatus:async()=>{stats.quota++;return {ok:!blocked}}
  }, {}, {webContents:{send(){}}})
  Object.assign(s,{running:true,getReadyRuntimeClock:async()=>({dbNow:now}),resolveCampaignWorkflow:()=>({workflowId:1}),
    getCampaignPreflightActionDescriptors:()=>({executable:[{code:'fb_post_group',name:'Đăng nhóm'}],quota:[{code:'fb_post_group',name:'Đăng nhóm'}]}),
    getActionLimitConfig:(_code,limits)=>({dailyLimit:limits?.dailyLimit??100,rateLimitCount:9,rateLimitMinutes:65}),
    buildLimitPreflightNote:async()=> 'Đạt giới hạn',browseAfterCampaign:async()=>{},hasFailedAccountRun:()=>false,logCampaignProgress:async()=>{},
    executeCampaign:async(_a,c)=>{s.facebookRandomTurns.get(c.id).processed=1;if(++stats.execute===count)s.running=false}
  })
  return {s,account,campaigns,bad,stats,setBlocked:value=>{blocked=value}}
}

async function main() {
  await inventoryContract()
  const f = schedulerFixture(20)
  await f.s.runFacebookRandomQueue(f.account)
  assert.deepEqual(f.stats,{inventory:20,action:40,data:20,disabled:40,quota:40,execute:20,plans:20,finishes:20})
  // Content errors remain runnable again immediately after the user repairs them.
  const inventory = {dbNow:now,actions:new Map(),limits:new Map(),input:{any:true,due:true}}
  assert.match(await f.s.randomCampaignBlockedReason(f.account,f.bad,true,inventory),/nội dung nâng cao/)
  const fixed = {...f.bad,extraSettings:{advancedContentEnabled:false}}
  assert.equal(await f.s.randomCampaignBlockedReason(f.account,fixed,true,inventory),null)
  // Runtime also confirms the original case stops before admitting any unit.
  const run = executionFixture({actionId:'facebook_group_post',extra:f.bad.extraSettings})
  run.scheduler.getAdvancedContentConfigError=(c,media)=>f.s.getAdvancedContentConfigError(c,media)
  let units=0
  run.scheduler.beginCampaignRunUnit=async()=>{units++;return true}
  await run.run();assert.equal(units,0);assert.equal(run.saved().status,'chờ xử lý')
  // Cached reads are per inventory/config, not per action forever.
  const before=f.stats.quota, reads=new Map()
  const descriptor=[{code:'fb_post_group',name:'Đăng nhóm'}]
  await f.s.checkActionLimits(f.account,fixed,descriptor,{dailyLimit:5},true,reads)
  await f.s.checkActionLimits(f.account,fixed,descriptor,{dailyLimit:5},true,reads)
  await f.s.checkActionLimits(f.account,fixed,descriptor,{dailyLimit:7},true,reads)
  assert.equal(f.stats.quota-before,2)
  f.setBlocked(true)
  assert.equal(await f.s.checkActionLimits(f.account,fixed,descriptor,{dailyLimit:5},true,reads),null)
  assert.equal((await f.s.checkActionLimits(f.account,fixed,descriptor,{dailyLimit:5},true)).ok,false)
  // A quota change after planning must be observed by selected-campaign validation.
  const late=schedulerFixture(1,{lateQuota:true})
  await late.s.runFacebookRandomQueue(late.account)
  assert.equal(late.stats.execute,0);assert.equal(late.stats.finishes,1);assert.equal(late.stats.quota,2)
  const revoked=schedulerFixture(1,{lateCatalog:true})
  await revoked.s.runFacebookRandomQueue(revoked.account)
  assert.equal(revoked.stats.execute,0);assert.equal(revoked.stats.finishes,1);assert.equal(revoked.stats.action,2)
  const allInvalid=schedulerFixture(1)
  allInvalid.campaigns[0].extraSettings=allInvalid.bad.extraSettings
  await allInvalid.s.runFacebookRandomQueue(allInvalid.account)
  assert.equal(allInvalid.stats.execute,0);assert.equal(allInvalid.stats.plans,0);assert.equal(allInvalid.stats.inventory,1)
  // Left-embed semantics preserve empty suggested-friend campaigns, but not exhausted data.
  const suggested={...fixed,actionId:'facebook_message_uid',extraSettings:{useSuggestedFriends:true}}
  f.setBlocked(false)
  for(const [input,allowed] of [[{any:false,due:false},true],[{any:true,due:false},false],[{any:true,due:true},true]]) {
    const reason=await f.s.randomCampaignBlockedReason(f.account,suggested,true,{dbNow:now,actions:new Map(),limits:new Map(),input})
    assert.equal(reason===null,allowed)
  }
  const invite={...fixed,actionId:'facebook_group_invite',extraSettings:{}}
  assert.match(await f.s.randomCampaignBlockedReason(f.account,invite,true),/chọn group/)
  const continuingReads=new Map(),beforeContinuing=f.stats.quota
  for(let i=0;i<2;i++) {
    const result=await f.s.checkActionLimitsForContinuation(f.account,fixed,descriptor,{continueWhenActionLimitReached:true},true,continuingReads)
    assert.equal(result.limitStatus,null)
  }
  assert.equal(f.stats.quota-beforeContinuing,1)
  console.log(JSON.stringify({inventoryTransport:'pass',past10000Inputs:true,fullDataReads:{before:420,after:20},actionReads:{before:420,after:40},quotaRecheck:true,invalidContentExcluded:true,externalCalls:0}))
}
main().catch(e=>{console.error(e);process.exitCode=1})
