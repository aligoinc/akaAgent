import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { loadCurrentUserEffectiveEntitlements, loadCurrentUserZaloAccountCapabilities } from './entitlementRepository'
import { mapAccountFromDB } from '../mappers'
import { listCampaignSummariesForPage } from './campaignRepository'
import {
  DEFAULT_DESKTOP_POLLING, DESKTOP_POLL_KEYS, parseDesktopPollSeconds,
  type DesktopAccountSnapshot, type DesktopCampaignPage, type DesktopCampaignPageQuery,
  type DesktopCampaignSelection, type DesktopCampaignSelectionQuery, type DesktopPollingSettings
} from '../../../shared/desktopUiReads'

async function scope() {
  const user = requireCurrentUser()
  const auth = requireCurrentUserCredentials()
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  return {
    p_staff_id: user.staffId, p_organization_id: user.organizationId,
    p_auth_username: auth.username, p_auth_password: auth.password,
    p_access: { ...entitlements, ...loadCurrentUserZaloAccountCapabilities(), chatSync: user.isChatSync === true }
  }
}

export async function getDesktopPollingSettings(): Promise<DesktopPollingSettings> {
  requireCurrentUser()
  try {
    const { data, error } = await getSupabaseClient().from('auto_system_settings')
      .select('key,value').in('key', Object.values(DESKTOP_POLL_KEYS))
      .eq('is_active', true).eq('is_secret', false).abortSignal(AbortSignal.timeout(5_000))
    if (error) return { ...DEFAULT_DESKTOP_POLLING }
    const values = new Map((data || []).map(row => [row.key, row.value]))
    return {
      campaigns: parseDesktopPollSeconds(values.get(DESKTOP_POLL_KEYS.campaigns)),
      accounts: parseDesktopPollSeconds(values.get(DESKTOP_POLL_KEYS.accounts))
    }
  } catch { return { ...DEFAULT_DESKTOP_POLLING } }
}

function validateFilters(filters: DesktopCampaignPageQuery['filters']) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('Bộ lọc không hợp lệ.')
  for (const date of [filters.dateFrom, filters.dateTo]) {
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new Error('Ngày lọc không hợp lệ.')
  }
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw new Error('Khoảng ngày không hợp lệ.')
  for (const ids of [filters.accountIds, filters.actionIds, filters.platforms, filters.statuses]) {
    if (ids !== undefined && (!Array.isArray(ids) || ids.length > 10_000)) throw new Error('Bộ lọc quá lớn.')
  }
  if ((filters.search?.length || 0) > 500) throw new Error('Tên tìm kiếm quá dài.')
  return filters
}

export async function getDesktopCampaignPage(query: DesktopCampaignPageQuery): Promise<DesktopCampaignPage> {
  if (!Number.isInteger(query.page) || query.page < 1 || query.page > 100_000) throw new Error('Trang không hợp lệ.')
  if (query.drafts && (!Array.isArray(query.drafts) || query.drafts.length > 10_000)) throw new Error('Danh sách bản nháp quá lớn.')
  const { data, error } = await getSupabaseClient().rpc('aka_agent_desktop_campaign_page', {
    ...await scope(), p_filters: validateFilters(query.filters), p_page: query.page,
    p_selected_id: query.selectedId ?? null, p_drafts: (query.drafts ?? []).map(draft => ({
      id: draft.id, schedule: Number.isFinite(Date.parse(draft.schedule)) ? new Date(draft.schedule).toISOString() : null
    }))
  }).abortSignal(AbortSignal.timeout(60_000))
  if (error) throw new Error(`Không thể tải trang chiến dịch: ${error.message}`)
  const result = data as Omit<DesktopCampaignPage, 'items' | 'selected'> & { ids: number[]; selectedId: number | null }
  const ids = [...new Set([...result.ids, ...(result.selectedId ? [result.selectedId] : [])])]
  const rows = await listCampaignSummariesForPage(ids)
  const byId = new Map(rows.map(row => [row.id, row]))
  return {
    page: result.page, pageSize: 100, total: result.total, campaignTotal: result.campaignTotal, order: result.order, actionOptions: result.actionOptions, runningCampaigns: result.runningCampaigns, extraAccounts: result.extraAccounts,
    items: result.ids.flatMap(id => byId.has(id) ? [byId.get(id)!] : []),
    selected: result.selectedId ? byId.get(result.selectedId) ?? null : null
  }
}

export async function getDesktopCampaignSelection(query: DesktopCampaignSelectionQuery): Promise<DesktopCampaignSelection[]> {
  if (query.ids && (!Array.isArray(query.ids) || query.ids.length > 500)) throw new Error('Tối đa 500 ID mỗi lượt.')
  const { data, error } = await getSupabaseClient().rpc('aka_agent_desktop_campaign_page', {
    ...await scope(), p_filters: validateFilters(query.filters), p_selection: true,
    p_ids: query.ids ?? null, p_after_id: query.afterId ?? 0
  }).abortSignal(AbortSignal.timeout(60_000))
  if (error) throw new Error(`Không thể đọc lựa chọn chiến dịch: ${error.message}`)
  return data.items
}

export async function getDesktopAccountSnapshot(version?: string): Promise<DesktopAccountSnapshot> {
  if (version !== undefined && !/^[a-f0-9]{32}$/.test(version)) throw new Error('Phiên bản tài khoản không hợp lệ.')
  const { data, error } = await getSupabaseClient().rpc('aka_agent_desktop_account_snapshot', {
    ...await scope(), p_catalog_version: version ?? null
  }).abortSignal(AbortSignal.timeout(60_000))
  if (error) throw new Error(`Không thể tải tài khoản: ${error.message}`)
  return {
    version: data.version, states: data.states,
    catalog: data.catalog === null ? null : data.catalog.map((row: Record<string, unknown>) => mapAccountFromDB(row))
  }
}

export async function getDesktopCampaignSources(id: number): Promise<number[]> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('ID chiến dịch không hợp lệ.')
  const user = requireCurrentUser()
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  if (!entitlements.facebookCore) return []
  const targetFields: Record<string, string> = {
    facebook_message_uid: 'findUidTargetCampaignIds', facebook_comment_seeding_post: 'findPostLinkTargetCampaignIds',
    zalo_message_phone: 'findPhoneZaloMessagePhoneTargetCampaignIds', zalo_join_group_link: 'findZaloGroupLinkJoinTargetCampaignIds',
    facebook_group_post: 'findFacebookGroupPostTargetCampaignIds', facebook_comment_seeding: 'findFacebookGroupCommentTargetCampaignIds',
    facebook_join_group: 'findFacebookGroupJoinTargetCampaignIds'
  }
  const { data: target, error: targetError } = await getSupabaseClient().from('auto_campaigns').select('action_id')
    .eq('id', id).eq('staff_id', user.staffId).eq('organization_id', user.organizationId).eq('is_delete', false)
    .abortSignal(AbortSignal.timeout(60_000)).maybeSingle()
  if (targetError) throw new Error(`Không thể tải chiến dịch liên kết: ${targetError.message}`)
  const field = target && targetFields[target.action_id]
  if (!field) return []
  const ids: number[] = []
  let afterId = 0
  while (true) {
    const { data, error } = await getSupabaseClient().from('auto_campaigns').select('id')
      .eq('staff_id', user.staffId).eq('organization_id', user.organizationId).eq('is_delete', false)
      .in('action_id', ['facebook_find_data_group', 'facebook_find_data_search'])
      .contains(`extra_settings->${field}`, [id])
      .gt('id', afterId).order('id').limit(1000).abortSignal(AbortSignal.timeout(60_000))
    if (error) throw new Error(`Không thể tải chiến dịch nguồn: ${error.message}`)
    if (!data?.length) return ids
    ids.push(...data.map(row => Number(row.id)))
    afterId = ids[ids.length - 1]
  }
}
