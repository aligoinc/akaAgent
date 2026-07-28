import {
  AutomationDataType,
  CampaignAction,
  CampaignActionDataType,
  ContactType,
  DataTypeCategoryCode
} from '../../../shared/types'
import { getSupabaseClient } from '../supabaseClient'
import { mapCampaignActionFromDB } from '../mappers'
import {
  canUseCampaignActionWithEntitlements,
  loadCurrentUserEffectiveEntitlements,
} from './entitlementRepository'

const client = () => getSupabaseClient()

async function loadActionDataTypes(actionIds: string[]): Promise<Map<string, CampaignActionDataType[]>> {
  const uniqueActionIds = Array.from(new Set(actionIds.filter(Boolean)))
  const result = new Map<string, CampaignActionDataType[]>()
  if (uniqueActionIds.length === 0) return result

  const { data: mappings, error: mappingError } = await client()
    .from('auto_campaign_action_data_types')
    .select('campaign_action_id, data_type_category_item_id, data_type_code, can_source, can_target, target_contact_type')
    .in('campaign_action_id', uniqueActionIds)
    .eq('is_active', true)
    .eq('is_delete', false)
  if (mappingError) throw new Error(`Failed to list campaign action data types: ${mappingError.message}`)

  const categoryIds = Array.from(new Set((mappings || [])
    .map(row => Number(row.data_type_category_item_id))
    .filter(id => Number.isSafeInteger(id) && id > 0)))
  if (categoryIds.length === 0) return result

  const { data: categories, error: categoryError } = await client()
    .from('category_item')
    .select('id, code, name, is_active')
    .in('id', categoryIds)
  if (categoryError) throw new Error(`Failed to list campaign action data type categories: ${categoryError.message}`)
  const categoriesById = new Map((categories || []).map(row => [Number(row.id), row]))

  for (const row of mappings || []) {
    const categoryItemId = Number(row.data_type_category_item_id)
    const category = categoriesById.get(categoryItemId)
    if (!category || category.is_active === false) continue
    const actionId = String(row.campaign_action_id || '')
    if (!actionId) continue
    const entries = result.get(actionId) || []
    if (entries.some(entry => entry.dataTypeCategoryItemId === categoryItemId)) continue
    entries.push({
      dataTypeCategoryItemId: categoryItemId,
      dataTypeCode: String(category.code) as DataTypeCategoryCode,
      dataTypeName: String(category.name || category.code || ''),
      automationDataType: String(row.data_type_code) as AutomationDataType,
      targetContactType: String(row.target_contact_type) as ContactType,
      canSource: row.can_source === true,
      canTarget: row.can_target === true
    })
    result.set(actionId, entries)
  }
  return result
}

async function attachActionDataTypes(actions: CampaignAction[]): Promise<CampaignAction[]> {
  const mappings = await loadActionDataTypes(actions.map(action => action.id))
  return actions.map(action => ({
    ...action,
    dataTypes: mappings.get(action.id) || []
  }))
}

export async function listCampaignActions(): Promise<CampaignAction[]> {
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  const { data, error } = await client()
    .from('auto_campaign_actions')
    .select('*')
    .eq('is_active', true)
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to list campaign actions: ${error.message}`)
  const actions = (data || [])
    .map(row => mapCampaignActionFromDB(row))
    .filter(action => canUseCampaignActionWithEntitlements(action.id, action.flatformType, entitlements))
  return attachActionDataTypes(actions)
}

export async function getAllCampaignActions(): Promise<CampaignAction[]> {
  const { data, error } = await client()
    .from('auto_campaign_actions')
    .select('*')
    .eq('is_delete', false)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`Failed to get all campaign actions: ${error.message}`)
  return attachActionDataTypes((data || []).map(row => mapCampaignActionFromDB(row)))
}

export async function getCampaignAction(actionId: string): Promise<CampaignAction | null> {
  const { data, error } = await client()
    .from('auto_campaign_actions')
    .select('*')
    .eq('id', actionId)
    .single()

  if (error) return null
  const action = mapCampaignActionFromDB(data)
  const entitlements = await loadCurrentUserEffectiveEntitlements()
  if (!canUseCampaignActionWithEntitlements(action.id, action.flatformType, entitlements)) return null
  return (await attachActionDataTypes([action]))[0] || null
}

export async function createCampaignAction(action: Partial<CampaignAction>): Promise<CampaignAction> {
  const payload = {
    id: action.id,
    name: action.name,
    flatform_type: action.flatformType,
    is_active: action.isActive ?? true,
    workflow_id: action.workflowId ?? null,
    test_workflow_id: action.testWorkflowId ?? null,
    allow_multiple_accounts: action.allowMultipleAccounts ?? false,
    limit_check_action_codes: action.limitCheckActionCodes ?? []
  }

  const { data, error } = await client()
    .from('auto_campaign_actions')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(`Failed to create campaign action: ${error.message}`)
  return (await attachActionDataTypes([mapCampaignActionFromDB(data)]))[0]
}

export async function updateCampaignAction(id: string, updates: Partial<CampaignAction>): Promise<CampaignAction> {
  const payload: any = {}
  if (updates.name !== undefined) payload.name = updates.name
  if (updates.flatformType !== undefined) payload.flatform_type = updates.flatformType
  if (updates.isActive !== undefined) payload.is_active = updates.isActive
  if (updates.workflowId !== undefined) payload.workflow_id = updates.workflowId
  if (updates.testWorkflowId !== undefined) payload.test_workflow_id = updates.testWorkflowId
  if (updates.allowMultipleAccounts !== undefined) payload.allow_multiple_accounts = updates.allowMultipleAccounts
  if (updates.limitCheckActionCodes !== undefined) payload.limit_check_action_codes = updates.limitCheckActionCodes

  const { data, error } = await client()
    .from('auto_campaign_actions')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(`Failed to update campaign action: ${error.message}`)
  return (await attachActionDataTypes([mapCampaignActionFromDB(data)]))[0]
}

export async function deleteCampaignAction(id: string): Promise<void> {
  const { error } = await client()
    .from('auto_campaign_actions')
    .update({ is_delete: true })
    .eq('id', id)

  if (error) throw new Error(`Failed to delete campaign action: ${error.message}`)
}
