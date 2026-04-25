import type { Workflow } from '../types/Workflow.js'
import type { InterpolationScope } from './interpolate.js'

/**
 * ExecutionContext — manage variable scope cho 1 run.
 *
 * 3 layer scope (lưu vào 1 object cho interpolate):
 *   - input.X       — workflow input (immutable trong run)
 *   - <nodeId>.Y    — output từ node đã chạy
 *   - secret.X      — từ ConnectionVault (mask trong log)
 *   - run.X         — metadata run (id, startedAt)
 *   - block-local   — loop iteration { item, index, iteration } (push/pop scope)
 *
 * Engine call setNodeOutput(nodeId, output) sau mỗi node thành công,
 * resolveInputs(node) trước khi execute node tiếp theo.
 */

export interface RunMetadata {
  id: string
  workflowId: string
  workflowVersion: number
  startedAt: string
}

export class ExecutionContext {
  private nodeOutputs = new Map<string, Record<string, unknown>>()
  private localScopeStack: Array<Record<string, unknown>> = []

  constructor(
    private workflow: Workflow,
    private input: Record<string, unknown>,
    private secrets: Record<string, string>,
    private runMeta: RunMetadata
  ) {}

  setNodeOutput(nodeId: string, output: Record<string, unknown>): void {
    this.nodeOutputs.set(nodeId, output)
  }

  getNodeOutput(nodeId: string): Record<string, unknown> | undefined {
    return this.nodeOutputs.get(nodeId)
  }

  pushLocal(local: Record<string, unknown>): void {
    this.localScopeStack.push(local)
  }

  popLocal(): void {
    this.localScopeStack.pop()
  }

  /** Toàn bộ scope cho interpolate: { ...nodeOutputs, input, secret, run, ...local } */
  getScope(): InterpolationScope {
    const scope: InterpolationScope = {}
    for (const [id, out] of this.nodeOutputs.entries()) {
      scope[id] = out
    }
    scope.input = this.input
    scope.secret = this.secrets
    scope.run = this.runMeta
    // Local scope (loop iteration) overlay sau cùng — outermost loop dưới, innermost trên
    for (const local of this.localScopeStack) {
      Object.assign(scope, local)
    }
    return scope
  }

  getInput(): Record<string, unknown> {
    return this.input
  }

  getRunMeta(): RunMetadata {
    return this.runMeta
  }

  /** Snapshot tất cả node outputs cho persistence/debug. */
  snapshotOutputs(): Record<string, Record<string, unknown>> {
    return Object.fromEntries(this.nodeOutputs)
  }
}
