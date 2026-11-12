// Keep this dependency-free contract identical in akaAgent, WebApp and Chat API.
export const STOP_MESSAGES_LINK_TOKEN = '#{STOP_MESSAGES_LINK}'
export const STOP_MESSAGES_INSERT_TEXT = `Từ chối nhận tin: ${STOP_MESSAGES_LINK_TOKEN}`
export const STOP_MESSAGES_ERROR_URL = 'https://b.akabiz.biz/s/error'
export const STOP_MESSAGES_PREVIEW_ID = '550e8400-e29b-41d4-a716-446655440000'
export const STOP_MESSAGES_CHECKBOX_ERROR = 'Nội dung có cá nhân hoá từ chối nhận tin. Vui lòng bật “Thêm link từ chối nhận tin nhắn” để lưu chiến dịch.'
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ACTIONS = new Set([
  'zalo_message_phone', 'zalo_message_friend', 'zalo_message_birthday',
  'zalo_message_group_member', 'zalo_message_group_realtime',
  'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation'
])
const TOGGLEABLE_MESSAGE_ACTIONS = new Set([
  'zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime',
  'zalo_message_remarketing_customer', 'zalo_message_friend_recommendation'
])

export function supportsStopMessagesLink(actionId: string, sendMode?: string): boolean {
  return ACTIONS.has(actionId) && sendMode !== 'share'
}

export function encodeStopMessagesId(id: string): string | null {
  if (!UUID.test(id)) return null
  const hex = id.replace(/-/g, '')
  const bytes = Array.from({ length: 16 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16))
  let output = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const value = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    output += ALPHABET[(value >>> 18) & 63]! + ALPHABET[(value >>> 12) & 63]!
    if (i + 1 < bytes.length) output += ALPHABET[(value >>> 6) & 63]
    if (i + 2 < bytes.length) output += ALPHABET[value & 63]
  }
  return output
}

export function decodeStopMessagesToken(token: string): string | null {
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) return null
  const bytes: number[] = []
  let value = 0
  let bits = 0
  for (const char of token) {
    value = (value << 6) | ALPHABET.indexOf(char)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >>> bits) & 255)
    }
  }
  if (bytes.length !== 16) return null
  const hex = bytes.map(byte => byte.toString(16).padStart(2, '0')).join('')
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  return encodeStopMessagesId(id) === token ? id : null
}

export function buildStopMessagesLink(id: string | null | undefined): string | null {
  const token = id ? encodeStopMessagesId(id) : null
  return token ? `https://b.akabiz.biz/s/${token}` : null
}

export const isStopMessagesPublicPath = (path: string): boolean =>
  /^\/(?:s|zalo-message-opt-out)(?:\/|$)/.test(path)

export function validateStopMessagesContent(
  contents: readonly string[], enabled: boolean, actionId: string, sendMode?: string
): string | null {
  if (!contents.some(content => content.includes(STOP_MESSAGES_LINK_TOKEN))) return null
  if (!supportsStopMessagesLink(actionId, sendMode)) {
    return 'Cá nhân hoá từ chối nhận tin chỉ hỗ trợ chiến dịch nhắn tin Zalo cá nhân ở chế độ thường.'
  }
  return enabled ? null : STOP_MESSAGES_CHECKBOX_ERROR
}

export interface StopMessagesRenderState { hasToken: boolean }

/** Validate only the source that the runtime will use, including its complete saved snapshot. */
export function validateStopMessagesSettings(
 content: string | null | undefined,
 settings: { enableMessage?: unknown; advancedContentEnabled?: unknown; advancedContentItems?: unknown; formattedContentEnabled?: unknown; zaloOptOutLinkEnabled?: unknown; zaloMessageSendMode?: unknown },
 actionId: string,
 plainText: (value: string) => string = value => value
): string | null {
 // These actions can run only auxiliary steps while retaining their message draft.
 if (settings.enableMessage === false && TOGGLEABLE_MESSAGE_ACTIONS.has(actionId)) return null
 const contents = settings.advancedContentEnabled === true
  ? (Array.isArray(settings.advancedContentItems) ? settings.advancedContentItems : []).map(item =>
    item && typeof item.content === 'string' ? item.content : '')
  : [content || '']
 return validateStopMessagesContent(
  settings.formattedContentEnabled === true ? contents.map(plainText) : contents,
  settings.zaloOptOutLinkEnabled === true, actionId,
  typeof settings.zaloMessageSendMode === 'string' ? settings.zaloMessageSendMode : undefined
 )
}


export function replaceStopMessagesLink(
  content: string, linkId: string | null | undefined, enabled: boolean, state: StopMessagesRenderState
): string {
  if (!content.includes(STOP_MESSAGES_LINK_TOKEN)) return content
  state.hasToken = true
  return content.split(STOP_MESSAGES_LINK_TOKEN).join(
    enabled ? buildStopMessagesLink(linkId) || STOP_MESSAGES_ERROR_URL : ''
  )
}

export function appendStopMessagesFooter<T extends { msg: string; styles?: Array<{ start: number; len: number }> }>(
  message: string | T, linkId: string | null | undefined, enabled: boolean, hasToken: boolean
): string | T {
  const link = enabled && !hasToken ? buildStopMessagesLink(linkId) : null
  if (!link) return message
  const body = (typeof message === 'string' ? message : message.msg).trimEnd()
  const footer = `Từ chối nhận tin: ${link}`
  const msg = body ? `${body}\n\n${footer}` : footer
  if (typeof message === 'string') return msg
  // Only the end is trimmed; preserve starts and clip styles before the plain footer.
  const styles = message.styles?.map(style => ({
    ...style, len: Math.min(style.len, body.length - style.start)
  })).filter(style => style.start >= 0 && style.len > 0)
  return { ...message, msg, ...(styles ? { styles } : {}) }
}
