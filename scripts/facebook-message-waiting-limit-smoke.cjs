// Actual Electron DOM + PageController + block/engine + scheduler policy methods.
// Isolated local fixtures: no Facebook, DB writes or messages to real recipients.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
if (!process.versions.electron) {
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', timeout: 60000 })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow } = require('electron')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const baseline = require('./fixtures/facebook-message-waiting-limit-live.json')
const migration = read('migrations/migration_v355_facebook_message_waiting_limit.sql')
const md5 = text => createHash('md5').update(text).digest('hex')
let code = baseline.block.code
assert.equal(md5(code), baseline.block_md5)
for (const name of ['wait', 'catch']) {
  const old = migration.split(`$old_${name}$`)[1], next = migration.split(`$new_${name}$`)[1]
  assert.equal(code.split(old).length, 2)
  code = code.replace(old, next)
}
assert.equal(md5(code), baseline.target_code_md5)
assert(code.includes(baseline.policy.error_element), 'same XPath as the existing policy/C#')
assert(!/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|NOTIFY\s+pgrst|CREATE\s+TABLE/i.test(migration))
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
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
const blocks = new Map([
  [38, { id: 38, name: 'fb_send_message', kind: 'js', code, defaultConfig: {} }],
  [39, { id: 39, name: 'fb_add_friend', kind: 'js', code: 'helpers.friend(); return {ok:true}', defaultConfig: {} }]
])
const { WorkflowEngineV2 } = compile('src/main/v2/runtime/workflowEngine.ts', {
  './blockExecutor': { BlockExecutor },
  '../../data/repositories/blockRepository': { getBlock: async id => blocks.get(id) },
  '../../data/repositories/workflowV2Repository': {}, '../../data/repositories/runV2Repository': {}
})
const { mapAutoErrorPolicyFromDB } = compile('src/main/data/mappers.ts', { './currentUser': {} })
const source = ts.createSourceFile('scheduler.ts', read('src/main/services/campaignScheduler.ts'), ts.ScriptTarget.Latest, true)
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CampaignScheduler')
const names = ['normalizeRuntimeError', 'handleCampaignBadTarget', 'applyRuntimeErrorPolicy', 'getPolicyThreshold',
  'runCampaignErrorPolicy', 'renderPolicyMessage', 'addActionContextToMessage', 'resolvePolicyActionDisableContext']
const methods = names.map(name => cls.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(source) === name).getText(source)).join('\n')
const Scheduler = new Function('IPC_EVENTS', 'PAGE_INBOX_MESSAGE_ACTION_ID',
  transpile('class Harness {' + methods + '}') + ';return Harness')({}, 'facebook_page_to_message')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'akaagent-message-limit-'))
app.setPath('userData', directory)
app.disableHardwareAcceleration()
let win
const message = baseline.policy.error_desc
const box = '[role="textbox"][contenteditable="true"]'
const banner = `<span><span>${message}</span></span>`
async function context(options = {}) {
  const html = `<style>[contenteditable]{display:block;width:300px;height:80px}</style>
    ${options.composer ? '<div role="textbox" contenteditable="true"></div>' : ''}
    ${options.limit ? banner : ''}${options.unmatchedText ? `<div>${message}</div>` : ''}`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const page = new PageController(win.webContents)
  const stats = { waits: [], actions: [], probes: 0, preparations: 0, friends: 0 }
  const abort = new AbortController()
  const wait = page.waitForSelector.bind(page), evaluate = page.evaluate.bind(page)
  page.waitForSelector = async (selector, opts) => {
    stats.waits.push([selector, opts.timeout])
    try { return await wait(selector, { ...opts, timeout: 40 }) }
    catch (error) {
      if (selector === box && options.delayedLimit) await evaluate('document.body.insertAdjacentHTML("beforeend", __args[0]);', banner)
      if (selector === box && options.abortOnTimeout) abort.abort()
      throw error
    }
  }
  page.evaluate = async (...args) => {
    stats.probes++
    if (options.probeFails) throw Error('DOM unavailable')
    return evaluate(...args)
  }
  // Record send operations; read/match paths above use the actual Electron DOM.
  page.click = async selector => stats.actions.push(['click', selector])
  page.fill = async (_selector, text) => stats.actions.push(['text', text])
  page.dropFile = async (_selector, files) => stats.actions.push(['media', files])
  page.press = async key => stats.actions.push(['send', key])
  const helpers = {
    log: () => {}, sleep: async () => {}, element: async name => { assert.equal(name, 'fb_messenger_textbox'); return box },
    friend: () => { stats.friends++ }
  }
  if (!options.legacy) helpers.prepareCampaignContent = async () => {
    stats.preparations++
    if (options.prepareFails) throw Error('allocation failed')
    return { content: options.mediaOnly ? '' : 'Selected content', media: ['fixture.jpg'], variantIndex: 2 }
  }
  return { stats, page, helpers, signal: abort.signal, vars: { campaignContent: 'Legacy content', images: [] }, input: {} }
}
const executor = new BlockExecutor()
const invoke = (ctx, sourceCode = code) => executor.execute({ code: sourceCode, blockName: 'fb_send_message' }, {
  ...ctx, runtimeHelpers: ctx.helpers
})
async function test(name, options, check) {
  const ctx = await context(options)
  const result = await invoke(ctx)
  await check(result, ctx)
  assert(ctx.stats.waits.some(([selector, timeout]) => selector === box && timeout === 15000), 'original composer wait retained')
  console.log('PASS ' + name)
}
async function main() {
  await app.whenReady()
  win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false, partition: 'message-limit-fixture' } })
  win.webContents.session.webRequest.onBeforeRequest((request, callback) => callback({ cancel: !request.url.startsWith('data:') }))
  const before = await context({ limit: true })
  const old = await invoke(before, baseline.block.code)
  assert.equal(old.success, true)
  assert.equal(old.output.ok, false)
  assert.match(old.output.error, /waitForSelector timeout/)
  console.log('PASS baseline reproduces the misleading timeout')
  for (const options of [{ limit: true }, { delayedLimit: true }]) {
    await test('limit becomes a workflow error without preparation/send', options, (result, ctx) => {
      assert.equal(result.success, false)
      assert.equal(result.error, message)
      assert.equal(ctx.stats.probes, 1)
      assert.equal(ctx.stats.preparations, 0)
      assert.deepEqual(ctx.stats.actions, [])
    })
  }
  for (const options of [{}, { unmatchedText: true }, { limit: true, probeFails: true }, { limit: true, abortOnTimeout: true }]) {
    await test('ordinary timeout/probe failure/cancellation keeps prior behavior', options, (result, ctx) => {
      assert.equal(result.success, true)
      assert.equal(result.output.ok, false)
      assert.match(result.output.error, /waitForSelector timeout/)
      assert.equal(ctx.stats.preparations, 0)
      assert.deepEqual(ctx.stats.actions, [])
      if (options.abortOnTimeout) assert.equal(ctx.stats.probes, 0)
    })
  }
  for (const options of [{ composer: true }, { composer: true, legacy: true }, { composer: true, mediaOnly: true }]) {
    await test('normal/legacy/media-only send remains once-only', options, (result, ctx) => {
      assert.equal(result.success, true)
      assert.equal(result.output.ok, true)
      assert.equal(ctx.stats.probes, 0)
      assert.equal(ctx.stats.actions.filter(a => a[0] === 'send').length, 1)
      assert.equal(ctx.stats.preparations, options.legacy ? 0 : 1)
      assert.equal(ctx.stats.actions.filter(a => a[0] === 'text').length, options.mediaOnly ? 0 : 1)
    })
  }
  await test('content preparation failure never sends stale content', { composer: true, prepareFails: true }, (result, ctx) => {
    assert.equal(result.output.ok, false)
    assert.equal(result.output.error, 'allocation failed')
    assert.equal(ctx.stats.actions.filter(a => a[0] === 'send').length, 0)
  })
  const ctx = await context({ limit: true })
  const workflow = { id: 1, name: 'fixture', nodes: [
    { id: 'send', blockId: 38, blockName: 'fb_send_message', config: { screenshotCaptureOn: 'failure', screenshotCaptureTiming: 'after' } },
    { id: 'friend', blockId: 39, blockName: 'fb_add_friend', config: {} }
  ], edges: [{ id: 'next', source: 'send', target: 'friend' }] }
  const captures = []
  const run = await new WorkflowEngineV2().run(workflow, ctx.vars, ctx.page, {
    persist: false, signal: ctx.signal, runtimeHelpers: ctx.helpers,
    onBlockScreenshot: async (request, page) => {
      assert.equal(page, ctx.page)
      captures.push(request)
    }
  })
  assert.notEqual(run.status, 'completed')
  assert.equal(run.steps.find(step => step.nodeId === 'send').status, 'error')
  assert.equal(ctx.stats.friends, 0, 'limit stops downstream friend action')
  assert.equal(captures.length, 1)
  assert.equal(captures[0].captureReason, 'failure')
  assert.equal(captures[0].captureTiming, 'after')
  assert.equal(captures[0].error, message)
  console.log('PASS actual engine stops downstream and requests an after-failure screenshot')
  for (const minutes of [60, 1440]) {
    const currentNotices = minutes === 1440 ? {
      noti_running_process: 'Facebook đang hạn chế nhắn tin cho người lạ.',
      noti_campaign: 'Facebook đang hạn chế nhắn tin cho người lạ. Tạm nghỉ 24 giờ.'
    } : {}
    const policy = mapAutoErrorPolicyFromDB({ ...baseline.policy, ...currentNotices, time_disable_actions: minutes })
    const writes = [], disables = [], requested = []
    const scheduler = Object.assign(new Scheduler(), {
      failedRunErrorPolicies: new Map(), attemptedRunErrorPolicies: new Set(),
      getMessageActionCode: () => 'fb_message_stranger',
      supabase: {
        getErrorPolicy: async key => { requested.push(key); assert.equal(key, policy.errorCode); return policy },
        disableAccountActions: async (...args) => disables.push(args)
      },
      updateErrorPolicyCampaign: async (_campaign, patch) => writes.push(patch),
      logCampaignProgress: async () => {}, mainWindow: { webContents: { send: () => {} } }
    })
    const campaign = { id: 1, actionId: 'facebook_message_uid', name: 'Fixture' }
    const error = scheduler.normalizeRuntimeError(campaign, run.steps, run.error)
    assert.equal(error.errorCode, policy.errorCode)
    const handled = await scheduler.handleCampaignBadTarget({ id: 2 }, campaign, 3, error.errorCode, error.actionCode, { message: error.message })
    assert.equal(handled.triggered, true)
    assert.equal(disables.length, 1)
    assert.deepEqual(disables[0].slice(0, 3), [2, ['fb_message_stranger'], minutes])
    assert.equal(disables[0][3].errorCode, policy.errorCode)
    assert.equal(writes[0].status, 'chờ xử lý')
    assert.equal(writes[0].note, policy.notiCampaign)
    assert(requested.every(key => key === policy.errorCode))
    console.log(`PASS existing scheduler applies exact policy and ${minutes}-minute action disable`)
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  if (win && !win.isDestroyed()) win.destroy()
  app.quit()
  fs.rmSync(directory, { recursive: true, force: true })
})
