import { FormEvent, useState } from 'react'
import { Zap, LogIn, Loader2 } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'

export default function LoginPage() {
  const { login, loggingIn, errorMessage, clearError } = useAuthStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    try {
      await login(username.trim(), password)
    } catch {
      /* error đã được set vào store, render bên dưới */
    }
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
          border: '1px solid var(--border-color, #27272f)',
          borderRadius: 10,
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
              border: '1px solid var(--border-color, #27272f)',
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
              border: '1px solid var(--border-color, #27272f)',
              borderRadius: 6,
              color: 'var(--text-primary, #fff)',
              outline: 'none'
            }}
          />
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
