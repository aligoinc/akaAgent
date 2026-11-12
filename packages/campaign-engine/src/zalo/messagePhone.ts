/**
 * Nhắn tin / kết bạn người lạ, tách từ bộ chạy Desktop/VPS (campaignScheduler.ts):
 * - "Nhắn tin theo SĐT" (zalo_message_phone): tra SĐT reqSrc 32 rồi 40 (searchZaloPhone) → cổng từ chối nhận tin
 *   (gateResolvedPhoneMessageTarget) → nhắn tin (zaloSendPhoneMessage) → kết bạn (zaloSendPhoneFriendRequest, chạy cả khi nhắn tin lỗi);
 * - "Nhắn tin thành viên nhóm" (zalo_message_group_member, workflow 272) và "Nhắn tin khách cũ" (zalo_message_remarketing_customer,
 *   workflow 274): data đã có UID; hồ sơ đọc theo UID (preflightZaloMessageOptOut) → cổng từ chối nhận tin → lưu danh bạ
 *   (zaloResolveGroupMemberTarget / zaloResolveRemarketingCustomerTarget) → các bước gửi như trên.
 *
 * Câu cho khách, cách chọn nội dung xoay vòng và cách dựng mẫu giữ đúng Desktop. Mỗi nơi chạy chỉ cài cổng
 * ZaloMessagePhonePort (thao tác thật với Zalo và DB); cổng không quyết định gì. Kết quả do DB chốt (V495).
 * Chiến dịch dùng tính năng chưa có ở đây thì zaloMessagePhoneV2Support trả lý do và nơi chạy dùng bộ cũ.
 */
import type { ClaimContext, RawOutcome, TargetRow } from '../contracts.js'
import type { EngineStep, StepContext } from '../runUnit.js'
import { CancelledError, DeadlineError, errorMessage, withDeadline } from '../boundary.js'
import { beginZaloEngagement, type ZaloEngagementPort } from './engagement.js'
import { prepareCampaignContent } from '../content/campaignContentPreparation.js'
import { splitContentVariants } from '../content/contentSpin.js'
import { appendStopMessagesFooter, supportsStopMessagesLink, type StopMessagesRenderState } from '../content/zaloMessageOptOut.js'
import { buildMessageOptOutSource } from '../content/messageOptOutSource.js'
import { splitFormattedContentVariants, supportsFormattedContent, transformFormattedContentText } from '../content/formattedContent.js'
import { convertHtmlToZaloMessage, type ZaloStyledText } from '../content/zaloFormattedContent.js'
import { searchZaloPhone, type PhoneSearchAttempt, type PhoneSearchLimitScope } from '../content/zaloPhoneSearch.js'
import {
  firstString, mergeZaloProfileTarget, preparationFailure, renderZaloTemplateText, templateUsesDatabaseDate, zaloFailure, zaloTargetFromFoundUser,
  zaloTargetFromInput, zaloTargetLabel, type ZaloFoundUser, type ZaloResolvedTarget
} from './common.js'
import {
  ZALO_AUXILIARY_ACTION_NAMES, buildAkaBizTagStep, buildZaloAuxiliarySteps, type ZaloAuxiliaryAccount, type ZaloAuxiliaryPort
} from './auxiliary.js'
import {
  campaignDeclaresMedia, campaignMediaName, campaignMediaSourceHint, hasDeclaredMediaSource, planZaloSend, selectZaloCampaignMedia,
  type CampaignMediaItem, type ZaloMediaFile
} from './media.js'
import { advancedContentConfigIssue, advancedContentItems, selectAdvancedContentItem, selectAdvancedContentMedia } from './advancedContent.js'
import { validateZaloContent, type ConfigIssue } from '../validation.js'
import { ZaloPortError } from './common.js'
import {
  checkZaloSendExclusion, exclusionProfileTarget, sendExclusionActive, validateSendExclusionConfig, type ZaloSendExclusionPort
} from './sendExclusion.js'
import { checkZaloFriendBlocklist, friendBlocklistActive, validateFriendBlocklistConfig, type ZaloFriendBlocklistPort } from './friendBlocklist.js'
import { ZALO_MESSAGE_BIRTHDAY, ZALO_MESSAGE_FRIEND_RECOMMENDATION } from './materialize.js'

export const ZALO_MESSAGE_PHONE = 'zalo_message_phone'
export const ZALO_MESSAGE_GROUP_MEMBER = 'zalo_message_group_member'
export const ZALO_MESSAGE_REMARKETING_CUSTOMER = 'zalo_message_remarketing_customer'
/** Nhắn tin thành viên group theo thời gian thực (workflow 276, cùng các bước với thành viên nhóm; data do bộ nhận sự kiện đổ vào). */
export const ZALO_MESSAGE_GROUP_REALTIME = 'zalo_message_group_realtime'
export const ZALO_MESSAGE_FRIEND = 'zalo_message_friend'
/** Mã thao tác "Nhắn tin bạn bè" (cũng là loại chiến dịch). */
export const MESSAGE_FRIEND = 'zalo_message_friend'
/** Nhắn tin group (workflow 268): loại chiến dịch và mã thao tác trùng tên. */
export const ZALO_MESSAGE_GROUP = 'zalo_message_group'
const NAME_MESSAGE_GROUP = 'Nhắn tin group'
export const FIND_PHONE = 'zalo_find_phone_user'
export const MESSAGE_STRANGER = 'zalo_message_stranger'
export const ADD_FRIEND = 'zalo_add_friend'
export const ZALO_MESSAGE_OPT_OUT_NOTE = 'Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo'
/** Lời mời kết bạn tối đa 150 ký tự, như Desktop. */
export const FRIEND_REQUEST_MAX_LENGTH = 150

/** Tên thao tác Desktop ghi vào lịch sử (actionName của helper). */
const NAME_FIND = 'Tìm SĐT'
const NAME_MESSAGE = 'Nhắn tin người lạ'
const NAME_FRIEND = 'Kết bạn'
const NAME_MESSAGE_FRIEND = 'Nhắn tin bạn bè'
export const ZALO_MESSAGE_PHONE_ACTION_NAMES: Readonly<Record<string, string>> = {
  [FIND_PHONE]: NAME_FIND,
  [MESSAGE_STRANGER]: NAME_MESSAGE,
  [ADD_FRIEND]: NAME_FRIEND,
  ...ZALO_AUXILIARY_ACTION_NAMES
}
/** Loại theo UID: như trên, không có Tìm SĐT. */
export const ZALO_UID_STRANGER_ACTION_NAMES: Readonly<Record<string, string>> = {
  [MESSAGE_STRANGER]: NAME_MESSAGE,
  [ADD_FRIEND]: NAME_FRIEND,
  ...ZALO_AUXILIARY_ACTION_NAMES
}
/** Nhắn tin bạn bè (workflow 266): nhắn tin bạn bè rồi tag / đổi tên. */
export const ZALO_MESSAGE_FRIEND_ACTION_NAMES: Readonly<Record<string, string>> = {
  [MESSAGE_FRIEND]: NAME_MESSAGE_FRIEND,
  ...ZALO_AUXILIARY_ACTION_NAMES
}
/** Nhắn tin group (workflow 268): chỉ nhắn tin (không tag / đổi tên). */
export const ZALO_MESSAGE_GROUP_ACTION_NAMES: Readonly<Record<string, string>> = { [ZALO_MESSAGE_GROUP]: NAME_MESSAGE_GROUP }

type JsonObject = Record<string, unknown>

/** Loại nhắn tin theo UID của data (người lạ: thành viên nhóm, khách cũ; bạn bè). */
export interface ZaloUidStrangerType {
  actionId: string
  /** Câu khi data không có UID (Desktop tự đặt mã 114 cho thao tác nhắn tin của loại). */
  missingUidText: string
  /** Có kiêm gửi SMS (EXTERNAL_SMS_ZALO_ACTION_IDS của Desktop: chỉ SĐT và thành viên nhóm); loại khác bỏ qua cấu hình SMS. */
  smsPush: boolean
  /** Thao tác nhắn tin của loại (mã hạn mức, khoá xoay vòng nội dung, tên trong lịch sử). */
  messageAction: string
  messageName: string
  /** Nhắn tin luôn chạy (bạn bè), không theo công tắc enableMessage; không có bước kết bạn. */
  friendMessage: boolean
}

export const ZALO_UID_STRANGER_TYPES: Readonly<Record<string, ZaloUidStrangerType>> = {
  [ZALO_MESSAGE_GROUP_MEMBER]: { actionId: ZALO_MESSAGE_GROUP_MEMBER, missingUidText: 'UID thành viên group Zalo không hợp lệ', smsPush: true,
    messageAction: MESSAGE_STRANGER, messageName: NAME_MESSAGE, friendMessage: false },
  // Group thời gian thực: cùng helper với thành viên nhóm (zaloResolveGroupMemberTarget), không kiêm SMS.
  [ZALO_MESSAGE_GROUP_REALTIME]: { actionId: ZALO_MESSAGE_GROUP_REALTIME, missingUidText: 'UID thành viên group Zalo không hợp lệ', smsPush: false,
    messageAction: MESSAGE_STRANGER, messageName: NAME_MESSAGE, friendMessage: false },
  [ZALO_MESSAGE_REMARKETING_CUSTOMER]: {
    actionId: ZALO_MESSAGE_REMARKETING_CUSTOMER, missingUidText: 'UID khách hàng cũ Zalo không hợp lệ', smsPush: false,
    messageAction: MESSAGE_STRANGER, messageName: NAME_MESSAGE, friendMessage: false
  },
  // Workflow 266 (zaloSendFriendMessage): không kiểm còn là bạn bè; người đã huỷ kết bạn nhận câu trả lời kiểu 120/802.
  [ZALO_MESSAGE_FRIEND]: { actionId: ZALO_MESSAGE_FRIEND, missingUidText: 'UID bạn bè Zalo không hợp lệ', smsPush: false,
    messageAction: MESSAGE_FRIEND, messageName: NAME_MESSAGE_FRIEND, friendMessage: true },
  // Chúc mừng sinh nhật (workflow 270): cùng helper với nhắn bạn bè (zaloSendFriendMessage), không tag akaBiz, không tag Zalo / đổi tên.
  [ZALO_MESSAGE_BIRTHDAY]: { actionId: ZALO_MESSAGE_BIRTHDAY, missingUidText: 'UID bạn bè Zalo không hợp lệ', smsPush: false,
    messageAction: MESSAGE_FRIEND, messageName: NAME_MESSAGE_FRIEND, friendMessage: true },
  // Nhắn tin / kết bạn theo đề xuất Zalo (workflow 280): như thành viên nhóm (zaloResolveFriendRecommendationTarget), không kiêm SMS.
  [ZALO_MESSAGE_FRIEND_RECOMMENDATION]: { actionId: ZALO_MESSAGE_FRIEND_RECOMMENDATION, missingUidText: 'UID đề xuất Zalo không hợp lệ',
    smsPush: false, messageAction: MESSAGE_STRANGER, messageName: NAME_MESSAGE, friendMessage: false }
}

function uidStrangerType(actionId: string): ZaloUidStrangerType | null {
  return Object.prototype.hasOwnProperty.call(ZALO_UID_STRANGER_TYPES, actionId) ? ZALO_UID_STRANGER_TYPES[actionId]! : null
}

/** Phần cấu hình chiến dịch mà bước cần; mỗi nơi chạy dựng từ dòng auto_campaigns của mình. */
export interface ZaloMessagePhoneCampaign {
  id: number
  actionId: string
  accountId: number
  content: string | null | undefined
  extraSettings: JsonObject
  /** Media chính (auto_campaigns.images). */
  images?: readonly unknown[] | null
  dataTargetSourceMode?: string | null
}

export interface ZaloMessagePhoneEnvironment {
  /** Theo dõi tương tác Zalo (zalo.campaign_engagement.enabled) đang bật. */
  engagementTrackingEnabled: boolean
  /** Cổng của nơi chạy ghi được nguồn tương tác (engagementBegin / engagementRegister); không có thì chiến dịch nhắn tin chạy bộ cũ khi bật. */
  engagementSupported?: boolean
  /** Nơi chạy kiêm SMS sang akaBiz Sms được (Desktop có tích hợp akaBiz; Fly không, như bộ cũ của Fly). */
  externalSmsPush?: boolean
}

export type V2Support = { ok: true } | { ok: false; reason: string }

/** Tin gửi Zalo: chữ thường, hoặc chữ có định dạng { msg, styles } (nội dung định dạng, như ZaloOutgoingText của Desktop). */
export type ZaloOutgoingText = string | ZaloStyledText
const outgoingText = (message: ZaloOutgoingText): string => typeof message === 'string' ? message : message.msg

/**
 * Thao tác thật với Zalo và DB. Mỗi hàm nhận ngữ cảnh của bước (lượt data, lease, data, tín hiệu huỷ): Fly dùng
 * lượt data làm khoá chống gửi trùng cho lệnh. Lỗi của Zalo ném ZaloPortError (zaloPortErrorFrom); lỗi khác là lỗi code.
 */
export interface ZaloMessagePhonePort extends ZaloAuxiliaryPort, ZaloSendExclusionPort, ZaloFriendBlocklistPort, ZaloEngagementPort {
  /** Một lần tra SĐT với reqSrc. Không có hồ sơ thì trả null (đã chuẩn hoá như normalizeFoundUser). */
  findUser(ctx: StepContext, phone: string, reqSrc: 32 | 40): Promise<ZaloFoundUser | null>
  /** Giới hạn tra số của mã lỗi theo chính sách hiện có (phoneSearchLimitScope của Desktop); không có thì null. */
  phoneSearchLimitScope(code: string): Promise<PhoneSearchLimitScope | null>
  /** Lưu hồ sơ tìm được: danh bạ và tên/UID của data. Lỗi ghi DB không đổi kết quả tra số. */
  saveFoundUser(ctx: StepContext, target: ZaloResolvedTarget, user: ZaloFoundUser): Promise<void>
  /**
   * Đọc hồ sơ theo UID (getUserProfile của Desktop: api.getUserInfo, bỏ hậu tố _0; Fly: lệnh get_user_profile). Không có hồ sơ
   * thì null; uid của hồ sơ là UID đã chuẩn hoá, raw thêm requestedUid / getUserInfoKey như Desktop.
   */
  getUserProfile(ctx: StepContext, uid: string): Promise<ZaloFoundUser | null>
  /**
   * Lưu hồ sơ đọc theo UID vào danh bạ (upsertZaloResolvedProfileTarget của Desktop; nguồn = loại chiến dịch). Chỉ gọi khi
   * mục tiêu có hồ sơ (raw.profile). Lỗi ghi DB không đổi kết quả.
   */
  saveResolvedProfile(ctx: StepContext, target: ZaloResolvedTarget): Promise<void>
  /** Kiểm danh sách từ chối nhận tin; ném lỗi khi không kiểm được. */
  isOptedOut(ctx: StepContext, identity: { phone?: string; globalId?: string }): Promise<boolean>
  /**
   * Tạo (hoặc lấy lại) link từ chối nhận tin cho người nhận (RPC aka_agent_prepare_zalo_message_opt_out, như
   * prepareZaloMessageOptOutLink); isOptedOut = người nhận đã từ chối. Ném lỗi kèm câu khi không tạo được.
   */
  prepareOptOutLink(ctx: StepContext, identity: { globalId: string; phone: string | null }): Promise<{ id: string; isOptedOut: boolean }>
  /** Lấy vị trí nội dung xoay vòng của data (aka_agent_engine_take_content_index_v1). */
  takeContentIndex(ctx: StepContext, actionCode: string, variantCount: number): Promise<number>
  /** Giờ nghiệp vụ của DB; chỉ gọi khi mẫu có #{TODAY(...)}, #{TOMORROW(...)}, #{YESTERDAY(...)}. */
  businessNow(ctx: StepContext): Promise<Date>
  /** Gửi chữ (thường, hoặc có định dạng { msg, styles }) tới người dùng (mặc định) hoặc nhóm Zalo. */
  sendText(ctx: StepContext, uid: string, message: ZaloOutgoingText, threadType?: 'user' | 'group'): Promise<{ response: unknown; msgId: string | null }>
  /**
   * Biến media đã chọn thành tệp gửi được (Desktop: đường dẫn trên máy / tải URL về máy; Fly: URL cho runtime tải).
   * Không dùng được tệp nào thì ném mediaUnavailableError (chưa gửi gì). Tài nguyên tạm dọn ở onTargetEnd của nơi chạy.
   */
  prepareMedia(ctx: StepContext, items: readonly CampaignMediaItem[]): Promise<ZaloMediaFile[]>
  /**
   * AI viết lại nội dung trước mỗi lần gửi (rewriteContentEachRun; mã AI fb_send_message_rewrite). Trả nội dung mới (đã bỏ khung
   * ```), ném lỗi kèm câu khi không dùng được; lõi in "⚠️ AI viết lại nội dung lỗi, dùng nội dung gốc: …" và gửi nội dung gốc.
   */
  rewriteMessage?(ctx: StepContext, content: string): Promise<string>
  /**
   * Gửi tệp (kèm chữ khi gửi chung một lần, message) tới người dùng / nhóm. stepKey: khoá chống gửi trùng của lệnh. mediaCacheKey /
   * releaseMediaCache: gửi dạng chia sẻ dùng chung tệp đã tải cho cả lô (runtime Fly; Desktop bỏ qua).
   */
  sendMedia(ctx: StepContext, input: { threadId: string; threadType: 'user' | 'group'; files: readonly ZaloMediaFile[];
    message?: ZaloOutgoingText; stepKey: string; mediaCacheKey?: string; releaseMediaCache?: boolean }): Promise<{ response: unknown; msgId: string | null }>
  sendFriendRequest(ctx: StepContext, uid: string, message: string): Promise<unknown>
  /** Ghi vết kỹ thuật (không hiện cho khách). */
  trace?(event: { type: string; [key: string]: unknown }): void
}

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
}

/**
 * Chiến dịch chạy được bằng bộ mới không. Tính năng nào chưa tách sang lõi thì chiến dịch chạy bộ cũ
 * (cùng bản cài), để không đổi hành vi của tính năng đó.
 */
export function zaloMessagePhoneV2Support(campaign: ZaloMessagePhoneCampaign, env: ZaloMessagePhoneEnvironment): V2Support {
  const extra = campaign.extraSettings
  const no = (reason: string): V2Support => ({ ok: false, reason })
  // Nhắn tin group: không có cổng từ chối nhận tin, loại trừ gửi, link từ chối, theo dõi tương tác hay kiêm SMS (Desktop không áp
  // cho nhóm); gửi dạng chia sẻ và Nhóm data đã chặn chung ở zaloCampaignV2Support.
  if (campaign.actionId === ZALO_MESSAGE_GROUP) {
    if (extra.zaloMessageSendMode === 'share' || extra.zaloShareRepeatEnabled === true) return no('share_mode')
    return { ok: true }
  }
  const uidType = uidStrangerType(campaign.actionId)
  if (campaign.actionId !== ZALO_MESSAGE_PHONE && !uidType) return no('action_not_supported')
  const messageOn = uidType?.friendMessage === true || extra.enableMessage === true
  if (!messageOn && extra.enableAddFriend !== true) return no('no_send_step')
  // Bạn bè "toàn bộ / theo tag", sinh nhật, đề xuất Zalo: lấy data đầu lượt (materialize.ts, V505).
  // Kiêm SMS (smsPush.ts): nội bộ chạy cả hai nơi (RPC V506); akaBiz Sms chỉ nơi có tích hợp (Desktop).
  if (extra.internalSmsEnabled !== true && extra.externalSmsEnabled === true && (!uidType || uidType.smsPush) && env.externalSmsPush !== true) {
    return no('sms_push_external')
  }
  // Sinh nhật bỏ qua gửi dạng chia sẻ (Desktop chạy gửi thường; chế độ đã lưu chỉ tắt link từ chối).
  if (extra.zaloMessageSendMode === 'share' && campaign.actionId !== ZALO_MESSAGE_BIRTHDAY) return no('share_mode')
  if (env.engagementTrackingEnabled && env.engagementSupported !== true) return no('engagement_tracking')
  return { ok: true }
}

/**
 * Luật kiểm cấu hình đầu lượt: nội dung nâng cao (CFG16), cấu hình loại trừ gửi (CFG18), tài khoản Zalo Web chỉ gửi ảnh (CFG10). Sai
 * thì DB tạm dừng chiến dịch một lần, data về hàng đợi.
 */
export function validateZaloMessagePhone(campaign: ZaloMessagePhoneCampaign, env: { zaloWeb: boolean }): ConfigIssue[] {
  const extra = campaign.extraSettings
  const formatted = extra.formattedContentEnabled === true && supportsFormattedContent(campaign.actionId)
  const advanced = advancedContentConfigIssue(extra, formatted)
  if (advanced) return [advanced]
  // Như lúc bắt đầu lượt của Desktop: cấu hình loại trừ gửi hỏng thì tạm dừng chiến dịch (CFG18).
  const exclusion = validateSendExclusionConfig(campaign)
  if (exclusion.length > 0) return exclusion
  // Danh sách không gửi tin kiểu cũ chưa chọn danh sách: CFG19.
  const blocklist = validateFriendBlocklistConfig(campaign)
  if (blocklist.length > 0) return blocklist
  const messageOn = campaign.actionId === ZALO_MESSAGE_GROUP || uidStrangerType(campaign.actionId)?.friendMessage === true
    || extra.enableMessage === true
  if (!env.zaloWeb || !messageOn) return []
  const media: CampaignMediaItem[] = extra.advancedContentEnabled === true
    ? advancedContentItems(extra).filter(item => item.mediaOption !== 'none').flatMap(item => item.mediaItems.filter(hasDeclaredMediaSource))
    : campaignDeclaresMedia(campaign) ? (campaign.images ?? []).filter(hasDeclaredMediaSource) : []
  return validateZaloContent({ zaloWeb: true, attachments: media.map(campaignMediaSourceHint).filter(Boolean) })
}

/**
 * Thao tác cho claim (preflight của Desktop): tra số bắt buộc; nhắn tin/kết bạn theo công tắc. "Tiếp tục khi chạm
 * giới hạn": hết lượt thì bỏ qua thao tác đó (đang bị khoá thì vẫn chờ); cả hai hết lượt thì không nhận data.
 */
export function zaloMessagePhoneClaimPlan(campaign: ZaloMessagePhoneCampaign): Pick<ClaimContext, 'actions' | 'requireAny'> {
  const extra = campaign.extraSettings
  // Nhắn tin bạn bè / group: một thao tác bắt buộc (hết lượt thì chờ, như preflight của Desktop).
  if (uidStrangerType(campaign.actionId)?.friendMessage) return { actions: [{ code: MESSAGE_FRIEND }] }
  if (campaign.actionId === ZALO_MESSAGE_GROUP) return { actions: [{ code: ZALO_MESSAGE_GROUP }] }
  const sendCodes = [
    ...(extra.enableMessage === true ? [MESSAGE_STRANGER] : []),
    ...(extra.enableAddFriend === true ? [ADD_FRIEND] : [])
  ]
  const canSkip = object(extra.actionLimits).continueWhenActionLimitReached === true
  // Loại theo UID không tra số: chỉ khoá/hạn mức của thao tác gửi (preflight của Desktop cho workflow 272/274).
  const actions: ClaimContext['actions'] = [
    ...(campaign.actionId === ZALO_MESSAGE_PHONE ? [{ code: FIND_PHONE }] : []),
    ...sendCodes.map(code => canSkip ? { code, required: false, skippableGates: ['quota'] } : { code })
  ]
  return { actions, ...(canSkip && sendCodes.length > 0 ? { requireAny: sendCodes } : {}) }
}

/** Như getInputDataDisplayName của Desktop cho chiến dịch theo SĐT: SĐT → tên → UID. */
export function zaloMessagePhoneTargetLabel(target: TargetRow): string {
  for (const value of [target.phone, target.name, target.uid]) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return 'N/A'
}

/** Như getInputDataDisplayName của Desktop cho chiến dịch theo UID (thành viên nhóm, khách cũ, bạn bè…): tên → UID → SĐT. */
export function zaloUidTargetLabel(target: TargetRow): string {
  for (const value of [target.name, target.uid, target.phone]) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return 'N/A'
}

/** Như getEffectiveSleepBetweenActions: nhóm tài khoản → actionLimits của chiến dịch → 0 (giây). */
export function sleepBetweenActionsSeconds(groupValue: unknown, actionLimits: unknown): number {
  const normalize = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined
    const parsed = Math.floor(Number(value))
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
  }
  return normalize(groupValue) ?? normalize(object(actionLimits).sleepBetweenActions) ?? 0
}

function resolvedTarget(ctx: StepContext): ZaloResolvedTarget {
  const target = ctx.state.zaloTarget as ZaloResolvedTarget | undefined
  if (!target?.uid) throw new Error('Thiếu hồ sơ Zalo từ bước xác định người nhận')
  return target
}

/**
 * account: tài khoản đang chạy (cấu hình tag theo tài khoản, tên trong câu tiến trình); thiếu thì lấy tài khoản của chiến dịch.
 * mediaStepTimeoutMs: hạn giờ bước gửi khi chiến dịch có tệp (tải tệp + 180 giây gửi tệp + 90 giây gửi chữ, theo nơi chạy).
 * random: bốc tệp ngẫu nhiên (imageOption 'random'); mặc định Math.random.
 */
export interface ZaloStepOptions {
  account?: ZaloAuxiliaryAccount
  mediaStepTimeoutMs?: number
  /** Hạn giờ bước nhắn tin khi không có tệp (mặc định của lượt nếu không truyền). */
  textStepTimeoutMs?: number
  /** Thời gian tối đa chờ AI viết lại (mặc định 300 giây); cộng vào hạn giờ bước nhắn tin khi bật AI. */
  aiRewriteTimeoutMs?: number
  random?: () => number
}

/** Như stripAiCodeFence của Desktop: bỏ khung ```text … ``` quanh câu trả lời của AI. */
export function stripAiCodeFence(value: string): string {
  const text = String(value || '').trim()
  const match = text.match(/^```(?:text|txt)?\s*([\s\S]*?)\s*```$/i)
  return match ? (match[1] ?? '').trim() : text
}

/** Như buildMessageOptOutSource của Desktop: chỉ thêm khoá messageOptOutSource khi dựng được (có link, global ID, giờ gửi). */
function optOutSourceData(linkId: string | null, target: ZaloResolvedTarget, contentSentAt: string | null): JsonObject {
  const source = linkId ? buildMessageOptOutSource(linkId, target, contentSentAt ?? new Date().toISOString()) : undefined
  return source ? { messageOptOutSource: source } : {}
}

/**
 * Tra SĐT (zaloFindPhoneUser / bước Tìm SĐT của workflow 260): reqSrc 32 rồi 40, lưu hồ sơ (danh bạ + tên/UID của data), dòng
 * `Đã tìm thấy SĐT …`. Dùng chung cho "Nhắn tin theo SĐT" và data chỉ có SĐT của "Thêm thành viên vào group".
 * `overrides`: điều kiện chạy riêng của loại (enabled, requires, onGateWait).
 */
export function buildZaloPhoneLookupStep(port: ZaloMessagePhonePort, overrides: Partial<Pick<EngineStep, 'enabled' | 'requires' | 'onGateWait'>> = {}): EngineStep {
  return {
    key: 'lookup',
    actionCode: FIND_PHONE,
    actionName: NAME_FIND,
    delivery: false,
    ...overrides,
    run: async ctx => {
      const phone = String(ctx.target.phone || '').trim()
      if (!phone) {
        // Desktop tự đặt mã 114: tín hiệu engine riêng, luật DB hiện ra đúng mã đó.
        return { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'target_missing_identity', message: 'SĐT Zalo không hợp lệ' },
          data: { phone } }
      }
      let search: { user: ZaloFoundUser | null; attempts: PhoneSearchAttempt[] }
      try {
        search = await searchZaloPhone(reqSrc => port.findUser(ctx, phone, reqSrc), code => port.phoneSearchLimitScope(code), ctx.signal)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        const attempts = (error as { searchPhoneAttempts?: PhoneSearchAttempt[] }).searchPhoneAttempts
        return zaloFailure(error, 'after_send', { phone, ...(attempts?.length ? { searchPhoneAttempts: attempts } : {}) })
      }
      const attemptData = search.attempts.length > 0 ? { searchPhoneAttempts: search.attempts } : {}
      if (!search.user) {
        // Desktop: chính sách "không tồn tại" (216) do app tự đặt khi Zalo không trả hồ sơ có UID.
        return { ok: false, phase: 'after_send', signal: { kind: 'engine', code: 'find_user_without_uid', message: 'Không tồn tại' },
          data: { phone, ...attemptData } }
      }
      const target = zaloTargetFromFoundUser(phone, search.user)
      try {
        await port.saveFoundUser(ctx, target, search.user)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        // Lỗi ghi DB của mình không đổi kết quả Zalo: tra số vẫn thành công (bất biến F1).
        port.trace?.({ type: 'save_found_user_failed', inputDataId: ctx.target.id, error: errorMessage(error) })
      }
      return {
        ok: true,
        customerLog: `Đã tìm thấy SĐT ${phone}: ${zaloTargetLabel(target)}`,
        data: { phone, target, ...attemptData },
        state: { zaloTarget: target }
      }
    }
  }
}

/**
 * Các bước của một data. Theo SĐT: tra số → cổng từ chối nhận tin → tag akaBiz → nhắn tin → kết bạn → tag Zalo → đổi tên
 * (workflow 260). Theo UID (thành viên nhóm, khách cũ; workflow 272/274): đọc hồ sơ theo UID → cổng từ chối nhận tin → lưu danh bạ
 * → tag akaBiz → nhắn tin → kết bạn → tag Zalo → đổi tên.
 */
export function buildZaloMessagePhoneSteps(campaign: ZaloMessagePhoneCampaign, port: ZaloMessagePhonePort,
  opts: ZaloStepOptions = {}): readonly EngineStep[] {
  const extra = campaign.extraSettings
  const inputData = (ctx: StepContext): JsonObject => ctx.target as unknown as JsonObject
  const uidType = uidStrangerType(campaign.actionId)
  const labelOf = uidType ? zaloUidTargetLabel : zaloMessagePhoneTargetLabel
  // Thao tác nhắn tin của loại: người lạ (SĐT, thành viên nhóm, khách cũ), bạn bè, hoặc group.
  const groupType = campaign.actionId === ZALO_MESSAGE_GROUP
  const messageAction = groupType ? ZALO_MESSAGE_GROUP : uidType?.messageAction ?? MESSAGE_STRANGER
  const messageName = groupType ? NAME_MESSAGE_GROUP : uidType?.messageName ?? NAME_MESSAGE
  const messageOn = groupType || uidType?.friendMessage === true || extra.enableMessage === true
  const threadType: 'user' | 'group' = groupType ? 'group' : 'user'
  // Link từ chối nhận tin (buildZaloOutgoingMessage): loại nhắn cá nhân, bật trong cấu hình, không gửi dạng chia sẻ.
  const linkEnabled = extra.zaloOptOutLinkEnabled === true
    && supportsStopMessagesLink(campaign.actionId, typeof extra.zaloMessageSendMode === 'string' ? extra.zaloMessageSendMode : undefined)
  // Loại trừ gửi chỉ khi loại có hỗ trợ và tài khoản chạy có cấu hình (supportsSendExclusion && hasSendExclusions).
  const exclusionOn = sendExclusionActive(campaign)
  // Danh sách không gửi tin kiểu cũ: nhắn bạn bè chưa có cấu hình loại trừ mới.
  const blocklistOn = friendBlocklistActive(campaign)

  /**
   * Chọn và dựng nội dung như prepareSelectedCampaignContent: biến thể bỏ dòng rỗng, chỉ lấy vị trí xoay vòng khi có
   * từ 2 biến thể. Lỗi lấy vị trí giữ lỗi gốc để phân loại (CampaignContentRotationError làm mất mã lỗi DB).
   */
  const prepare = async <C>(ctx: StepContext, actionCode: string, raw: unknown, build: (text: string) => Promise<C>,
    split: (raw: string) => string[] = text => splitContentVariants(text, { trim: false }).filter(item => item.trim())):
    Promise<{ ok: true; text: C; index: number } | { ok: false; cause: unknown }> => {
    const variants = split(String(raw ?? ''))
    let rotationCause: unknown = null
    try {
      const prepared = await prepareCampaignContent<never, C>({
        variantCount: variants.length,
        takeIndex: async count => {
          try {
            return await port.takeContentIndex(ctx, actionCode, count)
          } catch (error) {
            rotationCause = error
            throw error
          }
        },
        variant: index => ({ content: variants[index] ?? '', media: [] }),
        prepare: async variant => ({ content: await build(variant.content), media: [] }),
        signal: ctx.signal
      })
      return { ok: true, text: prepared.content, index: prepared.variantIndex }
    } catch (error) {
      if (ctx.signal.aborted) throw new CancelledError(`prepare:${actionCode}`)
      return { ok: false, cause: rotationCause ?? error }
    }
  }

  const lookup = buildZaloPhoneLookupStep(port)

  /**
   * Nhắn tin group (zaloSendGroupMessage): mục tiêu là ID group của data (giữ nguyên tiền tố "g" như Desktop gửi thường), không đọc
   * hồ sơ, không cổng từ chối nhận tin. Không có ID: Desktop tự đặt mã 114 (tín hiệu engine riêng, DB đổi ra DAT01).
   */
  const groupTarget: EngineStep = {
    key: 'target',
    actionCode: ZALO_MESSAGE_GROUP,
    actionName: NAME_MESSAGE_GROUP,
    delivery: false,
    gate: true,
    run: async ctx => {
      const groupId = String(ctx.target.uid || '').trim()
      if (!groupId) {
        return { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'target_missing_identity', message: 'ID group Zalo không hợp lệ' },
          data: { groupId } }
      }
      return { ok: true, state: { zaloTarget: zaloTargetFromInput(groupId, inputData(ctx), { type: 'group' }, false) } }
    }
  }

  /**
   * Loại theo UID: như preflightZaloMessageOptOut (CS:7364-7376) + resolveZaloFriendMessageTarget. Mục tiêu dựng từ data
   * (normalizeZaloTargetFromInputData với tham số mặc định: bộ nhớ đệm của cổng từ chối nhận tin mà helper resolve dùng lại) rồi ghép
   * hồ sơ đọc theo UID; đọc hồ sơ lỗi thì giữ mục tiêu từ data (cổng in "Không lấy được Zalo global ID…"). Không UID: Desktop tự đặt
   * mã 114 cho Nhắn tin người lạ (tín hiệu engine riêng, DB đổi ra mã).
   */
  const resolve: EngineStep = {
    key: 'resolve',
    actionCode: messageAction,
    actionName: messageName,
    delivery: false,
    gate: true,
    run: async ctx => {
      const uid = String(ctx.target.uid || '').trim()
      // Danh sách không gửi tin kiểu cũ: kiểm trước mọi lần đọc Zalo của data (như Desktop: trước từ chối nhận tin).
      if (blocklistOn) {
        const listed = await checkZaloFriendBlocklist(port, ctx, campaign, uid)
        if (listed.kind === 'blocked') return listed.outcome
      }
      if (!uid) {
        return { ok: false, phase: 'before_send',
          signal: { kind: 'engine', code: 'target_missing_identity', message: uidType?.missingUidText ?? 'UID người dùng Zalo không hợp lệ' },
          data: { uid } }
      }
      let target = zaloTargetFromInput(uid, inputData(ctx), {}, true)
      try {
        target = mergeZaloProfileTarget(target, await port.getUserProfile(ctx, uid))
      } catch (error) {
        // Đọc hồ sơ bị treo: Desktop không có hạn riêng, hạn bước cắt rồi data về hàng đợi (chưa gửi khi chưa kiểm được từ chối nhận
        // tin theo global ID). Cổng có hạn riêng (runtime Fly) báo DeadlineError để ra cùng kết quả; lỗi khác vẫn giữ mục tiêu từ data.
        if (ctx.signal.aborted || error instanceof DeadlineError) throw error
        port.trace?.({ type: 'get_user_profile_failed', inputDataId: ctx.target.id, error: errorMessage(error) })
      }
      return { ok: true, state: { zaloTarget: target } }
    }
  }

  // Lưu hồ sơ vào danh bạ sau cổng từ chối nhận tin, trước mọi lần gửi (zaloResolveGroupMemberTarget: upsert rồi tag akaBiz).
  const saveProfile: EngineStep = {
    key: 'save_profile',
    actionCode: messageAction,
    actionName: messageName,
    delivery: false,
    gate: true,
    requires: ['opt_out'],
    run: async ctx => {
      const target = resolvedTarget(ctx)
      const profile = object(object(target.raw).profile)
      if (Object.keys(profile).length === 0) return { ok: true }
      try {
        await port.saveResolvedProfile(ctx, target)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        // Lỗi ghi DB của mình không đổi kết quả (bất biến F1).
        port.trace?.({ type: 'save_resolved_profile_failed', inputDataId: ctx.target.id, error: errorMessage(error) })
      }
      return { ok: true }
    }
  }

  // Cổng từ chối nhận tin (gateResolvedPhoneMessageTarget): chặn cả nhắn tin lẫn kết bạn; lỗi kiểm thì vẫn gửi (on_error open).
  const optOut: EngineStep = {
    key: 'opt_out',
    actionCode: messageAction,
    actionName: messageName,
    delivery: false,
    gate: true,
    requires: [uidType ? 'resolve' : 'lookup'],
    run: async ctx => {
      const target = resolvedTarget(ctx)
      const label = labelOf(ctx.target)
      const warnings: string[] = []
      const closedOnError = ctx.gateSettings.opt_out?.onError === 'closed'
      let unavailable: string | null = null
      const check = async (identity: { phone?: string; globalId?: string }, by: string): Promise<boolean> => {
        try {
          return await port.isOptedOut(ctx, identity)
        } catch (error) {
          if (ctx.signal.aborted) throw error
          const message = errorMessage(error) || 'Lỗi không xác định'
          if (closedOnError) unavailable ??= `Không thể kiểm tra từ chối nhận tin Zalo theo ${by}: ${message}`
          else warnings.push(`Không thể kiểm tra từ chối nhận tin Zalo theo ${by}; vẫn tiếp tục gửi: ${message}`)
          return false
        }
      }
      // Desktop in cảnh báo sau dòng "Tìm SĐT" và trước dòng chặn.
      const flush = (): void => { for (const warning of warnings.splice(0)) ctx.progress(`⚠️ "${label}": ${warning}`) }
      const blocked = (): RawOutcome => {
        flush()
        return { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'recipient_opted_out', message: ZALO_MESSAGE_OPT_OUT_NOTE } }
      }
      // on_error closed (auto_engine_gates): không kiểm được thì không gửi, data chờ rồi chạy lại.
      const gateUnavailable = (): RawOutcome => {
        flush()
        return { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'gate_unavailable', message: unavailable ?? '' },
          data: { gate: 'opt_out' } }
      }

      const inputPhone = String(ctx.target.phone || '').trim()
      if (inputPhone && await check({ phone: inputPhone }, 'SĐT')) return blocked()
      if (unavailable) return gateUnavailable()
      const profilePhone = String(target.phone || '').trim()
      if (profilePhone && profilePhone !== inputPhone && await check({ phone: profilePhone }, 'SĐT hồ sơ')) return blocked()
      if (unavailable) return gateUnavailable()
      const globalId = String(target.globalId || '').trim()
      if (!globalId) {
        warnings.push('Không lấy được Zalo global ID; vẫn tiếp tục gửi, cá nhân hoá từ chối nhận tin (nếu có) dùng trang thông báo lỗi.')
      } else if (await check({ globalId }, 'Zalo global ID')) {
        return blocked()
      }
      if (unavailable) return gateUnavailable()
      // Loại trừ gửi (gateSendExclusion của Desktop): sau từ chối nhận tin, trước link từ chối; chặn cả nhắn tin lẫn kết bạn.
      if (exclusionOn) {
        const exclusion = await checkZaloSendExclusion(port, ctx, { campaign, uid: firstString(target.uid, ctx.target.uid) ?? '',
          profileTarget: exclusionProfileTarget(target, uidType !== null), labelContextRunId: ctx.targetRunId })
        if (exclusion.kind === 'blocked') { flush(); return exclusion.outcome }
        if (exclusion.warning) warnings.push(exclusion.warning)
      }
      // Như prepareZaloMessageOptOutLink: chỉ khi có global ID; người nhận đã từ chối thì chặn; tạo link lỗi thì cảnh báo và vẫn gửi
      // (cá nhân hoá từ chối nhận tin dùng trang thông báo lỗi).
      let optOutLinkId: string | null = null
      if (linkEnabled && globalId) {
        try {
          const prepared = await port.prepareOptOutLink(ctx, { globalId, phone: firstString(target.phone, ctx.target.phone) ?? null })
          if (prepared.isOptedOut) return blocked()
          optOutLinkId = prepared.id
        } catch (error) {
          if (ctx.signal.aborted) throw error
          warnings.push(`Không thể tạo link từ chối nhận tin Zalo; vẫn tiếp tục gửi, cá nhân hoá từ chối nhận tin (nếu có) dùng trang thông báo lỗi: ${errorMessage(error) || 'Lỗi không xác định'}`)
        }
      }
      flush()
      return { ok: true, ...(optOutLinkId ? { state: { optOutLinkId } } : {}) }
    }
  }

  // Như isFormattedContentCampaign / shouldUseAdvancedContent của Desktop (bước nhắn tin luôn dùng nội dung chính).
  const formatted = extra.formattedContentEnabled === true && supportsFormattedContent(campaign.actionId)
  const advanced = extra.advancedContentEnabled === true
  const hasMedia = advanced
    ? advancedContentItems(extra).some(item => item.mediaOption !== 'none' && item.mediaItems.some(hasDeclaredMediaSource))
    : campaignDeclaresMedia(campaign)
  // Như rewriteZaloMessageForRun: AI chỉ viết lại chữ thường (không áp cho nội dung định dạng).
  const rewrite = extra.rewriteContentEachRun === true && !formatted
  const aiBudgetMs = opts.aiRewriteTimeoutMs ?? 300_000
  const baseStepMs = hasMedia ? opts.mediaStepTimeoutMs : opts.textStepTimeoutMs
  const messageStepTimeoutMs = rewrite ? (baseStepMs ?? 150_000) + aiBudgetMs : baseStepMs
  const message: EngineStep = {
    key: 'message',
    actionCode: messageAction,
    actionName: messageName,
    delivery: true,
    requires: [groupType ? 'target' : 'opt_out'],
    enabled: () => messageOn,
    ...(messageStepTimeoutMs ? { timeoutMs: messageStepTimeoutMs } : {}),
    run: async ctx => {
      const target = resolvedTarget(ctx)
      // Như buildZaloOutgoingMessage: thay token link / thêm chân trang từ chối nhận tin khi bật (không bật thì xoá token, không chân
      // trang). Nội dung định dạng: dựng mẫu theo từng đoạn chữ của HTML (transformFormattedContentText) rồi đổi sang { msg, styles }.
      const linkId = linkEnabled ? (ctx.state.optOutLinkId as string | undefined) ?? null : null
      const build = async (raw: string): Promise<ZaloOutgoingText> => {
        const businessNow = templateUsesDatabaseDate(raw) ? await port.businessNow(ctx) : undefined
        const state: StopMessagesRenderState = { hasToken: false }
        const optOut = { linkId, enabled: linkEnabled, state }
        if (formatted) {
          const html = transformFormattedContentText(raw, text => renderZaloTemplateText(text, inputData(ctx), target, businessNow, optOut))
          return appendStopMessagesFooter(convertHtmlToZaloMessage(html), linkId, linkEnabled, state.hasToken)
        }
        const rendered = renderZaloTemplateText(raw, inputData(ctx), target, businessNow, optOut)
        const out = appendStopMessagesFooter(rendered, linkId, linkEnabled, state.hasToken)
        return typeof out === 'string' ? out : out.msg
      }
      // Nội dung nâng cao: mỗi mục là một biến thể (dấu | cấp ngoài giữ nguyên chữ), kể cả mục chỉ có tệp.
      const prepared = await prepare(ctx, messageAction, campaign.content, build,
        advanced ? () => advancedContentItems(extra).map(item => item.content) : formatted ? splitFormattedContentVariants : undefined)
      if (!prepared.ok) return preparationFailure(prepared.cause, { target })
      let message = prepared.text
      if (rewrite && typeof message === 'string' && message.trim()) {
        const original = message
        try {
          if (!port.rewriteMessage) throw new Error('Nơi chạy chưa hỗ trợ AI viết lại nội dung.')
          const rewriter = port.rewriteMessage
          const rewritten = stripAiCodeFence(await withDeadline('ai_rewrite', aiBudgetMs, ctx.signal, s => rewriter({ ...ctx, signal: s }, original.trim())))
          if (!rewritten) throw new Error('AI trả về nội dung không hợp lệ.')
          message = rewritten
        } catch (error) {
          if (ctx.signal.aborted) throw error
          const reason = error instanceof DeadlineError ? `AI không trả lời trong ${Math.round(aiBudgetMs / 1000)} giây.` : errorMessage(error)
          ctx.progress(`⚠️ AI viết lại nội dung lỗi, dùng nội dung gốc: ${reason}`)
        }
      }
      const text = outgoingText(message)
      // Như prepareSelectedCampaignContent: media chọn sau khi biết biến thể; nội dung nâng cao lấy tệp của đúng mục đó, nội dung
      // cơ bản không phụ thuộc biến thể.
      const media = advanced ? selectAdvancedContentMedia(selectAdvancedContentItem(extra, prepared.index), opts.random)
        : selectZaloCampaignMedia(campaign, opts.random)
      const data = { target, ...(groupType ? { groupId: target.uid } : {}), message, attachments: media.map(campaignMediaName) }
      let files: ZaloMediaFile[] = []
      if (media.length > 0) {
        try {
          files = await port.prepareMedia(ctx, media)
        } catch (error) {
          // Không dùng được tệp: chưa gửi gì (CFG01 do DB quyết định, như Fly; Desktop cũ ghi lỗi từng data).
          return zaloFailure(error, 'before_send', data)
        }
      }
      const plan = planZaloSend({ fileCount: files.length, hasText: text.trim() !== '', formatted })
      if (!text.trim() && files.length === 0) {
        // zca-js từ chối tin rỗng ("Missing message content") trước khi gọi Zalo; Desktop ghi như lỗi Zalo không mã.
        return { ok: false, phase: 'before_send', signal: { kind: 'engine', code: 'empty_content', message: 'Nội dung tin nhắn rỗng' }, data }
      }
      let firstMsgId: string | null = null
      let lastResponse: unknown = null
      let contentSentAt: string | null = null
      const responses: unknown[] = []
      // Theo dõi tương tác (nhắn người lạ / bạn bè, không áp cho group): giữ chỗ ngay trước khi gửi như beginCampaignEngagementSend của
      // Desktop; gửi lỗi hay chỉ tới một phần thì bỏ (abandonCampaignEngagementSend).
      const engagement = groupType ? null : beginZaloEngagement(port, ctx, target.uid, 'message')
      try {
        for (const [index, call] of plan.calls.entries()) {
          try {
            const sent = call.kind === 'text'
              ? await (groupType ? port.sendText(ctx, target.uid, message, 'group') : port.sendText(ctx, target.uid, message))
              : await port.sendMedia(ctx, { threadId: target.uid, threadType, files, stepKey: call.stepKey,
                  ...(call.kind === 'combined' && text.trim() ? { message } : {}) })
            if (index === 0) firstMsgId = sent.msgId
            lastResponse = sent.response
            responses.push(sent.response)
            if (call.kind !== 'media') contentSentAt = new Date().toISOString()
          } catch (error) {
            if (index === 0) return zaloFailure(error, 'after_send', { ...data, sequence: plan.sequence })
            if (!(error instanceof ZaloPortError)) throw error
            // Lần gửi thứ hai lỗi sau khi lần đầu đã tới (finalizeZaloPartialSendDetail): giao một phần, không gửi lại.
            const stage = plan.sequence === 'media_then_content' ? 'content_after_media' : 'media_after_content'
            return {
              ok: false, phase: error.phase ?? 'after_send', signal: error.signal,
              evidence: { ...(error.evidence ?? {}), partialDelivery: true, partialStage: stage, sequence: plan.sequence, msgId: firstMsgId },
              data: { ...data, sequence: plan.sequence, partialSend: { stage, sequence: plan.sequence, response: responses[0] ?? null,
                error: error.message, mediaTimeout: error.code === 'campaign_media_timeout' } }
            }
          }
        }
        return {
          ok: true,
          customerLog: groupType ? `Đã gửi tin nhắn vào group ${zaloTargetLabel(target)}` : `Đã gửi tin nhắn đến ${zaloTargetLabel(target)}`,
          // Zalo có lúc trả thành công mà không có msgId: vẫn là "đã gửi" như Desktop, ghi lại để đối soát.
          evidence: { msgId: firstMsgId },
          data: { ...data, ...(files.length > 0 ? { sequence: plan.sequence } : {}),
            response: plan.calls.length > 1 ? { sequence: plan.sequence, responses } : lastResponse,
            // Trigger trg_capture_message_opt_out_source ghi nguồn của link từ chối từ trường này; không có link thì không có khoá (như Desktop).
            ...optOutSourceData(linkId, target, contentSentAt),
            // Nguồn theo dõi tương tác (zaloEngagementSource + dòng chờ đăng ký) như dòng lịch sử của bộ chạy cũ.
            ...(engagement?.finish(responses) ?? {}) }
        }
      } finally {
        engagement?.abandon()
      }
    }
  }

  const friend: EngineStep = {
    key: 'friend',
    actionCode: ADD_FRIEND,
    actionName: NAME_FRIEND,
    delivery: true,
    requires: ['opt_out'],
    enabled: () => extra.enableAddFriend === true,
    run: async ctx => {
      const target = resolvedTarget(ctx)
      // Như zaloSendPhoneFriendRequest: dựng mẫu không có link từ chối, cắt 150 ký tự.
      const build = async (raw: string): Promise<string> => {
        const businessNow = templateUsesDatabaseDate(raw) ? await port.businessNow(ctx) : undefined
        return renderZaloTemplateText(raw, inputData(ctx), target, businessNow).slice(0, FRIEND_REQUEST_MAX_LENGTH)
      }
      const prepared = await prepare(ctx, ADD_FRIEND, extra.friendRequestMessage, build)
      if (!prepared.ok) return preparationFailure(prepared.cause, { target })
      const data = { target, message: prepared.text }
      // Theo dõi đồng ý kết bạn như bộ chạy cũ (nguồn friend_request, không có mã tin).
      const engagement = beginZaloEngagement(port, ctx, target.uid, 'friend_request')
      try {
        const response = await port.sendFriendRequest(ctx, target.uid, prepared.text)
        return {
          ok: true,
          statusCode: 'campaign_detail_success',
          customerLog: `Đã gửi lời mời kết bạn đến ${zaloTargetLabel(target)}`,
          data: { ...data, response: response ?? null, ...engagement.finish(null) }
        }
      } catch (error) {
        return zaloFailure(error, 'after_send', data)
      } finally {
        engagement.abandon()
      }
    }
  }

  // Như workflow 260 / 272 / 274 của Desktop: xác định người nhận → (cổng) → tag akaBiz trước khi gửi → nhắn tin → kết bạn
  // → gắn tag → đổi tên.
  const account = opts.account ?? { id: campaign.accountId, name: '' }
  if (groupType) {
    // Workflow 268: nhắn tin rồi tag akaBiz loại group CHỈ khi gửi thành công (applyAkaBizTagsToZaloTarget sau dispatch);
    // không tag Zalo / đổi tên (workflow không có hai bước này, kể cả khi extra_settings còn cờ).
    const groupAkaBiz = buildAkaBizTagStep(campaign, port, { requires: ['message'], contactType: 'group', actionCode: ZALO_MESSAGE_GROUP })
    return [groupTarget, message, groupAkaBiz]
  }
  const akaBiz = buildAkaBizTagStep(campaign, port, { requires: ['opt_out'], contactType: 'person', actionCode: messageAction })
  const front = uidType ? [resolve, optOut, saveProfile] : [lookup, optOut]
  // Bạn bè (workflow 266) không có bước kết bạn.
  const sends = uidType?.friendMessage ? [message] : [message, friend]
  // Sinh nhật (workflow 270) không có bước tag Zalo / đổi tên, kể cả khi extra_settings còn cờ.
  const auxiliary = campaign.actionId === ZALO_MESSAGE_BIRTHDAY ? [] : buildZaloAuxiliarySteps(campaign, port, { requires: ['opt_out'], account })
  return [...front, akaBiz, ...sends, ...auxiliary]
}
