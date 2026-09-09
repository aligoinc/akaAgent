/** Error cleanup only. Normal claim/settle retries do not use this helper. */
export interface CampaignFailureCleanupPayload {
  campaignId: number
  accountId: number
  staffId: number
  runtimeTarget: 'desktop' | 'server'
  runtimeClaimToken: string
  runtimeUnitToken: string | null
  unstartedInputDataIds: readonly number[]
  note: string
  pauseUnknownOutcome: boolean
  campaignStatus: string | null
  accountStatus: string | null
}

export interface CampaignFailureCleanupResult {
  ok: boolean
  reason: string
}

export type CampaignFailureCleanupOutcome = 'cleaned' | 'not_owner' | 'recovery_required' | 'stopped'

export function isTemporaryCleanupError(error: unknown): boolean {
  const e = error as { code?: string; status?: number; message?: string; cause?: { code?: string } }
  const code = String(e?.code || e?.cause?.code || '')
  // Explicit permanent database/contract errors must win over message matching.
  if (/^(22|23|28|42|P0001)/.test(code) || ['PGRST202', 'PGRST301', 'PGRST302'].includes(code)) return false
  if (/^(08|53|57|58)/.test(code) || ['40001', '40P01', '55P03', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].includes(code)) return true
  if ([408, 429, 502, 503, 504].includes(Number(e?.status))) return true
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|fetch failed|failed to fetch|network|socket hang up|statement timeout|connection.*(?:closed|terminated)|schema cache.*retrying/i.test(`${code} ${e?.message || ''}`)
}

function waitForRetry(signal: AbortSignal): Promise<void> {
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
export class CampaignFailureCleanup {
  private completion?: Promise<CampaignFailureCleanupOutcome>
  readonly controller = new AbortController()

  run(
    request: () => Promise<CampaignFailureCleanupResult>,
    report: (event: 'waiting' | 'recovered' | 'recovery_required', error?: unknown) => void
  ): Promise<CampaignFailureCleanupOutcome> {
    return this.completion ??= this.retry(request, report)
  }

  private async retry(
    request: () => Promise<CampaignFailureCleanupResult>,
    report: (event: 'waiting' | 'recovered' | 'recovery_required', error?: unknown) => void
  ): Promise<CampaignFailureCleanupOutcome> {
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
        if (!isTemporaryCleanupError(error)) {
          notify('recovery_required', error)
          return 'recovery_required'
        }
        if (!waiting) {
          waiting = true
          notify('waiting', error)
        }
        await waitForRetry(this.controller.signal)
      }
    }
    return 'stopped'
  }
}
