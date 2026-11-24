import {
  CONTENT_SYNTAX_ERROR_CODE,
  analyzeContentSyntax,
  checkCampaignContentSyntax,
  contentSyntaxBlockMessage,
  parseContentSyntaxGuardMode,
  type CampaignContentSyntaxInput,
  type ContentSyntaxGuardMode
} from '../../shared/contentSyntax'
import { getMessageOptOutChannels } from './messageOptOutChannelsSetting'

/**
 * Chặn lưu nội dung sai cú pháp biến / ngoặc ở đường lưu từ giao diện (IPC tạo / sửa chiến dịch, lưu mẫu nội dung).
 * Chỉ là bước lưu: bộ lập lịch, App Server và các chiến dịch do hệ thống tự tạo không đi qua đây.
 * Mức chặn đọc chung câu đọc cài đặt lúc đăng nhập (`campaign.content_syntax_guard`); chưa đọc = `block`.
 */
let mode: ContentSyntaxGuardMode = 'block'

export function setContentSyntaxGuardMode(value: unknown): ContentSyntaxGuardMode {
  mode = parseContentSyntaxGuardMode(value)
  return mode
}

export function getContentSyntaxGuardMode(): ContentSyntaxGuardMode {
  return mode
}

export class CampaignContentSyntaxError extends Error {
  readonly code = CONTENT_SYNTAX_ERROR_CODE
  constructor(message: string, readonly field: string) {
    super(message)
    this.name = 'CampaignContentSyntaxError'
  }
}

const EXTRA_CONTENT_KEYS = [
  'emailSubject', 'advancedContentItems', 'friendRequestMessage', 'zaloAliasTemplate', 'internalSmsContent',
  'externalSmsContent', 'commentContent', 'postBumpContent', 'newsfeedCommentContent'
] as const

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Lần lưu này có gửi ô nội dung nào không (để khỏi đọc lại chiến dịch khi chỉ sửa lịch, giới hạn). */
export function touchesCampaignContent(updates: { content?: unknown; extraSettings?: unknown }): boolean {
  if (typeof updates.content === 'string') return true
  const extra = asRecord(updates.extraSettings)
  return !!extra && (extra.zaloMessageSendMode === 'share'
    || EXTRA_CONTENT_KEYS.some(key => extra[key] !== undefined && extra[key] !== null && extra[key] !== ''))
}

/** Chỉ giữ các ô nội dung lần lưu này thật sự đổi so với bản đang lưu. */
export function changedCampaignContentFields(
  actionId: string,
  updates: { content?: unknown; extraSettings?: unknown },
  current: { actionId?: unknown; content?: unknown; extraSettings?: unknown } | null | undefined
): CampaignContentSyntaxInput {
  const actionChanged = !current || String(current.actionId ?? '') !== actionId
  const input: CampaignContentSyntaxInput = { actionId }
  if (typeof updates.content === 'string' && (actionChanged || updates.content !== current?.content)) input.content = updates.content
  const next = asRecord(updates.extraSettings)
  const before = asRecord(current?.extraSettings) || {}
  // Gửi dạng chia sẻ không điền biến: vừa bật chế độ này thì kiểm lại nội dung dù nội dung không đổi.
  const sendMode = next && next.zaloMessageSendMode !== undefined ? next.zaloMessageSendMode : before.zaloMessageSendMode
  const shareTurnedOn = sendMode === 'share' && before.zaloMessageSendMode !== 'share'
  if (shareTurnedOn && input.content === undefined) {
    const content = typeof updates.content === 'string' ? updates.content : current?.content
    if (typeof content === 'string') input.content = content
  }
  if (next || sendMode !== undefined) {
    const source = next || {}
    const changed: Record<string, unknown> = {
      formattedContentEnabled: source.formattedContentEnabled ?? before.formattedContentEnabled,
      emailBodyIsHtml: source.emailBodyIsHtml ?? before.emailBodyIsHtml,
      zaloMessageSendMode: sendMode
    }
    for (const key of EXTRA_CONTENT_KEYS) {
      if (next && (actionChanged || !sameValue(next[key], before[key]))) changed[key] = next[key]
    }
    if (shareTurnedOn && changed.advancedContentItems === undefined) {
      changed.advancedContentItems = next && next.advancedContentItems !== undefined ? next.advancedContentItems : before.advancedContentItems
    }
    input.extraSettings = changed
  }
  return input
}

export function assertCampaignContentSyntax(input: CampaignContentSyntaxInput): void {
  const verdict = checkCampaignContentSyntax({ ...input, optOutChannels: input.optOutChannels ?? getMessageOptOutChannels() }, mode)
  if (!verdict.ok) throw new CampaignContentSyntaxError(verdict.message, verdict.field || 'content')
}

/** Mẫu nội dung dùng cho nhiều kênh: chỉ chặn lỗi ngoặc / biến chưa đóng làm gộp mẫu. */
export function assertTemplateContentSyntax(template: { channels?: unknown } | null | undefined): void {
  if (mode !== 'block') return
  const channels = asRecord(template?.channels)
  if (!channels) return
  for (const name of Object.keys(channels)) {
    const channel = asRecord(channels[name])
    if (!channel) continue
    for (const key of ['content', 'contentHtml', 'subject']) {
      const text = channel[key]
      if (typeof text !== 'string' || !text.trim()) continue
      const result = analyzeContentSyntax(text, { channel: 'other', html: 'auto' })
      const message = contentSyntaxBlockMessage(key === 'subject' ? 'Tiêu đề của mẫu' : 'Nội dung mẫu', result)
      if (message) throw new CampaignContentSyntaxError(message, `channels.${name}.${key}`)
    }
  }
}
