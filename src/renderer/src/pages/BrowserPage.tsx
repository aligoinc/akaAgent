import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { useCampaignStore } from '../stores/campaignStore'
import { AutoAccount } from '../../../shared/types'

const PLATFORM_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  zalo: 'https://chat.zalo.me',
  tiktok: 'https://www.tiktok.com',
  shopee: 'https://banhang.shopee.vn',
  instagram: 'https://www.instagram.com',
}

interface BrowserPageProps {
  focusAccountId?: number | null
  onFocusHandled?: () => void
}

export default function BrowserPage({ focusAccountId, onFocusHandled }: BrowserPageProps) {
  const { accounts, loadAccounts } = useCampaignStore()
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null)
  const [preparedProxyByAccountId, setPreparedProxyByAccountId] = useState<Map<number, number | null>>(new Map())
  const [backgroundPreviews, setBackgroundPreviews] = useState<Map<number, {
    active: boolean
    image?: string
    context?: 'campaign' | 'contact-scan'
    title?: string
    timestamp: string
  }>>(new Map())
  const webviewRefs = useRef<Map<number, Electron.WebviewTag>>(new Map())
  const registeredIds = useRef<Set<number>>(new Set())
  const preparingSessionKeys = useRef<Set<string>>(new Set())

  // Filter out disabled (isActive=false) accounts - they don't get browser tabs
  const activeAccounts = accounts.filter(a => a.isActive)

  // Load accounts on mount
  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  // Auto-select first account
  useEffect(() => {
    if (activeAccounts.length > 0 && activeAccountId === null) {
      setActiveAccountId(activeAccounts[0].id)
    }
  }, [activeAccounts, activeAccountId])

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

    activeAccounts.forEach(account => {
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
  }, [activeAccounts, preparedProxyByAccountId, prepareAccountSession, markAccountPrepared])

  // Handle focus from external navigation (context menu)
  useEffect(() => {
    if (focusAccountId) {
      setActiveAccountId(focusAccountId)
      onFocusHandled?.()
    }
  }, [focusAccountId, onFocusHandled])

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

  // Cleanup: unregister all webviews on unmount
  useEffect(() => {
    return () => {
      registeredIds.current.forEach((accountId) => {
        window.electronAPI?.unregisterWebview(accountId).catch(() => {})
      })
      registeredIds.current.clear()
    }
  }, [])

  const getInitialUrl = (account: AutoAccount) => {
    return PLATFORM_URLS[account.flatformType] || 'about:blank'
  }

  const getProfilePartition = (accountId: number) => {
    return `persist:account_${accountId}`
  }

  const handleReload = async () => {
    if (!activeAccountId) return
    const account = activeAccounts.find(item => item.id === activeAccountId)
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
  const preparedActiveAccounts = activeAccounts.filter(isBrowserSessionPrepared)
  const activeAccount = activeAccountId ? activeAccounts.find(account => account.id === activeAccountId) : null
  const activeAccountPreparing = Boolean(activeAccount && !isBrowserSessionPrepared(activeAccount))
  const previewTitle = activeBackgroundPreview?.title || (activeBackgroundPreview?.context === 'contact-scan' ? 'Đang quét data nền' : 'Đang chạy nền')
  const previewDescription = activeBackgroundPreview?.context === 'contact-scan'
    ? 'Quét data đang chạy trong trình duyệt nền.'
    : 'Automation đang chạy trong trình duyệt nền.'

  // Register webview with main process when it's ready
  const handleWebviewRef = useCallback((account: AutoAccount, el: any) => {
    if (!el) return
    const wv = el as Electron.WebviewTag
    webviewRefs.current.set(account.id, wv)

    const onDomReady = () => {
      try {
        const wcId = (wv as any).getWebContentsId()
        if (wcId && window.electronAPI) {
          window.electronAPI.registerWebview(account.id, wcId)
          registeredIds.current.add(account.id)
        }
      } catch (err) {
        console.error('Failed to register webview:', err)
      }
    }

    // Listen for dom-ready to register
    wv.addEventListener('dom-ready', onDomReady)
  }, [])

  return (
    <div className="browser-page">
      {/* Browser tabs */}
      <div className="browser-tabs-bar">
        <div className="browser-tabs">
          {activeAccounts.map(account => (
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
        {activeAccounts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">Chưa có tài khoản nào hoạt động. Hãy thêm tài khoản ở trang Chiến dịch.</div>
          </div>
        ) : (
          preparedActiveAccounts.map(account => (
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
