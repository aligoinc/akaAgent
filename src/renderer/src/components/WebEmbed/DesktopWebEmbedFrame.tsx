import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshCw } from 'lucide-react'
import type { JourneyWebState, JourneyWebTheme } from '../../../../shared/journeyWebDesktop'
import { useThemeStore } from '../../stores/themeStore'
import './desktopWebEmbed.css'

/** Ba lời gọi tới main của một trang Web nhúng (Tự động hóa › Quy trình, Báo cáo 2). */
export interface DesktopWebEmbedApi {
  prepare: (theme: JourneyWebTheme, path?: string | null) => Promise<JourneyWebState>
  reload: () => Promise<JourneyWebState>
  onState: (callback: (state: JourneyWebState) => void) => () => void
}

/**
 * Một trang của Web ở chế độ nhúng (`?embed=desktop`). Main đăng nhập và đặt cookie phiên trong phân vùng riêng; webview
 * chỉ dựng khi khách mở trang lần đầu. Rời trang thì webview vẫn giữ (không tải lại khi quay về), Chromium tự giãn hẹn giờ
 * của trang ẩn vì webview này không tắt background throttling.
 */
export default function DesktopWebEmbedFrame({ api, label, regionLabel = label, bar, isActive, openPath }: {
  api: DesktopWebEmbedApi
  /** Tên trang trong câu báo ("Tự động hóa", "Báo cáo 2"). */
  label: string
  /** Tên vùng cho trình đọc màn hình và nút Tải lại (mặc định là `label`). */
  regionLabel?: string
  /** Dòng giới thiệu trên khung (có nút Tải lại); không truyền thì không có dòng này (trang Web có nút Làm mới riêng). */
  bar?: ReactNode
  isActive: boolean
  openPath?: { path: string; nonce: number } | null
}) {
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
    if (!mounted.current || next.revision < lastRevision.current) return
    lastRevision.current = next.revision
    setState(next)
    if (next.status === 'ready') {
      // Giữ webview đang có; chỉ dựng lại khi trang sập (generation đổi). Mở một đường cụ thể do main nạp lại.
      setDescriptor(previous => previous?.webviewGeneration === next.webviewGeneration ? previous : {
        partition: next.partition, url: next.url, webviewGeneration: next.webviewGeneration
      })
      setRequestError(null)
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    const unsubscribe = api.onState(acceptState)
    return () => { mounted.current = false; unsubscribe() }
  }, [acceptState, api])

  const request = useCallback(async (reload: boolean, path?: string | null) => {
    if (requestRunning.current) return
    requestRunning.current = true
    setBusy(true)
    setRequestError(null)
    try {
      acceptState(await (reload ? api.reload() : api.prepare(theme, path ?? null)))
    } catch {
      if (mounted.current) setRequestError(`Không thể mở ${label}. Vui lòng thử lại hoặc đăng nhập lại akaAgent.`)
    } finally {
      requestRunning.current = false
      if (mounted.current) setBusy(false)
    }
  }, [acceptState, api, label, theme])

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
  const message = requestError || state?.message || `Đang kết nối ${label}…`
  const canRetry = !!requestError || state?.status === 'error'

  return <section aria-label={regionLabel} className="journeys-embed">
    {bar && <div className="journeys-embed-bar">
      {bar}
      <button type="button" className="btn-icon" title="Tải lại" aria-label={`Tải lại ${regionLabel}`}
        disabled={busy || state?.status === 'connecting' || state?.status === 'closed'} onClick={() => void request(true)}>
        <RefreshCw size={15} />
      </button>
    </div>}
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
        <span>{unavailable ? message : `Đang tải trang ${label}…`}</span>
        {canRetry && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void request(true)}>{busy ? 'Đang kết nối…' : 'Thử lại'}</button>}
      </div>}
    </div>
  </section>
}
