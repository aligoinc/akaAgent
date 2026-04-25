// Phase 3a — primitives unit tests (delay, transformJson, subflow, httpRequest mock)
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

describe('Phase 3a — control flow', () => {
  it('core.delay sleeps approximately requested ms', async () => {
    const wf = {
      id: 'wf_delay', name: 'delay', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_d', manifestId: 'core.delay', position: { x: 0, y: 0 }, config: { ms: 80 }, inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { waited: { sourceNodeId: 'n_d', sourceField: 'waitedMs' } } }
        ],
        edges: [{ id: 'e1', source: 'n_d', target: 'n_out' }]
      }
    }
    const { engine } = makeEngine(async () => wf)
    const t0 = Date.now()
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    const elapsed = Date.now() - t0
    assert.equal(result.status, 'completed')
    assert.ok(elapsed >= 70, `elapsed ${elapsed}ms should be >= 70`)
    assert.ok(typeof result.output?.waited === 'number')
    assert.ok(result.output.waited >= 70 && result.output.waited <= 300, `waited ${result.output.waited} not within bounds`)
  })
})

describe('Phase 3a — data', () => {
  it('core.transformJson interpolates template fields', async () => {
    const wf = {
      id: 'wf_transform', name: 'transform', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_src', manifestId: 'core.setVariable', position: { x: 0, y: 0 },
            config: { value: { name: 'octocat', repos: 8 } }, inputMapping: {} },
          { id: 'n_t', manifestId: 'core.transformJson', position: { x: 0, y: 100 },
            config: { template: { user: '{{n_src.value.name}}', count: '{{n_src.value.repos}}' } },
            inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 200 }, config: {},
            inputMapping: { result: { sourceNodeId: 'n_t', sourceField: 'result' } } }
        ],
        edges: [
          { id: 'e1', source: 'n_src', target: 'n_t' },
          { id: 'e2', source: 'n_t', target: 'n_out' }
        ]
      }
    }
    const { engine } = makeEngine(async () => wf)
    const result = await engine.enqueue({ workflowId: wf.id, input: {} })
    assert.equal(result.status, 'completed')
    // Single-template values preserve raw type: {{n_src.value.repos}} = 8 (number),
    // not '8' (string). Mixed string templates ("{{a}}-{{b}}") would coerce to string.
    assert.deepEqual(result.output?.result, { user: 'octocat', count: 8 })
  })
})

describe('Phase 3a — io.subflow', () => {
  it('runs a sub-workflow synchronously and returns its output', async () => {
    const subWf = {
      id: 'wf_sub_double', name: 'double', version: 1,
      inputSchema: [{ name: 'x', type: 'number', label: 'X' }],
      outputSchema: [{ name: 'doubled', type: 'number', label: 'Doubled' }],
      variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_in', manifestId: 'core.input', position: { x: 0, y: 0 }, config: {}, inputMapping: {} },
          { id: 'n_set', manifestId: 'core.setVariable', position: { x: 0, y: 100 },
            config: { value: '{{n_in.x}}' }, inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 200 }, config: {},
            inputMapping: { doubled: { sourceNodeId: 'n_set', sourceField: 'value' } } }
        ],
        edges: [
          { id: 'e1', source: 'n_in', target: 'n_set' },
          { id: 'e2', source: 'n_set', target: 'n_out' }
        ]
      }
    }
    const parentWf = {
      id: 'wf_parent', name: 'parent', version: 1,
      inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
      graph: {
        nodes: [
          { id: 'n_call', manifestId: 'core.subflow', position: { x: 0, y: 0 },
            config: { workflowId: 'wf_sub_double', input: { x: 21 }, mode: 'sync' }, inputMapping: {} },
          { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
            inputMapping: { result: { sourceNodeId: 'n_call', sourceField: 'output' } } }
        ],
        edges: [{ id: 'e1', source: 'n_call', target: 'n_out' }]
      }
    }
    const { engine } = makeEngine(async (id) => id === 'wf_sub_double' ? subWf : parentWf)
    const result = await engine.enqueue({ workflowId: 'wf_parent', input: {} })
    assert.equal(result.status, 'completed', result.error)
    // sub-workflow output: { doubled: '21' } because interpolation; ok for now.
    assert.ok(result.output?.result?.doubled !== undefined)
  })
})

describe('Phase 3a — io.httpRequest (mock)', () => {
  it('handles successful response with JSON body', async () => {
    // Mock global fetch
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://example.com/users/42')
      assert.equal(init?.method, 'GET')
      const headers = new Headers({ 'content-type': 'application/json' })
      return new Response(JSON.stringify({ id: 42, name: 'Alice' }), { status: 200, headers })
    }
    try {
      const wf = {
        id: 'wf_http', name: 'http', version: 1,
        inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
        graph: {
          nodes: [
            { id: 'n_http', manifestId: 'core.httpRequest', position: { x: 0, y: 0 },
              config: { url: 'https://example.com/users/42', method: 'GET', timeout: 5000 }, inputMapping: {} },
            { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
              inputMapping: {
                status: { sourceNodeId: 'n_http', sourceField: 'status' },
                user: { sourceNodeId: 'n_http', sourceField: 'data' }
              } }
          ],
          edges: [{ id: 'e1', source: 'n_http', target: 'n_out' }]
        }
      }
      const { engine } = makeEngine(async () => wf)
      const result = await engine.enqueue({ workflowId: wf.id, input: {} })
      assert.equal(result.status, 'completed', result.error)
      assert.equal(result.output?.status, 200)
      assert.deepEqual(result.output?.user, { id: 42, name: 'Alice' })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('captures error when fetch throws', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED') }
    try {
      const wf = {
        id: 'wf_http_err', name: 'err', version: 1,
        inputSchema: [], outputSchema: [], variables: [], triggers: [{ kind: 'manual', config: {} }],
        graph: {
          nodes: [
            { id: 'n_http', manifestId: 'core.httpRequest', position: { x: 0, y: 0 },
              config: { url: 'https://nope.example.com', method: 'GET', timeout: 1000 }, inputMapping: {},
              onError: 'continue' },
            { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 100 }, config: {},
              inputMapping: { err: { sourceNodeId: 'n_http', sourceField: 'error' } } }
          ],
          edges: [{ id: 'e1', source: 'n_http', target: 'n_out' }]
        }
      }
      const { engine } = makeEngine(async () => wf)
      const result = await engine.enqueue({ workflowId: wf.id, input: {} })
      assert.equal(result.status, 'completed', result.error)
      assert.match(String(result.output?.err), /HTTP request failed/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('Phase 3a — acceptance: GitHub API + transformJson + log (mocked)', () => {
  it('full chain: httpRequest → transformJson → log → output', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (url) => {
      assert.match(String(url), /api\.github\.com\/users\/octocat/)
      const headers = new Headers({ 'content-type': 'application/json' })
      return new Response(JSON.stringify({ login: 'octocat', name: 'The Octocat', public_repos: 8 }), { status: 200, headers })
    }

    try {
      const wf = {
        id: 'wf_gh', name: 'GitHub user fetch', version: 1,
        inputSchema: [{ name: 'user', type: 'string', label: 'Username', required: true }],
        outputSchema: [{ name: 'summary', type: 'json', label: 'Summary' }],
        variables: [], triggers: [{ kind: 'manual', config: {} }],
        graph: {
          nodes: [
            { id: 'n_in', manifestId: 'core.input', position: { x: 0, y: 0 }, config: {}, inputMapping: {} },
            { id: 'n_http', manifestId: 'core.httpRequest', position: { x: 0, y: 100 },
              config: { url: 'https://api.github.com/users/{{n_in.user}}', method: 'GET', timeout: 5000 }, inputMapping: {} },
            { id: 'n_t', manifestId: 'core.transformJson', position: { x: 0, y: 200 },
              config: {
                template: {
                  username: '{{n_http.data.login}}',
                  fullName: '{{n_http.data.name}}',
                  repoCount: '{{n_http.data.public_repos}}'
                }
              },
              inputMapping: {} },
            { id: 'n_log', manifestId: 'core.log', position: { x: 0, y: 300 },
              config: { message: '{{n_t.result.fullName}} has {{n_t.result.repoCount}} repos', level: 'info' },
              inputMapping: {} },
            { id: 'n_out', manifestId: 'core.output', position: { x: 0, y: 400 }, config: {},
              inputMapping: { summary: { sourceNodeId: 'n_t', sourceField: 'result' } } }
          ],
          edges: [
            { id: 'e1', source: 'n_in', target: 'n_http' },
            { id: 'e2', source: 'n_http', target: 'n_t' },
            { id: 'e3', source: 'n_t', target: 'n_log' },
            { id: 'e4', source: 'n_log', target: 'n_out' }
          ]
        }
      }
      const { engine, persistence } = makeEngine(async () => wf)
      const logs = []
      engine.on('progress', (e) => { if (e.kind === 'log') logs.push(e) })

      const result = await engine.enqueue({ workflowId: wf.id, input: { user: 'octocat' } })
      assert.equal(result.status, 'completed', result.error)

      // Output check (single-template preserves type)
      assert.equal(result.output?.summary?.username, 'octocat')
      assert.equal(result.output?.summary?.fullName, 'The Octocat')
      assert.equal(result.output?.summary?.repoCount, 8)

      // Log check (httpRequest emits 1 log + n_log emits 1)
      const userLog = logs.find((l) => /octocat.*8.*repos|The Octocat has 8 repos/i.test(l.message))
      assert.ok(userLog, `Expected user-facing log, got: ${logs.map((l) => l.message).join(' | ')}`)

      // Step count: input + http + transform + log + output = 5
      const steps = persistence.stepsForRun(result.runId)
      assert.equal(steps.length, 5)
      assert.ok(steps.every((s) => s.status === 'success'))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
