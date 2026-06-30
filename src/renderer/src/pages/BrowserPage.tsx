import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { useCampaignStore } from '../stores/campaignStore'
import { AutoAccount } from '../../../shared/types'

const PLATFORM_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  tiktok: 'https://www.tiktok.com',
  shopee: 'https://banhang.shopee.vn',
  instagram: 'https://www.instagram.com',
}
const BROWSERLESS_PLATFORMS = new Set(['zalo', 'email'])
const OPEN_REQUEST_SETTLE_MS = 900

export interface BrowserOpenRequest {
  requestId: number
  accountId: number
  requestedAt: number
  reloadAfterOpen?: boolean
}

export interface BrowserOpenResult {
  requestId: number
  accountId: number
  success: boolean
  reason?: string
}

interface WebviewEventHandlers {
  domReady: EventListener
  didFinishLoad: EventListener
  didFailLoad: EventListener
}

interface WebviewReadyState {
  domReady: boolean
  didFinishLoad: boolean
  lastError?: string
}

interface BrowserPageProps {
  openRequest?: BrowserOpenRequest | null
  onRequestHandled?: (result: BrowserOpenResult) => void
}

export default function BrowserPage({ openRequest, onRequestHandled }: BrowserPageProps) {
  const { accounts, loadingAccounts, loadAccounts } = useCampaignStore()
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null)
  const [preparedProxyByAccountId, setPreparedProxyByAccountId] = useState<Map<number, number | null>>(new Map())
  const [accountsLoadAttempted, setAccountsLoadAttempted] = useState(false)
  const [pendingOpenRequest, setPendingOpenRequest] = useState<BrowserOpenRequest | null>(null)
  const [webviewReadyVersion, setWebviewReadyVersion] = useState(0)
  const [backgroundPreviews, setBackgroundPreviews] = useState<Map<number, {
    active: boolean
    image?: string
    context?: 'campaign' | 'contact-scan'
    title?: string
    timestamp: string
  }>>(new Map())
  const webviewRefs = useRef<Map<number, Electron.WebviewTag>>(new Map())
  const webviewEventHandlers = useRef<Map<number, WebviewEventHandlers>>(new Map())
  const webviewReadyState = useRef<Map<number, WebviewReadyState>>(new Map())
  const registeredIds = useRef<Set<number>>(new Set())
  const preparingSessionKeys = useRef<Set<string>>(new Set())

  // Filter out disabled and API-only platforms - they don't get browser tabs/profiles.
  const browserAccounts = accounts.filter(a => a.isActive && !BROWSERLESS_PLATFORMS.has(a.flatformType))

  // Load accounts on mount
  useEffect(() => {
    let cancelled = false
    loadAccounts()
      .finally(() => {
        if (!cancelled) setAccountsLoadAttempted(true)
      })
    return () => {
      cancelled = true
    }
  }, [loadAccounts])

  // Auto-select first account
  useEffect(() => {
    if (browserAccounts.length > 0 && activeAccountId === null) {
      setActiveAccountId(browserAccounts[0].id)
    }
  }, [browserAccounts, activeAccountId])

  useEffect(() => {
    if (activeAccountId !== null && !browserAccounts.some(account => account.id === activeAccountId)) {
      setActiveAccountId(browserAccounts[0]?.id ?? null)
    }
  }, [browserAccounts, activeAccountId])

  const markAccountPrepared = useCallback((accountId: number, proxyId: number | null) => {
    setPreparedProxyByAccountId(prev => {
      const next = new Map(prev)
      next.set(accountId, proxyId)
      return next
    })
  }, [])

  const prepareAccountSession = useCallback(async (account: AutoAccount) => {
    const proxyKey = account.proxyId ?? null

    if (!window.electronAPI?.prepareAccountBrowserSession) {
      markAccountPrepared(account.id, proxyKey)
      return
    }

    await window.electronAPI.prepareAccountBrowserSession(account.id)
    markAccountPrepared(account.id, proxyKey)
  }, [markAccountPrepared])

  const removeWebviewEventHandlers = useCallback((accountId: number, wv?: Electron.WebviewTag) => {
    const handlers = webviewEventHandlers.current.get(accountId)
    const target = wv || webviewRefs.current.get(accountId)
    if (handlers && target) {
      target.removeEventListener('dom-ready', handlers.domReady)
      target.removeEventListener('did-finish-load', handlers.didFinishLoad)
      target.removeEventListener('did-fail-load', handlers.didFailLoad)
    }
    webviewEventHandlers.current.delete(accountId)
    webviewReadyState.current.delete(accountId)
  }, [])

  const updateWebviewReadyState = useCallback((accountId: number, patch: Partial<WebviewReadyState>) => {
    const prev = webviewReadyState.current.get(accountId) || { domReady: false, didFinishLoad: false }
    webviewReadyState.current.set(accountId, { ...prev, ...patch })
    setWebviewReadyVersion(version => version + 1)
  }, [])

  useEffect(() => {
    let cancelled = false

    browserAccounts.forEach(account => {
      const proxyKey = account.proxyId ?? null
      if (webviewRefs.current.has(account.id)) return
      if (preparedProxyByAccountId.get(account.id) === proxyKey) return

      const prepareKey = `${account.id}:${proxyKey ?? 'none'}`
      if (preparingSessionKeys.current.has(prepareKey)) return
      preparingSessionKeys.current.add(prepareKey)

      prepareAccountSession(account)
        .catch(err => {
          console.error('Failed to prepare browser session:', err)
          if (!cancelled) markAccountPrepared(account.id, proxyKey)
        })
        .finally(() => {
          preparingSessionKeys.current.delete(prepareKey)
        })
    })

    return () => {
      cancelled = true
    }
  }, [browserAccounts, preparedProxyByAccountId, prepareAccountSession, markAccountPrepared])

  // Stage open requests from AccountPanel until the target webview is truly mounted.
  useEffect(() => {
    if (openRequest) {
      setPendingOpenRequest(openRequest)
    }
  }, [openRequest])

  // Background/offscreen campaign runs stream previews here so users can observe
  // without the app forcing focus or relying on minimized webview painting.
  useEffect(() => {
    if (!window.electronAPI?.onCampaignBrowserPreview) return
    return window.electronAPI.onCampaignBrowserPreview((preview) => {
      setBackgroundPreviews(prev => {
        const next = new Map(prev)
        const existing = next.get(preview.accountId)
        const active = preview.active === true
        next.set(preview.accountId, {
          active,
          context: preview.context || 'campaign',
          image: active ? (preview.image || existing?.image) : undefined,
          title: active ? preview.title : undefined,
          timestamp: preview.timestamp
        })
        return next
      })
    })
  }, [])

  // Unregister webviews for accounts that are no longer browser-capable.
  useEffect(() => {
    const browserAccountIds = new Set(browserAccounts.map(account => account.id))
    Array.from(registeredIds.current).forEach((accountId) => {
      if (!browserAccountIds.has(accountId)) {
        removeWebviewEventHandlers(accountId)
        webviewRefs.current.delete(accountId)
        window.electronAPI?.unregisterWebview(accountId).catch(() => {})
        registeredIds.current.delete(accountId)
      }
    })
  }, [browserAccounts, removeWebviewEventHandlers])

  // Cleanup: unregister all webviews on unmount
  useEffect(() => {
    return () => {
      registeredIds.current.forEach((accountId) => {
        removeWebviewEventHandlers(accountId)
        window.electronAPI?.unregisterWebview(accountId).catch(() => {})
      })
      registeredIds.current.clear()
      webviewEventHandlers.current.clear()
      webviewReadyState.current.clear()
      webviewRefs.current.clear()
    }
  }, [removeWebviewEventHandlers])

  const getInitialUrl = (account: AutoAccount) => {
    return PLATFORM_URLS[account.flatformType] || 'about:blank'
  }

  const getProfilePartition = (accountId: number) => {
    return `persist:account_${accountId}`
  }

  const markRequestHandled = useCallback((result: BrowserOpenResult) => {
    setPendingOpenRequest(prev => prev?.requestId === result.requestId ? null : prev)
    onRequestHandled?.(result)
  }, [onRequestHandled])

  const registerWebviewNow = useCallback((accountId: number, wv: Electron.WebviewTag) => {
    try {
      const wcId = (wv as any).getWebContentsId?.()
      if (wcId && window.electronAPI) {
        const wasRegistered = registeredIds.current.has(accountId)
        window.electronAPI.registerWebview(accountId, wcId).catch(err => {
          console.error('Failed to register webview:', err)
        })
        registeredIds.current.add(accountId)
        if (!wasRegistered) setWebviewReadyVersion(version => version + 1)
        return true
      }
    } catch (err) {
      console.error('Failed to register webview:', err)
    }
    return false
  }, [])

  const inspectVisibleWebview = useCallback((account: AutoAccount): { ready: boolean; reason?: string } => {
    if (activeAccountId !== account.id) {
      return { ready: false, reason: 'Chưa chọn được tab quan sát' }
    }

    const wv = webviewRefs.current.get(account.id)
    if (!wv) {
      return { ready: false, reason: 'Tab trình duyệt chưa được mở' }
    }

    const element = wv as unknown as HTMLElement
    if (!element.isConnected) {
      return { ready: false, reason: 'Tab trình duyệt không còn gắn vào giao diện' }
    }

    const rect = element.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8) {
      return { ready: false, reason: 'Tab trình duyệt chưa hiển thị trong vùng quan sát' }
    }

    let webContentsId: number | undefined
    try {
      webContentsId = (wv as any).getWebContentsId?.()
    } catch {}
    if (!webContentsId) {
      return { ready: false, reason: 'Tab trình duyệt chưa được mở' }
    }

    const state = webviewReadyState.current.get(account.id)
    if (state?.lastError) {
      return { ready: false, reason: state.lastError }
    }
    if (state?.domReady || state?.didFinishLoad) {
      return { ready: true }
    }

    try {
      const url = (wv as any).getURL?.()
      if (typeof url === 'string' && url.trim() && url !== 'about:blank') {
        return { ready: true }
      }
    } catch {}

    return { ready: false, reason: 'Tab trình duyệt chưa sẵn sàng' }
  }, [activeAccountId])

  const handleReload = async () => {
    if (!activeAccountId) return
    const account = browserAccounts.find(item => item.id === activeAccountId)
    if (account) {
      try {
        await prepareAccountSession(account)
      } catch (err) {
        console.error('Failed to prepare browser session before reload:', err)
      }
    }
    const wv = webviewRefs.current.get(activeAccountId)
    if (wv) wv.reload()
  }

  const activeBackgroundPreview = activeAccountId ? backgroundPreviews.get(activeAccountId) : null
  const isBrowserSessionPrepared = (account: AutoAccount) => (
    webviewRefs.current.has(account.id) || preparedProxyByAccountId.get(account.id) === (account.proxyId ?? null)
  )
  const preparedBrowserAccounts = browserAccounts.filter(isBrowserSessionPrepared)
  const activeAccount = activeAccountId ? browserAccounts.find(account => account.id === activeAccountId) : null
  const activeAccountPreparing = Boolean(activeAccount && !isBrowserSessionPrepared(activeAccount))
  const previewTitle = activeBackgroundPreview?.title || (activeBackgroundPreview?.context === 'contact-scan' ? 'Đang quét data nền' : 'Đang chạy nền')
  const previewDescription = activeBackgroundPreview?.context === 'contact-scan'
    ? 'Quét data đang chạy trong trình duyệt nền.'
    : 'Automation đang chạy trong trình duyệt nền.'

  useEffect(() => {
    if (!pendingOpenRequest) return
    const timer = window.setTimeout(() => {
      setWebviewReadyVersion(version => version + 1)
    }, OPEN_REQUEST_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [pendingOpenRequest])

  useEffect(() => {
    if (!pendingOpenRequest) return
    const requestSettled = Date.now() - pendingOpenRequest.requestedAt >= OPEN_REQUEST_SETTLE_MS

    const account = browserAccounts.find(item => item.id === pendingOpenRequest.accountId)
    if (!account) {
      const knownAccount = accounts.some(item => item.id === pendingOpenRequest.accountId)
      if (knownAccount || (accountsLoadAttempted && !loadingAccounts)) {
        markRequestHandled({
          requestId: pendingOpenRequest.requestId,
          accountId: pendingOpenRequest.accountId,
          success: false,
          reason: knownAccount ? 'Tài khoản này không có tab trình duyệt quan sát' : 'Không tìm thấy tài khoản'
        })
      }
      return
    }

    if (activeAccountId !== account.id) {
      setActiveAccountId(account.id)
      return
    }

    if (!isBrowserSessionPrepared(account)) {
      if (requestSettled) {
        markRequestHandled({
          requestId: pendingOpenRequest.requestId,
          accountId: pendingOpenRequest.accountId,
          success: false,
          reason: 'Tab trình duyệt chưa được mở'
        })
      }
      return
    }

    const wv = webviewRefs.current.get(account.id)
    if (!wv) {
      if (requestSettled) {
        markRequestHandled({
          requestId: pendingOpenRequest.requestId,
          accountId: pendingOpenRequest.accountId,
          success: false,
          reason: 'Tab trình duyệt chưa được mở'
        })
      }
      return
    }

    registerWebviewNow(account.id, wv)

    if (pendingOpenRequest.reloadAfterOpen) {
      try {
        wv.loadURL(getInitialUrl(account))
      } catch (err) {
        console.error('Failed to reload opened browser webview:', err)
      }
    }

    const visibleStatus = inspectVisibleWebview(account)
    if (visibleStatus.ready) {
      markRequestHandled({
        requestId: pendingOpenRequest.requestId,
        accountId: pendingOpenRequest.accountId,
        success: true
      })
      return
    }

    if (requestSettled) {
      markRequestHandled({
        requestId: pendingOpenRequest.requestId,
        accountId: pendingOpenRequest.accountId,
        success: false,
        reason: visibleStatus.reason || 'Tab trình duyệt chưa sẵn sàng'
      })
    }
  }, [
    activeAccountId,
    accounts,
    accountsLoadAttempted,
    browserAccounts,
    loadingAccounts,
    inspectVisibleWebview,
    markRequestHandled,
    pendingOpenRequest,
    preparedProxyByAccountId,
    registerWebviewNow,
    webviewReadyVersion
  ])

  // Register webview with main process when it's ready
  const handleWebviewRef = useCallback((account: AutoAccount, el: any) => {
    if (!el) return
    const wv = el as Electron.WebviewTag
    const existing = webviewRefs.current.get(account.id)
    if (existing === wv) {
      registerWebviewNow(account.id, wv)
      return
    }

    if (existing) {
      removeWebviewEventHandlers(account.id, existing)
    }

    webviewRefs.current.set(account.id, wv)
    webviewReadyState.current.set(account.id, { domReady: false, didFinishLoad: false })
    setWebviewReadyVersion(version => version + 1)

    const onDomReady = () => {
      updateWebviewReadyState(account.id, { domReady: true, lastError: undefined })
      registerWebviewNow(account.id, wv)
    }
    const onDidFinishLoad = () => {
      updateWebviewReadyState(account.id, { didFinishLoad: true, lastError: undefined })
      registerWebviewNow(account.id, wv)
    }
    const onDidFailLoad = (event: Event) => {
      const detail = event as any
      if (detail.isMainFrame === false) return
      const errorCode = Number(detail.errorCode)
      if (errorCode === -3) return
      const description = String(detail.errorDescription || detail.validatedURL || detail.errorCode || 'lỗi không xác định')
      updateWebviewReadyState(account.id, {
        domReady: false,
        didFinishLoad: false,
        lastError: `Tab trình duyệt tải lỗi: ${description}`
      })
    }
    webviewEventHandlers.current.set(account.id, {
      domReady: onDomReady,
      didFinishLoad: onDidFinishLoad,
      didFailLoad: onDidFailLoad
    })

    registerWebviewNow(account.id, wv)
    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-finish-load', onDidFinishLoad)
    wv.addEventListener('did-fail-load', onDidFailLoad)
  }, [registerWebviewNow, removeWebviewEventHandlers, updateWebviewReadyState])

  return (
    <div className="browser-page">
      {/* Browser tabs */}
      <div className="browser-tabs-bar">
        <div className="browser-tabs">
          {browserAccounts.map(account => (
            <div
              key={account.id}
              className={`browser-tab ${activeAccountId === account.id ? 'active' : ''} ${backgroundPreviews.get(account.id)?.active ? 'is-running' : ''}`}
              onClick={() => setActiveAccountId(account.id)}
            >
              <span className="browser-tab-label">{account.name}</span>
              <span className="browser-tab-platform">{account.flatformType}</span>
              {backgroundPreviews.get(account.id)?.active && <span className="browser-tab-live-dot" />}
            </div>
          ))}
        </div>

        <div className="browser-tab-actions">
          <button className="btn-icon" onClick={handleReload} title="Tải lại">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Webview container - all webviews are always rendered, stacked via z-index */}
      <div className="browser-webview-container" style={{ position: 'relative' }}>
        {browserAccounts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">Chưa có tài khoản nào hoạt động. Hãy thêm tài khoản ở trang Chiến dịch.</div>
          </div>
        ) : (
          preparedBrowserAccounts.map(account => (
            <webview
              key={account.id}
              ref={(el: any) => handleWebviewRef(account, el)}
              src={getInitialUrl(account)}
              partition={getProfilePartition(account.id)}
              style={{
                position: 'absolute' as const,
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: activeAccountId === account.id ? 2 : 1
              }}
              /* @ts-ignore */
              allowpopups="true"
              /* @ts-ignore */
              useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            />
          ))
        )}

        {activeAccountPreparing && (
          <div className="empty-state browser-session-loading">
            <div className="empty-state-text">Đang chuẩn bị phiên trình duyệt...</div>
          </div>
        )}

        {activeBackgroundPreview?.active && activeBackgroundPreview.image && (
          <div className="browser-background-preview">
            <img src={activeBackgroundPreview.image} alt="Background campaign preview" className="browser-background-preview-image" />
            <div className="browser-background-preview-gradient top" />
            <div className="browser-background-preview-gradient bottom" />
            <div className="browser-background-preview-toolbar">
              <div className="browser-background-preview-status">
                <span className="browser-background-preview-pulse" />
                <span>{previewTitle}</span>
              </div>
              <div className="browser-background-preview-meta">Live preview</div>
            </div>
            <div className="browser-background-preview-footer">
              <span>{previewDescription}</span>
              <span>{new Date(activeBackgroundPreview.timestamp).toLocaleTimeString('vi-VN')}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
