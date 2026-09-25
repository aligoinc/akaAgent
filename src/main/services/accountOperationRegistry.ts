import { isTemporaryCleanupError, RuntimeCleanupRetry, waitForRetry } from './runtimeCleanupRetry'
import type { RuntimeCleanupOutcome, RuntimeCleanupResult } from './runtimeCleanupRetry'
import { withRequestDeadline } from './requestDeadline'

export interface AccountOperationContext {
  readonly accountId: number
  readonly staffId: number
  readonly platform: 'zalo' | 'facebook' | 'email'
  readonly runtimeTarget: 'desktop' | 'server'
  readonly previousStatus: 'chờ xử lý' | 'tạm dừng'
  readonly claimToken: string
  readonly operationName: string
  /** Present only when DB cleanup can invalidate a claim that has not arrived yet. */
  readonly facebookClaimGeneration?: number
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
  retrySignal?: AbortSignal
  recoveryWork?: Promise<boolean>
}

/** One process may host many staff runtimes; account IDs are globally unique. */
export class AccountOperationRegistry {
  private readonly records = new Map<number, AccountOperationRecord>()
  private readonly stoppedStaffs = new Set<number>()

  has(accountId: number): boolean { return this.records.has(accountId) }

  listRecoverable(staffId: number, operationName: string): AccountOperationContext[] {
    return [...this.records.values()].filter(record => record.phase === 'recovery' &&
      record.context.staffId === staffId && record.context.operationName === operationName)
      .map(record => record.context)
  }

  /** Reconcile one finished operation without stopping other accounts or replaying its producer. */
  recoverOperation(context: AccountOperationContext, signal: AbortSignal): Promise<boolean> {
    const record = this.records.get(context.accountId)
    if (!record || record.context.claimToken !== context.claimToken || record.context.staffId !== context.staffId ||
      record.context.platform !== context.platform || record.context.runtimeTarget !== context.runtimeTarget ||
      record.context.operationName !== context.operationName || record.phase !== 'recovery' ||
      this.stoppedStaffs.has(context.staffId) || signal.aborted) return Promise.resolve(false)
    if (record.recoveryWork) return record.recoveryWork
    const work = withRequestDeadline(AbortSignal.any([signal, record.cleanup.controller.signal]),
      requestSignal => record.requestCleanup(requestSignal)).then(result => {
      if (!((result.ok && ['cleaned', 'already_cleaned'].includes(result.reason)) || result.reason === 'not_owner')) return false
      // A timed-out/old recovery must never remove a replacement account operation.
      if (this.records.get(context.accountId) !== record) return false
      this.records.delete(context.accountId)
      return true
    }).catch(() => false).finally(() => {
      if (record.recoveryWork === work) record.recoveryWork = undefined
    })
    record.recoveryWork = work
    return work
  }

  async claim(
    context: AccountOperationContext,
    request: (signal: AbortSignal) => Promise<AccountOperationClaimResult>,
    requestCleanup: AccountOperationRecord['requestCleanup'],
    retrySignal?: AbortSignal
  ): Promise<AccountOperationClaimResult> {
    const rejected = (reason: string): AccountOperationClaimResult => ({
      claimed: false, accountId: context.accountId, staffId: context.staffId,
      previousStatus: null, claimToken: null, reason
    })
    if (this.stoppedStaffs.has(context.staffId) || retrySignal?.aborted) return rejected('runtime_stopping')
    if (this.records.has(context.accountId)) return rejected('account_operation_pending')
    const record: AccountOperationRecord = {
      context: Object.freeze({ ...context }), phase: 'claiming',
      cleanup: new RuntimeCleanupRetry(), requestCleanup, retrySignal
    }
    this.records.set(context.accountId, record)
    const signal = retrySignal ? AbortSignal.any([record.cleanup.controller.signal, retrySignal]) : record.cleanup.controller.signal
    let waiting = false
    while (!signal.aborted) {
      let result: AccountOperationClaimResult
      try {
        // Only the generation-fenced FB protocol can close a claim before its
        // response arrives. Keep the RAM hold until its DB cleanup confirms;
        // every other operation still drains the original claim normally.
        const cancellable = context.platform === 'facebook' && context.operationName === 'facebook.login'
          && Number.isSafeInteger(context.facebookClaimGeneration) && context.facebookClaimGeneration! >= 0
        result = cancellable
          ? await withRequestDeadline(signal, request, 120_000)
          : await request(new AbortController().signal)
      } catch (error) {
        if (signal.aborted || !isTemporaryCleanupError(error)) {
          record.phase = 'recovery'
          if (retrySignal?.aborted && !record.cleanup.controller.signal.aborted) {
            await this.release(context.accountId, context.claimToken, context.staffId)
          }
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
    // The in-flight claim has settled. Try our token once even after a local
    // deadline; failed cleanup keeps only this account reserved for recovery.
    if (retrySignal?.aborted && !record.cleanup.controller.signal.aborted) {
      await this.release(context.accountId, context.claimToken, context.staffId)
    }
    throw new Error('Account operation stopped; no producer was started')
  }

  async release(accountId: number, claimToken: string, staffId?: number): Promise<RuntimeCleanupOutcome> {
    const record = this.records.get(accountId)
    // A late finally must neither call DB again nor remove a newer RAM hold.
    if (!record || record.context.claimToken !== claimToken) return 'not_owner'
    if (staffId !== undefined && record.context.staffId !== staffId) throw new Error('Account cleanup staff identity mismatch')
    record.phase = 'cleanup'
    const outcome = await record.cleanup.run(
      // Facebook's producer has drained. Bound even the first cleanup so a hung
      // transport reaches recovery; its immutable token still fences late SQL.
      // Give cleanup its own deadline, including when the login already expired.
      () => record.context.platform === 'facebook' && record.context.operationName === 'facebook.login'
        ? withRequestDeadline(record.cleanup.controller.signal, signal => record.requestCleanup(signal))
        : record.requestCleanup(record.cleanup.controller.signal),
      (event, error) => this.report(record, event, error),
      record.retrySignal
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
      // Join in-session reconciliation before lifecycle recovery tries the same token.
      if (record.recoveryWork) await record.recoveryWork
      if (this.records.get(record.context.accountId) !== record) continue
      if (record.phase === 'claiming' || record.phase === 'active') {
        throw new Error('Account operation producer has not stopped; recovery deferred')
      }
      // Lifecycle stop aborted the old controller. Facebook cleanup gets a fresh
      // bounded attempt; timeout keeps this token for the next scoped recovery.
      const signal = new AbortController().signal
      const result = record.context.platform === 'facebook' && record.context.operationName === 'facebook.login'
        ? await withRequestDeadline(signal, requestSignal => record.requestCleanup(requestSignal))
        : await record.requestCleanup(signal)
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
