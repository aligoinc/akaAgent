import {
  parseCampaignResultGroupItem, parseCampaignResultGroupList, type CampaignResultGroupItem, type CampaignResultGroupList,
  type CampaignResultGroupOptions, type CampaignResultGroupStatusAction
} from '../../../../shared/campaignResultGroups'
import {
  CAMPAIGN_RESULT_GROUPS_NOT_READY, CAMPAIGN_RESULT_GROUPS_UNAVAILABLE, campaignResultGroupsErrorMessage,
  type CampaignResultGroupsDesktopAction
} from '../../../../shared/campaignResultGroupsDesktop'
import type { DataGroup } from '../../../../shared/types'

/**
 * Gọi khung "Sau khi chạy: đưa khách vào nhóm" qua IPC `campaign-result-groups:call` (tiến trình chính gọi API Web bằng token
 * phiên Desktop). IPC không hủy được giữa chừng; `signal` chỉ để bỏ qua kết quả về muộn.
 */
export class CampaignResultGroupsCallError extends Error {
  constructor(readonly code: string, message = campaignResultGroupsErrorMessage(code)) {
    super(message)
    this.name = 'CampaignResultGroupsCallError'
  }
}

export const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError'
export const isNotReadyError = (error: unknown): boolean =>
  error instanceof CampaignResultGroupsCallError && error.code === CAMPAIGN_RESULT_GROUPS_NOT_READY

/**
 * API chưa có đường của Desktop: nhớ trong lần mở app này (10 phút) để form sau ẩn khung ngay, không gọi lại vô ích.
 * Gọi được (kể cả lỗi khác) thì xóa dấu.
 */
let notReadyUntil = 0
export const campaignResultGroupsKnownNotReady = (): boolean => Date.now() < notReadyUntil

async function call<T>(action: CampaignResultGroupsDesktopAction, payload: Record<string, unknown> | undefined, parse: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
  const aborted = () => new DOMException('Aborted', 'AbortError')
  if (signal?.aborted) throw aborted()
  const bridge = window.electronAPI?.campaignResultGroupsCall
  if (!bridge) throw new CampaignResultGroupsCallError(CAMPAIGN_RESULT_GROUPS_NOT_READY)
  let result: Awaited<ReturnType<typeof bridge>>
  try {
    result = await bridge(action, payload)
  } catch {
    throw new CampaignResultGroupsCallError(CAMPAIGN_RESULT_GROUPS_UNAVAILABLE)
  }
  if (signal?.aborted) throw aborted()
  if (!result.ok) {
    if (result.code === CAMPAIGN_RESULT_GROUPS_NOT_READY) notReadyUntil = Date.now() + 10 * 60_000
    throw new CampaignResultGroupsCallError(result.code, result.message)
  }
  notReadyUntil = 0
  return parse(result.data)
}

const parseOptions = (value: unknown): CampaignResultGroupOptions & { enabled?: boolean } => {
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value as CampaignResultGroupOptions & { enabled?: boolean } : null
  if (!data || !Array.isArray(data.actions)) throw new CampaignResultGroupsCallError(CAMPAIGN_RESULT_GROUPS_UNAVAILABLE, 'Chưa tải được danh sách kết quả.')
  return data
}
const parseItem = (value: unknown): CampaignResultGroupItem => {
  const item = parseCampaignResultGroupItem(value)
  if (!item) throw new CampaignResultGroupsCallError(CAMPAIGN_RESULT_GROUPS_UNAVAILABLE, 'Không đổi được trạng thái đồng bộ.')
  return item
}

export const campaignResultGroupsClient = {
  options: (actionId: string, accountIds: number[], signal?: AbortSignal) => call('options', { actionId, accountIds }, parseOptions, signal),
  list: (campaignId: number, signal?: AbortSignal): Promise<CampaignResultGroupList> => call('list', { campaignId }, parseCampaignResultGroupList, signal),
  listAll: (signal?: AbortSignal): Promise<CampaignResultGroupList> => call('listAll', undefined, parseCampaignResultGroupList, signal),
  save: (campaignId: number, body: { requestId: string; rows: Array<{ groupId: number; keys: string[] }>; includeExisting?: boolean }, signal?: AbortSignal) =>
    call('save', { campaignId, ...body }, parseCampaignResultGroupList, signal),
  setStatus: (campaignId: number, journeyId: number, body: { action: CampaignResultGroupStatusAction; includePaused?: boolean }, signal?: AbortSignal) =>
    call('setStatus', { campaignId, journeyId, ...body }, parseItem, signal)
}

/** Nhóm data của chính nhân viên (nhóm được chia sẻ không nhận khách từ chiến dịch của người khác). Tối đa 2.000 nhóm. */
export async function listOwnDataGroups(): Promise<DataGroup[]> {
  const groups: DataGroup[] = []
  const limit = 200
  for (let offset = 0; offset < 2000; offset += limit) {
    const page = await window.electronAPI.listDataGroups({ ownedOnly: true, offset, limit })
    groups.push(...page.groups.filter(group => !group.isDelete))
    if (page.groups.length < limit || groups.length >= page.total) break
  }
  return groups
}
