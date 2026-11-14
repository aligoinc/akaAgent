// Bộ lọc Hành động và "Gộp hành động vào một dòng" ở tab Kết quả chạy: hợp đồng hàm DB V539 và luật hiển thị/Excel.
// Chép nguyên văn từ akaAgentWebApp packages/control-api/src/campaignResultActions.ts (Desktop không import được
// package WebApp); chỉ khác phần import, loại nền tảng (Desktop có thêm Facebook và Email) và kiểu tương tác Zalo
// (Desktop chưa đọc bảng đồng bộ trạng thái tin nhắn nên không có "Đã nhận"). Sửa ở WebApp trước rồi chép lại.
import { ENGAGEMENT_STAGE_LABELS, finalEngagementStage, type EngagementStage } from './campaignEffectiveness'
import { CAMPAIGN_REPORT_AUXILIARY_ACTION_CODES } from './campaignRunReport'
import type { ZaloEngagement } from './zaloCampaignEngagement'

/** Nền tảng của tài khoản chạy chiến dịch (`flatform_type`: zalo, sms, facebook, email…). */
type CampaignPlatform = string
/** Như WebApp `ZaloEngagementWithStatus`; mốc "đã nhận" chỉ có khi nguồn đọc thêm bảng đồng bộ trạng thái tin nhắn. */
type ZaloEngagementWithStatus = ZaloEngagement & { delivered_at?: string | null; reply_until?: string | null; status_source?: 'status_sync' }

/**
 * Bộ lọc Hành động và "Gộp hành động vào một dòng" ở tab Kết quả chạy (Web, 14/11/2026).
 * Hợp đồng: docs/CAMPAIGN_RESULT_ACTION_FILTER.md. Hàm DB: scripts/sql/campaign-result-actions
 * (`aka_agent_list_campaign_details_page_v3`, `aka_agent_read_campaign_result_recipients`).
 * Mọi luật hiển thị và Excel của chế độ gộp nằm ở đây (hàm thuần) để Desktop/iOS dùng lại sau.
 */

/** Mã của lượt cũ chưa ghi hành động. */
export const CAMPAIGN_RESULT_NO_ACTION = ''
export const CAMPAIGN_RESULT_NO_ACTION_LABEL = 'Chưa rõ hành động'
/** Mã hành động hợp lệ (cùng luật với hàm DB v3). */
export const CAMPAIGN_RESULT_ACTION_CODE_PATTERN = /^[a-z0-9_]{1,80}$/
export const CAMPAIGN_RESULT_RECIPIENT_PAGE_SIZE = 100
/** Số lượt mới nhất hàm DB trả cho mỗi người nhận; `resultCount` luôn là tổng thật. */
export const CAMPAIGN_RESULT_RECIPIENT_HISTORY_LIMIT = 50
/** Số người nhận mỗi lô khi xuất Excel (POST …/result-recipients/selection). */
export const CAMPAIGN_RESULT_RECIPIENT_BATCH_SIZE = 200
export const CAMPAIGN_RESULT_RECIPIENT_KEYS_MAX = 100_000
/** Cùng bốn cách sắp xếp với tab Danh sách người nhận; mặc định cập nhật gần nhất, người chưa chạy ở cuối. */
export const CAMPAIGN_RESULT_RECIPIENT_SORTS = ['processed_desc', 'processed_asc', 'created_desc', 'created_asc'] as const
export type CampaignResultRecipientSort = typeof CAMPAIGN_RESULT_RECIPIENT_SORTS[number]

export const CAMPAIGN_RESULT_ACTIONS_NOT_READY = 'Bộ lọc theo hành động đang được cập nhật. Vui lòng thử lại sau.'
export const CAMPAIGN_RESULT_ACTIONS_UNAVAILABLE = 'Chưa tải được danh sách hành động. Vui lòng thử lại.'
export const CAMPAIGN_RESULT_RECIPIENTS_UNAVAILABLE = 'Chưa tải được danh sách gộp. Vui lòng thử lại.'
export const CAMPAIGN_RESULT_RECIPIENTS_BUSY = 'Hệ thống đang gộp kết quả khác. Vui lòng thử lại sau vài giây.'
export const CAMPAIGN_RESULT_RECIPIENTS_TIMEOUT = 'Chiến dịch quá lớn để gộp nhanh. Vui lòng thử lại sau.'
export const CAMPAIGN_RESULT_RECIPIENTS_TOO_MANY = 'Danh sách quá lớn để xuất một lần. Hãy thu hẹp bộ lọc rồi thử lại.'

/** Lựa chọn của bộ lọc Hành động. */
export type CampaignResultActionView = { kind: 'all' } | { kind: 'action'; code: string } | { kind: 'merged' }

export interface CampaignResultActionOption {
  /** '' = lượt cũ chưa ghi hành động. */
  code: string
  name: string
  /** Số lượt của hành động trong chiến dịch (không theo các bộ lọc khác). */
  count: number
  /** Có trong cấu hình hiện tại của chiến dịch (như tab Hành động). */
  configured: boolean
  /** Tìm SĐT, Gắn tag, Đổi tên. */
  auxiliary: boolean
}

export interface CampaignResultActions {
  campaignId: number
  /** Tổng lượt của chiến dịch (= tổng của tab Kết quả chạy khi không lọc). */
  total: number
  /** false: loại chiến dịch không dùng danh sách người nhận (không có chế độ gộp). */
  usesInputData: boolean
  actions: CampaignResultActionOption[]
}

export type CampaignResultStatusPresentation = { code: string | null; name: string | null; color: string | null; statusValue?: string | null }

/** Một lượt trong chế độ gộp (bản gọn: không kèm khối `data`). */
export interface CampaignResultRecipientResult {
  id: number
  actionCode: string | null
  actionName: string | null
  status: string
  statusId: number | null
  subStatusId: number | null
  reportGroup: 'success' | 'failure' | 'skipped' | 'pending' | null
  errorCode: string | null
  log: string | null
  postUrl: string | null
  errorMessage: string | null
  createdAt: string | null
  statusPresentation: CampaignResultStatusPresentation | null
  subStatusPresentation: CampaignResultStatusPresentation | null
  zaloEngagement: ZaloEngagementWithStatus | null
  /** API ghép từ bảng đồng bộ trạng thái tin nhắn Zalo (như trang Kết quả chạy). */
  zaloEngagementApplicable?: boolean
}

export interface CampaignResultRecipient {
  id: number
  name: string | null
  phone: string | null
  uid: string | null
  email: string | null
  info1: string | null
  info2: string | null
  info3: string | null
  info4: string | null
  info5: string | null
  /** Trạng thái của người nhận trong danh sách (hoàn thành, chờ xử lý…). */
  status: string | null
  note: string | null
  createdAt: string | null
  dateAction: string | null
  /** Tổng lượt thật của người nhận (có thể lớn hơn số lượt trả về). */
  resultCount: number
  /** Tối đa 50 lượt mới nhất, mới nhất trước. */
  results: CampaignResultRecipientResult[]
}

export interface CampaignResultRecipientPage { items: CampaignResultRecipient[]; total: number; page: number; pageSize: number }
export interface CampaignResultRecipientKeys { ids: number[]; total: number; truncated: boolean }

/** Bộ lọc của chế độ gộp (giống tab Kết quả chạy; ngày là yyyy-mm-dd theo giờ Việt Nam). */
export interface CampaignResultRecipientQuery {
  search?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  engagementFilter?: 'all' | 'seen' | 'responded' | 'reacted' | 'friended' | 'none'
  sort?: CampaignResultRecipientSort
}

// ---------------------------------------------------------------------------
// Kết quả thô của hàm DB
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value)
const invalid = (what: string): never => { throw new Error(`Dữ liệu kết quả theo hành động không hợp lệ (${what}).`) }
const count = (value: unknown, what: string): number => {
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= 0 ? n : invalid(what)
}
const id = (value: unknown, what: string): number => {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 ? n : invalid(what)
}
const optionalId = (value: unknown): number | null => {
  const n = Number(value)
  return value !== null && value !== undefined && Number.isSafeInteger(n) && n > 0 ? n : null
}
const optionalText = (value: unknown): string | null => typeof value === 'string' ? value : null
const list = (value: unknown, what: string): unknown[] => Array.isArray(value) ? value : invalid(what)
const REPORT_GROUPS = new Set(['success', 'failure', 'skipped', 'pending'])

export interface CampaignResultActionsRpc { total: number; actions: Array<{ code: string | null; name: string | null; count: number }> }

export function parseCampaignResultActionsRpc(data: unknown): CampaignResultActionsRpc {
  if (!isRow(data)) return invalid('root')
  return {
    total: count(data.total, 'total'),
    actions: list(data.actions, 'actions').map(row => {
      if (!isRow(row)) return invalid('actions[]')
      return { code: optionalText(row.code), name: optionalText(row.name), count: count(row.count, 'actions.count') }
    })
  }
}

const presentation = (value: unknown): CampaignResultStatusPresentation | null => isRow(value)
  ? { code: optionalText(value.code), name: optionalText(value.name), color: optionalText(value.color), statusValue: optionalText(value.statusValue) }
  : null

function parseResult(row: unknown): CampaignResultRecipientResult {
  if (!isRow(row)) return invalid('results[]')
  const group = optionalText(row.reportGroup)
  return {
    id: id(row.id, 'results.id'),
    actionCode: optionalText(row.actionCode),
    actionName: optionalText(row.actionName),
    status: optionalText(row.status) ?? '',
    statusId: optionalId(row.statusId),
    subStatusId: optionalId(row.subStatusId),
    reportGroup: group && REPORT_GROUPS.has(group) ? group as CampaignResultRecipientResult['reportGroup'] : null,
    errorCode: optionalText(row.errorCode),
    log: optionalText(row.log),
    postUrl: optionalText(row.postUrl),
    errorMessage: optionalText(row.errorMessage),
    createdAt: optionalText(row.createdAt),
    statusPresentation: presentation(row.statusPresentation),
    subStatusPresentation: presentation(row.subStatusPresentation),
    zaloEngagement: isRow(row.zaloEngagement) ? row.zaloEngagement as unknown as ZaloEngagementWithStatus : null
  }
}

function parseRecipient(row: unknown): CampaignResultRecipient {
  if (!isRow(row)) return invalid('items[]')
  return {
    id: id(row.id, 'items.id'),
    name: optionalText(row.name), phone: optionalText(row.phone), uid: optionalText(row.uid), email: optionalText(row.email),
    info1: optionalText(row.info1), info2: optionalText(row.info2), info3: optionalText(row.info3),
    info4: optionalText(row.info4), info5: optionalText(row.info5),
    status: optionalText(row.status), note: optionalText(row.note),
    createdAt: optionalText(row.createdAt), dateAction: optionalText(row.dateAction),
    resultCount: count(row.resultCount, 'items.resultCount'),
    results: list(row.results, 'items.results').map(parseResult)
  }
}

/** Chế độ `page` (có `total`) hoặc `byKeys` (không có). */
export function parseCampaignResultRecipientsRpc(data: unknown, mode: 'page' | 'byKeys'): { total: number | null; items: CampaignResultRecipient[] } {
  if (!isRow(data)) return invalid('root')
  return {
    total: mode === 'page' ? count(data.total, 'total') : null,
    items: list(data.items, 'items').map(parseRecipient)
  }
}

export function parseCampaignResultRecipientKeysRpc(data: unknown): CampaignResultRecipientKeys {
  if (!isRow(data)) return invalid('root')
  return {
    ids: list(data.ids, 'ids').map(value => id(value, 'ids[]')),
    total: count(data.total, 'total'),
    truncated: data.truncated === true
  }
}

// ---------------------------------------------------------------------------
// Danh sách hành động của bộ lọc
// ---------------------------------------------------------------------------

/**
 * Hành động đã cấu hình theo thứ tự chạy (kể cả chưa có lượt), rồi hành động chỉ còn trong lịch sử (nhiều lượt trước),
 * cuối cùng lượt cũ chưa ghi hành động. Tên: tên đã biết của mã, thiếu thì tên đã ghi trên lượt, thiếu nữa thì mã.
 */
export function buildCampaignResultActionOptions(input: {
  configuredCodes: readonly string[]
  recorded: CampaignResultActionsRpc['actions']
  names?: Readonly<Record<string, string>>
}): CampaignResultActionOption[] {
  const recorded = new Map<string, { name: string | null; count: number }>()
  for (const row of input.recorded) {
    const code = row.code ?? CAMPAIGN_RESULT_NO_ACTION
    const current = recorded.get(code)
    recorded.set(code, { name: current?.name ?? row.name, count: (current?.count ?? 0) + row.count })
  }
  const option = (code: string, configured: boolean): CampaignResultActionOption => {
    const seen = recorded.get(code)
    const name = code === CAMPAIGN_RESULT_NO_ACTION ? CAMPAIGN_RESULT_NO_ACTION_LABEL
      : input.names?.[code] || seen?.name?.trim() || code
    return { code, name, count: seen?.count ?? 0, configured, auxiliary: CAMPAIGN_REPORT_AUXILIARY_ACTION_CODES.includes(code) }
  }
  const configured = Array.from(new Set(input.configuredCodes.filter(code => CAMPAIGN_RESULT_ACTION_CODE_PATTERN.test(code))))
  const options = configured.map(code => option(code, true))
  const history = Array.from(recorded.entries())
    .filter(([code]) => code !== CAMPAIGN_RESULT_NO_ACTION && !configured.includes(code))
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .map(([code]) => option(code, false))
  const unknown = recorded.has(CAMPAIGN_RESULT_NO_ACTION) ? [option(CAMPAIGN_RESULT_NO_ACTION, false)] : []
  return [...options, ...history, ...unknown]
}

// ---------------------------------------------------------------------------
// Hiển thị một lượt và một người nhận
// ---------------------------------------------------------------------------

export const campaignResultActionKey = (result: Pick<CampaignResultRecipientResult, 'actionCode'>): string =>
  result.actionCode ?? CAMPAIGN_RESULT_NO_ACTION

export const campaignResultStage = (result: CampaignResultRecipientResult): EngagementStage | null =>
  finalEngagementStage({ actionCode: result.actionCode, reportGroup: result.reportGroup, status: result.status, engagement: result.zaloEngagement })

/** Chữ của một lượt: trạng thái (tên trong danh mục, thiếu thì chữ đã ghi), trạng thái phụ, ghi chú, nhãn tương tác. */
export function campaignResultText(result: CampaignResultRecipientResult): {
  status: string; subStatus: string | null; note: string; stage: EngagementStage | null; stageLabel: string | null
} {
  const stage = campaignResultStage(result)
  const note = result.log?.trim() || result.errorMessage?.trim() || result.postUrl?.trim()
    || (result.errorCode ? `Có lỗi (mã ${result.errorCode})` : '')
  return {
    status: result.statusPresentation?.name?.trim() || result.status,
    subStatus: result.subStatusPresentation?.name?.trim() || null,
    note,
    stage,
    stageLabel: stage ? ENGAGEMENT_STAGE_LABELS[stage] : null
  }
}

export interface CampaignResultCell {
  /** Lượt mới nhất của hành động; null = chưa có lượt. */
  latest: CampaignResultRecipientResult | null
  /** Các lượt trước đó, mới nhất trước. */
  older: CampaignResultRecipientResult[]
  /** Số lượt của hành động trong các lượt đã trả về. */
  count: number
}

/** Ô theo hành động của một người nhận (mỗi mã một ô, kể cả mã không có trong `codes`). */
export function campaignResultCells(recipient: CampaignResultRecipient, codes: readonly string[]): Map<string, CampaignResultCell> {
  const cells = new Map<string, CampaignResultCell>(codes.map(code => [code, { latest: null, older: [], count: 0 }]))
  // Hàm DB trả mới nhất trước; sắp lại phòng khi nguồn khác gọi.
  const results = [...recipient.results].sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0) || b.id - a.id)
  for (const result of results) {
    const key = campaignResultActionKey(result)
    const cell = cells.get(key) ?? { latest: null, older: [], count: 0 }
    if (cell.latest) cell.older.push(result)
    else cell.latest = result
    cell.count += 1
    cells.set(key, cell)
  }
  return cells
}

/** Người nhận có nhiều lượt hơn số lượt trả về (chỉ có 50 lượt mới nhất). */
export const campaignResultRecipientTruncated = (recipient: CampaignResultRecipient): boolean =>
  recipient.resultCount > recipient.results.length

/** Mã các cột của bảng gộp: theo bộ lọc, thêm mã lạ xuất hiện trong trang (phòng khi danh sách hành động cũ hơn). */
export function campaignResultColumnCodes(options: readonly CampaignResultActionOption[], recipients: readonly CampaignResultRecipient[]): string[] {
  const codes = options.map(option => option.code)
  for (const recipient of recipients) {
    for (const result of recipient.results) {
      const key = campaignResultActionKey(result)
      if (!codes.includes(key)) codes.push(key)
    }
  }
  // Lượt chưa rõ hành động luôn ở cột cuối.
  const unknownAt = codes.indexOf(CAMPAIGN_RESULT_NO_ACTION)
  if (unknownAt >= 0 && unknownAt < codes.length - 1) codes.push(...codes.splice(unknownAt, 1))
  return codes
}

export function campaignResultColumnName(code: string, options: readonly CampaignResultActionOption[], recipients: readonly CampaignResultRecipient[] = []): string {
  const option = options.find(item => item.code === code)
  if (option) return option.name
  if (code === CAMPAIGN_RESULT_NO_ACTION) return CAMPAIGN_RESULT_NO_ACTION_LABEL
  for (const recipient of recipients) {
    const named = recipient.results.find(result => result.actionCode === code && result.actionName?.trim())
    if (named?.actionName) return named.actionName.trim()
  }
  return code
}

const STAGE_RANK: readonly EngagementStage[] = ['responded', 'reacted', 'seen', 'received', 'friended', 'sent', 'requested']
const earliest = (values: Array<string | null | undefined>): string | null => values
  .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
  .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null

/** Tương tác Zalo của một người nhận: mức cao nhất trên mọi lượt, mỗi mốc lấy lần đầu. */
export function campaignResultRecipientEngagement(recipient: CampaignResultRecipient): {
  stage: EngagementStage | null; stageLabel: string | null
  deliveredAt: string | null; seenAt: string | null; respondedAt: string | null; reactedAt: string | null; friendedAt: string | null
} {
  const stages = recipient.results.map(campaignResultStage).filter((stage): stage is EngagementStage => !!stage)
  const stage = STAGE_RANK.find(item => stages.includes(item)) ?? null
  const marks = recipient.results.map(result => result.zaloEngagement).filter((value): value is ZaloEngagementWithStatus => !!value)
  return {
    stage,
    stageLabel: stage ? ENGAGEMENT_STAGE_LABELS[stage] : null,
    deliveredAt: earliest(marks.map(mark => mark.delivered_at)),
    seenAt: earliest(marks.map(mark => mark.seen_at)),
    respondedAt: earliest(marks.map(mark => mark.responded_at)),
    reactedAt: earliest(marks.map(mark => mark.reacted_at)),
    friendedAt: earliest(marks.map(mark => mark.friended_at))
  }
}

export type CampaignResultIdentityKey = 'phone' | 'uid' | 'email'

/** Cột định danh của người nhận theo loại chiến dịch (cùng luật với bảng Kết quả chạy). */
export function campaignResultIdentityColumns(actionCode: string, platform: CampaignPlatform): Array<{ key: CampaignResultIdentityKey; label: string }> {
  const uidLabel = platform === 'zalo' ? 'Zalo ID' : 'UID'
  if (platform === 'sms' || actionCode === 'zalo_message_phone') return [{ key: 'phone', label: 'SĐT' }]
  if (actionCode === 'email_send') return [{ key: 'email', label: 'Email' }]
  if (actionCode === 'zalo_add_group_member') return [{ key: 'phone', label: 'SĐT' }, { key: 'uid', label: uidLabel }]
  return [{ key: 'uid', label: uidLabel }]
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

export interface CampaignResultSheet { name: string; rows: Array<Record<string, string | number>> }

const INFO_KEYS = ['info1', 'info2', 'info3', 'info4', 'info5'] as const

/**
 * Hai sheet của file gộp: "Theo người nhận" (mỗi người nhận một hàng, mỗi hành động một nhóm cột, lượt mới nhất) và
 * "Tất cả lượt" (mọi lượt đã đọc của những người nhận đó). Cột "Trạng thái phụ"/"Số lượt" của một hành động và cột
 * "Thông tin N" chỉ có khi ít nhất một hàng có giá trị; hành động chưa có lượt vẫn có cột (để trống).
 */
export function campaignResultMergedSheets(input: {
  actionCode: string
  platform: CampaignPlatform
  options: readonly CampaignResultActionOption[]
  recipients: readonly CampaignResultRecipient[]
  formatTime(value: string | null): string
}): CampaignResultSheet[] {
  const { recipients, options, formatTime } = input
  const identity = campaignResultIdentityColumns(input.actionCode, input.platform)
  const zalo = input.platform === 'zalo'
  const codes = campaignResultColumnCodes(options, recipients)
  const cells = recipients.map(recipient => campaignResultCells(recipient, codes))
  const infoKeys = INFO_KEYS.filter(key => recipients.some(recipient => recipient[key]?.trim()))
  const withSub = new Set(codes.filter(code => cells.some(map => {
    const latest = map.get(code)?.latest
    return !!latest && !!campaignResultText(latest).subStatus
  })))
  const withCount = new Set(codes.filter(code => cells.some((map, index) =>
    (map.get(code)?.count ?? 0) > 1 || (campaignResultRecipientTruncated(recipients[index]) && (map.get(code)?.count ?? 0) > 0))))
  const engagements = recipients.map(campaignResultRecipientEngagement)
  const withDelivered = engagements.some(item => item.deliveredAt)
  const anyTruncated = recipients.some(campaignResultRecipientTruncated)

  const byRecipient = recipients.map((recipient, index) => {
    const row: Record<string, string | number> = { STT: index + 1, 'Tên': recipient.name ?? '' }
    for (const column of identity) row[column.label] = recipient[column.key] ?? ''
    for (const key of infoKeys) row[`Thông tin ${key.slice(4)}`] = recipient[key] ?? ''
    row['Trạng thái người nhận'] = recipient.status ?? ''
    row['Ghi chú người nhận'] = recipient.note ?? ''
    for (const code of codes) {
      const name = campaignResultColumnName(code, options, recipients)
      const cell = cells[index].get(code)
      const text = cell?.latest ? campaignResultText(cell.latest) : null
      row[`${name} - Thời gian`] = cell?.latest ? formatTime(cell.latest.createdAt) : ''
      row[`${name} - Trạng thái`] = text?.status ?? ''
      if (withSub.has(code)) row[`${name} - Trạng thái phụ`] = text?.subStatus ?? ''
      row[`${name} - Ghi chú`] = text?.note ?? ''
      if (withCount.has(code)) row[`${name} - Số lượt`] = cell?.count ? cell.count : ''
    }
    if (anyTruncated) row['Tổng số lượt'] = campaignResultRecipientTruncated(recipient) ? recipient.resultCount : ''
    if (zalo) {
      const engagement = engagements[index]
      row['Trạng thái tương tác'] = engagement.stageLabel ?? ''
      if (withDelivered) row['Đã nhận lúc'] = engagement.deliveredAt ? formatTime(engagement.deliveredAt) : ''
      row['Đã xem lúc'] = engagement.seenAt ? formatTime(engagement.seenAt) : ''
      row['Đã phản hồi lúc'] = engagement.respondedAt ? formatTime(engagement.respondedAt) : ''
      row['Đã thả cảm xúc lúc'] = engagement.reactedAt ? formatTime(engagement.reactedAt) : ''
      row['Đã kết bạn lúc'] = engagement.friendedAt ? formatTime(engagement.friendedAt) : ''
    }
    return row
  })

  const allResults: Array<Record<string, string | number>> = []
  recipients.forEach(recipient => {
    for (const result of recipient.results) {
      const text = campaignResultText(result)
      const row: Record<string, string | number> = { 'Tên': recipient.name ?? '' }
      for (const column of identity) row[column.label] = recipient[column.key] ?? ''
      row['Thời gian'] = formatTime(result.createdAt)
      row['Hành động'] = campaignResultColumnName(campaignResultActionKey(result), options, recipients)
      row['Trạng thái'] = text.status
      row['Trạng thái phụ'] = text.subStatus ?? ''
      row['Ghi chú'] = text.note
      if (zalo) {
        const marks = result.zaloEngagement
        row['Trạng thái tương tác'] = text.stageLabel ?? ''
        if (withDelivered) row['Đã nhận lúc'] = marks?.delivered_at ? formatTime(marks.delivered_at) : ''
        row['Đã xem lúc'] = marks?.seen_at ? formatTime(marks.seen_at) : ''
        row['Đã phản hồi lúc'] = marks?.responded_at ? formatTime(marks.responded_at) : ''
        row['Đã thả cảm xúc lúc'] = marks?.reacted_at ? formatTime(marks.reacted_at) : ''
        row['Đã kết bạn lúc'] = marks?.friended_at ? formatTime(marks.friended_at) : ''
      }
      allResults.push(row)
    }
  })
  return [{ name: 'Theo người nhận', rows: byRecipient }, { name: 'Tất cả lượt', rows: allResults }]
}

const fileSlug = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

export const campaignResultMergedFileName = (campaignId: number) => `ket-qua-chay-${campaignId}-gop.xlsx`
export const campaignResultActionFileName = (campaignId: number, actionName: string) =>
  `ket-qua-chay-${campaignId}-${fileSlug(actionName) || 'hanh-dong'}.xlsx`
