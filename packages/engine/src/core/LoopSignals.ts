/**
 * LoopSignals — special exceptions thrown bởi core.break / core.continue handlers.
 * Loop executor catch và xử lý đặc biệt thay vì coi là lỗi workflow.
 */

export class LoopBreakSignal extends Error {
  readonly signalKind = 'break' as const
  constructor() {
    super('LoopBreakSignal — should be caught by enclosing loop executor')
    this.name = 'LoopBreakSignal'
  }
}

export class LoopContinueSignal extends Error {
  readonly signalKind = 'continue' as const
  constructor() {
    super('LoopContinueSignal — should be caught by enclosing loop executor')
    this.name = 'LoopContinueSignal'
  }
}

export function isLoopSignal(err: unknown): err is LoopBreakSignal | LoopContinueSignal {
  return err instanceof LoopBreakSignal || err instanceof LoopContinueSignal
}
