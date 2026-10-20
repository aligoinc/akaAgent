/** Stable application slots. Database IDs and AI credentials never come from the form. */
export const FORM_AI_SECTIONS = {
  exclusions: 'campaign.send_exclusions',
  content: 'campaign.content',
  schedule: 'campaign.schedule',
  limits: 'campaign.action_limits'
} as const
export type FormAiSection = typeof FORM_AI_SECTIONS[keyof typeof FORM_AI_SECTIONS]
export const FORM_AI_AVAILABILITY_IPC = 'campaign-form-ai:availability'
export interface FormAiAvailability {
  sectionId: FormAiSection
  campaignScope: 'all' | 'selected'
  campaignActionIds: string[]
}
export function formAiApplies(config: Pick<FormAiAvailability, 'campaignScope' | 'campaignActionIds'>, actionId: string): boolean {
  return !!actionId && (config.campaignScope === 'all'
    || config.campaignScope === 'selected' && config.campaignActionIds.includes(actionId))
}
export function formAiAvailable(rows: FormAiAvailability[], sectionId: FormAiSection, actionId: string): boolean {
  return rows.some(row => row.sectionId === sectionId && formAiApplies(row, actionId))
}
export function formAiAvailability(rows: Record<string, unknown>[], platform: 'desktop' | 'web'): FormAiAvailability[] {
  return rows.flatMap(row => {
    const sectionId = row[`${platform}_section_id`]
    if (sectionId !== FORM_AI_SECTIONS.exclusions && sectionId !== FORM_AI_SECTIONS.content && sectionId !== FORM_AI_SECTIONS.schedule && sectionId !== FORM_AI_SECTIONS.limits) return []
    if (row.campaign_scope !== 'all' && row.campaign_scope !== 'selected') return []
    if (!Array.isArray(row.campaign_action_ids) || !row.campaign_action_ids.every(id => typeof id === 'string')) return []
    return [{ sectionId, campaignScope: row.campaign_scope, campaignActionIds: row.campaign_action_ids }]
  })
}
