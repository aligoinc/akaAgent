/**
 * Hợp đồng của `aka_agent_find_data_push_v1` (V608, docs/FIND_DATA_PUSH_LINKS_V608.md): Desktop gửi data tìm được của một lượt
 * "Tìm data", DB kiểm từng chiến dịch đích theo `auto_campaign_data_link_rules`, lọc trùng theo data đang có ở đích + sổ đẩy,
 * thêm dòng "chờ xử lý", mở lại đích "hoàn thành", trả kết quả từng đích để in tiến trình.
 */
import type { FindDataOutputKind } from './types'

export const FIND_DATA_PUSH_RPC = 'aka_agent_find_data_push_v1'
/** Trần số data mỗi lần gọi (DB từ chối khi vượt). */
export const FIND_DATA_PUSH_MAX_ITEMS = 5000

/** Loại chiến dịch có thể nhận data từ chiến dịch tìm data (để gửi danh sách loại được phép theo gói). */
export const FIND_DATA_PUSH_TARGET_ACTION_IDS = [
  'facebook_message_uid',
  'facebook_comment_seeding_post',
  'zalo_message_phone',
  'zalo_join_group_link',
  'facebook_group_post',
  'facebook_comment_seeding',
  'facebook_join_group'
] as const

export interface FindDataPushItem {
  value: string
  key: string
  name?: string | null
}

export interface FindDataPushRequest {
  sourceCampaignId: number
  outputKind: FindDataOutputKind
  items: FindDataPushItem[]
  sourceDetailId?: number | null
  sourceInputDataId?: number | null
  allowedTargetActionIds?: string[] | null
}

export type FindDataPushBlockReason =
  | 'target_missing'
  | 'target_deleted'
  | 'target_other_owner'
  | 'target_action_mismatch'
  | 'target_data_type_incompatible'
  | 'target_data_group_mode'
  | 'target_not_entitled'

export interface FindDataPushTargetResult {
  targetCampaignId: number
  targetCampaignName: string | null
  targetActionId: string
  label: string
  status: 'delivered' | 'blocked'
  reason: FindDataPushBlockReason | null
  inserted: number
  existing: number
  reopened: boolean
}

export interface FindDataPushResponse {
  sourceCampaignId: number
  outputKind: FindDataOutputKind
  itemCount: number
  targets: FindDataPushTargetResult[]
}

const BLOCK_REASONS = new Set<string>([
  'target_missing', 'target_deleted', 'target_other_owner', 'target_action_mismatch',
  'target_data_type_incompatible', 'target_data_group_mode', 'target_not_entitled'
])

const toCount = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** Đọc kết quả hàm DB; khuôn sai thì trả null (bên gọi coi như lỗi). */
export function parseFindDataPushResponse(raw: unknown): FindDataPushResponse | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  if (row.ok !== true || !Array.isArray(row.targets)) return null
  const targets: FindDataPushTargetResult[] = []
  for (const item of row.targets) {
    if (!item || typeof item !== 'object') continue
    const t = item as Record<string, unknown>
    const targetCampaignId = Number(t.targetCampaignId)
    if (!Number.isSafeInteger(targetCampaignId) || targetCampaignId <= 0) continue
    const status = t.status === 'blocked' ? 'blocked' : t.status === 'delivered' ? 'delivered' : null
    if (!status) continue
    const reason = typeof t.reason === 'string' && BLOCK_REASONS.has(t.reason) ? t.reason as FindDataPushBlockReason : null
    targets.push({
      targetCampaignId,
      targetCampaignName: typeof t.targetCampaignName === 'string' && t.targetCampaignName.trim() ? t.targetCampaignName : null,
      targetActionId: String(t.targetActionId || ''),
      label: String(t.label || 'data'),
      status,
      reason: status === 'blocked' ? (reason ?? 'target_missing') : null,
      inserted: toCount(t.inserted),
      existing: toCount(t.existing),
      reopened: t.reopened === true
    })
  }
  return {
    sourceCampaignId: Number(row.sourceCampaignId) || 0,
    outputKind: String(row.outputKind || '') as FindDataOutputKind,
    itemCount: toCount(row.itemCount),
    targets
  }
}

/** Câu cho khách khi chiến dịch đích không nhận được data. */
export function formatFindDataPushBlockReason(reason: FindDataPushBlockReason | null | undefined, label: string): string {
  switch (reason) {
    case 'target_deleted':
      return 'chiến dịch này đã bị xoá. Hãy bỏ chiến dịch này khỏi mục xử lý data tìm được'
    case 'target_data_group_mode':
      return `chiến dịch này đang chạy bằng Nhóm data. Hãy chọn "Đẩy ${label} sang Nhóm data" với nhóm của chiến dịch đó`
    case 'target_action_mismatch':
    case 'target_data_type_incompatible':
      return `loại chiến dịch này không nhận ${label}`
    case 'target_not_entitled':
      return 'gói dịch vụ hiện tại không có loại chiến dịch này'
    case 'target_other_owner':
    case 'target_missing':
    default:
      return 'không tìm thấy chiến dịch này'
  }
}
