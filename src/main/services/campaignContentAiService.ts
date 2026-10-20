import { CONTENT_AI_MESSAGES, parseContentAiResponse, type ContentAiRequest, type ContentAiResult } from '../../shared/campaignContentAi'
import { requireCurrentUser } from '../data/currentUser'
import { callAiUsing } from './aiRuntimeService'
import { getFormAiConfig } from '../data/repositories/aiRepository'
import { FORM_AI_SECTIONS } from '../../shared/campaignFormAiConfig'
import { compileFormAiSchema, formAiStructuredOptions } from './formAiSchema'

export async function generateCampaignContent(request: ContentAiRequest, signal: AbortSignal): Promise<ContentAiResult> {
  const config = await getFormAiConfig(FORM_AI_SECTIONS.content, request.context.actionId, signal)
  const validateContent = compileFormAiSchema(config.outputSchema, FORM_AI_SECTIONS.content)
  const result = await callAiUsing(config.using.code, {
    contentContext: JSON.stringify({ description: request.description, ...request.context, items: request.items }),
    bodyOverrides: formAiStructuredOptions(config.model.provider, config.model.endpoint, config.outputSchema, FORM_AI_SECTIONS.content)
  }, { organizationId: requireCurrentUser().organizationId }, { signal, formConfig: config, validateContent })
  signal.throwIfAborted()
  if (!result.ok) return { ok: false, code: 'unavailable', message: CONTENT_AI_MESSAGES.unavailable }
  return parseContentAiResponse(result.content, request)
}
