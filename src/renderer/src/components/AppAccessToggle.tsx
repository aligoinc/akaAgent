import { useEffect, useRef, useState } from 'react'
import type { AppAccessApp, AppAccessQuota, AppAccessTarget } from '../../../shared/appAccess'
import { useAuthStore } from '../stores/authStore'
import { staffErrorMessage } from '../../../shared/staffManagement'

export function AppAccessToggle({ targetType, targetId, app, enabled, stopping, quota, button, onChanged }: {
  targetType: AppAccessTarget; targetId: number; app: AppAccessApp; enabled: boolean
  stopping?: boolean; quota?: AppAccessQuota; button?: boolean; onChanged: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const pending = useRef<{ requestId: string; enabled: boolean } | null>(null)
  const mutex = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const reason = !enabled && stopping ? 'Đang dừng tác vụ cũ.'
    : !enabled && quota && !quota.hasPackage ? 'Ứng dụng chưa có gói còn hạn.'
    : !enabled && quota && quota.remaining === 0 ? 'Đã hết suất của ứng dụng.' : ''
  const label = button ? enabled ? 'Tắt đồng bộ akaChat' : 'Đồng bộ sang akaChat' : `Dùng ${app}`
  const change = async () => {
    if (mutex.current || reason) return
    mutex.current = true; setBusy(true); setError('')
    const session = useAuthStore.getState().user, desired = !enabled
    const isCurrent = () => alive.current && useAuthStore.getState().user === session
    if (!pending.current || pending.current.enabled !== desired) pending.current = { enabled: desired, requestId: crypto.randomUUID() }
    try {
      await window.electronAPI.appAccess.set({ targetType, targetId, app, ...pending.current })
      pending.current = null
      if (isCurrent()) {
        const appAccess = await window.electronAPI.appAccess.snapshot()
        if (isCurrent() && session) {
          useAuthStore.getState().handleUserUpdated({ ...session, appAccess })
          await onChanged()
        }
      }
    } catch (error) { if (isCurrent()) setError(staffErrorMessage(error)) }
    finally { mutex.current = false; if (alive.current) setBusy(false) }
  }
  return <span className="app-access-control" onClick={event => event.stopPropagation()}>
    {button ? <button className="context-menu-item" disabled={busy || !!reason} title={reason} onClick={() => void change()}>{busy ? 'Đang cập nhật…' : label}</button>
      : <label title={reason}><input type="checkbox" checked={enabled} disabled={busy || !!reason} onChange={() => void change()} /> {label}</label>}
    {stopping && <small role="status">Đang dừng</small>}
    {reason && <small>{reason}</small>}
    {error && <small role="alert">{error}</small>}
  </span>
}
