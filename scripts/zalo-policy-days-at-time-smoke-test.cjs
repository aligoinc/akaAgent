// Actual mapper/repository/scheduler methods with local adapters; never calls Zalo or DB.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function functions(file, names, globals = {}, text = read(file)) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const code = names.map(name => {
    const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
    assert(node, name); return node.getText(source).replace(/^export /, '')
  }).join('\n')
  return new Function(...Object.keys(globals), compile(code) + ';return {' + names.join(',') + '}')(...Object.values(globals))
}
function schedulerMethods(names, globals) {
  const file = 'src/main/services/campaignScheduler.ts'
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
  const c = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CampaignScheduler')
  const code = names.map(name => {
    const node = c.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(source) === name)
    assert(node, name); return node.getText(source)
  }).join('\n')
  return new Function(...Object.keys(globals), compile('class Harness {' + code + '}') + ';return Harness')(...Object.values(globals))
}
const { getVietnamDayStart } = functions('src/shared/vietnamTime.ts', ['getVietnamDayStart'],
  { VIETNAM_TIME_ZONE: 'Asia/Ho_Chi_Minh', VIETNAM_UTC_OFFSET_MS: 25200000 })
const { resolveDaysAtTimeDateEnable: resolve } = functions('src/shared/actionDisableTime.ts', ['resolveDaysAtTimeDateEnable'],
  { getVietnamDayStart, DAY_MS: 86400000 })
const { mapAutoErrorPolicyFromDB: map } = functions('src/main/data/mappers.ts', ['mapAutoErrorPolicyFromDB'])
const desired = JSON.parse(read('migrations/snapshots/zalo-policy-v323/desired.json'))
const before = JSON.parse(read('migrations/snapshots/zalo-policy-v323/before.json')).rows
const legacy = JSON.parse(read('scripts/fixtures/zalo-policy-legacy-7dbba81.json'))
async function main() {
  const disabled = '2026-09-26T07:30:12.345Z' // 14:30:12.345 Vietnam
  for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
    process.env.TZ = zone
    for (const [now, days, time, expected] of [
      [disabled, 1, '09:45', '2026-09-27T02:45:00.000Z'],
      [disabled, 2, '09:45:00', '2026-09-28T02:45:00.000Z'],
      [disabled, 1, null, '2026-09-27T07:30:12.345Z'],
      [disabled, 2, null, '2026-09-28T07:30:12.345Z'],
      ['2026-09-26T16:50:00Z', 1, '00:00', '2026-09-26T17:00:00.000Z'],
      ['2026-09-26T17:10:00Z', 1, '09:45', '2026-09-28T02:45:00.000Z'],
      ['2026-12-31T10:00:00Z', 2, '09:45', '2027-01-02T02:45:00.000Z'],
      ['2028-02-28T12:00:00Z', 1, '09:45', '2028-02-29T02:45:00.000Z'],
      ['2027-02-28T12:00:00Z', 1, '09:45', '2027-03-01T02:45:00.000Z'],
      ['2026-09-26T00:00:00Z', 1, '09:45', '2026-09-27T02:45:00.000Z'],
      [disabled, 0, '15:00', '2026-09-26T08:00:00.000Z']
    ]) assert.equal(resolve(now, { days, time }), expected, zone)
  }
  for (const days of [-1, 1.5, null, undefined, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => resolve(disabled, { days, time: '09:45' }))
  }
  for (const time of ['', '24:00', '09:60', '09:45:60', '9:45', '09:45Z', 0, '09:45:00+07']) {
    assert.throws(() => resolve(disabled, { days: 1, time }))
  }
  for (const time of [null, '00:00', '09:45', '14:30:12.345']) {
    assert.throws(() => resolve(disabled, { days: 0, time }))
  }
  assert.throws(() => resolve('bad-clock', { days: 1, time: null }))
  console.log('PASS time boundaries, NULL vs midnight, invalid configs, three host timezones')

  let writes = [], snapshots = 0, clockReads = 0
  const client = () => ({ from(table) {
    assert.equal(table, 'auto_account_action_status')
    let data; const filters = {}
    const q = { update(value) { data = value; return q }, eq(k,v) { filters[k]=v;return q },
      then(ok,bad) { writes.push({data,filters});return Promise.resolve({error:null}).then(ok,bad) } }
    return q
  } })
  const repoGlobals = { client, resolveDaysAtTimeDateEnable: resolve,
    getAccountActionStatusSnapshot: async () => { snapshots++; return {clock:{dbNow:disabled}} } }
  const { disableAccountActions } = functions('src/main/data/repositories/accountActionRepository.ts', ['disableAccountActions'], repoGlobals)
  const oldMap = functions('legacy', ['mapAutoErrorPolicyFromDB'], {}, legacy.mapper).mapAutoErrorPolicyFromDB
  const oldDisable = functions('legacy', ['disableAccountActions'], repoGlobals, legacy.repository).disableAccountActions
  const futureClock = {nextVietnamMidnight:'2026-09-26T17:00:00.000Z'}
  const Harness = schedulerMethods([
    'resolvePolicyActionDisableContext','renderPolicyMessage','renderZaloPolicyCampaignNote','renderZaloPolicyLog',
    'applyZaloPolicySideEffects','applyRuntimeErrorPolicy','createZaloErrorDetail','zaloAddGroupMember',
    'checkActionDisabled','createMilestoneSummary','logZaloMessagePhoneMilestones'
  ], {IPC_EVENTS:{ACCOUNT_STATUS_UPDATED:'updated'}, ZALO_API_BUSINESS_FAILED_ERROR_CODE:'err_zalo_api_business_failed',
      ZALO_ADD_GROUP_MEMBER_ACTION_ID:'zalo_add_group_member'})
  let campaignWrites = []
  const h = Object.assign(new Harness(), {
    supabase: {disableAccountActions, getRuntimeClock:async () => {clockReads++;return futureClock}},
    mainWindow:{webContents:{send(){}}}, runCampaignErrorPolicy:async (_id,fn)=>fn(), throwIfZaloRuntimeStopping(){},
    updateErrorPolicyCampaign: async (campaign,patch) => {campaignWrites.push(patch);Object.assign(campaign,patch)},
    updateErrorPolicyAccount: async () => {throw Error('Unexpected account mutation')}, logCampaignProgress:async()=>{},
    addActionContextToMessage:x=>x, getZaloErrorMessage:e=>e.message, getZaloErrorCode:e=>e.code,
    normalizeZaloDetailStatus:x=>x || null, shouldCountZaloActionTowardBadTarget:(_a,p)=>p.countsTowardBadTarget,
    logZaloApiError:async()=>{}, firstNonEmptyString:(...values)=>values.find(v=>v) || ''
  })
  const config = (code,action) => desired.find(r=>r.zalo_error_codes.includes(code)&&r.zalo_action_codes.includes(action))
  for (const code of ['120','802']) for (const action of ['zalo_message_stranger','zalo_add_group_member']) {
    const row=config(code,action), policy=map(row), oldPolicy=oldMap(row)
    assert.equal(policy.disableActionMode,'days_at_time')
    assert.equal(oldPolicy.disableActionMode,'fixed_minutes')
    assert.equal(oldPolicy.timeDisableActions,code==='120'?1440:2880)
    writes=[]; snapshots=0
    await oldDisable(1,oldPolicy.disableActionCodes,oldPolicy.timeDisableActions,{dateEnable:undefined})
    assert.equal(writes[0].data.date_enable,code==='120'?'2026-09-27T07:30:12.345Z':'2026-09-28T07:30:12.345Z')
    for (const generic of [false,true]) {
      writes=[];snapshots=0;campaignWrites=[]
      h.supabase.getErrorPolicy=async()=>policy
      const c={id:2,name:'fixture',status:'đang chạy'}
      if (generic) await h.applyRuntimeErrorPolicy({id:1},c,policy.errorCode,action)
      else assert.equal((await h.applyZaloPolicySideEffects({id:1},c,policy,{runningProcess:'error',campaign:'error'})).stopAfterTarget,true)
      assert.equal(writes.length,1);assert.equal(snapshots,1);assert.equal(clockReads,0)
      assert.deepEqual(writes[0].filters,{account_id:1,action_code:action})
      assert.equal(writes[0].data.disabled_at,disabled)
      assert.equal(writes[0].data.date_enable,code==='120'?'2026-09-27T02:45:00.000Z':'2026-09-28T02:45:00.000Z')
    }
    const note=h.renderZaloPolicyCampaignNote({...policy,notiCampaign:'[x] / [t]'},'raw',{},'fallback')
    assert(!note.includes(String(oldPolicy.timeDisableActions)), 'new app must not report fallback minutes')
  }
  assert.deepEqual(await h.resolvePolicyActionDisableContext(map({disable_action_mode:'fixed_minutes'})),{})
  assert.deepEqual(await h.resolvePolicyActionDisableContext(map({disable_action_mode:'indefinite'})),{dateEnable:null})
  assert.deepEqual(await h.resolvePolicyActionDisableContext(map({disable_action_mode:'end_of_day'})),{dateEnable:futureClock.nextVietnamMidnight})
  writes=[]
  await assert.rejects(disableAccountActions(1,['a'],1440,{daysAtTime:{days:0,time:null}}))
  assert.equal(writes.length,0)
  await assert.rejects(disableAccountActions(1,['a'],1440,{daysAtTime:{days:1},dateEnable:null}))
  assert.equal(writes.length,0)
  console.log('PASS both scheduler sites + DB snapshot anchor; legacy source locks 24/48h; old modes retained')

  // Exercise actual scoped selection, including retired globals and unchanged phone/friend policies.
  const live=before.map(r=>[12,13].includes(r.id)?{...r,is_active:false,zalo_error_codes:[]}:r).concat(desired)
  const lookupClient=()=>({from(table) {
    assert.equal(table,'auto_error');const filters=[]
    const q={select:()=>q,contains:(k,v)=>{filters.push(r=>v.every(x=>r[k].includes(x)));return q},
      eq:(k,v)=>{filters.push(r=>r[k]===v);return q},
      then:(ok,bad)=>Promise.resolve({data:live.filter(r=>filters.every(f=>f(r))),error:null}).then(ok,bad)}
    return q
  }})
  const {getZaloErrorPolicyByCode: lookup}=functions('src/main/data/repositories/errorPolicyRepository.ts',
    ['getZaloErrorPolicyByCode'],{client:lookupClient,mapAutoErrorPolicyFromDB:map})
  h.getZaloPolicyByErrorCode=lookup
  assert.equal(desired.length,18)
  const seen=new Set()
  for (const row of desired) for (const code of row.zalo_error_codes) for (const action of row.zalo_action_codes) {
    const key=code+'|'+action;assert(!seen.has(key));seen.add(key)
    assert.equal((await lookup(code,action)).errorCode,row.error_code)
    assert(row.disable_action_codes.length===0 || (row.zalo_action_codes.length===1&&row.disable_action_codes[0]===action))
  }
  for (const [code,action] of [['120','zalo_message_friend'],['802','zalo_add_friend'],['127','zalo_add_group_member']]) {
    assert.equal(await lookup(code,action),null,'no cross-action global fallback')
  }
  for (const [action,expected] of [['zalo_find_phone_user','err_zalo_find_phone_limit'],['zalo_add_friend','err_zalo_add_friend_limit'],
    ['zalo_message_group','err_zalo_221_message_group']]) {
    const p=await lookup('221',action);assert.equal(p.errorCode,expected);assert.equal(p.timeDisableActions,60)
  }
  writes=[];campaignWrites=[]
  const c={id:10,status:'đang chạy'}, d=await h.createZaloErrorDetail({id:1},c,{code:'223',message:'223'},'zalo_add_friend','Kết bạn')
  assert.equal(c.status,'tạm dừng');assert.equal(writes.length,0)
  assert.equal(d.stopAfterTarget,true);assert.equal(d.resetInputToPending,true);assert.equal(d.createDetail,false)
  assert.equal(d.countsTowardLimit,false);assert.equal(d.countsTowardBadTarget,false)
  assert.equal(config('223','zalo_add_friend').disable_action_days,null)
  h.getZaloActionDetailFromStep=step=>step.detail
  h.formatZaloProgressLog=detail=>detail.log || ''
  for (const details of [
    [{createDetail:false,deliveryCommitted:true},d],
    [d,{createDetail:false,deliveryCommitted:true}],
    [{createDetail:false,preventInputRetry:true},d]
  ]) {
    const result=await h.logZaloMessagePhoneMilestones(c,null,1,
      details.map((detail,i)=>({blockName:'zalo_step_'+i,nodeId:String(i),detail})))
    assert.equal(result.resetInputToPending,false,'committed/partial delivery cannot be retried')
    assert.equal(result.preventInputRetry,true)
    assert.equal(result.stopAfterTarget,true)
  }
  const noDelivery=await h.logZaloMessagePhoneMilestones(c,null,1,[{blockName:'zalo_add_friend',detail:d}])
  assert.equal(noDelivery.resetInputToPending,true)
  const phonePolicy=await lookup('221','zalo_find_phone_user')
  writes=[]
  await h.applyZaloPolicySideEffects({id:1},c,phonePolicy,{runningProcess:'phone',campaign:'phone'})
  h.supabase.getAccountActionDisabledStatus=async (id,actionCode)=>({
    ok:!writes.some(w=>w.filters.account_id===id&&w.filters.action_code===actionCode),actionCode
  })
  for (const actions of [
    [{code:'zalo_find_phone_user'}],
    [{code:'zalo_message_stranger'},{code:'zalo_find_phone_user'}],
    [{code:'zalo_add_group_member'},{code:'zalo_find_phone_user'}]
  ]) assert.equal((await h.checkActionDisabled({id:1},actions)).ok,false,'shared phone lookup lock')
  assert.equal(await h.checkActionDisabled({id:2},[{code:'zalo_find_phone_user'}]),null,'another account unaffected')
  const personal=await lookup('126','zalo_message_friend');assert.deepEqual(personal.disableActionCodes,[])
  for (const code of ['120','802','126']) {
    h.zaloRuntime={addMemberToGroup:async()=>{throw {code,message:code}}}
    const result=await h.zaloAddGroupMember({id:1},{id:22},{target:{uid:'target'},targetGroupId:'g123'})
    assert.equal(result.detail.countsTowardLimit,false,'existing add-member override')
    assert.equal(result.detail.stopAfterTarget,true)
    assert.equal(result.detail.createDetail,code!=='120')
  }
  console.log('PASS 18 scoped policies, 223 pause/no lock, 221 unchanged scopes, add-member quota override')
}
main().catch(error=>{console.error(error);process.exitCode=1})
