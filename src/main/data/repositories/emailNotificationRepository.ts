import { EmailNotificationSettings } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser } from '../currentUser'

const client = () => getSupabaseClient()
const DEFAULT_DAILY_REPORT_TIME = '18:00'

function normalizeEmails(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n;]/)
      : []

  const seen = new Set<string>()
  const emails: string[] = []
  for (const raw of rawValues) {
    const email = String(raw || '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

function normalizeDailyReportTime(value: unknown): string {
  const text = String(value || '').trim()
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(text)) return text.slice(0, 5)
  return DEFAULT_DAILY_REPORT_TIME
}

function defaultSettings(): EmailNotificationSettings {
  const u = requireCurrentUser()
  return {
    staffId: u.staffId,
    organizationId: u.organizationId,
    isEnabled: false,
    recipientEmails: [],
    notifyCampaignCompleted: true,
    dailyReportEnabled: false,
    dailyReportTime: DEFAULT_DAILY_REPORT_TIME,
    isDelete: false
  }
}

function mapEmailNotificationSettingsFromDB(row: Record<string, unknown>): EmailNotificationSettings {
  return {
    id: row.id as number,
    staffId: row.staff_id as number,
    organizationId: (row.organization_id as number | null) ?? null,
    isEnabled: (row.is_enabled as boolean) ?? false,
    recipientEmails: normalizeEmails(row.recipient_emails),
    notifyCampaignCompleted: (row.notify_campaign_completed as boolean) ?? true,
    dailyReportEnabled: (row.daily_report_enabled as boolean) ?? false,
    dailyReportTime: normalizeDailyReportTime(row.daily_report_time),
    isDelete: (row.is_delete as boolean) ?? false,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export async function getEmailNotificationSettings(): Promise<EmailNotificationSettings> {
  const u = requireCurrentUser()
  const { data, error } = await client()
    .from('auto_email_notification_settings')
    .select('*')
    .eq('staff_id', u.staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw new Error(`Failed to get email notification settings: ${error.message}`)
  return data ? mapEmailNotificationSettingsFromDB(data) : defaultSettings()
}

export async function saveEmailNotificationSettings(
  settings: Partial<EmailNotificationSettings>
): Promise<EmailNotificationSettings> {
  const u = requireCurrentUser()
  const recipientEmails = normalizeEmails(settings.recipientEmails)
  if (settings.isEnabled && recipientEmails.length === 0) {
    throw new Error('Vui lòng nhập ít nhất một email nhận thông báo.')
  }

  const payload = {
    staff_id: u.staffId,
    organization_id: u.organizationId,
    is_enabled: settings.isEnabled ?? false,
    recipient_emails: recipientEmails,
    notify_campaign_completed: settings.notifyCampaignCompleted ?? true,
    daily_report_enabled: settings.dailyReportEnabled ?? false,
    daily_report_time: normalizeDailyReportTime(settings.dailyReportTime),
    is_delete: false,
    updated_at: new Date().toISOString()
  }

  const { data, error } = await client()
    .from('auto_email_notification_settings')
    .upsert(payload, { onConflict: 'staff_id' })
    .select()
    .single()

  if (error) throw new Error(`Failed to save email notification settings: ${error.message}`)
  return mapEmailNotificationSettingsFromDB(data)
}
