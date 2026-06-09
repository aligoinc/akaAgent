import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Sparkles, Trash2, X } from 'lucide-react'
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
  const [screenshotPreview, setScreenshotPreview] = useState<{ dataUrl: string; title: string } | null>(null)
  const [screenshotPreviewError, setScreenshotPreviewError] = useState<string | null>(null)
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

  const handlePreviewScreenshot = async (filePath: string, title?: string) => {
    if (!filePath || !window.electronAPI?.readBlockScreenshotDataUrl) return
    setScreenshotPreviewError(null)
    try {
      const result = await window.electronAPI.readBlockScreenshotDataUrl(filePath)
      setScreenshotPreview({
        dataUrl: result.dataUrl,
        title: title || 'Ảnh chụp màn hình'
      })
    } catch {
      setScreenshotPreviewError('Không thể tải ảnh screenshot.')
    }
  }

  return (
    <div className="campaign-panel">
      {screenshotPreview && (
        <div
          className="modal-overlay"
          style={{ zIndex: 2600, padding: 24 }}
          onMouseDown={() => setScreenshotPreview(null)}
        >
          <div
            onMouseDown={event => event.stopPropagation()}
            style={{
              width: 'min(1200px, 96vw)',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-default)',
              borderRadius: 8,
              overflow: 'hidden',
              boxShadow: 'var(--shadow-lg)'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                borderBottom: '1px solid var(--border-default)'
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {screenshotPreview.title}
              </div>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setScreenshotPreview(null)}
                title="Đóng"
              >
                <X size={14} />
              </button>
            </div>
            <div
              style={{
                padding: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'auto',
                background: 'var(--bg-primary)'
              }}
            >
              <img
                src={screenshotPreview.dataUrl}
                alt="Browser screenshot"
                style={{
                  maxWidth: '100%',
                  maxHeight: 'calc(92vh - 74px)',
                  objectFit: 'contain',
                  borderRadius: 4,
                  border: '1px solid var(--border-default)'
                }}
              />
            </div>
          </div>
        </div>
      )}
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
          {screenshotPreviewError && (
            <div className="log-panel-error">{screenshotPreviewError}</div>
          )}
          {logs.length === 0 ? (
            <div className="empty-state"><div className="empty-state-text">Chưa có log nào</div></div>
          ) : (
            logs.map((log, i) => {
              const action = log.action?.type === 'block_screenshot_preview' && log.action.filePath
                ? log.action
                : null
              return (
                <div key={i} className="log-entry">
                  <span className="log-time">{new Date(log.timestamp).toLocaleTimeString('vi-VN')}</span>
                  <span className="log-message">{log.message}</span>
                  {action && (
                    <button
                      type="button"
                      className="log-entry-action"
                      onClick={() => handlePreviewScreenshot(action.filePath, action.title || log.message)}
                      title="Xem ảnh screenshot"
                    >
                      Xem
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>
      ) : (
        <CampaignAssistantTab campaign={assistantCampaign} />
      )}
    </div>
  )
}
