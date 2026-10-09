/** Pure result contract; no I/O, timers, global cache, or historical recomputation. */
export type ResultReportGroup = 'success' | 'failure' | 'skipped' | 'pending'
export type ResultInputEffect = 'complete' | 'pause' | 'requeue' | 'none'
export type BadTargetEffect = 'increment' | 'reset' | 'ignore'
export type OperationState = 'not_committed' | 'committed' | 'unknown'

export interface ResultStatus {
  id: number
  code: string
  name: string
  statusValue: string | null
  color: string | null
  componentType: string
  platform: string
  isActive: boolean
  isDelete: boolean
}
export interface ResultPolicyDecisions {
  reportGroup: ResultReportGroup
  countsTowardLimit: boolean
  badTargetEffect: BadTargetEffect
  resetErrorStreak: boolean
  inputEffect: ResultInputEffect
}
export interface AccountActionStatusPolicy extends ResultPolicyDecisions {
  id: number
  actionCode: string | null
  statusId: number
  isActive: boolean
  isDelete: boolean
}
export interface ResultErrorOverride {
  detailMode: 'inherit' | 'override' | 'suppress' | null
  detailStatusId: number | null
  inputEffect: ResultInputEffect | null
  /** Only populate when the legacy error adapter actually applies these columns. */
  countsTowardLimit?: boolean
  badTargetEffect?: BadTargetEffect
  resetErrorStreak?: boolean
}
export interface ActionResultOutput {
  actionCode: string
  statusCode: string
  subStatusCode?: string | null
  errorCode?: string | null
  operationState: OperationState
}
export interface ResultExecutionGuards {
  /** Evidence supplied by a legacy adapter, never inferred from policy names. */
  operationState?: OperationState
  quotaSuppressed?: boolean
  partialDelivery?: boolean
  auxiliaryAction?: boolean
  cancelled?: boolean
  /** Existing per-flow error semantics when detail_mode is NULL. */
  legacySuppress?: boolean
  legacyInputEffect?: ResultInputEffect
  /** A target-only member of a mixed batch cannot change campaign error state. */
  targetOnlyFailure?: boolean
  /** Earlier confirmed media delivery, settled with the next durable result. */
  badTargetResetBefore?: boolean
  /** Summary of a success that preceded an already settled terminal timeout. */
  ignoreBadTargetReset?: boolean
  /** Stop-threshold guard: retain the detail without advancing the streak. */
  badTargetIncrementSuppressed?: boolean
}
export interface EffectiveResult extends ResultPolicyDecisions {
  createDetail: boolean
  statusId: number | null
  subStatusId: number | null
  actionStatusPolicyId: number | null
  statusValue: string | null
  operationState: OperationState
  partialDelivery: boolean
  badTargetResetBefore?: boolean
}
export type ResultContractReason = 'status_unknown' | 'status_unavailable' | 'status_component_invalid'
  | 'status_value_missing' | 'status_value_ambiguous' | 'policy_missing' | 'policy_disabled'
  | 'policy_duplicate' | 'catalog_invalid' | 'error_override_invalid'
  | 'output_invalid' | 'target_settled' | 'result_key_conflict'
export class ResultContractError extends Error {
  readonly code = 'action_result_contract'
  constructor(readonly reason: ResultContractReason, readonly actionCode: string, readonly statusCode: string) {
    // Technical diagnostic only; do not replace existing note/log templates.
    super(`${reason}:${actionCode}:${statusCode}`)
    this.name = 'ResultContractError'
  }
}
const groups = new Set<ResultReportGroup>(['success', 'failure', 'skipped', 'pending'])
const effects = new Set<ResultInputEffect>(['complete', 'pause', 'requeue', 'none'])
const badEffects = new Set<BadTargetEffect>(['increment', 'reset', 'ignore'])
const key = (action: string | null, status: number): string => JSON.stringify([action, status])

/** Read-only catalog; runs may share it and retain their reference until they end. */
export class ActionStatusCatalog {
  private readonly statusesByCode = new Map<string, Readonly<ResultStatus>>()
  private readonly statusesById = new Map<number, Readonly<ResultStatus>>()
  private readonly policies = new Map<string, Readonly<AccountActionStatusPolicy>>()

  constructor(statuses: readonly ResultStatus[], policies: readonly AccountActionStatusPolicy[]) {
    for (const row of statuses) {
      if (!Number.isSafeInteger(row.id) || row.id <= 0 || !row.code || this.statusesByCode.has(row.code) || this.statusesById.has(row.id)) {
        throw new ResultContractError('catalog_invalid', '', row.code)
      }
      const status = Object.freeze({ ...row })
      this.statusesByCode.set(row.code, status)
      this.statusesById.set(row.id, status)
    }
    for (const row of policies) {
      const status = this.statusesById.get(row.statusId)
      if (!Number.isSafeInteger(row.id) || row.id <= 0 || !status || status.componentType !== 'campaign_detail'
        || !groups.has(row.reportGroup) || !effects.has(row.inputEffect) || !badEffects.has(row.badTargetEffect)
        || typeof row.countsTowardLimit !== 'boolean' || typeof row.resetErrorStreak !== 'boolean'
        || (row.actionCode !== null && !row.actionCode.trim())) {
        throw new ResultContractError('catalog_invalid', row.actionCode || '', status?.code || String(row.statusId))
      }
      const identity = key(row.actionCode, row.statusId)
      if (this.policies.has(identity)) throw new ResultContractError('policy_duplicate', row.actionCode || '', status.code)
      this.policies.set(identity, Object.freeze({ ...row }))
    }
  }

  status(code: string, actionCode = ''): Readonly<ResultStatus> {
    const row = this.statusesByCode.get(code)
    if (!row) throw new ResultContractError('status_unknown', actionCode, code)
    if (row.componentType !== 'campaign_detail') throw new ResultContractError('status_component_invalid', actionCode, code)
    if (!row.isActive || row.isDelete) throw new ResultContractError('status_unavailable', actionCode, code)
    return row
  }

  /** Text adapters use explicit status_value only, never name/description heuristics. */
  statusForLegacyValue(value: string, actionCode: string, platform: string): Readonly<ResultStatus> {
    const candidates = Array.from(this.statusesByCode.values()).filter(s => s.componentType === 'campaign_detail'
      && s.statusValue === value && (s.platform === 'all' || s.platform === platform))
    if (candidates.length !== 1) throw new ResultContractError(candidates.length ? 'status_value_ambiguous' : 'status_unknown', actionCode, value)
    return this.status(candidates[0]!.code, actionCode)
  }

  selectPolicy(actionCode: string, statusCode: string): Readonly<AccountActionStatusPolicy> {
    const status = this.status(statusCode, actionCode)
    if (!status.statusValue) throw new ResultContractError('status_value_missing', actionCode, statusCode)
    const specific = this.policies.get(key(actionCode, status.id))
    if (specific && !specific.isDelete) {
      if (!specific.isActive) throw new ResultContractError('policy_disabled', actionCode, statusCode)
      return specific
    }
    const fallback = this.policies.get(key(null, status.id))
    if (!fallback || fallback.isDelete) throw new ResultContractError('policy_missing', actionCode, statusCode)
    if (!fallback.isActive) throw new ResultContractError('policy_disabled', actionCode, statusCode)
    return fallback
  }

  preflight(declarations: readonly { actionCode: string; statusCodes: readonly string[] }[]): void {
    for (const action of declarations) for (const code of Array.from(new Set(action.statusCodes))) this.selectPolicy(action.actionCode, code)
  }

  resolve(output: ActionResultOutput, error: ResultErrorOverride | null = null, guards: ResultExecutionGuards = {}): EffectiveResult {
    let status = this.status(output.statusCode, output.actionCode)
    const sub = output.subStatusCode ? this.status(output.subStatusCode, output.actionCode) : null
    if (error?.detailMode === 'override') {
      const override = error.detailStatusId == null ? undefined : this.statusesById.get(error.detailStatusId)
      if (!override) throw new ResultContractError('error_override_invalid', output.actionCode, output.statusCode)
      status = this.status(override.code, output.actionCode)
    }
    const partialDelivery = guards.partialDelivery === true
    // Neither a producer nor a legacy adapter can downgrade observed delivery
    // to retryable work. Confirmed delivery wins; uncertainty still fences retry.
    const operationState = partialDelivery || guards.operationState === 'committed' || output.operationState === 'committed'
      ? 'committed' : guards.operationState === 'unknown' || output.operationState === 'unknown' ? 'unknown' : 'not_committed'
    const suppressed = !partialDelivery && ((guards.cancelled === true && operationState === 'not_committed')
      || error?.detailMode === 'suppress' || (error?.detailMode == null && guards.legacySuppress === true))
    let result: EffectiveResult
    if (suppressed) {
      result = { createDetail: false, statusId: null, subStatusId: null, actionStatusPolicyId: null,
        statusValue: null, reportGroup: 'skipped', countsTowardLimit: false, badTargetEffect: 'ignore',
        resetErrorStreak: false, inputEffect: error?.inputEffect ?? guards.legacyInputEffect ?? 'none', operationState, partialDelivery }
    } else {
      const policy = this.selectPolicy(output.actionCode, status.code)
      result = { createDetail: true, statusId: status.id, subStatusId: sub?.id ?? null,
        actionStatusPolicyId: policy.id, statusValue: status.statusValue, reportGroup: policy.reportGroup,
        countsTowardLimit: error?.countsTowardLimit ?? policy.countsTowardLimit,
        badTargetEffect: error?.badTargetEffect ?? policy.badTargetEffect,
        resetErrorStreak: error?.resetErrorStreak ?? policy.resetErrorStreak,
        inputEffect: error?.inputEffect ?? guards.legacyInputEffect ?? policy.inputEffect, operationState, partialDelivery }
    }
    if (guards.quotaSuppressed) result = { ...result, countsTowardLimit: false, resetErrorStreak: false }
    if (partialDelivery && result.createDetail) result = { ...result, countsTowardLimit: true, resetErrorStreak: true }
    if (guards.auxiliaryAction) result = { ...result, countsTowardLimit: false, badTargetEffect: 'ignore', resetErrorStreak: false }
    if (guards.targetOnlyFailure) result = { ...result, badTargetEffect: 'ignore' }
    if (guards.badTargetIncrementSuppressed && result.badTargetEffect === 'increment') result = { ...result, badTargetEffect: 'ignore' }
    if (guards.ignoreBadTargetReset && result.badTargetEffect === 'reset') result = { ...result, badTargetEffect: 'ignore' }
    // Respect the run's success policy; evidence alone cannot invent a reset.
    if (result.createDetail && !guards.auxiliaryAction && !guards.cancelled && guards.badTargetResetBefore
      && this.selectPolicy(output.actionCode, 'campaign_detail_success').badTargetEffect === 'reset') {
      result = { ...result, badTargetResetBefore: true }
    }
    // No override may turn an uncertain or completed external operation into a retry.
    if (result.inputEffect === 'requeue' && operationState !== 'not_committed') result = { ...result, inputEffect: 'pause' }
    return Object.freeze(result)
  }
}

/** Aggregate only at the target boundary; auxiliary actions cannot reset a failure. */
export function aggregateResultEffects(results: readonly EffectiveResult[]): { inputEffect: ResultInputEffect; badTargetEffect: BadTargetEffect } {
  const inputEffect = results.some(r => r.inputEffect === 'pause') ? 'pause'
    : results.some(r => r.inputEffect === 'requeue')
      ? results.some(r => r.operationState !== 'not_committed') ? 'pause' : 'requeue'
      : results.some(r => r.inputEffect === 'complete') ? 'complete' : 'none'
  const badTargetEffect = results.some(r => r.badTargetEffect === 'increment') ? 'increment'
    : results.some(r => r.badTargetEffect === 'reset') ? 'reset' : 'ignore'
  return { inputEffect, badTargetEffect }
}

/** Secondary event edge; no catalog/policy lookup or send/count side effect. */
export function secondaryConditionTransition(mainMatchesBefore: boolean, mainMatchesAfter: boolean,
  previousSubStatusId: number | null, nextSubStatusId: number | null, subStatusIds: readonly number[] | null): boolean {
  if (subStatusIds === null) return false // Existing main-only triggers handle their own transitions.
  if (!subStatusIds.length) throw new ResultContractError('catalog_invalid', '', '')
  const before = mainMatchesBefore && previousSubStatusId !== null && subStatusIds.includes(previousSubStatusId)
  const after = mainMatchesAfter && nextSubStatusId !== null && subStatusIds.includes(nextSubStatusId)
  return !before && after
}
