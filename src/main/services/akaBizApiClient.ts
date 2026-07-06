import {
  AkaBizCampaignListItem,
  AkaBizCampaignListKind,
  AkaBizIntegrationKind,
  AkaBizSmsShopListItem,
  AkaBizStaffBasic
} from '../../shared/types'

const AKA_BIZ_API_BASE_URL = 'https://akabiz-api.vercel.app'
const AKA_BIZ_LEGACY_API_BASE_URL = 'https://api.akaapp.vn'
const AKA_BIZ_RUNTIME_API_BASE_URL = 'https://app.akabiz.net'

interface AkaBizApiResponse<T = unknown> {
  status: number
  errorCode?: number
  message?: string
  data?: T
}

export interface AkaBizCampaignSummary {
  id: number
  name: string | null
  shopId: number
  campaignActionId: string | null
  status: string | null
  contentMessage: string | null
  isDelete: boolean | null
}

export interface AkaBizZaloCampaignDetailInput {
  campaignId: number
  status?: number | null
  name?: string | null
  uid?: string | null
  phone?: string | null
  postLink?: string | null
  actionName?: string | null
  contentMessage?: string | null
  isAutomate?: boolean | null
}

function apiPath(path: string, baseUrl = AKA_BIZ_API_BASE_URL): string {
  return `${baseUrl}${path}`
}

async function requestJson<T>(path: string, init?: RequestInit, baseUrl?: string): Promise<T> {
  const response = await fetch(apiPath(path, baseUrl), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    },
    signal: init?.signal ?? AbortSignal.timeout(30000)
  })
  let payload: AkaBizApiResponse<T> | null = null
  try {
    payload = await response.json() as AkaBizApiResponse<T>
  } catch {
    // Let the HTTP status error below carry the failure.
  }

  if (!response.ok) {
    throw new Error(payload?.message || `akaBizApi HTTP ${response.status}`)
  }
  if (!payload) throw new Error('akaBizApi trả về dữ liệu không hợp lệ')
  if (payload.status !== 1) {
    throw new Error(payload.message || 'akaBizApi xử lý thất bại')
  }
  return payload.data as T
}

function normalizeStaff(kind: AkaBizIntegrationKind, username: string, staff: any): AkaBizStaffBasic {
  const id = Number(staff?.id)
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(
      kind === 'sms'
        ? 'Không tìm thấy tài khoản akaBiz Sms'
        : kind === 'akaBizDesktop'
          ? 'Không tìm thấy tài khoản akaBiz Desktop'
          : 'Không tìm thấy tài khoản akaBiz Zalo Web'
    )
  }
  return {
    id,
    staffId: id,
    username,
    name: staff?.name === null || staff?.name === undefined ? null : String(staff.name)
  }
}

export async function lookupAkaBizStaff(kind: AkaBizIntegrationKind, username: string): Promise<AkaBizStaffBasic> {
  const trimmed = username.trim()
  if (!trimmed) throw new Error('Vui lòng nhập username.')
  const path = kind === 'sms' ? '/api/sms/staff' : '/api/zalo/staff'
  const staff = await requestJson<unknown>(`${path}?username=${encodeURIComponent(trimmed)}`)
  return normalizeStaff(kind, trimmed, staff)
}

export async function listAkaBizCampaigns(kind: AkaBizCampaignListKind, staffId: number): Promise<AkaBizCampaignListItem[]> {
  const path = kind === 'sms'
    ? '/api/sms/campaigns'
    : kind === 'zaloPhone'
      ? '/api/zalo/campaigns/phone-imports'
      : '/api/zalo/campaigns/group-link-imports'
  const rows = await requestJson<AkaBizCampaignListItem[]>(`${path}?staffId=${encodeURIComponent(String(staffId))}`)
  const list = Array.isArray(rows) ? rows : []
  return Promise.all(list.map(async row => {
    try {
      const summary = kind === 'sms'
        ? await getSmsCampaign(row.id)
        : await getZaloCampaign(row.id)
      return { ...row, status: summary.status ?? null }
    } catch {
      return { ...row, status: row.status ?? null }
    }
  }))
}

export async function listAkaBizSmsShops(staffId: number): Promise<AkaBizSmsShopListItem[]> {
  const rows = await requestJson<AkaBizSmsShopListItem[]>(
    `/api/Shop/get?staffId=${encodeURIComponent(String(staffId))}&shopTypes=smsmobile`,
    undefined,
    AKA_BIZ_LEGACY_API_BASE_URL
  )
  return Array.isArray(rows) ? rows : []
}

export async function getZaloCampaign(campaignId: number): Promise<AkaBizCampaignSummary> {
  return requestJson<AkaBizCampaignSummary>(`/api/zalo/campaigns/${encodeURIComponent(String(campaignId))}`)
}

export async function updateZaloCampaignStatus(campaignId: number, status: string): Promise<void> {
  await requestJson(`/api/zalo/campaigns/${encodeURIComponent(String(campaignId))}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  })
}

export async function addZaloCampaignDetails(details: AkaBizZaloCampaignDetailInput[]): Promise<void> {
  if (details.length === 0) return
  await requestJson('/api/zalo/campaign-details', {
    method: 'POST',
    body: JSON.stringify(details)
  })
}

export async function getSmsCampaign(campaignId: number): Promise<AkaBizCampaignSummary> {
  return requestJson<AkaBizCampaignSummary>(`/api/sms/campaigns/${encodeURIComponent(String(campaignId))}`)
}

export async function addSmsCampaignDetail(input: {
  shopId: number
  campaignId: number
  phone: string
  name: string
  content: string
}): Promise<void> {
  await requestJson('/api/Campaign/addDetailToSendSms', {
    method: 'POST',
    body: JSON.stringify({
      shopId: input.shopId,
      campaignId: input.campaignId,
      phone: input.phone,
      content: input.content
    })
  }, AKA_BIZ_RUNTIME_API_BASE_URL)
}
