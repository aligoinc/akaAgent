import type { AppNotification } from '../../../shared/types'
import { listActiveSystemSettingsByKeys } from './systemSettingsRepository'

const APP_NOTIFICATION_SETTING_KEY = 'app.notification'

function optionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

function safeLinkUrl(value: unknown): string | null {
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
  const timestamp = Date.parse(text)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function buildNotification(
  id: number,
  updatedAt: string | undefined,
  payload: Record<string, unknown>
): AppNotification | null {
  const message = optionalText(payload.message)
  if (!message) return null

  const startsAt = optionalTimestamp(payload.startsAt ?? payload.starts_at)
  const endsAt = optionalTimestamp(payload.endsAt ?? payload.ends_at)
  const now = Date.now()
  if (startsAt && Date.parse(startsAt) > now) return null
  if (endsAt && Date.parse(endsAt) <= now) return null

  const level = payload.level
  return {
    id,
    title: optionalText(payload.title),
    message,
    level: level === 'success' || level === 'warning' || level === 'error' ? level : 'info',
    linkLabel: optionalText(payload.linkLabel ?? payload.link_label),
    linkUrl: safeLinkUrl(payload.linkUrl ?? payload.link_url),
    startsAt,
    endsAt,
    updatedAt
  }
}

export async function getActiveAppNotification(): Promise<AppNotification | null> {
  const settings = await listActiveSystemSettingsByKeys([APP_NOTIFICATION_SETTING_KEY])
  const setting = settings.get(APP_NOTIFICATION_SETTING_KEY)
  const value = String(setting?.value || '').trim()
  if (!setting || !value) return null

  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed === 'string') {
      return buildNotification(setting.id, setting.updatedAt, { message: parsed })
    }
    return isRecord(parsed)
      ? buildNotification(setting.id, setting.updatedAt, parsed)
      : null
  } catch {
    return buildNotification(setting.id, setting.updatedAt, { message: value })
  }
}
