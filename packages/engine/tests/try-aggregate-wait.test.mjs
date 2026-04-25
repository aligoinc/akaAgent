// Phase 3b-3 — try/catch + aggregate + wait tests
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

describe('Phase 3b-3 — core.try', () => {
  it('body success → activate "try" handle, skip "catch"', async () => {
    const wf = {
      id: 'wf_try_ok', name: 'tryOk', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_try', manifestId: 'core.try', position: { x: 0, y: 0 }, config: {}, inputMapping: {} },
          { id: 'n_body', manifestId: 'core.log', position: { x: 0, y: 100 },
            config: { message: 'body running', level: 'info' }, inputMapping: {} },
          { id: 'n_ok', manifestId: 'core.log', position: { x: 0, y: 200 },
            config: { message: 'success path', level: 'info' }, inputMapping: {} },
          { id: 'n_err', manifestId: 'core.log', position: { x: 200, y: 200 },
            config: { message: 'error path', level: 'error' }, inputMapping: {} }
        ],
        edges: [
          { id: 'e1', source: 'n_try', sourceHandle: 'try-body', target: 'n_body' },
          { id: 'e2', source: 'n_try', sourceHandle: 'try', target: 'n_ok' },
          { id: 'e3', source: 'n_try', sourceHandle: 'catch', target: 'n_err' }
        ]
      }
    }
    const { engine, persistence } = makeEngine(async () => wf)
    const logs = []
    engine.on('progress', (e) => { if (e.kind === 'log') logs.push(e) })
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed', result.error)

    const messages = logs.map((l) => l.message)
    assert.deepEqual(messages, ['body running', 'success path'])

    const tryStep = persistence.stepsForRun(result.runId).find((s) => s.nodeId === 'n_try')
    assert.equal(tryStep.output?.success, true)
    assert.equal(tryStep.output?.branch, 'try')
  })

  it('body throws → activate "catch" handle với error info', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('boom') }
    try {
      const wf = {
        id: 'wf_try_err', name: 'tryErr', version: 1,
        inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
        graph: {
          nodes: [
            { id: 'n_try', manifestId: 'core.try', position: { x: 0, y: 0 }, config: {}, inputMapping: {} },
            { id: 'n_body', manifestId: 'core.httpRequest', position: { x: 0, y: 100 },
              config: { url: 'https://nope.example', method: 'GET', timeout: 1000 }, inputMapping: {} },
            { id: 'n_ok', manifestId: 'core.log', position: { x: 0, y: 200 },
              config: { message: 'success', level: 'info' }, inputMapping: {} },
            { id: 'n_err', manifestId: 'core.log', position: { x: 200, y: 200 },
              config: { message: 'caught: {{n_try.error.message}}', level: 'error' }, inputMapping: {} }
          ],
          edges: [
            { id: 'e1', source: 'n_try', sourceHandle: 'try-body', target: 'n_body' },
            { id: 'e2', source: 'n_try', sourceHandle: 'try', target: 'n_ok' },
            { id: 'e3', source: 'n_try', sourceHandle: 'catch', target: 'n_err' }
          ]
        }
      }
      const { engine, persistence } = makeEngine(async () => wf)
      const logs = []
      engine.on('progress', (e) => { if (e.kind === 'log') logs.push(e) })
      const result = await engine.enqueue({ workflowId: wf.id, input: {} })
      assert.equal(result.status, 'completed', `try should swallow body error: ${result.error}`)

      // Logs: [0] httpRequest error log, [1] n_err catch log
      // Important: success path 'success' must NOT appear
      const messages = logs.map((l) => l.message)
      assert.ok(!messages.includes('success'), 'success path must be skipped')
      const caughtLog = messages.find((m) => m.startsWith('caught:'))
      assert.ok(caughtLog, `expected catch log, got: ${messages.join(' | ')}`)
      assert.match(caughtLog, /^caught:.*HTTP request failed/)

      const tryStep = persistence.stepsForRun(result.runId).find((s) => s.nodeId === 'n_try')
      assert.equal(tryStep.output?.success, false)
      assert.equal(tryStep.output?.branch, 'catch')
      assert.ok(tryStep.output?.error)
      assert.match(tryStep.output.error.message, /HTTP request failed/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('Phase 3b-3 — core.aggregate', () => {
  it('collects outputs from multiple incoming branches', async () => {
    const wf = {
      id: 'wf_agg', name: 'agg', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_a', manifestId: 'core.setVariable', position: { x: 0, y: 0 },
            config: { value: 'A' }, inputMapping: {} },
          { id: 'n_b', manifestId: 'core.setVariable', position: { x: 200, y: 0 },
            config: { value: 'B' }, inputMapping: {} },
          { id: 'n_c', manifestId: 'core.setVariable', position: { x: 400, y: 0 },
            config: { value: 'C' }, inputMapping: {} },
          { id: 'n_agg', manifestId: 'core.aggregate', position: { x: 200, y: 200 },
            config: {}, inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 200, y: 300 }, config: {},
            inputMapping: { items: { sourceNodeId: 'n_agg', sourceField: 'items' } } }
        ],
        edges: [
          { id: 'e1', source: 'n_a', target: 'n_agg' },
          { id: 'e2', source: 'n_b', target: 'n_agg' },
          { id: 'e3', source: 'n_c', target: 'n_agg' },
          { id: 'e4', source: 'n_agg', target: 'n_out' }
        ]
      }
    }
    const { engine, persistence } = makeEngine(async () => wf)
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed', result.error)

    const aggStep = persistence.stepsForRun(result.runId).find((s) => s.nodeId === 'n_agg')
    assert.equal(aggStep.output?.count, 3)
    assert.deepEqual(aggStep.output?.items, [{ value: 'A' }, { value: 'B' }, { value: 'C' }])

    assert.ok(Array.isArray(result.output?.items))
    assert.equal(result.output.items.length, 3)
  })
})

describe('Phase 3b-3 — core.wait', () => {
  it('delayMs mode sleeps approximately', async () => {
    const wf = {
      id: 'wf_wait_delay', name: 'waitDelay', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_w', manifestId: 'core.wait', position: { x: 0, y: 0 },
            config: { delayMs: 80 }, inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { waited: { sourceNodeId: 'n_w', sourceField: 'waitedMs' } } }
        ],
        edges: [{ id: 'e1', source: 'n_w', target: 'n_out' }]
      }
    }
    const { engine } = makeEngine(async () => wf)
    const t0 = Date.now()
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    const elapsed = Date.now() - t0
    assert.equal(result.status, 'completed')
    assert.ok(elapsed >= 70, `elapsed ${elapsed}ms should be >= 70`)
    assert.ok(typeof result.output?.waited === 'number')
  })

  it('until in past returns immediately', async () => {
    const wf = {
      id: 'wf_wait_past', name: 'waitPast', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_w', manifestId: 'core.wait', position: { x: 0, y: 0 },
            config: { until: '2020-01-01T00:00:00Z' }, inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { waited: { sourceNodeId: 'n_w', sourceField: 'waitedMs' } } }
        ],
        edges: [{ id: 'e1', source: 'n_w', target: 'n_out' }]
      }
    }
    const { engine } = makeEngine(async () => wf)
    const t0 = Date.now()
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    const elapsed = Date.now() - t0
    assert.equal(result.status, 'completed')
    assert.ok(elapsed < 200, `should return immediately, elapsed ${elapsed}ms`)
    assert.equal(result.output?.waited, 0)
  })

  it('forEvent mode returns not-implemented error', async () => {
    const wf = {
      id: 'wf_wait_event', name: 'waitEvent', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_w', manifestId: 'core.wait', position: { x: 0, y: 0 },
            config: { forEvent: 'foo' }, inputMapping: {}, onError: 'continue' },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { err: { sourceNodeId: 'n_w', sourceField: 'error' } } }
        ],
        edges: [{ id: 'e1', source: 'n_w', target: 'n_out' }]
      }
    }
    const { engine } = makeEngine(async () => wf)
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed')
    assert.match(String(result.output?.err), /forEvent mode not implemented/)
  })
})
