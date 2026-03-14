import React, { useState, useEffect } from 'react'
import { useFlowStore } from '../../stores/flowStore'
import { ExecutionRun, ExecutionStep } from '../../../../shared/types'
import { 
  History as HistoryIcon, 
  X, 
  ChevronRight, 
  ChevronDown, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  Loader2,
  Camera
} from 'lucide-react'

interface RunHistoryPanelProps {
  onClose: () => void
}

export const RunHistoryPanel: React.FC<RunHistoryPanelProps> = ({ onClose }) => {
  const { flowId } = useFlowStore()
  const [runs, setRuns] = useState<ExecutionRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [steps, setSteps] = useState<Record<string, ExecutionStep[]>>({})
  const [loadingSteps, setLoadingSteps] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetchRuns()
  }, [flowId])

  const fetchRuns = async () => {
    setLoading(true)
    try {
      const history = await window.electronAPI.listRuns(flowId)
      setRuns(history as ExecutionRun[])
    } catch (error) {
      console.error('Failed to fetch runs:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleRun = async (runId: string) => {
    if (selectedRunId === runId) {
      setSelectedRunId(null)
      return
    }

    setSelectedRunId(runId)

    if (!steps[runId]) {
      setLoadingSteps(prev => ({ ...prev, [runId]: true }))
      try {
        const runSteps = await window.electronAPI.listRunSteps(runId)
        setSteps(prev => ({ ...prev, [runId]: runSteps as ExecutionStep[] }))
      } catch (error) {
        console.error('Failed to fetch steps:', error)
      } finally {
        setLoadingSteps(prev => ({ ...prev, [runId]: false }))
      }
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return '0ms'
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  const formatTimestamp = (ts?: string) => {
    if (!ts) return ''
    return new Date(ts).toLocaleString()
  }

  return (
    <div className="history-panel">
      <div className="history-panel-header">
        <div className="history-panel-title">
          <HistoryIcon size={18} color="var(--cat-navigation)" />
          <span>Execution History</span>
        </div>
        <button 
          onClick={onClose}
          className="btn btn-ghost btn-icon"
        >
          <X size={18} />
        </button>
      </div>

      <div className="history-content">
        {loading ? (
          <div className="empty-state">
            <Loader2 size={32} className="animate-spin" />
            <div className="empty-state-text">Loading history...</div>
          </div>
        ) : runs.length === 0 ? (
          <div className="empty-state">
            <Clock size={48} className="empty-state-icon" />
            <div className="empty-state-text">No execution history found</div>
          </div>
        ) : (
          runs.map(run => (
            <div 
              key={run.id}
              className={`history-run-item ${selectedRunId === run.id ? 'active' : ''}`}
            >
              <div 
                className="history-run-header"
                onClick={() => toggleRun(run.id)}
              >
                <div className="history-run-info">
                  {run.status === 'completed' ? (
                    <CheckCircle2 size={18} color="var(--accent-success)" />
                  ) : run.status === 'failed' ? (
                    <XCircle size={18} color="var(--accent-error)" />
                  ) : (
                    <Loader2 size={18} className="animate-spin" color="var(--accent-warning)" />
                  )}
                  <div className="history-run-details">
                    <span className="history-run-time">{formatTimestamp(run.startedAt)}</span>
                    <span className="history-run-id">Run ID: {run.id.slice(0, 8)}</span>
                  </div>
                </div>
                {selectedRunId === run.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </div>

              {selectedRunId === run.id && (
                <div className="history-run-body">
                  {loadingSteps[run.id] ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 10 }}>
                      <Loader2 size={16} className="animate-spin" />
                    </div>
                  ) : (
                    <div className="history-steps-list">
                      {steps[run.id]?.map((step, idx) => (
                        <div key={idx} className="history-step-item">
                          <div className="history-step-header">
                            <span className="history-step-type">{step.actionType}</span>
                            <div className="history-step-status">
                              <span style={{ 
                                width: 6, height: 6, borderRadius: '50%', 
                                background: step.status === 'success' ? 'var(--accent-success)' : 'var(--accent-error)' 
                              }} />
                              <span style={{ color: 'var(--text-tertiary)' }}>{formatDuration(step.durationMs)}</span>
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>
                            Node: {step.nodeId.slice(0, 8)}
                          </div>
                          {step.error && (
                            <div className="history-error-msg">
                              {step.error}
                            </div>
                          )}
                          {step.screenshotUrl && (
                            <button 
                              className="btn btn-ghost" 
                              style={{ padding: '2px 4px', fontSize: 10, marginTop: 4 }}
                              onClick={() => window.open(step.screenshotUrl)}
                            >
                              <Camera size={12} /> View Screenshot
                            </button>
                          )}
                        </div>
                      ))}
                      {(!steps[run.id] || steps[run.id].length === 0) && (
                        <div className="empty-state-text" style={{ fontSize: 11, textAlign: 'center' }}>
                          No step logs available.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        ))}
      </div>

      <div className="history-footer">
        <button 
          className="btn btn-secondary" 
          style={{ width: '100%' }}
          onClick={fetchRuns}
        >
          <HistoryIcon size={14} /> Refresh History
        </button>
      </div>
    </div>
  )
}
