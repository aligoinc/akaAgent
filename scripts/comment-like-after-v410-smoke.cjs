// Offline: real workflow engine + captured comment blocks, Electron DOM, PostgreSQL.
// No Facebook navigation, posting or production mutations.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const v = require('./comment-like-after-v410.cjs')
const root = path.resolve(__dirname, '..'), b = v.backup(), d = v.desired()
let checks = 0
const graphRuns = []
const plain = value => JSON.parse(JSON.stringify(value))
function compile(file, stubs = {}) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
    name => name in stubs ? stubs[name] : require(name), module, module.exports)
  return module.exports
}

async function graphTests() {
  let blocks
  const { BlockExecutor } = compile('src/main/v2/runtime/blockExecutor.ts', {
    './blockHelpers': { createBlockHelpers: (log, h) => ({ log, ...h }) }
  })
  const { WorkflowEngineV2 } = compile('src/main/v2/runtime/workflowEngine.ts', {
    './blockExecutor': { BlockExecutor }, '../../data/repositories/blockRepository': { getBlock: async id => blocks.get(id) },
    '../../data/repositories/workflowV2Repository': {}, '../../data/repositories/runV2Repository': {}
  })
  for (const changed of d.workflows) {
    const original = b.tables.auto_workflows.find(e => e.row.id === changed.id).row
    for (const mode of ['success', 'disabled', 'missing', 'like-error', 'selector-error', 'comment-empty', 'comment-error',
      'frequency-limit', 'media-only', 'second-comment-empty', 'abort-after-comment', 'old-graph']) {
      const w = mode === 'old-graph' ? original : changed
      const commentNode = w.nodes.find(n => [34, 2616].includes(n.blockId))
      const feed = commentNode.blockId === 34
      const order = [], abort = new AbortController()
      let submits = 0, likes = 0, iteration = 0
      const items = mode === 'second-comment-empty'
        ? [{ position: 1, text: 'one' }, { position: 2, text: '' }]
        : [{ position: 1, text: mode === 'comment-empty' || mode === 'media-only' ? '' : 'one',
          images: mode === 'media-only' ? ['fixture.jpg'] : [] }]
      blocks = new Map(w.nodes.map(n => [n.blockId, { id: n.blockId, name: n.blockName, kind: 'js',
        code: 'return {}' }]))
      for (const { row } of b.tables.auto_blocks) blocks.set(row.id, row)
      for (const row of d.blocks) blocks.set(row.id, row)
      // Keep real comments/Like and full graph; only navigation/search/Page setup is stubbed.
      const prepare = w.nodes.find(n => n.id === 'prepare_iters')
      blocks.set(prepare.blockId, { id: prepare.blockId, name: prepare.blockName, kind: 'js',
        code: `return {commentIterations:${JSON.stringify(items)}}` })
      const helpers = {
        element: async name => {
          if (name === v.elementName && mode === 'selector-error') throw new Error('element unavailable')
          return name === v.elementName ? v.xpath : name
        },
        elementWith: async (name, args) => { iteration = args.n; return name },
        sleep: async ms => {
          order.push('sleep:' + ms)
          if (abort.signal.aborted) throw new Error('cancelled')
        }
      }
      const page = {
        waitForSelector: async () => {}, click: async selector => order.push('click:' + selector),
        fill: async () => order.push('fill'), type: async () => order.push('space'),
        dropFile: async () => { order.push('media'); return { fileCount: 1 } },
        press: async key => {
          order.push(key)
          if (key === 'Enter') {
            if (mode === 'comment-error') throw new Error('submit failed')
            submits++
          }
        },
        evaluate: async (code, ...args) => {
          if (args[0] === 'GroupPostFrequencyLimitError') {
            order.push('frequency-check')
            return mode === 'frequency-limit'
          }
          if (args[0] === 'fb_comment_permalink') {
            order.push('comment-link')
            if (mode === 'abort-after-comment') abort.abort()
            return `https://www.facebook.com/fixture/posts/1?comment_id=${iteration || 1}`
          }
          assert.equal(args[0], v.xpath)
          assert(submits > likes, 'Like only after a new comment has been submitted')
          assert(order.includes('comment-link'), 'Like waits for the existing frequency/link checks')
          order.push('like')
          if (mode === 'like-error') throw new Error('browser failed')
          if (mode === 'missing') return { liked: false, skipped: true }
          likes++
          return { liked: true, alreadyLiked: false }
        }
      }
      const run = await new WorkflowEngineV2().run({ ...w, defaultVariables: w.default_variables },
        { enablePostLike: mode !== 'disabled', runAsPage: false }, page,
        { persist: false, signal: abort.signal, runtimeHelpers: helpers })
      if ([157, 207].includes(w.id) && ['success', 'missing', 'like-error', 'media-only'].includes(mode)) {
        graphRuns.push({ actionId: w.name, mode, run })
      }
      const comments = run.steps.filter(s => s.blockName === commentNode.blockName && s.status === 'success')
      if (mode === 'frequency-limit' || (mode === 'comment-error' && !feed)) {
        assert.equal(run.status, 'failed')
      } else if (mode !== 'abort-after-comment') assert.equal(run.status, 'completed', `${w.id}/${mode}: ${run.error}`)
      const shouldLike = ['success', 'media-only', 'second-comment-empty'].includes(mode)
      assert.equal(likes, shouldLike ? 1 : 0, `${w.id}/${mode}: like count`)
      const expectedSubmits = ['comment-empty', 'comment-error'].includes(mode) ? 0 : 1
      assert.equal(submits, expectedSubmits, `${w.id}/${mode}: never resubmit a comment`)
      if (['success', 'disabled', 'missing', 'like-error', 'selector-error', 'media-only', 'old-graph'].includes(mode)) {
        assert.equal(comments.length, 1)
        assert.equal(comments[0].output.commented, true)
        assert.equal(comments[0].output.imageCount, mode === 'media-only' ? 1 : 0)
        assert(comments[0].output.commentUrl.includes('comment_id='))
        const merged = run.steps.find(s => s.nodeId === 'merge_like' && s.status === 'success')
        if (mode !== 'old-graph') assert.equal(merged.output.commented, true, 'retain comment output across both Like branches')
      }
      if (mode === 'second-comment-empty') assert.equal(comments[1].output.commented, false)
      checks++
    }
    // No user-facing labels or other node settings change.
    for (const node of changed.nodes) {
      const old = original.nodes.find(n => n.id === node.id)
      assert.deepEqual(node, node.id === 'if_like'
        ? { ...old, config: { ...old.config, condition: 'vars.enablePostLike === true && input.commented === true && input.commentFailed !== true' } }
        : old)
    }
    checks++
  }
}

async function domTests() {
  const { app, BrowserWindow } = require('electron')
  await app.whenReady()
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
  try {
    for (const block of d.blocks) for (const mode of ['success', 'english', 'no-dialog', 'missing', 'already-liked',
      'click-error', 'removed', 'disabled', 'failed-comment', 'commentFailed', 'abort-before', 'abort-element', 'abort-after']) {
      const button = (id, label = 'Thích', pressed = false) =>
        `<div id="${id}" role="button" aria-label="${label}" aria-pressed="${pressed}">${label}</div>`
      const html = `<div role="feed">${button('feed')}</div>
        <div role="dialog" aria-label="Thông báo">${button('notifications')}</div>
        <div role="dialog" aria-label="Messenger">${button('messenger')}</div>
        ${mode === 'no-dialog' ? '' : `<div role="dialog">
          ${mode === 'missing' ? '' : button('first', mode === 'english' ? 'Like' : 'Thích', mode === 'already-liked')}
          ${mode === 'missing' ? '' : button('comment-like')}
          <div role="textbox" contenteditable="true" aria-label="Bình luận"></div>
        </div><div role="dialog">${button('second-dialog')}</div>`}`
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
      await win.webContents.executeJavaScript(`window.clicked = [];
        document.querySelectorAll('[role="button"]').forEach(el => el.addEventListener('click', () => window.clicked.push(el.id)));
        ${mode === 'click-error' ? "document.getElementById('first').click = () => { throw new Error('click failed') };" : ''}
        ${mode === 'removed' ? "document.getElementById('first').scrollIntoView = function() { this.remove() };" : ''}
        null;`)
      const abort = new AbortController()
      if (mode === 'abort-before') abort.abort()
      const output = await vm.runInNewContext(`(async()=>{${block.code}})()`, {
        vars: { enablePostLike: mode !== 'disabled', loopItem: { position: 3 } },
        input: { enabled: true, commented: mode !== 'failed-comment', commentFailed: mode === 'commentFailed', position: 3 },
        signal: abort.signal,
        helpers: {
          log() {},
          element: async name => {
            assert.equal(name, v.elementName)
            if (mode === 'abort-element') abort.abort()
            return v.xpath
          },
          sleep: async () => { if (mode === 'abort-after') { abort.abort(); throw new Error('cancelled') } }
        },
        page: { evaluate: async (code, ...args) =>
          win.webContents.executeJavaScript(`(async()=>{const __args=${JSON.stringify(args)};${code}})()`) }
      })
      const clicked = await win.webContents.executeJavaScript('window.clicked')
      assert.deepEqual(clicked, ['success', 'english', 'abort-after'].includes(mode) ? ['first'] : [], mode)
      assert.equal(output.liked, ['success', 'english', 'already-liked', 'abort-after'].includes(mode), mode)
      assert.equal(output.position, 3)
      checks++
    }
    console.log(JSON.stringify({ electron_dom_passed: true, checks }))
  } finally { win.destroy(); app.quit() }
}

async function schedulerTests() {
  const { schedulerClass, fixture } = require('./campaign-media-timeout-smoke-test.cjs')
  const { loader } = require('./action-status-runtime-smoke.cjs')
  const load = loader()
  const Scheduler = schedulerClass(await import('zca-js'), {
    '../../shared/actionStatusPolicy': load(path.join(root, 'src/shared/actionStatusPolicy.ts')),
    '../../shared/actionResultSession': load(path.join(root, 'src/shared/actionResultSession.ts'))
  })
  for (const { actionId, mode, run } of graphRuns) {
    const f = fixture(Scheduler)
    f.campaign.actionId = actionId
    f.scheduler.logCampaignProgress = async () => {}
    await f.scheduler.logMilestonesV2(f.campaign, { id: 100, name: 'Fixture' }, 20, plain(run.steps), true)
    const comments = f.details.filter(row => row.actionCode === 'fb_comment')
    assert.equal(comments.length, 1, actionId + '/' + mode)
    assert.equal(comments[0].status, 'thành công')
    assert(comments[0].data.commentUrl.includes('comment_id='))
    checks++
  }
}

async function sqlTests() {
  const { PGlite } = require('../../akaAgentChatApi/node_modules/@electric-sql/pglite')
  const db = new PGlite()
  try {
    await db.exec("SET timezone='UTC'")
    for (const [table, entries] of Object.entries(b.tables)) {
      const fields = Object.entries(entries[0].row).map(([key, value]) => `${key} ${
        key === 'id' ? 'bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY' :
          ['created_at', 'updated_at'].includes(key) ? 'timestamptz' : value && typeof value === 'object' ? 'jsonb' :
            typeof value === 'boolean' ? 'boolean' : typeof value === 'number' || ['staff_id', 'organization_id'].includes(key) ? 'bigint' : 'text'}`)
      await db.exec(`CREATE TABLE ${table} (${fields.join(',')});`)
      for (const { row } of entries) await db.exec(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},${v.json(row)});`)
      await db.exec(`SELECT setval(pg_get_serial_sequence('${table}','id'),(SELECT max(id) FROM ${table}));`)
    }
    await db.exec('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text,name text);')
    const originals = {}
    for (const table of Object.keys(b.tables)) originals[table] = (await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY id`)).rows
    await db.exec(v.sql())
    for (const [table, desiredRows] of [['auto_blocks', d.blocks], ['auto_workflows', d.workflows]]) {
      const actual = (await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY id`)).rows
      for (const { row } of actual) assert.deepEqual(v.stripTime(row), v.stripTime(
        desiredRows.find(r => r.id === row.id) || originals[table].find(e => e.row.id === row.id).row))
      checks++
    }
    const newElement = (await db.query(`SELECT to_jsonb(t)-'id'-'created_at'-'updated_at' row FROM auto_elements t WHERE name=${v.quote(v.elementName)}`)).rows[0].row
    assert.deepEqual(newElement, d.element); checks++
    await db.exec("UPDATE auto_blocks SET code=code||'// newer' WHERE id=2074")
    await assert.rejects(db.exec(v.rollbackSQL()), /2074 drift/); await db.exec('ROLLBACK'); checks++
    await db.exec(`UPDATE auto_blocks SET code=${v.quote(d.blocks.find(r => r.id === 2074).code)} WHERE id=2074`)
    await db.exec(v.rollbackSQL())
    for (const table of ['auto_blocks', 'auto_workflows']) {
      assert.deepEqual((await db.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY id`)).rows, originals[table])
      checks++
    }
    await db.exec(`DELETE FROM auto_elements WHERE name=${v.quote(v.elementName)}`)
    for (const [mutate, restore, expected] of [
      ["UPDATE auto_blocks SET code=code||'// drift' WHERE id=34", `UPDATE auto_blocks SET code=${v.quote(b.tables.auto_blocks.find(e => e.row.id === 34).row.code)} WHERE id=34`, /auto_blocks\/34 drift/],
      ["UPDATE auto_workflows SET name='drift' WHERE id=157", "UPDATE auto_workflows SET name='facebook_comment_seeding' WHERE id=157", /auto_workflows\/157 drift/],
      ["UPDATE auto_elements SET xpath='drift' WHERE id=1517", `UPDATE auto_elements SET xpath=${v.quote(b.tables.auto_elements.find(e => e.row.id === 1517).row.xpath)} WHERE id=1517`, /auto_elements\/1517 drift/],
      [`INSERT INTO supabase_migrations.schema_migrations VALUES('fixture',${v.quote(v.name)})`, 'DELETE FROM supabase_migrations.schema_migrations', /already applied/]
    ]) {
      await db.exec(mutate)
      await assert.rejects(db.exec(v.sql()), expected); await db.exec('ROLLBACK')
      await db.exec(restore)
      checks++
    }
  } finally { await db.close() }
}

async function main() {
  assert.equal(fs.readFileSync(v.migrationPath, 'utf8'), v.sql())
  assert.equal(fs.readFileSync(path.join(v.directory, 'rollback.sql'), 'utf8'), v.rollbackSQL())
  await graphTests()
  await schedulerTests()
  await sqlTests()
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const dom = execFileSync(require('electron'), [__filename, '--dom'], { env, encoding: 'utf8', timeout: 60000 })
  console.log(dom.trim())
  console.log(JSON.stringify({ passed: true, graph_and_sql_checks: checks, external_actions: 0 }))
}
if (process.argv.includes('--dom')) domTests().catch(error => { console.error(error); require('electron').app.exit(1) })
else main().catch(error => { console.error(error.stack || error); process.exitCode = 1 })
