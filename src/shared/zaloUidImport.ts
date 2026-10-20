/** Direct campaign uploads use Zalo UIDs, independently of the group-member picker. */
export const isZaloUidImportAction = (actionId?: string | null): boolean =>
  actionId === 'zalo_message_group_member'

export const normalizeZaloImportUid = (value: unknown): string => {
  // A rounded Excel/JSON number cannot be recovered into the original recipient.
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  const uid = String(value).replace(/\s+/g, '')
  return /^\d{5,30}$/.test(uid) ? uid : ''
}
