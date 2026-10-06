import { getSupabaseClient } from '../supabaseClient'
import { requireCurrentUser } from '../currentUser'

/** This call consumes an index. Never retry it or substitute index zero on error. */
export async function takeCampaignContentIndex(input: {
  campaignId: number
  accountId: number
  runtimeTarget: 'desktop' | 'server'
  runtimeClaimToken: string
  runtimeUnitToken: string
  inputDataId: number | null
  actionCode: string
  variantCount: number
}): Promise<number> {
  const user = requireCurrentUser()
  const { data, error } = await getSupabaseClient().rpc('aka_agent_take_campaign_content_index', {
    p_campaign_id: input.campaignId,
    p_account_id: input.accountId,
    p_staff_id: user.staffId,
    p_runtime_target: input.runtimeTarget,
    p_runtime_claim_token: input.runtimeClaimToken,
    p_runtime_unit_token: input.runtimeUnitToken,
    p_input_data_id: input.inputDataId,
    p_action_code: input.actionCode,
    p_variant_count: input.variantCount
  })
  if (error) throw new Error(`Không lấy được vị trí nội dung: ${error.message}`)
  if (!Number.isInteger(data)) throw new Error('RPC vị trí nội dung không trả chỉ số hợp lệ')
  return data
}
