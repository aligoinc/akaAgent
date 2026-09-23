// Keep this dependency-free contract identical to Chat runtime-protocol.
export function readZaloApiFriendStatus(raw: unknown): boolean | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const envelope = raw as Record<string, unknown>
  const value = envelope.profile ?? envelope.user ?? envelope
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const profile = value as Record<string, unknown>
  for (const key of ['isFr', 'is_fr', 'is_friend']) {
    const status = profile[key]
    if (status === 1 || status === '1' || status === true) return true
    if (status === 0 || status === '0' || status === false) return false
  }
  return null
}

export function normalizeZaloSkipTagIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(id => String(id ?? '').trim()).filter(id => /^[1-9][0-9]*$/.test(id))))
}

export interface ZaloAccountTagSettings {
  zaloTagId: string
  zaloTagName: string
  zaloTagSkipTagIds: string[]
  zaloTagSkipTagNames: string[]
}

export type ZaloTagSettingsByAccountId = Record<string, ZaloAccountTagSettings>

export function normalizeZaloAccountTagSettings(value: unknown): ZaloAccountTagSettings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const rawIds = Array.isArray(source.zaloTagSkipTagIds) ? source.zaloTagSkipTagIds.map(String) : []
  const rawNames = Array.isArray(source.zaloTagSkipTagNames) ? source.zaloTagSkipTagNames : []
  const ids = normalizeZaloSkipTagIds(rawIds)
  return {
    zaloTagId: normalizeZaloSkipTagIds([source.zaloTagId])[0] || '',
    zaloTagName: String(source.zaloTagName ?? ''),
    zaloTagSkipTagIds: ids,
    zaloTagSkipTagNames: ids.map(id => String(rawNames[rawIds.findIndex(raw => raw.trim() === id)] ?? ''))
  }
}

/** A present account map is authoritative; never borrow another account's labels. */
export function resolveZaloAccountTagSettings(value: unknown, accountId: number | string): ZaloAccountTagSettings | null {
  const extra = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  if (extra.zaloTagSettingsByAccountId === undefined) return normalizeZaloAccountTagSettings(extra)
  const map = extra.zaloTagSettingsByAccountId
  if (!map || typeof map !== 'object' || Array.isArray(map) || !Object.prototype.hasOwnProperty.call(map, String(accountId))) return null
  const settings = (map as Record<string, unknown>)[String(accountId)]
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  return normalizeZaloAccountTagSettings(settings)
}

/** Persist only the account(s) belonging to this campaign, including its fallback. */
export function pickZaloAccountTagSettings(settings: ZaloTagSettingsByAccountId, accountIds: Array<number | string>): ZaloTagSettingsByAccountId {
  return Object.fromEntries(accountIds.flatMap(id => Object.prototype.hasOwnProperty.call(settings, String(id))
    ? [[String(id), normalizeZaloAccountTagSettings(settings[String(id)])]] : []))
}

export interface ZaloLabelSkipResult {
  skipped: true
  reason: 'excluded_tag'
  matchedLabelIds: string[]
  matchedLabelNames: string[]
}

export function findZaloExcludedLabels(
  labels: Array<{ id: number | string; text?: string; conversations?: string[] }>,
  uid: string,
  skipLabelIds: unknown
): ZaloLabelSkipResult | null {
  const excluded = new Set(normalizeZaloSkipTagIds(skipLabelIds))
  const matches = labels.filter(label => excluded.has(String(label.id)) &&
    label.conversations?.some(value => String(value).trim() === uid.trim()))
  return matches.length === 0 ? null : {
    skipped: true,
    reason: 'excluded_tag',
    matchedLabelIds: matches.map(label => String(label.id)),
    matchedLabelNames: matches.map(label => label.text || String(label.id))
  }
}

export function isZaloLabelSkipResult(value: unknown): value is ZaloLabelSkipResult {
  if (!value || typeof value !== 'object') return false
  const result = value as Partial<ZaloLabelSkipResult>
  return result.skipped === true && result.reason === 'excluded_tag' &&
    Array.isArray(result.matchedLabelIds) && result.matchedLabelIds.every(id => typeof id === 'string') &&
    Array.isArray(result.matchedLabelNames) && result.matchedLabelNames.every(name => typeof name === 'string')
}
