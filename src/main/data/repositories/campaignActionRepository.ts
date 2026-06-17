import { CampaignAction } from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapCampaignActionFromDB } from '../mappers'
import {
  canCurrentUserUseEmailFeature,
} from './entitlementRepository'

const client = () => getSupabaseClient()
const EMAIL_PLATFORM = 'email'
const EMAIL_SEND_ACTION_ID = 'email_send'

export async function listCampaignActions(): Promise<CampaignAction[]> {
  const canUseEmailFeature = await canCurrentUserUseEmailFeature()
  let query = client()
    .from('auto_campaign_actions')
    .select('*')
    .eq('is_active', true)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (!canUseEmailFeature) {
    query = query.neq('flatform_type', EMAIL_PLATFORM)
  }

  const { data, error } = await query
  if (error) throw new Error(`Failed to list campaign actions: ${error.message}`)
  return (data || []).map(row => mapCampaignActionFromDB(row))
}

export async function getAllCampaignActions(): Promise<CampaignAction[]> {
  const { data, error } = await client()
    .from('auto_campaign_actions')
    .select('*')
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to get all campaign actions: ${error.message}`)
  return (data || []).map(row => mapCampaignActionFromDB(row))
}

export async function getCampaignAction(actionId: string): Promise<CampaignAction | null> {
  if (actionId === EMAIL_SEND_ACTION_ID && !(await canCurrentUserUseEmailFeature())) {
    return null
  }
  const { data, error } = await client()
    .from('auto_campaign_actions')
    .select('*')
    .eq('id', actionId)
    .single()

  if (error) return null
  return mapCampaignActionFromDB(data)
}

export async function createCampaignAction(action: Partial<CampaignAction>): Promise<CampaignAction> {
  const payload = {
    id: action.id,
    name: action.name,
    flatform_type: action.flatformType,
    is_active: action.isActive ?? true,
    workflow_id: action.workflowId ?? null,
    test_workflow_id: action.testWorkflowId ?? null,
    limit_check_action_codes: action.limitCheckActionCodes ?? []
  }

  const { data, error } = await client()
    .from('auto_campaign_actions')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create campaign action: ${error.message}`)
  return mapCampaignActionFromDB(data)
}

export async function updateCampaignAction(id: string, updates: Partial<CampaignAction>): Promise<CampaignAction> {
  const payload: any = {}
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.flatformType !== undefined) payload.flatform_type = updates.flatformType
  if (updates.isActive !== undefined) payload.is_active = updates.isActive
  if (updates.workflowId !== undefined) payload.workflow_id = updates.workflowId
  if (updates.testWorkflowId !== undefined) payload.test_workflow_id = updates.testWorkflowId
  if (updates.limitCheckActionCodes !== undefined) payload.limit_check_action_codes = updates.limitCheckActionCodes

  const { data, error } = await client()
    .from('auto_campaign_actions')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update campaign action: ${error.message}`)
  return mapCampaignActionFromDB(data)
}

export async function deleteCampaignAction(id: string): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_actions')
    .update({ is_delete: true })
    .eq('id', id)

  if (error) throw new Error(`Failed to delete campaign action: ${error.message}`)
}
