// Real DAG engine, block executor, scheduler and managed SQL writer. Offline only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { harness, result } = require('./action-status-mixed-output-smoke.cjs')
const root = path.resolve(__dirname, '..')
function compile(file, stubs = {}) {
  const module = { exports: {} }
  new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText)(name => name in stubs ? stubs[name] : require(name), module, module.exports)
  return module.exports
}
const { BlockExecutor } = compile('src/main/v2/runtime/blockExecutor.ts', {
  './blockHelpers': { createBlockHelpers: (log, runtime) => ({ log, ...runtime }) }
})
const blocks = new Map()
const { WorkflowEngineV2 } = compile('src/main/v2/runtime/workflowEngine.ts', {
  './blockExecutor': { BlockExecutor },
  '../../data/repositories/blockRepository': { getBlock: async id => blocks.get(id) },
  '../../data/repositories/workflowV2Repository': {}, '../../data/repositories/runV2Repository': {}
})
const output = (action = 'fb_like_post', inputDataId = 1) => ({ ...result(action), inputDataId })
let scenarios = 0
function js(id, code, blockName = id) {
  const blockId = blocks.size + 1
  blocks.set(blockId, { id: blockId, name: blockName, code })
  return { id, blockId, blockName }
}
const edge = (source, target, sourceHandle) => ({ id: `${source}-${target}`, source, target, sourceHandle })
async function run(f, nodes, edges, realtime = true, runtimeHelpers) {
  let progress = Promise.resolve()
  const abort = new AbortController()
  const boundary = new f.runtime.ActionResultBoundary(1, () => abort.abort())
  const executed = await new WorkflowEngineV2().run({ id: 7, nodes, edges }, {}, null, {
    persist: false, runtimeHelpers, signal: abort.signal,
    onStepProgress: step => {
      const accepted = boundary.observe(step)
      if (accepted && realtime) progress = progress.then(() => f.realtime(step))
    }
  })
  await progress
  if (boundary.error) {
    await f.final(boundary.accepted(executed.steps))
    throw boundary.error
  }
  assert.equal(executed.status, 'completed')
  // Simulate the UI/IPC roundtrip too, not only shared in-memory references.
  const cloned = JSON.parse(JSON.stringify(executed.steps))
  await f.final(cloned)
  await f.finish()
  await f.final(cloned)
  return executed
}
async function origins(zca) {
  for (const envelope of ['single', 'batch', 'direct']) for (const relay of ['merge', 'parallel', 'spread', 'json', 'extra-context']) {
    const f = await harness(zca)
    try {
      const row = output()
      const raw = envelope === 'single' ? { liked: true, actionResult: row }
        : envelope === 'batch' ? { liked: true, actionResults: [row] } : { liked: true, ...row }
      const producer = js('producer', `return ${JSON.stringify(raw)}`, 'fb_newsfeed_like_post')
      const pass = ['merge', 'parallel'].includes(relay) ? { id: 'pass', blockId: 0, blockName: relay, systemType: relay }
        : js('pass', relay === 'json' ? 'return JSON.parse(JSON.stringify(input))'
          : relay === 'extra-context' ? 'return {...input, extraContext: "no operation"}' : 'return {...input}')
      await run(f, [producer, pass], [edge('producer', 'pass')])
      assert.equal((await f.details()).length, 1, `${envelope}/${relay}: one result`)
      assert.equal(await f.quota(), 1)
      assert.equal(f.writes.length, 1, 'relay/finalization must not call writer again')
      assert.equal(f.logs.length, 1, 'legacy progress text is emitted once')
      scenarios++
    } finally { await f.close() }
  }
  for (const kind of ['sequential', 'parallel', 'loop', 'batch-append', 'batch-reorder', 'batch-append-mutating']) {
    const f = await harness(zca)
    try {
      const code = `return {actionResult:${JSON.stringify(output())}}`
      const first = js('first', code), second = js('second', code)
      let nodes = [first, second], edges = kind === 'sequential' ? [edge('first', 'second')] : [], expected = 2
      if (kind === 'loop') {
        nodes = [{ id: 'loop', blockId: 0, blockName: 'loop', systemType: 'loop', config: { loopType: 'count', count: 3 } },
          first, { id: 'pass', blockId: 0, blockName: 'merge', systemType: 'merge' }]
        edges = [edge('loop', 'first', 'body'), edge('first', 'pass')]; expected = 3
      } else if (kind.startsWith('batch')) {
        nodes = [js('batch', `return {actionResults:${JSON.stringify([output(), output('fb_comment', 2)])}}`),
          js('pass', kind === 'batch-append-mutating' ? `input.actionResults.push(${JSON.stringify(output('fb_comment'))}); return input`
            : kind === 'batch-append' ? `return {actionResults:[...input.actionResults,${JSON.stringify(output('fb_comment'))}]}`
            : 'return {actionResults:[...input.actionResults].reverse()}')]
        edges = [edge('batch', 'pass')]; expected = kind.startsWith('batch-append') ? 3 : 2
      }
      await run(f, nodes, edges)
      assert.equal((await f.details()).length, expected, `${kind}: fresh operations must remain distinct`)
      assert.equal(await f.quota(), expected)
      assert.equal(f.writes.length, expected)
      scenarios++
    } finally { await f.close() }
  }
  const changed = await harness(zca)
  try {
    await assert.rejects(run(changed, [js('first', `return {actionResult:${JSON.stringify(output())}}`),
      js('pass', 'return {actionResult:{...input.actionResult,statusCode:"campaign_detail_failed"}}')], [edge('first', 'pass')]), /result_key_conflict/)
    assert.equal((await changed.details()).length, 1)
    assert.equal(await changed.quota(), 1)
    scenarios++
  } finally { await changed.close() }
}
async function emails(zca) {
  for (const format of ['legacy', 'dual', 'new-only', 'direct', 'batch']) for (const observedBefore of [false, true]) {
    const f = await harness(zca, 'email_send', 'email')
    try {
      const tracking = (await f.db.query("INSERT INTO auto_email_message_trackings(campaign_id,account_id,input_data_id,recipient_email) VALUES(1,1,1,'fixture') RETURNING *")).rows[0]
      if (observedBefore) await f.db.query('SELECT * FROM aka_agent_mark_email_open($1)', [tracking.open_token])
      let sends = 0, links = 0
      const link = f.load(path.join(root, 'src/main/data/repositories/emailTrackingRepository.ts')).linkEmailMessageTrackingToDetail
      f.scheduler.supabase.linkEmailMessageTrackingToDetail = async (...args) => { links++; return link(...args) }
      f.scheduler.emailRuntime = { checkRecipientExists: async () => ({ status: 'unknown' }),
        sendEmail: async () => { sends++; return { messageId: 'local-fixture', trackingMessageId: tracking.id } } }
      Object.assign(f.scheduler, { getTemplateBusinessNow: async () => new Date(), renderZaloTemplate: x => x,
        rewriteEmailPlainTextBodyForRun: async (_a, _c, _o, x) => x })
      const contract = 'const row = {actionCode:"email_send",statusCode:"campaign_detail_success",operationState:"committed",inputDataId:1,message:sent.detail.log,data:sent.detail.data};'
      const returned = format === 'legacy' ? 'sent' : format === 'dual' ? '{...sent,actionResult:row}'
        : format === 'direct' ? '{...row,emailTrackingMessageId:sent.emailTrackingMessageId}'
        : format === 'batch' ? '{actionResults:[{...row,emailTrackingMessageId:sent.emailTrackingMessageId}]}'
        : '{actionResult:row,emailTrackingMessageId:sent.emailTrackingMessageId}'
      const producer = js('send', `const sent=await helpers.emailSendMessage(); ${contract} return ${returned}`, 'email_send_message')
      const nodes = format === 'legacy' ? [producer] : [producer, js('pass', 'return JSON.parse(JSON.stringify(input))')]
      const executed = await new WorkflowEngineV2().run({ id: 8, nodes, edges: format === 'legacy' ? [] : [edge('send', 'pass')] }, {}, null, {
        persist: false, runtimeHelpers: { emailSendMessage: () => f.scheduler.emailSendMessage(f.account, f.campaign,
          { to: 'recipient@fixture.invalid', subject: 'subject', body: 'body', inputData: { id: 1 } }) }
      })
      assert.equal(executed.status, 'completed')
      await f.final(executed.steps)
      await f.finish()
      if (format !== 'legacy') await f.final(JSON.parse(JSON.stringify(executed.steps)))
      if (!observedBefore) await f.db.query('SELECT * FROM aka_agent_mark_email_open($1)', [tracking.open_token])
      const rows = await f.details()
      const linked = (await f.db.query('SELECT campaign_detail_id,open_count FROM auto_email_message_trackings WHERE id=$1', [tracking.id])).rows[0]
      assert.equal(rows.length, 1)
      assert.equal(sends, 1); assert.equal(links, 1); assert.equal(await f.quota(), 1)
      assert.equal(linked.campaign_detail_id, rows[0].id)
      assert.equal(linked.open_count, 1)
      assert.equal(rows[0].status, 'thành công')
      const viewed = (await f.db.query("SELECT id FROM auto_status WHERE code='campaign_detail_viewed'")).rows[0].id
      assert.equal(rows[0].sub_status_id, viewed)
      assert.equal(rows[0].log, 'Đã gửi email đến recipient@fixture.invalid')
      scenarios++
    } finally { await f.close() }
  }
  const batch = await harness(zca, 'email_send', 'email')
  try {
    const ids = []
    for (const input of [1, 2]) ids.push((await batch.db.query("INSERT INTO auto_email_message_trackings(campaign_id,account_id,input_data_id,recipient_email) VALUES(1,1,$1,'fixture') RETURNING id", [input])).rows[0].id)
    let links = 0
    const link = batch.load(path.join(root, 'src/main/data/repositories/emailTrackingRepository.ts')).linkEmailMessageTrackingToDetail
    batch.scheduler.supabase.linkEmailMessageTrackingToDetail = async (...args) => { links++; return link(...args) }
    const rows = ids.map((id, i) => ({ ...output('email_send', i + 1), emailTrackingMessageId: id }))
    await run(batch, [js('batch', `return {actionResults:${JSON.stringify(rows)}}`), js('pass', 'return {actionResults:[...input.actionResults].reverse()}')], [edge('batch', 'pass')], false)
    const details = await batch.details()
    const trackings = (await batch.db.query('SELECT input_data_id,campaign_detail_id FROM auto_email_message_trackings ORDER BY id')).rows
    assert.deepEqual(trackings.map(t => t.campaign_detail_id), details.map(d => d.id))
    assert.equal(links, 2); assert.equal(await batch.quota(), 2)
    scenarios++
  } finally { await batch.close() }
}
async function main() {
  const zca = await import('zca-js')
  await origins(zca)
  await emails(zca)
  console.log(JSON.stringify({ scenarios, external_operations: 0 }))
}
module.exports = { WorkflowEngineV2, js, edge, output, run }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
