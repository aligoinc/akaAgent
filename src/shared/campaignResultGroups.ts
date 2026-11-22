/**
 * Đưa khách vào nhóm khách hàng theo kết quả chạy của chiến dịch (docs/CAMPAIGN_RESULT_GROUPS.md).
 *
 * Mỗi dòng của khung "Sau khi chạy: đưa khách vào nhóm" là một nhóm khách hàng + một tập khóa kết quả nối bằng HOẶC.
 * Lưu chiến dịch thì máy chủ tạo, với mỗi chiến dịch và mỗi dòng, một quy trình hai khối trên bộ máy Tự động hóa:
 * "Kết quả chiến dịch (các khóa đã chọn) → Đưa vào nhóm khách hàng". Khóa đi thẳng vào mảng `statuses` của nguồn quy trình:
 *   `<mã hành động>::<trạng thái>`  trạng thái ghi lúc hành động chạy xong (cột status của kết quả, chữ thường);
 *   `<mã hành động>::@<dấu>`        trạng thái đến sau (đã xem, đã phản hồi, đã thả cảm xúc, đã đồng ý kết bạn, SMS đã nhận về trễ),
 *                                   do hàng sự kiện đến sau của DB ghi.
 * Thuần, không import: Web, API, Desktop (chép nguyên văn sang akaAgent `src/shared/campaignResultGroups.ts`) dùng chung.
 * Sửa ở đây trước.
 *
 * Facebook (22/11/2026, người dùng chốt mở rộng): đối tượng có thể là một người (UID, khách inbox Page), một group,
 * một page hoặc một bài viết; nhóm nhận là Nhóm data đúng loại Facebook. Facebook không có kết quả "Sau khi gửi".
 */

export const CAMPAIGN_RESULT_GROUPS_TEMPLATE_CODE = 'campaign_groups'
export const CAMPAIGN_RESULT_GROUPS_MAX_ROWS = 5
/** Trần của mảng `statuses` của một nguồn quy trình (hàm bật quy trình V473). */
export const CAMPAIGN_RESULT_GROUPS_MAX_KEYS = 30
/** Cửa sổ theo dõi tương tác Zalo (V339, `zalo.campaign_engagement.tracking_window_hours` = 168). */
export const CAMPAIGN_RESULT_GROUPS_LATE_DAYS = 7
/** Chiến dịch đã hoàn thành và quá chừng này ngày không có kết quả mới thì quy trình tự dừng. */
export const CAMPAIGN_RESULT_GROUPS_IDLE_DAYS = 30
/** Thời gian từ lúc có kết quả tới lúc khách vào nhóm (mốc trễ 3 phút của bộ máy + một nhịp 30 giây). */
export const CAMPAIGN_RESULT_GROUPS_DELAY_TEXT = 'khoảng 3–5 phút'

export type CampaignResultLateMark = 'seen' | 'replied' | 'reacted' | 'friended' | 'received'
export const CAMPAIGN_RESULT_LATE_MARKS: readonly CampaignResultLateMark[] = ['seen', 'replied', 'reacted', 'friended', 'received']
export const CAMPAIGN_RESULT_LATE_MARK_LABELS: Readonly<Record<CampaignResultLateMark, string>> = {
  seen: 'Đã xem',
  replied: 'Đã phản hồi',
  reacted: 'Đã thả cảm xúc',
  friended: 'Đã đồng ý kết bạn',
  received: 'Đã nhận'
}
/** Dấu đến từ bảng theo dõi tương tác Zalo: chỉ tài khoản đang được theo dõi mới có. */
export const ZALO_ENGAGEMENT_LATE_MARKS: readonly CampaignResultLateMark[] = ['seen', 'replied', 'reacted', 'friended']
/** Trạng thái đến sau theo hành động (DB ghi đúng các khóa này, xem migration_campaign_result_groups.sql). */
export const CAMPAIGN_RESULT_LATE_MARKS_BY_ACTION: Readonly<Record<string, readonly CampaignResultLateMark[]>> = {
  zalo_message_stranger: ['seen', 'replied', 'reacted'],
  zalo_message_friend: ['seen', 'replied', 'reacted'],
  zalo_add_friend: ['friended'],
  sms_send: ['received']
}
/** Dấu đến sau cùng nghĩa với một trạng thái lúc chạy: gộp vào một ô (tick một lần là có cả hai khóa). */
const LATE_MARK_RUN_STATUS: Partial<Record<CampaignResultLateMark, string>> = { received: 'đã nhận', seen: 'đã xem' }

/** Loại chiến dịch Facebook có khung. Đăng trang cá nhân / fanpage, lướt newsfeed, tìm data: không có. */
export const CAMPAIGN_RESULT_FACEBOOK_ACTIONS = [
  'facebook_message_uid', 'facebook_message_friend', 'facebook_group_invite', 'facebook_page_to_message',
  'facebook_group_post', 'facebook_join_group', 'facebook_comment_seeding_post', 'facebook_comment_seeding'
] as const

/** Loại chiến dịch có khung (Zalo/SMS gửi tới từng người, và Facebook). Gửi tin vào group Zalo, tham gia group Zalo, email: không có. */
export const CAMPAIGN_RESULT_GROUP_ACTIONS = [
  'zalo_message_phone', 'zalo_message_friend', 'zalo_message_group_member', 'zalo_message_group_realtime',
  'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation', 'zalo_message_birthday',
  'zalo_add_group_member', 'zalo_cancel_sent_friend_request', 'sms_send', 'voice_call',
  ...CAMPAIGN_RESULT_FACEBOOK_ACTIONS
] as const

export const campaignResultIsFacebook = (actionId: string | null | undefined): boolean =>
  Boolean(actionId) && (CAMPAIGN_RESULT_FACEBOOK_ACTIONS as readonly string[]).includes(actionId!)

/** Hành động có thể chạy theo loại chiến dịch (form quyết định hành động nào thật sự bật). */
export const CAMPAIGN_RESULT_ACTION_CODES_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  zalo_message_phone: ['zalo_find_phone_user', 'zalo_add_friend', 'zalo_message_stranger', 'zalo_tag_contact', 'zalo_change_alias'],
  zalo_message_group_member: ['zalo_add_friend', 'zalo_message_stranger', 'zalo_tag_contact', 'zalo_change_alias'],
  zalo_message_group_realtime: ['zalo_add_friend', 'zalo_message_stranger', 'zalo_tag_contact', 'zalo_change_alias'],
  zalo_message_remarketing_customer: ['zalo_add_friend', 'zalo_message_stranger', 'zalo_tag_contact', 'zalo_change_alias'],
  zalo_message_friend_recommendation: ['zalo_add_friend', 'zalo_message_stranger', 'zalo_tag_contact', 'zalo_change_alias'],
  zalo_message_friend: ['zalo_message_friend', 'zalo_tag_contact', 'zalo_change_alias'],
  zalo_message_birthday: ['zalo_message_friend'],
  zalo_add_group_member: ['zalo_find_phone_user', 'zalo_add_group_member'],
  zalo_cancel_sent_friend_request: ['zalo_cancel_sent_friend_request'],
  sms_send: ['sms_send'],
  voice_call: ['voice_call'],
  facebook_message_uid: ['fb_add_friend', 'fb_message_stranger'],
  facebook_message_friend: ['fb_message_friend'],
  facebook_group_invite: ['fb_group_invite'],
  facebook_page_to_message: ['fb_message_page_inbox_customer'],
  facebook_group_post: ['fb_post_group', 'fb_comment'],
  facebook_join_group: ['fb_join_group'],
  facebook_comment_seeding_post: ['fb_comment'],
  facebook_comment_seeding: ['fb_comment']
}

/** Công tắc của form quyết định hành động nào thật sự chạy (tìm SĐT, nhắn tin bạn bè, SMS… luôn chạy). */
export interface CampaignResultActionFlags {
  enableMessage?: boolean
  enableAddFriend?: boolean
  enableZaloTag?: boolean
  enableZaloAlias?: boolean
  /** Facebook đăng nhóm: "Kiêm comment" (extra_settings.enableComment). */
  enableComment?: boolean
}

/** Hành động đang bật của chiến dịch theo form; kết quả của hành động đang tắt bị bỏ khi lưu. */
export function campaignResultEnabledActionCodes(actionId: string | null | undefined, flags: CampaignResultActionFlags = {}): string[] {
  const codes = (actionId && CAMPAIGN_RESULT_ACTION_CODES_BY_TYPE[actionId]) || []
  return codes.filter(code => {
    // Facebook theo đúng cách bộ chạy đọc extra_settings (facebookAccountActionCodes): nhắn tin bật trừ khi tắt hẳn.
    if (code === 'fb_add_friend') return flags.enableAddFriend === true
    if (code === 'fb_message_stranger') return flags.enableMessage !== false
    if (code === 'fb_comment' && actionId === 'facebook_group_post') return flags.enableComment === true
    if (code === 'zalo_add_friend') return flags.enableAddFriend === true
    if (code === 'zalo_message_stranger') return flags.enableMessage === true
    if (code === 'zalo_tag_contact') return flags.enableZaloTag === true
    if (code === 'zalo_change_alias') return flags.enableZaloAlias === true
    return true
  })
}

/** Khóa còn dùng được với hành động đang bật: có danh mục thì theo danh mục, chưa có thì chỉ xét hành động. */
export type CampaignResultKeyFilter = Set<string> | ((key: string) => boolean)
export function campaignResultUsableKeys(options: CampaignResultGroupOptions | null | undefined, enabledActionCodes: readonly string[]): CampaignResultKeyFilter {
  if (options) return campaignResultAllowedKeys(options, enabledActionCodes)
  return (key: string) => {
    const parsed = parseCampaignResultKey(key)
    return Boolean(parsed && enabledActionCodes.includes(parsed.actionCode))
  }
}

export const CAMPAIGN_RESULT_ACTION_NAMES: Readonly<Record<string, string>> = {
  zalo_find_phone_user: 'Tìm Zalo theo SĐT',
  zalo_add_friend: 'Kết bạn',
  zalo_message_stranger: 'Nhắn tin',
  zalo_message_friend: 'Nhắn tin bạn bè',
  zalo_add_group_member: 'Thêm vào group',
  zalo_cancel_sent_friend_request: 'Hủy lời mời kết bạn',
  zalo_tag_contact: 'Gắn tag Zalo',
  zalo_change_alias: 'Đổi tên gợi nhớ',
  sms_send: 'Gửi SMS',
  voice_call: 'Gọi điện',
  fb_add_friend: 'Kết bạn',
  fb_message_stranger: 'Nhắn tin',
  fb_message_friend: 'Nhắn tin bạn bè',
  fb_group_invite: 'Mời vào group',
  fb_message_page_inbox_customer: 'Nhắn tin khách inbox Page',
  fb_post_group: 'Đăng bài',
  fb_comment: 'Comment',
  fb_join_group: 'Tham gia group'
}

export type CampaignResultFacebookGroupType = 'facebook_person' | 'facebook_group' | 'facebook_page' | 'facebook_post_url' | 'facebook_page_inbox_customer'
export type CampaignResultGroupType = 'phone' | 'zalo_person' | CampaignResultFacebookGroupType
export const CAMPAIGN_RESULT_GROUP_TYPE_LABELS: Readonly<Record<CampaignResultGroupType, string>> = {
  phone: 'theo SĐT',
  zalo_person: 'theo UID',
  facebook_person: 'User Facebook',
  facebook_group: 'Group Facebook',
  facebook_page: 'Page Facebook',
  facebook_post_url: 'Link bài viết Facebook',
  facebook_page_inbox_customer: 'Khách inbox Page'
}
const CAMPAIGN_RESULT_GROUP_TYPE_CODES = Object.keys(CAMPAIGN_RESULT_GROUP_TYPE_LABELS) as CampaignResultGroupType[]

export const campaignResultGroupsSupported = (actionId: string | null | undefined): boolean =>
  Boolean(actionId) && (CAMPAIGN_RESULT_GROUP_ACTIONS as readonly string[]).includes(actionId!)

/**
 * Loại nhóm nhận được khách của loại chiến dịch. Nhóm chưa đặt loại nhận khách là một người (nạp theo SĐT nếu có, không thì
 * theo UID + tài khoản), trừ khách inbox Page. Nhóm theo UID nhận khách kèm tài khoản đã chạy chiến dịch (khách chỉ có UID chỉ
 * gửi được bằng tài khoản đã tìm ra họ).
 */
export function campaignResultGroupTypes(actionId: string | null | undefined): CampaignResultGroupType[] {
  if (!campaignResultGroupsSupported(actionId)) return []
  if (actionId === 'sms_send' || actionId === 'voice_call') return ['phone']
  if (actionId === 'zalo_message_phone' || actionId === 'zalo_add_group_member') return ['phone', 'zalo_person']
  if (actionId === 'facebook_message_uid' || actionId === 'facebook_message_friend' || actionId === 'facebook_group_invite') return ['facebook_person']
  if (actionId === 'facebook_page_to_message') return ['facebook_page_inbox_customer']
  if (actionId === 'facebook_group_post' || actionId === 'facebook_join_group') return ['facebook_group']
  if (actionId === 'facebook_comment_seeding_post') return ['facebook_post_url']
  if (actionId === 'facebook_comment_seeding') return ['facebook_group', 'facebook_page', 'facebook_person']
  return ['zalo_person']
}

export const campaignResultGroupTypeOf = (code: string | null | undefined): CampaignResultGroupType | null =>
  code && (CAMPAIGN_RESULT_GROUP_TYPE_CODES as readonly string[]).includes(code) ? code as CampaignResultGroupType : null

/**
 * Đối tượng của loại chiến dịch: một người, một group, một bài viết, hay lẫn group / page / trang cá nhân (comment seeding).
 * Quyết định câu của khung ("đưa khách / group / bài viết vào nhóm") và việc nhóm chưa đặt loại có nhận được không.
 */
export type CampaignResultTargetKind = 'person' | 'group' | 'post' | 'mixed'
export function campaignResultTargetKind(actionId: string | null | undefined): CampaignResultTargetKind {
  if (actionId === 'facebook_group_post' || actionId === 'facebook_join_group') return 'group'
  if (actionId === 'facebook_comment_seeding_post') return 'post'
  if (actionId === 'facebook_comment_seeding') return 'mixed'
  return 'person'
}

/** Nhóm chưa đặt loại có nhận được không: chỉ khi đối tượng là một người và không phải khách inbox Page. */
export const campaignResultUntypedGroupAccepted = (actionId: string | null | undefined): boolean =>
  campaignResultGroupsSupported(actionId) && campaignResultTargetKind(actionId) === 'person' && actionId !== 'facebook_page_to_message'

/** Nhóm có nhận được khách của loại chiến dịch không (nhóm loại khác, ví dụ group Zalo cho chiến dịch nhắn tin, thì không). */
export function campaignResultGroupAccepts(actionId: string | null | undefined, groupTypeCode: string | null | undefined): boolean {
  if (!campaignResultGroupsSupported(actionId)) return false
  if (!groupTypeCode) return campaignResultUntypedGroupAccepted(actionId)
  const type = campaignResultGroupTypeOf(groupTypeCode)
  return Boolean(type && campaignResultGroupTypes(actionId).includes(type))
}

/** Chữ của khung theo đối tượng: tiêu đề, danh từ đầu câu ("Khách vào nhóm khi"), tên nhóm ("nhóm khách hàng" / "nhóm data"). */
export interface CampaignResultGroupsWording {
  title: string
  subject: string
  groupNoun: string
}
export function campaignResultGroupsWording(actionId: string | null | undefined): CampaignResultGroupsWording {
  switch (campaignResultTargetKind(actionId)) {
    case 'group': return { title: 'Sau khi chạy: đưa group vào nhóm', subject: 'Group', groupNoun: 'nhóm data' }
    case 'post': return { title: 'Sau khi chạy: đưa bài viết vào nhóm', subject: 'Bài viết', groupNoun: 'nhóm data' }
    case 'mixed': return { title: 'Sau khi chạy: đưa data vào nhóm', subject: 'Data', groupNoun: 'nhóm data' }
    default: return { title: 'Sau khi chạy: đưa khách vào nhóm', subject: 'Khách', groupNoun: 'nhóm khách hàng' }
  }
}

// ---------------------------------------------------------------------------
// Khóa kết quả
// ---------------------------------------------------------------------------

const ACTION_CODE = /^[a-z][a-z0-9_]{1,60}$/
const normalizeStatus = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()

export const campaignResultStatusKey = (actionCode: string, status: string): string => `${actionCode}::${normalizeStatus(status)}`
export const campaignResultLateKey = (actionCode: string, mark: CampaignResultLateMark): string => `${actionCode}::@${mark}`

export interface ParsedCampaignResultKey {
  actionCode: string
  /** Trạng thái lúc chạy (chữ thường); null khi là dấu đến sau. */
  status: string | null
  mark: CampaignResultLateMark | null
}

export function parseCampaignResultKey(key: unknown): ParsedCampaignResultKey | null {
  if (typeof key !== 'string' || key.length > 100) return null
  const index = key.indexOf('::')
  if (index <= 0) return null
  const actionCode = key.slice(0, index)
  const value = key.slice(index + 2)
  if (!ACTION_CODE.test(actionCode) || !value) return null
  if (value.startsWith('@')) {
    const mark = value.slice(1) as CampaignResultLateMark
    return CAMPAIGN_RESULT_LATE_MARKS.includes(mark) ? { actionCode, status: null, mark } : null
  }
  if (value !== normalizeStatus(value) || value.length > 60) return null
  return { actionCode, status: value, mark: null }
}

/** Khóa có kèm theo dõi tương tác Zalo không (chỉ có với tài khoản đang được theo dõi). */
export const campaignResultKeyNeedsTracking = (key: string): boolean => {
  const parsed = parseCampaignResultKey(key)
  return Boolean(parsed?.mark && ZALO_ENGAGEMENT_LATE_MARKS.includes(parsed.mark))
}

/** Khóa không bao giờ mang UID Zalo (khách không có Zalo, tin SMS/cuộc gọi): không vào được nhóm theo UID. */
export function campaignResultKeyCarriesUid(key: string): boolean {
  const parsed = parseCampaignResultKey(key)
  if (!parsed) return false
  if (parsed.actionCode === 'sms_send' || parsed.actionCode === 'voice_call') return false
  if (parsed.status === 'không tồn tại') return false
  if (parsed.actionCode === 'zalo_find_phone_user' && parsed.status !== 'thành công') return false
  return true
}

// ---------------------------------------------------------------------------
// Lựa chọn của khung (API dựng từ danh mục trạng thái theo loại chiến dịch)
// ---------------------------------------------------------------------------

export interface CampaignResultStatusChoice {
  /** Khóa đại diện (khóa đầu của `keys`), dùng làm key khi vẽ. */
  id: string
  label: string
  /** Một ô có thể mang nhiều khóa (SMS "Đã nhận" = lúc chạy + về trễ). */
  keys: string[]
  late: boolean
  /** Cần tài khoản đang được theo dõi tương tác Zalo. */
  needsTracking: boolean
}

export interface CampaignResultActionChoice {
  code: string
  name: string
  statuses: CampaignResultStatusChoice[]
  late: CampaignResultStatusChoice[]
}

export interface CampaignResultGroupOptions {
  actionId: string
  supported: boolean
  actions: CampaignResultActionChoice[]
  /** Tài khoản (trong số đã hỏi) đang được theo dõi tương tác Zalo. */
  trackedAccountIds: number[]
  groupTypes: CampaignResultGroupType[]
  /** API trả kèm: `false` khi chỗ dừng khẩn cấp `web.campaign_result_groups` đang tắt (dòng mới không được lưu). */
  enabled?: boolean
}

/** Một dòng của danh mục `auto_campaign_action_detail_statuses` (action_code null = áp cho mọi hành động của loại). */
export interface CampaignResultCatalogRow {
  actionCode: string | null
  statusValue: string
  label?: string | null
  sortOrder?: number | null
}

const capitalize = (value: string) => value ? value.charAt(0).toLocaleUpperCase('vi-VN') + value.slice(1) : value

export function buildCampaignResultGroupOptions(actionId: string, catalog: CampaignResultCatalogRow[], trackedAccountIds: number[] = []): CampaignResultGroupOptions {
  const supported = campaignResultGroupsSupported(actionId)
  const empty: CampaignResultGroupOptions = { actionId, supported, actions: [], trackedAccountIds: [], groupTypes: campaignResultGroupTypes(actionId) }
  if (!supported) return empty
  const sorted = [...catalog].filter(row => typeof row.statusValue === 'string' && row.statusValue.trim())
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const wildcard = sorted.filter(row => !row.actionCode)
  const actions: CampaignResultActionChoice[] = []
  for (const code of CAMPAIGN_RESULT_ACTION_CODES_BY_TYPE[actionId] ?? []) {
    const explicit = sorted.filter(row => row.actionCode === code)
    const source = explicit.length ? explicit : wildcard.length ? wildcard : [{ actionCode: code, statusValue: 'thành công' }, { actionCode: code, statusValue: 'thất bại' }]
    const statuses: CampaignResultStatusChoice[] = []
    const seen = new Set<string>()
    for (const row of source) {
      const status = normalizeStatus(row.statusValue)
      const key = campaignResultStatusKey(code, status)
      if (seen.has(key) || status.length > 60) continue
      seen.add(key)
      statuses.push({ id: key, label: capitalize((row.label || status).trim()), keys: [key], late: false, needsTracking: false })
    }
    const late: CampaignResultStatusChoice[] = []
    for (const mark of CAMPAIGN_RESULT_LATE_MARKS_BY_ACTION[code] ?? []) {
      const key = campaignResultLateKey(code, mark)
      const run = LATE_MARK_RUN_STATUS[mark]
      const merged = run ? statuses.find(item => item.id === campaignResultStatusKey(code, run)) : undefined
      const needsTracking = ZALO_ENGAGEMENT_LATE_MARKS.includes(mark)
      if (merged) {
        merged.keys.push(key)
        continue
      }
      late.push({ id: key, label: CAMPAIGN_RESULT_LATE_MARK_LABELS[mark], keys: [key], late: true, needsTracking })
    }
    if (statuses.length || late.length) {
      actions.push({ code, name: CAMPAIGN_RESULT_ACTION_NAMES[code] ?? code, statuses, late })
    }
  }
  return { ...empty, actions, trackedAccountIds: Array.from(new Set(trackedAccountIds.filter(id => Number.isSafeInteger(id) && id > 0))) }
}

/** Mọi khóa hợp lệ của các hành động đang bật (Web lọc bằng hành động form đang chạy). */
export function campaignResultAllowedKeys(options: CampaignResultGroupOptions | null | undefined, enabledActionCodes?: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const action of options?.actions ?? []) {
    if (enabledActionCodes && !enabledActionCodes.includes(action.code)) continue
    for (const choice of [...action.statuses, ...action.late]) for (const key of choice.keys) out.add(key)
  }
  return out
}

/** "Nhắn tin · đã phản hồi, hoặc Kết bạn · đã đồng ý kết bạn" (một ô nhiều khóa chỉ hiện một lần). */
export function campaignResultKeysSummary(keys: readonly string[], options?: CampaignResultGroupOptions | null): string {
  const parts: string[] = []
  const used = new Set<string>()
  for (const key of keys) {
    if (used.has(key)) continue
    const parsed = parseCampaignResultKey(key)
    if (!parsed) continue
    const action = options?.actions.find(item => item.code === parsed.actionCode)
    const choice = action ? [...action.statuses, ...action.late].find(item => item.keys.includes(key)) : undefined
    for (const other of choice?.keys ?? [key]) used.add(other)
    const actionName = action?.name ?? CAMPAIGN_RESULT_ACTION_NAMES[parsed.actionCode] ?? parsed.actionCode
    const label = choice?.label ?? (parsed.mark ? CAMPAIGN_RESULT_LATE_MARK_LABELS[parsed.mark] : parsed.status!)
    parts.push(`${actionName} · ${label.toLocaleLowerCase('vi-VN')}`)
  }
  return parts.join(', hoặc ')
}

// ---------------------------------------------------------------------------
// Dòng trong form
// ---------------------------------------------------------------------------

export interface CampaignResultGroupDraft {
  /** Khóa cục bộ của dòng (không gửi máy chủ). */
  key: string
  groupId: number | null
  keys: string[]
}

export type CampaignResultGroupIssueCode = 'group_missing' | 'group_duplicate' | 'group_type' | 'group_account' | 'keys_missing' | 'too_many_keys' | 'too_many_rows' | 'uid_no_zalo'

export interface CampaignResultGroupIssue {
  /** -1 = cả khung. */
  index: number
  code: CampaignResultGroupIssueCode
  severity: 'error' | 'warning'
  message: string
}

export interface CampaignResultGroupValidateOptions {
  actionId?: string | null
  /** Khóa hợp lệ của các hành động đang bật; khóa ngoài tập này bị bỏ khi lưu (không báo lỗi). */
  allowedKeys?: CampaignResultKeyFilter
  /** Mã loại nhóm (`phone`, `zalo_person`, null = chưa đặt loại, undefined = chưa biết). */
  groupTypeOf?: (groupId: number) => string | null | undefined
  /** Tài khoản Zalo nhóm đang gắn (null = không gắn, undefined = chưa biết). */
  groupAccountOf?: (groupId: number) => number | null | undefined
  /** Tài khoản chạy chiến dịch: nhóm theo UID gắn tài khoản khác thì không nhận được khách. */
  accountIds?: readonly number[]
}

/** Nhóm theo UID gắn với một tài khoản Zalo không chạy chiến dịch: khách (UID của tài khoản chạy) không vào được. */
export function campaignResultGroupAccountMismatch(groupTypeCode: string | null | undefined, boundAccountId: number | null | undefined, accountIds: readonly number[]): boolean {
  return groupTypeCode === 'zalo_person' && typeof boundAccountId === 'number' && boundAccountId > 0
    && accountIds.length > 0 && accountIds.some(id => id !== boundAccountId)
}

/** Khóa sẽ được lưu của một dòng: hợp lệ, không trùng, thuộc hành động đang bật. */
export function campaignResultEffectiveKeys(keys: readonly string[], allowedKeys?: CampaignResultKeyFilter): string[] {
  const out: string[] = []
  for (const key of keys) {
    if (!parseCampaignResultKey(key) || out.includes(key)) continue
    if (allowedKeys && !(typeof allowedKeys === 'function' ? allowedKeys(key) : allowedKeys.has(key))) continue
    out.push(key)
  }
  return out
}

export function validateCampaignResultGroups(rows: readonly CampaignResultGroupDraft[], options: CampaignResultGroupValidateOptions = {}): CampaignResultGroupIssue[] {
  const issues: CampaignResultGroupIssue[] = []
  if (rows.length > CAMPAIGN_RESULT_GROUPS_MAX_ROWS) {
    issues.push({ index: -1, code: 'too_many_rows', severity: 'error', message: `Tối đa ${CAMPAIGN_RESULT_GROUPS_MAX_ROWS} nhóm.` })
  }
  rows.forEach((row, index) => {
    const label = `Nhóm ${index + 1}`
    if (!row.groupId) issues.push({ index, code: 'group_missing', severity: 'error', message: `${label}: chọn nhóm khách hàng.` })
    else if (rows.some((other, j) => j < index && other.groupId === row.groupId)) {
      issues.push({ index, code: 'group_duplicate', severity: 'error', message: `${label}: nhóm này đã dùng ở dòng khác.` })
    }
    const type = row.groupId && options.groupTypeOf ? options.groupTypeOf(row.groupId) : undefined
    if (row.groupId && type !== undefined && options.actionId && !campaignResultGroupAccepts(options.actionId, type)) {
      issues.push({ index, code: 'group_type', severity: 'error', message: `${label}: nhóm này không nhận được khách của loại chiến dịch này.` })
    }
    const bound = row.groupId && options.groupAccountOf ? options.groupAccountOf(row.groupId) : undefined
    if (row.groupId && type !== undefined && campaignResultGroupAccountMismatch(type, bound, options.accountIds ?? [])) {
      issues.push({ index, code: 'group_account', severity: 'error',
        message: `${label}: nhóm gắn với một tài khoản Zalo khác tài khoản chạy chiến dịch nên khách không vào được; chọn nhóm khác.` })
    }
    const keys = campaignResultEffectiveKeys(row.keys, options.allowedKeys)
    if (keys.length === 0) issues.push({ index, code: 'keys_missing', severity: 'error', message: `${label}: chọn ít nhất một kết quả.` })
    else if (keys.length > CAMPAIGN_RESULT_GROUPS_MAX_KEYS) {
      issues.push({ index, code: 'too_many_keys', severity: 'error', message: `${label}: tối đa ${CAMPAIGN_RESULT_GROUPS_MAX_KEYS} kết quả.` })
    }
    if (type === 'zalo_person' && keys.length > 0 && keys.every(key => !campaignResultKeyCarriesUid(key))) {
      issues.push({ index, code: 'uid_no_zalo', severity: 'warning',
        message: 'Khách không có Zalo thì không có UID, nên không vào được nhóm theo UID. Hãy chọn một nhóm theo SĐT cho các kết quả này.' })
    }
  })
  return issues
}

/** Đọc lại các dòng từ bản nháp (dữ liệu lạ thì bỏ). */
export function restoreCampaignResultGroupDrafts(value: unknown): CampaignResultGroupDraft[] {
  if (!Array.isArray(value)) return []
  const out: CampaignResultGroupDraft[] = []
  for (const item of value.slice(0, CAMPAIGN_RESULT_GROUPS_MAX_ROWS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const raw = item as Record<string, unknown>
    const groupId = Number(raw.groupId)
    const keys = Array.isArray(raw.keys) ? raw.keys.filter((key): key is string => parseCampaignResultKey(key) !== null) : []
    out.push({
      key: typeof raw.key === 'string' && raw.key ? raw.key.slice(0, 40) : `r${out.length + 1}`,
      groupId: Number.isSafeInteger(groupId) && groupId > 0 ? groupId : null,
      keys: Array.from(new Set(keys)).slice(0, CAMPAIGN_RESULT_GROUPS_MAX_KEYS)
    })
  }
  return out
}

/** Dòng gửi lên máy chủ (đã lọc khóa của hành động đang bật); dòng thiếu nhóm hoặc thiếu khóa bị bỏ. */
export function campaignResultGroupRowsForSave(rows: readonly CampaignResultGroupDraft[], allowedKeys?: CampaignResultKeyFilter): Array<{ groupId: number; keys: string[] }> {
  const out: Array<{ groupId: number; keys: string[] }> = []
  for (const row of rows) {
    const keys = campaignResultEffectiveKeys(row.keys, allowedKeys)
    if (!row.groupId || keys.length === 0 || out.some(item => item.groupId === row.groupId)) continue
    out.push({ groupId: row.groupId, keys: keys.slice(0, CAMPAIGN_RESULT_GROUPS_MAX_KEYS) })
  }
  return out
}

// ---------------------------------------------------------------------------
// Hợp đồng API
// ---------------------------------------------------------------------------

export interface SaveCampaignResultGroupsRequest {
  rows: Array<{ groupId: number; keys: string[] }>
  /** Gọi lại với cùng nội dung không tạo quy trình thứ hai (máy chủ khớp theo chiến dịch + nhóm). */
  requestId: string
  /** Áp cả cho kết quả đã có của chiến dịch (chỉ trạng thái lúc chạy). */
  includeExisting?: boolean
}

export type CampaignResultGroupState = 'draft' | 'active' | 'paused' | 'stopped'
export type CampaignResultGroupReason = 'user' | 'idle' | 'group_deleted' | 'campaign_deleted' | 'removed'
export const CAMPAIGN_RESULT_GROUP_REASONS: readonly CampaignResultGroupReason[] = ['user', 'idle', 'group_deleted', 'campaign_deleted', 'removed']

export interface CampaignResultGroupItem {
  /** Mã dòng liên kết. */
  id: number
  journeyId: number
  campaignId: number
  groupId: number
  groupName: string
  groupType: CampaignResultGroupType | null
  groupDeleted: boolean
  keys: string[]
  state: CampaignResultGroupState
  reason: CampaignResultGroupReason | null
  reasonAt: string | null
  pausedAt: string | null
  createdAt: string
  /** Khách đã đi qua bước đưa vào nhóm. */
  added: number
  /** Khách đang chờ (vừa vào quy trình, chưa tới lượt). */
  pending: number
  campaignName?: string
  campaignDeleted?: boolean
  accountName?: string | null
}

export interface CampaignResultGroupList {
  items: CampaignResultGroupItem[]
}

export type CampaignResultGroupStatusAction = 'pause' | 'resume' | 'stop'

export interface CampaignResultGroupStatusRequest {
  action: CampaignResultGroupStatusAction
  /** Bật lại: đưa cả khách đạt kết quả trong lúc tắt. */
  includePaused?: boolean
}

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})
const positive = (value: unknown) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : 0 }
const count = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 }
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const nullableText = (value: unknown) => (typeof value === 'string' && value ? value : null)

/** Đọc một dòng từ máy chủ; thiếu trường bắt buộc thì null. */
export function parseCampaignResultGroupItem(value: unknown): CampaignResultGroupItem | null {
  const raw = record(value)
  const id = positive(raw.id)
  const journeyId = positive(raw.journeyId)
  const campaignId = positive(raw.campaignId)
  const groupId = positive(raw.groupId)
  if (!id || !journeyId || !campaignId || !groupId) return null
  const state = (['draft', 'active', 'paused', 'stopped'] as const).find(item => item === raw.state) ?? 'draft'
  const reason = CAMPAIGN_RESULT_GROUP_REASONS.find(item => item === raw.reason) ?? null
  return {
    id, journeyId, campaignId, groupId,
    groupName: text(raw.groupName) || `Nhóm #${groupId}`,
    groupType: campaignResultGroupTypeOf(text(raw.groupType)),
    groupDeleted: raw.groupDeleted === true,
    keys: Array.isArray(raw.keys) ? raw.keys.filter((key): key is string => typeof key === 'string') : [],
    state, reason,
    reasonAt: nullableText(raw.reasonAt),
    pausedAt: nullableText(raw.pausedAt),
    createdAt: text(raw.createdAt),
    added: count(raw.added),
    pending: count(raw.pending),
    ...(raw.campaignName !== undefined ? { campaignName: text(raw.campaignName) } : {}),
    ...(raw.campaignDeleted !== undefined ? { campaignDeleted: raw.campaignDeleted === true } : {}),
    ...(raw.accountName !== undefined ? { accountName: nullableText(raw.accountName) } : {})
  }
}

export function parseCampaignResultGroupList(value: unknown): CampaignResultGroupList {
  const items = Array.isArray(record(value).items) ? record(value).items as unknown[] : []
  return { items: items.map(parseCampaignResultGroupItem).filter((item): item is CampaignResultGroupItem => item !== null) }
}

export type CampaignResultGroupTone = 'running' | 'paused' | 'neutral' | 'draft'

/** Chữ trạng thái của một dòng: "Đang đồng bộ", "Đã tắt", "Đã tự dừng"… kèm câu giải thích. */
export function campaignResultGroupStateView(item: Pick<CampaignResultGroupItem, 'state' | 'reason' | 'groupDeleted' | 'campaignDeleted'>): { label: string; tone: CampaignResultGroupTone; detail: string | null; canResume: boolean; canPause: boolean; canRemove: boolean } {
  if (item.state === 'active') return { label: 'Đang đồng bộ', tone: 'running', detail: null, canResume: false, canPause: true, canRemove: true }
  if (item.state === 'draft') return { label: 'Chưa bật', tone: 'draft', detail: 'Lần lưu trước chưa bật được đồng bộ; bấm Lưu để thử lại.', canResume: false, canPause: false, canRemove: true }
  if (item.state === 'stopped') {
    if (item.reason === 'campaign_deleted' || item.campaignDeleted) return { label: 'Đã dừng', tone: 'neutral', detail: 'Chiến dịch đã bị xóa', canResume: false, canPause: false, canRemove: false }
    return { label: 'Đã dừng hẳn', tone: 'neutral', detail: null, canResume: false, canPause: false, canRemove: false }
  }
  if (item.reason === 'group_deleted' || item.groupDeleted) return { label: 'Đã tự tắt', tone: 'neutral', detail: 'Nhóm đích đã bị xóa', canResume: false, canPause: false, canRemove: true }
  if (item.reason === 'idle') return { label: 'Đã tự dừng', tone: 'neutral', detail: `Chiến dịch xong, ${CAMPAIGN_RESULT_GROUPS_IDLE_DAYS} ngày không có kết quả mới`, canResume: true, canPause: false, canRemove: true }
  return { label: 'Đã tắt', tone: 'paused', detail: null, canResume: true, canPause: false, canRemove: true }
}
