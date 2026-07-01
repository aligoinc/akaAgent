import { getSupabaseClient } from '../supabaseClient'
import type { EmailCampaignLinkTrackingSummary } from '../../../shared/types'

const client = () => getSupabaseClient()

export interface CreateEmailMessageTrackingInput {
  campaignId: number
  accountId?: number | null
  inputDataId?: number | null
  recipientEmail: string
  recipientName?: string | null
  subject?: string | null
}

export interface EmailMessageTrackingRecord {
  id: number
  openToken: string
  openCount: number
  clickCount: number
}

export interface CreateEmailLinkTrackingInput {
  messageTrackingId: number
  originalUrl: string
  linkIndex: number
}

export interface EmailLinkTrackingRecord {
  id: number
  clickToken: string
  originalUrl: string
  linkIndex: number
}

function mapMessageTracking(row: Record<string, unknown>): EmailMessageTrackingRecord {
  return {
    id: Number(row.id),
    openToken: String(row.open_token || ''),
    openCount: Number(row.open_count || 0),
    clickCount: Number(row.click_count || 0)
  }
}

function mapLinkTrackingSummary(row: Record<string, unknown>): EmailCampaignLinkTrackingSummary {
  return {
    url: String(row.url || ''),
    emailCount: Number(row.email_count || 0),
    linkCount: Number(row.link_count || 0),
    clickCount: Number(row.click_count || 0),
    firstClickedAt: typeof row.first_clicked_at === 'string' ? row.first_clicked_at : null,
    lastClickedAt: typeof row.last_clicked_at === 'string' ? row.last_clicked_at : null,
    firstTrackedAt: typeof row.first_tracked_at === 'string' ? row.first_tracked_at : null,
    lastTrackedAt: typeof row.last_tracked_at === 'string' ? row.last_tracked_at : null
  }
}

function mapLinkTracking(row: Record<string, unknown>): EmailLinkTrackingRecord {
  return {
    id: Number(row.id),
    clickToken: String(row.click_token || ''),
    originalUrl: String(row.original_url || ''),
    linkIndex: Number(row.link_index || 0)
  }
}

export async function createEmailMessageTracking(
  input: CreateEmailMessageTrackingInput
): Promise<EmailMessageTrackingRecord> {
  const { data, error } = await client()
    .from('auto_email_message_trackings')
    .insert({
      campaign_id: input.campaignId,
      account_id: input.accountId ?? null,
      input_data_id: input.inputDataId ?? null,
      recipient_email: input.recipientEmail,
      recipient_name: input.recipientName || null,
      subject: input.subject || null
    })
    .select('id, open_token, open_count, click_count')
    .single()

  if (error) throw new Error(`Failed to create email message tracking: ${error.message}`)
  return mapMessageTracking(data)
}

export async function createEmailLinkTrackings(
  rows: CreateEmailLinkTrackingInput[]
): Promise<EmailLinkTrackingRecord[]> {
  if (rows.length === 0) return []

  const { data, error } = await client()
    .from('auto_email_link_trackings')
    .insert(rows.map(row => ({
      message_tracking_id: row.messageTrackingId,
      original_url: row.originalUrl,
      link_index: row.linkIndex
    })))
    .select('id, click_token, original_url, link_index')

  if (error) throw new Error(`Failed to create email link trackings: ${error.message}`)
  return (data || []).map(row => mapLinkTracking(row))
}

export async function markEmailMessageTrackingSent(
  messageTrackingId: number,
  messageId?: string | null
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await client()
    .from('auto_email_message_trackings')
    .update({
      message_id: messageId || null,
      sent_at: now,
      updated_at: now
    })
    .eq('id', messageTrackingId)

  if (error) throw new Error(`Failed to mark email message tracking sent: ${error.message}`)
}

export async function softDeleteEmailMessageTracking(messageTrackingId: number): Promise<void> {
  const now = new Date().toISOString()
  const { error: linkError } = await client()
    .from('auto_email_link_trackings')
    .update({
      is_delete: true,
      updated_at: now
    })
    .eq('message_tracking_id', messageTrackingId)

  if (linkError) throw new Error(`Failed to delete email link trackings: ${linkError.message}`)

  const { error } = await client()
    .from('auto_email_message_trackings')
    .update({
      is_delete: true,
      updated_at: now
    })
    .eq('id', messageTrackingId)

  if (error) throw new Error(`Failed to delete email message tracking: ${error.message}`)
}

export async function linkEmailMessageTrackingToDetail(
  messageTrackingId: number,
  campaignDetailId: number
): Promise<void> {
  const { data, error } = await client()
    .from('auto_email_message_trackings')
    .update({
      campaign_detail_id: campaignDetailId,
      updated_at: new Date().toISOString()
    })
    .eq('id', messageTrackingId)
    .eq('is_delete', false)
    .select('id, open_count, click_count')
    .maybeSingle()

  if (error) throw new Error(`Failed to link email tracking detail: ${error.message}`)
  if (!data) return

  const openCount = Number(data.open_count || 0)
  const clickCount = Number(data.click_count || 0)
  if (clickCount > 0) {
    const { error: detailError } = await client()
      .from('auto_campaign_details')
      .update({ status: 'đã click' })
      .eq('id', campaignDetailId)
      .eq('action_code', 'email_send')
      .in('status', ['thành công', 'đã xem'])
      .eq('is_delete', false)
    if (detailError) throw new Error(`Failed to apply email click detail status: ${detailError.message}`)
    return
  }

  if (openCount > 0) {
    const { error: detailError } = await client()
      .from('auto_campaign_details')
      .update({ status: 'đã xem' })
      .eq('id', campaignDetailId)
      .eq('action_code', 'email_send')
      .eq('status', 'thành công')
      .eq('is_delete', false)
    if (detailError) throw new Error(`Failed to apply email open detail status: ${detailError.message}`)
  }
}

export async function listEmailCampaignLinkTrackingSummaries(
  campaignId: number
): Promise<EmailCampaignLinkTrackingSummary[]> {
  const { data, error } = await client()
    .rpc('aka_agent_list_email_campaign_link_tracking_summaries', {
      p_campaign_id: campaignId
    })

  if (error) throw new Error(`Failed to list email link tracking summaries: ${error.message}`)
  return ((data || []) as Record<string, unknown>[]).map(row => mapLinkTrackingSummary(row))
}
