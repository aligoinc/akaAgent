import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import type { RenewalWebState } from '../../../../shared/types'
import { useUiStore } from '../../stores/uiStore'

export interface PortalWebWindowTexts {
  title: string
  /** Hiện cạnh tiêu đề khi trang CRM báo đơn đã kích hoạt. */
  done: string
  /** Hiện khi không có vé: khách đăng nhập ngay trên trang CRM trong form. */
  loginNote: string
  loading: string
  openFailed: string
  loadFailed: string
  reloadFailed: string
  externalFailed: string
  closeLabel: string
  frameLabel: string
}

export type PortalWebWindowOpenResult =
  | { ok: true; partition: string; url: string }
  | { ok: false; message: string }

export interface PortalWebWindowDriver {
  /** Tiến trình chính chuẩn bị webview; link (có thể có vé) do tiến trình chính tự nạp vào guest. */
  open(): Promise<PortalWebWindowOpenResult>
  reload(): Promise<RenewalWebState>
  openExternal(): Promise<{ ok: true } | { ok: false; message: string }>
  onState(callback: (state: RenewalWebState) => void): () => void
}

interface PortalWebWindowProps {
  texts: PortalWebWindowTexts
  /** Phải ổn định giữa các lần vẽ (useMemo): đổi `driver` là mở lại từ đầu. */
  driver: PortalWebWindowDriver
  overlayClassName?: string
  /** Hiện nút "Tải lại" trên thanh tiêu đề. */
  showReload?: boolean
  /** Gọi đúng một lần khi khách đóng cửa sổ (nút X, phím Esc, hoặc tiến trình chính từ chối mở). */
  onClose(): void
  onCompleted?(): void
  onExternalOpened?(): void
}

/**
 * Cửa sổ nhúng cổng CRM `/gia-han` (phân vùng `akaagent_renewal`), dùng chung cho "Gia hạn gói" (nhắc gia hạn) và
 * "Nâng cấp và mua gói" (docs/UPGRADE_PORTAL_DESKTOP.md). Main tự nạp link (có vé hoặc trang đăng nhập cổng) vào guest;
 * renderer chỉ gắn `about:blank` và không bao giờ thấy link. Chiến dịch vẫn chạy trong lúc mở.
 */
export default function PortalWebWindow({ texts, driver, overlayClassName, showReload, onClose, onCompleted, onExternalOpened }: PortalWebWindowProps) {
  const [descriptor, setDescriptor] = useState<{ partition: string; url: string } | null>(null)
  const [webState, setWebState] = useState<RenewalWebState | null>(null)
  const [frameError, setFrameError] = useState<string | null>(null)
  const [frameLoading, setFrameLoading] = useState(true)
  const [frameKey, setFrameKey] = useState(0)
  const [openingExternal, setOpeningExternal] = useState(false)
  const completed = useRef(false)
  const closing = useRef(false)
  const removeListeners = useRef<(() => void) | null>(null)
  const callbacks = useRef({ onClose, onCompleted, onExternalOpened })
  callbacks.current = { onClose, onCompleted, onExternalOpened }

  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    callbacks.current.onClose()
  }, [])

  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const prepare = useCallback(async () => {
    setFrameError(null)
    setFrameLoading(true)
    try {
      const result = await driver.open()
      if (!mounted.current) return
      if (!result.ok) {
        useUiStore.getState().showAlert(result.message, 'info')
        close()
        return
      }
      setDescriptor({ partition: result.partition, url: result.url })
    } catch {
      if (!mounted.current) return
      setFrameError(texts.openFailed)
      setFrameLoading(false)
    }
  }, [driver, close, texts.openFailed])

  useEffect(() => { void prepare() }, [prepare])

  useEffect(() => driver.onState(state => {
    setWebState(state)
    if (state.status === 'error' && state.message) setFrameError(state.message)
    if (state.orderCompleted && !completed.current) {
      completed.current = true
      callbacks.current.onCompleted?.()
    }
  }), [driver])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [close])

  const attachWebview = useCallback((webview: Electron.WebviewTag | null) => {
    removeListeners.current?.()
    removeListeners.current = null
    if (!webview) return
    const start = (event: Electron.DidStartNavigationEvent) => {
      if (event.isMainFrame && !event.isInPlace && event.url !== 'about:blank') { setFrameError(null); setFrameLoading(true) }
    }
    const stop = () => setFrameLoading(false)
    const failed = (event: Electron.DidFailLoadEvent) => {
      if (event.isMainFrame && event.errorCode !== -3) {
        setFrameError(texts.loadFailed)
        setFrameLoading(false)
      }
    }
    // Không tải lại guest đã dừng; gắn webview mới để main nạp link mới.
    const crashed = () => { setFrameError(null); setFrameLoading(true); setFrameKey(key => key + 1) }
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
  }, [texts.loadFailed])

  useEffect(() => () => { removeListeners.current?.() }, [])

  const reload = async () => {
    if (!descriptor) { void prepare(); return }
    setFrameError(null)
    setFrameLoading(true)
    try {
      setWebState(await driver.reload())
    } catch {
      setFrameError(texts.reloadFailed)
      setFrameLoading(false)
    }
  }

  const openExternal = async () => {
    if (openingExternal) return
    setOpeningExternal(true)
    try {
      const result = await driver.openExternal()
      if (result.ok) callbacks.current.onExternalOpened?.()
      else useUiStore.getState().showAlert(result.message, 'info')
    } catch {
      useUiStore.getState().showAlert(texts.externalFailed, 'error')
    } finally { setOpeningExternal(false) }
  }

  const waitingForLink = !!descriptor && (!webState || webState.status === 'loading')
  const showOverlay = !!frameError || !descriptor || waitingForLink || frameLoading

  return (
    <div className={`modal-overlay renewal-reminder-overlay${overlayClassName ? ` ${overlayClassName}` : ''}`}>
      <div className="renewal-reminder-window" role="dialog" aria-modal="true" aria-labelledby="renewal-reminder-window-title">
        <div className="renewal-reminder-window-head">
          <strong id="renewal-reminder-window-title">{texts.title}</strong>
          {webState?.orderCompleted && (
            <span className="renewal-reminder-window-done" role="status"><CheckCircle2 size={15} aria-hidden="true" /> {texts.done}</span>
          )}
          {showReload && (
            <button type="button" className="renewal-reminder-secondary" onClick={() => { void reload() }}>
              <RefreshCw size={14} aria-hidden="true" /> Tải lại
            </button>
          )}
          <button type="button" className="renewal-reminder-secondary" onClick={() => { void openExternal() }} disabled={openingExternal}>
            <ExternalLink size={14} aria-hidden="true" /> Mở bằng trình duyệt
          </button>
          <button type="button" className="btn-icon" onClick={close} aria-label={texts.closeLabel} title="Đóng">
            <X size={18} />
          </button>
        </div>
        {webState && !webState.signed && webState.status !== 'loading' && !frameError && !webState.orderCompleted && (
          <p className="renewal-reminder-window-note" role="status">
            {texts.loginNote}
          </p>
        )}
        <section className="renewal-reminder-window-frame" aria-label={texts.frameLabel}>
          {descriptor && (
            <webview key={frameKey} ref={attachWebview} src={descriptor.url} partition={descriptor.partition}
              className="renewal-reminder-webview"
              /* @ts-ignore Electron's custom webview attributes are not included in React JSX types. */
              allowpopups="true"
              webpreferences="sandbox=yes,contextIsolation=yes,nodeIntegration=no,webSecurity=yes" />
          )}
          {showOverlay && (
            <div className="renewal-reminder-frame-overlay" role={frameError ? 'alert' : 'status'}>
              {frameError ? (
                <>
                  <span>{frameError}</span>
                  <button type="button" className="renewal-reminder-secondary" onClick={() => { void reload() }}>
                    <RefreshCw size={15} aria-hidden="true" /> Thử lại
                  </button>
                </>
              ) : (
                <span className="renewal-reminder-frame-loading"><Loader2 size={18} className="animate-spin" aria-hidden="true" /> {texts.loading}</span>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
