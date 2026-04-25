// Phase 5 — NodeRuntime + PageRuntime sandbox tests
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  BlockRegistry,
  WorkflowEngine,
  registerCorePrimitives,
  NodeRuntime,
  PageRuntime
} from '../dist/index.js'
import {
  InMemoryPersistence, NoopVault, MockBrowserController, MockChannelProvider
} from '../dist/testing/index.js'

describe('Phase 5 — NodeRuntime (node:vm sandbox)', () => {
  it('executes user code with input + returns result', async () => {
    const rt = new NodeRuntime()
    const code = `
      async function main(input, ctx) {
        return { sum: input.a + input.b, secret: ctx.secrets ? Object.keys(ctx.secrets).length : 0 }
      }
    `
    const r = await rt.execute(code, { a: 3, b: 4 }, { token: 'xxx' })
    assert.equal(r.success, true)
    assert.deepEqual(r.output, { sum: 7, secret: 1 })
  })

  it('throws on syntax error', async () => {
    const rt = new NodeRuntime()
    const r = await rt.execute('not valid javascript ===', {}, {})
    assert.equal(r.success, false)
    assert.ok(r.error)
  })

  it('respects timeout', async () => {
    const rt = new NodeRuntime()
    const code = `
      async function main() {
        const start = Date.now()
        while (Date.now() - start < 1000) {}   // 1s busy loop
        return { done: true }
      }
    `
    const r = await rt.execute(code, {}, {}, { permissions: { timeoutMs: 100 } })
    assert.equal(r.success, false)
    assert.match(String(r.error), /Script execution timed out|aborted/i)
  })

  it('allows whitelisted modules (uuid)', async () => {
    const rt = new NodeRuntime()
    const code = `
      async function main(input, ctx) {
        const { v4 } = require('uuid')
        return { id: v4() }
      }
    `
    const r = await rt.execute(code, {}, {})
    assert.equal(r.success, true, r.error)
    assert.match(String(r.output?.id), /^[0-9a-f-]{36}$/)
  })

  it('blocks non-whitelisted modules', async () => {
    const rt = new NodeRuntime()
    const code = `
      async function main() {
        const fs = require('fs')
        return { ok: true }
      }
    `
    const r = await rt.execute(code, {}, {})
    assert.equal(r.success, false)
    assert.match(String(r.error), /not in allowlist/)
  })
})

describe('Phase 5 — PageRuntime (via IBrowserController.evalScript)', () => {
  it('dispatches evalScript with wrapped code', async () => {
    const ctrl = new MockBrowserController()
    ctrl.setResponse('evalScript', { success: true, output: { result: { value: 42 } } })
    const rt = new PageRuntime(ctrl)
    const r = await rt.execute('async function main(i) { return { value: 42 } }', {})
    assert.equal(r.success, true)
    assert.deepEqual(r.output, { value: 42 })

    // Verify call was made with code+args
    assert.equal(ctrl.calls.length, 1)
    assert.equal(ctrl.calls[0].actionType, 'evalScript')
    assert.ok(typeof ctrl.calls[0].input.code === 'string')
    assert.ok(ctrl.calls[0].input.code.includes('async () =>'))
  })
})

describe('Phase 5 — code block via WorkflowEngine', () => {
  it('node-runtime code block in workflow', async () => {
    const registry = new BlockRegistry()
    registerCorePrimitives(registry)
    // Register a custom code block
    registry.register({
      manifestId: 'user.compute',
      name: 'Compute',
      version: '1.0.0',
      kind: 'code',
      runtime: 'node',
      requires: 'none',
      ui: { icon: 'Code', category: 'custom', description: 'compute sum' },
      inputSchema: [{ name: 'a', type: 'number', label: 'A' }, { name: 'b', type: 'number', label: 'B' }],
      outputSchema: [{ name: 'sum', type: 'number', label: 'Sum' }],
      code: `async function main(input, ctx) { return { sum: input.a + input.b } }`
    })

    const wf = {
      id: 'wf_code_node', name: 'codeNode', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_c', manifestId: 'user.compute', position: { x: 0, y: 0 },
            config: { a: 5, b: 7 }, inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { sum: { sourceNodeId: 'n_c', sourceField: 'sum' } } }
        ],
        edges: [{ id: 'e1', source: 'n_c', target: 'n_out' }]
      }
    }
    const persistence = new InMemoryPersistence()
    const engine = new WorkflowEngine({
      registry,
      workflowLoader: async () => wf,
      vault: new NoopVault(),
      persistence
    })
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed', result.error)
    assert.equal(result.output?.sum, 12)
  })

  it('page-runtime code block dispatches via channel', async () => {
    const ctrl = new MockBrowserController()
    ctrl.setResponse('evalScript', { success: true, output: { result: { title: 'Mocked Page Title' } } })
    const provider = new MockChannelProvider(ctrl)

    const registry = new BlockRegistry()
    registerCorePrimitives(registry)
    registry.register({
      manifestId: 'user.scrapeTitle',
      name: 'Scrape Title',
      version: '1.0.0',
      kind: 'code',
      runtime: 'page',
      requires: 'browser',
      ui: { icon: 'Code', category: 'custom', description: 'read document.title' },
      inputSchema: [],
      outputSchema: [{ name: 'title', type: 'string', label: 'Title' }],
      code: `async function main() { return { title: document.title } }`
    })

    const wf = {
      id: 'wf_code_page', name: 'codePage', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_p', manifestId: 'user.scrapeTitle', position: { x: 0, y: 0 }, config: {}, inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { title: { sourceNodeId: 'n_p', sourceField: 'title' } } }
        ],
        edges: [{ id: 'e1', source: 'n_p', target: 'n_out' }]
      }
    }
    const persistence = new InMemoryPersistence()
    const engine = new WorkflowEngine({
      registry,
      workflowLoader: async () => wf,
      vault: new NoopVault(),
      persistence,
      channelProvider: provider
    })
    const result = await engine.enqueue({ workflowId: wf.id, channelId: 'ch1', input: {} })
    assert.equal(result.status, 'completed', result.error)
    assert.equal(result.output?.title, 'Mocked Page Title')
  })
})
