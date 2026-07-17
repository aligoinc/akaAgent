import { Campaign, CampaignAction } from '../../../shared/types'

export interface CampaignActionDescriptor {
  code: string
  name: string
}

const COMMENT_SEEDING_FEED_ACTION_ID = 'facebook_comment_seeding'
const COMMENT_SEEDING_POST_ACTION_ID = 'facebook_comment_seeding_post'
const MESSAGE_FRIEND_ACTION_ID = 'facebook_message_friend'
const MESSAGE_UID_ACTION_ID = 'facebook_message_uid'
const PAGE_INBOX_MESSAGE_ACTION_ID = 'facebook_page_to_message'
const PAGE_POST_ACTION_ID = 'facebook_page_post'
const NEWSFEED_INTERACTION_ACTION_ID = 'facebook_newsfeed_interaction'
const FACEBOOK_JOIN_GROUP_ACTION_ID = 'facebook_join_group'
const FACEBOOK_GROUP_INVITE_ACTION_ID = 'facebook_group_invite'
const ZALO_MESSAGE_PHONE_ACTION_ID = 'zalo_message_phone'
const ZALO_MESSAGE_FRIEND_ACTION_ID = 'zalo_message_friend'
const ZALO_MESSAGE_BIRTHDAY_ACTION_ID = 'zalo_message_birthday'
const ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID = 'zalo_message_group_member'
const ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID = 'zalo_message_group_realtime'
const ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID = 'zalo_message_remarketing_customer'
const ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID = 'zalo_message_friend_recommendation'
const ZALO_MESSAGE_GROUP_ACTION_ID = 'zalo_message_group'
const ZALO_ADD_GROUP_MEMBER_ACTION_ID = 'zalo_add_group_member'
const ZALO_JOIN_GROUP_LINK_ACTION_ID = 'zalo_join_group_link'
const ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID = 'zalo_cancel_sent_friend_request'
const EMAIL_SEND_ACTION_ID = 'email_send'
const SMS_SEND_ACTION_ID = 'sms_send'
const VOICE_CALL_ACTION_ID = 'voice_call'

export function isCommentSeedingCampaign(actionId: string): boolean {
  return actionId === COMMENT_SEEDING_FEED_ACTION_ID || actionId === COMMENT_SEEDING_POST_ACTION_ID
}

export function isNewsfeedLikeConfigured(extra: Campaign['extraSettings']): boolean {
  return extra?.enablePostLike === true
    && String(extra.newsfeedLikeKind || '').trim().length > 0
    && Number(extra.newsfeedLikeLimit || 0) > 0
}

export function isNewsfeedCommentConfigured(extra: Campaign['extraSettings']): boolean {
  return extra?.enableComment === true
    && String(extra.newsfeedCommentKind || '').trim().length > 0
    && Number(extra.newsfeedCommentLimit || 0) > 0
}

export function getAccountActionName(actionCode: string): string {
  switch (actionCode) {
    case 'fb_post_group': return 'Đăng bài group'
    case 'fb_post_my_profile': return 'Đăng bài trang cá nhân'
    case 'fb_post_page': return 'Đăng bài fanpage'
    case 'fb_comment': return 'Comment'
    case 'fb_message_stranger': return 'Nhắn tin người lạ'
    case 'fb_message_friend': return 'Nhắn tin bạn bè'
    case 'fb_message_page_inbox_customer': return 'Nhắn tin khách inbox page'
    case 'fb_add_friend': return 'Kết bạn'
    case 'fb_like_post': return 'Like post'
    case 'fb_join_group': return 'Tham gia group'
    case 'fb_group_invite': return 'Mời vào group'
    case 'zalo_find_phone_user': return 'Tìm SĐT'
    case 'zalo_message_friend': return 'Nhắn tin bạn bè'
    case 'zalo_message_group': return 'Nhắn tin group'
    case 'zalo_message_stranger': return 'Nhắn tin người lạ'
    case 'zalo_add_friend': return 'Kết bạn'
    case 'zalo_cancel_sent_friend_request': return 'Huỷ lời mời kết bạn'
    case 'zalo_add_group_member': return 'Thêm thành viên vào group'
    case 'zalo_join_group_link': return 'Tham gia group'
    case 'zalo_tag_contact': return 'Gắn tag Zalo'
    case 'zalo_change_alias': return 'Đổi tên Zalo'
    case 'email_send': return 'Gửi email'
    case 'sms_send': return 'Gửi SMS'
    case 'voice_call': return 'Gọi tự động qua SIM'
    default: return actionCode
  }
}

export function getPostActionCode(campaign: Campaign): string | null {
  if (campaign.actionId === 'facebook_group_post') return 'fb_post_group'
  if (campaign.actionId === 'facebook_timeline_post') return 'fb_post_my_profile'
  if (campaign.actionId === PAGE_POST_ACTION_ID) return 'fb_post_page'
  return null
}

export function getMessageActionCode(campaign: Campaign): string {
  if (campaign.actionId === MESSAGE_UID_ACTION_ID) return 'fb_message_stranger'
  if (campaign.actionId === PAGE_INBOX_MESSAGE_ACTION_ID) return 'fb_message_page_inbox_customer'
  return 'fb_message_friend'
}

function isActionCheckEnabledForCampaign(campaign: Campaign, actionCode: string): boolean {
  const extra = campaign.extraSettings || {}
  switch (actionCode) {
    case 'fb_message_friend':
      return true
    case 'fb_message_page_inbox_customer':
      return true
    case 'fb_message_stranger':
      return campaign.actionId !== MESSAGE_UID_ACTION_ID || extra.enableMessage !== false
    case 'fb_add_friend':
      if (campaign.actionId === MESSAGE_FRIEND_ACTION_ID) return false
      return campaign.actionId !== MESSAGE_UID_ACTION_ID || extra.enableAddFriend === true
    case 'fb_comment':
      if (campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID) {
        return isNewsfeedCommentConfigured(extra)
      }
      if (isCommentSeedingCampaign(campaign.actionId)) return true
      return extra.enableComment === true
    case 'fb_like_post':
      if (campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID) {
        return isNewsfeedLikeConfigured(extra)
      }
      return extra.enablePostLike === true
    case 'zalo_find_phone_user':
      return campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID
    case 'zalo_message_friend':
      return campaign.actionId === ZALO_MESSAGE_FRIEND_ACTION_ID || campaign.actionId === ZALO_MESSAGE_BIRTHDAY_ACTION_ID
    case 'zalo_message_group':
      return campaign.actionId === ZALO_MESSAGE_GROUP_ACTION_ID
    case 'zalo_join_group_link':
      return campaign.actionId === ZALO_JOIN_GROUP_LINK_ACTION_ID
    case 'zalo_cancel_sent_friend_request':
      return campaign.actionId === ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID
    case 'zalo_add_group_member':
      return campaign.actionId === ZALO_ADD_GROUP_MEMBER_ACTION_ID
    case 'zalo_message_stranger':
      return (
        campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
      ) && extra.enableMessage === true
    case 'zalo_add_friend':
      return (
        campaign.actionId === ZALO_MESSAGE_PHONE_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID ||
        campaign.actionId === ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID
      ) && extra.enableAddFriend === true
    case 'zalo_tag_contact':
    case 'zalo_change_alias':
      return false
    default:
      return true
  }
}

function dedupeActionDescriptors(actions: CampaignActionDescriptor[]): CampaignActionDescriptor[] {
  const seen = new Set<string>()
  return actions.filter(action => {
    if (seen.has(action.code)) return false
    seen.add(action.code)
    return true
  })
}

function normalizeActionDescriptors(actionCodes: string[]): CampaignActionDescriptor[] {
  return dedupeActionDescriptors(actionCodes.map(code => {
    const normalizedCode = code.trim()
    return { code: normalizedCode, name: getAccountActionName(normalizedCode) }
  }).filter(action => action.code))
}

function filterExecutableActionDescriptors(
  campaign: Campaign,
  actions: CampaignActionDescriptor[]
): CampaignActionDescriptor[] {
  return actions.filter(action => isActionCheckEnabledForCampaign(campaign, action.code))
}

function filterQuotaActionDescriptors(
  campaign: Campaign,
  actions: CampaignActionDescriptor[]
): CampaignActionDescriptor[] {
  const configuredCodes = campaign.extraSettings?.actionLimits?.enabledActionCodes
  const configuredSet = campaign.actionId === NEWSFEED_INTERACTION_ACTION_ID
    ? null
    : Array.isArray(configuredCodes) ? new Set(configuredCodes) : null

  return actions.filter(action => {
    if (configuredSet && !configuredSet.has(action.code)) return false
    return isActionCheckEnabledForCampaign(campaign, action.code)
  })
}

function getDefaultCampaignActionDescriptors(campaign: Campaign): CampaignActionDescriptor[] {
  const extra = campaign.extraSettings || {}
  const actions: CampaignActionDescriptor[] = []

  switch (campaign.actionId) {
    case 'facebook_group_post':
      actions.push({ code: 'fb_post_group', name: 'Đăng bài group' })
      if (extra.enableComment) actions.push({ code: 'fb_comment', name: 'Comment' })
      if (extra.enablePostLike) actions.push({ code: 'fb_like_post', name: 'Like post' })
      break
    case 'facebook_timeline_post':
      actions.push({ code: 'fb_post_my_profile', name: 'Đăng bài trang cá nhân' })
      if (extra.enableComment) actions.push({ code: 'fb_comment', name: 'Comment' })
      if (extra.enablePostLike) actions.push({ code: 'fb_like_post', name: 'Like post' })
      break
    case PAGE_POST_ACTION_ID:
      actions.push({ code: 'fb_post_page', name: 'Đăng bài fanpage' })
      break
    case MESSAGE_FRIEND_ACTION_ID:
      actions.push({ code: 'fb_message_friend', name: 'Nhắn tin bạn bè' })
      break
    case PAGE_INBOX_MESSAGE_ACTION_ID:
      actions.push({ code: 'fb_message_page_inbox_customer', name: 'Nhắn tin khách inbox page' })
      break
    case MESSAGE_UID_ACTION_ID:
      if (extra.enableMessage !== false) actions.push({ code: 'fb_message_stranger', name: 'Nhắn tin người lạ' })
      if (extra.enableAddFriend) actions.push({ code: 'fb_add_friend', name: 'Kết bạn' })
      break
    case COMMENT_SEEDING_FEED_ACTION_ID:
    case COMMENT_SEEDING_POST_ACTION_ID:
      actions.push({ code: 'fb_comment', name: 'Comment' })
      if (extra.enablePostLike) actions.push({ code: 'fb_like_post', name: 'Like post' })
      break
    case NEWSFEED_INTERACTION_ACTION_ID:
      if (isNewsfeedCommentConfigured(extra)) {
        actions.push({ code: 'fb_comment', name: 'Comment' })
      }
      if (isNewsfeedLikeConfigured(extra)) {
        actions.push({ code: 'fb_like_post', name: 'Like post' })
      }
      break
    case FACEBOOK_JOIN_GROUP_ACTION_ID:
      actions.push({ code: 'fb_join_group', name: 'Tham gia group' })
      break
    case FACEBOOK_GROUP_INVITE_ACTION_ID:
      actions.push({ code: 'fb_group_invite', name: 'Mời vào group' })
      break
    case ZALO_MESSAGE_PHONE_ACTION_ID:
      actions.push({ code: 'zalo_find_phone_user', name: 'Tìm SĐT' })
      if (extra.enableMessage) {
        actions.push({ code: 'zalo_message_stranger', name: 'Nhắn tin người lạ' })
      }
      if (extra.enableAddFriend) actions.push({ code: 'zalo_add_friend', name: 'Kết bạn' })
      break
    case ZALO_MESSAGE_GROUP_MEMBER_ACTION_ID:
    case ZALO_MESSAGE_GROUP_REALTIME_ACTION_ID:
      if (extra.enableMessage) {
        actions.push({ code: 'zalo_message_stranger', name: 'Nhắn tin người lạ' })
      }
      if (extra.enableAddFriend) actions.push({ code: 'zalo_add_friend', name: 'Kết bạn' })
      break
    case ZALO_MESSAGE_REMARKETING_CUSTOMER_ACTION_ID:
      if (extra.enableMessage) {
        actions.push({ code: 'zalo_message_stranger', name: 'Nhắn tin người lạ' })
      }
      if (extra.enableAddFriend) actions.push({ code: 'zalo_add_friend', name: 'Kết bạn' })
      break
    case ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID:
      if (extra.enableMessage) {
        actions.push({ code: 'zalo_message_stranger', name: 'Nhắn tin người lạ' })
      }
      if (extra.enableAddFriend) actions.push({ code: 'zalo_add_friend', name: 'Kết bạn' })
      break
    case ZALO_MESSAGE_FRIEND_ACTION_ID:
      actions.push({ code: 'zalo_message_friend', name: 'Nhắn tin bạn bè' })
      break
    case ZALO_MESSAGE_BIRTHDAY_ACTION_ID:
      actions.push({ code: 'zalo_message_friend', name: 'Nhắn tin bạn bè' })
      break
    case ZALO_MESSAGE_GROUP_ACTION_ID:
      actions.push({ code: 'zalo_message_group', name: 'Nhắn tin group' })
      break
    case ZALO_ADD_GROUP_MEMBER_ACTION_ID:
      actions.push({ code: 'zalo_add_group_member', name: 'Thêm thành viên vào group' })
      break
    case ZALO_JOIN_GROUP_LINK_ACTION_ID:
      actions.push({ code: 'zalo_join_group_link', name: 'Tham gia group' })
      break
    case ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID:
      actions.push({ code: 'zalo_cancel_sent_friend_request', name: 'Huỷ lời mời kết bạn' })
      break
    case EMAIL_SEND_ACTION_ID:
      actions.push({ code: 'email_send', name: 'Gửi email' })
      break
    case SMS_SEND_ACTION_ID:
      actions.push({ code: 'sms_send', name: 'Gửi SMS' })
      break
    case VOICE_CALL_ACTION_ID:
      actions.push({ code: 'voice_call', name: 'Gọi tự động qua SIM' })
      break
  }

  return dedupeActionDescriptors(actions)
}

function getQuotaCandidateActionDescriptors(
  campaign: Campaign,
  campaignAction?: CampaignAction
): CampaignActionDescriptor[] {
  if (campaignAction && Array.isArray(campaignAction.limitCheckActionCodes)) {
    return normalizeActionDescriptors(campaignAction.limitCheckActionCodes)
  }

  return getDefaultCampaignActionDescriptors(campaign)
}

export function getCampaignExecutableActionDescriptors(
  campaign: Campaign,
  campaignAction?: CampaignAction
): CampaignActionDescriptor[] {
  void campaignAction
  return filterExecutableActionDescriptors(
    campaign,
    getDefaultCampaignActionDescriptors(campaign)
  )
}

export function getCampaignActionDescriptors(
  campaign: Campaign,
  campaignAction?: CampaignAction
): CampaignActionDescriptor[] {
  return filterQuotaActionDescriptors(
    campaign,
    getQuotaCandidateActionDescriptors(campaign, campaignAction)
  )
}
