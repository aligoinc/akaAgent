import type { EffectivenessPlatform } from '../../../shared/campaignEffectiveness'
import type { EffectivenessCampaignMeta } from '../../../shared/campaignEffectivenessAssembly'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'
import * as accountActionRepo from './accountActionRepository'
import { canUseAccountPlatformWithEntitlements, loadCurrentUserEffectiveEntitlements } from './entitlementRepository'

const client = () => getSupabaseClient()
type Row = Record<string, unknown>

export interface EffectivenessAccountRef { id: number; name: string; flatformType: string }
export interface EffectivenessActionRef { code: string; name: string; flatformType: string }

/** RPC/DB failures with a stable code the renderer can show without technical details. */
export class EffectivenessReadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'EffectivenessReadError'
  }
}

function readError(error: { code?: string; message?: string }): EffectivenessReadError {
  const code = String(error.code || '')
  const message = String(error.message || '')
  if (code === 'PGRST202' || code === '42883' || /aka_agent_read_campaign_effectiveness/.test(message) && /not find|does not exist/i.test(message)) {
    return new EffectivenessReadError('effectiveness_not_ready', 'Báo cáo hiệu quả đang được cập nhật. Vui lòng thử lại sau.')
  }
  if (code === '42501') return new EffectivenessReadError('report_access_denied', 'Không có quyền xem báo cáo này.')
  if (code === '22023') return new EffectivenessReadError('invalid_report_query', 'Bộ lọc báo cáo không hợp lệ.')
  if (code === '57014') return new EffectivenessReadError('report_timeout', 'Báo cáo mất quá nhiều thời gian. Vui lòng chọn khoảng thời gian ngắn hơn.')
  if (/automation_auth/.test(message)) {
    return new EffectivenessReadError('session_invalid', 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.')
  }
  return new EffectivenessReadError('report_failed', 'Không thể tải báo cáo hiệu quả. Vui lòng thử lại.')
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

/** Platforms of the current staff that can be reported (same entitlement rule as the account report). */
export async function listEffectivenessPlatforms(): Promise<EffectivenessPlatform[]> {
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  return (['facebook', 'zalo', 'email', 'sms'] as const).filter(platform => canUseAccountPlatformWithEntitlements(platform, entitlements))
}

/**
 * Accounts and actions in scope: the staff's non-deleted accounts on entitled platforms (optionally one platform
 * and/or chosen ids) and the active action catalog of those platforms.
 */
export async function loadEffectivenessScope(platform: EffectivenessPlatform | undefined, accountIds: number[] | undefined,
  signal: AbortSignal): Promise<{ accounts: EffectivenessAccountRef[]; actions: EffectivenessActionRef[] }> {
  const user = requireCurrentUser()
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const platforms = (platform ? [platform] : await listEffectivenessPlatforms())
    .filter(item => canUseAccountPlatformWithEntitlements(item, entitlements))
  if (!platforms.length || accountIds?.length === 0) return { accounts: [], actions: [] }
  const actionLists = await Promise.all(platforms.map(item => accountActionRepo.listAccountActions(item)))
  const actions = actionLists.flat().map(action => ({ code: action.code, name: action.name, flatformType: String(action.flatformType || '') }))
  const accounts: EffectivenessAccountRef[] = []
  for (let afterId = 0; ;) {
    let request = client().from('auto_accounts').select('id,name,flatform_type')
      .eq('staff_id', user.staffId).eq('organization_id', user.organizationId).eq('is_delete', false)
      .in('flatform_type', platforms).gt('id', afterId).order('id').limit(1000)
    if (accountIds) request = request.in('id', accountIds)
    const { data, error } = await request.abortSignal(signal)
    if (error) throw readError(error)
    const page = (data || []) as Row[]
    for (const row of page) {
      const flatformType = String(row.flatform_type || '')
      if (canUseAccountPlatformWithEntitlements(flatformType, entitlements)) {
        accounts.push({ id: Number(row.id), name: String(row.name || ''), flatformType })
      }
    }
    if (page.length < 1000) break
    afterId = Number(page[page.length - 1].id)
  }
  accounts.sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  return { accounts, actions }
}

/** V462 reader with the Desktop token and the automation credentials (same identity rule as report pages). */
export async function readCampaignEffectiveness<T>(query: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  const { data, error } = await client().rpc('aka_agent_read_campaign_effectiveness', {
    p_staff_id: user.staffId, p_organization_id: user.organizationId,
    p_auth_username: credentials.username, p_auth_password: credentials.password, p_query: query
  }).abortSignal(signal)
  if (error) throw readError(error)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new EffectivenessReadError('report_failed', 'Dữ liệu báo cáo hiệu quả không hợp lệ.')
  }
  return data as T
}

export async function loadEffectivenessCampaigns(ids: number[], signal: AbortSignal): Promise<EffectivenessCampaignMeta[]> {
  const user = requireCurrentUser()
  const rows: Row[] = []
  for (const batch of chunk([...new Set(ids)], 200)) {
    const { data, error } = await client().from('auto_campaigns').select('id,name,action_id,status,account_id,is_delete')
      .eq('staff_id', user.staffId).eq('organization_id', user.organizationId).in('id', batch).abortSignal(signal)
    if (error) throw readError(error)
    rows.push(...((data || []) as Row[]))
  }
  const actionIds = [...new Set(rows.map(row => String(row.action_id || '')).filter(Boolean))]
  const names = new Map<string, string>()
  if (actionIds.length) {
    const { data, error } = await client().from('auto_campaign_actions').select('id,name').in('id', actionIds).abortSignal(signal)
    if (error) throw readError(error)
    for (const row of (data || []) as Row[]) names.set(String(row.id), String(row.name || ''))
  }
  return rows.map(row => ({
    id: Number(row.id), name: String(row.name || ''), actionId: String(row.action_id || ''),
    actionName: names.get(String(row.action_id || '')) || String(row.action_id || ''),
    status: String(row.status || ''), accountId: Number(row.account_id), isDeleted: row.is_delete === true
  }))
}

/** HEAD counts only (no rows downloaded) of the data the staff has built in the app. */
export async function countEffectivenessAssets(signal: AbortSignal): Promise<{
  dataGroups: number; zaloContacts: number; tags: number; contentTemplates: number
}> {
  const user = requireCurrentUser()
  const count = async (request: PromiseLike<{ count: number | null; error: { code?: string; message?: string } | null }>) => {
    const { count: value, error } = await request
    if (error) throw readError(error)
    return value || 0
  }
  const owned = (table: string) => client().from(table).select('id', { count: 'exact', head: true })
    .eq('staff_id', user.staffId).eq('organization_id', user.organizationId).eq('is_delete', false)
  const dataGroups = await count(owned('auto_account_contact_groups').eq('purpose', 'data_group').abortSignal(signal))
  // Desktop scans Facebook and Zalo contacts; both count as data built in the app.
  const zaloContacts = await count(owned('auto_account_contacts').abortSignal(signal))
  const tags = await count(owned('auto_contact_tags').abortSignal(signal))
  const contentTemplates = await count(owned('auto_content_templates').abortSignal(signal))
  return { dataGroups, zaloContacts, tags, contentTemplates }
}
