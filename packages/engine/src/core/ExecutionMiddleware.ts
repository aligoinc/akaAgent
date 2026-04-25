import type { ProgressEvent } from '../types/Run.js'

/**
 * Reserved cho extensibility — Phase 2 implement signature, không add middleware nào.
 *
 * Sau này thêm RateLimit, CircuitBreaker, Idempotency, Tracing... đều plug vào đây.
 * Cost ~80 dòng code Phase 2, mở khoá hầu hết pattern nâng cao mà không refactor engine.
 */

export interface NodeContext {
  runId: string
  nodeId: string
  manifestId: string
  attempt: number
  input: Record<string, unknown>
  abortSignal: AbortSignal
}

export interface NodeResult {
  status: 'success' | 'error' | 'skipped'
  output?: Record<string, unknown>
  error?: string
  durationMs: number
}

export interface ExecutionMiddleware {
  name: string
  beforeNode?(ctx: NodeContext): Promise<void | { skip?: true; output?: Record<string, unknown> }>
  afterNode?(ctx: NodeContext, result: NodeResult): Promise<void>
  onError?(ctx: NodeContext, error: Error): Promise<void | { swallow?: true }>
  onProgress?(event: ProgressEvent): Promise<void>
}
