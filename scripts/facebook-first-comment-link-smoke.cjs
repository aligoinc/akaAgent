// Executes captured block JS, the real scheduler and offline PostgreSQL. No real comments.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const v = require('./facebook-first-comment-link-v380.cjs')
const { PGlite } = require('../../akaAgentChatApi/node_modules/@electric-sql/pglite')
const { schedulerClass, fixture } = require('./campaign-media-timeout-smoke-test.cjs')
const { loader } = require('./action-status-runtime-smoke.cjs')
const root = path.resolve(__dirname, '..'), before = v.backup(), desired = v.desired()
const first = 'https://www.facebook.com/fixture/posts/1?comment_id=111&reply_comment_id=222&__cft__[0]=keep'
const second = 'https://www.facebook.com/fixture/posts/1?comment_id=333'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let checks = 0

function browser(options = {}) {
  const events = [], signal = { aborted: false }
  let submitted = false
  const document = { evaluate(selector, _root, _resolver, type) {
    assert.equal(selector, v.xpath)
    assert.equal(type, 9)
    assert(submitted, 'read link only after Enter')
    assert(events.some(e => e === 'sleep:10000'), 'preserve comment settle delay')
    assert(events.includes('frequency-check'), 'keep frequency check before link lookup')
    events.push('read-first-link')
    const hrefs = options.missing ? [] : options.hrefs || [first, second]
    return { singleNodeValue: hrefs.length ? { href: hrefs[0], getAttribute: () => hrefs[0] } : null }
  } }
  const helpers = {
    element: async name => {
      if (name === v.elementName) {
        events.push('resolve-link')
        if (options.elementError) throw new Error('element unavailable')
        return v.xpath
      }
      return name
    },
    elementWith: async name => name,
    sleep: async ms => events.push('sleep:' + ms),
    log: () => {}
  }
  const page = {
    waitForSelector: async () => {}, click: async () => {}, fill: async () => {}, type: async () => {},
    dropFile: async () => { events.push('upload'); return { fileCount: 1 } },
    press: async key => {
      events.push('press:' + key)
      if (key === 'Enter') {
        if (options.submitError) throw new Error('submit failed')
        submitted = true
      }
    },
    evaluate: async (code, ...args) => {
      if (args[0] === 'GroupPostFrequencyLimitError') { events.push('frequency-check'); return !!options.frequencyError }
      assert.equal(args[0], v.xpath)
      if (options.readError) throw new Error('page unavailable')
      return new AsyncFunction('document', 'XPathResult', '__args', code)(document, { FIRST_ORDERED_NODE_TYPE: 9 }, args)
    }
  }
  return { events, signal, helpers, page }
}

async function runBlock(block, options = {}, vars) {
  const b = browser(options)
  vars ??= { newsfeedState: { remainingComment: 2, commentDone: 0, currentPost: { targetName: 'Fixture' } } }
  const input = { text: options.empty || options.image ? '' : 'fixture comment', images: options.image ? ['fixture.jpg'] : [], pasted: !options.empty }
  const result = await vm.runInNewContext(`(async()=>{${block.code}\n})()`, { ...b, input, vars })
  return { result, ...b, vars }
}

async function blockTests() {
  for (const block of desired.blocks) {
    for (const options of [{}, { missing: true }, { readError: true }, { elementError: true }]) {
      const { result, events, vars } = await runBlock(block, options)
      assert.equal(result.commented, true)
      assert.equal(result.commentUrl, Object.keys(options).length ? '' : first)
      assert.equal(events.filter(e => e === 'press:Enter').length, 1, 'never resubmit for a missing link')
      assert(!events.includes('press:Escape'))
      if (block.id === 2710) { assert.equal(vars.newsfeedState.commentDone, 1); assert.equal(vars.newsfeedState.remainingComment, 1) }
      checks++
    }
    const empty = await runBlock(block, { empty: true })
    assert.equal(empty.result.commented, false)
    assert(!empty.events.includes('resolve-link')); checks++
    if (block.id !== 2710) {
      const image = await runBlock(block, { image: true })
      assert.equal(image.result.imageCount, 1)
      assert.equal(image.result.commentUrl, first)
      assert.equal(image.events.filter(e => e === 'sleep:10000').length, 2); checks++
    }
    if (block.id === 2616) await assert.rejects(runBlock(block, { submitError: true }), /submit failed/)
    else {
      const failed = await runBlock(block, { submitError: true })
      assert.equal(failed.result.commented, false)
      assert(!failed.events.includes('resolve-link'))
    }
    checks++
    await assert.rejects(runBlock(block, { frequencyError: true }), /giới hạn tần suất comment/); checks++
    const previous = await runBlock(block)
    const next = await runBlock(block, { missing: true }, previous.vars)
    assert.equal(previous.result.commentUrl, first)
    assert.equal(next.result.commentUrl, '', 'do not borrow a prior iteration link'); checks++
  }
  await assert.rejects(vm.runInNewContext(`(async()=>{${v.collector}\nreturn getFirstCommentUrl()})()`, {
    signal: { aborted: true }, helpers: { element: async () => { throw new Error('cancelled') } }
  }), /cancelled/); checks++
}

async function schedulerTests() {
  const zca = await import('zca-js'), load = loader()
  const Scheduler = schedulerClass(zca, {
    '../../shared/actionStatusPolicy': load(path.join(root, 'src/shared/actionStatusPolicy.ts')),
    '../../shared/actionResultSession': load(path.join(root, 'src/shared/actionResultSession.ts'))
  })
  const step = (id, blockName, output) => ({ id, runId: 1, nodeId: blockName, blockName, status: 'success', startedAt: String(id), output })
  for (const actionId of ['facebook_group_post', 'facebook_comment_seeding', 'facebook_comment_seeding_post']) {
    const f = fixture(Scheduler), logs = []
    f.campaign.actionId = actionId
    f.scheduler.logCampaignProgress = async (_c, line) => logs.push(line)
    const blockName = actionId === 'facebook_comment_seeding_post' ? 'fb_comment_current_post' : 'fb_comment_at_position'
    const outputs = [
      { commented: true, text: 'text', commentUrl: first },
      { commented: true, imageCount: 1, commentUrl: second },
      { commented: true, text: 'missing' },
      { commented: false, commentFailed: true, text: 'failed', error: 'existing error', commentUrl: 'stale' }
    ]
    await f.scheduler.logMilestonesV2(f.campaign, { id: 100, name: 'Fixture' }, 20, outputs.map((o, i) => step(i, blockName, o)), true)
    assert.deepEqual(f.details.map(d => d.postUrl), [first, second, undefined, undefined])
    assert.deepEqual(f.details.map(d => d.data.commentUrl), [first, second, undefined, undefined])
    assert.deepEqual(f.details.map(d => d.status), ['thành công', 'thành công', 'thành công', 'thất bại'])
    assert.equal(logs.filter(l => l.startsWith('🔗 Link comment:')).length, 2)
    checks++
  }
  // Realtime/finalization share one receipt, including existing explicit envelopes.
  for (const envelope of ['legacy', 'single', 'batch', 'direct']) for (const url of [first, '']) {
    const f = fixture(Scheduler), logs = []
    f.campaign.actionId = 'facebook_newsfeed_interaction'
    f.scheduler.logCampaignProgress = async (_c, line) => logs.push(line)
    const output = { commented: true, text: 'comment', targetName: 'Fixture', commentUrl: url }
    const explicit = { actionCode: 'fb_comment', statusCode: 'campaign_detail_success', operationState: 'committed' }
    Object.assign(output, envelope === 'single' ? { actionResult: explicit } : envelope === 'batch'
      ? { actionResults: [explicit] } : envelope === 'direct' ? explicit : {})
    const s = step(1, 'fb_newsfeed_comment_submit', output)
    await Promise.all([f.scheduler.logNewsfeedMilestoneStep(f.campaign, null, 20, s),
      f.scheduler.logNewsfeedMilestoneStep(f.campaign, null, 20, structuredClone(s))])
    await f.scheduler.logMilestonesV2(f.campaign, null, 20, [structuredClone(s)], true)
    assert.equal(f.details.length, 1)
    assert.equal(f.details[0].postUrl, url || undefined)
    assert.equal(f.details[0].data.commentUrl, url || undefined)
    assert.equal(logs.filter(l => l.startsWith('🔗 Link comment:')).length, url ? 1 : 0)
    checks++
  }
  const f = fixture(Scheduler)
  f.campaign.actionId = 'facebook_newsfeed_interaction'
  await f.scheduler.logNewsfeedMilestoneStep(f.campaign, null, 20,
    step(1, 'fb_newsfeed_like_post', { liked: true, commentUrl: first }))
  assert.equal(f.details[0].postUrl, undefined, 'like cannot inherit a comment URL'); checks++
  for (const result of [
    { actionCode: 'fb_comment', statusCode: 'campaign_detail_success', operationState: 'committed', inputDataId: 999 },
    { actionCode: 'fb_comment', statusCode: 'campaign_detail_failed', operationState: 'not_committed' }
  ]) {
    const f = fixture(Scheduler), logs = []
    f.campaign.actionId = 'facebook_newsfeed_interaction'
    f.scheduler.logCampaignProgress = async (_c, line) => logs.push(line)
    await f.scheduler.logNewsfeedMilestoneStep(f.campaign, { id: 100 }, 20,
      step(1, 'fb_newsfeed_comment_submit', { commented: true, text: 'old wrapper', commentUrl: first, actionResult: result }))
    assert.equal(f.details[0].postUrl, undefined, 'failed/other-input results cannot inherit the wrapper link')
    assert.equal(f.details[0].data.commentUrl, undefined)
    assert(!logs.some(l => l.startsWith('🔗 Link comment:'))); checks++
  }
}

async function sqlTests() {
  const db = new PGlite()
  try {
    await db.exec("SET timezone='UTC'")
    for (const [table, rows] of Object.entries(before.tables)) {
      const definitions = Object.entries(rows[0].row).map(([k, value]) => `${k} ${k === 'id' ? 'bigint GENERATED BY DEFAULT AS IDENTITY (START WITH 10000) PRIMARY KEY' :
        ['created_at', 'updated_at'].includes(k) ? 'timestamptz DEFAULT now()' : value && typeof value === 'object' ? 'jsonb' :
          typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'bigint' : ['staff_id', 'organization_id'].includes(k) ? 'bigint' : 'text'}`)
      await db.exec(`CREATE TABLE ${table} (${definitions.join(',')});`)
      for (const { row } of rows) await db.exec(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},${v.json(row)});`)
    }
    // Guard workflow canonical hashes separately; this fixture contains only captured workflow fields.
    await db.exec(`CREATE TABLE auto_workflows(id bigint,name text,nodes jsonb,edges jsonb);
      CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text,name text);`)
    for (const row of before.workflows) await db.exec(`INSERT INTO auto_workflows SELECT * FROM jsonb_populate_record(NULL::auto_workflows,${v.json(row)});`)
    const workflowHashes = (await db.query('SELECT id,md5(to_jsonb(w)::text) hash FROM auto_workflows w')).rows
    let sql = v.sql()
    for (const row of workflowHashes) sql = sql.replace(before.workflows.find(w => w.id === row.id).md5, row.hash)
    const original = (await db.query('SELECT to_jsonb(b) row FROM auto_blocks b ORDER BY id')).rows
    const workflows = (await db.query('SELECT * FROM auto_workflows ORDER BY id')).rows
    await db.exec(sql)
    assert.equal((await db.query(`SELECT xpath FROM auto_elements WHERE name=${v.quote(v.elementName)}`)).rows[0].xpath, v.xpath)
    const blocks = (await db.query('SELECT to_jsonb(b) row FROM auto_blocks b ORDER BY id')).rows
    for (const { row } of blocks) {
      const expected = desired.blocks.find(b => b.id === row.id)
      const { updated_at, ...rest } = row
      const { updated_at: oldTime, ...expectedRest } = expected
      assert.deepEqual(rest, expectedRest)
    }
    assert.deepEqual((await db.query('SELECT * FROM auto_workflows ORDER BY id')).rows, workflows); checks++
    await assert.rejects(db.exec(sql), /element already exists/); await db.exec('ROLLBACK'); checks++
    await db.exec("UPDATE auto_blocks SET code=code||'\n// newer patch' WHERE id=34")
    await assert.rejects(db.exec(v.rollbackSQL()), /block\/34 drift/); await db.exec('ROLLBACK'); checks++
    await db.exec(`UPDATE auto_blocks SET code=${v.quote(desired.blocks.find(b => b.id === 34).code)} WHERE id=34`)
    await db.exec(v.rollbackSQL())
    assert.deepEqual((await db.query('SELECT to_jsonb(b) row FROM auto_blocks b ORDER BY id')).rows, original)
    assert.equal((await db.query(`SELECT count(*) n FROM auto_elements WHERE name=${v.quote(v.elementName)}`)).rows[0].n, 1); checks++
    await db.exec(`DELETE FROM auto_elements WHERE name=${v.quote(v.elementName)}; UPDATE auto_blocks SET code=code||'\n// drift' WHERE id=2616`)
    await assert.rejects(db.exec(sql), /auto_blocks\/2616 drift/); await db.exec('ROLLBACK'); checks++
    await db.exec(`UPDATE auto_blocks SET code=${v.quote(before.tables.auto_blocks.find(x => x.row.id === 2616).row.code)} WHERE id=2616;
      UPDATE auto_workflows SET name=name||' changed' WHERE id=1`)
    await assert.rejects(db.exec(sql), /workflow\/1 drift/); await db.exec('ROLLBACK'); checks++
    await db.exec(`INSERT INTO supabase_migrations.schema_migrations VALUES('fixture',${v.quote(v.name)})`)
    await assert.rejects(db.exec(sql), /already applied/); await db.exec('ROLLBACK'); checks++
  } finally { await db.close() }
}

async function main() {
  assert.equal(fs.readFileSync(v.migrationPath, 'utf8'), v.sql())
  await blockTests(); await schedulerTests(); await sqlTests()
  console.log(`${checks} first-comment-link checks passed; no live DB writes or Facebook actions`)
}
if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
module.exports = { runBlock }
