import type { CoreBlockManifest } from '../../types/BlockManifest.js'
import type { CoreBlockHandler, ExecuteContext } from '../../core/BlockRegistry.js'

/**
 * core.delay — sleep N ms. Honors abortSignal cho cancellation.
 */

export const delayManifest: CoreBlockManifest = {
  manifestId: 'core.delay',
  name: 'Delay',
  version: '1.0.0',
  kind: 'core',
  runtime: 'control',
  requires: 'none',
  ui: { icon: 'Clock', category: 'control', description: 'Sleep for N milliseconds' },
  inputSchema: [
    { name: 'ms', type: 'number', label: 'Milliseconds', required: true, defaultValue: 1000 }
  ],
  outputSchema: [
    { name: 'waitedMs', type: 'number', label: 'Waited milliseconds' }
  ],
  implementationKey: 'core.delay'
}

export const delayHandler: CoreBlockHandler = {
  async execute(input: Record<string, unknown>, ctx: ExecuteContext) {
    const ms = Math.max(0, Number(input.ms ?? 0))
    if (ms === 0) return { success: true, output: { waitedMs: 0 } }

    const startedAt = Date.now()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        resolve()
      }, ms)
      const onAbort = () => {
        cleanup()
        reject(new Error('Delay cancelled by abortSignal'))
      }
      const cleanup = () => {
        clearTimeout(timer)
        ctx.abortSignal.removeEventListener('abort', onAbort)
      }
      if (ctx.abortSignal.aborted) {
        cleanup()
        reject(new Error('Delay cancelled by abortSignal'))
        return
      }
      ctx.abortSignal.addEventListener('abort', onAbort)
    })
    return { success: true, output: { waitedMs: Date.now() - startedAt } }
  }
}
