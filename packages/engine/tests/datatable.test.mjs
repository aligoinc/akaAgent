// Phase 3c — datatable readRow + updateRow tests
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  BlockRegistry,
  WorkflowEngine,
  registerCorePrimitives,
  registerDataTablePrimitives
} from '../dist/index.js'
import { InMemoryPersistence, NoopVault, InMemoryDataTableProvider } from '../dist/testing/index.js'

const makeEngine = (loader, provider) => {
  const registry = new BlockRegistry()
  registerCorePrimitives(registry)
  if (provider) registerDataTablePrimitives(registry, provider)
  const persistence = new InMemoryPersistence()
  const engine = new WorkflowEngine({
    registry,
    workflowLoader: loader,
    vault: new NoopVault(),
    persistence
  })
  return { engine, persistence }
}

describe('Phase 3c — core.readDataRow', () => {
  it('reads specific row by rowId', async () => {
    const provider = new InMemoryDataTableProvider()
    provider.seed([
      { id: 'r1', datatableId: 'dt_groups', data: { url: 'https://fb/g/1' }, status: 'pending', retryCount: 0 },
      { id: 'r2', datatableId: 'dt_groups', data: { url: 'https://fb/g/2' }, status: 'done', retryCount: 0 }
    ])

    const wf = {
      id: 'wf_read_id', name: 'readById', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_r', manifestId: 'core.readDataRow', position: { x: 0, y: 0 },
            config: { datatableId: 'dt_groups', rowId: 'r2' }, inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { row: { sourceNodeId: 'n_r', sourceField: 'row' } } }
        ],
        edges: [{ id: 'e1', source: 'n_r', target: 'n_out' }]
      }
    }
    const { engine } = makeEngine(async () => wf, provider)
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed', result.error)
    assert.equal(result.output?.row?.id, 'r2')
    assert.equal(result.output?.row?.status, 'done')
    assert.equal(result.output?.row?.data?.url, 'https://fb/g/2')
  })

  it('picks row with filter + atomicLock=true sets status=in_progress', async () => {
    const provider = new InMemoryDataTableProvider()
    provider.seed([
      { id: 'a', datatableId: 'dt', data: {}, status: 'pending', retryCount: 0, createdAt: '2026-04-01T00:00:00Z' },
      { id: 'b', datatableId: 'dt', data: {}, status: 'pending', retryCount: 0, createdAt: '2026-04-02T00:00:00Z' },
      { id: 'c', datatableId: 'dt', data: {}, status: 'done',    retryCount: 0, createdAt: '2026-04-03T00:00:00Z' }
    ])

    const wf = {
      id: 'wf_pick', name: 'pick', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_r', manifestId: 'core.readDataRow', position: { x: 0, y: 0 },
            config: {
              datatableId: 'dt',
              filter: { where: { status: 'pending' }, orderBy: 'created_at', limit: 5 },
              atomicLock: true
            },
            inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: {
              count: { sourceNodeId: 'n_r', sourceField: 'count' },
              rows: { sourceNodeId: 'n_r', sourceField: 'rows' }
            } }
        ],
        edges: [{ id: 'e1', source: 'n_r', target: 'n_out' }]
      }
    }
    const { engine } = makeEngine(async () => wf, provider)
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed', result.error)
    assert.equal(result.output?.count, 2)   // a + b (pending)
    const ids = result.output.rows.map((r) => r.id)
    assert.deepEqual(ids, ['a', 'b'])

    // Verify atomic lock applied
    assert.equal(provider.rows.get('a').status, 'in_progress')
    assert.equal(provider.rows.get('b').status, 'in_progress')
    assert.equal(provider.rows.get('c').status, 'done')   // unchanged
  })

  it('returns error when datatableId missing', async () => {
    const provider = new InMemoryDataTableProvider()
    const wf = {
      id: 'wf_no_id', name: 'noId', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_r', manifestId: 'core.readDataRow', position: { x: 0, y: 0 },
            config: {}, inputMapping: {}, onError: 'continue' },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { err: { sourceNodeId: 'n_r', sourceField: 'error' } } }
        ],
        edges: [{ id: 'e1', source: 'n_r', target: 'n_out' }]
      }
    }
    const { engine } = makeEngine(async () => wf, provider)
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed')
    assert.match(String(result.output?.err), /datatableId is required/)
  })
})

describe('Phase 3c — core.updateDataRow', () => {
  it('updates row fields: status + data merge + incrementRetry', async () => {
    const provider = new InMemoryDataTableProvider()
    provider.seed([
      { id: 'r1', datatableId: 'dt', data: { x: 1, y: 2 }, status: 'pending', retryCount: 3 }
    ])

    const wf = {
      id: 'wf_upd', name: 'upd', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_u', manifestId: 'core.updateDataRow', position: { x: 0, y: 0 },
            config: {
              rowId: 'r1',
              status: 'done',
              data: { y: 99, z: 'new' },
              incrementRetry: true,
              lastRunId: 'run-abc'
            },
            inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { row: { sourceNodeId: 'n_u', sourceField: 'row' } } }
        ],
        edges: [{ id: 'e1', source: 'n_u', target: 'n_out' }]
      }
    }
    const { engine } = makeEngine(async () => wf, provider)
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed', result.error)
    const row = result.output?.row
    assert.equal(row?.status, 'done')
    assert.deepEqual(row?.data, { x: 1, y: 99, z: 'new' })
    assert.equal(row?.retryCount, 4)
    assert.equal(row?.lastRunId, 'run-abc')

    // Persistent state in provider
    const stored = provider.rows.get('r1')
    assert.equal(stored.status, 'done')
    assert.equal(stored.retryCount, 4)
  })

  it('returns error when row not found (with onError continue)', async () => {
    const provider = new InMemoryDataTableProvider()
    const wf = {
      id: 'wf_upd_nf', name: 'updNotFound', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_u', manifestId: 'core.updateDataRow', position: { x: 0, y: 0 },
            config: { rowId: 'nope', status: 'done' }, inputMapping: {}, onError: 'continue' },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { err: { sourceNodeId: 'n_u', sourceField: 'error' } } }
        ],
        edges: [{ id: 'e1', source: 'n_u', target: 'n_out' }]
      }
    }
    const { engine } = makeEngine(async () => wf, provider)
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed')
    assert.match(String(result.output?.err), /not found/)
  })
})

describe('Phase 3c — full datatable iteration workflow', () => {
  it('readRow filter → loop over rows → updateRow done per iter', async () => {
    const provider = new InMemoryDataTableProvider()
    provider.seed([
      { id: 'r1', datatableId: 'dt', data: { name: 'Group A' }, status: 'pending', retryCount: 0 },
      { id: 'r2', datatableId: 'dt', data: { name: 'Group B' }, status: 'pending', retryCount: 0 },
      { id: 'r3', datatableId: 'dt', data: { name: 'Group C' }, status: 'pending', retryCount: 0 }
    ])

    const wf = {
      id: 'wf_dt_chain', name: 'datatable chain', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_read', manifestId: 'core.readDataRow', position: { x: 0, y: 0 },
            config: {
              datatableId: 'dt',
              filter: { where: { status: 'pending' }, limit: 10 },
              atomicLock: false
            },
            inputMapping: {} },
          { id: 'n_loop', manifestId: 'core.loop', position: { x: 0, y: 100 },
            config: { loopType: 'forEach' },
            inputMapping: { items: { sourceNodeId: 'n_read', sourceField: 'rows' } } },
          { id: 'n_log', manifestId: 'core.log', position: { x: 0, y: 200 },
            config: { message: 'processing {{item.data.name}}', level: 'info' },
            inputMapping: {} },
          { id: 'n_upd', manifestId: 'core.updateDataRow', position: { x: 0, y: 300 },
            config: { status: 'done' },
            inputMapping: { rowId: { sourceNodeId: '$inline', sourceField: 'item.id' } } }
        ],
        edges: [
          { id: 'e1', source: 'n_read', target: 'n_loop' },
          { id: 'e2', source: 'n_loop', sourceHandle: 'loop-body', target: 'n_log' },
          { id: 'e3', source: 'n_log', target: 'n_upd' }
        ]
      }
    }
    // Note: $inline source is invented; we'll use direct config interpolation via {{item.id}} instead.
    // Workaround: rowId from config interpolation.
    wf.graph.nodes[3].config = { rowId: '{{item.id}}', status: 'done' }
    wf.graph.nodes[3].inputMapping = {}

    const { engine } = makeEngine(async () => wf, provider)
    const logs = []
    engine.on('progress', (e) => { if (e.kind === 'log') logs.push(e) })
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed', result.error)

    const messages = logs.map((l) => l.message)
    assert.deepEqual(messages, ['processing Group A', 'processing Group B', 'processing Group C'])

    // All rows updated to done
    assert.equal(provider.rows.get('r1').status, 'done')
    assert.equal(provider.rows.get('r2').status, 'done')
    assert.equal(provider.rows.get('r3').status, 'done')
  })
})
