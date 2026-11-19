import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC_EVENTS, type RenewalWebDescriptor, type RenewalWebState } from '../../../shared/types'
import { RenewalWebService, type RenewalWebLink } from '../../services/renewalWebService'
import { RENEWAL_ENDED_MESSAGE, type AuthRenewalControl } from './authHandlers'
import {
  RENEWAL_REMINDER_IPC,
  RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE,
  RENEWAL_REMINDER_NO_REMINDER_MESSAGE,
  type RenewalReminderExternalResult,
  type RenewalReminderOpenResult
} from '../../../shared/renewalReminderDesktop'
import { UPGRADE_PORTAL_OPEN_ERROR, isUpgradePortalUrl, parseUpgradePortalLinkRequest, type UpgradePortalLinkRequest } from '../../../shared/upgradePortal'
import {
  UPGRADE_PORTAL_EXTERNAL_ERROR,
  UPGRADE_PORTAL_IPC,
  UPGRADE_PORTAL_LOAD_ERROR,
  UPGRADE_PORTAL_NOT_LOGGED_IN_MESSAGE,
  upgradePortalError,
  type UpgradePortalCloseResult,
  type UpgradePortalExternalResult,
  type UpgradePortalOpenResult
} from '../../../shared/upgradePortalDesktop'

/** Cửa sổ "Gia hạn gói" khi đang đăng nhập (nhắc gia hạn). Link (có vé dùng một lần) chỉ đi trong main. */
export interface RenewalReminderWebControl {
  /** Mã phiên đăng nhập hiện tại; null khi chưa đăng nhập. */
  currentSessionId(): number | null
  onSessionChanged(listener: () => void): () => void
  hasReminder(): boolean
  /** Link cho thông báo hiện tại (có vé dùng một lần, hoặc link thường khi không có vé). Ném lỗi có `code` khi không có thông báo. */
  createLink(reminderKey: unknown): Promise<RenewalWebLink>
  /** Trang CRM báo đơn đã kích hoạt. */
  orderCompleted(): void
  /** Khách đóng cửa sổ (có thể đã thanh toán rồi đóng). */
  windowClosed(): void
}

/**
 * Form "Nâng cấp và mua gói" (docs/UPGRADE_PORTAL_DESKTOP.md): mọi lối gia hạn / nâng cấp mới của phần mềm mở chung form này.
 * Link (có vé dùng một lần khi đang đăng nhập) chỉ đi trong main.
 */
export interface UpgradePortalWebControl {
  /** Mã phiên đăng nhập hiện tại; null khi chưa đăng nhập. */
  currentSessionId(): number | null
  onSessionChanged(listener: () => void): () => void
  /**
   * Link cho yêu cầu. `sessionId` null (form mở từ màn đăng nhập): không xin vé, không gọi DB. Đang đăng nhập: xin một vé;
   * không có vé thì trả link thường. Ném lỗi khi phiên đã kết thúc.
   */
  createLink(request: UpgradePortalLinkRequest, sessionId: number | null): Promise<RenewalWebLink>
  /** Dấu vân tay gói hiện tại của phiên, để biết sau khi đóng form gói có đổi không. */
  productsFingerprint(): string
  /** Đọc lại gói của phiên đang đăng nhập (lượt kiểm gói sẵn có). */
  refreshEntitlements(): Promise<void>
}

type Owner =
  | { mode: 'pending'; id: number }
  | { mode: 'reminder'; id: number }
  /** `id` null: form mở từ màn đăng nhập (chưa có phiên). `products`: dấu vân tay gói lúc mở. */
  | { mode: 'shop'; id: number | null; products: string }

const errorCode = (error: unknown): string | null =>
  error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : null

/**
 * Webview cổng gia hạn. Ba chế độ dùng chung một phân vùng nên không bao giờ cùng tồn tại:
 * - `pending`: màn Gia hạn trước đăng nhập, gắn với đúng một lượt gia hạn của main (giữ nguyên hành vi cũ). Lượt gia
 *   hạn đổi (đăng nhập thành công, huỷ, tài khoản khác, quá hạn chờ) thì đóng và xoá phân vùng.
 * - `reminder`: cửa sổ "Gia hạn gói" khi đang đăng nhập, gắn với phiên đăng nhập; đăng xuất/đổi tài khoản thì đóng.
 * - `shop`: form "Nâng cấp và mua gói" (menu, Thông tin tài khoản, màn đăng nhập, dải thông báo, thông báo tính năng), gắn
 *   với phiên đăng nhập, hoặc với trạng thái chưa đăng nhập khi mở từ màn đăng nhập; đổi phiên thì đóng. Cửa sổ "Gia hạn
 *   gói" đang mở thì không mở thêm form (giao diện dùng lại cửa sổ đang mở).
 */
export function registerRenewalWebHandlers(
  mainWindow: BrowserWindow,
  control: AuthRenewalControl,
  reminder?: RenewalReminderWebControl,
  shop?: UpgradePortalWebControl
): void {
  let service: RenewalWebService | null = null
  let owner: Owner | null = null
  let cleanup: Promise<void> = Promise.resolve()

  const assertMainFrame = (event: IpcMainInvokeEvent): void => {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error('Yêu cầu gia hạn không hợp lệ.')
    }
  }

  const dispose = (): Promise<void> => {
    const previous = service
    service = null
    owner = null
    if (previous) {
      cleanup = cleanup.then(() => previous.dispose()).catch(() => {
        console.warn('[Renewal] Không thể đóng hoàn toàn trang gia hạn.')
      })
    }
    return cleanup
  }

  const ownedBy = (mode: 'pending' | 'reminder', id: number | null): boolean => !!service && !!owner && id !== null && owner.mode === mode && owner.id === id
  /** Form của đúng phiên này (hoặc của trạng thái chưa đăng nhập khi `sessionId` null). */
  const ownedByShop = (sessionId: number | null): boolean => !!service && owner?.mode === 'shop' && owner.id === sessionId

  control.onRenewalChanged(() => {
    if (service && owner?.mode === 'pending' && control.currentRenewalId() !== owner.id) void dispose()
  })

  ipcMain.handle(IPC_EVENTS.AUTH_RENEWAL_WEB_PREPARE, async (event): Promise<RenewalWebDescriptor> => {
    assertMainFrame(event)
    const renewalId = control.currentRenewalId()
    if (renewalId === null) throw new Error(RENEWAL_ENDED_MESSAGE)
    if (service && !ownedBy('pending', renewalId)) void dispose()
    // Chờ lượt cũ xoá xong phân vùng trước khi mở lượt mới trên cùng phân vùng.
    await cleanup
    if (control.currentRenewalId() !== renewalId) throw new Error(RENEWAL_ENDED_MESSAGE)
    if (!service) {
      service = new RenewalWebService(mainWindow, {
        createLink: () => control.createRenewalLink(),
        isAllowed: () => control.currentRenewalId() === renewalId
      })
      owner = { mode: 'pending', id: renewalId }
    }
    return service.descriptor
  })

  ipcMain.handle(IPC_EVENTS.AUTH_RENEWAL_WEB_RELOAD, (event): RenewalWebState => {
    assertMainFrame(event)
    if (!service || !ownedBy('pending', control.currentRenewalId())) throw new Error(RENEWAL_ENDED_MESSAGE)
    service.reload()
    return service.snapshot()
  })

  if (reminder) {
    reminder.onSessionChanged(() => {
      if (service && owner?.mode === 'reminder' && reminder.currentSessionId() !== owner.id) void dispose()
    })

    ipcMain.handle(RENEWAL_REMINDER_IPC.open, async (event, request: unknown): Promise<RenewalReminderOpenResult> => {
      assertMainFrame(event)
      const reminderKey = request && typeof request === 'object' ? (request as { reminderKey?: unknown }).reminderKey : null
      const sessionId = reminder.currentSessionId()
      if (sessionId === null) return { ok: false, code: 'not_logged_in', message: RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE }
      if (!reminder.hasReminder()) return { ok: false, code: 'no_reminder', message: RENEWAL_REMINDER_NO_REMINDER_MESSAGE }
      if (service && !ownedBy('reminder', sessionId)) void dispose()
      await cleanup
      if (reminder.currentSessionId() !== sessionId) return { ok: false, code: 'not_logged_in', message: RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE }
      if (!service) {
        let completed = false
        service = new RenewalWebService(mainWindow, {
          createLink: () => reminder.createLink(reminderKey),
          isAllowed: () => reminder.currentSessionId() === sessionId,
          stateChannel: RENEWAL_REMINDER_IPC.webState,
          onOrderCompleted: () => {
            if (completed) return
            completed = true
            reminder.orderCompleted()
          }
        })
        owner = { mode: 'reminder', id: sessionId }
      }
      return { ok: true, partition: service.descriptor.partition, url: service.descriptor.url }
    })

    ipcMain.handle(RENEWAL_REMINDER_IPC.webReload, (event): RenewalWebState => {
      assertMainFrame(event)
      if (!service || !ownedBy('reminder', reminder.currentSessionId())) throw new Error(RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE)
      service.reload()
      return service.snapshot()
    })

    ipcMain.handle(RENEWAL_REMINDER_IPC.close, async (event): Promise<void> => {
      assertMainFrame(event)
      if (service && owner?.mode === 'reminder') await dispose()
      reminder.windowClosed()
    })

    ipcMain.handle(RENEWAL_REMINDER_IPC.openExternal, async (event, request: unknown): Promise<RenewalReminderExternalResult> => {
      assertMainFrame(event)
      const reminderKey = request && typeof request === 'object' ? (request as { reminderKey?: unknown }).reminderKey : null
      try {
        const link = await reminder.createLink(reminderKey)
        await shell.openExternal(link.url)
        return { ok: true, signed: link.signed }
      } catch (error) {
        const code = errorCode(error)
        if (code === 'no_reminder') return { ok: false, code, message: RENEWAL_REMINDER_NO_REMINDER_MESSAGE }
        if (code === 'not_logged_in') return { ok: false, code, message: RENEWAL_REMINDER_NOT_LOGGED_IN_MESSAGE }
        return { ok: false, code: 'unavailable', message: 'Không mở được trình duyệt. Vui lòng thử lại.' }
      }
    })
  }

  if (shop) {
    shop.onSessionChanged(() => {
      if (service && owner?.mode === 'shop' && shop.currentSessionId() !== owner.id) void dispose()
    })

    ipcMain.handle(UPGRADE_PORTAL_IPC.open, async (event, raw: unknown): Promise<UpgradePortalOpenResult> => {
      assertMainFrame(event)
      const request = parseUpgradePortalLinkRequest(raw)
      if (!request) return upgradePortalError('invalid_request')
      const sessionId = shop.currentSessionId()
      // Chưa đăng nhập chỉ có lối ở màn đăng nhập.
      if (sessionId === null && request.from !== 'login') return upgradePortalError('not_logged_in')
      // Màn Gia hạn trước đăng nhập hoặc cửa sổ "Gia hạn gói" của phiên này đang mở: dùng trang đang mở, không mở thêm form.
      if (sessionId === null && control.currentRenewalId() !== null) return upgradePortalError('busy')
      if (ownedBy('reminder', sessionId)) return upgradePortalError('busy')
      if (service && !ownedByShop(sessionId)) void dispose()
      // Chờ lượt cũ xoá xong phân vùng trước khi mở lượt mới trên cùng phân vùng.
      await cleanup
      if (shop.currentSessionId() !== sessionId) return upgradePortalError('not_logged_in')
      if (sessionId === null && control.currentRenewalId() !== null) return upgradePortalError('busy')
      if (service && !ownedByShop(sessionId)) return upgradePortalError('busy')
      // Hai lối bấm liên tiếp dùng lại form đang mở (giữ trang của lối bấm đầu).
      if (!service) {
        let completed = false
        service = new RenewalWebService(mainWindow, {
          createLink: async () => {
            const link = await shop.createLink(request, sessionId)
            // Đổi phiên trong lúc chờ vé: bỏ link, không nạp vào form.
            if (shop.currentSessionId() !== sessionId) throw new Error(UPGRADE_PORTAL_NOT_LOGGED_IN_MESSAGE)
            return link
          },
          isAllowed: () => shop.currentSessionId() === sessionId,
          stateChannel: UPGRADE_PORTAL_IPC.webState,
          texts: { openFailed: UPGRADE_PORTAL_OPEN_ERROR, loadFailed: UPGRADE_PORTAL_LOAD_ERROR },
          onOrderCompleted: () => {
            // Form mở từ màn đăng nhập không có phiên nào để đọc lại gói.
            if (completed || sessionId === null) return
            completed = true
            void shop.refreshEntitlements().catch(() => {})
          }
        })
        owner = { mode: 'shop', id: sessionId, products: sessionId === null ? '' : shop.productsFingerprint() }
      }
      return { ok: true, partition: service.descriptor.partition, url: service.descriptor.url }
    })

    ipcMain.handle(UPGRADE_PORTAL_IPC.webReload, (event): RenewalWebState => {
      assertMainFrame(event)
      if (!service || !ownedByShop(shop.currentSessionId())) throw new Error(UPGRADE_PORTAL_NOT_LOGGED_IN_MESSAGE)
      service.reload()
      return service.snapshot()
    })

    ipcMain.handle(UPGRADE_PORTAL_IPC.close, async (event): Promise<UpgradePortalCloseResult> => {
      assertMainFrame(event)
      if (!service || owner?.mode !== 'shop') return { updated: false }
      const { id: sessionId, products } = owner
      await dispose()
      // Đóng form thì đọc lại gói một lượt: nhận cả bản dùng thử vừa bật (trang CRM không đổi tiêu đề trong trường hợp này).
      if (sessionId === null || shop.currentSessionId() !== sessionId) return { updated: false }
      try { await shop.refreshEntitlements() } catch { return { updated: false } }
      if (shop.currentSessionId() !== sessionId) return { updated: false }
      return { updated: shop.productsFingerprint() !== products }
    })

    ipcMain.handle(UPGRADE_PORTAL_IPC.openExternal, async (event, raw: unknown): Promise<UpgradePortalExternalResult> => {
      assertMainFrame(event)
      const request = parseUpgradePortalLinkRequest(raw)
      if (!request) return upgradePortalError('invalid_request')
      const sessionId = shop.currentSessionId()
      if (sessionId === null && request.from !== 'login') return upgradePortalError('not_logged_in')
      try {
        const link = await shop.createLink(request, sessionId)
        if (shop.currentSessionId() !== sessionId) return upgradePortalError('not_logged_in')
        // Chỉ mở địa chỉ của cổng; link lạ thì báo lỗi, không mở.
        if (!isUpgradePortalUrl(link.url)) return upgradePortalError('unavailable')
        await shell.openExternal(link.url)
        return { ok: true, signed: link.signed }
      } catch {
        return { ok: false, code: 'unavailable', message: UPGRADE_PORTAL_EXTERNAL_ERROR }
      }
    })
  }

  mainWindow.once('closed', () => { void dispose() })
}
