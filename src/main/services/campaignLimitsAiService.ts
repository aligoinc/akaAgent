import { LIMITS_AI_MESSAGES, getLimitsAiCapabilities,
  parseLimitsAiResponse, type LimitsAiRequest, type LimitsAiResult } from '../../shared/campaignLimitsAi'
import { requireCurrentUser } from '../data/currentUser'
import { callAiUsing } from './aiRuntimeService'
import { getFormAiConfig } from '../data/repositories/aiRepository'
import { FORM_AI_SECTIONS } from '../../shared/campaignFormAiConfig'
import { compileFormAiSchema, formAiStructuredOptions } from './formAiSchema'

export async function generateCampaignLimits(request: LimitsAiRequest, signal: AbortSignal): Promise<LimitsAiResult> {
  const config = await getFormAiConfig(FORM_AI_SECTIONS.limits, request.context.actionId, signal)
  const validateContent = compileFormAiSchema(config.outputSchema, FORM_AI_SECTIONS.limits)
  const result = await callAiUsing(config.using.code, {
    limitsContext: JSON.stringify({ description: request.description, currentLimits: request.limits,
      ...request.context, capabilities: getLimitsAiCapabilities(request.context) }),
    bodyOverrides: formAiStructuredOptions(config.model.provider, config.model.endpoint, config.outputSchema, FORM_AI_SECTIONS.limits)
  }, { organizationId: requireCurrentUser().organizationId }, { signal, formConfig: config, validateContent })
  signal.throwIfAborted()
  if (!result.ok) return { ok: false, code: 'unavailable', message: LIMITS_AI_MESSAGES.unavailable }
  return parseLimitsAiResponse(result.content, request)
}
