import {
  SCHEDULE_AI_MESSAGES,
  getScheduleAiCapabilities, parseScheduleAiResponse, formatScheduleVietnam,
  type ScheduleAiRequest, type ScheduleAiResult
} from '../../shared/campaignScheduleAi'
import { requireCurrentUser } from '../data/currentUser'
import { peekDatabaseRuntimeClock } from '../data/repositories/runtimeClockRepository'
import { callAiUsing } from './aiRuntimeService'
import { getFormAiConfig } from '../data/repositories/aiRepository'
import { FORM_AI_SECTIONS } from '../../shared/campaignFormAiConfig'
import { compileFormAiSchema, formAiStructuredOptions } from './formAiSchema'

export async function generateCampaignSchedule(request: ScheduleAiRequest, signal: AbortSignal): Promise<ScheduleAiResult> {
  const now = new Date(peekDatabaseRuntimeClock()?.dbNow ?? Date.now())
  const config = await getFormAiConfig(FORM_AI_SECTIONS.schedule, request.context.actionId, signal)
  const validateContent = compileFormAiSchema(config.outputSchema, FORM_AI_SECTIONS.schedule)
  const result = await callAiUsing(config.using.code, {
    scheduleContext: JSON.stringify({ description: request.description, currentSchedule: request.schedule,
      ...request.context, capabilities: getScheduleAiCapabilities(request.context),
      currentDateTime: formatScheduleVietnam(now), timeZone: 'Asia/Ho_Chi_Minh' }),
    bodyOverrides: formAiStructuredOptions(config.model.provider, config.model.endpoint, config.outputSchema, FORM_AI_SECTIONS.schedule)
  }, { organizationId: requireCurrentUser().organizationId }, { signal, formConfig: config, validateContent })
  signal.throwIfAborted()
  if (!result.ok) return { ok: false, code: 'unavailable', message: SCHEDULE_AI_MESSAGES.unavailable }
  return parseScheduleAiResponse(result.content, request)
}
