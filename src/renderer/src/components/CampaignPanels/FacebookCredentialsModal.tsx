import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { AutoAccount } from '../../../../shared/types'
import type { FacebookLoginMetadata } from '../../../../shared/facebookLogin'
import { facebookErrorMessage } from './FacebookImportModal'
import { useUiStore } from '../../stores/uiStore'
import './facebookLogin.css'

export default function FacebookCredentialsModal({ account, onClose }: { account: AutoAccount; onClose: () => void }) {
  const [meta, setMeta] = useState<FacebookLoginMetadata | null>(null), [uid, setUid] = useState('')
  const [password, setPassword] = useState(''), [seed, setSeed] = useState('')
  const [clearPassword, setClearPassword] = useState(false), [clearSeed, setClearSeed] = useState(false)
  const [operation, setOperation] = useState<'save' | 'login' | null>(null), [error, setError] = useState('')
  const busy = operation !== null
  const view = useRef(0)
  useEffect(() => {
    const generation = ++view.current
    void window.electronAPI.facebookLogin.metadata(account.id).then(value => { if (view.current === generation) { setMeta(value); setUid(value.uid || '') } })
      .catch(error => { if (view.current === generation) setError(facebookErrorMessage(error)) })
    return () => { view.current++ }
  }, [account.id])
  const close = () => { view.current++; onClose() }
  const submit = async (action: 'save' | 'login') => {
    if (!meta || busy) return
    const generation = view.current
    setOperation(action); setError('')
    try {
      await window.electronAPI.facebookLogin[action](account.id, { uid, revision: meta.revision,
        ...(clearPassword || password ? { password: clearPassword ? '' : password } : {}),
        ...(clearSeed || seed ? { twoFactorSecret: clearSeed ? '' : seed } : {}) })
      if (view.current === generation) close()
      if (action === 'login') useUiStore.getState().showAlert(`Đã đăng nhập Facebook bằng 2FA thành công cho “${account.name}”.`, 'success')
    } catch (error) {
      const message = facebookErrorMessage(error)
      if (view.current === generation) setError(message)
      if (action === 'login') useUiStore.getState().showAlert(`Kết quả đăng nhập “${account.name}”: ${message}`, 'error')
    }
    finally { if (view.current === generation) setOperation(null) }
  }
  return <div className="modal-overlay facebook-login-overlay"><section className="modal facebook-credentials-modal" role="dialog" aria-modal="true" aria-labelledby="fb-credentials-title">
    <header className="modal-header"><h3 id="fb-credentials-title">Thông tin đăng nhập · {account.name}</h3>
      <button type="button" className="btn-icon" aria-label="Đóng form thông tin đăng nhập" onClick={close}><X size={20}/></button>
    </header>
    <div className="modal-body facebook-login-body">
      <p>UID xác minh gần nhất: {account.facebookUid || 'Chưa có'}. Bạn có thể đăng nhập bằng 2FA ngay cả khi trình duyệt đã đăng nhập.</p>
      <label>UID<input className="stepper-input" value={uid} onChange={event => setUid(event.target.value)} disabled={busy || !meta}/></label>
      <label>Mật khẩu {meta?.hasPassword ? '(đã lưu)' : '(chưa lưu)'}<input className="stepper-input" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy || !meta || clearPassword} placeholder={meta?.hasPassword ? 'Để trống để giữ giá trị hiện tại' : 'Nhập mật khẩu Facebook'}/></label>
      {meta?.hasPassword && <label className="facebook-login-checkbox"><input type="checkbox" checked={clearPassword} onChange={event => setClearPassword(event.target.checked)} disabled={busy}/>Xóa mật khẩu đã lưu</label>}
      <label>Khóa 2FA {meta?.hasTwoFactor ? '(đã lưu)' : '(chưa lưu)'}<input className="stepper-input" type="password" autoComplete="new-password" value={seed} onChange={event => setSeed(event.target.value)} disabled={busy || !meta || clearSeed} placeholder="Khóa gốc, không phải mã OTP"/></label>
      {meta?.hasTwoFactor && <label className="facebook-login-checkbox"><input type="checkbox" checked={clearSeed} onChange={event => setClearSeed(event.target.checked)} disabled={busy}/>Xóa khóa 2FA đã lưu</label>}
      <p className="facebook-login-note">Đăng nhập thành công mới lưu thông tin và thay phiên trên trình duyệt hiện tại. Nếu đổi UID, nhập cả mật khẩu và khóa 2FA của UID mới. Cho phép UID trùng với tài khoản khác.</p>
      {!!meta?.revision && <p className="facebook-login-note">“Lưu” chỉ cập nhật thông tin, không đăng nhập. Nếu trình duyệt đang đăng nhập, UID cần lưu phải khớp phiên đó.</p>}
      {operation === 'login' && <div className="facebook-login-processing" role="status" aria-atomic="true">
        <Loader2 size={20} className="animate-spin" aria-hidden="true"/>
        <div>
          <strong>Đang đăng nhập và xác minh phiên…</strong>
          <p>Nếu Facebook gửi thông báo xác thực, hãy phê duyệt trên thiết bị của bạn.</p>
        </div>
      </div>}
      {error && <p className="facebook-login-error" role="alert">{error}</p>}
    </div>
    <footer className="modal-footer">
      <button className="btn btn-ghost" onClick={close} disabled={busy}>Hủy</button>
      {!!meta?.revision && <button className="btn btn-secondary" onClick={() => void submit('save')} disabled={busy || !uid.trim()}>{operation === 'save' ? 'Đang lưu…' : 'Lưu'}</button>}
      <button className="btn btn-primary" onClick={() => void submit('login')} disabled={busy || !meta || !uid.trim()}>{operation === 'login' ? 'Đang đăng nhập…' : 'Đăng nhập bằng 2FA'}</button>
    </footer>
  </section></div>
}
