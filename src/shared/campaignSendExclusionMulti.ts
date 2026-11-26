/**
 * Loại trừ gửi theo nhiều Zalo, Nhóm data và chiến dịch đã gửi (V654, docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md):
 * hợp đồng của RPC aka_agent_send_exclusion_v2 và câu hiển thị dùng chung cho form Desktop và Web.
 * Chép nguyên văn sang akaAgentWebApp packages/control-api/src/campaignSendExclusionMulti.ts (sửa ở một nơi rồi chép lại).
 * Không import gì ngoài kiểu của campaignSendExclusion (đuôi .js cho control-api) để chép được giữa hai repo.
 */
import type { ExclusionCatalog, ExclusionRule, FilterOption, SendExclusionSelection, SendExclusionsByAccount } from './campaignSendExclusion.js'

/**
 * V666: khoá mới (_v2). Khoá cũ campaign.send_exclusion_multi_zalo do Desktop 10.7.0 / Web v144 đọc (bỏ mảng rỗng khi lưu, không có câu cho
 * mã lỗi mới) giữ tắt mãi, để bản đó không hiện thẻ mới. API Web trả trường sendExclusionMultiV2Audience (trường cũ không trả nữa).
 */
export const SEND_EXCLUSION_MULTI_SETTING_KEY = 'campaign.send_exclusion_multi_zalo_v2'
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
  /** V666: số khách đã nhận tin, đếm tới SEND_EXCLUSION_SENT_COUNT_CAP + 1; null = chưa đếm kịp (quá thời gian của lượt đọc). */
  deleted: boolean; completedAt: string | null; sentCount: number | null
}
export interface SendExclusionListsQuery {
  kind?: 'all' | 'dataGroups' | 'campaigns'; query?: string; excludeCampaignId?: number | null; dataGroupIds?: number[]; sentCampaignIds?: number[]
  /** V666: lọc chiến dịch theo trạng thái ở DB (trước: lọc trên 40 dòng đã tải). */
  status?: string | null
}
/** V666: DB đếm "đã gửi" (trên chỉ mục) tới mức này rồi dừng; quá 4 giây cho cả danh sách thì null. */
export const SEND_EXCLUSION_SENT_COUNT_CAP = 100000
/** Số khách đã gửi ("100.000+" khi đếm chạm trần); null khi DB chưa đếm được. */
export function describeSentCount(count: number | null | undefined): string | null {
  if (count === null || count === undefined) return null
  return count > SEND_EXCLUSION_SENT_COUNT_CAP ? `${SEND_EXCLUSION_SENT_COUNT_CAP.toLocaleString('vi-VN')}+` : count.toLocaleString('vi-VN')
}
/** Hộp chọn chiến dịch đã gửi (anh duyệt 26/11). */
export function describeSentCountPicker(count: number | null | undefined): string {
  const n = describeSentCount(count)
  return n === null ? 'Chưa đếm được số khách đã gửi' : `Đã gửi ${n} khách`
}
/** Dòng chiến dịch đã chọn trên thẻ (anh duyệt 26/11). */
export function describeSentCountChip(count: number | null | undefined): string {
  const n = describeSentCount(count)
  return n === null ? 'chưa đếm được số khách' : `${n} khách`
}
export interface SendExclusionLists { dataGroups: SendExclusionDataGroupInfo[] | null; campaigns: SendExclusionCampaignInfo[] | null }

export const SEND_EXCLUSION_V2_IPC = {
  page: 'send-exclusions-v2:page', options: 'send-exclusions-v2:options', lists: 'send-exclusions-v2:lists', save: 'send-exclusions-v2:save',
  preview: 'send-exclusions-v2:preview'
} as const

/**
 * V657: xem trước ở bước lưu (thao tác preview, chỉ đọc): đếm data sẽ không được gửi theo danh sách / Nhóm data / chiến dịch, bằng đúng hàm
 * so khớp của bộ chạy (SĐT hoặc Global ID). campaignId: data "chờ xử lý" của chiến dịch đã lưu; targets: data chưa lưu (≤ 500).
 * pending: chưa xác định được (Global ID chỉ có sau khi tra số), kiểm lúc chạy. Điều kiện của từng Zalo không tính ở đây.
 */
export const SEND_EXCLUSION_PREVIEW_MAX_TARGETS = 500
export interface SendExclusionPreviewQuery {
  accountId: number; selection: SendExclusionSelection; campaignId?: number | null
  targets?: Array<{ phone?: string | null; uid?: string | null }>; afterId?: number | null; limit?: number
}
export interface SendExclusionPreviewSource { kind: 'blocklist' | 'data_group' | 'campaign'; id: number; name: string; count: number }
export interface SendExclusionPreview { checked: number; excluded: number; pending: number; sources: SendExclusionPreviewSource[]; nextAfterId: number | null }
/** Gộp các trang xem trước (cùng một cấu hình). */
export function mergeSendExclusionPreview(a: SendExclusionPreview | null, b: SendExclusionPreview): SendExclusionPreview {
  if (!a) return b
  const sources = new Map<string, SendExclusionPreviewSource>()
  for (const s of [...a.sources, ...b.sources]) {
    const key = `${s.kind}:${s.id}`
    const prev = sources.get(key)
    sources.set(key, prev ? { ...prev, count: prev.count + s.count } : { ...s })
  }
  return { checked: a.checked + b.checked, excluded: a.excluded + b.excluded, pending: a.pending + b.pending,
    sources: Array.from(sources.values()).sort((x, y) => y.count - x.count || x.name.localeCompare(y.name)), nextAfterId: b.nextAfterId }
}
const PREVIEW_KIND: Record<SendExclusionPreviewSource['kind'], string> = { blocklist: 'danh sách Zalo ID', data_group: 'Nhóm data', campaign: 'chiến dịch' }
/** Câu xem trước cho khách. partial: chưa đếm hết data. */
export function describeSendExclusionPreview(p: SendExclusionPreview, partial = false): string {
  if (!p.checked) return 'Chưa có data để xem trước.'
  const head = `${partial ? 'Trong ' + p.checked + ' data đầu tiên' : 'Trong ' + p.checked + ' data'}: ${p.excluded} data sẽ không được gửi`
  const by = p.sources.length ? ' (' + p.sources.map(s => `${s.count} do ${PREVIEW_KIND[s.kind]} “${s.name}”`).join(', ') + ')' : ''
  const pend = p.pending ? `. ${p.pending} data chưa xác định được, sẽ kiểm khi chạy.` : '.'
  return head + by + pend
}

/** V666: trigger lưu chiến dịch từ chối cấu hình mới khi máy chạy chiến dịch chưa đủ bản mới (bản cũ bỏ qua cấu hình này khi gửi). */
export const SEND_EXCLUSION_RUNTIME_OUTDATED_MESSAGE = 'Máy tính đang đăng nhập tài khoản của bạn còn dùng akaAgent bản cũ nên chưa lưu được loại trừ này. Hãy cập nhật akaAgent trên máy đó rồi lưu lại.'
/** V666: câu cho khách khi lưu chiến dịch bị trigger loại trừ gửi từ chối; null = không phải lỗi loại trừ gửi. */
export function sendExclusionSaveErrorMessage(message: string | undefined): string | null {
  return message && /send_exclusion_[a-z_]+/.test(message) ? sendExclusionV2ErrorMessage(message) : null
}
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
    ['send_exclusion_group_not_found', 'Nhóm điều kiện loại trừ đã bị xoá.'],
    ['send_exclusion_blocklist_not_found', 'Danh sách Zalo ID loại trừ đã bị xoá.'],
    ['send_exclusion_account_configuration_missing', 'Chưa cấu hình loại trừ cho tài khoản thực hiện.'],
    ['send_exclusion_group_requires_update', 'Nhóm này dùng nhiều Zalo, hãy cập nhật akaAgent để sửa.'],
    ['send_exclusion_multi_zalo_off', 'Tài khoản của bạn chưa dùng được loại trừ theo Nhóm data, chiến dịch đã gửi hoặc nhiều Zalo.'],
    ['send_exclusion_runtime_outdated', SEND_EXCLUSION_RUNTIME_OUTDATED_MESSAGE],
    ['send_exclusion_server_not_ready', 'Loại trừ theo Nhóm data, chiến dịch đã gửi hoặc nhiều Zalo chưa dùng được với tài khoản Zalo Server.'],
    ['PGRST202', 'Tính năng đang được cập nhật. Vui lòng thử lại sau.']
  ]
  return map.find(([code]) => message?.includes(code))?.[1] ?? 'Không thể tải hoặc lưu loại trừ. Kiểm tra dữ liệu và thử lại.'
}

const EMPTY_SELECTION: SendExclusionSelection = { groupId: null, blocklistIds: [] }
export function selectionOf(value: SendExclusionsByAccount, accountId: number): SendExclusionSelection {
  return value[String(accountId)] ?? EMPTY_SELECTION
}
/**
 * V666: luôn ghi đủ dataGroupIds / sentCampaignIds (kể cả mảng rỗng). Trigger lưu chiến dịch coi lựa chọn THIẾU hai khoá này là của client
 * cũ (iOS / tab Web trước khi deploy, chỉ biết groupId + blocklistIds) và giữ lại giá trị đang lưu; mảng rỗng = khách đã bỏ chọn.
 */
export function normalizeSelection(selection: SendExclusionSelection): SendExclusionSelection {
  const unique = (ids: number[] | undefined) => Array.from(new Set((ids ?? []).filter(id => Number.isSafeInteger(id) && id > 0)))
  return { groupId: selection.groupId ?? null, blocklistIds: unique(selection.blocklistIds),
    dataGroupIds: unique(selection.dataGroupIds), sentCampaignIds: unique(selection.sentCampaignIds) }
}
/** Lựa chọn có loại trừ nào không (ngoài khách đã từ chối nhận tin). */
export function selectionHasExclusions(selection: SendExclusionSelection | null | undefined): boolean {
  return !!selection && (!!selection.groupId || selection.blocklistIds.length > 0 || !!selection.dataGroupIds?.length || !!selection.sentCampaignIds?.length)
}
/**
 * V666: lựa chọn chung khi đổi / thêm Zalo gửi ở chế độ dùng chung: lựa chọn chung đã nhớ ngay trước khi đổi (remembered), chưa có thì
 * lựa chọn có loại trừ đầu tiên của các Zalo đang chọn. Trước đây chép từ Zalo đứng đầu: Zalo mới thêm vào đầu danh sách chưa có lựa chọn
 * nên mọi Zalo mất loại trừ.
 */
export function sharedSelectionSource(value: SendExclusionsByAccount, accountIds: number[], remembered: SendExclusionSelection | null): SendExclusionSelection | null {
  // Chỉ dùng lựa chọn đã nhớ khi cấu hình vẫn còn giữ nó (form giữ khoá của Zalo cũ tới lúc lưu); cấu hình bị thay hẳn thì thôi.
  const kept = remembered && Object.values(value).some(entry => !!entry && sameSelection(entry, remembered)) ? remembered : null
  return kept ?? accountIds.map(id => value[String(id)]).find(selectionHasExclusions) ?? null
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
