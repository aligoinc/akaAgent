// Phase 4 — browser primitives tests with MockBrowserController
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  BlockRegistry,
  WorkflowEngine,
  registerCorePrimitives,
  registerBrowserPrimitives
} from '../dist/index.js'
import {
  InMemoryPersistence, NoopVault, MockBrowserController, MockChannelProvider
} from '../dist/testing/index.js'

const makeEngine = (loader, controller) => {
  const registry = new BlockRegistry()
  registerCorePrimitives(registry)
  registerBrowserPrimitives(registry)
  const persistence = new InMemoryPersistence()
  const provider = new MockChannelProvider(controller)
  const engine = new WorkflowEngine({
    registry,
    workflowLoader: loader,
    vault: new NoopVault(),
    persistence,
    channelProvider: provider
  })
  return { engine, persistence, controller }
}

describe('Phase 4 — browser primitives dispatch via IBrowserController', () => {
  it('navigate + click + type + getText pipeline', async () => {
    const ctrl = new MockBrowserController()
    ctrl.setResponse('navigate', { success: true, output: { currentUrl: 'https://example.com/loaded' } })
    ctrl.setResponse('click', { success: true, output: { success: true } })
    ctrl.setResponse('type', { success: true, output: { success: true } })
    ctrl.setResponse('getText', { success: true, output: { text: 'Hello World' } })

    const wf = {
      id: 'wf_browser', name: 'browser pipeline', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_nav', manifestId: 'core.navigate', position: { x: 0, y: 0 },
            config: { url: 'https://example.com' }, inputMapping: {} },
          { id: 'n_click', manifestId: 'core.click', position: { x: 0, y: 100 },
            config: { selector: { kind: 'inline', type: 'css', expression: 'button.submit' } },
            inputMapping: {} },
          { id: 'n_type', manifestId: 'core.type', position: { x: 0, y: 200 },
            config: {
              selector: { kind: 'inline', type: 'css', expression: 'input.search' },
              text: 'hello'
            }, inputMapping: {} },
          { id: 'n_get', manifestId: 'core.getText', position: { x: 0, y: 300 },
            config: { selector: { kind: 'inline', type: 'css', expression: 'h1' } },
            inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 400 }, config: {},
            inputMapping: {
              url: { sourceNodeId: 'n_nav', sourceField: 'currentUrl' },
              text: { sourceNodeId: 'n_get', sourceField: 'text' }
            } }
        ],
        edges: [
          { id: 'e1', source: 'n_nav', target: 'n_click' },
          { id: 'e2', source: 'n_click', target: 'n_type' },
          { id: 'e3', source: 'n_type', target: 'n_get' },
          { id: 'e4', source: 'n_get', target: 'n_out' }
        ]
      }
    }
    const { engine } = makeEngine(async () => wf, ctrl)
    const result = await engine.enqueue({ workflowId: wf.id, channelId: 'ch1', input: {} })
    assert.equal(result.status, 'completed', result.error)
    assert.equal(result.output?.url, 'https://example.com/loaded')
    assert.equal(result.output?.text, 'Hello World')

    // Verify dispatch order
    const types = ctrl.calls.map((c) => c.actionType)
    assert.deepEqual(types, ['navigate', 'click', 'type', 'getText'])
  })

  it('error from controller propagates to workflow with onError=fail', async () => {
    const ctrl = new MockBrowserController()
    ctrl.setResponse('click', { success: false, error: 'Element not found', output: {} })

    const wf = {
      id: 'wf_browser_err', name: 'click err', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_c', manifestId: 'core.click', position: { x: 0, y: 0 },
            config: { selector: { kind: 'inline', type: 'css', expression: '.nope' } }, inputMapping: {} }
        ],
        edges: []
      }
    }
    const { engine } = makeEngine(async () => wf, ctrl)
    const result = await engine.enqueue({ workflowId: wf.id, channelId: 'ch1', input: {} })
    assert.equal(result.status, 'failed')
    assert.match(String(result.error), /Element not found/)
  })

  it('workflow without browser block does NOT require channelId', async () => {
    const ctrl = new MockBrowserController()
    const wf = {
      id: 'wf_no_browser', name: 'no browser', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_set', manifestId: 'core.setVariable', position: { x: 0, y: 0 },
            config: { value: 42 }, inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { x: { sourceNodeId: 'n_set', sourceField: 'value' } } }
        ],
        edges: [{ id: 'e1', source: 'n_set', target: 'n_out' }]
      }
    }
    const { engine } = makeEngine(async () => wf, ctrl)
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed')
    assert.equal(result.output?.x, 42)
    assert.equal(ctrl.calls.length, 0, 'controller never called')
  })

  it('throws if workflow has browser block but no channelId', async () => {
    const ctrl = new MockBrowserController()
    const wf = {
      id: 'wf_need_ch', name: 'need ch', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_nav', manifestId: 'core.navigate', position: { x: 0, y: 0 },
            config: { url: 'https://example.com' }, inputMapping: {} }
        ],
        edges: []
      }
    }
    const { engine } = makeEngine(async () => wf, ctrl)
    await assert.rejects(
      async () => await engine.enqueue({ workflowId: wf.id, input: {} }),
      /requires browser channel/
    )
  })
})
