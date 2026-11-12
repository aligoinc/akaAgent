import { ipcMain, type BrowserWindow } from 'electron'
import {
  CAMPAIGN_ACCOUNT_ACTIONS_IPC, CAMPAIGN_ACCOUNT_ACTIONS_UNAVAILABLE, CAMPAIGN_LIMIT_PROGRESS_IPC, type CampaignAccountActionsResult
} from '../../../shared/campaignAccountActions'
import {
  CAMPAIGN_LIMIT_PROGRESS_MAX_IDS, CAMPAIGN_LIMIT_PROGRESS_UNAVAILABLE, type CampaignLimitProgressResult
} from '../../../shared/campaignLimitProgress'
import { getCurrentUser, getCurrentUserCredentials, requireCurrentUser, requireCurrentUserCredentials, runWithCurrentUser } from '../../data/currentUser'
import { CampaignAccountActionsError } from '../../services/campaignAccountActionsService'
import { readCampaignAccountActionsDetail, readCampaignLimitProgress } from '../../services/campaignLimitProgressService'
import { withRequestDeadline } from '../../services/requestDeadline'

/**
 * Tab "Hành động": một lượt đọc khi mở tab/bấm Làm mới. Gộp lượt trùng cùng chiến dịch/phiên, tối đa 4 lượt
 * đang chạy, hạn 20 giây; phiên đổi trong lúc đọc thì bỏ kết quả. Không ghi DB, không thêm kết nối.
 * Từ V502 đọc một RPC ở chế độ chi tiết; DB chưa có hàm thì dùng bộ đọc cũ.
 *
 * Cột "Giới hạn lượt" (V502): một lượt đọc cho các chiến dịch đang hiện trên danh sách (<= 101 id). Gộp lượt
 * trùng cùng tập id/phiên, tối đa 2 lượt đang chạy, hạn 10 giây; DB chưa có hàm thì trả `ready: false`.
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
      signal => readCampaignAccountActionsDetail(id, signal), 20_000))
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

  const progress = new Map<string, { credentials: object; staffId: number; promise: Promise<CampaignLimitProgressResult> }>()
  ipcMain.handle(CAMPAIGN_LIMIT_PROGRESS_IPC, async (event, input: unknown) => {
    const ids = Array.isArray(input) ? [...new Set(input.map(Number))].sort((left, right) => left - right) : []
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || !ids.length || ids.length > CAMPAIGN_LIMIT_PROGRESS_MAX_IDS || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new Error('Danh sách chiến dịch không hợp lệ.')
    }
    const user = requireCurrentUser()
    const credentials = requireCurrentUserCredentials()
    const current = () => getCurrentUser()?.staffId === user.staffId
      && getCurrentUser()?.organizationId === user.organizationId && getCurrentUserCredentials() === credentials
    const key = ids.join(',')
    const pending = progress.get(key)
    if (pending?.credentials === credentials && pending.staffId === user.staffId) return pending.promise
    if (progress.size >= 2) throw new Error(CAMPAIGN_LIMIT_PROGRESS_UNAVAILABLE)
    const request = { credentials, staffId: user.staffId, promise: null! as Promise<CampaignLimitProgressResult> }
    request.promise = runWithCurrentUser(user, () => withRequestDeadline(new AbortController().signal,
      signal => readCampaignLimitProgress(ids, signal), 10_000))
      .then(result => {
        if (!current()) throw new Error(CAMPAIGN_LIMIT_PROGRESS_UNAVAILABLE)
        return result
      })
      .catch(() => { throw new Error(CAMPAIGN_LIMIT_PROGRESS_UNAVAILABLE) })
      .finally(() => { if (progress.get(key) === request) progress.delete(key) })
    progress.set(key, request)
    return request.promise
  })
}
