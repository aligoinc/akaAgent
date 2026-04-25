import type { BlockManifest } from '../types/BlockManifest.js'

/**
 * BlockRegistry — register / lookup BlockManifest theo manifestId.
 *
 * Engine boot:
 *   1. Đăng ký core primitives (engine cung cấp)
 *   2. Đăng ký adapter blocks (slack, gmail, ... — service API)
 *   3. Load user blocks + composite blocks từ DB
 *
 * Composite blocks cần workflowLoader để execute (engine giải quyết sau qua subflow primitive).
 */

export interface CoreBlockHandler {
  /**
   * Engine gọi handler này khi gặp node có manifestId tương ứng.
   * Return ActionResult-like object hoặc throw error.
   */
  execute(input: Record<string, unknown>, ctx: ExecuteContext): Promise<{
    success: boolean
    output?: Record<string, unknown>
    error?: string
  }>
}

/** Forward-declare để tránh circular import. WorkflowRunner sẽ inject context. */
export interface ExecuteContext {
  runId: string
  nodeId: string
  abortSignal: AbortSignal
  log(level: 'info' | 'warn' | 'error', message: string): void
  /** Browser controller — chỉ available nếu workflow có channel. */
  controller?: import('../controllers/IBrowserController.js').IBrowserController
  /** Workflow loader — composite/subflow dùng. */
  loadWorkflow?: (id: string, version?: number) => Promise<import('../types/Workflow.js').Workflow>
  /** Recursive run sub-workflow — provided by runner. */
  runSubWorkflow?: (workflowId: string, input: Record<string, unknown>, opts?: { version?: number }) => Promise<Record<string, unknown>>
}

export class BlockRegistry {
  private manifests = new Map<string, BlockManifest>()
  private handlers = new Map<string, CoreBlockHandler>()

  register(manifest: BlockManifest, handler?: CoreBlockHandler): void {
    if (this.manifests.has(manifest.manifestId)) {
      throw new Error(`Block already registered: ${manifest.manifestId}`)
    }
    this.manifests.set(manifest.manifestId, manifest)
    if (handler) this.handlers.set(manifest.manifestId, handler)
  }

  /** Override existing manifest (vd update lại từ DB). */
  upsert(manifest: BlockManifest, handler?: CoreBlockHandler): void {
    this.manifests.set(manifest.manifestId, manifest)
    if (handler) this.handlers.set(manifest.manifestId, handler)
  }

  get(manifestId: string): BlockManifest | undefined {
    return this.manifests.get(manifestId)
  }

  getHandler(manifestId: string): CoreBlockHandler | undefined {
    return this.handlers.get(manifestId)
  }

  has(manifestId: string): boolean {
    return this.manifests.has(manifestId)
  }

  list(): BlockManifest[] {
    return Array.from(this.manifests.values())
  }

  listByKind(kind: BlockManifest['kind']): BlockManifest[] {
    return this.list().filter(m => m.kind === kind)
  }

  size(): number {
    return this.manifests.size
  }
}
