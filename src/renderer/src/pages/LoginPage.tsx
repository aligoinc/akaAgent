import { FormEvent, useEffect, useState } from 'react'
import { Zap, LogIn, Loader2 } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

export default function LoginPage() {
  const {
    login,
    loggingIn,
    errorMessage,
    clearError,
    loginOptions,
    setLoginOptions,
    savedCredentials
  } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [startupEnabled, setStartupEnabled] = useState(false)

  useEffect(() => {
    if (!loginOptions.rememberLogin || !savedCredentials) return
    setUsername(savedCredentials.username)
    setPassword(savedCredentials.password)
  }, [loginOptions.rememberLogin, savedCredentials])

  useEffect(() => {
    let active = true
    if (!window.electronAPI?.getStartupSetting) return
    window.electronAPI.getStartupSetting()
      .then(res => {
        if (active) setStartupEnabled(!!res.enabled)
      })
      .catch(err => console.warn('Get startup setting failed:', err))
    return () => {
      active = false
    }
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    try {
      await login(username.trim(), password, loginOptions)
    } catch {
      /* error đã được set vào store, render bên dưới */
    }
  }

  const handleStartupChange = async (checked: boolean) => {
    setStartupEnabled(checked)
    try {
      const res = await window.electronAPI.setStartupSetting(checked)
      setStartupEnabled(!!res.enabled)
    } catch (err) {
      setStartupEnabled(!checked)
      console.error('Set startup setting failed:', err)
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
            background: '#7c3aed',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Zap size={20} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary, #fff)' }}>akaBizAuto</div>
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
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: -4 }}>
          <label style={optionStyle}>
            <input
              type="checkbox"
              checked={loginOptions.rememberLogin}
              onChange={(e) => setLoginOptions({ rememberLogin: e.target.checked })}
              disabled={loggingIn}
              style={checkboxStyle}
            />
            <span>Ghi nhớ đăng nhập</span>
          </label>
          <label style={optionStyle}>
            <input
              type="checkbox"
              checked={loginOptions.autoLogin}
              onChange={(e) => setLoginOptions({ autoLogin: e.target.checked })}
              disabled={loggingIn}
              style={checkboxStyle}
            />
            <span>Tự động đăng nhập</span>
          </label>
          <label style={optionStyle}>
            <input
              type="checkbox"
              checked={startupEnabled}
              onChange={(e) => handleStartupChange(e.target.checked)}
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
