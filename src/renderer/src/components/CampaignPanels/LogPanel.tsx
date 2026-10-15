import { useEffect, useMemo, useState } from 'react'
import { Activity, ListFilter, Sparkles, Trash2, X } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'
import CampaignAssistantTab from './CampaignAssistantTab'
import CampaignSupportTab from './CampaignSupportTab'
import CampaignDiagnosticsTab from './CampaignDiagnosticsTab'
import type { CampaignAssistantOpenRequest } from '../../../../shared/campaignSupport'
import type { CampaignListItem } from '../../../../shared/types'
import type { DiagnosticAction } from '../../../../shared/campaignDiagnostics'
import { useUiStore } from '../../stores/uiStore'

interface LogPanelProps {
  assistantOpenRequest?: CampaignAssistantOpenRequest | null
  isActive?: boolean
  diagnosticsRevision?: number
  onDiagnosticAction?: (campaign: CampaignListItem, action: DiagnosticAction) => void
}

type LogPanelTab = 'progress' | 'assistant'

export default function LogPanel({ assistantOpenRequest, isActive = true, diagnosticsRevision = 0, onDiagnosticAction }: LogPanelProps) {
  const { logs, addLog, clearLogs, campaigns, accounts } = useCampaignStore()
  const [activeTab, setActiveTab] = useState<LogPanelTab>('progress')
  const [filterAccountId, setFilterAccountId] = useState<number | null>(null)
  const [assistantCampaignSnapshot, setAssistantCampaignSnapshot] = useState<CampaignListItem | null>(null)
  const [assistantSelection, setAssistantSelection] = useState<CampaignAssistantOpenRequest | null>(null)
  const assistantCampaignId = assistantSelection?.campaignId ?? null
  const assistantMode = assistantSelection?.mode ?? 'ask'
  const [screenshotPreview, setScreenshotPreview] = useState<{ dataUrl: string; title: string } | null>(null)
  const [screenshotPreviewError, setScreenshotPreviewError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.electronAPI) return
    const unsubscribe = window.electronAPI.onCampaignLog((log) => {
      addLog(log)
    })
    return () => unsubscribe()
  }, [addLog])

  useEffect(() => {
    if (!assistantOpenRequest?.campaignId) return
    setAssistantSelection(assistantOpenRequest)
    setActiveTab('assistant')
  }, [assistantOpenRequest])

  useEffect(() => {
    const current = campaigns.find(row => row.id === assistantCampaignId)
    if (current) setAssistantCampaignSnapshot(current)
  }, [assistantCampaignId, campaigns])

  const assistantCampaign = useMemo(
    () => assistantCampaignId
      ? campaigns.find(campaign => campaign.id === assistantCampaignId) || (assistantCampaignSnapshot?.id === assistantCampaignId ? assistantCampaignSnapshot : null)
      : null,
    [assistantCampaignId, campaigns, assistantCampaignSnapshot]
  )
  const diagnosticAccount = accounts.find(account => account.id === assistantCampaign?.accountId)
  const diagnosticCampaignStatus = campaigns.find(campaign => campaign.id === assistantCampaignId)?.status
  const handleDiagnosticResume = async () => {
    if (!assistantCampaign) return false
    const currentCampaign = useCampaignStore.getState().campaigns.find(campaign => campaign.id === assistantCampaign.id)
    if (currentCampaign && currentCampaign.status !== 'tạm dừng') return false
    try {
      await useCampaignStore.getState().updateCampaign(assistantCampaign.id, { status: 'chờ xử lý' })
      return true
    } catch {
      useUiStore.getState().showAlert('Không thể tiếp tục chiến dịch. Vui lòng thử lại.', 'error')
      return false
    }
  }

  const accountOptions = useMemo(() => {
    const namesById = new Map<number, string>()
    for (const account of accounts) {
      namesById.set(account.id, account.name)
    }
    for (const log of logs) {
      if (log.accountId && !namesById.has(log.accountId)) {
        namesById.set(log.accountId, log.accountName || `Tài khoản #${log.accountId}`)
      }
    }
    return Array.from(namesById, ([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'vi'))
  }, [accounts, logs])

  const filteredLogs = useMemo(() => {
    const visibleLogs = filterAccountId === null
      ? [...logs]
      : logs.filter(log => log.accountId === filterAccountId)
    return visibleLogs.reverse()
  }, [filterAccountId, logs])

  useEffect(() => {
    if (filterAccountId !== null && !accountOptions.some(account => account.id === filterAccountId)) {
      setFilterAccountId(null)
    }
  }, [accountOptions, filterAccountId])

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
      <div className={`campaign-panel-header log-panel-header${activeTab === 'assistant' ? ' log-panel-header-assistant' : ''}`}>
        <span className="campaign-panel-title">{activeTab === 'assistant' ? (assistantMode === 'diagnostics' ? 'Chẩn đoán' : assistantMode === 'ask' ? 'Hỏi AI' : 'Trợ lý AI') : 'Tiến trình'}</span>
        {activeTab === 'progress' ? (
          <button className="btn btn-ghost btn-icon" onClick={clearLogs} title="Xoá log">
            <Trash2 size={14} />
          </button>
        ) : (
          <span className="log-panel-header-context" title={assistantCampaign?.name || ''}>
            <span className="log-panel-campaign-name">{assistantCampaign?.name || 'Chưa chọn chiến dịch'}</span>
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

      {activeTab === 'progress' && (
        <div className="log-panel-filter">
          <ListFilter size={14} aria-hidden="true" />
          <select
            value={filterAccountId ?? ''}
            onChange={event => setFilterAccountId(event.target.value ? Number(event.target.value) : null)}
            aria-label="Lọc tiến trình theo tài khoản"
            title="Lọc tiến trình theo tài khoản"
          >
            <option value="">Tất cả tài khoản</option>
            {accountOptions.map(account => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </div>
      )}

      {activeTab === 'progress' ? (
        <div className="log-panel-content">
          {screenshotPreviewError && (
            <div className="log-panel-error">{screenshotPreviewError}</div>
          )}
          {filteredLogs.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-text">
                {logs.length === 0 ? 'Chưa có log nào' : 'Không có log của tài khoản này'}
              </div>
            </div>
          ) : (
            filteredLogs.map((log, i) => {
              const action = log.action?.type === 'block_screenshot_preview' && log.action.filePath
                ? log.action
                : null
              return (
                <div key={i} className="log-entry">
                  <div className="log-meta">
                    <span className="log-time">{new Date(log.timestamp).toLocaleTimeString('vi-VN')}</span>
                    {log.source === 'server' && (
                      <span className="log-source-server" title="Log từ akaAgent Zalo Server">SERVER</span>
                    )}
                  </div>
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
      ) : assistantMode === 'diagnostics' ? null : (
        assistantMode === 'campaign_support' || assistantMode === 'campaign_support_dsh'
          ? <CampaignSupportTab key={`${assistantMode}:${assistantCampaignId}`} campaign={assistantCampaign} startRequestId={assistantSelection?.requestId}
              variant={assistantMode === 'campaign_support_dsh' ? 'dsh' : 'standard'} />
          : <CampaignAssistantTab key={assistantCampaignId} campaign={assistantCampaign} />
      )}
      {assistantMode === 'diagnostics' && <div className="campaign-diagnostics-panel" hidden={activeTab !== 'assistant'}>
        {assistantCampaign && /^(facebook|zalo|email)_/.test(assistantCampaign.actionId)
          ? <CampaignDiagnosticsTab key={assistantCampaign.id} campaignId={assistantCampaign.id} accountId={assistantCampaign.accountId}
              active={isActive && activeTab === 'assistant'} revision={diagnosticsRevision} openRequestId={assistantSelection?.requestId}
              accountConfigVersion={diagnosticAccount?.flatformType === 'facebook'
                ? `${diagnosticAccount.id}:${diagnosticAccount.facebookRandomRunEnabled}:${diagnosticAccount.facebookRandomRunRevision}` : ''}
              campaignStatus={diagnosticCampaignStatus} onResume={handleDiagnosticResume}
              onAction={action => onDiagnosticAction?.(assistantCampaign, action)} />
          : <div className="empty-state"><div className="empty-state-text">Chọn Chẩn đoán trong menu Trợ lý của chiến dịch.</div></div>}
      </div>}
    </div>
  )
}
