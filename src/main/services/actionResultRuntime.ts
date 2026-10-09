import { AsyncLocalStorage } from 'node:async_hooks'
import { stageCampaignEngagementSource, failCampaignEngagementDetail } from './zaloCampaignEngagement'
import { createHash } from 'node:crypto'
import { ActionResultSession, parseActionResultOutput } from '../../shared/actionResultSession'
import { ResultContractError, ResultErrorOverride } from '../../shared/actionStatusPolicy'
import { CampaignDetail, CampaignInputData, CreateCampaignDetailInput } from '../../shared/types'
import { getSupabaseClient } from '../data/supabaseClient'
import { mapCampaignDetailFromDB, mapCampaignInputDataFromDB } from '../data/mappers'
import { loadRunResultCatalog, RunResultCatalog } from '../data/repositories/actionStatusPolicyRepository'

interface Settlement { settlement: { badTargetCount: number; badTargetEffect: string; inputApplied?: boolean }; input: Record<string, unknown> | null }
interface Run {
  campaignId: number; accountId: number; staffId: number; platform: string; claimToken: string
  loaded: RunResultCatalog
  unit?: { token: string; session: ActionResultSession; inputIds: number[]; settlements: Map<string, Settlement> }
}
const runContext = new AsyncLocalStorage<number>()
export const withActionResultRunContext = <T>(id: number, operation: () => T): T => runContext.run(id, operation)
const runs = new Map<number, Run>()
export function managesActionResult(campaignId: number): boolean { return !!runs.get(campaignId)?.unit }
export const currentActionResultErrors = () => runs.get(runContext.getStore() ?? -1)?.loaded.errors
export function managedTargetEffects(campaignId: number, inputId: number | null | undefined) {
  const target = runs.get(campaignId)?.unit?.session.target(inputId == null ? null : String(inputId))
  return target?.results.length ? target : null
}
const inputs = new Map<number, Run>()

export async function beginActionResultRun(input: Omit<Run, 'loaded' | 'unit'>,
  actionCodes: readonly string[], declarations: readonly { actionCode: string; statusCodes: readonly string[] }[] = []): Promise<void> {
  const loaded = await loadRunResultCatalog()
  for (const action of [...actionCodes, ...declarations.map(d => d.actionCode)]) {
    if (!loaded.actionCodes.has(action)) throw new ResultContractError('output_invalid', action, 'action_unavailable')
  }
  loaded.catalog.preflight(actionCodes.map(actionCode => ({ actionCode,
    statusCodes: ['campaign_detail_success', 'campaign_detail_failed', 'campaign_detail_error'] })))
  loaded.catalog.preflight(declarations)
  if (actionCodes.includes('zalo_tag_contact')) loaded.catalog.selectPolicy('zalo_tag_contact', 'campaign_detail_tag_not_found')
  if (actionCodes.includes('zalo_change_alias')) loaded.catalog.selectPolicy('zalo_change_alias', 'campaign_detail_invalid_parameter')
  // Preflight the configured error result codes for this platform. No new query
  // is made when a target fails. Legacy NULL remains owned by its flow adapter.
  for (const error of loaded.errors.values()) {
    if (!error.errorType.includes(input.platform) && error.errorType !== 'system') continue
    for (const actionCode of actionCodes) {
      if (error.zaloActionCodes.length && input.platform === 'zalo' && !error.zaloActionCodes.includes(actionCode)) continue
      if (error.detailMode === 'suppress') continue
      const status = error.detailMode === 'override'
        ? loaded.statuses.find(s => s.id === error.detailStatusId)
        : error.detailStatus ? loaded.catalog.statusForLegacyValue(error.detailStatus, actionCode, input.platform) : null
      if (status) loaded.catalog.selectPolicy(actionCode, status.code)
      else if (error.detailMode === 'override') throw new ResultContractError('error_override_invalid', actionCode, String(error.detailStatusId))
    }
  }
  runs.set(input.campaignId, { ...input, loaded })
}

export function beginActionResultUnit(campaignId: number, token: string, inputIds: number[]): void {
  const run = runs.get(campaignId)
  if (!run) return
  for (const id of run.unit?.inputIds ?? []) inputs.delete(id)
  run.unit = { token, inputIds: [...inputIds], settlements: new Map(), session: new ActionResultSession(run.loaded.catalog,
    createHash('md5').update(token).digest('hex')) }
  for (const id of inputIds) inputs.set(id, run)
}
export function endActionResultRun(campaignId: number): void {
  const run = runs.get(campaignId)
  for (const id of run?.unit?.inputIds ?? []) inputs.delete(id)
  runs.delete(campaignId)
}

/** Synchronous RAM check at each producer boundary, before the next block. */
export function validateActionResultStep(campaignId: number, value: Record<string, any> | undefined): void {
  if (!value || !('actionResult' in value || 'actionResults' in value || ('actionCode' in value && 'statusCode' in value))) return
  const run = runs.get(campaignId)
  if (!run) return
  const rows = 'actionResults' in value ? value.actionResults : [value.actionResult ?? value]
  if (!Array.isArray(rows) || !rows.length) throw new ResultContractError('output_invalid', '', 'batch_empty')
  for (const row of rows) {
    const output = parseActionResultOutput(row)
    if (run.unit && run.unit.inputIds.length > 1 && !run.unit.inputIds.includes(Number(row.inputDataId))) throw new ResultContractError('output_invalid', output?.actionCode ?? '', 'batch_input_missing')
    if (!output || !run.loaded.actionCodes.has(output.actionCode)) throw new ResultContractError('output_invalid', output?.actionCode ?? '', 'action_unavailable')
    const error = output.errorCode ? run.loaded.errors.get(output.errorCode) : null
    run.loaded.catalog.resolve(output, error ? { detailMode: error.detailMode ?? null,
      detailStatusId: error.detailStatusId ?? null, inputEffect: error.inputEffect ?? null } : null)
  }
}

function scope(run: Run) {
  return { p_staff_id: run.staffId, p_campaign_id: run.campaignId, p_account_id: run.accountId,
    p_claim_token: run.claimToken, p_unit_token: run.unit!.token }
}

/** undefined = non-runtime legacy writer, null = explicitly suppressed result. */
export async function writeManagedActionResult(action: CreateCampaignDetailInput,
  payload: Record<string, unknown>): Promise<CampaignDetail | null | undefined> {
  const run = action.campaignId == null ? undefined : runs.get(action.campaignId)
  if (!run || !action.actionCode) return undefined
  if (!run.unit) throw new ResultContractError('output_invalid', action.actionCode, 'unit_missing')
  const contract = action.resultOutput
  if (!run.loaded.actionCodes.has(action.actionCode) || (contract && contract.actionCode !== action.actionCode)) {
    throw new ResultContractError('output_invalid', action.actionCode, 'action_mismatch')
  }
  const status = contract ? run.loaded.catalog.status(contract.statusCode, contract.actionCode)
    : run.loaded.catalog.statusForLegacyValue(String(payload.status), action.actionCode, run.platform)
  const error = action.errorCode ? run.loaded.errors.get(action.errorCode) : undefined
  const legacyErrorCounting = !!error && (run.platform === 'zalo' || run.platform === 'email' || action.actionCode === 'fb_add_friend' || error.detailMode != null)
  const override: ResultErrorOverride | null = error ? {
    detailMode: error.detailMode ?? null, detailStatusId: error.detailStatusId ?? null, inputEffect: error.inputEffect ?? null,
    ...(legacyErrorCounting ? { countsTowardLimit: error.countsTowardLimit,
      badTargetEffect: error.countsTowardBadTarget ? 'increment' as const : 'ignore' as const,
      resetErrorStreak: error.countsTowardLimit } : {})
  } : null
  const guards = { ...action.resultGuards,
    quotaSuppressed: legacyErrorCounting && action.shouldCountAction === false,
    targetOnlyFailure: action.resultGuards?.targetOnlyFailure === true || (action.actionCode === 'fb_comment'
      && status.code !== 'campaign_detail_success' && run.unit.session.target(action.inputDataId == null ? null : String(action.inputDataId)).results.some(r => r.operationState === 'committed')),
    auxiliaryAction: action.actionCode === 'zalo_tag_contact' || action.actionCode === 'zalo_change_alias' }
  const prepared = run.unit.session.prepare(action.inputDataId == null ? null : String(action.inputDataId), contract ?? {
    actionCode: action.actionCode, statusCode: status.code,
    operationState: action.resultGuards?.operationState ?? (status.code === 'campaign_detail_success' ? 'committed' : 'not_committed')
  }, override, guards, action.resultSourceKey)
  const effective = prepared.effective
  if (!effective.createDetail) {
    run.unit.session.record(action.inputDataId == null ? null : String(action.inputDataId), prepared.key, null, effective)
    return null
  }
  stageCampaignEngagementSource(action.data?.zaloEngagementSource, action.campaignId, true)
  const { data, error: writeError } = await getSupabaseClient().rpc('aka_agent_write_action_result_v1', {
    ...scope(run), p_account_id: action.accountId ?? run.accountId, p_result_key: prepared.key,
    p_detail: { ...payload, status: effective.statusValue, status_id: effective.statusId,
      sub_status_id: effective.subStatusId, action_status_policy_id: effective.actionStatusPolicyId,
      policy_snapshot: effective }
  }).then(result => result, error => { failCampaignEngagementDetail(action.data?.zaloEngagementSource, error); throw error })
  if (writeError) failCampaignEngagementDetail(action.data?.zaloEngagementSource, writeError)
  if (writeError) throw new ResultContractError('output_invalid', action.actionCode, `write:${writeError.message}`)
  const detail = mapCampaignDetailFromDB(data.detail)
  run.unit.session.record(action.inputDataId == null ? null : String(action.inputDataId), prepared.key, String(detail.id),
    detail.policySnapshot as unknown as typeof effective)
  return detail
}

async function settle(run: Run, inputId: number | null, patch: Record<string, unknown> | null, reason?: string) {
  if (!run.unit) return null
  const target = run.unit.session.target(inputId == null ? null : String(inputId))
  if (!target.results.length) return null
  // Unit release must not requeue a started row after an observed operation,
  // even when every configured action leaves input ownership unchanged.
  if (patch != null && target.inputEffect === 'none' && target.results.some(r => r.operationState !== 'not_committed')) patch = { ...patch, status: 'tạm dừng' }
  const targetKey = inputId == null ? '0' : String(inputId)
  const cached = run.unit.settlements.get(targetKey)
  if (cached && (patch == null || cached.settlement.inputApplied)) return cached
  if (target.results.some(r => !r.createDetail)) patch = { ...patch, deferInput: patch == null,
    suppressedResult: { inputEffect: target.inputEffect, operationState: target.results.some(r => r.operationState !== 'not_committed') ? 'unknown' : 'not_committed' } }
  if (!target.detailIds.length && patch == null) return { settlement: { badTargetCount: 0, badTargetEffect: 'ignore' }, input: null }
  const { data, error } = await getSupabaseClient().rpc('aka_agent_settle_action_results_v1', {
    ...scope(run), p_input_data_id: inputId, p_detail_ids: target.detailIds,
    p_input_patch: patch, p_reason: reason ?? null
  })
  if (error) throw new ResultContractError('output_invalid', '', `settle:${error.message}`)
  run.unit.session.close(inputId == null ? null : String(inputId))
  const receipt = data as Settlement
  run.unit.settlements.set(targetKey, receipt)
  return receipt
}

export async function settleManagedActionInput(id: number, patch: Partial<CampaignInputData>): Promise<CampaignInputData | null> {
  const run = inputs.get(id)
  if (!run || !patch.status || !['hoàn thành', 'chờ xử lý', 'tạm dừng'].includes(patch.status)) return null
  // Enrichment and manual edits still use their existing validation path.
  if (Object.keys(patch).some(k => !['status', 'note', 'dateAction'].includes(k))) return null
  const result = await settle(run, id, patch)
  return result?.input ? mapCampaignInputDataFromDB(result.input) : null
}
export async function settleManagedBadTarget(campaignId: number, inputId: number | null | undefined, reason?: string): Promise<number | null> {
  const run = runs.get(campaignId)
  if (!run?.unit) return null
  if (inputId != null) return (await settle(run, inputId, null, reason))?.settlement.badTargetCount ?? null
  let count: number | null = null
  for (const id of run.unit.session.targets()) {
    const result = await settle(run, id === '0' ? null : Number(id), null, reason)
    if (result) count = result.settlement.badTargetCount
  }
  return count
}

/** Reset calls inside lookup/share preparation are deferred until the full target settles. */
export function defersManagedBadTargetReset(campaignId: number): boolean { return runs.has(campaignId) }
export async function finishActionResultUnit(campaignId: number): Promise<void> {
  const run = runs.get(campaignId)
  if (!run?.unit) return
  for (const id of run.unit.session.targets()) await settle(run, id === '0' ? null : Number(id), id === '0' ? null : {})
}
