import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { useCampaignStore } from '../stores/campaignStore'
import { OrgChannel } from '../../../shared/types'

const PLATFORM_URLS: Record<string, string> = {
  facebook: 'https://www.facebook.com',
  zalo: 'https://chat.zalo.me',
  tiktok: 'https://www.tiktok.com',
  shopee: 'https://banhang.shopee.vn',
  instagram: 'https://www.instagram.com',
}

interface BrowserPageProps {
  focusChannelId?: number | null
  onFocusHandled?: () => void
}

export default function BrowserPage({ focusChannelId, onFocusHandled }: BrowserPageProps) {
  const { channels, loadChannels } = useCampaignStore()
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null)
  const webviewRefs = useRef<Map<number, Electron.WebviewTag>>(new Map())
  const registeredIds = useRef<Set<number>>(new Set())

  // Filter out disabled (isActive=false) channels - they don't get browser tabs
  const activeChannels = channels.filter(a => a.isActive)

  // Load channels on mount
  useEffect(() => {
    loadChannels()
  }, [loadChannels])

  // Auto-select first channel
  useEffect(() => {
    if (activeChannels.length > 0 && activeChannelId === null) {
      setActiveChannelId(activeChannels[0].id)
    }
  }, [activeChannels, activeChannelId])

  // Handle focus from external navigation (context menu)
  useEffect(() => {
    if (focusChannelId) {
      setActiveChannelId(focusChannelId)
      onFocusHandled?.()
    }
  }, [focusChannelId, onFocusHandled])

  // Cleanup: unregister all webviews on unmount
  useEffect(() => {
    return () => {
      registeredIds.current.forEach((channelId) => {
        window.electronAPI?.unregisterWebview(channelId).catch(() => {})
      })
      registeredIds.current.clear()
    }
  }, [])

  const getInitialUrl = (channel: OrgChannel) => {
    return PLATFORM_URLS[channel.flatformType] || 'about:blank'
  }

  const getProfilePartition = (channelId: number) => {
    return `persist:channel_${channelId}`
  }

  const handleReload = () => {
    if (activeChannelId) {
      const wv = webviewRefs.current.get(activeChannelId)
      if (wv) wv.reload()
    }
  }

  // Register webview with main process when it's ready
  const handleWebviewRef = useCallback((channel: OrgChannel, el: any) => {
    if (!el) return
    const wv = el as Electron.WebviewTag
    webviewRefs.current.set(channel.id, wv)

    const onDomReady = () => {
      try {
        const wcId = (wv as any).getWebContentsId()
        if (wcId && window.electronAPI) {
          window.electronAPI.registerWebview(channel.id, wcId)
          registeredIds.current.add(channel.id)
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
          {activeChannels.map(channel => (
            <div
              key={channel.id}
              className={`browser-tab ${activeChannelId === channel.id ? 'active' : ''}`}
              onClick={() => setActiveChannelId(channel.id)}
            >
              <span className="browser-tab-label">{channel.name}</span>
              <span className="browser-tab-platform">{channel.flatformType}</span>
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
        {activeChannels.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-text">Chưa có kênh nào hoạt động. Hãy thêm kênh ở trang Chiến dịch.</div>
          </div>
        ) : (
          activeChannels.map(channel => (
            <webview
              key={channel.id}
              ref={(el: any) => handleWebviewRef(channel, el)}
              src={getInitialUrl(channel)}
              partition={getProfilePartition(channel.id)}
              style={{
                position: 'absolute' as const,
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: activeChannelId === channel.id ? 2 : 1
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
