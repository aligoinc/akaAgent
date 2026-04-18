import { useState } from 'react'
import { X, AlertTriangle, HelpCircle } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'

export default function ConfirmModal() {
  const { confirm, closeConfirm } = useUiStore()
  const [busy, setBusy] = useState(false)
  if (!confirm.isOpen) return null

  const handleConfirm = async () => {
    if (busy) return
    try {
      setBusy(true)
      await confirm.onConfirm?.()
    } finally {
      setBusy(false)
      closeConfirm()
    }
  }

  const handleCancel = () => {
    if (busy) return
    closeConfirm()
  }

  const isDanger = confirm.variant === 'danger'
  const confirmBtnClass = isDanger ? 'btn btn-danger' : 'btn btn-primary'

  return (
    <div className="modal-overlay" style={{ zIndex: 10001, position: 'fixed', top: 0, left: 0, width: '100%', height: '100%' }}>
      <div className="campaign-full-modal" style={{ width: '420px', height: 'auto', minHeight: 'unset', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', margin: 0 }}>
        <div className="campaign-modal-top" style={{ height: 'auto', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-default)' }}>
          <h2 className="section-title" style={{ margin: 0, border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px' }}>
            {isDanger
              ? <AlertTriangle color="var(--accent-error)" size={20} />
              : <HelpCircle color="var(--text-primary)" size={20} />}
            <span>{confirm.title}</span>
          </h2>
          <button className="btn-icon" onClick={handleCancel} disabled={busy}><X size={18} /></button>
        </div>
        <div className="campaign-modal-body" style={{ padding: '24px 16px', fontSize: '14px', textAlign: 'center', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
          {confirm.message}
        </div>
        <div className="modal-footer" style={{ justifyContent: 'center', gap: 8, borderTop: 'none', paddingBottom: '24px' }}>
          <button className="btn btn-ghost" onClick={handleCancel} disabled={busy} style={{ padding: '8px 24px' }}>
            {confirm.cancelText}
          </button>
          <button className={confirmBtnClass} onClick={handleConfirm} disabled={busy} style={{ padding: '8px 24px' }}>
            {busy ? 'Đang xử lý…' : confirm.confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
