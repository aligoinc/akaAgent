import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'

/**
 * core.wait — pause workflow đến time T hoặc chờ event.
 *
 * Modes:
 *   - until: ISO timestamp (vd '2026-05-01T08:00:00+07:00') — sleep đến thời điểm đó
 *   - delayMs: relative milliseconds (giống core.delay nhưng có metadata)
 *   - forEvent: event name (PLACEHOLDER — Phase 3b-4 cần persist + resume)
 *
 * Phase 3b-3: in-process wait only (until + delayMs).
 * Phase 3b-4 (next): forEvent + persist `runs.status='paused'` + resume khi event đến.
 *
 * Honors abortSignal cho cancellation.
 */

export const waitManifest: CoreBlockManifest = {
  manifestId: 'core.wait',
  name: 'Wait',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'Hourglass', category: 'control', description: 'Pause workflow until a time or event' },
  inputSchema: [
    { name: 'until', type: 'string', label: 'Until ISO timestamp',
      placeholder: '2026-05-01T08:00:00+07:00' },
    { name: 'delayMs', type: 'number', label: 'Or delay (ms relative)' },
    { name: 'forEvent', type: 'string', label: 'Or wait for event name (Phase 3b-4)' },
    { name: 'maxWaitMs', type: 'number', label: 'Max wait cap', defaultValue: 86400000 }   // 24h
  ],
  outputSchema: [
    { name: 'waitedMs', type: 'number', label: 'Actual ms waited' },
    { name: 'reason', type: 'string', label: 'How wait ended (timeout|event|cancelled)' }
  ],
  implementationKey: 'core.wait'
}

export const waitHandler: CoreBlockHandler = {
  async execute(input: Record<string, unknown>, ctx: ExecuteContext) {
    const forEvent = input.forEvent
    if (typeof forEvent === 'string' && forEvent.length > 0) {
      return { success: false, error: 'core.wait forEvent mode not implemented yet (Phase 3b-4)' }
    }

    const maxWaitMs = Number(input.maxWaitMs ?? 86400000)
    let targetMs: number | null = null
    let mode: 'delay' | 'until' = 'delay'

    if (input.until !== undefined && input.until !== null && input.until !== '') {
      const t = new Date(String(input.until)).getTime()
      if (Number.isNaN(t)) return { success: false, error: `core.wait: invalid 'until' timestamp: ${String(input.until)}` }
      targetMs = t - Date.now()
      mode = 'until'
    } else if (input.delayMs !== undefined && input.delayMs !== null) {
      targetMs = Number(input.delayMs)
    } else {
      return { success: false, error: 'core.wait: must provide one of until / delayMs / forEvent' }
    }

    if (targetMs <= 0) {
      return { success: true, output: { waitedMs: 0, reason: mode === 'until' ? 'timeout' : 'timeout' } }
    }
    if (targetMs > maxWaitMs) {
      ctx.log('warn', `core.wait: ${targetMs}ms exceeds maxWaitMs ${maxWaitMs}ms — capping`)
      targetMs = maxWaitMs
    }

    const startedAt = Date.now()
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup()
          resolve()
        }, targetMs!)
        const onAbort = () => {
          cleanup()
          reject(new Error('core.wait cancelled by abortSignal'))
        }
        const cleanup = () => {
          clearTimeout(timer)
          ctx.abortSignal.removeEventListener('abort', onAbort)
        }
        if (ctx.abortSignal.aborted) {
          cleanup()
          reject(new Error('core.wait cancelled by abortSignal'))
          return
        }
        ctx.abortSignal.addEventListener('abort', onAbort)
      })
      return {
        success: true,
        output: { waitedMs: Date.now() - startedAt, reason: 'timeout' }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
