import {
  CAMPAIGN_RESULT_GROUPS_DESKTOP_PATH, CAMPAIGN_RESULT_GROUPS_NOT_READY, CAMPAIGN_RESULT_GROUPS_UNAVAILABLE,
  CampaignResultGroupsDesktopError, buildCampaignResultGroupsRequest, type CampaignResultGroupsDesktopAction
} from '../../shared/campaignResultGroupsDesktop'

/**
 * Khung "Sau khi chạy: đưa khách vào nhóm" gọi API Web (akaAgentWebApp `campaignResultGroups.desktop.routes.ts`) bằng token phiên
 * Desktop, như đường AI và ảnh Hỏi đáp AI. Mọi RPC của tính năng chỉ cấp cho `service_role` và phần bật đồng bộ (dựng quy trình,
 * mã kiểm, nguồn) nằm ở TypeScript của API, nên Desktop không gọi DB cho việc này.
 * Hợp đồng: `{ ok: true, data }` hoặc `{ ok: false, code, message }`. Không tự gửi lại; không hẹn giờ.
 * Tệp này không nhập Electron hay Supabase: nơi gọi truyền cách lấy token và `fetch`.
 */

/** `AKA_AGENT_CAMPAIGN_RESULT_GROUPS_API_URL` chỉ để kiểm thử hoặc triển khai riêng. */
export const CAMPAIGN_RESULT_GROUPS_API_URL = process.env.AKA_AGENT_CAMPAIGN_RESULT_GROUPS_API_URL
  || `https://agent.akabiz.net${CAMPAIGN_RESULT_GROUPS_DESKTOP_PATH}`

const TIMEOUT_MS = 30_000

export interface CampaignResultGroupsApiDeps {
  url: string
  token(signal: AbortSignal): Promise<string>
  fetch: typeof fetch
  timeoutMs?: number
}

const fail = (code: string, message?: string) => new CampaignResultGroupsDesktopError(code, message)
const SAFE_CODE = /^[a-z][a-z0-9_]{1,80}$/

function codeForStatus(status: number): string {
  // API Web chưa deploy bản có đường của Desktop.
  if (status === 404 || status === 405) return CAMPAIGN_RESULT_GROUPS_NOT_READY
  if (status === 401 || status === 403) return 'access_denied'
  return CAMPAIGN_RESULT_GROUPS_UNAVAILABLE
}

export async function callCampaignResultGroupsApi(
  deps: CampaignResultGroupsApiDeps,
  action: CampaignResultGroupsDesktopAction,
  payload: unknown
): Promise<unknown> {
  const request = buildCampaignResultGroupsRequest(action, payload)
  const signal = AbortSignal.timeout(deps.timeoutMs ?? TIMEOUT_MS)
  let token: string
  try {
    token = await deps.token(signal)
  } catch {
    throw fail(CAMPAIGN_RESULT_GROUPS_UNAVAILABLE)
  }
  let response: Response
  try {
    response = await deps.fetch(`${deps.url}${request.path}`, {
      method: request.method, signal, redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...(request.body ? { 'Content-Type': 'application/json' } : {}) },
      ...(request.body ? { body: JSON.stringify(request.body) } : {})
    })
  } catch {
    throw fail(CAMPAIGN_RESULT_GROUPS_UNAVAILABLE)
  }
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  const result = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  if (response.ok && result.ok === true) return result.data
  // Câu báo lỗi nghiệp vụ của API (nhóm không nhận được khách, chiến dịch không có khung…) là câu cho khách: giữ nguyên.
  if (result.ok === false && typeof result.code === 'string' && SAFE_CODE.test(result.code)) {
    const message = typeof result.message === 'string' && result.message.trim() && result.message.length <= 600 ? result.message : undefined
    throw fail(result.code, message)
  }
  // API cũ / cổng trung gian trả 404 không theo hợp đồng thì coi là chưa sẵn sàng; 404 theo hợp đồng là "không tìm thấy" thật.
  throw fail(codeForStatus(response.status))
}
