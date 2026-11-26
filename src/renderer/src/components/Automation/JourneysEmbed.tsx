import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, Workflow } from 'lucide-react'
import type { ReactNode } from 'react'
import { JOURNEY_WEB_VIEWS, type JourneyWebState, type JourneyWebView } from '../../../../shared/journeyWebDesktop'
import { useThemeStore } from '../../stores/themeStore'

/**
 * Thẻ Tự động hóa › Quy trình: trang Tự động hóa của Web ở chế độ nhúng (`?embed=desktop`). Main đăng nhập và đặt cookie phiên
 * trong phân vùng riêng; webview chỉ dựng khi khách mở thẻ lần đầu. Rời thẻ thì webview vẫn giữ (không tải lại khi quay về),
 * Chromium tự giãn hẹn giờ của trang ẩn vì webview này không tắt background throttling.
 */
/**
 * Cũng dùng cho mục Bot sự kiện (`view = 'eventBot'`, trang /automation/event-bot cùng phiên): chỉ khác chữ trên thanh và trong câu báo.
 */
export default function JourneysEmbed({ isActive, openPath, view = 'automation', ariaLabel = 'Quy trình',
  description = 'Quy trình tự động: dựng kéo thả hoặc nhờ Agent dựng, chạy trên máy chủ.', icon }: {
  isActive: boolean
  openPath?: { path: string; nonce: number } | null
  view?: JourneyWebView
  ariaLabel?: string
  description?: string
  icon?: ReactNode
}) {
  const title = JOURNEY_WEB_VIEWS[view].title
  const theme = useThemeStore(state => state.theme)
  const [state, setState] = useState<JourneyWebState | null>(null)
  const [descriptor, setDescriptor] = useState<Pick<JourneyWebState, 'partition' | 'url' | 'webviewGeneration'> | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const requestRunning = useRef(false)
  const mounted = useRef(false)
  const lastRevision = useRef(-1)
  const removeWebviewListeners = useRef<(() => void) | null>(null)
  const handledOpen = useRef(0)

  const acceptState = useCallback((next: JourneyWebState) => {
    if (!mounted.current || (next.view ?? 'automation') !== view || next.revision < lastRevision.current) return
    lastRevision.current = next.revision
    setState(next)
    if (next.status === 'ready') {
      // Giữ webview đang có; chỉ dựng lại khi trang sập (generation đổi). Mở một quy trình cụ thể do main nạp lại.
      setDescriptor(previous => previous?.webviewGeneration === next.webviewGeneration ? previous : {
        partition: next.partition, url: next.url, webviewGeneration: next.webviewGeneration
      })
      setRequestError(null)
    }
  }, [view])

  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.electronAPI.onJourneyWebState(acceptState)
    return () => { mounted.current = false; unsubscribe() }
  }, [acceptState])

  const request = useCallback(async (reload: boolean, path?: string | null) => {
    if (requestRunning.current) return
    requestRunning.current = true
    setBusy(true)
    setRequestError(null)
    try {
      acceptState(await (reload ? window.electronAPI.journeyWebReload(view) : window.electronAPI.journeyWebPrepare(theme, path ?? null, view)))
    } catch {
      if (mounted.current) setRequestError(`Không thể mở ${title}. Vui lòng thử lại hoặc đăng nhập lại akaAgent.`)
    } finally {
      requestRunning.current = false
      if (mounted.current) setBusy(false)
    }
  }, [acceptState, theme, view, title])

  useEffect(() => {
    if (!isActive) return
    const pending = openPath && openPath.nonce !== handledOpen.current ? openPath : null
    if (pending) handledOpen.current = pending.nonce
    void request(false, pending?.path ?? null)
  }, [isActive, openPath, request])

  const attachWebview = useCallback((webview: Electron.WebviewTag | null) => {
    removeWebviewListeners.current?.()
    removeWebviewListeners.current = null
    if (!webview) return
    const start = (event: Electron.DidStartNavigationEvent) => { if (event.isMainFrame && !event.isInPlace) setPageLoading(true) }
    const stop = () => setPageLoading(false)
    webview.addEventListener('did-start-navigation', start)
    webview.addEventListener('did-stop-loading', stop)
    removeWebviewListeners.current = () => {
      webview.removeEventListener('did-start-navigation', start)
      webview.removeEventListener('did-stop-loading', stop)
    }
  }, [])

  const unavailable = !!requestError || state?.status !== 'ready'
  const message = requestError || state?.message || `Đang kết nối ${title}…`
  const canRetry = !!requestError || state?.status === 'error'

  return <section aria-label={ariaLabel} className="journeys-embed">
    <div className="journeys-embed-bar">
      {icon ?? <Workflow size={16} aria-hidden="true" />}
      <span>{description}</span>
      <button type="button" className="btn-icon" title="Tải lại" aria-label={`Tải lại ${ariaLabel}`}
        disabled={busy || state?.status === 'connecting' || state?.status === 'closed'} onClick={() => void request(true)}>
        <RefreshCw size={15} />
      </button>
    </div>
    <div className="journeys-embed-frame">
      {descriptor && <webview
        key={descriptor.webviewGeneration}
        ref={attachWebview}
        src={descriptor.url}
        partition={descriptor.partition}
        style={{ display: 'flex', width: '100%', height: '100%', visibility: unavailable ? 'hidden' : 'visible' }}
        /* @ts-ignore Electron's custom webview attributes are not included in React JSX types. */
        allowpopups="true"
        webpreferences="sandbox=yes,contextIsolation=yes,nodeIntegration=no,webSecurity=yes"
      />}
      {(unavailable || pageLoading) && <div role={canRetry ? 'alert' : 'status'} className="journeys-embed-overlay">
        <span>{unavailable ? message : `Đang tải trang ${title}…`}</span>
        {canRetry && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void request(true)}>{busy ? 'Đang kết nối…' : 'Thử lại'}</button>}
      </div>}
    </div>
  </section>
}
