// Offline: live-captured block -> real DAG/executor -> scheduler -> PostgreSQL WASM.
// No browser, Facebook action, HTTP request or production SQL is performed here.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const ts = require('typescript')
const { harness } = require('./action-status-mixed-output-smoke.cjs')
const { WorkflowEngineV2, js, edge } = require('./action-status-origin-tracking-smoke.cjs')
const migration = require('./fb-composer-policy-v374.cjs')
const root = path.resolve(__dirname, '..')
const before = migration.backup()
const code = migration.targetCode(before.tables.auto_blocks.rows[0].row.code)
const raw = 'waitForSelector timeout: //fixture-composer'
const clean = value => JSON.parse(JSON.stringify(value))
const claim = '11111111-1111-1111-1111-111111111111'
const unit = '22222222-2222-2222-2222-222222222222'
let scenarios = 0
function executor(legacy = false) {
  const file = 'src/main/v2/runtime/blockExecutor.ts'
  const source = legacy ? cp.execFileSync('git', ['show', `0b315a334c32418712e39b50b7d4550b12b452b6:${file}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, file), 'utf8')
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText)(name => name === './blockHelpers'
    ? { createBlockHelpers: (log, runtime) => ({ log, ...runtime }) } : require(name), module, module.exports)
  return new module.exports.BlockExecutor()
}
function browser(stage, abort) {
  const calls = []
  return { calls, page: {
    waitForSelector: async selector => {
      calls.push(`wait:${selector}`)
      if (stage === 'abort') { abort.abort(); throw new Error(raw) }
      if (selector === stage) throw new Error(raw)
      if (stage === 'browser') throw new Error('Browser closed')
    },
    click: async selector => { calls.push(`click:${selector}`); if (stage === 'click') throw new Error('click failed') }
  }, helpers: {
    element: async key => {
      if (stage === 'config') throw new Error('element config missing')
      return key === 'fb_composer_button' ? 'button' : 'dialog'
    }, sleep: async () => {}
  } }
}
async function engine(stage, actionCode, runtimeHelpers = {}, boundaryFactory) {
  const abort = new AbortController(), fixture = browser(stage, abort)
  const boundary = boundaryFactory?.(() => abort.abort())
  const open = { ...js('open', code, 'fb_open_composer'), config: { composerActionCode: actionCode } }
  const type = js('type', 'await page.click("type-content"); return {typed:true}')
  const media = js('media', 'await page.click("upload-media"); return {uploaded:true}')
  const post = js('post', 'await page.click("publish-post"); return {posted:true}')
  const run = await new WorkflowEngineV2().run({ id: 7, nodes: [open, type, media, post],
    edges: [edge('open', 'type'), edge('open', 'media'), edge('type', 'post'), edge('media', 'post')] }, {}, fixture.page, {
    persist: false, signal: abort.signal, runtimeHelpers: { ...fixture.helpers, ...runtimeHelpers },
    onStepProgress: step => boundary?.observe(step)
  })
  return { ...fixture, run, boundary, failed: run.steps.find(step => step.status === 'error') }
}
async function transport() {
  for (const action of ['fb_post_group', 'fb_post_my_profile']) for (const stage of ['button', 'dialog']) {
    const f = await engine(stage, action)
    assert.equal(f.run.status, 'failed')
    assert.equal(f.run.error, migration.notice)
    const result = f.failed.output.actionResult
    assert.equal(result.actionCode, action)
    assert.equal(result.statusCode, 'campaign_detail_error')
    assert.equal(result.errorCode, migration.errorCode)
    assert.equal(result.operationState, 'not_committed')
    assert.equal(result.data.error, raw)
    assert.equal(result.data.stage, `composer_${stage}`)
    assert.equal(f.calls.some(x => /type-content|upload-media|publish-post/.test(x)), false)
    assert.equal(f.calls.includes('click:button'), stage === 'dialog')
    scenarios++
  }
  for (const stage of ['config', 'click', 'browser', 'abort']) {
    const f = await engine(stage, 'fb_post_group')
    assert.equal(f.failed?.output.actionResult, undefined)
    assert.equal(f.calls.includes('click:publish-post'), false)
    assert.notEqual(f.run.error, migration.notice)
    scenarios++
  }
  const unknown = await engine('button', undefined)
  assert.equal(unknown.run.error, raw)
  assert.equal(unknown.failed.output.actionResult, undefined)
  const success = await engine('success', 'fb_post_group')
  assert.equal(success.run.status, 'completed')
  assert.equal(success.calls.filter(x => x === 'click:publish-post').length, 1)
  assert.equal(success.run.steps.some(s => s.output?.actionResult), false)
  scenarios += 2
  // Existing binary preserves the friendly exception and stopping behavior;
  // it does not retain the new attached policy contract until upgraded.
  const old = browser('button', new AbortController())
  const legacy = await executor(true).execute({ code, blockName: 'fb_open_composer' }, {
    input: { composerActionCode: 'fb_post_group' }, vars: {}, page: old.page,
    signal: new AbortController().signal, runtimeHelpers: old.helpers
  })
  assert.equal(legacy.success, false); assert.equal(legacy.error, migration.notice)
  assert.deepEqual(clean(legacy.output), {})
  scenarios++
  const fallback = await engine('button', 'fb_post_group', {
    resolveActionResultErrorMessage: async () => { throw new Error('catalog unavailable') }
  })
  assert.equal(fallback.run.error, migration.notice)
  assert.equal(fallback.failed.output.actionResult.data.error, raw)
  scenarios++
}
async function managed(zca, action, stage, alternateNotice = false) {
  const f = await harness(zca, action === 'fb_post_group' ? 'facebook_group_post' : 'facebook_timeline_post')
  try {
    const updated = await f.db.query(`UPDATE auto_error SET detail_mode='inherit',noti_running_process=$1,noti_campaign=$1
      WHERE error_code=$2 RETURNING *`, [alternateNotice ? 'Fixture edited catalog notice' : migration.notice, migration.errorCode])
    assert.equal(updated.rows.length, 1)
    const rawPolicy = updated.rows[0]
    const policy = Object.fromEntries(Object.entries(rawPolicy).map(([key, value]) => [key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), value]))
    const reads = [], effects = []
    f.scheduler.supabase.getErrorPolicy = async errorCode => { reads.push(errorCode); assert.equal(errorCode, migration.errorCode); return policy }
    f.scheduler.supabase.getAccount = async () => f.account
    f.scheduler.updateErrorPolicyAccount = async () => { throw new Error('must not disable account') }
    const apply = f.scheduler.applyRuntimeErrorPolicy.bind(f.scheduler)
    f.scheduler.applyRuntimeErrorPolicy = async (...args) => { effects.push(args[2]); return apply(...args) }
    await f.db.exec('INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(1,3)')
    await f.runtime.beginActionResultRun({ campaignId: 1, accountId: 1, staffId: 1, platform: 'facebook', claimToken: claim }, [action])
    f.runtime.beginActionResultUnit(1, unit, [1])
    const helpers = f.scheduler.createBlockRuntimeHelpers(f.account, f.campaign, f.input, null)
    const executed = await engine(stage, action, helpers, abort => new f.runtime.ActionResultBoundary(1, abort))
    assert.equal(executed.boundary.error, undefined)
    assert.equal(executed.run.error, policy.notiRunningProcess)
    assert.equal(f.scheduler.hasExplicitFailurePolicy(executed.failed), true)
    assert.equal(f.scheduler.hasExplicitFailurePolicy({ ...executed.failed, output: {} }), false)
    assert.equal(f.scheduler.hasExplicitFailurePolicy({ ...executed.failed, status: 'success' }), false)
    assert.equal(f.scheduler.hasExplicitFailurePolicy(undefined), false)
    const steps = clean(executed.run.steps)
    const summary = await f.final(steps)
    const finalized = await f.scheduler.finalizeExplicitResultPolicies(f.account, f.campaign, 1, summary,
      { targetCounter: {}, campaignDecision: { paused: false } })
    assert.equal(finalized.triggered, true)
    assert.equal(f.campaign.status, 'chờ xử lý')
    assert(f.campaign.note.includes(policy.notiCampaign))
    await f.finish()
    const target = f.runtime.managedTargetEffects(1, 1)
    assert.equal(target.badTargetEffect, 'ignore')
    await f.final(steps)
    await f.scheduler.finalizeExplicitResultPolicies(f.account, f.campaign, 1, summary, { targetCounter: {} })
    assert.deepEqual(effects, [migration.errorCode], 'policy effects happen once, including replay')
    const rows = await f.details()
    assert.equal(rows.length, 1)
    const row = rows[0]
    assert.equal(row.status, 'lỗi'); assert.equal(row.report_group, 'failure')
    assert.equal(row.action_code, action); assert.equal(row.error_code, migration.errorCode)
    assert.equal(row.sub_status_id, null)
    assert.equal(row.counts_toward_limit, false); assert.equal(await f.quota(), 0)
    assert.equal(row.policy_snapshot.badTargetEffect, 'ignore')
    assert.equal(row.data.error, raw); assert.equal(row.log, policy.notiRunningProcess)
    assert.equal((await f.db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state')).rows[0].n, 3)
    assert(f.logs.every(log => !log.includes('waitForSelector') && !log.includes('//fixture')))
    assert(reads.every(code => code === migration.errorCode))
    // The normal target branch must not normalize the same explicit failure
    // into err_undefined; execute its actual AST-extracted block below.
    await finalizeBranch(f, executed.run, summary)
    assert.deepEqual(effects, [migration.errorCode])
    assert.equal(f.increments.length, 0)
    scenarios++
  } finally { await f.close() }
}
async function finalizeBranch(f, result, milestoneSummary) {
  const filename = path.join(root, 'src/main/services/campaignScheduler.ts')
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true)
  let body
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(source) === '!accountStopReason && !pauseCancelledRun && !runtimeModeStopRequested') body = node.thenStatement.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source); assert(body)
  // These flags are normally aligned from managedTargetEffects before this
  // block. Derive from the real writer result, never from the test expectation.
  const target = f.runtime.managedTargetEffects(1, 1)
  if (target) Object.assign(milestoneSummary, { hasSuccess: target.badTargetEffect === 'reset',
    hasFailure: target.badTargetEffect === 'increment', hasHardFailure: target.badTargetEffect === 'increment', hasError: false })
  const compiled = ts.transpileModule(`async function run(account,campaign,detail,result,milestoneSummary) {
    let runtimeStopTriggered=false,shouldStopAfterTarget=false;
    const executableTargetActionDescriptors=[{code:'fb_post_group'}];
    ${body}
    return {runtimeStopTriggered,shouldStopAfterTarget};
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const run = new Function('COMMENT_FREQUENCY_LIMIT_ERROR_CODE', compiled+';return run;')('err_comment_frequency_limit')
  const decision = await run.call(f.scheduler, f.account, f.campaign, f.input, result, milestoneSummary)
  assert.equal(decision.runtimeStopTriggered, true); assert.equal(decision.shouldStopAfterTarget, true)
}
async function malformed(zca) {
  const f = await harness(zca, 'facebook_group_post')
  try {
    f.runtime.beginActionResultUnit(1, unit, [1])
    for (const attached of [null, [], { actionCode: 'fb_post_group', statusCode: 'missing', operationState: 'not_committed' },
      { actionCode: 'fb_post_group', statusCode: 'campaign_detail_error', operationState: 'not_committed', inputDataId: 999 }]) {
      const thrown = await executor().execute({ blockName: 'malformed',
        code: `const e=new Error('fixture');e.actionResult=${JSON.stringify(attached)};throw e;` }, {
        input: {}, vars: {}, page: null, signal: new AbortController().signal
      })
      const boundary = new f.runtime.ActionResultBoundary(1, () => {})
      assert.equal(boundary.observe({ id: 1, nodeId: 'bad', runId: 1, status: 'error', output: thrown.output }), false)
      assert(boundary.error)
      scenarios++
    }
    assert.equal((await f.details()).length, 0)
  } finally { await f.close() }
}
async function main() {
  await transport()
  const zca = await import('zca-js')
  for (const action of ['fb_post_group', 'fb_post_my_profile']) for (const stage of ['button', 'dialog']) await managed(zca, action, stage)
  await managed(zca, 'fb_post_group', 'button', true)
  await malformed(zca)
  // Only input configuration changes; successful DOM operations/graph stay intact.
  for (const change of migration.desired().filter(r => r.table === 'auto_workflows')) {
    const old = before.tables.auto_workflows.rows.find(r => r.row.id === change.id).row
    const nodes = clean(change.fields.nodes)
    delete nodes.find(n => n.blockId === 27).config.composerActionCode
    assert.deepEqual(nodes, old.nodes)
  }
  console.log(JSON.stringify({ scenarios, workflow_graphs_unchanged: 4, external_operations: 0 }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
