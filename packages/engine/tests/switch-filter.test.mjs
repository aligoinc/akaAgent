// Phase 3b-2 — switch + filter tests
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  BlockRegistry,
  WorkflowEngine,
  registerCorePrimitives
} from '../dist/index.js'
import { InMemoryPersistence, NoopVault } from '../dist/testing/index.js'

const makeEngine = (loader) => {
  const registry = new BlockRegistry()
  registerCorePrimitives(registry)
  const persistence = new InMemoryPersistence()
  const engine = new WorkflowEngine({
    registry,
    workflowLoader: loader,
    vault: new NoopVault(),
    persistence
  })
  return { engine, persistence }
}

describe('Phase 3b-2 — core.switch', () => {
  it('matches case "pending" → activates switch-pending handle', async () => {
    const wf = {
      id: 'wf_switch', name: 'switch', version: 1,
      inputSchema: [{ name: 'status', type: 'string', label: 'Status' }],
      outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_in', manifestId: 'core.input', position: { x: 0, y: 0 }, config: {}, inputMapping: {} },
          { id: 'n_sw', manifestId: 'core.switch', position: { x: 0, y: 100 },
            config: { expression: '{{n_in.status}}', cases: ['pending', 'running', 'done'] },
            inputMapping: {} },
          { id: 'n_pending', manifestId: 'core.log', position: { x: 0, y: 200 },
            config: { message: 'pending case', level: 'info' }, inputMapping: {} },
          { id: 'n_running', manifestId: 'core.log', position: { x: 200, y: 200 },
            config: { message: 'running case', level: 'info' }, inputMapping: {} },
          { id: 'n_done', manifestId: 'core.log', position: { x: 400, y: 200 },
            config: { message: 'done case', level: 'info' }, inputMapping: {} },
          { id: 'n_default', manifestId: 'core.log', position: { x: 600, y: 200 },
            config: { message: 'default', level: 'info' }, inputMapping: {} }
        ],
        edges: [
          { id: 'e0', source: 'n_in', target: 'n_sw' },
          { id: 'e1', source: 'n_sw', sourceHandle: 'switch-pending', target: 'n_pending' },
          { id: 'e2', source: 'n_sw', sourceHandle: 'switch-running', target: 'n_running' },
          { id: 'e3', source: 'n_sw', sourceHandle: 'switch-done', target: 'n_done' },
          { id: 'e4', source: 'n_sw', sourceHandle: 'switch-default', target: 'n_default' }
        ]
      }
    }
    const { engine, persistence } = makeEngine(async () => wf)
    const logs = []
    engine.on('progress', (e) => { if (e.kind === 'log') logs.push(e) })
    const result = await engine.enqueue({ workflowId: wf.id, input: { status: 'pending' } })
    assert.equal(result.status, 'completed', result.error)

    // Only 'pending case' log should fire
    assert.equal(logs.length, 1)
    assert.equal(logs[0].message, 'pending case')

    const swStep = persistence.stepsForRun(result.runId).find((s) => s.nodeId === 'n_sw')
    assert.equal(swStep.output?.branch, 'switch-pending')
    assert.equal(swStep.output?.matched, true)
  })

  it('falls back to switch-default when no case matches', async () => {
    const wf = {
      id: 'wf_switch_default', name: 'switchDefault', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_sw', manifestId: 'core.switch', position: { x: 0, y: 0 },
            config: { expression: 'unknown_state', cases: ['a', 'b', 'c'] }, inputMapping: {} },
          { id: 'n_a', manifestId: 'core.log', position: { x: 0, y: 100 },
            config: { message: 'A', level: 'info' }, inputMapping: {} },
          { id: 'n_def', manifestId: 'core.log', position: { x: 100, y: 100 },
            config: { message: 'fallback', level: 'info' }, inputMapping: {} }
        ],
        edges: [
          { id: 'e1', source: 'n_sw', sourceHandle: 'switch-a', target: 'n_a' },
          { id: 'e2', source: 'n_sw', sourceHandle: 'switch-default', target: 'n_def' }
        ]
      }
    }
    const { engine, persistence } = makeEngine(async () => wf)
    const logs = []
    engine.on('progress', (e) => { if (e.kind === 'log') logs.push(e) })
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed', result.error)
    assert.equal(logs.length, 1)
    assert.equal(logs[0].message, 'fallback')
    const swStep = persistence.stepsForRun(result.runId).find((s) => s.nodeId === 'n_sw')
    assert.equal(swStep.output?.branch, 'switch-default')
    assert.equal(swStep.output?.matched, false)
  })
})

describe('Phase 3b-2 — core.filter', () => {
  it('passed=true → downstream executes', async () => {
    const wf = {
      id: 'wf_filter_pass', name: 'filterPass', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_set', manifestId: 'core.setVariable', position: { x: 0, y: 0 },
            config: { value: 5 }, inputMapping: {} },
          { id: 'n_filt', manifestId: 'core.filter', position: { x: 0, y: 100 },
            config: { condition: '{{n_set.value}} > 3' }, inputMapping: {} },
          { id: 'n_log', manifestId: 'core.log', position: { x: 0, y: 200 },
            config: { message: 'kept', level: 'info' }, inputMapping: {} }
        ],
        edges: [
          { id: 'e1', source: 'n_set', target: 'n_filt' },
          { id: 'e2', source: 'n_filt', target: 'n_log' }
        ]
      }
    }
    const { engine, persistence } = makeEngine(async () => wf)
    const logs = []
    engine.on('progress', (e) => { if (e.kind === 'log') logs.push(e) })
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed', result.error)
    assert.equal(logs.length, 1)
    assert.equal(logs[0].message, 'kept')
    const filtStep = persistence.stepsForRun(result.runId).find((s) => s.nodeId === 'n_filt')
    assert.equal(filtStep.output?.passed, true)
  })

  it('passed=false → downstream skipped', async () => {
    const wf = {
      id: 'wf_filter_skip', name: 'filterSkip', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_set', manifestId: 'core.setVariable', position: { x: 0, y: 0 },
            config: { value: 1 }, inputMapping: {} },
          { id: 'n_filt', manifestId: 'core.filter', position: { x: 0, y: 100 },
            config: { condition: '{{n_set.value}} > 3' }, inputMapping: {} },
          { id: 'n_log', manifestId: 'core.log', position: { x: 0, y: 200 },
            config: { message: 'kept', level: 'info' }, inputMapping: {} }
        ],
        edges: [
          { id: 'e1', source: 'n_set', target: 'n_filt' },
          { id: 'e2', source: 'n_filt', target: 'n_log' }
        ]
      }
    }
    const { engine, persistence } = makeEngine(async () => wf)
    const logs = []
    engine.on('progress', (e) => { if (e.kind === 'log') logs.push(e) })
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed', result.error)
    assert.equal(logs.length, 0, 'log skipped because filter failed')
    const filtStep = persistence.stepsForRun(result.runId).find((s) => s.nodeId === 'n_filt')
    assert.equal(filtStep.output?.passed, false)
    // n_log step should NOT exist
    const logStep = persistence.stepsForRun(result.runId).find((s) => s.nodeId === 'n_log')
    assert.equal(logStep, undefined, 'n_log must be skipped, no step record')
  })

  it('filter inside loop body — skip per iteration', async () => {
    // Loop forEach [1,2,3,4]; filter pass when item % 2 === 0; log
    // Expected: only 'item 2' and 'item 4' logged
    const wf = {
      id: 'wf_filter_loop', name: 'filterLoop', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_loop', manifestId: 'core.loop', position: { x: 0, y: 0 },
            config: { loopType: 'forEach', items: [1, 2, 3, 4] }, inputMapping: {} },
          { id: 'n_filt', manifestId: 'core.filter', position: { x: 0, y: 100 },
            config: { condition: '{{item}} >= 3' }, inputMapping: {} },
          { id: 'n_log', manifestId: 'core.log', position: { x: 0, y: 200 },
            config: { message: 'item {{item}}', level: 'info' }, inputMapping: {} }
        ],
        edges: [
          { id: 'e1', source: 'n_loop', sourceHandle: 'loop-body', target: 'n_filt' },
          { id: 'e2', source: 'n_filt', target: 'n_log' }
        ]
      }
    }
    const { engine } = makeEngine(async () => wf)
    const logs = []
    engine.on('progress', (e) => { if (e.kind === 'log') logs.push(e) })
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed', result.error)
    const messages = logs.map((l) => l.message)
    assert.deepEqual(messages, ['item 3', 'item 4'])
  })
})
