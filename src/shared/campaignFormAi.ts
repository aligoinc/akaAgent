export const CAMPAIGN_FORM_AI_MODEL = 'gpt-6.1-sol'
export const CAMPAIGN_FORM_AI_TIMEOUT = 120_000
export const CAMPAIGN_FORM_AI_MAX_PROMPT = 2000
export type CampaignFormAiResult<Patch> =
  | { ok: true; patch: Patch }
  | { ok: false; code: 'unclear' | 'unsupported' | 'invalid' | 'unavailable' | 'cancelled'; message: string }
