import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Sparkles, Trash2 } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import CampaignAssistantTab from './CampaignAssistantTab'

interface LogPanelProps {
  assistantOpenRequest?: { campaignId: number; requestedAt: number } | null
}

type LogPanelTab = 'progress' | 'assistant'

export default function LogPanel({ assistantOpenRequest }: LogPanelProps) {
  const { logs, addLog, clearLogs, campaigns } = useCampaignStore()
  const [activeTab, setActiveTab] = useState<LogPanelTab>('progress')
  const [assistantCampaignId, setAssistantCampaignId] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!window.electronAPI) return
    const unsubscribe = window.electronAPI.onCampaignLog((log) => {
      addLog(log)
    })
    return () => unsubscribe()
  }, [addLog])

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs])

  useEffect(() => {
    if (!assistantOpenRequest?.campaignId) return
    setAssistantCampaignId(assistantOpenRequest.campaignId)
    setActiveTab('assistant')
  }, [assistantOpenRequest])

  const assistantCampaign = useMemo(
    () => assistantCampaignId
      ? campaigns.find(campaign => campaign.id === assistantCampaignId) || null
      : null,
    [assistantCampaignId, campaigns]
  )

  return (
    <div className="campaign-panel">
      <div className="campaign-panel-header log-panel-header">
        <span className="campaign-panel-title">{activeTab === 'assistant' ? 'Trợ lý' : 'Tiến trình'}</span>
        {activeTab === 'progress' ? (
          <button className="btn btn-ghost btn-icon" onClick={clearLogs} title="Xoá log">
            <Trash2 size={14} />
          </button>
        ) : (
          <span className="log-panel-header-context" title={assistantCampaign?.name || ''}>
            {assistantCampaign?.name || 'Chưa chọn chiến dịch'}
          </span>
        )}
      </div>

      <div className="log-panel-tabs">
        <button
          type="button"
          className={`log-panel-tab ${activeTab === 'progress' ? 'active' : ''}`}
          onClick={() => setActiveTab('progress')}
        >
          <Activity size={14} />
          <span>Tiến trình</span>
        </button>
        <button
          type="button"
          className={`log-panel-tab ${activeTab === 'assistant' ? 'active' : ''}`}
          onClick={() => setActiveTab('assistant')}
        >
          <Sparkles size={14} />
          <span>Trợ lý</span>
        </button>
      </div>

      {activeTab === 'progress' ? (
        <div className="log-panel-content" ref={scrollRef}>
          {logs.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">Chưa có log nào</div></div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="log-entry">
                <span className="log-time">{new Date(log.timestamp).toLocaleTimeString('vi-VN')}</span>
                <span className="log-message">{log.message}</span>
              </div>
            ))
          )}
        </div>
      ) : (
        <CampaignAssistantTab campaign={assistantCampaign} />
      )}
    </div>
  )
}
