import { FormEvent, useEffect, useState } from 'react'
import { LogIn, Loader2 } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

const appIconUrl = new URL('../assets/app-icon.png', import.meta.url).href

export default function LoginPage() {
  const {
    login,
    loggingIn,
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

  const optionStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: 'var(--text-secondary, #aaa)',
    cursor: loggingIn ? 'default' : 'pointer',
    userSelect: 'none' as const
  }

  const checkboxStyle = {
    width: 14,
    height: 14,
    accentColor: 'var(--accent-primary, #7c3aed)'
  }

  const recoverDisabled = loggingIn || recoveringCredentials

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'var(--bg-primary, #0a0a0f)'
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 380,
          padding: 28,
          background: 'var(--bg-secondary, #14141c)',
          border: '1px solid var(--border-default, #27272f)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden'
          }}>
            <img src={appIconUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #fff)' }}>akaBiz</div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary, #888)' }}>Đăng nhập để tiếp tục</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary, #aaa)' }}>Tên đăng nhập</label>
          <input
            type="text"
            autoFocus
            value={username}
            onChange={(e) => { setUsername(e.target.value); if (errorMessage) clearError() }}
            placeholder="Nhập tên đăng nhập"
            disabled={loggingIn}
            style={{
              padding: '9px 12px',
              fontSize: 13,
              background: 'var(--bg-primary, #0a0a0f)',
              border: '1px solid var(--border-default, #27272f)',
              borderRadius: 6,
              color: 'var(--text-primary, #fff)',
              outline: 'none'
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary, #aaa)' }}>Mật khẩu</label>
          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); if (errorMessage) clearError() }}
            placeholder="Nhập mật khẩu"
            disabled={loggingIn}
            style={{
              padding: '9px 12px',
              fontSize: 13,
              background: 'var(--bg-primary, #0a0a0f)',
              border: '1px solid var(--border-default, #27272f)',
              borderRadius: 6,
              color: 'var(--text-primary, #fff)',
              outline: 'none'
            }}
          />
          <button
            type="button"
            onClick={() => { void recoverDeviceCredentials() }}
            disabled={recoverDisabled}
            style={{
              alignSelf: 'flex-end',
              border: 'none',
              background: 'transparent',
              color: recoverDisabled ? 'var(--text-tertiary, #888)' : 'var(--accent-primary, #7c3aed)',
              cursor: recoverDisabled ? 'default' : 'pointer',
              fontSize: 12,
              padding: 0,
              marginTop: 2,
              textDecoration: recoverDisabled ? 'none' : 'underline'
            }}
          >
            {recoveringCredentials ? 'Đang lấy tên đăng nhập...' : 'Lấy lại tên đăng nhập'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: -4 }}>
          <label style={optionStyle}>
            <input
              type="checkbox"
              checked={loginOptions.rememberLogin}
              onChange={(e) => { void setLoginOptions({ rememberLogin: e.target.checked }) }}
              disabled={loggingIn}
              style={checkboxStyle}
            />
            <span>Ghi nhớ đăng nhập</span>
          </label>
          <label style={optionStyle}>
            <input
              type="checkbox"
              checked={loginOptions.autoLogin}
              onChange={(e) => { void setLoginOptions({ autoLogin: e.target.checked }) }}
              disabled={loggingIn}
              style={checkboxStyle}
            />
            <span>Tự động đăng nhập</span>
          </label>
          <label style={optionStyle}>
            <input
              type="checkbox"
              checked={loginOptions.startupEnabled}
              onChange={(e) => { void setLoginOptions({ startupEnabled: e.target.checked }) }}
              disabled={loggingIn}
              style={checkboxStyle}
            />
            <span>Khởi động cùng máy tính</span>
          </label>
        </div>

        {errorMessage && (
          <div style={{
            fontSize: 12,
            color: 'var(--accent-error, #ef4444)',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 6,
            padding: '8px 10px'
          }}>
            {errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={loggingIn || !username.trim() || !password}
          className="btn btn-primary"
          style={{ justifyContent: 'center', padding: '10px 14px', fontSize: 13 }}
        >
          {loggingIn ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
          {loggingIn ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  )
}
