/** Metadata only: never alters outgoing content, opt-out links or delivery policy. */
export interface MessageOptOutSource {
  version: 1
  optOutId: string
  zaloGlobalId: string
  zaloName: string | null
  zaloAvatar: string | null
  sentAt: string
}

export function buildMessageOptOutSource(
  optOutId: string | null | undefined,
  target: { globalId?: string | null; displayName?: string | null; originalName?: string | null; avatar?: string | null; raw?: unknown },
  sentAt: string | null | undefined
): MessageOptOutSource | undefined {
  if (!optOutId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(optOutId)
    || !target.globalId?.trim() || !sentAt || !Number.isFinite(Date.parse(sentAt))) return undefined
  const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const raw = object(target.raw)
  const profile = object(raw.profile)
  const data = object(raw.data)
  const user = object(raw.user)
  const text = (...values: unknown[]) => values.find(value => typeof value === 'string' && value.trim()) as string | undefined
  return {
    version: 1,
    optOutId,
    zaloGlobalId: target.globalId.trim(),
    zaloName: target.displayName?.trim() || target.originalName?.trim() || null,
    zaloAvatar: text(target.avatar, raw.profileAvatar, raw.avatar, profile.avatar, data.avatar, user.avatar)?.trim() || null,
    sentAt
  }
}
