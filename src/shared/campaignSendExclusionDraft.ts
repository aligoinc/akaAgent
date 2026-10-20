/** Draft-only intent; never included in campaign settings or AI context. */
export const PENDING_BLOCKLIST_MESSAGE = 'Bạn đã bật loại trừ theo danh sách nhưng chưa chọn danh sách. Hãy chọn danh sách hoặc bấm “Bỏ yêu cầu loại trừ danh sách”.'

export function restorePendingBlocklistAccount(settings: Record<string, unknown>, accountId?: number): number | null {
  if (settings.zaloPendingBlocklistAccountId !== undefined) return settings.zaloPendingBlocklistAccountId as number | null
  // An explicit new selection, including an empty one, takes precedence over legacy controls.
  if (settings.zaloSendExclusionsByAccountId !== undefined) return null
  return accountId && settings.zaloFriendBlocklistEnabled === true && !settings.zaloFriendBlocklistId ? accountId : null
}
