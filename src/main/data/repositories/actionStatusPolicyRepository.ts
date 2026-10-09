import { ActionStatusCatalog, AccountActionStatusPolicy, ResultStatus } from '../../../shared/actionStatusPolicy'
import { AutoErrorPolicy } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAutoErrorPolicyFromDB } from '../mappers'

const PAGE_SIZE = 500
async function catalogRows(table: 'auto_status' | 'auto_account_action_status_policies' | 'auto_error' | 'auto_account_actions'): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let afterId = 0
  while (true) {
    const { data, error } = await getSupabaseClient().from(table).select('*').gt('id', afterId).order('id').limit(PAGE_SIZE)
    if (error) throw new Error(`result_catalog_read:${table}:${error.code}`)
    const page = data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
    afterId = Number(page[page.length - 1].id)
  }
}
export interface RunResultCatalog {
  actionCodes: ReadonlySet<string>
  statuses: readonly ResultStatus[]
  catalog: ActionStatusCatalog
  errors: ReadonlyMap<string, AutoErrorPolicy>
}
/** Called only at run acquisition/recovery. No module cache, polling or target reads. */
export async function loadRunResultCatalog(): Promise<RunResultCatalog> {
  const [statusRows, policyRows, errorRows, actionRows] = await Promise.all([
    catalogRows('auto_status'), catalogRows('auto_account_action_status_policies'), catalogRows('auto_error'), catalogRows('auto_account_actions')
  ])
  const statuses: ResultStatus[] = statusRows.map(s => ({
    id: Number(s.id), code: String(s.code), name: String(s.name), statusValue: s.status_value == null ? null : String(s.status_value),
    color: s.color == null ? null : String(s.color), componentType: String(s.component_type), platform: String(s.flatform_type),
    isActive: s.is_active === true, isDelete: s.is_delete === true
  }))
  const policies: AccountActionStatusPolicy[] = policyRows.map(p => ({
    id: Number(p.id), actionCode: p.action_code == null ? null : String(p.action_code), statusId: Number(p.status_id),
    reportGroup: p.report_group as AccountActionStatusPolicy['reportGroup'], countsTowardLimit: p.counts_toward_limit as boolean,
    badTargetEffect: p.bad_target_effect as AccountActionStatusPolicy['badTargetEffect'], resetErrorStreak: p.reset_error_streak as boolean,
    inputEffect: p.input_effect as AccountActionStatusPolicy['inputEffect'], isActive: p.is_active === true, isDelete: p.is_delete === true
  }))
  const errors = new Map(errorRows.filter(p => p.is_active === true && p.is_delete === false)
    .map(row => { const p = mapAutoErrorPolicyFromDB(row); return [p.errorCode, p] as const }))
  return { actionCodes: new Set(actionRows.filter(a => a.is_active !== false && a.is_delete !== true).map(a => String(a.code))), statuses, catalog: new ActionStatusCatalog(statuses, policies), errors }
}
