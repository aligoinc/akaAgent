/**
 * Tự thêm người được gắn tag Zalo vào chiến dịch "Nhắn tin bạn bè" (V660, docs/ZALO_TAG_AUTO_SEND_PLAN.md): phần dùng chung của
 * Desktop / App Server (bộ chạy cũ, dịch vụ hỏi tag, form). Lõi engine có bản riêng ở packages/campaign-engine/src/zalo/tagAutoAdd.ts.
 */

/** Khoá `control_append_idempotency_key` của dòng data do DB thêm: `zalotag:<chiến dịch>:<uid>`. */
export const ZALO_TAG_AUTO_ADD_KEY_PREFIX = 'zalotag:'
export const ZALO_TAG_NOT_FRIEND_NOTE = 'Chưa là bạn bè nên không gửi'

export function isZaloTagAutoAddInput(input: { controlAppendIdempotencyKey?: string | null } | null | undefined): boolean {
  return String(input?.controlAppendIdempotencyKey ?? '').startsWith(ZALO_TAG_AUTO_ADD_KEY_PREFIX)
}

/** Chiến dịch có đang bật "tự gửi cho người được gắn tag" (cùng điều kiện với trigger của V660). */
export function isZaloTagAutoAddEnabled(campaign: {
  actionId?: string | null
  extraSettings?: Record<string, unknown> | null
}): boolean {
  const extra = campaign.extraSettings ?? {}
  return campaign.actionId === 'zalo_message_friend'
    && extra.zaloFriendTargetMode === 'tagged_friends'
    && extra.zaloFriendTagAutoAddEnabled === true
}

// ---- Hợp đồng với DB (V660) ----

export const ZALO_TAG_SYNC_DESKTOP_ACCOUNTS_RPC = 'aka_agent_desktop_zalo_tag_sync_accounts'
export const ZALO_TAG_SYNC_DESKTOP_RPC = 'aka_agent_desktop_sync_zalo_tags'
export const ZALO_TAG_SYNC_ACCOUNTS_RPC = 'aka_agent_zalo_tag_sync_accounts'
export const ZALO_TAG_SYNC_RPC = 'aka_agent_sync_zalo_tags'
export const ZALO_TAG_AUTO_ADD_DESKTOP_SET_RPC = 'aka_agent_desktop_set_campaign_zalo_tag_auto_add'

export interface ZaloTagSyncAccounts {
  enabled: boolean
  pollSeconds: number
  accountIds: number[]
}

export interface ZaloTagSnapshotTag {
  id: string
  name?: string
  /** Mã hội thoại như Zalo trả (nhóm có tiền tố "g"). */
  m: string[]
}

export interface ZaloTagSyncItem {
  a: string
  v: string
  tags?: ZaloTagSnapshotTag[]
}

export interface ZaloTagSyncResult {
  enabled: boolean
  pollSeconds: number
  needTags: number[]
  rejected: number[]
  baselined: number[]
  added: number
  removed: number
  campaignRows: number
}

const ids = (value: unknown): number[] =>
  (Array.isArray(value) ? value : [])
    .map(item => Number(item))
    .filter(item => Number.isSafeInteger(item) && item > 0)

const pollSeconds = (value: unknown): number => {
  const seconds = Number(value)
  return Number.isFinite(seconds) ? Math.min(600, Math.max(30, Math.floor(seconds))) : 60
}

export function parseZaloTagSyncAccounts(value: unknown): ZaloTagSyncAccounts {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return { enabled: row.enabled === true, pollSeconds: pollSeconds(row.pollSeconds), accountIds: ids(row.accountIds) }
}

export function parseZaloTagSyncResult(value: unknown): ZaloTagSyncResult {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const count = (key: string): number => {
    const n = Number(row[key])
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }
  return {
    enabled: row.enabled === true,
    pollSeconds: pollSeconds(row.pollSeconds),
    needTags: ids(row.needTags),
    rejected: ids(row.rejected),
    baselined: ids(row.baselined),
    added: count('added'),
    removed: count('removed'),
    campaignRows: count('campaignRows')
  }
}

/** Ảnh chụp tag từ `getLabels` của zca-js: mã tag, tên, mã hội thoại (bỏ trùng, bỏ rỗng). */
export function zaloTagSnapshotFromLabels(labels: ReadonlyArray<{
  id?: unknown
  text?: unknown
  conversations?: unknown
}>): ZaloTagSnapshotTag[] {
  const tags: ZaloTagSnapshotTag[] = []
  for (const label of labels) {
    const id = String(label?.id ?? '').trim()
    if (!/^[0-9A-Za-z_-]{1,40}$/.test(id)) continue
    const members = Array.from(new Set(
      (Array.isArray(label.conversations) ? label.conversations : [])
        .map(item => String(item ?? '').trim())
        .filter(item => /^g?[0-9]{1,40}$/.test(item))
    ))
    const name = String(label?.text ?? '').trim()
    tags.push({ id, ...(name ? { name } : {}), m: members })
  }
  return tags
}
