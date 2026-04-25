import type { Workflow } from '../types/Workflow.js'
import type { RunRequest, RunResult, ProgressEvent } from '../types/Run.js'
import type { IChannelProvider } from '../controllers/IChannelProvider.js'
import { BlockRegistry } from './BlockRegistry.js'
import { WorkflowRunner } from './WorkflowRunner.js'
import type { ExecutionMiddleware } from './ExecutionMiddleware.js'
import type { IRunPersistence } from './IRunPersistence.js'
import type { IConnectionVault } from './IConnectionVault.js'

/**
 * WorkflowEngine — public API class.
 *
 * App layer instance 1 lần khi boot, gọi enqueue() cho mỗi RunRequest.
 *
 * Phase 2: synchronous execute (1 run cùng lúc, không queue thật).
 * Phase 6+: tích hợp với RunOrchestrator (queue + per-channel concurrency).
 */
export interface WorkflowEngineOptions {
  registry: BlockRegistry
  workflowLoader: (id: string, version?: number) => Promise<Workflow>
  channelProvider?: IChannelProvider
  vault: IConnectionVault
  persistence: IRunPersistence
  middlewares?: ExecutionMiddleware[]
}

export class WorkflowEngine {
  private listeners = new Set<(event: ProgressEvent) => void>()
  private activeRunners = new Map<string, WorkflowRunner>()

  constructor(private opts: WorkflowEngineOptions) {}

  on(_event: 'progress', cb: (event: ProgressEvent) => void): void {
    this.listeners.add(cb)
  }

  off(_event: 'progress', cb: (event: ProgressEvent) => void): void {
    this.listeners.delete(cb)
  }

  /**
   * Enqueue 1 run. Phase 2: execute ngay, return RunResult.
   * Phase 6+: push vào RunOrchestrator queue, return { runId } sớm, run async.
   */
  async enqueue(request: RunRequest): Promise<RunResult> {
    const workflow = await this.opts.workflowLoader(request.workflowId, request.workflowVersion)

    // Acquire channel nếu workflow cần browser
    const requiresBrowser = workflow.graph.nodes.some(n => {
      const m = this.opts.registry.get(n.manifestId)
      return m?.requires === 'browser'
    })

    let channelHandle: Awaited<ReturnType<IChannelProvider['acquire']>> | undefined
    let controller = undefined
    if (requiresBrowser) {
      if (!request.channelId) throw new Error('Workflow requires browser channel but no channelId provided')
      if (!this.opts.channelProvider) throw new Error('No channelProvider configured but workflow requires browser')
      channelHandle = await this.opts.channelProvider.acquire(request.channelId)
      controller = channelHandle.controller
    }

    const runner = new WorkflowRunner({
      registry: this.opts.registry,
      ...(controller !== undefined ? { controller } : {}),
      persistence: this.opts.persistence,
      vault: this.opts.vault,
      ...(this.opts.middlewares !== undefined ? { middlewares: this.opts.middlewares } : {}),
      onProgress: (event) => this.emit(event),
      loadWorkflow: this.opts.workflowLoader
    })

    const tempId = `pending-${Date.now()}`
    this.activeRunners.set(tempId, runner)
    try {
      const result = await runner.run(workflow, request)
      return result
    } finally {
      this.activeRunners.delete(tempId)
      if (channelHandle) await channelHandle.release()
    }
  }

  cancel(runId: string): void {
    for (const runner of this.activeRunners.values()) {
      runner.cancel()
    }
    void runId   // Phase 6+: cancel theo runId cụ thể (cần map runId → runner)
  }

  private emit(event: ProgressEvent): void {
    for (const cb of this.listeners) {
      try { cb(event) } catch (err) { console.error('[WorkflowEngine] listener error:', err) }
    }
  }
}
