/**
 * "Thêm nhóm khách hàng bằng Agent" (Web): người dùng chọn một tài khoản Zalo rồi mô tả nhóm bạn bè cần lấy bằng tiếng
 * Việt; Agent (một dòng `ai_form_configs`, model `gpt-6.1-terra`) hỏi lại tới khi rõ rồi trả bộ lọc `ZaloFriendFilter`.
 * Phương án: docs/DATA_GROUP_FRIEND_AGENT_PLAN.md (mục 5). Hướng dẫn: docs/DATA_GROUP_FRIEND_AGENT.md.
 *
 * Một lượt chat = một lần gọi AI. Mọi hành vi của Agent nằm trong prompt ở DB; tệp này chỉ giữ hợp đồng request/phản hồi,
 * JSON Schema đầu ra (Structured Outputs strict), ngữ cảnh gửi AI và xử lý sau AI: kiểm bộ lọc, bỏ mã không có trong danh
 * mục, không cho "xác nhận" khi còn ý chưa rõ, và dựng bản tóm tắt bằng code từ chính JSON (AI không viết bản tóm tắt).
 *
 * Không gửi dữ liệu cá nhân của khách cho AI: chỉ mô tả của người dùng, tên tài khoản, danh mục tag/nhóm/chiến dịch,
 * số đếm và mốc độ phủ dữ liệu.
 *
 * Dùng chung Web/API/Desktop: sửa ở đây trước rồi chép nguyên văn (Desktop: akaAgent src/shared/dataGroupAgent.ts, cạnh
 * zaloFriendFilter.ts). Chỉ import zaloFriendFilter.ts. Đừng trải Set/Map bằng `...` (renderer Desktop không bật
 * downlevelIteration).
 */
import {
  FRIEND_CONDITION_FIELDS, FRIEND_GENDERS, FRIEND_INTERACTION_KINDS, FRIEND_MESSAGE_STATUSES, FRIEND_SET_OPS, MESSAGE_STAGES,
  ZALO_FRIEND_FILTER_LIMITS, ZaloFriendFilterError, attachFriendFilterAccount, describeZaloFriendFilter,
  describeZaloFriendFilterLines, ensureFriendFilterSeed, parseZaloFriendFilter, parseZaloFriendFilterDraft,
  pruneFriendFilterToCatalog, vietnamToday,
  type FriendFilterSummaryLine, type ZaloFriendAccount, type ZaloFriendFilter, type ZaloFriendFilterCatalog,
  type ZaloFriendFilterDraft
} from './zaloFriendFilter.js'

/** ai_form_configs.code và web_section_id của dòng cấu hình Agent nhóm khách hàng. */
export const DATA_GROUP_AGENT_CODE = 'app_data_group_friend_agent_web'
export const DATA_GROUP_AGENT_SECTION_ID = 'data_group.friend_agent'
export const DATA_GROUP_AGENT_TIMEOUT = 120_000
export const DATA_GROUP_AGENT_MAX_MESSAGE = 2000
export const DATA_GROUP_AGENT_MAX_HISTORY_TURNS = 20
export const DATA_GROUP_AGENT_MAX_HISTORY_TEXT = 2000
export const DATA_GROUP_AGENT_GROUP_NAME_MAX = 60

/**
 * Mục đích của một cuộc trò chuyện. `data_group`: trang Nhóm khách hàng, kết thúc bằng nút "Tạo nhóm".
 * `campaign_recipients`: form thêm chiến dịch ("Agent chọn bạn bè", docs/CAMPAIGN_FRIEND_AGENT_PLAN.md), kết thúc bằng nút
 * "Thêm vào danh sách": không tạo nhóm, không ghi DB. Cùng model, cùng schema; prompt đọc `purpose` để nói đúng nút.
 */
export type DataGroupAgentPurpose = 'data_group' | 'campaign_recipients'
export const DATA_GROUP_AGENT_PURPOSES: readonly DataGroupAgentPurpose[] = ['data_group', 'campaign_recipients']

/**
 * Công tắc `auto_system_settings` key `web.data_group_agent`, value JSON
 * `{"audience":"admin_akabiz"|"all"|"off","campaignForm"?:boolean}`. Thiếu dòng hoặc sai định dạng = `off`. API kiểm lại ở
 * mỗi lượt chat, lượt lọc, lượt tạo nhóm và lượt lấy danh sách người nhận. `campaignForm: false` tắt riêng nút "Agent chọn
 * bạn bè" trong form chiến dịch (thiếu = theo `audience`).
 */
export const DATA_GROUP_AGENT_SETTING_KEY = 'web.data_group_agent'
export type DataGroupAgentAudience = 'admin_akabiz' | 'all' | 'off'
/** Thiếu dòng, sai định dạng hay giá trị lạ đều là `off`: tính năng cần bảng và hàm DB mới, nên không hiện gì tới khi tệp
 * cấu hình (chạy sau migration) thêm dòng công tắc. Khác công tắc Agent chiến dịch (thiếu = chỉ admin akaBiz). */
export function parseDataGroupAgentAudience(value: unknown): DataGroupAgentAudience {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    const audience = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).audience : undefined
    return audience === 'all' || audience === 'off' || audience === 'admin_akabiz' ? audience : 'off'
  } catch { return 'off' }
}
/** Trường `campaignForm` của công tắc: chỉ `false` mới tắt; thiếu, sai định dạng hay giá trị khác đều là bật. */
export function parseDataGroupAgentCampaignForm(value: unknown): boolean {
  try {
    const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
    return !(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as Record<string, unknown>).campaignForm === false)
  } catch { return true }
}
/** Nút "Agent chọn bạn bè" của form chiến dịch: cùng điều kiện với trang Nhóm khách hàng, thêm `campaignForm`. */
export function dataGroupAgentCampaignFormVisible(audience: DataGroupAgentAudience | undefined, isAdminAkabiz: boolean | undefined,
  campaignForm: boolean | undefined): boolean {
  return campaignForm !== false && dataGroupAgentVisible(audience, isAdminAkabiz)
}
/** `undefined` = đang đọc công tắc: chưa hiện nút. */
export function dataGroupAgentVisible(audience: DataGroupAgentAudience | undefined, isAdminAkabiz: boolean | undefined): boolean {
  return audience === 'all' || audience === 'admin_akabiz' && isAdminAkabiz === true
}

export const DATA_GROUP_AGENT_MESSAGES = {
  invalid: 'Agent chưa xử lý được yêu cầu. Vui lòng thử lại hoặc mô tả ngắn hơn.',
  unavailable: 'Agent tạm thời chưa phản hồi. Vui lòng thử lại sau.',
  notConfigured: 'Agent tạo nhóm khách hàng chưa được cấu hình.',
  forbidden: 'Tài khoản này chưa được dùng Agent tạo nhóm khách hàng.',
  noFriends: 'Tài khoản này chưa có danh bạ bạn bè. Hãy Lấy danh bạ Zalo trước rồi mô tả lại.',
  accountUnavailable: 'Không dùng được tài khoản Zalo này để tạo nhóm khách hàng.',
  invalidFilter: 'Agent trả về bộ lọc chưa hợp lệ nên chưa áp dụng.',
  catalogPruned: 'Một số tag, nhóm khách hàng hoặc chiến dịch Agent nêu không có trong danh mục của tài khoản nên đã bỏ.',
  needConfirmation: 'Mình cần hỏi lại vài ý trước khi tạo nhóm.',
  needConfirmationRecipients: 'Mình cần hỏi lại vài ý trước khi lọc bạn bè.',
  confirmGroup: 'Mình đã tóm tắt bộ lọc bên phải. Bạn xem số người khớp rồi bấm Tạo nhóm nếu đúng.',
  confirmRecipients: 'Mình đã tóm tắt bộ lọc bên phải. Bạn xem số người khớp rồi bấm Thêm vào danh sách nếu đúng.'
} as const

export interface DataGroupAgentHistoryTurn { role: 'user' | 'assistant'; text: string }
export interface DataGroupAgentPreview { matched: number; totalFriends: number }

export interface DataGroupAgentRequest {
  requestId: string
  /** Thiếu (bản Web cũ) = `data_group`. */
  purpose: DataGroupAgentPurpose
  sourceType: 'zalo_friends'
  accountId: number
  /** Đã che SĐT/UID/email ở trình duyệt. */
  message: string
  history: DataGroupAgentHistoryTurn[]
  /** Bộ lọc sau lượt trước (đúng tài khoản này). */
  draft: ZaloFriendFilter | null
  lastPreview: DataGroupAgentPreview | null
  groupName: string | null
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const keys = (value: Record<string, unknown>, expected: readonly string[]) => Object.keys(value).sort().join() === [...expected].sort().join()
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

/** Kiểm request từ trình duyệt; ném Error khi sai. */
export function validateDataGroupAgentRequest(input: unknown, today: string = vietnamToday()): DataGroupAgentRequest {
  const fail = (): never => { throw new Error(DATA_GROUP_AGENT_MESSAGES.invalid) }
  const base = ['requestId', 'sourceType', 'accountId', 'message', 'history', 'draft', 'lastPreview', 'groupName']
  if (!record(input) || !(keys(input, base) || keys(input, [...base, 'purpose']))
    || input.purpose !== undefined && !DATA_GROUP_AGENT_PURPOSES.includes(input.purpose as DataGroupAgentPurpose)
    || !uuid(input.requestId) || input.sourceType !== 'zalo_friends' || !positiveId(input.accountId)
    || !text(input.message, DATA_GROUP_AGENT_MAX_MESSAGE) || !input.message.trim()
    || !Array.isArray(input.history) || input.history.length > DATA_GROUP_AGENT_MAX_HISTORY_TURNS * 2
    || !(input.groupName === null || text(input.groupName, ZALO_FRIEND_FILTER_LIMITS.groupName))) return fail()
  const history = input.history.map(turn => {
    if (!record(turn) || !keys(turn, ['role', 'text']) || !['user', 'assistant'].includes(String(turn.role))
      || !text(turn.text, DATA_GROUP_AGENT_MAX_HISTORY_TEXT)) return fail()
    return { role: turn.role as 'user' | 'assistant', text: turn.text as string }
  })
  let draft: ZaloFriendFilter | null = null
  if (input.draft !== null) {
    try { draft = parseZaloFriendFilter(input.draft, today) } catch { return fail() }
    if (draft.accountId !== input.accountId) return fail()
  }
  let lastPreview: DataGroupAgentPreview | null = null
  if (input.lastPreview !== null) {
    if (!record(input.lastPreview) || !keys(input.lastPreview, ['matched', 'totalFriends'])
      || !count(input.lastPreview.matched) || !count(input.lastPreview.totalFriends)) return fail()
    lastPreview = { matched: input.lastPreview.matched, totalFriends: input.lastPreview.totalFriends }
  }
  const purpose: DataGroupAgentPurpose = input.purpose === 'campaign_recipients' ? 'campaign_recipients' : 'data_group'
  return {
    requestId: input.requestId, purpose, sourceType: 'zalo_friends', accountId: input.accountId, message: input.message.trim(), history,
    draft, lastPreview,
    // Form chiến dịch không tạo nhóm nên không có tên nhóm.
    groupName: purpose === 'campaign_recipients' || input.groupName === null ? null : (input.groupName as string).trim() || null
  }
}

/**
 * Che số điện thoại, email và dãy số dài (Zalo ID) trong mô tả của người dùng trước khi gửi AI. Trình duyệt che trước khi
 * gửi, máy chủ che lại lần nữa. Ngày tháng (01/11/2026), số lượng ("30 ngày", "lấy 100 người") giữ nguyên.
 */
export function redactDataGroupAgentText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/(?<![\d/])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?![\d/])/g, '[số điện thoại]')
    .replace(/(?<![\d/])\d{9,}(?![\d/])/g, '[mã số]')
}

// ---------------------------------------------------------------------------------------------------------------
// Danh mục theo tài khoản (API dựng, không tin trình duyệt)

export interface DataGroupAgentCatalog extends ZaloFriendFilterCatalog {
  account: ZaloFriendAccount
  /** Danh mục bị cắt (quá nhiều mục) thì AI được dặn hỏi người dùng chọn trên form. */
  dataGroupsIncomplete: boolean
  campaignsIncomplete: boolean
  coverage: {
    messagesSince: string | null
    trackingSince: string | null
    deliveredAvailable: boolean
    /** Khoảng dài nhất (ngày) mà điều kiện về tin nhắn xét được với tài khoản này (365 với đa số tài khoản). */
    maxMessageDays: number
  }
}

export const DATA_GROUP_AGENT_CATALOG_LIMITS = { zaloTags: 300, akaBizTags: 300, dataGroups: 200, campaigns: 100, campaignDays: 180 } as const

const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
export function vietnamWeekday(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()]
}

const withoutAccount = (filter: ZaloFriendFilter | null): ZaloFriendFilterDraft | null => {
  if (!filter) return null
  const { accountId: _accountId, ...draft } = filter
  return draft
}

/**
 * JSON `{{dataGroupAgentContext}}` (prompt_user của dòng Agent). Phần tĩnh (luật, ví dụ) nằm trong prompt hệ thống để
 * provider cache tiền tố; mọi thứ đổi theo lượt nằm ở đây.
 */
export function dataGroupAgentContext(request: DataGroupAgentRequest, catalog: DataGroupAgentCatalog, today: string = vietnamToday()) {
  return {
    purpose: request.purpose,
    today,
    weekday: vietnamWeekday(today),
    timeZone: 'Asia/Ho_Chi_Minh',
    account: {
      name: catalog.account.name,
      kind: catalog.account.kind === 'server' ? 'Zalo Server' : catalog.account.kind === 'web' ? 'Zalo trình duyệt' : 'Zalo Desktop',
      friendCount: catalog.account.friendCount,
      friendsUpdatedAt: catalog.account.friendsUpdatedAt
    },
    coverage: {
      messagesSince: catalog.coverage.messagesSince,
      trackingSince: catalog.coverage.trackingSince,
      deliveredAvailable: catalog.coverage.deliveredAvailable,
      chatHistory: false,
      lookbackDays: ZALO_FRIEND_FILTER_LIMITS.lookbackDays,
      maxMessageDays: catalog.coverage.maxMessageDays
    },
    catalogs: {
      zaloTags: catalog.zaloTags.map(tag => ({ id: tag.id, name: tag.name, count: tag.count ?? null })),
      akaBizTags: catalog.akaBizTags.map(tag => ({ id: tag.id, name: tag.name })),
      dataGroups: catalog.dataGroups.map(group => ({ id: group.id, name: group.name })),
      dataGroupsIncomplete: catalog.dataGroupsIncomplete,
      campaigns: catalog.campaigns.map(campaign => ({ id: campaign.id, name: campaign.name })),
      campaignsIncomplete: catalog.campaignsIncomplete
    },
    draft: withoutAccount(request.draft),
    lastPreview: request.lastPreview,
    groupName: request.groupName,
    history: request.history,
    message: request.message
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Kết quả model (Structured Outputs, strict). Sinh từ hợp đồng; migration chép nguyên văn (bài test so md5).

const enumString = (values: readonly string[]) => ({ type: 'string', enum: [...values] })
const strictObject = (properties: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties
})
const PERIOD_SCHEMA = strictObject({
  type: enumString(['last_days', 'range', 'all']),
  days: { type: ['integer', 'null'] },
  from: { type: ['string', 'null'] },
  to: { type: ['string', 'null'] }
})
const NULLABLE_PERIOD_SCHEMA = { anyOf: [PERIOD_SCHEMA, { type: 'null' }] }
const stringArray = (max: number) => ({ type: 'array', maxItems: max, items: { type: 'string' } })
const integerArray = (max: number) => ({ type: 'array', maxItems: max, items: { type: 'integer' } })

export const FRIEND_CONDITION_SCHEMAS = {
  zalo_tag: strictObject({ field: enumString(['zalo_tag']), op: enumString(FRIEND_SET_OPS), tagIds: stringArray(ZALO_FRIEND_FILTER_LIMITS.tagIds) }),
  akabiz_tag: strictObject({ field: enumString(['akabiz_tag']), op: enumString(FRIEND_SET_OPS), tagIds: integerArray(ZALO_FRIEND_FILTER_LIMITS.tagIds) }),
  gender: strictObject({ field: enumString(['gender']), values: { type: 'array', maxItems: 3, items: enumString(FRIEND_GENDERS) } }),
  birthday: strictObject({ field: enumString(['birthday']), op: enumString(['in_months', 'in_next_days', 'unknown']),
    months: integerArray(12), days: { type: ['integer', 'null'] } }),
  phone: strictObject({ field: enumString(['phone']), op: enumString(['has', 'missing']) }),
  name: strictObject({ field: enumString(['name']), op: enumString(['contains', 'not_contains', 'starts_with']), text: { type: 'string' } }),
  sent_count: strictObject({ field: enumString(['sent_count']), period: PERIOD_SCHEMA, op: enumString(['eq', 'gte', 'lte', 'between']),
    value: { type: 'integer' }, valueTo: { type: ['integer', 'null'] } }),
  latest_message: strictObject({ field: enumString(['latest_message']), op: enumString(['in', 'not_in']),
    stages: { type: 'array', maxItems: MESSAGE_STAGES.length, items: enumString(MESSAGE_STAGES) }, period: NULLABLE_PERIOD_SCHEMA }),
  messages_in_period: strictObject({ field: enumString(['messages_in_period']), period: PERIOD_SCHEMA, quantifier: enumString(['any', 'none']),
    status: enumString(FRIEND_MESSAGE_STATUSES), amongSent: { type: 'boolean' } }),
  interaction: strictObject({ field: enumString(['interaction']), kinds: { type: 'array', maxItems: 3, items: enumString(FRIEND_INTERACTION_KINDS) },
    op: enumString(['within', 'not_within']), period: PERIOD_SCHEMA }),
  campaign: strictObject({ field: enumString(['campaign']), op: enumString(['received', 'not_received']),
    campaignIds: integerArray(ZALO_FRIEND_FILTER_LIMITS.campaignIds), period: NULLABLE_PERIOD_SCHEMA }),
  data_group: strictObject({ field: enumString(['data_group']), op: enumString(['in', 'not_in']), groupIds: integerArray(ZALO_FRIEND_FILTER_LIMITS.groupIds) })
} as const

/** Bộ lọc AI trả về: đúng `ZaloFriendFilter` trừ `accountId` (server gắn theo form). */
export const ZALO_FRIEND_FILTER_DRAFT_SCHEMA = strictObject({
  version: { type: 'integer', enum: [1] },
  source: enumString(['zalo_friends']),
  match: enumString(['all', 'any']),
  groups: { type: 'array', maxItems: ZALO_FRIEND_FILTER_LIMITS.groups, items: strictObject({
    match: enumString(['all', 'any']),
    conditions: { type: 'array', maxItems: ZALO_FRIEND_FILTER_LIMITS.conditionsPerGroup,
      items: { anyOf: FRIEND_CONDITION_FIELDS.map(field => FRIEND_CONDITION_SCHEMAS[field]) } }
  }) },
  excludeOptedOut: { type: 'boolean' },
  excludeBlocked: { type: 'boolean' },
  sort: { anyOf: [strictObject({
    by: enumString(['last_sent_at', 'last_interaction_at', 'name', 'random']),
    direction: enumString(['asc', 'desc']),
    seed: { type: ['string', 'null'] }
  }), { type: 'null' }] },
  limit: { type: ['integer', 'null'] }
})

export const DATA_GROUP_AGENT_SCHEMA = strictObject({
  status: enumString(['ask', 'confirm', 'unsupported']),
  message: { type: 'string' },
  questions: { type: 'array', maxItems: 3, items: strictObject({ text: { type: 'string' }, options: stringArray(6) }) },
  assumptions: stringArray(5),
  unresolved: stringArray(5),
  groupName: { type: ['string', 'null'] },
  filter: { anyOf: [ZALO_FRIEND_FILTER_DRAFT_SCHEMA, { type: 'null' }] }
})

export interface DataGroupAgentQuestion { text: string; options: string[] }
export interface DataGroupAgentReply {
  status: 'ask' | 'confirm' | 'unsupported'
  message: string
  questions: DataGroupAgentQuestion[]
  assumptions: string[]
  /** Đã chuẩn hóa, có `accountId`; null khi chưa có bộ lọc nào. */
  filter: ZaloFriendFilter | null
  groupName: string | null
  /** Bản tóm tắt do code dựng từ `filter` (lưu kèm nhóm). */
  summary: string[]
  summaryLines: FriendFilterSummaryLine[]
  /** Phần AI trả sai đã bị bỏ, hiện trong lượt trả lời. */
  notes: string[]
}
export type DataGroupAgentResult =
  | { ok: true; reply: DataGroupAgentReply }
  | { ok: false; code: 'invalid' | 'unavailable' | 'cancelled' | 'not_configured' | 'forbidden' | 'no_friends' | 'account_unavailable'; message: string }

const cleanText = (value: unknown, max: number): string => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : ''
const cleanList = (value: unknown, maxItems: number, maxLength: number): string[] => Array.isArray(value)
  ? value.map(item => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems) : []

export interface DataGroupAgentParseOptions {
  today?: string
  /** Seed cho sắp xếp ngẫu nhiên chưa có seed (API dùng crypto.randomUUID). */
  makeSeed: () => string
}

/**
 * Xử lý sau AI (phương án mục 5.5): kiểm bộ lọc, bỏ mã lạ, đổi `confirm` thành `ask` khi còn ý chưa rõ hoặc bộ lọc lỗi,
 * gắn tài khoản, cấp seed, dựng tóm tắt. Không tự lưu gì.
 */
export function parseDataGroupAgentResponse(content: string, request: DataGroupAgentRequest, catalog: DataGroupAgentCatalog,
  options: DataGroupAgentParseOptions): DataGroupAgentResult {
  const today = options.today ?? vietnamToday()
  let raw: unknown
  try { raw = JSON.parse(content) } catch { return { ok: false, code: 'invalid', message: DATA_GROUP_AGENT_MESSAGES.invalid } }
  if (!record(raw) || !['ask', 'confirm', 'unsupported'].includes(String(raw.status))) {
    return { ok: false, code: 'invalid', message: DATA_GROUP_AGENT_MESSAGES.invalid }
  }
  let status = raw.status as DataGroupAgentReply['status']
  const recipients = request.purpose === 'campaign_recipients'
  const needConfirmation = recipients ? DATA_GROUP_AGENT_MESSAGES.needConfirmationRecipients : DATA_GROUP_AGENT_MESSAGES.needConfirmation
  const notes: string[] = []
  const questions: DataGroupAgentQuestion[] = Array.isArray(raw.questions) ? raw.questions.flatMap(item => {
    if (!record(item)) return []
    const question = cleanText(item.text, 500)
    return question ? [{ text: question, options: cleanList(item.options, 6, 120) }] : []
  }).slice(0, 3) : []
  const assumptions = cleanList(raw.assumptions, 5, 500)
  const unresolved = cleanList(raw.unresolved, 5, 500)
  let message = cleanText(raw.message, 1500)

  let draft: ZaloFriendFilterDraft | null = null
  if (raw.filter !== null && raw.filter !== undefined) {
    try { draft = parseZaloFriendFilterDraft(raw.filter, today) }
    catch (error) {
      notes.push(DATA_GROUP_AGENT_MESSAGES.invalidFilter + (error instanceof ZaloFriendFilterError ? ` (${error.reason})` : ''))
      draft = null
    }
  }
  let pruned = 0
  if (draft) {
    const result = pruneFriendFilterToCatalog(draft, catalog)
    if (result.removedIds) notes.push(DATA_GROUP_AGENT_MESSAGES.catalogPruned)
    pruned = result.removedConditions
    draft = result.filter
  }
  if (status === 'confirm' && (!draft || unresolved.length > 0 || pruned > 0 || notes.length > 0)) {
    status = 'ask'
    if (!questions.length) {
      const pending = unresolved.length ? unresolved : notes.length ? ['Bạn mô tả lại giúp mình các ý vừa bị bỏ (tag, nhóm hoặc chiến dịch) nhé?'] : []
      for (const item of pending.slice(0, 3)) questions.push({ text: item, options: [] })
    }
    if (!message) message = needConfirmation
  }
  // Lượt hỏi lại không xóa bộ lọc đang có: AI không gửi bộ lọc thì giữ bộ lọc của lượt trước.
  const filter = draft
    ? ensureFriendFilterSeed(attachFriendFilterAccount(draft, request.accountId), options.makeSeed)
    : status === 'confirm' ? null : request.draft
  if (!message) message = status === 'confirm'
    ? recipients ? DATA_GROUP_AGENT_MESSAGES.confirmRecipients : DATA_GROUP_AGENT_MESSAGES.confirmGroup
    : needConfirmation
  const summaryOptions = { today, accountName: catalog.account.name, trackingSince: catalog.coverage.trackingSince }
  const groupName = recipients ? null : cleanText(raw.groupName, DATA_GROUP_AGENT_GROUP_NAME_MAX) || request.groupName || null
  return {
    ok: true,
    reply: {
      status, message, questions, assumptions, filter, groupName,
      summary: filter ? describeZaloFriendFilter(filter, catalog, summaryOptions) : [],
      summaryLines: filter ? describeZaloFriendFilterLines(filter, catalog, summaryOptions) : [],
      notes
    }
  }
}
