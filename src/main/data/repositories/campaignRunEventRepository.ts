import { CampaignRunEvent, CampaignRunEventInput, CampaignRunEventListOptions } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'

const client = () => getSupabaseClient()

function asJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function mapRunEventFromDB(row: Record<string, unknown>): CampaignRunEvent {
  return {
    id: row.id as number,
    campaignId: (row.campaign_id as number | null) ?? null,
    campaignActionId: (row.campaign_action_id as string | null) ?? null,
    campaignInputId: (row.campaign_input_id as number | null) ?? null,
    campaignInputDataId: (row.campaign_input_data_id as number | null) ?? null,
    accountId: (row.account_id as number | null) ?? null,
    runId: (row.run_id as number | null) ?? null,
    runStepId: (row.run_step_id as number | null) ?? null,
    nodeId: (row.node_id as string | null) ?? null,
    blockId: (row.block_id as number | null) ?? null,
    blockName: (row.block_name as string | null) ?? null,
    sequenceNo: (row.sequence_no as number | null) ?? null,
    eventType: String(row.event_type || 'info'),
    eventName: (row.event_name as string | null) ?? null,
    targetType: (row.target_type as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    isUserVisible: Boolean(row.is_user_visible),
    xpath: (row.xpath as string | null) ?? null,
    cssSelector: (row.css_selector as string | null) ?? null,
    elementCount: (row.element_count as number | null) ?? null,
    itemIndex: (row.item_index as number | null) ?? null,
    targetUrl: (row.target_url as string | null) ?? null,
    message: (row.message as string | null) ?? null,
    extractedData: asJsonObject(row.extracted_data),
    debugData: asJsonObject(row.debug_data),
    createdAt: row.created_at as string | undefined
  }
}

function toPayload(event: CampaignRunEventInput): Record<string, unknown> {
  return {
    campaign_id: event.campaignId ?? null,
    campaign_action_id: event.campaignActionId ?? null,
    campaign_input_id: event.campaignInputId ?? null,
    campaign_input_data_id: event.campaignInputDataId ?? null,
    account_id: event.accountId ?? null,
    run_id: event.runId ?? null,
    run_step_id: event.runStepId ?? null,
    node_id: event.nodeId ?? null,
    block_id: event.blockId ?? null,
    block_name: event.blockName ?? null,
    sequence_no: event.sequenceNo ?? null,
    event_type: String(event.eventType || 'info'),
    event_name: event.eventName ?? null,
    target_type: event.targetType ?? null,
    status: event.status ?? 'success',
    is_user_visible: event.isUserVisible ?? false,
    xpath: event.xpath ?? null,
    css_selector: event.cssSelector ?? null,
    element_count: event.elementCount ?? null,
    item_index: event.itemIndex ?? null,
    target_url: event.targetUrl ?? null,
    message: event.message ?? null,
    extracted_data: event.extractedData ?? {},
    debug_data: event.debugData ?? {}
  }
}

export async function createCampaignRunEvents(events: CampaignRunEventInput[]): Promise<CampaignRunEvent[]> {
  if (events.length === 0) return []
  const { data, error } = await client()
    .from('auto_campaign_run_events')
    .insert(events.map(toPayload))
    .select('*')

  if (error) throw new Error(`Failed to create campaign run events: ${error.message}`)
  return (data || []).map(mapRunEventFromDB)
}

export async function listCampaignRunEventsByCampaign(
  campaignId: number,
  options: CampaignRunEventListOptions = {}
): Promise<CampaignRunEvent[]> {
  const limit = Math.min(2000, Math.max(1, Number(options.limit || 500)))
  let query = client()
    .from('auto_campaign_run_events')
    .select('*')
    .eq('campaign_id', campaignId)

  if (options.userVisibleOnly === true) {
    query = query.eq('is_user_visible', true)
  }
  const eventTypes = Array.isArray(options.eventTypes)
    ? options.eventTypes.map(type => String(type || '').trim()).filter(Boolean)
    : []
  if (eventTypes.length > 0) {
    query = query.in('event_type', Array.from(new Set(eventTypes)))
  }

  const latest = options.latest === true
  const { data, error } = await query
    .order('created_at', { ascending: !latest })
    .order('sequence_no', { ascending: !latest })
    .order('id', { ascending: !latest })
    .limit(limit)

  if (error) throw new Error(`Failed to list campaign run events by campaign: ${error.message}`)
  const events = (data || []).map(mapRunEventFromDB)
  return latest ? events.reverse() : events
}

export async function listCampaignRunEventsByInputData(inputDataId: number, limit = 500): Promise<CampaignRunEvent[]> {
  const { data, error } = await client()
    .from('auto_campaign_run_events')
    .select('*')
    .eq('campaign_input_data_id', inputDataId)
    .order('created_at', { ascending: true })
    .order('sequence_no', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Failed to list campaign run events by input data: ${error.message}`)
  return (data || []).map(mapRunEventFromDB)
}

export async function findLatestBrowserScreenshotEvent(options: {
  campaignId: number
  campaignInputDataId?: number | null
  runId?: number | null
}): Promise<CampaignRunEvent | null> {
  let query = client()
    .from('auto_campaign_run_events')
    .select('*')
    .eq('campaign_id', options.campaignId)
    .eq('event_type', 'browser_screenshot')

  if (options.campaignInputDataId) {
    query = query.eq('campaign_input_data_id', options.campaignInputDataId)
  }
  if (options.runId) {
    query = query.eq('run_id', options.runId)
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(20)

  if (error) throw new Error(`Failed to find latest browser screenshot event: ${error.message}`)
  const rows = (data || []).map(mapRunEventFromDB)
  return rows.find(row => {
    const screenshotPath = row.debugData?.screenshotPath
    return typeof screenshotPath === 'string' && screenshotPath.trim().length > 0
  }) || null
}
