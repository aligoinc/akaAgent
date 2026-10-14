import { createRoot } from 'react-dom/client'
import BrowserPage from '../src/renderer/src/pages/BrowserPage'
import { useCampaignStore } from '../src/renderer/src/stores/campaignStore'
import type { BrowserPreview } from '../src/shared/browserPreview'
import '../src/renderer/src/styles/global.css'

let receive: ((preview: BrowserPreview) => void) | undefined
window.electronAPI = {
  onCampaignBrowserPreview: callback => { receive = callback; return () => { receive = undefined } },
  prepareAccountBrowserSession: async () => {},
  unregisterWebview: async () => {}
} as any
useCampaignStore.setState({ accounts: [1, 2].map(id => ({
  id, name: `Tài khoản kiểm thử ${id}`, flatformType: 'facebook', isActive: true,
  loginStatus: 'đã đăng nhập', status: 'chờ xử lý'
})) as any, loadingAccounts: false, loadAccounts: async () => {} })
;(window as any).webPreviewFixture = { emit: (preview: BrowserPreview) => receive?.(preview) }
createRoot(document.getElementById('root')!).render(<BrowserPage />)
