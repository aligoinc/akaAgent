import { useCallback, useMemo } from 'react'
import { UPGRADE_PORTAL_MENU_LABEL, UPGRADE_PORTAL_OPEN_ERROR, type UpgradePortalLinkRequest } from '../../../../shared/upgradePortal'
import {
  UPGRADE_PORTAL_DONE_TEXT,
  UPGRADE_PORTAL_EXTERNAL_ERROR,
  UPGRADE_PORTAL_LOAD_ERROR,
  UPGRADE_PORTAL_LOADING_TEXT,
  UPGRADE_PORTAL_LOGIN_NOTE,
  UPGRADE_PORTAL_RELOAD_ERROR
} from '../../../../shared/upgradePortalDesktop'
import { useUpgradePortalStore } from '../../stores/upgradePortalStore'
import PortalWebWindow, { type PortalWebWindowDriver, type PortalWebWindowTexts } from '../RenewalReminder/PortalWebWindow'

const TEXTS: PortalWebWindowTexts = {
  title: UPGRADE_PORTAL_MENU_LABEL,
  done: UPGRADE_PORTAL_DONE_TEXT,
  loginNote: UPGRADE_PORTAL_LOGIN_NOTE,
  loading: UPGRADE_PORTAL_LOADING_TEXT,
  openFailed: UPGRADE_PORTAL_OPEN_ERROR,
  loadFailed: UPGRADE_PORTAL_LOAD_ERROR,
  reloadFailed: UPGRADE_PORTAL_RELOAD_ERROR,
  externalFailed: UPGRADE_PORTAL_EXTERNAL_ERROR,
  closeLabel: 'Đóng trang Nâng cấp và mua gói',
  frameLabel: 'Trang Nâng cấp và mua gói akaBiz'
}

/**
 * Form "Nâng cấp và mua gói": cùng khung và cùng webview cổng CRM với cửa sổ "Gia hạn gói", mở được cả khi không có lời
 * nhắc gia hạn và cả ở màn đăng nhập (khi đó khách đăng nhập ngay trên trang CRM trong form).
 */
export default function UpgradePortalWindow({ request }: { request: UpgradePortalLinkRequest }) {
  const from = request.from
  const entitlementId = request.entitlementId ?? null

  const driver = useMemo<PortalWebWindowDriver>(() => ({
    open: () => window.electronAPI.openUpgradePortal({ from, entitlementId }),
    reload: () => window.electronAPI.reloadUpgradePortal(),
    openExternal: () => window.electronAPI.openUpgradePortalExternal({ from, entitlementId }),
    onState: callback => window.electronAPI.onUpgradePortalWebState(callback)
  }), [from, entitlementId])

  const close = useCallback(() => { useUpgradePortalStore.getState().close() }, [])

  return <PortalWebWindow texts={TEXTS} driver={driver} overlayClassName="upgrade-portal-overlay" showReload onClose={close} />
}
