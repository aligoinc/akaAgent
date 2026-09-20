import { normalizePublicLinkUrl } from './appNotification'
import type { AppNotificationLevel } from './types'

export interface AdminNotificationDraft {
  title: string; message: string; level: AppNotificationLevel; linkLabel: string; linkUrl: string; startsAt: string; endsAt: string
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
export function readNotificationDraft(raw: string): AdminNotificationDraft {
  let payload: unknown = raw
  try { payload = JSON.parse(raw) } catch { /* Legacy plain text is supported. */ }
  const value = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : { message: text(payload) }
  return {
    title: text(value.title), message: text(value.message),
    level: ['info', 'success', 'warning', 'error'].includes(text(value.level)) ? value.level as AppNotificationLevel : 'info',
    linkLabel: text(value.linkLabel ?? value.link_label), linkUrl: text(value.linkUrl ?? value.link_url),
    startsAt: text(value.startsAt ?? value.starts_at), endsAt: text(value.endsAt ?? value.ends_at)
  }
}
export function writeNotificationDraft(raw: string, draft: AdminNotificationDraft): string {
  if (!draft.message.trim()) throw new Error('Vui lòng nhập nội dung thông báo.')
  if (draft.linkUrl && !normalizePublicLinkUrl(draft.linkUrl)) throw new Error('Liên kết phải dùng HTTP hoặc HTTPS.')
  if ([draft.startsAt, draft.endsAt].some(value => value && !Number.isFinite(Date.parse(value)))) throw new Error('Thời gian thông báo không hợp lệ.')
  if (draft.startsAt && draft.endsAt && Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)) throw new Error('Thời gian kết thúc phải sau thời gian bắt đầu.')
  let original: Record<string, unknown> = {}
  try { const value = JSON.parse(raw); if (value && typeof value === 'object' && !Array.isArray(value)) original = value } catch { /* plain text */ }
  for (const key of ['link_label', 'link_url', 'starts_at', 'ends_at']) delete original[key]
  return JSON.stringify({ ...original, ...draft, title: draft.title.trim() || null, message: draft.message.trim(),
    linkLabel: draft.linkLabel.trim() || null, linkUrl: normalizePublicLinkUrl(draft.linkUrl),
    startsAt: draft.startsAt ? new Date(draft.startsAt).toISOString() : null,
    endsAt: draft.endsAt ? new Date(draft.endsAt).toISOString() : null })
}
export function vietnamDateInput(value: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return ''
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
  return parts.replace(' ', 'T')
}
