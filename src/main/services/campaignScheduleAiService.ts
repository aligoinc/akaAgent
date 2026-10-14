import {
  CAMPAIGN_SCHEDULE_AI_CODE, CAMPAIGN_SCHEDULE_AI_MODEL, SCHEDULE_AI_SCHEMA, SCHEDULE_AI_MESSAGES,
  getScheduleAiCapabilities, parseScheduleAiResponse, formatScheduleVietnam,
  type ScheduleAiRequest, type ScheduleAiResult
} from '../../shared/campaignScheduleAi'
import { requireCurrentUser } from '../data/currentUser'
import { peekDatabaseRuntimeClock } from '../data/repositories/runtimeClockRepository'
import { callAiUsing } from './aiRuntimeService'

export async function generateCampaignSchedule(request: ScheduleAiRequest, signal: AbortSignal): Promise<ScheduleAiResult> {
  const now = new Date(peekDatabaseRuntimeClock()?.dbNow ?? Date.now())
  const result = await callAiUsing(CAMPAIGN_SCHEDULE_AI_CODE, {
    scheduleContext: JSON.stringify({ description: request.description, currentSchedule: request.schedule,
      ...request.context, capabilities: getScheduleAiCapabilities(request.context),
      currentDateTime: formatScheduleVietnam(now), timeZone: 'Asia/Ho_Chi_Minh' }),
    bodyOverrides: { store: false, text: { format: {
      type: 'json_schema', name: 'campaign_schedule', strict: true, schema: SCHEDULE_AI_SCHEMA
    } } }
  }, { organizationId: requireCurrentUser().organizationId }, { signal, expectedModel: CAMPAIGN_SCHEDULE_AI_MODEL })
  signal.throwIfAborted()
  if (!result.ok) return { ok: false, code: 'unavailable', message: SCHEDULE_AI_MESSAGES.unavailable }
  return parseScheduleAiResponse(result.content, request)
}
