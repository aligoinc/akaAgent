import { ipcMain, type BrowserWindow } from 'electron'
import { DATA_GROUP_AGENT_IPC, type DataGroupAgentIpcRequest, type DataGroupAgentIpcResult } from '../../../shared/dataGroupAgentIpc'
import { getCurrentUserCredentials, getCurrentUser, requireCurrentUserCredentials, runWithCurrentUser } from '../../data/currentUser'
import {
  DATA_GROUP_AGENT_SESSION_INVALID, DataGroupAgentError, createDataGroupFromFriendFilter, filterZaloFriends, listFriendAccounts,
  readDataGroupAgentSettingSafe, readZaloFriendRecipients, runDataGroupAgentTurn
} from '../../services/dataGroupAgentService'
import { withRequestDeadline } from '../../services/requestDeadline'

type Kind = DataGroupAgentIpcRequest['kind']
/** Hạn cả lượt ở main (lượt lọc: chờ chỗ 20 giây + ngân sách DB 65 giây; lượt chat: AI 120 giây + danh mục). */
const DEADLINES: Record<Kind, number> = { setting: 35_000, accounts: 40_000, turn: 170_000, filter: 90_000, recipients: 150_000, create: 75_000 }
/** Lượt hủy được bằng requestId; lượt mới cùng loại hủy lượt cũ (đổi tài khoản, bắt đầu lại, đếm lại). */
const CANCELLABLE: ReadonlySet<Kind> = new Set<Kind>(['turn', 'filter', 'recipients'])
const KINDS: ReadonlySet<string> = new Set<Kind>(['setting', 'accounts', 'turn', 'filter', 'recipients', 'create'])
const UNAVAILABLE = 'Agent tạm thời chưa phản hồi. Vui lòng thử lại sau.'

/**
 * Kênh `data-group-agent:*` (docs/DATA_GROUP_FRIEND_AGENT_DESKTOP.md). Chỉ cửa sổ chính được gọi; kết quả về sau khi phiên
 * đổi (đăng xuất, đổi nhân viên) bị bỏ. Không ném lỗi qua IPC.
 */
export function registerDataGroupAgentHandlers(window: BrowserWindow): { stop: () => void } {
  const flights = new Map<string, { kind: Kind; controller: AbortController; credentials: object }>()
  const stop = () => {
    for (const flight of flights.values()) flight.controller.abort()
    flights.clear()
  }
  const fromMainFrame = (event: Electron.IpcMainInvokeEvent) =>
    event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
  window.webContents.once('destroyed', stop)

  ipcMain.handle(DATA_GROUP_AGENT_IPC.request, async (event, input: unknown): Promise<DataGroupAgentIpcResult<unknown>> => {
    if (!fromMainFrame(event)) return { ok: false, code: 'unavailable', message: UNAVAILABLE }
    const request = input as DataGroupAgentIpcRequest
    if (!request || typeof request !== 'object' || !KINDS.has(String(request.kind))) {
      return { ok: false, code: 'invalid_friend_filter', message: 'Yêu cầu không hợp lệ.' }
    }
    const user = getCurrentUser()
    const credentials = getCurrentUserCredentials()
    if (!user || !credentials) return { ok: false, code: 'session_invalid', message: DATA_GROUP_AGENT_SESSION_INVALID }
    const kind = request.kind
    const body = 'request' in request ? request.request : undefined
    const requestId = body && typeof body === 'object' && typeof (body as { requestId?: unknown }).requestId === 'string'
      ? (body as { requestId: string }).requestId : null
    const controller = new AbortController()
    let key: string | null = null
    if (CANCELLABLE.has(kind) && requestId) {
      for (const [id, flight] of flights) if (flight.kind === kind) { flight.controller.abort(); flights.delete(id) }
      key = requestId
      flights.set(key, { kind, controller, credentials })
    }
    const stale = () => controller.signal.aborted || getCurrentUserCredentials() !== credentials || window.isDestroyed()
    try {
      const data = await runWithCurrentUser(user, () => withRequestDeadline<unknown>(controller.signal, (signal): Promise<unknown> => {
        switch (kind) {
          case 'setting': return readDataGroupAgentSettingSafe()
          case 'accounts': return listFriendAccounts(signal)
          case 'turn': return runDataGroupAgentTurn(body, signal)
          case 'filter': return filterZaloFriends(body, signal)
          case 'recipients': return readZaloFriendRecipients(body, signal)
          case 'create': return createDataGroupFromFriendFilter(body, signal)
        }
      }, DEADLINES[kind]))
      if (stale()) return { ok: false, code: 'friend_filter_cancelled', message: '' }
      return { ok: true, data }
    } catch (error) {
      if (stale()) return { ok: false, code: 'friend_filter_cancelled', message: '' }
      if (error instanceof DataGroupAgentError) {
        return { ok: false, code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
      }
      const message = error instanceof Error ? error.message : String(error)
      if (/quá thời gian/i.test(message)) {
        return { ok: false, code: 'friend_filter_timeout', message: 'Lọc bạn bè quá thời gian chờ. Hãy thu hẹp khoảng thời gian hoặc bớt điều kiện rồi thử lại.' }
      }
      if (/chưa đăng nhập|đăng nhập lại|Not logged in/i.test(message)) {
        return { ok: false, code: 'session_invalid', message: DATA_GROUP_AGENT_SESSION_INVALID }
      }
      console.warn('[dataGroupAgent] request failed:', kind, message.slice(0, 200))
      return { ok: false, code: 'unavailable', message: UNAVAILABLE }
    } finally {
      if (key && flights.get(key)?.controller === controller) flights.delete(key)
    }
  })

  ipcMain.handle(DATA_GROUP_AGENT_IPC.cancel, (event, requestId: unknown) => {
    if (!fromMainFrame(event) || typeof requestId !== 'string') return
    const flight = flights.get(requestId)
    if (!flight) return
    try {
      if (flight.credentials !== requireCurrentUserCredentials()) return
    } catch {
      return
    }
    flight.controller.abort()
    flights.delete(requestId)
  })

  return { stop }
}
