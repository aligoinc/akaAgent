const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { PREFIX, STATE_BLOCK_NAME, STATE_BLOCK_CODE } = require('./facebook-page-identity-workflow.cjs')
const root = path.resolve(__dirname, '..')
const fixture = require('./fixtures/facebook-page-identity-live-graphs.json')
const migration = fs.readFileSync(path.join(root, 'migrations/migration_v284_facebook_campaign_run_as_page.sql'), 'utf8')
const patches = JSON.parse(migration.match(/\$patch\$([\s\S]*?)\$patch\$/)[1])
assert.equal(migration.match(/\$state_code\$([\s\S]*?)\$state_code\$/)[1], STATE_BLOCK_CODE)
assert.equal(patches.length, 12)
assert(!/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|NOTIFY\s+pgrst|CREATE\s+TABLE/i.test(migration))

const compile = (relative, mocks = {}) => {
  const filename = path.join(root, relative)
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name in mocks) return mocks[name]
    if (name.startsWith('.') && mocks['*']) return mocks['*']
    if (name.startsWith('.')) throw new Error(`Unexpected runtime dependency ${name} in ${relative}`)
    return require(name)
  }, module, module.exports)
  return module.exports
}
const { BlockExecutor } = compile('src/main/v2/runtime/blockExecutor.ts', {
  './blockHelpers': { createBlockHelpers: (log, runtime) => ({ log, ...runtime }) }
})
let blockMap = new Map()
const { WorkflowEngineV2 } = compile('src/main/v2/runtime/workflowEngine.ts', {
  './blockExecutor': { BlockExecutor },
  '../../data/repositories/blockRepository': { getBlock: async id => blockMap.get(id), getBlockByName: async name => [...blockMap.values()].find(b => b.name === name) },
  '../../data/repositories/workflowV2Repository': {}, '../../data/repositories/runV2Repository': {}
})
const { FacebookCampaignPageIdentity, assertPageIdentityWorkflow } = compile('src/main/services/facebookCampaignPageIdentity.ts')
const { validateFacebookPageIdentitySettings } = compile('src/shared/facebookPageIdentity.ts')
const schedulerImports = new Proxy({}, { get: () => function Stub() {} })
const { CampaignScheduler } = compile('src/main/services/campaignScheduler.ts', { '*': schedulerImports })

function buildWorkflow(original) {
  const patch = patches.find(p => p.id === original.id)
  return { ...original, nodes: [...original.nodes, ...patch.nodes], edges: [...original.edges, ...patch.edges],
    defaultVariables: { ...original.defaultVariables, ...patch.default_variables } }
}
function environment(original, options = {}) {
  const workflow = buildWorkflow(original)
  const stats = { actions: [], switches: [], originals: 0, activeIdentity: 'Profile', cleanupSignals: [] }
  const abort = new AbortController()
  blockMap = new Map()
  for (const node of workflow.nodes) {
    let code = `helpers.action(${JSON.stringify(node.id)}); return { value: ${JSON.stringify(node.id)} }`
    if (node.blockName === 'fb_get_current_identity_name') code = `helpers.original(); vars.originalIdentityName = 'Profile'; return { ok: true, identityName: 'Profile' }`
    if (node.blockName === 'fb_switch_identity_by_name') code = `return await helpers.switchIdentity(input.useOriginalIdentity === true, input.useOriginalIdentity ? vars.originalIdentityName : vars[input.identityNameFromVars])`
    if (node.blockName === STATE_BLOCK_NAME) code = STATE_BLOCK_CODE
    blockMap.set(node.blockId, { id: node.blockId, name: node.blockName, kind: node.systemType ? 'system' : 'js', code, defaultConfig: {} })
  }
  const runtimeHelpers = {
    original: () => { stats.originals++ },
    action: id => { stats.actions.push(id); if (options.failAction) throw new Error('Action failed') },
    switchIdentity: async (restore, name) => {
      stats.switches.push({ restore, name })
      if ((restore && options.failRestore) || (!restore && options.failSwitch)) return { ok: false, message: 'Switch failed' }
      stats.activeIdentity = name
      if (!restore && options.abortAfterSwitch) abort.abort()
      if (restore && options.holdRestore) await options.holdRestore
      return { ok: true, identityName: name }
    }
  }
  const engine = new WorkflowEngineV2()
  const vars = { ...workflow.defaultVariables, commentIterations: [{ content: 'one' }, { content: 'two' }], enablePostLike: true,
    enableComment: true, groupPostSubmitted: true, copyContentFromSource: false }
  const campaign = { id: 1, accountId: 2, actionId: 'facebook_group_post', extraSettings: { runAsPage: true, runAsPageUid: '101', runAsPageName: 'Page A' } }
  const session = new FacebookCampaignPageIdentity(campaign, workflow)
  const page = { isConnected: () => !options.disconnected }
  session.page = page
  const context = { persist: false, signal: abort.signal, runtimeHelpers, onStepProgress: step => session.observe(step) }
  return { workflow, vars, engine, stats, session, abort, context, page,
    target: async () => { session.targetStarted = false; return engine.run(workflow, { ...vars, ...session.variables() }, page, context) },
    restore: () => session.restore((w, v, p, ctx) => {
      stats.cleanupSignals.push(ctx.signal)
      return engine.run(w, v, p, ctx)
    }, context) }
}

async function main() {
  for (const original of fixture.workflows) {
    const env = environment(original)
    assertPageIdentityWorkflow(env.workflow)
    assert.throws(() => assertPageIdentityWorkflow(original), /Workflow chưa/)
    assert.throws(() => assertPageIdentityWorkflow({ ...env.workflow, edges: env.workflow.edges.slice(0, -1) }), /chưa hợp lệ/)
    const baseline = await env.engine.run(original, { ...env.vars, runAsPage: false }, env.page, { ...env.context, onStepProgress: undefined })
    const baselineActions = [...env.stats.actions]; env.stats.actions.length = 0
    const disabled = await env.engine.run(env.workflow, { ...env.vars, runAsPage: false }, env.page, env.context)
    assert.deepEqual(env.stats.actions, baselineActions, `${original.id}: Page off keeps original traversal`)
    assert.deepEqual(disabled.output, baseline.output, `${original.id}: Page off keeps original output`)
    assert.equal(env.stats.switches.length, 0)
    env.stats.actions.length = 0
    const first = await env.target()
    assert.equal(first.status, 'completed', `${original.id}: ${first.error}`)
    assert.equal(env.session.ready, true)
    assert.equal(env.stats.switches.length, 1)
    const actionsAfterFirst = env.stats.actions.length
    await env.target()
    assert.equal(env.stats.originals, 1, `${original.id}: capture once per campaign execution`)
    assert.equal(env.stats.switches.length, 1)
    assert.equal(env.stats.actions.length, actionsAfterFirst * 2)
    const beforeRestore = env.stats.actions.length
    await Promise.all([env.restore(), env.restore()])
    assert.equal(env.stats.actions.length, beforeRestore, `${original.id}: cleanup never runs actions`)
    assert.deepEqual(env.stats.switches, [{ restore: false, name: 'Page A' }, { restore: true, name: 'Profile' }])
    assert.equal(env.stats.activeIdentity, 'Profile')

    const editor = environment(original)
    const editorResult = await editor.engine.run(editor.workflow, { ...editor.vars, runAsPage: true, runAsPageName: 'Page A' }, editor.page, editor.context)
    assert.equal(editorResult.status, 'completed')
    assert.deepEqual(editorResult.output, baseline.output, `${original.id}: editor restore preserves output`)
    assert.equal(editor.stats.activeIdentity, 'Profile')
    assert.equal(editor.stats.switches.length, 2)
  }
  console.log('PASS all 12 live graphs: original traversal/output, one switch across targets, restore-only and editor run')
  const original = fixture.workflows.find(w => w.id === 284)
  for (const options of [{ failSwitch: true }, { abortAfterSwitch: true }]) {
    const env = environment(original, options)
    await env.target()
    assert.equal(env.stats.actions.length, 0)
    assert.equal(env.session.targetStarted, false)
    await env.restore()
    assert.equal(env.stats.activeIdentity, 'Profile')
    assert.notEqual(env.stats.cleanupSignals[0], env.abort.signal)
    assert.equal(env.stats.cleanupSignals[0].aborted, false)
  }
  const failed = environment(original, { failAction: true })
  assert.equal((await failed.target()).status, 'failed')
  await failed.restore()
  assert.equal(failed.stats.actions.length, 1)
  const failedRestore = environment(original, { failRestore: true })
  await failedRestore.target()
  await assert.rejects(failedRestore.restore(), /Switch failed/)
  await assert.rejects(failedRestore.restore(), /Switch failed/)
  assert.equal(failedRestore.stats.switches.length, 2, 'failed cleanup also runs only once')
  const disconnected = environment(original)
  await disconnected.target(); disconnected.page.isConnected = () => false
  await assert.rejects(disconnected.restore(), /Trình duyệt đã đóng/)
  let releaseRestore
  const holdRestore = new Promise(resolve => { releaseRestore = resolve })
  const held = environment(original, { holdRestore })
  await held.target()
  let released = false
  const cleanup = held.restore().then(() => { released = true })
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(released, false, 'release must await restore, not an aborted target signal')
  releaseRestore(); await cleanup; assert.equal(released, true)
  assert.throws(() => validateFacebookPageIdentitySettings('facebook_group_post', { runAsPage: true }), /chọn Page/)
  assert.throws(() => validateFacebookPageIdentitySettings('zalo_message_friend', { runAsPage: true }), /không hỗ trợ/)
  assert.throws(() => validateFacebookPageIdentitySettings('facebook_group_post', { runAsPage: true, runAsPageUid: '1', runAsPageName: 'Page' }, 3), /tài khoản phụ/)
  console.log('PASS preparation failure, abort, action failure, cleanup failure/disconnect, cleanup drain and config validation')

  // Exercise the actual scheduler exit hooks, not a copied cleanup wrapper.
  for (const exit of ['release', 'complete', 'pause', 'preflight', 'restore-failure']) {
    const env = environment(original, { failRestore: exit === 'restore-failure' })
    await env.target()
    const account = { id: 2, status: 'đang chạy', flatformType: 'facebook' }
    const campaign = { ...env.session.campaign, status: 'đang chạy', dataTargetSourceMode: 'direct' }
    const order = []
    const db = {
      getAccount: async () => account, getCampaign: async () => campaign,
      updateAccount: async (_id, patch) => { order.push(`account:${patch.status}`); return Object.assign(account, patch) },
      updateCampaign: async (_id, patch) => { order.push(`campaign:${patch.status}`); return Object.assign(campaign, patch) },
      updateRunningDesktopCampaign: async (_id, patch) => Object.assign(campaign, patch),
      finalizeCampaign: async () => { order.push('finalize'); assert.equal(env.stats.activeIdentity, 'Profile'); campaign.status = 'hoàn thành'; return { completed: true } }
    }
    const scheduler = new CampaignScheduler(db, {}, { webContents: { send() {} } })
    Object.assign(scheduler, { engineV2: env.engine, broadcastCampaignUpdate() {}, logCampaignProgress: async () => {},
      settleActiveCampaignRunUnit: async (_a, _c, unstarted) => { order.push(`settle:${!!unstarted}`); return true } })
    // Keep production restore context/persistence out of this isolated engine.
    scheduler.engineV2 = { run: (w, v, p, context) => env.engine.run(w, v, p, { ...context, persist: false, runtimeHelpers: env.context.runtimeHelpers }) }
    scheduler.facebookPageIdentities.set(1, env.session)
    if (exit === 'restore-failure') {
      await assert.rejects(scheduler.releaseRunningAccount(2), /Switch failed/)
      assert.equal(account.status, 'tạm dừng')
      assert.equal(campaign.status, 'tạm dừng')
      assert(!order.includes('account:chờ xử lý'))
    } else {
      if (exit === 'release') await scheduler.releaseRunningAccount(2)
      if (exit === 'complete') await scheduler.transitionCampaignToCompleted(campaign)
      if (exit === 'pause') await scheduler.completePauseAtBoundary(account, campaign)
      if (exit === 'preflight') await scheduler.pauseBeforePageIdentityTarget(account, campaign, 'Không chuyển Page')
      assert.equal(env.stats.activeIdentity, 'Profile')
      assert.equal(env.stats.switches.length, 2)
    }
  }
  console.log('PASS actual scheduler release/finalize/pause/preflight hooks and paused account on restore failure')

  const { fixture: targetLoopFixture } = require('./page-inbox-campaign-run-smoke-test.cjs')
  for (const options of [{}, { failSwitch: true }, { failRestore: true }, { failSwitch: true, failRestore: true }]) {
    const env = environment(original, options)
    const f = targetLoopFixture({ actionId: 'facebook_join_group' })
    const session = new FacebookCampaignPageIdentity({ ...f.campaign, extraSettings: env.session.campaign.extraSettings }, env.workflow)
    f.scheduler.facebookPageIdentities.set(f.campaign.id, session)
    f.scheduler.getAutomationPage = async () => ({ page: env.page, source: 'visible' })
    f.scheduler.createBlockRuntimeHelpers = () => env.context.runtimeHelpers
    f.scheduler.mainWindow = { webContents: { send() {} } }
    f.scheduler.isCampaignMediaResolveError = () => false
    f.scheduler.handleCampaignBadTarget = () => { throw new Error('Identity preparation/cleanup must not classify an action failure') }
    f.scheduler.restoreFacebookPageIdentity = async () => session.restore((w, v, p, context) => env.engine.run(w, v, p, { ...context, persist: false }), env.context)
    f.scheduler.pauseBeforePageIdentityTarget = CampaignScheduler.prototype.pauseBeforePageIdentityTarget.bind(f.scheduler)
    f.scheduler.updateCampaignAndBroadcast = async (_id, patch) => Object.assign(f.campaign, patch)
    f.scheduler.handleCampaignCompletion = async () => f.scheduler.restoreFacebookPageIdentity()
    f.scheduler.engineV2 = { run: (w, v, p, context) => env.engine.run(w, v, p, { ...context, persist: false }) }
    const writes = []
    const updateInput = f.scheduler.supabase.updateCampaignInputData
    f.scheduler.supabase.updateCampaignInputData = async (id, patch) => { writes.push(patch); return updateInput(id, patch) }
    if (options.failRestore) await assert.rejects(f.run(['chờ xử lý', 'chờ xử lý']), /Switch failed/)
    else await f.run(['chờ xử lý', 'chờ xử lý'])
    assert.equal(env.stats.originals, 1)
    assert.equal(env.stats.switches.length, 2)
    assert.equal(env.stats.actions.length, options.failSwitch ? 0 : 2)
    if (options.failSwitch) {
      assert(!writes.some(patch => patch.status === 'hoàn thành'), 'unstarted targets remain pending even when cleanup fails')
      if (!options.failRestore) assert.equal(f.campaign.status, 'tạm dừng')
    }
  }
  console.log('PASS real scheduler target loop: two targets share Page; failed prepare does not consume/action a target')

  for (const failRestore of [false, true]) {
    const f = targetLoopFixture({ actionId: 'facebook_join_group' })
    let finishRestore, restoreStarted
    const holdRestore = new Promise(resolve => { finishRestore = resolve })
    const started = new Promise(resolve => { restoreStarted = resolve })
    const env = environment(original, { holdRestore })
    env.page.screenshot = async () => Buffer.from('preview')
    const events = []
    const db = {
      getAccount: async () => ({ ...f.account, status: 'đang chạy' }),
      updateAccount: async (_id, patch) => patch,
      updateRunningDesktopCampaign: async (_id, patch) => Object.assign(f.campaign, patch)
    }
    const previews = new CampaignScheduler(db, {}, { webContents: { send(_event, payload) {
      if (typeof payload?.active === 'boolean') events.push(payload)
    } } })
    previews.logCampaignProgress = async () => {}
    previews.broadcastCampaignUpdate = () => {}
    const session = new FacebookCampaignPageIdentity({ ...f.campaign, accountId: f.account.id,
      extraSettings: env.session.campaign.extraSettings }, env.workflow)
    f.scheduler.facebookPageIdentities.set(f.campaign.id, session)
    previews.facebookPageIdentities = f.scheduler.facebookPageIdentities
    f.scheduler.getAutomationPage = async () => ({ page: env.page, source: 'background' })
    f.scheduler.createBlockRuntimeHelpers = () => env.context.runtimeHelpers
    f.scheduler.mainWindow = { webContents: { send() {} } }
    f.scheduler.startBackgroundPreview = previews.startBackgroundPreview.bind(previews)
    f.scheduler.stopBackgroundPreview = previews.stopBackgroundPreview.bind(previews)
    f.scheduler.handleCampaignCompletion = async () => previews.restoreFacebookPageIdentity(f.campaign.id)
    const engine = { run: async (w, v, p, context) => {
      if (v.pageIdentityRestoreOnly) restoreStarted()
      const result = await env.engine.run(w, v, p, { ...context, persist: false, runtimeHelpers: env.context.runtimeHelpers })
      if (v.pageIdentityRestoreOnly && failRestore) throw new Error('Restore preview failure')
      return result
    } }
    f.scheduler.engineV2 = previews.engineV2 = engine
    f.scheduler.releaseRunningAccount = async () => {
      assert.equal(previews.backgroundPreviewTimers.size, 0, 'preview ends before account release')
      assert.equal(events.at(-1)?.active, false)
    }
    const run = f.run(['chờ xử lý', 'chờ xử lý'])
    const settled = run.then(() => null, error => error)
    try {
      await started
      assert.equal(env.stats.actions.length, 2)
      assert(events.length > 0 && events.every(event => event.active), 'preview never stops between the targets and pending restore')
      assert.equal(previews.backgroundPreviewTimers.size, 1)
      assert.equal([...previews.backgroundPreviewOverrides.values()][0].title, 'Đang chuyển về danh tính ban đầu')
      finishRestore()
      const error = await settled
      if (failRestore) assert.match(error?.message || '', /Restore preview failure/)
      else assert.equal(error, null)
      assert.equal(events.at(-1).active, false)
      assert.equal(previews.backgroundPreviewTimers.size, 0)
      assert.equal(previews.backgroundPreviewOverrides.size, 0)
      const count = events.length
      await previews.restoreFacebookPageIdentity(f.campaign.id).catch(() => {})
      assert.equal(events.length, count, 'repeated cleanup does not restart the preview')
    } finally { finishRestore(); await settled; previews.stopAllBackgroundPreviews() }
  }

  // A screenshot already in flight must not make the UI active again after stop.
  const lateEvents = []
  const previews = new CampaignScheduler({}, {}, { webContents: { send(_event, payload) { lateEvents.push(payload) } } })
  let finishScreenshot
  const latePage = { isConnected: () => true, screenshot: () => new Promise(resolve => { finishScreenshot = resolve }) }
  previews.startBackgroundPreview(1, 100, latePage)
  previews.stopBackgroundPreview(1, 100)
  finishScreenshot(Buffer.from('late'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(lateEvents.map(event => event.active), [false])
  console.log('PASS preview stays active across targets and restore, ends on success/error, and rejects late screenshots')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
