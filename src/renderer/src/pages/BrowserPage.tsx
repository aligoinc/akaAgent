import { useState, useEffect, useRef } from 'react'
import { RefreshCw, X, Globe, ExternalLink } from 'lucide-react'
import { useCampaignStore } from '../stores/campaignStore'
import { FlatformAccount } from '../../../shared/types'

const PLATFORM_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  zalo: 'https://chat.zalo.me',
  tiktok: 'https://www.tiktok.com',
  shopee: 'https://banhang.shopee.vn',
}

export default function BrowserPage() {
  const { accounts, loadAccounts } = useCampaignStore()
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null)
  const webviewRefs = useRef<Map<number, Electron.WebviewTag>>(new Map())

  // Load accounts on mount
  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  // Auto-select first account
  useEffect(() => {
    if (accounts.length > 0 && activeAccountId === null) {
      setActiveAccountId(accounts[0].id)
    }
  }, [accounts, activeAccountId])

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

  const handleOpenExternal = () => {
    if (activeAccountId) {
      const wv = webviewRefs.current.get(activeAccountId)
      if (wv) {
        window.open(wv.getURL(), '_blank')
      }
    }
  }

  const activeAccounts = accounts.filter(a => a.isActive)

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

      {/* Webview container */}
      <div className="browser-webview-container">
        {activeAccounts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">Chưa có tài khoản nào. Hãy thêm tài khoản ở trang Chiến dịch.</div>
          </div>
        ) : (
          activeAccounts.map(account => (
            <webview
              key={account.id}
              ref={(el: any) => {
                if (el) webviewRefs.current.set(account.id, el)
              }}
              src={getInitialUrl(account)}
              partition={getProfilePartition(account.id)}
              style={{
                width: '100%',
                height: '100%',
                display: activeAccountId === account.id ? 'flex' : 'none'
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
