import { useState } from 'react'
import {
  Zap, 
  Play, 
  Square, 
  Globe, 
  Save, 
  History as HistoryIcon,
  Loader2,
  FolderOpen,
  FilePlus,
  Settings
} from 'lucide-react'
import { useFlowStore } from '../../stores/flowStore'
import { useExecutionStore } from '../../stores/executionStore'
import { RunHistoryPanel } from '../RunHistory/RunHistoryPanel'

interface ToolbarProps {
  onRun: () => void
  onStop: () => void
  onSave: () => void
  onLoad: () => void
  onNew: () => void
  onLaunchBrowser: () => void
}

export default function Toolbar({ 
  onRun, 
  onStop, 
  onSave, 
  onLoad, 
  onNew, 
  onLaunchBrowser 
}: ToolbarProps) {
  const { flowName, setFlowName, isBlock, setIsBlock } = useFlowStore()
  const { isRunning, browserConnected } = useExecutionStore()
  const [editing, setEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await onSave()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="toolbar">
      {/* Left section - Logo & name */}
      <div className="toolbar-section">
        <div className="toolbar-title">
          <div className="logo">
            <Zap size={14} color="white" />
          </div>
          {editing ? (
            <input
              type="text"
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => e.key === 'Enter' && setEditing(false)}
              autoFocus
              className="sidebar-search"
              style={{ width: 180, margin: 0 }}
            />
          ) : (
            <span
              onClick={() => setEditing(true)}
              style={{ cursor: 'pointer' }}
              title="Click to rename"
            >
              {flowName || 'Untitled Flow'}
            </span>
          )}
        </div>
      </div>

      {/* Center section - Actions */}
      <div className="toolbar-section center">
        <button className="btn btn-secondary" onClick={onNew} title="New Flow">
          <FilePlus size={14} />
          New
        </button>
        <button className="btn btn-secondary" onClick={onLoad} title="Open Flow">
          <FolderOpen size={14} />
          Open
        </button>
        <button className="btn btn-secondary" onClick={handleSave} disabled={isSaving} title="Save Flow">
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Save
        </button>
        
        <div style={{ display: 'flex', alignItems: 'center', marginLeft: 12, gap: 8, borderLeft: '1px solid var(--border-default)', paddingLeft: 12 }}>
          <select
            value={isBlock ? 'block' : 'workflow'}
            onChange={(e) => setIsBlock(e.target.value === 'block')}
            style={{ 
              fontSize: 11, 
              padding: '3px 6px', 
              background: isBlock ? 'rgba(124, 92, 252, 0.2)' : 'rgba(56, 189, 248, 0.2)',
              border: `1px solid ${isBlock ? 'var(--accent-primary)' : 'var(--cat-navigation)'}`,
              borderRadius: 4,
              color: isBlock ? 'var(--accent-primary)' : 'var(--cat-navigation)',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <option value="workflow">⚡ Workflow</option>
            <option value="block">📦 Block</option>
          </select>
        </div>
      </div>

      {/* Right section - Browser & Run */}
      <div className="toolbar-section right">
        <button
          className={`btn ${showHistory ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setShowHistory(!showHistory)}
          title="Run History"
        >
          <HistoryIcon size={14} />
          History
        </button>

        <button
          className={`btn ${browserConnected ? 'btn-secondary' : 'btn-primary'}`}
          onClick={onLaunchBrowser}
          title={browserConnected ? 'Browser Connected' : 'Launch Browser'}
        >
          <span className={`status-dot ${browserConnected ? 'connected' : 'disconnected'}`} />
          <Globe size={14} />
          {browserConnected ? 'Browser Ready' : 'Launch Browser'}
        </button>

        {isRunning ? (
          <button className="btn btn-danger" onClick={onStop}>
            <Square size={14} />
            Stop
          </button>
        ) : (
          <button className="btn btn-success" onClick={onRun}>
            <Play size={14} />
            Run
          </button>
        )}
      </div>

      {showHistory && <RunHistoryPanel onClose={() => setShowHistory(false)} />}
    </div>
  )
}
