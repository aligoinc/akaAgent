import { EXCLUSION_AI_MESSAGES, exclusionAiCatalog, parseExclusionAiResponse, type ExclusionAiRequest, type ExclusionAiResult } from '../../shared/campaignExclusionAi'
import { FORM_AI_SECTIONS } from '../../shared/campaignFormAiConfig'
import { getFormAiConfig } from '../data/repositories/aiRepository'
import { listSendExclusionGroups } from '../data/repositories/campaignSendExclusionRepository'
import { requireCurrentUser } from '../data/currentUser'
import { callAiUsing } from './aiRuntimeService'
import { compileFormAiSchema, formAiStructuredOptions } from './formAiSchema'

export async function generateCampaignExclusion(request: ExclusionAiRequest, signal: AbortSignal): Promise<ExclusionAiResult> {
  signal.throwIfAborted()
  const config = await getFormAiConfig(FORM_AI_SECTIONS.exclusions, request.context.actionId, signal)
  const validate = compileFormAiSchema(config.outputSchema, FORM_AI_SECTIONS.exclusions)
  // Existing scoped RPC verifies the account, tenant and credentials before any provider call.
  const page = await listSendExclusionGroups(request.context.accountId, signal)
  signal.throwIfAborted()
  const result = await callAiUsing(config.using.code, {
    exclusionContext: JSON.stringify({ description: request.description, actionId: request.context.actionId,
      fields: exclusionAiCatalog(page) }),
    bodyOverrides: formAiStructuredOptions(config.model.provider, config.model.endpoint, config.outputSchema, FORM_AI_SECTIONS.exclusions)
  }, { organizationId: requireCurrentUser().organizationId }, { signal, formConfig: config, validateContent: validate })
  signal.throwIfAborted()
  if (!result.ok) return { ok: false, code: 'unavailable', message: EXCLUSION_AI_MESSAGES.unavailable }
  return parseExclusionAiResponse(result.content, page)
}
