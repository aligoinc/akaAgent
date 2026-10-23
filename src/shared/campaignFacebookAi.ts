import { CAMPAIGN_FORM_AI_MAX_PROMPT, type CampaignFormAiResult } from './campaignFormAi'
import { supportsFacebookPageIdentity } from './facebookPageIdentity'

export const FACEBOOK_AI_IPC = { generate: 'campaign-facebook-ai:generate', cancel: 'campaign-facebook-ai:cancel' } as const
export const FACEBOOK_AI_SECTIONS = {
  // Keep the deployed general-section binding/IPC for older Desktop clients.
  // General is shared across platforms; the other five sections remain Facebook-only.
  general: 'campaign.facebook.general', search: 'campaign.facebook.search', keywords: 'campaign.facebook.keywords',
  postSearch: 'campaign.facebook.post_search', newsfeed: 'campaign.facebook.newsfeed', groupComment: 'campaign.facebook.group_comment'
} as const
export type FacebookAiKind = keyof typeof FACEBOOK_AI_SECTIONS
export const FACEBOOK_AI_MESSAGES = {
  invalid: 'Chưa thể điền cấu hình này. Vui lòng thử mô tả lại yêu cầu.',
  unavailable: 'AI tạm thời chưa phản hồi. Vui lòng thử lại sau.',
  unclear: 'Vui lòng bổ sung thông tin còn thiếu.', unsupported: 'Yêu cầu nằm ngoài phạm vi AI của phần này.',
  secondaryAccountConflict: 'Tài khoản này đang là tài khoản phụ. Vui lòng đổi hoặc bỏ tài khoản phụ trước khi chọn làm tài khoản chính.',
  pageSecondaryAccountConflict: 'Chạy bằng Page không dùng tài khoản phụ. Vui lòng bỏ tài khoản phụ trên form trước khi chọn Page.'
} as const
export const FACEBOOK_AI_ACTIONS = ['facebook_comment_seeding', 'facebook_comment_seeding_post', 'facebook_find_data_group',
  'facebook_find_data_search', 'facebook_group_invite', 'facebook_group_post', 'facebook_join_group', 'facebook_message_friend',
  'facebook_message_uid', 'facebook_newsfeed_interaction', 'facebook_page_post', 'facebook_page_to_message', 'facebook_timeline_post']
export const facebookAiActions = (kind: FacebookAiKind): string[] => kind === 'general' ? FACEBOOK_AI_ACTIONS
  : kind === 'search' ? ['facebook_find_data_group', 'facebook_find_data_search']
  : kind === 'keywords' ? ['facebook_find_data_search'] : kind === 'postSearch' ? ['facebook_comment_seeding']
  : kind === 'newsfeed' ? ['facebook_newsfeed_interaction'] : ['facebook_group_post']
export function campaignSectionAiSupportsAction(kind: FacebookAiKind, actionId: string): boolean {
  return !!actionId.trim() && (kind === 'general' || facebookAiActions(kind).includes(actionId))
}

type Field = { type: 'boolean' | 'integer' | 'string' | 'ids' | 'strings'; label: string; min?: number; max?: number; choices?: string[] }
const b = (label: string): Field => ({ type: 'boolean', label })
const n = (label: string, min = 1): Field => ({ type: 'integer', label, min, max: 1_000_000 })
const s = (label: string, choices?: string[]): Field => ({ type: 'string', label, choices })
const postFields = {
  isFindPostByKeywords: b('Lọc nội dung bài viết theo từ khóa'), postKeywords: s('Từ khóa bài viết, ngăn bằng dấu phẩy'),
  isFindPostByContentAI: b('Lọc nội dung bài viết bằng AI'), postContentAI: s('Mô tả nội dung bài viết cần tìm')
}
const sortPost = ['most_relevant', 'recent_activity', 'new_posts']
export const FACEBOOK_AI_FIELDS: Record<FacebookAiKind, Record<string, Field>> = {
  general: { name: s('Tên chiến dịch'), accountIds: { type: 'ids', label: 'Tài khoản chính; ID trong danh mục' },
    runAsPage: b('Chạy bằng Page'), runAsPageUid: s('UID Page trong danh mục, phải thuộc tài khoản chính') },
  search: {
    isFindPhone: b('Tìm số điện thoại'), isFindLinkGroupZalo: b('Tìm link group Zalo'), isFindUid: b('Tìm UID Facebook'),
    isFindPostLink: b('Tìm link bài post'), isFindFacebookGroup: b('Tìm group Facebook (chỉ loại search)'),
    isFindInPost: b('Tìm trong bài post'), isFindInComment: b('Tìm trong comment'),
    isFindNewInteractors: b('Tìm UID người tương tác mới (chỉ tìm trong group)'), isFindInGroupMembers: b('Tìm UID thành viên group (chỉ tìm trong group)'),
    findDataGoalModeEnabled: b('Bật mục tiêu thu thập trong ngày'), findDataGoalPriority: s('Loại data ưu tiên', ['phone', 'zalo_group_link', 'facebook_uid', 'post_link', 'facebook_group']),
    findDataGoalDailyLimit: n('Số data mục tiêu/ngày'), sortTypePost: s('Sắp xếp bài viết: liên quan/hoạt động mới/bài mới', sortPost),
    countSearchPostFindData: n('Số bài quét trên mỗi từ khóa (search)'), countPostFindData: n('Số bài quét mỗi group'),
    searchPostRecentOnly: b('Bài viết gần đây (search)'), searchPostSeenOnly: b('Bài đã xem (search)'),
    searchPostDateFilter: s('Ngày đăng (search)', ['all', 'today', 'this_week', 'this_month']),
    searchPostAuthorFilter: s('Người đăng (search)', ['all', 'you', 'friends', 'groups_pages']),
    searchPostTaggedLocation: s('Vị trí gắn thẻ (search)', ['all', 'near_me']), ...postFields,
    sortTypeComment: s('Sắp xếp bình luận: liên quan/tất cả/mới nhất', ['most_relevant', 'all_comments', 'newest']),
    countCommentFindData: n('Số comment quét mỗi bài'), isFindCommentByKeywords: b('Lọc comment theo từ khóa'),
    commentKeywords: s('Từ khóa comment, ngăn bằng dấu phẩy'), isFindCommentByContentAI: b('Lọc comment bằng AI'),
    commentContentAI: s('Mô tả comment cần tìm'), countGroupMemberFindData: n('Số thành viên group cần quét'),
    countSearchGroupFindData: n('Số group tìm mỗi từ khóa'), minSearchGroupMembers: n('Số thành viên group tối thiểu', 0),
    minSearchGroupPostsPerDay: n('Số bài/ngày tối thiểu của group', 0), searchGroupCity: s('Thành phố tìm group'),
    searchGroupNearMe: b('Group gần tôi'), searchGroupPublicOnly: b('Chỉ group công khai'), searchGroupMineOnly: b('Chỉ group của tôi')
  },
  keywords: { keywords: { type: 'strings', label: 'Danh sách từ khóa tìm kiếm, mỗi phần tử là một từ khóa' } },
  postSearch: { commentPostSort: s('Sắp xếp bài viết: liên quan/hoạt động mới/bài mới', sortPost),
    commentOnlyLatestPost: b('Chỉ comment bài mới nhất, không comment trùng'), ...postFields },
  newsfeed: { newsfeedTimeMinutes: n('Thời gian lướt, phút'), enablePostLike: b('Like/tim'), newsfeedLikeKind: s('Tính chất bài viết để like/tim'),
    newsfeedLikeLimit: n('Số like/tim tối đa'), enableComment: b('Comment'), newsfeedCommentKind: s('Tính chất bài viết để comment'),
    newsfeedCommentLimit: n('Số comment tối đa'), newsfeedCommentContent: s('Nội dung comment, dấu | phân cách biến thể, hoặc lời nhắc AI'),
    newsfeedCommentUseAI: b('Nội dung comment là lời nhắc AI tạo khi chạy') },
  groupComment: { enableComment: b('Kiêm comment'), commentGroupMode: s('Comment group: mọi group/bị duyệt/đăng thành công', ['all', 'pending_only', 'published_only']),
    commentType: s('Comment bài: của mình/của người khác/tất cả', ['own', 'others', 'all']), commentCount: n('Số comment tối đa'),
    commentContent: s('Nội dung comment, dấu | phân cách biến thể') }
}
export type FacebookAiValue = string | number | boolean | number[] | string[]
export type FacebookAiPatch = Record<string, FacebookAiValue>
export interface FacebookAiRequest {
  requestId: string; description: string; kind: FacebookAiKind; actionId: string
  current: FacebookAiPatch; lockedFields: string[]; eligibleAccountIds: number[]
  // Form restrictions only narrow the action's server-side account capability.
  singleAccountOnly: boolean
  secondaryAccountId: number | null
}
export interface FacebookAiCatalog {
  platform: string
  allowPageIdentity: boolean
  accounts: { id: number; name: string; accountType?: string }[]
  pages: { accountId: number; uid: string; name: string }[]
  allowMultipleAccounts: boolean
  hasSecondaryAccount: boolean
  secondaryAccount: { id: number; name: string; accountType?: string } | null
}
export type FacebookAiResult = CampaignFormAiResult<FacebookAiPatch>
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const ids = (x: unknown): x is number[] => Array.isArray(x) && x.length <= 500 && new Set(x).size === x.length && x.every(i => Number.isSafeInteger(i) && i > 0)
const string = (x: unknown, max = 16_000): x is string => typeof x === 'string' && x.length <= max
function valueValid(field: Field, value: unknown, snapshot = false): value is FacebookAiValue {
  if (field.type === 'boolean') return typeof value === 'boolean'
  if (field.type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value) && value >= (snapshot ? 0 : field.min!) && value <= field.max!
  if (field.type === 'ids') return ids(value) && (snapshot || value.length > 0)
  if (field.type === 'strings') return Array.isArray(value) && value.length <= 500 && value.every(v => string(v, 300) && !!v.trim() && !/[\r\n,]/.test(v)) && (snapshot || new Set(value).size === value.length)
  return string(value) && (!field.choices || snapshot && value === '' || field.choices.includes(value))
}
export function facebookAiSnapshot(kind: FacebookAiKind, form: Record<string, unknown>): FacebookAiPatch {
  // Preserve invalid legacy input too: Main rejects it instead of losing context and replacing it.
  return Object.fromEntries(Object.keys(FACEBOOK_AI_FIELDS[kind]).flatMap(key => form[key] !== undefined ? [[key, form[key]]] : [])) as FacebookAiPatch
}
export function validateFacebookAiRequest(input: unknown): FacebookAiRequest {
  if (!record(input) || !string(input.requestId, 36) || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(input.requestId)
    || !string(input.description, CAMPAIGN_FORM_AI_MAX_PROMPT) || !input.description.trim()
    || !string(input.kind) || !Object.hasOwn(FACEBOOK_AI_FIELDS, input.kind) || !string(input.actionId, 100)
    || !campaignSectionAiSupportsAction(input.kind as FacebookAiKind, input.actionId) || !record(input.current)
    || JSON.stringify(input.current).length > 100_000 || !Array.isArray(input.lockedFields) || !ids(input.eligibleAccountIds)
    || typeof input.singleAccountOnly !== 'boolean'
    || input.secondaryAccountId !== null && !(typeof input.secondaryAccountId === 'number' && Number.isSafeInteger(input.secondaryAccountId) && input.secondaryAccountId > 0)) throw new Error(FACEBOOK_AI_MESSAGES.invalid)
  const fields = FACEBOOK_AI_FIELDS[input.kind as FacebookAiKind]
  if (Object.entries(input.current).some(([key, value]) => !Object.hasOwn(fields, key) || !valueValid(fields[key], value, true))
    || input.lockedFields.some(key => typeof key !== 'string' || !Object.hasOwn(fields, key)) || input.lockedFields.length > Object.keys(fields).length) throw new Error(FACEBOOK_AI_MESSAGES.invalid)
  return { requestId: input.requestId, description: input.description.trim(), kind: input.kind as FacebookAiKind, actionId: input.actionId,
    current: input.current as FacebookAiPatch, lockedFields: input.lockedFields, eligibleAccountIds: input.eligibleAccountIds,
    singleAccountOnly: input.singleAccountOnly, secondaryAccountId: input.secondaryAccountId as number | null }
}
export function facebookAiSchema(kind: FacebookAiKind) {
  const properties = Object.fromEntries(Object.entries(FACEBOOK_AI_FIELDS[kind]).map(([key, field]) => [key,
    field.type === 'ids' || field.type === 'strings' ? { type: ['array', 'null'], items: { type: field.type === 'ids' ? 'integer' : 'string' } }
      : { type: [field.type, 'null'], ...(field.choices ? { enum: [...field.choices, null] } : {}) }]))
  return { type: 'object', additionalProperties: false, required: ['status', 'reason', 'changes'], properties: {
    status: { type: 'string', enum: ['ok', 'unclear', 'unsupported'] }, reason: { type: 'string' },
    changes: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties }
  } }
}
const groupOnly = ['isFindNewInteractors', 'isFindInGroupMembers', 'countGroupMemberFindData', 'countPostFindData']
const searchOnly = ['isFindFacebookGroup', 'countSearchPostFindData', 'searchPostRecentOnly', 'searchPostSeenOnly', 'searchPostDateFilter',
  'searchPostAuthorFilter', 'searchPostTaggedLocation', 'countSearchGroupFindData', 'minSearchGroupMembers', 'minSearchGroupPostsPerDay',
  'searchGroupCity', 'searchGroupNearMe', 'searchGroupPublicOnly', 'searchGroupMineOnly']
export function facebookAiHiddenFields(request: Pick<FacebookAiRequest, 'kind' | 'actionId'>): string[] {
  if (request.kind === 'general') return supportsFacebookPageIdentity(request.actionId) ? [] : ['runAsPage', 'runAsPageUid']
  if (request.kind !== 'search') return []
  return request.actionId === 'facebook_find_data_search' ? groupOnly : searchOnly
}
export function parseFacebookAiResponse(content: string, request: FacebookAiRequest, catalog?: FacebookAiCatalog): FacebookAiResult {
  const invalid = (): FacebookAiResult => ({ ok: false, code: 'invalid', message: FACEBOOK_AI_MESSAGES.invalid })
  try {
    if (content.length > 150_000) return invalid()
    const result: unknown = JSON.parse(content), fields = FACEBOOK_AI_FIELDS[request.kind]
    if (!record(result) || Object.keys(result).sort().join() !== 'changes,reason,status' || !string(result.reason, 300)
      || !['ok', 'unclear', 'unsupported'].includes(String(result.status)) || !record(result.changes)
      || Object.keys(result.changes).sort().join() !== Object.keys(fields).sort().join()) return invalid()
    const patch: FacebookAiPatch = {}
    const locked = new Set([...request.lockedFields, ...facebookAiHiddenFields(request)])
    for (const [key, value] of Object.entries(result.changes)) {
      if (value === null) continue
      if (!valueValid(fields[key], value) || locked.has(key)) return invalid()
      patch[key] = value
    }
    if (result.status !== 'ok') {
      if (Object.keys(patch).length) return invalid()
      const code = result.status as 'unclear' | 'unsupported'
      return { ok: false, code, message: result.reason.trim() || FACEBOOK_AI_MESSAGES[code] }
    }
    const next = { ...request.current, ...patch }
    if (request.kind === 'general') {
      if (patch.name !== undefined && (!String(patch.name).trim() || String(patch.name).length > 200)) return invalid()
      if (patch.accountIds || patch.runAsPage !== undefined || patch.runAsPageUid !== undefined) {
        if (!catalog || !ids(next.accountIds) || !next.accountIds.length) return invalid()
        if (next.runAsPage && request.secondaryAccountId !== null) {
          return { ok: false, code: 'unsupported', message: FACEBOOK_AI_MESSAGES.pageSecondaryAccountConflict }
        }
        if (request.secondaryAccountId !== null && next.accountIds.includes(request.secondaryAccountId)) {
          return { ok: false, code: 'unsupported', message: FACEBOOK_AI_MESSAGES.secondaryAccountConflict }
        }
        if (next.accountIds.some(id => !catalog.accounts.some(a => a.id === id))
          || (request.singleAccountOnly || request.secondaryAccountId !== null || !catalog.allowMultipleAccounts || next.runAsPage) && next.accountIds.length !== 1) return invalid()
        if (!next.runAsPage && patch.runAsPageUid) return invalid()
        if (next.runAsPage) {
          const page = catalog.pages.find(p => p.accountId === (next.accountIds as number[])[0] && p.uid === next.runAsPageUid)
          if (!page || catalog.platform !== 'facebook' || !catalog.allowPageIdentity || !supportsFacebookPageIdentity(request.actionId)) return invalid()
          patch.runAsPageName = page.name
        } else if (patch.runAsPage === false || patch.accountIds) { patch.runAsPageUid = ''; patch.runAsPageName = '' }
      }
    }
    if (request.kind === 'keywords' && patch.keywords && !(patch.keywords as string[]).length) return invalid()
    if (request.kind === 'search') {
      const post = next.isFindPhone || next.isFindLinkGroupZalo || next.isFindUid || next.isFindPostLink
      const comments = next.isFindPhone || next.isFindLinkGroupZalo || next.isFindUid
      if (next.isFindInPost && !post || next.isFindInComment && !comments
        || (next.isFindNewInteractors || next.isFindInGroupMembers) && (!next.isFindUid || request.actionId !== 'facebook_find_data_group')
        || next.isFindPostLink && !next.isFindInPost) return invalid()
      const usesPosts = next.isFindInPost || next.isFindInComment || next.isFindPostLink || next.isFindNewInteractors
      const usesComments = next.isFindInComment || next.isFindNewInteractors
      const changed = (names: string[]) => names.some(key => patch[key] !== undefined)
      if (!usesPosts && changed(['sortTypePost', 'countSearchPostFindData', 'countPostFindData', 'searchPostRecentOnly', 'searchPostSeenOnly', 'searchPostDateFilter', 'searchPostAuthorFilter', 'searchPostTaggedLocation'])
        || !(next.isFindInPost || next.isFindInComment || next.isFindPostLink) && changed(Object.keys(postFields))
        || !usesComments && changed(['sortTypeComment', 'countCommentFindData'])
        || !next.isFindInComment && changed(['isFindCommentByKeywords', 'commentKeywords', 'isFindCommentByContentAI', 'commentContentAI'])
        || !next.isFindInGroupMembers && changed(['countGroupMemberFindData'])
        || !next.isFindFacebookGroup && changed(searchOnly.filter(key => key !== 'isFindFacebookGroup' && !key.startsWith('searchPost') && key !== 'countSearchPostFindData'))) return invalid()
      if (next.findDataGoalModeEnabled) {
        const target = { phone: 'isFindPhone', zalo_group_link: 'isFindLinkGroupZalo', facebook_uid: 'isFindUid', post_link: 'isFindPostLink', facebook_group: 'isFindFacebookGroup' }[String(next.findDataGoalPriority)]
        if (!target || !next[target]) return invalid()
      }
      if (next.isFindNewInteractors && (patch.sortTypePost && patch.sortTypePost !== 'recent_activity' || patch.sortTypeComment && patch.sortTypeComment !== 'newest')) return invalid()
    }
    return { ok: true, patch }
  } catch { return invalid() }
}
