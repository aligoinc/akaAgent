import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { emptyWebEnrichmentConfig, validateWebEnrichment, type WebEnrichmentSettings } from '../../../shared/facebookWebEnrichment'

export async function webEnrichmentRpc(accountId: number, operation: 'get' | 'save', input?: unknown): Promise<WebEnrichmentSettings> {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('Tài khoản không hợp lệ.')
  const user = requireCurrentUser(), auth = requireCurrentUserCredentials()
  const settings = operation === 'save' ? validateWebEnrichment(input) : {}
  const { data, error } = await getSupabaseClient().rpc('aka_agent_facebook_web_enrichment_settings', {
    p_staff_id: user.staffId, p_organization_id: user.organizationId, p_auth_username: auth.username,
    p_auth_password: auth.password, p_account_id: accountId, p_operation: operation, p_input: settings
  }).abortSignal(AbortSignal.timeout(15_000))
  if (error) {
    if (error.message.includes('web_enrichment_conflict')) throw new Error('Cấu hình đã thay đổi trên máy khác. Hãy tải lại trước khi lưu.')
    if (error.message.includes('web_enrichment_feature')) throw new Error('Gói Facebook không còn hiệu lực.')
    throw new Error(`Không thể ${operation === 'get' ? 'tải' : 'lưu'} cài đặt: ${error.message}`)
  }
  return { enabled: data.enabled === true, config: data.config ?? emptyWebEnrichmentConfig() }
}
