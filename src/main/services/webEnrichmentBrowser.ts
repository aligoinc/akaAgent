import { performance } from 'node:perf_hooks'
import type { PageController } from '../v2/runtime/pageController'

export interface WebEnrichmentPage {
  page: PageController; destroy: () => void
  navigationFailed?: () => boolean
  onClosed?: (listener: () => void) => () => void
}
/** Destroy the disposable page before releasing callers, including a hung native navigation. */
export async function runWebEnrichmentBrowser(options: {
  signal: AbortSignal
  budgetMs: number
  createPage: () => WebEnrichmentPage
  run: (page: PageController, signal: AbortSignal) => Promise<void>
  operationTimeoutMs?: number
}): Promise<void> {
  const controller = new AbortController()
  const end = performance.now() + options.budgetMs
  let entry: WebEnrichmentPage | undefined
  let closed = false
  let unsubscribe: (() => void) | undefined
  const close = () => { if (!closed) { closed = true; try { entry?.destroy() } catch {} } }
  const cancel = () => { close(); controller.abort() }
  options.signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, Math.max(0, options.budgetMs))
  let rejectAbort: (() => void) | undefined
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Error('Đã kết thúc phiên lướt web.'))
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
  })
  try {
    if (options.signal.aborted || options.budgetMs <= 0) { cancel(); await cancelled }
    entry = options.createPage()
    unsubscribe = entry.onClosed?.(cancel)
    const page = new Proxy(entry.page, {
      get(target, key) {
        if (!['navigate', 'evaluate', 'scroll'].includes(String(key))) return undefined
        return async (...args: unknown[]) => {
          controller.signal.throwIfAborted()
          const remaining = end - performance.now()
          if (remaining <= 0) { cancel(); return await cancelled }
          let opTimer: ReturnType<typeof setTimeout> | undefined
          try {
            const timeout = new Promise<never>((_, reject) => {
              opTimer = setTimeout(() => { cancel(); reject(new Error('Thao tác web quá thời gian.')) },
                Math.min(options.operationTimeoutMs ?? 30_000, remaining))
            })
            const fn = Reflect.get(target, key) as (...values: unknown[]) => Promise<unknown>
            const result = await Promise.race([Promise.resolve().then(() => {
              controller.signal.throwIfAborted()
              return fn.apply(target, args)
            }), timeout, cancelled])
            controller.signal.throwIfAborted()
            if (key === 'navigate' && entry?.navigationFailed?.()) throw new Error('Website trả về lỗi HTTP.')
            return result
          } finally { clearTimeout(opTimer) }
        }
      }
    })
    await Promise.race([options.run(page, controller.signal), cancelled])
  } finally {
    cancel()
    clearTimeout(timer)
    unsubscribe?.()
    options.signal.removeEventListener('abort', cancel)
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort)
    // Promise.race has rejection handlers for late work; its page facade remains fenced forever.
    void cancelled.catch(() => {})
  }
}
