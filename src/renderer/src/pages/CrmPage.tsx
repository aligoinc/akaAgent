import { useCallback, useEffect, useRef, useState } from 'react'
import { ContactRound, RefreshCw } from 'lucide-react'
import type { CrmWebDescriptor } from '../../../shared/types'

export default function CrmPage({ isActive }: { isActive: boolean }) {
  const [descriptor, setDescriptor] = useState<CrmWebDescriptor | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const mounted = useRef(false)
  const preparing = useRef(false)
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const removeListeners = useRef<(() => void) | null>(null)

  const prepare = useCallback(async () => {
    if (preparing.current) return
    preparing.current = true
    setError(null)
    setLoading(true)
    try {
      const next = await window.electronAPI.prepareCrmWeb()
      if (mounted.current) setDescriptor(next)
    } catch {
      if (mounted.current) {
        setError('Không thể mở CRM. Vui lòng thử lại hoặc đăng nhập lại akaAgent.')
        setLoading(false)
      }
    } finally { preparing.current = false }
  }, [])

  useEffect(() => {
    mounted.current = true
    void prepare()
    return () => { mounted.current = false }
  }, [prepare])

  useEffect(() => {
    if (!isActive) webviewRef.current?.blur()
  }, [isActive])

  const attachWebview = useCallback((webview: Electron.WebviewTag | null) => {
    removeListeners.current?.()
    removeListeners.current = null
    webviewRef.current = webview
    if (!webview) return
    const start = (event: Electron.DidStartNavigationEvent) => {
      if (event.isMainFrame && !event.isInPlace) { setError(null); setLoading(true) }
    }
    const stop = () => setLoading(false)
    const failed = (event: Electron.DidFailLoadEvent) => {
      if (event.isMainFrame && event.errorCode !== -3) {
        setError('Không thể tải trang CRM. Vui lòng kiểm tra internet và thử lại.')
        setLoading(false)
      }
    }
    const crashed = () => {
      // Reloading a crashed guest can terminate Electron itself. Drop it now;
      // retry prepares a fresh webview in the same staff browser partition.
      setDescriptor(null)
      setError('Trang CRM đã dừng. Vui lòng tải lại.')
      setLoading(false)
    }
    webview.addEventListener('did-start-navigation', start)
    webview.addEventListener('did-stop-loading', stop)
    webview.addEventListener('did-fail-load', failed)
    webview.addEventListener('render-process-gone', crashed)
    removeListeners.current = () => {
      webview.removeEventListener('did-start-navigation', start)
      webview.removeEventListener('did-stop-loading', stop)
      webview.removeEventListener('did-fail-load', failed)
      webview.removeEventListener('render-process-gone', crashed)
    }
  }, [])

  const reload = () => {
    if (!descriptor || !webviewRef.current) { void prepare(); return }
    try {
      setError(null)
      webviewRef.current.reload()
    } catch { setError('Không thể tải lại CRM. Vui lòng mở lại akaAgent.') }
  }

  return (
    <section aria-label="CRM" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-default)' }}>
        <ContactRound size={17} />
        <span style={{ fontWeight: 600 }}>CRM</span>
        <span style={{ flex: 1, color: 'var(--text-secondary)', fontSize: 12 }}>aka10000.fly.dev</span>
        <button type="button" className="btn-icon" title="Tải lại CRM" aria-label="Tải lại CRM" disabled={loading} onClick={reload}>
          <RefreshCw size={15} />
        </button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {descriptor && (
          <webview ref={attachWebview} src={descriptor.url} partition={descriptor.partition}
            style={{ display: 'flex', width: '100%', height: '100%' }}
            /* @ts-ignore Electron's custom webview attributes are not included in React JSX types. */
            allowpopups="true"
            webpreferences="sandbox=yes,contextIsolation=yes,nodeIntegration=no,webSecurity=yes,backgroundThrottling=no" />
        )}
        {(error || loading) && (
          <div role={error ? 'alert' : 'status'} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
            <span>{error || 'Đang tải CRM…'}</span>
            {error && <button type="button" className="btn btn-secondary" disabled={loading} onClick={reload}>Thử lại</button>}
          </div>
        )}
      </div>
    </section>
  )
}
