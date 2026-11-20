import { useEffect, useRef, useState } from 'react'
import { X, AlertCircle, CheckCircle, Info, Loader2 } from 'lucide-react'
import { useUiStore, type AlertAction } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { useUpgradePortalStore } from '../../stores/upgradePortalStore'
import { UPGRADE_PORTAL_FEATURE_BUTTON_LABEL } from '../../../../shared/upgradePortal'
import { isUpgradePortalFeatureMessage } from '../../../../shared/upgradePortalDesktop'

export default function AlertModal() {
  const { alert, closeAlert } = useUiStore()
  const loggedIn = useAuthStore(state => !!state.user)
  // Nút thêm đang chạy việc có Promise (ví dụ "Mở trình duyệt" chờ vài giây cho tab tải trang).
  const [pendingAction, setPendingAction] = useState<AlertAction | null>(null)
  const pendingController = useRef<AbortController | null>(null)
  useEffect(() => {
    if (alert.isOpen && alert.extraAction === pendingAction) return
    pendingController.current?.abort()
    pendingController.current = null
    setPendingAction(null)
  }, [alert.isOpen, alert.extraAction, pendingAction])
  if (!alert.isOpen) return null

  const busy = pendingAction !== null && pendingAction === alert.extraAction
  // Đóng / X luôn bấm được: huỷ việc đang chờ của nút thêm rồi đóng hộp.
  const handleClose = () => {
    pendingController.current?.abort()
    closeAlert()
  }

  // "Tính năng … chưa được kích hoạt hoặc đã hết hạn.": thêm lối mua / dùng thử ngay trong thông báo (form "Nâng cấp và mua
  // gói"). Chỉ áp dụng cho thông báo lỗi chưa có nút riêng và khi đang đăng nhập; nút "Đóng" giữ nguyên.
  const offerUpgrade = loggedIn && alert.type === 'error' && !alert.action && !alert.extraAction && isUpgradePortalFeatureMessage(alert.message)
  const handleUpgrade = () => {
    closeAlert()
    useUpgradePortalStore.getState().open({ from: 'feature' })
  }

  const handleAction = () => {
    const action = alert.action
    pendingController.current?.abort()
    closeAlert()
    if (action) {
      void action.onClick(new AbortController().signal)
    }
  }

  const handleExtraAction = () => {
    const action = alert.extraAction
    if (!action || busy) return
    const controller = new AbortController()
    const result = action.onClick(controller.signal)
    if (!result || typeof (result as Promise<void>).then !== 'function') {
      closeAlert()
      return
    }
    pendingController.current = controller
    setPendingAction(action)
    void (result as Promise<void>)
      .catch(error => console.error('Alert action failed:', error))
      .finally(() => {
        if (controller.signal.aborted) return
        if (useUiStore.getState().alert.extraAction === action) closeAlert()
      })
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 10000, position: 'fixed', top: 0, left: 0, width: '100%', height: '100%' }}>
      <div className="campaign-full-modal campaign-feedback-modal" style={{ width: '400px', height: 'auto', minHeight: 'unset', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', margin: 0 }}>
        <div className="campaign-modal-top" style={{ height: 'auto', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-default)' }}>
          <h2 className="section-title" style={{ margin: 0, border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px' }}>
            {alert.type === 'error' && <AlertCircle color="var(--accent-error)" size={20} />}
            {alert.type === 'success' && <CheckCircle color="var(--accent-success)" size={20} />}
            {alert.type === 'info' && <Info color="var(--text-primary)" size={20} />}
            <span>{alert.type === 'error' ? 'Lỗi' : alert.type === 'success' ? 'Thành công' : 'Thông báo'}</span>
          </h2>
          <button className="btn-icon" onClick={handleClose}><X size={18} /></button>
        </div>
        <div className="campaign-modal-body" style={{ padding: '24px 16px', fontSize: '14px', textAlign: 'center', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
          {alert.message}
        </div>
        <div className="modal-footer" style={{ justifyContent: 'center', gap: '8px', borderTop: 'none', paddingBottom: '24px' }}>
          {alert.extraAction ? (
            <>
              <button className="btn btn-secondary" onClick={alert.action ? handleAction : handleClose} style={{ padding: '8px 24px' }}>
                {alert.action?.label || 'Đóng'}
              </button>
              <button className="btn btn-primary" onClick={handleExtraAction} disabled={busy} aria-busy={busy}
                style={{ padding: '8px 24px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                {busy && <Loader2 size={14} className="spin" />}
                {busy ? (alert.extraAction.pendingLabel || alert.extraAction.label) : alert.extraAction.label}
              </button>
            </>
          ) : offerUpgrade ? (
            <>
              <button className="btn btn-secondary" onClick={closeAlert} style={{ padding: '8px 24px' }}>Đóng</button>
              <button className="btn btn-primary" onClick={handleUpgrade} style={{ padding: '8px 24px' }}>{UPGRADE_PORTAL_FEATURE_BUTTON_LABEL}</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={alert.action ? handleAction : closeAlert} style={{ padding: '8px 32px' }}>
              {alert.action?.label || 'Đóng'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
