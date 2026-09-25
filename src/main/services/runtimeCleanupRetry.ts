export interface RuntimeCleanupResult { ok: boolean; reason: string }
export type RuntimeCleanupOutcome = 'cleaned' | 'not_owner' | 'recovery_required' | 'stopped'

export function isTemporaryCleanupError(error: unknown): boolean {
  const e = error as { code?: string; status?: number; message?: string; cause?: { code?: string } }
  const code = String(e?.code || e?.cause?.code || '')
  // Explicit permanent database/contract errors must win over message matching.
  if (/^(22|23|28|42|P0001)/.test(code) || ['PGRST202', 'PGRST301', 'PGRST302'].includes(code)) return false
  if (/^(08|53|57|58)/.test(code) || ['40001', '40P01', '55P03', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].includes(code)) return true
  if ([408, 429, 502, 503, 504].includes(Number(e?.status))) return true
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|fetch failed|failed to fetch|network|socket hang up|statement timeout|connection.*(?:closed|terminated)|schema cache.*retrying/i.test(`${code} ${e?.message || ''}`)
}

export function waitForRetry(signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) return resolve()
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, 2_000)
    signal.addEventListener('abort', finish, { once: true })
  })
}

/** Caches terminal outcomes too: another caller cannot restart this cleanup. */
export class RuntimeCleanupRetry {
  private completion?: Promise<RuntimeCleanupOutcome>
  readonly controller = new AbortController()

  run(
    request: () => Promise<RuntimeCleanupResult>,
    report: (event: 'waiting' | 'recovered' | 'recovery_required', error?: unknown) => void,
    retrySignal?: AbortSignal
  ): Promise<RuntimeCleanupOutcome> {
    return this.completion ??= this.retry(request, report, retrySignal)
  }

  private async retry(
    request: () => Promise<RuntimeCleanupResult>,
    report: (event: 'waiting' | 'recovered' | 'recovery_required', error?: unknown) => void,
    retrySignal?: AbortSignal
  ): Promise<RuntimeCleanupOutcome> {
    const waitSignal = retrySignal ? AbortSignal.any([this.controller.signal, retrySignal]) : this.controller.signal
    let waiting = false
    const notify = (event: Parameters<typeof report>[0], error?: unknown): void => {
      try { report(event, error) } catch { /* Logging must never own cleanup. */ }
    }
    while (!this.controller.signal.aborted) {
      try {
        const result = await request()
        if (result.ok && ['cleaned', 'already_cleaned'].includes(result.reason)) {
          if (waiting) notify('recovered')
          return 'cleaned'
        }
        if (result.reason === 'not_owner') return 'not_owner'
        notify('recovery_required', result.reason)
        return 'recovery_required'
      } catch (error) {
        if (this.controller.signal.aborted) return 'stopped'
        if (retrySignal?.aborted || !isTemporaryCleanupError(error)) {
          notify('recovery_required', error)
          return 'recovery_required'
        }
        if (!waiting) {
          waiting = true
          notify('waiting', error)
        }
        await waitForRetry(waitSignal)
        // An operation deadline stops retries, not the first token-scoped cleanup.
        // Keep the uncertain ownership hold; never clear it just because time ran out.
        if (retrySignal?.aborted) {
          notify('recovery_required')
          return 'recovery_required'
        }
      }
    }
    return 'stopped'
  }
}
