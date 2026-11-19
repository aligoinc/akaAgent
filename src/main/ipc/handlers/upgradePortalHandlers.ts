import { getCurrentUser } from '../../data/currentUser'
import { issueRenewalLinkTicket } from '../../data/repositories/renewalReminderRepository'
import { renewalReminderService } from '../../services/renewalReminderService'
import {
  UPGRADE_PORTAL_NOT_LOGGED_IN_MESSAGE,
  buildUpgradePortalDesktopLink,
  upgradePortalProductsFingerprint
} from '../../../shared/upgradePortalDesktop'
import type { UpgradePortalWebControl } from './renewalWebHandlers'

/**
 * "Nâng cấp và mua gói" (docs/UPGRADE_PORTAL_DESKTOP.md): MỘT hàm mở cổng cho mọi lối của phần mềm (menu, Thông tin tài khoản,
 * màn đăng nhập, dải thông báo, thông báo tính năng chưa kích hoạt). Các kênh IPC `upgrade-portal:*` đăng ký trong
 * `registerRenewalWebHandlers` vì form dùng chung webview và phân vùng với cửa sổ "Gia hạn gói".
 *
 * Mỗi lần mở khi đang đăng nhập gọi DB đúng 1 lượt (xin vé `aka_agent_renewal_link_ticket`, V521); chưa đăng nhập thì 0 lượt.
 * Sản phẩm trên yêu cầu chỉ được dùng khi thuộc gói của phiên đang đăng nhập (so với gói đã có trong RAM, không đọc DB).
 * `refreshEntitlements` là lượt kiểm gói sẵn có (cùng hàm với cửa sổ "Gia hạn gói").
 */
export function createUpgradePortalWebControl(refreshEntitlements: () => Promise<void>): UpgradePortalWebControl {
  return {
    currentSessionId: () => renewalReminderService.currentSessionId(),
    onSessionChanged: listener => renewalReminderService.onSessionChanged(listener),
    createLink: async (request, sessionId) => {
      if (sessionId === null) {
        return buildUpgradePortalDesktopLink({ from: request.from, ownedEntitlementIds: null, issueTicket: async () => null })
      }
      const user = getCurrentUser()
      if (!user || renewalReminderService.currentSessionId() !== sessionId) throw new Error(UPGRADE_PORTAL_NOT_LOGGED_IN_MESSAGE)
      const ownedEntitlementIds = (user.accountProducts ?? [])
        .map(product => product.organizationProductId)
        .filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0)
      return buildUpgradePortalDesktopLink({
        from: request.from,
        entitlementId: request.entitlementId,
        ownedEntitlementIds,
        // Vé dùng một lần do DB cấp (V521); DB chưa có hàm, quá hạn mức hoặc lỗi gọi thì dùng link thường.
        issueTicket: issueRenewalLinkTicket
      })
    },
    productsFingerprint: () => upgradePortalProductsFingerprint(getCurrentUser()?.accountProducts),
    refreshEntitlements
  }
}
