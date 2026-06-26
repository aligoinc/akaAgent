import { X, AlertCircle, CheckCircle, Info } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'

export default function AlertModal() {
  const { alert, closeAlert } = useUiStore()
  if (!alert.isOpen) return null

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
        <div className="modal-footer" style={{ justifyContent: 'center', borderTop: 'none', paddingBottom: '24px' }}>
          <button className="btn btn-primary" onClick={closeAlert} style={{ padding: '8px 32px' }}>Đóng</button>
        </div>
      </div>
    </div>
  )
}
