// Real captured JS, workflow engine, scheduler adapter and PostgreSQL WASM; no live posts.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const v = require('./facebook-top-post-link-v379.cjs')
const { PGlite } = require('../../akaAgentChatApi/node_modules/@electric-sql/pglite')
const root = path.resolve(__dirname, '..'), d = v.desired(), before = v.backup()
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let scenarios = 0

function browser(options = {}) {
  const events = [], waits = [], logs = [], navigations = []
  let rendered = false
  let currentUrl = 'https://www.facebook.com/'
  const link = href => ({ href, getAttribute: () => href })
  const raw = { ...link('?__cft__[0]=raw'), scrollIntoView() { events.push('scroll') },
    dispatchEvent(e) { events.push(e.type) }, focus() { events.push('focus') } }
  const document = { evaluate(selector) {
    let matches = []
    if (selector === 'FbComposerRawPostLink' && !options.missing) matches = [raw]
    if (selector === 'FbComposerPostLink' && rendered && !options.missing) {
      matches = [link('https://www.facebook.com/123/posts/top?__cft__[0]=tracking#part'), link('https://www.facebook.com/123/posts/second')]
    }
    return { snapshotLength: matches.length, snapshotItem: i => matches[i] }
  } }
  const page = { async navigate(url) {
    navigations.push(url)
    if (options.navigationError && url === 'https://www.facebook.com/profile.php') throw new Error('profile navigation failed')
    currentUrl = url
  }, getURL: () => currentUrl, async evaluate(code, ...args) {
    if (options.error) throw new Error('page unavailable')
    if (options.requireProfile) assert.equal(currentUrl, 'https://www.facebook.com/profile.php')
    return new AsyncFunction('document', 'window', 'location', 'URL', 'XPathResult', 'FocusEvent', 'Event', 'setTimeout', '__args', code)(
      document, {}, { href: currentUrl }, URL, { ORDERED_NODE_SNAPSHOT_TYPE: 7 },
      class { constructor(type) { this.type = type } }, class {},
      (fn, ms) => { assert(events.includes('focusin')); assert.equal(ms, 700); waits.push(ms); rendered = true; fn() }, args)
  } }
  const signal = { aborted: !!options.aborted }
  const helpers = { element: async name => { if (options.elementError) throw new Error('missing element'); return name },
    log: line => logs.push(line), sleep: async ms => { if (signal.aborted) throw new Error('cancelled'); waits.push(ms) } }
  return { events, waits, logs, navigations, page, signal, helpers }
}

async function linkTests() {
  for (const options of [{}, { missing: true }, { error: true }, { elementError: true }]) {
    const b = browser(options)
    const result = await vm.runInNewContext(`(async()=>{${d.block.code}\n})()`, { ...b, input: { posted: true }, vars: {} })
    assert.equal(result.ok, true)
    assert.equal(result.postUrl, Object.keys(options).length ? '' : 'https://www.facebook.com/123/posts/top')
    if (!Object.keys(options).length) assert.deepEqual(b.waits, [3000, 700])
    scenarios++
  }
  const unpublished = browser()
  const output = await vm.runInNewContext(`(async()=>{${d.block.code}\n})()`, { ...unpublished, input: { posted: false }, vars: {} })
  assert.equal(output.postUrl, ''); assert.deepEqual(unpublished.waits, []); scenarios++
  await assert.rejects(vm.runInNewContext(`(async()=>{${d.block.code}\n})()`, { ...browser({ aborted: true }), input: { posted: true }, vars: {} }), /cancelled/)
  scenarios++
  // Execute the Page collector plus the real success return, including read errors.
  const start = d.pageCode.indexOf('async function getPostUrl()')
  const end = d.pageCode.indexOf("helpers.log('Đang mở composer", start)
  const finishStart = d.pageCode.indexOf('const postUrl = String(await getPostUrl()')
  const finishEnd = d.pageCode.indexOf('} catch (e)', finishStart)
  for (const options of [{}, { missing: true }, { error: true }]) {
    const b = browser(options)
    const result = await vm.runInNewContext(`(async()=>{${d.pageCode.slice(start, end)}\n${d.pageCode.slice(finishStart, finishEnd)}\n})()`,
      { ...b, rawLinkSelector: 'FbComposerRawPostLink', postLinkSelector: 'FbComposerPostLink', images: [] })
    assert.equal(result.posted, true); assert.equal(result.ok, true)
    assert.equal(result.postUrl, Object.keys(options).length ? '' : 'https://www.facebook.com/123/posts/top')
    scenarios++
  }
}

function compile(file, stubs = {}) {
  const m = { exports: {} }
  new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(k => stubs[k] ?? require(k), m, m.exports)
  return m.exports
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
  const profileUrl = 'https://www.facebook.com/profile.php', sourceUrl = 'https://www.facebook.com/source/posts/source'
  const navCode = before.tables.auto_blocks.find(x => x.row.id === 5).row.code
  for (const w of d.workflows) for (const mode of ['success', 'copy-source', 'profile-failed', 'copy-profile-failed', 'publish-failed', 'composer-failed', 'missing-link', 'reels', 'share']) {
    const copySource = ['copy-source', 'copy-profile-failed'].includes(mode)
    const navigationError = ['profile-failed', 'copy-profile-failed'].includes(mode)
    const original = before.tables.auto_workflows.find(x => x.row.id === w.id).row
    const nodes = w.nodes.concat({ ...w.linkNode, blockId: 9999 })
    const workflow = { ...original, nodes, edges: w.edges, defaultVariables: original.default_variables }
    blocks = new Map(nodes.map(n => [n.blockId, { id: n.blockId, name: n.blockName, kind: 'js', systemType: n.systemType,
      code: n.blockId === 9999 ? d.block.code : n.blockId === 5 ? navCode
        : n.id === 'scrape' ? `await page.navigate('${sourceUrl}'); return {}` : n.id === 'click_post'
        ? mode === 'publish-failed' ? "throw new Error('publish timeout')" : 'return {posted:true}'
        : n.id === 'open_composer' ? `if (page.getURL() !== '${profileUrl}') throw new Error('composer opened outside profile'); return {opened:${mode !== 'composer-failed'}}` : 'return {}' }]))
    const b = browser({ missing: mode === 'missing-link', navigationError, requireProfile: true })
    const run = await new WorkflowEngineV2().run(workflow,
      { postAsReels: mode === 'reels', sharePost: mode === 'share', copyContentFromSource: copySource, sourceLink: sourceUrl }, b.page,
      { persist: false, signal: new AbortController().signal, runtimeHelpers: b.helpers })
    const linkStep = run.steps.find(s => s.nodeId === 'get_post_link')
    const ordinaryPost = !['reels', 'share'].includes(mode)
    assert.deepEqual(b.navigations, ['https://www.facebook.com', ...(copySource ? [sourceUrl, 'https://www.facebook.com'] : []), ...(ordinaryPost ? [profileUrl] : [])])
    if (navigationError) {
      assert.equal(run.status, 'failed')
      assert.equal(run.steps.find(s => s.nodeId === 'nav_profile').status, 'error')
      for (const node of ['open_composer', 'click_post']) assert.notEqual(run.steps.find(s => s.nodeId === node)?.status, 'success')
    }
    if (['success', 'copy-source', 'missing-link'].includes(mode)) {
      assert.equal(run.status, 'completed', run.error); assert.equal(linkStep.status, 'success')
      assert.equal(linkStep.output.postUrl, mode === 'missing-link' ? '' : 'https://www.facebook.com/123/posts/top')
      const completed = run.steps.filter(s => s.status === 'success').map(s => s.nodeId)
      assert(completed.indexOf('nav_profile') < completed.indexOf('open_composer'))
      assert(completed.indexOf('click_post') < completed.indexOf('get_post_link'))
    } else assert.notEqual(linkStep?.status, 'success')
    scenarios++
  }
}

async function schedulerTests() {
  const source = fs.readFileSync(path.join(root, 'src/main/services/campaignScheduler.ts'), 'utf8')
  const start = source.indexOf('    const postSteps = groupPostVerifySteps.length > 0')
  const end = source.indexOf('    const groupPostCommentAdjustStep =', start)
  assert(start > 0 && end > start)
  const code = ts.transpileModule(`module.exports = async function(steps,createCampaignDetail) {
    const groupPostVerifySteps=[],campaign={id:1,actionId:'facebook_timeline_post'},detail=null,accountId=1;
    const emits=()=>true,flushScreenshotLogsForStep=async()=>{};
    ${source.slice(start, end)}
  }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const ctx = { module: { exports: null }, ResultContractError: class extends Error {}, console }
  vm.runInNewContext(code, ctx)
  const post = () => ({ blockName: 'fb_click_post_button', status: 'success', output: { posted: true } })
  const link = url => ({ blockName: v.blockName, status: 'success', output: { postUrl: url } })
  for (const [steps, expected] of [
    [[post(), link('https://www.facebook.com/1/posts/top')], ['https://www.facebook.com/1/posts/top']],
    [[post(), link('')], [undefined]], [[post(), { ...link('bad'), status: 'error' }], [undefined]],
    [[link('stale'), post()], [undefined]], [[post(), post(), link('second')], [undefined, 'second']],
    [[{ ...post(), status: 'error' }, link('unused')], []]
  ]) {
    const details = [], logs = []
    await ctx.module.exports.call({ cleanPostLinkForStorage: x => x, getPostActionCode: () => 'fb_post_my_profile',
      logCampaignProgress: async (_campaign, message) => logs.push(message) }, steps, async row => details.push(row))
    assert.deepEqual(details.map(row => row.postUrl), expected)
    assert(details.every(row => row.status === 'thành công'))
    assert.equal(logs.filter(x => x.includes('Link bài post:')).length, expected.filter(Boolean).length)
    scenarios++
  }
}

async function sqlTests() {
  const db = new PGlite()
  try {
    for (const [table, rows] of Object.entries(before.tables)) {
      const definitions = Object.entries(rows[0].row).map(([k, value]) => `${k} ${k === 'id' ? 'bigint GENERATED BY DEFAULT AS IDENTITY (START WITH 10000) PRIMARY KEY' :
        ['created_at', 'updated_at'].includes(k) ? 'timestamptz DEFAULT now()' :
          value && typeof value === 'object' ? 'jsonb' : typeof value === 'boolean' ? 'boolean' :
            ['staff_id', 'organization_id'].includes(k) ? 'bigint' : 'text'}`)
      await db.exec(`CREATE TABLE ${table} (${definitions.join(',')});`)
      for (const { row } of rows) await db.exec(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},${v.json(row)});`)
    }
    await db.exec(`CREATE TABLE auto_campaign_actions(id text,workflow_id bigint,test_workflow_id bigint);
      CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text,name text);`)
    for (const row of before.actions) await db.exec(`INSERT INTO auto_campaign_actions SELECT * FROM jsonb_populate_record(NULL::auto_campaign_actions,${v.json(row)});`)
    const original = await db.query('SELECT id,nodes,edges FROM auto_workflows ORDER BY id')
    await db.exec(v.sql())
    const rows = (await db.query('SELECT id,nodes,edges FROM auto_workflows ORDER BY id')).rows
    assert.equal(rows.filter(w => w.nodes.some(n => n.blockName === v.blockName)).length, 2)
    for (const w of d.workflows) {
      const actual = rows.find(row => row.id === w.id)
      assert.deepEqual(actual.nodes.filter(n => n.id !== 'get_post_link'), w.nodes)
      assert.deepEqual(actual.edges, w.edges)
    }
    assert.deepEqual(rows.filter(w => [226, 250].includes(w.id)), original.rows.filter(w => [226, 250].includes(w.id)))
    assert.equal((await db.query("SELECT code FROM auto_blocks WHERE id=2626")).rows[0].code,
      before.tables.auto_blocks.find(x => x.row.id === 2626).row.code)
    scenarios++
    await assert.rejects(db.exec(v.sql()), /block already exists/); await db.exec('ROLLBACK'); scenarios++
    await db.exec(v.rollbackSQL())
    assert.deepEqual((await db.query('SELECT id,nodes,edges FROM auto_workflows ORDER BY id')).rows, original.rows)
    scenarios++
    await db.exec(`DELETE FROM auto_blocks WHERE name=${v.quote(v.blockName)}; UPDATE auto_blocks SET code=code||'\n// external patch' WHERE id=2672;`)
    await assert.rejects(db.exec(v.sql()), /2672 drift/); await db.exec('ROLLBACK'); scenarios++
    await db.exec(`UPDATE auto_blocks SET code=${v.quote(before.tables.auto_blocks.find(x => x.row.id === 2672).row.code)} WHERE id=2672;
      UPDATE auto_blocks SET code=code||'\n// external navigation patch' WHERE id=5;`)
    await assert.rejects(db.exec(v.sql()), /auto_blocks\/5 drift/); await db.exec('ROLLBACK'); scenarios++
  } finally { await db.close() }
}

async function main() {
  assert.equal(fs.readFileSync(v.migrationPath, 'utf8'), v.sql(), 'generated migration must match source')
  await linkTests(); await graphTests(); await schedulerTests(); await sqlTests()
  console.log(`${scenarios} top-post-link checks passed; no live DB writes or Facebook actions`)
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
