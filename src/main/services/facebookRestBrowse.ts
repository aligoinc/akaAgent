import { facebookRestBrowseSegments, validateFacebookRestBrowse, type FacebookRestBrowseSettings } from '../../shared/facebookRestBrowse'
import type { WorkflowDef } from '../../shared/v2Types'
import type { PageController } from '../v2/runtime/pageController'

interface RestBrowseOptions {
  settings: FacebookRestBrowseSettings
  targetUrl: string | null
  signal: AbortSignal
  isCancelled: () => boolean
  /** Read-only lifecycle guard, at the same 5s cadence as the main target guard. */
  checkControl: () => Promise<{ allowed: boolean; remainingMs: number }>
  loadWorkflow: () => Promise<WorkflowDef | null>
  createPage: () => { page: PageController; destroy: () => void }
  runWorkflow: (workflow: WorkflowDef, variables: Record<string, unknown>, page: PageController, signal: AbortSignal, onStarted: () => void) => Promise<{ status: string }>
  log: (message: string) => void
  preview: (page: PageController | null) => void
}

/** A bounded child of an already-owned campaign run. Never persists business results. */
export async function runFacebookRestBrowse(options: RestBrowseOptions): Promise<'completed' | 'skipped' | 'cancelled'> {
  const { settings } = options
  if (!settings.enabled || validateFacebookRestBrowse(settings)) return 'skipped'
  const segments = facebookRestBrowseSegments(settings, options.targetUrl)
  if (!segments.length || options.signal.aborted || options.isCancelled()) return 'skipped'

  const controller = new AbortController()
  const startedAt = performance.now()
  const browseMs = segments.reduce((sum, segment) => sum + segment.durationMs, 0)
  let deadline = startedAt + browseMs + settings.restSeconds * 1000
  let active = true
  let pageEntry: ReturnType<RestBrowseOptions['createPage']> | undefined
  let cancelled = false
  let preparationTimer: ReturnType<typeof setTimeout> | undefined
  const log = (message: string) => { if (active) { try { options.log(message) } catch {} } }
  const closePage = () => { try { pageEntry?.destroy() } catch {} }
  const abort = () => { controller.abort(); closePage() }
  const cancel = () => { cancelled = true; abort() }
  const remaining = () => Math.max(0, deadline - performance.now())
  options.signal.addEventListener('abort', cancel, { once: true })

  // Promise.race alone cannot cancel Chromium work. Every timeout/abort also
  // destroys this disposable page, and the facade rejects all late calls.
  async function bounded<T>(operation: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
    if (!active || controller.signal.aborted || options.isCancelled() || remaining() <= 0) throw new Error('Đã kết thúc phần lướt Facebook')
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: () => void = () => {}
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (!active || controller.signal.aborted) throw new Error('Đã kết thúc phần lướt Facebook')
          return operation()
        }),
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new Error('Đã kết thúc phần lướt Facebook'))
          controller.signal.addEventListener('abort', onAbort, { once: true })
          timer = setTimeout(() => { abort(); reject(new Error('Hết thời gian thao tác phụ')) }, Math.min(timeoutMs, remaining()))
        })
      ])
    } finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', onAbort)
    }
  }

  let controlInFlight = false
  let nextControlAt = 0
  const checkControl = async () => {
    controlInFlight = true
    try {
      const result = await bounded(options.checkControl)
      if (!active || controller.signal.aborted) return
      if (!result.allowed || !Number.isFinite(result.remainingMs) || result.remainingMs <= 0) { cancel(); return }
      deadline = Math.min(deadline, performance.now() + result.remainingMs)
      nextControlAt = performance.now() + 5000
    } finally { controlInFlight = false }
  }
  const guard = setInterval(() => {
    if (!active || controller.signal.aborted) return
    if (options.signal.aborted || options.isCancelled()) { cancel(); return }
    if (remaining() <= 0) { abort(); return }
    if (!controlInFlight && performance.now() >= nextControlAt) {
      void checkControl().catch(() => abort())
    }
  }, 250)

  try {
    await checkControl()
    const workflow = await bounded(options.loadWorkflow)
    if (!workflow) { log('ℹ️ Bỏ qua phần lướt Facebook vì chưa tải được cấu hình.'); return 'skipped' }
    if (controller.signal.aborted || options.isCancelled()) return 'cancelled'
    pageEntry = options.createPage()
    options.preview(pageEntry.page)
    const rawPage = pageEntry.page
    const page = new Proxy(rawPage, {
      get(_target, property) {
        if (property === 'navigate' || property === 'evaluate' || property === 'scroll') {
          return (...args: unknown[]) => bounded(() => (rawPage[property] as (...values: unknown[]) => Promise<unknown>).apply(rawPage, args))
        }
        throw new Error('Thao tác không được hỗ trợ trong phần lướt Facebook')
      }
    })
    log('⏳ Đã đạt giới hạn giờ, bắt đầu phần nghỉ và lướt Facebook.')
    // Preparation is included in the browse budget. Blocks use these deadlines
    // only for pacing; the host's monotonic deadline is authoritative.
    let segmentEnd = startedAt
    const timedSegments = segments.map(segment => {
      segmentEnd += segment.durationMs
      return { ...segment, until: Date.now() + Math.max(0, segmentEnd - performance.now()) }
    })
    preparationTimer = setTimeout(abort, Math.min(10_000, remaining()))
    const result = await bounded(() => options.runWorkflow(workflow, {
      restBrowseSegments: timedSegments,
      restBrowseSeconds: settings.restSeconds,
      restBrowseUntil: Date.now() + remaining()
    }, page, controller.signal, () => clearTimeout(preparationTimer)), remaining())
    if (result.status === 'error' || result.status === 'failed') {
      log('ℹ️ Bỏ qua thao tác lướt Facebook không thực hiện được.')
      return 'skipped'
    }
    return cancelled ? 'cancelled' : 'completed'
  } catch {
    if (!cancelled) log('ℹ️ Phần lướt Facebook đã kết thúc; chiến dịch tiếp tục chờ theo giới hạn giờ.')
    return cancelled ? 'cancelled' : 'skipped'
  } finally {
    active = false
    clearInterval(guard)
    clearTimeout(preparationTimer)
    options.signal.removeEventListener('abort', cancel)
    abort()
    try { options.preview(null) } catch {}
  }
}
