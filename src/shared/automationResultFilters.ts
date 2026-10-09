/** Keep omission distinct from explicit null for old Automation clients. */
export function automationSubStatusField(row: Record<string, unknown>): { subStatusIds?: number[] | null } {
  const key = Object.prototype.hasOwnProperty.call(row, 'subStatusIds') ? 'subStatusIds'
    : Object.prototype.hasOwnProperty.call(row, 'sub_status_ids') ? 'sub_status_ids' : null
  if (!key || row[key] === undefined) return {}
  const value = row[key]
  if (value === null) return { subStatusIds: null }
  if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error('invalid_automation_sub_status_ids')
  }
  return { subStatusIds: Array.from(new Set(value)).sort((a, b) => a - b) }
}

export function automationSubFilterCovers(wildcard?: number[] | null, specific?: number[] | null): boolean {
  return wildcard == null || (specific != null && specific.every(id => wildcard.includes(id)))
}
