import type { AppNotification } from './types'

function optionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

export function normalizePublicLinkUrl(value: unknown): string | null {
  const text = optionalText(value)
  if (!text) return null
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

function optionalTimestamp(value: unknown): string | null {
  const text = optionalText(value)
  if (!text) return null
  return Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : null
}

/** Shared by the public login screen and the authenticated staff/system banner. */
export function parseAppNotification(
  id: number,
  updatedAt: string | undefined,
  rawValue: string | null | undefined,
  now = Date.now()
): AppNotification | null {
  const value = String(rawValue || '').trim()
  if (!value) return null

  let payload: unknown
  try { payload = JSON.parse(value) } catch { payload = value }
  if (typeof payload === 'string') payload = { message: payload }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null

  const fields = payload as Record<string, unknown>
  const message = optionalText(fields.message)
  if (!message) return null
  const startsAt = optionalTimestamp(fields.startsAt ?? fields.starts_at)
  const endsAt = optionalTimestamp(fields.endsAt ?? fields.ends_at)
  if (startsAt && Date.parse(startsAt) > now) return null
  if (endsAt && Date.parse(endsAt) <= now) return null

  return {
    id,
    title: optionalText(fields.title),
    message,
    level: fields.level === 'success' || fields.level === 'warning' || fields.level === 'error'
      ? fields.level : 'info',
    linkLabel: optionalText(fields.linkLabel ?? fields.link_label),
    linkUrl: normalizePublicLinkUrl(fields.linkUrl ?? fields.link_url),
    startsAt,
    endsAt,
    updatedAt
  }
}
