import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { useCampaignStore } from '../stores/campaignStore'
import { AutoAccount } from '../../../shared/types'
import { useAuthStore } from '../stores/authStore'

const PLATFORM_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  zalo: 'https://chat.zalo.me',
  tiktok: 'https://www.tiktok.com',
  shopee: 'https://banhang.shopee.vn',
  instagram: 'https://www.instagram.com',
}
const ALWAYS_BROWSERLESS_PLATFORMS = new Set(['email', 'sms'])

export interface BrowserOpenRequest {
  requestId: number
  accountId: number
  reloadAfterOpen?: boolean
}

interface BrowserPageProps {
  openRequest?: BrowserOpenRequest | null
  onRequestHandled?: (requestId: number) => void
}

export default function BrowserPage({ openRequest, onRequestHandled }: BrowserPageProps) {
  const { accounts, loadingAccounts, loadAccounts } = useCampaignStore()
  const isZaloShowWeb = useAuthStore(state => state.user?.isZaloShowWeb === true)
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
  const webviewDomReadyHandlers = useRef<Map<number, EventListener>>(new Map())
  const registeredIds = useRef<Set<number>>(new Set())
  const initializationPromises = useRef<Map<number, Promise<boolean>>>(new Map())
  const preparingSessionKeys = useRef<Set<string>>(new Set())

  // Filter out disabled and API-only platforms - they don't get browser tabs/profiles.
  const browserAccounts = accounts.filter(account => (
    account.isActive
    && !ALWAYS_BROWSERLESS_PLATFORMS.has(account.flatformType)
    && (account.flatformType !== 'zalo' || isZaloShowWeb)
  ))

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
        const wv = webviewRefs.current.get(accountId)
        const handler = webviewDomReadyHandlers.current.get(accountId)
        if (wv && handler) wv.removeEventListener('dom-ready', handler)
        webviewRefs.current.delete(accountId)
        webviewDomReadyHandlers.current.delete(accountId)
        window.electronAPI?.unregisterWebview(accountId).catch(() => {})
        registeredIds.current.delete(accountId)
      }
    })
  }, [browserAccounts])

  // Cleanup: unregister all webviews on unmount
  useEffect(() => {
    return () => {
      registeredIds.current.forEach((accountId) => {
        const wv = webviewRefs.current.get(accountId)
        const handler = webviewDomReadyHandlers.current.get(accountId)
        if (wv && handler) wv.removeEventListener('dom-ready', handler)
        window.electronAPI?.unregisterWebview(accountId).catch(() => {})
      })
      registeredIds.current.clear()
      initializationPromises.current.clear()
      webviewDomReadyHandlers.current.clear()
      webviewRefs.current.clear()
    }
  }, [])

  const getInitialUrl = (account: AutoAccount) => {
    return PLATFORM_URLS[account.flatformType] || 'about:blank'
  }

  const getProfilePartition = (accountId: number) => {
    return `persist:account_${accountId}`
  }

  const markRequestHandled = useCallback((requestId: number) => {
    setPendingOpenRequest(prev => prev?.requestId === requestId ? null : prev)
    onRequestHandled?.(requestId)
  }, [onRequestHandled])

  const registerWebviewNow = useCallback(async (account: AutoAccount, wv: Electron.WebviewTag): Promise<boolean> => {
    try {
      const wcId = (wv as any).getWebContentsId?.()
      if (wcId && window.electronAPI) {
        const wasRegistered = registeredIds.current.has(account.id)
        // Re-register on dom-ready as well. Electron can recreate a crashed
        // renderer behind the same <webview>; main then re-arms Zalo capture.
        await window.electronAPI.registerWebview(account.id, wcId, account.flatformType)
        registeredIds.current.add(account.id)
        if (!wasRegistered) setWebviewReadyVersion(version => version + 1)
        return true
      }
    } catch (err) {
      console.error('Failed to register webview:', err)
    }
    return false
  }, [])

  const initializeWebview = useCallback((account: AutoAccount, wv: Electron.WebviewTag): Promise<boolean> => {
    const existing = initializationPromises.current.get(account.id)
    if (existing) return existing

    let initialization!: Promise<boolean>
    initialization = (async () => {
      const registered = await registerWebviewNow(account, wv)
      if (!registered) return false
      const currentUrl = String((wv as any).getURL?.() || '')
      if (!currentUrl || currentUrl === 'about:blank') {
        wv.loadURL(getInitialUrl(account))
      }
      return true
    })()
      .catch(err => {
        console.error('Failed to initialize webview:', err)
        return false
      })
      .finally(() => {
        if (initializationPromises.current.get(account.id) === initialization) {
          initializationPromises.current.delete(account.id)
        }
      })
    initializationPromises.current.set(account.id, initialization)
    return initialization
  }, [registerWebviewNow])

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

    const account = browserAccounts.find(item => item.id === pendingOpenRequest.accountId)
    if (!account) {
      const knownAccount = accounts.some(item => item.id === pendingOpenRequest.accountId)
      if (knownAccount || (accountsLoadAttempted && !loadingAccounts)) {
        markRequestHandled(pendingOpenRequest.requestId)
      }
      return
    }

    if (activeAccountId !== account.id) {
      setActiveAccountId(account.id)
    }

    if (!isBrowserSessionPrepared(account)) return

    const wv = webviewRefs.current.get(account.id)
    if (!wv) return

    void initializeWebview(account, wv).then(initialized => {
      if (!initialized || !pendingOpenRequest.reloadAfterOpen) return
      wv.loadURL(getInitialUrl(account))
    })

    markRequestHandled(pendingOpenRequest.requestId)
  }, [
    activeAccountId,
    accounts,
    accountsLoadAttempted,
    browserAccounts,
    loadingAccounts,
    markRequestHandled,
    pendingOpenRequest,
    preparedProxyByAccountId,
    initializeWebview,
    webviewReadyVersion
  ])

  // Register webview with main process when it's ready
  const handleWebviewRef = useCallback((account: AutoAccount, el: any) => {
    if (!el) return
    const wv = el as Electron.WebviewTag
    const existing = webviewRefs.current.get(account.id)
    if (existing === wv) {
      void initializeWebview(account, wv)
      return
    }

    const previousHandler = webviewDomReadyHandlers.current.get(account.id)
    if (existing && previousHandler) {
      existing.removeEventListener('dom-ready', previousHandler)
    }

    webviewRefs.current.set(account.id, wv)
    setWebviewReadyVersion(version => version + 1)

    const onDomReady = () => {
      void initializeWebview(account, wv)
    }
    webviewDomReadyHandlers.current.set(account.id, onDomReady)

    void initializeWebview(account, wv)
    wv.addEventListener('dom-ready', onDomReady)
  }, [initializeWebview])

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
              src="about:blank"
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
