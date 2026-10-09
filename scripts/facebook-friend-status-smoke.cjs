// Local Electron DOM + real block executor + extracted production scheduler methods.
// No Facebook requests, DB writes, or real friend requests.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
if (!process.versions.electron) {
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', timeout: 90000 })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow } = require('electron')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const baseline = require('./fixtures/facebook-friend-status-live.json')
const migration = read('migrations/migration_v360_facebook_friend_cancel_commit.sql')
const code = migration.split('$friend_code$')[1]
assert(code.includes(baseline.block.code), 'legacy fallback is the exact live body')
assert(!/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|NOTIFY\s+pgrst|CREATE\s+TABLE/i.test(migration))
const transpile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function compile(file, mocks = {}) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', transpile(read(file)))(name => {
    if (name in mocks) return mocks[name]
    if (name.startsWith('.')) throw Error('Unexpected dependency: ' + name)
    return require(name)
  }, module, module.exports)
  return module.exports
}
const { PageController } = compile('src/main/v2/runtime/pageController.ts')
const { BlockExecutor } = compile('src/main/v2/runtime/blockExecutor.ts', {
  './blockHelpers': { createBlockHelpers: (log, runtime) => ({ log, ...runtime }) }
})
const { mapAutoErrorPolicyFromDB } = compile('src/main/data/mappers.ts', { './currentUser': {} })
const schedulerText = read('src/main/services/campaignScheduler.ts')
const source = ts.createSourceFile('scheduler.ts', schedulerText, ts.ScriptTarget.Latest, true)
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CampaignScheduler')
const names = ['logFacebookFriendMilestone', 'createMilestoneSummary', 'recordMilestoneSummary',
  'normalizeRuntimeError', 'applyRuntimeErrorPolicy', 'handleCampaignBadTarget', 'getPolicyThreshold',
  'runCampaignErrorPolicy', 'renderPolicyMessage', 'addActionContextToMessage', 'resolvePolicyActionDisableContext',
  'getMilestoneBadReason', 'getMilestoneBadRootReason']
const methods = names.map(name => cls.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(source) === name).getText(source)).join('\n')
const start = schedulerText.indexOf('          if (!accountStopReason && !pauseCancelledRun && !runtimeModeStopRequested) {')
const end = schedulerText.indexOf('          if (milestoneSummary.stopAfterTarget', start)
// Execute the actual target-finalization path too, including mixed failures/reset.
const finish = `async finishTarget(milestoneSummary, result={status:'completed',steps:[]}) {
  const account={id:2}, campaign={id:1,actionId:'facebook_message_uid',name:'Fixture'}, detail={id:3};
  const accountStopReason=false,pauseCancelledRun=false,runtimeModeStopRequested=false;
  const executableTargetActionDescriptors=[{code:'fb_message_stranger'}];
  let runtimeStopTriggered=false,shouldStopAfterTarget=false;
  ${schedulerText.slice(start, end)}
  return {runtimeStopTriggered,shouldStopAfterTarget};
}`
// Exercise the actual input finalization, including account-stop and pause.
const settleStart = schedulerText.indexOf('          const committedDeliveryMustNotRetry =')
const settle = `async settleInput(milestoneSummary, result, options={}) {
  const account={id:2}, campaign={id:1,actionId:'facebook_message_uid',name:'Fixture'}, detail={id:3};
  const accountStopReason=options.accountStopReason||null, pauseCancelledRun=!!options.pauseCancelledRun;
  const runtimeModeStopRequested=false,runtimeStopReason=null,zaloOptOutContext=null;
  const consumedGroupPostInputDataIds=new Set();let shouldStopAfterTarget=false;
  ${schedulerText.slice(settleStart,start)}
  return {shouldStopAfterTarget,consumed:[...consumedGroupPostInputDataIds]};
}`
const Scheduler = new Function('IPC_EVENTS', 'PAGE_INBOX_MESSAGE_ACTION_ID', 'COMMENT_FREQUENCY_LIMIT_ERROR_CODE',
  'GROUP_POST_ACTION_ID', 'GROUP_POST_FREQUENCY_LIMIT_ERROR_CODE', 'CAMPAIGN_PAUSE_PENDING_NOTE',
  transpile('class Harness {' + methods + finish + settle + '}') + ';return Harness')({}, 'facebook_page_to_message',
  'err_comment_frequency_limit', 'facebook_group_post', 'err_post_frequency_limit', 'Đã tạm dừng')
const helperSource = ts.createSourceFile('helpers.ts', read('src/main/v2/runtime/blockHelpers.ts'), ts.ScriptTarget.Latest, true)
let sleepMethod
function findSleep(node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(helperSource) === 'sleep' && node.body) sleepMethod = node
  ts.forEachChild(node, findSleep)
}
findSleep(helperSource)
const realSleep = new Function('return ' + transpile('({' + sleepMethod.getText(helperSource) + '})'))().sleep
const selectors = {
  fb_add_friend_button: '//*[@role="button" and .="Thêm bạn bè"]',
  fb_friend_request_sent_button: "//*[@role='button' and .='Hủy lời mời']",
  fb_accept_friend_request_button: "//*[@role='button' and .='Chấp nhận lời mời']",
  fb_already_friend_button: "//*[@role='button' and .='Bạn bè']"
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akaagent-friend-status-'))
app.setPath('userData', directory)
app.disableHardwareAcceleration()
let win
async function run(labels, options = {}) {
  const html = '<style>button{display:block;width:200px;height:40px}</style>' + labels.map(label =>
    `<button role="button" ${options.hidden ? 'style="display:none"' : ''} onclick="this.dataset.clicked='true'">${label}</button>`).join('')
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const page = new PageController(win.webContents)
  const stats = { probes: [], clicks: [], sleeps: [], elements: [] }
  const abort = new AbortController()
  if (options.cancel) abort.abort()
  const wait = page.waitForSelector.bind(page), evaluate = page.evaluate.bind(page), click = page.click.bind(page)
  page.waitForSelector = async (selector, opts) => wait(selector, { ...opts, timeout: 30 })
  page.evaluate = async (js, ...args) => {
    stats.probes.push(args[0])
    if (options.probeFails) throw Error('DOM unavailable')
    return evaluate(js, ...args)
  }
  page.click = async selector => {
    stats.clicks.push(selector)
    if (options.cancelClickFailure) { abort.abort(); throw Error('Click interrupted') }
    if (options.clickFails) throw Error('Click failed')
    await click(selector)
    if (options.cancelAfterClick) abort.abort()
  }
  const helpers = {
    log: () => {},
    element: async name => { stats.elements.push(name); assert(name in selectors); return selectors[name] },
    sleep: async ms => {
      stats.sleeps.push(ms)
      if (options.cancelDuringSleep) setImmediate(() => abort.abort())
      if (options.cancelAfterClick || options.cancelDuringSleep) await realSleep(ms, abort.signal)
    }
  }
  const result = await new BlockExecutor().execute({ code, blockName: 'fb_add_friend' }, {
    input: {}, page, vars: options.legacy ? {} : { facebookFriendOutcomeVersion: 1 },
    signal: abort.signal, runtimeHelpers: helpers
  })
  assert.equal(result.success, true)
  const clickedElements = await evaluate("return document.querySelectorAll('[data-clicked=true]').length")
  return { output: result.output, stats, clickedElements }
}
const policies = Object.fromEntries(baseline.policies.map(row => [row.error_code, mapAutoErrorPolicyFromDB(row)]))
function harness(overrides = {}) {
  const stats = { details: [], policies: [], writes: [], inputs: [], stops: [], accounts: [], disables: [], increments: 0, resets: 0, logs: [] }
  let count = overrides.initialCount || 0
  const scheduler = Object.assign(new Scheduler(), {
    failedRunErrorPolicies: new Map(), attemptedRunErrorPolicies: new Set(),
    getInputDataDisplayName: () => 'Người nhận', getMessageActionCode: () => 'fb_message_stranger',
    getCampaignExecutableActionDescriptors: () => [{code:'fb_message_stranger'}],
    isNewsfeedDailyCampaign: () => false, diagnoseUndefinedErrorWithScreenshot: async () => null,
    resetCampaignBadTargetCount: async () => { stats.resets++; count=0 },
    withZaloMessageOptOutWarnings: note => note,
    stopCampaignForAccountCondition: async (...args) => stats.stops.push(args),
    supabase: {
      getErrorPolicy: async key => { stats.policies.push(key); if (overrides.lookupFails) throw Error('Policy unavailable'); return key in overrides ? overrides[key] : policies[key] },
      createCampaignDetail: async detail => { stats.details.push(detail); return detail },
      updateCampaignInputData: async (id, patch) => stats.inputs.push({id,...patch}),
      incrementCampaignBadTargetCount: async () => { stats.increments++; return {countConsecutiveBadTargets:++count} },
      disableAccountActions: async (...args) => stats.disables.push(args)
    },
    updateErrorPolicyCampaign: async (_campaign, patch) => stats.writes.push(patch),
    updateErrorPolicyAccount: async (_account, _campaign, patch) => stats.accounts.push(patch),
    logCampaignProgress: async (_campaign, log) => stats.logs.push(log),
    mainWindow: { webContents: { send: () => {} } }
  })
  const summary = scheduler.createMilestoneSummary()
  const log = output => scheduler.logFacebookFriendMilestone({ id:1,actionId:'facebook_message_uid' }, {id:3}, 2,
    {status:'success',blockName:'fb_add_friend',output},summary)
  return { scheduler, stats, summary, log }
}
async function main() {
  await app.whenReady()
  win = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}})
  const outputs = {}
  for (const [labels, outcome, clicks] of [
    [['Hủy lời mời','Chấp nhận lời mời','Bạn bè','Thêm bạn bè'],'already_requested',0],
    [['Chấp nhận lời mời','Bạn bè','Thêm bạn bè'],'accepted',1],
    [['Bạn bè','Thêm bạn bè'],'already_friend',0],
    [['Thêm bạn bè'],'request_sent',1],
    [[], 'unavailable',0]
  ]) {
    const result = await run(labels)
    assert.equal(result.output.outcome,outcome)
    assert.equal(result.stats.clicks.length,clicks)
    if(clicks) assert.deepEqual(result.stats.sleeps,[2000])
    outputs[outcome]=result.output
  }
  assert.equal((await run(['Bạn bè'], {hidden:true})).output.outcome,'already_friend','raw C# probe includes hidden matches')
  for(const label of ['Chấp nhận lời mời','Thêm bạn bè']) {
    const result=await run([label],{clickFails:true})
    assert.equal(result.output.outcome,'failed')
    assert.equal(result.output.errorCode,'err_undefined')
    assert.equal(result.stats.clicks.length,1,'no send retry')
  }
  assert.equal((await run([],{probeFails:true})).output.outcome,'failed','DOM failure is not missing button')
  const cancelled=await run(['Thêm bạn bè'],{cancel:true})
  assert.equal(cancelled.output.outcome,'cancelled'); assert.equal(cancelled.stats.clicks.length,0)
  for (const [label,outcome] of [['Thêm bạn bè','request_sent'],['Chấp nhận lời mời','accepted']]) {
    for (const options of [{cancelAfterClick:true},{cancelDuringSleep:true}]) {
      const committed=await run([label],options)
      assert.equal(committed.clickedElements,1)
      assert.equal(committed.output.outcome,outcome)
      assert.equal(committed.output.ok,true)
      assert.equal(committed.output.clicked,true)
      for (const stop of [{},{pauseCancelledRun:true},{accountStopReason:'Tài khoản bị dừng'}]) {
        const h=harness(), result={status:'cancelled',steps:[]}
        await h.log(committed.output)
        await h.scheduler.settleInput(h.summary,result,stop)
        assert.equal(h.stats.details.length,1)
        assert.equal(h.stats.details[0].shouldCountAction,true)
        assert.equal(h.stats.inputs.length,1)
        assert.equal(h.stats.inputs[0].status,'hoàn thành','committed click must never be requeued')
        assert.match(h.stats.inputs[0].note,/không tự chạy lại/)
        if (!stop.accountStopReason && !stop.pauseCancelledRun) {
          await h.scheduler.finishTarget(h.summary,result)
          assert.equal(h.stats.increments,0,'post-click cancellation is not an undefined error')
          assert.equal(h.stats.policies.length,0)
        }
      }
    }
    const failed=await run([label],{cancelClickFailure:true})
    assert.equal(failed.clickedElements,0)
    assert.equal(failed.output.outcome,'cancelled','an unconfirmed click is not success')
  }
  for(const stop of [{pauseCancelledRun:true},{accountStopReason:'Tài khoản bị dừng'}]) {
    const h=harness(); await h.log(cancelled.output)
    await h.scheduler.settleInput(h.summary,{status:'cancelled',steps:[]},stop)
    assert.equal(h.stats.details.length,0)
    assert.equal(h.stats.inputs[0].status,'chờ xử lý','pre-click cancellation remains retryable')
  }
  const legacy=await run([],{legacy:true})
  assert.equal(legacy.output.alreadyFriend,true); assert.equal(legacy.output.outcome,undefined)
  assert.deepEqual(legacy.stats.elements,['fb_add_friend_button'],'old clients never need new selectors')
  console.log('PASS DOM states, C# order, hidden raw matches, click failures, cancellation, legacy clients')

  for(const outcome of ['already_requested','already_friend','accepted','request_sent']) {
    const h=harness(); await h.log(outputs[outcome]); await h.scheduler.finishTarget(h.summary)
    const skipped=outcome.startsWith('already_')
    assert.equal(h.stats.details[0].shouldCountAction,!skipped)
    assert.equal(h.stats.details[0].status,skipped ? outcome==='already_friend'?'đã là bạn bè':'đã gửi lời mời' : 'thành công')
    assert.equal(h.stats.policies.length,0,'normal results are not errors')
    assert.equal(h.stats.increments,0); assert.equal(h.stats.resets,skipped?0:1)
  }
  {
    const h=harness(); await h.log(outputs.unavailable); const result=await h.scheduler.finishTarget(h.summary)
    assert.equal(h.stats.details[0].errorCode,'err_fb_add_friend_unavailable')
    assert.equal(h.stats.details[0].status,'thất bại'); assert.equal(h.stats.details[0].shouldCountAction,false)
    assert.equal(h.stats.increments,0); assert.equal(h.stats.resets,0); assert.equal(result.shouldStopAfterTarget,false)
    assert.equal(h.stats.writes.length,0); assert.equal(h.stats.disables.length,0)
    assert.deepEqual(h.stats.policies,['err_fb_add_friend_unavailable'],'one policy snapshot')
  }
  // Flipping DB policy bits changes runtime behavior without changing the block.
  for(const countLimit of [false,true]) for(const countBad of [false,true]) {
    const p={...policies.err_fb_add_friend_unavailable,countsTowardLimit:countLimit,countsTowardBadTarget:countBad,
      countConsecutiveErrors:2,updateStatusCampaign:'tạm dừng',disableActionCodes:['fb_add_friend'],timeDisableActions:37,
      updateLoginStatus:'chưa đăng nhập'}
    const h=harness({err_fb_add_friend_unavailable:p,initialCount:1})
    await h.log(outputs.unavailable)
    // A settings change after the result must not split quota/count/side effects.
    h.scheduler.supabase.getErrorPolicy=async()=>{throw Error('Unexpected second policy read')}
    const result=await h.scheduler.finishTarget(h.summary)
    assert.equal(h.stats.details[0].shouldCountAction,countLimit)
    assert.equal(h.stats.increments,countBad?1:0)
    assert.equal(h.stats.resets,0); assert.equal(result.shouldStopAfterTarget,true)
    assert.deepEqual(h.stats.disables[0].slice(0,3),[2,['fb_add_friend'],37])
    assert.equal(h.stats.writes[0].status,'tạm dừng')
    assert.equal(h.stats.accounts[0].loginStatus,'chưa đăng nhập')
  }
  {
    const h=harness(); await h.log({ok:false,outcome:'failed',error:'Click failed'})
    h.summary.hasSuccess=true // Message succeeded, friend request failed.
    await h.scheduler.finishTarget(h.summary)
    assert.equal(h.stats.increments,1); assert.equal(h.stats.resets,0)
    assert.equal(h.stats.writes.length,0,'err_undefined threshold not reached')
    assert.equal(h.stats.details[0].shouldCountAction,true)
  }
  {
    const h=harness(); await h.log({ok:false,outcome:'failed',error:'Click failed'})
    h.summary.hasFailure=true; h.summary.hasHardFailure=true
    await h.scheduler.finishTarget(h.summary)
    assert.equal(h.stats.increments,1,'two failed actions count as one bad target')
  }
  for (const nextStatus of [null,'chờ xử lý','giới hạn giờ','tạm dừng']) {
    const h=harness({initialCount:3,err_fb_add_friend_unavailable:{...policies.err_fb_add_friend_unavailable,
      disableActionCodes:['fb_add_friend'],timeDisableActions:17,updateStatusCampaign:nextStatus,
      updateStatusAccount:'tạm dừng',updateLoginStatus:'chưa đăng nhập'}})
    await h.log(outputs.unavailable)
    h.summary.hasHardFailure=true;h.summary.hasFailure=true;h.summary.failureReasons=['Nhắn tin thất bại']
    const result=await h.scheduler.finishTarget(h.summary)
    assert.equal(result.shouldStopAfterTarget,true)
    assert.equal(h.stats.increments,1)
    assert.equal(h.stats.writes.length,1,'later friend policy preserves the original pause and note')
    assert.equal(h.stats.writes[0].status,'tạm dừng')
    assert.match(h.stats.writes[0].note,/Dừng sau 4 data/)
    assert.match(h.stats.writes[0].note,/Nhắn tin thất bại/)
    assert.equal(h.stats.disables.length,1,'friend action side effects still apply')
    assert.deepEqual(h.stats.accounts,[{loginStatus:'chưa đăng nhập'},{status:'tạm dừng'}])
  }
  {
    const h=harness({initialCount:3,err_fb_add_friend_unavailable:{...policies.err_fb_add_friend_unavailable,
      disableActionCodes:['fb_add_friend'],timeDisableActions:17}})
    await h.log(outputs.unavailable)
    await h.log({ok:false,outcome:'failed',error:'Click failed'})
    await h.scheduler.finishTarget(h.summary)
    assert.deepEqual(h.stats.writes.map(p=>p.status),['chờ xử lý','tạm dừng'],'a later pause must still take precedence')
    assert.equal(h.stats.increments,1)
  }
  {
    const h=harness();await h.log(outputs.request_sent)
    const step={status:'error',blockName:'fb_send_message',error:'Message failed'}
    await h.scheduler.finishTarget(h.summary,{status:'cancelled',steps:[step]})
    assert.equal(h.stats.increments,1,'committed friend click cannot hide a real message error')
  }
  {
    const h=harness({err_fb_add_friend_unavailable:null}); await h.log(outputs.unavailable)
    await h.scheduler.finishTarget(h.summary)
    assert.equal(h.stats.details[0].errorCode,'err_undefined'); assert.equal(h.stats.increments,1)
  }
  {
    const h=harness({lookupFails:true}); await assert.rejects(h.log(outputs.unavailable),/Policy unavailable/)
    assert.equal(h.stats.details.length,0,'policy read failure cannot become success')
  }
  {
    const h=harness(); await h.log(cancelled.output); assert.equal(h.stats.details.length,0)
    await h.log(legacy.output); assert.equal(h.stats.details[0].status,'bỏ qua')
    assert.equal(h.stats.details[0].shouldCountAction,false)
  }
  for (const threshold of [null, 1]) {
    const h=harness({err_fb_add_friend_unavailable:{...policies.err_fb_add_friend_unavailable,
      countsTowardBadTarget:true,countConsecutiveErrors:threshold}})
    await h.log(outputs.unavailable)
    const result=await h.scheduler.finishTarget(h.summary)
    assert.equal(h.stats.increments,1,'count flag works even without a stop threshold')
    assert.equal(result.shouldStopAfterTarget,false,'counting alone does not pause')
    assert.equal(h.stats.writes.length,0)
    assert(!h.stats.logs.some(log=>log.includes('Dừng sau')))
  }
  {
    const h=harness({err_fb_add_friend_unavailable:{...policies.err_fb_add_friend_unavailable,
      disableActionCodes:['fb_add_friend'],timeDisableActions:17}})
    await h.log(outputs.unavailable)
    const result=await h.scheduler.finishTarget(h.summary)
    assert.equal(result.shouldStopAfterTarget,true)
    assert.equal(h.stats.writes[0].status,'chờ xử lý','action disable releases the running campaign')
    assert.equal(h.stats.increments,0)
  }
  {
    const h=harness()
    const step={status:'error',blockName:'fb_add_friend',error:'Execution failed',output:{}}
    await h.scheduler.logFacebookFriendMilestone({id:1,actionId:'facebook_message_uid'},{id:3},2,step,h.summary)
    await h.scheduler.finishTarget(h.summary,{status:'failed',steps:[step],error:step.error})
    assert.equal(h.stats.increments,1,'crashed friend step does not also enter generic error path')
    assert.equal(h.stats.details[0].status,'lỗi')
  }
  console.log('PASS scheduler statuses/logs, live policy toggles, side effects, fallback, mixed targets and no double counts')
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{
  if(win&&!win.isDestroyed())win.destroy()
  app.quit();fs.rmSync(directory,{recursive:true,force:true})
})
