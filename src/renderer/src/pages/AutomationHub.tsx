import { useEffect, useState, type ReactNode } from 'react'
import { Users, Workflow, Zap } from 'lucide-react'
import FromCampaignsTab from '../components/Automation/FromCampaignsTab'
import JourneysEmbed from '../components/Automation/JourneysEmbed'
import { getAutomationApi } from '../components/Automation/automationTypes'
import { useAutomationNavStore, type AutomationTab } from '../stores/automationNavStore'
import AutomationPage from './AutomationPage'
import '../styles/automationHub.css'

/**
 * Trang Tự động hóa của Desktop: ba thẻ.
 * - Quy trình: trang Tự động hóa của Web nhúng (dựng kéo thả, Agent, chạy thử, theo dõi; chạy trên máy chủ).
 * - Từ chiến dịch: các đồng bộ "Sau khi chạy: đưa khách vào nhóm".
 * - Quy tắc cũ: trang chuyển dữ liệu cũ, chỉ hiện khi nhân viên còn quy tắc; không tạo quy tắc mới.
 * Mỗi thẻ chỉ tải khi mở lần đầu.
 */
export default function AutomationHub({ isActive, onNewCampaign }: { isActive: boolean; onNewCampaign: () => void }) {
  const request = useAutomationNavStore(state => state.request)
  const [tab, setTab] = useState<AutomationTab>('journeys')
  const [opened, setOpened] = useState<Record<AutomationTab, boolean>>({ journeys: false, campaigns: false, legacy: false })
  const [hasLegacy, setHasLegacy] = useState(false)
  const [journeyOpen, setJourneyOpen] = useState<{ path: string; nonce: number } | null>(null)

  // Quy tắc cũ: một lượt đọc khi trang mở lần đầu (trang 1, 1 dòng).
  const [legacyChecked, setLegacyChecked] = useState(false)
  useEffect(() => {
    if (!isActive || legacyChecked) return
    setLegacyChecked(true)
    getAutomationApi().listAutomations({ page: 1, pageSize: 1 })
      .then(result => setHasLegacy(result.total > 0))
      .catch(() => setHasLegacy(false))
  }, [isActive, legacyChecked])

  useEffect(() => {
    if (!request) return
    setTab(request.tab)
    if (request.tab === 'journeys' && request.path) setJourneyOpen({ path: request.path, nonce: request.nonce })
  }, [request])

  useEffect(() => {
    if (isActive) setOpened(current => current[tab] ? current : { ...current, [tab]: true })
  }, [isActive, tab])

  const tabs: Array<{ id: AutomationTab; label: string; icon: ReactNode }> = [
    { id: 'journeys', label: 'Quy trình', icon: <Workflow size={15} /> },
    { id: 'campaigns', label: 'Từ chiến dịch', icon: <Users size={15} /> },
    ...(hasLegacy || tab === 'legacy' ? [{ id: 'legacy' as const, label: 'Quy tắc cũ', icon: <Zap size={15} /> }] : [])
  ]

  return <div className="automation-hub">
    <div className="automation-hub-tabs" role="tablist" aria-label="Tự động hóa">
      {tabs.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
        className={`automation-hub-tab${tab === item.id ? ' is-active' : ''}`} onClick={() => setTab(item.id)}>
        {item.icon}<span>{item.label}</span>
      </button>)}
    </div>
    <div className="automation-hub-body">
      {opened.journeys && <div className="automation-hub-panel" style={{ display: tab === 'journeys' ? 'flex' : 'none' }}>
        <JourneysEmbed isActive={isActive && tab === 'journeys'} openPath={journeyOpen} />
      </div>}
      {opened.campaigns && <div className="automation-hub-panel is-scroll" style={{ display: tab === 'campaigns' ? 'flex' : 'none' }}>
        <FromCampaignsTab isActive={isActive && tab === 'campaigns'} onNewCampaign={onNewCampaign} />
      </div>}
      {opened.legacy && <div className="automation-hub-panel" style={{ display: tab === 'legacy' ? 'flex' : 'none' }}>
        <AutomationPage isActive={isActive && tab === 'legacy'} allowCreate={false} embedded />
      </div>}
    </div>
  </div>
}
