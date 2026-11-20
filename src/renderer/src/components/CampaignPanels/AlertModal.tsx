import { X, AlertCircle, CheckCircle, Info } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import { useAuthStore } from '../../stores/authStore'
import { useUpgradePortalStore } from '../../stores/upgradePortalStore'
import { UPGRADE_PORTAL_FEATURE_BUTTON_LABEL } from '../../../../shared/upgradePortal'
import { isUpgradePortalFeatureMessage } from '../../../../shared/upgradePortalDesktop'

export default function AlertModal() {
  const { alert, closeAlert } = useUiStore()
  const loggedIn = useAuthStore(state => !!state.user)
  if (!alert.isOpen) return null

  // "Tính năng … chưa được kích hoạt hoặc đã hết hạn.": thêm lối mua / dùng thử ngay trong thông báo (form "Nâng cấp và mua
  // gói"). Chỉ áp dụng cho thông báo lỗi chưa có nút riêng và khi đang đăng nhập; nút "Đóng" giữ nguyên.
  const offerUpgrade = loggedIn && alert.type === 'error' && !alert.action && !alert.extraAction && isUpgradePortalFeatureMessage(alert.message)
  const handleUpgrade = () => {
    closeAlert()
    useUpgradePortalStore.getState().open({ from: 'feature' })
  }

  const handleAction = () => {
    const action = alert.action
    closeAlert()
    if (action) {
      void action.onClick()
    }
  }

  const handleExtraAction = () => {
    const action = alert.extraAction
    closeAlert()
    if (action) {
      void action.onClick()
    }
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
          <button className="btn-icon" onClick={closeAlert}><X size={18} /></button>
        </div>
        <div className="campaign-modal-body" style={{ padding: '24px 16px', fontSize: '14px', textAlign: 'center', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
          {alert.message}
        </div>
        <div className="modal-footer" style={{ justifyContent: 'center', gap: '8px', borderTop: 'none', paddingBottom: '24px' }}>
          {alert.extraAction ? (
            <>
              <button className="btn btn-secondary" onClick={alert.action ? handleAction : closeAlert} style={{ padding: '8px 24px' }}>
                {alert.action?.label || 'Đóng'}
              </button>
              <button className="btn btn-primary" onClick={handleExtraAction} style={{ padding: '8px 24px' }}>{alert.extraAction.label}</button>
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
