import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { accountOperationRegistry } from '../../main/services/accountOperationRegistry'
import type { CampaignScheduler } from '../../main/services/campaignScheduler'
import type { SupabaseService } from '../../main/services/supabase'
import type { ZaloRuntimeService } from '../../main/services/zaloRuntimeService'
import type { PendingZaloServerSession } from '../../main/data/repositories/accountRepository'

const RETRY_MIN_MS = 60_000
const RETRY_MAX_MS = 15 * 60_000

interface SessionRetry {
  sessionUpdatedAt: string | null
  failures: number
  retryAt: number
}

interface SessionRestorerOptions {
  supabase: SupabaseService
  zaloRuntime: ZaloRuntimeService
  scheduler: CampaignScheduler
  isRunning(): boolean
  onStatusUpdated(): void
  now?: () => number
}

/** Picks up imported sessions without requiring a command or restarting a staff runtime. */
export class ZaloServerSessionRestorer {
  private pending: Promise<void> | null = null
  private readonly retries = new Map<number, SessionRetry>()
  private readonly now: () => number

  constructor(private readonly options: SessionRestorerOptions) {
    // Retry pacing is monotonic, independent of the business/scheduling clock.
    this.now = options.now || (() => performance.now())
  }

  run(): Promise<void> {
    if (this.pending) return this.pending
    const operation = this.restorePending().finally(() => {
      if (this.pending === operation) this.pending = null
    })
    this.pending = operation
    return operation
  }

  private async restorePending(): Promise<void> {
    if (!this.options.isRunning()) return
    const candidates = await this.options.supabase.listPendingZaloServerSessions()
    const candidateIds = new Set(candidates.map(item => item.accountId))
    for (const accountId of this.retries.keys()) {
      if (!candidateIds.has(accountId)) this.retries.delete(accountId)
    }
    for (const candidate of candidates) {
      if (!this.options.isRunning()) return
      const previous = this.retries.get(candidate.accountId)
      if (previous?.sessionUpdatedAt === candidate.sessionUpdatedAt && previous.retryAt > this.now()) continue
      if (previous?.sessionUpdatedAt !== candidate.sessionUpdatedAt) this.retries.delete(candidate.accountId)
      await this.restoreOne(candidate)
    }
  }

  private async restoreOne(candidate: PendingZaloServerSession): Promise<void> {
    const { supabase, scheduler, zaloRuntime } = this.options
    const { accountId } = candidate
    const reservationToken = randomUUID()
    if (!scheduler.tryReserveExternalAccount(accountId, reservationToken)) return
    let claim: Awaited<ReturnType<SupabaseService['claimZaloAccountRuntimeOperation']>> | null = null
    let checked = false
    try {
      claim = await supabase.claimZaloAccountRuntimeOperation(accountId, 'server', false, 'zalo.session.restore')
      if (!claim.claimed || !claim.previousStatus || !claim.claimToken || !this.options.isRunning()) return
      const outcome = await zaloRuntime.restoreUnverifiedServerSession(accountId, candidate.sessionUpdatedAt)
      checked = outcome !== 'skipped'
      if (outcome === 'retry' || outcome === 'invalid') {
        this.defer(candidate, outcome === 'invalid')
      } else {
        this.retries.delete(accountId)
      }
    } catch {
      this.defer(candidate, false)
      // Do not log transport errors or credential-bearing payloads.
      console.warn('[ZaloServerSessionRestorer] Session restore will retry', { accountId })
    } finally {
      try {
        if (claim?.claimed && claim.previousStatus && claim.claimToken) {
          await supabase.releaseZaloAccountRuntimeOperation(
            accountId, 'server', claim.previousStatus, claim.staffId, claim.claimToken
          )
        }
      } catch {
        console.warn('[ZaloServerSessionRestorer] Session claim cleanup is pending', { accountId })
      } finally {
        // A failed/uncertain cleanup must retain both the DB and RAM hold.
        if (!accountOperationRegistry.has(accountId)) scheduler.releaseExternalAccount(accountId, reservationToken)
        if (checked) this.options.onStatusUpdated()
      }
    }
  }

  private defer(candidate: PendingZaloServerSession, invalid: boolean): void {
    const failures = Math.min((this.retries.get(candidate.accountId)?.failures || 0) + 1, 5)
    this.retries.set(candidate.accountId, {
      sessionUpdatedAt: candidate.sessionUpdatedAt,
      failures,
      // Definitively invalid credentials wait for a different session. Network
      // errors retry with backoff and never delete the imported credentials.
      retryAt: invalid ? Infinity : this.now() + Math.min(RETRY_MIN_MS * 2 ** (failures - 1), RETRY_MAX_MS)
    })
  }
}
