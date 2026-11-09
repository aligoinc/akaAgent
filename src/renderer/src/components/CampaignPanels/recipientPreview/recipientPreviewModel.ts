import { getAdvancedContentItems } from '../../../../../shared/advancedContent'
import {
  RECIPIENT_MESSAGE_OR_FRIEND_ACTIONS,
  recipientPreviewChannel,
  type RecipientChannel,
  type RecipientPreviewScreenModel,
  type RecipientPreviewSource,
  type RecipientRenderContext,
  type RecipientSampleGender,
  type RecipientScreen,
  type RecipientViewMode,
} from '../../../../../shared/recipientPreview'
import { smsRenderBaseDate } from '../../../../../shared/smsRecipientContent'
import type { CampaignConfig, CampaignInputData } from '../../../../../shared/types'
import { supportsStopMessagesLink } from '../../../../../shared/zaloMessageOptOut'

export interface RecipientSender {
  id: number
  name: string
  phone?: string | null
  /** Tài khoản Zalo chạy trên trình duyệt của app: chỉ gửi được ảnh. */
  zaloWeb: boolean
}

/** Dữ liệu form đưa vào khung "Khách sẽ nhận". Không có field nào đi vào nháp hay dữ liệu lưu. */
export interface RecipientPreviewInput {
  source: RecipientPreviewSource
  /** Data đang có trong form (nhập tay, dán, import, hoặc data đã tải khi sửa/nhân bản). Không tải thêm. */
  rows: Partial<CampaignInputData>[]
  senders: RecipientSender[]
  /** Ngày bắt đầu của Lịch chạy (ISO). */
  sendDateIso: string | null
  /** Khách lấy khi chạy (nhóm data, bạn bè, realtime, gợi ý kết bạn): không có dòng data trong form. */
  liveSource: boolean
  /** Sửa chiến dịch đã chạy: dòng đã gửi có vị trí xoay vòng riêng. */
  savedRows: boolean
}

export interface RecipientViewState {
  mode: RecipientViewMode
  rowIndex: number
  gender: RecipientSampleGender
  longName: boolean
  seed: number
  mediaSeed: number
}

export const DEFAULT_RECIPIENT_VIEW: RecipientViewState = { mode: 'sample', rowIndex: 0, gender: 'female', longName: false, seed: 0, mediaSeed: 0 }

export interface RecipientPreviewFocus {
  screen: RecipientScreen
  version?: number
  nonce: number
}

export interface RecipientCaret {
  version: number
  nonce: number
}

/**
 * Phiên bản con trỏ đang đứng trong ô nội dung. Giữ ngoài state của form (17k dòng) để di chuyển con trỏ
 * không vẽ lại form; chỉ khung xem trước đăng ký, và chỉ báo khi con trỏ sang phiên bản khác.
 */
export interface RecipientCaretStore {
  subscribe: (listener: () => void) => () => void
  get: () => RecipientCaret | null
  set: (version: number) => void
}

export function createRecipientCaretStore(): RecipientCaretStore {
  let caret: RecipientCaret | null = null
  let nonce = 0
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    get: () => caret,
    set: (version) => {
      if (caret?.version === version) return
      nonce += 1
      caret = { version, nonce }
      listeners.forEach((listener) => listener())
    },
  }
}

export const MAX_RECIPIENT_ROW_OPTIONS = 50

export const recipientShareMode = (source: RecipientPreviewSource): boolean =>
  source.zaloMessageSendMode === 'share' && (source.actionCode === 'zalo_message_friend' || source.actionCode === 'zalo_message_group')

export const recipientIsStranger = (source: RecipientPreviewSource): boolean =>
  RECIPIENT_MESSAGE_OR_FRIEND_ACTIONS.has(source.actionCode)

export function recipientRenderContext(input: RecipientPreviewInput, view: RecipientViewState, today: Date): RecipientRenderContext {
  const channel = recipientPreviewChannel(input.source.actionCode) || 'zalo'
  const scheduled = input.sendDateIso ? new Date(input.sendDateIso) : null
  const zaloSendDate = scheduled && !Number.isNaN(scheduled.getTime()) && scheduled.getTime() > today.getTime() ? scheduled : today
  const row = view.mode === 'row' ? input.rows[view.rowIndex] || null : null
  return {
    channel,
    mode: view.mode === 'row' && !row ? 'sample' : view.mode,
    gender: view.gender,
    longName: view.longName,
    row,
    share: recipientShareMode(input.source),
    optOutEnabled: input.source.zaloOptOutLinkEnabled
      && supportsStopMessagesLink(input.source.actionCode, input.source.zaloMessageSendMode),
    smsUseUnicode: input.source.smsUseUnicode,
    smsKeepNewLines: input.source.smsKeepNewLines,
    now: zaloSendDate,
    smsBaseDate: smsRenderBaseDate(input.sendDateIso),
    seed: view.seed,
    mediaSeed: view.mediaSeed,
  }
}

export const recipientChannelLabel = (channel: RecipientChannel, share: boolean): string => {
  const base = channel === 'sms' ? 'SMS' : channel === 'voice' ? 'Cuộc gọi tự động' : channel === 'zalo_group' ? 'Group Zalo' : 'Zalo cá nhân'
  return share ? `${base} · Chia sẻ` : base
}

export const recipientScreenLabel = (screen: RecipientScreen, channel: RecipientChannel): string =>
  screen === 'friend_request' ? 'Lời mời kết bạn' : channel === 'sms' ? 'Tin nhắn SMS' : channel === 'voice' ? 'Cuộc gọi' : 'Tin nhắn'

export const recipientVersionLabel = (screen: RecipientScreen, index: number): string =>
  screen === 'friend_request' ? `Lời mời ${index + 1}` : `Nội dung ${index + 1}`

export const recipientRowLabel = (row: Partial<CampaignInputData>, index: number): string => {
  const who = [row.name, row.phone, row.uid, row.email].map((value) => String(value ?? '').trim()).find(Boolean) || `Dòng ${index + 1}`
  return `Dòng ${index + 1} · ${who}`
}

export const recipientSequenceLabel = (sequence: string, mediaCount: number, share: boolean): string => {
  if (sequence === 'media_then_content') return `${share ? 'Mỗi người' : 'Khách'} nhận ${mediaCount} media trước, rồi tới chữ.`
  if (sequence === 'content_then_media') return 'Khách nhận chữ trước, rồi tới media.'
  if (sequence === 'combined') return 'Media và chữ đi chung một tin.'
  if (sequence === 'media_only') return 'Khách chỉ nhận media.'
  return ''
}

const positiveCount = (value: unknown, fallback: number) => {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * Cấu hình chiến dịch đã lưu → dữ liệu xem trước (tab Preview nội dung). Chỉ đọc cấu hình đã có, không tải thêm.
 * Mặc định theo đúng runtime Desktop (`campaignScheduler.ts`): `enableMessage`/`enableAddFriend` thiếu là tắt,
 * `imageOption` thiếu là gửi đủ, `randomImageCount` thiếu là 3.
 */
export function recipientSourceFromCampaign(campaign: Pick<CampaignConfig, 'actionId' | 'content' | 'extraSettings' | 'images'>): RecipientPreviewSource {
  const extra = campaign.extraSettings || {}
  const actionCode = campaign.actionId || ''
  return {
    actionCode,
    enableMessage: extra.enableMessage === true,
    enableAddFriend: extra.enableAddFriend === true,
    friendRequestMessage: extra.friendRequestMessage || '',
    zaloMessageSendMode: extra.zaloMessageSendMode === 'share' ? 'share' : 'normal',
    formattedContentEnabled: extra.formattedContentEnabled === true,
    zaloOptOutLinkEnabled: extra.zaloOptOutLinkEnabled === true,
    smsUseUnicode: extra.smsUseUnicode === true,
    smsKeepNewLines: extra.smsKeepNewLines === true,
    rewriteContentEachRun: extra.rewriteContentEachRun === true,
    advanced: actionCode !== 'voice_call' && extra.advancedContentEnabled === true,
    advancedContentSource: extra.advancedContentSource === 'group_snapshot' ? 'group_snapshot' : 'manual',
    content: campaign.content || '',
    advancedItems: getAdvancedContentItems(extra),
    media: Array.isArray(campaign.images) ? campaign.images : [],
    mediaOption: extra.imageOption === 'none' || extra.imageOption === 'random' ? extra.imageOption : 'all',
    randomCount: positiveCount(extra.randomImageCount, 3),
  }
}

/**
 * Số phiên bản khách có thể nhận (tin nhắn + lời mời kết bạn); 0 khi không có gì để gửi.
 * Lời mời không kèm lời nhắn vẫn là một màn khách thấy; tin nhắn cần chữ hoặc media.
 */
export const recipientVersionTotal = (screens: RecipientPreviewScreenModel[]): number => {
  const hasContent = screens.some((item) => item.screen === 'friend_request'
    || item.versions.some((version) => version.hasText || (version.media.option !== 'none' && version.media.pool.length > 0)))
  return hasContent ? screens.reduce((sum, item) => sum + item.versions.length, 0) : 0
}
