// Link từ chối nhận tin cho SMS, email và Facebook (akaAgent V649, docs/MESSAGE_OPT_OUT_CHANNELS_PLAN.md).
// Không phụ thuộc file nào: chép nguyên văn sang akaAgent `src/shared/messageOptOutChannels.ts` (sửa ở WebApp trước).
//
// Tin nhắn Zalo dùng `zaloMessageOptOut.ts` như cũ. Ba kênh này dùng chung biến `#{STOP_MESSAGES_LINK}`, chung ô
// "Thêm link từ chối nhận tin nhắn" (`zaloOptOutLinkEnabled`), chung trang từ chối; mỗi kênh bật bằng công tắc
// `message_opt_out.channels` (thiếu / sai = tắt). Từ chối ở kênh nào chỉ chặn kênh đó.

export type MessageOptOutChannel = 'sms' | 'email' | 'facebook'

export interface MessageOptOutChannels {
  sms: boolean
  email: boolean
  facebook: boolean
}

export const MESSAGE_OPT_OUT_CHANNELS_SETTING_KEY = 'message_opt_out.channels'
export const MESSAGE_OPT_OUT_CHANNELS_OFF: MessageOptOutChannels = Object.freeze({ sms: false, email: false, facebook: false })

const TOKEN = '#{STOP_MESSAGES_LINK}'
const LINK_PREFIX = 'https://b.akabiz.biz/s/'
/** `https://b.akabiz.biz/s/` + 22 ký tự. */
export const MESSAGE_OPT_OUT_LINK_LENGTH = LINK_PREFIX.length + 22

const ACTION_CHANNELS: Record<string, MessageOptOutChannel> = {
  sms_send: 'sms',
  email_send: 'email',
  facebook_message_uid: 'facebook',
  facebook_message_friend: 'facebook',
  facebook_page_to_message: 'facebook',
}

export const MESSAGE_OPT_OUT_CHANNEL_LABELS: Record<MessageOptOutChannel, string> = {
  sms: 'SMS',
  email: 'email',
  facebook: 'Facebook',
}

/** Ghi chú của data khi bỏ qua người đã từ chối (như "Bỏ qua vì người nhận đã từ chối nhận tin nhắn Zalo"). */
export const MESSAGE_OPT_OUT_SKIP_NOTES: Record<MessageOptOutChannel, string> = {
  sms: 'Bỏ qua vì người nhận đã từ chối nhận tin nhắn SMS',
  email: 'Bỏ qua vì người nhận đã từ chối nhận email',
  facebook: 'Bỏ qua vì người nhận đã từ chối nhận tin nhắn Facebook',
}

/** Mã lỗi engine v2 khi chặn người đã từ chối ở Facebook (OPT02, V649). */
export const FACEBOOK_OPT_OUT_ERROR_CODE = 'err_engine_recipient_opted_out_facebook'

/** Đọc giá trị khoá `message_opt_out.channels` (JSON `{"sms":true,…}`). Thiếu / sai = tắt cả ba. */
export function parseMessageOptOutChannels(value: unknown): MessageOptOutChannels {
  let parsed: unknown = value
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value) } catch { return { ...MESSAGE_OPT_OUT_CHANNELS_OFF } }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...MESSAGE_OPT_OUT_CHANNELS_OFF }
  const row = parsed as Record<string, unknown>
  return { sms: row.sms === true, email: row.email === true, facebook: row.facebook === true }
}

/** Kênh của loại chiến dịch: chỉ SMS, email và 3 loại nhắn tin Facebook; loại khác (kể cả Zalo) = null. */
export function messageOptOutChannelForAction(actionId: unknown): MessageOptOutChannel | null {
  return typeof actionId === 'string' ? ACTION_CHANNELS[actionId] ?? null : null
}

/** Loại chiến dịch này có ô / biến link từ chối không (theo công tắc kênh). */
export function channelOptOutLinkSupported(actionId: unknown, channels: Partial<MessageOptOutChannels> | null | undefined): boolean {
  const channel = messageOptOutChannelForAction(actionId)
  return channel !== null && channels?.[channel] === true
}

/**
 * Kiểm lúc lưu chiến dịch SMS / email / Facebook. Chỉ gọi cho loại có kênh (messageOptOutChannelForAction khác null).
 * Có biến mà kênh chưa mở thì chặn (bộ chạy sẽ bỏ biến); có biến mà chưa bật ô thì chặn như Zalo.
 */
export function validateChannelOptOutSettings(
  content: string | null | undefined,
  settings: { advancedContentEnabled?: unknown; advancedContentItems?: unknown; formattedContentEnabled?: unknown; zaloOptOutLinkEnabled?: unknown },
  actionId: string,
  channels: Partial<MessageOptOutChannels> | null | undefined,
  plainText: (value: string) => string = value => value,
): string | null {
  const channel = messageOptOutChannelForAction(actionId)
  if (!channel) return null
  const contents = settings.advancedContentEnabled === true
    ? (Array.isArray(settings.advancedContentItems) ? settings.advancedContentItems : []).map(item =>
      item && typeof item === 'object' && typeof (item as { content?: unknown }).content === 'string' ? (item as { content: string }).content : '')
    : [content || '']
  const texts = settings.formattedContentEnabled === true ? contents.map(plainText) : contents
  if (!texts.some(text => text.includes(TOKEN))) return null
  if (channels?.[channel] !== true) {
    return `Link từ chối nhận tin chưa mở cho chiến dịch ${MESSAGE_OPT_OUT_CHANNEL_LABELS[channel]}. Vui lòng bỏ ${TOKEN} khỏi nội dung.`
  }
  return settings.zaloOptOutLinkEnabled === true
    ? null
    : 'Nội dung có cá nhân hoá từ chối nhận tin. Vui lòng bật “Thêm link từ chối nhận tin nhắn” để lưu chiến dịch.'
}

/** Dòng thêm cuối tin khi bật ô mà nội dung không có biến. SMS không dấu dùng chữ không dấu. */
export function messageOptOutFooterText(link: string, options: { plain?: boolean } = {}): string {
  return `${options.plain ? 'Tu choi nhan tin' : 'Từ chối nhận tin'}: ${link}`
}

/**
 * Số ký tự link từ chối thêm vào một tin SMS (để form đếm số tin), như hàm DB lúc gửi: có biến thì mỗi biến thành link
 * 45 ký tự; không có biến thì thêm dấu cách (hoặc xuống dòng) + "Tu choi nhan tin: <link>".
 */
export function smsOptOutExtraLength(content: string): number {
  if (content.includes(TOKEN)) return (content.split(TOKEN).length - 1) * (MESSAGE_OPT_OUT_LINK_LENGTH - TOKEN.length)
  return (content.trim() ? 1 : 0) + messageOptOutFooterText('x'.repeat(MESSAGE_OPT_OUT_LINK_LENGTH)).length
}

/** Link mẫu trong xem trước: thay biến, hoặc thêm dòng cuối khi không có biến. */
export function applyMessageOptOutPreview(content: string, link: string, options: { plain?: boolean; newline?: string } = {}): string {
  if (content.includes(TOKEN)) return content.split(TOKEN).join(link)
  const body = content.replace(/\s+$/, '')
  return `${body}${body ? options.newline ?? '\n\n' : ''}${messageOptOutFooterText(link, options)}`
}

/**
 * Khoá người nhận Facebook (V649): inbox Page `page:<id Page>:<id khách>` (id khách chỉ có nghĩa trong một Page);
 * nhắn theo UID / bạn bè `uid:<số>` (nhận cả link profile.php?id= và link có UID), tên người dùng `user:<tên>`.
 * Không đọc ra được = null (không tạo link, không kiểm).
 */
export function facebookOptOutKey(actionId: unknown, uid: unknown, pageUid?: unknown): string | null {
  const raw = typeof uid === 'string' ? uid.trim() : typeof uid === 'number' && Number.isFinite(uid) ? String(uid) : ''
  if (!raw) return null
  if (actionId === 'facebook_page_to_message') {
    const page = typeof pageUid === 'string' ? pageUid.trim() : typeof pageUid === 'number' ? String(pageUid) : ''
    if (!page || /\s|:/.test(page) || /\s/.test(raw) || raw.length > 200) return null
    return `page:${page}:${raw}`
  }
  if (actionId !== 'facebook_message_uid' && actionId !== 'facebook_message_friend') return null
  if (/^\d{5,30}$/.test(raw)) return `uid:${raw}`
  let url: URL | null = null
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    url = null
  }
  if (!url || !/(^|\.)facebook\.com$|(^|\.)fb\.com$/i.test(url.hostname)) {
    return /^[A-Za-z0-9.]{3,100}$/.test(raw) ? `user:${raw.toLowerCase()}` : null
  }
  const id = url.searchParams.get('id')
  if (id && /^\d{5,30}$/.test(id)) return `uid:${id}`
  const parts = url.pathname.split('/').filter(Boolean)
  const numeric = parts.find(part => /^\d{5,30}$/.test(part))
  if (numeric) return `uid:${numeric}`
  const first = parts[0] || ''
  if (/^[A-Za-z0-9.]{3,100}$/.test(first) && !/^(profile\.php|people|groups|pages|permalink\.php|story\.php)$/i.test(first)) {
    return `user:${first.toLowerCase()}`
  }
  return null
}

/** Địa chỉ "Hủy đăng ký" một chạm cho header List-Unsubscribe của email (RFC 8058); `token` = 22 ký tự của link. */
export function messageOptOutOneClickUrl(token: string): string | null {
  return /^[A-Za-z0-9_-]{22}$/.test(token) ? `https://b.akabiz.biz/api/public/message-opt-out/${token}/one-click` : null
}
