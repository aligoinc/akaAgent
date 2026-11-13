import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, X } from 'lucide-react'
import type { RenewalWebState } from '../../../../shared/types'
import { useRenewalReminderStore } from '../../stores/renewalReminderStore'
import { useUiStore } from '../../stores/uiStore'

/**
 * Cửa sổ "Gia hạn gói" khi đang đăng nhập: webview cổng CRM `/gia-han` (phân vùng `akaagent_renewal`). Main tự nạp link
 * (ký số hoặc trang đăng nhập cổng) vào guest; renderer chỉ gắn `about:blank`. Chiến dịch vẫn chạy trong lúc mở.
 */
export default function RenewalReminderWindow({ reminderKey }: { reminderKey: string }) {
  const closeWindow = useRenewalReminderStore(store => store.closeWindow)
  const markRenewed = useRenewalReminderStore(store => store.markRenewed)
  const markRefreshOnFocus = useRenewalReminderStore(store => store.markRefreshOnFocus)
  const [descriptor, setDescriptor] = useState<{ partition: string; url: string } | null>(null)
  const [webState, setWebState] = useState<RenewalWebState | null>(null)
  const [frameError, setFrameError] = useState<string | null>(null)
  const [frameLoading, setFrameLoading] = useState(true)
  const [frameKey, setFrameKey] = useState(0)
  const [openingExternal, setOpeningExternal] = useState(false)
  const completed = useRef(false)
  const closing = useRef(false)
  const removeListeners = useRef<(() => void) | null>(null)

  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    // Main xoá dữ liệu phân vùng và đọc lại gói (khách có thể đã thanh toán rồi đóng).
    void window.electronAPI.closeRenewalReminderWindow().catch(() => {}).finally(closeWindow)
  }, [closeWindow])

  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const prepare = useCallback(async () => {
    setFrameError(null)
    setFrameLoading(true)
    try {
      const result = await window.electronAPI.openRenewalReminderWindow(reminderKey)
      if (!mounted.current) return
      if (!result.ok) {
        useUiStore.getState().showAlert(result.message, 'info')
        close()
        return
      }
      setDescriptor({ partition: result.partition, url: result.url })
    } catch {
      if (!mounted.current) return
      setFrameError('Không thể mở trang gia hạn. Vui lòng thử lại.')
      setFrameLoading(false)
    }
  }, [reminderKey, close])

  useEffect(() => { void prepare() }, [prepare])

  useEffect(() => window.electronAPI.onRenewalReminderWebState(state => {
    setWebState(state)
    if (state.status === 'error' && state.message) setFrameError(state.message)
    if (state.orderCompleted && !completed.current) {
      completed.current = true
      markRenewed()
    }
  }), [markRenewed])

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
        setFrameError('Không tải được trang gia hạn. Vui lòng kiểm tra internet và thử lại.')
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
  }, [])

  useEffect(() => () => { removeListeners.current?.() }, [])

  const reload = async () => {
    if (!descriptor) { void prepare(); return }
    setFrameError(null)
    setFrameLoading(true)
    try {
      setWebState(await window.electronAPI.reloadRenewalReminderWindow())
    } catch {
      setFrameError('Không thể tải lại trang gia hạn. Vui lòng thử lại.')
      setFrameLoading(false)
    }
  }

  const openExternal = async () => {
    if (openingExternal) return
    setOpeningExternal(true)
    try {
      const result = await window.electronAPI.openRenewalReminderExternal(reminderKey)
      if (result.ok) markRefreshOnFocus()
      else useUiStore.getState().showAlert(result.message, 'info')
    } catch {
      useUiStore.getState().showAlert('Không mở được trình duyệt. Vui lòng thử lại.', 'error')
    } finally { setOpeningExternal(false) }
  }

  const waitingForLink = !!descriptor && (!webState || webState.status === 'loading')
  const showOverlay = !!frameError || !descriptor || waitingForLink || frameLoading

  return (
    <div className="modal-overlay renewal-reminder-overlay">
      <div className="renewal-reminder-window" role="dialog" aria-modal="true" aria-labelledby="renewal-reminder-window-title">
        <div className="renewal-reminder-window-head">
          <strong id="renewal-reminder-window-title">Gia hạn gói</strong>
          {webState?.orderCompleted && (
            <span className="renewal-reminder-window-done" role="status"><CheckCircle2 size={15} aria-hidden="true" /> Đã gia hạn thành công.</span>
          )}
          <button type="button" className="renewal-reminder-secondary" onClick={() => { void openExternal() }} disabled={openingExternal}>
            <ExternalLink size={14} aria-hidden="true" /> Mở bằng trình duyệt
          </button>
          <button type="button" className="btn-icon" onClick={close} aria-label="Đóng cửa sổ gia hạn" title="Đóng">
            <X size={18} />
          </button>
        </div>
        {webState && !webState.signed && webState.status !== 'loading' && !frameError && !webState.orderCompleted && (
          <p className="renewal-reminder-window-note" role="status">
            Vui lòng đăng nhập trang gia hạn bằng tài khoản akaAgent của bạn để tiếp tục.
          </p>
        )}
        <section className="renewal-reminder-window-frame" aria-label="Trang gia hạn akaBiz">
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
                <span className="renewal-reminder-frame-loading"><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Đang mở trang gia hạn…</span>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
