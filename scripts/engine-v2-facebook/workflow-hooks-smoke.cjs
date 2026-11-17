// Hook của bộ chạy workflow cho engine v2 Facebook (beforeNode / afterNode, khoá mốc trong vòng lặp, commitPoint, observeSleep,
// luôn đóng dòng auto_runs). Chạy đúng WorkflowEngineV2 + BlockExecutor + blockHelpers thật, repository DB là bản giả trong bộ nhớ.
// Chạy: node scripts/engine-v2-facebook/workflow-hooks-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const ROOT = path.resolve(__dirname, '../..')
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

const STUBS = {
  blockRepository: 'module.exports = { getBlock: async id => globalThis.__hooks.blocks.get(id) || null }',
  workflowV2Repository: 'module.exports = { getWorkflow: async () => null }',
  runV2Repository: `module.exports = {
    createRun: async run => { const t = globalThis.__hooks; t.runs.push({ ...run }); return t.runs.length },
    updateRun: async (id, patch) => { globalThis.__hooks.runUpdates.push({ id, ...patch }) },
    createRunStep: async (runId, step) => { const t = globalThis.__hooks; t.stepRows.push({ runId, ...step }); return t.stepRows.length },
    updateRunStep: async (id, patch) => { Object.assign(globalThis.__hooks.stepRows[id - 1], patch) } }`,
  elementV2Repository: 'module.exports = { resolveXpathByName: async () => null }'
}

async function loadEngine() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-hooks-'))
  const outfile = path.join(out, 'engine.cjs')
  await build({
    entryPoints: [path.join(ROOT, 'src/main/v2/runtime/workflowEngine.ts')], outfile, bundle: true, platform: 'node', format: 'cjs',
    logLevel: 'warning',
    plugins: [{ name: 'hooks-fixture', setup(plugin) {
      plugin.onResolve({ filter: /repositories\/(blockRepository|workflowV2Repository|runV2Repository|elementV2Repository)$/ }, args => ({
        path: args.path.split('/').pop(), namespace: 'stub' }))
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: STUBS[args.path], loader: 'js' }))
      plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub-electron' }))
      plugin.onLoad({ filter: /.*/, namespace: 'stub-electron' }, () => ({ contents: 'module.exports = {}', loader: 'js' }))
    } }]
  })
  return require(outfile)
}

function fresh() {
  globalThis.__hooks = { blocks: new Map(), runs: [], runUpdates: [], stepRows: [], ran: [] }
  return globalThis.__hooks
}
let nextBlock = 1
function js(t, id, code, blockName = id) {
  const blockId = nextBlock++
  t.blocks.set(blockId, { id: blockId, name: blockName, code })
  return { id, blockId, blockName }
}
// Block ghi lại lần chạy (vars.loopIndex có trong vòng lặp) vào globalThis.__hooks.ran — sandbox không thấy globalThis của Node,
// nên ghi qua output rồi đọc từ hook afterNode / steps.
const edge = (source, target, sourceHandle) => ({ id: `${source}-${target}-${sourceHandle || ''}`, source, target, sourceHandle })
const loop = (id, count) => ({ id, blockId: 0, blockName: 'loop', systemType: 'loop', config: { loopType: 'count', count } })
const ran = steps => steps.filter(s => s.status === 'success' && !['loop'].includes(s.blockName)).map(s => s.nodeId + (s.output.i !== undefined ? '#' + s.output.i : ''))

async function main() {
  const { WorkflowEngineV2, workflowStepKey } = await loadEngine()
  const engine = () => new WorkflowEngineV2()

  // 1. Không hook: chạy như cũ, không có cờ stopped.
  {
    const t = fresh()
    const nodes = [js(t, 'a', 'return { a: 1 }'), js(t, 'b', 'return { b: input.a + 1 }'), js(t, 'c', 'return { c: input.b + 1 }')]
    const r = await engine().run({ id: 1, nodes, edges: [edge('a', 'b'), edge('b', 'c')] }, {}, null, { persist: false })
    assert.equal(r.status, 'completed'); assert.equal(r.stopped, undefined); assert.equal(r.output.c, 3)
    assert.equal(workflowStepKey('x', []), 'x'); assert.equal(workflowStepKey('x', [1, 2]), 'x#1.2')
    pass('Không có hook: workflow chạy như cũ, không có cờ dừng')
  }

  // 2. beforeNode trả 'stop' ở b: b không chạy (code b không chạy), c không chạy, run cancelled + stopped, dòng bước b = skipped.
  {
    const t = fresh()
    const nodes = [js(t, 'a', 'return { a: 1 }'), js(t, 'b', 'throw new Error("b không được chạy")'), js(t, 'c', 'throw new Error("c không được chạy")')]
    const seen = []
    const r = await engine().run({ id: 2, nodes, edges: [edge('a', 'b'), edge('b', 'c')] }, {}, null, {
      beforeNode: async info => { seen.push(info.stepKey); return info.nodeId === 'b' ? 'stop' : 'run' }
    })
    assert.deepEqual(seen, ['a', 'b'])
    assert.equal(r.status, 'cancelled'); assert.equal(r.stopped, true); assert.equal(r.error, undefined)
    assert.deepEqual(ran(r.steps), ['a'])
    assert.equal(t.stepRows.find(s => s.nodeId === 'b').status, 'skipped')
    assert.equal(t.stepRows.some(s => s.nodeId === 'c'), false, 'c không có dòng bước')
    assert.equal(t.runUpdates.at(-1).status, 'cancelled')
    pass("beforeNode 'stop': dừng trước block (không chạy code), lượt workflow cancelled, dòng bước skipped")
  }

  // 3. Khoá mốc trong vòng lặp: x#0, x#1, x#2; dừng ở x#1 → x#0 chạy, x#1 không, nút sau vòng lặp không chạy.
  {
    const t = fresh()
    const nodes = [loop('l', 3), js(t, 'x', 'return { i: vars.loopIndex }'), js(t, 'after', 'throw new Error("after không được chạy")')]
    const keys = []
    const r = await engine().run({ id: 3, nodes, edges: [edge('l', 'x', 'body'), edge('l', 'after', 'done')] }, {}, null, {
      persist: false, beforeNode: async info => { keys.push(info.stepKey); return info.stepKey === 'x#1' ? 'stop' : 'run' }
    })
    assert.deepEqual(keys, ['x#0', 'x#1'])
    assert.equal(r.status, 'cancelled'); assert.equal(r.stopped, true)
    assert.deepEqual(ran(r.steps), ['x#0'])
    assert.equal(r.steps.find(s => s.nodeId === 'l').output.stopped, true)
    pass('Vòng lặp: khoá mốc theo lượt (x#0, x#1), dừng giữa vòng lặp không chạy nút sau vòng lặp')
  }

  // 4. Vòng lặp lồng nhau: khoá y#i.j, không dừng thì chạy đủ 2×3.
  {
    const t = fresh()
    const nodes = [loop('outer', 2), loop('inner', 3), js(t, 'y', 'return { i: vars.loopIndex }')]
    const keys = []
    const r = await engine().run({ id: 4, nodes, edges: [edge('outer', 'inner', 'body'), edge('inner', 'y', 'body')] }, {}, null, {
      persist: false, beforeNode: async info => { keys.push(info.stepKey); return 'run' }
    })
    assert.equal(r.status, 'completed'); assert.equal(r.stopped, undefined)
    assert.deepEqual(keys, ['y#0.0', 'y#0.1', 'y#0.2', 'y#1.0', 'y#1.1', 'y#1.2'])
    pass('Vòng lặp lồng nhau: khoá mốc y#i.j, chạy đủ khi không dừng')
  }

  // 5. beforeNode ném lỗi: block không chạy, workflow dừng, run cancelled kèm câu lỗi; run() không ném.
  {
    const t = fresh()
    const nodes = [js(t, 'a', 'throw new Error("a không được chạy")'), js(t, 'b', 'throw new Error("b không được chạy")')]
    const r = await engine().run({ id: 5, nodes, edges: [edge('a', 'b')] }, {}, null, {
      persist: false, beforeNode: async () => { throw new Error('mất lease') }
    })
    assert.equal(r.status, 'cancelled'); assert.equal(r.stopped, true)
    assert.match(r.error, /Lỗi engine trước block a: mất lease/)
    assert.equal(r.steps.find(s => s.nodeId === 'a').status, 'error')
    assert.equal(r.steps.find(s => s.nodeId === 'b').status, 'pending')
    pass('beforeNode lỗi: block không chạy, workflow dừng có câu lỗi, run() không ném')
  }

  // 6. afterNode nhận kết quả; afterNode lỗi thì dừng sau block đó.
  {
    const t = fresh()
    const nodes = [js(t, 'a', 'return { ok: true }'), js(t, 'b', 'throw new Error("b không được chạy")')]
    const results = []
    const r = await engine().run({ id: 6, nodes, edges: [edge('a', 'b')] }, {}, null, {
      persist: false,
      afterNode: async info => { results.push([info.stepKey, info.result.success, info.result.output.ok]); throw new Error('ghi kết quả lỗi') }
    })
    assert.deepEqual(results, [['a', true, true]])
    assert.equal(r.status, 'cancelled'); assert.equal(r.stopped, true); assert.match(r.error, /Lỗi engine sau block a: ghi kết quả lỗi/)
    assert.deepEqual(ran(r.steps), ['a'])
    pass('afterNode: nhận kết quả block; lỗi thì dừng sau block đó')
  }

  // 7. commitPoint: nhận đúng khoá mốc; ném lỗi thì phần "bấm" phía sau không chạy và block lỗi.
  {
    const t = fresh()
    const calls = []
    const nodes = [loop('l', 2), js(t, 'send', `
      await helpers.commitPoint({ actionCode: 'fb_comment' })
      return { i: vars.loopIndex, clicked: true }`)]
    const r = await engine().run({ id: 7, nodes, edges: [edge('l', 'send', 'body')] }, {}, null, {
      persist: false,
      runtimeHelpers: { commitPoint: async (options, meta) => {
        calls.push([options.actionCode, meta.stepKey])
        if (meta.stepKey === 'send#1') throw new Error('Lease đã mất, không gửi')
      } }
    })
    assert.deepEqual(calls, [['fb_comment', 'send#0'], ['fb_comment', 'send#1']])
    const sends = r.steps.filter(s => s.nodeId === 'send')
    assert.equal(sends[0].status, 'success'); assert.equal(sends[0].output.clicked, true)
    assert.equal(sends[1].status, 'error'); assert.match(sends[1].error, /Lease đã mất/)
    assert.equal(sends[1].output.clicked, undefined)
    assert.equal(r.status, 'failed')
    pass('commitPoint: khoá mốc theo lượt vòng lặp; lỗi thì block dừng trước cú bấm')
  }

  // 8. observeSleep: báo bắt đầu / kết thúc nghỉ kèm khoá mốc; lỗi trong observeSleep không làm hỏng block.
  {
    const t = fresh()
    const events = []
    const nodes = [js(t, 'rest', 'await helpers.sleep(30); return { slept: true }')]
    const r = await engine().run({ id: 8, nodes, edges: [] }, {}, null, {
      persist: false,
      runtimeHelpers: { observeSleep: (phase, ms, meta) => { events.push([phase, ms, meta.stepKey]); throw new Error('chỉ quan sát') } }
    })
    assert.equal(r.status, 'completed'); assert.equal(r.output.slept, true)
    assert.deepEqual(events, [['start', 30, 'rest'], ['end', 30, 'rest']])
    pass('observeSleep: báo nghỉ bắt đầu / kết thúc, lỗi của bộ quan sát không ảnh hưởng block')
  }

  // 9. Lỗi ném ra giữa vòng (callback của nơi chạy): dòng auto_runs vẫn được đóng 'failed', rồi run() ném lại.
  {
    const t = fresh()
    const nodes = [js(t, 'a', 'return { a: 1 }'), js(t, 'b', 'return { b: 1 }')]
    let thrown = null
    try {
      await engine().run({ id: 9, nodes, edges: [edge('a', 'b')] }, {}, null, {
        onStepProgress: step => { if (step.nodeId === 'b' && step.status === 'running') throw new Error('nơi chạy hỏng') }
      })
    } catch (err) { thrown = err }
    assert.match(String(thrown && thrown.message), /nơi chạy hỏng/)
    assert.equal(t.runUpdates.length, 1); assert.equal(t.runUpdates[0].status, 'failed'); assert.match(t.runUpdates[0].error, /nơi chạy hỏng/)
    pass('Lỗi giữa vòng: dòng auto_runs vẫn được đóng failed rồi mới ném lại')
  }

  // 10. Hai nhánh song song: một nhánh dừng thì nhánh đang chạy trong cùng cụm chạy xong, không bắt đầu node mới.
  {
    const t = fresh()
    const nodes = [js(t, 'root', 'return {}'), js(t, 'p', 'await helpers.sleep(20); return { p: true }'),
      js(t, 'q', 'throw new Error("q không được chạy")'), js(t, 'next', 'throw new Error("next không được chạy")')]
    const r = await engine().run({ id: 10, nodes, edges: [edge('root', 'p'), edge('root', 'q'), edge('p', 'next')] }, {}, null, {
      persist: false, beforeNode: async info => info.nodeId === 'q' ? 'stop' : 'run'
    })
    assert.equal(r.status, 'cancelled'); assert.equal(r.stopped, true)
    assert.deepEqual(ran(r.steps).sort(), ['p', 'root'])
    pass('Nhánh song song: dừng một nhánh, nhánh đang chạy chạy xong, không bắt đầu node mới')
  }

  console.log(`\n${checks} nhóm kiểm tra đạt`)
}

main().catch(err => { console.error(err); process.exit(1) })
