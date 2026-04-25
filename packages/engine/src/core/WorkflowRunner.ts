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

/**
 * WorkflowRunner — execute 1 workflow lần.
 *
 * Phase 2 implementation: sequential topological execution + ifElse branching.
 * Future (Phase X): full ActivationQueue với parallel + race + n-of-m + side track.
 *
 * Reserved fields trên WorkflowNode (track/joinPolicy/joinCount/compensate) — Phase 2 IGNORE
 * (parse + lưu nhưng không xử lý). Future enable không cần migrate data.
 */

export interface WorkflowRunnerOptions {
  registry: BlockRegistry
  controller?: IBrowserController                                // optional: chỉ workflow có browser block mới cần
  persistence: IRunPersistence
  vault: IConnectionVault
  middlewares?: ExecutionMiddleware[]
  onProgress?: (event: ProgressEvent) => void
  loadWorkflow?: (id: string, version?: number) => Promise<Workflow>   // cho subflow recursive
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

    // Resolve secrets — Phase 2 collect connection IDs từ workflow node config (TODO: scan deeper)
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
      // Validate graph (no cycle) — Phase 2 chấp nhận chỉ DAG
      const sorted = topologicalSort(workflow.graph.nodes, workflow.graph.edges)
      const nodeMap = buildNodeMap(workflow.graph.nodes)
      const outgoing = buildOutgoingEdgeMap(workflow.graph.edges)
      const incoming = buildIncomingEdgeMap(workflow.graph.edges)

      // Track which nodes are skipped (do filter, ifElse skip nhánh, ...)
      const skipped = new Set<string>()
      // Track loop body node ids (skip trong main pass — loop primitive tự execute)
      const loopBodyNodes = new Set<string>()

      // Phase 2: pre-scan loop bodies (sub-graph downstream của loop trên handle 'loop-body')
      for (const node of workflow.graph.nodes) {
        if (node.manifestId === 'core.loop') {
          this.collectDownstream(node.id, 'loop-body', outgoing, incoming, loopBodyNodes)
        }
      }

      for (const node of sorted) {
        if (this.cancelled) {
          finalStatus = 'cancelled'
          break
        }
        if (skipped.has(node.id) || loopBodyNodes.has(node.id)) continue

        // Check parent skipped (no incoming edge active) — Phase 2 simple: nếu mọi incoming đều từ skipped node → skip
        if (this.allParentsSkipped(node.id, incoming, skipped)) {
          skipped.add(node.id)
          continue
        }

        // Special: ifElse — execute condition, mark losing branch downstream as skipped
        if (node.manifestId === 'core.if') {
          const branchTaken = await this.executeIfNode(node, context, runId, outgoing, incoming, skipped)
          // Mark losing handle subgraph as skipped
          const losingHandle = branchTaken ? 'if-false' : 'if-true'
          this.collectDownstream(node.id, losingHandle, outgoing, incoming, skipped)
          continue
        }

        // Normal node execute
        await this.executeNode(node, context, runId, request)
      }
    } catch (err) {
      finalStatus = 'failed'
      finalError = err instanceof Error ? err.message : String(err)
    }

    // Resolve final workflow output từ core.output node (nếu có)
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
      // Apply onError policy
      const policy = node.onError ?? 'fail'
      if (policy === 'continue') {
        // Treat as success with empty output
        context.setNodeOutput(node.id, { error: result.error })
        return
      }
      if (policy === 'goto') {
        // Phase 2 simple: just throw (downstream skipped via try/catch). Future: jump to onErrorTarget.
        throw new Error(`Node "${node.id}" failed: ${result.error}`)
      }
      // 'fail' (default)
      throw new Error(`Node "${node.id}" failed: ${result.error}`)
    }
    void request // reserved for future
  }

  private async executeIfNode(
    node: WorkflowNode,
    context: ExecutionContext,
    runId: string,
    _outgoing: Map<string, WorkflowEdge[]>,
    _incoming: Map<string, WorkflowEdge[]>,
    _skipped: Set<string>
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

  // ========== helpers ==========

  private resolveNodeInput(
    node: WorkflowNode,
    context: ExecutionContext
  ): Record<string, unknown> {
    const scope = context.getScope()
    const out: Record<string, unknown> = {}

    // 1. Apply config (with interpolation)
    for (const [k, v] of Object.entries(node.config)) {
      out[k] = resolveValue(v, scope)
    }

    // 2. inputMapping overrides config
    for (const [field, ref] of Object.entries(node.inputMapping)) {
      const sourceOutput = context.getNodeOutput(ref.sourceNodeId)
      if (!sourceOutput) {
        out[field] = undefined
        continue
      }
      let value: unknown = sourceOutput[ref.sourceField]
      if (ref.sourcePath && value && typeof value === 'object') {
        // Walk path
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
    if (!inc || inc.length === 0) return false      // entry node, never "skipped by parents"
    return inc.every(e => skipped.has(e.source))
  }

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
      // Chỉ mark skipped nếu mọi incoming đều đến từ subgraph (tránh skip nhầm node có path khác)
      const inc = incoming.get(id) ?? []
      const allFromSkipped = inc.every(e => target.has(e.source) || e.source === fromNodeId)
      if (!allFromSkipped) continue
      target.add(id)
      // Recurse downstream theo all handles
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
