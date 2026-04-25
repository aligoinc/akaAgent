// Phase 2 acceptance test — workflow 3-node: core.setVariable → core.if → core.log
// Run: npm run test -w @akabiz/engine
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  BlockRegistry,
  WorkflowEngine,
  registerCorePrimitives
} from '../dist/index.js'
import { InMemoryPersistence, NoopVault } from '../dist/testing/index.js'

describe('Phase 2 acceptance — workflow 3-node setVariable + if + log', () => {
  it('runs to completion, all 3 steps success, log emitted', async () => {
    const registry = new BlockRegistry()
    registerCorePrimitives(registry)

    const persistence = new InMemoryPersistence()
    const vault = new NoopVault()

    /** @type {import('../dist/index.js').Workflow} */
    const workflow = {
      id: 'wf_smoke',
      name: 'Smoke 3-node',
      version: 1,
      inputSchema: [],
      outputSchema: [],
      variables: [],
      triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          {
            id: 'n_set',
            manifestId: 'core.setVariable',
            position: { x: 0, y: 0 },
            config: { value: 'hello' },
            inputMapping: {}
          },
          {
            id: 'n_if',
            manifestId: 'core.if',
            position: { x: 0, y: 100 },
            config: { condition: "{{n_set.value}} === 'hello'" },
            inputMapping: {}
          },
          {
            id: 'n_log',
            manifestId: 'core.log',
            position: { x: 0, y: 200 },
            config: { message: 'Got: {{n_set.value}}', level: 'info' },
            inputMapping: {}
          }
        ],
        edges: [
          { id: 'e1', source: 'n_set', target: 'n_if' },
          { id: 'e2', source: 'n_if', sourceHandle: 'if-true', target: 'n_log' }
        ]
      }
    }

    const engine = new WorkflowEngine({
      registry,
      workflowLoader: async (id) => {
        if (id === workflow.id) return workflow
        throw new Error(`Unknown workflow: ${id}`)
      },
      vault,
      persistence
    })

    const logs = []
    engine.on('progress', (event) => {
      if (event.kind === 'log') logs.push(event)
    })

    const result = await engine.enqueue({
      workflowId: workflow.id,
      input: {}
    })

    assert.equal(result.status, 'completed', 'workflow must complete')
    const steps = persistence.stepsForRun(result.runId)
    assert.equal(steps.length, 3, '3 steps recorded')
    assert.ok(steps.every((s) => s.status === 'success'), 'all steps success')

    const setStep = steps.find((s) => s.nodeId === 'n_set')
    assert.deepEqual(setStep?.output, { value: 'hello' })

    const ifStep = steps.find((s) => s.nodeId === 'n_if')
    assert.equal(ifStep?.output?.result, true)
    assert.equal(ifStep?.output?.branch, 'if-true')

    const logStep = steps.find((s) => s.nodeId === 'n_log')
    assert.equal(logStep?.output?.message, 'Got: hello')

    assert.equal(logs.length, 1, '1 log event emitted')
    assert.equal(logs[0].message, 'Got: hello')
    assert.equal(logs[0].level, 'info')
  })

  it('skips false branch of if', async () => {
    const registry = new BlockRegistry()
    registerCorePrimitives(registry)
    const persistence = new InMemoryPersistence()

    const workflow = {
      id: 'wf_branch',
      name: 'Branch test',
      version: 1,
      inputSchema: [],
      outputSchema: [],
      variables: [],
      triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_set', manifestId: 'core.setVariable', position: { x: 0, y: 0 },
            config: { value: 5 }, inputMapping: {} },
          { id: 'n_if',  manifestId: 'core.if', position: { x: 0, y: 100 },
            config: { condition: "{{n_set.value}} > 10" }, inputMapping: {} },
          { id: 'n_log_true', manifestId: 'core.log', position: { x: 0, y: 200 },
            config: { message: 'big', level: 'info' }, inputMapping: {} },
          { id: 'n_log_false', manifestId: 'core.log', position: { x: 200, y: 200 },
            config: { message: 'small', level: 'info' }, inputMapping: {} }
        ],
        edges: [
          { id: 'e1', source: 'n_set', target: 'n_if' },
          { id: 'e2', source: 'n_if', sourceHandle: 'if-true', target: 'n_log_true' },
          { id: 'e3', source: 'n_if', sourceHandle: 'if-false', target: 'n_log_false' }
        ]
      }
    }

    const engine = new WorkflowEngine({
      registry,
      workflowLoader: async () => workflow,
      vault: new NoopVault(),
      persistence
    })

    const result = await engine.enqueue({ workflowId: workflow.id, input: {} })
    assert.equal(result.status, 'completed')

    const steps = persistence.stepsForRun(result.runId)
    const trueStep = steps.find((s) => s.nodeId === 'n_log_true')
    const falseStep = steps.find((s) => s.nodeId === 'n_log_false')

    assert.equal(trueStep, undefined, 'true branch must be skipped')
    assert.ok(falseStep, 'false branch must execute')
    assert.equal(falseStep.status, 'success')
    assert.equal(falseStep.output?.message, 'small')
  })

  it('passthrough workflow input to output', async () => {
    const registry = new BlockRegistry()
    registerCorePrimitives(registry)
    const persistence = new InMemoryPersistence()

    const workflow = {
      id: 'wf_passthrough',
      name: 'Passthrough',
      version: 1,
      inputSchema: [{ name: 'x', type: 'number', label: 'X', required: true }],
      outputSchema: [{ name: 'doubled', type: 'number', label: 'Doubled' }],
      variables: [],
      triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_in', manifestId: 'core.input', position: { x: 0, y: 0 }, config: {}, inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 },
            config: {},
            inputMapping: {
              echoed: { sourceNodeId: 'n_in', sourceField: 'x' }
            } }
        ],
        edges: [{ id: 'e1', source: 'n_in', target: 'n_out' }]
      }
    }

    const engine = new WorkflowEngine({
      registry,
      workflowLoader: async () => workflow,
      vault: new NoopVault(),
      persistence
    })

    const result = await engine.enqueue({ workflowId: workflow.id, input: { x: 42 } })
    assert.equal(result.status, 'completed')
    assert.equal(result.output?.echoed, 42)
  })

  it('preserves reserved fields (compensate, track, joinPolicy) on workflow load', async () => {
    const registry = new BlockRegistry()
    registerCorePrimitives(registry)
    const persistence = new InMemoryPersistence()

    const workflow = {
      id: 'wf_reserved',
      name: 'Reserved fields',
      version: 1,
      inputSchema: [],
      outputSchema: [],
      variables: [],
      triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          {
            id: 'n_set',
            manifestId: 'core.setVariable',
            position: { x: 0, y: 0 },
            config: { value: 1 },
            inputMapping: {},
            compensate: 'n_undo',         // reserved — engine ignore but must not strip
            track: 'main',
            joinPolicy: 'all',
            joinCount: 1
          }
        ],
        edges: []
      }
    }

    const engine = new WorkflowEngine({
      registry,
      workflowLoader: async () => workflow,
      vault: new NoopVault(),
      persistence
    })

    const result = await engine.enqueue({ workflowId: workflow.id, input: {} })
    assert.equal(result.status, 'completed', 'reserved fields must not break execution')
  })
})
