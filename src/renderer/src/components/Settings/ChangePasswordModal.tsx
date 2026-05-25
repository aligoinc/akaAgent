import { useState, type FormEvent } from 'react'
import { KeyRound, X } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { useUiStore } from '../../stores/uiStore'

interface ChangePasswordModalProps {
  onClose: () => void
}

export default function ChangePasswordModal({ onClose }: ChangePasswordModalProps) {
  const changePassword = useAuthStore(state => state.changePassword)
  const showAlert = useUiStore(state => state.showAlert)
  const [newPassword, setNewPassword] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const handleClose = () => {
    if (!busy) onClose()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    if (!newPassword) {
      showAlert('Vui lòng nhập mật khẩu mới.', 'error')
      return
    }
    if (!oldPassword) {
      showAlert('Vui lòng nhập mật khẩu cũ.', 'error')
      return
    }

    try {
      setBusy(true)
      await changePassword(oldPassword, newPassword)
      showAlert('Đã đổi mật khẩu thành công.', 'success')
      onClose()
    } catch (err: any) {
      setBusy(false)
      showAlert(err?.message || 'Đổi mật khẩu thất bại.', 'error')
    }
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <form className="modal change-password-modal" onSubmit={handleSubmit} onClick={event => event.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <KeyRound size={17} />
            <span>Đổi mật khẩu</span>
          </div>
          <button type="button" className="btn-icon" onClick={handleClose} disabled={busy} title="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body change-password-body">
          <div className="stepper-form-group">
            <label htmlFor="new-password">Mật khẩu mới</label>
            <input
              id="new-password"
              className="stepper-input"
              type="text"
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              disabled={busy}
              autoFocus
            />
          </div>
          <div className="stepper-form-group">
            <label htmlFor="old-password">Mật khẩu cũ</label>
            <input
              id="old-password"
              className="stepper-input"
              type="text"
              value={oldPassword}
              onChange={event => setOldPassword(event.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={handleClose} disabled={busy}>
            Hủy
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !newPassword || !oldPassword}>
            {busy ? 'Đang lưu...' : 'Xác nhận'}
          </button>
        </div>
      </form>
    </div>
  )
}
