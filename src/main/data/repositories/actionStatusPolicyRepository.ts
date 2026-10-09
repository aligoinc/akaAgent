import { ActionStatusCatalog, AccountActionStatusPolicy, ResultStatus } from '../../../shared/actionStatusPolicy'
import { ActionResultCatalogCache } from '../../../shared/actionResultCatalogCache'
import { AutoErrorPolicy } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapAutoErrorPolicyFromDB } from '../mappers'

const PAGE_SIZE = 500
const CATALOG_READ_TIMEOUT_MS = 60_000
async function catalogRows(table: 'auto_status' | 'auto_account_action_status_policies' | 'auto_error' | 'auto_account_actions', signal: AbortSignal): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  let afterId = 0
  while (true) {
    signal.throwIfAborted()
    const { data, error } = await getSupabaseClient().from(table).select('*').gt('id', afterId).order('id').limit(PAGE_SIZE).abortSignal(signal)
    signal.throwIfAborted()
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
// Global configuration only; shared by Desktop or all staff runtimes in one Server process.
const catalogCache = new ActionResultCatalogCache(readRunResultCatalog)

/** Acquisition/recovery keeps the same run snapshot, with a shared 60-second read cache. */
export function loadRunResultCatalog(): Promise<RunResultCatalog> {
  return catalogCache.get()
}

async function readRunResultCatalog(): Promise<RunResultCatalog> {
  const controller = new AbortController()
  // Bound the entire HTTP load (all tables/pages), not each campaign or target.
  const timeout = setTimeout(() => controller.abort(), CATALOG_READ_TIMEOUT_MS)
  try {
    return await readCatalogTables(controller.signal)
  } finally {
    clearTimeout(timeout)
    // Also stop sibling/page reads when one table fails; do not leave orphan HTTP requests.
    controller.abort()
  }
}

async function readCatalogTables(signal: AbortSignal): Promise<RunResultCatalog> {
  const [statusRows, policyRows, errorRows, actionRows] = await Promise.all([
    catalogRows('auto_status', signal), catalogRows('auto_account_action_status_policies', signal),
    catalogRows('auto_error', signal), catalogRows('auto_account_actions', signal)
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
