import { getCampaignSupportedActionDescriptors } from '../campaigns/campaignActionDescriptors'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ActionReportStatusCatalog } from '../../../shared/actionStatusReport'

/** Reuse the process HTTP client and the report deadline. No runtime-policy/cache dependency. */
export async function loadActionReportStatusCatalog(client: SupabaseClient, signal: AbortSignal): Promise<ActionReportStatusCatalog> {
  const read = async (table: string, select: string, statuses = false): Promise<Record<string, unknown>[]> => {
    const rows: Record<string, unknown>[] = []
    let after: string | number | undefined
    for (;;) {
      let request = client.from(table).select(select).order('id').limit(500).abortSignal(signal)
      if (statuses) request = request.eq('component_type', 'campaign_detail')
      else request = request.eq('is_active', true).eq('is_delete', false)
      if (after !== undefined) request = request.gt('id', after)
      const { data, error } = await request
      if (error) throw new Error('Không thể tải cấu hình trạng thái báo cáo. Vui lòng thử lại.')
      const page = (data || []) as unknown as Record<string, unknown>[]
      rows.push(...page)
      if (page.length < 500) return rows
      const next = page[page.length - 1].id as string | number
      if (next === after) throw new Error('Không thể đọc tiếp cấu hình trạng thái báo cáo.')
      after = next
    }
  }
  const statuses = await read('auto_status', 'id,name,status_value,flatform_type,component_type,is_active,is_delete', true)
  const mappings = await read('auto_campaign_action_detail_statuses', 'id,campaign_action_id,action_code,status_id,status_value,label,sort_order,is_active,is_delete')
  const campaigns = await read('auto_campaign_actions', 'id,limit_check_action_codes,is_active,is_delete')
  return new ActionReportStatusCatalog({ statuses, mappings, campaigns: campaigns.map(row => ({
    ...row, supported_action_codes: getCampaignSupportedActionDescriptors(String(row.id)).map(action => action.code)
  })) })
}
