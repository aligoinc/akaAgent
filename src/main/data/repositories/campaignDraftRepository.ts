import type { CampaignDraft, CampaignDraftPage, SaveCampaignDraftRequest, CompleteCampaignDraftRequest } from '../../../shared/campaignDrafts'
import { validateCampaignDraftPayload } from '../../../shared/campaignDrafts'
import { requireCurrentUser, requireCurrentUserCredentials } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'
import { getAccount } from './accountRepository'
import { ensureCurrentUserCanUseCampaignAction } from './entitlementRepository'

async function campaignDraftRpc<T>(operation: string, id: string | null, data: Record<string, unknown> = {}): Promise<T> {
  const user = requireCurrentUser()
  const credentials = requireCurrentUserCredentials()
  const { data: result, error } = await getSupabaseClient().rpc('aka_agent_campaign_drafts', {
    p_staff_id: user.staffId, p_organization_id: user.organizationId,
    p_auth_username: credentials.username, p_auth_password: credentials.password,
    p_operation: operation, p_draft_id: id, p_data: data
  })
  if (error) throw new Error(error.message)
  return result as T
}

export async function listCampaignDrafts(page = 1): Promise<CampaignDraftPage> {
  return campaignDraftRpc('list', null, { page: Math.max(1, Math.floor(Number(page) || 1)) })
}

export async function getCampaignDraft(id: string): Promise<CampaignDraft> {
  return campaignDraftRpc('get', id)
}

export async function saveCampaignDraft(request: SaveCampaignDraftRequest): Promise<CampaignDraft> {
  validateCampaignDraftPayload(request.payload)
  const form = request.payload.values.formData as { actionId: string; accountIds: number[] }
  await ensureCurrentUserCanUseCampaignAction(form.actionId)
  for (const id of form.accountIds) {
    if (!await getAccount(id)) throw new Error('Tài khoản không còn khả dụng. Vui lòng chọn lại.')
  }
  return campaignDraftRpc('save', request.id, { revision: request.revision, payload: request.payload })
}

export async function deleteCampaignDraft(id: string): Promise<void> {
  await campaignDraftRpc('delete', id)
}

export async function completeCampaignDraft(request: CompleteCampaignDraftRequest): Promise<void> {
  if (!Array.isArray(request.campaignIds) || request.campaignIds.length === 0
    || request.campaignIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('Danh sách chiến dịch đã tạo không hợp lệ.')
  }
  await campaignDraftRpc('complete', request.id, {
    revision: request.revision, campaignIds: request.campaignIds
  })
}
