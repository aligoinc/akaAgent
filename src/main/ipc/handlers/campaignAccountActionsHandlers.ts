import { ipcMain, type BrowserWindow } from 'electron'
import { CAMPAIGN_ACCOUNT_ACTIONS_IPC, CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE, type CampaignAccountActionsResult } from '../../../shared/campaignAccountActions'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials, runWithCurrentUser } from '../../data/currentUser'
import { CampaignAccountActionsError, readCampaignAccountActions } from '../../services/campaignAccountActionsService'
import { withRequestDeadline } from '../../services/requestDeadline'

/**
 * Tab "Hành động": một lượt đọc khi mở tab/bấm Làm mới. Gộp lượt trùng cùng chiến dịch/phiên, tối đa 4 lượt
 * đang chạy, hạn 20 giây; phiên đổi trong lúc đọc thì bỏ kết quả. Không ghi DB, không thêm kết nối.
 */
export function registerCampaignAccountActionsHandlers(window: BrowserWindow): void {
  const requests = new Map<number, { credentials: object; staffId: number; promise: Promise<CampaignAccountActionsResult> }>()
  ipcMain.handle(CAMPAIGN_ACCOUNT_ACTIONS_IPC, async (event, id: number) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || !Number.isSafeInteger(id) || id <= 0) throw new Error('Yêu cầu xem hành động của chiến dịch không hợp lệ.')
    const user = requireCurrentUser()
    const credentials = requireCurrentUserCredentials()
    const current = () => getCurrentUser()?.staffId === user.staffId
      && getCurrentUser()?.organizationId === user.organizationId && getCurrentUserCredentials() === credentials
    const pending = requests.get(id)
    if (pending?.credentials === credentials && pending.staffId === user.staffId) return pending.promise
    if (requests.size >= 4) throw new Error(CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE)
    const request = { credentials, staffId: user.staffId, promise: null! as Promise<CampaignAccountActionsResult> }
    request.promise = runWithCurrentUser(user, () => withRequestDeadline(new AbortController().signal,
      signal => readCampaignAccountActions(id, signal), 20_000))
      .then(result => {
        if (!current()) throw new Error(CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE)
        return result
      })
      .catch(error => {
        // Chỉ hiện nguyên văn lỗi nghiệp vụ; không lộ lỗi transport/SQL/credential.
        throw new Error(error instanceof CampaignAccountActionsError && current() ? error.message : CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE)
      })
      .finally(() => { if (requests.get(id) === request) requests.delete(id) })
    requests.set(id, request)
    return request.promise
  })
}
