import { createHash } from 'node:crypto'

// Only persisted configuration, never the append-only log or runtime progress.
// Keep schedule as well as original_schedule: the editor can write both.
const fields = [
  'name', 'action_id', 'account_id', 'secondary_account_id', 'schedule', 'original_schedule',
  'schedule_type', 'schedule_end_date', 'daily_stop_time', 'schedule_days', 'schedule_week_days',
  'continue_next_day', 'refresh_data', 'content', 'extra_settings', 'images',
  'data_target_source_mode', 'data_group_id', 'provisioning_state',
  'creation_bundle_id', 'creation_bundle_child_index'
] as const

export function getCampaignEditVersion(row: Record<string, unknown>): string {
  const snapshot = JSON.stringify(fields.map(field => row[field] ?? null), (_key, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]))
  })
  return createHash('sha256').update(snapshot).digest('hex')
}
