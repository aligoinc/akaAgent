import {
  STOP_MESSAGES_CHECKBOX_ERROR,
  STOP_MESSAGES_LINK_TOKEN,
  STOP_MESSAGES_PREVIEW_ID,
  buildStopMessagesLink,
  supportsStopMessagesLink,
} from './zaloMessageOptOut'
import type { CampaignAdvancedContentItem, CampaignInputData, CampaignMediaInput } from './types'
import { countContentSpinOptions, findContentVariantSeparatorIndexes, renderContentSpin, renderContentSpinMax, seededRandom, splitContentVariants } from './contentSpin'
import {
  appendFormattedPreviewFooter,
  escapeFormattedContentText,
  formattedContentToPlainText,
  formattedContentToZaloPreviewHtml,
  splitFormattedContentVariants,
  supportsFormattedContent,
  transformFormattedContentTextNodes,
} from './formattedContent'
import { normalizeVietnamMobilePhone } from './phone'
import { normalizeSmsContentForSend } from './smsContent'
import { formatSmsTemplateDate, smsRecipientVariantIndex } from './smsRecipientContent'
import { VOICE_CALL_AI_DISCLOSURE, getVoiceCallContentValidationError } from './voiceCall'

/**
 * Mô hình "Khách sẽ nhận" của form chiến dịch (docs/CAMPAIGN_RECIPIENT_PREVIEW.md).
 * Thuần TypeScript, không React, không I/O: chỉ đọc state form. Luật lấy từ runtime gửi thật
 * (`campaignScheduler.ts`, Chat API `zaloCampaignExecutor.ts`, `smsContent.ts` `renderSmsInputContent`).
 *
 * Chép theo akaAgentWebApp `packages/campaign-core/src/recipientPreview.ts` (sửa luật ở WebApp trước rồi chép
 * lại). Khác bản WebApp đúng ba điểm: API spin dạng options của Desktop; media nhận `CampaignMediaInput`
 * (chuỗi hoặc snapshot, file trên máy này xem được nên có `localPath` và không có cảnh báo
 * `desktop_local_media`); tài khoản Zalo trình duyệt cũng xét đuôi file trên máy.
 */
type CampaignActionCode = string
type CampaignDataInput = Partial<CampaignInputData>
type CampaignMedia = CampaignMediaInput

export type RecipientChannel = 'zalo' | 'zalo_group' | 'sms' | 'voice'
export type RecipientScreen = 'message' | 'friend_request'
export type RecipientViewMode = 'sample' | 'raw' | 'row'
export type RecipientSampleGender = 'female' | 'male' | 'unknown'
export type RecipientMediaOption = 'none' | 'all' | 'random'
export type RecipientSendSequence = 'content_only' | 'combined' | 'media_then_content' | 'content_then_media' | 'media_only'

/** Hành động nhắn tin + kết bạn (bật/tắt từng bước trong Tuỳ chọn hành động). */
export const RECIPIENT_MESSAGE_OR_FRIEND_ACTIONS: ReadonlySet<string> = new Set([
  'zalo_message_phone',
  'zalo_message_group_member',
  'zalo_message_group_realtime',
  'zalo_message_remarketing_customer',
  'zalo_message_friend_recommendation',
])

export const FRIEND_REQUEST_MAX_LENGTH = 150

export const RECIPIENT_SAMPLE = {
  displayName: 'Nguyễn Minh Anh',
  originalName: 'Minh Anh',
  longDisplayName: 'Nguyễn Hoàng Thị Thanh Hương',
  longOriginalName: 'Hoàng Thị Thanh Hương',
  groupName: 'Nhóm khách hàng VIP',
  row: {
    name: 'Trần Quốc Bảo',
    phone: '0987654321',
    email: 'bao@example.com',
    uid: '100012345678901',
    info1: 'Khách VIP',
    info2: 'Quận 1',
    info3: 'Quan tâm sản phẩm A',
    info4: 'Nguồn Facebook',
    info5: 'Hẹn tư vấn chiều nay',
  } satisfies CampaignDataInput,
} as const

export interface RecipientPreviewMedia {
  key: string
  name: string
  url: string | null
  kind: 'image' | 'video' | 'file'
  /** Đường dẫn file trên máy (renderer đọc ảnh qua IPC `readCampaignPreviewFileDataUrl`). */
  localPath: string | null
  /** Chỉ có trên máy này, chưa có URL cloud. */
  localOnly: boolean
  mimeType: string | null
  sizeBytes: number | null
}

/** State form cần cho bản xem trước. Không có field nào đi vào nháp hay dữ liệu lưu. */
export interface RecipientPreviewSource {
  actionCode: CampaignActionCode | ''
  enableMessage: boolean
  enableAddFriend: boolean
  friendRequestMessage: string
  zaloMessageSendMode: 'normal' | 'share'
  formattedContentEnabled: boolean
  zaloOptOutLinkEnabled: boolean
  smsUseUnicode: boolean
  smsKeepNewLines: boolean
  rewriteContentEachRun: boolean
  advanced: boolean
  advancedContentSource?: 'manual' | 'group_snapshot'
  content: string
  advancedItems: CampaignAdvancedContentItem[]
  media: CampaignMedia[]
  mediaOption: RecipientMediaOption
  randomCount: number
}

export interface RecipientVersion {
  index: number
  raw: string
  formatted: boolean
  hasText: boolean
  media: { option: RecipientMediaOption; pool: RecipientPreviewMedia[]; randomCount: number }
  origin: { kind: 'basic' | 'advanced' | 'group'; templateName?: string; templateVariant?: number }
  spinOptions: number
}

export interface RecipientPreviewScreenModel {
  screen: RecipientScreen
  versions: RecipientVersion[]
}

export interface RecipientTextPart {
  text: string
  kind: 'text' | 'token' | 'link' | 'disclosure' | 'cut'
  /** filled: đã điền giá trị; runtime: điền lúc gửi; empty: data trống; unknown: biến lạ; raw: đang giữ nguyên biến; unrendered: chia sẻ không điền. */
  state?: 'filled' | 'runtime' | 'empty' | 'unknown' | 'raw' | 'unrendered'
  token?: string
  label?: string
}

export type RecipientBubble =
  | { kind: 'text'; parts: RecipientTextPart[] }
  | { kind: 'rich'; html: string }
  | { kind: 'media'; media: RecipientPreviewMedia[]; caption?: RecipientBubble }

export interface RecipientRenderContext {
  channel: RecipientChannel
  mode: RecipientViewMode
  gender: RecipientSampleGender
  longName?: boolean
  row?: CampaignDataInput | null
  share: boolean
  /** Đã tính `supportsStopMessagesLink` và tuỳ chọn "Thêm link từ chối nhận tin". */
  optOutEnabled: boolean
  smsUseUnicode: boolean
  smsKeepNewLines: boolean
  /** Ngày gửi dự kiến cho Zalo (đồng hồ DB khi chạy thật). */
  now: Date
  /** API tính ngày SMS theo Lịch chạy. */
  smsBaseDate: Date
  seed: number
  /** Hạt giống riêng cho media ngẫu nhiên (nút Đổi media); thiếu thì dùng `seed`. */
  mediaSeed?: number
}

export interface RecipientRenderedMessage {
  sequence: RecipientSendSequence
  bubbles: RecipientBubble[]
  media: RecipientPreviewMedia[]
  chars: number
  smsSegments?: number
  smsUnicode?: boolean
  hasText: boolean
}

export interface RecipientRenderedFriendRequest {
  parts: RecipientTextPart[]
  /** Độ dài sau khi điền; null khi còn biến điền lúc gửi (không đo được). */
  length: number | null
  cut: boolean
}

export interface RecipientWarning {
  code: string
  level: 'warn' | 'info'
  text: string
  target: { section: 'content' | 'actionOptions' | 'details'; screen: RecipientScreen; version?: number }
}

const IMAGE_EXTENSION = /\.(apng|avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i
const VIDEO_EXTENSION = /\.(m4v|mov|mp4|webm)(?:[?#].*)?$/i
const VIETNAMESE_DIACRITIC = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i
const TOKEN_PATTERN = /#\{(TODAY|TOMORROW|YESTERDAY)\(([^}]*)\)\}|#\{SEX\{([^}]*)\}\}|#\{([A-Za-z0-9_]+)\}|#\{[^{}]*\}/g
const ROW_TOKENS: Record<string, keyof CampaignDataInput> = {
  INPUT_FULLNAME: 'name', UID: 'uid', EMAIL: 'email', PHONE: 'phone', MOBILE: 'phone',
  INFO1: 'info1', INFO2: 'info2', INFO3: 'info3', INFO4: 'info4', INFO5: 'info5',
}
const TOKEN_LABELS: Record<string, string> = {
  FULL_NAME: 'Tên Zalo', ORIGINAL_NAME: 'Tên gốc Zalo', INPUT_FULLNAME: 'Tên trong data', UID: 'UID',
  EMAIL: 'Email', PHONE: 'SĐT', MOBILE: 'SĐT', INFO1: 'INFO1', INFO2: 'INFO2', INFO3: 'INFO3',
  INFO4: 'INFO4', INFO5: 'INFO5', SEX: 'Xưng hô', TODAY: 'Hôm nay', TOMORROW: 'Ngày mai',
  YESTERDAY: 'Hôm qua', STOP_MESSAGES_LINK: 'Link từ chối nhận tin',
}
/** Biến đơn runtime thay; `#{SEX}` hay `#{TODAY}` thiếu tham số thì runtime giữ nguyên chữ. */
const SIMPLE_TOKENS = new Set([
  'FULL_NAME', 'ORIGINAL_NAME', 'INPUT_FULLNAME', 'UID', 'PHONE', 'MOBILE', 'EMAIL',
  'INFO1', 'INFO2', 'INFO3', 'INFO4', 'INFO5', 'STOP_MESSAGES_LINK',
])
const tokenKey = (match: RegExpMatchArray): string => {
  if (match[1]) return match[1]
  if (match[3] !== undefined) return 'SEX'
  return match[4] && SIMPLE_TOKENS.has(match[4]) ? match[4] : ''
}
const labelFor = (key: string, channel: RecipientChannel): string => {
  if (key === 'FULL_NAME' || key === 'ORIGINAL_NAME') {
    if (channel === 'sms' || channel === 'voice') return 'Tên'
    if (channel === 'zalo_group') return 'Tên group'
  }
  return TOKEN_LABELS[key] || key
}
// Ký tự vùng riêng (Private Use) làm chỗ giữ biến khi dựng HTML; không thể có trong nội dung đã sanitize.
const MARKER_START = '\uE000'
const MARKER_END = '\uE001'
const MARKER_PATTERN = /\uE000(\d+)\uE001/g

export function recipientPreviewChannel(actionCode: string | null | undefined): RecipientChannel | null {
  if (actionCode === 'sms_send') return 'sms'
  if (actionCode === 'voice_call') return 'voice'
  if (actionCode === 'zalo_message_group') return 'zalo_group'
  return String(actionCode || '').startsWith('zalo_message_') ? 'zalo' : null
}

const isRemoteMediaPath = (value: string): boolean => /^https?:\/\//i.test(value) || /^data:(image|video)\//i.test(value)

export function recipientPreviewMedia(item: CampaignMedia, index = 0): RecipientPreviewMedia | null {
  const snapshot = typeof item === 'string' ? null : item
  const raw = typeof item === 'string' ? item.trim() : ''
  const cloud = String(snapshot?.cloudUrl || (raw && isRemoteMediaPath(raw) ? raw : '')).trim()
  const url = isRemoteMediaPath(cloud) ? cloud : null
  const localPath = String(snapshot?.localPath || (raw && !isRemoteMediaPath(raw) ? raw : '')).trim()
  if (!url && !localPath) return null
  const mimeType = snapshot?.mimeType ? String(snapshot.mimeType).toLowerCase() : null
  const path = (url || localPath).split(/[?#]/)[0] || ''
  const fileName = path.split(/[\\/]/).pop() || ''
  const kind: RecipientPreviewMedia['kind'] = mimeType?.startsWith('image/') || /^data:image\//i.test(cloud) || IMAGE_EXTENSION.test(path)
    ? 'image'
    : mimeType?.startsWith('video/') || /^data:video\//i.test(cloud) || VIDEO_EXTENSION.test(path)
      ? 'video'
      : !mimeType && url && !/\.[a-z0-9]+$/i.test(fileName) ? 'image' : 'file'
  return {
    key: `${index}:${url || localPath}`,
    name: String(snapshot?.name || '').trim() || (url?.startsWith('data:') ? 'Ảnh' : fileName) || 'File',
    url,
    kind,
    localPath: localPath || null,
    localOnly: !url,
    mimeType,
    sizeBytes: typeof snapshot?.sizeBytes === 'number' ? snapshot.sizeBytes : null,
  }
}

const mediaPool = (items: CampaignMedia[] | undefined): RecipientPreviewMedia[] =>
  (Array.isArray(items) ? items : []).flatMap((item, index) => {
    const media = recipientPreviewMedia(item, index)
    return media ? [media] : []
  })

const normalizeMediaOption = (value: unknown): RecipientMediaOption =>
  value === 'none' || value === 'random' ? value : 'all'

const randomMediaCount = (value: unknown): number => Math.max(1, Math.floor(Number(value) || 3))

const plainHasText = (value: string, formatted: boolean) =>
  formatted ? formattedContentToPlainText(value).trim().length > 0 : value.trim().length > 0

/** Khách nhận các bước nào, theo đúng thứ tự gửi (tin nhắn trước, lời mời sau). */
export function recipientPreviewScreens(source: RecipientPreviewSource): RecipientPreviewScreenModel[] {
  const channel = recipientPreviewChannel(source.actionCode)
  if (!channel) return []
  const messageOrFriend = RECIPIENT_MESSAGE_OR_FRIEND_ACTIONS.has(source.actionCode)
  const screens: RecipientPreviewScreenModel[] = []
  if (!messageOrFriend || source.enableMessage) screens.push({ screen: 'message', versions: recipientMessageVersions(source) })
  if (messageOrFriend && source.enableAddFriend) screens.push({ screen: 'friend_request', versions: recipientFriendRequestVersions(source) })
  return screens
}

export function recipientMessageVersions(source: RecipientPreviewSource): RecipientVersion[] {
  const channel = recipientPreviewChannel(source.actionCode)
  if (!channel) return []
  const mobile = channel === 'sms' || channel === 'voice'
  const formatted = !mobile && supportsFormattedContent(source.actionCode) && source.formattedContentEnabled
  const noMedia = { option: 'none' as const, pool: [] as RecipientPreviewMedia[], randomCount: 3 }
  if (source.advanced && channel !== 'voice') {
    const group = source.advancedContentSource === 'group_snapshot'
    return source.advancedItems.map((item, index) => {
      const raw = String(item?.content ?? '')
      return {
        index,
        raw,
        formatted,
        hasText: plainHasText(raw, formatted),
        media: mobile ? noMedia : {
          // Runtime coi mục nâng cao thiếu tuỳ chọn là không gửi media (`mediaOption || 'none'`).
          option: item.mediaOption === 'all' || item.mediaOption === 'random' ? item.mediaOption : 'none',
          pool: mediaPool(item.mediaItems),
          randomCount: randomMediaCount(item.randomMediaCount),
        },
        origin: { kind: group ? 'group' : 'advanced', templateName: item.sourceTemplateName, templateVariant: item.sourceVariantIndex },
        spinOptions: countContentSpinOptions(formatted ? formattedContentToPlainText(raw) : raw),
      }
    })
  }
  const texts = formatted ? splitFormattedContentVariants(source.content) : splitContentVariants(source.content, { trim: true })
  const media = mobile ? noMedia : {
    option: normalizeMediaOption(source.mediaOption),
    pool: mediaPool(source.media),
    randomCount: randomMediaCount(source.randomCount),
  }
  return (texts.length ? texts : ['']).map((raw, index) => ({
    index,
    raw,
    formatted,
    hasText: plainHasText(raw, formatted),
    media,
    origin: { kind: 'basic' },
    spinOptions: countContentSpinOptions(formatted ? formattedContentToPlainText(raw) : raw),
  }))
}

export function recipientFriendRequestVersions(source: RecipientPreviewSource): RecipientVersion[] {
  const texts = splitContentVariants(source.friendRequestMessage, { trim: true })
  return (texts.length ? texts : ['']).map((raw, index) => ({
    index,
    raw,
    formatted: false,
    hasText: raw.trim().length > 0,
    media: { option: 'none', pool: [], randomCount: 3 },
    origin: { kind: 'basic' },
    spinOptions: countContentSpinOptions(raw),
  }))
}

/** Như runtime: không gửi / gửi đủ theo thứ tự / xáo rồi lấy N. Bản xem trước xáo theo hạt giống. */
export function selectRecipientMedia(media: RecipientVersion['media'], seed = 0): RecipientPreviewMedia[] {
  if (media.option === 'none') return []
  if (media.option !== 'random') return media.pool
  const shuffled = [...media.pool]
  const rng = seededRandom(seed)
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    ;[shuffled[index], shuffled[swap]] = [shuffled[swap]!, shuffled[index]!]
  }
  return shuffled.slice(0, media.randomCount)
}

/** Tên các nhánh giống Chat API (`zaloCampaignExecutor.sendMessage`) và modal xem trước của Desktop. */
export function zaloSendSequence(input: { mediaCount: number; rich: boolean; hasText: boolean; share: boolean }): RecipientSendSequence {
  if (input.mediaCount <= 0) return 'content_only'
  if (input.share || input.mediaCount >= 2) return input.hasText ? 'media_then_content' : 'media_only'
  if (input.rich && input.hasText) return 'content_then_media'
  return input.hasText ? 'combined' : 'media_only'
}

const sexChoice = (body: string, gender: RecipientSampleGender) => {
  const [male = '', female = '', unknown = ''] = String(body || '').split('-')
  if (gender === 'male') return male
  if (gender === 'female') return female
  return unknown || male || female
}

const zaloDate = (base: Date, format: string, offsetDays: number) => formatSmsTemplateDate(base, format, offsetDays)

/**
 * Tách một đoạn chữ (đã spin) thành phần chữ và phần biến theo chế độ xem.
 * Ghép `text` của mọi phần ở chế độ khách mẫu cho đúng chuỗi runtime trả về (test đối chiếu).
 */
export function recipientTemplateParts(
  text: string,
  ctx: RecipientRenderContext,
  scope: RecipientScreen = 'message',
): { parts: RecipientTextPart[]; hasStopToken: boolean } {
  const parts: RecipientTextPart[] = []
  let hasStopToken = false
  let last = 0
  const push = (part: RecipientTextPart) => {
    if (part.kind === 'text' && !part.state && !part.text) return
    parts.push(part)
  }
  const sms = ctx.channel === 'sms' || ctx.channel === 'voice'
  const group = ctx.channel === 'zalo_group'
  const row: CampaignDataInput = ctx.mode === 'row' ? ctx.row || {} : ctx.mode === 'sample' ? RECIPIENT_SAMPLE.row : {}
  const filled = (token: string, value: string, label: string): RecipientTextPart =>
    ctx.mode === 'row' && !value
      ? { kind: 'token', state: 'empty', token, label, text: '' }
      : { kind: 'token', state: 'filled', token, label, text: value }
  // Renderer Desktop typecheck không bật downlevelIteration: lặp iterator/Map qua Array.from.
  for (const match of Array.from(text.matchAll(TOKEN_PATTERN))) {
    const index = match.index ?? 0
    if (index > last) push({ kind: 'text', text: text.slice(last, index) })
    last = index + match[0].length
    const token = match[0]
    const [, dateKey, dateFormat, sexBody] = match
    const key = tokenKey(match)
    const known = Boolean(key)
    const label = known ? labelFor(key, ctx.channel) : token
    const stopToken = key === 'STOP_MESSAGES_LINK'
    if (ctx.share) { push({ kind: 'token', state: 'unrendered', token, label, text: token }); continue }
    // SMS và lời mời không có link từ chối: runtime giữ nguyên chữ.
    if (!known || (stopToken && (sms || scope === 'friend_request'))) {
      push({ kind: 'token', state: 'unknown', token, label: token, text: token })
      continue
    }
    if (stopToken) {
      hasStopToken = true
      if (ctx.mode === 'raw') push({ kind: 'token', state: 'raw', token, label, text: label })
      else if (ctx.optOutEnabled) push({ kind: 'link', token, label, text: buildStopMessagesLink(STOP_MESSAGES_PREVIEW_ID) || '' })
      continue
    }
    if (ctx.mode === 'raw') {
      const shown = dateKey ? `${label} (${dateFormat || 'DD/MM/YYYY'})` : label
      push({ kind: 'token', state: 'raw', token, label: shown, text: shown })
      continue
    }
    if (dateKey) {
      const offset = dateKey === 'TOMORROW' ? 1 : dateKey === 'YESTERDAY' ? -1 : 0
      push({ kind: 'token', state: 'filled', token, label, text: zaloDate(sms ? ctx.smsBaseDate : ctx.now, dateFormat || 'DD/MM/YYYY', offset) })
      continue
    }
    if (key === 'SEX') {
      // SMS và group không có giới tính: luôn vế thứ ba; Zalo theo hồ sơ khách lúc gửi.
      if (sms || group) push({ kind: 'token', state: 'filled', token, label, text: sexChoice(sexBody ?? '', 'unknown') })
      else if (ctx.mode === 'row') push({ kind: 'token', state: 'runtime', token, label: 'Xưng hô theo giới tính Zalo', text: sexChoice(sexBody ?? '', 'unknown') })
      else push({ kind: 'token', state: 'filled', token, label, text: sexChoice(sexBody ?? '', ctx.gender) })
      continue
    }
    if (key === 'FULL_NAME' || key === 'ORIGINAL_NAME') {
      if (sms) push(filled(token, String(row.name ?? '').trim(), label))
      else if (group) push(filled(token, ctx.mode === 'sample' ? RECIPIENT_SAMPLE.groupName : String(row.name ?? '').trim(), label))
      else if (ctx.mode === 'row') push({ kind: 'token', state: 'runtime', token, label, text: label })
      else {
        const value = key === 'FULL_NAME'
          ? (ctx.longName ? RECIPIENT_SAMPLE.longDisplayName : RECIPIENT_SAMPLE.displayName)
          : (ctx.longName ? RECIPIENT_SAMPLE.longOriginalName : RECIPIENT_SAMPLE.originalName)
        push({ kind: 'token', state: 'filled', token, label, text: value })
      }
      continue
    }
    const field = ROW_TOKENS[key]
    const rawValue = field ? row[field] : ''
    const value = key === 'PHONE' || key === 'MOBILE' ? normalizeVietnamMobilePhone(rawValue) : String(rawValue ?? '').trim()
    push(filled(token, value, label))
  }
  if (last < text.length) push({ kind: 'text', text: text.slice(last) })
  return { parts, hasStopToken }
}

const joinParts = (parts: RecipientTextPart[]) => parts.map((part) => part.text).join('')

const stopFooter = () => `Từ chối nhận tin: ${buildStopMessagesLink(STOP_MESSAGES_PREVIEW_ID) || ''}`

const trimPartsEnd = (parts: RecipientTextPart[]) => {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!
    if (part.kind !== 'text') return
    part.text = part.text.trimEnd()
    if (part.text) return
    parts.splice(index, 1)
  }
}

const normalizeSmsParts = (parts: RecipientTextPart[], options: { useUnicode: boolean; keepNewLines: boolean }) => {
  const mapped = parts.map((part) => ({
    ...part,
    // Bỏ dấu/xuống dòng từng phần cho cùng kết quả với chuẩn hoá cả chuỗi; khoảng trắng đầu/cuối cắt sau.
    text: normalizeSmsContentForSend(`\u0001${part.text}\u0001`, options).slice(1, -1),
  }))
  const firstText = mapped.findIndex((part) => part.text.length > 0)
  if (firstText >= 0) mapped[firstText]!.text = mapped[firstText]!.text.trimStart()
  for (let index = mapped.length - 1; index >= 0; index -= 1) {
    if (!mapped[index]!.text.length) continue
    mapped[index]!.text = mapped[index]!.text.trimEnd()
    break
  }
  return mapped.filter((part) => part.text.length > 0 || part.state === 'empty')
}

const tokenHtml = (part: RecipientTextPart) => {
  const text = escapeFormattedContentText(part.text)
  if (part.kind === 'link') return `<span class="recipient-token is-link">${text}</span>`
  if (part.state === 'filled' || !part.state) return `<span class="recipient-token is-filled">${text}</span>`
  const label = escapeFormattedContentText(part.label || part.token || '')
  return `<span class="recipient-token is-${part.state}" title="${label}">${part.state === 'empty' ? '(trống)' : text}</span>`
}

function renderRichText(raw: string, ctx: RecipientRenderContext, rng: () => number): { html: string; plain: string } {
  const tokens: RecipientTextPart[] = []
  let hasStopToken = false
  const transformed = transformFormattedContentTextNodes(raw, (text) => {
    const result = recipientTemplateParts(renderContentSpin(text, { rng }), ctx, 'message')
    hasStopToken ||= result.hasStopToken
    return result.parts.map((part) => {
      if (part.kind === 'text' && !part.state) return part.text
      tokens.push(part)
      return `${MARKER_START}${tokens.length - 1}${MARKER_END}`
    }).join('')
  })
  const withFooter = !ctx.share && ctx.optOutEnabled && !hasStopToken && ctx.mode !== 'raw'
    ? appendFormattedPreviewFooter(transformed, stopFooter())
    : transformed
  const html = formattedContentToZaloPreviewHtml(withFooter).replace(MARKER_PATTERN, (_, index) => {
    const part = tokens[Number(index)]
    return part ? tokenHtml(part) : ''
  })
  const plain = formattedContentToPlainText(withFooter).replace(MARKER_PATTERN, (_, index) => tokens[Number(index)]?.text || '')
  return { html, plain }
}

function renderPlainText(raw: string, ctx: RecipientRenderContext, rng: () => number): RecipientTextPart[] {
  const sms = ctx.channel === 'sms' || ctx.channel === 'voice'
  const { parts, hasStopToken } = recipientTemplateParts(renderContentSpin(raw, { rng }), ctx, 'message')
  if (sms) {
    const normalized = normalizeSmsParts(parts, ctx.channel === 'voice'
      ? { useUnicode: true, keepNewLines: true }
      : { useUnicode: ctx.smsUseUnicode, keepNewLines: ctx.smsKeepNewLines })
    return ctx.channel === 'voice' && normalized.length
      ? [{ kind: 'disclosure', text: `${VOICE_CALL_AI_DISCLOSURE} ` }, ...normalized]
      : normalized
  }
  if (!ctx.share && ctx.optOutEnabled && !hasStopToken && ctx.mode !== 'raw') {
    trimPartsEnd(parts)
    const link = buildStopMessagesLink(STOP_MESSAGES_PREVIEW_ID) || ''
    if (parts.length) parts.push({ kind: 'text', text: '\n\n' })
    parts.push({ kind: 'text', text: 'Từ chối nhận tin: ' }, { kind: 'link', text: link, label: TOKEN_LABELS.STOP_MESSAGES_LINK })
  }
  return parts
}

const smsSegments = (text: string, useUnicode: boolean) => {
  if (!text) return 0
  const size = useUnicode && VIETNAMESE_DIACRITIC.test(text) ? 70 : 160
  return Math.ceil(text.length / size)
}

export function renderRecipientMessage(version: RecipientVersion, ctx: RecipientRenderContext): RecipientRenderedMessage {
  const rng = seededRandom(ctx.seed * 7919 + version.index)
  const media = ctx.channel === 'sms' || ctx.channel === 'voice' ? [] : selectRecipientMedia(version.media, (ctx.mediaSeed ?? ctx.seed) + version.index)
  let textBubble: RecipientBubble | null = null
  let plain = ''
  if (version.formatted) {
    const rich = renderRichText(version.raw, ctx, rng)
    plain = rich.plain
    if (plain.trim()) textBubble = { kind: 'rich', html: rich.html }
  } else {
    const parts = renderPlainText(version.raw, ctx, rng)
    plain = joinParts(parts)
    if (parts.some((part) => part.text.trim() || part.state === 'empty')) textBubble = { kind: 'text', parts }
  }
  const hasText = Boolean(textBubble)
  const sequence = zaloSendSequence({ mediaCount: media.length, rich: version.formatted, hasText, share: ctx.share })
  const mediaBubble: RecipientBubble = { kind: 'media', media }
  const bubbles: RecipientBubble[] = sequence === 'content_only' ? (textBubble ? [textBubble] : [])
    : sequence === 'combined' ? [{ kind: 'media', media, caption: textBubble! }]
      : sequence === 'media_then_content' ? [mediaBubble, textBubble!]
        : sequence === 'content_then_media' ? [textBubble!, mediaBubble]
          : [mediaBubble]
  const rendered: RecipientRenderedMessage = { sequence, bubbles, media, chars: plain.length, hasText }
  if (ctx.channel === 'sms') {
    rendered.smsUnicode = ctx.smsUseUnicode && VIETNAMESE_DIACRITIC.test(plain)
    rendered.smsSegments = smsSegments(plain, ctx.smsUseUnicode)
  }
  return rendered
}

/** Lời mời kết bạn: spin, điền biến rồi cắt 150 ký tự như runtime (`.slice(0, 150)`). */
export function renderRecipientFriendRequest(version: RecipientVersion, ctx: RecipientRenderContext): RecipientRenderedFriendRequest {
  const rng = seededRandom(ctx.seed * 7919 + 101 + version.index)
  const { parts } = recipientTemplateParts(renderContentSpin(version.raw, { rng }), { ...ctx, share: false, optOutEnabled: false }, 'friend_request')
  if (parts.some((part) => part.state === 'runtime' || part.state === 'raw')) return { parts, length: null, cut: false }
  const length = joinParts(parts).length
  if (length <= FRIEND_REQUEST_MAX_LENGTH) return { parts, length, cut: false }
  const visible: RecipientTextPart[] = []
  let used = 0
  for (const part of parts) {
    const room = FRIEND_REQUEST_MAX_LENGTH - used
    if (room <= 0) { visible.push({ ...part, kind: 'cut', state: undefined }); continue }
    if (part.text.length <= room) { visible.push(part); used += part.text.length; continue }
    visible.push({ ...part, text: part.text.slice(0, room) })
    visible.push({ kind: 'cut', text: part.text.slice(room) })
    used = FRIEND_REQUEST_MAX_LENGTH
  }
  return { parts: visible, length, cut: true }
}

/** Dòng thứ `rowIndex` nhận phiên bản nào ở lần gửi đầu (SMS: cố định theo thứ tự dòng). Chia sẻ: theo lượt. */
export function recipientVersionForRow(input: { channel: RecipientChannel; share: boolean; rowIndex: number; versionCount: number }): number | null {
  if (input.share || input.versionCount <= 0) return null
  return smsRecipientVariantIndex(input.rowIndex, input.versionCount)
}

const tokenKeys = (raw: string): string[] => Array.from(raw.matchAll(TOKEN_PATTERN), tokenKey).filter(Boolean)

const unknownTokens = (raw: string, channel: RecipientChannel, screen: RecipientScreen): string[] =>
  Array.from(new Set(Array.from(raw.matchAll(TOKEN_PATTERN)).flatMap((match) => {
    const key = tokenKey(match)
    if (key === 'STOP_MESSAGES_LINK') return channel === 'sms' || channel === 'voice' || screen === 'friend_request' ? [match[0]] : []
    return key ? [] : [match[0]]
  })))

/** Tài khoản Zalo chạy trên trình duyệt của app Desktop chỉ gửi được ảnh JPG/PNG/WEBP/GIF (kể cả file trên máy). */
const zaloWebUnsupported = (item: RecipientPreviewMedia): boolean => {
  if (item.kind !== 'image') return true
  if (item.mimeType) return !/^image\/(jpe?g|png|webp|gif)$/.test(item.mimeType)
  const extension = (item.url || item.localPath || '').split(/[?#]/)[0]?.match(/\.([a-z0-9]+)$/i)?.[1]
  return extension ? !/^(jpe?g|png|webp|gif)$/i.test(extension) : false
}

/** `{` hoặc `}` lệch ngoài biến: runtime in nguyên dấu ngoặc ra cho khách. */
export function hasBrokenSpin(text: string): boolean {
  let depth = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\' && '{}|\\'.includes(text[index + 1] || '')) { index += 1; continue }
    if (char === '#' && text[index + 1] === '{') {
      let tokenDepth = 0
      let end = -1
      for (let cursor = index + 1; cursor < text.length; cursor += 1) {
        if (text[cursor] === '{') tokenDepth += 1
        else if (text[cursor] === '}' && --tokenDepth === 0) { end = cursor; break }
      }
      if (end < 0) return true
      index = end
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth < 0) return true
    }
  }
  return depth !== 0
}

export interface RecipientAnalysisInput {
  source: RecipientPreviewSource
  screens: RecipientPreviewScreenModel[]
  rows: CampaignDataInput[]
  /** Số tài khoản đã chọn chạy Zalo trên trình duyệt của app Desktop (chỉ gửi được ảnh). */
  zaloWebSenders: number
  ctx: RecipientRenderContext
}

/** Cảnh báo mềm, không chặn Lưu. `warn` trước `info`. */
export function analyzeRecipientPreview(input: RecipientAnalysisInput): RecipientWarning[] {
  const { source, screens, rows, ctx } = input
  const channel = recipientPreviewChannel(source.actionCode)
  if (!channel) return []
  const warnings: RecipientWarning[] = []
  const add = (code: string, level: RecipientWarning['level'], text: string, target: RecipientWarning['target']) =>
    warnings.push({ code, level, text, target })
  const sampleCtx: RecipientRenderContext = { ...ctx, mode: 'sample', share: false, longName: false }
  const message = screens.find((screen) => screen.screen === 'message')
  const friend = screens.find((screen) => screen.screen === 'friend_request')
  const sms = channel === 'sms' || channel === 'voice'
  const label = (screen: RecipientScreen, index: number) => screen === 'message' ? `Nội dung ${index + 1}` : `Lời mời ${index + 1}`
  const textOf = (version: RecipientVersion) => version.formatted ? formattedContentToPlainText(version.raw) : version.raw

  for (const screen of [message, friend]) {
    if (!screen) continue
    const section = screen.screen === 'message' ? 'content' as const : 'actionOptions' as const
    let unknownCount = 0
    for (const version of screen.versions) {
      const text = textOf(version)
      for (const token of unknownTokens(text, channel, screen.screen)) {
        if (unknownCount++ >= 10) break
        add('unknown_token', 'warn', `${label(screen.screen, version.index)} có ${token}: khách sẽ thấy nguyên chữ này.`, { section, screen: screen.screen, version: version.index })
      }
      if (hasBrokenSpin(text)) {
        add('broken_spin', 'warn', `${label(screen.screen, version.index)} có dấu ngoặc { } chưa đóng: khách sẽ thấy nguyên dấu ngoặc.`, { section, screen: screen.screen, version: version.index })
      }
    }
  }

  if (message) {
    const many = message.versions.length > 1
    for (const version of message.versions) {
      const target = { section: 'content' as const, screen: 'message' as const, version: version.index }
      const pool = version.media.pool
      if (many && !version.hasText && (version.media.option === 'none' || pool.length === 0)) {
        add('empty_version', 'warn', `${label('message', version.index)} đang trống: khách sẽ không nhận gì.`, target)
      }
      if (version.media.option !== 'none' && pool.length === 0 && (source.advanced || version.index === 0) && !sms) {
        add('media_option_empty', 'warn', `${label('message', version.index)} đã chọn gửi file nhưng chưa có file nào.`, target)
      }
      if (version.media.option === 'random' && pool.length > 0 && version.media.randomCount > pool.length && (source.advanced || version.index === 0)) {
        add('random_over_pool', 'info', `Chọn ngẫu nhiên ${version.media.randomCount} nhưng chỉ có ${pool.length} file: khách nhận đủ ${pool.length} file.`, target)
      }
      if (input.zaloWebSenders > 0 && (source.advanced || version.index === 0) && version.media.option !== 'none') {
        const unsupported = pool.find(zaloWebUnsupported)
        if (unsupported) add('zalo_web_media', 'warn', `Tài khoản Zalo (trình duyệt) chỉ gửi được ảnh JPG, PNG, WEBP, GIF: ${unsupported.name} sẽ bị lỗi khi gửi.`, target)
      }
      if (sms) {
        const rendered = renderRecipientMessage(version, sampleCtx)
        if (channel === 'sms' && (rendered.smsSegments || 0) > 1) {
          add('sms_segments', 'info', `${label('message', version.index)} dài ${rendered.smsSegments} tin SMS: mỗi khách tính ${rendered.smsSegments} tin.`, target)
        }
      }
    }
    if (source.zaloMessageSendMode === 'share' && !sms) {
      const withToken = message.versions.find((version) => /#\{[^{}]*\}/.test(textOf(version)))
      if (withToken) {
        const token = textOf(withToken).match(/#\{[^{}]*(?:\{[^{}]*\})?\}/)?.[0] || '#{…}'
        add('share_tokens', 'warn', `Gửi dạng chia sẻ không điền biến: khách sẽ thấy nguyên ${token} ở ${label('message', withToken.index)}.`, { section: 'content', screen: 'message', version: withToken.index })
      }
    }
    if (!sms && source.zaloMessageSendMode !== 'share' && !source.zaloOptOutLinkEnabled
      && supportsStopMessagesLink(source.actionCode, source.zaloMessageSendMode)) {
      const withStop = message.versions.find((version) => textOf(version).includes(STOP_MESSAGES_LINK_TOKEN))
      if (withStop) add('stop_link_off', 'warn', STOP_MESSAGES_CHECKBOX_ERROR, { section: 'content', screen: 'message', version: withStop.index })
    }
    if (channel === 'sms' && !source.smsUseUnicode && message.versions.some((version) => VIETNAMESE_DIACRITIC.test(version.raw))) {
      add('sms_diacritics', 'info', 'Đang tắt “Tiếng Việt có dấu”: khách nhận bản không dấu.', { section: 'content', screen: 'message' })
    }
    if (channel === 'voice') {
      const error = getVoiceCallContentValidationError(source.content)
      if (error) add('voice_too_long', 'warn', error, { section: 'content', screen: 'message' })
    }
    const seen = new Map<string, number>()
    for (const version of message.versions) {
      const key = textOf(version).replace(/\s+/g, ' ').trim()
      if (!key) continue
      const first = seen.get(key)
      if (first === undefined) seen.set(key, version.index)
      else add('duplicate_versions', 'info', `${label('message', first)} và ${label('message', version.index)} giống nhau.`, { section: 'content', screen: 'message', version: version.index })
    }
  }

  if (friend) {
    for (const version of friend.versions) {
      const target = { section: 'actionOptions' as const, screen: 'friend_request' as const, version: version.index }
      const rendered = renderRecipientFriendRequest(version, sampleCtx)
      const length = rendered.length ?? 0
      const names = tokenKeys(version.raw).filter((key) => key === 'FULL_NAME' || key === 'ORIGINAL_NAME').length
      if (length > FRIEND_REQUEST_MAX_LENGTH) {
        add('friend_request_cut', 'warn', `${label('friend_request', version.index)} dài ${length} ký tự khi điền khách mẫu: khách chỉ thấy ${FRIEND_REQUEST_MAX_LENGTH} ký tự đầu.`, target)
      } else if (names > 0 && FRIEND_REQUEST_MAX_LENGTH - length <= 10) {
        const room = FRIEND_REQUEST_MAX_LENGTH - length
        const maxName = RECIPIENT_SAMPLE.displayName.length + Math.floor(room / names)
        add('friend_request_headroom', 'info', `${label('friend_request', version.index)} chỉ còn dư ${room} ký tự: tên Zalo dài hơn ${maxName} ký tự sẽ bị cắt đuôi.`, target)
      }
    }
  }

  if (rows.length) {
    const used = new Map<string, { screen: RecipientScreen; version: number }>()
    for (const screen of [message, friend]) {
      for (const version of screen?.versions || []) {
        for (const key of tokenKeys(textOf(version))) {
          const dataKey = ROW_TOKENS[key] ? key : (sms || channel === 'zalo_group') && (key === 'FULL_NAME' || key === 'ORIGINAL_NAME') ? key : ''
          if (dataKey && !used.has(dataKey)) used.set(dataKey, { screen: screen!.screen, version: version.index })
        }
      }
    }
    for (const [key, where] of Array.from(used)) {
      const field = ROW_TOKENS[key] || 'name'
      const empty = rows.filter((row) => {
        const value = row[field]
        return key === 'PHONE' || key === 'MOBILE' ? !normalizeVietnamMobilePhone(value) : !String(value ?? '').trim()
      }).length
      if (!empty) continue
      add('empty_token_rows', 'warn', `${empty.toLocaleString('vi-VN')}/${rows.length.toLocaleString('vi-VN')} dòng trống ${labelFor(key, channel)}: khách thấy chỗ trống ở ${label(where.screen, where.version)}.`,
        { section: where.screen === 'message' ? 'content' : 'actionOptions', screen: where.screen, version: where.version })
    }
  }

  return warnings.sort((left, right) => (left.level === right.level ? 0 : left.level === 'warn' ? -1 : 1))
}

export interface RecipientNotesInput {
  source: RecipientPreviewSource
  screens: RecipientPreviewScreenModel[]
  liveSource: boolean
}

/** Mục "Khi chạy thật": chỉ phần bản xem trước không biết trước. */
export function recipientPreviewNotes(input: RecipientNotesInput): string[] {
  const { source, screens } = input
  const channel = recipientPreviewChannel(source.actionCode)
  if (!channel) return []
  const notes: string[] = []
  const message = screens.find((screen) => screen.screen === 'message')
  const friend = screens.find((screen) => screen.screen === 'friend_request')
  const count = message?.versions.length || 0
  const share = source.zaloMessageSendMode === 'share' && channel !== 'sms' && channel !== 'voice'
  if (channel === 'sms') {
    notes.push(count > 1
      ? `Dòng thứ k nhận Nội dung (k chia ${count} lấy dư), cố định khi thêm data. Sửa nội dung hoặc lịch thì hệ thống tạo lại cho dòng chưa gửi.`
      : 'Hệ thống tạo sẵn nội dung cho từng dòng khi thêm data; sửa nội dung hoặc lịch thì tạo lại cho dòng chưa gửi.')
    notes.push('Ngày trong nội dung tính theo Lịch chạy.')
  } else if (channel === 'voice') {
    notes.push('Thông báo cuộc gọi AI được đọc trước nội dung; âm thanh tạo bằng giọng nói AI khi gọi.')
  } else if (share) {
    notes.push(channel === 'zalo_group'
      ? 'Mỗi lượt chia sẻ tới tối đa 50 group, cả lượt nhận cùng một nội dung; lượt sau dùng nội dung kế tiếp.'
      : 'Mỗi lượt chia sẻ tới tối đa 50 người, cả lượt nhận cùng một nội dung; lượt sau dùng nội dung kế tiếp.')
    notes.push('Gửi dạng chia sẻ chỉ trộn spin {a|b}, không điền biến #{…}.')
  } else if (message) {
    notes.push(count > 1
      ? `Mỗi khách nhận lần lượt Nội dung 1 → ${count} theo thứ tự gửi; gửi lại cùng khách thì sang nội dung kế tiếp.`
      : 'Mọi khách nhận cùng một nội dung.')
  }
  if (friend && message) notes.push('Lời mời kết bạn gửi sau tin nhắn và xoay vòng riêng.')
  else if (friend) notes.push('Lời mời kết bạn xoay vòng riêng nếu có nhiều phiên bản.')
  if (channel === 'zalo' && !share) {
    const allText = screens.flatMap((screen) => screen.versions.map((version) => version.raw)).join(' ')
    if (/#\{(?:FULL_NAME|ORIGINAL_NAME|SEX\{)/.test(allText)) notes.push('Tên Zalo, tên gốc và xưng hô lấy từ hồ sơ Zalo của khách lúc gửi.')
  }
  if (channel === 'zalo_group' && !share) notes.push('Ở tin nhắn group, #{FULL_NAME} là tên group.')
  if (message?.versions.some((version) => version.media.option === 'random' && version.media.pool.length > 0)) {
    notes.push('Media ngẫu nhiên: mỗi lần gửi chọn lại; bấm Đổi media để xem tổ hợp khác.')
  }
  if (message?.versions.some((version) => version.spinOptions > 1)) notes.push('Cụm {a|b} được chọn ngẫu nhiên ở từng lần gửi.')
  if (source.rewriteContentEachRun && channel !== 'sms' && channel !== 'voice' && !source.formattedContentEnabled) {
    notes.push('Đang bật AI viết lại mỗi lượt: đây là nội dung trước khi AI viết lại.')
  }
  if (input.liveSource) notes.push('Khách được lấy khi chạy, nên bản xem trước dùng khách mẫu.')
  return notes
}

/** Độ dài lời nhắn kết bạn mà form hiện đang kiểm (giữ nguyên luật cũ: cả chuỗi, spin dài nhất). */
export const friendRequestFormLength = (message: string): number => renderContentSpinMax(message).length

interface VariantSegment { start: number; end: number; version: number | null }

/** Các đoạn giữa dấu `|` ngoài cùng; đoạn trống không thành phiên bản (giống `splitContentVariants`). */
const variantSegments = (content: string): VariantSegment[] => {
  const segments: VariantSegment[] = []
  let start = 0
  let version = 0
  for (const separator of [...findContentVariantSeparatorIndexes(content), content.length]) {
    const text = content.slice(start, separator)
    const trimmedStart = start + (text.length - text.trimStart().length)
    const trimmedEnd = separator - (text.length - text.trimEnd().length)
    const empty = !text.trim()
    segments.push({ start: empty ? start : trimmedStart, end: empty ? separator : trimmedEnd, version: empty ? null : version })
    if (!empty) version += 1
    start = separator + 1
  }
  return segments
}

/** Con trỏ ở vị trí `caret` trong ô nội dung thường đang soạn phiên bản nào. */
export function recipientVersionAtCaret(content: string, caret: number): number {
  const value = String(content || '')
  const segmentIndex = findContentVariantSeparatorIndexes(value).filter((index) => index < caret).length
  const segments = variantSegments(value)
  for (let index = Math.min(segmentIndex, segments.length - 1); index >= 0; index -= 1) {
    const version = segments[index]?.version
    if (version !== null && version !== undefined) return version
  }
  for (let index = segmentIndex + 1; index < segments.length; index += 1) {
    const version = segments[index]?.version
    if (version !== null && version !== undefined) return version
  }
  return 0
}

/** Vị trí chữ của phiên bản `version` để chọn đúng đoạn khi bấm Sửa. */
export function recipientVariantRange(content: string, version: number): { start: number; end: number } | null {
  const segment = variantSegments(String(content || '')).find((item) => item.version === version)
  return segment ? { start: segment.start, end: segment.end } : null
}
