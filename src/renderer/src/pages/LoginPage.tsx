import { FormEvent, useEffect, useRef, useState } from 'react'
import { ArrowRight, ExternalLink, Eye, EyeOff, FileCheck2, Loader2, LockKeyhole, UserRound, X } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import LoginInformationPanel from '../components/Login/LoginInformationPanel'
import './LoginPage.css'

const appIconUrl = new URL('../assets/app-icon.png', import.meta.url).href
const POLICY_URL = 'https://akabiz.net/UpdateAutoSqlite/akaAgent/chinh-sach-akabiz.pdf'

interface PolicyConsentModalProps {
  busy: boolean
  errorMessage: string | null
  onAccept: () => Promise<void>
  onCancel: () => void
}

function PolicyConsentModal({ busy, errorMessage, onAccept, onCancel }: PolicyConsentModalProps) {
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [pdfLoadFailed, setPdfLoadFailed] = useState(false)

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleStartLoading = () => setPdfLoadFailed(false)
    const handleFailedLoading = () => setPdfLoadFailed(true)
    webview.addEventListener('did-start-loading', handleStartLoading)
    webview.addEventListener('did-fail-load', handleFailedLoading)
    return () => {
      webview.removeEventListener('did-start-loading', handleStartLoading)
      webview.removeEventListener('did-fail-load', handleFailedLoading)
    }
  }, [])

  const handleAccept = async () => {
    if (!agreed || busy) return
    try {
      await onAccept()
    } catch {
      // Store keeps the modal open and exposes a user-facing error below.
    }
  }

  return (
    <div className="modal-overlay" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="policy-consent-title"
        style={{
          width: 'min(1040px, calc(100vw - 48px))',
          height: 'min(860px, calc(100vh - 64px))',
          maxHeight: 'calc(100vh - 64px)'
        }}
      >
        <div className="modal-header">
          <div className="modal-title" id="policy-consent-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileCheck2 size={18} />
            <span>Chính sách sử dụng akaBiz</span>
          </div>
          <button type="button" className="btn-icon" onClick={onCancel} disabled={busy} title="Đóng">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            Vui lòng đọc chính sách dưới đây và xác nhận đồng ý để tiếp tục đăng nhập.
          </div>

          <div style={{ position: 'relative', flex: 1, minHeight: 320, border: '1px solid var(--border-default)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
            <webview
              ref={(element: Electron.WebviewTag | null) => { webviewRef.current = element }}
              src={POLICY_URL}
              style={{ width: '100%', height: '100%' }}
              /* @ts-ignore Electron's webview custom attributes are not represented by React's JSX types. */
              plugins="true"
            />
            {pdfLoadFailed && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24, background: 'var(--bg-primary)', color: 'var(--text-secondary)', textAlign: 'center' }}>
                <span>Không thể tải PDF trong ứng dụng.</span>
                <a className="btn btn-secondary" href={POLICY_URL} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> Mở chính sách trên trình duyệt
                </a>
              </div>
            )}
          </div>

          <a href={POLICY_URL} target="_blank" rel="noreferrer" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--accent-primary)' }}>
            <ExternalLink size={13} /> Mở chính sách trên trình duyệt
          </a>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: busy ? 'default' : 'pointer', color: 'var(--text-primary)', fontSize: 13, lineHeight: 1.5 }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={event => setAgreed(event.target.checked)}
              disabled={busy}
              style={{ width: 16, height: 16, marginTop: 2, accentColor: 'var(--accent-primary)' }}
            />
            <span>Tôi đã đọc, hiểu và đồng ý với chính sách sử dụng akaBiz.</span>
          </label>

          {errorMessage && (
            <div style={{ fontSize: 12, color: 'var(--accent-error)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 6, padding: '8px 10px' }}>
              {errorMessage}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Hủy
          </button>
          <button type="button" className="btn btn-primary" onClick={() => { void handleAccept() }} disabled={!agreed || busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />}
            {busy ? 'Đang ghi nhận…' : 'Đồng ý và tiếp tục'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const {
    login,
    loggingIn,
    acceptingPolicy,
    policyAcceptanceRequired,
    acceptPolicyAndLogin,
    cancelPolicyAcceptance,
    recoveringCredentials,
    errorMessage,
    clearError,
    loginOptions,
    setLoginOptions,
    recoverDeviceCredentials,
    savedCredentials
  } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (!savedCredentials) return
    setUsername(savedCredentials.username)
    setPassword(savedCredentials.password)
  }, [savedCredentials])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    try {
      await login(username.trim(), password, loginOptions)
    } catch {
      /* error đã được set vào store, render bên dưới */
    }
  }

  const recoverDisabled = loggingIn || recoveringCredentials

  return (
    <main className="login-page">
      <div className="login-shell">
        <section className="login-form-panel" aria-labelledby="login-title">
          <div className="login-brand">
            <img src={appIconUrl} alt="" width={42} height={42} />
            <div>
              <span className="login-brand-name">akaAgent</span>
              <span className="login-brand-caption">Giải pháp tự động hóa từ akaBiz</span>
            </div>
          </div>

          <header className="login-heading">
            <h1 id="login-title">Đăng nhập</h1>
            <p>Chào mừng bạn trở lại.<br />Hãy tiếp tục công việc của mình.</p>
          </header>

          <form className="login-form" onSubmit={handleSubmit} aria-busy={loggingIn}>
            <div className="login-field">
              <label htmlFor="login-username">Tên đăng nhập</label>
              <div className="login-input-wrap">
                <UserRound className="login-input-icon" size={17} strokeWidth={1.7} aria-hidden="true" />
                <input
                  id="login-username"
                  name="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  value={username}
                  onChange={event => { setUsername(event.target.value); if (errorMessage) clearError() }}
                  placeholder="Nhập tên đăng nhập"
                  disabled={loggingIn}
                  aria-describedby={errorMessage ? 'login-error' : undefined}
                />
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="login-password">Mật khẩu</label>
              <div className="login-input-wrap login-password-input">
                <LockKeyhole className="login-input-icon" size={17} strokeWidth={1.7} aria-hidden="true" />
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={event => { setPassword(event.target.value); if (errorMessage) clearError() }}
                  placeholder="Nhập mật khẩu"
                  disabled={loggingIn}
                  aria-describedby={errorMessage ? 'login-error' : undefined}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                  onClick={() => setShowPassword(value => !value)}
                  disabled={loggingIn}
                >
                  {showPassword ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                </button>
              </div>
              <button
                type="button"
                className="login-recover"
                onClick={() => { void recoverDeviceCredentials() }}
                disabled={recoverDisabled}
              >
                {recoveringCredentials ? 'Đang lấy tên đăng nhập…' : 'Lấy lại tên đăng nhập'}
              </button>
            </div>

            <fieldset className="login-options" disabled={loggingIn}>
              <legend className="login-sr-only">Tùy chọn đăng nhập</legend>
              <label className="login-option">
                <input type="checkbox" checked={loginOptions.rememberLogin} onChange={event => { void setLoginOptions({ rememberLogin: event.target.checked }) }} />
                <span>Ghi nhớ đăng nhập</span>
              </label>
              <label className="login-option">
                <input type="checkbox" checked={loginOptions.autoLogin} onChange={event => { void setLoginOptions({ autoLogin: event.target.checked }) }} />
                <span>Tự động đăng nhập</span>
              </label>
              <label className="login-option">
                <input type="checkbox" checked={loginOptions.startupEnabled} onChange={event => { void setLoginOptions({ startupEnabled: event.target.checked }) }} />
                <span>Khởi động cùng máy tính</span>
              </label>
            </fieldset>

            {errorMessage && <p className="login-error" id="login-error" role="alert">{errorMessage}</p>}

            <button type="submit" className="login-submit" disabled={loggingIn || !username.trim() || !password}>
              {loggingIn ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : null}
              {loggingIn ? 'Đang đăng nhập…' : 'Đăng nhập'}
              {!loggingIn && <ArrowRight size={17} aria-hidden="true" />}
            </button>
          </form>
        </section>

        <LoginInformationPanel />
      </div>
      {policyAcceptanceRequired && (
        <PolicyConsentModal
          busy={acceptingPolicy}
          errorMessage={errorMessage}
          onAccept={acceptPolicyAndLogin}
          onCancel={cancelPolicyAcceptance}
        />
      )}
    </main>
  )
}
