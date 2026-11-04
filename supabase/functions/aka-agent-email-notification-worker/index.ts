import { createClient } from 'jsr:@supabase/supabase-js@2'

type WorkerMode = 'process' | 'daily' | 'all'

type SettingsRow = {
  staff_id: number
  is_enabled: boolean
  recipient_emails: string[] | null
  notify_campaign_completed: boolean
  daily_report_enabled: boolean
  daily_report_time: string
}

type DeliveryRow = {
  id: number
  staff_id: number
  type: 'campaign_completed' | 'daily_report'
  dedupe_key: string
  status: string
  attempt_count: number
  retry_count: number
  max_retry_count: number
  payload: Record<string, unknown>
}

type CampaignRow = {
  id: number
  name: string
  status: string
  action_id?: string | null
  account_id?: number | null
  completed_at?: string | null
  last_run_at?: string | null
  updated_at?: string | null
  auto_accounts?: { name?: string | null } | { name?: string | null }[] | null
  auto_campaign_actions?: { name?: string | null } | { name?: string | null }[] | null
}

type DetailRow = {
  campaign_id: number
  action_name?: string | null
  status?: string | null
  log?: string | null
  created_at?: string | null
}

const jsonHeaders = { 'Content-Type': 'application/json' }
const retryDelaysMinutes = [5, 15, 30]
const campaignSelect = 'id, name, status, action_id, account_id, completed_at, last_run_at, updated_at, auto_accounts(name), auto_campaign_actions(name)'

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders })
}

function validateInternalToken(req: Request): boolean {
  const expected = Deno.env.get('INTERNAL_EDGE_FUNCTION_TOKEN')?.trim()
  return !!expected && req.headers.get('x-internal-token') === expected
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function normalizeEmails(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[,\n;]/)
      : []

  const seen = new Set<string>()
  const emails: string[] = []
  for (const raw of values) {
    const email = String(raw || '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    emails.push(email)
  }
  return emails
}

function getVietnamDateKey(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

function getVietnamTimeMinutes(date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const hour = Number(parts.find(part => part.type === 'hour')?.value || '0')
  const minute = Number(parts.find(part => part.type === 'minute')?.value || '0')
  return hour * 60 + minute
}

function parseTimeMinutes(value: string | null | undefined): number {
  const [hour = '18', minute = '00'] = String(value || '18:00').split(':')
  const h = Number(hour)
  const m = Number(minute)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 18 * 60
  return Math.max(0, Math.min(23, h)) * 60 + Math.max(0, Math.min(59, m))
}

function formatTimeKey(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function vietnamDayBounds(dateKey: string): { startIso: string; endIso: string } {
  const start = new Date(`${dateKey}T00:00:00+07:00`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function joinedName(value: CampaignRow['auto_accounts'] | CampaignRow['auto_campaign_actions']): string {
  if (Array.isArray(value)) return value[0]?.name || '-'
  return value?.name || '-'
}

function summarizeDetails(details: DetailRow[]): Record<string, number> {
  return details.reduce<Record<string, number>>((acc, detail) => {
    const status = detail.status || 'khác'
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})
}

function countText(counts: Record<string, number>): string {
  const success = counts['thành công'] || 0
  const failed = counts['thất bại'] || 0
  const error = counts['lỗi'] || 0
  return `Thành công: ${success} • Thất bại: ${failed} • Lỗi: ${error}`
}

function emailShell(title: string, body: string): string {
  return `
    <div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5">
      <h2 style="margin:0 0 14px;font-size:20px;color:#111827">${escapeHtml(title)}</h2>
      ${body}
    </div>
  `
}

function renderTable(headers: string[], rows: string[][]): string {
  return `
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:12px;font-size:13px">
      <thead>
        <tr>
          ${headers.map(header => `<th style="text-align:left;border:1px solid #e5e7eb;background:#f9fafb;padding:8px">${escapeHtml(header)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            ${row.map(cell => `<td style="border:1px solid #e5e7eb;padding:8px;vertical-align:top">${escapeHtml(cell)}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

const supabase = createClient(
  getRequiredEnv('SUPABASE_URL'),
  getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } }
)

async function getSettings(staffId: number): Promise<SettingsRow | null> {
  const { data, error } = await supabase
    .from('auto_email_notification_settings')
    .select('*')
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .maybeSingle()

  if (error) throw error
  return data as SettingsRow | null
}

async function listCampaignDetails(campaignId: number, startIso?: string, endIso?: string): Promise<DetailRow[]> {
  let query = supabase
    .from('auto_campaign_details')
    .select('campaign_id, action_name, status, log, created_at')
    .eq('campaign_id', campaignId)
    .eq('is_delete', false)
    .order('created_at', { ascending: true })
    .limit(1000)

  if (startIso) query = query.gte('created_at', startIso)
  if (endIso) query = query.lt('created_at', endIso)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as DetailRow[]
}

async function fetchCampaign(campaignId: number): Promise<CampaignRow> {
  const { data, error } = await supabase
    .from('auto_campaigns')
    .select(campaignSelect)
    .eq('id', campaignId)
    .eq('is_delete', false)
    .single()

  if (error) throw error
  return data as CampaignRow
}

async function buildCampaignCompletedEmail(delivery: DeliveryRow): Promise<{ subject: string; html: string }> {
  const campaignId = Number(delivery.payload?.campaignId)
  if (!campaignId) throw new Error('Missing campaignId in delivery payload')

  const campaign = await fetchCampaign(campaignId)
  const completedDateKey = getVietnamDateKey(new Date(campaign.completed_at || String(delivery.payload?.completedAt || new Date().toISOString())))
  const bounds = vietnamDayBounds(completedDateKey)
  const [allDetails, todayDetails] = await Promise.all([
    listCampaignDetails(campaign.id),
    listCampaignDetails(campaign.id, bounds.startIso, bounds.endIso)
  ])

  const allCounts = summarizeDetails(allDetails)
  const todayCounts = summarizeDetails(todayDetails)
  const recentRows = todayDetails.slice(-10).reverse().map(detail => [
    formatDateTime(detail.created_at),
    detail.action_name || '-',
    detail.status || '-',
    detail.log || '-'
  ])

  const html = emailShell(`Chiến dịch hoàn thành: ${campaign.name}`, `
    <p><strong>Tài khoản:</strong> ${escapeHtml(joinedName(campaign.auto_accounts))}</p>
    <p><strong>Trạng thái:</strong> ${escapeHtml(campaign.status)}</p>
    <p><strong>Hoàn thành lúc:</strong> ${escapeHtml(formatDateTime(campaign.completed_at))}</p>
    <p><strong>Kết quả toàn bộ:</strong> ${escapeHtml(countText(allCounts))}</p>
    <p><strong>Kết quả hôm nay:</strong> ${escapeHtml(countText(todayCounts))}</p>
    ${recentRows.length > 0 ? renderTable(['Thời gian', 'Hành động', 'Trạng thái', 'Nội dung'], recentRows) : ''}
  `)

  return {
    subject: `Chiến dịch hoàn thành: ${campaign.name}`,
    html
  }
}

async function findDailyCampaigns(staffId: number, startIso: string, endIso: string): Promise<CampaignRow[]> {
  const { data: runCampaigns, error: runError } = await supabase
    .from('auto_campaigns')
    .select(campaignSelect)
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .gte('last_run_at', startIso)
    .lt('last_run_at', endIso)
    .limit(500)
  if (runError) throw runError

  const { data: todayDetails, error: detailsError } = await supabase
    .from('auto_campaign_details')
    .select('campaign_id')
    .eq('is_delete', false)
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .limit(2000)
  if (detailsError) throw detailsError

  const campaignIds = new Set<number>((runCampaigns || []).map((row: { id: number }) => row.id))
  for (const detail of todayDetails || []) {
    const id = Number((detail as { campaign_id?: number }).campaign_id)
    if (id) campaignIds.add(id)
  }

  if (campaignIds.size === 0) return []

  const { data: campaigns, error } = await supabase
    .from('auto_campaigns')
    .select(campaignSelect)
    .eq('staff_id', staffId)
    .eq('is_delete', false)
    .in('id', Array.from(campaignIds))
    .limit(500)
  if (error) throw error

  return (campaigns || []) as CampaignRow[]
}

async function buildDailyReportEmail(delivery: DeliveryRow): Promise<{ subject: string; html: string }> {
  const dateKey = String(delivery.payload?.dateKey || getVietnamDateKey())
  const bounds = vietnamDayBounds(dateKey)
  const campaigns = await findDailyCampaigns(delivery.staff_id, bounds.startIso, bounds.endIso)
  if (campaigns.length === 0) throw new Error('Không có chiến dịch cập nhật trong ngày.')

  const detailsByCampaign = new Map<number, DetailRow[]>()
  const { data: details, error } = await supabase
    .from('auto_campaign_details')
    .select('campaign_id, action_name, status, log, created_at')
    .eq('is_delete', false)
    .gte('created_at', bounds.startIso)
    .lt('created_at', bounds.endIso)
    .in('campaign_id', campaigns.map(campaign => campaign.id))
    .limit(3000)
  if (error) throw error

  for (const detail of (details || []) as DetailRow[]) {
    const list = detailsByCampaign.get(detail.campaign_id) || []
    list.push(detail)
    detailsByCampaign.set(detail.campaign_id, list)
  }

  const rows = campaigns
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'vi'))
    .map(campaign => {
      const detailsForCampaign = detailsByCampaign.get(campaign.id) || []
      const counts = summarizeDetails(detailsForCampaign)
      return [
        campaign.name,
        joinedName(campaign.auto_accounts),
        joinedName(campaign.auto_campaign_actions),
        campaign.status,
        countText(counts)
      ]
    })

  const html = emailShell(`Báo cáo chiến dịch ngày ${dateKey}`, `
    <p><strong>Số chiến dịch có cập nhật:</strong> ${campaigns.length}</p>
    ${renderTable(['Chiến dịch', 'Tài khoản', 'Loại', 'Trạng thái', 'Kết quả hôm nay'], rows)}
  `)

  return {
    subject: `Báo cáo chiến dịch ngày ${dateKey}`,
    html
  }
}

async function sendEmail(settings: SettingsRow, message: { subject: string; html: string }): Promise<void> {
  const sendEmailUrl = getRequiredEnv('SEND_EMAIL_FUNCTION_URL')
  const token = getRequiredEnv('INTERNAL_EDGE_FUNCTION_TOKEN')
  const recipients = normalizeEmails(settings.recipient_emails)

  if (!settings.is_enabled || recipients.length === 0) {
    throw new Error('Thông báo email đã tắt hoặc chưa có email nhận.')
  }

  const response = await fetch(sendEmailUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-token': token
    },
    body: JSON.stringify({
      to: recipients,
      subject: message.subject,
      html: message.html
    })
  })

  const data = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `send-email failed with HTTP ${response.status}`)
  }
}

async function markDeliverySent(deliveryId: number): Promise<void> {
  const { error } = await supabase
    .from('auto_email_notification_deliveries')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      last_error: null,
      locked_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', deliveryId)
  if (error) throw error
}

async function markDeliveryFailed(delivery: DeliveryRow, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : 'Không thể gửi email.'
  const retryCount = delivery.retry_count || 0
  const maxRetryCount = delivery.max_retry_count || 3

  if (retryCount >= maxRetryCount) {
    const { error } = await supabase
      .from('auto_email_notification_deliveries')
      .update({
        status: 'failed',
        last_error: message,
        locked_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', delivery.id)
    if (error) throw error
    return
  }

  const delayMinutes = retryDelaysMinutes[Math.min(retryCount, retryDelaysMinutes.length - 1)]
  const { error } = await supabase
    .from('auto_email_notification_deliveries')
    .update({
      status: 'retrying',
      retry_count: retryCount + 1,
      next_attempt_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
      last_error: message,
      locked_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', delivery.id)
  if (error) throw error
}

async function enqueueDueDailyReports(): Promise<number> {
  const nowMinutes = getVietnamTimeMinutes()
  const dateKey = getVietnamDateKey()
  const bounds = vietnamDayBounds(dateKey)
  const { data, error } = await supabase
    .from('auto_email_notification_settings')
    .select('*')
    .eq('is_delete', false)
    .eq('is_enabled', true)
    .eq('daily_report_enabled', true)

  if (error) throw error

  let enqueued = 0
  for (const setting of (data || []) as SettingsRow[]) {
    if (normalizeEmails(setting.recipient_emails).length === 0) continue
    const reportMinutes = parseTimeMinutes(setting.daily_report_time)
    if (nowMinutes < reportMinutes) continue

    const campaigns = await findDailyCampaigns(setting.staff_id, bounds.startIso, bounds.endIso)
    if (campaigns.length === 0) continue

    const reportTime = formatTimeKey(reportMinutes)
    const dedupeKey = `daily:${setting.staff_id}:${dateKey}:${reportTime}`
    const { error: insertError } = await supabase
      .from('auto_email_notification_deliveries')
      .upsert({
        staff_id: setting.staff_id,
        type: 'daily_report',
        dedupe_key: dedupeKey,
        payload: {
          staffId: setting.staff_id,
          dateKey,
          reportTime,
          dayStart: bounds.startIso,
          dayEnd: bounds.endIso
        }
      }, { onConflict: 'dedupe_key', ignoreDuplicates: true })

    if (insertError) throw insertError
    enqueued += 1
  }

  return enqueued
}

async function processDeliveries(): Promise<{ processed: number; sent: number; failed: number }> {
  const { data, error } = await supabase.rpc('aka_agent_claim_email_notification_deliveries', { p_limit: 10 })
  if (error) throw error

  const deliveries = (data || []) as DeliveryRow[]
  let sent = 0
  let failed = 0

  for (const delivery of deliveries) {
    try {
      const settings = await getSettings(delivery.staff_id)
      if (!settings) throw new Error('Chưa cấu hình thông báo email.')

      const message = delivery.type === 'campaign_completed'
        ? await buildCampaignCompletedEmail(delivery)
        : await buildDailyReportEmail(delivery)

      await sendEmail(settings, message)
      await markDeliverySent(delivery.id)
      sent += 1
    } catch (err) {
      await markDeliveryFailed(delivery, err)
      failed += 1
    }
  }

  return { processed: deliveries.length, sent, failed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 })
  if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'Method not allowed' })
  if (!validateInternalToken(req)) return jsonResponse(401, { ok: false, error: 'Unauthorized' })

  try {
    const body = await req.json().catch(() => ({})) as { mode?: WorkerMode }
    const mode: WorkerMode = body.mode === 'daily' || body.mode === 'process' || body.mode === 'all'
      ? body.mode
      : 'all'

    const result = {
      dailyEnqueued: 0,
      processed: 0,
      sent: 0,
      failed: 0
    }

    if (mode === 'daily' || mode === 'all') {
      result.dailyEnqueued = await enqueueDueDailyReports()
    }

    if (mode === 'process' || mode === 'daily' || mode === 'all') {
      const processed = await processDeliveries()
      result.processed = processed.processed
      result.sent = processed.sent
      result.failed = processed.failed
    }

    return jsonResponse(200, { ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Worker failed'
    return jsonResponse(500, { ok: false, error: message })
  }
})
