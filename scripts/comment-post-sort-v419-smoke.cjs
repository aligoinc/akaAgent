// Scheduler → real workflow engine/block VM; Electron PageController on local DOM.
// Never navigates to Facebook or sends a comment.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const migration = require('./comment-post-sort-v419.cjs')
const root = path.resolve(__dirname, '..'), before = migration.before(), desired = migration.desired()
const plain = value => JSON.parse(JSON.stringify(value))
const transpile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
function compile(file, stubs = {}) {
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', transpile(fs.readFileSync(path.join(root, file), 'utf8')))(
    name => name in stubs ? stubs[name] : require(name), mod, mod.exports)
  return mod.exports
}
let checks = 0
const elementMap = Object.fromEntries([...before.elements, ...desired.elements].map(e => [e.name, e.xpath]))
const runCode = (code, vars, input, page, helpers, signal = new AbortController().signal) =>
  vm.runInNewContext(`(async()=>{${code}})()`, { vars, input, page, helpers, signal })
function scheduler() {
  const source = ts.createSourceFile('scheduler.ts', fs.readFileSync(path.join(root, 'src/main/services/campaignScheduler.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CampaignScheduler')
  const method = cls.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(source) === 'buildVariablesV2')
  const globals = {}
  for (const statement of source.statements) if (ts.isVariableStatement(statement)) {
    for (const d of statement.declarationList.declarations)
      if (ts.isIdentifier(d.name) && d.initializer && ts.isStringLiteral(d.initializer)) globals[d.name.text] = d.initializer.text
  }
  const Harness = new Function(...Object.keys(globals), `${transpile(`class Harness {${method.getText(source)}}`)};return Harness`)(...Object.values(globals))
  const s = new Harness()
  for (const name of ['isFormattedContentCampaign', 'shouldSkipMessageByLimit', 'shouldSkipAddFriendByLimit',
    'shouldUseAdvancedCommentContent', 'shouldUseAdvancedContent', 'isBrowserlessCampaign', 'campaignUsesMainMedia', 'campaignUsesMessageMedia']) s[name] = () => false
  Object.assign(s, { campaignContentPreparationRuns: new Set(), facebookRandomTurns: new Map(),
    campaignUsesCommentIterations: c => c.actionId === 'facebook_comment_seeding',
    splitContentVariants: text => text ? [text] : [], getRawCampaignContentForIndex: () => '',
    renderSpinContent: x => x, cycleVariant: (values, i) => values[i % values.length] || '', firstNonEmptyString: x => x || '' })
  return s
}
async function runtimeTests() {
  const schedulerInstance = scheduler()
  const { BlockExecutor } = compile('src/main/v2/runtime/blockExecutor.ts', {
    './blockHelpers': { createBlockHelpers: (log, helpers) => ({ log, ...helpers }) }
  })
  let blocks
  const { WorkflowEngineV2 } = compile('src/main/v2/runtime/workflowEngine.ts', {
    './blockExecutor': { BlockExecutor },
    '../../data/repositories/blockRepository': { getBlock: async id => blocks.get(id) },
    '../../data/repositories/workflowV2Repository': {}, '../../data/repositories/runV2Repository': {}
  })
  for (const value of [undefined, null, 'recent_activity', 'most_relevant', 'new_posts']) {
    const variables = await schedulerInstance.buildVariablesV2({ id: 1, name: 'Fixture',
      actionId: 'facebook_comment_seeding', extraSettings: { commentPostSort: value, commentOnlyLatestPost: true,
        enableComment: true, postsPerTarget: 3, commentContent: 'Hello' } }, { id: 1, uid: 'fixture', name: 'Target' }, 1, '', 0)
    assert.equal(variables.commentPostSort, value ?? 'recent_activity')
    assert.equal(variables.commentOnlyLatestPost, undefined, 'dedupe remains unimplemented')
    assert.equal(variables.postsPerTarget, 3)
    assert.equal(variables.sortTypePost, 'most_relevant', 'find-data variable retains its existing default')
    for (const workflow of desired.workflows) {
      for (const mode of ['normal', 'no-menu', 'missing-option', 'click-error', 'abort-before', 'abort-after-menu', 'abort-after-sort', 'restore-only']) {
        const order = [], events = [], abort = new AbortController()
        if (mode === 'abort-before') abort.abort()
        blocks = new Map(workflow.nodes.map(n => [n.blockId, { id: n.blockId, name: n.blockName, kind: 'js', code: 'return {}' }]))
        for (const block of before.blocks.filter(b => [1, 2, 4].includes(b.id))) blocks.set(block.id, block)
        blocks.set(2600, desired.block)
        blocks.set(2554, { id: 2554, kind: 'js', name: 'fb_prepare_seeding_iterations',
          code: "await helpers.prepared(); return {commentIterations:[{position:1,text:'hello'}]}" })
        blocks.set(34, { id: 34, kind: 'js', name: 'fb_comment_at_position', code: "await helpers.commented();return {commented:true}" })
        const page = {
          $: async selector => mode === 'no-menu' || mode === 'missing-option' && selector !== elementMap.fb_feed_post_sort_button ? null : {},
          click: async selector => {
            order.push(selector === elementMap.fb_feed_post_sort_button ? 'menu' : 'sort')
            if (mode === 'click-error' && order.at(-1) === 'sort') throw Error('fixture click failure')
          },
          press: async key => order.push(key)
        }
        const runtimeHelpers = { element: async name => elementMap[name],
          prepared: async () => { order.push('prepare') }, commented: async () => { order.push('comment') },
          logRunEvent: async event => { events.push(event) },
          sleep: async ms => {
            if (mode === 'abort-after-menu' && ms === 1000 || mode === 'abort-after-sort' && ms === 2500) abort.abort()
          } }
        const vars = { ...variables, runAsPage: mode === 'restore-only', pageIdentityRestoreOnly: mode === 'restore-only' }
        if (value === undefined) delete vars.commentPostSort // Older Desktop has no new variable.
        const run = await new WorkflowEngineV2().run(workflow, vars, page, { persist: false, signal: abort.signal, runtimeHelpers })
        const interrupted = mode.startsWith('abort-')
        assert.equal(run.status, interrupted ? 'cancelled' : 'completed', `${workflow.id}/${value}/${mode}: ${run.error}`)
        if (interrupted || mode === 'restore-only') {
          assert(!order.includes('prepare')); assert(!order.includes('comment'))
        } else {
          assert(order.indexOf('prepare') < order.indexOf('comment'))
          assert.equal(events.length, 1)
          assert.equal(events[0].debugData.sortType, value ?? 'recent_activity')
          assert.equal(events[0].status, mode === 'normal' ? 'success' : mode === 'click-error' ? 'failed' : 'skipped')
          if (mode === 'normal') {
            assert.deepEqual(order.slice(0, 2), ['menu', 'sort'])
            assert(order.indexOf('sort') < order.indexOf('prepare'), 'sort before collecting/assigning post positions')
          }
          if (['click-error', 'missing-option'].includes(mode)) assert(order.includes('Escape'), 'dismiss open menu before searching')
        }
        checks++
      }
    }
  }
  for (const actionId of ['facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding_post']) {
    const vars = await schedulerInstance.buildVariablesV2({ id: 2, actionId, extraSettings: { commentPostSort: 'new_posts', sortTypePost: 'most_relevant' } }, null, 1, '', 0)
    assert.equal(vars.commentPostSort, undefined); assert.equal(vars.sortTypePost, 'most_relevant'); checks++
  }
  const original = before.blocks.find(b => b.id === 2600).code
  assert(desired.block.code.endsWith(original), 'keep the legacy find-data code byte-for-byte')
  for (const enabled of [false, true]) for (const sortTypePost of ['recent_activity', 'most_relevant', 'new_posts']) {
    const outcomes = []
    for (const code of [original, desired.block.code]) {
      const effects = []
      const output = await runCode(code, { isFindInPost: enabled, sortTypePost }, {}, {
        $: async () => ({}), click: async value => effects.push(value)
      }, { element: async name => name, sleep: async () => {}, log: () => {}, logRunEvent: async event => effects.push(plain(event)) })
      outcomes.push({ output: plain(output), effects })
    }
    assert.deepEqual(outcomes[0], outcomes[1]); checks++
  }
  console.log(`PASS scheduler/engine/cancellation/legacy parity: ${checks} cases`)
}
async function domTests() {
  const { app, BrowserWindow } = require('electron')
  await app.whenReady()
  const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { sandbox: true, contextIsolation: true } })
  const { PageController } = compile('src/main/v2/runtime/pageController.ts')
  const page = new PageController(win.webContents)
  try {
    const names = ['most_relevant', 'recent_activity', 'new_posts']
    for (const labels of [['Phù hợp nhất', 'Hoạt động mới đây', 'Bài viết mới'], ['Most relevant', 'Recent activity', 'New posts']]) {
      for (const current of names) for (const selected of names) {
        const html = `<main role="main">
          <article role="article"><button role="button" onclick="window.wrong=true">${labels[0]}</button></article>
          <div role="dialog"><button role="button" onclick="window.wrong=true">${labels[0]}</button></div>
          <button role="button" id="sort" onclick="document.getElementById('menu').hidden=false">${labels[names.indexOf(current)]}</button>
          <div id="menu" hidden>${names.map((name, i) =>
            `<button role="menuitemradio" onclick="window.selected='${name}';document.getElementById('sort').textContent=this.textContent;document.getElementById('menu').hidden=true">${labels[i]}</button>`).join('')}</div>
          </main>`
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        const out = await runCode(desired.block.code, { commentPostSort: selected }, { commentFeedSort: true }, page,
          { element: async name => elementMap[name], log: () => {}, logRunEvent: async () => {}, sleep: async () => {} })
        const result = await win.webContents.executeJavaScript('({selected:window.selected,wrong:window.wrong||false})')
        assert.equal(result.selected, selected)
        assert.equal(result.wrong, false, 'never click post/comment/dialog sort controls')
        assert.equal(out.postSortApplied, true)
        checks++
      }
    }
    console.log(`PASS real Electron PageController/DOM: ${checks} cases`)
  } finally { win.destroy(); app.quit() }
}
if (process.argv.includes('--dom')) domTests().catch(error => { console.error(error); require('electron').app.exit(1) })
else runtimeTests().then(() => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  process.stdout.write(execFileSync(require('electron'), [__filename, '--dom'], {
    cwd: root, env, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe']
  }))
}).catch(error => { console.error(error); if (error.stderr) console.error(String(error.stderr)); process.exitCode = 1 })
