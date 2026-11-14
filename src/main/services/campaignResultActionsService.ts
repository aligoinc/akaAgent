import { getAccountActionName, getCampaignAccountOverviewActionDescriptors } from '../../shared/campaignActionDescriptors'
import {
  buildCampaignResultActionOptions, CAMPAIGN_RESULT_RECIPIENT_BATCH_SIZE, CAMPAIGN_RESULT_RECIPIENT_PAGE_SIZE, CAMPAIGN_RESULT_RECIPIENT_SORTS,
  CAMPAIGN_RESULT_RECIPIENTS_BUSY, parseCampaignResultActionsRpc, parseCampaignResultRecipientKeysRpc, parseCampaignResultRecipientsRpc,
  type CampaignResultActions, type CampaignResultRecipient, type CampaignResultRecipientKeys, type CampaignResultRecipientPage
} from '../../shared/campaignResultActions'
import type {
  CampaignResultActionsIpcRequest, CampaignResultActionsIpcResponses, CampaignResultActionsIpcResult, CampaignResultRecipientIpcQuery
} from '../../shared/campaignResultActionsIpc'
import type { Campaign } from '../../shared/types'
import { requireCurrentUser, runWithCurrentUser } from '../data/currentUser'
import { CampaignRunReportReadError, readCampaignRunReportCampaign } from '../data/repositories/campaignRunReportRepository'
import {
  CampaignResultActionsReadError, invalidResultQuery, readCampaignResultRecipientsRpc, resultRecipientsTimeout, resultRecipientsUnavailable
} from '../data/repositories/campaignResultActionsRepository'
import { ReportReadFlights } from '../domain/reports/reportReadFlights'
import { REPORT_READ_TIMEOUT_MS } from '../domain/reports/reportReadRpc'
import { FACEBOOK_WITHOUT_INPUT_DATA } from './campaignRunReportService'

/**
 * Bộ lọc "Hành động" và "Gộp hành động vào một dòng" ở tab Kết quả chạy (Desktop, docs/CAMPAIGN_RESULT_ACTION_FILTER_DESKTOP_V540.md).
 * Mỗi lượt: một lượt RPC chỉ đọc V539 qua client HTTP sẵn có của tiến trình (riêng danh sách hành động đọc thêm dòng chiến
 * dịch như tab Báo cáo để biết hành động đã cấu hình). Hạn cả lượt 65 s; gộp lượt trùng, tối đa 3 lượt khác nhau (cổng
 * riêng, không chặn báo cáo khác); không cache kết quả, không hẹn giờ. Renderer chỉ gọi khi người dùng thao tác.
 */
const flights = new ReportReadFlights(3)
const ENGAGEMENT_FILTERS = new Set(['all', 'seen', 'responded', 'reacted', 'friended', 'none'])
type Row = Record<string, unknown>

const positiveId = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

const isoDate = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined
  const date = new Date(String(value))
  if (typeof value !== 'string' || Number.isNaN(date.getTime())) throw invalidResultQuery(`${label} không hợp lệ.`)
  return date.toISOString()
}

/** `p_query` của hàm DB (bỏ khóa trống), cùng giới hạn với tab Kết quả chạy. */
export function campaignResultRecipientRpcQuery(mode: 'page' | 'keys', raw: CampaignResultRecipientIpcQuery | undefined): Row {
  const input = raw && typeof raw === 'object' ? raw : {}
  const sort = input.sort ?? 'processed_desc'
  if (!CAMPAIGN_RESULT_RECIPIENT_SORTS.includes(sort)) throw invalidResultQuery('Thứ tự sắp xếp không hợp lệ.')
  const engagement = input.engagementFilter ?? 'all'
  if (!ENGAGEMENT_FILTERS.has(engagement)) throw invalidResultQuery('Bộ lọc tương tác không hợp lệ.')
  const dateFrom = isoDate(input.dateFrom, 'Ngày bắt đầu')
  const dateTo = isoDate(input.dateTo, 'Ngày kết thúc')
  if (dateFrom && dateTo && dateFrom > dateTo) throw invalidResultQuery('Khoảng thời gian lọc không hợp lệ.')
  const query: Row = { mode, sort }
  const search = typeof input.search === 'string' ? input.search.trim().slice(0, 200) : ''
  const status = typeof input.status === 'string' ? input.status.trim().slice(0, 120) : ''
  if (search) query.search = search
  if (status) query.status = status
  if (engagement !== 'all') query.engagementFilter = engagement
  if (dateFrom) query.dateFrom = dateFrom
  if (dateTo) query.dateTo = dateTo
  return query
}

const parsed = <T>(parse: () => T): T => {
  try {
    return parse()
  } catch {
    throw resultRecipientsUnavailable()
  }
}

async function readActions(campaignId: number, signal: AbortSignal): Promise<CampaignResultActions> {
  const campaign = await readCampaignRunReportCampaign(campaignId, signal)
  const data = await readCampaignResultRecipientsRpc(campaignId, { mode: 'actions' }, signal)
  const actions = parsed(() => parseCampaignResultActionsRpc(data))
  const configured = getCampaignAccountOverviewActionDescriptors({
    actionId: campaign.actionId, extraSettings: campaign.extraSettings as Campaign['extraSettings']
  }).map(action => action.code)
  const codes = new Set<string>(configured)
  for (const row of actions.actions) if (row.code) codes.add(row.code)
  // Chỉ tên Desktop biết; mã lạ thì để hàm dựng lấy tên đã ghi trên lượt.
  const names = Object.fromEntries(Array.from(codes)
    .map(code => [code, getAccountActionName(code)] as const)
    .filter(([code, name]) => name && name !== code))
  return {
    campaignId,
    total: actions.total,
    usesInputData: campaign.platform !== 'facebook' || !FACEBOOK_WITHOUT_INPUT_DATA.has(campaign.actionId),
    actions: buildCampaignResultActionOptions({ configuredCodes: configured, recorded: actions.actions, names })
  }
}

async function readPage(campaignId: number, query: CampaignResultRecipientIpcQuery, page: number, pageSize: number, signal: AbortSignal): Promise<CampaignResultRecipientPage> {
  const data = await readCampaignResultRecipientsRpc(campaignId, {
    ...campaignResultRecipientRpcQuery('page', query), offset: (page - 1) * pageSize, limit: pageSize
  }, signal)
  const result = parsed(() => parseCampaignResultRecipientsRpc(data, 'page'))
  return { items: result.items, total: result.total ?? 0, page, pageSize }
}

async function readKeys(campaignId: number, query: CampaignResultRecipientIpcQuery, signal: AbortSignal): Promise<CampaignResultRecipientKeys> {
  const data = await readCampaignResultRecipientsRpc(campaignId, campaignResultRecipientRpcQuery('keys', query), signal)
  return parsed(() => parseCampaignResultRecipientKeysRpc(data))
}

async function readByKeys(campaignId: number, ids: number[], signal: AbortSignal): Promise<{ items: CampaignResultRecipient[] }> {
  const data = await readCampaignResultRecipientsRpc(campaignId, { mode: 'byKeys', ids }, signal)
  return { items: parsed(() => parseCampaignResultRecipientsRpc(data, 'byKeys')).items }
}

type Read<K extends keyof CampaignResultActionsIpcResponses> = (signal: AbortSignal) => Promise<CampaignResultActionsIpcResponses[K]>

/** Kiểm tra yêu cầu và chọn lượt đọc; lỗi đầu vào ném CampaignResultActionsReadError trước khi gọi DB. */
function plan(request: CampaignResultActionsIpcRequest): { campaignId: number; key: unknown; read: Read<keyof CampaignResultActionsIpcResponses> } {
  const campaignId = positiveId(request?.campaignId)
  if (!campaignId) throw new CampaignResultActionsReadError('invalid_campaign_id', 'ID chiến dịch không hợp lệ.')
  switch (request.kind) {
    case 'actions':
      return { campaignId, key: null, read: signal => readActions(campaignId, signal) }
    case 'page': {
      const page = positiveId(request.page ?? 1)
      const pageSize = positiveId(request.pageSize ?? CAMPAIGN_RESULT_RECIPIENT_PAGE_SIZE)
      if (!page || page > 1_000_000) throw invalidResultQuery('Trang không hợp lệ.')
      if (!pageSize || pageSize > CAMPAIGN_RESULT_RECIPIENT_PAGE_SIZE) throw invalidResultQuery('Số dòng mỗi trang không hợp lệ.')
      campaignResultRecipientRpcQuery('page', request.query)
      return { campaignId, key: [request.query ?? {}, page, pageSize], read: signal => readPage(campaignId, request.query, page, pageSize, signal) }
    }
    case 'keys':
      campaignResultRecipientRpcQuery('keys', request.query)
      return { campaignId, key: request.query ?? {}, read: signal => readKeys(campaignId, request.query, signal) }
    case 'byKeys': {
      const ids = request.ids
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > CAMPAIGN_RESULT_RECIPIENT_BATCH_SIZE
        || ids.some(value => !Number.isSafeInteger(value) || value < 1) || new Set(ids).size !== ids.length) {
        throw invalidResultQuery(`Chọn từ 1 đến ${CAMPAIGN_RESULT_RECIPIENT_BATCH_SIZE} data khác nhau.`)
      }
      return { campaignId, key: ids, read: signal => readByKeys(campaignId, ids, signal) }
    }
    default:
      throw invalidResultQuery()
  }
}

export async function handleCampaignResultActionsRequest<R extends CampaignResultActionsIpcRequest>(
  request: R
): Promise<CampaignResultActionsIpcResult<CampaignResultActionsIpcResponses[R['kind']]>> {
  try {
    const { campaignId, key, read } = plan(request)
    const user = requireCurrentUser()
    const flightKey = JSON.stringify(['campaign-result-actions', user.staffId, user.organizationId, campaignId, request.kind, key])
    const data = await runWithCurrentUser(user, () => flights.run(flightKey, () => read(AbortSignal.timeout(REPORT_READ_TIMEOUT_MS))))
    return { ok: true, data: data as CampaignResultActionsIpcResponses[R['kind']] }
  } catch (error) {
    if (error instanceof CampaignResultActionsReadError) return { ok: false, code: error.code, message: error.message }
    if (error instanceof CampaignRunReportReadError) {
      // Lỗi đọc dòng chiến dịch (dùng chung với tab Báo cáo): giữ mã chiến dịch/phiên, còn lại nói theo bộ lọc này.
      if (error.code === 'campaign_not_found' || error.code === 'session_invalid') return { ok: false, code: error.code, message: error.message }
      const mapped = error.code === 'report_timeout' ? resultRecipientsTimeout() : resultRecipientsUnavailable()
      return { ok: false, code: mapped.code, message: mapped.message }
    }
    const message = error instanceof Error ? error.message : String(error)
    if (/Đang tải báo cáo khác/.test(message)) return { ok: false, code: 'campaign_result_recipients_busy', message: CAMPAIGN_RESULT_RECIPIENTS_BUSY }
    if (/chưa đăng nhập|đăng nhập lại|Not logged in/i.test(message)) {
      return { ok: false, code: 'session_invalid', message: 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.' }
    }
    console.warn('[campaignResultActions] request failed:', message)
    const fallback = resultRecipientsUnavailable()
    return { ok: false, code: fallback.code, message: fallback.message }
  }
}
