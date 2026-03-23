import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'

export default function LogPanel() {
  const { logs, addLog, clearLogs } = useCampaignStore()
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

  return (
    <div className="campaign-panel">
      <div className="campaign-panel-header">
        <span className="campaign-panel-title">Tiến trình</span>
        <button className="btn btn-ghost btn-icon" onClick={clearLogs} title="Xoá log">
          <Trash2 size={14} />
        </button>
      </div>
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
    </div>
  )
}
