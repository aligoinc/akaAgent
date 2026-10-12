import { ipcMain, type BrowserWindow } from 'electron'
import { CAMPAIGN_PENDING_REASON_IPC, CAMPAIGN_PENDING_REASON_UNAVAILABLE, type CampaignPendingReasonResult } from '../../../shared/campaignPendingReason'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials, runWithCurrentUser } from '../../data/currentUser'
import type { CampaignScheduler } from '../../services/campaignScheduler'
import { withRequestDeadline } from '../../services/requestDeadline'

export function registerCampaignPendingReasonHandlers(window: BrowserWindow, scheduler: Pick<CampaignScheduler, 'inspectPendingReason'>): void {
  const requests = new Map<number, { credentials: object; staffId: number; promise: Promise<CampaignPendingReasonResult> }>()
  ipcMain.handle(CAMPAIGN_PENDING_REASON_IPC, async (event, id: number) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || !Number.isSafeInteger(id) || id <= 0) throw new Error('Yêu cầu kiểm tra chiến dịch không hợp lệ.')
    const user = requireCurrentUser()
    const credentials = requireCurrentUserCredentials()
    const current = () => getCurrentUser()?.staffId === user.staffId
      && getCurrentUser()?.organizationId === user.organizationId && getCurrentUserCredentials() === credentials
    const pending = requests.get(id)
    if (pending?.credentials === credentials && pending.staffId === user.staffId) return pending.promise
    if (requests.size >= 4) throw new Error(CAMPAIGN_PENDING_REASON_UNAVAILABLE)
    const request = { credentials, staffId: user.staffId, promise: null! as Promise<CampaignPendingReasonResult> }
    request.promise = runWithCurrentUser(user, () => withRequestDeadline(new AbortController().signal,
      signal => scheduler.inspectPendingReason(id, signal), 20_000))
      .then(result => {
        if (!current()) return { campaignId: id, message: null, version: '' }
        return result
      })
      .catch(() => {
        if (!current()) return { campaignId: id, message: null, version: '' }
        // Do not expose raw transport/SQL/credential errors through a campaign note.
        throw new Error(CAMPAIGN_PENDING_REASON_UNAVAILABLE)
      })
      .finally(() => { if (requests.get(id) === request) requests.delete(id) })
    requests.set(id, request)
    return request.promise
  })
}
