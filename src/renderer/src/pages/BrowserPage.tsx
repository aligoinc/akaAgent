import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { useCampaignStore } from '../stores/campaignStore'
import { FlatformAccount } from '../../../shared/types'

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
  const webviewRefs = useRef<Map<number, Electron.WebviewTag>>(new Map())
  const registeredIds = useRef<Set<number>>(new Set())

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

  // Handle focus from external navigation (context menu)
  useEffect(() => {
    if (focusAccountId) {
      setActiveAccountId(focusAccountId)
      onFocusHandled?.()
    }
  }, [focusAccountId, onFocusHandled])

  // Cleanup: unregister all webviews on unmount
  useEffect(() => {
    return () => {
      registeredIds.current.forEach((accountId) => {
        window.electronAPI?.unregisterWebview(accountId).catch(() => {})
      })
      registeredIds.current.clear()
    }
  }, [])

  const getInitialUrl = (account: FlatformAccount) => {
    return PLATFORM_URLS[account.flatformType] || 'about:blank'
  }

  const getProfilePartition = (accountId: number) => {
    return `persist:account_${accountId}`
  }

  const handleReload = () => {
    if (activeAccountId) {
      const wv = webviewRefs.current.get(activeAccountId)
      if (wv) wv.reload()
    }
  }

  // Register webview with main process when it's ready
  const handleWebviewRef = useCallback((account: FlatformAccount, el: any) => {
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
              className={`browser-tab ${activeAccountId === account.id ? 'active' : ''}`}
              onClick={() => setActiveAccountId(account.id)}
            >
              <span className="browser-tab-label">{account.name}</span>
              <span className="browser-tab-platform">{account.flatformType}</span>
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
          activeAccounts.map(account => (
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
      </div>
    </div>
  )
}
