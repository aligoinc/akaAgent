import { CAMPAIGN_FORM_AI_MODEL } from '../../shared/campaignFormAi'
import { CAMPAIGN_LIMITS_AI_CODE, LIMITS_AI_SCHEMA, LIMITS_AI_MESSAGES, getLimitsAiCapabilities,
  parseLimitsAiResponse, type LimitsAiRequest, type LimitsAiResult } from '../../shared/campaignLimitsAi'
import { requireCurrentUser } from '../data/currentUser'
import { callAiUsing } from './aiRuntimeService'

export async function generateCampaignLimits(request: LimitsAiRequest, signal: AbortSignal): Promise<LimitsAiResult> {
  const result = await callAiUsing(CAMPAIGN_LIMITS_AI_CODE, {
    limitsContext: JSON.stringify({ description: request.description, currentLimits: request.limits,
      ...request.context, capabilities: getLimitsAiCapabilities(request.context) }),
    bodyOverrides: { store: false, text: { format: { type: 'json_schema', name: 'campaign_action_limits', strict: true, schema: LIMITS_AI_SCHEMA } } }
  }, { organizationId: requireCurrentUser().organizationId }, { signal, expectedModel: CAMPAIGN_FORM_AI_MODEL })
  signal.throwIfAborted()
  if (!result.ok) return { ok: false, code: 'unavailable', message: LIMITS_AI_MESSAGES.unavailable }
  return parseLimitsAiResponse(result.content, request)
}
