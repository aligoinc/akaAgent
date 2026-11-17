/**
 * Chiến dịch Facebook trên engine v2 (phương án docs/CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_PLAN.md, cách C): workflow vẫn chạy từ DB trên Desktop,
 * lõi giữ nhận data, lease, nhật ký, dấu "sắp gửi" theo mốc và chỉ thị của DB. File này là phần không phụ thuộc Electron: loại nào chạy bộ
 * mới (hàm phủ, như zaloCampaignV2Support), thao tác của claim theo đúng luật hạn mức của bộ cũ, nhãn data, tên thao tác.
 *
 * Bật theo tổ chức bằng thiết lập engine.facebook (anh chốt Q1 16/11/2026), claim kiểm lại mỗi lượt. Loại nào chạy bộ mới do bản Desktop
 * quyết định qua hàm phủ dưới đây; loại / cấu hình chưa làm thì chạy bộ cũ kể cả khi tổ chức đã bật.
 */
import type { ClaimContext, TargetRow } from '../contracts.js'
import type { V2Support } from '../zalo/messagePhone.js'

export const FB_GROUP_POST = 'facebook_group_post'
export const FB_TIMELINE_POST = 'facebook_timeline_post'
export const FB_PAGE_POST = 'facebook_page_post'
export const FB_MESSAGE_FRIEND = 'facebook_message_friend'
export const FB_MESSAGE_UID = 'facebook_message_uid'
export const FB_PAGE_INBOX = 'facebook_page_to_message'
export const FB_COMMENT_SEEDING = 'facebook_comment_seeding'
export const FB_COMMENT_SEEDING_POST = 'facebook_comment_seeding_post'
export const FB_NEWSFEED = 'facebook_newsfeed_interaction'
export const FB_JOIN_GROUP = 'facebook_join_group'
export const FB_GROUP_INVITE = 'facebook_group_invite'
export const FB_FIND_DATA_GROUP = 'facebook_find_data_group'
export const FB_FIND_DATA_SEARCH = 'facebook_find_data_search'

/** 13 loại chiến dịch Facebook của bộ cũ (auto_campaign_actions.flatform_type = facebook). */
export const FACEBOOK_CAMPAIGN_ACTION_IDS: readonly string[] = [
  FB_GROUP_POST, FB_TIMELINE_POST, FB_PAGE_POST, FB_MESSAGE_FRIEND, FB_MESSAGE_UID, FB_PAGE_INBOX, FB_COMMENT_SEEDING,
  FB_COMMENT_SEEDING_POST, FB_NEWSFEED, FB_JOIN_GROUP, FB_GROUP_INVITE, FB_FIND_DATA_GROUP, FB_FIND_DATA_SEARCH
]

/** Chiến dịch FB mà lõi cần: chỉ các trường đọc cấu hình. */
export interface FacebookCampaign {
  id: number
  actionId: string
  accountId: number | null | undefined
  extraSettings: Record<string, unknown>
  dataTargetSourceMode?: string | null
}

/**
 * Tìm data (group / search) không gửi gì lên Facebook nên không có thao tác: bộ cũ ghi một dòng "Tìm data" không mã thao tác (không tính
 * lượt, không khoá). Engine ghi đúng như vậy (V558: report_v1 nhận kết quả không gắn thao tác của chiến dịch Facebook; anh chốt Q5).
 */
export const FACEBOOK_FIND_DATA_RESULT_NAME = 'Tìm data'

/** Tên ghi lịch sử cho kết quả không gắn thao tác của loại chiến dịch (chỉ tìm data), không có thì undefined. */
export function facebookResultName(actionId: string): string | undefined {
  return actionId === FB_FIND_DATA_GROUP || actionId === FB_FIND_DATA_SEARCH ? FACEBOOK_FIND_DATA_RESULT_NAME : undefined
}

/** Tên thao tác ghi lịch sử, đúng getAccountActionName của Desktop. */
export const FACEBOOK_ACTION_NAMES: Readonly<Record<string, string>> = {
  fb_post_group: 'Đăng bài group',
  fb_post_my_profile: 'Đăng bài trang cá nhân',
  fb_post_page: 'Đăng bài fanpage',
  fb_comment: 'Comment',
  fb_message_stranger: 'Nhắn tin người lạ',
  fb_message_friend: 'Nhắn tin bạn bè',
  fb_message_page_inbox_customer: 'Nhắn tin khách inbox page',
  fb_add_friend: 'Kết bạn',
  fb_like_post: 'Like post',
  fb_join_group: 'Tham gia group',
  fb_group_invite: 'Mời vào group'
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function isFacebookCampaignAction(actionId: string | null | undefined): boolean {
  return FACEBOOK_CAMPAIGN_ACTION_IDS.includes(String(actionId ?? ''))
}

/** Loại không có dòng data (trang cá nhân, newsfeed): mỗi mốc lịch một lượt (claim mode campaign_slot, V558). */
export function facebookSlotMode(actionId: string): boolean {
  return actionId === FB_TIMELINE_POST || actionId === FB_NEWSFEED
}

export function isNewsfeedLikeConfigured(extra: Record<string, unknown>): boolean {
  return extra.enablePostLike === true && String(extra.newsfeedLikeKind ?? '').trim().length > 0 && Number(extra.newsfeedLikeLimit ?? 0) > 0
}

export function isNewsfeedCommentConfigured(extra: Record<string, unknown>): boolean {
  return extra.enableComment === true && String(extra.newsfeedCommentKind ?? '').trim().length > 0
    && Number(extra.newsfeedCommentLimit ?? 0) > 0
}

/** getDefaultCampaignActionDescriptors của Desktop (không gồm thao tác tuỳ chọn đang tắt). */
export function facebookDefaultActionCodes(campaign: Pick<FacebookCampaign, 'actionId' | 'extraSettings'>): string[] {
  const extra = campaign.extraSettings
  switch (campaign.actionId) {
    case FB_GROUP_POST:
      return ['fb_post_group', ...(extra.enableComment ? ['fb_comment'] : []), ...(extra.enablePostLike ? ['fb_like_post'] : [])]
    case FB_TIMELINE_POST:
      return ['fb_post_my_profile', ...(extra.enableComment ? ['fb_comment'] : []), ...(extra.enablePostLike ? ['fb_like_post'] : [])]
    case FB_PAGE_POST: return ['fb_post_page']
    case FB_MESSAGE_FRIEND: return ['fb_message_friend']
    case FB_PAGE_INBOX: return ['fb_message_page_inbox_customer']
    case FB_MESSAGE_UID:
      return [...(extra.enableMessage !== false ? ['fb_message_stranger'] : []), ...(extra.enableAddFriend ? ['fb_add_friend'] : [])]
    case FB_COMMENT_SEEDING:
    case FB_COMMENT_SEEDING_POST:
      return ['fb_comment', ...(extra.enablePostLike ? ['fb_like_post'] : [])]
    case FB_NEWSFEED:
      return [...(isNewsfeedCommentConfigured(extra) ? ['fb_comment'] : []), ...(isNewsfeedLikeConfigured(extra) ? ['fb_like_post'] : [])]
    case FB_JOIN_GROUP: return ['fb_join_group']
    case FB_GROUP_INVITE: return ['fb_group_invite']
    default: return []
  }
}

/** isActionCheckEnabledForCampaign của Desktop, phần Facebook. */
export function facebookActionEnabled(campaign: Pick<FacebookCampaign, 'actionId' | 'extraSettings'>, code: string): boolean {
  const extra = campaign.extraSettings
  if (campaign.actionId === FB_GROUP_POST && extra.groupPostShareFromPost === true && (code === 'fb_comment' || code === 'fb_like_post')) return false
  switch (code) {
    case 'fb_message_friend':
    case 'fb_message_page_inbox_customer':
      return true
    case 'fb_message_stranger':
      return campaign.actionId !== FB_MESSAGE_UID || extra.enableMessage !== false
    case 'fb_add_friend':
      if (campaign.actionId === FB_MESSAGE_FRIEND) return false
      return campaign.actionId !== FB_MESSAGE_UID || extra.enableAddFriend === true
    case 'fb_comment':
      if (campaign.actionId === FB_NEWSFEED) return isNewsfeedCommentConfigured(extra)
      if (campaign.actionId === FB_COMMENT_SEEDING || campaign.actionId === FB_COMMENT_SEEDING_POST) return true
      return extra.enableComment === true
    case 'fb_like_post':
      if (campaign.actionId === FB_NEWSFEED) return isNewsfeedLikeConfigured(extra)
      return extra.enablePostLike === true
    default:
      return true
  }
}

/** isSkippableLimitAction của Desktop, phần Facebook: hết lượt thì bỏ qua thao tác này khi bật "tiếp tục khi chạm giới hạn". */
export function facebookSkippableLimitAction(actionId: string, code: string): boolean {
  if (code === 'fb_comment') return actionId === FB_GROUP_POST || actionId === FB_TIMELINE_POST || actionId === FB_NEWSFEED
  if (code === 'fb_like_post') {
    return actionId === FB_GROUP_POST || actionId === FB_TIMELINE_POST || actionId === FB_COMMENT_SEEDING
      || actionId === FB_COMMENT_SEEDING_POST || actionId === FB_NEWSFEED
  }
  if (code === 'fb_message_stranger' || code === 'fb_add_friend') return actionId === FB_MESSAGE_UID
  return false
}

export interface FacebookClaimPlanOptions {
  /** auto_campaign_actions.limit_check_action_codes của loại chiến dịch (null = theo mặc định của Desktop). */
  limitCheckActionCodes?: readonly string[] | null
}

/**
 * Thao tác cho claim, đúng preflight của bộ cũ (checkActionDisabled + checkActionLimitsForContinuation): mọi thao tác chạy được đều kiểm
 * khoá; thao tác trong danh sách hạn mức (limit_check_action_codes ∩ enabledActionCodes) kiểm thêm hạn mức. "Tiếp tục khi chạm giới hạn":
 * thao tác tuỳ chọn hết lượt thì bỏ qua (khoá vẫn chờ); không bật thì hết lượt là chờ. Newsfeed: hai thao tác đều tuỳ chọn, cần ít nhất một.
 */
export function facebookClaimPlan(campaign: FacebookCampaign, options: FacebookClaimPlanOptions = {}): Pick<ClaimContext, 'actions' | 'requireAny'> {
  const extra = campaign.extraSettings
  const executable = facebookDefaultActionCodes(campaign).filter(code => facebookActionEnabled(campaign, code))
  const candidates = options.limitCheckActionCodes
    ? options.limitCheckActionCodes.map(code => String(code).trim()).filter(Boolean)
    : facebookDefaultActionCodes(campaign)
  const limits = object(extra.actionLimits)
  const configured = campaign.actionId !== FB_NEWSFEED && Array.isArray(limits.enabledActionCodes)
    ? new Set((limits.enabledActionCodes as unknown[]).map(String)) : null
  const quotaCodes = new Set(candidates.filter(code => (!configured || configured.has(code)) && facebookActionEnabled(campaign, code)))
  const canSkip = limits.continueWhenActionLimitReached === true
  // Thao tác chỉ có trong danh sách hạn mức (không chạy) vẫn được kiểm như bộ cũ (checkActionLimits duyệt danh sách hạn mức).
  const codes = [...executable, ...[...quotaCodes].filter(code => !executable.includes(code))]
  const actions: ClaimContext['actions'] = codes.map(code => {
    const quota = quotaCodes.has(code)
    const skippable = canSkip && quota && facebookSkippableLimitAction(campaign.actionId, code)
    return {
      code,
      ...(quota ? {} : { quota: false }),
      ...(skippable ? { required: false, skippableGates: ['quota'] } : {})
    }
  })
  if (campaign.actionId === FB_NEWSFEED) {
    const both = actions.filter(action => action.code === 'fb_comment' || action.code === 'fb_like_post').map(action => action.code)
    return { actions, ...(canSkip && both.length > 0 ? { requireAny: both } : {}) }
  }
  if (canSkip && campaign.actionId === FB_MESSAGE_UID) {
    const send = actions.filter(action => action.required === false).map(action => action.code)
    if (send.length > 0) return { actions, requireAny: send }
  }
  return { actions }
}

/** getInputDataDisplayName của Desktop cho Facebook: tên → UID → SĐT. */
export function facebookTargetLabel(target: TargetRow): string {
  for (const value of [target.name, target.uid, target.phone]) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return 'N/A'
}

export interface FacebookSupportEnvironment {
  /** Tài khoản bật hàng đợi ngẫu nhiên (facebookRandomRunEnabled): bộ cũ chạy theo tài khoản, engine không nhận. */
  randomRunEnabled?: boolean
}

/**
 * Hàm phủ của bản Desktop này: chiến dịch FB nào chạy bằng engine. Lý do trả về để ghi vết; nơi chạy dùng bộ cũ cho chiến dịch đó.
 * Cấu hình hiếm chưa làm (đo production 16/11/2026) chạy bộ cũ như cách Zalo làm với zaloCampaignV2Support.
 */
export function facebookCampaignV2Support(campaign: FacebookCampaign, env: FacebookSupportEnvironment = {}): V2Support {
  if (!isFacebookCampaignAction(campaign.actionId)) return { ok: false, reason: 'not_facebook' }
  if (env.randomRunEnabled === true) return { ok: false, reason: 'random_run' }
  // Đăng nhóm kèm chia sẻ sang nhóm đã tham gia (anh chốt 16/11 khuya: làm y bộ cũ): nơi chạy nhận thêm các nhóm đã chọn vào lượt
  // (claimExtraTargets) và ghi dấu "sắp gửi" cho từng nhóm trước cú bấm Đăng. Tìm data (Q5): dòng "Tìm data" không gắn thao tác
  // (facebookResultName). Cả 13 loại đều chạy bộ mới khi tổ chức bật.
  return { ok: true }
}
