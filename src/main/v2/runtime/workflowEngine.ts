import {
  WorkflowDef, WorkflowNode, WorkflowEdge,
  BlockDef, RunV2, RunStepV2, StepStatus, RunStatus, BlockResult,
  ScreenshotCaptureOn, ScreenshotCaptureTiming
} from '../../../shared/v2Types'
import { PageController } from './pageController'
import { BlockExecutor } from './blockExecutor'
import type { BlockRuntimeHelpers } from './blockHelpers'
import * as blockRepo from '../../data/repositories/blockRepository'
import * as workflowV2Repo from '../../data/repositories/workflowV2Repository'
import * as runV2Repo from '../../data/repositories/runV2Repository'

export interface RunContext {
  organizationId?: number | null
  accountId?: number
  campaignId?: number
  campaignInputId?: number | null
  campaignInputDataId?: number
  signal?: AbortSignal
  /** Realtime callback cho mỗi step transition (running → success/error/skipped) */
  onStepProgress?: (step: RunStepV2) => void
  /** Realtime callback cho log từ helpers.log() */
  onLog?: (entry: { nodeId: string; line: string }) => void
  /** Optional helper implementations exposed to JS blocks. */
  runtimeHelpers?: BlockRuntimeHelpers
  /** Best-effort screenshot hook for node-level runtime capture settings. */
  onBlockScreenshot?: (request: BlockScreenshotCaptureRequest, page: PageController) => Promise<void>
  /** Có persist run + run_steps vào DB không. Test runs có thể skip. */
  persist?: boolean
}

export interface BlockScreenshotCaptureRequest {
  organizationId?: number | null
  accountId?: number
  campaignId?: number
  campaignInputId?: number | null
  campaignInputDataId?: number
  workflowId?: number
  runId?: number
  runStepId?: number
  nodeId: string
  blockId?: number
  blockName?: string
  stepStatus: StepStatus
  captureTiming: ScreenshotCaptureTiming
  captureOn: ScreenshotCaptureOn
  captureReason: 'success' | 'failure'
  error?: string
  output: Record<string, unknown>
  startedAt?: string
  completedAt?: string
}

export interface RunResult {
  runId?: number
  status: RunStatus
  output: Record<string, unknown>
  error?: string
  steps: RunStepV2[]
}

interface NodeState {
  status: StepStatus
  output: Record<string, unknown>
  error?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  stepDbId?: number
}

const RUNTIME_NODE_CONFIG_KEYS = new Set([
  'screenshotCaptureTiming',
  'screenshotCaptureOn'
])

const SCREENSHOT_CAPTURE_TIMINGS = new Set<ScreenshotCaptureTiming>(['before', 'after', 'both'])
const SCREENSHOT_CAPTURE_ON = new Set<ScreenshotCaptureOn>(['off', 'success', 'failure', 'always'])

/**
 * WorkflowEngineV2 — DAG executor với parallel + AND/OR join.
 *
 * Algorithm: cohort-based topological sort.
 *   ready = nodes có in-degree 0
 *   while ready not empty:
 *     await Promise.all(ready.map(executeNode))
 *     compute nextReady = các successors có tất cả parents đã complete
 *     ready = nextReady
 *
 * System blocks runtime:
 *   - ifElse: eval `config.condition` với scope {input, vars}. Edges có
 *     sourceHandle 'true'|'false'. Nhánh không trúng → mark skipped đệ quy
 *     (BFS) cho tới khi gặp merge node.
 *   - loop: config {loopType: count|while|forEach, count, items, condition}.
 *     Edges 'body' (body subgraph), 'done' (after loop). Body subgraph chạy
 *     N iterations, mỗi iteration với loopIndex+loopItem inject vào input.
 *   - merge: config {mode: 'all'|'any'}. 'all' = AND (default). 'any' = OR.
 *   - parallel: no-op (DAG natural đã split).
 */
export class WorkflowEngineV2 {
  private executor = new BlockExecutor()

  async run(
    workflowOrId: number | WorkflowDef,
    variables: Record<string, unknown>,
    page: PageController | null,
    ctx: RunContext = {}
  ): Promise<RunResult> {
    // Resolve workflow
    const workflow = typeof workflowOrId === 'number'
      ? await workflowV2Repo.getWorkflow(workflowOrId)
      : workflowOrId
    if (!workflow) throw new Error(`Workflow không tồn tại: ${workflowOrId}`)

    // Pre-load tất cả block definitions cần thiết để tránh round-trip DB trong vòng lặp
    const blockMap = await this.loadBlocks(workflow.nodes)

    // Tạo run record
    const persist = ctx.persist ?? true
    let runId: number | undefined
    if (persist) {
      try {
        runId = await runV2Repo.createRun({
          workflowId: workflow.id,
          campaignId: ctx.campaignId,
          campaignInputDataId: ctx.campaignInputDataId,
          accountId: ctx.accountId,
          status: 'running',
          variables,
          output: {},
          startedAt: new Date().toISOString()
        })
      } catch (err) {
        console.error('[engineV2] createRun failed:', err)
      }
    }

    // Build graph
    const graph = this.buildGraph(workflow.nodes, workflow.edges)
    const nodeStates = new Map<string, NodeState>()
    for (const node of workflow.nodes) {
      nodeStates.set(node.id, { status: 'pending', output: {} })
    }

    // allSteps: track MỌI lần execute của mọi node (loop body có thể chạy lại nhiều lần
    // → cần history đầy đủ cho scheduler logging, không chỉ snapshot cuối)
    const allSteps: RunStepV2[] = []

    const signal = ctx.signal ?? new AbortController().signal

    // ===== Main DAG loop =====
    let cancelled = false
    let failed = false

    while (true) {
      if (signal.aborted) { cancelled = true; break }
      const ready = this.computeReady(workflow, graph, nodeStates)
      if (ready.length === 0) break

      // Run cohort song song
      await Promise.all(ready.map(node => this.executeNode({
        node, blockMap, workflow, graph, nodeStates, variables,
        page, signal, runId, ctx, allSteps
      })))

      if (signal.aborted) { cancelled = true; break }
    }

    // ===== Determine overall status =====
    let overallStatus: RunStatus = 'completed'
    let overallError: string | undefined
    let lastError: string | undefined
    for (const [, state] of nodeStates) {
      if (state.status === 'error') { failed = true; lastError = state.error }
    }
    if (cancelled) overallStatus = 'cancelled'
    else if (failed) { overallStatus = 'failed'; overallError = lastError }

    // Aggregate output (concatenate outputs của leaf nodes — node không có successor)
    const output: Record<string, unknown> = {}
    for (const node of workflow.nodes) {
      const childEdges = graph.children.get(node.id) ?? []
      const state = nodeStates.get(node.id)!
      if (childEdges.length === 0 && state.status === 'success') {
        Object.assign(output, state.output)
      }
    }

    // Build steps result: ưu tiên allSteps (đã accumulate đủ cho loop body),
    // fallback về snapshot từ nodeStates cho nodes nằm ngoài loop (đảm bảo đủ độ phủ).
    const seenNodeIds = new Set(allSteps.map(s => s.nodeId))
    const snapshotSteps: RunStepV2[] = workflow.nodes
      .filter(node => !seenNodeIds.has(node.id))
      .map(node => {
        const s = nodeStates.get(node.id)!
        return {
          runId,
          nodeId: node.id,
          blockId: node.blockId,
          blockName: node.blockName,
          status: s.status,
          input: {},
          output: s.output,
          error: s.error,
          durationMs: s.durationMs,
          startedAt: s.startedAt,
          completedAt: s.completedAt
        }
      })
    const steps: RunStepV2[] = [...allSteps, ...snapshotSteps]

    // Update run record
    if (persist && runId) {
      try {
        await runV2Repo.updateRun(runId, {
          status: overallStatus,
          output,
          error: overallError,
          completedAt: new Date().toISOString()
        })
      } catch (err) {
        console.error('[engineV2] updateRun failed:', err)
      }
    }

    return { runId, status: overallStatus, output, error: overallError, steps }
  }

  // =========== EXECUTION CORE ===========

  private async executeNode(args: {
    node: WorkflowNode
    blockMap: Map<number, BlockDef>
    workflow: WorkflowDef
    graph: Graph
    nodeStates: Map<string, NodeState>
    variables: Record<string, unknown>
    page: PageController | null
    signal: AbortSignal
    runId?: number
    ctx: RunContext
    allSteps: RunStepV2[]
  }): Promise<void> {
    const { node, blockMap, workflow, graph, nodeStates, variables, page, signal, runId, ctx, allSteps } = args
    const state = nodeStates.get(node.id)!
    state.status = 'running'
    state.startedAt = new Date().toISOString()

    // Build input (merge node.config + outputs từ parents)
    const input = this.buildInput(node, graph, nodeStates)

    // Persist running step
    let stepDbId: number | undefined
    if ((ctx.persist ?? true) && runId) {
      try {
        stepDbId = await runV2Repo.createRunStep(runId, {
          nodeId: node.id,
          blockId: node.blockId,
          blockName: node.blockName,
          status: 'running',
          input,
          output: {},
          startedAt: state.startedAt
        })
        state.stepDbId = stepDbId
      } catch (err) {
        console.error('[engineV2] createRunStep failed:', err)
      }
    }
    ctx.onStepProgress?.({
      runId, nodeId: node.id, blockId: node.blockId, blockName: node.blockName,
      status: 'running', input, output: {}, startedAt: state.startedAt
    })

    // ===== Dispatch theo systemType =====
    const block = blockMap.get(node.blockId)
    let result: BlockResult

    try {
      if (node.systemType === 'ifElse') {
        result = await this.execIfElse(node, input, variables)
      } else if (node.systemType === 'loop') {
        result = await this.execLoop(node, input, variables, workflow, graph, nodeStates, blockMap, page, signal, runId, ctx, allSteps)
      } else if (node.systemType === 'merge' || node.systemType === 'parallel') {
        result = await this.execMergeOrParallel(node, input)
      } else {
        // JS block
        if (!block) {
          throw new Error(`Block không tìm thấy: blockId=${node.blockId} blockName="${node.blockName}"`)
        }
        const code = node.codeOverride ?? block.code
        result = await this.executor.execute(
          { code, blockName: block.name },
          {
            input, page, vars: variables, signal,
            runtimeHelpers: ctx.runtimeHelpers,
            runtimeMetadata: {
              accountId: ctx.accountId,
              organizationId: ctx.organizationId,
              campaignId: ctx.campaignId,
              campaignInputId: ctx.campaignInputId,
              campaignInputDataId: ctx.campaignInputDataId,
              workflowId: workflow.id,
              runId,
              runStepId: stepDbId,
              nodeId: node.id,
              blockId: node.blockId,
              blockName: node.blockName
            },
            onLog: (line) => ctx.onLog?.({ nodeId: node.id, line })
          }
        )
      }
    } catch (err: any) {
      result = {
        success: false,
        output: {},
        error: err?.message ? String(err.message) : String(err),
        durationMs: 0,
        logs: []
      }
    }

    state.completedAt = new Date().toISOString()
    state.durationMs = result.durationMs
    state.output = result.output
    if (result.success) {
      state.status = 'success'
    } else {
      state.status = 'error'
      state.error = result.error
    }

    // Persist step update
    if ((ctx.persist ?? true) && stepDbId) {
      try {
        await runV2Repo.updateRunStep(stepDbId, {
          status: state.status,
          output: state.output,
          error: state.error,
          durationMs: state.durationMs,
          completedAt: state.completedAt
        })
      } catch (err) {
        console.error('[engineV2] updateRunStep failed:', err)
      }
    }

    const screenshotCapture = this.resolveAfterScreenshotCapture(node, result)
    if (screenshotCapture && ctx.onBlockScreenshot && page) {
      try {
        await ctx.onBlockScreenshot({
          organizationId: ctx.organizationId,
          accountId: ctx.accountId,
          campaignId: ctx.campaignId,
          campaignInputId: ctx.campaignInputId,
          campaignInputDataId: ctx.campaignInputDataId,
          workflowId: workflow.id,
          runId,
          runStepId: stepDbId,
          nodeId: node.id,
          blockId: node.blockId,
          blockName: node.blockName,
          stepStatus: state.status,
          captureTiming: screenshotCapture.captureTiming,
          captureOn: screenshotCapture.captureOn,
          captureReason: screenshotCapture.captureReason,
          error: state.error,
          output: state.output,
          startedAt: state.startedAt,
          completedAt: state.completedAt
        }, page)
      } catch (err) {
        console.warn('[engineV2] block screenshot capture failed:', err)
      }
    }

    ctx.onStepProgress?.({
      runId, nodeId: node.id, blockId: node.blockId, blockName: node.blockName,
      status: state.status, input, output: state.output,
      error: state.error, durationMs: state.durationMs,
      startedAt: state.startedAt, completedAt: state.completedAt
    })

    // Accumulate step vào allSteps (loop body có thể chạy nhiều lần — mỗi lần 1 row)
    allSteps.push({
      runId,
      nodeId: node.id,
      blockId: node.blockId,
      blockName: node.blockName,
      status: state.status,
      input,
      output: state.output,
      error: state.error,
      durationMs: state.durationMs,
      startedAt: state.startedAt,
      completedAt: state.completedAt
    })

    // ===== Skip propagation cho ifElse =====
    if (node.systemType === 'ifElse' && state.status === 'success') {
      const branch = state.output.branch === 'true' ? 'true' : 'false'
      this.skipBranchOfIfElse(node, branch, workflow, graph, nodeStates)
    }
  }

  // =========== SYSTEM BLOCKS ===========

  private async execIfElse(node: WorkflowNode, input: Record<string, unknown>, vars: Record<string, unknown>): Promise<BlockResult> {
    const startTime = Date.now()
    const condition = String(node.config?.condition ?? 'false')
    try {
      // Eval condition trong sandbox vm (an toàn hơn new Function)
      const sandbox = require('vm').createContext({ input, vars, Math, JSON })
      const result: unknown = require('vm').runInContext(`(${condition})`, sandbox, { timeout: 5000 })
      const branch = !!result ? 'true' : 'false'
      return {
        success: true,
        output: { branch, conditionResult: !!result },
        durationMs: Date.now() - startTime,
        logs: []
      }
    } catch (err: any) {
      return {
        success: false,
        output: { branch: 'false' },
        error: `ifElse condition lỗi: ${err.message}`,
        durationMs: Date.now() - startTime,
        logs: []
      }
    }
  }

  private async execMergeOrParallel(node: WorkflowNode, input: Record<string, unknown>): Promise<BlockResult> {
    void node
    // Merge passthrough: output = merged input từ parents (đã merge sẵn trong buildInput)
    return {
      success: true,
      output: input,
      durationMs: 0,
      logs: []
    }
  }

  /**
   * Loop execution.
   *   loopType=count: chạy `count` lần. loopItem = undefined.
   *   loopType=forEach: chạy mỗi item trong `items`. items có thể là array literal
   *     hoặc tham chiếu input.X (đặt trong config.itemsExpr).
   *   loopType=while: lặp tới khi `condition` (JS expr) === false. Hard cap 1000 vòng.
   *
   * Mỗi iteration chạy body subgraph (BFS từ outgoing edge handle='body').
   * Body subgraph nhận input.loopIndex + input.loopItem qua việc inject vào
   * vars tạm thời cho duration của iteration.
   */
  private async execLoop(
    node: WorkflowNode,
    input: Record<string, unknown>,
    vars: Record<string, unknown>,
    workflow: WorkflowDef,
    graph: Graph,
    nodeStates: Map<string, NodeState>,
    blockMap: Map<number, BlockDef>,
    page: PageController | null,
    signal: AbortSignal,
    runId: number | undefined,
    ctx: RunContext,
    allSteps: RunStepV2[]
  ): Promise<BlockResult> {
    const startTime = Date.now()
    const cfg = node.config ?? {}
    const loopType = (cfg.loopType as string) ?? 'count'
    void blockMap
    void runId

    // Determine iterations
    let iterations: { index: number; item?: unknown }[] = []
    try {
      if (loopType === 'count') {
        const count = Number(cfg.count ?? input.count ?? 0)
        for (let i = 0; i < count; i++) iterations.push({ index: i })
      } else if (loopType === 'forEach') {
        let items: unknown[]
        if (Array.isArray(cfg.items)) items = cfg.items as unknown[]
        else if (typeof cfg.itemsExpr === 'string') {
          const sandbox = require('vm').createContext({ input, vars, Math, JSON })
          const v = require('vm').runInContext(`(${cfg.itemsExpr})`, sandbox, { timeout: 5000 })
          items = Array.isArray(v) ? v : []
        } else if (Array.isArray(input.items)) items = input.items as unknown[]
        else items = []
        items.forEach((item, i) => iterations.push({ index: i, item }))
      } else if (loopType === 'while') {
        // Lazy iteration; xử lý trong loop chạy bên dưới
        iterations = []
      }
    } catch (err: any) {
      return {
        success: false, output: {},
        error: `Loop config lỗi: ${err.message}`,
        durationMs: Date.now() - startTime, logs: []
      }
    }

    // Body subgraph
    const bodyEdges = (graph.children.get(node.id) ?? []).filter(e => e.sourceHandle === 'body')
    const bodyStartIds = bodyEdges.map(e => e.target)
    if (bodyStartIds.length === 0) {
      // Loop không có body → no-op
      return { success: true, output: { iterations: 0 }, durationMs: Date.now() - startTime, logs: [] }
    }
    const bodyNodeIds = this.collectBodySubgraph(bodyStartIds, node.id, graph)
    const markPendingBodySkipped = () => {
      for (const id of bodyNodeIds) {
        const s = nodeStates.get(id)
        if (s?.status === 'pending') s.status = 'skipped'
      }
    }

    // Helper: chạy 1 iteration body
    const runIteration = async (iterIdx: number, item: unknown | undefined) => {
      // Reset body node states
      for (const id of bodyNodeIds) {
        nodeStates.set(id, { status: 'pending', output: {} })
      }
      const iterVars = { ...vars, loopIndex: iterIdx, loopItem: item, loopIteration: iterIdx + 1 }
      // Mini DAG loop trên body subgraph
      while (true) {
        if (signal.aborted) return false
        const ready = this.computeReadyInSubgraph(workflow, graph, nodeStates, bodyNodeIds, bodyStartIds, node.id)
        if (ready.length === 0) break
        await Promise.all(ready.map(n => this.executeNode({
          node: n, blockMap, workflow, graph, nodeStates,
          variables: iterVars, page, signal, runId, ctx, allSteps
        })))
      }
      // Iteration coi như completed nếu không có body node nào lỗi
      for (const id of bodyNodeIds) {
        const s = nodeStates.get(id)!
        if (s.status === 'error') return false
      }
      return true
    }

    if (loopType === 'while') {
      const conditionExpr = String(cfg.condition ?? 'false')
      const cap = Number(cfg.maxIterations ?? 1000)
      let i = 0
      let lastSuccess = true
      while (i < cap) {
        if (signal.aborted) break
        // Eval condition
        try {
          const sandbox = require('vm').createContext({ input, vars, iter: i, Math, JSON })
          const v = require('vm').runInContext(`(${conditionExpr})`, sandbox, { timeout: 5000 })
          if (!v) break
        } catch (err: any) {
          return {
            success: false, output: { iterations: i },
            error: `while condition lỗi: ${err.message}`,
            durationMs: Date.now() - startTime, logs: []
          }
        }
        lastSuccess = await runIteration(i, undefined)
        if (!lastSuccess) {
          return {
            success: false, output: { iterations: i + 1 },
            error: 'Body iteration lỗi',
            durationMs: Date.now() - startTime, logs: []
          }
        }
        i++
      }
      if (i === 0) markPendingBodySkipped()
      return { success: true, output: { iterations: i }, durationMs: Date.now() - startTime, logs: [] }
    } else {
      let completed = 0
      for (const it of iterations) {
        if (signal.aborted) break
        const ok = await runIteration(it.index, it.item)
        if (!ok) {
          return {
            success: false, output: { iterations: completed },
            error: `Body iteration #${it.index + 1} lỗi`,
            durationMs: Date.now() - startTime, logs: []
          }
        }
        completed++
      }
      if (completed === 0) markPendingBodySkipped()
      return { success: true, output: { iterations: completed }, durationMs: Date.now() - startTime, logs: [] }
    }
  }

  // =========== HELPERS ===========

  private async loadBlocks(nodes: WorkflowNode[]): Promise<Map<number, BlockDef>> {
    const ids = Array.from(new Set(nodes.map(n => n.blockId).filter(Boolean)))
    const map = new Map<number, BlockDef>()
    for (const id of ids) {
      const b = await blockRepo.getBlock(id)
      if (b) map.set(id, b)
    }
    return map
  }

  private buildGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): Graph {
    const children = new Map<string, WorkflowEdge[]>()
    const parents = new Map<string, WorkflowEdge[]>()
    for (const node of nodes) {
      children.set(node.id, [])
      parents.set(node.id, [])
    }
    for (const edge of edges) {
      const cs = children.get(edge.source) ?? []
      cs.push(edge)
      children.set(edge.source, cs)
      const ps = parents.get(edge.target) ?? []
      ps.push(edge)
      parents.set(edge.target, ps)
    }
    return { nodes: new Map(nodes.map(n => [n.id, n])), children, parents }
  }

  /**
   * Tìm các node có thể chạy ngay:
   *   - status === pending
   *   - tất cả parents đã hoàn thành (success | error | skipped)
   *   - đặc biệt: merge mode='any' → chạy khi ít nhất 1 parent success
   *   - default: chạy khi tất cả parents success. Nếu có parent error/skipped
   *     → node này cũng skipped.
   *
   * Side effect: nodes mà có parent error/skipped sẽ được mark skipped trong
   * `nodeStates` (để loop trên không re-evaluate).
   */
  private computeReady(
    workflow: WorkflowDef,
    graph: Graph,
    nodeStates: Map<string, NodeState>
  ): WorkflowNode[] {
    return this.computeReadyInSubgraph(workflow, graph, nodeStates, null, null, null)
  }

  private computeReadyInSubgraph(
    workflow: WorkflowDef,
    graph: Graph,
    nodeStates: Map<string, NodeState>,
    subset: Set<string> | string[] | null,
    rootNodeIds: string[] | null,
    excludeFromParents: string | null
  ): WorkflowNode[] {
    const subsetSet = subset ? (Array.isArray(subset) ? new Set(subset) : subset) : null
    const topLevelLoopBodyNodes = subsetSet ? null : this.collectAllLoopBodySubgraphs(workflow, graph)
    const ready: WorkflowNode[] = []
    for (const node of workflow.nodes) {
      if (subsetSet && !subsetSet.has(node.id)) continue
      if (topLevelLoopBodyNodes?.has(node.id)) continue
      const state = nodeStates.get(node.id)!
      if (state.status !== 'pending') continue

      const parentEdges = (graph.parents.get(node.id) ?? []).filter(e => {
        // Subset mode: chỉ tính edges từ parents trong subset hoặc từ rootNodeIds
        if (!subsetSet) return true
        if (excludeFromParents && e.source === excludeFromParents) {
          return rootNodeIds ? rootNodeIds.includes(node.id) : true
        }
        return subsetSet.has(e.source)
      })

      // Subset mode + rootNodeIds: nếu node là root của body subgraph → coi như không có parents
      if (subsetSet && rootNodeIds && rootNodeIds.includes(node.id)) {
        ready.push(node)
        continue
      }

      if (parentEdges.length === 0) {
        ready.push(node)
        continue
      }

      const parentStates = parentEdges.map(e => nodeStates.get(e.source)!)
      const allDone = parentStates.every(p => p.status === 'success' || p.status === 'error' || p.status === 'skipped')
      if (!allDone) continue

      // System merge node: kiểm tra mode
      if (node.systemType === 'merge') {
        const mode = ((node.config?.mode as string) ?? 'all')
        if (mode === 'any') {
          const anySuccess = parentStates.some(p => p.status === 'success')
          if (anySuccess) ready.push(node)
          else state.status = 'skipped'
          continue
        }
      }

      // Default behavior
      const allSuccess = parentStates.every(p => p.status === 'success')
      if (allSuccess) {
        ready.push(node)
      } else {
        // 1+ parent error/skipped → node này cũng skip
        state.status = 'skipped'
      }
    }
    return ready
  }

  /**
   * Build input cho 1 node:
   *   - Bắt đầu với node.config (user-set qua UI)
   *   - Merge các parent outputs (object spread theo thứ tự edges)
   *   - Edge sourceHandle (true/false từ ifElse, body/done từ loop) không lan
   *     vào input — chỉ control flow.
   */
  private buildInput(node: WorkflowNode, graph: Graph, nodeStates: Map<string, NodeState>): Record<string, unknown> {
    const input: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node.config ?? {})) {
      if (!RUNTIME_NODE_CONFIG_KEYS.has(key)) input[key] = value
    }
    const parents = graph.parents.get(node.id) ?? []
    for (const edge of parents) {
      const parentState = nodeStates.get(edge.source)
      if (parentState?.status === 'success' && parentState.output) {
        Object.assign(input, parentState.output)
      }
    }
    return input
  }

  private resolveAfterScreenshotCapture(
    node: WorkflowNode,
    result: BlockResult
  ): { captureTiming: ScreenshotCaptureTiming; captureOn: ScreenshotCaptureOn; captureReason: 'success' | 'failure' } | null {
    const captureOn = normalizeScreenshotCaptureOn(node.config?.screenshotCaptureOn)
    if (captureOn === 'off') return null

    const captureTiming = normalizeScreenshotCaptureTiming(node.config?.screenshotCaptureTiming)
    if (captureTiming !== 'after' && captureTiming !== 'both') return null

    const captureReason = getBlockResultCaptureReason(result)
    if (captureOn !== 'always' && captureOn !== captureReason) return null

    return { captureTiming, captureOn, captureReason }
  }

  /**
   * Khi ifElse complete với branch X, mark skipped tất cả nodes downstream qua
   * sourceHandle != X. BFS dừng khi gặp merge node (vì merge có thể converge
   * cả 2 nhánh).
   */
  private skipBranchOfIfElse(
    ifNode: WorkflowNode,
    activeBranch: 'true' | 'false',
    workflow: WorkflowDef,
    graph: Graph,
    nodeStates: Map<string, NodeState>
  ): void {
    void workflow
    const skipBranch = activeBranch === 'true' ? 'false' : 'true'
    const startEdges = (graph.children.get(ifNode.id) ?? []).filter(e => e.sourceHandle === skipBranch)
    const queue: string[] = startEdges.map(e => e.target)
    const visited = new Set<string>()
    while (queue.length > 0) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      const node = graph.nodes.get(id)
      if (!node) continue
      // Dừng tại merge — merge tự handle skip qua computeReady
      if (node.systemType === 'merge') continue
      const state = nodeStates.get(id)!
      if (state.status === 'pending') state.status = 'skipped'
      const childEdges = graph.children.get(id) ?? []
      for (const e of childEdges) queue.push(e.target)
    }
  }

  /**
   * BFS từ body start nodes, thu hết nodes có thể reach mà không qua node loop
   * gốc. Dùng để identify body subgraph cho loop iteration.
   */
  private collectBodySubgraph(bodyStartIds: string[], loopNodeId: string, graph: Graph): Set<string> {
    const result = new Set<string>()
    const queue: string[] = [...bodyStartIds]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (id === loopNodeId) continue
      if (result.has(id)) continue
      result.add(id)
      const childEdges = graph.children.get(id) ?? []
      for (const e of childEdges) {
        if (e.target !== loopNodeId) queue.push(e.target)
      }
    }
    return result
  }

  private collectAllLoopBodySubgraphs(workflow: WorkflowDef, graph: Graph): Set<string> {
    const result = new Set<string>()
    for (const node of workflow.nodes) {
      if (node.systemType !== 'loop') continue
      const bodyStartIds = (graph.children.get(node.id) ?? [])
        .filter(e => e.sourceHandle === 'body')
        .map(e => e.target)
      for (const id of this.collectBodySubgraph(bodyStartIds, node.id, graph)) {
        result.add(id)
      }
    }
    return result
  }
}

function normalizeScreenshotCaptureTiming(value: unknown): ScreenshotCaptureTiming {
  return typeof value === 'string' && SCREENSHOT_CAPTURE_TIMINGS.has(value as ScreenshotCaptureTiming)
    ? value as ScreenshotCaptureTiming
    : 'after'
}

function normalizeScreenshotCaptureOn(value: unknown): ScreenshotCaptureOn {
  return typeof value === 'string' && SCREENSHOT_CAPTURE_ON.has(value as ScreenshotCaptureOn)
    ? value as ScreenshotCaptureOn
    : 'off'
}

function getBlockResultCaptureReason(result: BlockResult): 'success' | 'failure' {
  if (!result.success) return 'failure'
  if (result.output?.ok === false || result.output?.success === false) return 'failure'
  return 'success'
}

interface Graph {
  nodes: Map<string, WorkflowNode>
  children: Map<string, WorkflowEdge[]>
  parents: Map<string, WorkflowEdge[]>
}

// Re-export type for consumer
export type { RunV2 }
