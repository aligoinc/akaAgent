import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import type { AuthRenewalKind, AuthRenewalProduct, AuthRenewalRequired, RenewalWebDescriptor, RenewalWebState } from '../../../shared/types'
import { useAuthStore } from '../stores/authStore'
import './RenewalPage.css'

const appIconUrl = new URL('../assets/app-icon.png', import.meta.url).href
/** Kiểm lại nhẹ khi màn đang hiển thị; dừng sau 30 phút để không giữ request vô hạn. */
const AUTO_RECHECK_INTERVAL_MS = 60_000
const AUTO_RECHECK_WINDOW_MS = 30 * 60_000
const FOCUS_RECHECK_MIN_GAP_MS = 20_000
const RENEWAL_ENDED_TEXT = 'Phiên gia hạn đã kết thúc'

const KIND_BADGES: Record<AuthRenewalKind, string> = {
  trial_expired: 'Hết hạn dùng thử',
  package_expired: 'Hết hạn gói',
  no_package: 'Chưa có gói'
}

const dateFormatter = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric'
})

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : dateFormatter.format(date)
}

function describeProduct(product: AuthRenewalProduct): string {
  const date = formatDate(product.expirationDate)
  return `${product.displayName} (${product.isTrial ? 'dùng thử' : 'gói'}${date ? ` hết hạn ${date}` : ' đã hết hạn'})`
}

function headline(renewal: AuthRenewalRequired): { title: string; detail: string } {
  const focus = renewal.focusProduct
  const date = formatDate(focus?.expirationDate)
  if (renewal.kind === 'trial_expired') {
    return {
      title: 'Bản dùng thử akaAgent đã kết thúc',
      detail: focus
        ? `${focus.displayName} hết hạn dùng thử${date ? ` ngày ${date}` : ''}. Nâng cấp để tiếp tục chạy chiến dịch.`
        : 'Nâng cấp để tiếp tục chạy chiến dịch.'
    }
  }
  if (renewal.kind === 'package_expired') {
    return {
      title: 'Gói akaAgent đã hết hạn',
      detail: focus
        ? `Gói ${focus.displayName} hết hạn${date ? ` ngày ${date}` : ''}. Gia hạn để chiến dịch chạy lại.`
        : 'Gia hạn để chiến dịch chạy lại.'
    }
  }
  return { title: 'Tài khoản chưa có gói akaAgent', detail: 'Chọn gói phù hợp để bắt đầu sử dụng akaAgent.' }
}

export default function RenewalPage() {
  const { renewal, renewalChecking, renewalNotice, recheckRenewal, cancelRenewal, openRenewalExternal } = useAuthStore()
  const [descriptor, setDescriptor] = useState<RenewalWebDescriptor | null>(null)
  const [webState, setWebState] = useState<RenewalWebState | null>(null)
  const [frameError, setFrameError] = useState<string | null>(null)
  const [frameLoading, setFrameLoading] = useState(true)
  const [frameKey, setFrameKey] = useState(0)
  const [openingExternal, setOpeningExternal] = useState(false)
  const mounted = useRef(false)
  const preparing = useRef(false)
  const lastCheckAt = useRef(0)
  const startedAt = useRef(Date.now())
  const completedRevision = useRef<number | null>(null)
  const removeListeners = useRef<(() => void) | null>(null)

  const endRenewal = useCallback((message: string) => {
    void cancelRenewal().then(() => useAuthStore.setState({ errorMessage: message }))
  }, [cancelRenewal])

  const prepare = useCallback(async () => {
    if (preparing.current) return
    preparing.current = true
    setFrameError(null)
    setFrameLoading(true)
    try {
      const next = await window.electronAPI.prepareRenewalWeb()
      if (mounted.current) setDescriptor(next)
    } catch (error) {
      if (!mounted.current) return
      const message = error instanceof Error ? error.message : ''
      if (message.includes(RENEWAL_ENDED_TEXT)) { endRenewal(`${RENEWAL_ENDED_TEXT}. Vui lòng đăng nhập lại.`); return }
      setFrameError('Không thể mở trang gia hạn. Vui lòng thử lại.')
      setFrameLoading(false)
    } finally { preparing.current = false }
  }, [endRenewal])

  const check = useCallback((automatic: boolean) => {
    lastCheckAt.current = Date.now()
    if (!automatic) startedAt.current = Date.now()
    void recheckRenewal({ automatic })
  }, [recheckRenewal])

  useEffect(() => {
    mounted.current = true
    void prepare()
    return () => { mounted.current = false }
  }, [prepare])

  useEffect(() => {
    return window.electronAPI.onRenewalWebState(state => {
      setWebState(state)
      if (state.status === 'error' && state.message) setFrameError(state.message)
      // Trang CRM báo đơn đã kích hoạt: kiểm ngay để vào phần mềm.
      if (state.orderCompleted && completedRevision.current === null) {
        completedRevision.current = state.revision
        check(true)
      }
    })
  }, [check])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - startedAt.current > AUTO_RECHECK_WINDOW_MS) return
      check(true)
    }, AUTO_RECHECK_INTERVAL_MS)
    const onFocus = () => {
      if (Date.now() - startedAt.current > AUTO_RECHECK_WINDOW_MS) return
      if (Date.now() - lastCheckAt.current < FOCUS_RECHECK_MIN_GAP_MS) return
      check(true)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [check])

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
    const crashed = () => {
      // Không tải lại guest đã dừng; gắn webview mới để main nạp link mới.
      setFrameError(null)
      setFrameLoading(true)
      setFrameKey(key => key + 1)
    }
    // Main đóng guest khi phiên gia hạn kết thúc (quá thời gian chờ…): kiểm lại để về đúng màn.
    const destroyed = () => { void useAuthStore.getState().recheckRenewal({ automatic: true }) }
    webview.addEventListener('did-start-navigation', start)
    webview.addEventListener('did-stop-loading', stop)
    webview.addEventListener('did-fail-load', failed)
    webview.addEventListener('render-process-gone', crashed)
    webview.addEventListener('destroyed', destroyed)
    removeListeners.current = () => {
      webview.removeEventListener('did-start-navigation', start)
      webview.removeEventListener('did-stop-loading', stop)
      webview.removeEventListener('did-fail-load', failed)
      webview.removeEventListener('render-process-gone', crashed)
      webview.removeEventListener('destroyed', destroyed)
    }
  }, [])

  const reload = async () => {
    if (!descriptor) { void prepare(); return }
    setFrameError(null)
    setFrameLoading(true)
    try {
      setWebState(await window.electronAPI.reloadRenewalWeb())
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes(RENEWAL_ENDED_TEXT)) { endRenewal(`${RENEWAL_ENDED_TEXT}. Vui lòng đăng nhập lại.`); return }
      setFrameError('Không thể tải lại trang gia hạn. Vui lòng thử lại.')
      setFrameLoading(false)
    }
  }

  const openExternal = async () => {
    if (openingExternal) return
    setOpeningExternal(true)
    try { await openRenewalExternal() } finally { setOpeningExternal(false) }
  }

  if (!renewal) return null
  const { title, detail } = headline(renewal)
  // Mỗi nhóm sản phẩm (Facebook, Zalo…) một dòng; bỏ nhóm đang là trọng tâm.
  const others = renewal.products.filter(product => product.displayName !== renewal.focusProduct?.displayName)
  const waitingForLink = !webState || webState.status === 'loading'
  const showOverlay = !!frameError || waitingForLink || frameLoading

  return (
    <main className="renewal-page" aria-labelledby="renewal-title">
      <header className="renewal-header">
        <div className="renewal-brand">
          <img src={appIconUrl} alt="" width={36} height={36} />
          <div>
            <span className="renewal-brand-name">akaAgent</span>
            <span className="renewal-brand-caption">Gia hạn và nâng cấp</span>
          </div>
        </div>
        <div className="renewal-status">
          <span className={`renewal-badge renewal-badge-${renewal.kind}`}>{KIND_BADGES[renewal.kind]}</span>
          <h1 id="renewal-title">{title}</h1>
          <p>{detail}</p>
          {others.length > 0 && <p className="renewal-status-others">Sản phẩm khác: {others.map(describeProduct).join(', ')}.</p>}
        </div>
        <div className="renewal-actions">
          <button type="button" className="renewal-button renewal-button-primary" onClick={() => check(false)} disabled={renewalChecking}>
            {renewalChecking ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
            {renewalChecking ? 'Đang kiểm tra…' : 'Tôi đã thanh toán – vào phần mềm'}
          </button>
          <button type="button" className="renewal-button" onClick={() => { void openExternal() }} disabled={openingExternal}>
            <ExternalLink size={15} aria-hidden="true" /> Mở bằng trình duyệt
          </button>
          <button type="button" className="renewal-button renewal-button-ghost" onClick={() => { void cancelRenewal() }}>
            <ArrowLeft size={15} aria-hidden="true" /> Đăng nhập tài khoản khác
          </button>
        </div>
      </header>

      {renewalNotice && (
        <p className={`renewal-notice renewal-notice-${renewalNotice.tone}`} role={renewalNotice.tone === 'error' ? 'alert' : 'status'}>
          {renewalNotice.text}
        </p>
      )}
      {webState && !webState.signed && webState.status !== 'loading' && !frameError && (
        <p className="renewal-notice renewal-notice-info" role="status">
          Vui lòng đăng nhập trang gia hạn bằng tài khoản akaAgent <strong>{renewal.username}</strong> để tiếp tục.
        </p>
      )}

      <section className="renewal-frame" aria-label="Trang gia hạn akaBiz">
        {descriptor && (
          <webview key={frameKey} ref={attachWebview} src={descriptor.url} partition={descriptor.partition}
            className="renewal-webview"
            /* @ts-ignore Electron's custom webview attributes are not included in React JSX types. */
            allowpopups="true"
            webpreferences="sandbox=yes,contextIsolation=yes,nodeIntegration=no,webSecurity=yes" />
        )}
        {showOverlay && (
          <div className="renewal-frame-overlay" role={frameError ? 'alert' : 'status'}>
            {frameError ? (
              <>
                <span>{frameError}</span>
                <button type="button" className="renewal-button" onClick={() => { void reload() }}>
                  <RefreshCw size={15} aria-hidden="true" /> Thử lại
                </button>
              </>
            ) : (
              <span className="renewal-frame-loading"><Loader2 size={18} className="animate-spin" aria-hidden="true" /> Đang mở trang gia hạn…</span>
            )}
          </div>
        )}
      </section>

      <footer className="renewal-footer">
        <ShieldCheck size={15} aria-hidden="true" />
        <span>Chuyển khoản xong, hệ thống tự kích hoạt gói trong 1–2 phút và akaAgent tự vào phần mềm. Tài khoản: <strong>{renewal.username}</strong></span>
      </footer>
    </main>
  )
}
