import type {
  AccountActionReportAction, AccountActionReportAccount, AccountActionReportQuery,
  AccountActionReportResult, AccountActionReportDetailQuery, AccountActionReportDetailResult
} from './types'

export type ActionReportStatusSelector =
  | { kind: 'pending' }
  | { kind: 'status'; statusId: number }
  | { kind: 'legacy'; status: string }

export interface ActionReportStatusColumn {
  key: string
  label: string
  selector: ActionReportStatusSelector
}
export interface AccountActionStatusReportResult {
  query: AccountActionReportQuery
  actions: Array<AccountActionReportAction & { statuses: ActionReportStatusColumn[] }>
  rows: Array<{ account: AccountActionReportAccount; countsByActionCode: Record<string, Record<string, number>> }>
  generatedAt: string
}
export interface AccountActionStatusReportDetailQuery extends Omit<AccountActionReportDetailQuery, 'statusBucket'> {
  selector: ActionReportStatusSelector
}
export interface AccountActionStatusReportDetailResult extends Omit<AccountActionReportDetailResult, 'query'> {
  query: AccountActionStatusReportDetailQuery
}

type CatalogRow = Record<string, unknown>
export interface ActionReportCatalogData {
  statuses: CatalogRow[]
  mappings: CatalogRow[]
  campaigns: CatalogRow[]
}
export const PENDING_ACTION_REPORT_COLUMN: ActionReportStatusColumn = {
  key: 'pending', label: 'Chờ xử lý', selector: { kind: 'pending' }
}

export function normalizeActionReportSelector(value: unknown): ActionReportStatusSelector {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Trạng thái báo cáo không hợp lệ.')
  const row = value as CatalogRow
  if (row.kind === 'pending' && row.statusId === undefined && row.status === undefined) return { kind: 'pending' }
  if (row.kind === 'status' && row.status === undefined && Number.isSafeInteger(row.statusId) && Number(row.statusId) > 0) {
    return { kind: 'status', statusId: Number(row.statusId) }
  }
  if (row.kind === 'legacy' && row.statusId === undefined && typeof row.status === 'string') {
    return { kind: 'legacy', status: row.status }
  }
  throw new Error('Trạng thái báo cáo không hợp lệ.')
}

/** PostgREST quoted values only escape quotes/backslashes; keep LF, CR and tabs verbatim. */
function quotePostgrestValue(value: string): string {
  return '"' + value.replace(/[\\"]/g, character => '\\' + character) + '"'
}

/** Read-only presentation catalog. Never consult runtime policies or rewrite history. */
export class ActionReportStatusCatalog {
  private readonly byId: Map<number, CatalogRow>
  constructor(private readonly data: ActionReportCatalogData) {
    this.byId = new Map(data.statuses.filter(row => row.component_type === 'campaign_detail').map(row => [Number(row.id), row]))
  }

  private legacyStatus(value: string, platform: string): CatalogRow | undefined {
    const matches = Array.from(this.byId.values()).filter(row => row.status_value === value
      && (row.flatform_type === 'all' || row.flatform_type === platform))
    return matches.length === 1 ? matches[0] : undefined
  }

  column(statusId: unknown, status: unknown, platform: string): ActionReportStatusColumn {
    const raw = String(status ?? '')
    const id = statusId == null ? Number(this.legacyStatus(raw, platform)?.id) : Number(statusId)
    if (Number.isSafeInteger(id) && id > 0) {
      return { key: `status:${id}`, label: String(this.byId.get(id)?.name || raw || 'Chưa xác định'), selector: { kind: 'status', statusId: id } }
    }
    return { key: `legacy:${JSON.stringify(raw)}`, label: raw || 'Chưa xác định', selector: { kind: 'legacy', status: raw } }
  }

  configured(action: AccountActionReportAction): ActionReportStatusColumn[] {
    const campaigns = this.data.campaigns.filter(row => row.is_active !== false && row.is_delete !== true)
    const campaignIds = new Set(campaigns.filter(row => {
      // Quota metadata can omit unmetered/optional executable actions.
      const codes = [
        ...(Array.isArray(row.supported_action_codes) ? row.supported_action_codes : []),
        ...(Array.isArray(row.limit_check_action_codes) ? row.limit_check_action_codes : [])
      ]
      return codes.includes(action.code) || this.data.mappings.some(mapping => mapping.campaign_action_id === row.id && mapping.action_code === action.code)
    }).map(row => row.id))
    const mappings = this.data.mappings.filter(row => row.is_active === true && row.is_delete === false
      && campaignIds.has(row.campaign_action_id) && (row.action_code === action.code || row.action_code == null))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id))
    const columns = new Map<string, ActionReportStatusColumn>()
    for (const mapping of mappings) {
      const column = this.column(mapping.status_id, mapping.status_value, action.flatformType)
      const status = column.selector.kind === 'status' ? this.byId.get(column.selector.statusId) : undefined
      if (status && (status.is_active === false || status.is_delete === true)) continue
      if (!columns.has(column.key)) columns.set(column.key, column)
    }
    return [PENDING_ACTION_REPORT_COLUMN, ...Array.from(columns.values())]
  }

  detailFilter(selector: ActionReportStatusSelector, platform: string, cursor?: string): string {
    let selected: string
    if (selector.kind === 'pending') selected = 'report_group.eq.pending'
    else {
      const predicates: string[] = []
      if (selector.kind === 'legacy') predicates.push(`and(status_id.is.null,status.eq.${quotePostgrestValue(selector.status)})`)
      else {
        predicates.push(`status_id.eq.${selector.statusId}`)
        const row = this.byId.get(selector.statusId)
        if (typeof row?.status_value === 'string' && Number(this.legacyStatus(row.status_value, platform)?.id) === selector.statusId) {
          predicates.push(`and(status_id.is.null,status.eq.${quotePostgrestValue(row.status_value)})`)
        }
      }
      selected = `and(or(report_group.is.null,report_group.neq.pending),or(${predicates.join(',')}))`
    }
    return cursor ? `and(${selected},or(${cursor}))` : selected
  }

  label(selector: ActionReportStatusSelector): string {
    return selector.kind === 'pending' ? 'Chờ xử lý' : selector.kind === 'legacy'
      ? selector.status || 'Chưa xác định' : String(this.byId.get(selector.statusId)?.name || 'Trạng thái đã lưu')
  }
}

/** Only narrow result rows are accumulated; pending totals come from the existing reader. */
export class ActionStatusReportBuilder {
  private readonly columns = new Map<string, Map<string, ActionReportStatusColumn>>()
  private readonly counts = new Map<number, Map<string, Record<string, number>>>()
  constructor(readonly catalog: ActionReportStatusCatalog) {}

  add(detail: { account_id: number | null; action_code: string | null; status: unknown; status_id?: unknown; report_group?: unknown }, platform: string): void {
    if (detail.report_group === 'pending') return
    const code = String(detail.action_code || '')
    const column = this.catalog.column(detail.status_id, detail.status, platform)
    let columns = this.columns.get(code)
    if (!columns) this.columns.set(code, columns = new Map())
    columns.set(column.key, column)
    let account = this.counts.get(Number(detail.account_id))
    if (!account) this.counts.set(Number(detail.account_id), account = new Map())
    let counts = account.get(code)
    if (!counts) account.set(code, counts = Object.create(null) as Record<string, number>)
    counts[column.key] = (counts[column.key] || 0) + 1
  }

  finish(base: AccountActionReportResult): AccountActionStatusReportResult {
    const actions = base.actions.map(action => {
      const statuses = this.catalog.configured(action)
      const configured = new Set(statuses.map(column => column.key))
      const historical = Array.from(this.columns.get(action.code)?.values() || []).filter(column => !configured.has(column.key))
        .sort((a, b) => a.label.localeCompare(b.label, 'vi') || a.key.localeCompare(b.key))
      return { ...action, statuses: [...statuses, ...historical] }
    })
    return { ...base, actions, rows: base.rows.map(row => ({
      account: row.account,
      countsByActionCode: Object.fromEntries(actions.map(action => [action.code, Object.fromEntries(action.statuses.map(column => [
        column.key, column.key === 'pending' ? row.countsByActionCode[action.code]?.pendingCount || 0
          : this.counts.get(row.account.id)?.get(action.code)?.[column.key] || 0
      ]))]))
    })) }
  }
}
