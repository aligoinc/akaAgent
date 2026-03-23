import { Zap, Layers, Settings, Play, Pause, Globe } from 'lucide-react'
import { useCampaignStore } from '../../stores/campaignStore'

interface TopBarProps {
  activePage: 'campaigns' | 'workflow-editor' | 'browsers'
  onPageChange: (page: 'campaigns' | 'workflow-editor' | 'browsers') => void
}

export default function TopBar({ activePage, onPageChange }: TopBarProps) {
  const { schedulerRunning, setSchedulerRunning } = useCampaignStore()

  const handleToggleScheduler = async () => {
    if (!window.electronAPI) return
    try {
      if (schedulerRunning) {
        await window.electronAPI.stopScheduler()
        setSchedulerRunning(false)
      } else {
        await window.electronAPI.startScheduler()
        setSchedulerRunning(true)
      }
    } catch (err) {
      console.error('Scheduler toggle error:', err)
    }
  }

  return (
    <div className="topbar">
      <div className="topbar-left">
        <div className="topbar-logo">
          <Zap size={16} color="white" />
        </div>
        <span className="topbar-brand">akaBizAuto</span>
      </div>

      <nav className="topbar-nav">
        <button
          className={`topbar-nav-item ${activePage === 'campaigns' ? 'active' : ''}`}
          onClick={() => onPageChange('campaigns')}
        >
          <Layers size={15} />
          Chiến dịch
        </button>
        <button
          className={`topbar-nav-item ${activePage === 'browsers' ? 'active' : ''}`}
          onClick={() => onPageChange('browsers')}
        >
          <Globe size={15} />
          Trình duyệt
        </button>
        <button
          className={`topbar-nav-item ${activePage === 'workflow-editor' ? 'active' : ''}`}
          onClick={() => onPageChange('workflow-editor')}
        >
          <Settings size={15} />
          Cài đặt Workflow
        </button>
      </nav>

      <div className="topbar-right">
        <button
          className={`btn ${schedulerRunning ? 'btn-danger' : 'btn-success'}`}
          onClick={handleToggleScheduler}
          title={schedulerRunning ? 'Dừng scheduler' : 'Bắt đầu scheduler'}
        >
          {schedulerRunning ? <Pause size={14} /> : <Play size={14} />}
          {schedulerRunning ? 'Dừng' : 'Chạy'} Scheduler
          {schedulerRunning && <span className="status-dot running" style={{ marginLeft: 4 }} />}
        </button>
      </div>
    </div>
  )
}
