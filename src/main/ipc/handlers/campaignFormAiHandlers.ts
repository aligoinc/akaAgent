import { CAMPAIGN_CONTENT_AI_IPC, CONTENT_AI_MESSAGES, validateContentAiRequest } from '../../../shared/campaignContentAi'
import { CAMPAIGN_EXCLUSION_AI_IPC, EXCLUSION_AI_MESSAGES, validateExclusionAiRequest } from '../../../shared/campaignExclusionAi'
import { generateCampaignExclusion } from '../../services/campaignExclusionAiService'
import { generateCampaignContent } from '../../services/campaignContentAiService'
import { ipcMain, type BrowserWindow } from 'electron'
import {
  CAMPAIGN_SCHEDULE_AI_IPC, SCHEDULE_AI_MESSAGES,
  validateScheduleAiRequest
} from '../../../shared/campaignScheduleAi'
import { getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials, runWithCurrentUser } from '../../data/currentUser'
import { generateCampaignSchedule } from '../../services/campaignScheduleAiService'
import { withRequestDeadline } from '../../services/requestDeadline'
import { CAMPAIGN_LIMITS_AI_IPC, LIMITS_AI_MESSAGES, validateLimitsAiRequest } from '../../../shared/campaignLimitsAi'
import { generateCampaignLimits } from '../../services/campaignLimitsAiService'
import { CAMPAIGN_FORM_AI_TIMEOUT, type CampaignFormAiResult } from '../../../shared/campaignFormAi'
import { FORM_AI_AVAILABILITY_IPC } from '../../../shared/campaignFormAiConfig'
import { listFormAiAvailability } from '../../data/repositories/aiRepository'

export function registerCampaignFormAiHandlers(window: BrowserWindow): { stop: () => void } {
  let flight: { id: string; channel: string; credentials: object; controller: AbortController } | undefined
  const stop = () => { flight?.controller.abort(); flight = undefined }
  const assertFrame = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error(SCHEDULE_AI_MESSAGES.unavailable)
  }
  window.webContents.once('destroyed', stop)
  ipcMain.handle(FORM_AI_AVAILABILITY_IPC, async event => {
    assertFrame(event)
    const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
    const result = await runWithCurrentUser(user, () => listFormAiAvailability(AbortSignal.timeout(10_000)))
    if (getCurrentUserCredentials() !== credentials || window.isDestroyed()) return []
    return result
  })
  function register<Request extends { requestId: string }, Patch>(
    channels: { generate: string; cancel: string }, validate: (input: unknown) => Request,
    generate: (request: Request, signal: AbortSignal) => Promise<CampaignFormAiResult<Patch>>,
    messages: { invalid: string; unavailable: string }
  ) {
    ipcMain.handle(channels.generate, async (event, input: unknown): Promise<CampaignFormAiResult<Patch>> => {
      assertFrame(event)
      let request: Request
      try { request = validate(input) }
      catch { return { ok: false, code: 'invalid', message: messages.invalid } }
      const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
      if (flight && flight.credentials !== credentials) stop()
      if (flight) return { ok: false, code: 'unavailable', message: messages.unavailable }
      const owned = { id: request.requestId, channel: channels.generate, credentials, controller: new AbortController() }
      flight = owned
      try {
        const result = await runWithCurrentUser(user, () => withRequestDeadline(owned.controller.signal,
          signal => generate(request, signal), CAMPAIGN_FORM_AI_TIMEOUT))
        if (owned.controller.signal.aborted || getCurrentUserCredentials() !== credentials) {
          return { ok: false, code: 'cancelled', message: '' }
        }
        return result
      } catch {
        return owned.controller.signal.aborted || getCurrentUserCredentials() !== credentials
          ? { ok: false, code: 'cancelled', message: '' }
          : { ok: false, code: 'unavailable', message: messages.unavailable }
      } finally { if (flight === owned) flight = undefined }
    })
    ipcMain.handle(channels.cancel, (event, requestId: unknown) => {
      assertFrame(event)
      if (typeof requestId === 'string' && flight?.id === requestId && flight.channel === channels.generate && flight.credentials === getCurrentUserCredentials()) stop()
    })
  }
  register(CAMPAIGN_SCHEDULE_AI_IPC, validateScheduleAiRequest, generateCampaignSchedule, SCHEDULE_AI_MESSAGES)
  register(CAMPAIGN_LIMITS_AI_IPC, validateLimitsAiRequest, generateCampaignLimits, LIMITS_AI_MESSAGES)
  register(CAMPAIGN_CONTENT_AI_IPC, validateContentAiRequest, generateCampaignContent, CONTENT_AI_MESSAGES)
  register(CAMPAIGN_EXCLUSION_AI_IPC, validateExclusionAiRequest, generateCampaignExclusion, EXCLUSION_AI_MESSAGES)
  return { stop }
}
