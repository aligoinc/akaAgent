import { isTemporaryCleanupError, RuntimeCleanupRetry, waitForRetry } from './runtimeCleanupRetry'
import type { RuntimeCleanupOutcome, RuntimeCleanupResult } from './runtimeCleanupRetry'

export interface AccountOperationContext {
  readonly accountId: number
  readonly staffId: number
  readonly platform: 'zalo' | 'facebook' | 'email'
  readonly runtimeTarget: 'desktop' | 'server'
  readonly previousStatus: 'chờ xử lý' | 'tạm dừng'
  readonly claimToken: string
  readonly operationName: string
}

export interface AccountOperationClaimResult {
  claimed: boolean
  accountId: number
  staffId: number
  previousStatus: 'chờ xử lý' | 'tạm dừng' | null
  claimToken: string | null
  reason: string | null
}

interface AccountOperationRecord {
  context: AccountOperationContext
  phase: 'claiming' | 'active' | 'cleanup' | 'recovery'
  cleanup: RuntimeCleanupRetry
  requestCleanup: (signal: AbortSignal) => Promise<RuntimeCleanupResult>
}

/** One process may host many staff runtimes; account IDs are globally unique. */
export class AccountOperationRegistry {
  private readonly records = new Map<number, AccountOperationRecord>()
  private readonly stoppedStaffs = new Set<number>()

  has(accountId: number): boolean { return this.records.has(accountId) }

  async claim(
    context: AccountOperationContext,
    request: (signal: AbortSignal) => Promise<AccountOperationClaimResult>,
    requestCleanup: AccountOperationRecord['requestCleanup']
  ): Promise<AccountOperationClaimResult> {
    const rejected = (reason: string): AccountOperationClaimResult => ({
      claimed: false, accountId: context.accountId, staffId: context.staffId,
      previousStatus: null, claimToken: null, reason
    })
    if (this.stoppedStaffs.has(context.staffId)) return rejected('runtime_stopping')
    if (this.records.has(context.accountId)) return rejected('account_operation_pending')
    const record: AccountOperationRecord = {
      context: Object.freeze({ ...context }), phase: 'claiming',
      cleanup: new RuntimeCleanupRetry(), requestCleanup
    }
    this.records.set(context.accountId, record)
    const signal = record.cleanup.controller.signal
    let waiting = false
    while (!signal.aborted) {
      let result: AccountOperationClaimResult
      try {
        // Retries retain exactly the same token and previous-status snapshot.
        // Do not make an in-flight claim look drained by merely aborting HTTP:
        // SQL may still commit it. Shutdown waits for this request to settle;
        // its result cannot start a producer once the lifecycle signal aborts.
        result = await request(new AbortController().signal)
      } catch (error) {
        if (signal.aborted || !isTemporaryCleanupError(error)) {
          record.phase = 'recovery'
          throw error
        }
        if (!waiting) this.report(record, 'claim_waiting', error)
        waiting = true
        await waitForRetry(signal)
        continue
      }
      if (signal.aborted) break
      if (result.claimed) {
        if (result.claimToken !== context.claimToken || result.previousStatus !== context.previousStatus) {
          record.phase = 'recovery'
          throw new Error('Account operation claim returned an unexpected ownership token')
        }
        record.phase = 'active'
        if (waiting) this.report(record, 'claim_recovered')
        return result
      }
      // A lost claim response followed by a pause can return control_changed.
      // Clean only our token before forgetting this attempted operation.
      await this.release(context.accountId, context.claimToken)
      return result
    }
    record.phase = 'recovery'
    throw new Error('Account operation stopped; ownership retained for scoped recovery')
  }

  async release(accountId: number, claimToken: string, staffId?: number): Promise<RuntimeCleanupOutcome> {
    const record = this.records.get(accountId)
    // A late finally must neither call DB again nor remove a newer RAM hold.
    if (!record || record.context.claimToken !== claimToken) return 'not_owner'
    if (staffId !== undefined && record.context.staffId !== staffId) throw new Error('Account cleanup staff identity mismatch')
    record.phase = 'cleanup'
    const outcome = await record.cleanup.run(
      () => record.requestCleanup(record.cleanup.controller.signal),
      (event, error) => this.report(record, event, error)
    )
    if (outcome === 'cleaned' || outcome === 'not_owner') {
      if (this.records.get(accountId) === record) this.records.delete(accountId)
    } else {
      record.phase = 'recovery'
    }
    return outcome
  }

  /** Stop retry/cleanup waits; recovery still drains in-flight claims and Zalo work. */
  stop(staffId: number): void {
    this.stoppedStaffs.add(staffId)
    for (const record of this.records.values()) {
      if (record.context.staffId === staffId) record.cleanup.controller.abort()
    }
  }

  async waitForProducers(staffId: number, timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs)
    while ([...this.records.values()].some(record => record.context.staffId === staffId &&
      (record.phase === 'claiming' || record.phase === 'active'))) {
      if (Date.now() >= deadline) return false
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return true
  }

  /** Only after producer drain and scoped DB recovery. Also covers subtype changes. */
  async recover(staffId: number): Promise<void> {
    for (const record of this.records.values()) {
      if (record.context.staffId !== staffId) continue
      if (record.phase === 'claiming' || record.phase === 'active') {
        throw new Error('Account operation producer has not stopped; recovery deferred')
      }
      // One attempt under the existing lifecycle recovery policy, with no new timer.
      const result = await record.requestCleanup(new AbortController().signal)
      if (!((result.ok && ['cleaned', 'already_cleaned'].includes(result.reason)) || result.reason === 'not_owner')) {
        throw new Error(`Account operation recovery refused: ${result.reason}`)
      }
      if (this.records.get(record.context.accountId) === record) this.records.delete(record.context.accountId)
    }
  }

  resume(staffId: number): void {
    if ([...this.records.values()].some(record => record.context.staffId === staffId)) {
      throw new Error('Account operation recovery is incomplete')
    }
    this.stoppedStaffs.delete(staffId)
  }

  private report(record: AccountOperationRecord, event: string, error?: unknown): void {
    console.warn('[AccountOperation]', {
      accountId: record.context.accountId, staffId: record.context.staffId,
      operation: record.context.operationName, runtimeTarget: record.context.runtimeTarget,
      event, ...(error === undefined ? {} : { error })
    })
  }
}

export const accountOperationRegistry = new AccountOperationRegistry()
