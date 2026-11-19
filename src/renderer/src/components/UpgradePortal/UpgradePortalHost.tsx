import { useEffect } from 'react'
import { useRenewalReminderStore } from '../../stores/renewalReminderStore'
import { useUpgradePortalStore } from '../../stores/upgradePortalStore'
import UpgradePortalWindow from './UpgradePortalWindow'

/**
 * Giữ form "Nâng cấp và mua gói". `scope` = tổ chức + nhân viên đang đăng nhập, null ở màn đăng nhập. Đổi phiên (đăng nhập,
 * đăng xuất, đổi tài khoản) thì bỏ form; cửa sổ "Gia hạn gói" mở lên thì nhường chỗ (hai cửa sổ dùng chung một webview).
 */
export default function UpgradePortalHost({ scope }: { scope: string | null }) {
  const request = useUpgradePortalStore(store => store.request)
  const openSeq = useUpgradePortalStore(store => store.openSeq)
  const renewalWindowOpen = useRenewalReminderStore(store => store.windowOpen)

  useEffect(() => {
    useUpgradePortalStore.getState().reset()
    return () => useUpgradePortalStore.getState().reset()
  }, [scope])

  useEffect(() => {
    if (renewalWindowOpen) useUpgradePortalStore.getState().reset()
  }, [renewalWindowOpen])

  if (!request || renewalWindowOpen) return null
  return <UpgradePortalWindow key={openSeq} request={request} />
}
