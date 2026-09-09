import { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquare, RefreshCw } from 'lucide-react'
import type { ChatWebState } from '../../../shared/types'

interface ChatPageProps {
  sessionId: string
  isActive: boolean
}

export default function ChatPage({ sessionId, isActive }: ChatPageProps) {
  const [state, setState] = useState<ChatWebState | null>(null)
  const [descriptor, setDescriptor] = useState<Pick<ChatWebState, 'partition' | 'url'> | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const requestRunning = useRef(false)
  const mounted = useRef(false)
  const lastRevision = useRef(-1)
  const removeWebviewListeners = useRef<(() => void) | null>(null)

  const acceptState = useCallback((next: ChatWebState) => {
    if (!mounted.current || next.sessionId !== sessionId) return
    if (next.revision < lastRevision.current) return
    lastRevision.current = next.revision
    setState(previous => previous && previous.revision > next.revision ? previous : next)
    if (next.status === 'ready') {
      setDescriptor(previous => previous ?? { partition: next.partition, url: next.url })
      setRequestError(null)
    }
  }, [sessionId])

  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.electronAPI.onChatWebState(acceptState)
    return () => {
      mounted.current = false
      unsubscribe()
    }
  }, [acceptState])

  const request = useCallback(async (reload: boolean) => {
    if (requestRunning.current) return
    requestRunning.current = true
    setBusy(true)
    setRequestError(null)
    try {
      const next = await (reload ? window.electronAPI.reloadChatWeb() : window.electronAPI.prepareChatWeb())
      acceptState(next)
    } catch {
      if (mounted.current) setRequestError('Không thể mở Chat. Vui lòng thử lại hoặc đăng nhập lại akaAgent.')
    } finally {
      requestRunning.current = false
      if (mounted.current) setBusy(false)
    }
  }, [acceptState])

  useEffect(() => {
    if (isActive) void request(false)
    else webviewRef.current?.blur()
  }, [isActive, request])

  const attachWebview = useCallback((webview: Electron.WebviewTag | null) => {
    removeWebviewListeners.current?.()
    removeWebviewListeners.current = null
    webviewRef.current = webview
    if (!webview) return
    const start = (event: Electron.DidStartNavigationEvent) => {
      // Conversation selection uses history.pushState. Electron also emits
      // did-start-loading for it, but the existing Chat document stays visible.
      if (event.isMainFrame && !event.isInPlace) setPageLoading(true)
    }
    const stop = () => setPageLoading(false)
    webview.addEventListener('did-start-navigation', start)
    webview.addEventListener('did-stop-loading', stop)
    removeWebviewListeners.current = () => {
      webview.removeEventListener('did-start-navigation', start)
      webview.removeEventListener('did-stop-loading', stop)
    }
  }, [])

  const unavailable = !!requestError || state?.status !== 'ready'
  const message = requestError || state?.message || 'Đang kết nối Chat…'
  const canRetry = !!requestError || state?.status === 'error' || state?.status === 'signed-out'

  return (
    <section aria-label="Chat" style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-default)' }}>
        <MessageSquare size={17} />
        <span style={{ fontWeight: 600 }}>Chat</span>
        <span style={{ flex: 1, color: 'var(--text-secondary)', fontSize: 12 }}>chat.akabiz.biz</span>
        <button type="button" className="btn-icon" title="Tải lại Chat" aria-label="Tải lại Chat"
          disabled={busy || state?.status === 'connecting' || state?.status === 'closed'} onClick={() => void request(true)}>
          <RefreshCw size={15} />
        </button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {descriptor && (
          <webview
            ref={attachWebview}
            src={descriptor.url}
            partition={descriptor.partition}
            style={{ display: 'flex', width: '100%', height: '100%', visibility: unavailable ? 'hidden' : 'visible' }}
            /* @ts-ignore Electron's custom webview attributes are not included in React JSX types. */
            allowpopups="true"
            webpreferences="sandbox=yes,contextIsolation=yes,nodeIntegration=no,webSecurity=yes,backgroundThrottling=no"
          />
        )}
        {(unavailable || pageLoading) && (
          <div role={canRetry ? 'alert' : 'status'} style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center', background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
            <span>{unavailable ? message : 'Đang tải trang Chat…'}</span>
            {canRetry && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void request(true)}>
                {busy ? 'Đang kết nối…' : state?.status === 'signed-out' ? 'Kết nối lại' : 'Thử lại'}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
