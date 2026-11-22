// Phần riêng của Desktop cho khung "Sau khi chạy: đưa khách vào nhóm" và thẻ Tự động hóa › Từ chiến dịch.
// `campaignResultGroups.ts` chép nguyên văn akaAgentWebApp `packages/control-api/src/campaignResultGroups.ts` (sửa ở WebApp
// trước rồi chép lại); tệp này chỉ nối hợp đồng đó với IPC và đường API Desktop
// (`/api/aka-agent/desktop/v1/campaign-result-groups`, akaAgentWebApp `campaignResultGroups.desktop.routes.ts`).

export const CAMPAIGN_RESULT_GROUPS_IPC = 'campaign-result-groups:call' as const

/** Đường của API Web cho Desktop (token phiên Desktop). */
export const CAMPAIGN_RESULT_GROUPS_DESKTOP_PATH = '/api/aka-agent/desktop/v1/campaign-result-groups'

export const CAMPAIGN_RESULT_GROUPS_DESKTOP_ACTIONS = ['options', 'list', 'listAll', 'save', 'setStatus'] as const
export type CampaignResultGroupsDesktopAction = (typeof CAMPAIGN_RESULT_GROUPS_DESKTOP_ACTIONS)[number]

/** API chưa có đường của Desktop (chưa deploy): giao diện ẩn cả khung, không báo lỗi. */
export const CAMPAIGN_RESULT_GROUPS_NOT_READY = 'campaign_result_groups_not_ready'
export const CAMPAIGN_RESULT_GROUPS_UNAVAILABLE = 'campaign_result_groups_unavailable'

export type CampaignResultGroupsIpcResult = { ok: true; data: unknown } | { ok: false; code: string; message: string }

export interface CampaignResultGroupsOptionsPayload { actionId: string; accountIds?: number[] }
export interface CampaignResultGroupsCampaignPayload { campaignId: number }
export interface CampaignResultGroupsSavePayload {
  campaignId: number
  requestId: string
  includeExisting?: boolean
  rows: Array<{ groupId: number; keys: string[] }>
}
export interface CampaignResultGroupsStatusPayload {
  campaignId: number
  journeyId: number
  action: 'pause' | 'resume' | 'stop'
  includePaused?: boolean
}

export interface CampaignResultGroupsDesktopRequest {
  method: 'GET' | 'PUT' | 'POST'
  path: string
  body?: Record<string, unknown>
}

const MESSAGES: Record<string, string> = {
  [CAMPAIGN_RESULT_GROUPS_NOT_READY]: 'Tính năng đưa khách vào nhóm đang được cập nhật trên máy chủ.',
  [CAMPAIGN_RESULT_GROUPS_UNAVAILABLE]: 'Chưa kết nối được máy chủ. Vui lòng thử lại.',
  access_denied: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
  campaign_result_groups_invalid_request: 'Yêu cầu không hợp lệ.'
}

export const campaignResultGroupsErrorMessage = (code: string): string =>
  MESSAGES[code] ?? MESSAGES[CAMPAIGN_RESULT_GROUPS_UNAVAILABLE]

export class CampaignResultGroupsDesktopError extends Error {
  constructor(readonly code: string, message = campaignResultGroupsErrorMessage(code)) {
    super(message)
    this.name = 'CampaignResultGroupsDesktopError'
  }
}

export function isCampaignResultGroupsDesktopAction(value: unknown): value is CampaignResultGroupsDesktopAction {
  return typeof value === 'string' && (CAMPAIGN_RESULT_GROUPS_DESKTOP_ACTIONS as readonly string[]).includes(value)
}

const positiveId = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null

const invalid = () => new CampaignResultGroupsDesktopError('campaign_result_groups_invalid_request')

/**
 * Đổi (action, payload) của renderer thành đúng một yêu cầu tới API. Ném `campaign_result_groups_invalid_request` khi payload
 * sai khuôn; phần kiểm nghiệp vụ (nhóm của ai, khóa kết quả nào được chọn) do API và RPC làm.
 */
export function buildCampaignResultGroupsRequest(action: CampaignResultGroupsDesktopAction, payload: unknown): CampaignResultGroupsDesktopRequest {
  const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {}
  if (action === 'listAll') return { method: 'GET', path: '' }
  if (action === 'options') {
    const actionId = typeof input.actionId === 'string' ? input.actionId.trim() : ''
    if (!/^[a-z][a-z0-9_]{1,79}$/.test(actionId)) throw invalid()
    const raw = Array.isArray(input.accountIds) ? input.accountIds : []
    const ids = Array.from(new Set(raw.map(positiveId).filter((id): id is number => id !== null))).sort((a, b) => a - b).slice(0, 50)
    const query = new URLSearchParams({ actionId })
    if (ids.length) query.set('accountIds', ids.join(','))
    return { method: 'GET', path: `/options?${query.toString()}` }
  }
  const campaignId = positiveId(input.campaignId)
  if (!campaignId) throw invalid()
  if (action === 'list') return { method: 'GET', path: `/campaigns/${campaignId}` }
  if (action === 'save') {
    const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : ''
    if (!requestId || requestId.length > 200 || !Array.isArray(input.rows) || input.rows.length > 5) throw invalid()
    const rows = input.rows.map(row => {
      const item = row && typeof row === 'object' ? row as Record<string, unknown> : {}
      const groupId = positiveId(item.groupId)
      const keys = Array.isArray(item.keys) ? item.keys.filter((key): key is string => typeof key === 'string' && key.length >= 3 && key.length <= 100) : []
      if (!groupId || keys.length === 0 || keys.length > 30) throw invalid()
      return { groupId, keys }
    })
    return { method: 'PUT', path: `/campaigns/${campaignId}`, body: { requestId, rows, ...(input.includeExisting === true ? { includeExisting: true } : {}) } }
  }
  const journeyId = positiveId(input.journeyId)
  const statusAction = input.action
  if (!journeyId || (statusAction !== 'pause' && statusAction !== 'resume' && statusAction !== 'stop')) throw invalid()
  return {
    method: 'POST',
    path: `/campaigns/${campaignId}/${journeyId}/status`,
    body: { action: statusAction, ...(statusAction === 'resume' ? { includePaused: input.includePaused === true } : {}) }
  }
}
