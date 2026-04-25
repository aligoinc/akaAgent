import { randomUUID } from 'node:crypto'
import type { Workflow, WorkflowNode, WorkflowEdge } from '../types/Workflow.js'
import type {
  Run,
  RunStep,
  RunStatus,
  RunRequest,
  RunResult,
  ProgressEvent,
  RunStepLogMessage
} from '../types/Run.js'
import type { IBrowserController } from '../controllers/IBrowserController.js'
import { ExecutionContext } from './ExecutionContext.js'
import { BlockRegistry, type ExecuteContext } from './BlockRegistry.js'
import { evaluateCondition } from './conditionEvaluator.js'
import { resolveValue } from './interpolate.js'
import {
  topologicalSort,
  buildNodeMap,
  buildOutgoingEdgeMap,
  buildIncomingEdgeMap
} from './topologicalSort.js'
import type { ExecutionMiddleware, NodeContext, NodeResult } from './ExecutionMiddleware.js'
import type { IRunPersistence } from './IRunPersistence.js'
import type { IConnectionVault } from './IConnectionVault.js'
import { LoopBreakSignal, LoopContinueSignal, isLoopSignal } from './LoopSignals.js'

/**
 * WorkflowRunner — execute 1 workflow lần.
 *
 * Phase 2: sequential topological execution + ifElse branching.
 * Phase 3a: + delay, transformJson, httpRequest, subflow primitives.
 * Phase 3b-1: + loop (count/forEach/while) + break + continue (refactor extract runNodeSubset).
 * Phase 3b-2 (next): switch, filter.
 * Phase 3b-3 (next): try/catch, parallel, race, aggregate, wait.
 *
 * Reserved fields (track/joinPolicy/joinCount/compensate) — IGNORE Phase 2-3,
 * parse + lưu nguyên trạng. Future enable không cần migrate.
 */

export interface WorkflowRunnerOptions {
  registry: BlockRegistry
  controller?: IBrowserController
  persistence: IRunPersistence
  vault: IConnectionVault
  middlewares?: ExecutionMiddleware[]
  onProgress?: (event: ProgressEvent) => void
  loadWorkflow?: (id: string, version?: number) => Promise<Workflow>
}

interface RunGraph {
  sortedIds: string[]
  nodeMap: Map<string, WorkflowNode>
  outgoing: Map<string, WorkflowEdge[]>
  incoming: Map<string, WorkflowEdge[]>
  bodyNodes: Set<string>              // nodes inside any control body (loop, try) — skip trong top-level pass
}

export class WorkflowRunner {
  private cancelled = false
  private abortController = new AbortController()

  constructor(private opts: WorkflowRunnerOptions) {}

  cancel(): void {
    this.cancelled = true
    this.abortController.abort()
  }

  async run(workflow: Workflow, request: RunRequest): Promise<RunResult> {
    const runId = randomUUID()
    const startedAt = new Date()
    const runMeta = {
      id: runId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      startedAt: startedAt.toISOString()
    }

    const secrets: Record<string, string> = {}
    const context = new ExecutionContext(workflow, request.input, secrets, runMeta)

    const run: Run = {
      id: runId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      ...(request.triggerId !== undefined ? { triggerId: request.triggerId } : {}),
      ...(request.channelId !== undefined ? { channelId: request.channelId } : {}),
      ...(request.context?.datatableRowId !== undefined ? { datatableRowId: request.context.datatableRowId } : {}),
      status: 'running',
      input: request.input,
      startedAt: runMeta.startedAt
    }

    await this.opts.persistence.createRun(run)
    this.emit({ kind: 'run.start', runId })

    let finalStatus: RunStatus = 'completed'
    let finalError: string | undefined
    let finalOutput: Record<string, unknown> = {}

    try {
      const graph = this.buildGraph(workflow)
      const skipped = new Set<string>()
      await this.runNodeSubset(graph.sortedIds, graph, context, runId, request, skipped, false)
    } catch (err) {
      finalStatus = 'failed'
      finalError = err instanceof Error ? err.message : String(err)
    }

    if (this.cancelled && finalStatus === 'completed') finalStatus = 'cancelled'

    const outputNode = workflow.graph.nodes.find(n => n.manifestId === 'core.output')
    if (outputNode && finalStatus === 'completed') {
      const out = context.getNodeOutput(outputNode.id)
      if (out) finalOutput = out
    }

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    await this.opts.persistence.finishRun(runId, finalStatus, finalOutput, finalError)
    this.emit({ kind: 'run.end', runId, status: finalStatus, durationMs })

    return {
      runId,
      status: finalStatus,
      ...(finalStatus === 'completed' ? { output: finalOutput } : {}),
      ...(finalError !== undefined ? { error: finalError } : {}),
      durationMs
    }
  }

  // ========== graph build ==========

  private buildGraph(workflow: Workflow): RunGraph {
    const nodeMap = buildNodeMap(workflow.graph.nodes)
    const outgoing = buildOutgoingEdgeMap(workflow.graph.edges)
    const incoming = buildIncomingEdgeMap(workflow.graph.edges)

    // Pre-scan body nodes của control structures (loop, try) — skip trong top-level pass
    const bodyNodes = new Set<string>()
    for (const node of workflow.graph.nodes) {
      if (node.manifestId === 'core.loop') {
        this.collectDownstreamReachableOnly(node.id, 'loop-body', outgoing, bodyNodes)
      }
      if (node.manifestId === 'core.try') {
        this.collectDownstreamReachableOnly(node.id, 'try-body', outgoing, bodyNodes)
      }
    }

    const sorted = topologicalSort(workflow.graph.nodes, workflow.graph.edges)
    return {
      sortedIds: sorted.map(n => n.id),
      nodeMap,
      outgoing,
      incoming,
      bodyNodes
    }
  }

  // ========== node subset execution ==========

  /**
   * Execute 1 list of node IDs in topological order, sharing context.
   * - Top-level: sortedIds = all sorted, skipBodyNodes=true (skip loop body trong main pass)
   * - Loop body iteration: sortedIds = sorted body subset, skipBodyNodes=false
   */
  private async runNodeSubset(
    sortedIds: string[],
    graph: RunGraph,
    context: ExecutionContext,
    runId: string,
    request: RunRequest,
    skipped: Set<string>,
    isInsideBody: boolean
  ): Promise<void> {
    for (const id of sortedIds) {
      if (this.cancelled) return
      const node = graph.nodeMap.get(id)
      if (!node) continue
      if (skipped.has(id)) continue
      // Top-level pass skips body nodes (loop/try) — control executor tự run body.
      if (!isInsideBody && graph.bodyNodes.has(id)) continue
      // Skip if all incoming come from skipped nodes (cascading skip)
      if (this.allParentsSkipped(id, graph.incoming, skipped)) {
        skipped.add(id)
        continue
      }

      // Loop control: chỉ valid khi bên trong loop body. Throw signal cho loop executor catch.
      if (node.manifestId === 'core.break') {
        if (!isInsideBody) throw new Error('core.break outside of any loop')
        await this.recordControlStep(node, context, runId, 'break')
        throw new LoopBreakSignal()
      }
      if (node.manifestId === 'core.continue') {
        if (!isInsideBody) throw new Error('core.continue outside of any loop')
        await this.recordControlStep(node, context, runId, 'continue')
        throw new LoopContinueSignal()
      }

      // Special: ifElse — execute condition, mark losing branch downstream as skipped
      if (node.manifestId === 'core.if') {
        const branchTaken = await this.executeIfNode(node, context, runId)
        const losingHandle = branchTaken ? 'if-false' : 'if-true'
        this.collectDownstream(node.id, losingHandle, graph.outgoing, graph.incoming, skipped)
        continue
      }

      // Special: switch — multi-case branching
      if (node.manifestId === 'core.switch') {
        await this.executeSwitchNode(node, context, runId, graph, skipped)
        continue
      }

      // Special: filter — skip downstream nếu condition false
      if (node.manifestId === 'core.filter') {
        await this.executeFilterNode(node, context, runId, graph, skipped)
        continue
      }

      // Special: loop
      if (node.manifestId === 'core.loop') {
        await this.executeLoopNode(node, graph, context, runId, request)
        continue
      }

      // Special: try/catch
      if (node.manifestId === 'core.try') {
        await this.executeTryNode(node, graph, context, runId, request, skipped)
        continue
      }

      // Special: aggregate — collect outputs from all incoming
      if (node.manifestId === 'core.aggregate') {
        await this.executeAggregateNode(node, context, runId, graph)
        continue
      }

      await this.executeNode(node, context, runId, request)
    }
  }

  // ========== loop ==========

  private async executeLoopNode(
    node: WorkflowNode,
    graph: RunGraph,
    context: ExecutionContext,
    runId: string,
    request: RunRequest
  ): Promise<void> {
    const startedAt = new Date()
    const resolved = this.resolveNodeInput(node, context)
    const loopType = String(resolved.loopType ?? 'forEach')
    const onIterationError = String(resolved.onIterationError ?? 'continue') as 'break' | 'continue' | 'fail'
    const maxIterations = Number(resolved.maxIterations ?? 10000)

    // Determine items to iterate
    let items: unknown[]
    if (loopType === 'count') {
      const n = Math.max(0, Number(resolved.count ?? 0))
      items = Array.from({ length: n }, (_, i) => i)
    } else if (loopType === 'forEach') {
      const raw = resolved.items
      if (Array.isArray(raw)) items = raw
      else if (typeof raw === 'string') {
        try {
          const parsed = JSON.parse(raw)
          items = Array.isArray(parsed) ? parsed : []
        } catch { items = [] }
      } else items = []
    } else if (loopType === 'while') {
      items = []   // dynamic — see while-mode below
    } else {
      throw new Error(`core.loop: unsupported loopType '${loopType}'`)
    }

    // Pre-build sorted body node list (subset of graph.sortedIds containing only this loop's body)
    const bodyIds = new Set<string>()
    this.collectDownstreamReachableOnly(node.id, 'loop-body', graph.outgoing, bodyIds)
    const sortedBody = graph.sortedIds.filter(id => bodyIds.has(id))

    let successCount = 0
    let errorCount = 0
    const iterationOutputs: Array<Record<string, unknown>> = []
    let lastError: string | undefined

    const runIteration = async (item: unknown, iteration: number, index: number): Promise<'success' | 'error' | 'break'> => {
      // Push local scope: { item, index, iteration, loop: { item, index, iteration } }
      const local: Record<string, unknown> = {
        item,
        index,
        iteration,
        loop: { item, index, iteration }
      }
      context.pushLocal(local)

      // Each iteration uses a fresh skip set (so previous iteration's skips don't carry over)
      const iterSkipped = new Set<string>()

      try {
        await this.runNodeSubset(sortedBody, graph, context, runId, request, iterSkipped, true)
      } catch (err) {
        if (err instanceof LoopBreakSignal) {
          context.popLocal()
          return 'break'
        }
        if (err instanceof LoopContinueSignal) {
          context.popLocal()
          return 'success'   // continue treats iteration as completed (skip rest)
        }
        // Real error
        const msg = err instanceof Error ? err.message : String(err)
        lastError = msg
        context.popLocal()
        return 'error'
      } finally {
        // already popped above on early return
      }

      // Snapshot outputs of body nodes for this iteration (debug)
      iterationOutputs.push({})
      context.popLocal()
      return 'success'
    }

    let breakRequested = false
    if (loopType === 'while') {
      // Raw condition (chưa interpolate) — evaluate fresh mỗi iteration với scope hiện tại
      const condition = String(node.config.condition ?? '')
      if (!condition) throw new Error('core.loop while: condition is required')
      let iter = 0
      while (iter < maxIterations) {
        // Expose `iteration` (= completed count) cho condition check.
        context.pushLocal({ iteration: iter })
        const cond = evaluateCondition(condition, context.getScope())
        context.popLocal()
        if (!cond) break
        iter++
        const outcome = await runIteration(undefined, iter, iter - 1)
        if (outcome === 'break') { breakRequested = true; break }
        if (outcome === 'error') {
          errorCount++
          if (onIterationError === 'fail') throw new Error(`core.loop iteration ${iter} failed: ${lastError}`)
          if (onIterationError === 'break') { breakRequested = true; break }
        } else successCount++
      }
    } else {
      for (let i = 0; i < items.length; i++) {
        if (this.cancelled) break
        const outcome = await runIteration(items[i], i + 1, i)
        if (outcome === 'break') { breakRequested = true; break }
        if (outcome === 'error') {
          errorCount++
          if (onIterationError === 'fail') throw new Error(`core.loop iteration ${i + 1} failed: ${lastError}`)
          if (onIterationError === 'break') { breakRequested = true; break }
        } else successCount++
      }
    }

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    const output = {
      successCount,
      errorCount,
      iterations: successCount + errorCount,
      completed: !breakRequested,
      results: iterationOutputs
    }

    // Record loop step
    const step: RunStep = {
      id: randomUUID(),
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      input: { loopType, onIterationError, itemsCount: items.length },
      output,
      attempt: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      ...(node.reportingLabel !== undefined ? { reportingLabel: node.reportingLabel } : {}),
      ...(node.reportingTags !== undefined ? { reportingTags: node.reportingTags } : {})
    }
    await this.opts.persistence.saveStep(step)

    this.emit({
      kind: 'step.end',
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      output,
      durationMs,
      ...(node.reportingLabel !== undefined ? { reportingLabel: node.reportingLabel } : {}),
      ...(node.reportingTags !== undefined ? { reportingTags: node.reportingTags } : {})
    })

    context.setNodeOutput(node.id, output)
  }

  /** Persist a step record cho break/continue (no real execution, just trace). */
  private async recordControlStep(node: WorkflowNode, context: ExecutionContext, runId: string, kind: 'break' | 'continue'): Promise<void> {
    void context
    const ts = new Date()
    const step: RunStep = {
      id: randomUUID(),
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      input: {},
      output: { signal: kind },
      attempt: 1,
      startedAt: ts.toISOString(),
      finishedAt: ts.toISOString(),
      durationMs: 0
    }
    await this.opts.persistence.saveStep(step)
    this.emit({
      kind: 'step.end',
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      output: { signal: kind },
      durationMs: 0
    })
  }

  // ========== node execution ==========

  private async executeNode(
    node: WorkflowNode,
    context: ExecutionContext,
    runId: string,
    request: RunRequest
  ): Promise<void> {
    const startedAt = new Date()

    // Resolve inputs từ inputMapping + config.
    // Special-case core.input → expose workflow input as output via input.
    const resolvedInput =
      node.manifestId === 'core.input'
        ? context.getInput()
        : this.resolveNodeInput(node, context)

    const nodeCtx: NodeContext = {
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      attempt: 1,
      input: resolvedInput,
      abortSignal: this.abortController.signal
    }

    this.emit({
      kind: 'step.start',
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      attempt: 1
    })

    // beforeNode middleware — có thể skip
    for (const mw of this.opts.middlewares ?? []) {
      const result = await mw.beforeNode?.(nodeCtx)
      if (result?.skip) {
        const stepSkipped: RunStep = {
          id: randomUUID(),
          runId,
          nodeId: node.id,
          manifestId: node.manifestId,
          status: 'skipped',
          input: resolvedInput,
          ...(result.output !== undefined ? { output: result.output } : {}),
          attempt: 1,
          startedAt: startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 0
        }
        await this.opts.persistence.saveStep(stepSkipped)
        if (result.output) context.setNodeOutput(node.id, result.output)
        this.emit({
          kind: 'step.end', runId, nodeId: node.id, manifestId: node.manifestId,
          status: 'skipped', durationMs: 0,
          ...(node.reportingLabel !== undefined ? { reportingLabel: node.reportingLabel } : {}),
          ...(node.reportingTags !== undefined ? { reportingTags: node.reportingTags } : {})
        })
        return
      }
    }

    // Execute via registry handler
    const handler = this.opts.registry.getHandler(node.manifestId)
    const logMessages: RunStepLogMessage[] = []

    let result: { success: boolean; output?: Record<string, unknown>; error?: string }

    if (!handler) {
      result = { success: false, error: `No handler registered for manifestId: ${node.manifestId}` }
    } else {
      const execCtx: ExecuteContext = {
        runId,
        nodeId: node.id,
        abortSignal: this.abortController.signal,
        log: (level, message) => {
          logMessages.push({ level, ts: new Date().toISOString(), message })
          this.emit({ kind: 'log', runId, nodeId: node.id, level, message })
        },
        ...(this.opts.controller !== undefined ? { controller: this.opts.controller } : {}),
        ...(this.opts.loadWorkflow !== undefined ? { loadWorkflow: this.opts.loadWorkflow } : {}),
        runSubWorkflow: async (workflowId, input, subOpts) => {
          if (!this.opts.loadWorkflow) throw new Error('loadWorkflow not provided')
          const subWf = await this.opts.loadWorkflow(workflowId, subOpts?.version)
          const subRunner = new WorkflowRunner(this.opts)
          const subResult = await subRunner.run(subWf, {
            workflowId,
            input,
            ...(subOpts?.version !== undefined ? { workflowVersion: subOpts.version } : {})
          })
          if (subResult.status !== 'completed') {
            throw new Error(subResult.error ?? `Sub-workflow ${workflowId} failed`)
          }
          return subResult.output ?? {}
        }
      }

      try {
        result = await handler.execute(resolvedInput, execCtx)
      } catch (err) {
        if (isLoopSignal(err)) throw err   // re-throw cho loop executor
        result = { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()

    const step: RunStep = {
      id: randomUUID(),
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: result.success ? 'success' : 'error',
      input: resolvedInput,
      ...(result.output !== undefined ? { output: result.output } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      attempt: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      ...(node.reportingLabel !== undefined ? { reportingLabel: node.reportingLabel } : {}),
      ...(node.reportingTags !== undefined ? { reportingTags: node.reportingTags } : {}),
      ...(logMessages.length > 0 ? { logMessages } : {})
    }
    await this.opts.persistence.saveStep(step)

    // afterNode middleware
    const nodeResult: NodeResult = {
      status: step.status === 'success' ? 'success' : step.status === 'skipped' ? 'skipped' : 'error',
      ...(result.output !== undefined ? { output: result.output } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      durationMs
    }
    for (const mw of this.opts.middlewares ?? []) {
      await mw.afterNode?.(nodeCtx, nodeResult)
    }

    this.emit({
      kind: 'step.end',
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: result.success ? 'success' : 'error',
      ...(result.output !== undefined ? { output: result.output } : {}),
      ...(result.error !== undefined ? { error: result.error } : {}),
      durationMs,
      ...(node.reportingLabel !== undefined ? { reportingLabel: node.reportingLabel } : {}),
      ...(node.reportingTags !== undefined ? { reportingTags: node.reportingTags } : {})
    })

    if (result.success) {
      context.setNodeOutput(node.id, result.output ?? {})
    } else {
      const policy = node.onError ?? 'fail'
      if (policy === 'continue') {
        context.setNodeOutput(node.id, { error: result.error })
        return
      }
      if (policy === 'goto') {
        throw new Error(`Node "${node.id}" failed: ${result.error}`)
      }
      throw new Error(`Node "${node.id}" failed: ${result.error}`)
    }
    void request
  }

  private async executeIfNode(
    node: WorkflowNode,
    context: ExecutionContext,
    runId: string
  ): Promise<boolean> {
    const startedAt = new Date()
    const condition = String(node.config.condition ?? '')
    const scope = context.getScope()
    const result = evaluateCondition(condition, scope)

    const step: RunStep = {
      id: randomUUID(),
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      input: { condition },
      output: { result, branch: result ? 'if-true' : 'if-false' },
      attempt: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: new Date().getTime() - startedAt.getTime()
    }
    await this.opts.persistence.saveStep(step)
    context.setNodeOutput(node.id, { result, branch: result ? 'if-true' : 'if-false' })
    this.emit({
      kind: 'step.end',
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      output: step.output,
      durationMs: step.durationMs ?? 0
    })
    return result
  }

  // ========== switch ==========

  private async executeSwitchNode(
    node: WorkflowNode,
    context: ExecutionContext,
    runId: string,
    graph: RunGraph,
    skipped: Set<string>
  ): Promise<void> {
    const startedAt = new Date()
    // Resolve expression — use raw config (KHÔNG pre-interpolated bởi resolveNodeInput
    // vì cần raw template) hoặc resolved config.
    // Use resolved config: simple cho user (config["expression"] đã interpolate).
    const resolved = this.resolveNodeInput(node, context)
    const value = resolved.expression
    const valueStr = value === null || value === undefined ? 'null' : String(value)

    // Cases: array of strings
    const casesRaw = resolved.cases
    const cases: string[] = Array.isArray(casesRaw)
      ? casesRaw.map(c => String(c))
      : []

    let matchedHandle: string
    let matched: boolean
    if (cases.includes(valueStr)) {
      matchedHandle = `switch-${valueStr}`
      matched = true
    } else {
      matchedHandle = 'switch-default'
      matched = false
    }

    // Mark losing handles' downstream as skipped
    for (const c of cases) {
      const h = `switch-${c}`
      if (h !== matchedHandle) {
        this.collectDownstream(node.id, h, graph.outgoing, graph.incoming, skipped)
      }
    }
    if (matchedHandle !== 'switch-default') {
      this.collectDownstream(node.id, 'switch-default', graph.outgoing, graph.incoming, skipped)
    }

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const output = { value, branch: matchedHandle, matched }

    const step: RunStep = {
      id: randomUUID(),
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      input: { expression: value, cases },
      output,
      attempt: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs
    }
    await this.opts.persistence.saveStep(step)
    context.setNodeOutput(node.id, output)
    this.emit({
      kind: 'step.end',
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      output,
      durationMs
    })
  }

  // ========== try / catch ==========

  /**
   * core.try wraps subgraph downstream của handle 'try-body'.
   * - Body success → emit handle 'try', mark 'catch' downstream as skipped.
   * - Body error → emit handle 'catch' với error info, mark 'try' downstream as skipped.
   * - LoopBreakSignal/ContinueSignal trong body bypass try (re-throw cho enclosing loop).
   */
  private async executeTryNode(
    node: WorkflowNode,
    graph: RunGraph,
    context: ExecutionContext,
    runId: string,
    request: RunRequest,
    parentSkipped: Set<string>
  ): Promise<void> {
    const startedAt = new Date()

    // Pre-scan body nodes
    const bodyIds = new Set<string>()
    this.collectDownstreamReachableOnly(node.id, 'try-body', graph.outgoing, bodyIds)
    const sortedBody = graph.sortedIds.filter(id => bodyIds.has(id))

    let success = true
    let errorInfo: { message: string; name: string; nodeId?: string } | null = null

    const bodySkipped = new Set<string>()
    try {
      await this.runNodeSubset(sortedBody, graph, context, runId, request, bodySkipped, true)
    } catch (err) {
      // Re-throw loop signals — try doesn't catch break/continue
      if (isLoopSignal(err)) throw err
      success = false
      const e = err instanceof Error ? err : new Error(String(err))
      errorInfo = { message: e.message, name: e.name }
      // Try to extract nodeId from message format 'Node "<id>" failed: ...'
      const m = e.message.match(/Node "([^"]+)" failed/)
      if (m && m[1]) errorInfo.nodeId = m[1]
    }

    // Mark losing branch as skipped (use parentSkipped — sẽ propagate downstream try node)
    const losingHandle = success ? 'catch' : 'try'
    this.collectDownstream(node.id, losingHandle, graph.outgoing, graph.incoming, parentSkipped)

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const output = {
      success,
      branch: success ? 'try' : 'catch',
      ...(errorInfo !== null ? { error: errorInfo } : {})
    }

    const step: RunStep = {
      id: randomUUID(),
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      input: { bodySize: sortedBody.length },
      output,
      attempt: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs
    }
    await this.opts.persistence.saveStep(step)
    context.setNodeOutput(node.id, output)
    this.emit({
      kind: 'step.end',
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      output,
      durationMs
    })
  }

  // ========== aggregate ==========

  private async executeAggregateNode(
    node: WorkflowNode,
    context: ExecutionContext,
    runId: string,
    graph: RunGraph
  ): Promise<void> {
    const startedAt = new Date()
    const incoming = graph.incoming.get(node.id) ?? []
    const items: unknown[] = incoming.map(e => context.getNodeOutput(e.source) ?? null)

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const output = { items, count: items.length }

    const step: RunStep = {
      id: randomUUID(),
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      input: { incomingCount: incoming.length },
      output,
      attempt: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs
    }
    await this.opts.persistence.saveStep(step)
    context.setNodeOutput(node.id, output)
    this.emit({
      kind: 'step.end',
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      output,
      durationMs
    })
  }

  // ========== filter ==========

  private async executeFilterNode(
    node: WorkflowNode,
    context: ExecutionContext,
    runId: string,
    graph: RunGraph,
    skipped: Set<string>
  ): Promise<void> {
    const startedAt = new Date()
    // Use raw condition để evaluate fresh với current scope (giống while loop)
    const condition = String(node.config.condition ?? '')
    const passed = condition !== '' && evaluateCondition(condition, context.getScope())

    if (!passed) {
      // Skip all downstream qua handle 'main' (default outgoing)
      this.collectDownstream(node.id, 'main', graph.outgoing, graph.incoming, skipped)
    }

    const finishedAt = new Date()
    const durationMs = finishedAt.getTime() - startedAt.getTime()
    const output = { passed }

    const step: RunStep = {
      id: randomUUID(),
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      input: { condition },
      output,
      attempt: 1,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs
    }
    await this.opts.persistence.saveStep(step)
    context.setNodeOutput(node.id, output)
    this.emit({
      kind: 'step.end',
      runId,
      nodeId: node.id,
      manifestId: node.manifestId,
      status: 'success',
      output,
      durationMs
    })
  }

  // ========== helpers ==========

  private resolveNodeInput(
    node: WorkflowNode,
    context: ExecutionContext
  ): Record<string, unknown> {
    const scope = context.getScope()
    const out: Record<string, unknown> = {}

    for (const [k, v] of Object.entries(node.config)) {
      out[k] = resolveValue(v, scope)
    }

    for (const [field, ref] of Object.entries(node.inputMapping)) {
      const sourceOutput = context.getNodeOutput(ref.sourceNodeId)
      if (!sourceOutput) {
        out[field] = undefined
        continue
      }
      let value: unknown = sourceOutput[ref.sourceField]
      if (ref.sourcePath && value && typeof value === 'object') {
        for (const part of ref.sourcePath.split('.')) {
          if (value == null || typeof value !== 'object') {
            value = undefined
            break
          }
          value = (value as Record<string, unknown>)[part]
        }
      }
      out[field] = value
    }

    return out
  }

  private allParentsSkipped(
    nodeId: string,
    incoming: Map<string, WorkflowEdge[]>,
    skipped: Set<string>
  ): boolean {
    const inc = incoming.get(nodeId)
    if (!inc || inc.length === 0) return false
    return inc.every(e => skipped.has(e.source))
  }

  /**
   * Walk subgraph (DFS) reachable từ `fromNodeId` qua handle (loop-body, switch-x...).
   * KHÔNG check incoming logic — chỉ collect tất cả node downstream qua handle này
   * và recursive xuôi theo bất kỳ handle nào của node con.
   *
   * Dùng cho:
   *   - Pre-scan loop body (loopBodyNodes set)
   *   - Pre-scan switch branches (Phase 3b-2)
   */
  private collectDownstreamReachableOnly(
    fromNodeId: string,
    handle: string,
    outgoing: Map<string, WorkflowEdge[]>,
    target: Set<string>
  ): void {
    const queue: string[] = []
    const start = outgoing.get(`${fromNodeId}::${handle}`) ?? []
    for (const e of start) queue.push(e.target)

    while (queue.length > 0) {
      const id = queue.shift()!
      if (target.has(id)) continue
      target.add(id)
      // Recurse downstream theo all handles của id
      for (const [key, edges] of outgoing.entries()) {
        if (!key.startsWith(`${id}::`)) continue
        for (const e of edges) {
          if (!target.has(e.target)) queue.push(e.target)
        }
      }
    }
  }

  /**
   * Conservative skip cascade: dùng cho ifElse losing branch — chỉ mark skipped
   * nếu mọi incoming của node đều thuộc subgraph đang bị skip.
   * Tránh skip nhầm node có path khác (vd join từ branch khác).
   */
  private collectDownstream(
    fromNodeId: string,
    handle: string,
    outgoing: Map<string, WorkflowEdge[]>,
    incoming: Map<string, WorkflowEdge[]>,
    target: Set<string>
  ): void {
    const queue: string[] = []
    const start = outgoing.get(`${fromNodeId}::${handle}`) ?? []
    for (const e of start) queue.push(e.target)

    while (queue.length > 0) {
      const id = queue.shift()!
      if (target.has(id)) continue
      const inc = incoming.get(id) ?? []
      const allFromSkipped = inc.every(e => target.has(e.source) || e.source === fromNodeId)
      if (!allFromSkipped) continue
      target.add(id)
      for (const [key, edges] of outgoing.entries()) {
        if (!key.startsWith(`${id}::`)) continue
        for (const e of edges) queue.push(e.target)
      }
    }
  }

  private emit(event: ProgressEvent): void {
    this.opts.onProgress?.(event)
    for (const mw of this.opts.middlewares ?? []) {
      void mw.onProgress?.(event)?.catch(() => {/* swallow middleware errors */})
    }
  }
}
