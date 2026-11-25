/**
 * Loại trừ gửi theo nhiều Zalo, Nhóm data và chiến dịch đã gửi (V653, docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md):
 * hợp đồng của RPC aka_agent_send_exclusion_v2 và câu hiển thị dùng chung cho form Desktop và Web.
 * Chép nguyên văn sang akaAgentWebApp packages/control-api/src/campaignSendExclusionMulti.ts (sửa ở một nơi rồi chép lại).
 * Không import gì ngoài kiểu của campaignSendExclusion (đuôi .js cho control-api) để chép được giữa hai repo.
 */
import type { ExclusionCatalog, ExclusionRule, FilterOption, SendExclusionSelection, SendExclusionsByAccount } from './campaignSendExclusion.js'

export const SEND_EXCLUSION_MULTI_SETTING_KEY = 'campaign.send_exclusion_multi_zalo'
export type SendExclusionMultiAudience = 'off' | 'admin_akabiz' | 'all'
/** Thiếu dòng / sai JSON = off (form cũ). */
export function parseSendExclusionMultiAudience(value: unknown): SendExclusionMultiAudience {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    const audience = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).audience : undefined
    return audience === 'all' || audience === 'admin_akabiz' ? audience : 'off'
  } catch { return 'off' }
}
export function sendExclusionMultiVisible(audience: SendExclusionMultiAudience | undefined, isAdminAkabiz: boolean | undefined): boolean {
  return audience === 'all' || (audience === 'admin_akabiz' && isAdminAkabiz === true)
}

export const SEND_EXCLUSION_MULTI_LIMITS = { accounts: 20, dataGroups: 20, campaigns: 20 } as const
/** Chiến dịch dùng được làm "chiến dịch đã gửi": nhắn tin Zalo tới người (như SEND_EXCLUSION_ACTIONS). */
export const SENT_CAMPAIGN_ACTIONS = ['zalo_message_phone', 'zalo_message_friend', 'zalo_message_birthday', 'zalo_message_group_member',
  'zalo_message_group_realtime', 'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation'] as const

export interface SendExclusionAccountInfo {
  id: number; name: string; isServer?: boolean; isWeb?: boolean; loginStatus?: string | null
  /** Lần cập nhật danh sách bạn bè/khách gần nhất của Zalo này trong DB (null = chưa có). */
  syncedAt?: string | null
  /** false = chưa đồng bộ lần nào: khối của Zalo này bị bỏ qua lúc chạy. */
  synced: boolean
}
export interface SendExclusionBlock { id?: number; accountId: number; accountName?: string | null; accountDeleted?: boolean; matchMode: 'and' | 'or'; sortOrder?: number; rules: ExclusionRule[] }
export interface SendExclusionGroupV2 {
  id: number; requestId?: string; accountId: number; name: string; matchMode: 'and' | 'or'; revision: number; version: number; blocks: SendExclusionBlock[]
}
export interface SaveSendExclusionGroupV2 {
  id?: number; requestId?: string; name: string; revision: number
  /** accountName chỉ để form hiển thị Zalo đã xoá; DB bỏ qua. */
  blocks: Array<{ accountId: number; accountName?: string | null; matchMode: 'and' | 'or'; rules: ExclusionRule[] }>
}
export interface SendExclusionBlocklistInfo { id: number; name: string; accountId: number; accountName: string; count: number }
export interface SendExclusionV2Page { catalog: ExclusionCatalog; accounts: SendExclusionAccountInfo[]; groups: SendExclusionGroupV2[]; blocklists: SendExclusionBlocklistInfo[] }
export interface SendExclusionAccountOptions { accountId: number; options: FilterOption[] }
export interface SendExclusionDataGroupInfo { id: number; name: string; dataType: 'phone' | 'zalo_person'; count: number; shared: boolean; deleted: boolean }
export interface SendExclusionCampaignInfo {
  id: number; name: string; actionId: string; status: string; accountId: number | null; accountName: string | null
  deleted: boolean; completedAt: string | null; sentCount: number
}
export interface SendExclusionListsQuery {
  kind?: 'all' | 'dataGroups' | 'campaigns'; query?: string; excludeCampaignId?: number | null; dataGroupIds?: number[]; sentCampaignIds?: number[]
}
export interface SendExclusionLists { dataGroups: SendExclusionDataGroupInfo[] | null; campaigns: SendExclusionCampaignInfo[] | null }

export const SEND_EXCLUSION_V2_IPC = {
  page: 'send-exclusions-v2:page', options: 'send-exclusions-v2:options', lists: 'send-exclusions-v2:lists', save: 'send-exclusions-v2:save'
} as const

/** Mã lỗi DB → câu cho khách (lưu/tải trong form). */
export function sendExclusionV2ErrorMessage(message: string | undefined): string {
  const map: Array<[string, string]> = [
    ['revision_conflict', 'Nhóm đã được thay đổi ở nơi khác. Hãy tải lại trước khi sửa.'],
    ['send_exclusion_blocks_invalid', 'Mỗi Zalo chỉ được chọn một lần, tối đa 20 Zalo.'],
    ['send_exclusion_account_not_found', 'Zalo đã chọn không còn hoặc không thuộc bạn. Hãy tải lại.'],
    ['send_exclusion_option_unavailable', 'Một tag đã chọn không còn ở Zalo đó. Hãy chọn lại tag.'],
    ['send_exclusion_rules_required', 'Mỗi Zalo cần ít nhất một điều kiện.'],
    ['send_exclusion_name_invalid', 'Nhập tên nhóm (tối đa 200 ký tự).'],
    ['send_exclusion_data_group_not_found', 'Nhóm data đã chọn không còn dùng được. Hãy chọn lại.'],
    ['send_exclusion_campaign_not_found', 'Chiến dịch đã chọn không còn dùng được. Hãy chọn lại.'],
    ['send_exclusion_campaign_self', 'Không chọn chính chiến dịch này để loại trừ.'],
    ['send_exclusion_group_requires_update', 'Nhóm này dùng nhiều Zalo, hãy cập nhật akaAgent để sửa.'],
    ['PGRST202', 'Tính năng đang được cập nhật. Vui lòng thử lại sau.']
  ]
  return map.find(([code]) => message?.includes(code))?.[1] ?? 'Không thể tải hoặc lưu loại trừ. Kiểm tra dữ liệu và thử lại.'
}

const EMPTY_SELECTION: SendExclusionSelection = { groupId: null, blocklistIds: [] }
export function selectionOf(value: SendExclusionsByAccount, accountId: number): SendExclusionSelection {
  return value[String(accountId)] ?? EMPTY_SELECTION
}
/** Bỏ khoá rỗng để cấu hình chỉ chọn nhóm vẫn chạy được với bản app cũ. */
export function normalizeSelection(selection: SendExclusionSelection): SendExclusionSelection {
  const unique = (ids: number[] | undefined) => Array.from(new Set((ids ?? []).filter(id => Number.isSafeInteger(id) && id > 0)))
  const next: SendExclusionSelection = { groupId: selection.groupId ?? null, blocklistIds: unique(selection.blocklistIds) }
  const dataGroupIds = unique(selection.dataGroupIds), sentCampaignIds = unique(selection.sentCampaignIds)
  if (dataGroupIds.length) next.dataGroupIds = dataGroupIds
  if (sentCampaignIds.length) next.sentCampaignIds = sentCampaignIds
  return next
}
const sameSelection = (a: SendExclusionSelection, b: SendExclusionSelection) => JSON.stringify(normalizeSelection(a)) === JSON.stringify(normalizeSelection(b))
/** Mọi Zalo gửi của chiến dịch dùng cùng một lựa chọn (mặc định của form mới). */
export function selectionsShared(value: SendExclusionsByAccount, accountIds: number[]): boolean {
  return accountIds.every(id => sameSelection(selectionOf(value, id), selectionOf(value, accountIds[0] ?? 0)))
}
export function applySelection(value: SendExclusionsByAccount, accountIds: number[], selection: SendExclusionSelection): SendExclusionsByAccount {
  const next = { ...value }
  for (const id of accountIds) next[String(id)] = normalizeSelection(selection)
  return next
}

export interface SendExclusionDescribeContext {
  catalog: ExclusionCatalog
  /** Nhãn giá trị theo trường (tag Zalo của đúng Zalo của khối, tag akaBiz, trạng thái bạn bè). */
  options: FilterOption[]
}
const fieldOf = (catalog: ExclusionCatalog, rule: ExclusionRule) => catalog.fields.find(field => field.id === rule.fieldId)
const operatorOf = (catalog: ExclusionCatalog, rule: ExclusionRule) => catalog.operators.find(operator => operator.id === rule.operatorId)
const listOf = (value: unknown): unknown[] => Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value]
/** Lựa chọn trạng thái bạn bè hiển thị trong form: [nhãn, mã toán tử, giá trị]. */
export const FRIEND_STATUS_CHOICES: ReadonlyArray<readonly [string, 'equals' | 'not_equals', string]> = [
  ['là bạn bè', 'equals', 'friend'],
  ['không phải bạn bè', 'not_equals', 'friend'],
  ['đã được gửi lời mời kết bạn', 'equals', 'request_sent'],
  ['là người lạ', 'equals', 'stranger']
]
/** Một điều kiện thành câu sau chữ "Khách …": "là bạn bè", "có tag Zalo VIP, Đã mua", "đã được Zalo này gửi tin trong 30 ngày". */
export function describeRule(ctx: SendExclusionDescribeContext, rule: ExclusionRule): string {
  const field = fieldOf(ctx.catalog, rule), operator = operatorOf(ctx.catalog, rule)
  if (!field || !operator) return 'có điều kiện không còn hỗ trợ'
  const labels = listOf(rule.value).map(value => ctx.options.find(option => option.fieldId === rule.fieldId && option.value === value)?.label ?? String(value))
  if (field.sourceKey === 'zalo_friendship') {
    const choice = FRIEND_STATUS_CHOICES.find(([, code, value]) => code === operator.code && value === rule.value)
    if (choice) return choice[0]
    return `${operator.code === 'not_equals' ? 'không ' : ''}có trạng thái bạn bè ${labels.join(', ')}`.trim()
  }
  if (field.sourceKey === 'zalo_labels' || field.sourceKey === 'akabiz_contact') {
    const kind = field.sourceKey === 'zalo_labels' ? 'tag Zalo' : 'tag akaBiz'
    return `${operator.evaluatorKey === 'contains_none' ? 'không có' : 'có'} ${kind} ${labels.join(', ') || '…'}`
  }
  if (field.sourceKey === 'campaign_delivery') return `đã được Zalo này gửi tin trong ${labels[0] ?? '…'} ngày gần nhất`
  return `${field.name} ${operator.name} ${labels.join(', ')}`.trim()
}
/** Các điều kiện của một khối thành một câu, nối bằng "và" / "hoặc" theo cách kết hợp của khối. */
export function describeBlock(ctx: SendExclusionDescribeContext, block: Pick<SendExclusionBlock, 'matchMode' | 'rules'>): string {
  const rules = block.rules.filter(rule => rule.isEnabled).sort((a, b) => a.sortOrder - b.sortOrder)
  return rules.map(rule => describeRule(ctx, rule)).join(block.matchMode === 'and' ? ' và ' : ' hoặc ')
}
