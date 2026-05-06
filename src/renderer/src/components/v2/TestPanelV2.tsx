import { useEffect, useMemo, useState } from 'react'
import { useWorkflowV2Store } from '../../stores/workflowV2Store'
import { useCampaignStore } from '../../stores/campaignStore'

export default function TestPanelV2() {
  const { current: workflow, isTesting, testRunKey, testStatusByNode, testLogs, startTest, recordStep, appendLog, endTest, clearTest } = useWorkflowV2Store()
  const accounts = useCampaignStore(s => s.accounts)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [variablesJson, setVariablesJson] = useState('{}')
  const [collapsed, setCollapsed] = useState(false)

  // Tự fill variables theo defaultVariables khi load workflow
  useEffect(() => {
    if (workflow?.defaultVariables) {
      setVariablesJson(JSON.stringify(workflow.defaultVariables, null, 2))
    }
  }, [workflow?.id, workflow?.defaultVariables])

  // Subscribe progress + log events
  useEffect(() => {
    const unsubProgress = window.electronAPI.v2.onRunProgress((payload) => {
      if (payload.runKey !== useWorkflowV2Store.getState().testRunKey) return
      recordStep(payload.step)
    })
    const unsubLog = window.electronAPI.v2.onRunLog((payload) => {
      if (payload.runKey !== useWorkflowV2Store.getState().testRunKey) return
      appendLog({ nodeId: payload.nodeId, line: payload.line })
    })
    return () => { unsubProgress(); unsubLog() }
  }, [recordStep, appendLog])

  const stepsArray = useMemo(() => Array.from(testStatusByNode.values()), [testStatusByNode])

  const onTestWorkflow = async () => {
    if (!workflow || !accountId) return
    const runKey = `wf-test-${Date.now()}`
    let variables: Record<string, unknown>
    try { variables = JSON.parse(variablesJson) } catch { alert('Variables JSON không hợp lệ'); return }
    startTest(runKey)
    try {
      await window.electronAPI.v2.testRunWorkflow({
        runKey,
        workflowId: workflow.id || undefined,
        workflow: workflow.id ? undefined : workflow,
        accountId,
        variables
      })
    } catch (err: any) {
      console.error(err)
      appendLog({ nodeId: 'engine', line: 'Lỗi: ' + (err.message || err) })
    } finally {
      endTest()
    }
  }

  const onStop = async () => {
    if (testRunKey) {
      await window.electronAPI.v2.stopRun(testRunKey)
    }
  }

  return (
    <div style={{
      borderTop: '1px solid var(--border, #2a2a35)',
      background: 'var(--bg-secondary, #16161e)',
      maxHeight: collapsed ? 32 : 280,
      transition: 'max-height 0.2s',
      display: 'flex', flexDirection: 'column'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: '1px solid var(--border, #2a2a35)' }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setCollapsed(!collapsed)} style={{ minWidth: 28 }}>
          {collapsed ? '▲' : '▼'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--text, #e0e0e0)', fontWeight: 500 }}>Test panel</span>

        {!collapsed && (
          <>
            <select
              value={accountId ?? ''}
              onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : null)}
              style={{ padding: '4px 6px', fontSize: 12, background: 'var(--bg-primary, #0e0e15)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, color: 'var(--text, #e0e0e0)' }}
            >
              <option value="">— Chọn TK —</option>
              {accounts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {!isTesting ? (
              <button className="btn btn-sm" onClick={onTestWorkflow} disabled={!workflow || !accountId}>
                ▶ Test workflow
              </button>
            ) : (
              <button className="btn btn-sm" onClick={onStop} style={{ background: '#ef4444' }}>
                ■ Stop
              </button>
            )}

            <button className="btn btn-sm btn-ghost" onClick={clearTest}>Clear</button>

            {isTesting && <span style={{ fontSize: 11, color: '#fbbf24' }}>● Đang chạy...</span>}
          </>
        )}
      </div>

      {!collapsed && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 200px', minHeight: 0 }}>
          {/* Steps */}
          <div style={{ padding: 8, overflowY: 'auto', borderRight: '1px solid var(--border, #2a2a35)' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Steps</div>
            {stepsArray.length === 0 && <div style={{ fontSize: 11, color: '#666' }}>(chưa có step)</div>}
            {stepsArray.map((s, i) => (
              <div key={i} style={{ fontSize: 11, padding: '2px 4px', display: 'flex', gap: 6 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', marginTop: 4,
                  background: s.status === 'success' ? '#22c55e' : s.status === 'error' ? '#ef4444' : s.status === 'running' ? '#fbbf24' : '#666'
                }} />
                <span style={{ flex: 1 }}>
                  <span style={{ color: '#e0e0e0' }}>{s.blockName || s.nodeId}</span>
                  <span style={{ color: '#666', marginLeft: 4 }}>({s.nodeId})</span>
                  {s.error && <div style={{ color: '#ef4444' }}>{s.error}</div>}
                </span>
                {s.durationMs && <span style={{ color: '#666' }}>{s.durationMs}ms</span>}
              </div>
            ))}
          </div>

          {/* Logs */}
          <div style={{ padding: 8, overflowY: 'auto', borderRight: '1px solid var(--border, #2a2a35)' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Logs</div>
            {testLogs.length === 0 && <div style={{ fontSize: 11, color: '#666' }}>(chưa có log)</div>}
            <pre style={{ fontSize: 11, fontFamily: 'monospace', color: '#ddd', margin: 0, whiteSpace: 'pre-wrap' }}>
              {testLogs.map((l, i) => `[${l.nodeId}] ${l.line}`).join('\n')}
            </pre>
          </div>

          {/* Variables editor */}
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Variables (JSON)</div>
            <textarea
              value={variablesJson}
              onChange={(e) => setVariablesJson(e.target.value)}
              style={{ flex: 1, fontSize: 11, fontFamily: 'monospace', background: 'var(--bg-primary, #0e0e15)', border: '1px solid var(--border, #2a2a35)', borderRadius: 4, color: 'var(--text, #e0e0e0)', padding: 6, resize: 'none' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
