import type { SupabaseClient } from '@supabase/supabase-js'

/** Whole report operation cap, with transport margin over the DB statement limit. */
export const REPORT_READ_TIMEOUT_MS = 65_000
export interface ReportReadScope {
  staffId: number
  organizationId: number
  username?: string
  password?: string
}
export interface ReportPageQuery {
  source: 'results' | 'pending'
  view: 'summary' | 'details'
  accountIds: number[]
  campaignIds?: number[]
  actionCodes: string[]
  startIso: string
  endIso: string
  limit?: number
  offset?: number
  head?: boolean
  count?: boolean
  requireCampaign?: boolean
  ownSchedule?: boolean
  afterId?: number
  afterCreatedAt?: string
  afterCampaignId?: number
  filter?: Record<string, unknown>
}
export async function readReportPage<T>(
  client: SupabaseClient, scope: ReportReadScope, query: ReportPageQuery, signal: AbortSignal
): Promise<{ rows: T[]; count: number | null }> {
  const { data, error } = await client.rpc('aka_agent_read_report_page', {
    p_staff_id: scope.staffId, p_organization_id: scope.organizationId,
    p_auth_username: scope.username ?? null, p_auth_password: scope.password ?? null, p_query: query
  }).abortSignal(signal)
  if (error) throw new Error(`Không thể tải dữ liệu báo cáo: ${error.message}`)
  if (!data || !Array.isArray(data.rows)
    || (data.count !== null && (!Number.isSafeInteger(data.count) || data.count < 0))) {
    throw new Error('Dữ liệu trang báo cáo không hợp lệ.')
  }
  return data as { rows: T[]; count: number | null }
}
