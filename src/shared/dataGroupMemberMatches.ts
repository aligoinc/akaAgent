/**
 * Cửa sổ nhập của nhóm khách hàng: hỏi máy chủ định danh nào (SĐT, UID Zalo, link group) đã là thành viên của nhóm
 * đang nhập và của các nhóm khách hàng khác của cùng nhân viên (akaAgent V519, RPC
 * `aka_agent_read_data_group_member_matches`, chỉ đọc).
 *
 * Vì sao cần: hàm nạp của DB chỉ nhận ra khách đã có khi nhóm gắn tài khoản Zalo; nhóm không gắn tài khoản để lọt
 * khách đã có từ lần nhập khác (docs/DATA_GROUP_IMPORT_DUPLICATES.md). Luật so khớp nằm trong RPC; tệp này chỉ giữ
 * giới hạn, kiểu dữ liệu, kiểm tra đầu vào/kết quả, chia lượt và công tắc.
 *
 * Hợp đồng dùng chung Web/API/Desktop: akaAgent chép nguyên văn sang `src/shared/dataGroupMemberMatches.ts`
 * (Desktop gọi cùng RPC bằng token Desktop, akaAgent V522). Sửa ở đây trước rồi chép lại. Không import gì.
 */

export const DATA_GROUP_MEMBER_MATCHES_RPC = 'aka_agent_read_data_group_member_matches'
/** Web gửi mỗi lượt tối đa 1.000 định danh, tuần tự; RPC và API nhận tới 2.000. */
export const DATA_GROUP_MATCHES_MAX_VALUES_PER_CALL = 1000
export const DATA_GROUP_MATCHES_RPC_MAX_VALUES = 2000
export const DATA_GROUP_MATCHES_MAX_OTHER_GROUPS = 200
export const DATA_GROUP_MATCHES_MAX_VALUE_LENGTH = 512
/** Cùng dòng cài đặt với lọc trùng chiến dịch (`INPUT_DUPLICATES_SETTING_KEY`), trường tùy chọn `groupMatches`. */
export const DATA_GROUP_MATCHES_SETTING_KEY = 'web.campaign_input_duplicates'

export type DataGroupMatchContactType = 'phone' | 'person' | 'group'
export const DATA_GROUP_MATCH_CONTACT_TYPES: readonly DataGroupMatchContactType[] = ['phone', 'person', 'group']

/** `none`: chỉ nhóm đang nhập; `all`: mọi nhóm khách hàng khác của nhân viên; mảng id: chỉ các nhóm đó. */
export type DataGroupMatchOtherGroups = 'none' | 'all' | number[]

export interface DataGroupMemberMatchesRequest {
  contactType: DataGroupMatchContactType
  /** SĐT (máy chủ tự chuẩn hóa), UID Zalo hoặc link group, theo đúng thứ tự dòng sẽ gửi. */
  values: string[]
  otherGroups: DataGroupMatchOtherGroups
}

export interface DataGroupMatchOtherGroup {
  id: number
  name: string
  addedAt: string
}

export interface DataGroupMemberMatch {
  /** Vị trí của định danh trong `values` của lượt hỏi (bắt đầu từ 0). */
  index: number
  inGroup: boolean
  otherGroupCount: number
  /** Nhóm khác mà khách vào gần đây nhất. */
  otherGroup: DataGroupMatchOtherGroup | null
}

export interface DataGroupMemberMatchesResult {
  checkedAt: string
  valueCount: number
  /** Chỉ gồm định danh có khớp, tăng dần theo `index`. */
  items: DataGroupMemberMatch[]
}

const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** Kiểm tra thân yêu cầu (API dùng trước khi gọi DB; Web dùng để không gửi yêu cầu sai). Ném Error tiếng Việt. */
export function validateDataGroupMemberMatchesRequest(value: unknown): DataGroupMemberMatchesRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Yêu cầu đối chiếu nhóm khách hàng không hợp lệ.')
  const body = value as Record<string, unknown>
  if (typeof body.contactType !== 'string' || !(DATA_GROUP_MATCH_CONTACT_TYPES as readonly string[]).includes(body.contactType)) {
    throw new Error('Loại danh sách này chưa đối chiếu được với nhóm khách hàng.')
  }
  if (!Array.isArray(body.values) || body.values.length > DATA_GROUP_MATCHES_RPC_MAX_VALUES
    || !body.values.every(item => typeof item === 'string')) {
    throw new Error(`Mỗi lượt đối chiếu tối đa ${DATA_GROUP_MATCHES_RPC_MAX_VALUES.toLocaleString('vi-VN')} dòng.`)
  }
  const other = body.otherGroups ?? 'none'
  let otherGroups: DataGroupMatchOtherGroups
  if (other === 'none' || other === 'all') otherGroups = other
  else if (Array.isArray(other) && other.length <= DATA_GROUP_MATCHES_MAX_OTHER_GROUPS && other.every(positiveId)) {
    otherGroups = Array.from(new Set(other as number[]))
  } else throw new Error(`Chọn tối đa ${DATA_GROUP_MATCHES_MAX_OTHER_GROUPS} nhóm khách hàng để đối chiếu.`)
  return { contactType: body.contactType as DataGroupMatchContactType, values: body.values as string[], otherGroups }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

/** Đọc kết quả của RPC/API; sai dạng thì ném lỗi để nơi gọi coi là lượt đối chiếu hỏng (không coi là "không trùng"). */
export function parseDataGroupMemberMatchesResult(value: unknown): DataGroupMemberMatchesResult {
  const body = record(Array.isArray(value) ? value[0] : value)
  if (!body || typeof body.checkedAt !== 'string' || !Array.isArray(body.items)) throw new Error('Kết quả đối chiếu nhóm khách hàng không hợp lệ.')
  const valueCount = Number(body.valueCount)
  if (!Number.isInteger(valueCount) || valueCount < 0) throw new Error('Kết quả đối chiếu nhóm khách hàng không hợp lệ.')
  const items = body.items.map(raw => {
    const item = record(raw)
    const index = Number(item?.index)
    const otherGroupCount = Number(item?.otherGroupCount ?? 0)
    if (!item || !Number.isInteger(index) || index < 0 || index >= valueCount || typeof item.inGroup !== 'boolean'
      || !Number.isInteger(otherGroupCount) || otherGroupCount < 0) {
      throw new Error('Kết quả đối chiếu nhóm khách hàng không hợp lệ.')
    }
    const other = record(item.otherGroup)
    const otherGroup = other && positiveId(Number(other.id))
      ? { id: Number(other.id), name: String(other.name ?? ''), addedAt: String(other.addedAt ?? '') }
      : null
    return { index, inGroup: item.inGroup, otherGroupCount, otherGroup }
  })
  return { checkedAt: body.checkedAt, valueCount, items }
}

/** Chia danh sách thành các lượt tối đa 1.000 định danh, giữ thứ tự. */
export function chunkDataGroupMatchValues(values: readonly string[], size = DATA_GROUP_MATCHES_MAX_VALUES_PER_CALL): string[][] {
  const chunks: string[][] = []
  for (let offset = 0; offset < values.length; offset += size) chunks.push(values.slice(offset, offset + size))
  return chunks
}

/** Gộp kết quả các lượt liên tiếp: `index` đổi về vị trí trong cả danh sách; giờ đối chiếu là của lượt đầu. */
export function mergeDataGroupMemberMatches(results: readonly DataGroupMemberMatchesResult[]): DataGroupMemberMatchesResult | null {
  if (results.length === 0) return null
  let offset = 0
  const items: DataGroupMemberMatch[] = []
  for (const result of results) {
    for (const item of result.items) items.push({ ...item, index: item.index + offset })
    offset += result.valueCount
  }
  return { checkedAt: results[0].checkedAt, valueCount: offset, items }
}

/**
 * Công tắc tắt nhanh: `auto_system_settings` `web.campaign_input_duplicates`, trường tùy chọn `groupMatches`.
 * Thiếu dòng, thiếu trường hoặc sai định dạng = bật; chỉ `false` mới tắt. Tắt thì cửa sổ nhập của nhóm trở về như
 * trước V519 (không hỏi máy chủ về thành viên nhóm).
 */
export function parseDataGroupMemberMatchesEnabled(value: unknown): boolean {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true
    return (parsed as Record<string, unknown>).groupMatches !== false
  } catch { return true }
}
