import type { FacebookAiRequest, FacebookAiPatch } from './campaignFacebookAi'
import type { ScheduleAiRequest, ScheduleAiPatch } from './campaignScheduleAi'
import type { LimitsAiRequest, LimitsAiPatch } from './campaignLimitsAi'
import type { ContentAiRequest, ContentAiPatch, ContentAiContext } from './campaignContentAi'
import type { ExclusionAiRequest, ExclusionAiPatch } from './campaignExclusionAi'
import type { DataGroup, CampaignInputData } from './types'
import { supportsRecentDeliveryCooldown, MAX_RECENT_DELIVERY_COOLDOWN_DAYS } from './campaignDeliveryCooldown'
import { validAgentDataFiles, validAgentDataImport, type AgentDataFile, type AgentDataImport } from './campaignAgentData'

export const AGENT_IPC = { generate: 'campaign-agent:generate', cancel: 'campaign-agent:cancel',
  images: 'campaign-agent:images', image: 'campaign-agent:image', removeImage: 'campaign-agent:remove-image' } as const
export const AGENT_MAX_TURN_TEXT = 16_000
export const AGENT_MAX_EXTRACTED_TEXT = 16_000
export const AGENT_MAX_HISTORY_TURNS = 20
// A history entry contains the whole message, a separator and the whole OCR result.
export const AGENT_MAX_HISTORY_TEXT = AGENT_MAX_TURN_TEXT + 1 + AGENT_MAX_EXTRACTED_TEXT
export const AGENT_PENDING_GROUP_REPLACE_MESSAGE = 'Danh sách còn nhóm data đang chờ thêm. Hãy kiểm tra và bỏ các nhóm đó ở “Thêm trực tiếp” trước khi thay danh sách hoặc chuyển về nguồn trực tiếp bằng Agent. Chưa áp dụng thay đổi.'
export const AGENT_AUTOMATIC_DATA_MESSAGE = 'Nguồn tự động và danh sách trực tiếp không thể dùng cùng lúc. Hãy chọn nguồn bạn muốn dùng; chưa áp dụng thay đổi.'
export const AGENT_CONTENT_MODE_MESSAGE = 'Hãy bật nhắn tin và chọn nội dung soạn trực tiếp trước khi điền nội dung, hoặc yêu cầu đổi các tùy chọn đó trong cùng lượt. Chưa áp dụng thay đổi.'
export const AGENT_CONTENT_SIZE_MESSAGE = 'Nội dung hiện tại vượt giới hạn xử lý của AI. Hãy chỉnh nội dung trực tiếp trên form; bạn vẫn có thể nhờ Agent đổi tên, lịch và các phần khác. Chưa áp dụng thay đổi.'
// Match the existing manual switch to a running Data Group, including dormant options.
export const AGENT_DATA_GROUP_FIELDS = { splitDataAcrossAccounts: false, refreshData: false,
  findDataRerunEnabled: false, multiDailyTimeSlotsEnabled: false, useSuggestedFriends: false, zaloFriendTargetMode: 'selected' } as const
export const AGENT_SECTIONS = ['general', 'options', 'data', 'content', 'schedule', 'limits', 'cooldown',
  'search', 'keywords', 'postSearch', 'newsfeed', 'groupComment', 'extras', 'exclusions'] as const
export type AgentSection = typeof AGENT_SECTIONS[number]
export const AGENT_SECTION_LABELS: Record<AgentSection, string> = {
  general: 'Cài đặt chung', options: 'Tuỳ chọn hành động', data: 'Nguồn và danh sách data', content: 'Nội dung',
  schedule: 'Lịch chạy', limits: 'Giới hạn hành động', cooldown: 'Kiểm tra trùng lặp', search: 'Cấu hình tìm kiếm',
  keywords: 'Danh sách từ khóa', postSearch: 'Điều kiện bài post', newsfeed: 'Lướt newsfeed', groupComment: 'Kiêm comment',
  extras: 'Cài đặt thêm', exclusions: 'Loại trừ gửi cho khách hàng'
}
export type AgentScalar = string | number | boolean
// Internal lookup/auxiliary quotas have no editable control in the campaign form.
export const isAgentEditableLimitAction = (code: string): boolean =>
  !['zalo_find_phone_user', 'zalo_tag_contact', 'zalo_change_alias'].includes(code)
type ExtraField = { label: string; section: 'options' | 'cooldown' | 'extras'; type: 'boolean' | 'number' | 'string';
  actions: readonly string[]; min?: number; max?: number; choices?: readonly string[] }
const messageActions = ['facebook_message_uid', 'zalo_message_phone', 'zalo_message_group_member',
  'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation']
const zaloPersonal = ['zalo_message_phone', 'zalo_message_friend', 'zalo_message_birthday', 'zalo_message_group_member',
  'zalo_message_group_realtime', 'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation']
const zaloAuxiliary = zaloPersonal.filter(id => id !== 'zalo_message_birthday')
const restActions = ['facebook_group_post', 'facebook_comment_seeding', 'facebook_message_uid']
const posts = ['facebook_timeline_post', 'facebook_group_post', 'facebook_page_post']
const field = (label: string, section: ExtraField['section'], type: ExtraField['type'], actions: readonly string[],
  more: Partial<ExtraField> = {}): ExtraField => ({ label, section, type, actions, ...more })
/** Explicit form capabilities. DB schemas and model output cannot invent controls. */
export const AGENT_EXTRA_FIELDS: Record<string, ExtraField> = {
  enableMessage: field('Nhắn tin', 'options', 'boolean', [...messageActions, 'zalo_message_group_realtime']),
  enableAddFriend: field('Kết bạn', 'options', 'boolean', messageActions),
  friendRequestMessage: field('Lời mời kết bạn', 'options', 'string', messageActions, { max: 2000 }),
  useSuggestedFriends: field('Bạn bè gợi ý', 'options', 'boolean', ['facebook_message_uid']),
  suggestedFriendsCount: field('Số bạn gợi ý', 'options', 'number', ['facebook_message_uid'], { min: 1, max: 10000 }),
  zaloFriendRecommendationCount: field('Số bạn gợi ý Zalo', 'options', 'number', ['zalo_message_friend_recommendation'], { min: 1, max: 10000 }),
  zaloCancelFriendRequestLimit: field('Số lời mời cần thu hồi', 'options', 'number', ['zalo_cancel_sent_friend_request'], { min: 1, max: 10000 }),
  enableZaloTag: field('Kiêm gắn tag Zalo', 'options', 'boolean', zaloAuxiliary),
  zaloTagSkipIfFriend: field('Bỏ qua gắn tag cho bạn bè', 'options', 'boolean', zaloAuxiliary),
  enableZaloAlias: field('Kiêm đổi tên gợi nhớ', 'options', 'boolean', zaloAuxiliary),
  zaloAliasSkipIfFriend: field('Bỏ qua đổi tên bạn bè', 'options', 'boolean', zaloAuxiliary),
  zaloAliasTemplate: field('Mẫu tên gợi nhớ', 'options', 'string', zaloAuxiliary, { max: 1000 }),
  zaloMessageSendMode: field('Cách gửi tin Zalo', 'options', 'string', ['zalo_message_friend', 'zalo_message_group'], { choices: ['normal', 'share'] }),
  zaloOptOutLinkEnabled: field('Link từ chối nhận tin', 'options', 'boolean', zaloPersonal),
  zaloAddGroupMemberUseShareMethod: field('Mời nhóm bằng chia sẻ', 'options', 'boolean', ['zalo_add_group_member']),
  recentDeliveryCooldownAllAccounts: field('Kiểm tra trùng trên mọi tài khoản', 'cooldown', 'boolean', ['zalo_message_phone']),
  recentDeliveryCooldownEnabled: field('Kiểm tra gửi trùng', 'cooldown', 'boolean', []),
  recentDeliveryCooldownDays: field('Không gửi trùng trong số ngày', 'cooldown', 'number', [], { min: 1, max: MAX_RECENT_DELIVERY_COOLDOWN_DAYS }),
  sharePost: field('Chia sẻ bài nguồn', 'extras', 'boolean', ['facebook_timeline_post']),
  postWithBackground: field('Nền bài viết', 'extras', 'boolean', posts),
  postAsReels: field('Đăng Reels', 'extras', 'boolean', ['facebook_timeline_post']),
  pagePostMode: field('Phương thức đăng Page', 'extras', 'string', ['facebook_page_post'], { choices: ['api', 'ui'] }),
  copyContentFromSource: field('Copy nội dung nguồn', 'extras', 'boolean', posts),
  includeSourceImages: field('Lấy ảnh từ nguồn', 'extras', 'boolean', posts),
  rewriteSourceContentWithAI: field('Viết lại nội dung nguồn', 'extras', 'boolean', posts),
  sourceContentAiPrompt: field('Yêu cầu viết lại nguồn', 'extras', 'string', posts, { max: 8000 }),
  sourceLinks: field('Link bài nguồn', 'extras', 'string', posts, { max: 16000 }),
  groupPostShareFromPost: field('Chia sẻ bài vào nhóm', 'extras', 'boolean', ['facebook_group_post']),
  groupPostShareCaption: field('Nội dung chia sẻ', 'extras', 'string', ['facebook_group_post'], { max: 16000 }),
  enablePostLike: field('Like bài khi comment', 'extras', 'boolean', ['facebook_comment_seeding', 'facebook_comment_seeding_post']),
  enablePostBump: field('Kiêm up tin', 'extras', 'boolean', ['facebook_group_post']),
  postBumpContent: field('Nội dung up tin', 'extras', 'string', ['facebook_group_post'], { max: 16000 }),
  'facebookRestBrowse.enabled': field('Kiêm nghỉ/lướt Facebook', 'extras', 'boolean', restActions),
  'facebookRestBrowse.browseSeconds': field('Thời gian lướt (giây)', 'extras', 'number', restActions, { min: 1, max: 2147483 }),
  'facebookRestBrowse.restSeconds': field('Thời gian nghỉ (giây)', 'extras', 'number', restActions, { min: 0, max: 2147483 }),
  'facebookRestBrowse.browseTarget': field('Lướt trang của đối tượng', 'extras', 'boolean', restActions),
  'facebookRestBrowse.browseHome': field('Lướt trang chủ', 'extras', 'boolean', restActions),
  smsUseUnicode: field('SMS có dấu', 'extras', 'boolean', ['sms_send']),
  smsKeepNewLines: field('Giữ xuống dòng SMS', 'extras', 'boolean', ['sms_send']),
  leaveGroupOnPendingApproval: field('Rời nhóm khi bài chờ duyệt', 'extras', 'boolean', ['facebook_group_post']),
  autoJoinGroupAfterPost: field('Tham gia nhóm sau khi đăng', 'extras', 'boolean', ['facebook_group_post']),
  shuffleGroupList: field('Xáo trộn danh sách nhóm', 'extras', 'boolean', ['facebook_group_post']),
  skipPostIfGroupRequiresApproval: field('Bỏ qua nhóm yêu cầu duyệt', 'extras', 'boolean', ['facebook_group_post']),
  enableGroupPostShareToJoinedGroups: field('Chia sẻ tới nhóm đã tham gia', 'extras', 'boolean', ['facebook_group_post']),
  postBumpCount: field('Số lần up tin', 'extras', 'number', ['facebook_group_post'], { min: 1, max: 10 }),
  postBumpInitialDelayMinutes: field('Đợi trước lần up tin đầu', 'extras', 'number', ['facebook_group_post'], { min: 0, max: 10080 }),
  postBumpIntervalMinutes: field('Khoảng cách up tin', 'extras', 'number', ['facebook_group_post'], { min: 1, max: 10080 }),
  zaloFriendTargetMode: field('Nguồn bạn bè Zalo', 'options', 'string', ['zalo_message_friend'], { choices: ['selected', 'all_friends', 'tagged_friends'] }),
  zaloTagSkipIfHasSelectedTags: field('Bỏ qua khi đã có tag đã chọn', 'options', 'boolean', zaloAuxiliary),
  emailCheckLinkClicks: field('Theo dõi click email', 'extras', 'boolean', ['email_send']),
  rewriteContentEachRun: field('Viết lại nội dung mỗi lượt', 'extras', 'boolean', [...posts, ...zaloPersonal, 'zalo_message_group', 'email_send']),
}
export function agentExtraFields(actionId: string): Record<string, ExtraField> {
  return Object.fromEntries(Object.entries(AGENT_EXTRA_FIELDS).filter(([, spec]) => spec.section === 'cooldown'
    ? supportsRecentDeliveryCooldown(actionId, { enableMessage: true }) && (!spec.actions.length || spec.actions.includes(actionId)) : spec.actions.includes(actionId)))
}
export const AGENT_CAMPAIGN_LINKS: Record<string, { label: string; actions: string[]; target: string; gate?: string }> = {
  postBumpTargetCampaignIds: { label: 'Chiến dịch up tin', actions: ['facebook_group_post'], target: 'facebook_comment_seeding_post' },
  findUidTargetCampaignIds: { label: 'Chuyển UID tới chiến dịch nhắn tin', actions: ['facebook_find_data_group', 'facebook_find_data_search'], target: 'facebook_message_uid', gate: 'isFindUid' },
  findPostLinkTargetCampaignIds: { label: 'Chuyển link bài tới chiến dịch comment', actions: ['facebook_find_data_group', 'facebook_find_data_search'], target: 'facebook_comment_seeding_post', gate: 'isFindPostLink' },
  findPhoneSmsTargetCampaignIds: { label: 'Chuyển số điện thoại tới SMS', actions: ['facebook_find_data_group', 'facebook_find_data_search'], target: 'sms_send', gate: 'isFindPhone' },
  findPhoneZaloMessagePhoneTargetCampaignIds: { label: 'Chuyển số điện thoại tới nhắn Zalo', actions: ['facebook_find_data_group', 'facebook_find_data_search'], target: 'zalo_message_phone', gate: 'isFindPhone' },
  findZaloGroupLinkJoinTargetCampaignIds: { label: 'Chuyển link nhóm tới tham gia Zalo', actions: ['facebook_find_data_group', 'facebook_find_data_search'], target: 'zalo_join_group_link', gate: 'isFindLinkGroupZalo' },
  findFacebookGroupPostTargetCampaignIds: { label: 'Chuyển nhóm Facebook tới đăng bài', actions: ['facebook_find_data_search'], target: 'facebook_group_post', gate: 'isFindFacebookGroup' },
  findFacebookGroupCommentTargetCampaignIds: { label: 'Chuyển nhóm Facebook tới comment', actions: ['facebook_find_data_search'], target: 'facebook_comment_seeding', gate: 'isFindFacebookGroup' },
  findFacebookGroupJoinTargetCampaignIds: { label: 'Chuyển nhóm Facebook tới tham gia nhóm', actions: ['facebook_find_data_search'], target: 'facebook_join_group', gate: 'isFindFacebookGroup' }
}
export interface AgentImage { id: string; name: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; bytes: number }
export interface AgentSnapshot {
  actionId: string; availableActionIds: string[]; form: Record<string, AgentScalar>; accountIds: number[];
  sourceTagSelection?: { accountId: number; tagIds: string[] };
  // pendingGroupCount includes retained direct-source groups hidden while mode is data_group.
  campaignLinks?: Record<string, number[]>; data?: { mode: 'direct' | 'data_group'; groupName: string; count: number; pendingGroupCount: number; rows: Array<{ name: string; uid: string; phone: string; email: string }> };
  // Stable editing capability; effective availability is recomputed after Options.
  sections: AgentSection[]; lockedFields: string[]; directDataEditable: boolean;
  facebook: Partial<Record<FacebookAiRequest['kind'], Omit<FacebookAiRequest, 'requestId' | 'description'>>>;
  schedule?: Omit<ScheduleAiRequest, 'requestId' | 'description'>;
  limits?: Omit<LimitsAiRequest, 'requestId' | 'description'>;
  content?: Omit<ContentAiRequest, 'requestId' | 'description'>;
  // Oversized content stays in the form/draft; only its mode is sent for dependent controls.
  contentUnavailable?: { reason: 'size'; context: ContentAiContext };
  exclusions?: Omit<ExclusionAiRequest, 'requestId' | 'description'>;
}
export function agentUsesAutomaticData(actionId: string, form: Record<string, unknown>): boolean {
  return actionId === 'facebook_message_uid' && form.useSuggestedFriends === true
    || actionId === 'zalo_message_friend' && form.zaloFriendTargetMode !== 'selected'
}
export function agentDirectDataAllowed(snapshot: { actionId: string; form: Record<string, unknown>; directDataEditable: boolean }): boolean {
  return snapshot.directDataEditable && !agentUsesAutomaticData(snapshot.actionId, snapshot.form)
}
export function agentContentEnabled(actionId: string, form: Record<string, unknown>): boolean {
  // Renderer retains other actions' values for undo; only current capabilities can block content.
  const fields = agentExtraFields(actionId)
  return !(fields.enableMessage && form.enableMessage === false)
    && !(fields.copyContentFromSource && form.copyContentFromSource === true)
    && !(fields.sharePost && form.sharePost === true)
    && !(fields.groupPostShareFromPost && form.groupPostShareFromPost === true)
    && !(fields.zaloMessageSendMode && form.zaloMessageSendMode === 'share')
}
export interface AgentRequest {
  requestId: string; sessionId: string; revision: number; draftId: string; description: string;
  section: AgentSection | null; snapshot: AgentSnapshot; images: AgentImage[];
  dataFiles?: AgentDataFile[];
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
}
export interface AgentExtraPatch { fields: Record<string, AgentScalar>; rows: Partial<CampaignInputData>[];
  importMode?: 'append' | 'replace';
  dataMode: 'append' | 'replace' | null; campaignLinks?: Record<string, number[]>; dataGroup?: DataGroup; directSource?: boolean;
  sourceTags?: Array<{ accountId: number; tagId: string; name: string }>;
  tags: Array<{ accountId: number; tagId: string; name: string }> }
export type AgentPatchEntry = { section: 'schedule'; patch: ScheduleAiPatch } | { section: 'limits'; patch: LimitsAiPatch }
  | { section: 'content'; patch: ContentAiPatch } | { section: 'exclusions'; accountId: number; patch: ExclusionAiPatch }
  | { section: FacebookAiRequest['kind']; patch: FacebookAiPatch }
  | { section: 'options' | 'data' | 'cooldown' | 'extras'; patch: AgentExtraPatch }
export interface AgentReply { actionId: string | null; message: string; extractedText: string; entries: AgentPatchEntry[] }
export type AgentResult = { ok: true; patch: AgentReply } | { ok: false; code: 'invalid' | 'unavailable' | 'cancelled' | 'unclear' | 'unsupported'; message: string; extractedText?: string }
export interface AgentLimitWindows { before: Record<string, number[]>; after: Record<string, number[]> }
export interface AgentChange { key: string; label: string; section: string; before: unknown; after: unknown; revision?: number; hidden?: boolean; beforeText?: string; afterText?: string; limitWindows?: AgentLimitWindows }
export interface AgentTurn { id: string; role: 'user' | 'assistant'; text: string; images?: AgentImage[];
  dataFiles?: AgentDataFile[]; dataImport?: AgentDataImport; contentRequest?: boolean;
  changes?: AgentChange[]; undone?: boolean; extractedText?: string }
export interface AgentDraft { version: 1; turns: AgentTurn[]; fieldRevisions?: Record<string, number>;
  composer?: { text: string; images: AgentImage[]; dataFiles?: AgentDataFile[] } }
export function isAgentDraft(value: unknown): value is AgentDraft {
  if (!isAgentRecord(value) || value.version !== 1 || !Array.isArray(value.turns) || value.turns.length > 1000) return false
  const image = (i: unknown) => isAgentRecord(i) && agentUuid(i.id) && typeof i.name === 'string'
    && ['image/png', 'image/jpeg', 'image/webp'].includes(String(i.mimeType)) && Number.isSafeInteger(i.bytes) && Number(i.bytes) > 0
  const images = (v: unknown) => Array.isArray(v) && v.length <= 5 && v.every(image)
  const windows = (v: unknown) => isAgentRecord(v) && Object.keys(v).length <= 100 && Object.values(v).every(minutes =>
    Array.isArray(minutes) && minutes.length <= 1000 && minutes.every(n => Number.isSafeInteger(n) && Number(n) >= 0))
  if (value.fieldRevisions !== undefined && (!isAgentRecord(value.fieldRevisions)
    || Object.values(value.fieldRevisions).some(n => !Number.isSafeInteger(n) || Number(n) < 0))) return false
  if (value.composer !== undefined && (!isAgentRecord(value.composer) || typeof value.composer.text !== 'string' || value.composer.text.length > 4000 || !images(value.composer.images)
    || value.composer.dataFiles !== undefined && !validAgentDataFiles(value.composer.dataFiles))) return false
  return value.turns.every(t => isAgentRecord(t) && agentUuid(t.id) && ['user', 'assistant'].includes(String(t.role))
    && typeof t.text === 'string' && t.text.length <= AGENT_MAX_TURN_TEXT && (t.undone === undefined || typeof t.undone === 'boolean')
    && (t.contentRequest === undefined || typeof t.contentRequest === 'boolean')
    && (t.dataFiles === undefined || validAgentDataFiles(t.dataFiles)) && (t.dataImport === undefined || validAgentDataImport(t.dataImport))
    && (t.extractedText === undefined || typeof t.extractedText === 'string' && t.extractedText.length <= AGENT_MAX_EXTRACTED_TEXT)
    && (t.images === undefined || images(t.images)) && (t.changes === undefined || Array.isArray(t.changes)
      && t.changes.length <= 500 && t.changes.every(c => isAgentRecord(c) && typeof c.key === 'string' && typeof c.label === 'string'
        && typeof c.section === 'string' && (c.hidden === undefined || typeof c.hidden === 'boolean')
        && (c.beforeText === undefined || typeof c.beforeText === 'string') && (c.afterText === undefined || typeof c.afterText === 'string')
        && (c.limitWindows === undefined || isAgentRecord(c.limitWindows) && windows(c.limitWindows.before) && windows(c.limitWindows.after))
        && (c.revision === undefined || Number.isSafeInteger(c.revision)))))
}
export const isAgentRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
export const agentUuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
export const agentEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const object = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
const str = { type: 'string' }
export const AGENT_ROUTER_SCHEMA = object({ status: { type: 'string', enum: ['ok', 'unclear', 'unsupported'] },
  message: str, extractedText: str, actionId: { type: ['string', 'null'] },
  tasks: { type: 'array', maxItems: 14, items: object({ section: { type: 'string', enum: [...AGENT_SECTIONS] }, description: str }) } })
export const AGENT_EXTRA_SCHEMA = object({ status: { type: 'string', enum: ['ok', 'unclear', 'unsupported'] }, reason: str,
  fields: { type: 'array', items: object({ key: str, value: { type: ['string', 'number', 'boolean'] } }) },
  dataMode: { type: ['string', 'null'], enum: ['append', 'replace', null] },
  rows: { type: 'array', items: object({ name: str, uid: str, phone: str, email: str }) },
  sourceTagIds: { type: ['array', 'null'], items: str },
  sourceTagMode: { type: ['string', 'null'], enum: ['append', 'remove', 'replace', null] },
  campaignLinks: { type: 'array', items: object({ key: str, ids: { type: 'array', items: { type: 'integer' } } }) },
  dataGroupId: { type: ['integer', 'null'] }, directSource: { type: 'boolean' },
  tags: { type: 'array', items: object({ accountId: { type: 'integer' }, tagId: str }) } })

export function canUndoAgentTurn(turn: AgentTurn, read: (key: string) => unknown, revision?: (key: string) => number): boolean {
  return !turn.undone && !!turn.changes?.length && turn.changes.every(change => agentEqual(read(change.key), change.after) && (!revision || change.revision === revision(change.key)))
}
