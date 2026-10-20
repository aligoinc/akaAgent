// Local Electron fixtures and real workflow engine; no Facebook actions.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const split = require('./comment-like-separate-elements-v412.cjs')
const legacy = require('./comment-like-after-v410.cjs')
const root = path.resolve(__dirname, '..')
const parentXpath = split.before().elements.find(e => e.row.id === 1492).row.xpath
const compile = (file, imports) => {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)(name => imports[name] ?? require(name), module, module.exports)
  return module.exports
}
async function graphTests() {
  let blocks
  const { BlockExecutor } = compile('src/main/v2/runtime/blockExecutor.ts', {
    './blockHelpers': { createBlockHelpers: (log, helpers) => ({ log, ...helpers }) }
  })
  const { WorkflowEngineV2 } = compile('src/main/v2/runtime/workflowEngine.ts', {
    './blockExecutor': { BlockExecutor }, '../../data/repositories/blockRepository': { getBlock: async id => blocks.get(id) },
    '../../data/repositories/workflowV2Repository': {}, '../../data/repositories/runV2Repository': {}
  })
  for (const w of legacy.desired().workflows) {
    const trace = []
    blocks = new Map(w.nodes.map(n => [n.blockId, { id: n.blockId, name: n.blockName, code: 'return {}' }]))
    for (const { row } of split.before().blocks) blocks.set(row.id, row)
    for (const row of split.desired().blocks) blocks.set(row.id, row)
    const prepare = w.nodes.find(n => n.id === 'prepare_iters')
    blocks.set(prepare.blockId, { id: prepare.blockId, name: prepare.blockName,
      code: 'return {commentIterations:[{position:1,text:"one"},{position:2,text:"two"}]}' })
    const page = {
      waitForSelector: async () => {}, click: async () => {}, fill: async () => {}, type: async () => {},
      press: async key => { if (key === 'Enter') trace.push('comment') },
      evaluate: async (_code, ...args) => {
        if (args[0] === 'GroupPostFrequencyLimitError') return false
        if (args[0] === 'fb_comment_permalink') return 'https://www.facebook.com/fixture?comment_id=1'
        assert.equal(args[0], parentXpath)
        assert.equal(args[1], split.xpath)
        assert.equal(trace.at(-1), 'comment')
        trace.push('like')
        return { liked: true }
      }
    }
    const result = await new WorkflowEngineV2().run({ ...w, defaultVariables: w.default_variables },
      { enablePostLike: true, runAsPage: false }, page, { persist: false, runtimeHelpers: {
        element: async name => name === split.parentName ? parentXpath : name === split.elementName ? split.xpath : name,
        elementWith: async name => name, sleep: async () => {}
      } })
    assert.equal(result.status, 'completed', result.error)
    assert.deepEqual(trace, ['comment', 'like', 'comment', 'like'])
    const merges = result.steps.filter(s => s.nodeId === 'merge_like')
    assert.equal(merges.length, 2)
    assert(merges.every(s => s.output.commented === true))
  }
  console.log(JSON.stringify({ workflow_checks: 4, iterations: 8, passed: true }))
}
async function domTests() {
  const { app, BrowserWindow } = require('electron')
  await app.whenReady()
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  let checks = 0
  try {
    for (const block of split.desired().blocks) for (const mode of [
      'success', 'english', 'new-parent', 'first-parent', 'no-parent', 'no-button', 'stale-absolute',
      'outside-union', 'disabled', 'failed-comment', 'already-pressed', 'abort-parent'
    ]) {
      const button = (id, label = 'Thích', pressed = false) =>
        `<div id="${id}" role="button" aria-label="${label}" aria-pressed="${pressed}">${label}</div>`
      const html = `${button('outside')}<div role="dialog" aria-label="Thông báo">${button('notice')}</div>
        <div role="dialog" aria-label="Messenger">${button('messenger')}</div>
        ${mode === 'no-parent' ? '' : `<${mode === 'new-parent' ? 'section id="new-parent"' : 'div role="dialog"'}>
          ${mode === 'no-button' ? '' : button('first', mode === 'english' ? 'Like' : 'Thích', mode === 'already-pressed')}
          ${mode === 'no-button' ? '' : button('second')}
        </${mode === 'new-parent' ? 'section' : 'div'}>`}
        ${['first-parent', 'no-button'].includes(mode) ? `<div role="dialog">${button('later-parent')}</div>` : ''}`
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      await win.webContents.executeJavaScript("window.clicked=[];document.querySelectorAll('[role=button]').forEach(el=>el.addEventListener('click',()=>window.clicked.push(el.id)));null")
      const abort = new AbortController()
      let evaluations = 0
      const result = await vm.runInNewContext(`(async()=>{${block.code}})()`, {
        input: { commented: mode !== 'failed-comment' }, vars: { enablePostLike: mode !== 'disabled' },
        signal: abort.signal,
        helpers: {
          log() {}, sleep: async () => {},
          element: async name => {
            if (name === split.parentName) {
              if (mode === 'abort-parent') abort.abort()
              return mode === 'new-parent' ? "//*[@id='new-parent']" : parentXpath
            }
            assert.equal(name, split.elementName)
            return mode === 'stale-absolute' ? "//*[@id='outside']"
              : mode === 'outside-union' ? split.xpath + " | //*[@id='outside']" : split.xpath
          }
        },
        page: { evaluate: async (code, ...args) => {
          evaluations++
          return win.webContents.executeJavaScript(`(async()=>{const __args=${JSON.stringify(args)};${code}})()`)
        } }
      })
      const clicked = await win.webContents.executeJavaScript('window.clicked')
      assert.deepEqual(clicked, ['success', 'english', 'new-parent', 'first-parent'].includes(mode) ? ['first'] : [], mode)
      assert.equal(result.liked, ['success', 'english', 'new-parent', 'first-parent', 'already-pressed'].includes(mode), mode)
      if (['disabled', 'failed-comment', 'stale-absolute', 'abort-parent'].includes(mode)) assert.equal(evaluations, 0, mode)
      checks++
    }
    console.log(JSON.stringify({ electron_dom_checks: checks, passed: true, external_actions: 0 }))
  } finally { win.destroy(); app.quit() }
}
async function main() {
  await graphTests()
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  console.log(execFileSync(require('electron'), [__filename, '--dom'], { env, encoding: 'utf8', timeout: 60000 }).trim())
}
if (process.argv.includes('--dom')) domTests().catch(error => { console.error(error); require('electron').app.exit(1) })
else main().catch(error => { console.error(error); process.exitCode = 1 })
