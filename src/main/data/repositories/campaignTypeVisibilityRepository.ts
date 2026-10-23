import { isCampaignTypeVisibilitySnapshot, validateCampaignVisibilityChanges, type CampaignVisibilityChange, type CampaignTypeVisibilityResult } from '../../../shared/campaignTypeVisibility'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'
import { loadCurrentUserEffectiveEntitlements, loadCurrentUserZaloAccountCapabilities } from './entitlementRepository'

async function invoke(operation: 'get' | 'patch', includeCatalog: boolean, changes: CampaignVisibilityChange[] = []): Promise<CampaignTypeVisibilityResult> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  if (operation === 'patch') validateCampaignVisibilityChanges(changes)
  const access = { ...await loadCurrentUserEffectiveEntitlements(), ...loadCurrentUserZaloAccountCapabilities() }
  if (getCurrentUser()?.staffId !== user.staffId || getCurrentUser()?.organizationId !== user.organizationId
    || getCurrentUserCredentials() !== credentials) throw new Error('Phiên đăng nhập đã thay đổi.')
  const { data, error } = await getSupabaseClient().rpc('aka_agent_campaign_type_visibility', {
    p_staff_id: user.staffId, p_organization_id: user.organizationId,
    p_auth_username: credentials.username, p_auth_password: credentials.password,
    p_access: access, p_operation: operation, p_changes: changes, p_include_catalog: includeCatalog
  }).abortSignal(AbortSignal.timeout(15_000))
  const current = getCurrentUser()
  if (current?.staffId !== user.staffId || current.organizationId !== user.organizationId
    || getCurrentUserCredentials() !== credentials) throw new Error('Phiên đăng nhập đã thay đổi.')
  if (error?.message.includes('visibility_access_denied')) throw new Error('Chỉ quản trị tổ chức được thay đổi cài đặt hiển thị.')
  if (error?.message.includes('visibility_invalid')) throw new Error('Loại chiến dịch không còn hợp lệ. Hãy mở lại cài đặt.')
  if (error || !isCampaignTypeVisibilitySnapshot(data) || data.organizationId !== user.organizationId) {
    throw new Error(operation === 'get' ? 'Không thể tải cài đặt hiển thị. Vui lòng thử lại.' : 'Chưa xác nhận được kết quả lưu. Vui lòng thử lại.')
  }
  if (includeCatalog && !Array.isArray((data as CampaignTypeVisibilityResult).catalog)) throw new Error('Không thể tải danh mục loại chiến dịch.')
  return data
}

export const getCampaignTypeVisibility = (includeCatalog = false) => invoke('get', includeCatalog)
export const patchCampaignTypeVisibility = (changes: CampaignVisibilityChange[]) => invoke('patch', false, changes)
