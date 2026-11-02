import { FACEBOOK_AI_IPC, FACEBOOK_AI_MESSAGES, validateFacebookAiRequest } from '../../../shared/campaignFacebookAi'
import { generateCampaignFacebook } from '../../services/campaignFacebookAiService'
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
import { AGENT_IPC } from '../../../shared/campaignAgent'
import { validateAgentRequest, generateCampaignAgent, AGENT_MESSAGES } from '../../services/campaignAgentService'
import { storeAgentImages, readAgentImage, removeAgentImage } from '../../services/campaignAgentImages'
import { AGENT_DATA_IPC, validAgentDataFiles } from '../../../shared/campaignAgentData'
import { agentUuid, isAgentRecord } from '../../../shared/campaignAgent'
import { storeAgentData, readAgentData } from '../../services/campaignAgentData'

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
  register(FACEBOOK_AI_IPC, validateFacebookAiRequest, generateCampaignFacebook, FACEBOOK_AI_MESSAGES)
  register(AGENT_IPC, validateAgentRequest, generateCampaignAgent, AGENT_MESSAGES)
  register({ generate: AGENT_DATA_IPC.read, cancel: AGENT_DATA_IPC.cancel }, input => {
    if (!isAgentRecord(input) || !agentUuid(input.requestId) || !agentUuid(input.draftId) || !validAgentDataFiles([input.file])) throw new Error(AGENT_MESSAGES.invalid)
    return { requestId: input.requestId, draftId: input.draftId, file: input.file }
  }, async (request, signal) => {
    try { return { ok: true, patch: await readAgentData(request, signal) } }
    catch { return { ok: false, code: signal.aborted ? 'cancelled' : 'invalid', message: 'Không thể đọc file hoặc ảnh trên thiết bị này. Hãy kiểm tra file gốc và thử lại.' } }
  }, AGENT_MESSAGES)
  for (const [channel, handle] of [
    [AGENT_IPC.images, storeAgentImages], [AGENT_IPC.image, readAgentImage], [AGENT_IPC.removeImage, removeAgentImage], [AGENT_DATA_IPC.store, storeAgentData]
  ] as const) {
    ipcMain.handle(channel, async (event, input: unknown) => {
      assertFrame(event)
      const user = requireCurrentUser(), credentials = requireCurrentUserCredentials()
      try {
        const result = await runWithCurrentUser(user, () => handle(input))
        if (getCurrentUserCredentials() !== credentials || window.isDestroyed()) throw new Error(AGENT_MESSAGES.unavailable)
        return result
      } catch { throw new Error(channel === AGENT_DATA_IPC.store
        ? 'Không thể lưu dữ liệu. Vui lòng chọn lại file hợp lệ.'
        : 'Không thể đọc hoặc lưu ảnh. Vui lòng chọn lại ảnh hợp lệ.') }
    })
  }
  return { stop }
}
